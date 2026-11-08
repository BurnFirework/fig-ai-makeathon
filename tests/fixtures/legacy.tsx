import { createRoot } from 'react-dom/client'
import { Tldraw, AssetRecordType, createShapeId, type Editor } from 'tldraw'
import { canvasOptions } from '../../client/canvas-options'
import { defaultInspiration } from '../../client/unfold'
import 'tldraw/tldraw.css'

const ids = ['unfold-board-v1', 'unfold-board-legacy-second']
localStorage.setItem('unfold-boards-v1', JSON.stringify({ boards: ids.map((id, index) => ({ id, name: `Legacy ${index + 1}` })), activeId: ids[0] }))
localStorage.setItem('unfold-palette', 'sage')
localStorage.setItem('unfold-canvas-pattern', 'grid')
localStorage.setItem('unfold-canvas-tone', 'linen')
let complete = 0
function finished() {
  complete++
  if (complete === ids.length) setTimeout(() => { document.body.dataset.seeded = 'true' }, 2000)
}
async function seed(editor: Editor, index: number) {
  if (editor.getCurrentPageShapes().length) { finished(); return }
  const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas unavailable')
  context.fillStyle = '#648960'; context.fillRect(0, 0, 2, 2)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG creation failed')), 'image/png'))
  const asset = new URL(location.href).searchParams.has('inline')
    ? AssetRecordType.create({ id: AssetRecordType.createId('legacy-pixel'), type: 'image', props: { name: `legacy-${index}.png`, src: canvas.toDataURL('image/png'), w: 2, h: 2, fileSize: blob.size, mimeType: 'image/png', isAnimated: false } })
    : await editor.getAssetForExternalContent({ type: 'file', file: new File([blob], `legacy-${index}.png`, { type: 'image/png' }) })
  if (!asset) throw new Error('Legacy asset creation failed')
  editor.createAssets([asset])
  const id = createShapeId()
  editor.createShape({ id, type: 'node', x: 100, y: 100, props: { node: { ...defaultInspiration(), branchId: id, assetId: asset.id, goal: `Legacy image ${index + 1}` } } })
  finished()
}
const root = document.getElementById('root')
if (!root) throw new Error('Missing root')
createRoot(root).render(<>{ids.map((id, index) => <div key={id} style={{ width: 600, height: 500, position: 'absolute', left: index * 600 }}><Tldraw {...canvasOptions} persistenceKey={id} onMount={editor => { seed(editor, index).catch((error: unknown) => { document.body.dataset.error = error instanceof Error ? `${error.message} ${error.stack ?? ''}` : String(error) }) }}/></div>)}</>)
