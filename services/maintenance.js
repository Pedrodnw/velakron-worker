const mongoose = require('mongoose')
const Attachment = require('../models/Attachment')
const OneTimeToken = require('../models/OneTimeToken')

const inspectAndExpireAbandonedAttachments = async ({
  limit = 100,
  now = new Date(),
  write = false,
} = {}) => {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 100))
  const filter = {
    state: mongoose.trusted({ $in: ['initiated', 'pending', 'uploaded'] }),
    upload_expires_at: mongoose.trusted({ $lte: now }),
  }
  const candidates = await Attachment.find(filter)
    .select('_id state storage_adapter upload_expires_at')
    .sort({ upload_expires_at: 1 })
    .limit(safeLimit)
    .lean()
  let markedFailed = 0
  if (write && candidates.length) {
    const result = await Attachment.updateMany({
      _id: mongoose.trusted({ $in: candidates.map(item => item._id) }),
      ...filter,
    }, {
      $set: {
        state: 'failed',
        failed_at: now,
        failure_reason: 'Upload intent expired before security verification.',
      },
    })
    markedFailed = result.modifiedCount || 0
  }
  return {
    candidates: candidates.length,
    marked_failed: markedFailed,
    storage_cleanup_required: candidates.filter(item => item.state !== 'initiated').length,
    mode: write ? 'metadata_only' : 'report_only',
    limit: safeLimit,
    inspected_at: now,
  }
}

const inspectAndRevokeExpiredTokens = async ({ now = new Date(), write = false } = {}) => {
  const filter = {
    expires_at: mongoose.trusted({ $lte: now }),
    consumed_at: null,
    revoked_at: null,
  }
  const candidates = await OneTimeToken.countDocuments(filter)
  let revoked = 0
  if (write && candidates) {
    const result = await OneTimeToken.updateMany(filter, { $set: { revoked_at: now } })
    revoked = result.modifiedCount || 0
  }
  return {
    candidates,
    revoked,
    mode: write ? 'write' : 'report_only',
    inspected_at: now,
  }
}

module.exports = { inspectAndExpireAbandonedAttachments, inspectAndRevokeExpiredTokens }
