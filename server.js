const http = require('node:http')
const express = require('express')
const mongoose = require('mongoose')
const { connectDB, disconnectDB } = require('./config/db')
const { loadConfig } = require('./config/env')
const logger = require('./functions/logger')
const { registerDefaultJobs } = require('./jobs/defaults')
const { createOutboxProcessor } = require('./jobs/outboxProcessor')
const { listJobs } = require('./jobs/registry')
const { createScheduler } = require('./jobs/scheduler')
const { createScheduledRunner } = require('./jobs/scheduledRunner')
const { createEmailProvider } = require('./services/providers/email')
const { createMalwareScanner } = require('./services/providers/malwareScanner')

const createApp = ({ config, scheduler, scheduledRunner, emailProvider, malwareScanner }) => {
  const app = express()
  app.disable('x-powered-by')
  app.locals.config = config
  app.locals.scheduler = scheduler

  app.get('/health', (_req, res) => res.status(200).json({
    data: {
      status: 'ok',
      service: 'velakron-worker',
      scheduler: scheduler.getStatus(),
      scheduled_jobs: scheduledRunner?.getStatus() || { enabled: false, in_flight: [] },
      email: emailProvider.getStatus(),
      malware_scanner: malwareScanner?.getStatus() || { provider: 'disabled', enabled: false },
    },
    meta: {},
    error: null,
  }))

  app.get('/ready', (_req, res) => {
    const providerStatus = emailProvider.getStatus()
    const scannerStatus = malwareScanner?.getStatus() || { provider: 'disabled', enabled: false }
    const ready = mongoose.connection.readyState === 1
      && (!providerStatus.enabled || (providerStatus.configured && providerStatus.mailbox_verified))
      && (!scannerStatus.enabled || (scannerStatus.configured && scannerStatus.verified))
    return res.status(ready ? 200 : 503).json({
      data: ready ? {
        status: 'ready',
        database: config.databaseName,
        email: providerStatus,
        malware_scanner: scannerStatus,
        jobs: listJobs().map(job => ({
          key: job.key,
          kind: job.kind,
          enabled: Boolean(job.enabled),
        })),
      } : null,
      meta: {},
      error: ready ? null : { code: 'WORKER_NOT_READY', message: 'A required worker dependency is not ready' },
    })
  })

  app.use((_req, res) => res.status(404).json({
    data: null,
    meta: {},
    error: { code: 'NOT_FOUND', message: 'Route not found' },
  }))
  return app
}

const startServer = async () => {
  const config = loadConfig()
  await connectDB(config)
  const emailProvider = createEmailProvider(config)
  const malwareScanner = createMalwareScanner(config)
  if (config.email.deliveryEnabled) await emailProvider.verifyMailbox()
  if (config.malwareScanner.enabled) await malwareScanner.verifyConfiguration()
  registerDefaultJobs({ emailProvider, config, malwareScanner })
  const outboxProcessor = createOutboxProcessor({ config })
  const scheduledRunner = createScheduledRunner({ config })
  const scheduler = createScheduler({
    config,
    tick: async () => ({
      outbox: await outboxProcessor.drain({ limit: 10 }),
      scheduled: await scheduledRunner.runDue(),
    }),
  })
  await scheduler.start()
  const app = createApp({ config, scheduler, scheduledRunner, emailProvider, malwareScanner })
  const server = http.createServer(app)

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.port, config.host, resolve)
  })
  logger.info('worker.started', {
    address: `http://${config.host}:${config.port}`,
    database: config.databaseName,
    jobsEnabled: config.jobs.enabled,
  })

  const shutdown = async signal => {
    logger.info('worker.stopping', { signal })
    await new Promise(resolve => server.close(resolve))
    await scheduler.stop()
    await disconnectDB()
    process.exit(0)
  }
  process.once('SIGTERM', () => shutdown('SIGTERM'))
  process.once('SIGINT', () => shutdown('SIGINT'))
  return { app, config, scheduler, scheduledRunner, server }
}

if (require.main === module) {
  startServer().catch(error => {
    logger.error('worker.start_failed', { message: error.message })
    process.exit(1)
  })
}

module.exports = { createApp, startServer }
