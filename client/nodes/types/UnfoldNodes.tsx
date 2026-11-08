import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Textarea } from '../../components/ui/textarea'
import { useEffect, useState } from 'react'
import { T, useEditor, useValue } from 'tldraw'
import { ArrowRight, Check, ChevronDown, ChevronUp, ExternalLink, GripHorizontal, Link2, LoaderCircle, Move, RotateCcw, Sparkles, Square, Star, Trash2 } from 'lucide-react'
import { isUnfoldNode, type UnfoldNode } from '../../../shared/schema'
import { actions, collapsedBranches, uiState } from '../../actions'
import type { NodeTypePorts } from '../nodeTypes'
import { NODE_WIDTH_PX } from '../../constants'
import { defaultInspiration, nodes } from '../../unfold'
import type { NodeShape } from '../NodeShapeUtil'
import { type NodeComponentProps, NodeDefinition } from './shared'

export class UnfoldNodeDefinition extends NodeDefinition<UnfoldNode> {
  static type = 'inspiration'
  static validator = new T.Validator<UnfoldNode>(value => { if (!isUnfoldNode(value)) throw new Error('Invalid node'); return value })
  title = 'Inspiration'; heading = 'Unfold'; icon = <Sparkles />
  getDefault() { return defaultInspiration() }
  getBodyWidthPx(_shape: NodeShape, _node: UnfoldNode) { return NODE_WIDTH_PX }
  getBodyHeightPx(_shape: NodeShape, node: UnfoldNode) {
    if (node.type === 'inspiration') return 348
    if (node.type === 'answer') return 220
    if (node.type === 'question') return 390
    if (node.type === 'opportunity') return 472
    return 455
  }
  getPorts(shape: NodeShape, node: UnfoldNode): NodeTypePorts {
    const height = this.getBodyHeightPx(shape, node)
    const output = { id: 'output', terminal: 'start' as const, x: NODE_WIDTH_PX / 2, y: height }
    if (node.type === 'inspiration') return { output, input: { id: 'input', terminal: 'end', x: NODE_WIDTH_PX / 2, y: 0 } }
    if (node.type === 'opportunity') return { output,
      'goal-0': { id: 'goal-0', terminal: 'end' as const, x: NODE_WIDTH_PX / 3, y: 0 },
      'goal-1': { id: 'goal-1', terminal: 'end' as const, x: NODE_WIDTH_PX * 2 / 3, y: 0 },
    }
    return { input: { id: 'input', terminal: 'end' as const, x: NODE_WIDTH_PX / 2, y: 0 }, output }
  }
  Component = UnfoldCard
}

