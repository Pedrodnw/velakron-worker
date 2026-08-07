const createProductionAttentionJob = ({
  enabled = false,
  evaluateBatch,
  intervalMilliseconds = 15 * 60 * 1000,
  policy = null,
  write = false,
}) => {
  if (typeof evaluateBatch !== 'function') throw new Error('Production attention job requires an evaluator')
  return Object.freeze({
    key: 'attention.active_records.evaluate',
    kind: 'scheduled',
    enabled,
    intervalMilliseconds,
    concurrency: 1,
    idempotency: 'record-policy-version-time-sweep',
    redaction: 'counts-only',
    maxAttempts: 3,
    timeoutMilliseconds: 60_000,
    run: async (payload = {}, context = {}) => {
      const limit = Math.max(1, Math.min(Number(payload.limit) || 100, 100))
      return evaluateBatch({
        limit,
        now: context.now || new Date(),
        policy,
        write,
      })
    },
  })
}

module.exports = { createProductionAttentionJob }
