import { isEmpty, isNotEmpty } from '../../shared/arrays'
import { useRef, useState } from 'react'
import { ArrowRight, Compass, LoaderCircle, Pencil, Plus } from 'lucide-react'
import { useEditor, useValue } from 'tldraw'
import { actions, uiState, type ExploreCandidate } from '../actions'
import { describeTopic, ExploreRequestSchema, type WebTopic } from '../../shared/explore'
import { Button } from './ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'

type Draft = ExploreCandidate & { checked: boolean; editing: boolean }
type ScopeChange = { query?: string; remoteOnly?: boolean; city?: string | undefined; schedule?: string | undefined; start?: string | undefined; end?: string | undefined; maxPrice?: number | undefined; region?: string | undefined }
/** Applies an edit to the search scope; a cleared field is removed rather than kept as an empty value. */
function applyScope(topic: WebTopic, change: ScopeChange): WebTopic {
  const next = { ...topic, ...change }
  const { city, schedule, start, end, maxPrice, region } = next
  const { city: _city, schedule: _schedule, start: _start, end: _end, maxPrice: _maxPrice, region: _region, ...rest } = topic
  return { ...rest, query: next.query, ...(next.remoteOnly !== undefined ? { remoteOnly: next.remoteOnly } : {}),
    ...(city ? { city } : {}), ...(schedule ? { schedule } : {}), ...(start ? { start } : {}), ...(end ? { end } : {}),
    ...(maxPrice !== undefined && Number.isFinite(maxPrice) ? { maxPrice } : {}), ...(region ? { region } : {}) }
}
const LIMIT = 4

/** Optional text field: empty clears the value instead of storing an empty string. */
const optional = (value: string) => value.trim() ? value.trim().slice(0, 160) : undefined

