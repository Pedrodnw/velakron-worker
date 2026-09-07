const crypto = require('node:crypto')
const mongoose = require('mongoose')
const { OutboxEvent } = require('../models/OutboxEvent')
const { PartCollaborationItem } = require('../models/PartCollaboration')
const AttentionCondition = require('../models/AttentionCondition')
const { currentActor } = require('./attentionWorkflowV2')
const PartRevisionReview = require('../models/PartRevisionReview')
const { encryptOutboxPayload } = require('./outboxPayload')

const DAY = 24 * 60 * 60 * 1000
const hashRecipient = email => crypto.createHash('sha256').update(String(email).toLowerCase()).digest('hex').slice(0, 20)
const technicalDetailsFree = ({ clientAppUrl, partId, collaborationId = null, productionId = null, formalId = null, kind }) => {
  const base = `${clientAppUrl}/app/parts/${encodeURIComponent(String(partId))}`
  const url = productionId ? `${clientAppUrl}/app/production/${encodeURIComponent(String(productionId))}?${formalId ? `formal=${encodeURIComponent(String(formalId))}` : `part_tab=cases&collaboration=${encodeURIComponent(String(collaborationId))}`}` : collaborationId ? `${base}?collaboration=${encodeURIComponent(String(collaborationId))}` : base
  return {
    template: 'part_workspace_reminder',
    template_version: '1',
    subject: kind === 'review' ? 'A Part Workspace revision is waiting for review' : 'A Part Workspace action is due',
    text: `A secure Part Workspace action is waiting for your company. This email intentionally contains no part number, technical description, drawing, model, filename, or attachment.\n\nOpen Velakron securely: ${url}`,
    html: '',
  }
}

const activeRecipientEmails = async ({ connection, organizationId, roles = null }) => {
  const membershipFilter = {
    organization: new mongoose.Types.ObjectId(organizationId),
    status: 'active',
    current: true,
  }
  if (Array.isArray(roles) && roles.length) membershipFilter.role = { $in: roles }
  const memberships = await connection.collection('organizationmemberships').find(
    membershipFilter,
    { projection: { user: 1 } },
  ).toArray()
  const ids = memberships.map(row => row.user).filter(Boolean)
  if (!ids.length) return []
  const users = await connection.collection('users').find({
    _id: { $in: ids },
    account_status: 'active',
    demo_guest: { $ne: true },
  }, { projection: { email: 1 } }).toArray()
  return [...new Set(users.map(row => String(row.email || '').trim().toLowerCase()).filter(email => /^\S+@\S+\.\S+$/.test(email) && !/@(?:fixture\.)?[^@]*\.test$/i.test(email)))]
}

