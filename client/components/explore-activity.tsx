import { ChevronDown, LoaderCircle, Plus, Sparkles, X } from 'lucide-react'
import { useEditor, useValue, type TLShapeId } from 'tldraw'
import { actions, uiState, type ExploreRun } from '../actions'
import { Button } from './ui/button'
import { isEmpty, isNotEmpty } from '../../shared/arrays'

const STAGE_ORDER = { discovery: 0, verification: 1, shortlist: 2, synthesis: 3 } as const

/** What the run produced, in one line, with the one action that fits. */
function outcome(run: ExploreRun): { title: string; detail?: string; action?: 'show' | 'edit' | 'retry'; ids?: TLShapeId[] } {
  if (run.running) return { title: 'Finding options…' }
  if (run.stopped) return { title: 'Search stopped', action: 'edit' }
  if (run.added > 0) return { title: `${run.added} ${run.added === 1 ? 'option' : 'options'} added to your board`, action: 'show', ids: run.updatedIds }
  if (run.existing > 0) return { title: `${run.existing === 1 ? 'The option is' : 'These options are'} already on your board`, detail: 'Nothing new turned up this time.', action: 'show', ids: run.existingIds }
  if (run.error || isNotEmpty(run.failed)) return { title: 'Search couldn’t finish', ...(run.error ? { detail: run.error } : {}), action: 'retry' }
  return { title: 'No confirmed options found', action: 'edit' }
}

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
  const log = [...run.workers].sort((a, b) => (a.sourceId ?? '~').localeCompare(b.sourceId ?? '~') || STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage])
  return <aside className="explore-work-panel" aria-label="Explore results" onPointerDown={event => editor.markEventAsHandled(event)} onKeyDown={event => event.stopPropagation()}>
    <header>
      <div>{run.running ? <LoaderCircle className="spin" size={17}/> : <Sparkles size={17}/>}<strong className="explore-result-title" role="status">{result.title}</strong></div>
      {!run.running && <Button variant="ghost" size="icon-xs" aria-label="Close Explore results" onClick={() => uiState.update(editor, state => ({ ...state, explore: null }))}><X size={14}/></Button>}
    </header>
    {result.detail && <p className="explore-result-detail">{result.detail}</p>}
    <div className="explore-result-actions">
      {run.running && <Button variant="outline" size="sm" onClick={() => api?.stopExplore()}>Stop</Button>}
      {result.action === 'show' && result.ids && <Button size="sm" onClick={() => show(result.ids ?? [])}>Show on board</Button>}
      {result.action === 'edit' && <Button size="sm" onClick={() => uiState.update(editor, state => ({ ...state, exploreDialog: { reuse: true } }))}>Edit search</Button>}
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
    {!isEmpty(log) && <details className="explore-log">
      <summary>Agent activity<ChevronDown size={14} aria-hidden="true"/></summary>
      <ol>
        {log.map(worker => <li key={worker.id} data-status={worker.status}>
          <strong>{worker.label}{worker.sourceId && titles.get(worker.sourceId) ? <span> · {titles.get(worker.sourceId)}</span> : null}</strong>
          <p>{worker.status === 'queued' ? 'Waiting.' : worker.message}</p>
        </li>)}
      </ol>
    </details>}
  </aside>
}
