import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { z } from 'zod'
import { decodeWorkspace, encodeWorkspace, type Workspace } from '../shared/workspace-format'
import type { DesktopAck, DesktopSave, DesktopSession } from '../shared/desktop-contract'

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const MAX_BYTES = 256 * 1024 * 1024
const RecoverySchema = z.object({ bytes: z.array(z.number().int().min(0).max(255)).max(MAX_BYTES), source: z.string().nullable(), fingerprint: z.string().nullable(), revision: z.number() })
type RecoveryChoice = 'saved' | 'recovery'
export class RecoveryConflictError extends Error {
  constructor(readonly sourceName: string, readonly savedAvailable = true) { super(savedAvailable ? 'Saved boards and recovery contain different versions. Choose which version to keep.' : 'The saved library is unavailable. You can recover your boards from its checkpoint.') }
}
export async function atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  const file = await open(temporary, 'wx', 0o600)
  try { await file.writeFile(bytes); await file.sync() } catch (error) { await file.close(); await unlink(temporary).catch(() => {}); throw error }
  await file.close()
  try { await rename(temporary, path) } catch (error) { await unlink(temporary).catch(() => {}); throw error }
  const directory = await open(dirname(path), 'r').catch(() => null)
  if (directory) { try { await directory.sync() } catch { /* Directory syncing is platform dependent. */ } finally { await directory.close() } }
}
function missing(error: unknown) { return error instanceof Error && 'code' in error && error.code === 'ENOENT' }
async function readBytes(path: string) {
  const file = await open(path, 'r')
  try { const info = await file.stat(); if (info.size > MAX_BYTES) throw new Error('Workspace file is too large.'); return new Uint8Array(await file.readFile()) } finally { await file.close() }
}
async function optionalBytes(path: string) { try { return await readBytes(path) } catch (error) { if (missing(error)) return null; throw error } }
async function readRecovery(path: string) {
  try { return RecoverySchema.parse(JSON.parse(await readFile(path, 'utf8'))) } catch (error) { if (missing(error)) return null; throw error }
}
function decoded(bytes: Uint8Array | null) { if (!bytes) return null; try { return decodeWorkspace(bytes) } catch { return null } }

