const mongoose = require('mongoose')
const AttentionCondition = require('../models/AttentionCondition')
const SupplierAssignment = require('../models/SupplierAssignment')
const { stageIndex } = require('./productionWorkflow')

const POLICY_VERSION = 'attention-v1'
const POLICY = Object.freeze({
  awaitingAcceptanceHours: 48,
  staleSupplierDays: 5,
  highSlipDays: 7,
  machineRequiredStage: 'in_production',
})
const MANUAL_ATTENTION_CATEGORY_POLICY = Object.freeze({
  non_conformance: Object.freeze({ code: 'NON_CONFORMANCE', severity: 'high', health: 'at_risk' }),
  production_block: Object.freeze({ code: 'PRODUCTION_BLOCK', severity: 'high', health: 'at_risk' }),
  issue: Object.freeze({ code: 'ISSUE', severity: 'medium', health: 'needs_attention' }),
  information_flag: Object.freeze({ code: 'INFORMATION_FLAG', severity: 'low', health: 'on_schedule' }),
})
const resolvedPolicy = policy => ({ ...POLICY, ...(policy || {}) })
const DAY_MS = 24 * 60 * 60 * 1000
const hoursBetween = (earlier, later) => Math.max(0, (new Date(later) - new Date(earlier)) / (60 * 60 * 1000))
const calendarDaysBetween = (earlier, later) => {
  const start = Date.UTC(new Date(earlier).getUTCFullYear(), new Date(earlier).getUTCMonth(), new Date(earlier).getUTCDate())
  const end = Date.UTC(new Date(later).getUTCFullYear(), new Date(later).getUTCMonth(), new Date(later).getUTCDate())
  return Math.max(0, Math.floor((end - start) / DAY_MS))
}
const isoDate = value => value ? new Date(value).toISOString().slice(0, 10) : null
const condition = (code, health, severity, explanation, evidence = {}) => ({
  code,
  health,
  severity,
  explanation,
  evidence,
  source: 'computed',
  visibility: 'shared',
  stable_key: `computed:${code}`,
})

const evaluateComputedAttention = ({ record, assignment = null, now = new Date(), policy: policyInput = null }) => {
  const policy = resolvedPolicy(policyInput)
  if (!record || record.lifecycle_state !== 'active') return []
  const results = []
  const requiredDate = record.required_delivery_date && new Date(record.required_delivery_date)
  const projectedArrival = record.projected_arrival_date && new Date(record.projected_arrival_date)

  if (requiredDate && now > requiredDate && !record.delivered_at) {
    const days = calendarDaysBetween(requiredDate, now)
    results.push(condition(
      'REQUIRED_DATE_PASSED',
      'delayed',
      'high',
      `Required arrival date passed ${days || 1} day${days === 1 ? '' : 's'} ago.`,
      { required_delivery_date: isoDate(requiredDate), days_past_due: days || 1 },
    ))
  } else if (requiredDate && projectedArrival && projectedArrival > requiredDate && !record.delivered_at) {
    const days = calendarDaysBetween(requiredDate, projectedArrival)
    results.push(condition(
      'FORECAST_AFTER_REQUIRED',
      'at_risk',
      'high',
      `Projected arrival is ${days || 1} day${days === 1 ? '' : 's'} after the required date.`,
      {
        projected_arrival_date: isoDate(projectedArrival),
        required_delivery_date: isoDate(requiredDate),
        days_late: days || 1,
      },
    ))
  }

  const assignmentStartedAt = assignment?.assigned_at || assignment?.created_at
  if (['pending', 'reacceptance_required'].includes(record.acceptance_status) && assignmentStartedAt) {
    const hours = Math.floor(hoursBetween(assignmentStartedAt, now))
    if (hours >= policy.awaitingAcceptanceHours) {
      results.push(condition(
        'AWAITING_ACCEPTANCE',
        'needs_attention',
        'medium',
        `Supplier acceptance has been pending for ${hours} hours.`,
        { assigned_at: assignmentStartedAt, hours_waiting: hours },
      ))
    }
  }

  if (record.acceptance_status === 'accepted' && !record.delivered_at && !record.expected_ship_date) {
    results.push(condition(
      'MISSING_EXPECTED_SHIP_DATE',
      'needs_attention',
      'medium',
      'Accepted work does not have a current expected ship date.',
    ))
  }

  if (record.acceptance_status === 'accepted' && !record.delivered_at && record.last_supplier_update_at) {
    const days = calendarDaysBetween(record.last_supplier_update_at, now)
    if (days >= policy.staleSupplierDays) {
      results.push(condition(
        'STALE_SUPPLIER_UPDATE',
        'needs_attention',
        'medium',
        `No supplier update for ${days} calendar days.`,
        { last_supplier_update_at: record.last_supplier_update_at, days_without_update: days },
      ))
    }
  }

  if (record.acceptance_status === 'accepted'
    && !record.delivered_at
    && stageIndex(record.current_stage) >= stageIndex(policy.machineRequiredStage)
    && !record.current_machine) {
    results.push(condition(
      'MACHINE_UNASSIGNED',
      'needs_attention',
      'medium',
      `No primary machine is assigned at the ${String(record.current_stage).replaceAll('_', ' ')} stage.`,
      { current_stage: record.current_stage },
    ))
  }
  return results
}

