import { createShapeId, Editor, type TLShapeId } from 'tldraw'
import { z } from 'zod'
import { type Chat, type ChatMessage, NodeSchema, type UnfoldNode, revisionsMatch } from '../shared/schema'
import { invalidatedBy } from '../shared/context'
import { canPublish, chatContext, foldLegacyMessages, lineage, nodeTitle } from '../shared/chats'
import { actions, uiState, type UnfoldActions } from './actions'
import { requestAgent } from './agentClient'
import { createOrUpdateConnectionBinding, getConnectionBindings } from './connection/ConnectionBindingUtil'
import { getNextConnectionIndex } from './connection/keepConnectionsAtBottom'
import type { NodeShape } from './nodes/NodeShapeUtil'
import { getNodeHeightPx } from './nodes/nodeTypes'

export function nodes(editor: Editor): NodeShape[] { return editor.getCurrentPageShapes().filter((shape): shape is NodeShape => editor.isShapeOfType(shape, 'node')) }
export function nodeAt(editor: Editor, id: TLShapeId) { const shape = editor.getShape(id); return shape && editor.isShapeOfType(shape, 'node') ? shape : undefined }
export function fitBoard(editor: Editor) {
  const bounds = editor.getCurrentPageBounds()
  if (!bounds) return
  const screen = editor.getViewportScreenBounds()
  const state = uiState.get(editor)
  const width = screen.w > 850 && state.activeChat && state.chatView === 'board' ? screen.w - 440 : screen.w
  const zoom = Math.min(1, (width - 120) / bounds.w, (screen.h - 200) / bounds.h)
  editor.setCamera({ x: -bounds.center.x + width / (2 * zoom), y: -bounds.center.y + screen.h / (2 * zoom), z: zoom })
}
export function baseNode(branchId: string, agent: UnfoldNode['agent'] = 'you') { return { branchId, sequence: Date.now(), revision: 0, stale: false, dependsOn: [], agent, createdAt: Date.now() } }
export function defaultInspiration(): Extract<UnfoldNode, { type: 'inspiration' }> { return { ...baseNode(''), type: 'inspiration', assetId: '', goal: 'Something I want to explore', started: false } }
function update(editor: Editor, id: TLShapeId, transform: (node: UnfoldNode) => UnfoldNode) {
  const shape = nodeAt(editor, id)
  if (shape) editor.updateShape<NodeShape>({ id, type: 'node', props: { node: NodeSchema.parse(transform(shape.props.node)) } })
}
function link(editor: Editor, from: TLShapeId, to: TLShapeId, input = 'input') {
  const id = createShapeId()
  editor.createShape({ id, type: 'connection', index: getNextConnectionIndex(editor) })
  createOrUpdateConnectionBinding(editor, id, from, { portId: 'output', terminal: 'start' })
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

export function setupUnfold(editor: Editor) {
  const running = new Map<string, { requestId: string; controller: AbortController; sourceId: TLShapeId; lastMessageId: string | undefined; dependencies: UnfoldNode['dependsOn'] }>()
  const retries = new Map<string, () => void>()
  const records = () => nodes(editor).map(shape => ({ id: shape.id, node: shape.props.node }))
  const notice = (message: string) => uiState.update(editor, state => ({ ...state, notice: message }))
  const activity = (role: string, message: string) => uiState.update(editor, state => ({ ...state, activity: [...state.activity.slice(-99), { id: crypto.randomUUID(), role, message, time: Date.now() }] }))
  const launch = (promise: Promise<void>) => { promise.catch((error: unknown) => notice(error instanceof Error ? error.message : 'The operation could not finish. Please retry.')) }
  const clearJob = (id: string) => uiState.update(editor, state => { const jobs = { ...state.jobs }; delete jobs[id]; return { ...state, jobs } })
  const cancel = (id: string) => { running.get(id)?.controller.abort(); running.delete(id); clearJob(id) }
  const chatAt = (id: TLShapeId, chatId: string) => nodeAt(editor, id)?.props.node.chats?.find(chat => chat.id === chatId)
  const editChat = (id: TLShapeId, chatId: string, transform: (chat: Chat) => Chat) => update(editor, id, node => ({ ...node, chats: node.chats?.map(chat => chat.id === chatId ? transform(chat) : chat) }))
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
  const createChat = (id: TLShapeId, sourceIds: TLShapeId[] = [id], branchIds = sourceBranches(id), operation: Chat['operation'] = 'branch') => {
    const node = nodeAt(editor, id)?.props.node
    if (!node || !branchIds.length) return
    const contextChats = operation === 'connect' ? sourceIds.flatMap(sourceId => {
      const previous = nodeAt(editor, sourceId)?.props.node.chats?.filter(chat => chat.operation !== 'connect').at(-1)
      const lastMessage = previous?.messages.at(-1)
      return previous ? [{ nodeId: sourceId, chatId: previous.id, ...(lastMessage ? { messageId: lastMessage.id } : {}) }] : []
    }) : []
    const chat: Chat = { id: crypto.randomUUID(), title: operation === 'connect' ? 'Find a shared direction' : `Exploration ${(node.chats?.length ?? 0) + 1}`, contextChats, sourceIds, branchIds, operation, messages: [], createdAt: Date.now() }
    editor.markHistoryStoppingPoint('start exploration')
    update(editor, id, node => ({ ...node, ...(node.type === 'inspiration' ? { started: true } : {}), chats: [...(node.chats ?? []), chat] }))
    activate(id, chat)
    return chat
  }
  const invalidate = (id: TLShapeId) => {
    const affected = invalidatedBy(records(), id)
    for (const shape of nodes(editor)) if (affected.has(shape.id)) update(editor, shape.id, node => ({ ...node, stale: true, revision: node.revision + 1 }))
    for (const [jobId, job] of running) if (job.dependencies.some(dependency => dependency.id === id || affected.has(dependency.id))) cancel(jobId)
  }
  const addNode = (node: UnfoldNode, parentIds: TLShapeId[]) => {
    const parents = parentIds.flatMap(id => { const shape = nodeAt(editor, id); return shape ? [shape] : [] })
    const x = parents.reduce((total, shape) => total + shape.x, 0) / parents.length
    let y = Math.max(...parents.map(shape => shape.y + getNodeHeightPx(editor, shape))) + 80
    for (let i = 0; i < 40; i++) {
      const collision = nodes(editor).find(shape => Math.abs(shape.x - x) < 355 && shape.y < y + 330 && shape.y + getNodeHeightPx(editor, shape) > y - 40)
      if (!collision) break
      y = collision.y + getNodeHeightPx(editor, collision) + 65
    }
    const id = createShapeId()
    editor.createShape<NodeShape>({ id, type: 'node', x, y, props: { node } })
    parentIds.forEach((parentId, index) => link(editor, parentId, id, parentIds.length === 2 && node.type === 'opportunity' ? `goal-${index}` : 'input'))
    return id
  }
  const run = async (sourceId: TLShapeId, chatId: string) => {
    const source = nodeAt(editor, sourceId)
    const chat = chatAt(sourceId, chatId)
    if (!source || !chat) return
    cancel(chatId)
    const controller = new AbortController(); const requestId = crypto.randomUUID()
    const all = records()
    const dependencyIds = new Set([...chat.branchIds, ...chat.sourceIds.flatMap(id => lineage(all, id).map(record => record.id))])
    const dependencies = all.filter(record => dependencyIds.has(record.id)).map(record => ({ id: record.id, revision: record.node.revision }))
    running.set(chatId, { requestId, controller, sourceId, lastMessageId: chat.messages.at(-1)?.id, dependencies })
    retries.set(chatId, () => launch(run(sourceId, chatId)))
    uiState.update(editor, state => ({ ...state, notice: '', jobs: { ...state.jobs, [chatId]: { status: 'running', message: chat.operation === 'connect' ? 'Finding a shared direction…' : chat.operation === 'research' ? 'Looking for a real first step…' : 'Following your inspiration…' } } }))
    try {
      const branches = chat.branchIds.map(branchId => chatContext(all, sourceId, chat, branchId))
      let image: string | undefined
      const root = all.find(record => record.id === chat.branchIds[0])?.node
      if (chat.operation === 'branch' && root?.type === 'inspiration' && uiState.get(editor).mode === 'live') {
        const asset = editor.getAssets().find(asset => asset.id === root.assetId)
        if (asset?.type === 'image' && asset.props.src) {
          const url = await editor.resolveAssetUrl(asset.id, { shouldResolveToOriginal: true })
          if (!url) throw new Error('The inspiration image is unavailable. Please reimport it.')
          if (url.startsWith('data:image/')) image = url
          else { const blob = await (await fetch(url, { signal: controller.signal })).blob(); image = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read the image.')); reader.onerror = () => reject(new Error('Could not read the image.')); reader.readAsDataURL(blob) }) }
        }
      }
      const selectedContext = source.props.node.type === 'inspiration' ? '' : `Build from this outcome: ${nodeTitle(source.props.node)}. ${source.props.node.type === 'action' || source.props.node.type === 'opportunity' ? source.props.node.description : ''}`
      const latest = chat.messages.filter(message => message.role === 'user').at(-1)
      const result = await requestAgent({ requestId, operation: chat.operation, branches, image, note: [selectedContext, latest?.role === 'user' ? latest.text : ''].filter(Boolean).join('\n').slice(0, 2000) }, controller.signal, event => {
        if (running.get(chatId)?.requestId === requestId) activity(event.role, event.message)
      })
      if (controller.signal.aborted || running.get(chatId)?.requestId !== requestId || !chatAt(sourceId, chatId) || !revisionsMatch(dependencies, new Map(records().map(record => [record.id, record.node.revision])))) return
      running.delete(chatId)
      editChat(sourceId, chatId, current => ({ ...current, messages: [...current.messages, { id: crypto.randomUUID(), role: 'assistant', proposal: result.proposal, dependsOn: dependencies }] }))
      if (result.mode !== uiState.get(editor).mode) uiState.update(editor, state => ({ ...state, mode: result.mode }))
      clearJob(chatId)
      activity('coordinator', 'Reply ready in your chat. Add an outcome to the canvas when it feels right.')
    } catch (error) {
      if (!controller.signal.aborted && running.get(chatId)?.requestId === requestId) uiState.update(editor, state => ({ ...state, jobs: { ...state.jobs, [chatId]: { status: 'error', message: error instanceof Error ? error.message : 'Something went wrong. Please retry.' } } }))
    } finally {
      if (running.get(chatId)?.requestId === requestId) { if (uiState.get(editor).jobs[chatId]?.status === 'running') clearJob(chatId); running.delete(chatId) }
    }
  }
  const api: UnfoldActions = {
    openChat(id, chatId) {
      const node = nodeAt(editor, id)?.props.node
      if (!node) return
      const chat = chatId ? node.chats?.find(chat => chat.id === chatId) : node.chats?.at(-1)
      if (chat) activate(id, chat)
      else { const next = createChat(id, [id], sourceBranches(id), node.type === 'opportunity' ? 'research' : 'branch'); if (next) launch(run(id, next.id)) }
    },
    newChat(id) { const chat = createChat(id, [id], sourceBranches(id), nodeAt(editor, id)?.props.node.type === 'opportunity' ? 'research' : 'branch'); if (chat) launch(run(id, chat.id)) },
    closeChat() { uiState.update(editor, state => ({ ...state, activeChat: null })) },
    send(id, chatId, text, replyTo) {
      const chat = chatAt(id, chatId)
      if (!text.trim() || !chat || uiState.get(editor).jobs[chatId]?.status === 'running') return
      const message: ChatMessage = { id: crypto.randomUUID(), role: 'user', text: text.trim().slice(0, 2000), ...(replyTo ? { replyTo } : {}) }
      editor.markHistoryStoppingPoint('chat message')
      editChat(id, chatId, current => ({ ...current, messages: [...current.messages, message] }))
      launch(run(id, chatId))
    },
    publish(id, chatId, messageId) {
      const chat = chatAt(id, chatId)
      const message = chat?.messages.find(message => message.id === messageId)
      const source = nodeAt(editor, id)
      if (!chat || !source || !message || !canPublish(message) || message.role !== 'assistant') return
      if (!revisionsMatch(message.dependsOn, new Map(records().map(record => [record.id, record.node.revision])))) { notice('Your sources changed. Continue the chat to update this outcome before adding it.'); return }
      const parents = chat.sourceIds.flatMap(id => nodes(editor).filter(shape => shape.id === id).map(shape => shape.id))
      if (parents.length !== chat.sourceIds.length) { notice('A source was removed. Start a new exploration from an existing node.'); return }
      const proposal = message.proposal
      const common = { ...baseNode(source.props.node.branchId, proposal.kind === 'opportunity' ? 'connection' : 'research'), dependsOn: message.dependsOn, origin: { nodeId: id, chatId, messageId } }
      editor.markHistoryStoppingPoint('add outcome to canvas')
      editor.run(() => {
        let outcomeId: TLShapeId
        if (proposal.kind === 'action') outcomeId = addNode({ ...common, type: 'action', title: proposal.title, description: proposal.description, sources: proposal.sources, completed: false, reflection: '' }, parents)
        else if (proposal.kind === 'opportunity') outcomeId = addNode({ ...common, branchId: `shared-${crypto.randomUUID()}`, type: 'opportunity', title: proposal.title, description: proposal.description, benefitA: proposal.benefitA, benefitB: proposal.benefitB, status: 'accepted', refinement: '', sourceBranchIds: chat.branchIds }, parents)
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
      const existing = first.props.node.chats?.find(chat => chat.operation === 'connect' && chat.sourceIds.includes(second.id) && chat.sourceIds.includes(first.id))
      if (existing) { activate(first.id, existing); return }
      const chat = createChat(first.id, [first.id, second.id], branchIds, 'connect')
      if (chat) launch(run(first.id, chat.id))
    },
    manualConnect(a, b) { api.connect([a, b]) },
    retry(id) { retries.get(id)?.() },
    stop(id) { cancel(id); activity('coordinator', 'Stopped. Your conversation is saved; continue whenever you like.') },
    updateGoal(id, goal) { if (!goal.trim()) return; editor.markHistoryStoppingPoint('edit goal'); invalidate(id); update(editor, id, node => node.type === 'inspiration' ? { ...node, goal: goal.trim(), revision: node.revision + 1 } : node); notice('Goal updated. Earlier outcomes may need a fresh look.') },
    complete(id, reflection) { update(editor, id, node => node.type === 'action' ? { ...node, completed: true, reflection, revision: node.revision + 1 } : node); activity('you', 'Recorded your first step and reflection.') },
    remove(id) { editor.markHistoryStoppingPoint('remove option'); invalidate(id); editor.deleteShapes([id]); notice('Removed. Use Undo to restore it.') },
    async importFiles(files) {
      try {
        for (const file of files) {
          if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { notice('Choose a PNG, JPEG or WebP image.'); continue }
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
        editor.zoomToFit({ animation: { duration: 200 } })
      } catch (error) { notice(error instanceof Error ? error.message : 'Could not import this image.') }
    },
    async samples() {
      try {
        const files: File[] = []
        for (const { path, name } of [{ path: '/creative.svg', name: 'Explore a creative practice' }, { path: '/connection.svg', name: 'Meet new people' }]) {
          const blob = await (await fetch(path)).blob(); const file = await rasterize(new File([blob], name + '.svg', { type: 'image/svg+xml' })); files.push(new File([file], name + '.jpg', { type: 'image/jpeg' }))
        }
        await api.importFiles(files)
      } catch { notice('Could not load the sample inspirations. Try uploading your own images.') }
    },
  }
  const legacy = foldLegacyMessages(records())
  if (legacy.removed.length) editor.run(() => {
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
  actions.set(editor, api)
  const Config = z.object({ mode: z.enum(['live', 'demo']), provider: z.string() })
  fetch('/api/config').then(response => { if (!response.ok) throw new Error(); return response.json() }).then(value => { const config = Config.parse(value); uiState.update(editor, state => ({ ...state, ...config })) }).catch(() => notice('The agent server is unavailable. Your board still works; restart pnpm dev to reconnect.'))
  const unlisten = editor.store.listen(() => {
    const current = new Map(records().map(record => [record.id, record.node.revision]))
    for (const [id, job] of running) if (!revisionsMatch(job.dependencies, current) || !chatAt(job.sourceId, id) || chatAt(job.sourceId, id)?.messages.at(-1)?.id !== job.lastMessageId) cancel(id)
    const active = uiState.get(editor).activeChat
    if (active && !chatAt(active.nodeId, active.chatId)) api.closeChat()

  }, { scope: 'document' })
  return () => { for (const [id] of running) cancel(id); unlisten(); actions.delete(editor) }
}
