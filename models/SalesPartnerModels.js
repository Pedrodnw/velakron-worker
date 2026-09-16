const { Schema, model, models } = require('mongoose')

const SALES_PARTNER_AGREEMENT_VERSION = '2026-09-16'
const SALES_PARTNER_EARLY_ACCESS_FEE_CENTS = 50000
const SALES_PARTNER_ANNUAL_SUBSCRIPTION_FEE_CENTS = 100000
const SALES_PARTNER_AGREEMENT = Object.freeze({
  version: SALES_PARTNER_AGREEMENT_VERSION,
  title: 'Velakron Sales Partner Agreement',
  summary: 'Finder’s fee, referral attribution, reporting, and payout terms for approved Velakron Sales Partners.',
  sections: Object.freeze([
    Object.freeze({
      title: 'Appointment and permitted promotion',
      body: 'Velakron appoints the Sales Partner on a non-exclusive basis to introduce prospective customers using referral links issued in the partner portal. The Sales Partner may not make commitments, warranties, discounts, or representations on behalf of Velakron.',
    }),
    Object.freeze({
      title: 'Referral attribution',
      body: 'A referral is attributed to the team member identified by the active referral link used when the prospect submits the Velakron demo form. Velakron records the attribution in its CRM and may reject duplicate, fraudulent, self-referred, or previously active customer referrals.',
    }),
    Object.freeze({
      title: 'Finder’s fees',
      body: 'For an eligible attributed customer, the Sales Partner earns a one-time $500 USD finder’s fee after Velakron successfully collects the customer’s Early Access payment. The Sales Partner earns an additional one-time $1,000 USD finder’s fee if that same customer later begins a prepaid annual Velakron subscription and Velakron successfully collects its first annual subscription payment. Each fee is earned only once per referred customer. Refunded, reversed, disputed, fraudulent, self-referred, duplicate, or uncollected payments are not eligible and may reverse the related fee.',
    }),
    Object.freeze({
      title: 'Monthly reporting and payment',
      body: 'Velakron will provide a monthly statement showing each eligible Early Access or annual-subscription milestone and the finder’s fee credited to each Sales Partner team member. Approved finder’s fees are paid to the Sales Partner entity as one bundled ACH payment using the verified payout method on file. The Sales Partner is responsible for distributing compensation to its team.',
    }),
    Object.freeze({
      title: 'Team and link administration',
      body: 'The Sales Partner is responsible for keeping its team roster current, disabling links that should no longer be used, protecting portal access, and ensuring each link is used only by the team member to whom it is assigned.',
    }),
    Object.freeze({
      title: 'Compliance and conduct',
      body: 'The Sales Partner will comply with applicable anti-bribery, privacy, marketing, tax, and sanctions laws. The Sales Partner will not use misleading, coercive, deceptive, or unlawful sales practices or submit personal data without authority.',
    }),
    Object.freeze({
      title: 'Term and suspension',
      body: 'Either party may end the relationship according to the separately agreed commercial notice terms. Velakron may suspend portal access, referral links, or unpaid finder’s fees while investigating suspected fraud, misuse, legal risk, or a material breach.',
    }),
    Object.freeze({
      title: 'Electronic signature',
      body: 'The signer confirms authority to bind the Sales Partner and agrees that entering their legal name and selecting the signature confirmations constitutes an electronic signature of this agreement.',
    }),
  ]),
})

const payoutSchema = new Schema({
  method: { type: String, enum: ['ach'], default: 'ach', required: true },
  status: {
    type: String,
    enum: ['unconfigured', 'pending_review', 'verified', 'rejected'],
    default: 'unconfigured',
    required: true,
    index: true,
  },
  account_holder_name: { type: String, trim: true, maxlength: 180, default: '' },
  bank_name: { type: String, trim: true, maxlength: 180, default: '' },
  account_last4: { type: String, trim: true, match: /^\d{4}$/, default: undefined },
  payout_contact_email: { type: String, trim: true, lowercase: true, maxlength: 320, default: '' },
  provider: { type: String, trim: true, maxlength: 80, default: 'manual' },
  provider_recipient_id: { type: String, trim: true, maxlength: 320, default: undefined, select: false },
  submitted_at: { type: Date, default: null },
  verified_at: { type: Date, default: null },
  verified_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  rejection_reason: { type: String, trim: true, maxlength: 500, default: '', select: false },
}, { _id: false })

