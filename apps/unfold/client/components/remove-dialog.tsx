import { useEditor, useValue } from 'tldraw'
import { Trash2 } from 'lucide-react'
import { actions, uiState } from '../actions'
import { cardsLosingSources, nodeAt } from '../unfold'
import { isNotEmpty } from '../../shared/arrays'
import { nodeTitle } from '../../shared/chats'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'

/** One confirmation for every way of removing cards: the card's bin button, Delete/Backspace and the context menu. */
export function RemoveDialog() {
  const editor = useEditor()
  const ids = useValue('removal request', () => uiState.get(editor).removing, [editor])
  const close = () => uiState.update(editor, state => ({ ...state, removing: null }))
  const cards = useValue('cards to remove', () => (ids ?? []).flatMap(id => {
    const shape = nodeAt(editor, id)
    return shape ? [shape] : []
  }), [editor, ids])
  const affected = useValue('cards losing their sources', () => ids ? cardsLosingSources(editor, ids) : [], [editor, ids])
  const photos = cards.filter(shape => shape.props.node.type === 'inspiration').length
  const title = cards.length > 1
    ? `Remove ${cards.length} ${photos === cards.length ? 'photos' : 'cards'} from your vision board?`
    : photos ? 'Remove this photo from your vision board?' : 'Remove this card?'
  const hasAffected = isNotEmpty(affected)
  const linked = affected.length === 1 ? 'linked card' : 'linked cards'
  const remove = (includeAffected: boolean) => {
    if (ids) actions.get(editor)?.remove(ids, includeAffected ? affected.map(shape => shape.id) : [])
  }
  return <Dialog open={ids !== null} onOpenChange={open => { if (!open) close() }}>
    <DialogContent onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{hasAffected
          ? `This removes the last source for the ${linked} below. You can keep ${affected.length === 1 ? 'it' : 'them'} on your board or remove ${affected.length === 1 ? 'it' : 'them'} too.`
          : 'Shared conversations remain on any other cards they’re attached to. You can undo this right after.'}</DialogDescription>
      </DialogHeader>
      {hasAffected && <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-sm" aria-label="Cards that would lose their last source">
        {affected.map(shape => <li key={shape.id} className="break-words">{nodeTitle(shape.props.node)}</li>)}
      </ul>}
      <DialogFooter>
        <Button variant="outline" autoFocus onClick={close}>{hasAffected ? 'Cancel' : 'Keep it'}</Button>
        {hasAffected && <Button variant="outline" onClick={() => remove(false)}>Keep {linked}</Button>}
        <Button variant="destructive" onClick={() => remove(hasAffected)}><Trash2/>{hasAffected ? `Remove ${linked} too` : 'Remove'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
