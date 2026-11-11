import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { T, useEditor, useValue } from 'tldraw'
import { ArrowRight, Check, ChevronDown, Clock, ExternalLink, LoaderCircle, MapPin, MessageCircle, MessageSquarePlus, Sparkles, Trash2, Wallet } from 'lucide-react'
import { isUnfoldNode, type UnfoldNode } from '../../../shared/schema'
import { isNotEmpty } from '../../../shared/arrays'
import { lineage, nodeTitle } from '../../../shared/chats'
import { actions, uiState } from '../../actions'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { getNodeHeightPx, type NodeTypePorts } from '../nodeTypes'
import { NODE_WIDTH_PX } from '../../constants'
import { Blossom, Tape } from '../../decor'
import { LinkPill } from '../../components/collaboration'
import { conversationsFor } from '../../conversations'
import { ArtifactContent } from '../../components/artifact-content'

// Inspiration cards are slim polaroids: a thin frame around the photo, its proportions kept within a range.
const FRAME_PX = 10
const CAPTION_PX = 52
import { defaultInspiration, nodes } from '../../unfold'
import type { NodeShape } from '../NodeShapeUtil'
import { type NodeComponentProps, NodeDefinition } from './shared'

export class UnfoldNodeDefinition extends NodeDefinition<UnfoldNode> {
  static type = 'inspiration'
  static validator = new T.Validator<UnfoldNode>(value => { if (!isUnfoldNode(value)) throw new Error('Invalid node'); return value })
  title = 'Inspiration'; heading = 'Unfold'; icon = <Sparkles/>
  getDefault() { return defaultInspiration() }
  getBodyWidthPx(_shape: NodeShape, _node: UnfoldNode) { return NODE_WIDTH_PX }
  getBodyHeightPx(_shape: NodeShape, node: UnfoldNode) {
    if (node.type === 'action') return node.fit ?? actionHeight(node, node.expanded === true)
    if (node.type === 'artifact') return 120 + Math.min(140, lines(node.content.description, 40) * 20) + (node.content.kind === 'moodboard' ? Math.ceil(node.content.items.length / 2) * 110 : 0) + (node.stale ? 26 : 0)
    if (node.type !== 'inspiration') return 320
    const asset = this.editor.getAssets().find(asset => asset.id === node.assetId)
    const imageWidth = NODE_WIDTH_PX - FRAME_PX * 2
    const imageHeight = asset?.type === 'image' ? imageWidth * asset.props.h / asset.props.w : 260
    return FRAME_PX + Math.max(200, Math.min(460, imageHeight)) + CAPTION_PX + (node.stale ? 24 : 0)
  }
  getPorts(shape: NodeShape, node: UnfoldNode): NodeTypePorts {
    const output = { id: 'output', terminal: 'start' as const, x: NODE_WIDTH_PX / 2, y: this.getBodyHeightPx(shape, node) }
    if (node.type === 'opportunity') return { output,
      'goal-0': { id: 'goal-0', terminal: 'end', x: NODE_WIDTH_PX / 3, y: 0 },
      'goal-1': { id: 'goal-1', terminal: 'end', x: NODE_WIDTH_PX * 2 / 3, y: 0 },
    }
    return { output, input: { id: 'input', terminal: 'end', x: NODE_WIDTH_PX / 2, y: 0 } }
  }
  Component = UnfoldCard
}

type ActionNode = Extract<UnfoldNode, { type: 'action' }>
/** Wrapped line count, counting each paragraph or bullet on its own line. */
const lines = (text: string, perLine: number) => Math.max(1, text.split('\n').reduce((sum, paragraph) => sum + Math.max(1, Math.ceil(paragraph.length / perLine)), 0))
/** Estimated card height so a next step fits its title, summary, chips and checklist without scrolling. */
function actionHeight(node: ActionNode, expanded: boolean) {
  const structured = Boolean(node.summary || node.steps)
  let height = 40 + 16 + lines(node.title, 26) * 28 + 10
  if (node.summary) height += lines(node.summary, 44) * 21 + 10
  if (node.meta && Object.values(node.meta).some(Boolean)) height += 34
  for (const step of node.steps ?? []) height += lines(step, 38) * 20 + 8
  const extra = structured ? node.description.trim() : ''
  if (!structured) height += (expanded ? lines(node.description, 42) : Math.min(4, lines(node.description, 42))) * 22.2 + (lines(node.description, 42) > 4 ? 30 : 0)
  else if (extra) height += 30 + (expanded ? lines(extra, 46) * 21 + 6 : 0)
  height += node.sources.length * 30 + (node.completed && node.reflection ? lines(node.reflection, 46) * 20 + 20 : 8)
  return Math.round(Math.max(200, height))
}
const domain = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }

