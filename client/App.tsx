import { WorkspaceContext, type WorkspaceController } from './workspace'
import { WorkspaceBootstrap } from './workspace-bootstrap'
import { WorkspaceControls } from './workspace-controls'
import { StylePicker } from './StylePicker'
import { BoardSwitcher, BoardsContext } from './components/board-switcher'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select'
import { Button } from './components/ui/button'
import { ChatPanel } from './components/chat-panel'
import { lineage, nodeTitle } from '../shared/chats'
import { Input } from './components/ui/input'
import { selectAgentProvider } from './agentClient'
import { useRef, useState, useSyncExternalStore } from 'react'
import { Editor, type TLComponents, Tldraw, useEditor, useValue } from 'tldraw'
import { Activity, ArrowDownToLine, ArrowRight, ChevronRight, Expand, Hand, ImagePlus, Link2, MessageCircle, MoreHorizontal, MousePointer2, Plus, Settings2, Undo2, Redo2, X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './components/ui/dropdown-menu'
import { actions, uiState } from './actions'
import { NodeShapeUtil } from './nodes/NodeShapeUtil'
import { ConnectionShapeUtil } from './connection/ConnectionShapeUtil'
import { ConnectionBindingUtil } from './connection/ConnectionBindingUtil'
import { keepConnectionsAtBottom } from './connection/keepConnectionsAtBottom'
import { PointingPort } from './ports/PointingPort'
import { fitBoard, nodes, setupUnfold } from './unfold'

function reportFailure(editor: Editor, error: unknown) {
  uiState.update(editor, state => ({ ...state, notice: error instanceof Error ? error.message : 'The operation could not finish. Please retry.' }))
}

async function switchProvider(editor: Editor, provider: string) {
  const config = await selectAgentProvider(provider)
  uiState.update(editor, state => ({ ...state, ...config }))
}

function Chrome() {
  const editor = useEditor(); const input = useRef<HTMLInputElement>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
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
      <a className="wordmark" href="#" aria-label="Unfold home" onClick={event => { event.preventDefault(); api?.closeChat(); editor.selectNone(); editor.zoomToFit({ animation: { duration: 200 } }) }}>Unfold</a>
      <div className="header-navigation"><BoardSwitcher/><nav className="breadcrumbs" aria-label="Exploration breadcrumbs">{(path.length > 1 || state.activeChat) && path.map((record, index) => <span className="breadcrumb" key={record.id}><ChevronRight size={13}/><button aria-current={index === path.length - 1 && !state.activeChat ? 'location' : undefined} title={nodeTitle(record.node)} onClick={() => { const shape = nodes(editor).find(shape => shape.id === record.id); if (shape) { api?.closeChat(); editor.select(shape.id); editor.zoomToSelection() } }}>{nodeTitle(record.node)}</button></span>)}{state.activeChat && <span className="breadcrumb current"><ChevronRight size={13}/><MessageCircle size={13}/><span aria-current="location">Chat</span></span>}</nav></div>
      <div className="header-right"><WorkspaceControls/>
        {state.mode === 'demo' && <span className="mode-label">Preview</span>}
        <StylePicker/>
        <Button variant="ghost" size="icon-sm" aria-label="Board settings" title="Board settings" onClick={() => setSettingsOpen(true)}><Settings2 size={17}/></Button>
        <Button variant="ghost" size="sm" aria-label="Agent activity" aria-pressed={state.panel} onClick={() => uiState.update(editor, state => ({ ...state, panel: !state.panel }))}>
          <Activity/>{jobs > 0 && <span className="rounded-full bg-secondary px-1.5 text-xs">{jobs}</span>}
        </Button>
      </div>
    </header>
    {roots.length === 0 && <div className="empty-state"><div className="empty-mark" aria-hidden="true"><ImagePlus size={30} strokeWidth={1.25}/></div><h1>A little space for your ideas.</h1><p>Add an image that means something to you.<br/>See where it takes you.</p><Button size="lg" onClick={() => input.current?.click()}><ImagePlus size={17}/> Add inspiration</Button><Button variant="link" size="sm" onClick={() => { api?.samples().catch((error: unknown) => reportFailure(editor, error)) }}>Explore a sample board <ArrowRight size={14}/></Button></div>}
    <ChatPanel/>
    {roots.length > 0 && <div className="bottom-toolbar" role="toolbar" aria-label="Canvas tools">
      <div className="tool-group"><Button variant="ghost" size="icon" aria-pressed={tool === 'select'} title="Select (V)" aria-label="Select tool" onClick={() => editor.setCurrentTool('select')}><MousePointer2 size={18}/></Button><Button variant="ghost" size="icon" aria-pressed={tool === 'hand'} title="Pan (H) · hold Space to pan" aria-label="Pan tool" onClick={() => editor.setCurrentTool('hand')}><Hand size={18}/></Button></div>
      <span className="toolbar-divider"/>
      <Button variant="ghost" size="sm" className="add-image-tool" aria-label="Add inspiration" onClick={() => input.current?.click()}><Plus size={18}/><span>Add image</span></Button>
      <Button variant="ghost" size="icon" title="Connect two inspirations" aria-label="Connect goals" onClick={() => api?.connect()}><Link2 size={18}/></Button>
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="More canvas actions" title="More canvas actions"/>}><MoreHorizontal size={18}/></DropdownMenuTrigger><DropdownMenuContent side="top" align="end" className="w-52" onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
        {selected && <DropdownMenuItem onClick={() => api?.openChat(selected.id)}><MessageCircle/>Open attached chat</DropdownMenuItem>}
        <DropdownMenuItem onClick={() => fitBoard(editor)}><Expand/>Fit board</DropdownMenuItem><DropdownMenuSeparator/>
        <DropdownMenuItem onClick={() => editor.undo()}><Undo2/>Undo</DropdownMenuItem><DropdownMenuItem onClick={() => editor.redo()}><Redo2/>Redo</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
    </div>}
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}><DialogContent className="board-settings" onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}><DialogHeader><DialogTitle>Board settings</DialogTitle><DialogDescription>Your boards stay on this device. Use Workspace files to export a complete backup.</DialogDescription></DialogHeader><label className="settings-label">Agent provider</label>
        <Select items={[{ value: 'demo', label: 'Preview agents' }, { value: 'claude', label: 'Claude Code' }, { value: 'codex', label: 'Codex CLI' }]} disabled={jobs > 0} value={state.mode === 'demo' ? 'demo' : state.provider.toLowerCase().includes('claude') ? 'claude' : 'codex'} onValueChange={provider => {
          if (provider) switchProvider(editor, provider).catch((error: unknown) => reportFailure(editor, error))
        }}>
          <SelectTrigger aria-label="Agent provider" size="sm" className="w-full"><SelectValue/></SelectTrigger>
          <SelectContent><SelectItem value="demo">Preview agents</SelectItem><SelectItem value="claude">Claude Code</SelectItem><SelectItem value="codex">Codex CLI</SelectItem></SelectContent>
        </Select>
      <p className="settings-note">{state.mode === 'demo' ? 'Preview uses sample responses and does not search the web.' : 'Uses your signed-in CLI subscription for conversations and research.'}</p>
    </DialogContent></Dialog>
    {state.notice && <div className="notice" role="status"><span>{state.notice}</span><Button variant="ghost" size="icon-sm" aria-label="Dismiss notification" onClick={() => uiState.update(editor, state => ({ ...state, notice: '' }))}><X size={15}/></Button></div>}
    {state.panel && <aside className="activity-panel"><header><div><h2>Agent activity</h2></div><Button variant="ghost" size="icon-sm" aria-label="Close activity" onClick={() => uiState.update(editor, state => ({ ...state, panel: false }))}><X size={17}/></Button></header><p>Conversations, research and decisions for this board.</p><div className="agent-roster"><span><i className="branch-dot"/> Branch</span><span><i className="research-dot"/> Research</span><span><i className="connection-dot"/> Connection</span></div><div className="activity-list">{state.activity.length === 0 ? <div className="activity-empty"><MessageCircle size={28}/><p>Start a conversation.<br/>The story of your exploration will appear here.</p></div> : state.activity.map(item => <div className={`activity-item role-${item.role}`} key={item.id}><span className="activity-dot"/><div><strong>{item.role === 'you' ? 'You' : item.role.charAt(0).toUpperCase() + item.role.slice(1)}</strong><p>{item.message}</p></div><time>{new Date(item.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>)}</div><footer><ArrowDownToLine size={13}/> Decisions are saved with your board.</footer></aside>}
    <Input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={event => { api?.importFiles(Array.from(event.target.files || [])).catch((error: unknown) => reportFailure(editor, error)); event.target.value = '' }}/>
  </div>
}
const components: TLComponents = { Toolbar: null, MenuPanel: null, StylePanel: null, PageMenu: null, NavigationPanel: null, HelpMenu: null, ActionsMenu: null, QuickActions: null, InFrontOfTheCanvas: Chrome }
export default function App() {
  return <WorkspaceBootstrap>{workspace => <WorkspaceApp workspace={workspace}/>}</WorkspaceBootstrap>
}
function WorkspaceApp({ workspace }: { workspace: WorkspaceController }) {
  const state = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot)
  return <WorkspaceContext.Provider value={workspace}><BoardsContext.Provider value={{ catalog: state.workspace.catalog, update: catalog => workspace.updateCatalog(catalog) }}>
    {state.busy && <div role="status" style={{ position: 'fixed', inset: 0, zIndex: 99999, background: '#fff8', display: 'grid', placeItems: 'center' }}>Updating workspace…</div>}
    {state.error && <div className="board-storage-error" role="alert">{state.error}</div>}
    <WorkspaceCanvas key={`${state.generation}:${state.workspace.catalog.activeId}`} workspace={workspace}/>
  </BoardsContext.Provider></WorkspaceContext.Provider>
}
function WorkspaceCanvas({ workspace }: { workspace: WorkspaceController }) {
  const [store] = useState(() => workspace.createStore())
  const licenseKey = import.meta.env.VITE_TLDRAW_LICENSE_KEY
  return <Tldraw store={store} {...(licenseKey ? { licenseKey } : {})} shapeUtils={[NodeShapeUtil, ConnectionShapeUtil]} bindingUtils={[ConnectionBindingUtil]} components={components} options={{ maxPages: 1, zoomToFitPadding: 160 }} onMount={editor => {
    editor.user.updateUserPreferences({ colorScheme: 'light', isSnapMode: true })
    if (!editor.getStateDescendant('select.pointing_port')) editor.getStateDescendant('select')?.addChild(PointingPort)
    const detachWorkspace = workspace.attachEditor(editor)
    const cleanupConnections = keepConnectionsAtBottom(editor)
    const cleanup = setupUnfold(editor)
    editor.registerExternalContentHandler('files', info => { actions.get(editor)?.importFiles(info.files).catch((error: unknown) => reportFailure(editor, error)) })
    if (nodes(editor).length) setTimeout(() => editor.zoomToFit({}), 100)
    return () => { detachWorkspace(); cleanup(); cleanupConnections() }
  }}/>
}
