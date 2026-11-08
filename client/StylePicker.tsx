import { useEffect, useRef, useState } from 'react'
import { type Editor, useEditor } from 'tldraw'

// Viewer-level look of the board: main color, canvas pattern, canvas tone.
// Choices live on <html> as data attributes (styled in index.css) and in localStorage.
// The inline script in index.html applies the same keys before first paint — keep them in sync.

const PALETTES = [
  { id: 'lavender', label: 'Lavender', swatch: '#c6b1de', accent: '#9c80c0' },
  { id: 'rose', label: 'Rose', swatch: '#eca8bd', accent: '#de7499' },
  { id: 'sage', label: 'Sage', swatch: '#b6cca0', accent: '#809f67' },
] as const
const PATTERNS = [
  { id: 'dots', label: 'Dots' },
  { id: 'grid', label: 'Grid' },
  { id: 'lined', label: 'Lined' },
  { id: 'gingham', label: 'Gingham' },
  { id: 'plain', label: 'Plain' },
] as const
const TONES = [
  { id: 'cream', label: 'Cream', swatch: '#fcf6e9' },
  { id: 'white', label: 'White', swatch: '#fffefb' },
  { id: 'linen', label: 'Linen', swatch: '#f3eadb' },
  { id: 'tint', label: 'Tinted', swatch: 'color-mix(in srgb, var(--accent-100) 60%, #fffcf3)' },
] as const

type Option = { readonly id: string }
const SETTINGS = {
  palette: { key: 'unfold-palette', attribute: 'palette', options: PALETTES, fallback: 'rose' },
  pattern: { key: 'unfold-canvas-pattern', attribute: 'pattern', options: PATTERNS, fallback: 'dots' },
  tone: { key: 'unfold-canvas-tone', attribute: 'canvasTone', options: TONES, fallback: 'cream' },
} as const
type Setting = keyof typeof SETTINGS

function readStored(setting: Setting): string {
  const { key, options, fallback } = SETTINGS[setting]
  try { const value = localStorage.getItem(key); return options.some((option: Option) => option.id === value) && value ? value : fallback } catch { return fallback }
}

function usePersistedChoice(setting: Setting) {
  const [value, setValue] = useState(() => readStored(setting))
  useEffect(() => {
    const { key, attribute } = SETTINGS[setting]
    document.documentElement.dataset[attribute] = value
    try { localStorage.setItem(key, value) } catch { /* storage unavailable: the choice lasts for this visit */ }
  }, [setting, value])
  return [value, setValue] as const
}

function applySelectionColor(editor: Editor, paletteId: string) {
  const { accent } = PALETTES.find(palette => palette.id === paletteId) ?? PALETTES[1]
  // tldraw draws selection outlines on its own canvas from the JS theme, not from CSS.
  const theme = editor.getTheme('default')
  if (theme) editor.updateTheme({ ...theme, colors: { ...theme.colors, light: { ...theme.colors.light, selectionStroke: accent, selectionFill: `${accent}33` } } })
}

export function StylePicker() {
  const editor = useEditor()
  const [palette, setPalette] = usePersistedChoice('palette')
  const [pattern, setPattern] = usePersistedChoice('pattern')
  const [tone, setTone] = usePersistedChoice('tone')
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => { applySelectionColor(editor, palette) }, [editor, palette])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => { if (!(event.target instanceof Node) || !root.current?.contains(event.target)) setOpen(false) }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('pointerdown', onPointerDown, true); window.removeEventListener('keydown', onKeyDown) }
  }, [open])

  const current = PALETTES.find(item => item.id === palette) ?? PALETTES[1]
  return <div className="style-picker" ref={root}>
    <button className={`style-toggle ${open ? 'active' : ''}`} aria-label="Board style" aria-haspopup="true" aria-expanded={open} title="Colors and canvas" onClick={() => setOpen(value => !value)}>
      <i style={{ background: current.swatch }}/><span>Style</span>
    </button>
    {open && <div className="style-menu" role="dialog" aria-label="Board style">
      <p className="style-menu-title">Make it yours</p>
      <section role="radiogroup" aria-label="Main color">
        <h3>Main color</h3>
        <div className="style-options">{PALETTES.map(item => <button key={item.id} role="radio" aria-checked={item.id === palette} className={item.id === palette ? 'selected' : ''} onClick={() => setPalette(item.id)}>
          <i className="swatch" style={{ background: item.swatch }}/>{item.label}
        </button>)}</div>
      </section>
      <section role="radiogroup" aria-label="Canvas pattern">
        <h3>Canvas</h3>
        <div className="style-options patterns">{PATTERNS.map(item => <button key={item.id} role="radio" aria-checked={item.id === pattern} className={item.id === pattern ? 'selected' : ''} onClick={() => setPattern(item.id)}>
          <i className="pattern-tile" data-pattern={item.id}/>{item.label}
        </button>)}</div>
      </section>
      <section role="radiogroup" aria-label="Canvas color">
        <h3>Canvas color</h3>
        <div className="style-options tones">{TONES.map(item => <button key={item.id} role="radio" aria-checked={item.id === tone} className={item.id === tone ? 'selected' : ''} onClick={() => setTone(item.id)}>
          <i className="swatch" style={{ background: item.swatch }}/>{item.label}
        </button>)}</div>
      </section>
    </div>}
  </div>
}
