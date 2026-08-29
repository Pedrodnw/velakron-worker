const createInspectionReminderJob = ({
  enabled = false,
  sweep,
  intervalMilliseconds = 60 * 60 * 1000,
  write = false,
  encryptionKey,
  clientAppUrl,
}) => {
  if (typeof sweep !== 'function') throw new Error('Inspection reminder job requires a sweep function')
  return Object.freeze({
    key: 'inspection.reminders.evaluate',
    kind: 'scheduled',
    enabled,
    intervalMilliseconds,
    timeoutMilliseconds: 60_000,
    maxAttempts: 3,
    concurrency: 1,
    idempotency: 'run-milestone-recipient',
    redaction: 'counts-only',
    run: (payload = {}, context = {}) => sweep({
      limit: Math.max(1, Math.min(Number(payload.limit) || 100, 100)),
      now: context.now || new Date(),
      write,
      encryptionKey,
      clientAppUrl,
    }),
  })
}

module.exports = { createInspectionReminderJob }
