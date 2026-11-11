import { z } from 'zod'

const label = z.string().trim().min(1).max(240)
const dependency = z.object({ id: z.string(), revision: z.number().int().nonnegative() })
const target = { sourceId: label, title: label, query: label, dependencies: z.array(dependency).min(1).max(120) }
export const ExploreTopicSchema = z.discriminatedUnion('kind', [
  z.object({ ...target, kind: z.literal('events'), cities: z.array(label).min(1).max(2), start: z.iso.date(), end: z.iso.date(), maxPrice: z.number().positive().max(100000).optional() }),
  z.object({ ...target, kind: z.literal('jobs'), remoteOnly: z.boolean() }),
])
export type ExploreTopic = z.infer<typeof ExploreTopicSchema>
export const ExploreRequestSchema = z.object({
  operation: z.literal('explore'), requestId: label, topics: z.array(ExploreTopicSchema).min(1).max(4),
}).superRefine(({ topics }, ctx) => {
  if (new Set(topics.map(topic => topic.sourceId)).size !== topics.length) ctx.addIssue({ code: 'custom', message: 'Choose one search per interest.' })
  for (const topic of topics) if (topic.kind === 'events' && (topic.start > topic.end || Date.parse(topic.end) - Date.parse(topic.start) > 90 * 86400000)) ctx.addIssue({ code: 'custom', message: 'Choose an event window of up to 90 days.' })
})
export type ExploreRequest = z.infer<typeof ExploreRequestSchema>
export const ExploreUrl = z.url({ protocol: /^https?$/ }).max(1600)
export const ExploreFindingSchema = z.object({
  id: label, title: label, subtitle: label, when: label.optional(), price: label.optional(),
  why: label, url: ExploreUrl, source: ExploreUrl, state: z.enum(['new', 'changed', 'seen', 'closed']),
})
export type ExploreFinding = z.infer<typeof ExploreFindingSchema>
export const ExploreReportSchema = z.discriminatedUnion('status', [
  z.object({ sourceId: label, status: z.literal('complete'), findings: z.array(ExploreFindingSchema).max(6), checkedAt: z.number() }),
  z.object({ sourceId: label, status: z.literal('failed'), message: label }),
])
export type ExploreReport = z.infer<typeof ExploreReportSchema>
export const ExploreWorkerSchema = z.object({
  id: label, sourceId: label.optional(), label, message: z.string().max(500),
  stage: z.enum(['discovery', 'verification', 'shortlist', 'synthesis']),
  status: z.enum(['queued', 'running', 'complete', 'failed', 'skipped']),
})
export type ExploreWorker = z.infer<typeof ExploreWorkerSchema>
export const ExploreSharedSchema = z.object({
  title: label, summary: z.string().min(1).max(300),
  items: z.array(z.object({ sourceId: label, finding: ExploreFindingSchema })).min(2).max(4),
  checkedAt: z.number(),
})
export type ExploreShared = z.infer<typeof ExploreSharedSchema>
export const ExploreResultSchema = z.object({ requestId: label, reports: z.array(ExploreReportSchema).max(4), shared: ExploreSharedSchema.optional() })
export type ExploreResult = z.infer<typeof ExploreResultSchema>

export function searchScope(topic: ExploreTopic): string {
  return topic.kind === 'events' ? JSON.stringify([topic.kind, topic.query, topic.cities, topic.start, topic.end, topic.maxPrice])
    : JSON.stringify([topic.kind, topic.query, topic.remoteOnly])
}
export function mergeFindings(previous: readonly ExploreFinding[], incoming: readonly ExploreFinding[], retainUnseen = true): ExploreFinding[] {
  const old = new Map(previous.map(finding => [finding.id, finding]))
  const fresh = new Map(incoming.map(finding => {
    const before = old.get(finding.id)
    const changed = before && (before.title !== finding.title || before.subtitle !== finding.subtitle || before.when !== finding.when || before.price !== finding.price || before.state === 'closed')
    const state = finding.state === 'closed' ? 'closed' : !before ? 'new' : changed ? 'changed' : 'seen'
    return [finding.id, { ...finding, state }] as const
  }))
  const retained = (retainUnseen ? previous : []).filter(item => !fresh.has(item.id)).map(item => ({ ...item, state: item.state === 'closed' ? 'closed' as const : 'seen' as const }))
  return [...fresh.values(), ...retained].slice(0, 30)
}
