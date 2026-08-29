const crypto = require('node:crypto')
const mongoose = require('mongoose')
const { OutboxEvent } = require('../models/OutboxEvent')
const { PartCollaborationItem } = require('../models/PartCollaboration')
const PartRevisionReview = require('../models/PartRevisionReview')
const { encryptOutboxPayload } = require('./outboxPayload')

const DAY = 24 * 60 * 60 * 1000
const hashRecipient = email => crypto.createHash('sha256').update(String(email).toLowerCase()).digest('hex').slice(0, 20)
const technicalDetailsFree = ({ clientAppUrl, partId, collaborationId = null, kind }) => {
  const base = `${clientAppUrl}/app/parts/${encodeURIComponent(String(partId))}`
  const url = collaborationId ? `${base}?collaboration=${encodeURIComponent(String(collaborationId))}` : base
  return {
    template: 'part_workspace_reminder',
    template_version: '1',
    subject: kind === 'review' ? 'A Part Workspace revision is waiting for review' : 'A Part Workspace action is due',
    text: `A secure Part Workspace action is waiting for your company. This email intentionally contains no part number, technical description, drawing, model, filename, or attachment.\n\nOpen Velakron securely: ${url}`,
    html: '',
  }
}

const activeRecipientEmails = async ({ connection, organizationId }) => {
  const memberships = await connection.collection('organizationmemberships').find({
    organization: new mongoose.Types.ObjectId(organizationId),
    status: 'active',
    current: true,
  }, { projection: { user: 1 } }).toArray()
  const ids = memberships.map(row => row.user).filter(Boolean)
  if (!ids.length) return []
  const users = await connection.collection('users').find({
    _id: { $in: ids },
    account_status: 'active',
  }, { projection: { email: 1 } }).toArray()
  return [...new Set(users.map(row => String(row.email || '').trim().toLowerCase()).filter(email => /^\S+@\S+\.\S+$/.test(email) && !/@(?:fixture\.)?[^@]*\.test$/i.test(email)))]
}

const queueEmail = async ({ encryptionKey, organizationId, aggregateType, aggregateId, idempotencyKey, message, to }) => {
  const document = {
    event_type: 'identity.email.send', schema_version: 1,
    aggregate_type: aggregateType,
    aggregate_id: aggregateId,
    organization: organizationId,
    payload: encryptOutboxPayload({ to, ...message }, encryptionKey),
    idempotency_key: idempotencyKey,
    provider_state: 'queued',
  }
  if (await OutboxEvent.exists({ idempotency_key: idempotencyKey })) return false
  try {
    await OutboxEvent.create(document)
    return true
  } catch (error) {
    if (error?.code === 11000) return false
    throw error
  }
}

const sweepPartWorkspaceReminders = async ({
  now = new Date(),
  limit = 100,
  write = false,
  connection = mongoose.connection,
  encryptionKey,
  clientAppUrl,
} = {}) => {
  const dueSoon = new Date(now.getTime() + DAY)
  const stale = new Date(now.getTime() - (3 * DAY))
  const [items, reviews] = await Promise.all([
    PartCollaborationItem.find({
      state: mongoose.trusted({ $nin: ['closed'] }),
      archived_at: null,
      current_actor_side: mongoose.trusted({ $in: ['oem', 'supplier'] }),
      due_at: mongoose.trusted({ $ne: null, $lte: dueSoon }),
    }).sort({ due_at: 1 }).limit(limit).lean(),
    PartRevisionReview.find({
      state: mongoose.trusted({ $in: ['not_started', 'in_review', 'changes_requested'] }),
      updated_at: mongoose.trusted({ $lte: stale }),
    }).sort({ updated_at: 1 }).limit(limit).lean(),
  ])
  const candidates = [
    ...items.map(item => ({
      kind: 'collaboration', aggregateId: item._id, partId: item.part, collaborationId: item._id,
      organizationId: item.current_actor_side === 'oem' ? item.oem_organization : item.supplier_organization,
      milestone: item.due_at < now ? 'overdue' : 'due-soon',
      occurrence: new Date(item.due_at).toISOString().slice(0, 10),
    })),
    ...reviews.map(review => {
      const ageDays = Math.floor((now.getTime() - new Date(review.updated_at).getTime()) / DAY)
      const milestone = ageDays >= 14 ? 14 : ageDays >= 7 ? 7 : 3
      return {
        kind: 'review', aggregateId: review._id, partId: review.part,
        organizationId: review.supplier_organization,
        milestone: `stale-${milestone}`, occurrence: review.state,
      }
    }),
  ].slice(0, limit)
  let recipients = 0
  let queued = 0
  for (const candidate of candidates) {
    const emails = await activeRecipientEmails({ connection, organizationId: candidate.organizationId })
    recipients += emails.length
    if (!write) continue
    for (const to of emails) {
      const created = await queueEmail({
        encryptionKey,
        organizationId: candidate.organizationId,
        aggregateType: candidate.kind === 'review' ? 'PartRevisionReview' : 'PartCollaborationItem',
        aggregateId: candidate.aggregateId,
        idempotencyKey: `identity.email.send:v1:part-reminder:${candidate.aggregateId}:${candidate.milestone}:${candidate.occurrence}:${hashRecipient(to)}`,
        message: technicalDetailsFree({ clientAppUrl, partId: candidate.partId, collaborationId: candidate.collaborationId, kind: candidate.kind }),
        to,
      })
      if (created) queued += 1
    }
  }
  return { inspected: candidates.length, collaboration_items: items.length, stale_reviews: reviews.length, recipients, queued, write }
}

module.exports = { activeRecipientEmails, sweepPartWorkspaceReminders, technicalDetailsFree }
