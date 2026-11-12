import { ChevronDown, LoaderCircle, Plus, Sparkles, X } from 'lucide-react'
import { useEditor, useValue, type TLShapeId } from 'tldraw'
import { actions, uiState, type ExploreRun } from '../actions'
import { cardRow, plural, type CardRow } from '../explore-summary'
import { Button } from './ui/button'
import { isEmpty, isNotEmpty } from '../../shared/arrays'

const STAGE_ORDER = { discovery: 0, verification: 1, shortlist: 2, synthesis: 3 } as const

/** What the run produced, in one line, with the one action that fits. */
function outcome(run: ExploreRun): { title: string; detail?: string; action?: 'show' | 'edit' | 'retry'; ids?: TLShapeId[] } {
  if (run.running) return { title: 'Exploring your cards…', detail: `${run.workers.filter(worker => worker.status === 'complete').length} of ${run.topics.length} cards complete · additions appear as they are ready` }
  if (run.stopped) return { title: 'Search stopped', action: 'edit' }
  if (run.added > 0) return { title: `${run.added} ${run.added === 1 ? 'option' : 'options'} added to your board`, action: 'show', ids: run.updatedIds }
  if (run.existing > 0) return { title: `${run.existing === 1 ? 'The option is' : 'These options are'} already on your board`, detail: 'Nothing new turned up this time.', action: 'show', ids: run.existingIds }
  if (run.error || isNotEmpty(run.failed)) return { title: 'Search couldn’t finish', ...(run.error ? { detail: run.error } : {}), action: 'retry' }
  return { title: 'No confirmed options found', action: 'edit' }
}

const settled = (row: CardRow) => row.state === 'found' || row.state === 'known'

export function ExploreActivity() {
  const editor = useEditor()
  const run = useValue('explore run', () => uiState.get(editor).explore, [editor])
  if (!run) return null
  const api = actions.get(editor)
  const result = outcome(run)
  const shared = run.shared
  const addedId = shared?.addedId
  const show = (ids: TLShapeId[]) => {
    const present = ids.filter(id => editor.getShape(id))
    if (isNotEmpty(present)) { editor.select(...present); editor.zoomToSelection({ animation: { duration: 220 } }) }
  }
  const titles = new Map(run.topics.map(topic => [topic.sourceId, topic.title]))
  const rows = run.topics.map(topic => cardRow(topic, run.reports?.find(report => report.sourceId === topic.sourceId), run.cards?.[topic.sourceId], run.running))
  // Open by default only when a card needs a decision; a fully successful run stays one quiet line.
  const needsYou = !run.running && rows.some(row => !settled(row))
  const done = rows.filter(row => row.state !== 'working').length
  const tally = run.running ? `${done} of ${rows.length} done` : needsYou ? `${plural(rows.filter(row => !settled(row)).length, 'card needs', 'cards need')} you` : `${plural(rows.length, 'card')} · all done`
  const log = [...run.workers].sort((a, b) => (a.sourceId ?? '~').localeCompare(b.sourceId ?? '~') || STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage])
  return <aside className="explore-work-panel" aria-label="Explore results" onPointerDown={event => editor.markEventAsHandled(event)} onKeyDown={event => event.stopPropagation()}>
    <header>
      <div>{run.running ? <LoaderCircle className="spin" size={17}/> : <Sparkles size={17}/>}<strong className="explore-result-title" role="status">{result.title}</strong></div>
      {run.running
        ? <Button variant="outline" size="sm" className="explore-stop" onClick={() => api?.stopExplore()}>Stop</Button>
        : <Button variant="ghost" size="icon-xs" aria-label="Close Explore results" onClick={() => uiState.update(editor, state => ({ ...state, explore: null }))}><X size={14}/></Button>}
    </header>
    {result.detail && <p className="explore-result-detail">{result.detail}</p>}
    <div className="explore-result-actions">
      {result.action === 'show' && result.ids && <Button size="sm" onClick={() => show(result.ids ?? [])}>Show on board</Button>}
      {result.action === 'edit' && <Button size="sm" onClick={() => uiState.update(editor, state => ({ ...state, exploreDialog: { reuse: true } }))}>Edit search</Button>}
      {!run.running && isNotEmpty(run.failed) && result.action !== 'retry' && <Button variant="outline" size="sm" onClick={() => { api?.retryExplore().catch(() => {}) }}>Retry unfinished</Button>}
      {result.action === 'retry' && <Button size="sm" onClick={() => { api?.retryExplore().catch(() => {}) }}>Retry</Button>}
    </div>
    {shared && !run.running && <section className="explore-shared" aria-label="Suggested shared step">
      <small>Shared step for {shared.plan.items.length} ideas</small>
      <strong>{shared.plan.title}</strong>
      <p>{shared.plan.summary}</p>
      {addedId && editor.getShape(addedId)
        ? <Button variant="ghost" size="sm" onClick={() => show([addedId])}>On your board · Show</Button>
        : <Button variant="outline" size="sm" onClick={() => api?.addSharedStep()}><Plus aria-hidden="true"/>Add to board</Button>}
    </section>}
    {isNotEmpty(rows) && <details className="explore-log explore-cards" open={needsYou || undefined} key={needsYou ? 'needs-you' : 'settled'}>
      <summary>By card<span className="explore-cards-tally">{tally}</span><ChevronDown size={14} aria-hidden="true"/></summary>
      <ol>
        {rows.map(row => <li key={row.sourceId} data-state={row.state}>
          <div className="explore-card-head">
            <span className="explore-card-dot" aria-hidden="true">{row.state === 'working' && <LoaderCircle className="spin" size={11}/>}</span>
            <button type="button" className="explore-card-title" title="Show on board" onClick={() => show(isNotEmpty(row.ids) ? row.ids : editor.getCurrentPageShapes().filter(shape => shape.id === row.sourceId).map(shape => shape.id))}>{row.title}</button>
          </div>
          <p className="explore-card-label">{row.label}</p>
          {row.why && (settled(row)
            ? <details className="explore-card-why"><summary>Agent’s note</summary><p>{row.why}</p></details>
            : <p className="explore-card-why">{row.why}</p>)}
          {!run.running && (row.state === 'failed' || row.state === 'unfinished') && <Button variant="outline" size="xs" aria-label={`Retry ${row.title}`} onClick={() => { api?.retryExplore([row.sourceId]).catch(() => {}) }}>Retry</Button>}
          {!run.running && row.state === 'attention' && <Button variant="outline" size="xs" aria-label={`Edit search for ${row.title}`} onClick={() => uiState.update(editor, state => ({ ...state, exploreDialog: { reuse: true, focus: row.sourceId } }))}>Edit search</Button>}
        </li>)}
      </ol>
    </details>}
    {!isEmpty(log) && <details className="explore-log">
      <summary>Agent activity<ChevronDown size={14} aria-hidden="true"/></summary>
      <ol>
        {log.map(worker => <li key={worker.id} data-status={worker.status}>
          <strong>{worker.label}{worker.sourceId && titles.get(worker.sourceId) ? <span> · {titles.get(worker.sourceId)}</span> : null}</strong>
          <p>{worker.status === 'queued' ? 'Waiting.' : worker.message}</p>{worker.connections?.map(connection => <a key={connection.toolkit} href={connection.url} target="_blank" rel="noopener noreferrer">Connect {connection.toolkit}</a>)}
        </li>)}
      </ol>
    </details>}
  </aside>
}
