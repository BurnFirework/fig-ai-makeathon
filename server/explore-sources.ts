import { isNotEmpty } from '../shared/arrays'
import { z } from 'zod'
import { ExploreUrl } from '../shared/explore'

const text = z.string().nullish().transform(value => value ?? '')
const ticket = z.object({
  id: z.string(), name: z.string(), url: ExploreUrl,
  dates: z.object({ start: z.object({ localDate: z.string(), localTime: text }), status: z.object({ code: z.string() }).optional() }),
  priceRanges: z.array(z.object({ min: z.number().nonnegative(), max: z.number().nonnegative(), currency: z.string() })).optional(),
  _embedded: z.object({ venues: z.array(z.object({ name: z.string(), city: z.object({ name: z.string() }) })).optional() }).optional(),
  classifications: z.array(z.object({ genre: z.object({ name: text }).optional() })).optional(),
})
const job = z.object({
  job_id: z.string(), job_title: z.string(), employer_name: z.string(), job_apply_link: ExploreUrl,
  job_description: text, job_posted_at_datetime_utc: text, employer_website: text,
})
export type Ticket = z.infer<typeof ticket>
export type JobLead = z.infer<typeof job>
const pageSchema = z.object({ url: ExploreUrl, title: text, excerpts: z.array(z.string()).default([]) })
export type EvidencePage = z.infer<typeof pageSchema>
async function post(url: string, headers: Record<string, string>, body: object, signal: AbortSignal) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
    redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(22_000)]),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.text()
}

function parseJson(text: string): unknown { return JSON.parse(text) }

async function composio(slug: 'TICKETMASTER_GET_EVENTS' | 'JOB_SEARCH_JSEARCH_SEARCH_JOBS', args: object, signal: AbortSignal): Promise<unknown> {
  const key = process.env.COMPOSIO_API_KEY
  const ticketmasterKey = process.env.TICKETMASTER_API_KEY
  if (!key || (slug === 'TICKETMASTER_GET_EVENTS' && !ticketmasterKey)) throw new Error('Add the provider keys to the local Unfold runtime.')
  try {
    const raw = await post(`https://backend.composio.dev/api/v3.1/tools/execute/${slug}`, { 'x-api-key': key }, {
      version: '20261101_00', user_id: 'unfold-explore',
      ...(slug === 'TICKETMASTER_GET_EVENTS'
        ? { custom_auth_params: { parameters: [{ name: 'apikey', value: ticketmasterKey, in: 'query' }] } }
        : { connected_account_id: 'instant_account' }),
      arguments: args,
    }, signal)
    const reply = z.object({ successful: z.boolean(), data: z.unknown() }).parse(parseJson(raw))
    if (!reply.successful) throw new Error('Tool failed')
    return reply.data
  } catch (error) {
    signal.throwIfAborted()
    const reason = error instanceof Error && /^HTTP \d{3}$/.test(error.message) ? ` (${error.message})` : ''
    throw new Error(slug === 'TICKETMASTER_GET_EVENTS'
      ? `Ticketmaster search failed${reason}. Check the local connection and retry.`
      : `JSearch Instant failed${reason}. Check that Instant is enabled and funded, then retry.`, { cause: error })
  }
}

export async function searchEvents(topic: { query: string; cities: string[]; start: string; end: string }, signal: AbortSignal) {
  const range = (value: string, days: number) => new Date(Date.parse(value) + days * 86400000).toISOString().replace('.000Z', 'Z')
  const replies = await Promise.all(topic.cities.map(city => composio('TICKETMASTER_GET_EVENTS', {
    ...(topic.query.toLowerCase() === 'jazz' ? { classificationName: 'Jazz' } : { keyword: topic.query }),
    city, countryCode: 'US', startDateTime: range(topic.start, -1), endDateTime: range(topic.end, 2),
    size: 24, sort: 'date,asc',
  }, signal)))
  const payload = z.object({ _embedded: z.object({ events: z.array(ticket) }).optional(), page: z.object({ totalElements: z.number() }) })
  return [...new Map(replies.flatMap(reply => (payload.parse(reply)._embedded?.events ?? [])
    .filter(event => event.dates.start.localDate >= topic.start && event.dates.start.localDate <= topic.end)
    .filter(event => topic.query.toLowerCase() !== 'jazz' || !event.classifications?.every(entry => entry.genre?.name === 'Rock'))
    .map(event => [event.id, event] as const))).values()]
}

export async function searchJobs(topic: { query: string; remoteOnly: boolean }, signal: AbortSignal) {
  const data = await composio('JOB_SEARCH_JSEARCH_SEARCH_JOBS', {
    query: `${topic.query}${topic.remoteOnly ? ' remote' : ''} United States`, country: 'us',
    work_from_home: topic.remoteOnly, num_pages: 1,
    fields: ['job_id', 'job_title', 'employer_name', 'employer_website', 'job_apply_link', 'job_description', 'job_posted_at_datetime_utc'],
  }, signal)
  const envelope = z.object({ result: z.object({ data: z.object({ jobs: z.array(job) }), status: z.literal('OK') }) })
  return envelope.parse(data).result.data.jobs
}

async function parallel(tool: 'web_search' | 'web_fetch', args: object, signal: AbortSignal) {
  try {
    const raw = await post('https://mcp.parallel.ai/mcp', { Accept: 'application/json, text/event-stream' }, {
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args },
    }, signal)
    const message = raw.split(/\r?\n/).find(line => line.startsWith('data: '))?.slice(6) ?? raw
    const rpc = z.object({ result: z.object({ content: z.array(z.object({ text: z.string() })).min(1), isError: z.boolean().optional() }) }).parse(parseJson(message))
    if (rpc.result.isError) throw new Error('Tool failed')
    return rpc.result.content.flatMap(item => z.object({ results: z.array(pageSchema) }).parse(parseJson(item.text)).results)
  } catch {
    signal.throwIfAborted()
    throw new Error('Parallel verification failed. Retry this interest in a moment.')
  }
}
export const findPages = (objective: string, search_queries: string[], signal: AbortSignal) => parallel('web_search', { objective, search_queries }, signal)
export const fetchPages = (objective: string, urls: string[], signal: AbortSignal) => isNotEmpty(urls) ? parallel('web_fetch', { objective, urls }, signal) : Promise.resolve([])
