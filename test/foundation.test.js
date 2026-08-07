const { expect } = require('chai')
const { loadConfig } = require('../config/env')
const { clearJobsForTest, registerJob } = require('../jobs/registry')
const { runOneJob } = require('../jobs/runOne')
const { createScheduler } = require('../jobs/scheduler')
const { createProductionAttentionJob } = require('../jobs/evaluateProductionAttention')
const { createAttachmentScanJob } = require('../jobs/scanAttachment')
const { createScheduledRunner } = require('../jobs/scheduledRunner')
const { checkModelParity } = require('../scripts/checkModelParity')
const { GuardDutyS3MalwareScanner } = require('../services/providers/malwareScanner')

describe('worker foundation', () => {
  const previous = {}
  const keys = [
    'NODE_ENV',
    'MONGO_URI',
    'MONGO_DB_NAME',
    'VELAKRON_JOBS_ENABLED',
    'VELAKRON_SCHEDULED_JOBS_ENABLED',
    'VELAKRON_ATTENTION_WRITES_ENABLED',
    'VELAKRON_MAINTENANCE_WRITES_ENABLED',
    'VELAKRON_EMAIL_ADAPTER',
    'VELAKRON_EMAIL_DELIVERY_ENABLED',
    'VELAKRON_MALWARE_SCANNER_ADAPTER',
    'VELAKRON_MALWARE_SCANNING_ENABLED',
  ]

  beforeEach(() => {
    for (const key of keys) previous[key] = process.env[key]
    process.env.NODE_ENV = 'test'
    process.env.MONGO_URI = 'mongodb://127.0.0.1:27017'
    process.env.MONGO_DB_NAME = 'velakron_test'
    process.env.VELAKRON_JOBS_ENABLED = 'false'
    process.env.VELAKRON_SCHEDULED_JOBS_ENABLED = 'false'
    process.env.VELAKRON_ATTENTION_WRITES_ENABLED = 'false'
    process.env.VELAKRON_MAINTENANCE_WRITES_ENABLED = 'false'
    process.env.VELAKRON_EMAIL_ADAPTER = 'development'
    process.env.VELAKRON_EMAIL_DELIVERY_ENABLED = 'false'
    process.env.VELAKRON_MALWARE_SCANNER_ADAPTER = 'disabled'
    process.env.VELAKRON_MALWARE_SCANNING_ENABLED = 'false'
    clearJobsForTest()
  })

  afterEach(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
    clearJobsForTest()
  })

  it('keeps scheduling disabled by default', async () => {
    const config = loadConfig()
    const scheduler = createScheduler({ config })
    expect(await scheduler.start()).to.equal(false)
    expect(scheduler.getStatus()).to.deep.equal({ enabled: false, running: false })
  })

  it('refuses a non-Velakron database', () => {
    process.env.MONGO_DB_NAME = 'dnw'
    expect(() => loadConfig()).to.throw('Worker database must be velakron')
  })

  it('can execute one inert job only in test mode', async () => {
    registerJob({ key: 'foundation.echo', run: async payload => payload })
    expect(await runOneJob({ key: 'foundation.echo', payload: { ok: true } })).to.deep.equal({ ok: true })
  })

  it('keeps shared server and worker schemas in parity', () => {
    expect(checkModelParity()).to.equal(true)
  })

  it('defines a bounded, injected, idempotent attention-evaluation job contract', async () => {
    const calls = []
    registerJob(createProductionAttentionJob({
      evaluateBatch: async options => {
        calls.push(options)
        return { evaluated: 2, ...options }
      },
    }))
    const now = new Date('2030-01-02T03:04:05.000Z')
    const result = await runOneJob({
      key: 'attention.active_records.evaluate',
      payload: { limit: 500 },
      context: { now },
    })
    expect(result).to.deep.include({ evaluated: 2, limit: 100 })
    expect(calls).to.deep.equal([{ limit: 100, now, policy: null, write: false }])
  })

  it('uses a database lease before running a due scheduled job', async () => {
    const updates = []
    const leaseModel = {
      findOne: () => ({ lean: async () => null }),
      findOneAndUpdate: () => ({ lean: async () => ({
        job_key: 'foundation.scheduled',
        run_id: 'run-1',
      }) }),
      updateOne: async (...args) => { updates.push(args) },
    }
    registerJob({
      key: 'foundation.scheduled',
      kind: 'scheduled',
      enabled: true,
      intervalMilliseconds: 60_000,
      run: async () => ({ inspected: 2 }),
    })
    const runner = createScheduledRunner({
      config: {
        jobs: {
          enabled: true,
          scheduledEnabled: true,
          instanceId: 'test-worker',
          leaseMilliseconds: 60_000,
        },
      },
      leaseModel,
      now: () => new Date('2030-01-02T03:04:05.000Z'),
    })
    const result = await runner.runDue()
    expect(result.processed).to.equal(1)
    expect(result.outcomes[0]).to.deep.include({ job: 'foundation.scheduled', state: 'completed' })
    expect(updates).to.have.length(1)
    expect(updates[0][1].$set.metadata).to.deep.include({ state: 'completed', outcome: { inspected: 2 } })
  })

  it('makes a scanned file available only after a clean provider result', async () => {
    const attachment = {
      _id: '507f1f77bcf86cd799439099',
      owner_organization: '507f1f77bcf86cd799439011',
      state: 'scanning',
      scan_status: 'pending',
      storage_adapter: 's3',
      object_key: 'development/active/507f1f77bcf86cd799439011/11111111-1111-4111-8111-111111111111',
      mime_type: 'application/pdf',
      byte_size: 12,
      save: async () => undefined,
    }
    const job = createAttachmentScanJob({
      enabled: true,
      attachmentModel: {
        findOne: () => ({ select: async () => attachment }),
      },
      scanner: {
        scan: async () => ({ status: 'clean', provider: 'fake-scanner', reference: 'scan-1' }),
      },
    })
    const result = await job.run({
      attachment_id: String(attachment._id),
      owner_organization_id: String(attachment.owner_organization),
    })
    expect(result).to.include({ provider: 'fake-scanner', state: 'clean' })
    expect(attachment).to.include({ state: 'available', scan_status: 'clean' })
    expect(attachment.available_at).to.be.instanceOf(Date)
  })

  it('verifies the exact AWS target and reads GuardDuty scan tags without exposing object data', async () => {
    const s3Calls = []
    const scanner = new GuardDutyS3MalwareScanner({
      accountId: '923243861794',
      bucket: 'velakron-prototype-private-923243861794',
      environment: 'development',
      region: 'us-east-2',
      s3Client: {
        send: async command => {
          s3Calls.push(command.constructor.name)
          if (command.constructor.name === 'GetBucketLocationCommand') {
            return { LocationConstraint: 'us-east-2' }
          }
          return { TagSet: [{ Key: 'GuardDutyMalwareScanStatus', Value: 'NO_THREATS_FOUND' }] }
        },
      },
      stsClient: { send: async () => ({ Account: '923243861794' }) },
    })
    expect(await scanner.verifyConfiguration()).to.include({ verified: true, region: 'us-east-2' })
    expect(await scanner.scan({
      attachmentId: '507f1f77bcf86cd799439099',
      objectKey: 'development/active/507f1f77bcf86cd799439011/11111111-1111-4111-8111-111111111111',
    })).to.include({ status: 'clean', provider: 'guardduty-s3' })
    await scanner.quarantine({
      objectKey: 'development/active/507f1f77bcf86cd799439011/11111111-1111-4111-8111-111111111111',
    })
    expect(s3Calls).to.deep.equal([
      'GetBucketLocationCommand',
      'GetObjectTaggingCommand',
      'CopyObjectCommand',
      'DeleteObjectCommand',
    ])
  })

  it('keeps an untagged GuardDuty object pending for a later retry', async () => {
    const scanner = new GuardDutyS3MalwareScanner({
      accountId: '923243861794',
      bucket: 'velakron-prototype-private-923243861794',
      environment: 'development',
      region: 'us-east-2',
      s3Client: {
        send: async command => command.constructor.name === 'GetBucketLocationCommand'
          ? { LocationConstraint: 'us-east-2' }
          : { TagSet: [] },
      },
      stsClient: { send: async () => ({ Account: '923243861794' }) },
    })
    await scanner.verifyConfiguration()
    try {
      await scanner.scan({
        attachmentId: '507f1f77bcf86cd799439099',
        objectKey: 'development/active/507f1f77bcf86cd799439011/11111111-1111-4111-8111-111111111111',
      })
      throw new Error('Expected the scan to remain pending')
    } catch (error) {
      expect(error).to.include({ code: 'MALWARE_SCAN_PENDING', retryable: true })
      expect(error.retryAfterMilliseconds).to.equal(30_000)
    }
  })
})
