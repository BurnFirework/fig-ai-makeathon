import { Undo2 } from 'lucide-react'
import { toast } from 'sonner'

/** A small "Undo" pill in the bottom-right corner that fades away on its own if it is not used. */
export function showUndo(what: string, onUndo: () => void) {
  toast.custom(id => <button type="button" className="undo-toast" aria-label={`Undo: ${what}`} title={what} onClick={() => { toast.dismiss(id); onUndo() }}>
    <Undo2 size={15}/>Undo
  </button>, { duration: 6000 })
}
