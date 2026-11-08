import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { z } from 'zod'
import { decodeWorkspace, encodeWorkspace, type Workspace } from '../shared/workspace-format'
import type { DesktopAck, DesktopSave, DesktopSession } from '../shared/desktop-contract'

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const MAX_BYTES = 256 * 1024 * 1024
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
async function readBytes(path: string) {
  const file = await open(path, 'r')
  try { const info = await file.stat(); if (info.size > MAX_BYTES) throw new Error('Workspace file is too large.'); return new Uint8Array(await file.readFile()) } finally { await file.close() }
}
export class WorkspaceFiles {
  private session = randomUUID()
  private path: string | null = null
  private fingerprint: string | null = null
  private revision = -1
  private workspace: Workspace | null = null
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly recoveryPath: string) {}
  private serial<T>(operation: () => Promise<T> | T): Promise<T> {
    const next = this.queue.then(operation)
    this.queue = next.catch(() => {})
    return next
  }
  private state(): DesktopSession { return { session: this.session, name: this.path ? basename(this.path) : null, workspace: this.workspace } }
  async load(): Promise<DesktopSession> {
    return this.serial(async () => {
      try {
        const recovery = z.object({ bytes: z.array(z.number().int().min(0).max(255)).max(MAX_BYTES), source: z.string().nullable(), fingerprint: z.string().nullable(), revision: z.number() }).parse(JSON.parse(await readFile(this.recoveryPath, 'utf8')))
        const bytes = new Uint8Array(recovery.bytes)
        this.workspace = decodeWorkspace(bytes)
        this.revision = this.workspace.revision
        if (recovery.source && recovery.fingerprint && digest(bytes) === recovery.fingerprint) {
          const original = await readBytes(recovery.source).catch(() => null)
          if (original && digest(original) === recovery.fingerprint) { this.path = recovery.source; this.fingerprint = recovery.fingerprint }
        }
        // Conflicting or unsaved recovery is untitled; original files cannot be silently overwritten.
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw new Error('The recovery workspace could not be read. Your original workspace files are unchanged.', { cause: error })
      }
      return this.state()
    })
  }
  async newWorkspace(): Promise<DesktopSession> {
    return this.serial(() => { this.session = randomUUID(); this.path = null; this.fingerprint = null; this.revision = -1; this.workspace = null; return this.state() })
  }
  async openFile(path: string): Promise<DesktopSession> {
    return this.serial(async () => {
      const bytes = await readBytes(path); const workspace = decodeWorkspace(bytes)
      await atomicWrite(this.recoveryPath, new TextEncoder().encode(JSON.stringify({ bytes: Array.from(bytes), source: path, fingerprint: digest(bytes), revision: workspace.revision })))
      this.session = randomUUID(); this.path = path; this.fingerprint = digest(bytes); this.workspace = workspace; this.revision = workspace.revision
      return this.state()
    })
  }
  private async recover(bytes: Uint8Array) { await atomicWrite(this.recoveryPath, new TextEncoder().encode(JSON.stringify({ bytes: Array.from(bytes), source: this.path, fingerprint: this.fingerprint, revision: this.revision }))) }
  async save(value: DesktopSave, destination?: string): Promise<DesktopAck> {
    return this.serial(async () => {
      if (value.session !== this.session) throw new Error('This workspace session has closed.')
      if (value.workspace.revision < this.revision) throw new Error('An older workspace revision cannot overwrite newer work.')
      const bytes = encodeWorkspace(value.workspace)
      if (bytes.byteLength > MAX_BYTES) throw new Error('Workspace file is too large.')
      // Checkpoint current edits independently before a conflict or target write can fail.
      const recoveryFailure: unknown = await this.recover(bytes).then(() => null, (error: unknown) => error)
      if (!destination && !this.path && recoveryFailure) throw recoveryFailure instanceof Error ? recoveryFailure : new Error('Could not save recovery.')
      if (this.path && (!destination || destination === this.path)) {
        const current = await readBytes(this.path).catch(() => null)
        if (!current || digest(current) !== this.fingerprint) throw new Error('The workspace file changed outside Unfold. Use Save As to keep your changes.')
        await atomicWrite(this.recoveryPath + '.previous', current).catch(() => {})
      }
      const path = destination ?? this.path
      if (path) {
        await atomicWrite(path, bytes)
        this.path = path; this.fingerprint = digest(bytes)
      }
      this.workspace = value.workspace; this.revision = value.workspace.revision
      await this.recover(bytes).catch(() => {})
      return { session: this.session, revision: this.revision, name: this.path ? basename(this.path) : null, savedAt: Date.now() }
    })
  }
}
