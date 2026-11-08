import { BOARD_CATALOG_KEY, readBoardCatalog, initialBoardCatalog, type BoardCatalog } from './boards'
import { BoardSwitcher, BoardsContext } from './components/board-switcher'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select'
import { Button } from './components/ui/button'
import { ChatPanel } from './components/chat-panel'
import { lineage, nodeTitle } from '../shared/chats'
import { Input } from './components/ui/input'
import { z } from 'zod'
import { useRef, useState } from 'react'
import { Editor, type TLComponents, Tldraw, useEditor, useValue } from 'tldraw'
import { Activity, ArrowDownToLine, ArrowRight, Check, ChevronRight, Expand, Hand, ImagePlus, Link2, MessageCircle, MousePointer2, Undo2, Redo2, X } from 'lucide-react'
import { StylePicker } from './StylePicker'
import { actions, uiState } from './actions'
import { NodeShapeUtil } from './nodes/NodeShapeUtil'
import { ConnectionShapeUtil } from './connection/ConnectionShapeUtil'
import { ConnectionBindingUtil } from './connection/ConnectionBindingUtil'
import { keepConnectionsAtBottom } from './connection/keepConnectionsAtBottom'
import { PointingPort } from './ports/PointingPort'
import { nodes, setupUnfold } from './unfold'

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
  const path = useValue('exploration path', () => {
    const id = state.activeChat?.nodeId ?? editor.getSelectedShapeIds()[0]
    return id ? lineage(nodes(editor).map(shape => ({ id: shape.id, node: shape.props.node })), id) : []
  }, [editor, state.activeChat])
  const selected = useValue('selected node', () => editor.getSelectedShapes().find(shape => editor.isShapeOfType(shape, 'node')), [editor])
  const tool = useValue('tool', () => editor.getCurrentToolId(), [editor])
  const jobs = Object.values(state.jobs).filter(job => job.status === 'running').length
  const api = actions.get(editor)
  return <div className={`chrome ${state.activeChat ? `has-chat ${state.chatView === 'focus' ? 'has-focus-chat' : ''}` : ''}`} onPointerDown={event => { if (event.target !== event.currentTarget) editor.markEventAsHandled(event) }}>
    <header className="app-header">
      <a className="wordmark" href="#" aria-label="Unfold home" onClick={event => { event.preventDefault(); api?.closeChat(); editor.selectNone(); editor.zoomToFit({ animation: { duration: 200 } }) }}>Unfold<span className="wordmark-flower">✳</span></a>
      <div className="header-navigation"><BoardSwitcher/><nav className="breadcrumbs" aria-label="Exploration breadcrumbs">{path.map((record, index) => <span className="breadcrumb" key={record.id}><ChevronRight size={13}/><button aria-current={index === path.length - 1 && !state.activeChat ? 'location' : undefined} title={nodeTitle(record.node)} onClick={() => { const shape = nodes(editor).find(shape => shape.id === record.id); if (shape) { api?.closeChat(); editor.select(shape.id); editor.zoomToSelection() } }}>{nodeTitle(record.node)}</button></span>)}{state.activeChat && <span className="breadcrumb current"><ChevronRight size={13}/><MessageCircle size={13}/><span aria-current="location">Chat</span></span>}</nav></div>
      <div className="header-right">
        <span className="saved-status" title="Stored in this browser on this device"><Check size={12}/> On this device</span>
        <Select items={[{ value: 'demo', label: 'Preview agents' }, { value: 'claude', label: 'Claude Code' }, { value: 'codex', label: 'Codex CLI' }]} disabled={jobs > 0} value={state.mode === 'demo' ? 'demo' : state.provider.toLowerCase().includes('claude') ? 'claude' : 'codex'} onValueChange={provider => {
          if (provider) switchProvider(editor, provider).catch((error: unknown) => reportFailure(editor, error))
        }}>
          <SelectTrigger aria-label="Agent provider" size="sm" className={`rounded-full text-xs ${state.mode === 'demo' ? 'bg-muted text-muted-foreground' : 'bg-secondary text-secondary-foreground'}`}><SelectValue/></SelectTrigger>
          <SelectContent><SelectItem value="demo">Preview agents</SelectItem><SelectItem value="claude">Claude Code</SelectItem><SelectItem value="codex">Codex CLI</SelectItem></SelectContent>
        </Select>
        <StylePicker/>
        <Button variant="ghost" size="sm" aria-label="Agent activity" aria-pressed={state.panel} onClick={() => uiState.update(editor, state => ({ ...state, panel: !state.panel }))}>
          <Activity/>{jobs > 0 && <span className="rounded-full bg-secondary px-1.5 text-xs">{jobs}</span>}
        </Button>
      </div>
    </header>
    {roots.length === 0 && <div className="empty-state minimal-empty"><div className="empty-mark" aria-hidden="true">✳</div><span className="micro-label">A LITTLE ROOM FOR POSSIBILITY</span><h1>Start with a spark.</h1><p>Bring an image. Follow a conversation.<br/>Keep the ideas worth building on.</p><Button size="lg" onClick={() => input.current?.click()}><ImagePlus size={17}/> Add inspiration</Button><Button variant="link" size="sm" onClick={() => { api?.samples().catch((error: unknown) => reportFailure(editor, error)) }}>Explore a sample board <ArrowRight size={14}/></Button></div>}
    {roots.length > 0 && !state.activeChat && <div className="canvas-caption"><span className="micro-label">YOUR THINKING, TAKING SHAPE</span><span>Open a chat from any inspiration. Keep what matters.</span></div>}
    <ChatPanel/>
    <div className="bottom-toolbar"><div className="tool-group"><Button variant="ghost" size="icon-sm" aria-pressed={tool === 'select'} title="Select (V)" aria-label="Select tool" onClick={() => editor.setCurrentTool('select')}><MousePointer2 size={18}/></Button><Button variant="ghost" size="icon-sm" aria-pressed={tool === 'hand'} title="Pan (H)" aria-label="Pan tool" onClick={() => editor.setCurrentTool('hand')}><Hand size={18}/></Button></div><span/><Button size="sm" className="add-image-tool rounded-full px-3.5 text-[10px] font-bold" aria-label="Add inspiration" onClick={() => input.current?.click()}><ImagePlus size={18}/><span>Add inspiration</span></Button>{selected && <Button variant="ghost" size="icon-sm" title="Open attached chat" aria-label="Open attached chat" onClick={() => api?.openChat(selected.id)}><MessageCircle size={18}/></Button>}<span/><Button variant="ghost" size="icon-sm" title="Connect goals" aria-label="Connect goals" onClick={() => api?.connect()}><Link2 size={18}/></Button><Button variant="ghost" size="icon-sm" title="Fit board" aria-label="Fit all nodes" onClick={() => editor.zoomToFit({ animation: { duration: 200 } })}><Expand size={18}/></Button><span/><Button variant="ghost" size="icon-sm" title="Undo" aria-label="Undo" onClick={() => editor.undo()}><Undo2 size={17}/></Button><Button variant="ghost" size="icon-sm" title="Redo" aria-label="Redo" onClick={() => editor.redo()}><Redo2 size={17}/></Button></div>
    <div className="bottom-note">{state.mode === 'demo' ? 'Preview mode · sample responses, no live web search' : `${state.provider} · your subscription, your choices`}</div>
    {state.notice && <div className="notice" role="status"><span>{state.notice}</span><Button variant="ghost" size="icon-sm" aria-label="Dismiss notification" onClick={() => uiState.update(editor, state => ({ ...state, notice: '' }))}><X size={15}/></Button></div>}
    {state.panel && <aside className="activity-panel"><header><div><span className="chapter-label"><span className="dot"/> BEHIND THE POSSIBILITIES</span><h2>A little <em>teamwork.</em></h2></div><Button variant="ghost" size="icon-sm" aria-label="Close activity" onClick={() => uiState.update(editor, state => ({ ...state, panel: false }))}><X size={17}/></Button></header><p>Your agents explore. You choose the direction.</p><div className="agent-roster"><span><i className="branch-dot"/> Branch</span><span><i className="research-dot"/> Research</span><span><i className="connection-dot"/> Connection</span></div><div className="activity-list">{state.activity.length === 0 ? <div className="activity-empty"><MessageCircle size={28}/><p>Start a conversation.<br/>The story of your exploration will appear here.</p></div> : state.activity.map(item => <div className={`activity-item role-${item.role}`} key={item.id}><span className="activity-dot"/><div><strong>{item.role === 'you' ? 'You' : item.role.charAt(0).toUpperCase() + item.role.slice(1)}</strong><p>{item.message}</p></div><time>{new Date(item.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>)}</div><footer><ArrowDownToLine size={13}/> Decisions are saved with your board.</footer></aside>}
    <Input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={event => { api?.importFiles(Array.from(event.target.files || [])).catch((error: unknown) => reportFailure(editor, error)); event.target.value = '' }}/>
  </div>
}
const components: TLComponents = { Toolbar: null, MenuPanel: null, StylePanel: null, PageMenu: null, NavigationPanel: null, HelpMenu: null, ActionsMenu: null, QuickActions: null, InFrontOfTheCanvas: Chrome }
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
  return <BoardsContext.Provider value={{ catalog, update }}>{error && <div className="board-storage-error" role="alert">{error}</div>}<Tldraw key={catalog.activeId} persistenceKey={catalog.activeId} {...(licenseKey ? { licenseKey } : {})} shapeUtils={[NodeShapeUtil, ConnectionShapeUtil]} bindingUtils={[ConnectionBindingUtil]} components={components} options={{ maxPages: 1, zoomToFitPadding: 100 }} onMount={editor => {
    editor.user.updateUserPreferences({ colorScheme: 'light', isSnapMode: true })
    if (!editor.getStateDescendant('select.pointing_port')) editor.getStateDescendant('select')?.addChild(PointingPort)
    const cleanupConnections = keepConnectionsAtBottom(editor)
    const cleanup = setupUnfold(editor)
    editor.registerExternalContentHandler('files', info => { actions.get(editor)?.importFiles(info.files).catch((error: unknown) => reportFailure(editor, error)) })
    if (nodes(editor).length) setTimeout(() => editor.zoomToFit({ }), 100)
    return () => { cleanup(); cleanupConnections() }
  }}/></BoardsContext.Provider>
}
