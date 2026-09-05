const createBillingWebhookJob = ({ process, enabled = false, intervalMilliseconds = 60_000 }) => {
  if (typeof process !== 'function') throw new Error('Billing webhook job requires a processor')
  return ({
  key: 'billing.webhooks.process',
  kind: 'scheduled',
  enabled,
  intervalMilliseconds,
  idempotency: 'stripe-event-id',
  redaction: 'metadata-only',
  run: async () => process({ limit: 25 }),
  })
}

const createBillingLifecycleJob = ({ sweep, enabled = false, intervalMilliseconds = 60 * 60 * 1000, write = false, reminderWrites = false, encryptionKey, clientAppUrl }) => {
  if (typeof sweep !== 'function') throw new Error('Billing lifecycle job requires a sweep function')
  return ({
  key: 'billing.lifecycle.evaluate',
  kind: 'scheduled',
  enabled,
  intervalMilliseconds,
  idempotency: 'billing-record-milestone',
  redaction: 'metadata-only',
  run: async (_payload, context = {}) => sweep({
    now: context.now || new Date(),
    write,
    reminderWrites,
    encryptionKey,
    clientAppUrl,
  }),
  })
}

module.exports = { createBillingLifecycleJob, createBillingWebhookJob }
