const mongoose = require('mongoose')
const { Schema, model, models } = mongoose

const createOneTimeTokenSchema = () => {
  const schema = new Schema({
    type: {
      type: String,
      enum: ['invitation', 'email_verification', 'password_reset', 'magic_link', 'email_change'],
      required: true,
      index: true,
    },
    token_hash: { type: String, required: true, unique: true, select: false },
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    email: { type: String, trim: true, lowercase: true, maxlength: 320, default: null, index: true },
    organization: { type: Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    membership: { type: Schema.Types.ObjectId, ref: 'OrganizationMembership', default: null },
    invitation: { type: Schema.Types.ObjectId, ref: 'Invitation', default: null },
    purpose_data: { type: Schema.Types.Mixed, default: () => ({}) },
    issued_at: { type: Date, required: true, default: Date.now },
    expires_at: { type: Date, required: true },
    consumed_at: { type: Date, default: null },
    revoked_at: { type: Date, default: null },
    superseded_by: { type: Schema.Types.ObjectId, ref: 'OneTimeToken', default: null },
    attempt_count: { type: Number, default: 0, min: 0 },
    last_attempt_at: { type: Date, default: null },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    request_ip: { type: String, trim: true, maxlength: 80, default: null },
    request_user_agent: { type: String, trim: true, maxlength: 500, default: null },
  }, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false,
  })

  schema.index({ type: 1, user: 1, consumed_at: 1, revoked_at: 1 })
  schema.index({ type: 1, email: 1, consumed_at: 1, revoked_at: 1 })
  schema.index({ expires_at: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 })
  return schema
}

const OneTimeToken = models.OneTimeToken || model('OneTimeToken', createOneTimeTokenSchema())
module.exports = OneTimeToken
module.exports.createOneTimeTokenSchema = createOneTimeTokenSchema
