const { Schema, model, models } = require('mongoose')

const actorSnapshotSchema = new Schema({
  user_id: { type: Schema.Types.ObjectId, default: null },
  membership_id: { type: Schema.Types.ObjectId, default: null },
  organization_id: { type: Schema.Types.ObjectId, default: null },
  display_name: { type: String, trim: true, maxlength: 200, default: '' },
  organization_name: { type: String, trim: true, maxlength: 200, default: '' },
  organization_type: { type: String, trim: true, maxlength: 40, default: '' },
  role: { type: String, trim: true, maxlength: 80, default: '' },
}, { _id: false })

const commitmentSnapshotSchema = new Schema({
  part_number: { type: String, maxlength: 160, default: '' },
  part_name: { type: String, maxlength: 300, default: '' },
  drawing_revision: { type: String, maxlength: 120, default: '' },
  po_number: { type: String, maxlength: 160, default: '' },
  po_line_number: { type: String, maxlength: 80, default: '' },
  quantity: { type: Number, default: null },
  unit: { type: String, maxlength: 80, default: '' },
  required_delivery_date: { type: Date, default: null },
  transit_days: { type: Number, default: null },
}, { _id: false })

const createSupplierAssignmentSchema = () => {
  const schema = new Schema({
    production_record: { type: Schema.Types.ObjectId, ref: 'ProductionRecord', required: true, index: true },
    sequence: { type: Number, required: true, min: 1 },
    current: { type: Boolean, required: true, default: true, select: false },
    oem_organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    supplier_organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    relationship: { type: Schema.Types.ObjectId, ref: 'OrganizationRelationship', required: true },
    state: {
      type: String,
      enum: ['assigned', 'accepted', 'declined', 'superseded', 'cancelled', 'completed'],
      default: 'assigned',
      required: true,
      index: true,
    },
    assigned_by: { type: actorSnapshotSchema, required: true },
    assigned_at: { type: Date, required: true, default: Date.now },
    accepted_by: { type: actorSnapshotSchema, default: null },
    accepted_at: { type: Date, default: null },
    declined_by: { type: actorSnapshotSchema, default: null },
    declined_at: { type: Date, default: null },
    expected_ship_date: { type: Date, default: null },
    decline_reason: { type: String, trim: true, maxlength: 1000, default: '' },
    change_reason: { type: String, trim: true, maxlength: 1000, default: '' },
    superseded_by: { type: Schema.Types.ObjectId, ref: 'SupplierAssignment', default: null },
    commitment: { type: commitmentSnapshotSchema, required: true },
  }, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    optimisticConcurrency: true,
  })

  schema.index({ production_record: 1, sequence: 1 }, { unique: true })
  schema.index(
    { production_record: 1, current: 1 },
    { unique: true, partialFilterExpression: { current: true } },
  )
  schema.index({ supplier_organization: 1, state: 1, assigned_at: -1 })

  schema.set('toJSON', {
    getters: true,
    virtuals: true,
    transform: (_document, value) => {
      value.version = value.__v
      delete value.__v
      delete value.current
      return value
    },
  })
  return schema
}

const SupplierAssignment = models.SupplierAssignment
  || model('SupplierAssignment', createSupplierAssignmentSchema())

module.exports = SupplierAssignment
module.exports.actorSnapshotSchema = actorSnapshotSchema
module.exports.commitmentSnapshotSchema = commitmentSnapshotSchema
module.exports.createSupplierAssignmentSchema = createSupplierAssignmentSchema
