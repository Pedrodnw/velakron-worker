const crypto = require('node:crypto')
const mongoose = require('mongoose')
const {
  BillingAccount,
  BillingPilotOffer,
  BillingSubscription,
} = require('../models/BillingModels')
const { OutboxEvent } = require('../models/OutboxEvent')
const { encryptOutboxPayload } = require('./outboxPayload')

const DAY = 24 * 60 * 60 * 1000
const hashRecipient = email => crypto.createHash('sha256').update(String(email).toLowerCase()).digest('hex').slice(0, 20)
const daysUntil = (value, now) => Math.max(0, Math.ceil((new Date(value).getTime() - now.getTime()) / DAY))
const reminderMilestone = days => days <= 1 ? 1 : days <= 3 ? 3 : days <= 7 ? 7 : days <= 14 ? 14 : days <= 30 ? 30 : null

const adminRecipientEmails = async ({ connection, organizationId }) => {
  const organizationObjectId = new mongoose.Types.ObjectId(organizationId)
  const [memberships, organization] = await Promise.all([
    connection.collection('organizationmemberships').find({
      organization: organizationObjectId,
      status: 'active',
      current: true,
      role: 'oem_admin',
    }, { projection: { user: 1 } }).toArray(),
    connection.collection('organizations').findOne(
      { _id: organizationObjectId },
      { projection: { 'primary_contact.email': 1 } },
    ),
  ])
  const ids = memberships.map(row => row.user).filter(Boolean)
  const users = ids.length ? await connection.collection('users').find({
    _id: { $in: ids },
    account_status: 'active',
  }, { projection: { email: 1 } }).toArray() : []
  const emails = [organization?.primary_contact?.email, ...users.map(row => row.email)]
  return [...new Set(emails
    .map(value => String(value || '').trim().toLowerCase())
    .filter(email => /^\S+@\S+\.\S+$/.test(email) && !/@(?:fixture\.)?[^@]*\.test$/i.test(email)))]
}

const billingMessage = ({ kind, milestone, clientAppUrl }) => {
  const variants = {
    payment: {
      subject: milestone <= 1 ? 'Billing access needs immediate attention' : 'Payment action is needed for Velakron',
      text: `Your organization has a billing issue that requires an administrator. Update the payment method before the grace period ends to avoid read-only access.\n\nManage billing securely: ${clientAppUrl}/app/billing`,
    },
    pilot_offer: {
      subject: 'Your Velakron pilot offer expires soon',
      text: `Your private Velakron pilot offer expires in ${milestone} day${milestone === 1 ? '' : 's'}. Review the offer securely in your organization billing workspace.\n\nOpen billing: ${clientAppUrl}/app/billing`,
    },
    pilot_end: {
      subject: 'Your Velakron pilot is ending soon',
      text: `Your Velakron pilot ends in ${milestone} day${milestone === 1 ? '' : 's'}. Contact Velakron or review billing to keep your workspace active after the pilot.\n\nOpen billing: ${clientAppUrl}/app/billing`,
    },
    renewal: {
      subject: 'Your Velakron annual renewal is approaching',
      text: `Your Velakron subscription renews in ${milestone} day${milestone === 1 ? '' : 's'}. Review your plan, seats, and payment method before renewal.\n\nOpen billing: ${clientAppUrl}/app/billing`,
    },
  }
  return {
    template: `billing_${kind}_reminder`,
    template_version: '1',
    subject: variants[kind].subject,
    text: variants[kind].text,
    html: '',
  }
}

const queueReminder = async ({ aggregate, organizationId, kind, milestone, occurrence, to, encryptionKey, clientAppUrl, outboxModel }) => {
  const idempotencyKey = `identity.email.send:v1:billing:${kind}:${aggregate._id}:${milestone}:${occurrence}:${hashRecipient(to)}`
  if (await outboxModel.exists({ idempotency_key: idempotencyKey })) return false
  try {
    await outboxModel.create({
      event_type: 'identity.email.send',
      schema_version: 1,
      aggregate_type: aggregate.constructor?.modelName || 'BillingRecord',
      aggregate_id: aggregate._id,
      organization: organizationId,
      payload: encryptOutboxPayload({ to, ...billingMessage({ kind, milestone, clientAppUrl }) }, encryptionKey),
      idempotency_key: idempotencyKey,
      provider_state: 'queued',
    })
    return true
  } catch (error) {
    if (error?.code === 11000) return false
    throw error
  }
}

