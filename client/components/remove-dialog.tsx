import { useEditor, useValue } from 'tldraw'
import { Trash2 } from 'lucide-react'
import { actions, uiState } from '../actions'
import { nodeAt, removalSetOf } from '../unfold'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'

/** One confirmation for every way of removing cards: the card's bin button, Delete/Backspace and the context menu. */
export function RemoveDialog() {
  const editor = useEditor()
  const ids = useValue('removal request', () => uiState.get(editor).removing, [editor])
  const close = () => uiState.update(editor, state => ({ ...state, removing: null }))
  const cards = (ids ?? []).flatMap(id => { const shape = nodeAt(editor, id); return shape ? [shape] : [] })
  const photos = cards.filter(shape => shape.props.node.type === 'inspiration').length
  const extra = ids ? removalSetOf(editor, ids).filter(id => nodeAt(editor, id)).length - cards.length : 0
  const title = cards.length > 1
    ? `Remove ${cards.length} ${photos === cards.length ? 'photos' : 'cards'} from your vision board?`
    : photos ? 'Remove this photo from your vision board?' : 'Remove this card?'
  const grown = extra > 0 ? `This also removes ${extra === 1 ? 'the card' : `${extra} cards`} that grew from ${cards.length > 1 ? 'them' : 'it'}, with their conversations. ` : `${cards.length > 1 ? 'Their' : 'Its'} conversations go too. `
  return <Dialog open={ids !== null} onOpenChange={open => { if (!open) close() }}>
    <DialogContent onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{grown}You can undo this right after.</DialogDescription></DialogHeader>
      <DialogFooter>
        <Button variant="outline" autoFocus onClick={close}>Keep it</Button>
        <Button variant="destructive" onClick={() => { if (ids) actions.get(editor)?.remove(ids) }}><Trash2/>Remove</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
