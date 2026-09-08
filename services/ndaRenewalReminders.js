const crypto = require('node:crypto')
const mongoose = require('mongoose')
const { OutboxEvent } = require('../models/OutboxEvent')
const { encryptOutboxPayload } = require('./outboxPayload')
const { activeRecipientEmails } = require('./partWorkspaceReminders')

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000
const asObjectId = value => value instanceof mongoose.Types.ObjectId
  ? value
  : new mongoose.Types.ObjectId(value)
const hashRecipient = email => crypto.createHash('sha256')
  .update(String(email).toLowerCase())
  .digest('hex')
  .slice(0, 20)

const utcDateOnly = value => {
  const date = new Date(value)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

const reminderMilestone = ({ effectiveOn, expiresOn, now = new Date() }) => {
  if (!expiresOn) return null
  const today = utcDateOnly(now)
  const expiration = utcDateOnly(expiresOn)
  if (effectiveOn && today < utcDateOnly(effectiveOn)) return null
  const daysRemaining = Math.round((expiration.getTime() - today.getTime()) / DAY_MILLISECONDS)
  if (daysRemaining > 60) return null
  if (daysRemaining > 30) return { milestone: 60, daysRemaining }
  if (daysRemaining > 7) return { milestone: 30, daysRemaining }
  if (daysRemaining > 0) return { milestone: 7, daysRemaining }
  return { milestone: 0, daysRemaining }
}

const dateLabel = value => new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
}).format(new Date(value))

const reminderSubject = (supplierName, daysRemaining) => {
  if (daysRemaining < 0) return `NDA renewal overdue for ${supplierName}`
  if (daysRemaining === 0) return `NDA expires today for ${supplierName}`
  return `NDA renewal due in ${daysRemaining} days for ${supplierName}`
}

const reminderMessage = ({ clientAppUrl, supplierName, oemName, expiresOn, daysRemaining, url }) => {
  const expiration = dateLabel(expiresOn)
  const timing = daysRemaining < 0
    ? 'The NDA is expired and may need renewal.'
    : daysRemaining === 0
      ? 'The NDA expires today.'
      : `The NDA may need renewal in ${daysRemaining} days.`
  return {
    template: 'nda_renewal_reminder',
    template_version: '1',
    subject: reminderSubject(supplierName, daysRemaining),
    text: `${oemName} and ${supplierName} have an optional relationship NDA that expires on ${expiration}. ${timing}\n\nReview it securely in Velakron: ${clientAppUrl}${url}\n\nThe NDA status does not change platform access. This email contains no NDA attachment or production data.`,
    html: '',
  }
}

const queueEmail = async ({ encryptionKey, organizationId, requirementId, idempotencyKey, correlationId, message, to }) => {
  if (await OutboxEvent.exists({ idempotency_key: idempotencyKey })) return false
  try {
    await OutboxEvent.create({
      event_type: 'identity.email.send',
      schema_version: 1,
      aggregate_type: 'ConfidentialityNdaReminder',
      aggregate_id: requirementId,
      organization: organizationId,
      payload: encryptOutboxPayload({ to, ...message }, encryptionKey),
      idempotency_key: idempotencyKey,
      provider_state: 'queued',
      correlation_id: correlationId,
    })
    return true
  } catch (error) {
    if (error?.code === 11000) return false
    throw error
  }
}

const sweepNdaRenewalReminders = async ({
  now = new Date(),
  limit = 250,
  write = false,
  connection = mongoose.connection,
  encryptionKey,
  clientAppUrl,
  recipientLookup = activeRecipientEmails,
} = {}) => {
  const today = utcDateOnly(now)
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 250, 500))
  const requirements = await connection.collection('confidentialityrequirements').find({
    scope: 'relationship',
    current: true,
    'custom_nda.expires_on': {
      $gte: new Date(today.getTime() - (90 * DAY_MILLISECONDS)),
      $lte: new Date(today.getTime() + (60 * DAY_MILLISECONDS)),
    },
  }).sort({ 'custom_nda.expires_on': 1 }).limit(boundedLimit).toArray()

  const relationshipIds = requirements.map(requirement => asObjectId(requirement.relationship))
  const relationships = relationshipIds.length
    ? await connection.collection('organizationrelationships').find({
      _id: { $in: relationshipIds },
      status: 'active',
      current: true,
    }, { projection: { oem_organization: 1, supplier_organization: 1 } }).toArray()
    : []
  const relationshipById = new Map(relationships.map(item => [String(item._id), item]))
  const organizationIds = [...new Set(relationships.flatMap(item => [
    String(item.oem_organization),
    String(item.supplier_organization),
  ]))].map(asObjectId)
  const organizations = organizationIds.length
    ? await connection.collection('organizations').find(
      { _id: { $in: organizationIds } },
      { projection: { name: 1 } },
    ).toArray()
    : []
  const organizationById = new Map(organizations.map(item => [String(item._id), item]))

  let eligible = 0
  let recipients = 0
  let queued = 0
  let duplicate = 0
  let failed = 0
  for (const requirement of requirements) {
    const relationship = relationshipById.get(String(requirement.relationship))
    const reminder = reminderMilestone({
      effectiveOn: requirement.custom_nda?.effective_on,
      expiresOn: requirement.custom_nda?.expires_on,
      now,
    })
    if (!relationship || !reminder) continue
    eligible += 1
    const supplierName = organizationById.get(String(relationship.supplier_organization))?.name || 'your supplier'
    const oemName = organizationById.get(String(relationship.oem_organization))?.name || 'the OEM'
    const groups = [
      {
        organizationId: relationship.oem_organization,
        roles: ['oem_admin'],
        url: `/app/suppliers/${encodeURIComponent(String(relationship.supplier_organization))}`,
      },
      {
        organizationId: relationship.supplier_organization,
        roles: ['supplier_admin'],
        url: '/app/suppliers',
      },
    ]
    for (const group of groups) {
      const emails = await recipientLookup({
        connection,
        organizationId: group.organizationId,
        roles: group.roles,
      })
      recipients += emails.length
      if (!write) continue
      for (const to of emails) {
        const idempotencyKey = `identity.email.send:v1:nda-renewal:${requirement._id}:${reminder.milestone}:${hashRecipient(to)}`
        try {
          const created = await queueEmail({
            encryptionKey,
            organizationId: group.organizationId,
            requirementId: requirement._id,
            idempotencyKey,
            correlationId: `nda-renewal:${requirement._id}:${reminder.milestone}`,
            message: reminderMessage({
              clientAppUrl,
              supplierName,
              oemName,
              expiresOn: requirement.custom_nda.expires_on,
              daysRemaining: reminder.daysRemaining,
              url: group.url,
            }),
            to,
          })
          if (created) queued += 1
          else duplicate += 1
        } catch (_error) {
          failed += 1
        }
      }
    }
  }

  return { inspected: requirements.length, eligible, recipients, queued, duplicate, failed, write }
}

module.exports = {
  reminderMessage,
  reminderMilestone,
  reminderSubject,
  sweepNdaRenewalReminders,
}
