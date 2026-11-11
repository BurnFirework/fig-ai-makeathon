import { isEmpty, isNotEmpty } from '../../shared/arrays'
import { useEffect, useRef, useState } from 'react'
import { type TLShapeId, useEditor, useValue } from 'tldraw'
import { ArrowRight, Check, ChevronDown, ExternalLink, HelpCircle, LayoutPanelLeft, Link2, LoaderCircle, Maximize2, MessageCircle, Pencil, Plus, RotateCcw, Sparkles, Square, Undo2, X } from 'lucide-react'
import { canPublish, currentRevisions, decisionOf, nodeTitle } from '../../shared/chats'
import { chatMemory } from '../../shared/memory'
import type { NodeShape } from '../nodes/NodeShapeUtil'
import { type Chat, type ChatMessage, type Conflict, type Handoff, type Proposal, revisionsMatch } from '../../shared/schema'
import { isAnswerOption } from '../../shared/coordinator'
import { actions, uiState } from '../actions'
import { fitBoard, nodeAt, nodes } from '../unfold'
import { conversationAt, conversations, conversationsFor } from '../conversations'
import { conversationCards } from '../../shared/conversation-record'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'
import { CollaborationStatus } from './collaboration'
import { ArtifactContent } from './artifact-content'

export function ChatPanel() {
  const editor = useEditor()
  const state = useValue('active conversation', () => uiState.get(editor), [editor])
  const source = useValue('conversation source', () => state.activeChat ? nodeAt(editor, state.activeChat.nodeId) : undefined, [editor, state.activeChat])
  const chat = useValue('board conversation', () => state.activeChat ? conversationAt(editor, state.activeChat.chatId) : undefined, [editor, state.activeChat])
  if (!source || !chat) return null
  return <Conversation key={chat.id} sourceId={source.id} title={nodeTitle(source.props.node)} chat={chat}/>
}

