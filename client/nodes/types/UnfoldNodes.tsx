import { useEffect, useState } from 'react'
import { T, useEditor, useValue } from 'tldraw'
import { ArrowRight, Check, ExternalLink, LoaderCircle, MessageCircle, Sparkles, Trash2 } from 'lucide-react'
import { isUnfoldNode, type UnfoldNode } from '../../../shared/schema'
import { nodeTitle } from '../../../shared/chats'
import { actions, uiState } from '../../actions'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import type { NodeTypePorts } from '../nodeTypes'
import { NODE_WIDTH_PX } from '../../constants'
import { Blossom, Tape } from '../../decor'

// Inspiration cards are slim polaroids: a thin frame around the photo, its proportions kept within a range.
const FRAME_PX = 10
const CAPTION_PX = 52
import { defaultInspiration } from '../../unfold'
import type { NodeShape } from '../NodeShapeUtil'
import { type NodeComponentProps, NodeDefinition } from './shared'

export class UnfoldNodeDefinition extends NodeDefinition<UnfoldNode> {
  static type = 'inspiration'
  static validator = new T.Validator<UnfoldNode>(value => { if (!isUnfoldNode(value)) throw new Error('Invalid node'); return value })
  title = 'Inspiration'; heading = 'Unfold'; icon = <Sparkles/>
  getDefault() { return defaultInspiration() }
  getBodyWidthPx(_shape: NodeShape, _node: UnfoldNode) { return NODE_WIDTH_PX }
  getBodyHeightPx(_shape: NodeShape, node: UnfoldNode) {
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
  const count = node.chats?.length ?? 0
  const busy = node.chats?.some(chat => state.jobs[chat.id]?.status === 'running')
  const active = state.activeChat?.nodeId === shape.id
  const label = node.type === 'inspiration' ? 'Inspiration' : node.type === 'opportunity' ? 'Shared direction' : node.type === 'action' ? 'Next step' : 'Earlier exploration'
  return <article className={`unfold-card card-${node.type} ${active ? 'chat-is-open' : ''} ${selected ? 'is-selected' : ''} ${hovered ? 'is-hovered' : ''} ${busy ? 'is-busy' : ''} ${node.stale ? 'is-stale' : ''}`}>
    {node.type === 'inspiration' && <Tape/>}
    {node.type === 'inspiration' ? <div className="inspiration-image" title="Drag to move · double-click to explore" onDoubleClick={event => { editor.markEventAsHandled(event); api?.openChat(shape.id) }}>{src ? <img src={src} alt={node.goal} draggable={false}/> : <div className="image-placeholder"><Sparkles/></div>}<Blossom className="card-sticker" size={22}/></div> : <header className="card-header"><span className="card-eyebrow">{label}</span></header>}
    <div className="card-interactive" onPointerDown={event => editor.markEventAsHandled(event)} onKeyDown={event => event.stopPropagation()}>
      {node.type === 'inspiration' ? <div className="inspiration-content"><Input aria-label="Inspiration goal" className="inspiration-title h-auto border-0 bg-transparent p-0 shadow-none focus-visible:ring-0" defaultValue={node.goal} key={`${shape.id}-${node.revision}`} maxLength={600} onBlur={event => { if (event.target.value.trim() && event.target.value.trim() !== node.goal) api?.updateGoal(shape.id, event.target.value) }}/></div> : <div className="card-content"><h2>{nodeTitle(node)}</h2>{(node.type === 'action' || node.type === 'opportunity') && <p className="description">{node.description}</p>}{node.type === 'action' && <div className="sources">{node.sources.map(source => <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">{source.title}<ExternalLink size={12}/></a>)}</div>}{node.type === 'opportunity' && <div className="node-benefits"><p>{node.benefitA}</p><p>{node.benefitB}</p></div>}</div>}
      {node.stale && <div className="stale-banner">Source updated · revisit this direction</div>}
      {node.type === 'action' && <div className="node-completion">{node.completed ? <span><Check size={13}/> First step taken{node.reflection && <small>{node.reflection}</small>}</span> : <Button variant="ghost" size="sm" onClick={() => api?.complete(shape.id, '')}><Check size={13}/> Mark as done</Button>}</div>}
      <footer className="card-footer"><Button variant="secondary" size="sm" className="explore-button" aria-label={`Explore ${nodeTitle(node)}`} aria-expanded={active} onClick={() => api?.openChat(shape.id)}>{busy ? <LoaderCircle size={15} className="spin"/> : <MessageCircle size={15}/>}<span>{active ? 'Continue conversation' : count ? 'Continue exploring' : 'Explore'}</span><ArrowRight size={13}/></Button><Button variant="secondary" size="icon-sm" className="remove-button" aria-label={`Remove ${nodeTitle(node)}`} onClick={() => api?.remove(shape.id)}><Trash2 size={13}/></Button></footer>
    </div>
  </article>
}