const createSalesPartnerProfileSchema = () => {
  const schema = new Schema({
    organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, unique: true },
    status: {
      type: String,
      enum: ['pending_agreement', 'active', 'suspended', 'terminated'],
      default: 'pending_agreement',
      required: true,
      index: true,
    },
    early_access_finder_fee_cents: { type: Number, min: 0, default: SALES_PARTNER_EARLY_ACCESS_FEE_CENTS, required: true },
    annual_subscription_finder_fee_cents: { type: Number, min: 0, default: SALES_PARTNER_ANNUAL_SUBSCRIPTION_FEE_CENTS, required: true },
    agreement_version: { type: String, trim: true, maxlength: 80, default: SALES_PARTNER_AGREEMENT_VERSION },
    agreement_acceptance: { type: Schema.Types.ObjectId, ref: 'SalesPartnerAgreementAcceptance', default: null },
    agreement_accepted_at: { type: Date, default: null },
    payout: { type: payoutSchema, default: () => ({}) },
    activated_at: { type: Date, default: null },
    suspended_at: { type: Date, default: null },
    suspension_reason: { type: String, trim: true, maxlength: 500, default: '' },
    terminated_at: { type: Date, default: null },
    termination_reason: { type: String, trim: true, maxlength: 500, default: '' },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updated_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  }, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    optimisticConcurrency: true,
  })
  schema.index({ status: 1, updated_at: -1 })
  schema.index({ 'payout.status': 1, status: 1 })
  schema.set('toJSON', {
    getters: true,
    virtuals: true,
    transform: (_document, value) => {
      value.version = value.__v
      delete value.__v
      if (value.payout) {
        delete value.payout.provider_recipient_id
        delete value.payout.rejection_reason
      }
      return value
    },
  })
  return schema
}

const createSalesPartnerAgreementAcceptanceSchema = () => {
  const schema = new Schema({
    partner_organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    profile: { type: Schema.Types.ObjectId, ref: 'SalesPartnerProfile', required: true, index: true },
    agreement_version: { type: String, required: true, trim: true, maxlength: 80 },
    agreement_title: { type: String, required: true, trim: true, maxlength: 180 },
    terms_hash: { type: String, required: true, trim: true, maxlength: 128 },
    terms_snapshot: { type: String, required: true, maxlength: 30000, select: false },
    signer_user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    signer_membership: { type: Schema.Types.ObjectId, ref: 'OrganizationMembership', required: true },
    signer_name: { type: String, required: true, trim: true, maxlength: 180 },
    signer_title: { type: String, required: true, trim: true, maxlength: 180 },
    signer_email: { type: String, required: true, trim: true, lowercase: true, maxlength: 320 },
    authority_confirmed: { type: Boolean, required: true },
    signature_intent_confirmed: { type: Boolean, required: true },
    ip_address: { type: String, trim: true, maxlength: 120, default: '' },
    user_agent: { type: String, trim: true, maxlength: 1000, default: '' },
    accepted_at: { type: Date, required: true, default: Date.now },
  }, {
    timestamps: { createdAt: 'created_at', updatedAt: false },
  })
  schema.index({ partner_organization: 1, agreement_version: 1 }, { unique: true })
  return schema
}

const createSalesPartnerMemberSchema = () => {
  const schema = new Schema({
    partner_organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    first_name: { type: String, required: true, trim: true, maxlength: 80 },
    last_name: { type: String, trim: true, maxlength: 80, default: '' },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 320 },
    external_reference: { type: String, trim: true, maxlength: 120, default: '' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', required: true, index: true },
    joined_at: { type: Date, default: Date.now },
    deactivated_at: { type: Date, default: null },
    deactivated_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deactivation_reason: { type: String, trim: true, maxlength: 500, default: '' },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updated_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  }, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    optimisticConcurrency: true,
  })
  schema.index({ partner_organization: 1, email: 1 }, { unique: true })
  schema.index({ partner_organization: 1, status: 1, last_name: 1, first_name: 1 })
  schema.set('toJSON', {
    getters: true,
    virtuals: true,
    transform: (_document, value) => {
      value.full_name = [value.first_name, value.last_name].filter(Boolean).join(' ')
      value.version = value.__v
      delete value.__v
      return value
    },
  })
  return schema
}

