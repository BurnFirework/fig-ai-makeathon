import { useEffect, useState } from 'react'
import { useEditor, useValue } from 'tldraw'
import type { UnfoldNode } from '../../shared/schema'
import { nodes } from '../unfold'

export function ArtifactContent({ content }: { content: Extract<UnfoldNode, { type: 'artifact' }>['content'] }) {
  return <>
    <p className="description artifact-description">{content.description}</p>
    {content.kind === 'moodboard' && <div className="artifact-tiles" aria-label="Moodboard images">{content.items.map(item => <MoodboardImage key={item.nodeId} {...item}/>)}</div>}
  </>
}

function MoodboardImage({ nodeId, caption }: { nodeId: string; caption: string }) {
  const editor = useEditor()
  const source = useValue('moodboard image card', () => nodes(editor).find(shape => shape.id === nodeId)?.props.node, [editor, nodeId])
  const assetId = source?.type === 'inspiration' ? source.assetId : undefined
  const asset = useValue('moodboard image asset', () => editor.getAssets().find(item => item.id === assetId && item.type === 'image'), [editor, assetId])
  const [src, setSrc] = useState('')
  useEffect(() => {
    let current = true
    if (asset) editor.resolveAssetUrl(asset.id, { screenScale: 1 }).then(url => { if (current) setSrc(url ?? '') }).catch(() => { if (current) setSrc('') })
    return () => { current = false }
  }, [editor, asset])
  return <figure>{asset && src ? <img src={src} alt={source?.type === 'inspiration' ? source.goal : caption} draggable={false}/> : <div className="artifact-image-missing">{asset ? 'Loading image' : 'Source image removed'}</div>}<figcaption>{caption}</figcaption></figure>
}
