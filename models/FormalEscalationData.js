const { Schema } = require('mongoose')
const { actorSnapshotSchema } = require('./SupplierAssignment')
const string = (max = 3000, required = false) => ({ type: String, trim: true, maxlength: max, ...(required ? { required: true, minlength: 8 } : { default: '' }) })
const reference = (ref, required = false) => ({ type: Schema.Types.ObjectId, ref, required, default: null })
const referenceList = ref => ({ type: [reference(ref)], default: [], validate: value => value.length <= 30 })
const nested = definition => new Schema(definition, { _id: false, strict: 'throw' })
const approvalSchema = nested({ actor: { type: actorSnapshotSchema, required: true }, occurred_at: { type: Date, required: true } })
const technicalChangeSchema = nested({
  original_condition: string(3000, true), accepted_change: string(3000, true), reason: string(3000, true), effectivity: string(3000, true),
  attachment_ids: referenceList('Attachment'), visual_anchor_id: reference('VisualAnchor'),
})
const resolutionSchema = nested({ summary: string(3000, true), reason: string(3000, true), technical_change: { type: technicalChangeSchema, default: null } })
const summarySchema = nested({ summary: string(3000, true), attachment_ids: referenceList('Attachment') })
const affectedScopeSchema = nested({
  affected_quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  produced_quantity: { type: Number, default: null, min: 1, validate: value => value == null || Number.isSafeInteger(value) },
  reported_containment: string(1000), quantity_override_reason: string(1000), lot: string(240), serial_start: string(240), serial_end: string(240), shipment_reference: string(240),
  inspection_run: reference('InspectionRun'), inspection_result: reference('InspectionResult'), inspection_characteristic: reference('InspectionCharacteristic'),
  requirement: reference('PartRequirement'), visual_anchor: reference('VisualAnchor'), evidence_ids: referenceList('Attachment'),
})
const investigationSchema = nested({ owner_membership_id: reference('OrganizationMembership', true), preliminary_cause: string(), root_cause: string(3000, true), method: string(3000, true), notes: string() })
const dispositionSchema = nested({ type: { type: String, enum: ['use_as_is', 'repair', 'rework', 'scrap', 'return'], required: true }, instructions: string(3000, true), reason: string(3000, true), verification_plan: string(3000, true) })
const formalDataSchema = nested({
  affected_scope: { type: affectedScopeSchema, default: undefined },
  resolution: { type: resolutionSchema, default: undefined },
  containment: { type: summarySchema, default: undefined },
  investigation: { type: investigationSchema, default: undefined },
  disposition: { type: dispositionSchema, default: undefined },
  corrective_action: { type: summarySchema, default: undefined },
  verification_evidence: { type: summarySchema, default: undefined },
  final_verification: { type: summarySchema, default: undefined },
  stop_confirmation: { type: approvalSchema, default: undefined },
  resolution_approval: { type: approvalSchema, default: undefined },
  disposition_approval: { type: approvalSchema, default: undefined },
  production_release: { type: approvalSchema, default: undefined },
  resumption_acknowledgement: { type: approvalSchema, default: undefined },
  acknowledgement: { type: approvalSchema, default: undefined },
  message: { type: nested({ summary: { type: String, required: true, trim: true, minlength: 1, maxlength: 6000 }, attachment_ids: referenceList('Attachment') }), default: undefined },
})
const technicalAcceptanceSchema = nested({
  label: { type: String, enum: ['Accepted for this production only'], required: true },
  production_record: reference('ProductionRecord', true), part_revision: reference('PartRevision', true),
  manifest_hash: { type: String, required: true, minlength: 1, maxlength: 128 },
  change: { type: technicalChangeSchema, required: true }, approval: { type: approvalSchema, required: true },
})
module.exports = { affectedScopeSchema, approvalSchema, formalDataSchema, technicalAcceptanceSchema }
