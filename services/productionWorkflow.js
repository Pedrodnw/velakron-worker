const STAGES = Object.freeze([
  'assigned',
  'accepted',
  'material_ordered',
  'material_received',
  'programming',
  'in_production',
  'inspection',
  'ready_to_ship',
  'shipped',
  'delivered',
  'quality_review',
  'approved',
])

const workflowStageKeys = record => Array.isArray(record?.workflow_steps) && record.workflow_steps.length
  ? record.workflow_steps.map(stage => stage.key)
  : STAGES

const stageIndex = (key, record = null) => workflowStageKeys(record).indexOf(key)

module.exports = { STAGES, stageIndex, workflowStageKeys }
