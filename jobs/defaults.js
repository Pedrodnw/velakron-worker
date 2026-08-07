const { getJob, registerJob } = require('./registry')
const { evaluateAttentionBatch } = require('../services/attentionBatch')
const {
  inspectAndExpireAbandonedAttachments,
  inspectAndRevokeExpiredTokens,
} = require('../services/maintenance')
const { createProductionAttentionJob } = require('./evaluateProductionAttention')
const { createAttachmentMaintenanceJob, createTokenCleanupJob } = require('./maintenance')
const { createAttachmentScanJob } = require('./scanAttachment')
const { createIdentityEmailJob } = require('./sendIdentityEmail')

const registerDefaultJobs = ({ emailProvider, config, malwareScanner = null }) => {
  const runtime = config || {
    email: { deliveryEnabled: true },
    jobs: {
      scheduledEnabled: false,
      attentionWritesEnabled: false,
      maintenanceWritesEnabled: false,
      attentionIntervalMilliseconds: 15 * 60 * 1000,
      attachmentMaintenanceIntervalMilliseconds: 60 * 60 * 1000,
      tokenCleanupIntervalMilliseconds: 6 * 60 * 60 * 1000,
    },
    attention: null,
    malwareScanner: { adapter: 'disabled' },
  }
  if (!getJob('identity.email.send')) {
    registerJob(createIdentityEmailJob({
      emailProvider,
      enabled: runtime.email.deliveryEnabled,
    }))
  }
  if (!getJob('attention.active_records.evaluate')) {
    registerJob(createProductionAttentionJob({
      enabled: runtime.jobs.scheduledEnabled,
      evaluateBatch: evaluateAttentionBatch,
      intervalMilliseconds: runtime.jobs.attentionIntervalMilliseconds,
      policy: runtime.attention,
      write: runtime.jobs.attentionWritesEnabled,
    }))
  }
  if (!getJob('attachment.scan') && malwareScanner) {
    const scannerStatus = malwareScanner.getStatus()
    registerJob(createAttachmentScanJob({
      enabled: Boolean(runtime.jobs.enabled && scannerStatus.enabled && scannerStatus.verified),
      scanner: malwareScanner,
    }))
  }
  if (!getJob('attachment.abandoned.cleanup')) {
    registerJob(createAttachmentMaintenanceJob({
      enabled: runtime.jobs.scheduledEnabled,
      inspect: inspectAndExpireAbandonedAttachments,
      intervalMilliseconds: runtime.jobs.attachmentMaintenanceIntervalMilliseconds,
      write: runtime.jobs.maintenanceWritesEnabled,
    }))
  }
  if (!getJob('token.expired.cleanup')) {
    registerJob(createTokenCleanupJob({
      enabled: runtime.jobs.scheduledEnabled,
      inspect: inspectAndRevokeExpiredTokens,
      intervalMilliseconds: runtime.jobs.tokenCleanupIntervalMilliseconds,
      write: runtime.jobs.maintenanceWritesEnabled,
    }))
  }
}

module.exports = { registerDefaultJobs }
