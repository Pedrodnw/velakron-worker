const crypto = require('node:crypto')
const MailComposer = require('nodemailer/lib/mail-composer')
const { google } = require('googleapis')

const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504])
const TRANSIENT_ERROR_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
  'RATE_LIMITED',
])

const normalizeAddress = value => String(value || '').trim().toLowerCase()

const safeProviderError = error => {
  const status = Number(error?.response?.status || error?.code)
  const providerReason = error?.response?.data?.error?.errors?.[0]?.reason
  const rawCode = providerReason || error?.code || (status ? `HTTP_${status}` : 'GMAIL_REQUEST_FAILED')
  const code = String(rawCode).replace(/[^a-z0-9_.-]/gi, '_').slice(0, 120)
  const retryable = TRANSIENT_STATUS_CODES.has(status)
    || TRANSIENT_ERROR_CODES.has(String(rawCode).toUpperCase())
  return { code, retryable }
}

class GmailProviderError extends Error {
  constructor(message, { code = 'GMAIL_REQUEST_FAILED', retryable = false } = {}) {
    super(message)
    this.name = 'GmailProviderError'
    this.code = code
    this.retryable = retryable
  }
}

const buildOAuthClient = config => {
  const client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.oauthRedirectUri,
  )
  client.setCredentials({ refresh_token: config.refreshToken })
  return client
}

const createGmailClient = config => google.gmail({
  version: 'v1',
  auth: buildOAuthClient(config),
})

const createIdentityClient = config => google.oauth2({
  version: 'v2',
  auth: buildOAuthClient(config),
})

class GmailEmailProvider {
  constructor({ config, gmailClient = null, identityClient = null } = {}) {
    if (!config?.gmail?.sender) throw new Error('Gmail provider requires a configured sender')
    if (/[\r\n]/.test(config.gmail.fromName)) throw new Error('Gmail from name cannot contain line breaks')
    this.config = config
    this.gmail = gmailClient || createGmailClient(config.gmail)
    this.identity = identityClient || createIdentityClient(config.gmail)
    this.verifiedMailbox = null
  }

  getStatus() {
    return Object.freeze({
      provider: 'gmail',
      enabled: this.config.deliveryEnabled,
      configured: Boolean(
        this.config.gmail.clientId
        && this.config.gmail.clientSecret
        && this.config.gmail.refreshToken,
      ),
      sender: this.config.gmail.sender,
      mailbox_verified: Boolean(this.verifiedMailbox),
    })
  }

  assertRecipientAllowed(to) {
    const recipient = normalizeAddress(to)
    if (!/^\S+@\S+\.\S+$/.test(recipient) || recipient.length > 320) {
      throw new GmailProviderError('Recipient address is invalid', {
        code: 'INVALID_RECIPIENT',
        retryable: false,
      })
    }
    const allowlist = this.config.allowedRecipients || []
    if (allowlist.length && !allowlist.includes(recipient)) {
      throw new GmailProviderError('Recipient is not approved for this environment', {
        code: 'RECIPIENT_NOT_ALLOWED',
        retryable: false,
      })
    }
    return recipient
  }

  async verifyMailbox() {
    if (this.verifiedMailbox) return this.verifiedMailbox
    let profile
    try {
      const response = await this.identity.userinfo.get()
      profile = normalizeAddress(response?.data?.email)
    } catch (error) {
      const safe = safeProviderError(error)
      throw new GmailProviderError('Gmail mailbox verification failed', safe)
    }
    if (profile !== normalizeAddress(this.config.gmail.sender)) {
      throw new GmailProviderError('Gmail token belongs to a different mailbox', {
        code: 'GMAIL_SENDER_MISMATCH',
        retryable: false,
      })
    }
    this.verifiedMailbox = profile
    return profile
  }

  async createRawMessage(message, idempotencyKey) {
    const recipient = this.assertRecipientAllowed(message.to)
    const subject = String(message.subject || '').trim()
    const text = String(message.text || '')
    const html = String(message.html || '')
    if (!subject || /[\r\n]/.test(subject) || (!text && !html)) {
      throw new GmailProviderError('Queued email content is invalid', {
        code: 'INVALID_EMAIL_CONTENT',
        retryable: false,
      })
    }
    if (subject.length > 998 || text.length > 200_000 || html.length > 400_000) {
      throw new GmailProviderError('Queued email content exceeds the supported size', {
        code: 'EMAIL_CONTENT_TOO_LARGE',
        retryable: false,
      })
    }
    const hash = crypto.createHash('sha256').update(String(idempotencyKey)).digest('hex').slice(0, 32)
    const mail = new MailComposer({
      to: recipient,
      from: {
        name: this.config.gmail.fromName,
        address: this.config.gmail.sender,
      },
      replyTo: this.config.gmail.replyTo,
      subject,
      text,
      html,
      messageId: `<velakron-${hash}@miamisoundrental.com>`,
      headers: {
        'X-Velakron-Delivery': hash,
      },
      disableFileAccess: true,
      disableUrlAccess: true,
    }).compile()
    const raw = await mail.build()
    return raw.toString('base64url')
  }

  async send(message, { idempotencyKey } = {}) {
    if (!this.config.deliveryEnabled) {
      throw new GmailProviderError('Gmail delivery is disabled', {
        code: 'GMAIL_DELIVERY_DISABLED',
        retryable: false,
      })
    }
    if (!idempotencyKey) {
      throw new GmailProviderError('Email delivery requires an idempotency key', {
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        retryable: false,
      })
    }
    await this.verifyMailbox()
    const raw = await this.createRawMessage(message, idempotencyKey)
    try {
      const response = await this.gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw },
      })
      if (!response?.data?.id) {
        throw new GmailProviderError('Gmail did not return a message identifier', {
          code: 'GMAIL_MESSAGE_ID_MISSING',
          retryable: true,
        })
      }
      return Object.freeze({
        provider: 'gmail',
        messageId: String(response.data.id),
        threadId: response.data.threadId ? String(response.data.threadId) : null,
        state: 'submitted',
      })
    } catch (error) {
      if (error instanceof GmailProviderError) throw error
      const safe = safeProviderError(error)
      throw new GmailProviderError('Gmail message submission failed', safe)
    }
  }
}

module.exports = {
  GmailEmailProvider,
  GmailProviderError,
  buildOAuthClient,
  createGmailClient,
  createIdentityClient,
  safeProviderError,
}
