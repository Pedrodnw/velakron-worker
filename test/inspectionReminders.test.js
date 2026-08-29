const { expect } = require('chai')
const { createInspectionReminderJob } = require('../jobs/inspectionReminders')
const { technicalDetailsFree } = require('../services/inspectionReminders')

describe('Inspection reminder job', () => {
  it('is bounded, injected, and independently write-disabled by default', async () => {
    const calls = []
    const job = createInspectionReminderJob({
      sweep: async options => { calls.push(options); return { inspected: 0, queued: 0, dead_letters: 0 } },
      clientAppUrl: 'https://velakron.example',
      encryptionKey: 'unused-in-dry-run',
    })
    expect(job.key).to.equal('inspection.reminders.evaluate')
    expect(job.enabled).to.equal(false)
    const result = await job.run({ limit: 999 }, { now: new Date('2026-08-29T12:00:00Z') })
    expect(result).to.deep.equal({ inspected: 0, queued: 0, dead_letters: 0 })
    expect(calls[0].limit).to.equal(100)
    expect(calls[0].write).to.equal(false)
  })

  it('keeps controlled quality details out of reminder content', () => {
    const message = technicalDetailsFree({
      clientAppUrl: 'https://velakron.example',
      productionRecordId: '507f1f77bcf86cd799439011',
      kind: 'review',
    })
    expect(message.subject).to.equal('An inspection package is waiting for review')
    expect(message.text).to.include('/app/production/507f1f77bcf86cd799439011')
    expect(message.text).to.include('contains no part number, measurement, tolerance, drawing, model, filename, or attachment')
  })
})
