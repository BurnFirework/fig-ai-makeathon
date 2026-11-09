import { isEmpty, isNotEmpty } from '../../shared/arrays'
import { useEffect, useRef, useState } from 'react'
import { type TLShapeId, useEditor, useValue } from 'tldraw'
import { ArrowRight, Brain, Check, ChevronDown, ExternalLink, LayoutPanelLeft, Link2, LoaderCircle, Maximize2, MessageCircle, Pencil, Plus, RotateCcw, Square, Undo2, X } from 'lucide-react'
import { canPublish, contextThreads, currentRevisions, decisionOf, nodeTitle } from '../../shared/chats'
import { chatMemory, mergeMemory, type MemoryItem, type MemoryView } from '../../shared/memory'
import type { NodeShape } from '../nodes/NodeShapeUtil'
import { type Chat, type ChatMessage, type Handoff, revisionsMatch } from '../../shared/schema'
import { actions, uiState } from '../actions'
import { fitBoard, nodeAt, nodes } from '../unfold'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'

export function ChatPanel() {
  const editor = useEditor()
  const state = useValue('active conversation', () => uiState.get(editor), [editor])
  const source = useValue('conversation source', () => state.activeChat ? nodeAt(editor, state.activeChat.nodeId) : undefined, [editor, state.activeChat])
  const chat = source?.props.node.chats?.find(chat => chat.id === state.activeChat?.chatId)
  if (!source || !chat) return null
  return <Conversation key={chat.id} sourceId={source.id} title={nodeTitle(source.props.node)} chat={chat} chats={source.props.node.chats ?? []}/>
}