export function ExploreBoard() {
  const editor = useEditor()
  const dialog = useValue('explore dialog', () => uiState.get(editor).exploreDialog, [editor])
  const running = useValue('explore running', () => uiState.get(editor).explore?.running === true, [editor])
  const [rows, setRows] = useState<Draft[]>([])
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const titleRef = useRef<HTMLHeadingElement>(null)
  const selected = rows.filter(row => row.checked)
  const setOpen = (open: boolean) => uiState.update(editor, state => ({ ...state, exploreDialog: open ? state.exploreDialog ?? { reuse: false } : null }))
  const prepare = (reuse: boolean, failure = '') => {
    const candidates = actions.get(editor)?.exploreCandidates() ?? []
    const last = reuse ? uiState.get(editor).explore?.topics ?? [] : []
    const picked = candidates.filter(candidate => candidate.selected)
    // A selected card is the search; with no selection, ideas searched before are offered again.
    const defaults = isNotEmpty(last) ? new Set(last.map(topic => topic.sourceId))
      : new Set((isNotEmpty(picked) ? picked : candidates.filter(candidate => candidate.suggested)).slice(0, LIMIT).map(candidate => candidate.topic.sourceId))
    setRows(candidates.map(candidate => {
      const previous = last.find(topic => topic.sourceId === candidate.topic.sourceId)
      return { ...candidate, topic: previous ? { ...previous, dependencies: candidate.topic.dependencies } : candidate.topic, checked: defaults.has(candidate.topic.sourceId), editing: reuse && previous !== undefined }
    }))
    setAdding(defaults.size === 0)
    setError(failure)
  }
  const [prepared, setPrepared] = useState<typeof dialog>(null)
  if (dialog !== prepared) { setPrepared(dialog); if (dialog) prepare(dialog.reuse, dialog.error) }
  const patch = (sourceId: string, map: (row: Draft) => Draft) => setRows(current => current.map(row => row.topic.sourceId === sourceId ? map(row) : row))
  const scope = (sourceId: string, change: ScopeChange) => patch(sourceId, row => ({ ...row, topic: applyScope(row.topic, change) }))
  const shown = rows.filter(row => row.checked || adding)
  const hidden = rows.length - shown.length
  const find = () => {
    const controller = actions.get(editor)
    if (!controller || isEmpty(selected)) return
    const topics = selected.map(row => row.topic)
    const parsed = ExploreRequestSchema.safeParse({ operation: 'explore', requestId: 'check', topics })
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check the search details.'); return }
    controller.exploreBoard(topics).then(() => {}, (failure: unknown) => {
      uiState.update(editor, state => ({ ...state, exploreDialog: { reuse: false, error: failure instanceof Error ? failure.message : 'Explore board could not start.' } }))
    })
    setOpen(false)
  }
  return (
    <Dialog open={dialog !== null} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" className="explore-board-trigger"/>} onClick={() => uiState.update(editor, state => ({ ...state, exploreDialog: { reuse: false } }))} disabled={editor.getIsReadonly()}>
        {running ? <LoaderCircle className="spin"/> : <Compass/>}<span>Explore board</span>
      </DialogTrigger>
      <DialogContent className="explore-board-dialog" initialFocus={titleRef} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
        <DialogHeader className="explore-header">
          <span className="explore-header-icon"><Compass size={21} aria-hidden="true"/></span>
          <div>
            <DialogTitle ref={titleRef} tabIndex={-1}>Explore board</DialogTitle>
            <DialogDescription>Choose up to four ideas. Unfold searches the web, checks each option on its own page and adds confirmed ones next to your cards.</DialogDescription>
          </div>
        </DialogHeader>
        <form onSubmit={event => { event.preventDefault(); if (!running) find() }}>
          <div className="explore-topic-list">
            {isEmpty(rows) && <div className="explore-empty">
              <h3>No ideas to explore yet</h3>
              <p>Add an inspiration or a note about something you want to find.</p>
            </div>}
            {shown.map(row => <Topic key={row.topic.sourceId} row={row} disabled={running} full={!row.checked && selected.length >= LIMIT}
              onCheck={checked => patch(row.topic.sourceId, current => ({ ...current, checked, editing: checked && current.editing }))}
              onEdit={() => patch(row.topic.sourceId, current => ({ ...current, editing: !current.editing }))}
              onScope={change => scope(row.topic.sourceId, change)}/>)}
            {hidden > 0 && <Button type="button" variant="ghost" size="sm" className="explore-add" onClick={() => setAdding(true)}><Plus aria-hidden="true"/>Add interests<span>{hidden}</span></Button>}
          </div>
          <div className="explore-footer">
            <div className="explore-status" role="status">
              {error ? <span className="explore-error">{error}</span> : running ? <><LoaderCircle size={16} className="spin" aria-hidden="true"/>Finding options…</>
                : isNotEmpty(rows) && <span><strong>{selected.length}</strong> {selected.length === 1 ? 'idea' : 'ideas'} selected</span>}
            </div>
            <div className="explore-actions">
              {running ? <Button type="button" variant="ghost" onClick={() => actions.get(editor)?.stopExplore()}>Stop</Button> : <>
                <DialogClose render={<Button type="button" variant="ghost"/>}>{isEmpty(rows) ? 'Close' : 'Cancel'}</DialogClose>
                {isNotEmpty(rows) && <Button type="submit" disabled={isEmpty(selected)}>Find options<ArrowRight aria-hidden="true"/></Button>}
              </>}
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Topic({ row, disabled, full, onCheck, onEdit, onScope }: { row: Draft; disabled: boolean; full: boolean; onCheck: (checked: boolean) => void; onEdit: () => void; onScope: (change: ScopeChange) => void }) {
  const { topic } = row
  const job = topic.category === 'job'
  // The wish the user stated in the card's chat, which shaped what is searched.
  const wish = topic.context.find(entry => !/^[A-Za-z ]+:\s/.test(entry))
  return <fieldset className="explore-topic" disabled={disabled} data-selected={row.checked || undefined}>
    <legend className="sr-only">{topic.title}</legend>
    <div className="explore-topic-row">
      <label className="explore-topic-heading">
        <input type="checkbox" aria-label={topic.title} checked={row.checked} disabled={full} onChange={event => onCheck(event.target.checked)}/>
        <span><strong>{topic.title}</strong>{!row.checked && <small>{row.reason}</small>}</span>
      </label>
      {row.checked && <Button type="button" variant="ghost" size="sm" className="explore-edit" aria-expanded={row.editing} aria-label={`Edit search for ${topic.title}`} onClick={onEdit}><Pencil aria-hidden="true"/>{row.editing ? 'Done' : 'Edit'}</Button>}
    </div>
    {row.checked && <div className="explore-scope-summary">
      <p className="explore-scope-line">{describeTopic(topic)}</p>
      {wish && <p className="explore-intent">From your chat: “{wish}”</p>}
      {isNotEmpty(topic.preferences) && <p className="explore-preferences">{topic.preferences.slice(0, 2).join(' · ')}</p>}
    </div>}
    {row.checked && row.editing && <div className="explore-topic-scope">
      <label className="explore-field explore-field-wide">Search for<Textarea rows={1} required maxLength={240} value={topic.query} onChange={event => onScope({ query: event.target.value })}/></label>
      {job ? <div className="explore-filters">
        <label className="explore-remote"><input type="checkbox" checked={topic.remoteOnly === true} onChange={event => onScope({ remoteOnly: event.target.checked, ...(event.target.checked && !topic.region ? { region: 'United States' } : {}) })}/>Remote only</label>
        {topic.remoteOnly ? <label className="explore-field">Remote region<Input maxLength={160} placeholder="Any region" value={topic.region ?? ''} onChange={event => onScope({ region: optional(event.target.value) })}/></label>
          : <label className="explore-field">City<Input maxLength={160} placeholder="Anywhere" value={topic.city ?? ''} onChange={event => onScope({ city: optional(event.target.value) })}/></label>}
      </div> : <div className="explore-filters">
        <label className="explore-field">City<Input maxLength={160} placeholder="Anywhere" value={topic.city ?? ''} onChange={event => onScope({ city: optional(event.target.value) })}/></label>
        <label className="explore-field">When<Input maxLength={160} placeholder="Any day or time" value={topic.schedule ?? ''} onChange={event => onScope({ schedule: optional(event.target.value) })}/></label>
        <label className="explore-field explore-date">From<Input type="date" value={topic.start ?? ''} onChange={event => onScope({ start: event.target.value || undefined })}/></label>
        <label className="explore-field explore-date">Through<Input type="date" value={topic.end ?? ''} onChange={event => onScope({ end: event.target.value || undefined })}/></label>
        <label className="explore-field">Budget ($)<Input type="number" min="0" max="100000" step="1" placeholder="Not set" value={topic.maxPrice ?? ''} onChange={event => onScope({ maxPrice: event.target.value === '' ? undefined : Number(event.target.value) })}/></label>
      </div>}
      {isNotEmpty(topic.conditions) && <p className="explore-hint"><strong>From your conversations</strong> {topic.conditions.join(' · ')}</p>}
    </div>}
  </fieldset>
}
