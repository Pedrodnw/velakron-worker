const { expect } = require('chai')
const { createBillingLifecycleJob, createBillingWebhookJob } = require('../jobs/billing')
const { billingMessage, reminderMilestone } = require('../services/billingLifecycle')
const {
  invoiceProjection,
  normalizeSubscriptionStatus,
  paymentMethodProjection,
  stripeDate,
} = require('../services/billingWebhookProcessor')

describe('billing worker lifecycle', () => {
  it('normalizes provider subscription states into the bounded local lifecycle', () => {
    expect(normalizeSubscriptionStatus('incomplete')).to.equal('pending')
    expect(normalizeSubscriptionStatus('active')).to.equal('active')
    expect(normalizeSubscriptionStatus('past_due')).to.equal('past_due')
    expect(normalizeSubscriptionStatus('canceled')).to.equal('canceled')
  })

  it('projects invoice and payment method data without storing sensitive card details', () => {
    const invoice = invoiceProjection({
      id: 'in_123', status: 'paid', currency: 'usd', subtotal: 1500, total: 1500,
      amount_due: 0, amount_paid: 1500, created: 1_900_000_000,
    }, {
      organizationId: 'org',
      accountId: 'account',
      subscriptionId: 'subscription',
      providerSubscriptionId: 'sub_123',
    })
    expect(invoice).to.include({
      provider_invoice_id: 'in_123',
      provider_subscription_id: 'sub_123',
      total_cents: 1500,
      amount_paid_cents: 1500,
    })
    expect(stripeDate(1_900_000_000)).to.be.instanceOf(Date)

    const payment = paymentMethodProjection({
      id: 'pm_123', type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 4, exp_year: 2030, cvc: '999' },
    }, { organizationId: 'org', accountId: 'account', isDefault: true })
    expect(payment).to.include({ type: 'card', brand: 'visa', last4: '4242', expiry_month: 4, expiry_year: 2030, is_default: true })
    expect(payment).not.to.have.property('cvc')
  })

  it('uses stable reminder milestones and secure billing links', () => {
    expect([31, 30, 20, 14, 6, 3, 1, 0].map(reminderMilestone))
      .to.deep.equal([null, 30, 30, 14, 7, 3, 1, 1])
    const message = billingMessage({ kind: 'payment', milestone: 3, clientAppUrl: 'https://velakron.com' })
    expect(message.text).to.include('https://velakron.com/app/billing')
    expect(message.text).not.to.match(/card|invoice number|amount due/i)
  })

  it('defines disabled-by-default bounded scheduled job contracts', async () => {
    const webhook = createBillingWebhookJob({ process: async options => options })
    const lifecycle = createBillingLifecycleJob({ sweep: async options => options })
    expect(webhook).to.include({ key: 'billing.webhooks.process', kind: 'scheduled', enabled: false })
    expect(await webhook.run()).to.deep.equal({ limit: 25 })
    expect(lifecycle).to.include({ key: 'billing.lifecycle.evaluate', kind: 'scheduled', enabled: false })
    expect(await lifecycle.run({}, { now: new Date('2030-01-01T00:00:00.000Z') })).to.include({ write: false, reminderWrites: false })
  })
})
