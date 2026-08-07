const { getJob } = require('./registry')

const runOneJob = async ({ key, payload = {}, context = {} }) => {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Direct job execution is restricted to test mode in Phase 0')
  }
  const job = getJob(key)
  if (!job) throw new Error(`Unknown job: ${key}`)
  return job.run(payload, context)
}

module.exports = { runOneJob }
