const { Schema, model, models } = require('mongoose')

const createJobLeaseSchema = () => {
  const schema = new Schema({
    job_key: { type: String, required: true, trim: true, maxlength: 160 },
    owner_instance: { type: String, required: true, trim: true, maxlength: 160 },
    acquired_at: { type: Date, required: true },
    lease_expires_at: { type: Date, required: true },
    heartbeat_at: { type: Date, required: true },
    cursor: { type: Schema.Types.Mixed, default: null },
    run_id: { type: String, required: true, trim: true, maxlength: 160 },
    attempt: { type: Number, default: 1, min: 1 },
    metadata: { type: Schema.Types.Mixed, default: () => ({}) },
  }, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    optimisticConcurrency: true,
  })

  schema.index({ job_key: 1 }, { unique: true })
  schema.index({ lease_expires_at: 1 })
  return schema
}

const JobLease = models.JobLease || model('JobLease', createJobLeaseSchema())

module.exports = { createJobLeaseSchema, JobLease }
