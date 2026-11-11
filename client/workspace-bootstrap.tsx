import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { DesktopSession } from '../shared/desktop-contract'
import { Tldraw, type Editor } from 'tldraw'
import { AppearanceSchema, parseWorkspace, type Workspace } from '../shared/workspace-format'
import { readBoardCatalog, type BoardCatalog } from './boards'
import { canvasOptions } from './canvas-options'
import { readBrowserWorkspace } from './platform/browser-storage'
import { assetData, emptyWorkspace, WorkspaceController } from './workspace'

interface LegacyState { catalog: BoardCatalog; workspace: Workspace; index: number }
async function collect(editor: Editor, state: LegacyState): Promise<LegacyState> {
  const board = state.catalog.boards[state.index]
  if (!board) throw new Error('An existing board is missing.')
  const assets = { ...state.workspace.assets }
  for (const asset of editor.getAssets()) {
    if (asset.type === 'image') assets[asset.id] = await assetData(editor, asset)
  }
  const document = structuredClone(editor.store.getStoreSnapshot('document'))
  for (const record of Object.values(document.store)) if (record.typeName === 'asset' && record.type === 'image') record.props.src = record.id
  return { ...state, index: state.index + 1, workspace: { ...state.workspace, boards: { ...state.workspace.boards, [board.id]: { document } }, assets } }
}
export function WorkspaceBootstrap({ children }: { children: (controller: WorkspaceController) => ReactNode }) {
  const [controller, setController] = useState<WorkspaceController | null>(null)
  const [legacy, setLegacy] = useState<LegacyState | null>(null)
  const [error, setError] = useState('')
  const desktopLoad = useRef<Promise<DesktopSession> | null>(null)
  const restoreDesktop = useCallback(async () => {
    try {
      const desktop = window.unfoldDesktop
      if (!desktop) return
      const loaded = await desktop.restoreBackup()
      if (loaded?.workspace) setController(new WorkspaceController(parseWorkspace(loaded.workspace), { desktop, session: loaded.session, notice: loaded.notice, persisted: true }))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The backup could not be restored.') }
  }, [])
  useEffect(() => {
    if (!error || controller) return
    return window.unfoldDesktop?.subscribeCommands(command => { if (command === 'import') restoreDesktop().catch(() => {}) })
  }, [error, controller, restoreDesktop])
  useEffect(() => {
    let canceled = false
    async function start() {
      if (window.unfoldDesktop) {
        const loaded = await (desktopLoad.current ??= window.unfoldDesktop.load())
        if (canceled) return
        const workspace = loaded.workspace ? parseWorkspace(loaded.workspace) : emptyWorkspace()
        const next = new WorkspaceController(workspace, { desktop: window.unfoldDesktop, session: loaded.session, notice: loaded.notice, persisted: loaded.workspace !== null })
        await next.flush()
        setController(next)
        return
      }
      const stored = await readBrowserWorkspace()
      if (canceled) return
      if (stored) { setController(new WorkspaceController(parseWorkspace(stored), { persisted: true })); return }
      const catalog = readBoardCatalog(localStorage)
      const appearance = AppearanceSchema.parse({ palette: AppearanceSchema.shape.palette.catch('rose').parse(localStorage.getItem('unfold-palette')), pattern: AppearanceSchema.shape.pattern.catch('dots').parse(localStorage.getItem('unfold-canvas-pattern')), tone: AppearanceSchema.shape.tone.catch('cream').parse(localStorage.getItem('unfold-canvas-tone')) })
      const workspace = { ...emptyWorkspace(), catalog, boards: {}, appearance }
      setLegacy({ catalog, workspace, index: 0 })
    }
    start().catch((reason: unknown) => { if (!canceled) setError(reason instanceof Error ? reason.message : 'Your workspace could not be loaded.') })
    return () => { canceled = true }
  }, [])
  useEffect(() => {
    if (!legacy || legacy.index !== legacy.catalog.boards.length) return
    let canceled = false
    const complete = async () => {
      const next = new WorkspaceController(parseWorkspace(legacy.workspace), { persisted: false })
      await next.flush()
      if (!canceled) setController(next)
    }
    complete().catch((reason: unknown) => { if (!canceled) setError(reason instanceof Error ? reason.message : 'Your existing boards could not be migrated.') })
    return () => { canceled = true }
  }, [legacy])
  if (controller) return children(controller)
  if (error) return <div role="alert" style={{ padding: 32 }}><h1>Your saved boards could not be opened.</h1><p>{error}</p><p>{window.unfoldDesktop ? 'Existing files have been preserved. You can restore an Unfold backup or find recovery copies in the data folder.' : 'Close other Unfold tabs and reload to retry. Existing browser storage has not been deleted.'}</p>{window.unfoldDesktop && <><button onClick={() => { restoreDesktop().catch(() => {}) }}>Restore backup…</button><button onClick={() => { window.unfoldDesktop?.showDataFolder().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'The data folder could not be opened.')) }}>Show data folder</button></>}<button onClick={() => location.reload()}>Retry</button></div>
  const board = legacy?.catalog.boards[legacy.index]
  return <><div role="status" style={{ padding: 32 }}>Opening your workspace…</div>{legacy && board && <div style={{ position: 'fixed', width: 800, height: 600, left: -10000, top: 0 }}><Tldraw key={board.id} persistenceKey={board.id} {...canvasOptions} onMount={editor => {
    let canceled = false
    collect(editor, legacy).then(next => { if (!canceled) setLegacy(next) }).catch((reason: unknown) => { if (!canceled) setError(reason instanceof Error ? reason.message : 'An existing board could not be read.') })
    return () => { canceled = true }
  }}/></div>}</>
}
