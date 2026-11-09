import { isEmpty } from '../../shared/arrays'
import { useEffect, useRef, useState } from 'react'
import { type TLShapeId, useEditor, useValue } from 'tldraw'
import { ArrowRight, Check, ChevronDown, ExternalLink, LayoutPanelLeft, Link2, LoaderCircle, Maximize2, MessageCircle, Plus, RotateCcw, Square, X } from 'lucide-react'
import { canPublish, nodeTitle } from '../../shared/chats'
import type { NodeShape } from '../nodes/NodeShapeUtil'
import type { Chat, ChatMessage } from '../../shared/schema'
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
    <div className="chat-messages" role="log" aria-label="Conversation messages" tabIndex={0}>
      {isEmpty(chat.messages) && !busy && <div className="chat-welcome"><MessageCircle size={26}/><h3>Where could this take you?</h3><p>Try an idea, ask a question, or tell us what caught your eye.</p></div>}
      {chat.messages.map(message => <Message key={message.id} message={message} sourceId={sourceId} chatId={chat.id} isLatest={message.id === lastAssistant?.id} busy={busy} onChoice={text => send(text)}/>)}
      {job && <div className={`chat-job ${job.status}`} role="status">{busy ? <LoaderCircle size={15} className="spin"/> : <RotateCcw size={15}/>}<span>{job.message}</span><Button variant="ghost" size="icon-sm" aria-label={busy ? 'Stop request' : 'Retry request'} onClick={() => busy ? api?.stop(chat.id) : api?.retry(chat.id)}>{busy ? <Square size={13}/> : <RotateCcw size={14}/>}</Button></div>}
      <div ref={bottom}/>
    </div>
    <form className="chat-compose" onSubmit={event => { event.preventDefault(); send() }}>
      <Textarea ref={composer} className="rounded-none border-0 bg-transparent p-1 text-xs shadow-none focus-visible:ring-0 md:text-xs" aria-label="Message" placeholder="Think out loud…" value={draft} maxLength={2000} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() } }}/>
      <div className="compose-footer"><span>{state.mode === 'demo' ? 'Preview · sample responses' : state.provider}</span><Button size="icon-sm" type="submit" aria-label="Send message" disabled={busy || !draft.trim()}><ArrowRight size={17}/></Button></div>
    </form>
    </div>
  </aside>
}

function Message({ message, sourceId, chatId, isLatest, busy, onChoice }: { message: ChatMessage; sourceId: TLShapeId; chatId: string; isLatest: boolean; busy: boolean; onChoice: (choice: string) => void }) {
  const editor = useEditor(); const api = actions.get(editor)
  const outcome = useValue('published outcome', () => message.role === 'assistant' && message.outcomeId ? nodes(editor).find(shape => shape.id === message.outcomeId) : undefined, [editor, message])
  if (message.role === 'user') return <div className="chat-message user-message"><span className="message-label">You</span><p>{message.text}</p></div>
  const proposal = message.proposal
  return <div className="chat-message assistant-message"><span className="message-label">Unfold</span>
    {proposal.kind === 'question' && <><p>{proposal.prompt}</p><small className="message-purpose">{proposal.purpose}</small>{isLatest && <div className="chat-choices">{proposal.options.map(option => <Button key={option} variant="outline" size="sm" className="h-auto whitespace-normal text-[11px]" disabled={busy} onClick={() => onChoice(option)}>{option}<ArrowRight size={12}/></Button>)}</div>}</>}
    {proposal.kind === 'research' && <p>{proposal.brief}</p>}
    {(proposal.kind === 'opportunity' || proposal.kind === 'action') && <div className="chat-outcome"><div className="outcome-label">{proposal.kind === 'opportunity' ? 'Shared direction' : 'Next step'}</div><h3>{proposal.title}</h3><p>{proposal.description}</p>
      {proposal.kind === 'opportunity' && <div className="outcome-benefits"><p>{proposal.benefitA}</p><p>{proposal.benefitB}</p></div>}
      {proposal.kind === 'action' && <div className="outcome-sources">{proposal.sources.map(source => <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">{source.title}<ExternalLink size={12}/></a>)}</div>}
      {canPublish(message) ? <Button size="sm" onClick={() => api?.publish(sourceId, chatId, message.id)}><Plus size={14}/> Add to canvas</Button> : outcome ? <Button variant="outline" size="sm" onClick={() => { uiState.update(editor, state => ({ ...state, chatView: 'board' })); editor.select(outcome.id); fitBoard(editor) }}><Check size={14}/> View on canvas</Button> : <span className="outcome-removed">Outcome removed from canvas</span>}
    </div>}
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
