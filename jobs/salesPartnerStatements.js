const { SalesPartnerProfile } = require('../models/SalesPartnerModels')
const { generateSalesPartnerStatement, previousPeriodKey } = require('../services/salesPartnerStatements')

const createSalesPartnerStatementJob = ({ enabled = false, intervalMilliseconds = 6 * 60 * 60 * 1000 } = {}) => ({
  key: 'sales_partner.statements.generate',
  kind: 'scheduled',
  enabled,
  intervalMilliseconds,
  idempotency: 'sales-partner-period',
  redaction: 'financial-totals-only',
  run: async (_payload, context = {}) => {
    const periodKey = previousPeriodKey(context.now || new Date())
    const profiles = await SalesPartnerProfile.find({ status: 'active' }).select('organization').lean()
    let generated = 0
    for (const profile of profiles) {
      await generateSalesPartnerStatement({ partnerOrganizationId: profile.organization, periodKey })
      generated += 1
    }
    return { period_key: periodKey, generated }
  },
})

module.exports = { createSalesPartnerStatementJob }
