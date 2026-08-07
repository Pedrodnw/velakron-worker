const { Schema, model, models } = require('mongoose')

const createOutboxEventSchema = () => {
  const schema = new Schema({
    event_type: { type: String, required: true, trim: true, maxlength: 120 },
    schema_version: { type: Number, required: true, default: 1, min: 1 },
    aggregate_type: { type: String, required: true, trim: true, maxlength: 80 },
    aggregate_id: { type: Schema.Types.ObjectId, required: true },
    organization: { type: Schema.Types.ObjectId, ref: 'Organization', default: null },
    payload: { type: Schema.Types.Mixed, required: true, default: () => ({}) },
    idempotency_key: { type: String, required: true, trim: true, maxlength: 240 },
    state: {
      type: String,
      enum: ['pending', 'claimed', 'completed', 'retryable', 'dead'],
      default: 'pending',
      required: true,
    },
    available_at: { type: Date, required: true, default: Date.now },
    claimed_at: { type: Date, default: null },
    lease_expires_at: { type: Date, default: null },
    completed_at: { type: Date, default: null },
    attempt: { type: Number, default: 0, min: 0 },
    max_attempts: { type: Number, default: 8, min: 1, max: 25 },
    claimed_by: { type: String, trim: true, maxlength: 160, default: null },
    provider: { type: String, trim: true, maxlength: 80, default: null },
    provider_message_id: { type: String, trim: true, maxlength: 320, default: null },
    provider_state: {
      type: String,
      enum: ['queued', 'submitted', 'failed'],
      default: 'queued',
      required: true,
    },
    last_error_code: { type: String, trim: true, maxlength: 120, default: null },
    last_safe_error: { type: String, maxlength: 1000, default: null },
    correlation_id: { type: String, trim: true, maxlength: 160, default: null },
  }, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    optimisticConcurrency: true,
  })

  schema.index({ idempotency_key: 1 }, { unique: true })
  schema.index({ state: 1, available_at: 1 })
  schema.index({ state: 1, lease_expires_at: 1 })
  schema.index({ aggregate_type: 1, aggregate_id: 1 })
  schema.index({ organization: 1, created_at: -1 })
  return schema
}

const OutboxEvent = models.OutboxEvent || model('OutboxEvent', createOutboxEventSchema())

module.exports = { createOutboxEventSchema, OutboxEvent }
