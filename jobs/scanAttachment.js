const Attachment = require('../models/Attachment')

const createAttachmentScanJob = ({
  attachmentModel = Attachment,
  enabled = false,
  scanner,
}) => ({
  key: 'attachment.scan',
  kind: 'outbox',
  enabled,
  maxAttempts: 5,
  timeoutMilliseconds: 5 * 60 * 1000,
  concurrency: 1,
  idempotency: 'attachment-id-storage-version',
  redaction: 'never-log-filename-object-key-or-content',
  run: async (payload, context = {}) => {
    const attachment = await attachmentModel.findOne({
      _id: payload?.attachment_id,
      owner_organization: payload?.owner_organization_id,
    }).select('+object_key +scan_reference')
    if (!attachment) {
      const error = new Error('Attachment no longer exists')
      error.code = 'ATTACHMENT_NOT_FOUND'
      error.retryable = false
      throw error
    }
    if (attachment.state === 'available' && attachment.scan_status === 'clean') {
      return {
        provider: attachment.scan_provider || 'scanner',
        messageId: attachment.scan_reference || `attachment:${attachment._id}`,
        state: 'already_completed',
      }
    }
    if (attachment.state !== 'scanning' || attachment.scan_status !== 'pending') {
      const error = new Error('Attachment is not awaiting a malware scan')
      error.code = 'ATTACHMENT_SCAN_STATE_INVALID'
      error.retryable = false
      throw error
    }
    const result = await scanner.scan({
      attachmentId: String(attachment._id),
      objectKey: attachment.object_key,
      storageAdapter: attachment.storage_adapter,
      mimeType: attachment.mime_type,
      byteSize: attachment.byte_size,
      idempotencyKey: context.idempotencyKey,
    })
    if (!['clean', 'infected', 'unavailable'].includes(result?.status)) {
      const error = new Error('Scanner returned an unsupported result')
      error.code = 'MALWARE_SCAN_RESULT_INVALID'
      error.retryable = false
      throw error
    }
    const completedAt = new Date()
    attachment.scan_provider = String(result.provider || 'scanner').slice(0, 80)
    attachment.scan_completed_at = completedAt
    attachment.scan_reference = String(result.reference || '').slice(0, 240)
    attachment.scan_status = result.status
    if (result.status === 'clean') {
      attachment.state = 'available'
      attachment.available_at = completedAt
      attachment.failure_reason = ''
    } else {
      if (typeof scanner.quarantine === 'function') {
        try {
          await scanner.quarantine({ objectKey: attachment.object_key })
        } catch (_error) {
          // The application metadata still fails closed. The provider result
          // tag remains available for an audited relocation retry.
        }
      }
      attachment.state = 'quarantined'
      attachment.failed_at = completedAt
      attachment.failure_reason = result.status === 'infected'
        ? 'Security scanning identified a potentially unsafe file.'
        : 'Security scanning could not safely inspect this file format.'
    }
    await attachment.save()
    return {
      provider: attachment.scan_provider,
      messageId: attachment.scan_reference || `attachment:${attachment._id}`,
      state: result.status,
    }
  },
})

module.exports = { createAttachmentScanJob }