function UnfoldCard({ shape, node }: NodeComponentProps<UnfoldNode>) {
  const editor = useEditor(); const api = actions.get(editor)
  const state = useValue('unfold state', () => uiState.get(editor), [editor])
  const collapsed = useValue('collapsed', () => collapsedBranches.get(editor).includes(node.branchId), [editor, node.branchId])
  const answer = useValue('answer', () => nodes(editor).find(s => s.props.node.type === 'answer' && s.props.node.questionId === shape.id)?.props.node, [editor, shape.id])
  const asset = useValue('image asset', () => {
    if (node.type !== 'inspiration') return undefined
    return editor.getAssets().find(asset => asset.id === node.assetId)
  }, [editor, node])
  const [src, setSrc] = useState('')
  useEffect(() => {
    let current = true
    if (!asset || asset.type !== 'image') return
    void editor.resolveAssetUrl(asset.id, { screenScale: 1 }).then(url => { if (current) setSrc(url || '') }).catch(() => { if (current) setSrc('') })
    return () => { current = false }
  }, [editor, asset])
  const [comment, setComment] = useState(''); const [choice, setChoice] = useState(''); const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(node.type === 'answer' ? node.text : '')
  const job = state.jobs[shape.id]
  const busy = job?.status === 'running'
  const label = node.type === 'inspiration' ? 'INSPIRATION' : node.type === 'question' ? 'A LITTLE CLARITY' : node.type === 'answer' ? 'YOUR DIRECTION' : node.type === 'opportunity' ? 'A SHARED POSSIBILITY' : 'YOUR FIRST STEP'
  return <article className={`unfold-card card-${node.type} ${node.stale ? 'is-stale' : ''}`}>
    <header className="card-header"><span className="card-eyebrow">{node.type === 'opportunity' ? <Link2 size={12}/> : node.type === 'answer' ? <Check size={12}/> : <Sparkles size={12}/>} {label}</span><GripHorizontal size={16} className="drag-grip"/></header>
    <div className="card-interactive" onPointerDown={event => editor.markEventAsHandled(event)} onKeyDown={event => event.stopPropagation()}>
      {node.type === 'inspiration' && <>
        <div className="inspiration-image">{src ? <img src={src} alt={node.goal} draggable={false}/> : <div className="image-placeholder"><Sparkles/></div>}<span className="image-caption">a possibility, waiting</span></div>
        <div className="inspiration-content"><Input aria-label="Inspiration goal" className="h-auto rounded-none border-0 bg-transparent p-0 font-serif text-[22px] leading-[1.2] shadow-none md:text-[22px]" defaultValue={node.goal} key={`${shape.id}-${node.revision}`} maxLength={600} onBlur={event => { if (event.target.value.trim() && event.target.value.trim() !== node.goal) api?.updateGoal(shape.id, event.target.value) }}/><p>Where could this take you?</p>
          <Button variant="star" size="icon-sm" className="absolute right-4 top-4" data-started={node.started} aria-label={`Explore ${node.goal}`} title="Start or continue this inspiration" disabled={busy} onClick={() => api?.start(shape.id)}>{busy ? <LoaderCircle className="spin" size={20}/> : <Star className="size-5"/>}</Button>
        </div>
        <div className="root-controls"><Button variant="ghost" size="compact" aria-expanded={!collapsed} onClick={() => api?.collapse(node.branchId)}>{collapsed ? <ChevronDown size={13}/> : <ChevronUp size={13}/>} {collapsed ? 'Expand branch' : 'Fold branch'}</Button><Button variant="ghost" size="compact" onClick={() => api?.moveBranch(node.branchId)}><Move size={13}/> Move branch</Button></div>
      </>}
      {node.type === 'question' && <div className="card-body"><div className="card-content"><h2>{node.prompt}</h2><p className="muted small question-purpose">{node.purpose}</p><div className="choices">{node.options.map(option => <Button variant="outline" size="compact" key={option} className="max-w-full whitespace-normal text-left" aria-pressed={choice === option} disabled={busy} onClick={() => setChoice(option)}>{choice === option && <Check size={12}/>} {option}</Button>)}</div></div><div className="card-actions"><Textarea className="mb-2 h-14 min-h-14 field-sizing-fixed resize-none bg-background text-base md:text-xs" aria-label="Add a little context" placeholder="A little more context… (optional)" maxLength={1200} value={comment} onChange={event => setComment(event.target.value)}/><Button size="compact" className="w-full" disabled={busy || (!choice && !comment.trim())} onClick={() => { api?.answer(shape.id, choice, comment); setComment('') }}>{answer ? 'Update my direction' : 'Follow this thread'} <ArrowRight size={14}/></Button><Button variant="link" size="text" disabled={busy} onClick={() => api?.start(shape.id)}>Try another direction <RotateCcw size={11}/></Button></div></div>}
      {node.type === 'answer' && <div className="card-body answer-body">{editing ? <form className="answer-form" onSubmit={event => { event.preventDefault(); if (draft.trim()) { api?.updateAnswer(shape.id, draft); setEditing(false); api?.start(shape.id) } }}><Textarea className="mb-2 min-h-0 flex-1 field-sizing-fixed resize-none bg-background text-base md:text-xs" aria-label="Edit your answer" maxLength={2000} value={draft} onChange={event => setDraft(event.target.value)}/><Button variant="link" size="text" type="submit">Save & continue <ArrowRight size={13}/></Button></form> : <><div className="card-content"><p className="answer-text">“{node.text}”</p></div><Button variant="link" size="text" onClick={() => { setDraft(node.text); setEditing(true) }}>Edit my answer</Button></>}</div>}
      {node.type === 'opportunity' && <div className="card-body"><div className="card-content"><div className="connection-mark"><Link2 size={22}/><span>Two inspirations.<br/>One new direction.</span></div><h2>{node.title}</h2><p className="description">{node.description}</p><div className="benefits"><p><span>01</span>{node.benefitA}</p><p><span>02</span>{node.benefitB}</p></div></div><div className="card-actions">
        {node.status === 'proposed' ? <><div className="decision-buttons"><Button size="compact" className="flex-1" disabled={busy} onClick={() => api?.decide(shape.id, true)}>Explore this <ArrowRight size={14}/></Button><Button variant="outline" size="compact" disabled={busy} onClick={() => api?.decide(shape.id, false)}>Not this time</Button></div><form className="refine-form" onSubmit={event => { event.preventDefault(); api?.refine(shape.id, comment); setComment('') }}><Input className="h-auto rounded-none border-0 bg-transparent px-0 py-2 text-base shadow-none md:text-xs" aria-label="Refine the connection" placeholder="Or tell us what to change…" value={comment} maxLength={1200} onChange={event => setComment(event.target.value)}/><Button variant="ghost" size="icon-xs" type="submit" aria-label="Refine connection" disabled={busy || !comment.trim()}><ArrowRight size={15}/></Button></form></> : <><div className={`decision-state ${node.status}`}><Check size={15}/>{node.status === 'accepted' ? 'A direction worth exploring' : 'Set aside. Your other paths stay open.'}</div>{node.status === 'accepted' && <Button variant="link" size="text" disabled={busy || node.stale} onClick={() => api?.research(shape.id, 'Find a sourced first step for this accepted shared direction.')}>Find my first step <ArrowRight size={13}/></Button>}</>}
      </div></div>}
      {node.type === 'action' && <div className="card-body"><div className="card-content"><div className="action-kicker">Small enough to start.</div><h2>{node.title}</h2><p className="description action-description">{node.description}</p><div className="sources">{node.sources.map(source => <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer"><span>{source.title}</span><ExternalLink size={13}/></a>)}</div></div><div className="card-actions">{node.completed ? <div className="completed-note"><Check size={15}/><span>First step taken.{node.reflection && <small>{node.reflection}</small>}</span></div> : <><Textarea className="mb-2 h-14 min-h-14 field-sizing-fixed resize-none bg-background text-base md:text-xs" aria-label="Reflection" placeholder="How did it feel? Leave a note when you try it." maxLength={1200} value={comment} onChange={event => setComment(event.target.value)}/><Button size="compact" className="w-full" onClick={() => api?.complete(shape.id, comment)}><Check size={14}/> I took the first step</Button></>}{node.completed && <Button variant="link" size="text" onClick={() => api?.start(shape.id)}>What could come next? <ArrowRight size={13}/></Button>}</div></div>}
      {node.stale && <div className="stale-banner">Your direction changed. <Button variant="link" size="text" onClick={() => node.type === 'opportunity' ? api?.refine(shape.id, 'Reconsider using the updated goals and answers.') : api?.start(shape.id)}>Refresh</Button></div>}
      {job && <div className={`job-state ${job.status}`} role="status">{busy ? <LoaderCircle size={13} className="spin"/> : <RotateCcw size={13}/>}<span>{job.message}</span><Button variant="outline" size="compact" aria-label={busy ? 'Stop request' : 'Retry request'} onClick={() => busy ? api?.stop(shape.id) : api?.retry(shape.id)}>{busy ? <Square size={11}/> : 'Retry'}</Button></div>}
      {node.type !== 'inspiration' && <div className="card-footer"><span>{node.agent === 'you' ? 'Confirmed by you' : node.agent === 'connection' ? 'Connection agent · a suggestion' : 'Branch agent · a suggestion'}</span><Button variant="ghost" size="icon-xs" aria-label="Remove this option" title="Remove this option" onClick={() => api?.remove(shape.id)}><Trash2 size={12}/></Button></div>}
    </div>
  </article>
}
