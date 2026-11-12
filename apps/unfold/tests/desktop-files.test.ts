import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, readdir, mkdir, chmod } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { workspaceFixture } from './workspace-fixture'
import { atomicWrite, RecoveryConflictError, WorkspaceFiles } from '../desktop/workspace-files'
import { decodeWorkspace, encodeWorkspace, type Workspace } from '../shared/workspace-format'

function fixture(revision = 0): Workspace { return { ...workspaceFixture(), revision } }
async function directory(t: TestContext) {
  const path = await mkdtemp(join(tmpdir(), 'unfold-files-'))
  t.after(() => rm(path, { recursive: true, force: true }))
  return path
}
async function seedLegacy(root: string, recovered: Workspace, saved?: Workspace) {
  const source = saved ? join(root, 'Original.unfold') : null
  const savedBytes = saved ? encodeWorkspace(saved) : null
  if (source && savedBytes) await writeFile(source, savedBytes)
  const checkpoint = JSON.stringify({ bytes: Array.from(recovered === saved && savedBytes ? savedBytes : encodeWorkspace(recovered)), source, fingerprint: savedBytes ? createHash('sha256').update(savedBytes).digest('hex') : null, revision: recovered.revision })
  await writeFile(join(root, 'workspace-recovery.json'), checkpoint)
  return { source, checkpoint, savedBytes }
}
const cases: Promise<void>[] = []
cases.push(test('desktop automatically saves and reopens its managed library, rejecting stale writers', async t => {
  const root = await directory(t), files = new WorkspaceFiles(root)
  const initial = await files.load()
  assert.equal(initial.workspace, null)
  await files.save({ session: initial.session, workspace: fixture() })
  const library = join(root, 'workspaces', 'default.unfold')
  assert.equal(decodeWorkspace(new Uint8Array(await readFile(library))).id, 'workspace-fixture')
  await files.save({ session: initial.session, workspace: fixture(1) })
  assert.equal(decodeWorkspace(new Uint8Array(await readFile(join(root, 'workspaces', 'previous.unfold')))).revision, 0)
  await assert.rejects(files.save({ session: initial.session, workspace: fixture(0) }), /older/)
  const reopened = new WorkspaceFiles(root), loaded = await reopened.load()
  assert.equal(loaded.workspace?.revision, 1)
  assert.equal(loaded.notice, null)
  await assert.rejects(reopened.save({ session: initial.session, workspace: fixture(2) }), /session is not open/)
  // A load must checkpoint the actual archive bytes, not a re-encoding with new ZIP timestamps.
  assert.equal((await new WorkspaceFiles(root).load()).workspace?.revision, 1)
}))
cases.push(test('legacy saved work migrates without changing source files and is not imported again', async t => {
  const root = await directory(t)
  const workspace = fixture(2), legacy = await seedLegacy(root, workspace, workspace)
  const files = new WorkspaceFiles(root), loaded = await files.load()
  assert.equal(loaded.workspace?.revision, 2)
  assert.match(loaded.notice ?? '', /now save automatically/)
  assert.equal(await readFile(join(root, 'workspace-recovery.json'), 'utf8'), legacy.checkpoint)
  if (!legacy.source || !legacy.savedBytes) throw new Error('Legacy file missing')
  assert.deepEqual(new Uint8Array(await readFile(legacy.source)), legacy.savedBytes)
  await files.save({ session: loaded.session, workspace: fixture(3) })
  await writeFile(legacy.source, encodeWorkspace(fixture(9)))
  const reopened = await new WorkspaceFiles(root).load()
  assert.equal(reopened.workspace?.revision, 3)
  assert.equal(reopened.notice, null)
  assert.equal(await readFile(join(root, 'workspace-recovery.json'), 'utf8'), legacy.checkpoint)
}))
for (const choice of ['saved', 'recovery'] as const) {
  cases.push(test(`legacy divergence requires a choice and preserves both originals when choosing ${choice}`, async t => {
    const root = await directory(t)
    const legacy = await seedLegacy(root, fixture(2), fixture(1))
    const files = new WorkspaceFiles(root)
    await assert.rejects(files.load(), RecoveryConflictError)
    await assert.rejects(readFile(join(root, 'workspaces', 'default.unfold')), { code: 'ENOENT' })
    assert.equal((await files.load(choice)).workspace?.revision, choice === 'saved' ? 1 : 2)
    assert.equal(await readFile(join(root, 'workspace-recovery.json'), 'utf8'), legacy.checkpoint)
    if (!legacy.source || !legacy.savedBytes) throw new Error('Legacy file missing')
    assert.deepEqual(new Uint8Array(await readFile(legacy.source)), legacy.savedBytes)
  }))
}
cases.push(test('untitled recovery migrates automatically and a failed migration can be retried', async t => {
  const root = await directory(t), legacy = await seedLegacy(root, fixture(4))
  await writeFile(join(root, 'workspaces'), 'blocked destination')
  await assert.rejects(new WorkspaceFiles(root).load())
  assert.equal(await readFile(join(root, 'workspace-recovery.json'), 'utf8'), legacy.checkpoint)
  await rm(join(root, 'workspaces'))
  const files = new WorkspaceFiles(root)
  assert.equal((await files.load()).workspace?.revision, 4)
  assert.equal((await new WorkspaceFiles(root).load()).workspace?.revision, 4)
  assert.equal(await readFile(join(root, 'workspace-recovery.json'), 'utf8'), legacy.checkpoint)
}))
cases.push(test('corrupt legacy recovery cannot initialize an empty replacement; backup restore copies safely', async t => {
  const root = await directory(t)
  await writeFile(join(root, 'workspace-recovery.json'), '{truncated')
  const files = new WorkspaceFiles(root)
  await assert.rejects(files.load(), /previous recovery workspace could not be read/)
  await assert.rejects(readFile(join(root, 'workspaces', 'default.unfold')), { code: 'ENOENT' })
  const backup = join(root, 'backup.unfold'), bytes = encodeWorkspace(fixture(3))
  await writeFile(backup, bytes)
  assert.equal((await files.restoreFile(backup)).workspace?.revision, 3)
  assert.deepEqual(new Uint8Array(await readFile(backup)), bytes)
  assert.equal(await readFile(join(root, 'workspace-recovery.json'), 'utf8'), '{truncated')
  assert.equal((await new WorkspaceFiles(root).load()).workspace?.revision, 3)
}))
cases.push(test('external edits stop autosave while current edits remain recoverable', async t => {
  const root = await directory(t), files = new WorkspaceFiles(root), initial = await files.load()
  await files.save({ session: initial.session, workspace: fixture(1) })
  const library = join(root, 'workspaces', 'default.unfold'), external = encodeWorkspace(fixture(8))
  await writeFile(library, external)
  await assert.rejects(files.save({ session: initial.session, workspace: fixture(2) }), /changed outside/)
  assert.deepEqual(new Uint8Array(await readFile(library)), external)
  const reopened = new WorkspaceFiles(root)
  await assert.rejects(reopened.load(), RecoveryConflictError)
  assert.equal((await reopened.load('saved')).workspace?.revision, 8)
  const recovered = (await readdir(join(root, 'workspaces'))).find(name => name.startsWith('recovered-edits-'))
  assert.ok(recovered)
  assert.equal(decodeWorkspace(new Uint8Array(await readFile(join(root, 'workspaces', recovered)))).revision, 2)
}))
cases.push(test('a corrupt library offers recovery and preserves damaged bytes before replacement', async t => {
  const root = await directory(t), files = new WorkspaceFiles(root), initial = await files.load()
  await files.save({ session: initial.session, workspace: fixture(2) })
  const library = join(root, 'workspaces', 'default.unfold')
  await writeFile(library, 'damaged library')
  const reopened = new WorkspaceFiles(root)
  await assert.rejects(reopened.load(), error => error instanceof RecoveryConflictError && !error.savedAvailable)
  assert.equal(await readFile(library, 'utf8'), 'damaged library')
  assert.equal((await reopened.load('recovery')).workspace?.revision, 2)
  const backup = (await readdir(join(root, 'workspaces'))).find(name => name.startsWith('before-recovery-'))
  assert.ok(backup)
  assert.equal(await readFile(join(root, 'workspaces', backup), 'utf8'), 'damaged library')
}))
cases.push(test('damaged library and recovery remain preserved when restoring a valid backup', async t => {
  const root = await directory(t)
  const data = join(root, 'workspaces')
  await mkdir(data)
  await writeFile(join(data, 'default.unfold'), 'damaged library')
  await writeFile(join(data, 'recovery.json'), '{truncated')
  const files = new WorkspaceFiles(root)
  await assert.rejects(files.load(), /library and its recovery could not be read/)
  const invalid = join(root, 'invalid.unfold')
  await writeFile(invalid, 'invalid backup')
  await assert.rejects(files.restoreFile(invalid))
  assert.equal(await readFile(join(data, 'default.unfold'), 'utf8'), 'damaged library')
  const backup = join(root, 'backup.unfold'), bytes = encodeWorkspace(fixture(5))
  await writeFile(backup, bytes)
  assert.equal((await files.restoreFile(backup)).workspace?.revision, 5)
  const names = await readdir(data)
  const oldLibrary = names.find(name => name.startsWith('before-restore-'))
  const oldRecovery = names.find(name => name.startsWith('recovery.json.before-restore-'))
  assert.ok(oldLibrary); assert.ok(oldRecovery)
  assert.equal(await readFile(join(data, oldLibrary), 'utf8'), 'damaged library')
  assert.equal(await readFile(join(data, oldRecovery), 'utf8'), '{truncated')
}))
cases.push(test('a healthy library opens despite a damaged recovery copy, preserving it separately', async t => {
  const root = await directory(t), files = new WorkspaceFiles(root), initial = await files.load()
  await files.save({ session: initial.session, workspace: fixture(1) })
  const data = join(root, 'workspaces')
  await writeFile(join(data, 'recovery.json'), '{truncated')
  assert.equal((await new WorkspaceFiles(root).load()).workspace?.revision, 1)
  const preserved = (await readdir(data)).find(name => name.startsWith('recovery.json.unreadable-'))
  assert.ok(preserved)
  assert.equal(await readFile(join(data, preserved), 'utf8'), '{truncated')
}))
cases.push(test('failed disk writes keep the last valid library and can be retried', async t => {
  const root = await directory(t), files = new WorkspaceFiles(root), initial = await files.load()
  await files.save({ session: initial.session, workspace: fixture(1) })
  const data = join(root, 'workspaces')
  await chmod(data, 0o500)
  try { await assert.rejects(files.save({ session: initial.session, workspace: fixture(2) })) } finally { await chmod(data, 0o700) }
  assert.equal(decodeWorkspace(new Uint8Array(await readFile(join(data, 'default.unfold')))).revision, 1)
  assert.equal((await files.save({ session: initial.session, workspace: fixture(2) })).revision, 2)
}))
cases.push(test('a healthy library still saves if the recovery destination becomes unavailable', async t => {
  const root = await directory(t), files = new WorkspaceFiles(root), initial = await files.load()
  await files.save({ session: initial.session, workspace: fixture(1) })
  const recovery = join(root, 'workspaces', 'recovery.json')
  await rm(recovery)
  await mkdir(recovery)
  assert.equal((await files.save({ session: initial.session, workspace: fixture(2) })).revision, 2)
  assert.equal(decodeWorkspace(new Uint8Array(await readFile(join(root, 'workspaces', 'default.unfold')))).revision, 2)
}))
cases.push(test('atomic replacement failure preserves existing content and cleans temporary files', async t => {
  const root = await directory(t), target = join(root, 'target')
  await mkdir(target)
  await writeFile(join(target, 'original'), 'safe')
  await assert.rejects(atomicWrite(target, new Uint8Array([1, 2, 3])))
  assert.equal(await readFile(join(target, 'original'), 'utf8'), 'safe')
  assert.deepEqual(await readdir(root), ['target'])
}))

await Promise.all(cases)
