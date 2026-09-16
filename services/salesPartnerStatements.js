const mongoose = require('mongoose')
const {
  SalesPartnerCommission,
  SalesPartnerMember,
  SalesPartnerStatement,
} = require('../models/SalesPartnerModels')

const periodBounds = periodKey => {
  if (!/^\d{4}-\d{2}$/.test(String(periodKey || ''))) return null
  const [year, month] = periodKey.split('-').map(Number)
  if (month < 1 || month > 12) return null
  const periodStart = new Date(Date.UTC(year, month - 1, 1))
  const periodEnd = new Date(Date.UTC(year, month, 1))
  return { periodStart, periodEnd }
}

const previousPeriodKey = (now = new Date()) => {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

const generateSalesPartnerStatement = async ({
  partnerOrganizationId,
  periodKey,
  models = { SalesPartnerCommission, SalesPartnerMember, SalesPartnerStatement },
}) => {
  const bounds = periodBounds(periodKey)
  if (!bounds) throw Object.assign(new Error('Statement period must use YYYY-MM'), { code: 'INVALID_STATEMENT_PERIOD' })
  const existing = await models.SalesPartnerStatement.findOne({
    partner_organization: partnerOrganizationId,
    period_key: periodKey,
  })
  if (existing && existing.status !== 'draft') return existing
  const commissions = await models.SalesPartnerCommission.find({
    partner_organization: partnerOrganizationId,
    earning_month: periodKey,
    status: mongoose.trusted({ $in: ['accrued', 'approved'] }),
  }).sort({ member: 1, earned_at: 1 })
  const memberIds = [...new Set(commissions.map(item => String(item.member)))]
  const members = await models.SalesPartnerMember.find({ _id: mongoose.trusted({ $in: memberIds }) })
  const memberMap = new Map(members.map(member => [String(member._id), member]))
  const grouped = new Map()
  for (const commission of commissions) {
    const key = String(commission.member)
    const member = memberMap.get(key)
    const current = grouped.get(key) || {
      member: commission.member,
      member_name: member ? [member.first_name, member.last_name].filter(Boolean).join(' ') : 'Former team member',
      member_email: member?.email || 'unavailable@example.invalid',
      sales_count: 0,
      collected_revenue_cents: 0,
      commission_amount_cents: 0,
    }
    current.sales_count += 1
    current.collected_revenue_cents += commission.source_amount_cents
    current.commission_amount_cents += commission.commission_amount_cents
    grouped.set(key, current)
  }
  const memberBreakdown = [...grouped.values()].sort((left, right) => left.member_name.localeCompare(right.member_name))
  const totals = memberBreakdown.reduce((result, item) => ({
    sales_count: result.sales_count + item.sales_count,
    collected_revenue_cents: result.collected_revenue_cents + item.collected_revenue_cents,
    commission_amount_cents: result.commission_amount_cents + item.commission_amount_cents,
  }), { sales_count: 0, collected_revenue_cents: 0, commission_amount_cents: 0 })
  const statement = await models.SalesPartnerStatement.findOneAndUpdate(
    { partner_organization: partnerOrganizationId, period_key: periodKey },
    {
      $set: {
        period_start: bounds.periodStart,
        period_end: bounds.periodEnd,
        currency: 'usd',
        status: 'draft',
        ...totals,
        member_breakdown: memberBreakdown,
      },
      $setOnInsert: { partner_organization: partnerOrganizationId, period_key: periodKey },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  )
  if (commissions.length) {
    await models.SalesPartnerCommission.updateMany(
      {
        _id: mongoose.trusted({ $in: commissions.map(item => item._id) }),
        status: mongoose.trusted({ $in: ['accrued', 'approved'] }),
      },
      { $set: { statement: statement._id } },
    )
  }
  return statement
}

module.exports = { generateSalesPartnerStatement, periodBounds, previousPeriodKey }