function Conversation({ sourceId, title, chat }: { sourceId: TLShapeId; title: string; chat: Chat }) {
  const editor = useEditor(); const api = actions.get(editor)
  const state = useValue('conversation status', () => uiState.get(editor), [editor])
  const cards = useValue('board cards', () => nodes(editor), [editor])
  const sources = conversationCards(chat).flatMap(id => cards.filter(shape => shape.id === id))
  const chats = useValue('card conversations', () => conversationsFor(editor, sourceId), [editor, sourceId])
  const unattached = cards.filter(card => !conversationCards(chat).includes(card.id))
  const [draft, setDraft] = useState('')
  const bottom = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { composer.current?.focus({ preventScroll: true }) }, [])
  const job = state.jobs[chat.id]; const busy = job?.status === 'running'
  const lastAssistant = chat.messages.filter(message => message.role === 'assistant').at(-1)
  const revisions = useValue('dependency revisions', () => currentRevisions(nodes(editor).map(shape => ({ id: shape.id, node: shape.props.node })), conversations(editor)), [editor])
  const pending = !job && lastAssistant?.role === 'assistant' && lastAssistant.proposal.kind === 'question' && chat.messages.at(-1)?.id === lastAssistant.id ? lastAssistant.proposal : undefined
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }) }, [chat.messages.length, busy])
  // A new, empty conversation waits for the person: put the cursor where they can ask.
  const empty = isEmpty(chat.messages) && !busy
  useEffect(() => { if (empty) composer.current?.focus() }, [chat.id, empty])
  function send(text = draft) {
    if (!text.trim() || busy) return
    api?.send(sourceId, chat.id, text, lastAssistant?.id)
    setDraft('')
  }
  return <aside className={`chat-panel ${state.chatView === 'focus' ? 'focus-mode' : 'board-mode'}`} aria-label="Node conversation" onKeyDown={event => {
    event.stopPropagation()
    if (event.key === 'Escape') api?.closeChat()
    // 1–4 pick an answer to the open question, unless the user is typing.
    const typing = event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement
    const choice = pending && !typing && !event.metaKey && !event.ctrlKey && !event.altKey ? answerChoices(pending)[Number(event.key) - 1]?.option : undefined
    if (choice) { event.preventDefault(); send(choice) }
  }}>
    <header className="chat-panel-header">
      <div className="chat-heading"><h2 title={title}>{state.chatView === 'focus' ? 'Explore this idea' : title}</h2></div>
      <div className="chat-view-controls" role="group" aria-label="Chat view"><Button variant="ghost" size="sm" aria-label="Focus view" aria-pressed={state.chatView === 'focus'} title="Focus on this image and its conversation" onClick={() => uiState.update(editor, state => ({ ...state, chatView: 'focus' }))}><Maximize2 size={14}/><span>Focus</span></Button><Button variant="ghost" size="sm" aria-label="Board and chat view" aria-pressed={state.chatView === 'board'} title="Keep the board visible beside the conversation" onClick={() => { uiState.update(editor, state => ({ ...state, chatView: 'board' })); fitBoard(editor) }}><LayoutPanelLeft size={14}/><span>Board & chat</span></Button></div>
      <Button variant="ghost" size="icon-sm" aria-label="Close chat" onClick={() => api?.closeChat()}><X size={17}/></Button>
    </header>
    {state.chatView === 'focus' && <section className="focus-content" aria-label="Conversation source content">{sources.filter(source => source.id === sourceId || chat.sourceIds.includes(source.id)).map(source => <FocusContent key={source.id} source={source}/>)}</section>}
    <div className="conversation-body">
    <div className="chat-navigation">
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="chat-switcher" aria-label="Switch conversation"/>}><span className="truncate">{chat.title}</span><ChevronDown size={13}/></DropdownMenuTrigger><DropdownMenuContent className="w-72" onKeyDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>{chats.map(item => <DropdownMenuItem key={item.id} onClick={() => api?.openChat(sourceId, item.id)}><MessageCircle size={14}/><span className="truncate">{item.title}</span>{item.id === chat.id && <Check size={13}/>}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
      <Button variant="ghost" size="icon-sm" title="Start a separate, empty conversation" aria-label="New conversation" onClick={() => api?.newChat(sourceId)}><Plus size={16}/></Button>
      {isNotEmpty(unattached) && <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="sm" aria-label="Attach a card" disabled={busy}/>}><Link2 size={13}/> Add card</DropdownMenuTrigger><DropdownMenuContent className="w-72" onKeyDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>{unattached.map(card => <DropdownMenuItem key={card.id} onClick={() => api?.applyBoardEdits([{ kind: 'attachNodeToConversation', conversationId: chat.id, nodeId: card.id }])}>{nodeTitle(card.props.node)}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>}
    </div>
    {sources.length > 1 && <div className="chat-source-row"><Link2 size={13}/><span>Bringing together</span>{sources.map(source => <button key={source.id} title={nodeTitle(source.props.node)} onClick={() => { uiState.update(editor, state => ({ ...state, chatView: 'board' })); editor.select(source.id); fitBoard(editor) }}>{nodeTitle(source.props.node)}</button>)}</div>}
    {chat.operation === 'connect' && <CollaborationStatus live={busy} handoffs={busy ? job.handoffs ?? [] : lastAssistant?.role === 'assistant' ? lastAssistant.trace ?? [] : []}/>}
    <div className="chat-messages" role="log" aria-label="Conversation messages" tabIndex={0}>
      {empty && <div className="chat-welcome"><MessageCircle size={26}/><h3>Where could this take you?</h3><p>Ask your own question below, or let the agents suggest a few directions.</p><Button variant="secondary" size="sm" className="suggest-button" onClick={() => api?.suggest(sourceId, chat.id)}><Sparkles size={14}/>Suggest directions</Button></div>}
      {foldTurns(chat.messages).map(item => item.kind === 'turn'
        ? <FoldedTurn key={item.question.id} question={item.question} answer={item.answer} chat={chat}/>
        : <Message key={item.message.id} message={item.message} chat={chat} sourceId={sourceId} isLatest={item.message.id === lastAssistant?.id} busy={busy} stale={item.message.role === 'assistant' && !revisionsMatch(item.message.dependsOn, revisions)} onChoice={text => send(text)}/>)}
      {job && <div className={`chat-job ${job.status}`} role="status">{busy ? <LoaderCircle size={15} className="spin"/> : <RotateCcw size={15}/>}<span>{busy && job.handoffs && isNotEmpty(job.handoffs) ? handoffStatus(job.handoffs.at(-1)) : job.message}</span><Button variant="ghost" size="icon-sm" aria-label={busy ? 'Stop request' : 'Retry request'} onClick={() => busy ? api?.stop(chat.id) : api?.retry(chat.id)}>{busy ? <Square size={13}/> : <RotateCcw size={14}/>}</Button></div>}
      {!job && chat.messages.at(-1)?.role === 'user' && <div className="chat-job error" role="status"><RotateCcw size={15}/><span>The agents have not answered your last message. Retry to continue from here.</span><Button variant="ghost" size="icon-sm" aria-label="Retry request" onClick={() => api?.retry(chat.id)}><RotateCcw size={14}/></Button></div>}
      {busy && job.handoffs && job.handoffs.length > 1 && <details className="agent-trace live"><summary>All agent steps so far · {job.handoffs.length}</summary><ol aria-label="What the agents are doing">{job.handoffs.map((handoff, index) => <HandoffLine key={index} handoff={handoff}/>)}</ol></details>}
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

/** One short line for the status bar while agents work. */
function handoffStatus(handoff: Handoff | undefined) {
  if (!handoff) return 'Working…'
  const text = handoff.summary.length > 110 ? `${handoff.summary.slice(0, 109)}…` : handoff.summary
  return `${ROLE_NAMES[handoff.from]}: ${text}`
}

type ChatItem = { kind: 'message'; message: ChatMessage } | { kind: 'turn'; question: Extract<ChatMessage, { role: 'assistant' }>; answer: Extract<ChatMessage, { role: 'user' }> }
/** The chat exists so the agents can learn about the user: each answered question reads as one compact "question → your answer" line. */
function foldTurns(messages: ChatMessage[]): ChatItem[] {
  const items: ChatItem[] = []
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]; const next = messages[index + 1]
    if (!message) continue
    if (message.role === 'assistant' && message.proposal.kind === 'question' && next?.role === 'user') { items.push({ kind: 'turn', question: message, answer: next }); index++ }
    else items.push({ kind: 'message', message })
  }
  return items
}
function FoldedTurn({ question, answer, chat }: { question: Extract<ChatMessage, { role: 'assistant' }>; answer: Extract<ChatMessage, { role: 'user' }>; chat: Chat }) {
  const [open, setOpen] = useState(false)
  const prompt = question.proposal.kind === 'question' ? question.proposal.prompt : ''
  const purpose = question.proposal.kind === 'question' ? question.proposal.purpose : undefined
  return <div id={`message-${question.id}`} className={`folded-turn ${open ? 'is-open' : ''}`}>
    <button type="button" className="folded-row" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span className="folded-question">{prompt}</span>
      <span id={`message-${answer.id}`} className="folded-answer" title={answer.text}><Check size={10} strokeWidth={3}/><span>{answer.text}</span></span>
    </button>
    {open && <div className="folded-detail">{question.proposal.kind === 'question' && question.proposal.conflict && <ConflictDetails conflict={question.proposal.conflict}/>}{purpose && <small className="message-purpose">{purpose}</small>}<UserNotes message={answer} chat={chat}/></div>}
  </div>
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

/** The options worth showing, each with its effect: invitations such as "Share my city" saved by earlier versions are hidden. */
function answerChoices(proposal: Extract<Proposal, { kind: 'question' }>) {
  return proposal.options.flatMap((option, index) => isAnswerOption(option) ? [{ option, effect: proposal.conflict?.effects[index] }] : [])
}
/** "Something else…" opens a field in the question itself; an open question shows it straight away. */
function OwnAnswer({ placeholder, busy, open, onOpen, onClose, onSend }: { placeholder: string; busy: boolean; open: boolean; onOpen: () => void; onClose?: (() => void) | undefined; onSend: (text: string) => void }) {
  const [text, setText] = useState('')
  const submit = () => { if (text.trim() && !busy) { onSend(text.trim()); setText('') } }
  if (!open) return <button type="button" className="choice own" disabled={busy} onClick={onOpen}><Pencil size={12}/><span>Something else…</span></button>
  return <form className="own-answer" onSubmit={event => { event.preventDefault(); submit() }}>
    <Textarea aria-label="Your answer" placeholder={placeholder} value={text} maxLength={600} rows={1} autoFocus onChange={event => setText(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit() } if (event.key === 'Escape' && onClose) { event.stopPropagation(); onClose() } }}/>
    <div className="own-answer-actions">
      {onClose && <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>}
      <Button type="submit" size="sm" disabled={busy || !text.trim()}>Send<ArrowRight size={13}/></Button>
    </div>
  </form>
}
function Message({ message, chat, sourceId, isLatest, busy, stale, onChoice }: { message: ChatMessage; chat: Chat; sourceId: TLShapeId; isLatest: boolean; busy: boolean; stale: boolean; onChoice: (choice: string) => void }) {
  const editor = useEditor(); const api = actions.get(editor)
  const chatId = chat.id
  const outcomes = useValue('published outcomes', () => message.role === 'assistant' ? nodes(editor).filter(shape => shape.id === message.outcomeId || message.outcomeIds?.includes(shape.id)) : [], [editor, message])
  const outcome = outcomes[0]
  const [composing, setComposing] = useState<'decline' | 'refine' | null>(null)
  const [note, setNote] = useState('')
  const [why, setWhy] = useState(false)
  const [answering, setAnswering] = useState(false)
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
    {message.trace && isNotEmpty(message.trace) && <details className="agent-trace"><summary>How the agents got here · {message.trace.length} step{message.trace.length === 1 ? '' : 's'}</summary><ol>{message.trace.map((handoff, index) => <HandoffLine key={index} handoff={handoff}/>)}</ol></details>}
    {proposal.kind === 'question' && (isLatest && !stale ? <div className="question-card">
      <span className="your-turn">Your turn</span>
      <h3>{proposal.prompt}</h3>
      {proposal.conflict && <ConflictDetails conflict={proposal.conflict}/>}
      {proposal.purpose && <button type="button" className="why-toggle" aria-expanded={why} onClick={() => setWhy(value => !value)}><HelpCircle size={12}/>Why this question?</button>}
      {why && <small className="message-purpose">{proposal.purpose}</small>}
      <div className="chat-choices" role="group" aria-label="Answers">{answerChoices(proposal).map(({ option, effect }, index) => <button key={option} type="button" className={`choice ${effect ? 'has-effect' : ''}`} disabled={busy} onClick={() => onChoice(option)}><kbd>{index + 1}</kbd><span>{option}{effect && <small className="choice-effect">{effect}</small>}</span><ArrowRight size={13}/></button>)}
        <OwnAnswer placeholder={proposal.placeholder ?? 'Type your answer'} busy={busy} open={answering || isEmpty(answerChoices(proposal))} onOpen={() => setAnswering(true)} onClose={isEmpty(answerChoices(proposal)) ? undefined : () => setAnswering(false)} onSend={onChoice}/></div>
    </div> : <><p>{proposal.prompt}</p>{proposal.conflict && <ConflictDetails conflict={proposal.conflict}/>}{proposal.purpose && <small className="message-purpose">{proposal.purpose}</small>}</>)}
    {proposal.kind === 'research' && <p>{proposal.brief}</p>}
    {proposal.kind === 'reply' && <><p>{proposal.text}</p>{outcomes.map(card => <Button key={card.id} variant="outline" size="sm" onClick={() => { uiState.update(editor, state => ({ ...state, chatView: 'board' })); editor.select(card.id); fitBoard(editor) }}>{nodeTitle(card.props.node)}<ArrowRight size={13}/></Button>)}</>}
    {proposal.kind === 'none' && <div className="chat-none"><div className="outcome-label">No useful overlap</div><p>{proposal.reason}</p><small className="message-purpose">Nothing was added. Agents look again when either goal changes.</small></div>}
    {(proposal.kind === 'opportunity' || proposal.kind === 'action') && <div className={`chat-outcome ${decision ? `decision-${decision}` : ''}`}><div className="outcome-label">{proposal.kind === 'opportunity' ? (revisedFrom ? 'Shared direction · revised' : 'Shared direction') : 'Next step'}</div><h3>{proposal.title}</h3>
      {proposal.kind === 'action' ? <ActionSummary action={proposal}/> : <p>{proposal.description}</p>}
      {proposal.kind === 'opportunity' && <div className="outcome-benefits"><p>{proposal.benefitA}</p><p>{proposal.benefitB}</p></div>}
      {proposal.kind === 'opportunity' && proposal.openPoints && isNotEmpty(proposal.openPoints) && <ul className="open-points" aria-label="Still open">{proposal.openPoints.map(point => <li key={point}>{point}</li>)}</ul>}
      {proposal.kind === 'opportunity' && proposal.sources && isNotEmpty(proposal.sources) && <div className="source-chips">{proposal.sources.map(source => <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer" title={source.title}>{domainOf(source.url)}<ExternalLink size={11}/></a>)}</div>}
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
  </div>
}

/** What blocks a shared idea and what the agents based that on; the effects sit on the answer buttons. */
function ConflictDetails({ conflict }: { conflict: Conflict }) {
  return <div className="conflict-details">
    <div className="conflict-condition"><span>Blocked by</span><strong>{conflict.condition}</strong></div>
    {conflict.basis && <p>{conflict.basis}</p>}
    {isNotEmpty(conflict.sources) && <div className="source-chips">{conflict.sources.map(source => <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer" title={source.title}>{domainOf(source.url)}<ExternalLink size={11}/></a>)}</div>}
  </div>
}

const domainOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }
/** A next step in the chat: summary, quick facts, checklist and sources, with longer text folded away. */
function ActionSummary({ action }: { action: { description: string; summary?: string | undefined; steps?: string[] | undefined; meta?: { time?: string | undefined; cost?: string | undefined; place?: string | undefined } | undefined; sources: { id: string; title: string; url: string }[] } }) {
  const structured = Boolean(action.summary || action.steps)
  const facts = [action.meta?.time, action.meta?.cost, action.meta?.place].flatMap(fact => fact ? [fact] : [])
  return <div className="action-summary-block">
    {action.summary && <p>{action.summary}</p>}
    {isNotEmpty(facts) && <div className="action-meta">{facts.map(fact => <span key={fact} className="meta-chip">{fact}</span>)}</div>}
    {action.steps && <ol className="chat-steps">{action.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>}
    {structured ? action.description.trim() && <details className="chat-details"><summary>More details</summary><p>{action.description}</p></details> : <p className="chat-description">{action.description}</p>}
    {isNotEmpty(action.sources) && <div className="source-chips">{action.sources.map(source => <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer" title={source.title}>{domainOf(source.url)}<ExternalLink size={11}/></a>)}</div>}
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
    {node.type === 'inspiration' ? <>{src ? <img src={src} alt={node.goal} draggable={false}/> : <div className="focus-image-placeholder"><MessageCircle size={30}/></div>}<span>{node.goal}</span></> : <div className="focus-outcome"><span className="micro-label">{node.type === 'opportunity' ? 'Shared direction' : node.type === 'artifact' ? node.content.kind : 'Next step'}</span><h3>{nodeTitle(node)}</h3>{node.type === 'opportunity' && <p>{node.description}</p>}{node.type === 'action' && <ActionSummary action={node}/>}{node.type === 'artifact' && <ArtifactContent content={node.content}/>}</div>}
  </div>
}