/** A next step: a one-line why, quick facts as chips, a short checklist and compact source links. */
function ActionBody({ shape, node }: { shape: NodeShape; node: ActionNode }) {
  const editor = useEditor(); const api = actions.get(editor)
  // View state lives in the card's props so its height, selection outline and ports all follow; it is not an undoable edit.
  const expanded = node.expanded === true
  const setView = (view: { expanded?: boolean; fit?: number | undefined }) => editor.run(() => {
    const current = editor.getShape(shape.id)
    if (!current || current.type !== 'node' || current.props.node.type !== 'action') return
    const { fit: _fit, ...rest } = current.props.node
    const fit = 'fit' in view ? view.fit : current.props.node.fit
    editor.updateShape({ id: shape.id, type: 'node', props: { node: { ...rest, expanded: view.expanded ?? rest.expanded, ...(fit === undefined ? {} : { fit }) } } })
  }, { history: 'ignore' })
  const toggle = () => { setView({ expanded: !expanded }) }
  // The character-count estimate is only a first guess: the card takes the measured height of its content.
  const content = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = content.current
    const card = element?.closest('.unfold-card')
    if (!element || !(card instanceof HTMLElement)) return
    const fit = () => {
      const parts = [card.querySelector('.card-header'), ...Array.from(element.parentElement?.children ?? []).filter(child => !child.classList.contains('card-footer'))]
      const needed = Math.ceil(parts.reduce((sum, part) => sum + (part instanceof HTMLElement ? part.offsetHeight : 0), 0) + card.offsetHeight - card.clientHeight)
      const current = editor.getShape(shape.id)
      if (!current || current.type !== 'node' || Math.abs(getNodeHeightPx(editor, current) - needed) <= 1) return
      setView({ fit: needed })
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [editor, shape.id, expanded])
  const structured = Boolean(node.summary || node.steps)
  const extra = structured ? node.description.trim() : ''
  const long = !structured && lines(node.description, 42) > 4
  const meta = [{ icon: <Clock size={12}/>, text: node.meta?.time }, { icon: <Wallet size={12}/>, text: node.meta?.cost }, { icon: <MapPin size={12}/>, text: node.meta?.place }].flatMap(item => item.text ? [{ icon: item.icon, text: item.text }] : [])
  const done = new Set(node.doneSteps ?? [])
  return <div ref={content} className="card-content action-body">
    <h2>{node.title}</h2>
    {node.summary && <p className="action-summary">{node.summary}</p>}
    {isNotEmpty(meta) && <div className="action-meta">{meta.map(item => <span key={item.text} className="meta-chip">{item.icon}{item.text}</span>)}</div>}
    {node.steps && <ul className="action-steps">{node.steps.map((step, index) => <li key={index} className={done.has(index) ? 'is-done' : ''}><button type="button" role="checkbox" aria-checked={done.has(index)} aria-label={step} onClick={() => api?.toggleStep(shape.id, index)}>{done.has(index) && <Check size={11} strokeWidth={3}/>}</button><span>{step}</span></li>)}</ul>}
    {!structured && <p className={`description ${expanded ? '' : 'clamped'}`}>{node.description}</p>}
    {long && <button type="button" className="details-toggle" aria-expanded={expanded} onClick={toggle}>{expanded ? 'Show less' : 'Show more'}<ChevronDown size={12}/></button>}
    {extra && <><button type="button" className="details-toggle" aria-expanded={expanded} onClick={toggle}>{expanded ? 'Hide details' : 'More details'}<ChevronDown size={12}/></button>{expanded && <p className="action-details">{extra}</p>}</>}
    {isNotEmpty(node.sources) && <div className="source-chips">{node.sources.map(source => <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer" title={source.title}>{domain(source.url)}<ExternalLink size={11}/></a>)}</div>}
  </div>
}

function UnfoldCard({ shape, node }: NodeComponentProps<UnfoldNode>) {
  const editor = useEditor(); const api = actions.get(editor)
  const state = useValue('node chat status', () => uiState.get(editor), [editor])
  const asset = useValue('image asset', () => node.type === 'inspiration' ? editor.getAssets().find(asset => asset.id === node.assetId) : undefined, [editor, node])
  const [src, setSrc] = useState('')
  useEffect(() => {
    let current = true
    if (!asset || asset.type !== 'image') return
    void editor.resolveAssetUrl(asset.id, { screenScale: 1 }).then(url => { if (current) setSrc(url || '') }).catch(() => { if (current) setSrc('') })
    return () => { current = false }
  }, [editor, asset])
  const selected = useValue('card selected', () => editor.getSelectedShapeIds().includes(shape.id), [editor, shape.id])
  // tldraw hit-tests the photo itself (it has no DOM pointer events), so CSS :hover cannot see it.
  const hovered = useValue('card hovered', () => editor.getHoveredShapeId() === shape.id, [editor, shape.id])
  const chats = useValue('card conversations', () => conversationsFor(editor, shape.id), [editor, shape.id])
  const count = chats.length
  const busy = chats.some(chat => state.jobs[chat.id]?.status === 'running')
  const active = state.activeChat?.nodeId === shape.id
  const step = useValue('step number', () => node.type === 'action' ? lineage(nodes(editor).map(item => ({ id: item.id, node: item.props.node })), shape.id).filter(record => record.node.type === 'action').length : 0, [editor, shape.id, node.type])
  const label = node.type === 'inspiration' ? 'Inspiration' : node.type === 'opportunity' ? 'Shared direction' : node.type === 'action' ? `Step ${Math.max(1, step)}` : node.type === 'artifact' ? node.content.kind === 'moodboard' ? 'Moodboard' : 'Note' : 'Earlier exploration'
  return <article className={`unfold-card card-${node.type} ${active ? 'chat-is-open' : ''} ${selected ? 'is-selected' : ''} ${hovered ? 'is-hovered' : ''} ${busy ? 'is-busy' : ''} ${node.stale ? 'is-stale' : ''}`}>
    {node.type === 'inspiration' && <Tape/>}
    {node.type === 'inspiration' ? <div className="inspiration-image" title="Drag to move · double-click to explore" onDoubleClick={event => { editor.markEventAsHandled(event); api?.openChat(shape.id) }}>{src ? <img src={src} alt={node.goal} draggable={false}/> : <div className="image-placeholder"><Sparkles/></div>}<Blossom className="card-sticker" size={22}/></div> : <header className="card-header"><span className="card-eyebrow">{label}</span></header>}
    <div className="card-interactive" onPointerDown={event => editor.markEventAsHandled(event)} onKeyDown={event => event.stopPropagation()}>
      {node.type === 'inspiration' ? <div className="inspiration-content"><Input aria-label="Inspiration goal" className="inspiration-title h-auto border-0 bg-transparent p-0 shadow-none focus-visible:ring-0" defaultValue={node.goal} key={`${shape.id}-${node.revision}`} maxLength={600} onBlur={event => { if (event.target.value.trim() && event.target.value.trim() !== node.goal) api?.updateGoal(shape.id, event.target.value) }}/></div> : node.type === 'action' ? <ActionBody shape={shape} node={node}/> : node.type === 'artifact' ? <div className="card-content"><Input aria-label="Card title" className="artifact-title h-auto border-0 bg-transparent p-0 shadow-none focus-visible:ring-0" defaultValue={node.content.title} key={node.revision} maxLength={600} onBlur={event => { if (event.target.value.trim() && event.target.value.trim() !== node.content.title) api?.applyBoardEdits([{ kind: 'updateNode', nodeId: shape.id, title: event.target.value }]) }}/><ArtifactContent content={node.content}/></div> : <div className="card-content"><h2>{nodeTitle(node)}</h2>{node.type === 'opportunity' && <p className="description">{node.description}</p>}{node.type === 'opportunity' && <div className="node-benefits"><p>{node.benefitA}</p><p>{node.benefitB}</p></div>}{node.type === 'opportunity' && node.sources && isNotEmpty(node.sources) && <div className="source-chips">{node.sources.map(source => <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer" title={source.title}>{domain(source.url)}<ExternalLink size={11}/></a>)}</div>}</div>}
      {node.stale && <div className="stale-banner">Sources or conditions changed · revisit this direction</div>}
      {node.type === 'opportunity' && node.status === 'rejected' && <div className="stale-banner declined-banner">Declined · agents won’t develop this direction</div>}
      {node.type === 'action' && node.completed && node.reflection && <div className="node-completion"><span><small>{node.reflection}</small></span></div>}
      <footer className="card-footer"><Button variant="secondary" size="sm" className="explore-button" aria-label={`Explore ${nodeTitle(node)}`} aria-expanded={active} onClick={() => api?.openChat(shape.id)}>{busy ? <LoaderCircle size={15} className="spin"/> : <MessageCircle size={15}/>}<span>{active || count ? 'Continue' : 'Explore'}</span><ArrowRight size={13}/></Button>{node.type === 'inspiration' && <LinkPill shapeId={shape.id}/>}<Button variant="secondary" size="icon-sm" aria-label={`Ask Unfold about ${nodeTitle(node)}`} title="Ask Unfold" onClick={() => api?.startChat(shape.id)}><MessageSquarePlus size={15}/></Button><Button variant="secondary" size="icon-sm" className="remove-button" aria-label={`Remove ${nodeTitle(node)}`} onClick={() => api?.requestRemove([shape.id])}><Trash2 size={13}/></Button></footer>
    </div>
  </article>
}
