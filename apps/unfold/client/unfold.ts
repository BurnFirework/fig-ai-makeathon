import { placeNear } from '../shared/spatial-layout'
import { getConnectionPagePoints } from './connection/ConnectionShapeUtil'
import { isEmpty, isNotEmpty } from '../shared/arrays'
import { NODE_WIDTH_PX } from './constants'
import { createShapeId, Editor, type TLBinding, type TLShape, type TLShapeId } from 'tldraw'
import { toast } from 'sonner'
import { showUndo } from './components/undo-toast'
import { type AgentResult, type Chat, type ChatMemory, type ChatMessage, type Handoff, type LinkScan, NodeSchema, type UnfoldNode, memoryKey, revisionsMatch } from '../shared/schema'
import { LINK_DELAY_MS, lastScan, pairChat, pairIsSettled, pairKey, pairOwner, pairSignature, pairsToScan } from '../shared/links'
import { invalidatedBy } from '../shared/context'
import { branchFrom, type BranchEdge } from '../shared/branch'
import { canPublish, cardConditions, chatContext, contextThreads, currentRevisions, decisionOf, foldLegacyMessages, lineage, memoryDependencies, nodeTitle, suggestedTitle } from '../shared/chats'
import { applyAgentMemory, applyDrafts, chatMemory, classifyMessage, confirmAssumption, interpretMessage, questionFor, revisedConditions, withdrawEntry } from '../shared/memory'
import { buildWebTopic, developmentKey, investigationTopic, refreshInvestigationScope, ExploreRequestSchema, mergeFindings, searchScope, type ExploreReport, type ExploreTopic } from '../shared/explore'
import { actions, saveNow, uiState, type ExploreCandidate, type ExploreRun, type UnfoldActions } from './actions'
import { requestAgent, requestExplore, getAgentConfig } from './agentClient'
import { createOrUpdateConnectionBinding, getConnectionBindings } from './connection/ConnectionBindingUtil'
import { getNextConnectionIndex } from './connection/keepConnectionsAtBottom'
import type { NodeShape } from './nodes/NodeShapeUtil'
import { getNodeHeightPx, getNodeWidthPx } from './nodes/nodeTypes'
import { conversationAt, conversations, conversationsFor, putConversation } from './conversations'
import { conversationCards } from '../shared/conversation-record'
import { editedNodeIds, validateBoardEdits, type BoardContext, type BoardEdit, type Relationship } from '../shared/board-edits'

export function nodes(editor: Editor): NodeShape[] { return editor.getCurrentPageShapes().filter((shape): shape is NodeShape => editor.isShapeOfType(shape, 'node')) }
export function nodeAt(editor: Editor, id: TLShapeId) { const shape = editor.getShape(id); return shape && editor.isShapeOfType(shape, 'node') ? shape : undefined }
function boardLinks(editor: Editor) {
  return editor.getCurrentPageShapes().flatMap(shape => {
    if (!editor.isShapeOfType(shape, 'connection')) return []
    const { start, end } = getConnectionBindings(editor, shape)
    return start && end ? [{ from: start.toId, to: end.toId, relationship: shape.props.relationship ?? 'develops' }] : []
  })
}

/** A bounded view of the live board, prioritizing the chat's cards and then connected or matching cards. */
export function getBoardContext(editor: Editor, chat: Chat, focusId: TLShapeId): BoardContext {
  const cards = nodes(editor)
  const byId = new Map<string, NodeShape>(cards.map(shape => [shape.id, shape]))
  const attachedIds = [...new Set([focusId, ...chat.sourceIds, ...conversationCards(chat)])].filter(id => byId.has(id)).slice(0, 24)
  const selectedIds = editor.getSelectedShapeIds().filter(id => byId.has(id)).slice(0, 24)
  const links = boardLinks(editor)
  const nearby = links.flatMap(link => attachedIds.includes(link.from) ? [link.to] : attachedIds.includes(link.to) ? [link.from] : [])
  const recent = chat.messages.slice(-16).map((message): BoardContext['messages'][number] => {
    if (message.role === 'user') {
      // A comment on a suggested card says which one it changes, so the agents can return a revised version of it.
      const revised = message.stance === 'refine' ? chat.messages.find(item => item.id === message.replyTo) : undefined
      const suggested = revised && suggestedTitle(revised)
      return { role: message.role, text: (suggested ? `Change the suggested ${suggested.charAt(0).toLowerCase()}${suggested.slice(1)}: ${message.text}` : message.text).slice(0, 2000) }
    }
    const proposal = message.proposal
    // The agents see what they suggested for the canvas, not only the sentence that offered it.
    const suggestions = (message.proposedEdits ?? []).flatMap(edit => edit.kind === 'createNode' ? [`Suggested ${edit.content.kind} “${edit.content.title}”: ${edit.content.description}`] : edit.kind === 'updateNode' ? [`Suggested renaming to “${edit.title}”`] : [])
    const text = proposal.kind === 'question' ? proposal.prompt : proposal.kind === 'reply' ? [proposal.text, ...suggestions].join('\n') : proposal.kind === 'research' ? proposal.brief : proposal.kind === 'none' ? proposal.reason : `${proposal.title}. ${proposal.description}`
    return { role: message.role, text: text.slice(0, 2000) }
  })
  const words = new Set((recent.filter(message => message.role === 'user').map(message => message.text).join(' ').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []))
  const matches = cards.filter(shape => (nodeTitle(shape.props.node).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).some(word => words.has(word)))
  const ids = [...new Set([...attachedIds, ...selectedIds, ...nearby, ...matches.map(shape => shape.id), ...cards.map(shape => shape.id)])].slice(0, 40)
  const included = new Set(ids)
  return { conversationId: chat.id, focusId, attachedIds, selectedIds: selectedIds.filter(id => included.has(id)), links: links.filter(link => included.has(link.from) && included.has(link.to)).slice(0, 80), messages: recent,
    cards: ids.flatMap(id => {
      const node = byId.get(id)?.props.node
      if (!node) return []
      const description = node.type === 'artifact' ? node.content.description : node.type === 'opportunity' || node.type === 'action' ? node.description : undefined
      return [{ id, title: nodeTitle(node).slice(0, 600), revision: node.revision, image: node.type === 'inspiration' && Boolean(node.assetId), ...(description ? { description: description.slice(0, 1200) } : {}) }]
    }),
  }
}
export function fitBoard(editor: Editor) {
  const bounds = editor.getCurrentPageBounds()
  if (!bounds) return
  const screen = editor.getViewportScreenBounds()
  const state = uiState.get(editor)
  const sidebar = state.activeChat && state.chatView === 'board' ? 440 : state.explore ? 344 : 0
  const width = screen.w > 850 ? screen.w - sidebar : screen.w
  const zoom = Math.min(1, (width - 120) / bounds.w, (screen.h - 200) / bounds.h)
  editor.setCamera({ x: -bounds.center.x + width / (2 * zoom), y: -bounds.center.y + screen.h / (2 * zoom), z: zoom })
}
/** Finds the extra cards offered in the removal confirmation. */
export function cardsLosingSources(editor: Editor, ids: readonly TLShapeId[]): NodeShape[] {
  const shapes = nodes(editor)
  const cards = shapes.map(({ id, props: { node } }) => ({
    id,
    branchId: node.type === 'artifact' ? '' : node.branchId,
    inspiration: node.type === 'inspiration',
    sourceBranchIds: node.type === 'opportunity' ? node.sourceBranchIds : undefined,
  }))
  const sources: BranchEdge[] = boardLinks(editor)
  for (const { id, props: { node } } of shapes) {
    if (node.type !== 'artifact' || node.content.kind !== 'moodboard') continue
    for (const item of node.content.items) sources.push({ from: item.nodeId, to: id, relationship: 'reference' })
  }
  const selected = new Set(ids)
  const affected = new Set(branchFrom(ids, cards, sources))
  return shapes.filter(shape => affected.has(shape.id) && !selected.has(shape.id))
}
export function baseNode(branchId: string, agent: UnfoldNode['agent'] = 'you') { return { branchId, sequence: Date.now(), revision: 0, stale: false, dependsOn: [], agent, createdAt: Date.now() } }
export function defaultInspiration(): Extract<UnfoldNode, { type: 'inspiration' }> { return { ...baseNode(''), type: 'inspiration', assetId: '', goal: 'Something I want to explore', started: false } }
function update(editor: Editor, id: TLShapeId, transform: (node: UnfoldNode) => UnfoldNode) {
  const shape = nodeAt(editor, id)
  if (shape) editor.updateShape<NodeShape>({ id, type: 'node', props: { node: NodeSchema.parse(transform(shape.props.node)) } })
}
function link(editor: Editor, from: TLShapeId, to: TLShapeId, input = 'input', relationship: Relationship = 'develops', output = 'output') {
  const id = createShapeId()
  editor.createShape({ id, type: 'connection', props: { relationship }, index: getNextConnectionIndex(editor) })
  createOrUpdateConnectionBinding(editor, id, from, { portId: output, terminal: 'start' })
  createOrUpdateConnectionBinding(editor, id, to, { portId: input, terminal: 'end' })
}
async function rasterize(file: File): Promise<File> {
  if (file.size > 12_000_000) throw new Error('Please choose an image smaller than 12 MB.')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image(); image.src = url; await image.decode()
    const scale = Math.min(1, 1200 / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale)
    const context = canvas.getContext('2d'); if (!context) throw new Error('Could not read this image.')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not process this image.')), 'image/jpeg', 0.86))
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } finally { URL.revokeObjectURL(url) }
}

/** One line for the activity log about what a finished request left for the user. */
function resultNote(result: AgentResult) {
  switch (result.proposal.kind) {
    case 'reply': return result.proposal.text
    case 'question': return result.proposal.conflict ? 'A condition blocks the shared idea; your decision is waiting in the chat.' : 'Agents paused for your answer in the chat.'
    case 'opportunity': return 'A shared proposal is waiting for your decision: accept, decline or refine.'
    case 'none': return `No useful overlap: ${result.proposal.reason}`
    case 'action': case 'research': return 'Reply ready in your chat. Add an outcome to the canvas when it feels right.'
  }
}

