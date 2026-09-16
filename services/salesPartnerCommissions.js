const mongoose = require('mongoose')
const {
  SALES_PARTNER_ANNUAL_SUBSCRIPTION_FEE_CENTS,
  SALES_PARTNER_EARLY_ACCESS_FEE_CENTS,
  SalesPartnerAttribution,
  SalesPartnerCommission,
} = require('../models/SalesPartnerModels')

const earningMonth = date => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
const providerId = value => typeof value === 'string' ? value : value?.id || ''

const crmOrganizationForCustomer = async (customerOrganizationId, models) => {
  if (models.CrmOrganization) {
    return models.CrmOrganization.findOne({
      platform_organization: customerOrganizationId,
      archived_at: null,
    }).sort({ created_at: 1 })
  }
  return mongoose.connection.collection('crmorganizations').findOne({
    platform_organization: new mongoose.Types.ObjectId(String(customerOrganizationId)),
    archived_at: null,
  }, { sort: { created_at: 1 } })
}

const attributionForCustomer = async (customerOrganizationId, models) => {
  const Attribution = models.SalesPartnerAttribution || SalesPartnerAttribution
  const crmOrganization = await crmOrganizationForCustomer(customerOrganizationId, models)
  if (!crmOrganization?._id) return null
  return Attribution.findOne({
    crm_organization: crmOrganization._id,
    status: mongoose.trusted({ $ne: 'disqualified' }),
  }).sort({ created_at: 1, _id: 1 })
}

const upsertFinderFee = async ({ attribution, earningType, values, models }) => {
  const Commission = models.SalesPartnerCommission || SalesPartnerCommission
  const query = { attribution: attribution._id, earning_type: earningType }
  try {
    return await Commission.findOneAndUpdate(
      query,
      { $setOnInsert: values },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    )
  } catch (error) {
    if (error?.code !== 11000 || !Commission.findOne) throw error
    return Commission.findOne(query)
  }
}

const accrueEarlyAccessFinderFee = async ({ session, offer, account, earnedAt = new Date(), models = {} }) => {
  if (
    !session?.id
    || session.mode !== 'payment'
    || session.payment_status !== 'paid'
    || !offer?._id
    || !account?.organization
  ) return null
  const attribution = await attributionForCustomer(account.organization, models)
  if (!attribution) return null
  const commissionAmountCents = Number(
    attribution.early_access_finder_fee_cents ?? SALES_PARTNER_EARLY_ACCESS_FEE_CENTS,
  )
  if (!Number.isInteger(commissionAmountCents) || commissionAmountCents <= 0) return null
  const commission = await upsertFinderFee({
    attribution,
    earningType: 'early_access',
    values: {
      partner_organization: attribution.partner_organization,
      member: attribution.member,
      attribution: attribution._id,
      customer_organization: account.organization,
      pilot_offer: offer._id,
      provider_checkout_session_id: session.id,
      provider_payment_intent_id: providerId(session.payment_intent) || undefined,
      earning_type: 'early_access',
      earning_month: earningMonth(earnedAt),
      earned_at: earnedAt,
      source_amount_cents: Math.max(0, Number(session.amount_total ?? offer.fee_cents ?? 0)),
      commission_amount_cents: commissionAmountCents,
      currency: 'usd',
      status: 'accrued',
    },
    models,
  })
  if (!attribution.early_access_at) attribution.early_access_at = earnedAt
  attribution.customer_organization = account.organization
  if (attribution.status === 'lead') attribution.status = 'early_access'
  await attribution.save()
  return commission
}

const accrueAnnualSubscriptionFinderFee = async ({ invoice, subscription, models = {} }) => {
  const Commission = models.SalesPartnerCommission || SalesPartnerCommission
  if (
    !invoice?._id
    || invoice.status !== 'paid'
    || invoice.currency !== 'usd'
    || !subscription?._id
    || subscription.price_snapshot?.interval !== 'year'
  ) return null
  const sourceAmountCents = Math.max(0, Math.min(
    Number(invoice.amount_paid_cents || 0),
    Math.max(0, Number(invoice.subtotal_cents || 0) - Number(invoice.discount_cents || 0)),
  ))
  if (!sourceAmountCents) return null
  const attribution = await attributionForCustomer(invoice.organization, models)
  if (!attribution) return null
  const earlyAccessFee = await Commission.findOne({
    attribution: attribution._id,
    earning_type: 'early_access',
    status: mongoose.trusted({ $ne: 'reversed' }),
  })
  if (!earlyAccessFee) return null
  const paidAt = invoice.paid_at || new Date()
  const commissionAmountCents = Number(
    attribution.annual_subscription_finder_fee_cents ?? SALES_PARTNER_ANNUAL_SUBSCRIPTION_FEE_CENTS,
  )
  if (!Number.isInteger(commissionAmountCents) || commissionAmountCents <= 0) return null
  const commission = await upsertFinderFee({
    attribution,
    earningType: 'annual_subscription',
    values: {
      partner_organization: attribution.partner_organization,
      member: attribution.member,
      attribution: attribution._id,
      customer_organization: invoice.organization,
      subscription: subscription._id,
      billing_invoice: invoice._id,
      earning_type: 'annual_subscription',
      earning_month: earningMonth(paidAt),
      earned_at: paidAt,
      source_amount_cents: sourceAmountCents,
      commission_amount_cents: commissionAmountCents,
      currency: 'usd',
      status: 'accrued',
    },
    models,
  })
  attribution.status = 'converted'
  attribution.customer_organization = invoice.organization
  attribution.subscription = subscription._id
  attribution.converted_at ||= paidAt
  await attribution.save()
  return commission
}

const reverseSalesPartnerCommission = async ({ invoice, reason, models = {} }) => {
  const Commission = models.SalesPartnerCommission || SalesPartnerCommission
  if (!invoice?._id) return null
  return Commission.findOneAndUpdate(
    { billing_invoice: invoice._id, status: mongoose.trusted({ $in: ['accrued', 'approved'] }) },
    { $set: { status: 'reversed', reversed_at: new Date(), reversal_reason: String(reason || 'Customer invoice was voided').slice(0, 500) } },
    { new: true },
  )
}

const reverseEarlyAccessFinderFee = async ({ paymentIntentId, reason, models = {} }) => {
  const Commission = models.SalesPartnerCommission || SalesPartnerCommission
  if (!paymentIntentId) return null
  return Commission.findOneAndUpdate(
    {
      provider_payment_intent_id: paymentIntentId,
      earning_type: 'early_access',
      status: mongoose.trusted({ $in: ['accrued', 'approved'] }),
    },
    { $set: { status: 'reversed', reversed_at: new Date(), reversal_reason: String(reason || 'Early Access payment was refunded').slice(0, 500) } },
    { new: true },
  )
}

module.exports = {
  accrueAnnualSubscriptionFinderFee,
  accrueEarlyAccessFinderFee,
  attributionForCustomer,
  crmOrganizationForCustomer,
  earningMonth,
  reverseEarlyAccessFinderFee,
  reverseSalesPartnerCommission,
}
