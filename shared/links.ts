import { isEmpty, isNotEmpty } from './arrays'
import { chatContext, decisionOf } from './chats'
import type { NodeRecord } from './context'
import type { Chat, LinkScan } from './schema'

/** Two goals are compared together at most this often per user action, so a big board stays bounded. */
export const MAX_PAIRS_PER_ACTION = 2
/** Quiet time after the user's last meaningful action before the board looks for overlaps. */
export const LINK_DELAY_MS = 3500

export const pairKey = (a: string, b: string) => [a, b].sort().join('|')
/** Scan records live on the inspiration whose id sorts first. */
export const pairOwner = (a: string, b: string) => [a, b].sort()[0] ?? a

const inspiration = (records: NodeRecord[], id: string) => { const record = records.find(item => item.id === id); return record?.node.type === 'inspiration' ? record : undefined }
/** The branch's own latest exploration (never a shared one), the conversation a connection reads. */
export function branchChat(records: NodeRecord[], branchId: string): Chat | undefined {
  return inspiration(records, branchId)?.node.chats?.filter(chat => chat.operation !== 'connect').at(-1)
}

/** What the user confirmed in this branch: its goal and active intentions and conditions. Agent guesses and app writes are not part of it. */
export function branchSignature(records: NodeRecord[], branchId: string): { ready: boolean; signature: string } {
  const root = inspiration(records, branchId)
  if (!root || root.node.type !== 'inspiration') return { ready: false, signature: '' }
  const chat = branchChat(records, branchId)
  const confirmed = chat ? chatContext(records, branchId, chat, branchId).memory.filter(item => item.kind === 'intent' || item.kind === 'constraint').map(item => item.text.toLowerCase().replace(/\s+/g, ' ').trim()).sort() : []
  return { ready: isNotEmpty(confirmed), signature: [root.node.goal.trim().toLowerCase(), ...confirmed].join('\n') }
}
export function pairSignature(records: NodeRecord[], a: string, b: string): string | undefined {
  const [first, second] = [a, b].sort().map(id => branchSignature(records, id))
  if (!first?.ready || !second?.ready) return undefined
  return `${first.signature}\n--\n${second.signature}`.slice(0, 4000)
}

/** The one shared conversation for a pair of goals, wherever it is stored. */
export function pairChat(records: NodeRecord[], a: string, b: string): { nodeId: string; chat: Chat } | undefined {
  const key = pairKey(a, b)
  for (const record of records) for (const chat of record.node.chats ?? []) if (chat.operation === 'connect' && chat.branchIds.length === 2 && pairKey(chat.branchIds[0] ?? '', chat.branchIds[1] ?? '') === key) return { nodeId: record.id, chat }
  return undefined
}
export function lastScan(records: NodeRecord[], a: string, b: string): LinkScan | undefined {
  const owner = inspiration(records, pairOwner(a, b))
  const other = owner?.id === a ? b : a
  return owner?.node.type === 'inspiration' ? owner.node.links?.find(scan => scan.otherId === other) : undefined
}

/** True while a shared conversation waits on the user or already holds an accepted direction: automatic checks leave it alone. */
export function pairIsSettled(chat: Chat | undefined): boolean {
  if (!chat) return false
  if (chat.messages.some(message => decisionOf(message) === 'accepted')) return true
  const last = chat.messages.at(-1)
  if (last?.role === 'user') return true
  return last?.role === 'assistant' && ((last.proposal.kind === 'opportunity' && decisionOf(last) === undefined) || last.proposal.kind === 'question')
}

/**
 * Pairs worth checking after the user acted in these branches: both goals have a clear intention,
 * the pair has changed since its last check, and no shared conversation is waiting on the user.
 * Most recently active pairs first, at most `limit`.
 */
export function pairsToScan(records: NodeRecord[], changed: string[], limit = MAX_PAIRS_PER_ACTION): { a: string; b: string; signature: string }[] {
  const roots = records.filter(record => record.node.type === 'inspiration')
  const activity = (id: string) => Math.max(0, ...(inspiration(records, id)?.node.chats ?? []).flatMap(chat => [chat.createdAt, ...(chat.memory?.entries ?? []).map(entry => entry.createdAt)]))
  const seen = new Set<string>()
  const pairs: { a: string; b: string; signature: string; recency: number }[] = []
  for (const a of changed) {
    if (!inspiration(records, a)) continue
    for (const other of roots) {
      const b = other.id
      if (b === a || seen.has(pairKey(a, b))) continue
      seen.add(pairKey(a, b))
      const signature = pairSignature(records, a, b)
      if (!signature) continue
      if (lastScan(records, a, b)?.signature === signature) continue
      if (pairIsSettled(pairChat(records, a, b)?.chat)) continue
      pairs.push({ a, b, signature, recency: activity(b) })
    }
  }
  return isEmpty(pairs) ? [] : pairs.sort((x, y) => y.recency - x.recency).slice(0, limit).map(({ a, b, signature }) => ({ a, b, signature }))
}
