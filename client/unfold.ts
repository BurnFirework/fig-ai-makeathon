import { createShapeId, Editor, type TLShapeId } from 'tldraw'
import { z } from 'zod'
import { type AgentRequest, NodeSchema, type Proposal, type UnfoldNode, revisionsMatch } from '../shared/schema'
import { branchContext, invalidatedBy } from '../shared/context'
import { actions, collapsedBranches, uiState, type UnfoldActions } from './actions'
import { requestAgent } from './agentClient'
import { createOrUpdateConnectionBinding } from './connection/ConnectionBindingUtil'
import { getNextConnectionIndex } from './connection/keepConnectionsAtBottom'
import type { NodeShape } from './nodes/NodeShapeUtil'
import { getNodeHeightPx } from './nodes/nodeTypes'

export function nodes(editor: Editor): NodeShape[] { return editor.getCurrentPageShapes().filter((shape): shape is NodeShape => editor.isShapeOfType(shape, 'node')) }
export function nodeAt(editor: Editor, id: TLShapeId) { const shape = editor.getShape(id); return shape && editor.isShapeOfType(shape, 'node') ? shape : undefined }
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
  const running = new Map<TLShapeId, { requestId: string; controller: AbortController; branches: string[] }>()
  const retries = new Map<TLShapeId, () => void>()
  const notice = (message: string) => uiState.update(editor, state => ({ ...state, notice: message }))
  const activity = (role: string, message: string) => uiState.update(editor, state => ({ ...state, activity: [...state.activity.slice(-99), { id: crypto.randomUUID(), role, message, time: Date.now() }] }))
  const launch = (promise: Promise<void>) => { promise.catch((error: unknown) => notice(error instanceof Error ? error.message : 'The operation could not finish. Please retry.')) }
  const clearJob = (id: TLShapeId) => uiState.update(editor, state => { const jobs = { ...state.jobs }; delete jobs[id]; return { ...state, jobs } })
  const cancel = (id: TLShapeId) => { running.get(id)?.controller.abort(); running.delete(id); clearJob(id) }
  const invalidate = (id: TLShapeId) => {
    const affected = invalidatedBy(nodes(editor).map(shape => ({ id: shape.id, node: shape.props.node })), id)
    for (const shape of nodes(editor)) if (affected.has(shape.id)) update(editor, shape.id, node => ({ ...node, stale: true, revision: node.revision + 1 }))
    for (const [jobId] of running) cancel(jobId)
  }
  const addNode = (node: UnfoldNode, parentIds: TLShapeId[], position?: { x: number; y: number }) => {
    const parent = parentIds[0] ? nodeAt(editor, parentIds[0]) : undefined
    const x = position?.x ?? parent?.x ?? 160
    let y = position?.y ?? (parent ? parent.y + getNodeHeightPx(editor, parent) + 65 : 200)
    for (let i = 0; i < 40; i++) {
      const collision = nodes(editor).find(shape => Math.abs(shape.x - x) < 355 && shape.y < y + 250 && shape.y + getNodeHeightPx(editor, shape) > y - 40)
      if (!collision) break
      y = collision.y + getNodeHeightPx(editor, collision) + 65
    }
    const id = createShapeId()
    editor.createShape<NodeShape>({ id, type: 'node', x, y, props: { node } })
    parentIds.forEach((parentId, index) => link(editor, parentId, id, parentIds.length === 2 ? `goal-${index}` : 'input'))
    return id
  }
  const applyProposal = (proposal: Proposal, sourceId: TLShapeId, branchIds: string[], dependencies: UnfoldNode['dependsOn']) => {
    const source = nodeAt(editor, sourceId)
    if (!source) return
    const common = { ...baseNode(source.props.node.branchId, proposal.kind === 'opportunity' ? 'connection' : 'branch'), dependsOn: dependencies }
    let id: TLShapeId | undefined
    editor.markHistoryStoppingPoint('agent step')
    editor.run(() => {
      if (proposal.kind === 'question') id = addNode({ ...common, type: 'question', prompt: proposal.prompt, options: proposal.options, purpose: proposal.purpose }, [sourceId])
      if (proposal.kind === 'action') id = addNode({ ...common, type: 'action', title: proposal.title, description: proposal.description, sources: proposal.sources, completed: false, reflection: '' }, [sourceId])
      if (proposal.kind === 'opportunity') {
        const roots = branchIds.flatMap(branch => nodes(editor).filter(shape => shape.props.node.branchId === branch && !shape.props.node.stale).sort((a,b) => b.props.node.sequence - a.props.node.sequence).slice(0, 1))
        if (roots.length !== 2 || !roots[0] || !roots[1]) return
        const a = roots[0], b = roots[1]
        id = addNode({ ...common, branchId: `shared-${crypto.randomUUID()}`, type: 'opportunity', title: proposal.title, description: proposal.description, benefitA: proposal.benefitA, benefitB: proposal.benefitB, status: 'proposed', refinement: '', sourceBranchIds: branchIds }, [a.id, b.id], { x: (a.x + b.x) / 2, y: Math.max(a.y + getNodeHeightPx(editor, a), b.y + getNodeHeightPx(editor, b)) + 90 })
      }
    })
    if (id) { editor.select(id); editor.zoomToSelection({ animation: { duration: 250 } }) }
  }
  const run = async (sourceId: TLShapeId, operation: AgentRequest['operation'], note = '', explicitBranches?: string[]) => {
    const source = nodeAt(editor, sourceId)
    if (!source) return
    const sourceNode = source.props.node
    const sharedSource = nodes(editor).find(shape => shape.props.node.type === 'opportunity' && shape.props.node.branchId === sourceNode.branchId)?.props.node
    const branchIds = explicitBranches || (sourceNode.type === 'opportunity' ? sourceNode.sourceBranchIds : sharedSource?.type === 'opportunity' ? sharedSource.sourceBranchIds : [sourceNode.branchId])
    for (const [id, job] of running) if (job.branches.some(branch => branchIds.includes(branch))) cancel(id)
    const controller = new AbortController(); const requestId = crypto.randomUUID()
    running.set(sourceId, { requestId, controller, branches: branchIds })
    retries.set(sourceId, () => launch(run(sourceId, operation, note, explicitBranches)))
    uiState.update(editor, state => ({ ...state, notice: '', jobs: { ...state.jobs, [sourceId]: { status: 'running', message: operation === 'connect' ? 'Finding the thread between your goals…' : operation === 'research' ? 'Looking for a real first step…' : 'Following your inspiration…' } } }))
    try {
      const records = nodes(editor).map(shape => ({ id: shape.id, node: shape.props.node }))
      const dependencies = records.filter(record => branchIds.includes(record.node.branchId) && !record.node.stale).map(record => ({ id: record.id, revision: record.node.revision }))
      if (!dependencies.some(dependency => dependency.id === sourceId)) dependencies.push({ id: sourceId, revision: sourceNode.revision })
      const branches = branchIds.map(id => branchContext(records, id))
      let image: string | undefined
      const root = nodes(editor).find(shape => shape.id === branchIds[0])?.props.node
      if (operation === 'branch' && root?.type === 'inspiration' && uiState.get(editor).mode === 'live') {
        const asset = editor.getAssets().find(asset => asset.id === root.assetId)
        if (asset?.type === 'image' && asset.props.src) {
          const url = await editor.resolveAssetUrl(asset.id, { shouldResolveToOriginal: true })
          if (!url) throw new Error('The inspiration image is unavailable. Please reimport it.')
          if (url.startsWith('data:image/')) image = url
          else { const blob = await (await fetch(url, { signal: controller.signal })).blob(); image = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read the image.')); reader.onerror = () => reject(new Error('Could not read the image.')); reader.readAsDataURL(blob) }) }
        }
      }
      const selectedContext = sourceNode.type === 'opportunity' ? `Selected shared direction: ${sourceNode.title}. ${sourceNode.description}. Benefits: ${sourceNode.benefitA}; ${sourceNode.benefitB}. Status: ${sourceNode.status}.`
        : sourceNode.type === 'action' ? `Previous step: ${sourceNode.title}. User's reflection: ${sourceNode.reflection || 'not yet provided'}.` : ''
      const result = await requestAgent({ requestId, operation, branches, image, note: [note, selectedContext].filter(Boolean).join('\n').slice(0, 2000) }, controller.signal, event => activity(event.role, event.message))
      const current = new Map(nodes(editor).map(shape => [shape.id, shape.props.node.revision]))
      if (controller.signal.aborted || running.get(sourceId)?.requestId !== requestId || !revisionsMatch(dependencies, current)) return
      if (result.mode !== uiState.get(editor).mode) uiState.update(editor, state => ({ ...state, mode: result.mode }))
      applyProposal(result.proposal, sourceId, branchIds, dependencies)
      clearJob(sourceId)
      activity('coordinator', 'Your next step is ready. You decide where this goes.')
      if (operation === 'branch' && !nodes(editor).some(shape => shape.props.node.type === 'opportunity')) {
        const roots = nodes(editor).filter(shape => shape.props.node.type === 'inspiration' && shape.props.node.started && branchContext(nodes(editor).map(s => ({ id: s.id, node: s.props.node })), shape.id).answers.length > 0).slice(0, 2)
        if (roots.length === 2) queueMicrotask(() => api.connect(roots.map(root => root.id)))
      }
    } catch (error) {
      if (!controller.signal.aborted && running.get(sourceId)?.requestId === requestId) uiState.update(editor, state => ({ ...state, jobs: { ...state.jobs, [sourceId]: { status: 'error', message: error instanceof Error ? error.message : 'Something went wrong. Please retry.' } } }))
    } finally { if (running.get(sourceId)?.requestId === requestId) { if (uiState.get(editor).jobs[sourceId]?.status === 'running') clearJob(sourceId); running.delete(sourceId) } }
  }
  const api: UnfoldActions = {
    start(id) {
      const shape = nodeAt(editor, id)
      if (!shape) return
      if (shape.props.node.type === 'inspiration') update(editor, id, node => node.type === 'inspiration' ? { ...node, started: true } : node)
      launch(run(id, 'branch'))
    },
    answer(id, choice, comment) {
      const shape = nodeAt(editor, id)
      if (!shape || shape.props.node.type !== 'question') return
      const existing = nodes(editor).find(item => item.props.node.type === 'answer' && item.props.node.questionId === id)
      const text = [choice, comment.trim()].filter(Boolean).join(' — ')
      if (!text) { notice('Choose an answer or add a short comment.'); return }
      if (existing) { api.updateAnswer(existing.id, text); launch(run(existing.id, 'branch')); return }
      editor.markHistoryStoppingPoint('answer question')
      let answerId: TLShapeId | undefined
      editor.run(() => { answerId = addNode({ ...baseNode(shape.props.node.branchId), type: 'answer', text, questionId: id, dependsOn: [{ id, revision: shape.props.node.revision }] }, [id]) })
      if (answerId) launch(run(answerId, 'branch'))
    },
    connect(ids) {
      let selected = (ids || editor.getSelectedShapeIds()).flatMap(id => { const shape = nodeAt(editor, id); return shape ? [shape] : [] })
      if (!ids && selected.length !== 2) selected = nodes(editor).filter(shape => shape.props.node.type === 'inspiration' && shape.props.node.started).slice(0, 2)
      const first = selected[0], second = selected[1]
      if (!first || !second || first.props.node.branchId === second.props.node.branchId) { notice('Start two inspirations, or select a node in each branch to connect them.'); return }
      const idsToConnect = [first.props.node.branchId, second.props.node.branchId]
      if (idsToConnect.some(id => !nodes(editor).some(shape => shape.id === id && shape.props.node.type === 'inspiration'))) { notice('Choose two original inspiration branches.'); return }
      launch(run(first.id, 'connect', '', idsToConnect))
    },
    manualConnect(a, b) { api.connect([a, b]) },
    research(id, note) { const shape = nodeAt(editor, id); if (!shape || (shape.props.node.type === 'opportunity' && shape.props.node.status !== 'accepted')) return; launch(run(id, 'research', note)) },
    retry(id) { retries.get(id)?.() },
    stop(id) { cancel(id); activity('coordinator', 'Stopped. Your saved decisions are unchanged.') },
    decide(id, accepted) {
      editor.markHistoryStoppingPoint('decide opportunity')
      update(editor, id, node => node.type === 'opportunity' ? { ...node, status: accepted ? 'accepted' : 'rejected', revision: node.revision + 1 } : node)
      activity('you', accepted ? 'Accepted the shared direction.' : 'Set this connection aside.')
      if (accepted) api.research(id, 'Find one real opportunity for the accepted shared direction. Include a small first step and cite evidence.')
      else cancel(id)
    },
    refine(id, note) { if (note.trim()) launch(run(id, 'connect', note)) },
    updateGoal(id, goal) { if (!goal.trim()) return; editor.markHistoryStoppingPoint('edit goal'); invalidate(id); update(editor, id, node => node.type === 'inspiration' ? { ...node, goal: goal.trim(), revision: node.revision + 1 } : node); notice('Goal updated. Earlier suggestions are marked for review.') },
    updateAnswer(id, text) { editor.markHistoryStoppingPoint('edit answer'); invalidate(id); update(editor, id, node => node.type === 'answer' ? { ...node, text, revision: node.revision + 1 } : node) },
    complete(id, reflection) { update(editor, id, node => node.type === 'action' ? { ...node, completed: true, reflection, revision: node.revision + 1 } : node); activity('you', 'Recorded your first step and reflection.') },
    remove(id) { editor.markHistoryStoppingPoint('remove option'); invalidate(id); editor.deleteShapes([id]); notice('Removed. Dependent suggestions are marked for review.') },
    collapse(branchId) { collapsedBranches.update(editor, branches => branches.includes(branchId) ? branches.filter(id => id !== branchId) : [...branches, branchId]) },
    moveBranch(branchId) { editor.select(...nodes(editor).filter(shape => shape.props.node.branchId === branchId).map(shape => shape.id)); notice('Branch selected. Drag a card to move the branch together.') },
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
  actions.set(editor, api)
  const Config = z.object({ mode: z.enum(['live', 'demo']), provider: z.string() })
  fetch('/api/config').then(response => { if (!response.ok) throw new Error(); return response.json() }).then(value => { const config = Config.parse(value); uiState.update(editor, state => ({ ...state, ...config })) }).catch(() => notice('The agent server is unavailable. Your board still works; restart pnpm dev to reconnect.'))
  const unlisten = editor.store.listen(() => {
    for (const [id] of running) if (!nodeAt(editor, id)) cancel(id)
  }, { scope: 'document' })
  return () => { for (const [id] of running) cancel(id); unlisten(); actions.delete(editor) }
}
