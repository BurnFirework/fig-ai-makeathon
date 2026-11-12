import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Editor } from 'tldraw'

/** Elements inside a card that act on a press of their own; everything else on the card moves it. */
const CONTROLS = 'button, a[href], select, summary, label, [role="button"], [role="checkbox"], [role="menuitem"], [role="tab"], [data-card-control]'
const FIELDS = 'input, textarea, [contenteditable="true"], [contenteditable=""]'
/** How far the pointer may travel before a press on a title counts as a drag rather than a click. */
const CLICK_SLOP_PX = 4

function focusField(field: HTMLElement) {
  field.focus({ preventScroll: true })
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.setSelectionRange(field.value.length, field.value.length)
}

/**
 * A card can be grabbed anywhere. Buttons, links and checkboxes keep their own press. An unfocused title field
 * moves the card when dragged and starts editing when clicked; once it is being edited, it behaves as a text field.
 */
export function cardPointerDown(editor: Editor) {
  return (event: ReactPointerEvent) => {
    const target = event.target instanceof Element ? event.target : null
    if (!target) return
    if (target.closest(CONTROLS)) { editor.markEventAsHandled(event); return }
    const field = target.closest<HTMLElement>(FIELDS)
    if (!field) return
    if (field === document.activeElement || event.button !== 0 || editor.getIsReadonly()) { editor.markEventAsHandled(event); return }
    // Keep the browser from focusing the field on press, so the canvas can drag the card; a click focuses it after.
    event.preventDefault()
    const { clientX: x, clientY: y } = event
    window.addEventListener('pointerup', end => {
      if (Math.hypot(end.clientX - x, end.clientY - y) < CLICK_SLOP_PX) setTimeout(() => focusField(field), 0)
    }, { once: true, capture: true })
  }
}
