const mongoose = require('mongoose')
const {
  BillingAccount,
  BillingInvoice,
  BillingPaymentMethod,
  BillingPilotOffer,
  BillingPlan,
  BillingSubscription,
  BillingWebhookEvent,
} = require('../models/BillingModels')

const DAY = 24 * 60 * 60 * 1000
const supportedEventTypes = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.finalized',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.voided',
  'payment_method.attached',
  'payment_method.updated',
  'payment_method.detached',
])

const stripeDate = value => Number.isFinite(Number(value)) && Number(value) > 0
  ? new Date(Number(value) * 1000)
  : null

const normalizeSubscriptionStatus = value => ({
  incomplete: 'pending',
  incomplete_expired: 'expired',
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  unpaid: 'unpaid',
  paused: 'paused',
  canceled: 'canceled',
}[String(value || '')] || 'pending')

const validObjectId = value => value && mongoose.Types.ObjectId.isValid(String(value))
const providerId = value => typeof value === 'string' ? value : value?.id || ''

const planCodeFrom = object => String(
  object?.metadata?.velakron_plan_code
  || object?.subscription_details?.metadata?.velakron_plan_code
  || '',
).trim().toLowerCase()

const organizationIdFrom = object => {
  const value = object?.metadata?.velakron_organization_id || object?.client_reference_id
  return validObjectId(value) ? String(value) : null
}

const invoiceProjection = (invoice, {
  organizationId,
  accountId,
  subscriptionId,
  providerSubscriptionId,
}) => ({
  organization: organizationId,
  billing_account: accountId,
  subscription: subscriptionId || null,
  provider_subscription_id: providerSubscriptionId || null,
  provider_invoice_id: invoice.id,
  number: String(invoice.number || ''),
  status: ['draft', 'open', 'paid', 'void', 'uncollectible'].includes(invoice.status) ? invoice.status : 'open',
  currency: String(invoice.currency || 'usd').toLowerCase(),
  subtotal_cents: Math.max(0, Number(invoice.subtotal || 0)),
  discount_cents: Math.max(0, Number(invoice.total_discount_amounts?.reduce((sum, item) => sum + Number(item.amount || 0), 0) || 0)),
  tax_cents: Math.max(0, Number(invoice.total_taxes?.reduce((sum, item) => sum + Number(item.amount || 0), 0) || invoice.tax || 0)),
  total_cents: Math.max(0, Number(invoice.total || 0)),
  amount_due_cents: Math.max(0, Number(invoice.amount_due || 0)),
  amount_paid_cents: Math.max(0, Number(invoice.amount_paid || 0)),
  hosted_invoice_url: invoice.hosted_invoice_url || null,
  invoice_pdf_url: invoice.invoice_pdf || null,
  issued_at: stripeDate(invoice.created),
  due_at: stripeDate(invoice.due_date),
  paid_at: stripeDate(invoice.status_transitions?.paid_at),
  period_start: stripeDate(invoice.period_start),
  period_end: stripeDate(invoice.period_end),
  last_provider_sync_at: new Date(),
})

const paymentMethodProjection = (method, { organizationId, accountId, isDefault = false }) => {
  const details = method.card || method.us_bank_account || {}
  return {
    organization: organizationId,
    billing_account: accountId,
    provider_payment_method_id: method.id,
    type: ['card', 'us_bank_account'].includes(method.type) ? method.type : 'other',
    brand: String(details.brand || details.networks?.preferred || ''),
    last4: String(details.last4 || '').slice(-4),
    expiry_month: details.exp_month || null,
    expiry_year: details.exp_year || null,
    bank_name: String(details.bank_name || ''),
    is_default: isDefault,
    removed_at: null,
    last_provider_sync_at: new Date(),
  }
}

const accountForObject = async (object, models) => {
  const customerId = providerId(object?.customer)
  const organizationId = organizationIdFrom(object)
  const account = organizationId
    ? await models.BillingAccount.findOne({ organization: organizationId }).select('+provider_customer_id +provider_metadata')
    : customerId
      ? await models.BillingAccount.findOne({ provider: 'stripe', provider_customer_id: customerId }).select('+provider_customer_id +provider_metadata')
      : null
  if (!account) throw Object.assign(new Error('Billing account could not be matched safely'), { code: 'BILLING_ACCOUNT_NOT_FOUND' })
  if (customerId && !account.provider_customer_id) account.provider_customer_id = customerId
  account.provider = 'stripe'
  account.last_provider_sync_at = new Date()
  return account
}

const priceSnapshot = plan => ({
  catalog_version: plan.catalog_version,
  plan_code: plan.code,
  plan_name: plan.name,
  currency: plan.currency,
  interval: plan.interval,
  annual_amount_cents: plan.annual_amount_cents,
  participating_oem_seat_limit: plan.participating_oem_seat_limit,
  participating_oem_seat_minimum: plan.participating_oem_seat_minimum,
  view_only_oem_seat_limit: plan.view_only_oem_seat_limit,
  supplier_seat_limit: plan.supplier_seat_limit,
})

