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
const serverPartReview = require('../../new-server/models/PartRevisionReview')
const workerPartReview = require('../models/PartRevisionReview')
const serverPartCollaboration = require('../../new-server/models/PartCollaboration')
const workerPartCollaboration = require('../models/PartCollaboration')
const serverInspection = require('../../new-server/models/InspectionExecution')
const workerInspection = require('../models/InspectionExecution')
const serverBilling = require('../../new-server/models/BillingModels')
const workerBilling = require('../models/BillingModels')

const serializableOptions = options => {
  const seen = new WeakSet()
  const normalize = (item, depth = 0) => {
    if (typeof item === 'function') return `[Function:${item.name || 'anonymous'}]`
    if (!item || typeof item !== 'object') return item
    if (item.instanceOfSchema) {
      return {
        schema: Object.fromEntries(Object.entries(item.paths).map(([path, value]) => [path, {
          instance: value.instance,
          required: Boolean(value.options?.required),
          enum: value.enumValues || [],
        }])),
      }
    }
    if (depth >= 8 || seen.has(item)) return '[Circular]'
    seen.add(item)
    if (Array.isArray(item)) return item.map(value => normalize(value, depth + 1))
    return Object.fromEntries(Object.entries(item)
      .filter(([key]) => key !== '$id')
      .map(([key, value]) => [key, normalize(value, depth + 1)]))
  }
  return normalize(options)
}

const describeSchema = schema => ({
  paths: Object.fromEntries(Object.entries(schema.paths).map(([key, value]) => [key, {
    instance: value.instance,
    options: serializableOptions(value.options),
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
    ['PartRevisionReview', serverPartReview.createPartRevisionReviewSchema, workerPartReview.createPartRevisionReviewSchema],
    ['PartCollaborationItem', serverPartCollaboration.createPartCollaborationItemSchema, workerPartCollaboration.createPartCollaborationItemSchema],
    ['PartCollaborationMessage', serverPartCollaboration.createPartCollaborationMessageSchema, workerPartCollaboration.createPartCollaborationMessageSchema],
    ['InspectionRun', serverInspection.createInspectionRunSchema, workerInspection.createInspectionRunSchema],
    ['InspectionResult', serverInspection.createInspectionResultSchema, workerInspection.createInspectionResultSchema],
    ['InspectionSubmission', serverInspection.createInspectionSubmissionSchema, workerInspection.createInspectionSubmissionSchema],
    ['InspectionImport', serverInspection.createInspectionImportSchema, workerInspection.createInspectionImportSchema],
    ['BillingPlan', serverBilling.createBillingPlanSchema, workerBilling.createBillingPlanSchema],
    ['BillingAccount', serverBilling.createBillingAccountSchema, workerBilling.createBillingAccountSchema],
    ['BillingSubscription', serverBilling.createBillingSubscriptionSchema, workerBilling.createBillingSubscriptionSchema],
    ['BillingPilotOffer', serverBilling.createBillingPilotOfferSchema, workerBilling.createBillingPilotOfferSchema],
    ['BillingInvoice', serverBilling.createBillingInvoiceSchema, workerBilling.createBillingInvoiceSchema],
    ['BillingPaymentMethod', serverBilling.createBillingPaymentMethodSchema, workerBilling.createBillingPaymentMethodSchema],
    ['BillingWebhookEvent', serverBilling.createBillingWebhookEventSchema, workerBilling.createBillingWebhookEventSchema],
    ['BillingOperation', serverBilling.createBillingOperationSchema, workerBilling.createBillingOperationSchema],
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
