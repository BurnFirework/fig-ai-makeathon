import { z } from 'zod'
import { isNotEmpty } from './arrays'

const label = z.string().trim().min(1).max(240)
const short = z.string().trim().min(1).max(160)
const dependency = z.object({ id: z.string(), revision: z.number().int().nonnegative() })
const target = { sourceId: label, title: label, query: label, dependencies: z.array(dependency).min(1).max(120) }
export const ExploreUrl = z.url({ protocol: /^https?$/ }).max(1600)
export const WebCategorySchema = z.enum(['activity', 'event', 'job'])
export type WebCategory = z.infer<typeof WebCategorySchema>
/**
 * `web` is the search Explore runs today. `events` and `jobs` are earlier provider-specific searches; they stay readable so
 * saved boards keep their findings, and the client turns them into web searches before running them again.
 */
const WebTopicObject = z.object({ ...target, kind: z.literal('web'), category: WebCategorySchema,
    /** Optional scope the user approved. Unset means no limit, never "anything nearby". */
    city: short.optional(), schedule: short.optional(), start: z.iso.date().optional(), end: z.iso.date().optional(),
    maxPrice: z.number().nonnegative().max(100000).optional(), remoteOnly: z.boolean().optional(), region: short.optional(),
    /** Confirmed conditions every option must meet, from the user's conversations. */
    conditions: z.array(short).max(8).default([]),
    /** Soft preferences used for ranking only. */
    preferences: z.array(short).max(6).default([]),
    /** What the user said they want, for the planner's search phrases. Never checked as a requirement. */
    context: z.array(label).max(6).default([]),
    /** Links already on the source card; checked first. */
    links: z.array(ExploreUrl).max(3).default([]),
  })
