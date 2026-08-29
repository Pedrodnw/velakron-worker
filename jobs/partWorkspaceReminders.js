const createPartWorkspaceReminderJob = ({
  enabled = false,
  sweep,
  intervalMilliseconds = 60 * 60 * 1000,
  write = false,
  encryptionKey,
  clientAppUrl,
}) => {
  if (typeof sweep !== 'function') throw new Error('Part Workspace reminder job requires a sweep function')
  return Object.freeze({
    key: 'part_workspace.reminders.evaluate',
    kind: 'scheduled',
    enabled,
    intervalMilliseconds,
    timeoutMilliseconds: 60_000,
    maxAttempts: 3,
    concurrency: 1,
    idempotency: 'item-milestone-recipient',
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

module.exports = { createPartWorkspaceReminderJob }
