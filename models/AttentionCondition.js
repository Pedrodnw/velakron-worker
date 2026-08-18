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
  }, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
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
module.exports.createAttentionConditionSchema = createAttentionConditionSchema