const planForObject = async (object, models) => {
  const item = object?.items?.data?.[0]
  const code = planCodeFrom(object)
  const priceId = providerId(item?.price) || providerId(object?.lines?.data?.[0]?.price)
  const plan = code
    ? await models.BillingPlan.findOne({ code, active: true }).select('+provider_price_id')
    : priceId
      ? await models.BillingPlan.findOne({ provider_price_id: priceId, active: true }).select('+provider_price_id')
      : null
  if (!plan) throw Object.assign(new Error('Billing plan could not be matched safely'), { code: 'BILLING_PLAN_NOT_FOUND' })
  return plan
}

const upsertSubscription = async (object, account, models) => {
  const plan = await planForObject(object, models)
  const subscriptionId = providerId(object.subscription) || (String(object.object || '') === 'subscription' ? object.id : '')
  if (!subscriptionId) throw Object.assign(new Error('Subscription ID is missing'), { code: 'SUBSCRIPTION_ID_MISSING' })
  const item = object?.items?.data?.[0]
  const status = normalizeSubscriptionStatus(object.status || 'active')
  const periodStart = stripeDate(object.current_period_start || item?.current_period_start) || new Date()
  const periodEnd = stripeDate(object.current_period_end || item?.current_period_end) || new Date(periodStart.getTime() + 365 * DAY)
  const subscription = await models.BillingSubscription.findOneAndUpdate(
    { organization: account.organization, current: true },
    {
      $set: {
        organization: account.organization,
        billing_account: account._id,
        provider: 'stripe',
        provider_subscription_id: subscriptionId,
        provider_subscription_item_id: item?.id || undefined,
        provider_price_id: providerId(item?.price) || undefined,
        status,
        current: true,
        price_snapshot: priceSnapshot(plan),
        current_period_start: periodStart,
        current_period_end: periodEnd,
        cancel_at_period_end: Boolean(object.cancel_at_period_end),
        canceled_at: stripeDate(object.canceled_at),
        ended_at: stripeDate(object.ended_at),
        last_provider_sync_at: new Date(),
      },
      $setOnInsert: { created_by: null },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).select('+provider_subscription_id +provider_subscription_item_id +provider_price_id')
  await models.BillingInvoice.updateMany({
    organization: account.organization,
    provider_subscription_id: subscriptionId,
    subscription: null,
  }, { $set: { subscription: subscription._id } })
  const hasDefaultPaymentMethod = Object.prototype.hasOwnProperty.call(object, 'default_payment_method')
  const defaultPaymentMethodId = providerId(object.default_payment_method)
  if (hasDefaultPaymentMethod) {
    const providerMetadata = { ...(account.provider_metadata || {}) }
    if (defaultPaymentMethodId) providerMetadata.default_payment_method_id = defaultPaymentMethodId
    else delete providerMetadata.default_payment_method_id
    account.provider_metadata = Object.keys(providerMetadata).length ? providerMetadata : undefined
    await models.BillingPaymentMethod.updateMany({
      billing_account: account._id,
      removed_at: null,
    }, { $set: { is_default: false } })
    if (defaultPaymentMethodId) {
      await models.BillingPaymentMethod.updateOne({
        billing_account: account._id,
        provider_payment_method_id: defaultPaymentMethodId,
        removed_at: null,
      }, { $set: { is_default: true } })
    }
  }
  account.status = ['past_due', 'unpaid'].includes(status) ? 'delinquent' : status === 'canceled' ? 'closed' : 'active'
  if (!['past_due', 'unpaid'].includes(status)) {
    account.access_mode = 'full'
    account.grace_ends_at = null
    account.delinquent_since = null
  }
  await account.save()
  return subscription
}

const handleCheckout = async (session, models, now) => {
  const account = await accountForObject(session, models)
  if (session.mode === 'subscription') return upsertSubscription(session, account, models)
  const offerCode = String(session.metadata?.velakron_pilot_offer_code || '')
  if (session.mode === 'payment' && offerCode) {
    const offer = await models.BillingPilotOffer.findOne({ organization: account.organization, offer_code: offerCode })
    if (!offer) throw Object.assign(new Error('Pilot offer could not be matched safely'), { code: 'PILOT_OFFER_NOT_FOUND' })
    offer.status = 'active'
    offer.accepted_at = offer.accepted_at || now
    offer.starts_at = offer.starts_at || now
    offer.ends_at = offer.ends_at || new Date(now.getTime() + offer.duration_days * DAY)
    await offer.save()
    account.status = 'active'
    account.access_mode = 'full'
    await account.save()
    return offer
  }
  return null
}

const handleInvoice = async (invoice, eventType, models, now) => {
  const account = await accountForObject(invoice, models)
  const providerSubscriptionId = providerId(invoice.subscription) || providerId(invoice.parent?.subscription_details?.subscription)
  const subscription = providerSubscriptionId
    ? await models.BillingSubscription.findOne({ organization: account.organization, current: true }).select('+provider_subscription_id')
    : null
  await models.BillingInvoice.findOneAndUpdate(
    { provider_invoice_id: invoice.id },
    {
      $set: invoiceProjection(invoice, {
        organizationId: account.organization,
        accountId: account._id,
        subscriptionId: subscription?._id,
        providerSubscriptionId,
      }),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
  if (eventType === 'invoice.payment_failed') {
    account.status = 'delinquent'
    account.access_mode = 'grace'
    account.delinquent_since = account.delinquent_since || now
    account.grace_ends_at = account.grace_ends_at || new Date(now.getTime() + 14 * DAY)
    if (subscription) subscription.status = 'past_due'
  } else if (eventType === 'invoice.paid') {
    account.status = 'active'
    account.access_mode = 'full'
    account.delinquent_since = null
    account.grace_ends_at = null
    if (subscription && subscription.status === 'past_due') subscription.status = 'active'
  }
  await account.save()
  if (subscription?.isModified()) await subscription.save()
  return account
}

const processPayload = async ({ eventType, object, models, now }) => {
  if (!supportedEventTypes.has(eventType)) return 'ignored'
  if (eventType === 'checkout.session.completed') {
    await handleCheckout(object, models, now)
    return 'processed'
  }
  if (eventType.startsWith('customer.subscription.')) {
    const account = await accountForObject(object, models)
    await upsertSubscription(object, account, models)
    return 'processed'
  }
  if (eventType.startsWith('invoice.')) {
    await handleInvoice(object, eventType, models, now)
    return 'processed'
  }
  if (eventType.startsWith('payment_method.')) {
    const account = await accountForObject(object, models)
    if (eventType === 'payment_method.detached') {
      await models.BillingPaymentMethod.updateOne({ provider_payment_method_id: object.id }, { $set: { removed_at: now, is_default: false } })
    } else {
      const isDefault = account.provider_metadata?.default_payment_method_id === object.id
      await models.BillingPaymentMethod.findOneAndUpdate(
        { provider_payment_method_id: object.id },
        {
          $set: paymentMethodProjection(object, {
            organizationId: account.organization,
            accountId: account._id,
            isDefault,
          }),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
    }
    await account.save()
    return 'processed'
  }
  return 'ignored'
}

const createBillingWebhookProcessor = ({
  models = {
    BillingAccount,
    BillingInvoice,
    BillingPaymentMethod,
    BillingPilotOffer,
    BillingPlan,
    BillingSubscription,
    BillingWebhookEvent,
  },
  now = () => new Date(),
  maxAttempts = 8,
} = {}) => {
  const processOne = async () => {
    const current = now()
    const event = await models.BillingWebhookEvent.findOneAndUpdate({
      attempts: mongoose.trusted({ $lt: maxAttempts }),
      $or: [
        { status: mongoose.trusted({ $in: ['received', 'failed'] }) },
        { status: 'processing', last_attempt_at: mongoose.trusted({ $lte: new Date(current.getTime() - 5 * 60 * 1000) }) },
      ],
    }, {
      $set: { status: 'processing', last_attempt_at: current, last_error_code: '', last_safe_error: '' },
      $inc: { attempts: 1 },
    }, { sort: { created_at: 1 }, new: true }).select('+data_payload')
    if (!event) return null
    try {
      const status = await processPayload({ eventType: event.event_type, object: event.data_payload, models, now: current })
      event.status = status
      event.processed_at = current
      await event.save()
      return { event_id: String(event._id), status }
    } catch (error) {
      event.status = 'failed'
      event.last_error_code = String(error?.code || 'BILLING_EVENT_FAILED').slice(0, 120)
      event.last_safe_error = 'Billing event projection could not be completed'
      await event.save()
      return { event_id: String(event._id), status: 'failed', error_code: event.last_error_code }
    }
  }
  const drain = async ({ limit = 25 } = {}) => {
    const outcomes = []
    for (let index = 0; index < limit; index += 1) {
      const outcome = await processOne()
      if (!outcome) break
      outcomes.push(outcome)
    }
    return {
      processed: outcomes.filter(item => item.status === 'processed').length,
      ignored: outcomes.filter(item => item.status === 'ignored').length,
      failed: outcomes.filter(item => item.status === 'failed').length,
      outcomes,
    }
  }
  return { drain, processOne }
}

module.exports = {
  createBillingWebhookProcessor,
  invoiceProjection,
  normalizeSubscriptionStatus,
  paymentMethodProjection,
  processPayload,
  stripeDate,
  supportedEventTypes,
}
