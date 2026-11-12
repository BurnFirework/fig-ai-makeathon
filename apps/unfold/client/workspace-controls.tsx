import { useContext, useEffect, useId, useRef, useSyncExternalStore } from 'react'
import { FolderOpen, Download, Upload, MoreHorizontal } from 'lucide-react'
import { WorkspaceContext } from './workspace'
import { Button } from './components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './components/ui/dropdown-menu'

export function WorkspaceControls() {
  const workspace = useContext(WorkspaceContext)
  const input = useRef<HTMLInputElement>(null)
  if (!workspace) return null
  return <Controls workspace={workspace} input={input}/>
}
function Controls({ workspace, input }: { workspace: NonNullable<React.ContextType<typeof WorkspaceContext>>; input: React.RefObject<HTMLInputElement | null> }) {
  const state = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot)
  const storageNoteId = useId()
  const savedInBrowser = state.status === 'Saved in browser'
  const statusColor = state.status === 'Not saved' ? 'text-destructive' : 'text-muted-foreground'
  const run = (operation: Promise<unknown>) => { operation.catch((error: unknown) => workspace.report(error)) }
  useEffect(() => {
    if (workspace.desktop) return
    const flush = () => { workspace.flush().catch((error: unknown) => workspace.report(error)) }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!workspace.hasUnsavedChanges()) return
      event.preventDefault(); event.returnValue = ''; flush()
    }
    const background = () => { if (document.hidden) flush() }
    const updateGuard = () => {
      window.removeEventListener('beforeunload', beforeUnload)
      if (workspace.hasUnsavedChanges()) window.addEventListener('beforeunload', beforeUnload)
    }
    const unsubscribe = workspace.subscribe(updateGuard)
    updateGuard()
    window.addEventListener('blur', flush)
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', background)
    return () => {
      unsubscribe(); window.removeEventListener('beforeunload', beforeUnload)
      window.removeEventListener('blur', flush); window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', background)
    }
  }, [workspace])
  useEffect(() => {
    const desktop = workspace.desktop
    const unsubscribe = desktop?.subscribeCommands(command => {
      if (command === 'save') run(workspace.flush())
      if (command === 'export') run(workspace.exportCopy())
      if (command === 'import') input.current?.click()
    })
    const unclose = desktop?.onCloseRequested(() => {
      const closing = async () => {
        try {
          const success = await workspace.prepareClose()
          await desktop.closeReady(success)
        } catch (error) { workspace.cancelClose(); workspace.report(error); await desktop.closeReady(false) }
      }
      run(closing())
    })
    const key = (event: KeyboardEvent) => {
      if (workspace.getSnapshot().busy) { event.preventDefault(); event.stopImmediatePropagation(); return }
      if (!desktop && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); run(workspace.exportCopy()) }
    }
    window.addEventListener('keydown', key, true)
    return () => { unsubscribe?.(); unclose?.(); window.removeEventListener('keydown', key, true) }
  }, [workspace, input])
  return <><span className={savedInBrowser ? 'sr-only' : `text-xs ${statusColor}`} role="status">{state.status}</span>
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Board menu" title={savedInBrowser ? 'Board menu' : `Board menu · ${state.status}`}/>}><MoreHorizontal size={17}/></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" onPointerDown={event => event.stopPropagation()}>
        <DropdownMenuItem aria-describedby={workspace.desktop ? undefined : storageNoteId} onClick={() => run(workspace.exportCopy())}><Download/>{workspace.desktop ? 'Export backup' : 'Export'}</DropdownMenuItem>
        {workspace.desktop ? <><DropdownMenuItem onClick={() => input.current?.click()}><Upload/>Import</DropdownMenuItem><DropdownMenuItem onClick={() => { if (workspace.desktop) run(workspace.desktop.showDataFolder()) }}><FolderOpen/>Show data folder</DropdownMenuItem></> : <>
          <DropdownMenuSeparator/>
          <div id={storageNoteId} className="px-2.5 pt-1 pb-2 text-xs leading-normal text-muted-foreground">
            <p className="font-semibold text-foreground">Boards stay in this browser</p>
            <p>Export to keep a backup.</p>
          </div>
        </>}
      </DropdownMenuContent>
    </DropdownMenu>
    {workspace.desktop && <input ref={input} type="file" accept=".unfold,application/zip" hidden aria-label="Import backup" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) run(workspace.importCopy(file)) }}/>}
  </>
}
