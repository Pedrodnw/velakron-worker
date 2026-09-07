const { isManagedAttention, availableActions } = require('./attentionWorkflow')
const v2 = require('./attentionWorkflowV2')

const attentionActor = (condition, record) => {
  if (!condition.active) return 'none'
  if (v2.isV2(condition)) return v2.currentActor(condition)
  if (isManagedAttention(condition)) {
    if (availableActions(condition, condition.oem_organization).length) return 'oem'
    if (availableActions(condition, condition.supplier_organization).length) return 'supplier'
    return 'none'
  }
  if (condition.visibility === 'velakron_internal') return 'none'
  if (condition.source === 'computed') {
    if (condition.code === 'REQUIRED_DATE_PASSED' && record.current_stage === 'shipped') return 'oem'
    return 'supplier'
  }
  return condition.visibility === 'oem_internal' || condition.source === 'supplier' ? 'oem' : 'supplier'
}
const actionSummary = (record, conditions) => {
  const result = { oem_formal_action_count: 0, supplier_formal_action_count: 0, oem_operational_action_count: 0, supplier_operational_action_count: 0, active_production_block_count: 0 }
  for (const condition of conditions) {
    if (!condition.active) continue
    const side = attentionActor(condition, record)
    if (side !== 'none') result[`${side}_${isManagedAttention(condition) ? 'formal' : 'operational'}_action_count`]++
    if (condition.source !== 'computed' && condition.category === 'production_block' && (!v2.isV2(condition) || condition.blocking)) result.active_production_block_count++
  }
  return result
}
module.exports = { actionSummary, attentionActor }
