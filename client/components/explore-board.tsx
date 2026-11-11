import { isEmpty, isNotEmpty } from '../../shared/arrays'
import { useRef, useState } from 'react'
import { ArrowRight, ChevronDown, Compass, LoaderCircle } from 'lucide-react'
import { useEditor } from 'tldraw'
import { actions, type ExploreCandidate, type ExploreOutcome } from '../actions'
import type { ExploreTopic } from '../../shared/explore'
import { Button } from './ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'

type Draft = ExploreCandidate & { checked: boolean }
const LIMIT = 4

export function ExploreBoard() {
  const editor = useEditor()
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Draft[]>([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [outcomes, setOutcomes] = useState<ExploreOutcome[]>([])
  const [error, setError] = useState('')
  const titleRef = useRef<HTMLHeadingElement>(null)
  const selected = rows.filter(row => row.checked)
  const failed = new Set(outcomes.filter(outcome => outcome.retry).map(outcome => outcome.sourceId))
  const finished = isNotEmpty(outcomes)
  const api = actions.get(editor)
  const openReview = () => {
    if (!running) {
      const candidates = actions.get(editor)?.exploreCandidates() ?? []
      setRows(candidates.map((candidate, index) => ({ ...candidate, checked: candidate.suggested && index < LIMIT })))
      setOutcomes([])
      setError('')
    }
  }
  const patch = (sourceId: string, map: (row: Draft) => Draft) => setRows(current => current.map(row => row.topic.sourceId === sourceId ? map(row) : row))
  const changeKind = (row: Draft, kind: ExploreTopic['kind']) => {
    const { sourceId, title, query, dependencies } = row.topic
    const now = new Date()
    const local = (days: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 12).toLocaleDateString('sv-SE')
    const topic: ExploreTopic = kind === 'jobs' ? { sourceId, title, query, dependencies, kind, remoteOnly: true }
      : { sourceId, title, query, dependencies, kind, cities: [], start: local(0), end: local(30) }
    patch(sourceId, current => ({ ...current, topic }))
  }
  const run = async (topics: ExploreTopic[]) => {
    const controller = actions.get(editor)
    if (!controller) return
    setRunning(true)
    setProgress('Preparing your searches…')
    setError('')
    setOutcomes([])
    try {
      setOutcomes(await controller.exploreBoard(topics, setProgress))
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Explore board could not finish.')
    } finally { setRunning(false) }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" className="explore-board-trigger"/>} onClick={openReview} disabled={editor.getIsReadonly()}>
        {running ? <LoaderCircle className="spin"/> : <Compass/>}<span>Explore board</span>
      </DialogTrigger>
      <DialogContent className="explore-board-dialog" initialFocus={titleRef} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
        <DialogHeader className="explore-header">
          <span className="explore-header-icon"><Compass size={21} aria-hidden="true"/></span>
          <div>
            <DialogTitle ref={titleRef} tabIndex={-1}>Explore board</DialogTitle>
            <DialogDescription>{finished ? 'Review what each search found.' : 'Choose up to four interests. Verified findings go on your board.'}</DialogDescription>
          </div>
        </DialogHeader>
        <form onSubmit={event => {
          event.preventDefault()
          if (!running && !finished && isNotEmpty(selected)) run(selected.map(row => row.topic)).catch(() => {})
        }}>
          <div className="explore-topic-list">
            {isEmpty(rows) && <div className="explore-empty">
              <h3>No interests to explore yet</h3>
              <p>Add an inspiration or note about an event or job you want to find.</p>
            </div>}
            {rows.map(row => {
              const { topic } = row
              const outcome = outcomes.find(item => item.sourceId === topic.sourceId)
              if (finished && !outcome) return null
              return <fieldset className="explore-topic" key={topic.sourceId} disabled={running} data-selected={row.checked || undefined}>
                <legend className="sr-only">{topic.title}</legend>
                {outcome ? <div className="explore-topic-result">
                  <h3>{topic.title}</h3>
                  <p className={outcome.retry ? 'explore-error' : 'explore-outcome'}>{outcome.message}</p>
                </div> : <>
                  <label className="explore-topic-heading">
                    <input type="checkbox" aria-label={topic.title} checked={row.checked} disabled={!row.checked && selected.length >= LIMIT} onChange={event => patch(topic.sourceId, current => ({ ...current, checked: event.target.checked }))}/>
                    <span><strong>{topic.title}</strong><small>{row.reason}</small></span>
                  </label>
                  {row.checked && <div className="explore-topic-scope">
                    <div className="explore-filters">
                      <label>Search type<span className="explore-select"><select value={topic.kind} onChange={event => changeKind(row, event.target.value === 'jobs' ? 'jobs' : 'events')}><option value="events">Events · Ticketmaster</option><option value="jobs">Jobs · JSearch</option></select><ChevronDown size={15} aria-hidden="true"/></span></label>
                      <label>Search terms<Textarea rows={1} required maxLength={240} value={topic.query} onChange={event => patch(topic.sourceId, current => ({ ...current, topic: { ...current.topic, query: event.target.value } }))}/></label>
                    </div>
                    {topic.kind === 'events' ? <div className="explore-filters explore-event-filters">
                      <label className="explore-cities">Cities<Input required maxLength={240} defaultValue={topic.cities.join(', ')} placeholder="San Francisco, Oakland" onChange={event => { const cities = event.target.value.split(',').map(city => city.trim()).filter(Boolean); patch(topic.sourceId, current => current.topic.kind === 'events' ? { ...current, topic: { ...current.topic, cities } } : current) }}/></label>
                      <label>Max price ($)<Input type="number" min="1" max="100000" step="0.01" placeholder="Any price" value={topic.maxPrice ?? ''} onChange={event => patch(topic.sourceId, current => current.topic.kind === 'events' ? { ...current, topic: { ...current.topic, maxPrice: event.target.value ? Number(event.target.value) : undefined } } : current)}/></label>
                      <label className="explore-date">From<Input type="date" required value={topic.start} onChange={event => patch(topic.sourceId, current => current.topic.kind === 'events' ? { ...current, topic: { ...current.topic, start: event.target.value } } : current)}/></label>
                      <label className="explore-date">Through<Input type="date" required value={topic.end} onChange={event => patch(topic.sourceId, current => current.topic.kind === 'events' ? { ...current, topic: { ...current.topic, end: event.target.value } } : current)}/></label>
                    </div> : <div className="explore-job-options">
                      <label className="explore-remote"><input type="checkbox" checked={topic.remoteOnly} onChange={event => patch(topic.sourceId, current => current.topic.kind === 'jobs' ? { ...current, topic: { ...current.topic, remoteOnly: event.target.checked } } : current)}/>US remote only</label>
                      <span>One page of results per job search</span>
                    </div>}
                    {isNotEmpty(row.conditions) && <p className="explore-hint"><strong>From your conversations</strong> {row.conditions.slice(0, 3).join(' · ')}</p>}
                  </div>}
                </>}
              </fieldset>
            })}
          </div>
          <div className="explore-footer">
            <div className="explore-status" role="status">
              {running && <><LoaderCircle size={16} className="spin" aria-hidden="true"/>{progress}</>}
              {error && <span className="explore-error">{error}</span>}
              {finished && <span>{outcomes.length === 1 ? '1 search finished' : `${outcomes.length} searches finished`}</span>}
              {!running && !error && !finished && isNotEmpty(rows) && <span><strong>{selected.length}</strong> {selected.length === 1 ? 'interest' : 'interests'} selected</span>}
            </div>
            <div className="explore-actions">
              {running ? <><Button type="button" variant="ghost" onClick={() => api?.stopExplore()}>Stop searches</Button><DialogClose render={<Button type="button"/>}>Watch on board</DialogClose></> : finished ? <>
                <DialogClose render={<Button type="button" variant={failed.size ? 'ghost' : 'default'}/>}>Back to board</DialogClose>
                {failed.size > 0 && <Button type="button" onClick={() => { run(rows.filter(row => failed.has(row.topic.sourceId)).map(row => row.topic)).catch(() => {}) }}>Retry failed</Button>}
              </> : <>
                <DialogClose render={<Button type="button" variant="ghost"/>}>{isEmpty(rows) ? 'Close' : 'Cancel'}</DialogClose>
                {isNotEmpty(rows) && <Button type="submit" disabled={isEmpty(selected)}>Start search<ArrowRight aria-hidden="true"/></Button>}
              </>}
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
