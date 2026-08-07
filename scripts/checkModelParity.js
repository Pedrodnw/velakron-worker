const assert = require('node:assert/strict')
const serverOutbox = require('../../new-server/models/OutboxEvent')
const serverLease = require('../../new-server/models/JobLease')
const serverAttachment = require('../../new-server/models/Attachment')
const serverAttention = require('../../new-server/models/AttentionCondition')
const serverProductionRecord = require('../../new-server/models/ProductionRecord')
const serverSupplierAssignment = require('../../new-server/models/SupplierAssignment')
const serverOneTimeToken = require('../../new-server/models/OneTimeToken')
const workerOutbox = require('../models/OutboxEvent')
const workerLease = require('../models/JobLease')
const workerAttachment = require('../models/Attachment')
const workerAttention = require('../models/AttentionCondition')
const workerProductionRecord = require('../models/ProductionRecord')
const workerSupplierAssignment = require('../models/SupplierAssignment')
const workerOneTimeToken = require('../models/OneTimeToken')

const describeSchema = schema => ({
  paths: Object.fromEntries(Object.entries(schema.paths).map(([key, value]) => [key, {
    instance: value.instance,
    options: JSON.parse(JSON.stringify(value.options, (key, item) => {
      if (key === '$id') return '[SchemaId]'
      return typeof item === 'function' ? `[Function:${item.name || 'anonymous'}]` : item
    })),
  }])),
  indexes: schema.indexes(),
  options: {
    optimisticConcurrency: schema.options.optimisticConcurrency,
    timestamps: schema.options.timestamps,
  },
})

const checkModelParity = () => {
  const pairs = [
    ['OutboxEvent', serverOutbox.createOutboxEventSchema, workerOutbox.createOutboxEventSchema],
    ['JobLease', serverLease.createJobLeaseSchema, workerLease.createJobLeaseSchema],
    ['Attachment', serverAttachment.createAttachmentSchema, workerAttachment.createAttachmentSchema],
    ['AttentionCondition', serverAttention.createAttentionConditionSchema, workerAttention.createAttentionConditionSchema],
    ['ProductionRecord', serverProductionRecord.createProductionRecordSchema, workerProductionRecord.createProductionRecordSchema],
    ['SupplierAssignment', serverSupplierAssignment.createSupplierAssignmentSchema, workerSupplierAssignment.createSupplierAssignmentSchema],
    ['OneTimeToken', serverOneTimeToken.createOneTimeTokenSchema, workerOneTimeToken.createOneTimeTokenSchema],
  ]
  for (const [name, serverFactory, workerFactory] of pairs) {
    assert.deepEqual(
      describeSchema(serverFactory()),
      describeSchema(workerFactory()),
      `${name} differs between server and worker`,
    )
  }
  return true
}

if (require.main === module) {
  checkModelParity()
  console.log('Server/worker model parity: OK')
}

module.exports = { checkModelParity, describeSchema }
