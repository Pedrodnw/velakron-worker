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
])

const stageIndex = key => STAGES.indexOf(key)

module.exports = { STAGES, stageIndex }
