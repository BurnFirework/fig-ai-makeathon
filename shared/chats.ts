import { branchContext, type NodeRecord } from './context'
import type { BranchContext, Chat, ChatMessage, UnfoldNode } from './schema'

export function nodeTitle(node: UnfoldNode): string {
  switch (node.type) {
    case 'inspiration': return node.goal
    case 'question': return node.prompt
    case 'answer': return node.text
    case 'opportunity': case 'action': return node.title
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

export function chatContext(records: NodeRecord[], sourceId: string, chat: Chat, branchId: string): BranchContext {
  const context = branchContext(records.filter(record => record.node.type !== 'action' && record.node.type !== 'opportunity'), branchId)
  const threads: Chat[] = []
  const visited = new Set<string>()
  function visitNode(id: string) {
    const node = records.find(record => record.id === id)?.node
    if (!node?.origin) return
    const owner = records.find(record => record.id === node.origin?.nodeId)
    const origin = owner?.node.chats?.find(thread => thread.id === node.origin?.chatId)
    if (origin) visitChat(origin, node.origin.messageId)
  }
  function visitChat(thread: Chat, throughMessage?: string) {
    if (visited.has(thread.id) || !thread.branchIds.includes(branchId)) return
    visited.add(thread.id)
    thread.sourceIds.forEach(visitNode)
    for (const reference of thread.contextChats ?? []) {
      const ancestor = records.find(record => record.id === reference.nodeId)?.node.chats?.find(chat => chat.id === reference.chatId)
      if (ancestor) visitChat(ancestor, reference.messageId)
    }
    threads.push(throughMessage ? { ...thread, messages: thread.messages.slice(0, thread.messages.findIndex(message => message.id === throughMessage) + 1) } : thread)
  }
  visitNode(sourceId)
  visitChat(chat)
  const messages = threads.flatMap(thread => thread.messages)
  const answers = messages.flatMap(message => {
    if (message.role !== 'user') return []
    const question = messages.find(previous => previous.id === message.replyTo)
    return [{ question: question?.role === 'assistant' && question.proposal.kind === 'question' ? question.proposal.prompt : 'Your direction', answer: message.text }]
  })
  return { ...context, answers: [...context.answers, ...answers],
    confirmed: [...context.confirmed, ...answers.map(answer => answer.answer)],
    previousSuggestions: [...context.previousSuggestions, ...messages.flatMap(message => message.role !== 'assistant' ? [] : message.proposal.kind === 'question' ? [message.proposal.prompt] : message.proposal.kind === 'action' || message.proposal.kind === 'opportunity' ? [message.proposal.title] : [])],
  }
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
    if (!legacy.length) continue
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
