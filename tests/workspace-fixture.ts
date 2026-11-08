import { parseWorkspace, workspaceTLSchema } from '../shared/workspace-format'

export const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5ioAAAAASUVORK5CYII='

export function workspaceFixture() {
  const document = workspaceTLSchema.types.document.validate({ id: 'document:document', typeName: 'document', name: '', gridSize: 10, meta: {} })
  const page = workspaceTLSchema.types.page.create({ name: 'Page', index: 'a1' })
  const image = workspaceTLSchema.types.asset.create({ type: 'image', props: { name: 'Image', src: 'asset:pixel', w: 1, h: 1, fileSize: 68, mimeType: 'image/png', isAnimated: false } })
  const common = { branchId: 'shape:root', sequence: 1, revision: 0, stale: false, dependsOn: [], agent: 'you', createdAt: 1 }
  const shape = workspaceTLSchema.types.shape.validate({
    id: 'shape:root', typeName: 'shape', type: 'node', x: 100, y: 100, rotation: 0, index: 'a1', parentId: page.id, isLocked: false, opacity: 1, meta: {},
    props: { node: { ...common, type: 'inspiration', assetId: image.id, goal: 'Paint', started: true } },
  })
  const action = workspaceTLSchema.types.shape.validate({
    ...shape, id: 'shape:action', index: 'a2',
    props: { node: { ...common, type: 'action', title: 'Take a class', description: 'One small step', sources: [{ id: 'source-1', title: 'Official page', url: 'https://example.com/class' }], completed: true, reflection: 'I did it' } },
  })
  const snapshot = { schema: workspaceTLSchema.serialize(), store: Object.fromEntries([document, page, image, shape, action].map(record => [record.id, record])) }
  return parseWorkspace({
    formatVersion: 1, id: 'workspace-fixture', revision: 1,
    catalog: { boards: [{ id: 'board-a', name: 'First' }, { id: 'board-b', name: 'Second' }], activeId: 'board-a' },
    boards: { 'board-a': { document: snapshot }, 'board-b': { document: structuredClone(snapshot) } },
    assets: { [image.id]: { mime: 'image/png', data: pixel } },
    appearance: { palette: 'rose', pattern: 'dots', tone: 'cream' },
  })
}
