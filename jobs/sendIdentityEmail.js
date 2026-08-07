const createIdentityEmailJob = ({ emailProvider, enabled = true }) => ({
  key: 'identity.email.send',
  kind: 'outbox',
  enabled,
  concurrency: 1,
  idempotency: 'deterministic-rfc-message-id',
  redaction: 'never-log-recipient-or-content',
  maxAttempts: 8,
  timeoutMilliseconds: 30_000,
  run: async (payload, context = {}) => emailProvider.send(payload, {
    idempotencyKey: context.idempotencyKey,
  }),
})

module.exports = { createIdentityEmailJob }
