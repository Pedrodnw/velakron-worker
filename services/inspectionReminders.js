const crypto = require('node:crypto')
const mongoose = require('mongoose')
const { InspectionRun } = require('../models/InspectionExecution')
const { OutboxEvent } = require('../models/OutboxEvent')
const { encryptOutboxPayload } = require('./outboxPayload')
const { activeRecipientEmails } = require('./partWorkspaceReminders')

const DAY = 24 * 60 * 60 * 1000
const hashRecipient = email => crypto.createHash('sha256').update(String(email).toLowerCase()).digest('hex').slice(0, 20)

const technicalDetailsFree = ({ clientAppUrl, productionRecordId, kind }) => ({
  template: 'inspection_action_reminder',
  template_version: '1',
  subject: kind === 'review'
    ? 'An inspection package is waiting for review'
    : 'An inspection action is due',
  text: `A secure inspection action is waiting for your company. This email intentionally contains no part number, measurement, tolerance, drawing, model, filename, or attachment.\n\nOpen Velakron securely: ${clientAppUrl}/app/production/${encodeURIComponent(String(productionRecordId))}`,
  html: '',
})

const queueEmail = async ({ encryptionKey, organizationId, runId, idempotencyKey, message, to }) => {
  if (await OutboxEvent.exists({ idempotency_key: idempotencyKey })) return false
  try {
    await OutboxEvent.create({
      event_type: 'identity.email.send',
      schema_version: 1,
      aggregate_type: 'InspectionRun',
      aggregate_id: runId,
      organization: organizationId,
      payload: encryptOutboxPayload({ to, ...message }, encryptionKey),
      idempotency_key: idempotencyKey,
      provider_state: 'queued',
    })
    return true
  } catch (error) {
    if (error?.code === 11000) return false
    throw error
  }
}

const sweepInspectionReminders = async ({
  now = new Date(),
  limit = 100,
  write = false,
  connection = mongoose.connection,
  encryptionKey,
  clientAppUrl,
} = {}) => {
  const dueSoon = new Date(now.getTime() + DAY)
  const staleReview = new Date(now.getTime() - (3 * DAY))
  const [dueRuns, reviewRuns, deadLetters] = await Promise.all([
    InspectionRun.find({
      state: mongoose.trusted({ $in: ['not_started', 'in_progress', 'ready_to_submit', 'changes_requested'] }),
      current_actor_side: mongoose.trusted({ $in: ['oem', 'supplier'] }),
      due_at: mongoose.trusted({ $ne: null, $lte: dueSoon }),
    }).sort({ due_at: 1 }).limit(limit).lean(),
    InspectionRun.find({
      state: 'submitted',
      current_actor_side: 'oem',
      updated_at: mongoose.trusted({ $lte: staleReview }),
    }).sort({ updated_at: 1 }).limit(limit).lean(),
    OutboxEvent.countDocuments({ aggregate_type: 'InspectionRun', state: 'dead' }),
  ])

  const candidates = [
    ...dueRuns.map(run => ({
      run,
      kind: 'execution',
      organizationId: run.current_actor_side === 'oem' ? run.oem_organization : run.supplier_organization,
      milestone: new Date(run.due_at) < now ? 'overdue' : 'due-soon',
      occurrence: new Date(run.due_at).toISOString().slice(0, 10),
    })),
    ...reviewRuns.map(run => {
      const ageDays = Math.floor((now.getTime() - new Date(run.updated_at).getTime()) / DAY)
      const milestone = ageDays >= 14 ? 14 : ageDays >= 7 ? 7 : 3
      return {
        run,
        kind: 'review',
        organizationId: run.oem_organization,
        milestone: `stale-${milestone}`,
        occurrence: String(run.current_submission || 'submitted'),
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
        runId: candidate.run._id,
        idempotencyKey: `identity.email.send:v1:inspection-reminder:${candidate.run._id}:${candidate.milestone}:${candidate.occurrence}:${hashRecipient(to)}`,
        message: technicalDetailsFree({
          clientAppUrl,
          productionRecordId: candidate.run.production_record,
          kind: candidate.kind,
        }),
        to,
      })
      if (created) queued += 1
    }
  }

  return {
    inspected: candidates.length,
    due_runs: dueRuns.length,
    stale_reviews: reviewRuns.length,
    recipients,
    queued,
    dead_letters: deadLetters,
    write,
  }
}

module.exports = { sweepInspectionReminders, technicalDetailsFree }
