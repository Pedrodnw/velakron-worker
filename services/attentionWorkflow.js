const ATTENTION_WORKFLOW_VERSION = 'attention-workflow-v1'
const v2 = require('./attentionWorkflowV2')

const MANAGED_CATEGORIES = Object.freeze([
  'non_conformance',
  'production_block',
  'issue',
  'information_flag',
])

const ACTIONS = Object.freeze({
  acknowledge: { label: 'Acknowledge', role: 'recipient', requires_note: false },
  ask_question: { label: 'Ask a question', role: 'recipient', requires_note: true, note_label: 'Question' },
  answer_question: { label: 'Answer question', role: 'creator', requires_note: true, note_label: 'Answer' },
  escalate_to_issue: { label: 'Escalate to issue', role: 'recipient', requires_note: true, note_label: 'Why is this an issue?' },
  submit_response: { label: 'Submit response or action taken', role: 'recipient', requires_note: true, note_label: 'Response or action taken' },
  submit_resolution: { label: 'Submit resolution', role: 'recipient', requires_note: true, note_label: 'Proposed resolution' },
  accept_resolution: { label: 'Accept and close issue', role: 'creator', requires_note: false },
  reject_resolution: { label: 'Return for more work', role: 'creator', requires_note: true, note_label: 'What still needs to be addressed?' },
  escalate_to_production_block: { label: 'Escalate to production block', role: 'recipient', requires_note: true, note_label: 'Why must production stop?' },
  submit_containment: { label: 'Confirm containment', role: 'recipient', requires_note: true, note_label: 'How was the affected product contained?' },
  submit_disposition: { label: 'Submit disposition', role: 'recipient', requires_note: true, note_label: 'Proposed disposition' },
  approve_disposition: { label: 'Approve disposition', role: 'creator', requires_note: false },
  reject_disposition: { label: 'Return disposition', role: 'creator', requires_note: true, note_label: 'Required changes' },
  complete_required_action: { label: 'Complete required action', role: 'recipient', requires_note: true, note_label: 'Action completed' },
  submit_evidence: { label: 'Submit completion evidence', role: 'recipient', requires_note: true, note_label: 'Evidence and supporting file references' },
  verify_completion: { label: 'Verify and close non-conformance', role: 'creator', requires_note: false },
  reject_completion: { label: 'Return for corrective action', role: 'creator', requires_note: true, note_label: 'What still needs to be completed?' },
  confirm_production_stopped: { label: 'Confirm production stopped', role: 'recipient', requires_note: false },
  submit_block_action: { label: 'Submit action or disposition', role: 'creator', requires_note: true, note_label: 'Action or disposition' },
  request_block_release: { label: 'Request block release', role: 'creator', requires_note: true, note_label: 'Why is production ready to resume?' },
  approve_block_release: { label: 'Approve block release', role: 'recipient', requires_note: false },
  reject_block_release: { label: 'Reject block release', role: 'recipient', requires_note: true, note_label: 'What is required before release?' },
  confirm_production_released: { label: 'Confirm production released', role: 'recipient', requires_note: false },
})

const STATE_LABELS = Object.freeze({
  awaiting_review: 'Awaiting recipient review',
  question_open: 'Question awaiting creator response',
  awaiting_acknowledgement: 'Awaiting recipient acknowledgement',
  response_required: 'Recipient response required',
  resolution_required: 'Recipient resolution required',
  awaiting_resolution_acceptance: 'Awaiting creator acceptance',
  containment_required: 'Containment required',
  disposition_required: 'Disposition required',
  awaiting_disposition_approval: 'Awaiting disposition approval',
  action_required: 'Corrective action required',
  evidence_required: 'Completion evidence required',
  awaiting_completion_verification: 'Awaiting completion verification',
  stop_confirmation_required: 'Production stopped — awaiting confirmation',
  release_request_required: 'Block release request required',
  awaiting_release_approval: 'Awaiting block release approval',
  release_approved: 'Release approved — awaiting production restart',
  closed: 'Closed',
  escalated: 'Escalated',
})

