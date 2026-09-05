const fs = require('node:fs')
const path = require('node:path')
const dotenv = require('dotenv')

const workerRoot = path.join(__dirname, '..')
const configuredEnvFile = process.env.VELAKRON_ENV_FILE
const envFile = configuredEnvFile
  ? path.resolve(workerRoot, configuredEnvFile)
  : ['config.env', '.env']
    .map(file => path.join(workerRoot, file))
    .find(file => fs.existsSync(file))

if (envFile) dotenv.config({ path: envFile, quiet: true })

const parsePositiveNumber = (value, fallback, name) => {
  const parsed = Number(value || fallback)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`)
  return parsed
}

const parseBoolean = (value, fallback, name) => {
  if (value === undefined || value === null || value === '') return fallback
  const normalized = String(value).trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  throw new Error(`${name} must be true or false`)
}

const parseList = value => String(value || '')
  .split(',')
  .map(item => item.trim().toLowerCase())
  .filter(Boolean)

const validOutboxEncryptionKey = value => {
  const encoded = String(value || '').trim()
  const decoded = Buffer.from(encoded, 'base64')
  const canonical = decoded.toString('base64').replace(/=+$/, '') === encoded.replace(/=+$/, '')
  return canonical && decoded.length >= 32 && decoded.length <= 64
}

const readRefreshToken = tokenFile => {
  const direct = String(process.env.VELAKRON_GMAIL_REFRESH_TOKEN || '').trim()
  if (direct) return direct
  if (!fs.existsSync(tokenFile)) return ''
  try {
    const parsed = JSON.parse(fs.readFileSync(tokenFile, 'utf8'))
    const scopes = String(parsed.scope || '').split(/\s+/).filter(Boolean)
    if (!scopes.includes('https://www.googleapis.com/auth/gmail.send')) return ''
    return String(parsed.refresh_token || '').trim()
  } catch (_error) {
    throw new Error('VELAKRON_GMAIL_TOKEN_FILE must contain valid Gmail OAuth token JSON')
  }
}

const readGoogleOAuthClient = redirectUri => {
  const configuredFile = String(process.env.VELAKRON_GMAIL_CREDENTIALS_FILE || '').trim()
  if (!configuredFile) {
    return {
      clientId: String(process.env.VELAKRON_GMAIL_CLIENT_ID || '').trim(),
      clientSecret: String(process.env.VELAKRON_GMAIL_CLIENT_SECRET || '').trim(),
    }
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(path.resolve(workerRoot, configuredFile), 'utf8'))
    const client = parsed?.web || parsed?.installed
    const redirectUris = Array.isArray(client?.redirect_uris) ? client.redirect_uris : []
    if (!redirectUris.includes(redirectUri)) throw new Error('callback mismatch')
    return {
      clientId: String(client?.client_id || '').trim(),
      clientSecret: String(client?.client_secret || '').trim(),
    }
  } catch {
    throw new Error('VELAKRON_GMAIL_CREDENTIALS_FILE must contain valid Google OAuth client JSON')
  }
}

const loadConfig = () => {
  const nodeEnv = process.env.NODE_ENV || 'development'
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production')
  }

  const mongoUri = String(process.env.MONGO_URI || '').trim()
  if (!mongoUri) throw new Error('MONGO_URI is required')

  const databaseName = String(
    process.env.MONGO_DB_NAME || (nodeEnv === 'test' ? 'velakron_test' : 'velakron'),
  ).trim()
  const allowedDatabase = nodeEnv === 'test'
    ? /^velakron(?:_[a-z0-9]+)*_test$/i.test(databaseName)
    : databaseName === 'velakron'
  if (!allowedDatabase || databaseName.toLowerCase().includes('dnw')) {
    throw new Error('Worker database must be velakron, or a Velakron-only test database in test mode')
  }

  const jobsEnabled = parseBoolean(
    process.env.VELAKRON_JOBS_ENABLED,
    false,
    'VELAKRON_JOBS_ENABLED',
  )
  const scheduledJobsEnabled = parseBoolean(
    process.env.VELAKRON_SCHEDULED_JOBS_ENABLED,
    false,
    'VELAKRON_SCHEDULED_JOBS_ENABLED',
  )
  const attentionWritesEnabled = parseBoolean(
    process.env.VELAKRON_ATTENTION_WRITES_ENABLED,
    false,
    'VELAKRON_ATTENTION_WRITES_ENABLED',
  )
  const maintenanceWritesEnabled = parseBoolean(
    process.env.VELAKRON_MAINTENANCE_WRITES_ENABLED,
    false,
    'VELAKRON_MAINTENANCE_WRITES_ENABLED',
  )
  const partReminderWritesEnabled = parseBoolean(
    process.env.VELAKRON_PART_REMINDER_WRITES_ENABLED,
    false,
    'VELAKRON_PART_REMINDER_WRITES_ENABLED',
  )
  const inspectionReminderWritesEnabled = parseBoolean(
    process.env.VELAKRON_INSPECTION_REMINDER_WRITES_ENABLED,
    false,
    'VELAKRON_INSPECTION_REMINDER_WRITES_ENABLED',
  )
  const billingProcessingEnabled = parseBoolean(
    process.env.VELAKRON_BILLING_PROCESSING_ENABLED,
    false,
    'VELAKRON_BILLING_PROCESSING_ENABLED',
  )
  const billingReminderWritesEnabled = parseBoolean(
    process.env.VELAKRON_BILLING_REMINDER_WRITES_ENABLED,
    false,
    'VELAKRON_BILLING_REMINDER_WRITES_ENABLED',
  )
  if (scheduledJobsEnabled && !jobsEnabled) {
    throw new Error('VELAKRON_JOBS_ENABLED must be true when scheduled jobs are enabled')
  }
  if (attentionWritesEnabled && !scheduledJobsEnabled) {
    throw new Error('VELAKRON_SCHEDULED_JOBS_ENABLED must be true when attention writes are enabled')
  }
  if (maintenanceWritesEnabled && !scheduledJobsEnabled) {
    throw new Error('VELAKRON_SCHEDULED_JOBS_ENABLED must be true when maintenance writes are enabled')
  }
  if (partReminderWritesEnabled && !scheduledJobsEnabled) {
    throw new Error('VELAKRON_SCHEDULED_JOBS_ENABLED must be true when Part Workspace reminder writes are enabled')
  }
  if (inspectionReminderWritesEnabled && !scheduledJobsEnabled) {
    throw new Error('VELAKRON_SCHEDULED_JOBS_ENABLED must be true when inspection reminder writes are enabled')
  }
  if (billingProcessingEnabled && !scheduledJobsEnabled) {
    throw new Error('VELAKRON_SCHEDULED_JOBS_ENABLED must be true when billing processing is enabled')
  }
  if (billingReminderWritesEnabled && !billingProcessingEnabled) {
    throw new Error('VELAKRON_BILLING_PROCESSING_ENABLED must be true when billing reminder writes are enabled')
  }

  const emailAdapter = String(process.env.VELAKRON_EMAIL_ADAPTER || 'development')
    .trim()
    .toLowerCase()
  if (!['development', 'gmail'].includes(emailAdapter)) {
    throw new Error('VELAKRON_EMAIL_ADAPTER must be development or gmail')
  }

  const emailDeliveryEnabled = parseBoolean(
    process.env.VELAKRON_EMAIL_DELIVERY_ENABLED,
    false,
    'VELAKRON_EMAIL_DELIVERY_ENABLED',
  )
  const outboxEncryptionKey = String(process.env.VELAKRON_OUTBOX_ENCRYPTION_KEY || '').trim()
  const clientAppUrl = String(process.env.VELAKRON_CLIENT_APP_URL || 'http://127.0.0.1:5001').trim().replace(/\/$/, '')
  if (!/^https?:\/\/[^\s]+$/i.test(clientAppUrl) || (nodeEnv === 'production' && !clientAppUrl.startsWith('https://'))) {
    throw new Error('VELAKRON_CLIENT_APP_URL must be an HTTPS URL in production')
  }
  if ((partReminderWritesEnabled || inspectionReminderWritesEnabled || billingReminderWritesEnabled) && !validOutboxEncryptionKey(outboxEncryptionKey)) {
    throw new Error('VELAKRON_OUTBOX_ENCRYPTION_KEY is required when reminder writes are enabled')
  }
  const gmailTokenFile = path.resolve(
    workerRoot,
    process.env.VELAKRON_GMAIL_TOKEN_FILE || '.gmail-token.json',
  )
  const gmailOauthRedirectUri = String(
    process.env.VELAKRON_GMAIL_OAUTH_REDIRECT_URI
      || 'http://127.0.0.1:5010/oauth2/callback',
  ).trim()
  const gmailOAuthClient = readGoogleOAuthClient(gmailOauthRedirectUri)
  const gmail = Object.freeze({
    clientId: gmailOAuthClient.clientId,
    clientSecret: gmailOAuthClient.clientSecret,
    refreshToken: readRefreshToken(gmailTokenFile),
    tokenFile: gmailTokenFile,
    authorizedMailbox: String(
      process.env.VELAKRON_GMAIL_AUTHORIZED_MAILBOX
        || process.env.VELAKRON_GMAIL_SENDER
        || 'velakron@miamisoundrental.com',
    ).trim().toLowerCase(),
    sender: String(
      process.env.VELAKRON_GMAIL_SENDER || 'velakron@miamisoundrental.com',
    ).trim().toLowerCase(),
    fromName: String(process.env.VELAKRON_GMAIL_FROM_NAME || 'Velakron').trim(),
    replyTo: String(
      process.env.VELAKRON_GMAIL_REPLY_TO || 'velakron@miamisoundrental.com',
    ).trim().toLowerCase(),
    oauthRedirectUri: gmailOauthRedirectUri,
  })
  const allowedRecipients = parseList(process.env.VELAKRON_EMAIL_ALLOWED_RECIPIENTS)
  const malwareScannerAdapter = String(process.env.VELAKRON_MALWARE_SCANNER_ADAPTER || 'disabled')
    .trim()
    .toLowerCase()
  if (!['disabled', 'guardduty_s3'].includes(malwareScannerAdapter)) {
    throw new Error('VELAKRON_MALWARE_SCANNER_ADAPTER must be disabled or guardduty_s3')
  }
  const malwareScanningEnabled = parseBoolean(
    process.env.VELAKRON_MALWARE_SCANNING_ENABLED,
    false,
    'VELAKRON_MALWARE_SCANNING_ENABLED',
  )
  const scannerAccountId = String(process.env.VELAKRON_AWS_ACCOUNT_ID || '').trim()
  const scannerRegion = String(process.env.VELAKRON_AWS_REGION || '').trim()
  const scannerBucket = String(process.env.VELAKRON_S3_BUCKET || '').trim()
  const scannerAccessKeyId = String(process.env.VELAKRON_AWS_ACCESS_KEY_ID || '').trim()
  const scannerSecretAccessKey = String(process.env.VELAKRON_AWS_SECRET_ACCESS_KEY || '').trim()
  const scannerSessionToken = String(process.env.VELAKRON_AWS_SESSION_TOKEN || '').trim()
  const itarEnabled = parseBoolean(process.env.VELAKRON_ITAR_ENABLED, false, 'VELAKRON_ITAR_ENABLED')
  const itarFipsEndpoint = parseBoolean(process.env.VELAKRON_ITAR_FIPS_ENDPOINT, false, 'VELAKRON_ITAR_FIPS_ENDPOINT')
  const itarKmsKeyArn = String(process.env.VELAKRON_ITAR_KMS_KEY_ARN || '').trim()
  const itarDatabaseApproved = parseBoolean(process.env.VELAKRON_ITAR_DATABASE_APPROVED, false, 'VELAKRON_ITAR_DATABASE_APPROVED')
  if (malwareScanningEnabled) {
    if (!jobsEnabled) throw new Error('VELAKRON_JOBS_ENABLED must be true when malware scanning is enabled')
    if (malwareScannerAdapter !== 'guardduty_s3') {
      throw new Error('VELAKRON_MALWARE_SCANNER_ADAPTER must be guardduty_s3 when scanning is enabled')
    }
    if (!/^\d{12}$/.test(scannerAccountId) || !scannerRegion || !scannerBucket) {
      throw new Error('AWS account, region, and bucket are required when GuardDuty S3 scanning is enabled')
    }
    if ((scannerAccessKeyId && !scannerSecretAccessKey) || (!scannerAccessKeyId && scannerSecretAccessKey)) {
      throw new Error('AWS access key ID and secret access key must be provided together')
    }
  }
  if (itarEnabled) {
    if (!['us-gov-east-1', 'us-gov-west-1'].includes(scannerRegion)) {
      throw new Error('VELAKRON_ITAR_ENABLED requires an AWS GovCloud (US) region')
    }
    if (!itarFipsEndpoint) {
      throw new Error('VELAKRON_ITAR_ENABLED requires VELAKRON_ITAR_FIPS_ENDPOINT=true')
    }
    const expectedKmsPrefix = `arn:aws-us-gov:kms:${scannerRegion}:${scannerAccountId}:key/`
    if (!itarKmsKeyArn.startsWith(expectedKmsPrefix) || itarKmsKeyArn.length <= expectedKmsPrefix.length) {
      throw new Error('VELAKRON_ITAR_KMS_KEY_ARN must be a customer-managed AWS GovCloud KMS key ARN in the configured account and region')
    }
    if (!malwareScanningEnabled) {
      throw new Error('VELAKRON_ITAR_ENABLED requires malware scanning in the worker')
    }
    if (nodeEnv === 'production' && String(process.env.AWS_REGION || '') !== scannerRegion) {
      throw new Error('VELAKRON_ITAR_ENABLED requires the worker runtime itself to run in the configured AWS GovCloud (US) region')
    }
    if (!itarDatabaseApproved) {
      throw new Error('VELAKRON_ITAR_ENABLED requires VELAKRON_ITAR_DATABASE_APPROVED=true after the database is approved for ITAR data')
    }
  }

  if (emailDeliveryEnabled) {
    if (!jobsEnabled) {
      throw new Error('VELAKRON_JOBS_ENABLED must be true when Gmail delivery is enabled')
    }
    if (emailAdapter !== 'gmail') {
      throw new Error('VELAKRON_EMAIL_ADAPTER must be gmail when delivery is enabled')
    }
    if (!gmail.clientId || !gmail.clientSecret || !gmail.refreshToken) {
      throw new Error('Gmail client ID, client secret, and refresh token are required when delivery is enabled')
    }
    if (!validOutboxEncryptionKey(outboxEncryptionKey)) {
      throw new Error('VELAKRON_OUTBOX_ENCRYPTION_KEY must contain 32 to 64 base64-encoded random bytes when delivery is enabled')
    }
    if (!/^\S+@\S+\.\S+$/.test(gmail.authorizedMailbox)
      || !/^\S+@\S+\.\S+$/.test(gmail.sender)
      || !/^\S+@\S+\.\S+$/.test(gmail.replyTo)) {
      throw new Error('Gmail authorized mailbox, sender, and reply-to must be valid email addresses')
    }
    if (nodeEnv !== 'production' && allowedRecipients.length === 0) {
      throw new Error('VELAKRON_EMAIL_ALLOWED_RECIPIENTS is required for non-production Gmail delivery')
    }
  }

  return Object.freeze({
    nodeEnv,
    clientAppUrl,
    isProduction: nodeEnv === 'production',
    isTest: nodeEnv === 'test',
    host: process.env.HOST || '127.0.0.1',
    port: parsePositiveNumber(process.env.PORT, 5004, 'PORT'),
    mongoUri,
    databaseName,
    jobs: Object.freeze({
      enabled: jobsEnabled,
      scheduledEnabled: scheduledJobsEnabled,
      attentionWritesEnabled,
      maintenanceWritesEnabled,
      partReminderWritesEnabled,
      inspectionReminderWritesEnabled,
      billingProcessingEnabled,
      billingReminderWritesEnabled,
      instanceId: String(process.env.VELAKRON_WORKER_INSTANCE_ID || 'local-worker'),
      outboxPollMilliseconds: parsePositiveNumber(
        process.env.VELAKRON_OUTBOX_POLL_MS,
        5000,
        'VELAKRON_OUTBOX_POLL_MS',
      ),
      leaseMilliseconds: parsePositiveNumber(
        process.env.VELAKRON_JOB_LEASE_MS,
        60000,
        'VELAKRON_JOB_LEASE_MS',
      ),
      maxAttempts: parsePositiveNumber(
        process.env.VELAKRON_JOB_MAX_ATTEMPTS,
        8,
        'VELAKRON_JOB_MAX_ATTEMPTS',
      ),
      attentionIntervalMilliseconds: parsePositiveNumber(
        process.env.VELAKRON_ATTENTION_INTERVAL_MS,
        15 * 60 * 1000,
        'VELAKRON_ATTENTION_INTERVAL_MS',
      ),
      attachmentMaintenanceIntervalMilliseconds: parsePositiveNumber(
        process.env.VELAKRON_ATTACHMENT_MAINTENANCE_INTERVAL_MS,
        60 * 60 * 1000,
        'VELAKRON_ATTACHMENT_MAINTENANCE_INTERVAL_MS',
      ),
      tokenCleanupIntervalMilliseconds: parsePositiveNumber(
        process.env.VELAKRON_TOKEN_CLEANUP_INTERVAL_MS,
        6 * 60 * 60 * 1000,
        'VELAKRON_TOKEN_CLEANUP_INTERVAL_MS',
      ),
      partReminderIntervalMilliseconds: parsePositiveNumber(
        process.env.VELAKRON_PART_REMINDER_INTERVAL_MS,
        60 * 60 * 1000,
        'VELAKRON_PART_REMINDER_INTERVAL_MS',
      ),
      inspectionReminderIntervalMilliseconds: parsePositiveNumber(
        process.env.VELAKRON_INSPECTION_REMINDER_INTERVAL_MS,
        60 * 60 * 1000,
        'VELAKRON_INSPECTION_REMINDER_INTERVAL_MS',
      ),
      billingProcessingIntervalMilliseconds: parsePositiveNumber(
        process.env.VELAKRON_BILLING_PROCESSING_INTERVAL_MS,
        60 * 1000,
        'VELAKRON_BILLING_PROCESSING_INTERVAL_MS',
      ),
      billingLifecycleIntervalMilliseconds: parsePositiveNumber(
        process.env.VELAKRON_BILLING_LIFECYCLE_INTERVAL_MS,
        60 * 60 * 1000,
        'VELAKRON_BILLING_LIFECYCLE_INTERVAL_MS',
      ),
    }),
    attention: Object.freeze({
      awaitingAcceptanceHours: parsePositiveNumber(
        process.env.VELAKRON_AWAITING_ACCEPTANCE_HOURS,
        48,
        'VELAKRON_AWAITING_ACCEPTANCE_HOURS',
      ),
      staleSupplierDays: parsePositiveNumber(
        process.env.VELAKRON_STALE_SUPPLIER_DAYS,
        5,
        'VELAKRON_STALE_SUPPLIER_DAYS',
      ),
      highSlipDays: parsePositiveNumber(
        process.env.VELAKRON_HIGH_SLIP_DAYS,
        7,
        'VELAKRON_HIGH_SLIP_DAYS',
      ),
      machineRequiredStage: 'in_production',
    }),
    email: Object.freeze({
      adapter: emailAdapter,
      deliveryEnabled: emailDeliveryEnabled,
      outboxEncryptionKey,
      allowedRecipients: Object.freeze(allowedRecipients),
      gmail,
    }),
    malwareScanner: Object.freeze({
      adapter: malwareScannerAdapter,
      enabled: malwareScanningEnabled,
      guardDutyS3: Object.freeze({
        accountId: scannerAccountId,
        region: scannerRegion,
        bucket: scannerBucket,
        accessKeyId: scannerAccessKeyId,
        secretAccessKey: scannerSecretAccessKey,
        sessionToken: scannerSessionToken,
        environment: nodeEnv,
        tagKey: String(
          process.env.VELAKRON_GUARDDUTY_SCAN_TAG_KEY || 'GuardDutyMalwareScanStatus',
        ).trim(),
        fipsEndpoint: itarEnabled && itarFipsEndpoint,
        itarKmsKeyArn,
      }),
    }),
    itar: Object.freeze({ enabled: itarEnabled }),
  })
}

module.exports = {
  loadConfig,
  parseBoolean,
  parseList,
  parsePositiveNumber,
  readRefreshToken,
  validOutboxEncryptionKey,
}
