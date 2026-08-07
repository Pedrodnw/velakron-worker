const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { google } = require('googleapis')

require('../config/env')

const clientId = String(process.env.VELAKRON_GMAIL_CLIENT_ID || '').trim()
const clientSecret = String(process.env.VELAKRON_GMAIL_CLIENT_SECRET || '').trim()
const expectedMailbox = String(
  process.env.VELAKRON_GMAIL_SENDER || 'velakron@miamisoundrental.com',
).trim().toLowerCase()
const redirectUri = String(
  process.env.VELAKRON_GMAIL_OAUTH_REDIRECT_URI
    || 'http://127.0.0.1:5010/oauth2/callback',
).trim()
const tokenFile = path.resolve(
  __dirname,
  '..',
  process.env.VELAKRON_GMAIL_TOKEN_FILE || '.gmail-token.json',
)
const gmailSendScope = 'https://www.googleapis.com/auth/gmail.send'

if (!clientId || !clientSecret) {
  throw new Error('Add VELAKRON_GMAIL_CLIENT_ID and VELAKRON_GMAIL_CLIENT_SECRET before authorizing Gmail')
}

const redirect = new URL(redirectUri)
if (!['127.0.0.1', 'localhost', '::1'].includes(redirect.hostname)) {
  throw new Error('The local authorization helper requires a loopback Gmail OAuth redirect URI')
}

const state = crypto.randomBytes(32).toString('hex')
const oauth = new google.auth.OAuth2(clientId, clientSecret, redirectUri)
const authorizationUrl = oauth.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  include_granted_scopes: false,
  login_hint: expectedMailbox,
  scope: [
    'openid',
    'email',
    gmailSendScope,
  ],
  state,
})

const respond = (res, status, message) => {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(message)
}

const safeError = error => String(error?.message || 'Unknown authorization error')
  .replace(/([?&](?:token|code|secret|key)=)[^&\s]+/gi, '$1[REDACTED]')
  .replace(/[a-z0-9_-]{48,}/gi, '[REDACTED]')
  .slice(0, 500)

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, redirectUri)
  if (requestUrl.pathname !== redirect.pathname) {
    return respond(res, 404, 'Not found')
  }
  if (requestUrl.searchParams.get('state') !== state) {
    return respond(res, 400, 'Authorization state did not match. Close this page and restart the helper.')
  }
  if (requestUrl.searchParams.get('error')) {
    return respond(res, 400, 'Google authorization was not completed. No credential was saved.')
  }
  const code = requestUrl.searchParams.get('code')
  if (!code) return respond(res, 400, 'Google did not return an authorization code.')

  try {
    const { tokens } = await oauth.getToken(code)
    if (!tokens.refresh_token) {
      throw new Error('Google did not return a refresh token. Revoke the prior grant and authorize again.')
    }
    const grantedScopes = String(tokens.scope || '').split(/\s+/).filter(Boolean)
    if (!grantedScopes.includes(gmailSendScope)) {
      throw new Error('Google did not grant Gmail send permission. Select the send-email permission and authorize again.')
    }
    oauth.setCredentials(tokens)
    const identity = google.oauth2({ version: 'v2', auth: oauth })
    const profile = await identity.userinfo.get()
    const mailbox = String(profile?.data?.email || '').trim().toLowerCase()
    if (mailbox !== expectedMailbox) {
      throw new Error(`The authorized mailbox was ${mailbox || 'unknown'}, not ${expectedMailbox}`)
    }
    fs.writeFileSync(tokenFile, `${JSON.stringify({
      mailbox,
      refresh_token: tokens.refresh_token,
      scope: tokens.scope || '',
      authorized_at: new Date().toISOString(),
    }, null, 2)}\n`, { mode: 0o600 })
    fs.chmodSync(tokenFile, 0o600)
    respond(res, 200, 'Velakron Gmail authorization is complete. You can close this page.')
    console.log(`Gmail authorization saved for ${mailbox} in an ignored local credential file.`)
    server.close()
  } catch (error) {
    respond(res, 400, 'Authorization failed. No credential was saved; check the worker terminal for the safe error summary.')
    console.error(`Gmail authorization failed: ${safeError(error)}`)
    server.close()
  }
})

server.listen(Number(redirect.port || 80), redirect.hostname, () => {
  console.log(`Authorize only ${expectedMailbox} using this URL:`)
  console.log(authorizationUrl)
  console.log(`Waiting for Google to return to ${redirectUri}`)
})
