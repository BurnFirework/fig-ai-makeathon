import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, readdir, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { workspaceFixture } from './workspace-fixture'
import { atomicWrite, WorkspaceFiles } from '../desktop/workspace-files'
import { decodeWorkspace, type Workspace } from '../shared/workspace-format'

function fixture(revision = 0): Workspace {
  return { ...workspaceFixture(), revision }
}
const cases: Promise<void>[] = []
cases.push(test('desktop files save, reopen target after restart, reject stale sessions and external edits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'unfold-file-test-'))
  try {
    const recovery = join(directory, 'recovery.json'), target = join(directory, 'test.unfold')
    const files = new WorkspaceFiles(recovery)
    const initial = await files.load()
    await files.save({ session: initial.session, workspace: fixture() }, target)
    assert.equal(decodeWorkspace(new Uint8Array(await readFile(target))).id, 'workspace-fixture')
    await files.save({ session: initial.session, workspace: fixture(1) })
    assert.equal(decodeWorkspace(new Uint8Array(await readFile(recovery + '.previous'))).revision, 0)
    await assert.rejects(files.save({ session: initial.session, workspace: fixture(0) }), /older/)
    const reopened = await new WorkspaceFiles(recovery).load()
    assert.equal(reopened.name, 'test.unfold')
    assert.equal(reopened.workspace?.revision, 1)
    await writeFile(target, 'external edit')
    await assert.rejects(files.save({ session: initial.session, workspace: fixture(2) }), /changed outside/)
    assert.equal(await readFile(target, 'utf8'), 'external edit')
    const recovered = await new WorkspaceFiles(recovery).load()
    assert.equal(recovered.name, null)
    assert.equal(recovered.workspace?.revision, 2)
    await files.newWorkspace()
    await assert.rejects(files.save({ session: initial.session, workspace: fixture(3) }), /session has closed/)
  } finally { await rm(directory, { recursive: true, force: true }) }
}))
cases.push(test('atomic replacement failure preserves existing content and cleans temporary files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'unfold-atomic-test-'))
  try {
    const target = join(directory, 'target')
    await mkdir(target)
    await writeFile(join(target, 'original'), 'safe')
    await assert.rejects(atomicWrite(target, new Uint8Array([1, 2, 3])))
    assert.equal(await readFile(join(target, 'original'), 'utf8'), 'safe')
    assert.deepEqual(await readdir(directory), ['target'])
  } finally { await rm(directory, { recursive: true, force: true }) }
}))

cases.push(test('Save As can save to a healthy destination when recovery storage is unavailable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'unfold-saveas-test-'))
  try {
    const recovery = join(directory, 'unwritable-recovery')
    await mkdir(recovery)
    const files = new WorkspaceFiles(recovery)
    const session = await files.newWorkspace()
    const target = join(directory, 'copy.unfold')
    const ack = await files.save({ session: session.session, workspace: fixture(1) }, target)
    assert.equal(ack.name, 'copy.unfold')
    assert.equal(decodeWorkspace(new Uint8Array(await readFile(target))).revision, 1)
  } finally { await rm(directory, { recursive: true, force: true }) }
}))

cases.push(test('a healthy working file still saves if the recovery directory becomes unavailable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'unfold-recovery-test-'))
  try {
    const recoveryDirectory = join(directory, 'recovery')
    const files = new WorkspaceFiles(join(recoveryDirectory, 'current.json'))
    const initial = await files.load(), target = join(directory, 'working.unfold')
    await files.save({ session: initial.session, workspace: fixture(0) }, target)
    await rm(recoveryDirectory, { recursive: true })
    await writeFile(recoveryDirectory, 'unavailable directory')
    const ack = await files.save({ session: initial.session, workspace: fixture(1) })
    assert.equal(ack.revision, 1)
    assert.equal(decodeWorkspace(new Uint8Array(await readFile(target))).revision, 1)
  } finally { await rm(directory, { recursive: true, force: true }) }
}))

await Promise.all(cases)
