import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WorkspaceController, emptyWorkspace } from '../client/workspace'
import { encodeWorkspace, parseWorkspace } from '../shared/workspace-format'
import type { DesktopFiles } from '../shared/desktop-contract'
import { workspaceFixture } from './workspace-fixture'

function desktopFiles(overrides: Partial<DesktopFiles> = {}): DesktopFiles {
  return {
    load: () => Promise.resolve({ workspace: null, session: 'session', notice: null }),
    save: value => Promise.resolve({ session: value.session, revision: value.workspace.revision, savedAt: Date.now() }),
    restoreBackup: () => Promise.resolve(null), showDataFolder: () => Promise.resolve(),
    exportCopy: () => Promise.resolve(true), markDirty() {}, subscribeCommands: () => () => {}, onCloseRequested: () => () => {}, closeReady: () => Promise.resolve(),
    ...overrides,
  }
}
const cases: Promise<void>[] = []
cases.push(test('fresh workspaces contain a valid document and page before the first editor mounts', () => {
  assert.doesNotThrow(() => parseWorkspace(emptyWorkspace()))
}))
cases.push(test('desktop libraries report local saving and can dismiss a migration notice', () => {
  const controller = new WorkspaceController(workspaceFixture(), { desktop: desktopFiles(), session: 'session', persisted: true, notice: 'Your boards now save automatically.' })
  assert.equal(controller.getSnapshot().status, 'Saved on this device')
  assert.equal(controller.getSnapshot().notice, 'Your boards now save automatically.')
  controller.dismissNotice()
  assert.equal(controller.getSnapshot().notice, null)
  controller.dispose()
}))
cases.push(test('board style is saved with the workspace', async () => {
  let saved: unknown
  const desktop = desktopFiles({ save: value => { saved = value.workspace.appearance; return Promise.resolve({ session: value.session, revision: value.workspace.revision, savedAt: Date.now() }) } })
  const controller = new WorkspaceController(workspaceFixture(), { desktop, session: 'session', persisted: true })
  const revision = controller.getSnapshot().workspace.revision
  assert.equal(controller.updateAppearance({ palette: 'lavender', pattern: 'gingham', tone: 'tint' }), true)
  assert.deepEqual(controller.getSnapshot().workspace.appearance, { palette: 'lavender', pattern: 'gingham', tone: 'tint' })
  assert.equal(controller.getSnapshot().workspace.revision, revision + 1)
  assert.equal(controller.updateAppearance({ palette: 'lavender', pattern: 'gingham', tone: 'tint' }), true)
  assert.equal(controller.getSnapshot().workspace.revision, revision + 1, 'choosing the current style is not a change')
  await controller.flush()
  assert.deepEqual(saved, { palette: 'lavender', pattern: 'gingham', tone: 'tint' })
  assert.doesNotThrow(() => parseWorkspace(controller.getSnapshot().workspace))
  controller.dispose()
}))
cases.push(test('failed close keeps edits exportable and a later retry can save them', async () => {
  let available = false
  let exported: unknown
  const desktop = desktopFiles({
    save: value => available ? Promise.resolve({ session: value.session, revision: value.workspace.revision, savedAt: 1 }) : Promise.reject(new Error('Disk unavailable')),
    exportCopy: workspace => { exported = workspace; return Promise.resolve(true) },
  })
  const controller = new WorkspaceController(workspaceFixture(), { desktop, session: 'session', persisted: true })
  controller.updateCatalog({ ...controller.getSnapshot().workspace.catalog, activeId: 'board-b' })
  await assert.rejects(controller.prepareClose(), /Disk unavailable/)
  assert.equal(controller.getSnapshot().busy, false)
  assert.equal(controller.hasUnsavedChanges(), true)
  await controller.exportCopy()
  assert.deepEqual(exported, controller.getSnapshot().workspace)
  available = true
  await controller.flush()
  assert.equal(controller.hasUnsavedChanges(), false)
  assert.equal(controller.getSnapshot().status, 'Saved on this device')
  controller.dispose()
}))
cases.push(test('a failed additive import does not publish imported boards', async () => {
  const fixture = workspaceFixture()
  const desktop = desktopFiles({ save: () => Promise.reject(new Error('Disk full')) })
  const controller = new WorkspaceController(fixture, { desktop, session: 'session', persisted: true })
  const file = new File([Uint8Array.from(encodeWorkspace(fixture)).buffer], 'backup.unfold')
  await assert.rejects(controller.importCopy(file), /Disk full/)
  assert.equal(controller.getSnapshot().workspace.catalog.boards.length, 2)
  assert.equal(controller.getSnapshot().busy, false)
  controller.dispose()
}))
cases.push(test('catalog edits are fenced while an import commit is pending', async () => {
  let complete: () => void = () => {}
  const waiting = new Promise<void>(resolve => { complete = resolve })
  const desktop = desktopFiles({ save: async value => { await waiting; return { session: value.session, revision: value.workspace.revision, savedAt: 1 } } })
  const controller = new WorkspaceController(workspaceFixture(), { desktop, session: 'session', persisted: true })
  const file = new File([Uint8Array.from(encodeWorkspace(workspaceFixture())).buffer], 'backup.unfold')
  const importing = controller.importCopy(file)
  // File reading precedes the exclusive commit phase.
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(controller.getSnapshot().busy, true)
  assert.equal(controller.updateCatalog({ ...controller.getSnapshot().workspace.catalog, activeId: 'board-b' }), false)
  complete(); await importing
  assert.equal(controller.getSnapshot().workspace.catalog.boards.length, 4)
  assert.equal(controller.getSnapshot().workspace.catalog.activeId, 'board-a')
  controller.dispose()
}))
cases.push(test('fresh desktop close saves without a destination and waits for acknowledgment', async () => {
  let complete: () => void = () => {}
  const waiting = new Promise<void>(resolve => { complete = resolve })
  let saved = false
  const desktop = desktopFiles({ save: async value => { await waiting; saved = true; return { session: value.session, revision: value.workspace.revision, savedAt: 1 } } })
  const controller = new WorkspaceController(emptyWorkspace(), { desktop, session: 'session', persisted: false })
  const closing = controller.prepareClose()
  assert.equal(controller.getSnapshot().busy, true)
  assert.equal(saved, false)
  assert.equal(controller.updateCatalog({ ...controller.getSnapshot().workspace.catalog, activeId: 'board-a' }), false)
  complete()
  assert.equal(await closing, true)
  assert.equal(saved, true)
  assert.equal(controller.getSnapshot().busy, true)
  controller.dispose()
}))

await Promise.all(cases)