const TRANSITIONS = Object.freeze({
  information_flag: Object.freeze({
    awaiting_review: Object.freeze({
      acknowledge: 'closed',
      ask_question: 'question_open',
      escalate_to_issue: 'escalated',
    }),
    question_open: Object.freeze({ answer_question: 'awaiting_review' }),
  }),
  issue: Object.freeze({
    awaiting_acknowledgement: Object.freeze({ acknowledge: 'response_required' }),
    response_required: Object.freeze({
      submit_response: 'resolution_required',
      escalate_to_production_block: 'escalated',
    }),
    resolution_required: Object.freeze({
      submit_resolution: 'awaiting_resolution_acceptance',
      escalate_to_production_block: 'escalated',
    }),
    awaiting_resolution_acceptance: Object.freeze({
      accept_resolution: 'closed',
      reject_resolution: 'response_required',
    }),
  }),
  non_conformance: Object.freeze({
    awaiting_acknowledgement: Object.freeze({ acknowledge: 'containment_required' }),
    containment_required: Object.freeze({ submit_containment: 'disposition_required' }),
    disposition_required: Object.freeze({ submit_disposition: 'awaiting_disposition_approval' }),
    awaiting_disposition_approval: Object.freeze({
      approve_disposition: 'action_required',
      reject_disposition: 'disposition_required',
    }),
    action_required: Object.freeze({ complete_required_action: 'evidence_required' }),
    evidence_required: Object.freeze({ submit_evidence: 'awaiting_completion_verification' }),
    awaiting_completion_verification: Object.freeze({
      verify_completion: 'closed',
      reject_completion: 'action_required',
    }),
  }),
  production_block: Object.freeze({
    awaiting_acknowledgement: Object.freeze({ acknowledge: 'stop_confirmation_required' }),
    stop_confirmation_required: Object.freeze({ confirm_production_stopped: 'action_required' }),
    action_required: Object.freeze({ submit_block_action: 'release_request_required' }),
    release_request_required: Object.freeze({ request_block_release: 'awaiting_release_approval' }),
    awaiting_release_approval: Object.freeze({
      approve_block_release: 'release_approved',
      reject_block_release: 'action_required',
    }),
    release_approved: Object.freeze({ confirm_production_released: 'closed' }),
  }),
})

const INITIAL_STATES = Object.freeze({
  information_flag: 'awaiting_review',
  issue: 'awaiting_acknowledgement',
  non_conformance: 'awaiting_acknowledgement',
  production_block: 'awaiting_acknowledgement',
})

const sameId = (left, right) => Boolean(left && right && String(left) === String(right))
const isManagedAttention = condition => condition?.source !== 'computed' && MANAGED_CATEGORIES.includes(condition?.category)
  && ['oem', 'supplier'].includes(condition?.source)

const inferredState = condition => {
  if (!isManagedAttention(condition)) return ''
  if (!condition.active) return condition.escalated_to ? 'escalated' : 'closed'
  if (condition.workflow_state) return condition.workflow_state
  if (!condition.acknowledged_at) return INITIAL_STATES[condition.category]
  return {
    information_flag: 'awaiting_review',
    issue: 'response_required',
    non_conformance: 'containment_required',
    production_block: 'stop_confirmation_required',
  }[condition.category]
}

const creatorOrganizationId = condition => {
  if (condition?.reported_by?.organization_id) return condition.reported_by.organization_id
  if (condition?.source === 'oem') return condition.oem_organization
  if (condition?.source === 'supplier') return condition.supplier_organization
  return null
}

const actorRole = (condition, actorOrganizationId) => {
  if (!actorOrganizationId || !isManagedAttention(condition)) return 'observer'
  const creatorId = creatorOrganizationId(condition)
  if (!creatorId) return 'observer'
  return sameId(creatorId, actorOrganizationId) ? 'creator' : 'recipient'
}

const availableActions = (condition, actorOrganizationId) => {
  const state = inferredState(condition)
  const role = actorRole(condition, actorOrganizationId)
  const transitions = TRANSITIONS[condition?.category]?.[state] || {}
  return Object.keys(transitions)
    .filter(key => ACTIONS[key]?.role === role)
    .map(key => ({ key, ...ACTIONS[key], next_state: transitions[key] }))
}

