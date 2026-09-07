const { FORMAL_VERSION, CATEGORIES, fail, resolution, scope, stepData, text } = require('./collaborationV2Contract')

const ACTIONS = Object.freeze({
  submit_resolution: { label: 'Submit proposed resolution', side: 'supplier', data_kind: 'resolution' },
  approve_resolution: { label: 'Approve resolution', side: 'oem' },
  return_resolution: { label: 'Return to supplier', side: 'oem', requires_note: true },
  confirm_production_stopped: { label: 'Confirm production stopped', side: 'supplier' },
  release_production: { label: 'Release production', side: 'oem' },
  acknowledge_resumption: { label: 'Acknowledge resumption', side: 'supplier' },
  submit_containment: { label: 'Confirm containment', side: 'supplier', data_kind: 'summary' },
  submit_investigation: { label: 'Submit investigation', side: 'supplier', data_kind: 'investigation' },
  submit_disposition: { label: 'Propose disposition', side: 'supplier', data_kind: 'disposition' },
  approve_disposition: { label: 'Approve disposition', side: 'oem' },
  return_disposition: { label: 'Return disposition', side: 'oem', requires_note: true },
  complete_corrective_action: { label: 'Complete corrective action', side: 'supplier', data_kind: 'summary' },
  submit_evidence: { label: 'Submit verification evidence', side: 'supplier', data_kind: 'evidence' },
  verify_and_close: { label: 'Verify and close Non-Conformance', side: 'oem', data_kind: 'summary' },
  return_verification: { label: 'Return for corrective action', side: 'oem', requires_note: true },
})
const TRANSITIONS = Object.freeze({
  issue: {
    supplier_resolution_required: { submit_resolution: 'awaiting_oem_resolution_approval' },
    awaiting_oem_resolution_approval: { approve_resolution: 'closed_approved', return_resolution: 'supplier_resolution_required' },
  },
  production_block: {
    stop_confirmation_required: { confirm_production_stopped: 'supplier_resolution_required' },
    supplier_resolution_required: { submit_resolution: 'awaiting_oem_resolution_approval' },
    awaiting_oem_resolution_approval: { approve_resolution: 'oem_release_required', return_resolution: 'supplier_resolution_required' },
    oem_release_required: { release_production: 'released_awaiting_supplier_acknowledgement' },
    released_awaiting_supplier_acknowledgement: { acknowledge_resumption: 'closed_released' },
  },
  non_conformance: {
    supplier_containment_required: { submit_containment: 'supplier_investigation_required' },
    supplier_investigation_required: { submit_investigation: 'supplier_disposition_required' },
    supplier_disposition_required: { submit_disposition: 'awaiting_oem_disposition_approval' },
    awaiting_oem_disposition_approval: { approve_disposition: 'supplier_corrective_action_required', return_disposition: 'supplier_disposition_required' },
    supplier_corrective_action_required: { complete_corrective_action: 'supplier_evidence_required' },
    supplier_evidence_required: { submit_evidence: 'awaiting_oem_final_verification' },
    awaiting_oem_final_verification: { verify_and_close: 'closed_verified', return_verification: 'supplier_corrective_action_required' },
  },
})
const STATE_LABELS = Object.freeze({
  supplier_resolution_required: 'Supplier resolution required',
  awaiting_oem_resolution_approval: 'Awaiting OEM resolution approval',
  stop_confirmation_required: 'Supplier must confirm production stopped',
  oem_release_required: 'Solution approved — OEM release required',
  released_awaiting_supplier_acknowledgement: 'Production released — supplier acknowledgement required',
  supplier_containment_required: 'Supplier containment required',
  supplier_investigation_required: 'Supplier investigation required',
  supplier_disposition_required: 'Supplier disposition required',
  awaiting_oem_disposition_approval: 'Awaiting OEM disposition approval',
  supplier_corrective_action_required: 'Supplier corrective action required',
  supplier_evidence_required: 'Supplier verification evidence required',
  awaiting_oem_final_verification: 'Awaiting OEM final verification',
  closed_approved: 'Closed — OEM approved', closed_released: 'Closed — production released', closed_verified: 'Closed — OEM verified',
})
const isV2 = condition => condition?.workflow_version === FORMAL_VERSION
const terminal = condition => Boolean(condition?.terminal || !condition?.active || String(condition?.workflow_state).startsWith('closed_'))
const currentActor = condition => {
  if (terminal(condition)) return 'none'
  const firstAction = Object.keys(TRANSITIONS[condition.category]?.[condition.workflow_state] || {})[0]
  return ACTIONS[firstAction]?.side || 'none'
}
const actorSide = (condition, actor) => {
  const side = actor?.organization_type
  return ['oem', 'supplier'].includes(side) && String(actor.organization_id) === String(condition[`${side}_organization`]) ? side : null
}
const canMutate = actor => ['oem_admin', 'oem_user', 'supplier_admin', 'supplier_user'].includes(actor?.role)
const availableActions = (condition, actor) => {
  if (terminal(condition) || !canMutate(actor)) return []
  const side = actorSide(condition, actor)
  return Object.keys(TRANSITIONS[condition.category]?.[condition.workflow_state] || {})
    .filter(key => ACTIONS[key].side === side).map(key => ({ key, ...ACTIONS[key] }))
}
const initialize = ({ category, initial = {}, creatorSide, quantity = null }) => {
  if (!CATEGORIES.includes(category)) fail('INVALID_FORMAL_CATEGORY', 'Choose Issue, Production Block, or Non-Conformance')
  const result = { workflow_version: FORMAL_VERSION, workflow_history: [], active: true, terminal: false, blocking: category === 'production_block', current_actor_side: 'supplier', formal_data: {} }
  result.workflow_state = { issue: 'supplier_resolution_required', production_block: 'stop_confirmation_required', non_conformance: 'supplier_containment_required' }[category]
  if (category === 'non_conformance') result.formal_data.affected_scope = scope(initial.affected_scope, quantity)
  if (initial.resolution != null) {
    if (category !== 'issue' || creatorSide !== 'supplier') fail('ACTION_NOT_AVAILABLE', 'Only a supplier-created Issue may include its initial resolution', 403)
    result.formal_data.resolution = resolution(initial.resolution)
    result.workflow_state = 'awaiting_oem_resolution_approval'
    result.current_actor_side = 'oem'
  }
  return result
}
const apply = ({ condition, action, actor, data = {}, note = '', now = new Date(), idempotencyKey = '', requestHash = '' }) => {
  if (terminal(condition)) fail('FORMAL_RECORD_TERMINAL', 'This formal record is permanently closed. Start a new case.', 409)
  const side = actorSide(condition, actor)
  if (!canMutate(actor) || !side) fail('FORBIDDEN', 'This action is not available to your role', 403)
  const definition = action === 'add_message' ? { label: 'Message added', side } : ACTIONS[action]
  const nextState = action === 'add_message' ? condition.workflow_state : TRANSITIONS[condition.category]?.[condition.workflow_state]?.[action]
  if (!definition || !nextState || side !== definition.side) fail('ACTION_NOT_AVAILABLE', 'That action is not available to your company at this workflow step', 409)
  const cleanNote = text(note, 'Comments', { optional: !definition.requires_note, max: 1000 })
  const payload = stepData(action, data)
  const fromState = condition.workflow_state
  condition.formal_data ||= {}
  const field = { submit_resolution: 'resolution', submit_containment: 'containment', submit_investigation: 'investigation', submit_disposition: 'disposition', complete_corrective_action: 'corrective_action', submit_evidence: 'verification_evidence', verify_and_close: 'final_verification' }[action]
  if (field) condition.formal_data[field] = payload
  const snapshot = { actor, occurred_at: now }
  if (action === 'confirm_production_stopped') condition.formal_data.stop_confirmation = snapshot
  if (action === 'approve_resolution') condition.formal_data.resolution_approval = snapshot
  if (action === 'approve_disposition') condition.formal_data.disposition_approval = snapshot
  if (action === 'release_production') {
    condition.formal_data.production_release = snapshot
    condition.blocking = false
  }
  if (action === 'acknowledge_resumption') condition.formal_data.resumption_acknowledgement = snapshot
  condition.workflow_state = nextState
  const closed = nextState.startsWith('closed_')
  if (closed) {
    condition.active = false
    condition.terminal = true
    condition.resolved_at = now
    condition.resolved_by = actor
    condition.resolution_reason = cleanNote || definition.label
    condition.oem_closure_approval = action === 'acknowledge_resumption' ? condition.formal_data.production_release : snapshot
  }
  condition.current_actor_side = currentActor(condition)
  condition.last_seen_at = now
  condition.workflow_history.push({ action, from_state: fromState, to_state: nextState, note: cleanNote, actor, occurred_at: now, data: { [field || (action === 'add_message' ? 'message' : 'acknowledgement')]: field || action === 'add_message' ? payload : snapshot }, idempotency_key: idempotencyKey, request_hash: requestHash })
  return { action, previous_state: fromState, next_state: nextState, closed, note: cleanNote, definition }
}
const presentation = (condition, actor) => ({
  managed: true, version: FORMAL_VERSION, state: condition.workflow_state,
  state_label: STATE_LABELS[condition.workflow_state] || 'Unknown workflow state',
  current_actor_side: currentActor(condition), actor_role: actorSide(condition, actor),
  responsibility_label: currentActor(condition) === 'none' ? 'Closed' : currentActor(condition) === actorSide(condition, actor) ? 'Action required' : `Waiting on ${currentActor(condition) === 'oem' ? 'OEM' : 'supplier'}`,
  production_blocked: condition.category === 'production_block' && condition.blocking === true,
  terminal: terminal(condition), available_actions: availableActions(condition, actor),
  can_message: !terminal(condition) && canMutate(actor) && Boolean(actorSide(condition, actor)),
  history: condition.workflow_history || [], data: condition.formal_data || {},
})

module.exports = { ACTIONS, STATE_LABELS, TRANSITIONS, actorSide, apply, availableActions, canMutate, currentActor, initialize, isV2, presentation, terminal }
