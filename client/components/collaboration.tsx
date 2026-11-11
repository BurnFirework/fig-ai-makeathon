import { isNotEmpty } from '../../shared/arrays'
import { useEditor, useValue, type TLShapeId } from 'tldraw'
import { Link2, LoaderCircle, RotateCcw } from 'lucide-react'
import { collaborationStages, STAGES, type Stage } from '../../shared/coordinator'
import { decisionOf, nodeTitle } from '../../shared/chats'
import { pairKey } from '../../shared/links'
import type { Chat, Handoff, LinkScan } from '../../shared/schema'
import { actions, uiState, type UiState } from '../actions'
import { nodes } from '../unfold'
import { conversations } from '../conversations'
import { conversationCards } from '../../shared/conversation-record'

export const STAGE_LABELS: Record<Stage, string> = {
  overlap: 'Overlap found', checking: 'Checking both goals', researching: 'Researching a real option',
  conflict: 'Conflict found', decision: 'Your decision needed', ready: 'Proposal ready', none: 'No useful overlap',
}

/** The short state of shared work in a connection chat, read from the coordinator's real handoffs. */
export function CollaborationStatus({ handoffs, live }: { handoffs: Handoff[]; live: boolean }) {
  const { current, reached } = collaborationStages(handoffs)
  if (!current) return null
  const shown: Stage[] = current === 'none' ? ['none'] : STAGES.filter(stage => reached.includes(stage))
  return <ol className={`collab-stages ${live ? 'is-live' : ''}`} aria-label="Shared work between the agents">
    {shown.map(stage => <li key={stage} className={`stage-${stage} ${stage === current ? 'is-current' : ''}`} aria-current={stage === current ? 'step' : undefined}>{stage === current && live ? <LoaderCircle size={11} className="spin"/> : <i/>}{STAGE_LABELS[stage]}</li>)}
  </ol>
}

type Link = { key: string; tone: 'working' | 'decision' | 'ready' | 'error'; label: string; short: string; other: string; open?: { nodeId: TLShapeId; chatId: string }; stop?: string; retry?: [string, string]; detail?: string }
/** The few words that fit on a card while agents work. */
const shortOf = (handoffs: Handoff[]) => collaborationStages(handoffs).current === 'researching' ? 'Researching…' : 'Checking link…'
const RANK: Record<Link['tone'], number> = { decision: 0, ready: 1, error: 2, working: 3 }

/** Links of one goal that need attention: a check in progress, a decision or a proposal waiting. Accepted, declined and empty links show nothing. */
function linksOf(cards: { id: TLShapeId; links: LinkScan[]; title: string }[], chats: Chat[], id: TLShapeId, jobs: UiState['jobs']): Link[] {
  const titleOf = (other: string) => cards.find(card => card.id === other)?.title ?? 'another goal'
  const links: Link[] = []
  for (const [key, job] of Object.entries(jobs)) {
    if (!key.startsWith('link:')) continue
    const [a = '', b = ''] = key.slice(5).split('|')
    if (a !== id && b !== id) continue
    const other = a === id ? b : a
    links.push(job.status === 'running'
      ? { key, tone: 'working', label: job.handoffs && isNotEmpty(job.handoffs) ? `${STAGE_LABELS[collaborationStages(job.handoffs).current ?? 'checking']}…` : 'Looking for a link…', short: shortOf(job.handoffs ?? []), other: titleOf(other), stop: key.slice(5) }
      : { key, tone: 'error', label: 'Link check paused', short: 'Link paused', other: titleOf(other), retry: [a, b], detail: job.message })
  }
  // A check that failed before a reload stays visible with its reason until it is retried or the goals change.
  for (const card of cards) for (const scan of card.links) {
    if (scan.status !== 'error' || (card.id !== id && scan.otherId !== id)) continue
    const other = card.id === id ? scan.otherId : card.id
    const pair = pairKey(card.id, scan.otherId)
    if (!cards.some(item => item.id === other) || jobs[`link:${pair}`]) continue
    links.push({ key: `scan:${pair}`, tone: 'error', label: 'Link check paused', short: 'Link paused', other: titleOf(other), retry: [card.id, other], detail: scan.reason })
  }
  for (const chat of chats) {
    if (chat.operation !== 'connect' || !chat.branchIds.includes(id)) continue
    const other = chat.branchIds.find(branch => branch !== id) ?? ''
    const attached = conversationCards(chat)
    const nodeId = attached.includes(id) ? id : cards.find(card => attached.includes(card.id))?.id
    if (!nodeId) continue
    const open = { nodeId, chatId: chat.id }
    const job = jobs[chat.id]
    const last = chat.messages.at(-1)
    if (job?.status === 'running') links.push({ key: chat.id, tone: 'working', label: `${STAGE_LABELS[collaborationStages(job.handoffs ?? []).current ?? 'checking']}…`, short: shortOf(job.handoffs ?? []), other: titleOf(other), open })
    else if (job?.status === 'error') links.push({ key: chat.id, tone: 'error', label: 'Shared work paused', short: 'Link paused', other: titleOf(other), open })
    else if (last?.role === 'assistant' && last.proposal.kind === 'question') links.push({ key: chat.id, tone: 'decision', label: last.proposal.conflict ? 'Link needs your decision' : 'Link needs your answer', short: last.proposal.conflict ? 'Link · decide' : 'Link · answer', other: titleOf(other), open })
    else if (last?.role === 'assistant' && last.proposal.kind === 'opportunity' && decisionOf(last) === undefined) links.push({ key: chat.id, tone: 'ready', label: 'Shared idea ready', short: 'Link ready', other: titleOf(other), open })
  }
  return links.sort((x, y) => RANK[x.tone] - RANK[y.tone])
}

/** A compact way into links the agents noticed for this goal. It never opens anything by itself. */
export function LinkPill({ shapeId }: { shapeId: TLShapeId }) {
  const editor = useEditor(); const api = actions.get(editor)
  const links = useValue('goal links', () => {
    const cards = nodes(editor).map(shape => ({ id: shape.id, links: shape.props.node.type === 'inspiration' ? shape.props.node.links ?? [] : [], title: nodeTitle(shape.props.node) }))
    return linksOf(cards, conversations(editor), shapeId, uiState.get(editor).jobs)
  }, [editor, shapeId])
  const link = links[0]
  if (!link) return null
  const more = links.length > 1 ? ` · +${links.length - 1}` : ''
  const title = link.stop ? `Agents are checking whether this goal connects with “${link.other}”. Click to stop.` : link.retry ? `Checking the link with “${link.other}” could not finish. ${link.detail ?? ''} Click to retry.` : `With “${link.other}”`
  return <button type="button" className={`link-pill tone-${link.tone}`} title={title} aria-label={`${link.label} with ${link.other}${link.stop ? '. Stop checking' : ''}${link.retry ? `. ${link.detail ? `${link.detail} ` : ''}Retry` : ''}`}
    onPointerDown={event => editor.markEventAsHandled(event)}
    onClick={() => { if (link.open) api?.openChat(link.open.nodeId, link.open.chatId); else if (link.stop) api?.stopLink(link.stop); else if (link.retry) api?.retryLink(...link.retry) }}>
    {link.tone === 'working' ? <LoaderCircle size={12} className="spin"/> : link.tone === 'error' ? <RotateCcw size={12}/> : <Link2 size={12}/>}
    <span>{link.short}{more}</span>
  </button>
}
