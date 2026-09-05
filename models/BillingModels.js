const { Schema, model, models } = require('mongoose')

const PLAN_CODES = ['starter', 'team', 'professional', 'business', 'business_plus', 'enterprise']
const CURRENCIES = ['usd']

const createPriceSnapshotSchema = () => new Schema({
  catalog_version: { type: String, required: true, trim: true, maxlength: 80 },
  plan_code: { type: String, required: true, enum: PLAN_CODES },
  plan_name: { type: String, required: true, trim: true, maxlength: 120 },
  currency: { type: String, required: true, enum: CURRENCIES },
  interval: { type: String, required: true, enum: ['year'] },
  annual_amount_cents: { type: Number, default: null, min: 0 },
  participating_oem_seat_limit: { type: Number, default: null, min: 1 },
  participating_oem_seat_minimum: { type: Number, default: null, min: 1 },
  view_only_oem_seat_limit: { type: Number, default: null, min: 0 },
  supplier_seat_limit: { type: Number, default: null, min: 0 },
}, { _id: false })

const createBillingPlanSchema = () => {
  const schema = new Schema({
    catalog_version: { type: String, required: true, trim: true, maxlength: 80 },
    code: { type: String, required: true, enum: PLAN_CODES },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    currency: { type: String, required: true, enum: CURRENCIES, default: 'usd' },
    interval: { type: String, required: true, enum: ['year'], default: 'year' },
    annual_amount_cents: { type: Number, default: null, min: 0 },
    participating_oem_seat_limit: { type: Number, default: null, min: 1 },
    participating_oem_seat_minimum: { type: Number, default: null, min: 1 },
    view_only_oem_seat_limit: { type: Number, default: null, min: 0 },
    supplier_seat_limit: { type: Number, default: null, min: 0 },
    pilot_eligible: { type: Boolean, required: true, default: false },
    pilot_duration_days: { type: Number, default: null, min: 1 },
    pilot_fee_cents: { type: Number, default: null, min: 0 },
    pilot_conversion_credit_cents: { type: Number, default: null, min: 0 },
    self_service: { type: Boolean, required: true, default: false },
    provider_price_id: { type: String, trim: true, maxlength: 320, default: null, select: false },
    active: { type: Boolean, required: true, default: true, index: true },
    published_at: { type: Date, default: null },
    retired_at: { type: Date, default: null },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updated_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  }, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    optimisticConcurrency: true,
  })
  schema.index({ catalog_version: 1, code: 1 }, { unique: true })
  schema.index({ active: 1, code: 1 })
  return schema
}

const createBillingAccountSchema = () => {
  const schema = new Schema({
    organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, unique: true },
    provider: { type: String, enum: ['disabled', 'fake', 'stripe'], required: true, default: 'disabled' },
    provider_customer_id: { type: String, trim: true, maxlength: 320, default: undefined, select: false },
    billing_name: { type: String, trim: true, maxlength: 180, default: '' },
    billing_email: { type: String, trim: true, lowercase: true, maxlength: 320, default: '' },
    status: { type: String, enum: ['unconfigured', 'active', 'delinquent', 'suspended', 'closed'], default: 'unconfigured', required: true, index: true },
    access_mode: { type: String, enum: ['full', 'grace', 'read_only'], default: 'full', required: true, index: true },
    grace_ends_at: { type: Date, default: null, index: true },
    delinquent_since: { type: Date, default: null },
    last_provider_sync_at: { type: Date, default: null },
    provider_metadata: { type: Schema.Types.Mixed, default: undefined, select: false },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updated_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  }, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    optimisticConcurrency: true,
  })
  schema.index({ provider: 1, provider_customer_id: 1 }, { unique: true, sparse: true })
  schema.index({ status: 1, grace_ends_at: 1 })
  return schema
}