function Conversation({ sourceId, title, chat, chats }: { sourceId: TLShapeId; title: string; chat: Chat; chats: Chat[] }) {
  const editor = useEditor(); const api = actions.get(editor)
  const state = useValue('conversation status', () => uiState.get(editor), [editor])
  const sources = useValue('chat sources', () => chat.sourceIds.flatMap(id => nodes(editor).filter(shape => shape.id === id)), [editor, chat.sourceIds])
  const [draft, setDraft] = useState('')
  const bottom = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { composer.current?.focus({ preventScroll: true }) }, [])
  const job = state.jobs[chat.id]; const busy = job?.status === 'running'
  const lastAssistant = chat.messages.filter(message => message.role === 'assistant').at(-1)
  const revisions = useValue('dependency revisions', () => currentRevisions(nodes(editor).map(shape => ({ id: shape.id, node: shape.props.node }))), [editor])
  const memory = useValue('conversation memory', () => {
    const records = nodes(editor).map(shape => ({ id: shape.id, node: shape.props.node }))
    return chat.branchIds.map(branchId => {
      const root = records.find(record => record.id === branchId)?.node
      return { branchId, goal: root?.type === 'inspiration' ? root.goal : 'This goal', view: mergeMemory(contextThreads(records, sourceId, chat, branchId)) }
    })
  }, [editor, sourceId, chat])
  const waiting = !job && lastAssistant?.role === 'assistant' && chat.messages.at(-1)?.id === lastAssistant.id && revisionsMatch(lastAssistant.dependsOn, revisions)
    ? lastAssistant.proposal.kind === 'question' ? 'Agents paused · waiting for your answer' : lastAssistant.proposal.kind === 'opportunity' && !decisionOf(lastAssistant) ? 'Agents paused · waiting for your decision on this proposal' : '' : ''
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }) }, [chat.messages.length, busy])
  function send(text = draft) {
    if (!text.trim() || busy) return
    api?.send(sourceId, chat.id, text, lastAssistant?.id)
    setDraft('')
  }
  return <aside className={`chat-panel ${state.chatView === 'focus' ? 'focus-mode' : 'board-mode'}`} aria-label="Node conversation" onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') api?.closeChat() }}>
    <header className="chat-panel-header">
      <div className="chat-heading"><h2 title={title}>{state.chatView === 'focus' ? 'Explore this idea' : title}</h2></div>
      <div className="chat-view-controls" role="group" aria-label="Chat view"><Button variant="ghost" size="sm" aria-label="Focus view" aria-pressed={state.chatView === 'focus'} title="Focus on this image and its conversation" onClick={() => uiState.update(editor, state => ({ ...state, chatView: 'focus' }))}><Maximize2 size={14}/><span>Focus</span></Button><Button variant="ghost" size="sm" aria-label="Board and chat view" aria-pressed={state.chatView === 'board'} title="Keep the board visible beside the conversation" onClick={() => { uiState.update(editor, state => ({ ...state, chatView: 'board' })); fitBoard(editor) }}><LayoutPanelLeft size={14}/><span>Board & chat</span></Button></div>
      <Button variant="ghost" size="icon-sm" aria-label="Close chat" onClick={() => api?.closeChat()}><X size={17}/></Button>
    </header>
    {state.chatView === 'focus' && <section className="focus-content" aria-label="Conversation source content">{sources.map(source => <FocusContent key={source.id} source={source}/>)}</section>}
    <div className="conversation-body">
    <div className="chat-navigation">
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="chat-switcher" aria-label="Switch conversation"/>}><span className="truncate">{chat.title}</span><ChevronDown size={13}/></DropdownMenuTrigger><DropdownMenuContent className="w-72" onKeyDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>{chats.map(item => <DropdownMenuItem key={item.id} onClick={() => api?.openChat(sourceId, item.id)}><MessageCircle size={14}/><span className="truncate">{item.title}</span>{item.id === chat.id && <Check size={13}/>}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
      <Button variant="ghost" size="icon-sm" title="Start a separate exploration" aria-label="New conversation" onClick={() => api?.newChat(sourceId)}><Plus size={16}/></Button>
    </div>
    {sources.length > 1 && <div className="chat-source-row"><Link2 size={13}/><span>Bringing together</span>{sources.map(source => <button key={source.id} title={nodeTitle(source.props.node)} onClick={() => { uiState.update(editor, state => ({ ...state, chatView: 'board' })); editor.select(source.id); fitBoard(editor) }}>{nodeTitle(source.props.node)}</button>)}</div>}
    <MemoryPanel views={memory} chat={chat} sourceId={sourceId}/>
    <div className="chat-messages" role="log" aria-label="Conversation messages" tabIndex={0}>
      {isEmpty(chat.messages) && !busy && <div className="chat-welcome"><MessageCircle size={26}/><h3>Where could this take you?</h3><p>Try an idea, ask a question, or tell us what caught your eye.</p></div>}
      {chat.messages.map(message => <Message key={message.id} message={message} chat={chat} sourceId={sourceId} isLatest={message.id === lastAssistant?.id} busy={busy} stale={message.role === 'assistant' && !revisionsMatch(message.dependsOn, revisions)} onChoice={text => send(text)}/>)}
      {job && <div className={`chat-job ${job.status}`} role="status">{busy ? <LoaderCircle size={15} className="spin"/> : <RotateCcw size={15}/>}<span>{job.message}</span><Button variant="ghost" size="icon-sm" aria-label={busy ? 'Stop request' : 'Retry request'} onClick={() => busy ? api?.stop(chat.id) : api?.retry(chat.id)}>{busy ? <Square size={13}/> : <RotateCcw size={14}/>}</Button></div>}
      {busy && job.handoffs && isNotEmpty(job.handoffs) && <ol className="live-handoffs" aria-label="What the agents are doing">{job.handoffs.map((handoff, index) => <HandoffLine key={index} handoff={handoff}/>)}</ol>}
      {waiting && <div className="chat-waiting" role="status">{waiting}</div>}
      <div ref={bottom}/>
    </div>
    <form className="chat-compose" onSubmit={event => { event.preventDefault(); send() }}>
      <Textarea ref={composer} className="rounded-none border-0 bg-transparent p-1 text-xs shadow-none focus-visible:ring-0 md:text-xs" aria-label="Message" placeholder="Think out loud…" value={draft} maxLength={2000} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() } }}/>
      <div className="compose-footer"><span>{state.mode === 'demo' ? 'Preview · sample responses' : state.provider}</span><Button size="icon-sm" type="submit" aria-label="Send message" disabled={busy || !draft.trim()}><ArrowRight size={17}/></Button></div>
    </form>
    </div>
  </aside>
}

