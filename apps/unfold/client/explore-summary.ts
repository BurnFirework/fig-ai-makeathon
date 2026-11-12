import { isNotEmpty } from '../shared/arrays'
import type { ExploreReport, InvestigationTopic } from '../shared/explore'
import type { TLShapeId } from 'tldraw'
import type { ExploreCardTally } from './actions'

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

export type CardState = 'working' | 'found' | 'known' | 'attention' | 'failed' | 'unfinished'
/** One card's result in the panel: a status the eye can scan, the counts behind it, the agent's explanation and the action that fits. */
export interface CardRow { sourceId: string; title: string; state: CardState; label: string; why?: string | undefined; ids: TLShapeId[] }

const REASONS = { incomplete: 'A required fact is still unknown.', rejected: 'The sources contradicted your conditions.', empty: 'No confirmed options turned up.' } as const

export function cardRow(topic: Pick<InvestigationTopic, 'sourceId' | 'title'>, report: ExploreReport | undefined, tally: ExploreCardTally | undefined, running: boolean): CardRow {
  const base = { sourceId: topic.sourceId, title: topic.title, ids: tally?.ids ?? [] }
  if (!report) return running ? { ...base, state: 'working', label: 'Working…' } : { ...base, state: 'unfinished', label: 'Not finished' }
  if (report.status === 'failed') return { ...base, state: 'failed', label: 'Couldn’t finish', why: report.message }
  const added = [tally?.options ? plural(tally.options, 'option') : '', tally?.ideas ? plural(tally.ideas, 'idea') : ''].filter(Boolean)
  if (isNotEmpty(added)) return { ...base, state: 'found', label: [`${added.join(' · ')} added`, tally?.existing ? `${tally.existing} already saved` : ''].filter(Boolean).join(' · '), why: report.note }
  if (tally?.existing) return { ...base, state: 'known', label: 'Already on your board', why: report.note }
  const outcome = report.outcome === 'incomplete' || report.outcome === 'rejected' ? report.outcome : 'empty'
  return { ...base, state: 'attention', label: outcome === 'incomplete' ? 'Not confirmed yet' : outcome === 'rejected' ? 'Didn’t match' : 'Nothing found', why: report.note ?? REASONS[outcome] }
}