const stillActionable = async ({ connection, candidate }) => {
  const collection = candidate.kind === 'formal' ? 'attentionconditions' : candidate.kind === 'review' ? 'partrevisionreviews' : 'partcollaborationitems'
  const current = await connection.collection(collection).findOne({ _id: candidate.aggregateId })
  if (!current || current.__v !== candidate.version) return false
  if (candidate.kind === 'formal' && (currentActor(current) === 'none' || String(current[`${currentActor(current)}_organization`]) !== String(candidate.organizationId))) return false
  if (candidate.kind === 'collaboration' && (['closed', 'escalated'].includes(current.state) || current.archived_at || String(current[`${current.current_actor_side}_organization`]) !== String(candidate.organizationId))) return false
  if (candidate.kind === 'review' && !['not_started', 'in_review', 'changes_requested'].includes(current.state)) return false
  const organization = await connection.collection('organizations').findOne({ _id: candidate.organizationId, status: 'active', demo_workspace: { $ne: true } })
  if (!organization) return false
  const share = await connection.collection('partworkspaceshares').findOne({ ...(current.share ? { _id: current.share } : {}), oem_organization: current.oem_organization, supplier_organization: current.supplier_organization, visible_revisions: current.part_revision, state: 'active' })
  if (!share) return false
  const relationship = await connection.collection('organizationrelationships').findOne({ _id: share.relationship, status: 'active', current: true, oem_organization: current.oem_organization, supplier_organization: current.supplier_organization })
  if (!relationship) return false
  if (candidate.productionId && !await connection.collection('productionrecords').findOne({ _id: candidate.productionId, oem_organization: current.oem_organization, supplier_organization: current.supplier_organization, current_relationship: relationship._id, demo_workspace: { $ne: true } })) return false
  return true
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
  const [items, reviews, formalRecords] = await Promise.all([
    PartCollaborationItem.find({
      state: mongoose.trusted({ $nin: ['closed', 'escalated'] }),
      archived_at: null,
      current_actor_side: mongoose.trusted({ $in: ['oem', 'supplier'] }),
      due_at: mongoose.trusted({ $ne: null, $lte: dueSoon }),
    }).sort({ due_at: 1 }).limit(limit).lean(),
    PartRevisionReview.find({
      state: mongoose.trusted({ $in: ['not_started', 'in_review', 'changes_requested'] }),
      updated_at: mongoose.trusted({ $lte: stale }),
    }).sort({ updated_at: 1 }).limit(limit).lean(),
    AttentionCondition.find({ workflow_version: 'attention-workflow-v2', active: true, terminal: false, last_seen_at: mongoose.trusted({ $lte: stale }) }).sort({ last_seen_at: 1 }).limit(limit).lean(),
  ])
  const candidates = [
    ...items.map(item => ({
      kind: 'collaboration', aggregateId: item._id, partId: item.part, collaborationId: item._id, productionId: item.primary_production_record || item.production_records?.[0],
      version: item.__v, due: item.due_at,
      organizationId: item.current_actor_side === 'oem' ? item.oem_organization : item.supplier_organization,
      milestone: item.due_at < now ? 'overdue' : 'due-soon',
      occurrence: new Date(item.due_at).toISOString().slice(0, 10),
    })),
    ...reviews.map(review => {
      const ageDays = Math.floor((now.getTime() - new Date(review.updated_at).getTime()) / DAY)
      const milestone = ageDays >= 14 ? 14 : ageDays >= 7 ? 7 : 3
      return {
        kind: 'review', aggregateId: review._id, partId: review.part,
        version: review.__v, due: review.updated_at,
        organizationId: review.supplier_organization,
        milestone: `stale-${milestone}`, occurrence: review.state,
      }
    }),
    ...formalRecords.filter(item => currentActor(item) !== 'none').map(item => ({ kind: 'formal', aggregateId: item._id, formalId: item._id, version: item.__v, due: item.last_seen_at, productionId: item.production_record, organizationId: currentActor(item) === 'oem' ? item.oem_organization : item.supplier_organization, milestone: 'formal-stale', occurrence: `${item.__v}:${Math.floor((now - new Date(item.last_seen_at)) / (7 * DAY))}` })),
  ].sort((a, b) => new Date(a.due) - new Date(b.due)).slice(0, limit)
  let recipients = 0
  let queued = 0
  for (const candidate of candidates) {
    if (!await stillActionable({ connection, candidate })) continue
    const emails = await activeRecipientEmails({ connection, organizationId: candidate.organizationId, roles: candidate.kind === 'formal' ? ['oem_admin', 'oem_user', 'supplier_admin', 'supplier_user'] : null })
    recipients += emails.length
    if (!write) continue
    for (const to of emails) {
      const created = await queueEmail({
        encryptionKey,
        organizationId: candidate.organizationId,
        aggregateType: candidate.kind === 'review' ? 'PartRevisionReview' : candidate.kind === 'formal' ? 'AttentionCondition' : 'PartCollaborationItem',
        aggregateId: candidate.aggregateId,
        idempotencyKey: `identity.email.send:v1:part-reminder:${candidate.aggregateId}:${candidate.milestone}:${candidate.occurrence}:${hashRecipient(to)}`,
        message: technicalDetailsFree({ clientAppUrl, partId: candidate.partId, collaborationId: candidate.collaborationId, productionId: candidate.productionId, formalId: candidate.formalId, kind: candidate.kind }),
        to,
      })
      if (created) queued += 1
    }
  }
  return { inspected: candidates.length, collaboration_items: items.length, stale_reviews: reviews.length, recipients, queued, write }
}

module.exports = { activeRecipientEmails, stillActionable, sweepPartWorkspaceReminders, technicalDetailsFree }
