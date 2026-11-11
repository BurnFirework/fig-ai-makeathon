import { Check, Circle, CircleAlert, LoaderCircle, Minus, Sparkles, X } from 'lucide-react'
import { useEditor, useValue } from 'tldraw'
import { actions, uiState } from '../actions'
import { Button } from './ui/button'
import { isNotEmpty } from '../../shared/arrays'

export function ExploreActivity() {
  const editor = useEditor()
  const explore = useValue('explore agents', () => uiState.get(editor).explore, [editor])
  if (!explore) return null
  const completed = explore.workers.filter(worker => worker.status === 'complete').length
  const working = explore.workers.filter(worker => worker.status === 'running').length
  return <aside className="explore-work-panel" aria-label="Explore agents" onPointerDown={event => editor.markEventAsHandled(event)} onKeyDown={event => event.stopPropagation()}>
    <header>
      <div><Sparkles size={17}/><strong>{explore.running ? 'Exploring your board' : 'Exploration finished'}</strong></div>
      {!explore.running && <Button variant="ghost" size="icon-xs" aria-label="Hide agent activity" onClick={() => uiState.update(editor, state => ({ ...state, explore: null }))}><X size={14}/></Button>}
    </header>
    <p className="explore-work-summary" role="status">{explore.running ? isNotEmpty(explore.workers) ? `${working} working · ${completed} of ${explore.workers.length} finished` : 'Preparing agents…' : `${completed} of ${explore.workers.length} agents finished · ${explore.updatedIds.length} cards updated`}</p>
    <ol>
      {explore.workers.map(worker => <li key={worker.id} data-status={worker.status}>
        <span className="explore-worker-icon" aria-label={worker.status}>
          {worker.status === 'running' ? <LoaderCircle className="spin"/> : worker.status === 'complete' ? <Check/> : worker.status === 'failed' ? <CircleAlert/> : worker.status === 'skipped' ? <Minus/> : <Circle/>}
        </span>
        <div><strong>{worker.label}</strong><p>{worker.message}</p></div>
      </li>)}
    </ol>
    <footer>{explore.running ? <Button variant="outline" size="sm" onClick={() => actions.get(editor)?.stopExplore()}>Stop searches</Button> : isNotEmpty(explore.updatedIds) && <Button size="sm" onClick={() => {
      const ids = explore.updatedIds.filter(id => editor.getShape(id))
      if (isNotEmpty(ids)) { editor.select(...ids); editor.zoomToSelection() }
    }}>Show updates</Button>}</footer>
  </aside>
}
