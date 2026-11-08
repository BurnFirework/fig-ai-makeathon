import { BOARD_CATALOG_KEY, readBoardCatalog, initialBoardCatalog, type BoardCatalog } from './boards'
import { BoardSwitcher, BoardsContext } from './components/board-switcher'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { z } from 'zod'
import { useRef, useState } from 'react'
import { Editor, type TLComponents, Tldraw, useEditor, useValue } from 'tldraw'
import { Activity, ArrowDownToLine, ArrowRight, Check, Expand, Hand, ImagePlus, Link2, MousePointer2, Plus, Sparkles, Undo2, Redo2, X } from 'lucide-react'
import { actions, collapsedBranches, uiState } from './actions'
import { NodeShapeUtil } from './nodes/NodeShapeUtil'
import { ConnectionShapeUtil } from './connection/ConnectionShapeUtil'
import { ConnectionBindingUtil, getConnectionBindings } from './connection/ConnectionBindingUtil'
import { keepConnectionsAtBottom } from './connection/keepConnectionsAtBottom'
import { PointingPort } from './ports/PointingPort'
import { nodeAt, nodes, setupUnfold } from './unfold'

function reportFailure(editor: Editor, error: unknown) {
  uiState.update(editor, state => ({ ...state, notice: error instanceof Error ? error.message : 'The operation could not finish. Please retry.' }))
}

async function switchProvider(editor: Editor, provider: string) {
  const response = await fetch('/api/provider', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }) })
  if (!response.ok) throw new Error('Provider is unavailable. Install and sign in to its CLI first.')
  const configResponse = await fetch('/api/config')
  const config = z.object({ mode: z.enum(['live', 'demo']), provider: z.string() }).parse(await configResponse.json())
  uiState.update(editor, state => ({ ...state, ...config }))
}

