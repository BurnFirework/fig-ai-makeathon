import { isEmpty, isNotEmpty } from '../shared/arrays'
import type { AgentEvent } from '../shared/schema'
import { ExploreFindingSchema, ExploreUrl, type ExploreFinding, type ExploreReport, type ExploreRequest, type ExploreTopic } from '../shared/explore'
import { fetchPages, findPages, searchEvents, searchJobs, type EvidencePage, type JobLead, type Ticket } from './explore-sources'

const money = (min: number, max: number) => min === max ? `$${min.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(min) ? 0 : 2 })}` : `$${min.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(min) ? 0 : 2 })}–$${max.toLocaleString('en-US')}`
const words = (value: string): string[] => value.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []
const comparable = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
const sameName = (name: string, title: string) => words(name).filter(word => word !== 'the').some(word => words(title).includes(word))
const content = (page: EvidencePage) => page.excerpts.join('\n')
const unavailable = (page: EvidencePage) => /(?:this (?:job|posting|position) (?:is no longer (?:available|open|accepting)|has been (?:closed|removed|filled))|(?:applications|this position) (?:are|is) closed|event (?:has been )?cancell?ed)/i.test(content(page))
const ticketSeller = (url: string) => /(?:^|\.)(?:ticketmaster\.com|ticketweb\.com)$/.test(new URL(url).hostname)
const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
function eventDate(page: EvidencePage, date: string) {
  const day = new Date(`${date}T12:00:00Z`)
  const month = day.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
  return content(page).includes(date) || new RegExp(`\\b${month}[a-z]*\\.?\\s+${day.getUTCDate()}\\b`, 'i').test(content(page))
}
function eventPrice(page: EvidencePage) {
  const lines = content(page).split('\n')
  const row = lines.find(line => /(?:ticket|price|admission|^\s*\$)/i.test(line) && /\$[\d.]+/.test(line) && !/\b(?:fee only|processing fee|food|minimum purchase)\b/i.test(line))
  if (!row) return
  const prices = [...row.matchAll(/\$(\d+(?:\.\d{1,2})?)/g)].flatMap(match => match[1] ? [Number(match[1])] : [])
  return isNotEmpty(prices) ? { min: Math.min(...prices), max: Math.max(...prices) } : undefined
}

function verifiedEvent(lead: Ticket, pages: EvidencePage[], topic: Extract<ExploreTopic, { kind: 'events' }>) {
  const venue = lead._embedded?.venues?.[0]
  if (!venue) return
  const date = lead.dates.start.localDate
  const venueKey = comparable(venue.name).replace(/(?:sanfrancisco|oakland)$/, '').slice(0, 12)
  const candidates = pages.filter(page => sameName(lead.name, page.title) && eventDate(page, date))
  const page = candidates.find(page => venueKey.length >= 5 && comparable(new URL(page.url).hostname).includes(venueKey))
    ?? candidates.find(page => ticketSeller(page.url) && (page.url === lead.url || comparable(content(page)).includes(venueKey)))
  if (!page) return
  const closed = unavailable(page) || ['cancelled', 'canceled'].includes(lead.dates.status?.code ?? '')
  const price = eventPrice(page) ?? lead.priceRanges?.find(range => range.currency === 'USD')
  if (!closed && topic.maxPrice !== undefined && (!price || price.min > topic.maxPrice)) return
  const time = lead.dates.start.localTime
  return ExploreFindingSchema.parse({
    id: `ticketmaster:${lead.id}`, title: lead.name, subtitle: `${venue.name} · ${venue.city.name}`,
    when: dateLabel(date) + (time ? ` · ${time.slice(0, 5)}` : ''), price: price ? money(price.min, price.max) : 'Price unknown',
    why: closed ? 'The listing is closed.' : 'The listing confirms this performance falls within your dates.',
    url: lead.url, source: page.url, state: closed ? 'closed' : 'new',
  })
}