const initializeAttentionWorkflow = category => MANAGED_CATEGORIES.includes(category)
  ? { workflow_version: ATTENTION_WORKFLOW_VERSION, workflow_state: INITIAL_STATES[category], workflow_data: {}, workflow_history: [] }
  : {}

const noteForAction = (action, note) => {
  const clean = String(note || '').trim()
  const definition = ACTIONS[action]
  if (!definition) throw Object.assign(new Error('Attention workflow action is not supported'), { code: 'ACTION_NOT_SUPPORTED' })
  if (definition.requires_note && (clean.length < 8 || clean.length > 1000)) {
    throw Object.assign(new Error(`${definition.note_label || 'Details'} must contain between 8 and 1,000 characters`), { code: 'VALIDATION_ERROR' })
  }
  if (!definition.requires_note && clean.length > 1000) {
    throw Object.assign(new Error('Action note must contain at most 1,000 characters'), { code: 'VALIDATION_ERROR' })
  }
  return clean
}

const applyAttentionWorkflowAction = ({ condition, action, note, actor, now = new Date(), ...options }) => {
  if (v2.isV2(condition)) return v2.apply({ condition, action, note, actor, now, ...options })
  if (!condition?.active || !isManagedAttention(condition)) {
    throw Object.assign(new Error('This attention flag does not have an active managed workflow'), { code: 'ACTION_NOT_AVAILABLE' })
  }
  const currentState = inferredState(condition)
  const role = actorRole(condition, actor?.organization_id)
  const actionDefinition = ACTIONS[action]
  const nextState = TRANSITIONS[condition.category]?.[currentState]?.[action]
  if (!actionDefinition || !nextState || actionDefinition.role !== role) {
    throw Object.assign(new Error('That action is not available to your company at this workflow step'), { code: 'ACTION_NOT_AVAILABLE' })
  }
  const cleanNote = noteForAction(action, note)
  condition.workflow_version = ATTENTION_WORKFLOW_VERSION
  condition.workflow_state = nextState
  condition.workflow_data = {
    ...(condition.workflow_data || {}),
    [action]: { note: cleanNote, actor, occurred_at: now },
  }
  condition.workflow_history.push({
    action,
    from_state: currentState,
    to_state: nextState,
    note: cleanNote,
    actor,
    occurred_at: now,
  })
  if (action === 'acknowledge' && !condition.acknowledged_at) {
    condition.acknowledged_at = now
    condition.acknowledged_by = actor
  }
  const closed = nextState === 'closed' || nextState === 'escalated'
  if (closed) {
    condition.active = false
    condition.resolved_at = now
    condition.resolved_by = actor
    condition.resolution_reason = cleanNote || (nextState === 'escalated' ? 'Escalated into a higher-risk attention workflow.' : `${actionDefinition.label}.`)
  }
  return {
    action,
    definition: actionDefinition,
    previous_state: currentState,
    next_state: nextState,
    closed,
    escalation_category: action === 'escalate_to_issue'
      ? 'issue'
      : action === 'escalate_to_production_block' ? 'production_block' : null,
    note: cleanNote,
  }
}

const publicAttentionWorkflow = (condition, actorOrganizationId, actor = null) => {
  if (v2.isV2(condition)) return v2.presentation(condition, actor)
  if (!isManagedAttention(condition)) return { managed: false }
  const state = inferredState(condition)
  return {
    managed: true,
    version: condition.workflow_version || ATTENTION_WORKFLOW_VERSION,
    state,
    state_label: STATE_LABELS[state] || state.replaceAll('_', ' '),
    actor_role: actorRole(condition, actorOrganizationId),
    production_blocked: condition.category === 'production_block' && condition.active,
    available_actions: availableActions(condition, actorOrganizationId),
    history: condition.workflow_history || [],
    data: condition.workflow_data || {},
  }
}

module.exports = {
  ACTIONS,
  ATTENTION_WORKFLOW_VERSION,
  MANAGED_CATEGORIES,
  STATE_LABELS,
  TRANSITIONS,
  actorRole,
  applyAttentionWorkflowAction,
  availableActions,
  creatorOrganizationId,
  inferredState,
  initializeAttentionWorkflow,
  isManagedAttention,
  publicAttentionWorkflow,
}