function Chrome() {
  const editor = useEditor(); const input = useRef<HTMLInputElement>(null)
  const state = useValue('chrome state', () => uiState.get(editor), [editor])
  const roots = useValue('roots', () => nodes(editor).filter(shape => shape.props.node.type === 'inspiration'), [editor])
  const tool = useValue('tool', () => editor.getCurrentToolId(), [editor])
  const jobs = Object.values(state.jobs).filter(job => job.status === 'running').length
  const api = actions.get(editor)
  return <div className="chrome" onPointerDown={event => { if (event.target !== event.currentTarget) editor.markEventAsHandled(event) }}>
    <header className="app-header">
      <a className="wordmark" href="#" aria-label="Unfold home" onClick={event => { event.preventDefault(); editor.zoomToFit({ animation: { duration: 200 } }) }}>unfold<span>✳</span></a>
      <BoardSwitcher/>
      <div className="header-right">
        <span className="saved-status"><Check size={12}/> Saved on this device</span>
        <Select items={[{ value: 'demo', label: 'Preview agents' }, { value: 'claude', label: 'Claude Code' }, { value: 'codex', label: 'Codex CLI' }]} disabled={jobs > 0} value={state.mode === 'demo' ? 'demo' : state.provider.toLowerCase().includes('claude') ? 'claude' : 'codex'} onValueChange={provider => {
          if (provider) switchProvider(editor, provider).catch((error: unknown) => reportFailure(editor, error))
        }}>
          <SelectTrigger aria-label="Agent provider" size="sm" className={`rounded-full text-xs ${state.mode === 'demo' ? 'bg-muted text-muted-foreground' : 'bg-secondary text-secondary-foreground'}`}><SelectValue/></SelectTrigger>
          <SelectContent><SelectItem value="demo">Preview agents</SelectItem><SelectItem value="claude">Claude Code</SelectItem><SelectItem value="codex">Codex CLI</SelectItem></SelectContent>
        </Select>
        <Button variant="ghost" size="sm" aria-label="Agent activity" aria-pressed={state.panel} onClick={() => uiState.update(editor, state => ({ ...state, panel: !state.panel }))}>
          <Activity/><span>Agent activity</span>{jobs > 0 && <span className="rounded-full bg-secondary px-1.5 text-xs">{jobs}</span>}
        </Button>
      </div>
    </header>
    <div className="board-heading"><div className="chapter-label"><span/> A SPACE FOR WHAT’S NEXT</div><h1>Let your possibilities unfold.</h1><p>Start with something that moves you. Find a small way forward.</p></div>
    {roots.length > 0 && <nav className="inspiration-tabs" aria-label="Your inspirations">{roots.map((root, index) => <Button variant="outline" size="pill" key={root.id} title="Focus inspiration. Shift-click to select two." onClick={event => { if (event.shiftKey) editor.select(...new Set([...editor.getSelectedShapeIds(), root.id])); else { editor.select(root.id); editor.zoomToSelection({ animation: { duration: 200 } }) } }}><span className="text-muted-foreground">{String(index + 1).padStart(2, '0')}</span><span className="truncate">{root.props.node.type === 'inspiration' ? root.props.node.goal : ''}</span></Button>)}</nav>}
    <aside className="left-rail"><Button variant="secondary" size="icon-sm" aria-label="Add inspiration" title="Add inspiration" onClick={() => input.current?.click()}><Plus size={20}/></Button><span/><Button variant="ghost" size="icon-sm" aria-label="Fit board" title="See the whole picture" onClick={() => editor.zoomToFit({ animation: { duration: 200 } })}><Expand size={18}/></Button><Button variant="ghost" size="icon-sm" aria-label="Connect two inspirations" title="Connect two inspirations" onClick={() => api?.connect()}><Link2 size={18}/></Button></aside>
    {roots.length === 0 && <div className="empty-state"><div className="empty-illustration"><span className="empty-paper first">a little<br/>curiosity <Sparkles size={26}/></span><span className="empty-paper second">something<br/>new <StarSmall/></span></div><h2>Every next chapter<br/>starts with a little spark.</h2><p>Bring two images that speak to you.<br/>We’ll help you find the possibilities between them.</p><Button size="lg" onClick={() => input.current?.click()}><ImagePlus size={17}/> Add your inspirations</Button><Button variant="link" size="text" className="mx-auto mt-3 flex" onClick={() => { api?.samples().catch((error: unknown) => reportFailure(editor, error)) }}>Or explore a sample board <ArrowRight size={14}/></Button><small>YOUR PACE. YOUR CHOICES. YOUR NEXT STEP.</small></div>}
    {roots.length > 0 && roots.every(root => root.props.node.type === 'inspiration' && !root.props.node.started) && <div className="board-hint"><span className="hint-star">✧</span> Click a star to explore an inspiration.<span className="hint-separator">·</span> Select two branches to find a connection.</div>}
    <div className="bottom-toolbar"><div className="tool-group"><Button variant="ghost" size="icon-sm" aria-pressed={tool === 'select'} title="Select (V)" aria-label="Select tool" onClick={() => editor.setCurrentTool('select')}><MousePointer2 size={18}/></Button><Button variant="ghost" size="icon-sm" aria-pressed={tool === 'hand'} title="Pan (H)" aria-label="Pan tool" onClick={() => editor.setCurrentTool('hand')}><Hand size={18}/></Button></div><span/><Button variant="ghost" size="sm" className="add-image-tool" aria-label="Add inspiration" onClick={() => input.current?.click()}><ImagePlus size={18}/><span>Add inspiration</span></Button><span/><Button variant="ghost" size="icon-sm" title="Connect goals" aria-label="Connect goals" onClick={() => api?.connect()}><Link2 size={18}/></Button><Button variant="ghost" size="icon-sm" title="Fit board" aria-label="Fit all nodes" onClick={() => editor.zoomToFit({ animation: { duration: 200 } })}><Expand size={18}/></Button><span/><Button variant="ghost" size="icon-sm" title="Undo" aria-label="Undo" onClick={() => editor.undo()}><Undo2 size={17}/></Button><Button variant="ghost" size="icon-sm" title="Redo" aria-label="Redo" onClick={() => editor.redo()}><Redo2 size={17}/></Button></div>
    <div className="bottom-note">{state.mode === 'demo' ? 'Preview mode · sample responses, no live web search' : `${state.provider} · your subscription, your choices`}</div>
    {state.notice && <div className="notice" role="status"><span>{state.notice}</span><Button variant="ghost" size="icon-sm" aria-label="Dismiss notification" onClick={() => uiState.update(editor, state => ({ ...state, notice: '' }))}><X size={15}/></Button></div>}
    {state.panel && <aside className="activity-panel"><header><div><span className="chapter-label">BEHIND THE POSSIBILITIES</span><h2>A little teamwork.</h2></div><Button variant="ghost" size="icon-sm" aria-label="Close activity" onClick={() => uiState.update(editor, state => ({ ...state, panel: false }))}><X size={17}/></Button></header><p>Your agents explore. You choose the direction.</p><div className="agent-roster"><span><i className="branch-dot"/> Branch</span><span><i className="research-dot"/> Research</span><span><i className="connection-dot"/> Connection</span></div><div className="activity-list">{state.activity.length === 0 ? <div className="activity-empty"><Sparkles size={24}/><p>Start with a star.<br/>The story of your exploration will appear here.</p></div> : state.activity.map(item => <div className={`activity-item role-${item.role}`} key={item.id}><span className="activity-dot"/><div><strong>{item.role === 'you' ? 'You' : item.role.charAt(0).toUpperCase() + item.role.slice(1)}</strong><p>{item.message}</p></div><time>{new Date(item.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>)}</div><footer><ArrowDownToLine size={13}/> Decisions are saved with your board.</footer></aside>}
    <Input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={event => { api?.importFiles(Array.from(event.target.files || [])).catch((error: unknown) => reportFailure(editor, error)); event.target.value = '' }}/>
  </div>
}
function StarSmall() { return <Sparkles size={32}/> }
const components: TLComponents = { Toolbar: null, MenuPanel: null, StylePanel: null, PageMenu: null, NavigationPanel: null, HelpMenu: null, ActionsMenu: null, QuickActions: null, InFrontOfTheCanvas: Chrome }
function shapeVisibility(shape: Parameters<NonNullable<React.ComponentProps<typeof Tldraw>['getShapeVisibility']>>[0], editor: Editor) {
  const hidden = collapsedBranches.get(editor)
  if (editor.isShapeOfType(shape, 'node')) return shape.props.node.type !== 'inspiration' && hidden.includes(shape.props.node.branchId) ? 'hidden' : 'inherit'
  if (editor.isShapeOfType(shape, 'connection')) {
    const bindings = getConnectionBindings(editor, shape)
    for (const binding of [bindings.start, bindings.end]) {
      const node = binding ? nodeAt(editor, binding.toId)?.props.node : undefined
      if (node && node.type !== 'inspiration' && hidden.includes(node.branchId)) return 'hidden'
    }
  }
  return 'inherit'
}

export default function App() {
  const [initial] = useState(() => {
    try { return { catalog: readBoardCatalog(localStorage), error: '' } }
    catch { return { catalog: initialBoardCatalog(), error: 'Your saved board list could not be loaded. Reload to try again. Your canvas data is still on this device.' } }
  })
  const [catalog, setCatalog] = useState(initial.catalog)
  const [error, setError] = useState(initial.error)
  function update(next: BoardCatalog) {
    if (initial.error) return false
    try {
      localStorage.setItem(BOARD_CATALOG_KEY, JSON.stringify(next))
      setCatalog(next)
      setError('')
      return true
    } catch {
      setError('Could not save your board list. Free some browser storage and try again.')
      return false
    }
  }
  const licenseKey = import.meta.env.VITE_TLDRAW_LICENSE_KEY
  return <BoardsContext.Provider value={{ catalog, update }}>{error && <div className="board-storage-error" role="alert">{error}</div>}<Tldraw key={catalog.activeId} persistenceKey={catalog.activeId} {...(licenseKey ? { licenseKey } : {})} shapeUtils={[NodeShapeUtil, ConnectionShapeUtil]} bindingUtils={[ConnectionBindingUtil]} components={components} options={{ maxPages: 1, zoomToFitPadding: 220 }} getShapeVisibility={shapeVisibility} onMount={editor => {
    editor.user.updateUserPreferences({ colorScheme: 'light', isSnapMode: true })
    if (!editor.getStateDescendant('select.pointing_port')) editor.getStateDescendant('select')?.addChild(PointingPort)
    const cleanupConnections = keepConnectionsAtBottom(editor)
    const cleanup = setupUnfold(editor)
    editor.registerExternalContentHandler('files', info => { actions.get(editor)?.importFiles(info.files).catch((error: unknown) => reportFailure(editor, error)) })
    if (nodes(editor).length) setTimeout(() => editor.zoomToFit({ }), 100)
    return () => { cleanup(); cleanupConnections() }
  }}/></BoardsContext.Provider>
}
