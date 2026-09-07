// Versioned, server-authoritative contracts. Creation gates never disable readers.
const COLLABORATION_VERSION = 'part-collaboration-v2'
const FORMAL_VERSION = 'attention-workflow-v2'
const TOPICS = Object.freeze(['general', 'drawing', 'model', 'requirement', 'tooling', 'manufacturing', 'quality', 'clarification', 'information', 'manufacturability_suggestion', 'deviation_request'])
const CATEGORIES = Object.freeze(['issue', 'production_block', 'non_conformance'])
const DISPOSITIONS = Object.freeze(['use_as_is', 'repair', 'rework', 'scrap', 'return'])
const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }) }
const object = (value, name = 'data') => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('VALIDATION_ERROR', `${name} must be an object`)
  return value
}
const exactKeys = (value, keys, name = 'data') => {
  object(value, name)
  if (Object.keys(value).some(key => !keys.includes(key))) fail('VALIDATION_ERROR', `${name} contains an unsupported field`)
}
const text = (value, name, { min = 8, max = 3000, optional = false } = {}) => {
  if (optional && (value === undefined || value === null || value === '')) return ''
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail('VALIDATION_ERROR', `${name} must contain ${min}–${max} characters`)
  return value.trim()
}
const id = (value, name, optional = false) => {
  if (optional && (value === undefined || value === null || value === '')) return null
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) fail('VALIDATION_ERROR', `${name} must be a valid ID`)
  return value.toLowerCase()
}
const ids = (value = [], name = 'attachment_ids') => {
  if (!Array.isArray(value) || value.length > 30) fail('VALIDATION_ERROR', `${name} must contain at most 30 IDs`)
  const result = value.map(entry => id(entry, name))
  if (new Set(result).size !== result.length) fail('VALIDATION_ERROR', `${name} contains duplicates`)
  return result
}
const commandIdentity = body => {
  object(body, 'command')
  if (!Number.isSafeInteger(body.version) || body.version < 0) fail('VALIDATION_ERROR', 'A current integer record version is required')
  if (typeof body.idempotency_key !== 'string' || !/^[a-zA-Z0-9._:-]{8,160}$/.test(body.idempotency_key)) fail('VALIDATION_ERROR', 'An idempotency key of 8–160 safe characters is required')
  return { version: body.version, idempotency_key: body.idempotency_key }
}

const changeProposal = value => {
  if (value == null) return null
  exactKeys(value, ['original_condition', 'accepted_change', 'reason', 'effectivity', 'attachment_ids', 'visual_anchor_id'], 'technical_change')
  return {
    original_condition: text(value.original_condition, 'Original requirement or condition'),
    accepted_change: text(value.accepted_change, 'Accepted change'),
    reason: text(value.reason, 'Technical change reason'),
    effectivity: text(value.effectivity, 'Scope for this production'),
    attachment_ids: ids(value.attachment_ids),
    visual_anchor_id: id(value.visual_anchor_id, 'Visual anchor', true),
  }
}
const resolution = value => {
  exactKeys(value, ['summary', 'reason', 'technical_change'], 'resolution')
  return { summary: text(value.summary, 'Proposed resolution'), reason: text(value.reason, 'Resolution reason'), technical_change: changeProposal(value.technical_change) }
}
const scope = (value, productionQuantity = null) => {
  const referenceKeys = ['inspection_run', 'inspection_result', 'inspection_characteristic', 'requirement', 'visual_anchor']
  const stringKeys = ['lot', 'serial_start', 'serial_end', 'shipment_reference']
  exactKeys(value, ['affected_quantity', 'produced_quantity', 'quantity_override_reason', 'reported_containment', ...referenceKeys, ...stringKeys, 'evidence_ids'], 'affected_scope')
  if (!Number.isSafeInteger(value.affected_quantity) || value.affected_quantity < 1) fail('VALIDATION_ERROR', 'Affected quantity must be a positive whole number')
  if (value.produced_quantity != null && (!Number.isSafeInteger(value.produced_quantity) || value.produced_quantity < 1)) fail('VALIDATION_ERROR', 'Produced quantity must be a positive whole number')
  const override = text(value.quantity_override_reason, 'Quantity override reason', { optional: true, max: 1000 })
  const limit = value.produced_quantity ?? productionQuantity
  if ((Number.isFinite(limit) && value.affected_quantity > limit) || (productionQuantity && value.produced_quantity > productionQuantity)) {
    if (!override) fail('QUANTITY_SCOPE_EXCEEDED', 'Explain the aggregated or unknown scope when quantities exceed this production')
  }
  return {
    affected_quantity: value.affected_quantity,
    produced_quantity: value.produced_quantity ?? null,
    quantity_override_reason: override,
    reported_containment: text(value.reported_containment, 'Initial containment reported', { min: 4, optional: true, max: 1000 }),
    ...Object.fromEntries(referenceKeys.map(key => [key, id(value[key], key, true)])),
    ...Object.fromEntries(stringKeys.map(key => [key, text(value[key], key, { min: 1, max: 240, optional: true })])),
    evidence_ids: ids(value.evidence_ids, 'evidence_ids'),
  }
}
const stepData = (action, value = {}) => {
  if (action === 'submit_resolution') return resolution(value)
  if (action === 'submit_investigation') {
    exactKeys(value, ['owner_membership_id', 'preliminary_cause', 'root_cause', 'method', 'notes'])
    return { owner_membership_id: id(value.owner_membership_id, 'Investigation owner'), preliminary_cause: text(value.preliminary_cause, 'Preliminary cause', { optional: true }), root_cause: text(value.root_cause, 'Root cause'), method: text(value.method, 'Investigation method'), notes: text(value.notes, 'Investigation notes', { optional: true }) }
  }
  if (action === 'submit_disposition') {
    exactKeys(value, ['type', 'instructions', 'reason', 'verification_plan'])
    if (!DISPOSITIONS.includes(value.type)) fail('VALIDATION_ERROR', 'Choose a supported disposition')
    return { type: value.type, instructions: text(value.instructions, `${value.type.replaceAll('_', ' ')} instructions`), reason: text(value.reason, 'Disposition justification'), verification_plan: text(value.verification_plan, 'Verification plan') }
  }
  if (['submit_containment', 'complete_corrective_action', 'submit_evidence', 'verify_and_close', 'add_message'].includes(action)) {
    exactKeys(value, ['summary', 'attachment_ids'])
    return { summary: text(value.summary, action === 'add_message' ? 'Message' : 'Summary', { min: action === 'add_message' ? 1 : 8, max: action === 'add_message' ? 6000 : 3000 }), attachment_ids: ids(value.attachment_ids) }
  }
  exactKeys(value, [])
  return {}
}

module.exports = { CATEGORIES, COLLABORATION_VERSION, DISPOSITIONS, FORMAL_VERSION, TOPICS, changeProposal, commandIdentity, exactKeys, fail, id, ids, object, resolution, scope, stepData, text }
