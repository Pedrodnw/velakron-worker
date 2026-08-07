const definitions = new Map()

const registerJob = definition => {
  if (!definition?.key || typeof definition.run !== 'function') {
    throw new Error('A job requires a stable key and run function')
  }
  if (definitions.has(definition.key)) throw new Error(`Duplicate job key: ${definition.key}`)
  definitions.set(definition.key, Object.freeze({
    kind: 'outbox',
    enabled: true,
    concurrency: 1,
    idempotency: 'event-idempotency-key',
    redaction: 'metadata-only',
    maxAttempts: 8,
    timeoutMilliseconds: 30000,
    ...definition,
  }))
}

const getJob = key => definitions.get(key) || null
const listJobs = () => Array.from(definitions.values())
const clearJobsForTest = () => definitions.clear()

module.exports = { clearJobsForTest, getJob, listJobs, registerJob }
