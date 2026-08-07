const mongoose = require('mongoose')
const logger = require('../functions/logger')
const { OutboxEvent } = require('../models/OutboxEvent')
const { decryptOutboxPayload } = require('../services/outboxPayload')
const { getJob, listJobs } = require('./registry')

const MAX_BATCH_SIZE = 25
const MAX_BACKOFF_MILLISECONDS = 60 * 60 * 1000

const redactError = error => String(error?.message || 'Provider operation failed')
  .replace(/((?:token|code|secret|key)=)[^&\s]+/gi, '$1[REDACTED]')
  .replace(/(bearer\s+)[a-z0-9._~-]+/gi, '$1[REDACTED]')
  .replace(/[a-z0-9_-]{48,}/gi, '[REDACTED]')
  .slice(0, 1000)

const retryDelay = ({ attempt, random = Math.random }) => {
  const exponential = Math.min(MAX_BACKOFF_MILLISECONDS, 1000 * (2 ** Math.max(0, attempt - 1)))
  return Math.min(MAX_BACKOFF_MILLISECONDS, exponential + Math.floor(random() * Math.min(30_000, exponential)))
}

const buildClaimFilter = ({ eventTypes, currentTime }) => ({
  event_type: mongoose.trusted({ $in: eventTypes }),
  $or: [
    {
      state: mongoose.trusted({ $in: ['pending', 'retryable'] }),
      available_at: mongoose.trusted({ $lte: currentTime }),
    },
    {
      state: 'claimed',
      lease_expires_at: mongoose.trusted({ $lte: currentTime }),
    },
  ],
})

const createOutboxProcessor = ({
  config,
  outboxModel = OutboxEvent,
  now = () => new Date(),
  random = Math.random,
} = {}) => {
  const supportedEventTypes = () => listJobs()
    .filter(job => job.kind === 'outbox' && job.enabled)
    .map(job => job.key)

  const claimNext = async () => {
    const currentTime = now()
    const eventTypes = supportedEventTypes()
    if (!eventTypes.length) return null
    const filter = buildClaimFilter({ eventTypes, currentTime })
    return outboxModel.findOneAndUpdate(filter, {
      $set: {
        state: 'claimed',
        claimed_at: currentTime,
        claimed_by: config.jobs.instanceId,
        lease_expires_at: new Date(currentTime.getTime() + config.jobs.leaseMilliseconds),
      },
      $inc: { attempt: 1 },
    }, {
      new: true,
      sort: { available_at: 1, created_at: 1 },
    }).lean()
  }

  const complete = async (event, delivery) => {
    const completedAt = now()
    await outboxModel.updateOne({
      _id: event._id,
      state: 'claimed',
      claimed_by: config.jobs.instanceId,
    }, {
      $set: {
        state: 'completed',
        completed_at: completedAt,
        lease_expires_at: null,
        provider: delivery.provider,
        provider_message_id: delivery.messageId,
        provider_state: 'submitted',
        last_error_code: null,
        last_safe_error: null,
      },
    })
    logger.info('outbox.completed', {
      eventId: String(event._id),
      eventType: event.event_type,
      attempt: event.attempt,
      provider: delivery.provider,
    })
  }

  const fail = async (event, error) => {
    const retryable = error?.retryable === true && event.attempt < event.max_attempts
    const currentTime = now()
    const requestedDelay = Math.max(0, Number(error?.retryAfterMilliseconds) || 0)
    const delay = Math.min(
      MAX_BACKOFF_MILLISECONDS,
      Math.max(retryDelay({ attempt: event.attempt, random }), requestedDelay),
    )
    const code = String(error?.code || 'JOB_FAILED').replace(/[^a-z0-9_.-]/gi, '_').slice(0, 120)
    const update = {
      state: retryable ? 'retryable' : 'dead',
      available_at: retryable
        ? new Date(currentTime.getTime() + delay)
        : currentTime,
      claimed_at: null,
      claimed_by: null,
      lease_expires_at: null,
      provider_state: 'failed',
      last_error_code: code,
      last_safe_error: redactError(error),
    }
    await outboxModel.updateOne({
      _id: event._id,
      state: 'claimed',
      claimed_by: config.jobs.instanceId,
    }, { $set: update })
    logger.error(retryable ? 'outbox.retry_scheduled' : 'outbox.dead', {
      eventId: String(event._id),
      eventType: event.event_type,
      attempt: event.attempt,
      code,
    })
  }

  const processOne = async () => {
    if (config.jobs.enabled === false) return Object.freeze({ state: 'disabled' })
    const event = await claimNext()
    if (!event) return null
    const job = getJob(event.event_type)
    try {
      if (!job) {
        const error = new Error('No worker job is registered for this event type')
        error.code = 'JOB_NOT_REGISTERED'
        error.retryable = false
        throw error
      }
      let payload = event.payload
      if (event.event_type === 'identity.email.send') {
        try {
          payload = decryptOutboxPayload(event.payload, config.email.outboxEncryptionKey)
        } catch (_error) {
          const error = new Error('Encrypted email payload could not be opened')
          error.code = 'OUTBOX_PAYLOAD_DECRYPTION_FAILED'
          error.retryable = false
          throw error
        }
      }
      const delivery = await job.run(payload, {
        eventId: String(event._id),
        idempotencyKey: event.idempotency_key,
        correlationId: event.correlation_id,
        attempt: event.attempt,
      })
      await complete(event, delivery)
      return Object.freeze({ state: 'completed', eventId: String(event._id) })
    } catch (error) {
      await fail(event, error)
      return Object.freeze({
        state: error?.retryable === true && event.attempt < event.max_attempts ? 'retryable' : 'dead',
        eventId: String(event._id),
      })
    }
  }

  const drain = async ({ limit = 10 } = {}) => {
    const boundedLimit = Math.max(1, Math.min(MAX_BATCH_SIZE, Number(limit) || 10))
    const outcomes = []
    for (let index = 0; index < boundedLimit; index += 1) {
      const outcome = await processOne()
      if (!outcome || outcome.state === 'disabled') break
      outcomes.push(outcome)
    }
    return Object.freeze({ processed: outcomes.length, outcomes })
  }

  return Object.freeze({ claimNext, drain, processOne })
}

module.exports = { buildClaimFilter, createOutboxProcessor, redactError, retryDelay }