export function setupUnfold(editor: Editor) {
  const running = new Map<string, { requestId: string; controller: AbortController; sourceId: TLShapeId; lastMessageId: string | undefined; cardIds: string; dependencies: UnfoldNode['dependsOn'] }>()
  let exploreRun: AbortController | undefined
  const retries = new Map<string, () => void>()
  const records = () => nodes(editor).map(shape => ({ id: shape.id, node: shape.props.node }))
  const chats = () => conversations(editor)
  const notice = (message: string) => { toast(message) }
  const fail = (message: string) => { toast.error(message) }
  /** Puts removed cards, their lines and the lines' bindings back, skipping anything whose endpoint is gone since. */
  const restore = (shapes: TLShape[], bindings: TLBinding[], lineIds: ReadonlySet<string>) => {
    const missing = shapes.filter(shape => !editor.getShape(shape.id))
    if (isEmpty(missing)) return
    const back = new Set<string>(missing.map(shape => shape.id))
    const usable = bindings.filter(binding => back.has(binding.fromId) && (back.has(binding.toId) || editor.getShape(binding.toId)))
    const complete = new Set(usable.map(binding => binding.fromId).filter(id => usable.filter(binding => binding.fromId === id).length === 2))
    editor.markHistoryStoppingPoint('restore branch')
    editor.run(() => {
      editor.createShapes(missing.filter(shape => !lineIds.has(shape.id) || complete.has(shape.id)))
      editor.createBindings(usable.filter(binding => complete.has(binding.fromId)))
    })
  }
  const activity = (role: string, message: string, handoff?: Handoff) => uiState.update(editor, state => ({ ...state, activity: [...state.activity.slice(-99), { id: crypto.randomUUID(), role, message, time: Date.now(), ...(handoff ? { handoff } : {}) }] }))
  const revisions = () => currentRevisions(records(), chats())
  const launch = (promise: Promise<void>) => { promise.catch((error: unknown) => fail(error instanceof Error ? error.message : 'The operation could not finish. Please retry.')) }
  const clearJob = (id: string) => uiState.update(editor, state => { const jobs = { ...state.jobs }; delete jobs[id]; return { ...state, jobs } })
  const cancel = (id: string) => { running.get(id)?.controller.abort(); running.delete(id); clearJob(id) }
  /** A request whose sources or conditions changed is stopped; its late answer can never be applied. */
  const cancelOutdated = (id: string) => {
    running.get(id)?.controller.abort(); running.delete(id)
    uiState.update(editor, state => ({ ...state, jobs: { ...state.jobs, [id]: { status: 'error', message: 'Your conditions or sources changed while the agents worked, so their answer was set aside. Retry to use the latest.' } } }))
  }
  const chatAt = (id: TLShapeId, chatId: string) => {
    const chat = conversationAt(editor, chatId)
    return chat && nodeAt(editor, id) && conversationCards(chat).includes(id) ? chat : undefined
  }
  const editChat = (id: TLShapeId, chatId: string, transform: (chat: Chat) => Chat) => {
    const chat = chatAt(id, chatId)
    if (chat) putConversation(editor, transform(chat))
  }
  const focus = (id: TLShapeId) => {
    editor.select(id)
    const bounds = editor.getShapePageBounds(id)
    if (bounds) {
      const zoom = Math.min(editor.getZoomLevel(), 1)
      // Reserve space for the attached chat, keeping its source visible on the same canvas.
      editor.setCamera({ x: -bounds.center.x + (editor.getViewportScreenBounds().w - 440) / (2 * zoom), y: -bounds.center.y + editor.getViewportScreenBounds().h / (2 * zoom), z: zoom })
    }
  }
  const activate = (id: TLShapeId, chat: Chat) => {
    uiState.update(editor, state => ({ ...state, activeChat: { nodeId: id, chatId: chat.id }, panel: false }))
    focus(id)
  }
  const sourceBranches = (id: TLShapeId) => {
    const node = nodeAt(editor, id)?.props.node
    if (!node) return []
    if (node.type === 'opportunity') return node.sourceBranchIds
    const shared = nodes(editor).find(shape => shape.props.node.type === 'opportunity' && shape.props.node.branchId === node.branchId)?.props.node
    return shared?.type === 'opportunity' ? shared.sourceBranchIds : [node.branchId]
  }
  /** A shared conversation reads each source's latest exploration, up to its latest message. */
  /** The card with this id, when it is still on the board. */
  const cardId = (id: string) => nodes(editor).find(shape => shape.id === id)?.id
  const connectContext = (sourceIds: string[]) => sourceIds.flatMap(sourceId => {
    const card = cardId(sourceId)
    const previous = card ? conversationsFor(editor, card).filter(chat => chat.operation !== 'connect' && chat.sourceIds[0] === card).at(-1) : undefined
    const lastMessage = previous?.messages.at(-1)
    return previous ? [{ nodeId: sourceId, chatId: previous.id, ...(lastMessage ? { messageId: lastMessage.id } : {}) }] : []
  })
  const createChat = (id: TLShapeId, sourceIds: TLShapeId[] = [id], branchIds = sourceBranches(id), operation: Chat['operation'] = 'branch') => {
    const node = nodeAt(editor, id)?.props.node
    if (!node || isEmpty(branchIds)) return
    const contextChats = operation === 'connect' ? connectContext(sourceIds) : []
    const chat: Chat = { id: crypto.randomUUID(), title: operation === 'connect' ? 'Find a shared direction' : `Exploration ${conversationsFor(editor, id).length + 1}`, contextChats, sourceIds, cardIds: [...new Set([id, ...sourceIds])], branchIds, operation, messages: [], createdAt: Date.now() }
    editor.markHistoryStoppingPoint('start exploration')
    editor.run(() => {
      if (node.type === 'inspiration' && !node.started) update(editor, id, node => ({ ...node, started: true }))
      putConversation(editor, chat)
    })
    activate(id, chat)
    return chat
  }
  /** Research briefs a conversation already ran, so the agents search differently next time. */
  const briefsOf = (chat: Chat) => chat.messages.flatMap(message => message.role === 'assistant' ? message.searches ?? [] : []).slice(-6)
  /** Sources the research agent verified earlier in a conversation: the basis of decisions and of proposed ideas, newest last. */
  const sourcesOf = (chat: Chat) => {
    const all = chat.messages.flatMap(message => message.role !== 'assistant' ? [] : message.proposal.kind === 'question' ? message.proposal.conflict?.sources ?? [] : message.proposal.kind === 'opportunity' ? message.proposal.sources ?? [] : [])
    const latest = new Map(all.map(source => [source.url, source]))
    return [...latest.values()].slice(-6)
  }
  /** Marks cards built on `id` as out of date, so agents stop building on them and late answers are dropped. */
  const invalidate = (id: string) => {
    const affected = invalidatedBy(records(), id)
    for (const shape of nodes(editor)) if (affected.has(shape.id)) update(editor, shape.id, node => ({ ...node, stale: true, revision: node.revision + 1 }))
    for (const [jobId, job] of running) if (job.dependencies.some(dependency => dependency.id === id || affected.has(dependency.id))) cancelOutdated(jobId)
  }
  /**
   * Saves a conversation's memory. Only a confirmed condition that was replaced or withdrawn marks results for
   * review; a new message or a new condition does not, since nothing those results were based on became untrue.
   */
  const saveMemory = (id: TLShapeId, chatId: string, memory: ChatMemory) => {
    const before = chatAt(id, chatId)
    if (!before) return
    const revised = revisedConditions(chatMemory(before), memory)
    editChat(id, chatId, current => ({ ...current, memory }))
    if (isNotEmpty(revised)) invalidate(memoryKey(chatId))
  }
  /**
   * Places a new card. Found options sit beside the card they were searched for when there is room; any other card goes under its
   * parents, and beside the children they already have, so a second idea from the same card reads as a branch and
   * no line runs underneath another card.
   */
  const addNode = (node: UnfoldNode, parentIds: TLShapeId[], relationships?: ReadonlyMap<string, Relationship>) => {
    const parents = parentIds.flatMap(id => { const shape = nodeAt(editor, id); return shape ? [shape] : [] })
    const center = editor.getViewportPageBounds().center
    const id = createShapeId()
    editor.createShape<NodeShape>({ id, type: 'node', x: center.x, y: center.y, props: { node } })
    const created = nodeAt(editor, id)
    const width = created ? getNodeWidthPx(editor, created) : NODE_WIDTH_PX
    const height = created ? getNodeHeightPx(editor, created) : 330
    const rect = (shape: NodeShape) => ({ id: shape.id, x: shape.x, y: shape.y, w: getNodeWidthPx(editor, shape), h: getNodeHeightPx(editor, shape) })
    const occupied = nodes(editor).filter(shape => shape.id !== id).map(rect)
    const connections = editor.getCurrentPageShapes().flatMap(shape => editor.isShapeOfType(shape, 'connection') ? [getConnectionPagePoints(editor, shape)] : [])
    // Preserve main's hidden side-port links where a result can sit directly beside its source.
    const first = parents[0]
    const side = first ? { x: first.x + getNodeWidthPx(editor, first) + 60, y: first.y } : undefined
    const beside = node.type === 'findings' && first && side
      && !occupied.some(shape => side.x < shape.x + shape.w + 35 && side.x + width + 35 > shape.x && side.y < shape.y + shape.h + 35 && side.y + height + 35 > shape.y)
      && !connections.some(path => path.some(point => point.x > side.x && point.x < side.x + width && point.y > side.y && point.y < side.y + height)) ? first : undefined
    const position = beside && side ? side : placeNear(parents.map(rect), { w: width, h: height }, occupied, connections, center, node.type === 'opportunity' && parents.length === 2 ? [1 / 3, 2 / 3] : [])
    editor.updateShape<NodeShape>({ id, type: 'node', x: position.x, y: position.y })
    if (beside) link(editor, beside.id, id, 'side-in', relationships?.get(beside.id) ?? 'reference', 'side-out')
    else parentIds.forEach((parentId, index) => link(editor, parentId, id, parentIds.length === 2 && node.type === 'opportunity' ? `goal-${index}` : 'input', relationships?.get(parentId)))
    return id
  }
  /** What an edit may refer to: the turn's cards and conversation, or the whole board for the user's own edits. */
  function editContext(availableIds?: ReadonlySet<string>, chatId?: string) {
    return {
      cards: nodes(editor).filter(shape => !availableIds || availableIds.has(shape.id)).map(({ id, isLocked, props: { node } }) => ({ id, image: node.type === 'inspiration' && editor.getAssets().some(asset => asset.id === node.assetId && asset.type === 'image'), editable: !isLocked && node.type !== 'question' && node.type !== 'answer' && node.type !== 'findings', acceptsDescription: node.type !== 'inspiration' })),
      conversationIds: chatId ? [chatId] : chats().map(chat => chat.id), revisions: revisions(), links: boardLinks(editor),
    }
  }
  function applyBoardEdits(value: readonly BoardEdit[], turn?: {
    chat: Chat; focusId: TLShapeId; messageId: string; dependencies: UnfoldNode['dependsOn']; outputDependencies: UnfoldNode['dependsOn']; availableIds: ReadonlySet<string>; begin: () => void; finish: (created: TLShapeId[]) => void
  }): TLShapeId[] {
    if (editor.getIsReadonly()) throw new Error('The board is read-only right now. Try again when it is available.')
    const cards = nodes(editor).filter(shape => !turn || turn.availableIds.has(shape.id))
    const links = boardLinks(editor)
    const edits = validateBoardEdits(value, editContext(turn?.availableIds, turn?.chat.id), turn?.dependencies)
    const ids = new Map<string, TLShapeId>(cards.map(shape => [shape.id, shape.id]))
    const created: TLShapeId[] = []
    const attach = (chatId: string, nodeId: TLShapeId) => {
      const chat = conversationAt(editor, chatId)
      if (chat && !conversationCards(chat).includes(nodeId)) putConversation(editor, { ...chat, cardIds: [...conversationCards(chat), nodeId] })
    }
    if (isNotEmpty(edits)) editor.markHistoryStoppingPoint('edit board')
    editor.run(() => {
      turn?.begin()
      for (const edit of edits) {
        if (edit.kind === 'updateNode') {
          const id = ids.get(edit.nodeId)
          if (!id) continue
          const before = nodeAt(editor, id)?.props.node
          if (!before) continue
          const description = before.type === 'artifact' ? before.content.description : before.type === 'action' || before.type === 'opportunity' ? before.description : undefined
          if (nodeTitle(before) === edit.title && (edit.description === undefined || edit.description === description)) continue
          invalidate(id)
          update(editor, id, node => {
            const revision = node.revision + 1
            if (node.type === 'inspiration') return { ...node, goal: edit.title, revision }
            if (node.type === 'artifact') return { ...node, revision, content: { ...node.content, title: edit.title, description: edit.description ?? node.content.description } }
            if (node.type === 'action' || node.type === 'opportunity') return { ...node, revision, title: edit.title, description: edit.description ?? node.description }
            return node
          })
          if (!turn && before.type === 'inspiration') noteActivity([id])
        } else if (edit.kind === 'connectNodes') {
          const from = ids.get(edit.from), to = ids.get(edit.to)
          if (!from || !to || links.some(item => item.from === from && item.to === to && item.relationship === edit.relationship)) continue
          const target = nodeAt(editor, to)?.props.node
          link(editor, from, to, target?.type === 'opportunity' ? 'goal-0' : 'input', edit.relationship)
          links.push({ from, to, relationship: edit.relationship })
        } else if (edit.kind === 'attachNodeToConversation') {
          const id = ids.get(edit.nodeId)
          if (id) attach(edit.conversationId, id)
        } else {
          const parents = new Map(edit.links.map(link => [link.nodeId, link.relationship]))
          if (turn && !parents.has(turn.focusId)) parents.set(turn.focusId, 'develops')
          if (edit.content.kind === 'moodboard') for (const item of edit.content.items) if (!parents.has(item.nodeId)) parents.set(item.nodeId, 'reference')
          const parentIds = [...parents.keys()].flatMap(id => { const parent = ids.get(id); return parent ? [parent] : [] })
          const parent = turn ? nodeAt(editor, turn.focusId)?.props.node : undefined
          const provenance = turn ? { origin: { nodeId: turn.focusId, chatId: turn.chat.id, messageId: turn.messageId, inputs: turn.dependencies }, dependsOn: turn.outputDependencies } : {}
          const id = addNode({ ...baseNode(parent?.branchId || crypto.randomUUID(), turn ? 'branch' : 'you'), ...provenance, type: 'artifact', content: edit.content }, parentIds, parents)
          created.push(id)
          if (turn) attach(turn.chat.id, id)
        }
      }
      turn?.finish(created)
      const first = created[0]
      if (first && (!turn || uiState.get(editor).activeChat?.chatId === turn.chat.id)) editor.select(first)
    })
    if (isNotEmpty(edits)) editor.markHistoryStoppingPoint('board edit applied')
    return created
  }
  const run = async (sourceId: TLShapeId, chatId: string) => {
    const source = nodeAt(editor, sourceId)
    const chat = chatAt(sourceId, chatId)
    if (!source || !chat) return
    cancel(chatId)
    const controller = new AbortController(); const requestId = crypto.randomUUID()
    const all = records()
    const threadsOnBoard = chats()
    const board = getBoardContext(editor, chat, sourceId)
    const attachmentKey = JSON.stringify(conversationCards(chat))
    const dependencyIds = new Set([...chat.branchIds, ...[sourceId, ...chat.sourceIds].flatMap(id => lineage(all, id).map(record => record.id))])
    const dependencies = [...all.filter(record => dependencyIds.has(record.id)).map(record => ({ id: record.id, revision: record.node.revision })), ...memoryDependencies(all, sourceId, chat, threadsOnBoard)]
    if (source.props.node.type === 'opportunity' && source.props.node.status === 'rejected') {
      uiState.update(editor, state => ({ ...state, jobs: { ...state.jobs, [chatId]: { status: 'error', message: 'You declined this shared direction, so agents will not develop it. Reconsider it in its connection chat to continue.' } } }))
      return
    }
    running.set(chatId, { requestId, controller, sourceId, lastMessageId: chat.messages.at(-1)?.id, cardIds: attachmentKey, dependencies })
    retries.set(chatId, () => launch(run(sourceId, chatId)))
    uiState.update(editor, state => ({ ...state, jobs: { ...state.jobs, [chatId]: { status: 'running', message: chat.operation === 'connect' ? 'Finding a shared direction…' : chat.operation === 'research' ? 'Looking for a real first step…' : 'Following your inspiration…' } } }))
    try {
      const remaining = chat.branchIds.filter(id => all.some(record => record.id === id && record.node.type === 'inspiration'))
      const operation = chat.operation === 'connect' && remaining.length !== 2 ? 'branch' : chat.operation
      const branchIds = isNotEmpty(remaining) ? remaining : chat.branchIds.slice(0, 1)
      const branches = branchIds.map(branchId => chatContext(all, sourceId, chat, branchId, threadsOnBoard))
      let image: string | undefined
      const root = source.props.node.type === 'inspiration' ? source.props.node : all.find(record => record.id === branchIds[0])?.node
      if (operation === 'branch' && root?.type === 'inspiration' && uiState.get(editor).mode === 'live') {
        const asset = editor.getAssets().find(asset => asset.id === root.assetId)
        if (asset?.type === 'image' && asset.props.src) {
          const url = await editor.resolveAssetUrl(asset.id, { shouldResolveToOriginal: true })
          if (!url) throw new Error('The inspiration image is unavailable. Please reimport it.')
          if (url.startsWith('data:image/')) image = url
          else { const blob = await (await fetch(url, { signal: controller.signal })).blob(); image = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read the image.')); reader.onerror = () => reject(new Error('Could not read the image.')); reader.readAsDataURL(blob) }) }
        }
      }
      const selectedContext = source.props.node.type === 'inspiration' ? '' : `Build from this outcome: ${nodeTitle(source.props.node)}. ${source.props.node.type === 'action' || source.props.node.type === 'opportunity' ? source.props.node.description : ''}`
      // Only a message the agents have not answered yet guides this request.
      const tail = chat.messages.at(-1)
      const latest = tail?.role === 'user' ? tail : undefined
      const revised = latest?.role === 'user' && latest.stance === 'refine' ? chat.messages.find(message => message.id === latest.replyTo) : undefined
      const asked = revised?.role === 'assistant' ? revised.proposal : undefined
      // A next step is revised with its own steps and sources; a shared direction with its description.
      const focus = latest?.role === 'user' && (asked?.kind === 'opportunity' || asked?.kind === 'action') ? {
        kind: 'refine' as const, title: asked.title.slice(0, 200), note: latest.text,
        ...(asked.kind === 'action'
          ? { description: (asked.summary || asked.description).slice(0, 2000), ...(asked.steps && isNotEmpty(asked.steps) ? { steps: asked.steps.slice(0, 4).map(step => step.slice(0, 200)) } : {}), ...(isNotEmpty(asked.sources) ? { sources: asked.sources.slice(0, 6) } : {}) }
          : { description: asked.description.slice(0, 2000) }),
      } : undefined
      const sourceNode = source.props.node
      const outcome = sourceNode.type === 'action' || sourceNode.type === 'opportunity' ? { title: sourceNode.title.slice(0, 200), description: sourceNode.description.slice(0, 2000), ...(sourceNode.type === 'opportunity' && sourceNode.sources && isNotEmpty(sourceNode.sources) ? { sources: sourceNode.sources } : {}) } : undefined
      const priorBriefs = briefsOf(chat)
      const priorSources = chat.operation === 'connect' ? sourcesOf(chat) : []
      if (chat.operation === 'connect') { const [a, b] = chat.branchIds; if (a && b) stopLinkJob(pairKey(a, b)) }
      const result = await requestAgent({ requestId, operation, branches, image, board, note: [selectedContext, latest?.role === 'user' ? latest.text : ''].filter(Boolean).join('\n').slice(0, 2000), ...(focus ? { focus } : {}), ...(outcome ? { outcome } : {}), ...(operation === 'connect' ? { trigger: 'manual' as const } : {}), ...(isNotEmpty(priorBriefs) ? { priorBriefs } : {}), ...(isNotEmpty(priorSources) ? { priorSources } : {}) }, controller.signal, event => {
        if (running.get(chatId)?.requestId !== requestId) return
        if (event.type === 'activity') { activity(event.role, event.message); return }
        activity(event.handoff.from, event.handoff.summary, event.handoff)
        uiState.update(editor, state => { const job = state.jobs[chatId]; return job ? { ...state, jobs: { ...state.jobs, [chatId]: { ...job, handoffs: [...(job.handoffs ?? []), event.handoff].slice(-24) } } } : state })
      })
      const current = chatAt(sourceId, chatId)
      if (controller.signal.aborted || running.get(chatId)?.requestId !== requestId || !current) return
      if (current.messages.at(-1)?.id !== chat.messages.at(-1)?.id || JSON.stringify(conversationCards(current)) !== attachmentKey || !revisionsMatch(dependencies, revisions())) { cancelOutdated(chatId); return }
      const messageId = crypto.randomUUID()
      // Agent memory needs a user message as its basis; otherwise it stays an assumption.
      const threads = chat.branchIds.flatMap(branchId => contextThreads(all, sourceId, chat, branchId, threadsOnBoard))
      const userMessageIds = new Set(threads.flatMap(thread => thread.chat.messages.flatMap(message => message.role === 'user' ? [message.id] : [])))
      const knownEntryIds = new Set(branches.flatMap(branch => branch.memory.map(item => item.id)))
      let index = 0
      const memory = applyAgentMemory(chatMemory(current), result.memory, userMessageIds, knownEntryIds, messageId, Date.now(), () => `${messageId}:${index++}`)
      const ownKey = memoryKey(chatId)
      const availableIds = new Set(board.cards.map(card => card.id))
      const used = new Set([...result.usedNodeIds, ...result.edits.flatMap(editedNodeIds)])
      if ([...used].some(id => !availableIds.has(id))) throw new Error('The agent referred to a card outside this conversation’s board context. Please retry.')
      const inputs = [...dependencies, ...board.cards.filter(card => used.has(card.id) && !dependencyIds.has(card.id)).map(({ id, revision }) => ({ id, revision }))]
      const finalDependencies = inputs.map(dependency => dependency.id === ownKey ? { ...dependency, revision: memory.revision } : dependency)
      // Board changes are only suggested here: the user sees them in the chat and adds them, or not.
      if (isNotEmpty(result.edits)) validateBoardEdits(result.edits, editContext(availableIds, chatId), inputs)
      running.delete(chatId)
      if (memory !== chatMemory(current)) saveMemory(sourceId, chatId, memory)
      editChat(sourceId, chatId, thread => ({ ...thread, messages: [...thread.messages, { id: messageId, role: 'assistant', proposal: result.proposal, dependsOn: finalDependencies, ...(isNotEmpty(result.edits) ? { proposedEdits: result.edits } : {}), ...(isNotEmpty(result.handoffs) ? { trace: result.handoffs } : {}), ...(isNotEmpty(result.searches) ? { searches: result.searches } : {}), ...(revised && (focus || (revised.role === 'assistant' && revised.proposedEdits && isNotEmpty(result.edits))) ? { revises: revised.id } : {}) }] }))
      if (result.mode !== uiState.get(editor).mode) {
        uiState.update(editor, state => ({ ...state, mode: result.mode }))
        getAgentConfig().then(config => uiState.update(editor, state => ({ ...state, ...config }))).catch(() => {})
      }
      clearJob(chatId)
      activity('coordinator', resultNote(result))
    } catch (error) {
      if (!controller.signal.aborted && running.get(chatId)?.requestId === requestId) uiState.update(editor, state => ({ ...state, jobs: { ...state.jobs, [chatId]: { status: 'error', message: error instanceof Error ? error.message : 'Something went wrong. Please retry.' } } }))
    } finally {
      if (running.get(chatId)?.requestId === requestId) { if (uiState.get(editor).jobs[chatId]?.status === 'running') clearJob(chatId); running.delete(chatId) }
    }
  }
  // —— Noticing links between goals ——
  // Only the user's own actions in a branch schedule a check: messages, goal edits and memory changes.
  // Card moves, typing and the app's own writes never do. Checks wait for a quiet moment, compare a
  // signature of what each branch confirmed, skip pairs already checked or waiting on the user, and run
  // one pair at a time. A late result whose sources or conditions changed is set aside.
  const linkJobs = new Map<string, { requestId: string; controller: AbortController; dependencies: UnfoldNode['dependsOn']; a: string; b: string }>()
  const pendingBranches = new Set<string>()
  const linkQueue: { a: string; b: string }[] = []
  let linkTimer: ReturnType<typeof setTimeout> | undefined
  let scanning = false
  let disposed = false
  const linkJobKey = (key: string) => `link:${key}`
  const stopLinkJob = (key: string) => { linkJobs.get(key)?.controller.abort(); linkJobs.delete(key); clearJob(linkJobKey(key)) }
  const noteActivity = (branchIds: string[]) => {
    if (disposed) return
    for (const id of branchIds) pendingBranches.add(id)
    clearTimeout(linkTimer)
    linkTimer = setTimeout(flushLinks, LINK_DELAY_MS)
  }
  const flushLinks = () => {
    if (disposed) return
    // A branch whose own agents are still replying may still change what it knows: wait for them.
    const replying = [...running.entries()].some(([chatId, job]) => chatAt(job.sourceId, chatId)?.branchIds.some(id => pendingBranches.has(id)))
    if (replying) { linkTimer = setTimeout(flushLinks, LINK_DELAY_MS); return }
    const changed = [...pendingBranches]; pendingBranches.clear()
    const queued = new Set([...linkJobs.keys(), ...linkQueue.map(pair => pairKey(pair.a, pair.b))])
    for (const pair of pairsToScan(records(), changed, undefined, chats())) if (!queued.has(pairKey(pair.a, pair.b))) linkQueue.push({ a: pair.a, b: pair.b })
    linkQueue.splice(0, Math.max(0, linkQueue.length - 4))
    launch(pumpLinks())
  }
  const pumpLinks = async () => {
    if (scanning) return
    scanning = true
    try { for (let next = linkQueue.shift(); next && !disposed; next = linkQueue.shift()) await scanPair(next.a, next.b) } finally { scanning = false }
  }
  /** Keeps the outcome of the latest check of a pair, so it is not repeated after a reload. */
  const recordScan = (a: string, b: string, scan: Omit<LinkScan, 'otherId' | 'at'>) => {
    const owner = cardId(pairOwner(a, b))
    if (!owner) return
    const otherId = owner === a ? b : a
    update(editor, owner, node => node.type === 'inspiration' ? { ...node, links: [...(node.links ?? []).filter(item => item.otherId !== otherId), { ...scan, otherId, at: Date.now() }].slice(-40) } : node)
  }
  const goalOf = (id: string) => { const card = cardId(id); const node = card ? nodeAt(editor, card)?.props.node : undefined; return node ? nodeTitle(node) : 'a goal' }
  const scanPair = async (a: string, b: string, force = false) => {
    const all = records()
    const signature = pairSignature(all, a, b, chats())
    if (!signature || (!force && lastScan(all, a, b)?.signature === signature)) return
    const existing = pairChat(all, a, b, chats())
    if (pairIsSettled(existing?.chat) || (existing && running.has(existing.chat.id))) return
    const key = pairKey(a, b)
    const ownerId = cardId(existing?.nodeId ?? pairOwner(a, b))
    if (!ownerId) return
    const branchIds = existing?.chat.branchIds ?? [ownerId, ownerId === a ? b : a]
    const chat: Chat = existing ? { ...existing.chat, contextChats: connectContext(existing.chat.sourceIds) } : { id: crypto.randomUUID(), title: 'Shared direction', contextChats: connectContext(branchIds), sourceIds: branchIds, branchIds, operation: 'connect', messages: [], createdAt: Date.now() }
    const ownKey = memoryKey(chat.id)
    const dependencies = [...branchIds.flatMap(id => { const record = all.find(item => item.id === id); return record ? [{ id, revision: record.node.revision }] : [] }), ...memoryDependencies(all, ownerId, chat, chats()).filter(dependency => existing || dependency.id !== ownKey)]
    const controller = new AbortController(); const requestId = crypto.randomUUID()
    stopLinkJob(key)
    linkJobs.set(key, { requestId, controller, dependencies, a, b })
    uiState.update(editor, state => ({ ...state, jobs: { ...state.jobs, [linkJobKey(key)]: { status: 'running', message: 'Checking whether these goals connect…', handoffs: [] } } }))
    const current = () => !disposed && !controller.signal.aborted && linkJobs.get(key)?.requestId === requestId
    try {
      const branches = branchIds.map(branchId => chatContext(all, ownerId, chat, branchId, chats()))
      const priorBriefs = existing ? briefsOf(existing.chat) : []
      const priorSources = existing ? sourcesOf(existing.chat) : []
      const result = await requestAgent({ requestId, operation: 'connect', branches, note: '', trigger: 'auto', ...(isNotEmpty(priorBriefs) ? { priorBriefs } : {}), ...(isNotEmpty(priorSources) ? { priorSources } : {}) }, controller.signal, event => {
        if (!current()) return
        if (event.type === 'activity') { activity(event.role, event.message); return }
        activity(event.handoff.from, event.handoff.summary, event.handoff)
        uiState.update(editor, state => { const job = state.jobs[linkJobKey(key)]; return job ? { ...state, jobs: { ...state.jobs, [linkJobKey(key)]: { ...job, handoffs: [...(job.handoffs ?? []), event.handoff].slice(-24) } } } : state })
      })
      if (!current()) return
      const now = records()
      // Late results never apply to changed conditions, a removed goal or a conversation the user has since started.
      if (pairSignature(now, a, b, chats()) !== signature || !revisionsMatch(dependencies, currentRevisions(now, chats()))) return
      const latest = pairChat(now, a, b, chats())
      if (pairIsSettled(latest?.chat) || (latest && running.has(latest.chat.id)) || (latest && latest.chat.id !== chat.id)) return
      if (result.proposal.kind === 'none') {
        const reason = result.proposal.reason
        editor.run(() => recordScan(a, b, { signature, status: 'none', reason }), { history: 'ignore' })
        activity('coordinator', `Checked “${goalOf(a)}” and “${goalOf(b)}”: no useful overlap yet, so nothing was suggested.`)
        return
      }
      const messageId = crypto.randomUUID()
      const message: ChatMessage = { id: messageId, role: 'assistant', proposal: result.proposal, dependsOn: [...dependencies.filter(dependency => dependency.id !== ownKey), { id: ownKey, revision: chatMemory(latest?.chat ?? chat).revision }], ...(isNotEmpty(result.handoffs) ? { trace: result.handoffs } : {}), ...(isNotEmpty(result.searches) ? { searches: result.searches } : {}) }
      editor.run(() => {
        if (latest) editChat(ownerId, chat.id, thread => ({ ...thread, contextChats: chat.contextChats ?? [], messages: [...thread.messages, message] }))
        else putConversation(editor, { ...chat, cardIds: [...new Set([ownerId, ...chat.sourceIds])], messages: [message] })
        recordScan(a, b, { signature, status: 'found', reason: result.proposal.kind === 'opportunity' ? result.proposal.title : result.proposal.kind === 'question' ? result.proposal.prompt : '', chatId: chat.id })
      }, { history: 'ignore' })
      activity('coordinator', `Noticed a link between “${goalOf(a)}” and “${goalOf(b)}”. ${resultNote(result)}`)
      // A short notice only while nothing else is open; the cards' link entry stays either way.
      if (!uiState.get(editor).activeChat) toast(result.proposal.kind === 'question' ? 'Your two goals may connect — the agents need your decision' : 'Your two goals may connect', { description: `${goalOf(a)} + ${goalOf(b)}`, action: { label: 'Open', onClick: () => api.openChat(ownerId, chat.id) } })
    } catch (error) {
      if (!current()) return
      // A technical failure is not a finding: it is kept (so Retry survives a reload) and never reads as “no overlap”.
      const message = error instanceof Error ? error.message : 'The link check could not finish. Please retry.'
      uiState.update(editor, state => ({ ...state, jobs: { ...state.jobs, [linkJobKey(key)]: { status: 'error', message } } }))
      if (pairSignature(records(), a, b, chats()) === signature) editor.run(() => recordScan(a, b, { signature, status: 'error', reason: message.slice(0, 400) }), { history: 'ignore' })
      activity('coordinator', `Paused checking “${goalOf(a)}” and “${goalOf(b)}”: ${message}`)
      toast.error('The agents could not finish checking a link', { description: message, action: { label: 'Retry', onClick: () => api.retryLink(a, b) } })
    } finally {
      if (linkJobs.get(key)?.requestId === requestId) { linkJobs.delete(key); if (uiState.get(editor).jobs[linkJobKey(key)]?.status === 'running') clearJob(linkJobKey(key)) }
    }
  }
  const conversationCardsForRetry = (chat: Chat | undefined) => chat ? conversationCards(chat).flatMap(id => { const card = cardId(id); return card ? [card] : [] })[0] : undefined
  /** The canvas card of an earlier version of this step, following the chain of revisions. */
  function revisedCard(chat: Chat, message: ChatMessage): NodeShape | undefined {
    let current: ChatMessage | undefined = message
    for (let depth = 0; depth < 12 && current?.role === 'assistant' && current.revises; depth++) {
      const earlierId: string = current.revises
      current = chat.messages.find(item => item.id === earlierId)
      const outcomeId = current?.role === 'assistant' ? current.outcomeId : undefined
      const card = outcomeId ? nodes(editor).find(shape => shape.id === outcomeId && shape.props.node.type === 'action') : undefined
      if (card) return card
    }
    return undefined
  }
  function exploreCandidates(): ExploreCandidate[] {
    const all = records()
    const threads = chats()
    const current = revisions()
    return nodes(editor).flatMap(({ id, props: { node } }): ExploreCandidate[] => {
      const title = nodeTitle(node).trim().slice(0, 240)
      if (!title || title === 'Something I want to explore') return []
      const { conditions, memory } = cardConditions(all, id, threads)
      const dependencies = [...lineage(all, id).map(record => ({ id: record.id, revision: record.node.revision })), ...memory]
      const seen = all.find(record => record.node.type === 'findings' && record.node.topic.sourceId === id)?.node
      const links = node.type === 'action' || node.type === 'opportunity' ? (node.sources ?? []).map(source => source.url) : node.type === 'findings' ? node.findings.filter(finding => !node.dismissed.includes(finding.id)).map(finding => finding.source) : (node.exploration?.sources ?? []).map(source => source.url)
      // A saved search is reused while its card and conversation are unchanged, so earlier edits to the scope survive.
      const topic = seen?.type === 'findings' && revisionsMatch(seen.dependsOn, current)
        ? { ...investigationTopic(seen.topic), sourceId: id, title, dependencies }
        : buildWebTopic({ sourceId: id, title, dependencies, conditions, links })
      const generic = { ...topic, kind: 'card' as const, category: topic.category === 'activity' ? undefined : topic.category }
      return [{ topic: generic, selected: true, suggested: true, reason: node.type === 'findings' ? 'Develop previous discoveries' : 'Explore this card', conditions }]
    })
  }

  const setExplore = (change: (run: ExploreRun) => ExploreRun) => uiState.update(editor, state => state.explore ? { ...state, explore: change(state.explore) } : state)
  /** The shared step's card, created or refreshed only when the user asks for it. */
  function addSharedStep(): TLShapeId | undefined {
    const run = uiState.get(editor).explore
    const shared = run?.shared?.plan
    if (!run || !shared || editor.getIsReadonly()) return
    const sourceIds = new Set(shared.items.map(item => item.sourceId))
    const parents = nodes(editor).filter(shape => shape.props.node.type === 'findings' && sourceIds.has(shape.props.node.topic.sourceId))
    // One option can serve several ideas: it must still be on the board, and no idea's card may have dismissed it.
    const holds = (id: string) => parents.some(parent => parent.props.node.type === 'findings' && parent.props.node.findings.some(finding => finding.id === id && finding.state !== 'closed'))
    const dismissed = (id: string) => parents.some(parent => parent.props.node.type === 'findings' && parent.props.node.dismissed.includes(id))
    const eligible = isNotEmpty(parents) && shared.items.every(item => holds(item.finding.id) && !dismissed(item.finding.id))
    if (!eligible) { notice('An option in this step was dismissed or changed. Run the search again for a fresh suggestion.'); return }
    const options = [...new Map(shared.items.map(item => [item.finding.id, item.finding])).values()]
    // An idea without its own findings card connects through its card on the board.
    const linked = [...parents.map(parent => parent.id), ...[...sourceIds].flatMap(sourceId => parents.some(parent => parent.props.node.type === 'findings' && parent.props.node.topic.sourceId === sourceId) ? [] : nodes(editor).filter(shape => shape.id === sourceId).map(shape => shape.id))]
    const topics = run.topics.filter(topic => sourceIds.has(topic.sourceId))
    const branchId = `explore-shared:${[...sourceIds].sort().join('|')}`
    const existing = nodes(editor).find(shape => shape.props.node.branchId === branchId && shape.props.node.type === 'action')
    const content = {
      title: shared.title, summary: shared.summary, description: '',
      sources: options.map(finding => ({ id: finding.id, title: finding.title, url: finding.source })),
      steps: options.map(finding => `Review ${finding.title}`.slice(0, 200)),
      dependsOn: [...new Map([...topics.flatMap(topic => topic.dependencies), ...parents.map(parent => ({ id: parent.id, revision: parent.props.node.revision }))].map(dependency => [dependency.id, dependency])).values()],
    }
    let id: TLShapeId | undefined
    editor.markHistoryStoppingPoint('add shared step')
    editor.run(() => {
      if (existing?.props.node.type === 'action') {
        if (existing.props.node.completed) { id = existing.id; return }
        update(editor, existing.id, node => node.type === 'action' ? { ...node, ...content, doneSteps: JSON.stringify(node.steps) === JSON.stringify(content.steps) ? node.doneSteps : [], revision: node.revision + 1, stale: false } : node)
        id = existing.id
      } else id = addNode({ ...baseNode(branchId, 'connection'), type: 'action', ...content, completed: false, reflection: '' }, linked, new Map(linked.map(parentId => [parentId, 'reference'])))
    })
    if (id) { const added = id; setExplore(current => current.shared ? { ...current, shared: { ...current.shared, addedId: added } } : current); editor.select(added) }
    saveNow.get(editor)?.()
    return id
  }

  async function exploreBoard(topics: ExploreTopic[]): Promise<void> {
    if (exploreRun) throw new Error('An Explore board run is already active.')
    if (editor.getIsReadonly()) throw new Error('This board is read-only.')
    const parsed = ExploreRequestSchema.safeParse({ operation: 'explore', requestId: crypto.randomUUID(), topics: topics.map(investigationTopic) })
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Check the search details.')
    const scope = parsed.data.topics.map(investigationTopic)
    if (scope.some(topic => !revisionsMatch(topic.dependencies, revisions()))) throw new Error('Your sources or conditions changed. Reopen Explore board to use the latest context.')
    const baselineTopics = exploreCandidates().map(candidate => candidate.topic)
    const controller = new AbortController()
    exploreRun = controller
    const applied = new Set<string>()
    const updatedIds: TLShapeId[] = []; const existingIds: TLShapeId[] = []
    const addedOptions = new Set<string>(); const existingOptions = new Set<string>()
    const reports: ExploreReport[] = []
    uiState.update(editor, state => ({ ...state, explore: { running: true, stopped: false, error: '', workers: [], topics: scope, baselines: baselineTopics, reports: [], updatedIds: [], added: 0, existingIds: [], existing: 0, failed: [] } }))
    try {
      const fingerprint = () => JSON.stringify({ cards: records().map(({ id, node }) => ({ id, node: { ...node, fit: undefined, expanded: undefined } })), conversations: chats(), relations: boardLinks(editor) })
      let expected = fingerprint()
      const captured = { cards: records(), conversations: chats(), relations: boardLinks(editor) }
      const assets = new Map(editor.getAssets().map(asset => [String(asset.id), asset]))
      const images = new Map<string, Promise<string>>()
      async function readImage(assetId: string) {
        const asset = assets.get(assetId)
        if (!asset) throw new Error('An inspiration image is unavailable. Reimport it before exploring.')
        const url = await editor.resolveAssetUrl(asset.id, { shouldResolveToOriginal: true })
        if (!url) throw new Error('An inspiration image is unavailable.')
        if (url.startsWith('data:image/')) return url
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok) throw new Error('An inspiration image could not be read.')
        const blob = await response.blob()
        return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read an image.')); reader.onerror = () => reject(new Error('Could not read an image.')); reader.readAsDataURL(blob) })
      }
      const cards = await Promise.all(captured.cards.map(async card => {
        if (card.node.type !== 'inspiration' || !card.node.assetId) return card
        const id = card.node.assetId
        let image = images.get(id)
        if (!image) {
          image = readImage(id)
          images.set(id, image)
        }
        return { ...card, image: await image }
      }))
      controller.signal.throwIfAborted()
      const apply = (report: ExploreReport) => {
        if (disposed || controller.signal.aborted || exploreRun !== controller || editor.getIsReadonly() || applied.has(report.sourceId)) return
        const topic = scope.find(topic => topic.sourceId === report.sourceId)
        if (!topic) return
        applied.add(report.sourceId)
        const source = nodes(editor).find(shape => shape.id === topic.sourceId)
        if (!source || fingerprint() !== expected) report = { sourceId: topic.sourceId, status: 'failed', message: 'The board changed during this investigation. Retry with the latest context.' }
        if (report.status === 'complete' && source) {
          const used = new Set([topic.sourceId, ...(report.usedCardIds ?? [])])
          const dependencies = [...new Map([...[...used].flatMap(id => lineage(captured.cards, id).map(card => ({ id: card.id, revision: card.node.revision }))), ...[...used].flatMap(id => cardConditions(captured.cards, id, captured.conversations).memory)].map(dependency => [dependency.id, dependency])).values()]
          if ([...used].some(id => !captured.cards.some(card => card.id === id))) report = { sourceId: topic.sourceId, status: 'failed', message: 'The reply used an unavailable card. Retry this investigation.' }
          else if (!revisionsMatch(dependencies, revisions())) report = { sourceId: topic.sourceId, status: 'failed', message: 'A source used by this investigation changed. Retry with the latest context.' }
          else {
            const completed = report
            editor.markHistoryStoppingPoint('apply card investigation')
            editor.run(() => {
              const group = nodes(editor).find(shape => shape.props.node.type === 'findings' && shape.props.node.topic.sourceId === topic.sourceId)
              const before = group?.props.node.type === 'findings' ? group.props.node : undefined
              const incoming = completed.findings.filter(finding => finding.state !== 'closed' || before?.findings.some(old => old.id === finding.id))
              if (before || isNotEmpty(incoming)) {
                const retain = before !== undefined && searchScope(before.topic) === searchScope(topic)
                const findings = mergeFindings(before?.findings ?? [], incoming, retain, before?.checkedAt)
                const found = findings.filter(finding => incoming.some(item => item.id === finding.id) && !before?.dismissed.includes(finding.id) && finding.state !== 'closed')
                for (const finding of found) (finding.state === 'new' ? addedOptions : existingOptions).add(`finding:${finding.id}`)
                let id: TLShapeId
                if (group && before) {
                  const changed = JSON.stringify(before.findings.map(item => ({ ...item, state: undefined, checkedAt: undefined }))) !== JSON.stringify(findings.map(item => ({ ...item, state: undefined, checkedAt: undefined })))
                  update(editor, group.id, () => ({ ...before, topic, findings, checkedAt: completed.checkedAt, revision: before.revision + Number(changed), dependsOn: dependencies.filter(dependency => dependency.id !== group.id), stale: false }))
                  if (changed) invalidate(group.id)
                  id = group.id
                } else id = addNode({ ...baseNode(source.props.node.branchId, 'research'), type: 'findings', topic, findings, dismissed: [], checkedAt: completed.checkedAt, dependsOn: dependencies }, [source.id], new Map([[source.id, 'reference']]))
                if (found.some(finding => finding.state === 'new')) updatedIds.push(id)
                else if (isNotEmpty(found)) existingIds.push(id)
              }
              for (const development of completed.developments ?? []) {
                const existing = nodes(editor).find(({ props: { node } }) => node.type === 'artifact' && node.exploration?.sourceId === topic.sourceId && developmentKey({ kind: node.exploration.kind, title: node.content.title, text: node.content.description, sources: node.exploration.sources }) === developmentKey(development))
                if (existing) {
                  update(editor, existing.id, node => ({ ...node, dependsOn: dependencies.filter(dependency => dependency.id !== existing.id), stale: false, ...(node.exploration ? { exploration: { ...node.exploration, sources: development.sources } } : {}) }))
                  existingIds.push(existing.id); existingOptions.add(`development:${topic.sourceId}:${development.id}`); continue
                }
                const id = addNode({ ...baseNode(`explore:${topic.sourceId}:${development.id}`, 'research'), type: 'artifact', content: { kind: 'note', title: development.title, description: development.text }, exploration: { sourceId: topic.sourceId, id: development.id, kind: development.kind, sources: development.sources }, dependsOn: dependencies }, [source.id])
                updatedIds.push(id); addedOptions.add(`development:${topic.sourceId}:${development.id}`)
              }
            })
            expected = fingerprint()
            editor.markHistoryStoppingPoint('card investigation applied')
          }
        }
        reports.push(report)
        setExplore(run => ({ ...run, reports: [...reports], updatedIds: [...new Set(updatedIds)], existingIds: [...new Set(existingIds)], added: addedOptions.size, existing: [...existingOptions].filter(id => !addedOptions.has(id)).length, failed: reports.flatMap(item => item.status === 'failed' ? [item.sourceId] : []) }))
      }
      const result = await requestExplore({ ...parsed.data, board: { cards, conversations: captured.conversations, relations: captured.relations } }, controller.signal, event => {
        if (disposed || controller.signal.aborted || exploreRun !== controller) return
        if (event.type === 'activity') activity(event.role, event.message)
        if (event.type === 'explore-report') apply(event.report)
        if (event.type === 'explore-worker') setExplore(run => {
          const workers = run.workers.filter(worker => worker.id !== event.worker.id)
          const index = run.workers.findIndex(worker => worker.id === event.worker.id)
          workers.splice(index < 0 ? workers.length : index, 0, event.worker)
          return { ...run, workers }
        })
      })
      result.reports.forEach(apply)
      const shared = result.shared
      if (!controller.signal.aborted && shared) setExplore(run => ({ ...run, shared: { plan: shared } }))
    } catch (error) {
      if (!disposed) setExplore(run => ({ ...run, stopped: controller.signal.aborted, error: controller.signal.aborted ? '' : error instanceof Error ? error.message : 'Explore board could not finish.' }))
    } finally {
      if (exploreRun === controller) exploreRun = undefined
      if (!disposed && reports.some(report => report.status === 'complete')) saveNow.get(editor)?.()
      if (!disposed) setExplore(run => ({ ...run, running: false, failed: [...new Set([...run.failed, ...scope.filter(topic => !applied.has(topic.sourceId)).map(topic => topic.sourceId)])], workers: run.workers.map(worker => worker.status === 'running' || worker.status === 'queued' ? { ...worker, status: 'skipped', message: controller.signal.aborted ? 'Stopped by you.' : 'The investigation ended before this card.' } : worker) }))
    }
  }

  const api: UnfoldActions = {
    exploreCandidates,
    exploreBoard,
    stopExplore() { exploreRun?.abort() },
    async retryExplore() {
      const run = uiState.get(editor).explore
      if (!run || run.running) return
      const fresh = exploreCandidates()
      const topics = (run.error ? run.topics : run.topics.filter(topic => run.failed.includes(topic.sourceId))).flatMap(previous => {
        const candidate = fresh.find(candidate => candidate.topic.sourceId === previous.sourceId)?.topic
        if (!candidate) return []
        const baseline = run.baselines?.find(topic => topic.sourceId === previous.sourceId)
        return [refreshInvestigationScope(candidate, previous, baseline)]
      })
      if (isEmpty(topics)) return
      try { await exploreBoard(topics) } catch (error) { setExplore(current => ({ ...current, error: error instanceof Error ? error.message : 'Explore board could not finish.' })) }
    },
    addSharedStep,
    dismissFinding(id, findingId) {
      const node = nodeAt(editor, id)?.props.node
      if (editor.getIsReadonly() || node?.type !== 'findings' || node.dismissed.includes(findingId) || node.dismissed.length >= 500) return
      editor.markHistoryStoppingPoint('dismiss finding')
      editor.run(() => {
        update(editor, id, current => current.type === 'findings' ? { ...current, dismissed: [...current.dismissed, findingId], revision: current.revision + 1 } : current)
        invalidate(id)
      })
    },
    applyBoardEdits(edits) {
      try { return applyBoardEdits(edits) } catch (error) { fail(error instanceof Error ? error.message : 'The board edit failed.'); return [] }
    },
    openChat(id, chatId) {
      const node = nodeAt(editor, id)?.props.node
      if (!node) return
      const available = conversationsFor(editor, id)
      const chat = chatId ? available.find(chat => chat.id === chatId) : available.filter(chat => chat.operation !== 'connect' && chat.sourceIds[0] === id).at(-1) ?? available.at(-1)
      if (chatId && !chat) return
      if (chat) activate(id, chat)
      else { const next = createChat(id, [id], sourceBranches(id), node.type === 'opportunity' ? 'research' : 'branch'); if (next) launch(run(id, next.id)) }
    },
    newChat(id) { createChat(id, [id], sourceBranches(id), nodeAt(editor, id)?.props.node.type === 'opportunity' ? 'research' : 'branch') },
    suggest(id, chatId) { if (!running.has(chatId) && isEmpty(chatAt(id, chatId)?.messages ?? [])) launch(run(id, chatId)) },
    closeChat() { uiState.update(editor, state => ({ ...state, activeChat: null })) },
    send(id, chatId, text, replyTo, stance) {
      const chat = chatAt(id, chatId)
      if (!text.trim() || !chat || uiState.get(editor).jobs[chatId]?.status === 'running') return
      const value = text.trim().slice(0, 2000)
      // Choosing one of the agent's offered options is an answer, even when the option ends with a question mark.
      const asked = chat.messages.find(item => item.id === replyTo)
      const chosen = asked?.role === 'assistant' && asked.proposal.kind === 'question' && asked.proposal.options.includes(value)
      const read = stance ?? classifyMessage(value)
      const message: ChatMessage = { id: crypto.randomUUID(), role: 'user', text: value, ...(replyTo ? { replyTo } : {}), stance: chosen && (read === 'question' || read === 'request') ? 'answer' : read }
      const messages = [...chat.messages, message]
      let index = 0
      const memory = applyDrafts(chatMemory(chat), interpretMessage(value, message.stance ?? 'answer', questionFor(messages, message)), [message.id], 'you', Date.now(), () => `${message.id}:${index++}`)
      editor.markHistoryStoppingPoint('chat message')
      editChat(id, chatId, current => ({ ...current, messages: [...current.messages, message] }))
      saveMemory(id, chatId, memory)
      launch(run(id, chatId))
      if (chat.operation !== 'connect') noteActivity(chat.branchIds)
    },
    decide(id, chatId, messageId, decision, note = '') {
      const chat = chatAt(id, chatId)
      const message = chat?.messages.find(item => item.id === messageId)
      if (!chat || message?.role !== 'assistant' || uiState.get(editor).jobs[chatId]?.status === 'running') return
      const proposal = message.proposal
      // A suggestion for the canvas is decided like a next step: changed with a comment or turned down with a reason.
      const suggested = suggestedTitle(message)
      if (proposal.kind === 'reply' && message.proposedEdits) {
        const reason = note.trim().slice(0, 600)
        const mark = (status?: 'declined' | 'refine') => editChat(id, chatId, current => ({ ...current, messages: current.messages.map(item => {
          if (item.id !== messageId || item.role !== 'assistant') return item
          const { decision: _removed, editsDeclined: _declined, ...rest } = item
          return status ? { ...rest, decision: { status, note: reason, at: Date.now() } } : rest
        }) }))
        const what = suggested ?? 'This suggestion'
        if (decision === 'reopen') { editor.markHistoryStoppingPoint('reconsider suggestion'); mark(); activity('you', `Reconsidering ${what}.`); return }
        if (decision === 'decline') {
          editor.markHistoryStoppingPoint('decline suggestion'); mark('declined')
          activity('you', `Turned down ${what}${reason ? `: ${reason}` : ''}. Agents will not suggest it again without saying what changed.`)
          notice('Noted. Agents won’t suggest this again.')
          return
        }
        if (decision === 'refine' && reason) {
          editor.markHistoryStoppingPoint('refine suggestion'); mark('refine')
          activity('you', `Asked to change ${what}: ${reason}`)
          api.send(id, chatId, reason, messageId, 'refine')
        }
        return
      }
      // A next step can be refined or turned down; adding it to the canvas is its acceptance.
      if (proposal.kind === 'action') {
        const reason = note.trim().slice(0, 600)
        const mark = (status?: 'declined' | 'refine') => editChat(id, chatId, current => ({ ...current, messages: current.messages.map(item => {
          if (item.id !== messageId || item.role !== 'assistant') return item
          if (!status) { const { decision: _removed, ...rest } = item; return rest }
          return { ...item, decision: { status, note: reason, at: Date.now() } }
        }) }))
        if (decision === 'reopen') { editor.markHistoryStoppingPoint('reconsider step'); mark(); activity('you', `Reconsidering “${proposal.title}”.`); return }
        if (decision === 'decline') {
          editor.markHistoryStoppingPoint('decline step'); mark('declined')
          activity('you', `Turned down “${proposal.title}”${reason ? `: ${reason}` : ''}. Agents will not suggest it again without saying what changed.`)
          notice('Noted. Agents won’t suggest this step again.')
          return
        }
        if (decision === 'refine' && reason) {
          editor.markHistoryStoppingPoint('refine step'); mark('refine')
          activity('you', `Asked to change “${proposal.title}”: ${reason}`)
          api.send(id, chatId, reason, messageId, 'refine')
        }
        return
      }
      if (proposal.kind !== 'opportunity') return
      const reason = note.trim().slice(0, 600)
      const setDecision = (status: 'accepted' | 'declined' | 'refine', extra: { outcomeId?: string } = {}) => editChat(id, chatId, current => ({ ...current, messages: current.messages.map(item => {
        if (item.role !== 'assistant') return item
        if (item.id === messageId) return { ...item, ...extra, decision: { status, note: reason, at: Date.now() } }
        // Accepting a revision supersedes the earlier accepted version; one card represents the direction.
        if (status === 'accepted' && decisionOf(item) === 'accepted' && item.proposal.kind === 'opportunity') return { ...item, decision: { status: 'superseded', note: '', at: Date.now() } }
        return item
      }) }))
      const linkedCard = (item: ChatMessage) => item.role === 'assistant' && item.outcomeId ? nodes(editor).find(shape => shape.id === item.outcomeId) : undefined
      if (decision === 'reopen') {
        editor.markHistoryStoppingPoint('reconsider proposal')
        editChat(id, chatId, current => ({ ...current, messages: current.messages.map(item => { if (item.id !== messageId || item.role !== 'assistant') return item; const { decision: _removed, ...rest } = item; return rest }) }))
        const card = linkedCard(message)
        if (card) update(editor, card.id, node => node.type === 'opportunity' ? { ...node, status: 'proposed' } : node)
        activity('you', `Reopened “${proposal.title}” for a decision.`)
        return
      }
      if (decision === 'decline') {
        editor.markHistoryStoppingPoint('decline proposal')
        setDecision('declined')
        const card = linkedCard(message)
        if (card) {
          update(editor, card.id, node => node.type === 'opportunity' ? { ...node, status: 'rejected' } : node)
          for (const [jobId, job] of running) if (job.sourceId === card.id) cancel(jobId)
        }
        activity('you', `Declined “${proposal.title}”${reason ? `: ${reason}` : ''}. Agents will not develop it or suggest it again without saying what changed.`)
        notice('Declined. Agents will remember your reason.')
        return
      }
      if (decision === 'refine') {
        if (!reason) return
        editor.markHistoryStoppingPoint('refine proposal')
        // An accepted direction stays accepted (and on the canvas) until a revision is accepted.
        if (decisionOf(message) !== 'accepted') setDecision('refine')
        activity('you', `Asked to refine “${proposal.title}”: ${reason}`)
        api.send(id, chatId, reason, messageId, 'refine')
        return
      }
      if (!revisionsMatch(message.dependsOn, revisions())) { notice('Your conditions or sources changed since this was proposed. Ask for an update before accepting it.'); return }
      const parents = chat.sourceIds.flatMap(sourceId => nodes(editor).filter(shape => shape.id === sourceId).map(shape => shape.id))
      if (parents.length !== chat.sourceIds.length) { notice('A source was removed. Start a new exploration from an existing node.'); return }
      const content = { title: proposal.title, description: proposal.description, benefitA: proposal.benefitA, benefitB: proposal.benefitB, ...(proposal.sources && isNotEmpty(proposal.sources) ? { sources: proposal.sources } : {}) }
      editor.markHistoryStoppingPoint('accept proposal')
      editor.run(() => {
        // Reuse this conversation's existing shared card so acceptance never duplicates it.
        const existing = chat.messages.map(linkedCard).find(card => card?.props.node.type === 'opportunity')
        let outcomeId: TLShapeId
        if (existing) {
          outcomeId = existing.id
          // A revised direction replaces the card's content, so work built on the earlier version needs review.
          if (existing.props.node.origin?.messageId !== messageId) invalidate(existing.id)
          update(editor, existing.id, node => node.type === 'opportunity' ? { ...node, ...content, status: 'accepted', stale: false, revision: node.revision + 1, dependsOn: message.dependsOn, origin: { nodeId: id, chatId, messageId } } : node)
        } else {
          const source = nodeAt(editor, id)
          if (!source) return
          outcomeId = addNode({ ...baseNode(`shared-${crypto.randomUUID()}`, 'connection'), dependsOn: message.dependsOn, origin: { nodeId: id, chatId, messageId }, type: 'opportunity', ...content, status: 'accepted', refinement: '', sourceBranchIds: chat.branchIds }, parents)
        }
        setDecision('accepted', { outcomeId })
        editor.select(outcomeId)
      })
      activity('you', `Accepted “${proposal.title}”. It is on the canvas with both sources.`)
      notice('Accepted and added to your canvas. Open the card to find a real first step.')
    },
    forgetMemory(id, chatId, entryId) {
      const chat = chatAt(id, chatId)
      if (!chat) return
      editor.markHistoryStoppingPoint('forget memory')
      saveMemory(id, chatId, withdrawEntry(chatMemory(chat), entryId))
      if (chat.operation !== 'connect') noteActivity(chat.branchIds)
    },
    confirmMemory(id, chatId, entryId) {
      const chat = chatAt(id, chatId)
      if (!chat) return
      let index = 0
      editor.markHistoryStoppingPoint('confirm memory')
      saveMemory(id, chatId, confirmAssumption(chatMemory(chat), entryId, Date.now(), () => `${entryId}:confirmed:${index++}`))
      if (chat.operation !== 'connect') noteActivity(chat.branchIds)
    },
    addProposedEdits(id, chatId, messageId) {
      const chat = chatAt(id, chatId)
      const message = chat?.messages.find(item => item.id === messageId)
      if (!chat || message?.role !== 'assistant' || !message.proposedEdits) return
      const edits = message.proposedEdits
      try {
        const created = applyBoardEdits(edits, { chat, focusId: id, messageId, dependencies: message.dependsOn, outputDependencies: message.dependsOn, availableIds: new Set(nodes(editor).map(shape => shape.id)), begin: () => {},
          finish: outcomeIds => editChat(id, chatId, thread => ({ ...thread, messages: thread.messages.map(item => {
            if (item.id !== messageId || item.role !== 'assistant') return item
            const { proposedEdits: _edits, editsDeclined: _declined, ...rest } = item
            return { ...rest, ...(isNotEmpty(outcomeIds) ? { outcomeIds } : {}) }
          }) })) })
        if (created[0]) { editor.select(...created); fitBoard(editor) }
      } catch (error) { notice(error instanceof Error ? error.message : 'The board changed since this was suggested. Ask again for an updated version.') }
    },
    publish(id, chatId, messageId) {
      const chat = chatAt(id, chatId)
      const message = chat?.messages.find(message => message.id === messageId)
      const source = nodeAt(editor, id)
      if (!chat || !source || !message || !canPublish(message) || message.role !== 'assistant') return
      if (message.proposal.kind === 'opportunity') { api.decide(id, chatId, messageId, 'accept'); return }
      if (!revisionsMatch(message.dependsOn, revisions())) { notice('Your sources or conditions changed. Continue the chat to update this outcome before adding it.'); return }
      const parents = chat.sourceIds.flatMap(id => nodes(editor).filter(shape => shape.id === id).map(shape => shape.id))
      if (parents.length !== chat.sourceIds.length) { notice('A source was removed. Start a new exploration from an existing node.'); return }
      // Cards the user added to this chat (“Bringing together”) are sources of the step too; cards this chat made are not.
      for (const card of nodes(editor)) if (conversationCards(chat).includes(card.id) && !parents.includes(card.id) && card.props.node.origin?.chatId !== chat.id) parents.push(card.id)
      const proposal = message.proposal
      const common = { ...baseNode(source.props.node.branchId, 'research'), dependsOn: message.dependsOn, origin: { nodeId: id, chatId, messageId } }
      editor.markHistoryStoppingPoint('add outcome to canvas')
      editor.run(() => {
        let outcomeId: TLShapeId
        if (proposal.kind === 'action') {
          const { kind: _kind, ...action } = proposal
          // A revision replaces the card of the step it revises, so the canvas keeps one card for it.
          const earlier = revisedCard(chat, message)
          if (earlier) {
            outcomeId = earlier.id
            invalidate(earlier.id)
            update(editor, earlier.id, node => node.type === 'action' ? { ...node, ...action, completed: false, doneSteps: [], stale: false, revision: node.revision + 1, dependsOn: message.dependsOn, origin: { nodeId: id, chatId, messageId } } : node)
            const linked = new Set(boardLinks(editor).filter(item => item.to === earlier.id).map(item => item.from))
            for (const parent of parents) if (!linked.has(parent)) link(editor, parent, earlier.id, 'input')
          } else outcomeId = addNode({ ...common, ...action, type: 'action', completed: false, reflection: '' }, parents)
        }
        else return
        editChat(id, chatId, current => ({ ...current, messages: current.messages.map(item => item.id === messageId ? { ...item, outcomeId } : item) }))
        editor.select(outcomeId)
        const bounds = [...parents, outcomeId].flatMap(id => { const bounds = editor.getShapePageBounds(id); return bounds ? [bounds] : [] })
        const minX = Math.min(...bounds.map(bounds => bounds.x)), minY = Math.min(...bounds.map(bounds => bounds.y))
        const maxX = Math.max(...bounds.map(bounds => bounds.maxX)), maxY = Math.max(...bounds.map(bounds => bounds.maxY))
        const screen = editor.getViewportScreenBounds()
        const width = screen.w > 850 ? screen.w - 440 : screen.w
        const zoom = Math.min(1, (width - 100) / (maxX - minX), (screen.h - 200) / (maxY - minY))
        editor.setCamera({ x: -(minX + maxX) / 2 + width / (2 * zoom), y: -(minY + maxY) / 2 + screen.h / (2 * zoom), z: zoom })
      })
      notice('Added to your canvas. Your conversation stays with its source.')
    },
    connect(ids) {
      let selected = (ids || editor.getSelectedShapeIds()).flatMap(id => { const shape = nodeAt(editor, id); return shape ? [shape] : [] })
      if (!ids && selected.length !== 2) selected = nodes(editor).filter(shape => shape.props.node.type === 'inspiration').slice(0, 2)
      const first = selected[0], second = selected[1]
      if (!first || !second || first.props.node.branchId === second.props.node.branchId) { notice('Select a node from each of two inspirations to find a shared direction.'); return }
      const branchIds = [first.props.node.branchId, second.props.node.branchId]
      if (branchIds.some(id => !records().some(record => record.id === id && record.node.type === 'inspiration'))) { notice('Choose two original inspiration branches.'); return }
      // One shared conversation per pair of goals, whether the board noticed the link or the user asked.
      const [branchA = '', branchB = ''] = branchIds
      const existing = pairChat(records(), branchA, branchB, chats())
      stopLinkJob(pairKey(branchA, branchB))
      // Connecting by hand supersedes a paused automatic check; the shared conversation shows its own state from here.
      if (lastScan(records(), branchA, branchB)?.status === 'error') editor.run(() => { const owner = cardId(pairOwner(branchA, branchB)); if (owner) update(editor, owner, node => node.type === 'inspiration' ? { ...node, links: (node.links ?? []).filter(scan => !(scan.status === 'error' && [branchA, branchB].includes(scan.otherId))) } : node) }, { history: 'ignore' })
      if (existing) {
        const owner = cardId(existing.nodeId)
        if (!owner) return
        activate(owner, existing.chat)
        if (!pairIsSettled(existing.chat) && !running.has(existing.chat.id)) launch(run(owner, existing.chat.id))
        return
      }
      const chat = createChat(first.id, [first.id, second.id], branchIds, 'connect')
      if (chat) launch(run(first.id, chat.id))
    },
    manualConnect(a, b) { api.connect([a, b]) },
    stopLink(key) { stopLinkJob(key); activity('coordinator', 'Stopped checking this link. It will be checked again after your next change.') },
    retryLink(a, b) { clearJob(linkJobKey(pairKey(a, b))); launch(scanPair(a, b, true)) },
    retry(id) {
      const again = retries.get(id)
      if (again) { again(); return }
      // After a reload the request is gone; retry the conversation from where it is saved.
      const chat = conversationAt(editor, id)
      const active = uiState.get(editor).activeChat
      const card = active?.chatId === id ? active.nodeId : conversationCardsForRetry(chat)
      if (card) launch(run(card, id))
    },
    stop(id) { cancel(id); activity('coordinator', 'Stopped. Your conversation is saved; continue whenever you like.') },
    updateGoal(id, goal) { if (goal.trim()) api.applyBoardEdits([{ kind: 'updateNode', nodeId: id, title: goal }]) },
    toggleStep(id, index) {
      update(editor, id, node => {
        if (node.type !== 'action') return node
        const done = new Set(node.doneSteps ?? [])
        if (done.has(index)) done.delete(index); else done.add(index)
        return { ...node, doneSteps: [...done].sort((a, b) => a - b) }
      })
    },
    requestRemove(ids) {
      if (isEmpty(ids)) return
      if (ids.some(id => nodeAt(editor, id))) uiState.update(editor, state => ({ ...state, removing: ids }))
      else { editor.markHistoryStoppingPoint('remove line'); editor.deleteShapes(ids) }
    },
    remove(ids, additionalIds = []) {
      uiState.update(editor, state => ({ ...state, removing: null }))
      const removed = [...new Set([...ids, ...additionalIds])].filter(id => editor.getShape(id))
      if (isEmpty(removed)) return
      const gone = new Set<string>(removed)
      for (const [jobId, job] of running) if (gone.has(job.sourceId)) cancel(jobId)
      for (const [key, job] of linkJobs) if (gone.has(job.a) || gone.has(job.b)) stopLinkJob(key)
      const open = uiState.get(editor).activeChat
      if (open && gone.has(open.nodeId)) api.closeChat()
      const lines = editor.getCurrentPageShapes().filter(shape => {
        if (!editor.isShapeOfType(shape, 'connection')) return false
        const { start, end } = getConnectionBindings(editor, shape)
        return (start && gone.has(start.toId)) || (end && gone.has(end.toId))
      })
      const lineIds = new Set<string>(lines.map(shape => shape.id))
      // Kept so the toast's Undo restores exactly this removal, even after other edits.
      const shapes = [...removed.flatMap(removedId => { const shape = editor.getShape(removedId); return shape ? [shape] : [] }), ...lines.filter(shape => !gone.has(shape.id))]
      const bindings = lines.flatMap(shape => editor.getBindingsFromShape(shape.id, 'connection'))
      const cards = removed.filter(removedId => nodeAt(editor, removedId))
      const photos = cards.filter(cardId => nodeAt(editor, cardId)?.props.node.type === 'inspiration')
      editor.markHistoryStoppingPoint('remove cards')
      editor.run(() => {
        for (const removedId of cards) invalidate(removedId)
        editor.deleteShapes([...removed, ...lines.map(shape => shape.id)])
      })
      const asked = ids.filter(askedId => cards.includes(askedId))
      const askedPhotos = photos.filter(photoId => asked.includes(photoId))
      const extra = cards.length - asked.length
      const what = asked.length > 1 ? `${asked.length} ${askedPhotos.length === asked.length ? 'photos' : 'cards'}` : isNotEmpty(askedPhotos) ? 'Photo' : 'Card'
      const label = extra > 0 ? `${what} and ${extra} ${extra === 1 ? 'card' : 'cards'} removed` : `${what} removed`
      showUndo(label, () => restore(shapes, bindings, lineIds))
    },
    async importFiles(files) {
      try {
        for (const file of files) {
          if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { fail('Choose a PNG, JPEG or WebP image.'); continue }
          const processed = await rasterize(file)
          const asset = await editor.getAssetForExternalContent({ type: 'file', file: processed })
          if (!asset || asset.type !== 'image') throw new Error('Could not import the image.')
          const id = createShapeId(); const roots = nodes(editor).filter(shape => shape.props.node.type === 'inspiration')
          editor.markHistoryStoppingPoint('add inspiration')
          editor.run(() => {
            editor.createAssets([asset])
            editor.createShape<NodeShape>({ id, type: 'node', x: 100 + roots.length * 560, y: 180, props: { node: { ...defaultInspiration(), branchId: id, assetId: asset.id, goal: file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ') || 'Something I want to explore' } } })
          })
          editor.select(id)
        }
        fitBoard(editor)
      } catch (error) { fail(error instanceof Error ? error.message : 'Could not import this image.') }
    },
    async samples() {
      try {
        const files: File[] = []
        for (const { path, name } of [{ path: 'creative.svg', name: 'Explore a creative practice' }, { path: 'connection.svg', name: 'Meet new people' }]) {
          const blob = await (await fetch(`${import.meta.env.BASE_URL}${path}`)).blob(); const file = await rasterize(new File([blob], name + '.svg', { type: 'image/svg+xml' })); files.push(new File([file], name + '.jpg', { type: 'image/jpeg' }))
        }
        await api.importFiles(files)
      } catch { fail('Could not load the sample inspirations. Try uploading your own images.') }
    },
  }
  const legacy = foldLegacyMessages(records())
  if (isNotEmpty(legacy.removed)) editor.run(() => {
    for (const record of legacy.updates) {
      const shape = nodes(editor).find(shape => shape.id === record.id)
      if (shape) update(editor, shape.id, () => record.node)
    }
    for (const shape of editor.getCurrentPageShapes()) {
      if (!editor.isShapeOfType(shape, 'connection')) continue
      const bindings = getConnectionBindings(editor, shape)
      if (!bindings.start || !bindings.end || !legacy.removed.includes(bindings.start.toId) || legacy.removed.includes(bindings.end.toId)) continue
      const old = nodeAt(editor, bindings.start.toId)
      const root = nodes(editor).find(shape => shape.id === old?.props.node.branchId)
      if (root) createOrUpdateConnectionBinding(editor, shape, root, bindings.start.props)
    }
    editor.deleteShapes(nodes(editor).filter(shape => legacy.removed.includes(shape.id)).map(shape => shape.id))
  })
  // Older workspaces embedded chats inside their owner card. Preserve their IDs and remove the embedded copies.
  editor.run(() => {
    for (const shape of nodes(editor)) {
      const { chats: embedded, ...node } = shape.props.node
      if (!embedded) continue
      for (const chat of embedded) if (!conversationAt(editor, chat.id)) putConversation(editor, { ...chat, cardIds: [...new Set([shape.id, ...conversationCards(chat), ...chat.sourceIds])] })
      update(editor, shape.id, () => node)
    }
  }, { history: 'ignore' })
  actions.set(editor, api)
  getAgentConfig().then(config => uiState.update(editor, state => ({ ...state, ...config }))).catch(() => fail('Local agents are unavailable. Your board is still saved; try reopening the app.'))
  const unlisten = editor.store.listen(() => {
    const current = revisions()
    for (const [id, job] of running) {
      if (!chatAt(job.sourceId, id) || chatAt(job.sourceId, id)?.messages.at(-1)?.id !== job.lastMessageId) cancel(id)
      else {
        const chat = conversationAt(editor, id)
        if (!chat || JSON.stringify(conversationCards(chat)) !== job.cardIds || !revisionsMatch(job.dependencies, current)) cancelOutdated(id)
      }
    }
    // A check whose goals or conditions changed is set aside and looked at again with the new state.
    for (const [key, job] of linkJobs) if (!revisionsMatch(job.dependencies, current)) { stopLinkJob(key); activity('coordinator', 'Conditions changed while the agents checked a link; checking again with the latest.'); noteActivity([job.a, job.b]) }
    const active = uiState.get(editor).activeChat
    if (active && !chatAt(active.nodeId, active.chatId)) api.closeChat()

  }, { scope: 'document' })
  // Switching boards or workspaces tears this down: nothing scheduled or running may write into the next board.
  return () => { disposed = true; exploreRun?.abort(); clearTimeout(linkTimer); linkQueue.length = 0; for (const [key] of linkJobs) stopLinkJob(key); for (const [id] of running) cancel(id); unlisten(); actions.delete(editor) }
}
