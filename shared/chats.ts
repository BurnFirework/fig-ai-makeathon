import { isEmpty } from './arrays'
import { branchContext, type NodeRecord } from './context'
import { chatMemory, classifyMessage, mergeMemory } from './memory'
import { type BranchContext, type Chat, type ChatMessage, type Decision, type UnfoldNode, memoryKey } from './schema'

export function nodeTitle(node: UnfoldNode): string {
  switch (node.type) {
    case 'inspiration': return node.goal
    case 'question': return node.prompt
    case 'answer': return node.text
    case 'opportunity': case 'action': return node.title
    case 'findings': return `Findings · ${node.topic.title}`
    case 'artifact': return node.content.title
  }
}

// Provenance follows one navigation path; a shared outcome keeps both sources in its chat.
export function lineage(records: NodeRecord[], sourceId: string): NodeRecord[] {
  const path: NodeRecord[] = []
  const visited = new Set<string>()
  let current = records.find(record => record.id === sourceId)
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    path.unshift(current)
    const parentId = current.node.origin?.nodeId ?? current.node.dependsOn.find(dependency => dependency.id !== current?.id)?.id
    current = records.find(record => record.id === parentId)
  }
  return path
}

export interface ContextThread { nodeId: string; chat: Chat; through?: string | undefined }

const embeddedChats = (records: NodeRecord[]) => records.flatMap(record => record.node.chats ?? [])

/** Conversations whose content belongs to one branch's context, oldest ancestor first. */
export function contextThreads(records: NodeRecord[], sourceId: string, chat: Chat, branchId: string, conversations: readonly Chat[] = embeddedChats(records)): ContextThread[] {
  const threads: ContextThread[] = []
  const visited = new Set<string>()
  function visitNode(id: string) {
    const node = records.find(record => record.id === id)?.node
    if (!node?.origin) return
    const origin = conversations.find(thread => thread.id === node.origin?.chatId)
    if (origin) visitChat(node.origin.nodeId, origin, node.origin.messageId)
  }
  function visitChat(nodeId: string, thread: Chat, throughMessage?: string) {
    if (visited.has(thread.id) || !thread.branchIds.includes(branchId)) return
    visited.add(thread.id)
    visitNode(nodeId)
    thread.sourceIds.forEach(visitNode)
    for (const reference of thread.contextChats ?? []) {
      const ancestor = conversations.find(chat => chat.id === reference.chatId)
      if (ancestor) visitChat(reference.nodeId, ancestor, reference.messageId)
    }
    threads.push({ nodeId, chat: thread, through: throughMessage })
  }
  visitChat(sourceId, chat)
  return threads
}

const visibleMessages = (thread: ContextThread) => thread.through ? thread.chat.messages.slice(0, thread.chat.messages.findIndex(message => message.id === thread.through) + 1) : thread.chat.messages

/** The user's decision on a proposal. Older saved boards recorded acceptance only by adding a card. */
export function decisionOf(message: ChatMessage): Decision['status'] | undefined {
  if (message.role !== 'assistant') return undefined
  return message.decision?.status ?? (message.outcomeId && message.proposal.kind === 'opportunity' ? 'accepted' : undefined)
}

/** Ideas the user declined, from this lineage and from other conversations about the same pair of goals. */
export function declinedIdeas(records: NodeRecord[], threads: ContextThread[], chat: Chat, conversations: readonly Chat[] = embeddedChats(records)): { idea: string; reason: string }[] {
  const pair = chat.branchIds.length === 2 ? [...chat.branchIds].sort().join('|') : undefined
  const related = pair ? conversations.filter(other => [...other.branchIds].sort().join('|') === pair) : []
  const messages = [...threads.flatMap(visibleMessages), ...related.flatMap(other => other.messages)]
  const ideas = messages.flatMap(message => message.role === 'assistant' && message.decision?.status === 'declined' && (message.proposal.kind === 'opportunity' || message.proposal.kind === 'action') ? [{ idea: message.proposal.title, reason: message.decision.note }] : [])
  return ideas.filter((idea, index) => ideas.findIndex(other => other.idea === idea.idea && other.reason === idea.reason) === index).slice(-40)
}

