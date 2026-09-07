const { Schema, model, models } = require('mongoose')
const { actorSnapshotSchema } = require('./SupplierAssignment')
const { protectCollaborationHistory } = require('./collaborationIntegrity')

const PART_COLLABORATION_TYPES = Object.freeze(['clarification', 'information', 'manufacturability_suggestion', 'deviation_request'])
const PART_COLLABORATION_PRIORITIES = Object.freeze(['low', 'normal', 'high'])
const PART_COLLABORATION_SCHEDULE_EFFECTS = Object.freeze(['none', 'possible', 'confirmed'])
const PART_COLLABORATION_STATES = Object.freeze([
  'open',
  'oem_review',
  'answered',
  'recipient_acknowledged',
  'closed',
  'proposed',
  'accepted',
  'rejected',
  'requested',
  'escalated',
])

const collaborationEventSchema = new Schema({
  action: { type: String, required: true, trim: true, maxlength: 120 },
  from_state: { type: String, trim: true, maxlength: 80, default: '' },
  to_state: { type: String, trim: true, maxlength: 80, default: '' },
  note: { type: String, trim: true, maxlength: 3000, default: '' },
  idempotency_key: { type: String, trim: true, maxlength: 160, default: '' },
  request_hash: { type: String, maxlength: 64, default: '' },
  actor: { type: actorSnapshotSchema, required: true },
  occurred_at: { type: Date, required: true, default: Date.now },
}, { _id: true })

const createPartCollaborationItemSchema = () => {
  const schema = new Schema({
    collaboration_version: { type: String, enum: ['part-collaboration-v1', 'part-collaboration-v2'], default: 'part-collaboration-v1', index: true },
    topic: { type: String, enum: ['', 'general', 'drawing', 'model', 'requirement', 'tooling', 'manufacturing', 'quality', ...PART_COLLABORATION_TYPES], default: '' },
    needs_response_from: { type: String, enum: ['none', 'oem', 'supplier'], default: 'none' },
    closing_summary: { type: String, trim: true, maxlength: 3000, default: '' },
    closed_by: { type: actorSnapshotSchema, default: null },
    reopened_at: { type: Date, default: null },
    reopened_by: { type: actorSnapshotSchema, default: null },
    escalated_at: { type: Date, default: null },
    primary_production_record: { type: Schema.Types.ObjectId, ref: 'ProductionRecord', default: null },
    references_formal_record: { type: Schema.Types.ObjectId, ref: 'AttentionCondition', default: null },
    creation_idempotency_key: { type: String, maxlength: 160, default: undefined },
    creation_request_hash: { type: String, maxlength: 64, default: '' },
    part: { type: Schema.Types.ObjectId, ref: 'Part', required: true, index: true },
    part_revision: { type: Schema.Types.ObjectId, ref: 'PartRevision', required: true, index: true },
    share: { type: Schema.Types.ObjectId, ref: 'PartWorkspaceShare', required: true, index: true },
    oem_organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    supplier_organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    type: { type: String, enum: PART_COLLABORATION_TYPES, required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 240 },
    description: { type: String, required: true, trim: true, maxlength: 6000 },
    state: { type: String, enum: PART_COLLABORATION_STATES, required: true, index: true },
    priority: { type: String, enum: PART_COLLABORATION_PRIORITIES, default: 'normal', required: true, index: true },
    schedule_effect: { type: String, enum: PART_COLLABORATION_SCHEDULE_EFFECTS, default: 'none', required: true },
    visual_anchor: { type: Schema.Types.ObjectId, ref: 'VisualAnchor', default: null, index: true },
    requirement: { type: Schema.Types.ObjectId, ref: 'PartRequirement', default: null },
    source_asset: { type: Schema.Types.ObjectId, ref: 'PartRevisionAsset', default: null },
    production_records: [{ type: Schema.Types.ObjectId, ref: 'ProductionRecord' }],
    creator_side: { type: String, enum: ['oem', 'supplier'], required: true },
    current_actor_side: { type: String, enum: ['oem', 'supplier', 'none'], required: true, index: true },
    assignee_membership: { type: Schema.Types.ObjectId, ref: 'OrganizationMembership', default: null, index: true },
    watchers: [{ type: Schema.Types.ObjectId, ref: 'OrganizationMembership' }],
    due_at: { type: Date, default: null, index: true },
    effectivity: { type: Schema.Types.Mixed, default: null },
    decision: { type: Schema.Types.Mixed, default: null },
    escalated_attention: { type: Schema.Types.ObjectId, ref: 'AttentionCondition', default: null },
    last_activity_at: { type: Date, default: Date.now, required: true, index: true },
    created_by: { type: actorSnapshotSchema, required: true },
    closed_at: { type: Date, default: null },
    archived_at: { type: Date, default: null },
    archive_reason: { type: String, trim: true, maxlength: 1000, default: '' },
    workflow_history: { type: [collaborationEventSchema], default: [] },
  }, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    optimisticConcurrency: true,
  })
  schema.index({ share: 1, state: 1, last_activity_at: -1 })
  protectCollaborationHistory(schema, { versionField: 'collaboration_version', version: 'part-collaboration-v2', terminal: value => value.state === 'escalated' })
  schema.pre('validate', function validateConversationV2() {
    if (this.collaboration_version !== 'part-collaboration-v2') return
    if (!['open', 'closed', 'escalated'].includes(this.state)) this.invalidate('state', 'V2 conversations use open, closed or escalated')
    if (this.current_actor_side !== (this.state === 'open' ? this.needs_response_from : 'none')) this.invalidate('current_actor_side', 'Conversation ownership must match explicit needs response')
    if (this.state === 'closed' && (!this.closing_summary || !this.closed_by || !this.closed_at)) this.invalidate('closing_summary', 'Closure requires a summary, actor and time')
    if (this.state === 'escalated' && (!this.escalated_attention || !this.escalated_at)) this.invalidate('escalated_attention', 'Escalation requires its immutable formal link')
  })
  schema.index({ oem_organization: 1, current_actor_side: 1, state: 1, due_at: 1 })
  schema.index({ supplier_organization: 1, current_actor_side: 1, state: 1, due_at: 1 })
  schema.index({ production_records: 1, state: 1, last_activity_at: -1 })
  schema.index({ oem_organization: 1, 'created_by.user_id': 1, creation_idempotency_key: 1 }, { unique: true, partialFilterExpression: { creation_idempotency_key: { $type: 'string' } } })
  schema.set('toJSON', {
    getters: true,
    virtuals: true,
    transform: (_document, value) => { value.version = value.__v; delete value.__v; return value },
  })
  return schema
}

