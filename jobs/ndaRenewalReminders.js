const createNdaRenewalReminderJob = ({
  enabled = false,
  sweep,
  intervalMilliseconds = 6 * 60 * 60 * 1000,
  write = false,
  encryptionKey,
  clientAppUrl,
}) => {
  if (typeof sweep !== 'function') throw new Error('NDA renewal reminder job requires a sweep function')
  return Object.freeze({
    key: 'nda_renewal.reminders.evaluate',
    kind: 'scheduled',
    enabled,
    intervalMilliseconds,
    timeoutMilliseconds: 60_000,
    maxAttempts: 3,
    concurrency: 1,
    idempotency: 'requirement-milestone-recipient',
    redaction: 'counts-only',
    run: (payload = {}, context = {}) => sweep({
      limit: Math.max(1, Math.min(Number(payload.limit) || 250, 500)),
      now: context.now || new Date(),
      write,
      encryptionKey,
      clientAppUrl,
    }),
  })
}

module.exports = { createNdaRenewalReminderJob }
