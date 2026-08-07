const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.join(__dirname, '..')
const collect = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  if (entry.name === 'node_modules') return []
  const target = path.join(directory, entry.name)
  if (entry.isDirectory()) return collect(target)
  return entry.isFile() && entry.name.endsWith('.js') ? [target] : []
})

for (const file of collect(root)) execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
console.log('Worker JavaScript syntax: OK')
