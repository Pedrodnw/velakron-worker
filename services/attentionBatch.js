const AttentionCondition = require('../models/AttentionCondition')
const ProductionRecord = require('../models/ProductionRecord')
const SupplierAssignment = require('../models/SupplierAssignment')
const { evaluateComputedAttention, synchronizeAttention } = require('./productionAttention')
const { withTransaction } = require('./transaction')

const inspectRecord = async ({ record, now, policy }) => {
  const [assignment, active] = await Promise.all([
    record.current_assignment ? SupplierAssignment.findById(record.current_assignment).lean() : null,
    AttentionCondition.find({
      production_record: record._id,
      source: 'computed',
      active: true,
      'evidence.sticky': { $ne: true },
    }).select('stable_key').lean(),
  ])
  const desired = evaluateComputedAttention({ record, assignment, now, policy })
  const desiredKeys = desired.map(item => item.stable_key).sort()
  const activeKeys = active.map(item => item.stable_key).sort()
  return {
    drifted: JSON.stringify(desiredKeys) !== JSON.stringify(activeKeys),
    desired_conditions: desiredKeys.length,
  }
}

const evaluateAttentionBatch = async ({
  limit = 100,
  now = new Date(),
  policy = null,
  write = false,
} = {}) => {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 100))
  const records = await ProductionRecord.find({ lifecycle_state: 'active' })
    .sort({ last_attention_evaluated_at: 1, _id: 1 })
    .limit(safeLimit)
  let evaluated = 0
  let drifted = 0
  let desiredConditions = 0

  for (const record of records) {
    if (!write) {
      const inspection = await inspectRecord({ record, now, policy })
      evaluated += 1
      if (inspection.drifted) drifted += 1
      desiredConditions += inspection.desired_conditions
      continue
    }
    await withTransaction(async session => {
      const current = await ProductionRecord.findById(record._id).session(session)
      if (!current || current.lifecycle_state !== 'active') return
      const active = await synchronizeAttention({ record: current, now, session, policy })
      await current.save({ session })
      evaluated += 1
      desiredConditions += active.length
    })
  }
  return {
    evaluated,
    drifted,
    desired_conditions: desiredConditions,
    mode: write ? 'write' : 'report_only',
    limit: safeLimit,
    evaluated_at: now,
  }
}

module.exports = { evaluateAttentionBatch, inspectRecord }
