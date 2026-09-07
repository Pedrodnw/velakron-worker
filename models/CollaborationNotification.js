const { Schema, model, models } = require('mongoose')
const createCollaborationNotificationSchema = () => {
  const schema = new Schema({
    organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    membership: { type: Schema.Types.ObjectId, ref: 'OrganizationMembership', required: true },
    production_record: { type: Schema.Types.ObjectId, ref: 'ProductionRecord', required: true },
    conversation: { type: Schema.Types.ObjectId, ref: 'PartCollaborationItem', default: null },
    formal_record: { type: Schema.Types.ObjectId, ref: 'AttentionCondition', default: null },
    event: { type: String, required: true, maxlength: 100 },
    subject: { type: String, required: true, maxlength: 240 },
    action_required: { type: Boolean, required: true },
    idempotency_key: { type: String, required: true, maxlength: 240 },
    occurred_at: { type: Date, required: true },
  }, { timestamps: { createdAt: 'created_at', updatedAt: false } })
  schema.index({ idempotency_key: 1 }, { unique: true })
  schema.index({ organization: 1, membership: 1, production_record: 1, occurred_at: -1 })
  return schema
}
module.exports = models.CollaborationNotification || model('CollaborationNotification', createCollaborationNotificationSchema())
module.exports.createCollaborationNotificationSchema = createCollaborationNotificationSchema
