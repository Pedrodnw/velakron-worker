const canonical = value => {
  if (value == null || typeof value !== 'object') return value
  if (value instanceof Date) return value.toISOString()
  if (value._bsontype === 'ObjectId') return String(value)
  if (Array.isArray(value)) return value.map(canonical)
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
}
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
const error = message => Object.assign(new Error(message), { code: 'IMMUTABLE_HISTORY', status: 409 })

const protectCollaborationHistory = (schema, { versionField, version, terminal, immutableFields = [] }) => {
  schema.pre('save', async function protectHistory() {
    if (this.isNew) return
    const raw = await this.constructor.collection.findOne({ _id: this._id }, { session: this.$session() || undefined })
    if (!raw || raw[versionField] !== version) return
    const prior = this.constructor.hydrate(raw).toObject()
    const next = this.toObject()
    if (terminal(prior) && this.modifiedPaths().some(path => !['updated_at', '__v'].includes(path))) throw error('This record is permanently read-only')
    if (next[versionField] !== version) throw error('The workflow version cannot be downgraded')
    const history = prior.workflow_history || []
    if ((next.workflow_history || []).length < history.length || !equal(history, next.workflow_history.slice(0, history.length))) throw error('Workflow history is append-only')
    for (const field of immutableFields) {
      if (prior[field] != null && !equal(prior[field], next[field])) throw error(`${field} is immutable after it is recorded`)
    }
  })
  // Bulk migration uses the native collection deliberately; application mutations
  // must load the aggregate and use its versioned transactional command service.
  for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace']) {
    schema.pre(operation, async function protectQueryMutation() {
      const existing = await this.model.collection.findOne({ $and: [this.getFilter(), { [versionField]: version }] }, { session: this.getOptions().session, projection: { _id: 1 } })
      if (existing) throw error('V2 records require a versioned aggregate command')
    })
  }
}
module.exports = { canonical, protectCollaborationHistory }
