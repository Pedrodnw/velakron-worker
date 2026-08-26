const { Schema, model, models } = require('mongoose')
const { actorSnapshotSchema } = require('./SupplierAssignment')

const ATTENTION_CODES = Object.freeze([
  'REQUIRED_DATE_PASSED',
  'FORECAST_AFTER_REQUIRED',
  'SHIP_DATE_SLIPPED',
  'STALE_SUPPLIER_UPDATE',
  'AWAITING_ACCEPTANCE',
  'MISSING_EXPECTED_SHIP_DATE',
  'SUPPLIER_REPORTED_ISSUE',
  'MANUAL_OEM_ATTENTION',
  'NON_CONFORMANCE',
  'PRODUCTION_BLOCK',
  'ISSUE',
  'INFORMATION_FLAG',
  'OEM_QUALITY_ISSUE',
  'MACHINE_UNASSIGNED',
])
const ATTENTION_SEVERITIES = Object.freeze(['low', 'medium', 'high'])
const ATTENTION_SOURCES = Object.freeze(['computed', 'supplier', 'oem', 'velakron'])
const ATTENTION_CATEGORIES = Object.freeze([
  'non_conformance',
  'production_block',
  'issue',
  'information_flag',
])
const ATTENTION_WORKFLOW_ACTIONS = Object.freeze([
  'acknowledge',
  'ask_question',
  'answer_question',
  'escalate_to_issue',
  'submit_response',
  'submit_resolution',
  'accept_resolution',
  'reject_resolution',
  'escalate_to_production_block',
  'submit_containment',
  'submit_disposition',
  'approve_disposition',
  'reject_disposition',
  'complete_required_action',
  'submit_evidence',
  'verify_completion',
  'reject_completion',
  'confirm_production_stopped',
  'submit_block_action',
  'request_block_release',
  'approve_block_release',
  'reject_block_release',
  'confirm_production_released',
])

const attentionWorkflowEventSchema = new Schema({
  action: { type: String, enum: ATTENTION_WORKFLOW_ACTIONS, required: true },
  from_state: { type: String, required: true, trim: true, maxlength: 80 },
  to_state: { type: String, required: true, trim: true, maxlength: 80 },
  note: { type: String, trim: true, maxlength: 1000, default: '' },
  actor: { type: actorSnapshotSchema, required: true },
  occurred_at: { type: Date, required: true, default: Date.now },
}, { _id: true })

const createAttentionConditionSchema = () => {
  const schema = new Schema({
    production_record: { type: Schema.Types.ObjectId, ref: 'ProductionRecord', required: true, index: true },
    oem_organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    supplier_organization: { type: Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    code: { type: String, enum: ATTENTION_CODES, required: true, index: true },
    category: { type: String, enum: ATTENTION_CATEGORIES, default: null, index: true },
    policy_version: { type: String, required: true, trim: true, maxlength: 80, default: 'attention-v1' },
    severity: { type: String, enum: ATTENTION_SEVERITIES, required: true },
    health: {
      type: String,
      enum: ['on_schedule', 'at_risk', 'delayed', 'needs_attention'],
      required: true,
    },
    source: { type: String, enum: ATTENTION_SOURCES, required: true },
    visibility: {
      type: String,
      enum: ['shared', 'oem_internal', 'velakron_internal'],
      required: true,
      default: 'shared',
      index: true,
    },
    stable_key: { type: String, required: true, trim: true, maxlength: 240 },
    explanation: { type: String, required: true, trim: true, maxlength: 1000 },
    evidence: { type: Schema.Types.Mixed, default: null },
    first_seen_at: { type: Date, required: true, default: Date.now },
    last_seen_at: { type: Date, required: true, default: Date.now },
    detected_at: { type: Date, required: true, default: Date.now },
    active: { type: Boolean, required: true, default: true, index: true },
    acknowledged_at: { type: Date, default: null },
    acknowledged_by: { type: actorSnapshotSchema, default: null },
    resolved_at: { type: Date, default: null },
    resolved_by: { type: actorSnapshotSchema, default: null },
    resolution_reason: { type: String, trim: true, maxlength: 1000, default: '' },
    reported_by: { type: actorSnapshotSchema, default: null },
    workflow_version: { type: String, trim: true, maxlength: 80, default: '' },
    workflow_state: { type: String, trim: true, maxlength: 80, default: '', index: true },
    workflow_data: { type: Schema.Types.Mixed, default: {} },
    workflow_history: { type: [attentionWorkflowEventSchema], default: [] },
    escalated_from: { type: Schema.Types.ObjectId, ref: 'AttentionCondition', default: null },
    escalated_to: { type: Schema.Types.ObjectId, ref: 'AttentionCondition', default: null },
  }, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    optimisticConcurrency: true,
  })

  schema.index({ production_record: 1, active: 1, severity: 1 })
  schema.index({ production_record: 1, stable_key: 1, active: 1 }, {
    unique: true,
    partialFilterExpression: { active: true },
  })
  schema.index({ oem_organization: 1, active: 1, severity: 1 })
  schema.index({ supplier_organization: 1, active: 1, severity: 1 })

  schema.set('toJSON', {
    getters: true,
    virtuals: true,
    transform: (_document, value) => {
      delete value.__v
      return value
    },
  })
  return schema
}

const AttentionCondition = models.AttentionCondition || model('AttentionCondition', createAttentionConditionSchema())

module.exports = AttentionCondition
module.exports.ATTENTION_CODES = ATTENTION_CODES
module.exports.ATTENTION_SEVERITIES = ATTENTION_SEVERITIES
module.exports.ATTENTION_SOURCES = ATTENTION_SOURCES
module.exports.ATTENTION_CATEGORIES = ATTENTION_CATEGORIES
module.exports.ATTENTION_WORKFLOW_ACTIONS = ATTENTION_WORKFLOW_ACTIONS
module.exports.createAttentionConditionSchema = createAttentionConditionSchema
