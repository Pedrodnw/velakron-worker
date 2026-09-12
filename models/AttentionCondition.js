const { Schema, model, models } = require('mongoose')
const { actorSnapshotSchema } = require('./SupplierAssignment')
const { approvalSchema, formalDataSchema, technicalAcceptanceSchema } = require('./FormalEscalationData')
const { protectCollaborationHistory } = require('./collaborationIntegrity')

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
  'create', 'approve_resolution', 'return_resolution', 'release_production', 'acknowledge_resumption',
  'submit_investigation', 'return_disposition', 'complete_corrective_action', 'verify_and_close', 'return_verification', 'add_message',
  'acknowledge',
  'ask_question',
  'answer_question',
  'escalate_to_issue',
  'submit_response',
  'submit_resolution',
  'accept_resolution',
  'reject_resolution',
  'escalate_to_production_block',
  'submit_affected_scope',
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
  data: { type: formalDataSchema, default: undefined },
  idempotency_key: { type: String, maxlength: 160, default: '' },
  request_hash: { type: String, maxlength: 64, default: '' },
  actor: { type: actorSnapshotSchema, required: true },
  occurred_at: { type: Date, required: true, default: Date.now },
}, { _id: true })

const createAttentionConditionSchema = () => {
  const schema = new Schema({
  legacy_replaces: { type: Schema.Types.ObjectId, ref: 'AttentionCondition', default: null, immutable: true },
  legacy_replaced_by: { type: Schema.Types.ObjectId, ref: 'AttentionCondition', default: null, immutable: true },
  record_number: { type: String, trim: true, maxlength: 40, immutable: true, default: undefined },
  originating_conversation: { type: Schema.Types.ObjectId, ref: 'PartCollaborationItem', default: undefined, immutable: true },
  related_production_records: [{ type: Schema.Types.ObjectId, ref: 'ProductionRecord' }],
  related_formal_records: [{ type: Schema.Types.ObjectId, ref: 'AttentionCondition' }],
  part_revision: { type: Schema.Types.ObjectId, ref: 'PartRevision', default: null },
  current_actor_side: { type: String, enum: ['none', 'oem', 'supplier'], default: 'none', index: true },
  blocking: { type: Boolean, default: false },
  terminal: { type: Boolean, default: false },
  oem_closure_approval: { type: approvalSchema, default: null },
  formal_data: { type: formalDataSchema, default: undefined },
  technical_acceptance: { type: technicalAcceptanceSchema, default: null },
  creation_idempotency_key: { type: String, maxlength: 160, default: undefined },
  creation_request_hash: { type: String, maxlength: 64, default: '' },
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
  inspection_run: { type: Schema.Types.ObjectId, ref: 'InspectionRun', default: null, index: true },
  inspection_result: { type: Schema.Types.ObjectId, ref: 'InspectionResult', default: null, index: true },
  inspection_characteristic: { type: Schema.Types.ObjectId, ref: 'InspectionCharacteristic', default: null },
  visual_anchor: { type: Schema.Types.ObjectId, ref: 'VisualAnchor', default: null },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  optimisticConcurrency: true,
  })

  schema.index({ production_record: 1, active: 1, severity: 1 })
  protectCollaborationHistory(schema, {
    versionField: 'workflow_version', version: 'attention-workflow-v2',
    terminal: value => value.terminal || !value.active,
    immutableFields: ['technical_acceptance', 'oem_closure_approval'],
  })
  schema.pre('validate', function validateFormalV2() {
    if (this.workflow_version !== 'attention-workflow-v2') return
    if (!['issue', 'production_block', 'non_conformance'].includes(this.category)) this.invalidate('category', 'V2 requires a formal category')
    if (!this.record_number) this.invalidate('record_number', 'A formal record number is required')
    if (!this.part_revision) this.invalidate('part_revision', 'A formal record requires its released revision')
    if (!this.supplier_organization) this.invalidate('supplier_organization', 'A formal record requires its supplier')
    const scopePending = this.category === 'non_conformance' && this.source === 'oem' && this.workflow_state === 'supplier_scope_required' && this.active && !this.terminal && this.current_actor_side === 'supplier'
    if (this.category === 'non_conformance' && !this.formal_data?.affected_scope && !scopePending) this.invalidate('formal_data.affected_scope', 'Affected scope is required before containment')
    if (this.category !== 'production_block' && this.blocking) this.invalidate('blocking', 'Only a Production Block stops production')
    if (this.terminal && (this.active || this.blocking || this.current_actor_side !== 'none' || !this.oem_closure_approval)) this.invalidate('terminal', 'Terminal records require OEM approval and no active action')
    if (this.oem_closure_approval && (this.oem_closure_approval.actor.organization_type !== 'oem' || String(this.oem_closure_approval.actor.organization_id) !== String(this.oem_organization))) this.invalidate('oem_closure_approval', 'Closure requires the assigned OEM')
    if (this.technical_acceptance && (String(this.technical_acceptance.production_record) !== String(this.production_record) || String(this.technical_acceptance.part_revision) !== String(this.part_revision) || String(this.technical_acceptance.approval.actor.organization_id) !== String(this.oem_organization))) this.invalidate('technical_acceptance', 'Acceptance must match this production, revision and OEM')
    if (this.category === 'production_block' && !this.blocking && !this.formal_data?.production_release) this.invalidate('blocking', 'Production can resume only after an OEM release')
  })
  schema.index({ production_record: 1, stable_key: 1, active: 1 }, {
    unique: true,
    partialFilterExpression: { active: true },
  })
  schema.index({ oem_organization: 1, active: 1, severity: 1 })
  schema.index({ supplier_organization: 1, active: 1, severity: 1 })
  schema.index({ oem_organization: 1, category: 1, record_number: 1 }, { unique: true, partialFilterExpression: { record_number: { $type: 'string' } } })
  schema.index({ originating_conversation: 1 }, { unique: true, partialFilterExpression: { workflow_version: 'attention-workflow-v2', originating_conversation: { $type: 'objectId' } } })
  schema.index({ production_record: 1, current_actor_side: 1, active: 1 })
  schema.index({ production_record: 1, blocking: 1, active: 1 })
  schema.index({ related_production_records: 1, blocking: 1, active: 1 })
  schema.index({ production_record: 1, creation_idempotency_key: 1 }, { unique: true, partialFilterExpression: { creation_idempotency_key: { $type: 'string' } } })

  schema.set('toJSON', {
  getters: true,
  virtuals: true,
  transform: (_document, value) => {
    value.version = value.__v
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
