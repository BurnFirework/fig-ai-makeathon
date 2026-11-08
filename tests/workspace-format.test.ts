import assert from 'node:assert/strict'
import { test } from 'node:test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { decodeWorkspace, encodeWorkspace, mergeWorkspaces, parseWorkspace, workspaceTLSchema } from '../shared/workspace-format'
import { workspaceFixture } from './workspace-fixture'

const cases: Promise<void>[] = []
cases.push(test('a portable archive restores every board, custom inspiration image, sources and reflection', () => {
  const original = workspaceFixture()
  const bytes = encodeWorkspace(original)
  const restored = decodeWorkspace(bytes)
  assert.equal(restored.catalog.boards.length, 2)
  assert.deepEqual(restored.assets, original.assets)
  assert.deepEqual(restored.appearance, original.appearance)
  for (const board of restored.catalog.boards) {
    const records = Object.values(restored.boards[board.id]?.document.store ?? {})
    const image = records.find(record => record.typeName === 'asset')
    assert.equal(image?.typeName === 'asset' && image.props.src, image?.id)
    assert.equal(records.some(record => record.typeName === 'shape' && record.type === 'node' && record.props.node.type === 'action' && record.props.node.reflection === 'I did it'), true)
  }
  const entries = unzipSync(bytes)
  assert.ok(entries['assets/0'])
  assert.equal(strFromU8(entries['manifest.json'] ?? new Uint8Array()).includes('iVBORw0K'), false)
}))

cases.push(test('import adds isolated boards and assets without changing the existing workspace or appearance', () => {
  const current = workspaceFixture()
  const original = structuredClone(current)
  const incoming = workspaceFixture()
  incoming.appearance.palette = 'sage'
  const result = mergeWorkspaces(current, incoming)
  assert.deepEqual(current, original)
  assert.equal(result.catalog.boards.length, 4)
  assert.equal(new Set(result.catalog.boards.map(board => board.id)).size, 4)
  assert.deepEqual(result.appearance, original.appearance)
  assert.equal(result.catalog.activeId, original.catalog.activeId)
  assert.equal(Object.keys(result.assets).length, 2)
  assert.equal(result.revision, current.revision + 1)
}))

cases.push(test('missing images, mismatched records and newer formats cannot produce a successful backup', () => {
  const missing = workspaceFixture(); missing.assets = {}
  assert.throws(() => encodeWorkspace(missing), /missing/)
  assert.throws(() => parseWorkspace({ ...workspaceFixture(), formatVersion: 2 }))
  const broken = workspaceFixture()
  const first = broken.boards['board-a']
  assert.ok(first)
  const root = Object.values(first.document.store).find(record => record.id === 'shape:root')
  assert.ok(root)
  first.document.store[workspaceTLSchema.types.shape.createId('other')] = root
  assert.throws(() => encodeWorkspace(broken), /ID does not match/)
}))

cases.push(test('corrupt contents and unsafe or extra ZIP paths are rejected before restore', () => {
  const encoded = encodeWorkspace(workspaceFixture())
  assert.throws(() => decodeWorkspace(encoded.subarray(0, encoded.length - 1)), /Truncated/)
  const files = unzipSync(encoded)
  files['boards/0.json'] = strToU8('{}')
  assert.throws(() => decodeWorkspace(zipSync(files)), /corrupt/)
  files['../escape'] = strToU8('bad')
  assert.throws(() => decodeWorkspace(zipSync(files)), /Unexpected/)
}))

cases.push(test('additive import remaps stock image references as well as custom inspiration images', () => {
  const incoming = workspaceFixture()
  const first = incoming.boards['board-a']
  assert.ok(first)
  const root = Object.values(first.document.store).find(record => record.typeName === 'shape' && record.type === 'node' && record.props.node.type === 'inspiration')
  const asset = Object.values(first.document.store).find(record => record.typeName === 'asset')
  assert.ok(root); assert.ok(asset)
  const image = workspaceTLSchema.types.shape.validate({ ...root, type: 'image', props: { w: 100, h: 100, assetId: asset.id, playing: true, url: '', crop: null, flipX: false, flipY: false, altText: '' } })
  first.document.store[root.id] = image
  const merged = mergeWorkspaces(workspaceFixture(), incoming)
  const importedId = merged.catalog.boards[2]?.id
  assert.ok(importedId)
  const imported = Object.values(merged.boards[importedId]?.document.store ?? {}).find(record => record.typeName === 'shape' && record.type === 'image')
  assert.ok(imported)
  assert.notEqual(imported.props.assetId, asset.id)
  assert.ok(imported.props.assetId && merged.assets[imported.props.assetId])
}))

await Promise.all(cases)
