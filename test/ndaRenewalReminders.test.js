const { expect } = require('chai')
const { createNdaRenewalReminderJob } = require('../jobs/ndaRenewalReminders')
const {
  reminderMessage,
  reminderMilestone,
} = require('../services/ndaRenewalReminders')

describe('NDA renewal reminder job', () => {
  it('is independently gated, bounded, and write-disabled by default', async () => {
    const calls = []
    const job = createNdaRenewalReminderJob({
      sweep: async options => { calls.push(options); return { inspected: 0, queued: 0 } },
      clientAppUrl: 'https://velakron.example',
      encryptionKey: 'unused-in-dry-run',
    })
    expect(job).to.include({
      key: 'nda_renewal.reminders.evaluate',
      kind: 'scheduled',
      enabled: false,
    })
    await job.run({ limit: 9999 }, { now: new Date('2026-09-05T12:00:00Z') })
    expect(calls[0]).to.include({ limit: 500, write: false })
  })

  it('preserves the API renewal milestones', () => {
    const now = new Date('2026-09-05T12:00:00Z')
    expect(reminderMilestone({ expiresOn: '2026-11-05', now })).to.equal(null)
    expect(reminderMilestone({ expiresOn: '2026-10-20', now })).to.deep.equal({ milestone: 60, daysRemaining: 45 })
    expect(reminderMilestone({ expiresOn: '2026-09-25', now })).to.deep.equal({ milestone: 30, daysRemaining: 20 })
    expect(reminderMilestone({ expiresOn: '2026-09-10', now })).to.deep.equal({ milestone: 7, daysRemaining: 5 })
    expect(reminderMilestone({ expiresOn: '2026-09-04', now })).to.deep.equal({ milestone: 0, daysRemaining: -1 })
  })

  it('keeps agreement files and production data out of reminder email', () => {
    const message = reminderMessage({
      clientAppUrl: 'https://velakron.example',
      supplierName: 'Supplier Company',
      oemName: 'OEM Company',
      expiresOn: '2026-09-10',
      daysRemaining: 5,
      url: '/app/suppliers/507f1f77bcf86cd799439011',
    })
    expect(message.subject).to.equal('NDA renewal due in 5 days for Supplier Company')
    expect(message.text).to.include('https://velakron.example/app/suppliers/507f1f77bcf86cd799439011')
    expect(message.text).to.include('contains no NDA attachment or production data')
  })
})