export const ExploreTopicSchema = z.discriminatedUnion('kind', [
  WebTopicObject,
  WebTopicObject.extend({ kind: z.literal('card'), category: WebCategorySchema.optional() }),
  z.object({ ...target, kind: z.literal('events'), cities: z.array(label).min(1).max(2), start: z.iso.date(), end: z.iso.date(), maxPrice: z.number().positive().max(100000).optional() }),
  z.object({ ...target, kind: z.literal('jobs'), remoteOnly: z.boolean() }),
])
export type ExploreTopic = z.infer<typeof ExploreTopicSchema>
export type InvestigationTopic = Extract<ExploreTopic, { kind: 'card' | 'web' }>
export type WebTopic = Extract<ExploreTopic, { kind: 'web' }>
const window = (start: string, end: string) => start <= end && Date.parse(end) - Date.parse(start) <= 90 * 86400000
export const ExploreRequestSchema = z.object({
  operation: z.literal('explore'), requestId: label, topics: z.array(ExploreTopicSchema).min(1),
  board: z.object({ cards: z.array(z.object({ id: label, node: z.record(z.string(), z.unknown()), image: z.string().max(4_000_000).optional() })), conversations: z.array(z.unknown()), relations: z.array(z.unknown()) }).optional(),
}).superRefine(({ topics }, ctx) => {
  if (new Set(topics.map(topic => topic.sourceId)).size !== topics.length) ctx.addIssue({ code: 'custom', message: 'Choose one search per interest.' })
  for (const topic of topics) {
    if (topic.kind === 'events' && !window(topic.start, topic.end)) ctx.addIssue({ code: 'custom', message: 'Choose an event window of up to 90 days.' })
    if ((topic.kind === 'web' || topic.kind === 'card') && topic.start && topic.end && !window(topic.start, topic.end)) ctx.addIssue({ code: 'custom', message: `“${topic.title}”: choose dates up to 90 days apart, with the start first.` })
  }
})
export type ExploreRequest = z.infer<typeof ExploreRequestSchema>
export const ExploreFindingSchema = z.object({
  id: label, title: label, subtitle: label, when: label.optional(), price: label.optional(),
  why: label, url: ExploreUrl, source: ExploreUrl, state: z.enum(['new', 'changed', 'seen', 'closed']),
  /** A published schedule is not a confirmed seat; only an explicit availability statement is. */
  availability: z.enum(['schedule', 'spots', 'unknown']).optional(),
  /** When this run's agents last read the source. Unset on findings saved before per-finding checks. */
  checkedAt: z.number().optional(),
})
export type ExploreFinding = z.infer<typeof ExploreFindingSchema>
export const ExploreOutcomeSchema = z.enum(['confirmed', 'incomplete', 'rejected', 'empty'])
export const ExploreDevelopmentSchema = z.object({ id: label, kind: z.enum(['idea', 'plan', 'question', 'comparison']), title: label, text: z.string().min(1).max(1200), sources: z.array(z.object({ title: label, url: ExploreUrl, quote: z.string().trim().min(4).max(1200) })).default([]) })
export const ExploreReportSchema = z.discriminatedUnion('status', [
  z.object({ sourceId: label, status: z.literal('complete'), findings: z.array(ExploreFindingSchema).max(6), note: z.string().min(1).max(400).optional(),
    /** confirmed: options passed every check · incomplete: a required fact stayed unknown · rejected: sources contradicted the scope · empty: nothing to check. */
    developments: z.array(ExploreDevelopmentSchema).optional(), usedCardIds: z.array(label).optional(),
    outcome: ExploreOutcomeSchema.optional(), candidates: z.number().int().nonnegative().optional(), checkedAt: z.number() }),
  z.object({ sourceId: label, status: z.literal('failed'), message: label }),
])
export type ExploreReport = z.infer<typeof ExploreReportSchema>
export const ExploreWorkerSchema = z.object({
  id: label, sourceId: label.optional(), label, message: z.string().max(500),
  connections: z.array(z.object({ toolkit: label, url: ExploreUrl })).optional(),
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
export const ExploreResultSchema = z.object({ requestId: label, reports: z.array(ExploreReportSchema), shared: ExploreSharedSchema.optional() })
export type ExploreResult = z.infer<typeof ExploreResultSchema>

export function searchScope(topic: ExploreTopic): string {
  if (topic.kind === 'web' || topic.kind === 'card') return JSON.stringify([topic.kind, topic.category, topic.query, topic.city, topic.schedule, topic.start, topic.end, topic.maxPrice, topic.remoteOnly, topic.region, topic.conditions])
  return topic.kind === 'events' ? JSON.stringify([topic.kind, topic.query, topic.cities, topic.start, topic.end, topic.maxPrice])
    : JSON.stringify([topic.kind, topic.query, topic.remoteOnly])
}
/**
 * Merges a run's findings into a saved group. Findings this run did not check keep their own check time
 * (or the group's earlier one), so a rerun never makes an old result look freshly verified.
 */
export function mergeFindings(previous: readonly ExploreFinding[], incoming: readonly ExploreFinding[], retainUnseen = true, previousCheckedAt?: number): ExploreFinding[] {
  const old = new Map(previous.map(finding => [finding.id, finding]))
  const fresh = new Map(incoming.map(finding => {
    const before = old.get(finding.id)
    const changed = before && (before.title !== finding.title || before.subtitle !== finding.subtitle || before.when !== finding.when || before.price !== finding.price || before.state === 'closed')
    const state = finding.state === 'closed' ? 'closed' : !before ? 'new' : changed ? 'changed' : 'seen'
    return [finding.id, { ...finding, state }] as const
  }))
  const retained = (retainUnseen ? previous : []).filter(item => !fresh.has(item.id)).map(item => ({
    ...item, state: item.state === 'closed' ? 'closed' as const : 'seen' as const,
    ...(item.checkedAt === undefined && previousCheckedAt !== undefined ? { checkedAt: previousCheckedAt } : {}),
  }))
  return [...fresh.values(), ...retained].slice(0, 30)
}

// ---- Turning a board card and its confirmed conversation memory into a web search ----

const WEEKDAY = /\b(?:mon|tues|wednes|thurs|fri|satur|sun)days?\b|\bweekends?\b|\bweekdays?\b/gi
const DAYPART = /\b(?:mornings?|afternoons?|evenings?|nights?)\b/gi
const JOB = /\b(?:job|jobs|career|careers|hiring|role|roles|work from home|job search|position|positions|engineer(?:ing)?|designer|developer|technologist)\b/i
const EVENT = /\b(?:concerts?|gigs?|jazz|live music|shows?|festival|tickets?|performances?|comedy|theater|theatre|opera|symphony)\b/i
const FILLER = /^(?:i (?:want|would like|'d like) to\s+)?(?:try|find|join|take|attend|book|get|go to|look for|search for|discover)\s+(?:(?:a|an|the|some|my)\s+)?/i
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const tidy = (text: string) => text.replace(/\s+/g, ' ').replace(/\s+([,.;])/g, '$1').trim()
const unique = (items: string[]) => [...new Map(items.map(item => [item.toLowerCase(), item])).values()]

/** Weekday and part-of-day words, e.g. "Saturday afternoons". */
export function scheduleWords(text: string): string | undefined {
  const days = unique([...text.matchAll(WEEKDAY)].map(match => capitalize(match[0].toLowerCase())))
  const parts = unique([...text.matchAll(DAYPART)].map(match => match[0].toLowerCase()))
  const value = [days.join(' or '), parts.join(' or ')].filter(Boolean).join(' ')
  return value || undefined
}
function placeFrom(text: string, answer = false): string | undefined {
  const named = /(?:^|\b)(?:[Ii]n|[Nn]ear|[Aa]round)\s+((?:[A-Z][\p{L}'.-]+)(?:\s+[A-Z][\p{L}'.-]+){0,2})/u.exec(text)?.[1]
  if (named) return named.replace(/[.,]+$/, '')
  if (/\bbay area\b/i.test(text)) return 'San Francisco Bay Area'
  if (/\bsan francisco\b|\bSF\b/.test(text)) return 'San Francisco'
  // A bare name such as "Oakland" or "Mission District": every word capitalized, nothing else in the answer.
  const bare = text.trim().replace(/[.!]+$/, '')
  if (answer && /^(?:[A-Z][\p{L}.-]+)(?:\s+[A-Z][\p{L}.-]+){0,2}$/u.test(bare) && !/'/.test(bare)) return bare
  return undefined
}
/** "Preferably in a small group" → "Small group preferred". */
function preferenceText(value: string): string {
  const core = value.replace(/[.!]+$/, '').replace(/^(?:i(?:'d| would)?\s+(?:rather|prefer(?:ably)?|like)|preferably|ideally|if possible,?)\s+/i, '').replace(/^(?:in|with|at)\s+(?:a|an|the)\s+/i, '').replace(/^(?:a|an|the)\s+/i, '').trim()
  return (/\bprefer/i.test(core) ? capitalize(core) : `${capitalize(core)} preferred`).slice(0, 160)
}
const memoryValue = (text: string) => text.replace(/^[A-Za-z ]+:\s*/, '').trim()
const LABELLED = /^(?:budget|place|time|company|priority|condition):/i
const GENERIC = new Set(['a', 'an', 'the', 'some', 'new', 'people', 'meet', 'more', 'my', 'and', 'with', 'to', 'of', 'for', 'only'])
const contentWords = (text: string) => (text.toLowerCase().match(/[\p{L}\d'-]{3,}/gu) ?? []).filter(word => !GENERIC.has(word))
/**
 * What a stated wish asks to search for: "I want to meet new people through a weekly ceramics group" → "weekly ceramics group".
 * Only an explicit means ("through", "via", "by joining") or an action verb counts; anything else stays planner context.
 */
export function intentFocus(text: string): string | undefined {
  const value = text.replace(/[.!?]+$/, '').trim()
  const means = /\b(?:through|via|by (?:joining|taking|attending|going to|finding))\s+(.+)$/i.exec(value)?.[1]
  const action = /^(?:i(?:'d| would)? (?:really )?(?:want|like|love|hope)(?: to)?|i'm looking (?:for|to)|looking (?:for|to))\s+(?:join|take|try|attend|find|start|do)\s+(.+)$/i.exec(value)?.[1]
  const focus = tidy((means ?? action ?? '').replace(/^(?:a|an|the|some)\s+/i, '').replace(/\s+only$/i, ''))
  const words = focus.split(/\s+/).filter(Boolean)
  return words.length <= 8 && isNotEmpty(contentWords(focus)) ? focus : undefined
}

export interface TopicSeed { sourceId: string; title: string; dependencies: { id: string; revision: number }[]; conditions: readonly string[]; links?: readonly string[] }

/**
 * Builds the default web search for a card. Budget, place and time from confirmed memory become search scope;
 * "prefer" statements and company become ranking preferences; stated wishes become planner context.
 */
export function buildWebTopic(seed: TopicSeed): WebTopic {
  const title = seed.title.trim().slice(0, 240)
  const memory = seed.conditions.map(text => text.trim()).filter(Boolean)
  const details = [title, ...memory].join(' · ')
  const category: WebCategory = JOB.test(details) ? 'job' : EVENT.test(details) ? 'event' : 'activity'
  let city: string | undefined; let schedule: string | undefined; let maxPrice: number | undefined; let remoteOnly: boolean | undefined
  const conditions: string[] = []; const preferences: string[] = []; const context: string[] = []
  for (const entry of memory) {
    const value = memoryValue(entry)
    if (/^budget:/i.test(entry)) {
      const amount = /\$\s?(\d[\d,]*(?:\.\d+)?)/.exec(value)?.[1]
      if (amount) maxPrice = Number(amount.replace(/,/g, ''))
      else if (/\bfree\b/i.test(value)) maxPrice = 0
      // A budget answer without an amount ("not much") guides the planner but is never a filter.
      else context.push(entry.slice(0, 240))
    } else if (/^place:/i.test(entry)) {
      // Only a recognizable place becomes the city; an answer like "Haven't booked yet" is context, not a location.
      const place = /\bremote(?:ly)?\b|from home/i.test(value) ? undefined : placeFrom(value, true)
      if (/\bremote(?:ly)?\b|from home/i.test(value)) remoteOnly = true
      else if (place) city = place
      else context.push(entry.slice(0, 240))
    } else if (/^time:/i.test(entry)) {
      const words = scheduleWords(value)
      if (words) schedule = words
      else context.push(entry.slice(0, 240))
    } else if (/^company:/i.test(entry) || /\bprefer/i.test(value)) preferences.push(preferenceText(value))
    else if (/^(?:priority|condition):/i.test(entry)) conditions.push(value.slice(0, 160))
    else context.push(entry.slice(0, 240))
  }
  city ??= placeFrom(title)
  schedule ??= scheduleWords(title)
  // A wish from the chat that names how to pursue the card ("through a weekly ceramics group") becomes what is searched;
  // the card title stays the goal the planner sees.
  const own = new Set(contentWords(title))
  const focus = memory.filter(entry => !LABELLED.test(entry)).map(intentFocus).find(found => found !== undefined && contentWords(found).some(word => !own.has(word)))
  let query = (focus ?? title).replace(FILLER, '')
  if (schedule) query = query.replace(WEEKDAY, '').replace(DAYPART, '')
  if (category === 'job') {
    if (/\bremote\b|work from home/i.test(details)) remoteOnly = true
    query = query.replace(/\b(?:remote|jobs?|roles?|find|search for|look for)\b/gi, '')
  }
  if (city) query = query.replace(new RegExp(String.raw`\b(?:in|near|around)?\s*${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\b`, 'i'), '')
  query = tidy(query.replace(/\b(?:a|an)\s*$/i, '')) || title
  return {
    kind: 'web', sourceId: seed.sourceId, title, query: capitalize(query).slice(0, 240), dependencies: seed.dependencies, category,
    ...(city ? { city: city.slice(0, 160) } : {}), ...(schedule ? { schedule: schedule.slice(0, 160) } : {}),
    ...(maxPrice !== undefined ? { maxPrice } : {}),
    ...(category === 'job' ? { remoteOnly: remoteOnly ?? false, ...(remoteOnly ? { region: 'United States' } : {}) } : {}),
    conditions: unique(conditions).slice(0, 8), preferences: unique(preferences).slice(0, 6), context: unique(context).slice(0, 6),
    links: [...new Set(seed.links ?? [])].filter(link => ExploreUrl.safeParse(link).success).slice(0, 3),
  }
}

/** Reads an earlier provider-specific search as the equivalent web search. */
export function toWebTopic(topic: Exclude<ExploreTopic, { kind: 'card' }>): WebTopic {
  if (topic.kind === 'web') return topic
  const base = { sourceId: topic.sourceId, title: topic.title, query: topic.query.split(/\s+OR\s+/i)[0]?.trim() || topic.query, dependencies: topic.dependencies, conditions: [], preferences: [], context: [], links: [] }
  return topic.kind === 'events'
    ? { ...base, kind: 'web', category: 'event', ...(topic.cities[0] ? { city: topic.cities[0] } : {}), start: topic.start, end: topic.end, ...(topic.maxPrice !== undefined ? { maxPrice: topic.maxPrice } : {}) }
    : { ...base, kind: 'web', category: 'job', remoteOnly: topic.remoteOnly, ...(topic.remoteOnly ? { region: 'United States' } : {}) }
}

const dateText = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const money = (value: number) => value === 0 ? 'Free' : `Up to $${value.toLocaleString('en-US')}`
/** The one-line scope shown before a search, e.g. "Pottery wheel class · San Francisco · Saturday". */
export function describeTopic(topic: ExploreTopic): string {
  const web = topic.kind === 'card' ? topic : toWebTopic(topic)
  const dates = web.start && web.end ? `${dateText(web.start)}–${dateText(web.end)}` : web.start ? `From ${dateText(web.start)}` : web.end ? `Until ${dateText(web.end)}` : undefined
  return [web.query, web.remoteOnly ? `Remote${web.region ? ` · ${web.region}` : ''}` : web.city, web.schedule, dates,
    web.maxPrice !== undefined ? money(web.maxPrice) : undefined, ...web.conditions.slice(0, 2)].filter(Boolean).join(' · ')
}

export function investigationTopic(topic: ExploreTopic): InvestigationTopic { return topic.kind === 'card' ? topic : toWebTopic(topic) }
/** Transport duration accounts for all selected cards; per-card work stays bounded. */
export const exploreTimeout = (cards: number) => Math.min(2_147_000_000, cards * 490_000 + 20_000)
export function developmentKey(item: { kind: string; title: string; text: string; sources: { url: string }[] }): string {
  const normalize = (value: string) => value.trim().replace(/\s+/g, ' ')
  return JSON.stringify([item.kind, normalize(item.title).toLowerCase(), normalize(item.text), [...new Set(item.sources.map(source => new URL(source.url).href))].sort()])
}

/** Refresh inherited facts while preserving scope fields explicitly edited for the prior run. */
export function refreshInvestigationScope(current: InvestigationTopic, previous: InvestigationTopic, baseline?: InvestigationTopic): InvestigationTopic {
  const keys = ['query', 'city', 'schedule', 'start', 'end', 'maxPrice', 'remoteOnly', 'region', 'preferences'] as const
  const overrides = Object.fromEntries(keys.filter(key => baseline && JSON.stringify(previous[key]) !== JSON.stringify(baseline[key])).map(key => [key, previous[key]]))
  return { ...current, ...overrides }
}
