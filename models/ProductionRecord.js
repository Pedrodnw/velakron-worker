const { Schema, model, models } = require('mongoose')

const PRODUCTION_STAGES = Object.freeze([
  'assigned',
  'accepted',
  'material_ordered',
  'material_received',
  'programming',
  'in_production',
  'inspection',
  'ready_to_ship',
  'shipped',
  'delivered',
])

const UNIT_KEYS = Object.freeze([
  'each',
  'lot',
  'set',
  'assembly',
  'pound',
  'kilogram',
  'foot',
  'meter',
  'other',
])

const normalizeSearchValue = value => String(value || '')
  .trim()
  .toLocaleLowerCase('en-US')
  .replace(/\s+/g, ' ')

const createProductionRecordSchema = () => {
  const schema = new Schema({
    public_reference: { type: String, required: true, trim: true, maxlength: 40, unique: true, index: true },
    oem_organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    supplier_organization: { type: Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    current_relationship: { type: Schema.Types.ObjectId, ref: 'OrganizationRelationship', default: null },
    current_assignment: { type: Schema.Types.ObjectId, ref: 'SupplierAssignment', default: null },
    current_assignment_sequence: { type: Number, min: 0, default: 0 },
    part_number: { type: String, trim: true, maxlength: 160, default: '' },
    normalized_part_number: { type: String, trim: true, maxlength: 160, default: '' },
    part_name: { type: String, trim: true, maxlength: 300, default: '' },
    drawing_revision: { type: String, trim: true, maxlength: 120, default: '' },
    po_number: { type: String, trim: true, maxlength: 160, default: '' },
    normalized_po_number: { type: String, trim: true, maxlength: 160, default: '' },
    po_line_number: { type: String, trim: true, maxlength: 80, default: '' },
    quantity: { type: Number, min: 0.000001, max: 1_000_000_000, default: null },
    unit: { type: String, enum: ['', ...UNIT_KEYS], default: '' },
    unit_other: { type: String, trim: true, maxlength: 80, default: '' },
    required_delivery_date: { type: Date, default: null, index: true },
    required_date_type: { type: String, enum: ['arrival'], default: 'arrival' },
    transit_days: { type: Number, min: 0, max: 365, default: null },
    expected_ship_date: { type: Date, default: null },
    projected_arrival_date: { type: Date, default: null },
    shipment_date: { type: Date, default: null },
    delivered_at: { type: Date, default: null },
    current_stage: { type: String, enum: [null, ...PRODUCTION_STAGES], default: null, index: true },
    workflow_version: { type: String, required: true, default: 'production-v1', maxlength: 80 },
    schedule_health: {
      type: String,
      enum: ['unassessed', 'on_schedule', 'at_risk', 'delayed', 'needs_attention'],
      default: 'unassessed',
      index: true,
    },
    schedule_policy_version: { type: String, default: 'attention-v1', maxlength: 80 },
    highest_attention_severity: {
      type: String,
      enum: [null, 'low', 'medium', 'high'],
      default: null,
      index: true,
    },
    active_attention_codes: [{ type: String, trim: true, maxlength: 100 }],
    active_attention_count: { type: Number, min: 0, default: 0 },
    last_attention_evaluated_at: { type: Date, default: null, index: true },
    shared_schedule_health: {
      type: String,
      enum: ['unassessed', 'on_schedule', 'at_risk', 'delayed', 'needs_attention'],
      default: 'unassessed',
      index: true,
    },
    shared_highest_attention_severity: {
      type: String,
      enum: [null, 'low', 'medium', 'high'],
      default: null,
    },
    shared_active_attention_codes: [{ type: String, trim: true, maxlength: 100 }],
    shared_active_attention_count: { type: Number, min: 0, default: 0 },
    acceptance_status: {
      type: String,
      enum: ['unassigned', 'pending', 'accepted', 'declined', 'reacceptance_required'],
      default: 'unassigned',
      index: true,
    },
    accepted_at: { type: Date, default: null },
    accepted_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    confidentiality_level: {
      type: String,
      enum: ['confidential', 'restricted'],
      default: 'confidential',
      required: true,
      index: true,
    },
    confidentiality_state: {
      type: String,
      enum: ['not_applicable', 'pending', 'active', 'revoked'],
      default: 'not_applicable',
      required: true,
      index: true,
    },
    confidentiality_requirement: { type: Schema.Types.ObjectId, ref: 'ConfidentialityRequirement', default: null },
    confidentiality_acceptance: { type: Schema.Types.ObjectId, ref: 'ConfidentialityAcceptance', default: null },
    confidentiality_authorized_memberships: [{ type: Schema.Types.ObjectId, ref: 'OrganizationMembership' }],
    current_machine: { type: Schema.Types.ObjectId, ref: 'Machine', default: null },
    current_machine_assignment: { type: Schema.Types.ObjectId, ref: 'MachineAssignment', default: null },
    last_supplier_update_at: { type: Date, default: null, index: true },
    first_article_required: { type: Boolean, default: false },
    first_article_note: { type: String, trim: true, maxlength: 2000, default: '' },
    oem_internal_note: { type: String, trim: true, maxlength: 3000, default: '', select: false },
    process_summary: { type: String, trim: true, maxlength: 1000, default: '' },
    external_erp_reference: { type: String, trim: true, maxlength: 160, default: '' },
    lifecycle_state: {
      type: String,
      enum: ['draft', 'active', 'cancelled', 'completed', 'archived'],
      default: 'draft',
      required: true,
      index: true,
    },
    timeline_sequence: { type: Number, min: 0, default: 0 },
    cancelled_at: { type: Date, default: null },
    cancelled_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cancellation_reason: { type: String, trim: true, maxlength: 1000, default: '' },
    completed_at: { type: Date, default: null, index: true },
    completed_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    archived_at: { type: Date, default: null },
    archived_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    archive_reason: { type: String, trim: true, maxlength: 1000, default: '' },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updated_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  }, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    optimisticConcurrency: true,
  })

  schema.pre('validate', function normalizeBusinessReferences() {
    this.normalized_part_number = normalizeSearchValue(this.part_number)
    this.normalized_po_number = normalizeSearchValue(this.po_number)
  })

  schema.index({ oem_organization: 1, lifecycle_state: 1, required_delivery_date: 1 })
  schema.index({ supplier_organization: 1, lifecycle_state: 1, required_delivery_date: 1 })
  schema.index({ oem_organization: 1, current_stage: 1, schedule_health: 1 })
  schema.index({ supplier_organization: 1, acceptance_status: 1, current_stage: 1 })
  schema.index({ supplier_organization: 1, confidentiality_state: 1, confidentiality_level: 1 })
  schema.index({ confidentiality_authorized_memberships: 1, confidentiality_state: 1 })
  schema.index({ oem_organization: 1, normalized_part_number: 1 })
  schema.index({ oem_organization: 1, normalized_po_number: 1 })
  schema.index({ supplier_organization: 1, last_supplier_update_at: -1 })
  schema.index({ oem_organization: 1, lifecycle_state: 1, schedule_health: 1, highest_attention_severity: 1 })
  schema.index({ supplier_organization: 1, lifecycle_state: 1, shared_schedule_health: 1 })

  schema.set('toJSON', {
    getters: true,
    virtuals: true,
    transform: (_document, value) => {
      value.version = value.__v
      delete value.__v
      delete value.normalized_part_number
      delete value.normalized_po_number
      delete value.timeline_sequence
      delete value.oem_internal_note
      return value
    },
  })
  return schema
}

const ProductionRecord = models.ProductionRecord || model('ProductionRecord', createProductionRecordSchema())

module.exports = ProductionRecord
module.exports.PRODUCTION_STAGES = PRODUCTION_STAGES
module.exports.UNIT_KEYS = UNIT_KEYS
module.exports.createProductionRecordSchema = createProductionRecordSchema
module.exports.normalizeSearchValue = normalizeSearchValue
