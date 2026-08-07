const sanitize = value => String(value || '')
  .replace(/(token|secret|password|authorization)=[^\s&]+/gi, '$1=[REDACTED]')
  .slice(0, 2000)

const write = (level, event, fields = {}) => {
  const safeFields = Object.fromEntries(Object.entries(fields).map(([key, value]) => [
    key,
    typeof value === 'string' ? sanitize(value) : value,
  ]))
  const output = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: 'velakron-worker',
    event,
    ...safeFields,
  })
  const destination = level === 'error' ? console.error : console.log
  destination(output)
}

module.exports = {
  info: (event, fields) => write('info', event, fields),
  error: (event, fields) => write('error', event, fields),
}
