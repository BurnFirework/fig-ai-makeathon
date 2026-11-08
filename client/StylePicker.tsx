import { useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useEditor } from 'tldraw'
import { WorkspaceContext, type WorkspaceController } from './workspace'
import type { Workspace } from '../shared/workspace-format'
import { Button } from './components/ui/button'

// The board's look: main color, canvas pattern and canvas tone. The choice is part of the workspace
// (`workspace.appearance`), so it is saved, exported and restored with the boards. It is applied as
// data attributes on <html> (styled in index.css) and mirrored to localStorage only so the pre-paint
// script (public/appearance.js) can paint the right colors before the workspace finishes loading.

type Appearance = Workspace['appearance']
const PALETTES = [
  { id: 'lavender', label: 'Lavender', swatch: '#c6b1de', accent: '#9c80c0' },
  { id: 'rose', label: 'Rose', swatch: '#eca8bd', accent: '#de7499' },
  { id: 'sage', label: 'Sage', swatch: '#b6cca0', accent: '#809f67' },
] as const satisfies readonly { id: Appearance['palette']; label: string; swatch: string; accent: string }[]
const PATTERNS = [
  { id: 'dots', label: 'Dots' },
  { id: 'grid', label: 'Grid' },
  { id: 'lined', label: 'Lined' },
  { id: 'gingham', label: 'Gingham' },
  { id: 'plain', label: 'Plain' },
] as const satisfies readonly { id: Appearance['pattern']; label: string }[]
const TONES = [
  { id: 'cream', label: 'Cream', swatch: '#fcf6e9' },
  { id: 'white', label: 'White', swatch: '#fffefb' },
  { id: 'linen', label: 'Linen', swatch: '#f3eadb' },
  { id: 'tint', label: 'Tinted', swatch: 'color-mix(in srgb, var(--accent-100) 60%, #fffcf3)' },
] as const satisfies readonly { id: Appearance['tone']; label: string; swatch: string }[]

function applyToDocument(appearance: Appearance) {
  const data = document.documentElement.dataset
  data.palette = appearance.palette
  data.pattern = appearance.pattern
  data.canvasTone = appearance.tone
  try {
    localStorage.setItem('unfold-palette', appearance.palette)
    localStorage.setItem('unfold-canvas-pattern', appearance.pattern)
    localStorage.setItem('unfold-canvas-tone', appearance.tone)
  } catch { /* Storage unavailable: only the pre-paint hint is lost. */ }
}

export function StylePicker() {
  const workspace = useContext(WorkspaceContext)
  if (!workspace) return null
  return <Picker workspace={workspace}/>
}

function Picker({ workspace }: { workspace: WorkspaceController }) {
  const editor = useEditor()
  const appearance = useSyncExternalStore(workspace.subscribe, () => workspace.getSnapshot().workspace.appearance)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => { applyToDocument(appearance) }, [appearance])
  useEffect(() => {
    const { accent } = PALETTES.find(palette => palette.id === appearance.palette) ?? PALETTES[1]
    // tldraw draws selection outlines on its own canvas from the JS theme, not from CSS.
    const theme = editor.getTheme('default')
    if (theme) editor.updateTheme({ ...theme, colors: { ...theme.colors, light: { ...theme.colors.light, selectionStroke: accent, selectionFill: `${accent}1f` } } })
  }, [editor, appearance.palette])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => { if (!(event.target instanceof Node) || !root.current?.contains(event.target)) setOpen(false) }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('pointerdown', onPointerDown, true); window.removeEventListener('keydown', onKeyDown) }
  }, [open])

  const set = (update: Partial<Appearance>) => { if (!workspace.updateAppearance({ ...appearance, ...update })) workspace.report(new Error('Wait for the workspace operation to finish, then try again.')) }
  const current = PALETTES.find(item => item.id === appearance.palette) ?? PALETTES[1]
  return <div className="style-picker" ref={root}>
    <Button variant="ghost" size="icon-sm" aria-label="Board style" aria-haspopup="true" aria-expanded={open} title="Colors and canvas" onClick={() => setOpen(value => !value)}>
      <i className="style-swatch" style={{ background: current.swatch }}/>
    </Button>
    {open && <div className="style-menu" role="dialog" aria-label="Board style">
      <p className="style-menu-title">Make it yours</p>
      <section role="radiogroup" aria-label="Main color">
        <h3>Main color</h3>
        <div className="style-options">{PALETTES.map(item => <button key={item.id} type="button" role="radio" aria-checked={item.id === appearance.palette} className={item.id === appearance.palette ? 'selected' : ''} onClick={() => set({ palette: item.id })}>
          <i className="swatch" style={{ background: item.swatch }}/>{item.label}
        </button>)}</div>
      </section>
      <section role="radiogroup" aria-label="Canvas pattern">
        <h3>Canvas</h3>
        <div className="style-options patterns">{PATTERNS.map(item => <button key={item.id} type="button" role="radio" aria-checked={item.id === appearance.pattern} className={item.id === appearance.pattern ? 'selected' : ''} onClick={() => set({ pattern: item.id })}>
          <i className="pattern-tile" data-pattern={item.id}/>{item.label}
        </button>)}</div>
      </section>
      <section role="radiogroup" aria-label="Canvas color">
        <h3>Canvas color</h3>
        <div className="style-options tones">{TONES.map(item => <button key={item.id} type="button" role="radio" aria-checked={item.id === appearance.tone} className={item.id === appearance.tone ? 'selected' : ''} onClick={() => set({ tone: item.id })}>
          <i className="swatch" style={{ background: item.swatch }}/>{item.label}
        </button>)}</div>
      </section>
    </div>}
  </div>
}
