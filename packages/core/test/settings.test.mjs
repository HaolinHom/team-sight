import test from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultSettings, normalizeSettings } from '../dist/index.js'

test('fresh defaults enable supported query types, operations, fields and China calendar', () => {
  const settings = createDefaultSettings()
  assert.deepEqual(settings.tapd.defaultTypes, ['task', 'bug'])
  assert.deepEqual(settings.tapd.writeAccess, {
    operations: ['create', 'update', 'comment'],
    fields: ['name', 'description', 'owner', 'effort', 'begin', 'due', 'story_id', 'status'],
  })
  assert.deepEqual(settings.chinaCalendar, { enabled: true, years: {} })
  const normalized = normalizeSettings(settings).settings
  assert.deepEqual(normalized.tapd, settings.tapd)
  assert.deepEqual(normalized.chinaCalendar, settings.chinaCalendar)
  settings.tapd.writeAccess.operations.length = 0
  assert.equal(createDefaultSettings().tapd.writeAccess.operations.length, 3)
})

test('existing settings retain missing permissions, explicit opt-outs and custom fields', () => {
  for (const writeAccess of [undefined, {}, { operations: [], fields: [] }, { operations: ['update'], fields: ['name', 'custom_field'] }]) {
    const raw = { schemaVersion: 6, tapd: { defaultTypes: [], ...(writeAccess ? { writeAccess } : {}) }, chinaCalendar: { enabled: false, years: {} } }
    const settings = normalizeSettings(raw).settings
    assert.deepEqual(settings.tapd.defaultTypes, [])
    assert.deepEqual(settings.tapd.writeAccess.operations, writeAccess?.operations ?? [])
    assert.deepEqual(settings.tapd.writeAccess.fields, writeAccess?.fields ?? [])
    assert.equal(settings.chinaCalendar.enabled, false)
  }
  const legacy = normalizeSettings({ schemaVersion: 6 }).settings
  assert.equal(legacy.chinaCalendar.enabled, false)
  assert.deepEqual(legacy.tapd.writeAccess, { operations: [], fields: [] })
})
