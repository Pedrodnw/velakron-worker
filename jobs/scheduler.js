const logger = require('../functions/logger')

const createScheduler = ({ config, tick = async () => ({ processed: 0 }) }) => {
  let running = false
  let timer = null
  let inFlight = null

  const runTick = async () => {
    if (!running || inFlight) return inFlight
    inFlight = Promise.resolve()
      .then(tick)
      .catch(error => {
        logger.error('scheduler.tick_failed', { message: error.message })
      })
      .finally(() => {
        inFlight = null
      })
    return inFlight
  }

  return Object.freeze({
    getStatus: () => ({ enabled: config.jobs.enabled, running }),
    start: async () => {
      if (!config.jobs.enabled) {
        logger.info('scheduler.disabled', { reason: 'VELAKRON_JOBS_ENABLED is false' })
        return false
      }
      if (running) return true
      running = true
      await runTick()
      timer = setInterval(runTick, config.jobs.outboxPollMilliseconds)
      timer.unref?.()
      logger.info('scheduler.started', {
        pollMilliseconds: config.jobs.outboxPollMilliseconds,
      })
      return true
    },
    stop: async () => {
      running = false
      if (timer) clearInterval(timer)
      timer = null
      if (inFlight) await inFlight
      logger.info('scheduler.stopped')
    },
  })
}

module.exports = { createScheduler }
