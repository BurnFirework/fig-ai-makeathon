import { createTLStore, loadSnapshot, type Editor, type TLAsset, type TLAssetStore, type TLStore } from 'tldraw'
import { createContext } from 'react'
import { z } from 'zod'
import { decodeWorkspace, encodeWorkspace, mergeWorkspaces, parseWorkspace, workspaceTLSchema, MAX_WORKSPACE_BYTES, type Workspace } from '../shared/workspace-format'
import type { DesktopFiles } from '../shared/desktop-contract'
import { type BoardCatalog, initialBoardCatalog } from './boards'
import { actions, uiState } from './actions'
import { commitBrowserWorkspace } from './platform/browser-storage'

export const WorkspaceContext = createContext<WorkspaceController | null>(null)

export function emptyWorkspace(): Workspace {
  const store = createTLStore({ schema: workspaceTLSchema })
  store.put([workspaceTLSchema.types.document.validate({ id: 'document:document', typeName: 'document', name: '', gridSize: 10, meta: {} }), workspaceTLSchema.types.page.create({ name: 'Page', index: 'a1' })])
  const document = store.getStoreSnapshot('document')
  store.dispose()
  return { formatVersion: 1, id: crypto.randomUUID(), revision: 0, catalog: initialBoardCatalog(), boards: { 'unfold-board-v1': { document } }, assets: {}, appearance: { palette: 'rose', pattern: 'dots', tone: 'cream' } }
}
export async function assetData(editor: Editor, asset: TLAsset): Promise<Workspace['assets'][string]> {
  const src = await editor.resolveAssetUrl(asset.id, { shouldResolveToOriginal: true })
  if (!src) throw new Error(`An image is unavailable: ${asset.id}. Your existing board has not been changed.`)
  const response = await fetch(src)
  if (!response.ok) throw new Error('An image could not be read. Your existing board has not been changed.')
  const blob = await response.blob()
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read an image.'))
    reader.onload = () => {
      if (typeof reader.result !== 'string') { reject(new Error('Could not read an image.')); return }
      const comma = reader.result.indexOf(',')
      resolve({ mime: z.enum(['image/png', 'image/jpeg', 'image/webp']).parse(blob.type), data: reader.result.slice(comma + 1) })
    }
    reader.readAsDataURL(blob)
  })
}
function download(bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes).buffer], { type: 'application/zip' }))
  const link = document.createElement('a'); link.href = url; link.download = 'Unfold.unfold'; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export interface WorkspaceState { workspace: Workspace; status: string; error: string; name: string | null; generation: number; busy: boolean }