const severityRank = Object.freeze({ low: 1, medium: 2, high: 3 })
const healthRank = Object.freeze({ on_schedule: 0, needs_attention: 1, at_risk: 2, delayed: 3 })
const summarizeAttention = (record, activeConditions, now = new Date()) => {
  const visible = activeConditions || []
  const unresolvedManual = visible.some(item => item.source !== 'computed' || item.code === 'SHIP_DATE_SLIPPED')
  const effective = record.lifecycle_state === 'completed' && !unresolvedManual ? [] : visible
  const health = effective.reduce(
    (result, item) => healthRank[item.health] > healthRank[result] ? item.health : result,
    'on_schedule',
  )
  const severity = effective.reduce(
    (result, item) => !result || severityRank[item.severity] > severityRank[result] ? item.severity : result,
    null,
  )
  return {
    schedule_health: health,
    highest_attention_severity: severity,
    active_attention_codes: [...new Set(effective.map(item => item.code))],
    active_attention_count: effective.length,
    last_attention_evaluated_at: now,
    schedule_policy_version: POLICY_VERSION,
  }
}

const synchronizeAttention = async ({ record, now = new Date(), session = null, policy = null }) => {
  const assignment = record.current_assignment
    ? await SupplierAssignment.findById(record.current_assignment).session(session)
    : null
  const desired = evaluateComputedAttention({ record, assignment, now, policy })
  const desiredKeys = desired.map(item => item.stable_key)
  const computedFilter = {
    production_record: record._id,
    source: 'computed',
    active: true,
    'evidence.sticky': { $ne: true },
  }
  await AttentionCondition.updateMany({
    ...computedFilter,
    ...(desiredKeys.length ? { stable_key: mongoose.trusted({ $nin: desiredKeys }) } : {}),
  }, {
    $set: {
      active: false,
      resolved_at: now,
      resolution_reason: 'The underlying condition no longer applies.',
      last_seen_at: now,
    },
  }, { session })

  for (const item of desired) {
    const existing = await AttentionCondition.findOne({
      production_record: record._id,
      stable_key: item.stable_key,
      active: true,
    }).session(session)
    if (existing) {
      existing.health = item.health
      existing.severity = item.severity
      existing.explanation = item.explanation
      existing.evidence = item.evidence
      existing.last_seen_at = now
      await existing.save({ session })
    } else {
      await AttentionCondition.create([{
        production_record: record._id,
        oem_organization: record.oem_organization,
        supplier_organization: record.supplier_organization,
        policy_version: POLICY_VERSION,
        ...item,
        first_seen_at: now,
        last_seen_at: now,
        detected_at: now,
      }], { session })
    }
  }

  const active = await AttentionCondition.find({ production_record: record._id, active: true }).session(session)
  Object.assign(record, summarizeAttention(record, active, now))
  const sharedSummary = summarizeAttention(record, active.filter(item => item.visibility === 'shared'), now)
  record.shared_schedule_health = sharedSummary.schedule_health
  record.shared_highest_attention_severity = sharedSummary.highest_attention_severity
  record.shared_active_attention_codes = sharedSummary.active_attention_codes
  record.shared_active_attention_count = sharedSummary.active_attention_count
  return active
}

module.exports = {
  MANUAL_ATTENTION_CATEGORY_POLICY,
  POLICY,
  POLICY_VERSION,
  calendarDaysBetween,
  evaluateComputedAttention,
  summarizeAttention,
  synchronizeAttention,
}