const ROLE_NAMES: Record<Handoff['from'], string> = { branch: 'Branch agent', research: 'Research agent', connection: 'Connection agent', coordinator: 'Coordinator', you: 'You' }
const roleName = (role: Handoff['from'], label?: string) => role === 'branch' && label ? `${ROLE_NAMES[role]} · ${label}` : ROLE_NAMES[role]
function HandoffLine({ handoff }: { handoff: Handoff }) {
  return <li className={`handoff outcome-${handoff.outcome}`}><span className="handoff-route">{roleName(handoff.from, handoff.fromLabel)} → {roleName(handoff.to, handoff.toLabel)}</span><span>{handoff.summary}</span></li>
}

const scrollToMessage = (id: string) => {
  const element = document.getElementById(`message-${id}`)
  element?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  element?.classList.add('is-flashing'); setTimeout(() => element?.classList.remove('is-flashing'), 1200)
}

function MemoryPanel({ views, chat, sourceId }: { views: { branchId: string; goal: string; view: MemoryView }[]; chat: Chat; sourceId: TLShapeId }) {
  const editor = useEditor(); const api = actions.get(editor)
  const shared = views.length === 2
  const own = (views[0]?.view.active ?? []).filter(item => item.chatId === chat.id)
  const groups = shared
    ? [{ title: 'This conversation', items: own }, ...views.map(view => ({ title: view.goal, items: view.view.active.filter(item => item.inherited) }))]
    : [{ title: '', items: views[0]?.view.active ?? [] }]
  const changes = views.flatMap(view => view.view.history).filter((change, index, all) => all.findIndex(other => other.before === change.before && other.after === change.after) === index)
  const all = groups.flatMap(group => group.items)
  const confirmed = all.filter(item => item.kind === 'intent' || item.kind === 'constraint').length
  const assumptions = all.filter(item => item.kind === 'assumption').length
  if (isEmpty(all) && isEmpty(changes)) return null
  const entry = (item: MemoryItem) => <li key={`${item.chatId}-${item.id}`} className={`memory-item kind-${item.kind}`}>
    <span className="memory-kind">{item.kind === 'intent' ? 'Intent' : item.kind === 'constraint' ? 'Condition' : item.kind === 'assumption' ? 'AI assumption' : 'Declined'}</span>
    <span className="memory-text">{item.text}</span>
    {item.inherited ? <button className="memory-source" title="Open the conversation this came from" onClick={() => { const owner = nodes(editor).find(shape => shape.id === item.nodeId); if (owner) api?.openChat(owner.id, item.chatId) }}>earlier chat</button>
      : item.sources[0] && chat.messages.some(message => message.id === item.sources[0]) && <button className="memory-source" title="Show the message this came from" onClick={() => { if (item.sources[0]) scrollToMessage(item.sources[0]) }}>{item.by === 'agent' ? 'from a reply' : 'your message'}</button>}
    {!item.inherited && item.kind === 'assumption' && <button className="memory-action" aria-label={`Confirm ${item.text}`} title="Confirm this assumption" onClick={() => api?.confirmMemory(sourceId, chat.id, item.id)}><Check size={12}/></button>}
    {!item.inherited && <button className="memory-action" aria-label={`Forget ${item.text}`} title="Forget this (kept in history)" onClick={() => api?.forgetMemory(sourceId, chat.id, item.id)}><X size={12}/></button>}
  </li>
  return <details className="memory-panel">
    <summary><Brain size={13}/><span>What the agents know</span><small>{confirmed} confirmed{assumptions ? ` · ${assumptions} assumption${assumptions === 1 ? '' : 's'}` : ''}{isNotEmpty(changes) ? ` · ${changes.length} change${changes.length === 1 ? '' : 's'}` : ''}</small><ChevronDown size={13}/></summary>
    {groups.filter(group => isNotEmpty(group.items)).map(group => <section key={group.title || 'memory'}>{group.title && <h4>{group.title}</h4>}<ul>{group.items.map(entry)}</ul></section>)}
    {isNotEmpty(changes) && <section><h4>Changed</h4><ul>{changes.map(change => <li key={`${change.before}-${change.after}`} className="memory-change"><s>{change.before}</s><ArrowRight size={11}/><span>{change.after}</span></li>)}</ul></section>}
    <p className="memory-hint">Only your own words become confirmed. Tell the agent if something changed; the newest value replaces the old one.</p>
  </details>
}

