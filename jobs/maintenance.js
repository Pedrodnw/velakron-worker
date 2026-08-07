const createAttachmentMaintenanceJob = ({
  enabled = false,
  inspect,
  intervalMilliseconds = 60 * 60 * 1000,
  write = false,
}) => {
  if (typeof inspect !== 'function') throw new Error('Attachment maintenance job requires an inspector')
  return Object.freeze({
    key: 'attachment.abandoned.cleanup',
    kind: 'scheduled',
    enabled,
    intervalMilliseconds,
    timeoutMilliseconds: 60_000,
    maxAttempts: 3,
    concurrency: 1,
    idempotency: 'attachment-id-expiry',
    redaction: 'counts-only',
    run: (payload = {}, context = {}) => inspect({
      limit: Math.max(1, Math.min(Number(payload.limit) || 100, 100)),
      now: context.now || new Date(),
      write,
    }),
  })
}

const createTokenCleanupJob = ({
  enabled = false,
  inspect,
  intervalMilliseconds = 6 * 60 * 60 * 1000,
  write = false,
}) => {
  if (typeof inspect !== 'function') throw new Error('Token cleanup job requires an inspector')
  return Object.freeze({
    key: 'token.expired.cleanup',
    kind: 'scheduled',
    enabled,
    intervalMilliseconds,
    timeoutMilliseconds: 60_000,
    maxAttempts: 3,
    concurrency: 1,
    idempotency: 'token-id-expiry',
    redaction: 'counts-only',
    run: (_payload = {}, context = {}) => inspect({
      now: context.now || new Date(),
      write,
    }),
  })
}

module.exports = { createAttachmentMaintenanceJob, createTokenCleanupJob }
