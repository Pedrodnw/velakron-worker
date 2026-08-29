const { Schema, model, models } = require('mongoose')
const { actorSnapshotSchema } = require('./SupplierAssignment')

const PART_REVIEW_STATES = Object.freeze(['not_started', 'in_review', 'changes_requested', 'acknowledged', 'superseded'])

const requirementAcknowledgementSchema = new Schema({
  requirement: { type: Schema.Types.ObjectId, ref: 'PartRequirement', required: true },
  actor: { type: actorSnapshotSchema, required: true },
  acknowledged_at: { type: Date, default: Date.now, required: true },
}, { _id: false })

const createPartRevisionReviewSchema = () => {
  const schema = new Schema({
    share: { type: Schema.Types.ObjectId, ref: 'PartWorkspaceShare', required: true, index: true },
    part: { type: Schema.Types.ObjectId, ref: 'Part', required: true, index: true },
    part_revision: { type: Schema.Types.ObjectId, ref: 'PartRevision', required: true, index: true },
    oem_organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    supplier_organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    state: { type: String, enum: PART_REVIEW_STATES, default: 'not_started', required: true, index: true },
    started_at: { type: Date, default: null },
    started_by: { type: actorSnapshotSchema, default: null },
    changes_requested_at: { type: Date, default: null },
    changes_requested_by: { type: actorSnapshotSchema, default: null },
    review_note: { type: String, trim: true, maxlength: 3000, default: '' },
    requirement_acknowledgements: { type: [requirementAcknowledgementSchema], default: [] },
    acknowledged_at: { type: Date, default: null },
    acknowledged_by: { type: actorSnapshotSchema, default: null },
    acknowledged_manifest_hash: { type: String, trim: true, maxlength: 128, default: '' },
    superseded_at: { type: Date, default: null },
  }, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    optimisticConcurrency: true,
  })
  schema.index({ share: 1, part_revision: 1 }, { unique: true })
  schema.index({ supplier_organization: 1, state: 1, updated_at: -1 })
  schema.set('toJSON', { getters: true, virtuals: true, transform: (_document, value) => { value.version = value.__v; delete value.__v; return value } })
  return schema
}

const PartRevisionReview = models.PartRevisionReview || model('PartRevisionReview', createPartRevisionReviewSchema())
module.exports = PartRevisionReview
module.exports.PART_REVIEW_STATES = PART_REVIEW_STATES
module.exports.createPartRevisionReviewSchema = createPartRevisionReviewSchema
