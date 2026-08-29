const { expect } = require('chai')
const { createPartWorkspaceReminderJob } = require('../jobs/partWorkspaceReminders')
const { technicalDetailsFree } = require('../services/partWorkspaceReminders')

describe('Part Workspace reminder job', () => {
  it('is bounded, scheduled, injected, and disabled independently by default', async () => {
    const calls = []
    const job = createPartWorkspaceReminderJob({
      sweep: async options => { calls.push(options); return { inspected: 0, queued: 0 } },
      clientAppUrl: 'https://velakron.example',
      encryptionKey: 'unused-in-dry-run',
    })
    expect(job.key).to.equal('part_workspace.reminders.evaluate')
    expect(job.kind).to.equal('scheduled')
    expect(job.enabled).to.equal(false)
    const result = await job.run({ limit: 999 }, { now: new Date('2026-08-28T12:00:00Z') })
    expect(result).to.deep.equal({ inspected: 0, queued: 0 })
    expect(calls[0].limit).to.equal(100)
    expect(calls[0].write).to.equal(false)
  })

  it('keeps protected technical context out of reminder content', () => {
    const message = technicalDetailsFree({
      clientAppUrl: 'https://velakron.example',
      partId: '507f1f77bcf86cd799439011',
      collaborationId: '507f191e810c19729de860ea',
      kind: 'collaboration',
    })
    expect(message.subject).to.equal('A Part Workspace action is due')
    expect(message.text).to.include('/app/parts/507f1f77bcf86cd799439011?collaboration=')
    expect(message.text).to.include('contains no part number, technical description, drawing, model, filename, or attachment')
  })
})