const createSalesPartnerReferralLinkSchema = () => {
  const schema = new Schema({
    partner_organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    member: { type: Schema.Types.ObjectId, ref: 'SalesPartnerMember', required: true, index: true },
    code: { type: String, required: true, unique: true, trim: true, maxlength: 80 },
    label: { type: String, trim: true, maxlength: 120, default: '' },
    destination_path: { type: String, enum: ['/request-demo'], default: '/request-demo', required: true },
    status: { type: String, enum: ['active', 'disabled'], default: 'active', required: true, index: true },
    visit_count: { type: Number, min: 0, default: 0 },
    submission_count: { type: Number, min: 0, default: 0 },
    last_visited_at: { type: Date, default: null },
    last_submitted_at: { type: Date, default: null },
    disabled_at: { type: Date, default: null },
    disabled_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    disabled_reason: { type: String, trim: true, maxlength: 500, default: '' },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updated_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  }, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    optimisticConcurrency: true,
  })
  schema.index({ partner_organization: 1, member: 1, status: 1, created_at: -1 })
  schema.set('toJSON', { getters: true, virtuals: true })
  return schema
}

const createSalesPartnerAttributionSchema = () => {
  const schema = new Schema({
    partner_organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    member: { type: Schema.Types.ObjectId, ref: 'SalesPartnerMember', required: true, index: true },
    referral_link: { type: Schema.Types.ObjectId, ref: 'SalesPartnerReferralLink', required: true, index: true },
    request_id: { type: String, required: true, unique: true, trim: true, maxlength: 120 },
    early_access_finder_fee_cents: { type: Number, min: 0, default: SALES_PARTNER_EARLY_ACCESS_FEE_CENTS, required: true },
    annual_subscription_finder_fee_cents: { type: Number, min: 0, default: SALES_PARTNER_ANNUAL_SUBSCRIPTION_FEE_CENTS, required: true },
    prospect_company_name: { type: String, required: true, trim: true, maxlength: 180 },
    prospect_email: { type: String, required: true, trim: true, lowercase: true, maxlength: 320, select: false },
    crm_organization: { type: Schema.Types.ObjectId, ref: 'CrmOrganization', required: true, index: true },
    crm_contact: { type: Schema.Types.ObjectId, ref: 'CrmContact', required: true },
    crm_opportunity: { type: Schema.Types.ObjectId, ref: 'CrmOpportunity', required: true, index: true },
    customer_organization: { type: Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    subscription: { type: Schema.Types.ObjectId, ref: 'BillingSubscription', default: null },
    status: { type: String, enum: ['lead', 'early_access', 'converted', 'disqualified'], default: 'lead', required: true, index: true },
    early_access_at: { type: Date, default: null },
    converted_at: { type: Date, default: null },
    disqualified_at: { type: Date, default: null },
    disqualified_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    disqualification_reason: { type: String, trim: true, maxlength: 500, default: '' },
  }, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    optimisticConcurrency: true,
  })
  schema.index({ crm_organization: 1, status: 1, created_at: 1 })
  schema.index({ partner_organization: 1, created_at: -1 })
  return schema
}

const createSalesPartnerCommissionSchema = () => {
  const schema = new Schema({
    partner_organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    member: { type: Schema.Types.ObjectId, ref: 'SalesPartnerMember', required: true, index: true },
    attribution: { type: Schema.Types.ObjectId, ref: 'SalesPartnerAttribution', required: true, index: true },
    customer_organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    subscription: { type: Schema.Types.ObjectId, ref: 'BillingSubscription', default: null },
    earning_type: { type: String, enum: ['early_access', 'annual_subscription'], required: true, index: true },
    pilot_offer: { type: Schema.Types.ObjectId, ref: 'BillingPilotOffer', default: null },
    billing_invoice: { type: Schema.Types.ObjectId, ref: 'BillingInvoice', default: undefined },
    provider_checkout_session_id: { type: String, trim: true, maxlength: 320, default: undefined, select: false },
    provider_payment_intent_id: { type: String, trim: true, maxlength: 320, default: undefined, select: false },
    earning_month: { type: String, required: true, match: /^\d{4}-\d{2}$/, index: true },
    earned_at: { type: Date, required: true, index: true },
    source_amount_cents: { type: Number, min: 0, required: true },
    commission_amount_cents: { type: Number, min: 0, required: true },
    currency: { type: String, enum: ['usd'], default: 'usd', required: true },
    status: { type: String, enum: ['accrued', 'approved', 'paid', 'reversed'], default: 'accrued', required: true, index: true },
    statement: { type: Schema.Types.ObjectId, ref: 'SalesPartnerStatement', default: null, index: true },
    approved_at: { type: Date, default: null },
    approved_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    paid_at: { type: Date, default: null },
    reversed_at: { type: Date, default: null },
    reversal_reason: { type: String, trim: true, maxlength: 500, default: '' },
  }, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    optimisticConcurrency: true,
  })
  schema.index({ attribution: 1, earning_type: 1 }, { unique: true })
  schema.index({ billing_invoice: 1 }, { unique: true, sparse: true })
  schema.index({ provider_checkout_session_id: 1 }, { unique: true, sparse: true })
  schema.index({ partner_organization: 1, earning_month: 1, status: 1 })
  schema.index({ partner_organization: 1, member: 1, earned_at: -1 })
  return schema
}