export class WorkspaceFiles {
  readonly directory: string
  private readonly libraryPath: string
  private readonly recoveryPath: string
  private readonly legacyPath: string
  private readonly session = randomUUID()
  private fingerprint: string | null = null
  private revision = -1
  private workspace: Workspace | null = null
  private loaded = false
  private unreadableRecovery = false
  private queue: Promise<unknown> = Promise.resolve()
  constructor(userData: string) {
    this.directory = join(userData, 'workspaces')
    this.libraryPath = join(this.directory, 'default.unfold')
    this.recoveryPath = join(this.directory, 'recovery.json')
    this.legacyPath = join(userData, 'workspace-recovery.json')
  }
  private serial<T>(operation: () => Promise<T> | T): Promise<T> {
    const next = this.queue.then(operation)
    this.queue = next.catch(() => {})
    return next
  }
  private state(notice: string | null = null): DesktopSession { return { session: this.session, workspace: this.workspace, notice } }
  private accept(workspace: Workspace, bytes: Uint8Array) { this.workspace = workspace; this.revision = workspace.revision; this.fingerprint = digest(bytes); this.loaded = true }
  private async checkpoint(bytes: Uint8Array) {
    if (this.unreadableRecovery) {
      await rename(this.recoveryPath, this.recoveryPath + `.unreadable-${randomUUID()}`)
      this.unreadableRecovery = false
    }
    await atomicWrite(this.recoveryPath, new TextEncoder().encode(JSON.stringify({ bytes: Array.from(bytes), source: this.libraryPath, fingerprint: this.fingerprint, revision: this.revision })))
  }
  private async preserve(bytes: Uint8Array, label: string) { await atomicWrite(join(this.directory, `${label}-${randomUUID()}.unfold`), bytes) }
  async load(choice?: RecoveryChoice): Promise<DesktopSession> {
    return this.serial(async () => {
      if (this.loaded) return this.state()
      const current = await optionalBytes(this.libraryPath)
      let recovery: z.infer<typeof RecoverySchema> | null = null
      try { recovery = await readRecovery(this.recoveryPath) } catch (error) {
        if (!decoded(current)) throw new Error('Your saved library and its recovery could not be read. Restore a backup to recover your boards.', { cause: error })
        this.unreadableRecovery = true
      }
      if (current || recovery) {
        const saved = decoded(current)
        const recoveryBytes = recovery ? new Uint8Array(recovery.bytes) : null
        const recovered = decoded(recoveryBytes)
        if (recovery && !recovered) this.unreadableRecovery = true
        if (recovered && recoveryBytes && (!current || digest(current) !== digest(recoveryBytes))) {
          if (!choice) throw new RecoveryConflictError('Unfold library', saved !== null)
          if (choice === 'recovery') {
            if (current) await this.preserve(current, 'before-recovery')
            await atomicWrite(this.libraryPath, recoveryBytes)
            this.accept(recovered, recoveryBytes)
          } else if (saved && current) {
            await this.preserve(recoveryBytes, 'recovered-edits')
            this.accept(saved, current)
          } else throw new Error('The saved library is unavailable. Choose recovery or restore a backup.')
        } else if (saved && current) this.accept(saved, current)
        else throw new Error('Your saved library could not be read. Restore a backup to recover your boards.')
        await this.checkpoint(await readBytes(this.libraryPath)).catch(() => {})
        return this.state()
      }
      let legacy: z.infer<typeof RecoverySchema> | null
      try { legacy = await readRecovery(this.legacyPath) } catch (error) { throw new Error('Your previous recovery workspace could not be read. Restore a backup to recover your boards. Original files are unchanged.', { cause: error }) }
      if (!legacy) { this.loaded = true; return this.state() }
      let bytes = new Uint8Array(legacy.bytes)
      decodeWorkspace(bytes)
      if (legacy.source) {
        const original = await optionalBytes(legacy.source).catch(() => null)
        const saved = decoded(original)
        if (original && saved) {
          if (digest(original) !== digest(bytes) && !choice) throw new RecoveryConflictError(basename(legacy.source))
          if (digest(original) === digest(bytes) || choice === 'saved') bytes = original
        } else if (choice === 'saved') throw new Error('The saved workspace is unavailable. Choose recovery or restore a backup.')
      }
      await atomicWrite(this.libraryPath, bytes)
      const verified = decodeWorkspace(await readBytes(this.libraryPath))
      this.accept(verified, bytes)
      await this.checkpoint(bytes).catch(() => {})
      return this.state('Your boards now save automatically in Unfold. Your original workspace files and recovery copy are unchanged.')
    })
  }
  async restoreFile(path: string): Promise<DesktopSession> {
    return this.serial(async () => {
      if (this.loaded) throw new Error('Your library is already open. Use Import to add boards from a backup.')
      const bytes = await readBytes(path), workspace = decodeWorkspace(bytes)
      const current = await optionalBytes(this.libraryPath)
      if (current) await this.preserve(current, 'before-restore')
      const recovery = await optionalBytes(this.recoveryPath)
      if (recovery) await atomicWrite(this.recoveryPath + `.before-restore-${randomUUID()}`, recovery)
      await atomicWrite(this.libraryPath, bytes)
      this.accept(workspace, bytes)
      await this.checkpoint(bytes).catch(() => {})
      return this.state('Your backup was copied into Unfold. Your boards now save automatically on this device.')
    })
  }
  async save(value: DesktopSave): Promise<DesktopAck> {
    return this.serial(async () => {
      if (!this.loaded || value.session !== this.session) throw new Error('This library session is not open.')
      if (value.workspace.revision < this.revision) throw new Error('An older workspace revision cannot overwrite newer work.')
      const bytes = encodeWorkspace(value.workspace)
      if (bytes.byteLength > MAX_BYTES) throw new Error('Workspace file is too large.')
      // Preserve current edits even when the canonical file cannot be replaced.
      await this.checkpoint(bytes).catch(() => {})
      const current = await optionalBytes(this.libraryPath)
      if ((current ? digest(current) : null) !== this.fingerprint) throw new Error('Saved boards changed outside Unfold. Export a backup of your edits, then reopen Unfold to choose a version.')
      if (current) await atomicWrite(join(this.directory, 'previous.unfold'), current).catch(() => {})
      await atomicWrite(this.libraryPath, bytes)
      this.accept(value.workspace, bytes)
      await this.checkpoint(bytes).catch(() => {})
      return { session: this.session, revision: this.revision, savedAt: Date.now() }
    })
  }
}
