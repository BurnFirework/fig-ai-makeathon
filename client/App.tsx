import { z } from 'zod'
import { useRef } from 'react'
import { Editor, type TLComponents, Tldraw, useEditor, useValue } from 'tldraw'
import { Activity, ArrowDownToLine, ArrowRight, Check, Expand, Flower2, Hand, ImagePlus, Link2, MousePointer2, Plus, Sparkles, Undo2, Redo2, X } from 'lucide-react'
import { Blossom, Bow, Heart, Rose, Sparkle, Tape } from './decor'
import { StylePicker } from './StylePicker'
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
    <header className="app-header"><a className="wordmark" href="#" aria-label="Unfold home" onClick={event => { event.preventDefault(); editor.zoomToFit({ animation: { duration: 200 } }) }}>Unfold<Bow size={30}/></a><div className="header-divider"/><span className="workspace-name">Your next chapter <ChevronDownSmall/></span><div className="header-right"><span className="saved-status"><Check size={12}/> Saved on this device</span><select aria-label="Agent provider" disabled={jobs > 0} className={`provider-badge ${state.mode}`} value={state.mode === 'demo' ? 'demo' : state.provider.toLowerCase().includes('claude') ? 'claude' : 'codex'} onChange={event => {
      switchProvider(editor, event.currentTarget.value).catch((error: unknown) => reportFailure(editor, error))
    }}><option value="demo">Preview agents</option><option value="claude">Claude Code</option><option value="codex">Codex CLI</option></select><StylePicker/><button className={`activity-toggle ${state.panel ? 'active' : ''}`} onClick={() => uiState.update(editor, state => ({ ...state, panel: !state.panel }))}><Activity size={16}/><span>Agent activity</span>{jobs > 0 && <i>{jobs}</i>}</button></div></header>
    <div className="board-heading"><div className="chapter-label"><span className="dot"/> A SPACE FOR WHAT’S NEXT</div><h1>Let your possibilities <em>unfold</em>.</h1><p><span className="ribbon">Start with something that moves you. Find a small way forward.</span></p></div>
    {roots.length > 0 && <nav className="inspiration-tabs" aria-label="Your inspirations">{roots.map((root, index) => <button key={root.id} title="Focus inspiration. Shift-click to select two." onClick={event => { if (event.shiftKey) editor.select(...new Set([...editor.getSelectedShapeIds(), root.id])); else { editor.select(root.id); editor.zoomToSelection({ animation: { duration: 200 } }) } }}><span>{String(index + 1).padStart(2, '0')}</span>{root.props.node.type === 'inspiration' ? root.props.node.goal : ''}</button>)}</nav>}
    <aside className="left-rail"><button aria-label="Add inspiration" title="Add inspiration" onClick={() => input.current?.click()}><Plus size={20}/></button><span/><button aria-label="Fit board" title="See the whole picture" onClick={() => editor.zoomToFit({ animation: { duration: 200 } })}><Expand size={18}/></button><button aria-label="Connect two inspirations" title="Connect two inspirations" onClick={() => api?.connect()}><Link2 size={18}/></button></aside>
    {roots.length === 0 && <div className="empty-state"><div className="empty-illustration" aria-hidden="true"><Sparkle className="deco-sparkle-a" size={16}/><Sparkle className="deco-sparkle-b" size={22} color="#d3e1c4"/><span className="empty-paper first"><Tape/><span>a little<br/>curiosity <Sparkles size={22}/></span><small>for me</small></span><span className="empty-paper second"><Tape className="sage"/><span>something<br/>new <StarSmall/></span><small>soon ✿</small></span><Bow className="bow" size={58}/><Blossom className="deco-blossom" size={34}/></div><h2>Every next chapter<br/>starts with <em className="highlight">a little spark.</em></h2><p>Bring two images that speak to you.<br/>We’ll help you find the possibilities between them.</p><button className="primary large" onClick={() => input.current?.click()}><ImagePlus size={17}/> Add your inspirations</button><button className="text-button sample-button" onClick={() => { api?.samples().catch((error: unknown) => reportFailure(editor, error)) }}>Or explore a sample board <ArrowRight size={14}/></button><small>YOUR PACE · YOUR CHOICES · YOUR NEXT STEP</small></div>}
    {roots.length > 0 && roots.every(root => root.props.node.type === 'inspiration' && !root.props.node.started) && <div className="board-hint"><span className="hint-star"><Heart size={16}/></span> Tap the heart to explore an inspiration.<span className="hint-separator">·</span> Select two branches to find a connection.</div>}
    <div className="bottom-toolbar"><div className="tool-group"><button className={tool === 'select' ? 'selected' : ''} title="Select (V)" aria-label="Select tool" onClick={() => editor.setCurrentTool('select')}><MousePointer2 size={18}/></button><button className={tool === 'hand' ? 'selected' : ''} title="Pan (H)" aria-label="Pan tool" onClick={() => editor.setCurrentTool('hand')}><Hand size={18}/></button></div><span/><button className="add-image-tool" onClick={() => input.current?.click()}><ImagePlus size={18}/><span>Add inspiration</span></button><span/><button title="Connect goals" aria-label="Connect goals" onClick={() => api?.connect()}><Link2 size={18}/></button><button title="Fit board" aria-label="Fit all nodes" onClick={() => editor.zoomToFit({ animation: { duration: 200 } })}><Expand size={18}/></button><span/><button title="Undo" aria-label="Undo" onClick={() => editor.undo()}><Undo2 size={17}/></button><button title="Redo" aria-label="Redo" onClick={() => editor.redo()}><Redo2 size={17}/></button></div>
    <div className="bottom-note">{state.mode === 'demo' ? 'Preview mode · sample responses, no live web search' : `${state.provider} · your subscription, your choices`}</div>
    <Rose className="corner-rose" size={72}/>
    {state.notice && <div className="notice" role="status"><span>{state.notice}</span><button aria-label="Dismiss notification" onClick={() => uiState.update(editor, state => ({ ...state, notice: '' }))}><X size={15}/></button></div>}
    {state.panel && <aside className="activity-panel"><header><div><span className="chapter-label"><span className="dot"/> BEHIND THE POSSIBILITIES</span><h2>A little <em>teamwork.</em></h2></div><button aria-label="Close activity" onClick={() => uiState.update(editor, state => ({ ...state, panel: false }))}><X size={17}/></button></header><p>Your agents explore. You choose the direction.</p><div className="agent-roster"><span><i className="branch-dot"/> Branch</span><span><i className="research-dot"/> Research</span><span><i className="connection-dot"/> Connection</span></div><div className="activity-list">{state.activity.length === 0 ? <div className="activity-empty"><Heart size={28}/><p>Start with a heart.<br/>The story of your exploration will appear here.</p></div> : state.activity.map(item => <div className={`activity-item role-${item.role}`} key={item.id}><span className="activity-dot"/><div><strong>{item.role === 'you' ? 'You' : item.role.charAt(0).toUpperCase() + item.role.slice(1)}</strong><p>{item.message}</p></div><time>{new Date(item.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>)}</div><footer><ArrowDownToLine size={13}/> Decisions are saved with your board.</footer></aside>}
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={event => { api?.importFiles(Array.from(event.target.files || [])).catch((error: unknown) => reportFailure(editor, error)); event.target.value = '' }}/>
  </div>
}
function ChevronDownSmall() { return <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.3"/></svg> }
function StarSmall() { return <Flower2 size={22}/> }
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
  const licenseKey = import.meta.env.VITE_TLDRAW_LICENSE_KEY
  return <Tldraw persistenceKey="unfold-board-v1" {...(licenseKey ? { licenseKey } : {})} shapeUtils={[NodeShapeUtil, ConnectionShapeUtil]} bindingUtils={[ConnectionBindingUtil]} components={components} options={{ maxPages: 1, zoomToFitPadding: 220 }} getShapeVisibility={shapeVisibility} onMount={editor => {
    editor.user.updateUserPreferences({ colorScheme: 'light', isSnapMode: true })
    if (!editor.getStateDescendant('select.pointing_port')) editor.getStateDescendant('select')?.addChild(PointingPort)
    const cleanupConnections = keepConnectionsAtBottom(editor)
    const cleanup = setupUnfold(editor)
    editor.registerExternalContentHandler('files', info => { actions.get(editor)?.importFiles(info.files).catch((error: unknown) => reportFailure(editor, error)) })
    if (nodes(editor).length) setTimeout(() => editor.zoomToFit({ }), 100)
    return () => { cleanup(); cleanupConnections() }
  }}/>
}
