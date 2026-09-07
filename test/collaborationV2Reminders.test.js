const { expect } = require('chai')
const { stillActionable, technicalDetailsFree } = require('../services/partWorkspaceReminders')

describe('V2 reminder ownership and secure links', () => {
  const formal = { _id: 'formal', __v: 2, active: true, terminal: false, category: 'production_block', workflow_state: 'oem_release_required', part_revision: 'revision', oem_organization: 'oem', supplier_organization: 'supplier' }
  const candidate = { kind: 'formal', aggregateId: 'formal', productionId: 'production', organizationId: 'oem', version: 2 }
  const connection = overrides => ({ collection: name => ({ findOne: async filter => {
    const rows = { attentionconditions: formal, organizations: { _id: 'oem' }, partworkspaceshares: { relationship: 'relationship' }, organizationrelationships: { _id: 'relationship' }, productionrecords: { _id: 'production' }, ...overrides }
    if (name === 'organizations') expect(filter).to.include({ status: 'active' })
    if (name === 'organizationrelationships') expect(filter).to.include({ status: 'active', current: true })
    return rows[name]
  } }) })
  it('revalidates the current formal version, actor, relationship and organization before delivery', async () => {
    expect(await stillActionable({ connection: connection({}), candidate })).to.equal(true)
    for (const overrides of [{ attentionconditions: { ...formal, __v: 3 } }, { attentionconditions: { ...formal, active: false, terminal: true } }, { attentionconditions: { ...formal, workflow_state: 'supplier_resolution_required' } }, { organizations: null }, { organizationrelationships: null }, { partworkspaceshares: null }, { productionrecords: null }]) expect(await stillActionable({ connection: connection(overrides), candidate })).to.equal(false)
  })
  it('links directly to the secure production step without technical content', () => {
    const message = technicalDetailsFree({ clientAppUrl: 'https://synthetic.example', productionId: 'production', formalId: 'formal', kind: 'formal' })
    expect(message.text).to.include('/app/production/production?formal=formal')
    expect(message.text).not.to.include('/app/parts/')
    expect(message.html).to.equal('')
  })
})
