import { useContext, useEffect, useRef, useSyncExternalStore } from 'react'
import { FolderOpen, Download, Upload, Save, FilePlus, MoreHorizontal } from 'lucide-react'
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
    async function save() { if (workspace.getSnapshot().name) await workspace.flush(); else await workspace.saveAs() }
    const unsubscribe = desktop?.subscribeCommands(command => {
      if (command === 'save') run(save())
      if (command === 'saveAs') run(workspace.saveAs())
      if (command === 'open') run(workspace.openFile())
      if (command === 'new') run(workspace.newFile())
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
  }, [workspace])
  return <><span className="text-xs text-muted-foreground" role="status" title={state.name ?? undefined}>{state.status}</span>
    <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Workspace files" title="Workspace files"/>}><MoreHorizontal size={17}/></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-56" onPointerDown={event => event.stopPropagation()}>
      {workspace.desktop && <><DropdownMenuItem onClick={() => run(workspace.newFile())}><FilePlus/>New workspace</DropdownMenuItem><DropdownMenuItem onClick={() => run(workspace.openFile())}><FolderOpen/>Open workspace</DropdownMenuItem><DropdownMenuItem onClick={() => run(state.name ? workspace.flush() : workspace.saveAs())}><Save/>Save workspace</DropdownMenuItem><DropdownMenuItem onClick={() => run(workspace.saveAs())}><Save/>Save workspace as…</DropdownMenuItem><DropdownMenuSeparator/></>}
      <DropdownMenuItem onClick={() => run(workspace.exportCopy())}><Download/>Export all boards</DropdownMenuItem>
      <DropdownMenuItem onClick={() => input.current?.click()}><Upload/>Import boards</DropdownMenuItem>
    </DropdownMenuContent></DropdownMenu>
    <input ref={input} type="file" accept=".unfold,application/zip" hidden aria-label="Import workspace backup" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) run(workspace.importCopy(file)) }}/>
  </>
}
