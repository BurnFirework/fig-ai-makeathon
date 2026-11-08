import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WorkspaceController, emptyWorkspace } from '../client/workspace'
import { encodeWorkspace, parseWorkspace } from '../shared/workspace-format'
import type { DesktopFiles } from '../shared/desktop-contract'
import { workspaceFixture } from './workspace-fixture'

function desktopFiles(overrides: Partial<DesktopFiles> = {}): DesktopFiles {
  return {
    load: () => Promise.resolve({ workspace: null, session: 'session', name: null }),
    save: value => Promise.resolve({ session: value.session, revision: value.workspace.revision, name: 'project.unfold', savedAt: Date.now() }),
    saveAs: value => Promise.resolve({ session: value.session, revision: value.workspace.revision, name: 'copy.unfold', savedAt: Date.now() }),
    open: () => Promise.resolve(null),
    newWorkspace: () => Promise.resolve({ workspace: null, session: 'new', name: null }),
    exportCopy: () => Promise.resolve(true), markDirty() {}, subscribeCommands: () => () => {}, onCloseRequested: () => () => {}, closeReady: () => Promise.resolve(),
    ...overrides,
  }
}
const cases: Promise<void>[] = []
cases.push(test('fresh workspaces contain a valid document and page before the first editor mounts', () => {
  assert.doesNotThrow(() => parseWorkspace(emptyWorkspace()))
}))
cases.push(test('board style is saved with the workspace', async () => {
  let saved: unknown
  const desktop = desktopFiles({ save: value => { saved = value.workspace.appearance; return Promise.resolve({ session: value.session, revision: value.workspace.revision, name: 'project.unfold', savedAt: Date.now() }) } })
  const controller = new WorkspaceController(workspaceFixture(), { desktop, session: 'session', name: 'project.unfold', persisted: true })
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
cases.push(test('Save As recovers after the original destination fails', async () => {
  let copies = 0
  const desktop = desktopFiles({ save: () => Promise.reject(new Error('Disk unavailable')), saveAs: value => { copies++; return Promise.resolve({ session: value.session, revision: value.workspace.revision, name: 'copy.unfold', savedAt: 1 }) } })
  const controller = new WorkspaceController(workspaceFixture(), { desktop, session: 'session', name: 'project.unfold', persisted: true })
  controller.updateCatalog({ ...controller.getSnapshot().workspace.catalog, activeId: 'board-b' })
  await assert.rejects(controller.flush(), /Disk unavailable/)
  assert.equal(await controller.saveAs(), true)
  assert.equal(copies, 1)
  assert.equal(controller.getSnapshot().name, 'copy.unfold')
  controller.dispose()
}))
cases.push(test('a failed additive import does not publish imported boards', async () => {
  const fixture = workspaceFixture()
  const desktop = desktopFiles({ save: () => Promise.reject(new Error('Disk full')) })
  const controller = new WorkspaceController(fixture, { desktop, session: 'session', name: 'project.unfold', persisted: true })
  const file = new File([Uint8Array.from(encodeWorkspace(fixture)).buffer], 'backup.unfold')
  await assert.rejects(controller.importCopy(file), /Disk full/)
  assert.equal(controller.getSnapshot().workspace.catalog.boards.length, 2)
  assert.equal(controller.getSnapshot().busy, false)
  controller.dispose()
}))
cases.push(test('catalog edits are fenced while a file lifecycle operation is pending', async () => {
  let complete: () => void = () => {}
  const waiting = new Promise<void>(resolve => { complete = resolve })
  const controller = new WorkspaceController(workspaceFixture(), { desktop: desktopFiles({ open: async () => { await waiting; return null } }), session: 'session', name: 'project.unfold', persisted: true })
  const opening = controller.openFile()
  assert.equal(controller.getSnapshot().busy, true)
  assert.equal(controller.updateCatalog({ ...controller.getSnapshot().workspace.catalog, activeId: 'board-b' }), false)
  complete(); await opening
  assert.equal(controller.getSnapshot().workspace.catalog.activeId, 'board-a')
  controller.dispose()
}))

cases.push(test('named-file close stays fenced until its final save is acknowledged', async () => {
  let complete: () => void = () => {}
  const waiting = new Promise<void>(resolve => { complete = resolve })
  const desktop = desktopFiles({ save: async value => { await waiting; return { session: value.session, revision: value.workspace.revision, name: 'project.unfold', savedAt: 1 } } })
  const controller = new WorkspaceController(workspaceFixture(), { desktop, session: 'session', name: 'project.unfold', persisted: true })
  controller.updateCatalog({ ...controller.getSnapshot().workspace.catalog, activeId: 'board-b' })
  const closing = controller.prepareClose()
  assert.equal(controller.getSnapshot().busy, true)
  assert.equal(controller.updateCatalog({ ...controller.getSnapshot().workspace.catalog, activeId: 'board-a' }), false)
  complete()
  assert.equal(await closing, true)
  assert.equal(controller.getSnapshot().busy, true)
  controller.dispose()
}))

await Promise.all(cases)