const createBillingSubscriptionSchema = () => {
  const schema = new Schema({
    organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    billing_account: { type: Schema.Types.ObjectId, ref: 'BillingAccount', required: true, index: true },
    provider: { type: String, enum: ['disabled', 'fake', 'stripe'], required: true, default: 'disabled' },
    provider_subscription_id: { type: String, trim: true, maxlength: 320, default: undefined, select: false },
    provider_subscription_item_id: { type: String, trim: true, maxlength: 320, default: null, select: false },
    provider_schedule_id: { type: String, trim: true, maxlength: 320, default: null, select: false },
    provider_price_id: { type: String, trim: true, maxlength: 320, default: null, select: false },
    status: {
      type: String,
      enum: ['pending', 'trialing', 'active', 'past_due', 'unpaid', 'paused', 'canceled', 'expired'],
      default: 'pending',
      required: true,
      index: true,
    },
    current: { type: Boolean, required: true, default: true, select: false },
    price_snapshot: { type: createPriceSnapshotSchema(), required: true },
    pilot_offer: { type: Schema.Types.ObjectId, ref: 'BillingPilotOffer', default: null },
    current_period_start: { type: Date, default: null },
    current_period_end: { type: Date, default: null, index: true },
    cancel_at_period_end: { type: Boolean, required: true, default: false },
    canceled_at: { type: Date, default: null },
    ended_at: { type: Date, default: null },
    scheduled_plan_code: { type: String, enum: PLAN_CODES, default: null },
    scheduled_change_at: { type: Date, default: null },
    last_provider_sync_at: { type: Date, default: null },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updated_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  }, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    optimisticConcurrency: true,
  })
  schema.index({ provider: 1, provider_subscription_id: 1 }, { unique: true, sparse: true })
  schema.index({ organization: 1 }, { unique: true, partialFilterExpression: { current: true } })
  schema.index({ status: 1, current_period_end: 1 })
  return schema
}

const createBillingPilotOfferSchema = () => {
  const schema = new Schema({
    organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    offer_code: { type: String, required: true, trim: true, uppercase: true, maxlength: 80 },
    status: { type: String, enum: ['draft', 'sent', 'accepted', 'active', 'expired', 'converted', 'canceled'], default: 'draft', required: true, index: true },
    price_snapshot: { type: createPriceSnapshotSchema(), required: true },
    duration_days: { type: Number, required: true, min: 1, max: 366 },
    fee_cents: { type: Number, default: null, min: 0 },
    conversion_credit_cents: { type: Number, default: null, min: 0 },
    currency: { type: String, required: true, enum: CURRENCIES, default: 'usd' },
    expires_at: { type: Date, required: true, index: true },
    accepted_at: { type: Date, default: null },
    starts_at: { type: Date, default: null },
    ends_at: { type: Date, default: null, index: true },
    converted_at: { type: Date, default: null },
    provider_checkout_session_id: { type: String, trim: true, maxlength: 320, default: null, select: false },
    terms_snapshot: { type: Schema.Types.Mixed, required: true, default: () => ({}) },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updated_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  }, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    optimisticConcurrency: true,
  })
  schema.index({ offer_code: 1 }, { unique: true })
  schema.index({ organization: 1, status: 1, created_at: -1 })
  return schema
}

const createBillingInvoiceSchema = () => {
  const schema = new Schema({
    organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    billing_account: { type: Schema.Types.ObjectId, ref: 'BillingAccount', required: true, index: true },
    subscription: { type: Schema.Types.ObjectId, ref: 'BillingSubscription', default: null, index: true },
    provider_invoice_id: { type: String, required: true, trim: true, maxlength: 320 },
    number: { type: String, trim: true, maxlength: 120, default: '' },
    status: { type: String, enum: ['draft', 'open', 'paid', 'void', 'uncollectible'], required: true, index: true },
    currency: { type: String, required: true, enum: CURRENCIES, default: 'usd' },
    subtotal_cents: { type: Number, required: true, min: 0, default: 0 },
    discount_cents: { type: Number, required: true, min: 0, default: 0 },
    tax_cents: { type: Number, required: true, min: 0, default: 0 },
    total_cents: { type: Number, required: true, min: 0, default: 0 },
    amount_due_cents: { type: Number, required: true, min: 0, default: 0 },
    amount_paid_cents: { type: Number, required: true, min: 0, default: 0 },
    hosted_invoice_url: { type: String, trim: true, maxlength: 1200, default: null },
    invoice_pdf_url: { type: String, trim: true, maxlength: 1200, default: null },
    issued_at: { type: Date, default: null },
    due_at: { type: Date, default: null },
    paid_at: { type: Date, default: null },
    period_start: { type: Date, default: null },
    period_end: { type: Date, default: null },
    last_provider_sync_at: { type: Date, default: null },
  }, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    optimisticConcurrency: true,
  })
  schema.index({ provider_invoice_id: 1 }, { unique: true })
  schema.index({ organization: 1, created_at: -1 })
  schema.index({ status: 1, due_at: 1 })
  return schema
}

const createBillingPaymentMethodSchema = () => {
  const schema = new Schema({
    organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    billing_account: { type: Schema.Types.ObjectId, ref: 'BillingAccount', required: true, index: true },
    provider_payment_method_id: { type: String, required: true, trim: true, maxlength: 320, select: false },
    type: { type: String, enum: ['card', 'us_bank_account', 'other'], required: true },
    brand: { type: String, trim: true, maxlength: 80, default: '' },
    last4: { type: String, trim: true, maxlength: 4, default: '' },
    expiry_month: { type: Number, min: 1, max: 12, default: null },
    expiry_year: { type: Number, min: 2000, max: 9999, default: null },
    bank_name: { type: String, trim: true, maxlength: 160, default: '' },
    is_default: { type: Boolean, required: true, default: false },
    removed_at: { type: Date, default: null },
    last_provider_sync_at: { type: Date, default: null },
  }, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    optimisticConcurrency: true,
  })
  schema.index({ provider_payment_method_id: 1 }, { unique: true })
  schema.index({ billing_account: 1, removed_at: 1, is_default: -1 })
  return schema
}

