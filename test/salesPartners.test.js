const { expect } = require('chai')
const { createSalesPartnerStatementJob } = require('../jobs/salesPartnerStatements')
const {
  accrueAnnualSubscriptionFinderFee,
  accrueEarlyAccessFinderFee,
  earningMonth,
  reverseSalesPartnerCommission,
} = require('../services/salesPartnerCommissions')
const { periodBounds, previousPeriodKey } = require('../services/salesPartnerStatements')

describe('Sales Partner worker processing', () => {
  it('accrues a one-time $500 finder’s fee after a referred Early Access payment', async () => {
    const calls = []
    const attribution = {
      _id: 'attribution-1',
      partner_organization: 'partner-1',
      member: 'member-1',
      early_access_finder_fee_cents: 50000,
      annual_subscription_finder_fee_cents: 100000,
      status: 'lead',
      save: async () => undefined,
    }
    const models = {
      CrmOrganization: {
        findOne: query => ({ sort: async sort => { calls.push({ kind: 'crm', query, sort }); return { _id: 'crm-1' } } }),
      },
      SalesPartnerAttribution: {
        findOne: query => ({ sort: async sort => { calls.push({ kind: 'attribution', query, sort }); return attribution } }),
      },
      SalesPartnerCommission: {
        findOneAndUpdate: async (query, update, options) => {
          calls.push({ kind: 'commission', query, update, options })
          return { _id: 'commission-1', ...update.$setOnInsert }
        },
      },
    }
    const earnedAt = new Date('2026-08-18T14:00:00.000Z')

    const commission = await accrueEarlyAccessFinderFee({
      session: { id: 'cs_early_access', mode: 'payment', payment_status: 'paid', amount_total: 281250, payment_intent: 'pi_early_access' },
      offer: { _id: 'offer-1', fee_cents: 281250 },
      account: { organization: 'customer-1' },
      earnedAt,
      models,
    })

    expect(commission).to.include({
      earning_type: 'early_access',
      earning_month: '2026-08',
      source_amount_cents: 281250,
      commission_amount_cents: 50000,
      currency: 'usd',
      status: 'accrued',
    })
    expect(calls.find(item => item.kind === 'commission').options).to.include({ upsert: true, new: true })
    expect(attribution).to.include({ status: 'early_access', customer_organization: 'customer-1' })
    expect(attribution.early_access_at).to.deep.equal(earnedAt)
  })

  it('accrues one additional $1,000 fee for the first paid annual subscription', async () => {
    const calls = []
    const attribution = {
      _id: 'attribution-1',
      partner_organization: 'partner-1',
      member: 'member-1',
      early_access_finder_fee_cents: 50000,
      annual_subscription_finder_fee_cents: 100000,
      status: 'early_access',
      save: async () => undefined,
    }
    const models = {
      CrmOrganization: {
        findOne: query => ({ sort: async sort => { calls.push({ kind: 'crm', query, sort }); return { _id: 'crm-1' } } }),
      },
      SalesPartnerAttribution: {
        findOne: query => ({ sort: async sort => { calls.push({ kind: 'attribution', query, sort }); return attribution } }),
      },
      SalesPartnerCommission: {
        findOne: async query => { calls.push({ kind: 'eligibility', query }); return { _id: 'early-access-fee' } },
        findOneAndUpdate: async (query, update, options) => {
          calls.push({ kind: 'commission', query, update, options })
          return { _id: 'annual-fee', ...update.$setOnInsert }
        },
      },
    }
    const invoice = {
      _id: 'invoice-1',
      organization: 'customer-1',
      status: 'paid',
      currency: 'usd',
      subtotal_cents: 1500000,
      discount_cents: 281250,
      amount_paid_cents: 1218750,
      paid_at: new Date('2026-11-18T14:00:00.000Z'),
    }
    const subscription = { _id: 'subscription-1', price_snapshot: { interval: 'year' } }

    const commission = await accrueAnnualSubscriptionFinderFee({ invoice, subscription, models })

    expect(commission).to.include({
      earning_type: 'annual_subscription',
      earning_month: '2026-11',
      source_amount_cents: 1218750,
      commission_amount_cents: 100000,
      currency: 'usd',
      status: 'accrued',
    })
    expect(calls.find(item => item.kind === 'commission').query).to.deep.equal({ attribution: 'attribution-1', earning_type: 'annual_subscription' })
    expect(attribution).to.include({ status: 'converted', customer_organization: 'customer-1', subscription: 'subscription-1' })
    expect(attribution.converted_at).to.deep.equal(invoice.paid_at)
  })

  it('ignores ineligible payments and reverses an unsettled annual fee on invoice void', async () => {
    let reversedUpdate
    const models = {
      SalesPartnerCommission: {
        findOneAndUpdate: async (query, update) => { reversedUpdate = { query, update }; return { status: 'reversed' } },
      },
    }
    expect(await accrueAnnualSubscriptionFinderFee({
      invoice: { _id: 'invoice-open', status: 'open', currency: 'usd' },
      subscription: { _id: 'subscription-1', price_snapshot: { interval: 'year' } },
      models,
    })).to.equal(null)
    const reversed = await reverseSalesPartnerCommission({
      invoice: { _id: 'invoice-void' },
      reason: 'Provider voided invoice',
      models,
    })
    expect(reversed.status).to.equal('reversed')
    expect(reversedUpdate.query.billing_invoice).to.equal('invoice-void')
    expect(reversedUpdate.update.$set).to.include({ status: 'reversed', reversal_reason: 'Provider voided invoice' })
  })

  it('uses stable UTC statement periods and remains disabled unless scheduling is enabled', () => {
    expect(earningMonth(new Date('2026-01-31T23:59:59.000Z'))).to.equal('2026-01')
    expect(previousPeriodKey(new Date('2026-01-15T10:00:00.000Z'))).to.equal('2025-12')
    expect(periodBounds('2026-08')).to.deep.equal({
      periodStart: new Date('2026-08-01T00:00:00.000Z'),
      periodEnd: new Date('2026-09-01T00:00:00.000Z'),
    })
    expect(periodBounds('2026-13')).to.equal(null)
    expect(createSalesPartnerStatementJob()).to.include({
      key: 'sales_partner.statements.generate',
      kind: 'scheduled',
      enabled: false,
      idempotency: 'sales-partner-period',
    })
  })
})