function UserNotes({ message, chat }: { message: Extract<ChatMessage, { role: 'user' }>; chat: Chat }) {
  const entries = chatMemory(chat).entries
  const noted = entries.filter(entry => entry.sources.includes(message.id) && entry.by === 'you' && entry.kind !== 'assumption')
  const stance = message.stance
  if (isEmpty(noted)) {
    if (stance === 'question') return <small className="message-note">Kept as your question, not as a fact</small>
    if (stance === 'uncertain') return <small className="message-note">Not confirmed yet · agents may ask a short follow-up</small>
    return null
  }
  return <small className="message-note">{noted.map(entry => {
    const replaced = entry.replaces ? entries.find(other => other.id === entry.replaces) : undefined
    return <span key={entry.id}>{entry.kind === 'declined' ? 'Noted as declined' : 'Noted'}: {entry.text}{replaced ? ` (replaces ${replaced.text})` : ''}{entry.status !== 'active' ? ' · no longer active' : ''}</span>
  })}</small>
}

function Message({ message, chat, sourceId, isLatest, busy, stale, onChoice }: { message: ChatMessage; chat: Chat; sourceId: TLShapeId; isLatest: boolean; busy: boolean; stale: boolean; onChoice: (choice: string) => void }) {
  const editor = useEditor(); const api = actions.get(editor)
  const chatId = chat.id
  const outcome = useValue('published outcome', () => message.role === 'assistant' && message.outcomeId ? nodes(editor).find(shape => shape.id === message.outcomeId) : undefined, [editor, message])
  const [composing, setComposing] = useState<'decline' | 'refine' | null>(null)
  const [note, setNote] = useState('')
  if (message.role === 'user') return <div id={`message-${message.id}`} className="chat-message user-message"><span className="message-label">{message.stance === 'refine' ? 'You · requested changes' : 'You'}</span><p>{message.text}</p><UserNotes message={message} chat={chat}/></div>
  const proposal = message.proposal
  const viewCard = () => { if (!outcome) return; uiState.update(editor, state => ({ ...state, chatView: 'board' })); editor.select(outcome.id); fitBoard(editor) }
  const decision = decisionOf(message)
  const revisedFrom = message.revises ? chat.messages.find(item => item.id === message.revises) : undefined
  const submit = () => {
    if (composing === 'refine' && !note.trim()) return
    if (composing) api?.decide(sourceId, chatId, message.id, composing, note)
    setComposing(null); setNote('')
  }
  return <div id={`message-${message.id}`} className="chat-message assistant-message"><span className="message-label">Unfold</span>
    {proposal.kind === 'question' && <><p>{proposal.prompt}</p><small className="message-purpose">{proposal.purpose}</small>{isLatest && <div className="chat-choices">{proposal.options.map(option => <Button key={option} variant="outline" size="sm" className="h-auto whitespace-normal text-[11px]" disabled={busy} onClick={() => onChoice(option)}>{option}<ArrowRight size={12}/></Button>)}</div>}</>}
    {proposal.kind === 'research' && <p>{proposal.brief}</p>}
    {(proposal.kind === 'opportunity' || proposal.kind === 'action') && <div className={`chat-outcome ${decision ? `decision-${decision}` : ''}`}><div className="outcome-label">{proposal.kind === 'opportunity' ? (revisedFrom ? 'Shared direction · revised' : 'Shared direction') : 'Next step'}</div><h3>{proposal.title}</h3><p>{proposal.description}</p>
      {proposal.kind === 'opportunity' && <div className="outcome-benefits"><p>{proposal.benefitA}</p><p>{proposal.benefitB}</p></div>}
      {proposal.kind === 'action' && <div className="outcome-sources">{proposal.sources.map(source => <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">{source.title}<ExternalLink size={12}/></a>)}</div>}
      {stale && decision === undefined && <div className="outcome-stale" role="note">Your conditions or sources changed since this was proposed. Continue the chat for an updated version.</div>}
      {proposal.kind === 'action' && (canPublish(message) ? <Button size="sm" disabled={stale} onClick={() => api?.publish(sourceId, chatId, message.id)}><Plus size={14}/> Add to canvas</Button> : outcome ? <Button variant="outline" size="sm" onClick={viewCard}><Check size={14}/> View on canvas</Button> : <span className="outcome-removed">Outcome removed from canvas</span>)}
      {proposal.kind === 'opportunity' && <div className="decision-area">
        {decision === undefined && !composing && <><span className="decision-status">{stale ? 'Needs an update before you decide' : 'Waiting for your decision'}</span><div className="decision-actions">
          <Button size="sm" disabled={busy || stale} onClick={() => api?.decide(sourceId, chatId, message.id, 'accept')}><Check size={14}/> Accept</Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setComposing('refine')}><Pencil size={13}/> Refine</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setComposing('decline')}><X size={14}/> Decline</Button>
        </div></>}
        {decision === 'accepted' && !composing && <><span className="decision-status accepted"><Check size={13}/> Accepted{outcome ? ' · on your canvas' : ' · card removed from the canvas'}</span><div className="decision-actions">
          {outcome ? <Button variant="outline" size="sm" onClick={viewCard}>View on canvas</Button> : <Button variant="outline" size="sm" disabled={busy || stale} onClick={() => api?.decide(sourceId, chatId, message.id, 'accept')}><Plus size={14}/> Add to canvas again</Button>}
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setComposing('refine')}><Pencil size={13}/> Refine</Button>
        </div></>}
        {decision === 'declined' && <><span className="decision-status declined">Declined{message.decision?.note ? `: ${message.decision.note}` : ''} · agents won’t develop it</span><div className="decision-actions"><Button variant="ghost" size="sm" disabled={busy} onClick={() => api?.decide(sourceId, chatId, message.id, 'reopen')}><Undo2 size={13}/> Reconsider</Button></div></>}
        {decision === 'refine' && <span className="decision-status">You asked for changes: {message.decision?.note}</span>}
        {decision === 'superseded' && <span className="decision-status">Replaced by a revised version you accepted</span>}
        {composing && <div className="decision-compose"><Textarea aria-label={composing === 'refine' ? 'What should change?' : 'Why not? (optional)'} placeholder={composing === 'refine' ? 'What should change? For example: keep it under $30, on weekends' : 'Why not? (optional)'} value={note} maxLength={600} autoFocus onChange={event => setNote(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit() } if (event.key === 'Escape') { event.stopPropagation(); setComposing(null) } }}/>
          <div className="decision-actions"><Button size="sm" disabled={busy || (composing === 'refine' && !note.trim())} onClick={submit}>{composing === 'refine' ? 'Ask for a revision' : 'Decline'}</Button><Button variant="ghost" size="sm" onClick={() => { setComposing(null); setNote('') }}>Cancel</Button></div></div>}
      </div>}
    </div>}
    {message.trace && isNotEmpty(message.trace) && <details className="agent-trace"><summary>How the agents got here · {message.trace.length} step{message.trace.length === 1 ? '' : 's'}</summary><ol>{message.trace.map((handoff, index) => <HandoffLine key={index} handoff={handoff}/>)}</ol></details>}
  </div>
}

