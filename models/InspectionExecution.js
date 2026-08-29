const { Schema, model, models } = require('mongoose')
const { actorSnapshotSchema } = require('./SupplierAssignment')

const INSPECTION_STAGES = Object.freeze(['first_article', 'in_process', 'final', 'receiving'])
const INSPECTION_GATE_POLICIES = Object.freeze(['completion_required', 'submission_required', 'oem_approval_required'])
const INSPECTION_RUN_STATES = Object.freeze(['not_started', 'in_progress', 'ready_to_submit', 'submitted', 'changes_requested', 'accepted', 'cancelled'])
const INSPECTION_RESULT_STATES = Object.freeze(['pass', 'fail_unconfirmed', 'fail_confirmed', 'not_evaluated'])
const INSPECTION_SUBMISSION_STATES = Object.freeze(['submitted', 'changes_requested', 'accepted'])
const INSPECTION_IMPORT_STATES = Object.freeze(['uploaded', 'previewed', 'committed', 'failed'])

const sampleScopeSchema = new Schema({
  characteristic: { type: Schema.Types.ObjectId, ref: 'InspectionCharacteristic', required: true },
  required_count: { type: Number, min: 1, max: 1000000, required: true },
}, { _id: false })

const createInspectionRunSchema = () => {
  const schema = new Schema({
    production_record: { type: Schema.Types.ObjectId, ref: 'ProductionRecord', required: true, index: true },
    part: { type: Schema.Types.ObjectId, ref: 'Part', required: true, index: true },
    part_revision: { type: Schema.Types.ObjectId, ref: 'PartRevision', required: true, index: true },
    inspection_plan: { type: Schema.Types.ObjectId, ref: 'InspectionPlan', required: true, index: true },
    share: { type: Schema.Types.ObjectId, ref: 'PartWorkspaceShare', required: true, index: true },
    oem_organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    supplier_organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    kind: { type: String, enum: INSPECTION_STAGES, required: true, index: true },
    occurrence_number: { type: Number, min: 1, default: 1, required: true },
    production_quantity_snapshot: { type: Number, min: 1, required: true },
    sample_scope: { type: [sampleScopeSchema], default: () => [] },
    plan_snapshot_hash: { type: String, required: true, trim: true, maxlength: 128 },
    state: { type: String, enum: INSPECTION_RUN_STATES, default: 'not_started', required: true, index: true },
    current_actor_side: { type: String, enum: ['oem', 'supplier', 'none'], default: 'supplier', required: true, index: true },
    assignee_membership: { type: Schema.Types.ObjectId, ref: 'OrganizationMembership', default: null, index: true },
    due_at: { type: Date, default: null, index: true },
    gate_policy: { type: String, enum: INSPECTION_GATE_POLICIES, required: true },
    required_results: { type: Number, min: 0, default: 0 },
    completed_results: { type: Number, min: 0, default: 0 },
    pass_count: { type: Number, min: 0, default: 0 },
    fail_count: { type: Number, min: 0, default: 0 },
    unconfirmed_failure_count: { type: Number, min: 0, default: 0 },
    current_submission: { type: Schema.Types.ObjectId, ref: 'InspectionSubmission', default: null },
    active_nonconformances: [{ type: Schema.Types.ObjectId, ref: 'AttentionCondition' }],
    started_at: { type: Date, default: null },
    submitted_at: { type: Date, default: null },
    accepted_at: { type: Date, default: null },
    cancelled_at: { type: Date, default: null },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updated_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  }, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, optimisticConcurrency: true })
  schema.index({ production_record: 1, inspection_plan: 1, kind: 1, occurrence_number: 1 }, { unique: true })
  schema.index({ oem_organization: 1, current_actor_side: 1, state: 1, due_at: 1 })
  schema.index({ supplier_organization: 1, current_actor_side: 1, state: 1, due_at: 1 })
  schema.set('toJSON', { getters: true, virtuals: true, transform: (_document, value) => { value.version = value.__v; delete value.__v; return value } })
  return schema
}

const resultSnapshotSchema = new Schema({
  characteristic_id: { type: String, required: true },
  title: { type: String, required: true },
  type: { type: String, enum: ['numeric', 'attribute'], required: true },
  nominal_value: { type: String, default: '' },
  lower_limit: { type: String, default: '' },
  upper_limit: { type: String, default: '' },
  attribute_expectation: { type: String, default: '' },
  unit: { type: String, default: 'dimensionless' },
  criticality: { type: String, required: true },
  visual_anchor: { type: Schema.Types.ObjectId, ref: 'VisualAnchor', default: null },
}, { _id: false })