function isJobBoard(url: string) {
  const { hostname, pathname } = new URL(url)
  return pathname.split('/').filter(Boolean).length >= 2 && (/^(?:jobs\.ashbyhq\.com|job-boards\.greenhouse\.io|boards\.greenhouse\.io|jobs\.lever\.co|apply\.workable\.com|jobs\.smartrecruiters\.com)$/.test(hostname) || hostname.endsWith('.myworkdayjobs.com'))
}
function employerListing(url: string, lead: JobLead) {
  const { hostname } = new URL(url)
  if (isJobBoard(url)) return true
  const firstWord = words(lead.employer_name)[0]
  if (firstWord && firstWord.length >= 4 && words(hostname).includes(firstWord) && /career|jobs|workday/.test(hostname + new URL(url).pathname)) return true
  const company = ExploreUrl.safeParse(lead.employer_website)
  return company.success && hostname.replace(/^www\./, '') === new URL(company.data).hostname.replace(/^www\./, '')
}
function jobKey(lead: JobLead, source: string, evidence: string) {
  const requisition = /(?:requisition\s+(?:number|id)|job\s+req(?:uisition)?\s+id)\s*[:#-]?\s*([a-z]*\d[\w-]*)/i.exec(evidence)?.[1]
  if (requisition) return `job:${comparable(lead.employer_name)}:${requisition.toLowerCase()}`.slice(0, 240)
  const url = new URL(source)
  return `job:${url.hostname}${url.pathname.replace(/\/application\/?$|\/$/g, '')}`.slice(0, 240)
}
export function verifiedJob(lead: JobLead, pages: EvidencePage[], remoteOnly: boolean) {
  const company = words(lead.employer_name).find(word => word !== 'the')
  const title = words(lead.job_title).filter(word => !['remote', 'senior', 'junior', 'from'].includes(word))
  const page = pages.find(page => employerListing(page.url, lead) && company && comparable(page.title + page.url + content(page).slice(0, 600)).includes(company)
    && title.filter(word => words(page.title).includes(word)).length >= Math.min(2, title.length))
  if (!page) return
  const evidence = content(page)
  const closed = unavailable(page)
  const workplace = /(?:^|\n)(?:#+\s*)?(?:location type|workplace type|work arrangement)\s*:?\s*\n*\s*(remote|hybrid|on[- ]?site)\b/i.exec(evidence)?.[1]?.toLowerCase()
  const hybrid = workplace === 'hybrid' || /\b(?:hybrid|on[- ]site) (?:role|position|schedule)\b/i.test(evidence)
  const usLocation = /\b(?:remote\s*[-–,(]\s*(?:us\b|u\.s\.|united states)|remotely in the u\.s\.|u\.s\.[ -]remote|remote (?:anywhere )?(?:within|in) the (?:us|united states)|united states\s*[/–,-]\s*remote)\b/i.test(evidence)
  const usScope = /\b(?:united states|us locations?|us only|us-based|us tier|home teleworkers)\b/i.test(evidence)
  const remote = !hybrid && (usLocation || ((workplace === 'remote' || /remote\s*:\s*yes/i.test(evidence)) && usScope))
  if (!closed && remoteOnly && !remote) return
  const pay = /\$[\d,.]+[kK]?\s*[–—-]\s*\$[\d,.]+[kK]?/
  const salary = /starting pay range[^.\n]*?(\$[\d,.]+[kK]?\s*[–—-]\s*\$[\d,.]+[kK]?)/i.exec(evidence)?.[1] ?? pay.exec(evidence)?.[0]
  const deadline = /\b(?:end date|apply by):\s*([a-z]+ \d{1,2}, \d{4})/i.exec(evidence)?.[1]
  const exceptions = /with the following exceptions:\s*([^.!\n]{2,70})/i.exec(evidence)?.[1]
  return ExploreFindingSchema.parse({
    id: jobKey(lead, page.url, evidence), title: page.title.split(/\s@\s|\s\|\s/)[0]?.trim().slice(0, 240) || lead.job_title.slice(0, 240),
    subtitle: `${lead.employer_name} · ${remote ? 'Remote' : hybrid ? 'Hybrid' : 'Location on listing'}`.slice(0, 240),
    ...(salary ? { price: salary } : {}),
    ...(deadline ? { when: `Apply by ${deadline}` } : {}),
    why: closed ? 'The employer closed this listing.' : remote ? exceptions ? `US remote, except ${exceptions}.` : 'The employer listing supports US remote work.' : 'Read the employer listing for location and eligibility.',
    url: page.url, source: page.url, state: closed ? 'closed' : 'new',
  })
}

async function exploreTopic(topic: ExploreTopic, signal: AbortSignal, progress: (message: string) => void): Promise<ExploreFinding[]> {
  if (topic.kind === 'events') {
    const events = (await searchEvents(topic, signal)).filter(event => topic.maxPrice === undefined
      || !event.priceRanges || isEmpty(event.priceRanges) || event.priceRanges.some(price => price.currency === 'USD' && price.min <= (topic.maxPrice ?? Infinity))).slice(0, 5)
    if (isEmpty(events)) return []
    progress(`Checking dates and prices for ${topic.title}…`)
    const found = await findPages('Find the original venue or box office pages for these exact events and show dates.', events.map(event => `${event.name} ${event._embedded?.venues?.[0]?.name ?? ''} ${dateLabel(event.dates.start.localDate)} tickets`), signal)
    const urls = [...new Set([...events.map(event => event.url), ...found.filter(page => events.some(event => sameName(event.name, page.title) && comparable(page.title + content(page)).includes(comparable(event._embedded?.venues?.[0]?.name ?? '').slice(0, 9)))).slice(0, 6).map(page => page.url)])]
    const pages = await fetchPages('Find exact title, performance date, showtime, venue, published ticket prices and closure status.', urls, signal)
    return events.flatMap(lead => { const found = verifiedEvent(lead, pages, topic); return found ? [found] : [] }).slice(0, 3)
  }
  const terms = words(topic.query).filter(word => !['remote', 'engineer', 'engineering', 'design'].includes(word))
  const leads = (await searchJobs(topic, signal)).filter(lead => {
    const combined = `${lead.job_title} ${lead.job_description.slice(0, 1100)}`
    if (/design engineer|design technologist|design systems/i.test(topic.query) && /\b(?:hvac|mep|mechanical design|civil engineer)\b/i.test(combined)) return false
    return isEmpty(terms) || terms.some(word => words(combined).includes(word))
  }).slice(0, 6)
  if (isEmpty(leads)) return []
  progress(`Checking employer listings for ${topic.title}…`)
  const direct = leads.filter(lead => employerListing(lead.job_apply_link, lead))
  const others = [...new Map(leads.filter(lead => !employerListing(lead.job_apply_link, lead)).map(lead => [`${lead.employer_name}:${lead.job_title}`, lead])).values()].slice(0, 4)
  const requisition = (lead: JobLead) => /(?:requisition\s+(?:number|id))\s*[:#-]?\s*([a-z]*\d[\w-]*)/i.exec(lead.job_description)?.[1]
  const priority = others.find(lead => requisition(lead)) ?? others[0]
  const role = topic.query.split(/\s+OR\s+/i)[0] ?? topic.query
  const location = topic.remoteOnly ? 'US remote' : 'United States'
  const found = (await Promise.all([
    findPages(`Find direct employer postings for ${location} ${topic.query} jobs. Return the job title, location, salary and application link.`, [
      `${role} ${location} hiring careers`, `${role} ${location} site:jobs.ashbyhq.com OR site:job-boards.greenhouse.io OR site:jobs.lever.co`,
    ], signal),
    priority ? findPages(`Find the official employer or Workday job listing for ${priority.employer_name}: ${priority.job_title}. Requisition ${requisition(priority) ?? 'unknown'}.`, [
      `${priority.employer_name} ${priority.job_title} ${requisition(priority) ?? ''} careers site:myworkdayjobs.com`,
      `${priority.employer_name} ${priority.job_title} ${requisition(priority) ?? ''} employer application`,
    ], signal) : Promise.resolve([]),
  ])).flat()
  const originals = found.filter(page => others.some(lead => employerListing(page.url, lead)
    && (words(lead.employer_name).some(word => comparable(page.title + page.url).includes(word))
      || (requisition(lead) && comparable(page.url).includes(comparable(requisition(lead) ?? ''))))))
  // A provider shortlist can be exhausted by false remote flags. The same source lookup can surface direct employer postings.
  const related = found.filter(page => isJobBoard(page.url) && words(page.title).filter(word => words(topic.query).includes(word)).length >= 2).slice(0, 5)
  const urls = [...new Set([...direct.map(lead => lead.job_apply_link), ...originals.slice(0, 6).map(page => page.url), ...related.map(page => page.url)])]
  const pages = await fetchPages('Extract job title, employer, location and workplace type, salary range, job requisition ID, and whether applications are closed.', urls, signal)
  const matches = leads.flatMap(lead => { const found = verifiedJob(lead, pages, topic.remoteOnly); return found ? [found] : [] })
  const nearby = related.flatMap(page => {
    const [title, company] = page.title.split(' @ ')
    if (!title || !company || /\b(?:hvac|mep|mechanical|civil)\b/i.test(title)) return []
    const match = verifiedJob({ job_id: page.url, job_title: title, employer_name: company, job_apply_link: page.url,
      job_description: '', employer_website: '', job_posted_at_datetime_utc: '' }, pages.filter(item => item.url === page.url), topic.remoteOnly)
    return match ? [match] : []
  })
  return [...new Map([...nearby, ...matches].map(match => [match.id, match])).values()].slice(0, 3)
}

let active = false
export async function runExplore(request: ExploreRequest, signal: AbortSignal, emit: (event: AgentEvent) => void) {
  if (active) throw new Error('An Explore board run is already active.')
  active = true
  try {
    const reports: ExploreReport[] = []
    for (let i = 0; i < request.topics.length; i += 2) {
      signal.throwIfAborted()
      const batch = await Promise.all(request.topics.slice(i, i + 2).map(async (topic): Promise<ExploreReport> => {
        const progress = (message: string) => { if (!signal.aborted) emit({ type: 'activity', role: 'research', message }) }
        progress(`Searching ${topic.kind === 'events' ? 'Ticketmaster' : 'JSearch'} for ${topic.title}…`)
        try {
          const findings = await exploreTopic(topic, signal, progress)
          progress(`${topic.title}: ${isNotEmpty(findings) ? `${findings.length} checked` : 'no verified matches'}.`)
          return { sourceId: topic.sourceId, status: 'complete', findings, checkedAt: Date.now() }
        } catch (error) {
          const message = error instanceof Error && /^(?:Ticketmaster search|JSearch Instant|Parallel verification|Add the provider keys)/.test(error.message) ? error.message : 'This search returned an unreadable response. Retry this interest.'
          progress(`${topic.title}: search failed.`)
          return { sourceId: topic.sourceId, status: 'failed', message }
        }
      }))
      reports.push(...batch)
    }
    signal.throwIfAborted()
    return { requestId: request.requestId, reports }
  } finally { active = false }
}