const memberBreakdownSchema = new Schema({
  member: { type: Schema.Types.ObjectId, ref: 'SalesPartnerMember', required: true },
  member_name: { type: String, required: true, trim: true, maxlength: 180 },
  member_email: { type: String, required: true, trim: true, lowercase: true, maxlength: 320 },
  sales_count: { type: Number, min: 0, required: true },
  collected_revenue_cents: { type: Number, min: 0, required: true },
  commission_amount_cents: { type: Number, min: 0, required: true },
}, { _id: false })

const createSalesPartnerStatementSchema = () => {
  const schema = new Schema({
    partner_organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    period_key: { type: String, required: true, match: /^\d{4}-\d{2}$/, index: true },
    period_start: { type: Date, required: true },
    period_end: { type: Date, required: true },
    currency: { type: String, enum: ['usd'], default: 'usd', required: true },
    status: { type: String, enum: ['draft', 'finalized', 'paid', 'void'], default: 'draft', required: true, index: true },
    sales_count: { type: Number, min: 0, default: 0 },
    collected_revenue_cents: { type: Number, min: 0, default: 0 },
    commission_amount_cents: { type: Number, min: 0, default: 0 },
    member_breakdown: { type: [memberBreakdownSchema], default: () => [] },
    finalized_at: { type: Date, default: null },
    finalized_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    paid_at: { type: Date, default: null },
    paid_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    payout_reference: { type: String, trim: true, maxlength: 200, default: '' },
    ach_trace_number: { type: String, trim: true, maxlength: 200, default: '', select: false },
    voided_at: { type: Date, default: null },
    voided_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    void_reason: { type: String, trim: true, maxlength: 500, default: '' },
  }, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    optimisticConcurrency: true,
  })
  schema.index({ partner_organization: 1, period_key: 1 }, { unique: true })
  schema.index({ status: 1, period_end: 1 })
  return schema
}

const SalesPartnerProfile = models.SalesPartnerProfile
  || model('SalesPartnerProfile', createSalesPartnerProfileSchema())
const SalesPartnerAgreementAcceptance = models.SalesPartnerAgreementAcceptance
  || model('SalesPartnerAgreementAcceptance', createSalesPartnerAgreementAcceptanceSchema())
const SalesPartnerMember = models.SalesPartnerMember
  || model('SalesPartnerMember', createSalesPartnerMemberSchema())
const SalesPartnerReferralLink = models.SalesPartnerReferralLink
  || model('SalesPartnerReferralLink', createSalesPartnerReferralLinkSchema())
const SalesPartnerAttribution = models.SalesPartnerAttribution
  || model('SalesPartnerAttribution', createSalesPartnerAttributionSchema())
const SalesPartnerCommission = models.SalesPartnerCommission
  || model('SalesPartnerCommission', createSalesPartnerCommissionSchema())
const SalesPartnerStatement = models.SalesPartnerStatement
  || model('SalesPartnerStatement', createSalesPartnerStatementSchema())

module.exports = {
  SALES_PARTNER_AGREEMENT,
  SALES_PARTNER_AGREEMENT_VERSION,
  SALES_PARTNER_ANNUAL_SUBSCRIPTION_FEE_CENTS,
  SALES_PARTNER_EARLY_ACCESS_FEE_CENTS,
  SalesPartnerProfile,
  SalesPartnerAgreementAcceptance,
  SalesPartnerMember,
  SalesPartnerReferralLink,
  SalesPartnerAttribution,
  SalesPartnerCommission,
  SalesPartnerStatement,
  createSalesPartnerProfileSchema,
  createSalesPartnerAgreementAcceptanceSchema,
  createSalesPartnerMemberSchema,
  createSalesPartnerReferralLinkSchema,
  createSalesPartnerAttributionSchema,
  createSalesPartnerCommissionSchema,
  createSalesPartnerStatementSchema,
}