export function chatContext(records: NodeRecord[], sourceId: string, chat: Chat, branchId: string, conversations: readonly Chat[] = embeddedChats(records)): BranchContext {
  const root = records.find(record => record.id === branchId && record.node.type === 'inspiration')
  const focus = records.find(record => record.id === sourceId)
  const context: BranchContext = root
    ? branchContext(records.filter(record => record.node.type !== 'action' && record.node.type !== 'opportunity'), branchId)
    : { id: branchId, goal: focus ? nodeTitle(focus.node) : 'Earlier inspiration', revision: 0, answers: [], confirmed: [], assumptions: [], previousSuggestions: [], memory: [], changes: [], declined: [] }
  const threads = contextThreads(records, sourceId, chat, branchId, conversations)
  const messages = threads.flatMap(visibleMessages)
  const answers = messages.flatMap(message => {
    if (message.role !== 'user') return []
    const question = messages.find(previous => previous.id === message.replyTo)
    const asked = question?.role === 'assistant' ? question.proposal : undefined
    return [{ question: asked?.kind === 'question' ? asked.prompt : asked?.kind === 'opportunity' ? `Feedback on “${asked.title}”` : 'Your direction', answer: message.text, stance: message.stance ?? classifyMessage(message.text), messageId: message.id }]
  })
  const view = mergeMemory(threads)
  const memory = view.active.slice(-120).map(item => ({ id: item.id, kind: item.kind, ...(item.key ? { key: item.key } : {}), text: item.text, ...(item.sources[0] ? { from: item.sources[0] } : {}) }))
  const changes = view.history.map(change => ({ ...(change.key ? { key: change.key } : {}), before: change.before, after: change.after }))
  const memoryDeclined = view.active.flatMap(item => item.kind === 'declined' ? [{ idea: item.text, reason: '' }] : [])
  return { ...context, answers: [...context.answers, ...answers],
    confirmed: view.active.flatMap(item => item.kind === 'intent' || item.kind === 'constraint' ? [item.text] : []),
    assumptions: view.active.flatMap(item => item.kind === 'assumption' ? [item.text] : []),
    memory, changes: changes.slice(-60), declined: [...declinedIdeas(records, threads, chat, conversations), ...memoryDeclined].slice(-40),
    previousSuggestions: [...context.previousSuggestions, ...messages.flatMap(message => message.role !== 'assistant' ? [] : message.proposal.kind === 'question' ? [message.proposal.prompt] : message.proposal.kind === 'action' || message.proposal.kind === 'opportunity' ? [message.decision?.status === 'refine' ? `${message.proposal.title} (you asked to change it: ${message.decision.note})` : message.proposal.title] : [])],
  }
}

/** Memory revisions of every conversation a request reads, so changed conditions block late answers. */
export function memoryDependencies(records: NodeRecord[], sourceId: string, chat: Chat, conversations: readonly Chat[] = embeddedChats(records)): { id: string; revision: number }[] {
  const threads = chat.branchIds.flatMap(branchId => contextThreads(records, sourceId, chat, branchId, conversations))
  const ids = [...new Map(threads.map(thread => [thread.chat.id, thread.chat])).values()]
  return ids.map(thread => ({ id: memoryKey(thread.id), revision: chatMemory(thread).revision }))
}

/** Node revisions plus each conversation's memory revision. */
export function currentRevisions(records: NodeRecord[], conversations: readonly Chat[] = embeddedChats(records)): Map<string, number> {
  const map = new Map(records.map(record => [record.id, record.node.revision]))
  for (const chat of conversations) map.set(memoryKey(chat.id), chatMemory(chat).revision)
  return map
}

export function canPublish(message: ChatMessage): boolean {
  return message.role === 'assistant' && !message.outcomeId && (message.proposal.kind === 'opportunity' || message.proposal.kind === 'action')
}

// Fold legacy message shapes into their inspiration without losing text or existing outcomes.
export function foldLegacyMessages(records: NodeRecord[]): { updates: NodeRecord[]; removed: string[] } {
  const updates: NodeRecord[] = []
  const removed: string[] = []
  for (const root of records.filter(record => record.node.type === 'inspiration')) {
    const branch = records.filter(record => record.node.branchId === root.id).sort((a, b) => a.node.sequence - b.node.sequence)
    const legacy = branch.filter(record => record.node.type === 'question' || record.node.type === 'answer')
    if (isEmpty(legacy)) continue
    const chatId = `legacy-${root.id}`
    const messages: ChatMessage[] = branch.flatMap(({ id, node }): ChatMessage[] => {
      if (node.type === 'question') return [{ id, role: 'assistant', proposal: { kind: 'question', prompt: node.prompt, options: node.options, purpose: node.purpose }, dependsOn: [{ id: root.id, revision: root.node.revision }] }]
      if (node.type === 'answer') return [{ id, role: 'user', text: node.text, replyTo: node.questionId }]
      if (node.type === 'action') return [{ id, role: 'assistant', proposal: { kind: 'action', title: node.title, description: node.description, sources: node.sources }, dependsOn: [{ id: root.id, revision: root.node.revision }], outcomeId: id }]
      return []
    })
    const chat: Chat = { id: chatId, title: 'Earlier exploration', sourceIds: [root.id], branchIds: [root.id], operation: 'branch', messages, createdAt: root.node.createdAt }
    updates.push({ id: root.id, node: { ...root.node, chats: [...(root.node.chats ?? []), chat] } })
    removed.push(...legacy.map(record => record.id))
    for (const record of branch.filter(record => record.node.type === 'action')) {
      updates.push({ id: record.id, node: { ...record.node, origin: { nodeId: root.id, chatId, messageId: record.id } } })
    }
  }
  const removedIds = new Set(removed)
  for (const record of records.filter(record => !removedIds.has(record.id))) {
    const replacement = updates.find(update => update.id === record.id) ?? record
    if (!replacement.node.dependsOn.some(dependency => removedIds.has(dependency.id))) continue
    const dependsOn = replacement.node.dependsOn.map(dependency => {
      if (!removedIds.has(dependency.id)) return dependency
      const legacy = records.find(record => record.id === dependency.id)
      const root = records.find(record => record.id === legacy?.node.branchId)
      return root ? { id: root.id, revision: root.node.revision } : dependency
    }).filter((dependency, index, all) => all.findIndex(other => other.id === dependency.id) === index)
    const updated = { id: replacement.id, node: { ...replacement.node, dependsOn } }
    const index = updates.findIndex(update => update.id === record.id)
    if (index < 0) updates.push(updated)
    else updates[index] = updated
  }
  return { updates, removed }
}