const sweepBillingLifecycle = async ({
  now = new Date(),
  limit = 100,
  write = false,
  reminderWrites = false,
  connection = mongoose.connection,
  encryptionKey,
  clientAppUrl,
  models = { BillingAccount, BillingPilotOffer, BillingSubscription, OutboxEvent },
} = {}) => {
  const reminderHorizon = new Date(now.getTime() + 30 * DAY)
  const [delinquentAccounts, expiringOffers, endingPilots, renewals] = await Promise.all([
    models.BillingAccount.find({ status: 'delinquent', grace_ends_at: mongoose.trusted({ $ne: null }) }).sort({ grace_ends_at: 1 }).limit(limit),
    models.BillingPilotOffer.find({ status: 'sent', expires_at: mongoose.trusted({ $lte: reminderHorizon }) }).sort({ expires_at: 1 }).limit(limit),
    models.BillingPilotOffer.find({ status: 'active', ends_at: mongoose.trusted({ $ne: null, $lte: reminderHorizon }) }).sort({ ends_at: 1 }).limit(limit),
    models.BillingSubscription.find({
      current: true,
      status: mongoose.trusted({ $in: ['trialing', 'active'] }),
      cancel_at_period_end: false,
      current_period_end: mongoose.trusted({ $ne: null, $lte: reminderHorizon }),
    }).sort({ current_period_end: 1 }).limit(limit),
  ])

  let accessRestricted = 0
  let offersExpired = 0
  let pilotsExpired = 0
  const candidates = []
  for (const account of delinquentAccounts) {
    if (new Date(account.grace_ends_at) <= now) {
      if (write && account.access_mode !== 'read_only') {
        account.access_mode = 'read_only'
        await account.save()
        accessRestricted += 1
      }
      continue
    }
    const milestone = reminderMilestone(daysUntil(account.grace_ends_at, now))
    if (milestone) candidates.push({ aggregate: account, organizationId: account.organization, kind: 'payment', milestone, date: account.grace_ends_at })
  }
  for (const offer of expiringOffers) {
    if (new Date(offer.expires_at) <= now) {
      if (write) {
        offer.status = 'expired'
        await offer.save()
        offersExpired += 1
      }
      continue
    }
    const milestone = reminderMilestone(daysUntil(offer.expires_at, now))
    if (milestone) candidates.push({ aggregate: offer, organizationId: offer.organization, kind: 'pilot_offer', milestone, date: offer.expires_at })
  }
  for (const pilot of endingPilots) {
    if (new Date(pilot.ends_at) <= now) {
      if (write) {
        pilot.status = 'expired'
        await pilot.save()
        pilotsExpired += 1
      }
      continue
    }
    const milestone = reminderMilestone(daysUntil(pilot.ends_at, now))
    if (milestone) candidates.push({ aggregate: pilot, organizationId: pilot.organization, kind: 'pilot_end', milestone, date: pilot.ends_at })
  }
  for (const subscription of renewals) {
    const milestone = reminderMilestone(daysUntil(subscription.current_period_end, now))
    if (milestone) candidates.push({ aggregate: subscription, organizationId: subscription.organization, kind: 'renewal', milestone, date: subscription.current_period_end })
  }

  let recipients = 0
  let queued = 0
  if (reminderWrites) {
    for (const candidate of candidates.slice(0, limit)) {
      const emails = await adminRecipientEmails({ connection, organizationId: candidate.organizationId })
      recipients += emails.length
      for (const to of emails) {
        if (await queueReminder({
          ...candidate,
          occurrence: new Date(candidate.date).toISOString().slice(0, 10),
          to,
          encryptionKey,
          clientAppUrl,
          outboxModel: models.OutboxEvent,
        })) queued += 1
      }
    }
  }

  return {
    inspected: delinquentAccounts.length + expiringOffers.length + endingPilots.length + renewals.length,
    access_restricted: accessRestricted,
    offers_expired: offersExpired,
    pilots_expired: pilotsExpired,
    reminder_candidates: candidates.length,
    recipients,
    queued,
    write,
    reminder_writes: reminderWrites,
  }
}

module.exports = {
  adminRecipientEmails,
  billingMessage,
  daysUntil,
  reminderMilestone,
  sweepBillingLifecycle,
}