const createInspectionResultSchema = () => {
  const schema = new Schema({
    inspection_run: { type: Schema.Types.ObjectId, ref: 'InspectionRun', required: true, index: true },
    inspection_characteristic: { type: Schema.Types.ObjectId, ref: 'InspectionCharacteristic', required: true, index: true },
    sample_key: { type: String, required: true, trim: true, maxlength: 160 },
    sample_sequence: { type: Number, min: 1, required: true },
    characteristic_snapshot: { type: resultSnapshotSchema, required: true },
    numeric_value: { type: String, trim: true, maxlength: 120, default: '' },
    attribute_value: { type: String, trim: true, maxlength: 120, default: '' },
    status: { type: String, enum: INSPECTION_RESULT_STATES, required: true, index: true },
    deviation: { type: String, trim: true, maxlength: 120, default: '' },
    source: { type: String, enum: ['manual', 'csv_import'], default: 'manual', required: true },
    instrument: { type: String, trim: true, maxlength: 500, default: '' },
    method: { type: String, trim: true, maxlength: 1000, default: '' },
    operation: { type: String, trim: true, maxlength: 240, default: '' },
    cavity: { type: String, trim: true, maxlength: 120, default: '' },
    lot_serial: { type: String, trim: true, maxlength: 240, default: '' },
    note: { type: String, trim: true, maxlength: 2000, default: '' },
    evidence_attachments: [{ type: Schema.Types.ObjectId, ref: 'Attachment' }],
    inspection_import: { type: Schema.Types.ObjectId, ref: 'InspectionImport', default: null },
    source_row_fingerprint: { type: String, trim: true, maxlength: 128, default: '' },
    inspected_at: { type: Date, required: true, default: Date.now },
    inspected_by: { type: actorSnapshotSchema, required: true },
    supersedes_result: { type: Schema.Types.ObjectId, ref: 'InspectionResult', default: null, index: true },
    superseded_at: { type: Date, default: null, index: true },
    correction_reason: { type: String, trim: true, maxlength: 1000, default: '' },
    nonconformance: { type: Schema.Types.ObjectId, ref: 'AttentionCondition', default: null },
    failure_confirmed_at: { type: Date, default: null },
    failure_confirmed_by: { type: actorSnapshotSchema, default: null },
  }, { timestamps: { createdAt: 'created_at', updatedAt: false } })
  schema.index({ inspection_run: 1, inspection_characteristic: 1, sample_key: 1, superseded_at: 1 })
  schema.index({ inspection_import: 1, source_row_fingerprint: 1 })
  schema.set('toJSON', { getters: true, virtuals: true, transform: (_document, value) => { delete value.__v; return value } })
  return schema
}

const createInspectionSubmissionSchema = () => {
  const schema = new Schema({
    inspection_run: { type: Schema.Types.ObjectId, ref: 'InspectionRun', required: true, index: true },
    submission_number: { type: Number, min: 1, required: true },
    result_ids: [{ type: Schema.Types.ObjectId, ref: 'InspectionResult' }],
    evidence_attachment_ids: [{ type: Schema.Types.ObjectId, ref: 'Attachment' }],
    required_results: { type: Number, min: 0, required: true },
    completed_results: { type: Number, min: 0, required: true },
    pass_count: { type: Number, min: 0, required: true },
    fail_count: { type: Number, min: 0, required: true },
    manifest_hash: { type: String, required: true, trim: true, maxlength: 128, index: true },
    state: { type: String, enum: INSPECTION_SUBMISSION_STATES, default: 'submitted', required: true, index: true },
    declaration: { type: String, required: true, trim: true, maxlength: 1000 },
    submitted_by: { type: actorSnapshotSchema, required: true },
    submitted_at: { type: Date, required: true, default: Date.now },
    reviewed_by: { type: actorSnapshotSchema, default: null },
    reviewed_at: { type: Date, default: null },
    review_note: { type: String, trim: true, maxlength: 3000, default: '' },
    correction_characteristics: [{ type: Schema.Types.ObjectId, ref: 'InspectionCharacteristic' }],
  }, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, optimisticConcurrency: true })
  schema.index({ inspection_run: 1, submission_number: 1 }, { unique: true })
  schema.set('toJSON', { getters: true, virtuals: true, transform: (_document, value) => { value.version = value.__v; delete value.__v; return value } })
  return schema
}

const createInspectionImportSchema = () => {
  const schema = new Schema({
    inspection_run: { type: Schema.Types.ObjectId, ref: 'InspectionRun', required: true, index: true },
    source_attachment: { type: Schema.Types.ObjectId, ref: 'Attachment', default: null },
    source_checksum: { type: String, trim: true, maxlength: 128, default: '' },
    parser: { type: String, enum: ['csv-v1', 'evidence-only'], default: 'csv-v1', required: true },
    parser_version: { type: String, trim: true, maxlength: 80, default: '1' },
    mapping: { type: Schema.Types.Mixed, default: {} },
    preview_rows: { type: [Schema.Types.Mixed], default: () => [] },
    row_count: { type: Number, min: 0, default: 0 },
    accepted_count: { type: Number, min: 0, default: 0 },
    rejected_count: { type: Number, min: 0, default: 0 },
    state: { type: String, enum: INSPECTION_IMPORT_STATES, default: 'uploaded', required: true, index: true },
    import_hash: { type: String, trim: true, maxlength: 128, default: '', index: true },
    idempotency_key: { type: String, required: true, trim: true, maxlength: 200 },
    created_by: { type: actorSnapshotSchema, required: true },
    committed_at: { type: Date, default: null },
  }, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, optimisticConcurrency: true })
  schema.index({ inspection_run: 1, idempotency_key: 1 }, { unique: true })
  schema.set('toJSON', { getters: true, virtuals: true, transform: (_document, value) => { value.version = value.__v; delete value.__v; return value } })
  return schema
}

const InspectionRun = models.InspectionRun || model('InspectionRun', createInspectionRunSchema())
const InspectionResult = models.InspectionResult || model('InspectionResult', createInspectionResultSchema())
const InspectionSubmission = models.InspectionSubmission || model('InspectionSubmission', createInspectionSubmissionSchema())
const InspectionImport = models.InspectionImport || model('InspectionImport', createInspectionImportSchema())

module.exports = {
  INSPECTION_IMPORT_STATES,
  INSPECTION_RESULT_STATES,
  INSPECTION_RUN_STATES,
  INSPECTION_SUBMISSION_STATES,
  InspectionImport,
  InspectionResult,
  InspectionRun,
  InspectionSubmission,
  createInspectionImportSchema,
  createInspectionResultSchema,
  createInspectionRunSchema,
  createInspectionSubmissionSchema,
}