export class WorkspaceController {
  private current: WorkspaceState
  private listeners = new Set<() => void>()
  private editor: Editor | null = null
  private editorBoardId: string | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private pending: Promise<void> = Promise.resolve()
  private expected: { id: string; revision: number } | null
  private session: string
  private closed = false
  readonly desktop: DesktopFiles | undefined
  constructor(workspace: Workspace, options: { desktop?: DesktopFiles; session?: string; name?: string | null; persisted: boolean }) {
    this.desktop = options.desktop
    this.session = options.session ?? ''
    this.expected = options.persisted ? { id: workspace.id, revision: workspace.revision } : null
    this.current = { workspace, status: options.persisted ? (this.desktop ? (options.name ? 'Saved to file' : 'Saved to recovery') : 'Saved in browser') : 'Preparing storage…', error: '', name: options.name ?? null, generation: 0, busy: false }
  }
  getSnapshot = () => this.current
  hasUnsavedChanges = () => Boolean(this.current.error) || this.expected?.id !== this.current.workspace.id || this.expected.revision !== this.current.workspace.revision
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(update: Partial<WorkspaceState>) {
    this.current = { ...this.current, ...update }
    this.listeners.forEach(listener => listener())
  }
  report(error: unknown) { this.publish({ error: error instanceof Error ? error.message : 'The operation could not finish.', status: 'Not saved' }) }
  private change(workspace: Workspace) {
    if (this.closed) return
    this.publish({ workspace: { ...workspace, revision: this.current.workspace.revision + 1 }, status: 'Unsaved changes', error: '' })
    this.desktop?.markDirty()
    if (!this.timer) this.timer = setTimeout(() => { this.timer = undefined; this.flush().catch((error: unknown) => this.report(error)) }, 650)
  }
  updateCatalog(catalog: BoardCatalog): boolean {
    if (this.current.busy) return false
    try {
      this.capture()
      const workspace = this.current.workspace
      const boards = { ...workspace.boards }
      for (const board of catalog.boards) if (!boards[board.id]) boards[board.id] = Object.values(emptyWorkspace().boards)[0] ?? { document: createTLStore({ schema: workspaceTLSchema }).getStoreSnapshot('document') }
      this.change({ ...workspace, catalog, boards })
      return true
    } catch (error) { this.report(error); return false }
  }
  /** Viewer look of the whole workspace (main color, canvas pattern and tone); saved with the workspace. */
  updateAppearance(appearance: Workspace['appearance']): boolean {
    if (this.current.busy) return false
    const current = this.current.workspace.appearance
    if (current.palette === appearance.palette && current.pattern === appearance.pattern && current.tone === appearance.tone) return true
    this.change({ ...this.current.workspace, appearance })
    return true
  }
  private capture() {
    if (!this.editor) return
    const workspace = this.current.workspace
    const document = this.editor.store.getStoreSnapshot('document')
    this.publish({ workspace: { ...workspace, boards: { ...workspace.boards, [this.editorBoardId ?? workspace.catalog.activeId]: { document } } } })
  }
  createStore(): TLStore {
    const assets: TLAssetStore = {
      upload: async (asset, file) => {
        const blob = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onerror = () => reject(new Error('Could not read image.'))
          reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result.slice(reader.result.indexOf(',') + 1)) : reject(new Error('Could not read image.'))
          reader.readAsDataURL(file)
        })
        if (this.current.busy) throw new Error('Wait for the workspace operation before importing an image.')
        this.change({ ...this.current.workspace, assets: { ...this.current.workspace.assets, [asset.id]: { mime: z.enum(['image/png', 'image/jpeg', 'image/webp']).parse(file.type), data: blob } } })
        return { src: asset.id }
      },
      resolve: (asset) => {
        const bytes = this.current.workspace.assets[asset.id]
        return bytes ? `data:${bytes.mime};base64,${bytes.data}` : asset.props.src
      },
    }
    const store = createTLStore({ schema: workspaceTLSchema, assets })
    const board = this.current.workspace.boards[this.current.workspace.catalog.activeId]
    if (!board) throw new Error('The selected board is missing.')
    loadSnapshot(store, board.document)
    return store
  }
  attachEditor(editor: Editor): () => void {
    this.editor = editor
    this.editorBoardId = this.current.workspace.catalog.activeId
    const stop = editor.store.listen(() => {
      this.capture()
      this.change(this.current.workspace)
    }, { scope: 'document' })
    return () => { this.capture(); if (this.editor === editor) this.editor = null; stop() }
  }
  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined }
    this.capture()
    const snapshot = this.current.workspace
    const session = this.session
    this.pending = this.pending.catch(() => undefined).then(async () => {
      if (session !== this.session) return
      if (this.expected?.id === snapshot.id && this.expected.revision === snapshot.revision) return
      this.publish({ status: 'Saving…' })
      if (this.desktop) {
        const ack = await this.desktop.save({ workspace: snapshot, session })
        if (ack.session !== this.session) return
        this.publish({ name: ack.name })
      } else await commitBrowserWorkspace(snapshot, this.expected)
      this.expected = { id: snapshot.id, revision: snapshot.revision }
      if (this.current.workspace.revision === snapshot.revision) this.publish({ status: this.desktop ? (this.current.name ? 'Saved to file' : 'Saved to recovery') : 'Saved in browser', error: '' })
    })
    return this.pending
  }
  async exportCopy() {
    this.capture()
    if (this.desktop) { await this.desktop.exportCopy(this.current.workspace); return }
    download(encodeWorkspace(this.current.workspace))
  }
  private async transition<T>(operation: () => Promise<T>, holdOnSuccess = false): Promise<T> {
    if (this.current.busy) throw new Error('Please wait for the current workspace operation.')
    this.publish({ busy: true })
    this.editor?.updateInstanceState({ isReadonly: true })
    if (this.editor) {
      const api = actions.get(this.editor)
      for (const jobId of Object.keys(uiState.get(this.editor).jobs)) api?.stop(jobId)
    }
    let hold = false
    try { const result = await operation(); hold = holdOnSuccess && result === true; return result } finally { if (!hold) this.cancelClose() }
  }
  async importCopy(file: File) {
    if (file.size > MAX_WORKSPACE_BYTES) throw new Error('Workspace backup is too large.')
    const imported = decodeWorkspace(new Uint8Array(await file.arrayBuffer()))
    await this.transition(async () => {
      await this.flush()
      this.capture()
      const merged = mergeWorkspaces(this.current.workspace, imported)
      if (this.desktop) {
        const ack = await this.desktop.save({ workspace: merged, session: this.session })
        if (ack.session !== this.session) throw new Error('The workspace changed while importing.')
        this.publish({ name: ack.name })
      } else await commitBrowserWorkspace(merged, this.expected)
      this.expected = { id: merged.id, revision: merged.revision }
      this.publish({ workspace: merged, status: this.desktop ? (this.current.name ? 'Saved to file' : 'Saved to recovery') : 'Saved in browser', error: '' })
    })
  }
  private async chooseSaveAs(): Promise<boolean> {
    if (!this.desktop) { await this.exportCopy(); return true }
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined }
    await this.pending.catch(() => undefined)
    this.capture()
    const ack = await this.desktop.saveAs({ workspace: this.current.workspace, session: this.session })
    if (!ack) return false
    this.session = ack.session
    this.expected = { id: this.current.workspace.id, revision: ack.revision }
    this.publish({ name: ack.name, status: 'Saved to file', error: '' })
    return true
  }
  cancelClose() { this.editor?.updateInstanceState({ isReadonly: false }); this.publish({ busy: false }) }
  prepareClose(): Promise<boolean> {
    return this.transition(async () => {
      if (!this.current.name) return await this.chooseSaveAs()
      await this.flush()
      return true
    }, true)
  }
  saveAs(): Promise<boolean> { return this.transition(() => this.chooseSaveAs()) }
  async openFile() {
    const desktop = this.desktop
    if (!desktop) return
    await this.transition(async () => {
      if (this.current.name) await this.flush()
      else if (!await this.chooseSaveAs()) return
      const opened = await desktop.open()
      if (opened?.workspace) this.replace(opened.workspace, opened.session, opened.name)
    })
  }
  async newFile() {
    const desktop = this.desktop
    if (!desktop) return
    await this.transition(async () => {
      if (this.current.name) await this.flush()
      else if (!await this.chooseSaveAs()) return
      const opened = await desktop.newWorkspace()
      this.replace(opened.workspace ?? emptyWorkspace(), opened.session, opened.name)
      await this.flush()
    })
  }
  private replace(workspace: Workspace, session: string, name: string | null) {
    this.editor = null
    this.session = session
    this.expected = name ? { id: workspace.id, revision: workspace.revision } : null
    this.publish({ workspace: parseWorkspace(workspace), generation: this.current.generation + 1, name, status: name ? 'Saved to file' : 'Saved to recovery', error: '' })
  }
  dispose() { this.closed = true; if (this.timer) clearTimeout(this.timer); this.listeners.clear() }
}