function FocusContent({ source }: { source: NodeShape }) {
  const editor = useEditor()
  const node = source.props.node
  const asset = useValue('focus image', () => node.type === 'inspiration' ? editor.getAssets().find(asset => asset.id === node.assetId) : undefined, [editor, node])
  const [src, setSrc] = useState('')
  useEffect(() => {
    let current = true
    if (!asset || asset.type !== 'image') return
    void editor.resolveAssetUrl(asset.id, { screenScale: 1 }).then(url => { if (current) setSrc(url || '') }).catch(() => { if (current) setSrc('') })
    return () => { current = false }
  }, [editor, asset])
  return <div className={`focus-source source-${node.type}`}>
    {node.type === 'inspiration' ? <>{src ? <img src={src} alt={node.goal} draggable={false}/> : <div className="focus-image-placeholder"><MessageCircle size={30}/></div>}<span>{node.goal}</span></> : <div className="focus-outcome"><span className="micro-label">{node.type === 'opportunity' ? 'Shared direction' : 'Next step'}</span><h3>{nodeTitle(node)}</h3>{(node.type === 'action' || node.type === 'opportunity') && <p>{node.description}</p>}{node.type === 'action' && <div className="outcome-sources">{node.sources.map(source => <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">{source.title}<ExternalLink size={12}/></a>)}</div>}</div>}
  </div>
}
