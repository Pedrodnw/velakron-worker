const { expect } = require('chai')
const mongoose = require('mongoose')
const { loadConfig } = require('../config/env')
const { registerDefaultJobs } = require('../jobs/defaults')
const { buildClaimFilter, createOutboxProcessor, redactError, retryDelay } = require('../jobs/outboxProcessor')
const { clearJobsForTest } = require('../jobs/registry')
const { OutboxEvent } = require('../models/OutboxEvent')
const { GmailEmailProvider, GmailProviderError, safeProviderError } = require('../services/providers/gmail')
const { encryptOutboxPayload } = require('../services/outboxPayload')

const outboxEncryptionKey = Buffer.alloc(32, 7).toString('base64')

const providerConfig = overrides => ({
  adapter: 'gmail',
  deliveryEnabled: true,
  allowedRecipients: ['recipient@example.test'],
  gmail: {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    oauthRedirectUri: 'http://127.0.0.1:5010/oauth2/callback',
    authorizedMailbox: 'plara@velakron.com',
    sender: 'app@velakron.com',
    fromName: 'Velakron',
    replyTo: 'app@velakron.com',
  },
  ...overrides,
})

describe('Phase 7 Gmail delivery', () => {
  afterEach(() => clearJobsForTest())

  it('sends a MIME message through Gmail only after verifying the mailbox', async () => {
    const calls = []
    const provider = new GmailEmailProvider({
      config: providerConfig(),
      identityClient: {
        userinfo: {
          get: async () => ({ data: { email: 'plara@velakron.com' } }),
        },
      },
      gmailClient: {
        users: {
          messages: {
            send: async options => {
              calls.push(options)
              return { data: { id: 'gmail-message-1', threadId: 'gmail-thread-1' } }
            },
          },
        },
      },
    })
    const result = await provider.send({
      to: 'recipient@example.test',
      subject: 'Velakron invitation',
      text: 'Review your invitation.',
      html: '<p>Review your invitation.</p>',
    }, { idempotencyKey: 'identity.email.send:v1:aggregate:occurrence' })

    expect(result).to.deep.equal({
      provider: 'gmail',
      messageId: 'gmail-message-1',
      threadId: 'gmail-thread-1',
      state: 'submitted',
    })
    expect(calls).to.have.length(1)
    expect(calls[0].userId).to.equal('me')
    const mime = Buffer.from(calls[0].requestBody.raw, 'base64url').toString('utf8')
    expect(mime).to.include('From: Velakron <app@velakron.com>')
    expect(mime).to.include('To: recipient@example.test')
    expect(mime).to.include('Subject: Velakron invitation')
    expect(mime).to.match(/Message-ID:\s*<velakron-[a-f0-9]{32}@velakron\.com>/i)
  })

  it('refuses a token belonging to any other Google mailbox', async () => {
    let sendCalled = false
    const provider = new GmailEmailProvider({
      config: providerConfig(),
      identityClient: {
        userinfo: { get: async () => ({ data: { email: 'someone@velakron.com' } }) },
      },
      gmailClient: {
        users: { messages: { send: async () => { sendCalled = true } } },
      },
    })
    try {
      await provider.send({
        to: 'recipient@example.test',
        subject: 'Test',
        text: 'Test',
      }, { idempotencyKey: 'safe-key' })
      throw new Error('Expected mailbox verification to fail')
    } catch (error) {
      expect(error).to.be.instanceOf(GmailProviderError)
      expect(error.code).to.equal('GMAIL_SENDER_MISMATCH')
    }
    expect(sendCalled).to.equal(false)
  })

  it('classifies retryable provider failures and redacts secrets', () => {
    expect(safeProviderError({ response: { status: 429 } })).to.include({ retryable: true })
    expect(safeProviderError({ response: { status: 401 } })).to.include({ retryable: false })
    expect(redactError(new Error('failed token=abcdefghijklmnopqrstuvwxyz0123456789-secret')))
      .not.to.include('abcdefghijklmnopqrstuvwxyz')
    expect(retryDelay({ attempt: 2, random: () => 0 })).to.equal(2000)
  })

  it('keeps outbox claim operators trusted when Mongoose sanitizes filters', () => {
    const filter = mongoose.sanitizeFilter(buildClaimFilter({
      eventTypes: ['identity.email.send'],
      currentTime: new Date('2030-01-02T03:04:05.000Z'),
    }))

    expect(() => OutboxEvent.findOne(filter).cast(OutboxEvent)).not.to.throw()
    expect(filter.event_type).to.deep.include({ $in: ['identity.email.send'] })
    expect(filter.$or[0].state).to.deep.include({ $in: ['pending', 'retryable'] })
  })

  it('claims and completes a durable identity email without logging its content', async () => {
    const event = {
      _id: '507f1f77bcf86cd799439099',
      event_type: 'identity.email.send',
      payload: encryptOutboxPayload({
        to: 'recipient@example.test',
        subject: 'Test',
        text: 'Secret action link',
      }, outboxEncryptionKey),
      idempotency_key: 'identity.email.send:v1:aggregate:occurrence',
      correlation_id: 'request-123',
      attempt: 1,
      max_attempts: 8,
    }
    const updates = []
    const outboxModel = {
      findOneAndUpdate: () => ({ lean: async () => event }),
      updateOne: async (...args) => { updates.push(args) },
    }
    registerDefaultJobs({
      emailProvider: {
        send: async () => ({ provider: 'gmail', messageId: 'gmail-message-1' }),
      },
    })
    const processor = createOutboxProcessor({
      config: {
        email: { deliveryEnabled: true, outboxEncryptionKey },
        jobs: { instanceId: 'test-worker', leaseMilliseconds: 60_000 },
      },
      outboxModel,
      now: () => new Date('2030-01-02T03:04:05.000Z'),
    })
    expect(await processor.processOne()).to.deep.equal({
      state: 'completed',
      eventId: event._id,
    })
    expect(updates).to.have.length(1)
    expect(updates[0][1].$set).to.include({
      state: 'completed',
      provider: 'gmail',
      provider_message_id: 'gmail-message-1',
      provider_state: 'submitted',
    })
  })

  it('requires both worker and delivery switches plus Gmail credentials', () => {
    const keys = [
      'NODE_ENV',
      'MONGO_URI',
      'MONGO_DB_NAME',
      'VELAKRON_JOBS_ENABLED',
      'VELAKRON_EMAIL_ADAPTER',
      'VELAKRON_EMAIL_DELIVERY_ENABLED',
      'VELAKRON_OUTBOX_ENCRYPTION_KEY',
      'VELAKRON_GMAIL_CLIENT_ID',
      'VELAKRON_GMAIL_CLIENT_SECRET',
      'VELAKRON_GMAIL_REFRESH_TOKEN',
      'VELAKRON_GMAIL_CREDENTIALS_FILE',
      'VELAKRON_GMAIL_TOKEN_FILE',
      'VELAKRON_GMAIL_AUTHORIZED_MAILBOX',
      'VELAKRON_EMAIL_ALLOWED_RECIPIENTS',
    ]
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
    try {
      process.env.NODE_ENV = 'development'
      process.env.MONGO_URI = 'mongodb://127.0.0.1:27017'
      process.env.MONGO_DB_NAME = 'velakron'
      process.env.VELAKRON_JOBS_ENABLED = 'true'
      process.env.VELAKRON_EMAIL_ADAPTER = 'gmail'
      process.env.VELAKRON_EMAIL_DELIVERY_ENABLED = 'true'
      delete process.env.VELAKRON_GMAIL_CLIENT_ID
      delete process.env.VELAKRON_GMAIL_CLIENT_SECRET
      delete process.env.VELAKRON_GMAIL_REFRESH_TOKEN
      delete process.env.VELAKRON_GMAIL_CREDENTIALS_FILE
      delete process.env.VELAKRON_GMAIL_TOKEN_FILE
      process.env.VELAKRON_EMAIL_ALLOWED_RECIPIENTS = 'recipient@example.test'
      expect(() => loadConfig()).to.throw('Gmail client ID, client secret, and refresh token are required')
    } finally {
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key]
        else process.env[key] = previous[key]
      }
    }
  })
})
