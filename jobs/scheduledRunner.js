const crypto = require('node:crypto')
const mongoose = require('mongoose')
const logger = require('../functions/logger')
const { JobLease } = require('../models/JobLease')
const { listJobs } = require('./registry')

const createScheduledRunner = ({
  config,
  leaseModel = JobLease,
  now = () => new Date(),
} = {}) => {
  const inFlight = new Set()

  const acquire = async job => {
    const currentTime = now()
    const existing = await leaseModel.findOne({ job_key: job.key }).lean()
    const nextRunAt = existing?.metadata?.next_run_at && new Date(existing.metadata.next_run_at)
    if (nextRunAt && nextRunAt > currentTime) return null
    if (existing?.lease_expires_at && new Date(existing.lease_expires_at) > currentTime) return null
    const runId = crypto.randomUUID()
    const update = {
      $set: {
        owner_instance: config.jobs.instanceId,
        acquired_at: currentTime,
        heartbeat_at: currentTime,
        lease_expires_at: new Date(currentTime.getTime() + config.jobs.leaseMilliseconds),
        run_id: runId,
        attempt: Number(existing?.attempt || 0) + 1,
        metadata: {
          ...(existing?.metadata || {}),
          state: 'running',
          started_at: currentTime,
        },
      },
    }
    try {
      const query = existing
        ? { job_key: job.key, lease_expires_at: mongoose.trusted({ $lte: currentTime }) }
        : { job_key: job.key }
      return await leaseModel.findOneAndUpdate(query, {
        ...update,
        ...(!existing ? {
          $setOnInsert: {
            job_key: job.key,
            cursor: null,
          },
        } : {}),
      }, {
        new: true,
        upsert: !existing,
      }).lean()
    } catch (error) {
      if (error?.code === 11000) return null
      throw error
    }
  }

  const finish = async ({ job, lease, outcome, error = null }) => {
    const finishedAt = now()
    const nextRunAt = new Date(finishedAt.getTime() + job.intervalMilliseconds)
    await leaseModel.updateOne({
      job_key: job.key,
      run_id: lease.run_id,
      owner_instance: config.jobs.instanceId,
    }, {
      $set: {
        heartbeat_at: finishedAt,
        lease_expires_at: finishedAt,
        metadata: {
          state: error ? 'failed' : 'completed',
          completed_at: finishedAt,
          next_run_at: nextRunAt,
          ...(error ? { error_code: String(error.code || 'SCHEDULED_JOB_FAILED').slice(0, 120) } : {}),
          ...(!error && outcome ? { outcome } : {}),
        },
      },
    })
  }

  const runJob = async job => {
    if (inFlight.has(job.key)) return null
    const lease = await acquire(job)
    if (!lease) return null
    inFlight.add(job.key)
    const startedAt = Date.now()
    try {
      const outcome = await job.run({}, {
        now: now(),
        runId: lease.run_id,
        instanceId: config.jobs.instanceId,
      })
      await finish({ job, lease, outcome })
      logger.info('scheduled.completed', {
        jobType: job.key,
        runId: lease.run_id,
        durationMilliseconds: Date.now() - startedAt,
      })
      return { job: job.key, state: 'completed', outcome }
    } catch (error) {
      await finish({ job, lease, error })
      logger.error('scheduled.failed', {
        jobType: job.key,
        runId: lease.run_id,
        code: String(error?.code || 'SCHEDULED_JOB_FAILED').slice(0, 120),
        durationMilliseconds: Date.now() - startedAt,
      })
      return { job: job.key, state: 'failed' }
    } finally {
      inFlight.delete(job.key)
    }
  }

  const runDue = async () => {
    if (!config.jobs.enabled || !config.jobs.scheduledEnabled) {
      return Object.freeze({ state: 'disabled', processed: 0, outcomes: [] })
    }
    const jobs = listJobs().filter(job => job.kind === 'scheduled' && job.enabled)
    const outcomes = []
    for (const job of jobs) {
      const outcome = await runJob(job)
      if (outcome) outcomes.push(outcome)
    }
    return Object.freeze({ state: 'enabled', processed: outcomes.length, outcomes })
  }

  return Object.freeze({
    getStatus: () => ({
      enabled: Boolean(config.jobs.enabled && config.jobs.scheduledEnabled),
      in_flight: [...inFlight],
    }),
    runDue,
    runJob,
  })
}

module.exports = { createScheduledRunner }