const createBillingWebhookEventSchema = () => {
  const schema = new Schema({
    provider: { type: String, enum: ['stripe'], required: true, default: 'stripe' },
    provider_event_id: { type: String, required: true, trim: true, maxlength: 320 },
    event_type: { type: String, required: true, trim: true, maxlength: 180, index: true },
    provider_created_at: { type: Date, required: true },
    livemode: { type: Boolean, required: true, default: false },
    api_version: { type: String, trim: true, maxlength: 80, default: '' },
    object_id: { type: String, trim: true, maxlength: 320, default: '' },
    organization: { type: Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    billing_account: { type: Schema.Types.ObjectId, ref: 'BillingAccount', default: null },
    status: { type: String, enum: ['received', 'processing', 'processed', 'ignored', 'failed'], default: 'received', required: true, index: true },
    attempts: { type: Number, required: true, default: 0, min: 0 },
    processed_at: { type: Date, default: null },
    last_attempt_at: { type: Date, default: null },
    last_error_code: { type: String, trim: true, maxlength: 120, default: '' },
    last_safe_error: { type: String, trim: true, maxlength: 1000, default: '' },
    data_payload: { type: Schema.Types.Mixed, required: true, default: () => ({}), select: false },
  }, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    optimisticConcurrency: true,
  })
  schema.index({ provider: 1, provider_event_id: 1 }, { unique: true })
  schema.index({ status: 1, created_at: 1 })
  return schema
}

const createBillingOperationSchema = () => {
  const schema = new Schema({
    organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    billing_account: { type: Schema.Types.ObjectId, ref: 'BillingAccount', default: null },
    operation_type: {
      type: String,
      enum: ['checkout', 'portal', 'upgrade', 'downgrade', 'cancel', 'resume', 'pilot_checkout', 'support_sync'],
      required: true,
      index: true,
    },
    idempotency_key: { type: String, required: true, trim: true, maxlength: 240 },
    request_fingerprint: { type: String, required: true, trim: true, maxlength: 128 },
    status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending', required: true, index: true },
    provider_object_id: { type: String, trim: true, maxlength: 320, default: null, select: false },
    redirect_url: { type: String, trim: true, maxlength: 1200, default: null, select: false },
    redirect_expires_at: { type: Date, default: null },
    result_snapshot: { type: Schema.Types.Mixed, default: undefined },
    last_error_code: { type: String, trim: true, maxlength: 120, default: '' },
    last_safe_error: { type: String, trim: true, maxlength: 1000, default: '' },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  }, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    optimisticConcurrency: true,
  })
  schema.index({ idempotency_key: 1 }, { unique: true })
  schema.index({ organization: 1, created_at: -1 })
  return schema
}

const BillingPlan = models.BillingPlan || model('BillingPlan', createBillingPlanSchema())
const BillingAccount = models.BillingAccount || model('BillingAccount', createBillingAccountSchema())
const BillingSubscription = models.BillingSubscription || model('BillingSubscription', createBillingSubscriptionSchema())
const BillingPilotOffer = models.BillingPilotOffer || model('BillingPilotOffer', createBillingPilotOfferSchema())
const BillingInvoice = models.BillingInvoice || model('BillingInvoice', createBillingInvoiceSchema())
const BillingPaymentMethod = models.BillingPaymentMethod || model('BillingPaymentMethod', createBillingPaymentMethodSchema())
const BillingWebhookEvent = models.BillingWebhookEvent || model('BillingWebhookEvent', createBillingWebhookEventSchema())
const BillingOperation = models.BillingOperation || model('BillingOperation', createBillingOperationSchema())

module.exports = {
  PLAN_CODES,
  BillingAccount,
  BillingInvoice,
  BillingOperation,
  BillingPaymentMethod,
  BillingPilotOffer,
  BillingPlan,
  BillingSubscription,
  BillingWebhookEvent,
  createBillingAccountSchema,
  createBillingInvoiceSchema,
  createBillingOperationSchema,
  createBillingPaymentMethodSchema,
  createBillingPilotOfferSchema,
  createBillingPlanSchema,
  createBillingSubscriptionSchema,
  createBillingWebhookEventSchema,
  createPriceSnapshotSchema,
}