const createPartCollaborationMessageSchema = () => {
  const schema = new Schema({
    collaboration_item: { type: Schema.Types.ObjectId, ref: 'PartCollaborationItem', required: true, index: true },
    share: { type: Schema.Types.ObjectId, ref: 'PartWorkspaceShare', required: true, index: true },
    author: { type: actorSnapshotSchema, required: true },
    body: { type: String, required: true, trim: true, maxlength: 6000 },
    attachment_references: [{ type: Schema.Types.ObjectId, ref: 'Attachment' }],
    supersedes_message: { type: Schema.Types.ObjectId, ref: 'PartCollaborationMessage', default: null },
    archived_at: { type: Date, default: null },
    idempotency_key: { type: String, maxlength: 160, default: undefined },
    request_hash: { type: String, maxlength: 64, default: '' },
  }, { timestamps: { createdAt: 'created_at', updatedAt: false } })
  schema.index({ collaboration_item: 1, created_at: 1 })
  schema.index({ collaboration_item: 1, idempotency_key: 1 }, { unique: true, partialFilterExpression: { idempotency_key: { $type: 'string' } } })
  schema.set('toJSON', { getters: true, virtuals: true, transform: (_document, value) => { delete value.__v; return value } })
  return schema
}

const PartCollaborationItem = models.PartCollaborationItem || model('PartCollaborationItem', createPartCollaborationItemSchema())
const PartCollaborationMessage = models.PartCollaborationMessage || model('PartCollaborationMessage', createPartCollaborationMessageSchema())

module.exports = {
  PART_COLLABORATION_PRIORITIES,
  PART_COLLABORATION_SCHEDULE_EFFECTS,
  PART_COLLABORATION_STATES,
  PART_COLLABORATION_TYPES,
  PartCollaborationItem,
  PartCollaborationMessage,
  createPartCollaborationItemSchema,
  createPartCollaborationMessageSchema,
}
