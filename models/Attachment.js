const { Schema, model, models } = require('mongoose')
const { actorSnapshotSchema } = require('./SupplierAssignment')

const createAttachmentSchema = () => {
  const schema = new Schema({
    owner_organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    category: {
      type: String,
      enum: ['photo', 'document', 'certification', 'quality_record', 'drawing_reference', 'nda'],
      required: true,
      index: true,
    },
    subject_type: {
      type: String,
      enum: ['Machine', 'Certification', 'ProductionRecord', 'StatusEvent', 'Note', 'OrganizationRelationship', 'ConfidentialityRequirement', 'InternalTask', 'CrmOrganization', 'CrmOpportunity', 'CrmOnboarding', 'CrmMeeting', 'CrmInteraction'],
      required: true,
    },
    subject_id: { type: Schema.Types.ObjectId, required: true, index: true },
    production_record: { type: Schema.Types.ObjectId, ref: 'ProductionRecord', default: null, index: true },
    original_filename: { type: String, required: true, trim: true, maxlength: 240 },
    display_filename: { type: String, trim: true, maxlength: 240, default: '' },
    mime_type: { type: String, required: true, trim: true, maxlength: 120 },
    byte_size: { type: Number, required: true, min: 0 },
    storage_adapter: { type: String, enum: ['local', 's3'], default: 'local', required: true },
    object_key: { type: String, required: true, trim: true, maxlength: 512, unique: true },
    state: {
      type: String,
      enum: ['initiated', 'pending', 'uploaded', 'scanning', 'quarantined', 'available', 'failed', 'archived'],
      default: 'pending',
      required: true,
      index: true,
    },
    visibility: {
      type: String,
      enum: ['connected_oems', 'shared', 'oem_internal', 'velakron_internal'],
      default: 'connected_oems',
      required: true,
      index: true,
    },
    position: { type: Number, min: 0, max: 1000, default: 0 },
    caption: { type: String, trim: true, maxlength: 500, default: '' },
    checksum: { type: String, trim: true, maxlength: 128, default: '', select: false },
  storage_version: { type: String, trim: true, maxlength: 120, default: '' },
  etag: { type: String, trim: true, maxlength: 240, default: '' },
  export_control: {
    type: String,
    enum: ['none', 'itar'],
    default: 'none',
    required: true,
    index: true,
  },
  encryption_profile: {
    type: String,
    enum: ['standard', 'itar-preview', 'itar-fips-pending', 'itar-fips-validated'],
    default: 'standard',
    required: true,
  },
  encryption_verified_at: { type: Date, default: null },
  kms_key_reference: { type: String, trim: true, maxlength: 240, default: '', select: false },
    uploader: { type: actorSnapshotSchema, default: null },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    upload_expires_at: { type: Date, default: null, select: false },
    available_at: { type: Date, default: null },
    failed_at: { type: Date, default: null },
    failure_reason: { type: String, trim: true, maxlength: 500, default: '' },
    signature_status: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending',
      required: true,
      index: true,
    },
    signature_verified_at: { type: Date, default: null },
    scan_status: {
      type: String,
      enum: ['pending', 'clean', 'infected', 'error', 'unavailable'],
      default: 'pending',
      required: true,
      index: true,
    },
    scan_provider: { type: String, trim: true, maxlength: 80, default: '' },
    scan_completed_at: { type: Date, default: null },
    scan_reference: { type: String, trim: true, maxlength: 240, default: '', select: false },
    image_metadata: { type: Schema.Types.Mixed, default: null },
    retention_until: { type: Date, default: null },
    legal_hold: { type: Boolean, default: false, required: true, index: true },
    legal_hold_reason: { type: String, trim: true, maxlength: 500, default: '' },
    deletion_requested_at: { type: Date, default: null },
    archived_at: { type: Date, default: null },
    archived_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    archive_reason: { type: String, trim: true, maxlength: 500, default: '' },
  }, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    optimisticConcurrency: true,
  })

  schema.pre('validate', function ensureDisplayFilename() {
    if (!this.display_filename) this.display_filename = this.original_filename
  })

  schema.index({ owner_organization: 1, subject_type: 1, subject_id: 1, state: 1, position: 1 })
  schema.index({ production_record: 1, state: 1, visibility: 1, created_at: -1 })
  schema.index({ state: 1, upload_expires_at: 1 })
  schema.index({ state: 1, scan_status: 1, created_at: 1 })
  schema.index({ production_record: 1, export_control: 1, state: 1 })

  schema.set('toJSON', {
    getters: true,
    virtuals: true,
    transform: (_document, value) => {
      value.version = value.__v
      delete value.__v
      delete value.object_key
      delete value.checksum
      return value
    },
  })
  return schema
}

const Attachment = models.Attachment || model('Attachment', createAttachmentSchema())
module.exports = Attachment
module.exports.createAttachmentSchema = createAttachmentSchema
