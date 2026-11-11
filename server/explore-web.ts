import { z } from 'zod'
import { isEmpty, isNotEmpty } from '../shared/arrays'
import { ExploreFindingSchema, ExploreUrl, type ExploreFinding, type ExploreReport, type WebTopic } from '../shared/explore'
import type { EvidencePage } from './explore-sources'

// The web route of Explore: a planner turns the approved scope into search phrases, web search finds candidate pages,
// every material condition is checked against the organizer's own page, and a shortlist agent ranks what passed.
// Agents may add judgement, but a fact only counts as confirmed when its quote is on the fetched page.

export type CheckStatus = 'confirmed' | 'contradicted' | 'unknown'
export interface Check { id: string; label: string; status: CheckStatus; evidence?: string }
export type Verdict = 'confirmed' | 'incomplete' | 'rejected'
export interface Review { url: string; page: EvidencePage; checks: Check[]; verdict: Verdict; reason: string; finding: ExploreFinding }

const clip = (text: string, length: number) => { const value = text.replace(/\s+/g, ' ').trim(); return value.length > length ? `${value.slice(0, length - 1).trimEnd()}…` : value }
const flat = (text: string) => text.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim()
const STOP = new Set(['the', 'and', 'for', 'with', 'new', 'from', 'into', 'your', 'that', 'this', 'class', 'classes', 'near', 'some', 'about', 'more', 'than', 'have', 'want', 'like', 'would', 'should', 'must', 'friendly', 'preferred', 'through', 'meet', 'people', 'find', 'going', 'something'])
const keywords = (text: string) => [...new Set((text.toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) ?? []).filter(word => !STOP.has(word)))]
const stem = (word: string) => word.replace(/'s$/, '').slice(0, Math.max(4, Math.min(word.length, 6)))
const hasStem = (text: string, word: string) => new RegExp(String.raw`\b${stem(word).replace(/[^a-z0-9]/g, '')}`, 'i').test(text)
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const comparable = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '')

export function normalizeUrl(value: string): string {
  try {
    const url = new URL(value)
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid|gclid|mc_|ref$|source$|embed$|gh_src$|lever-source)/i.test(key)) url.searchParams.delete(key)
    // An applicant-tracking listing and its /application form are one job.
    const path = url.pathname.replace(/\/+$/, '').replace(/\/(?:application|apply)$/i, '')
    // Applicant-tracking paths ignore case: /Ashby/… and /ashby/… are one listing.
    const site = url.hostname.replace(/^www\./, '').toLowerCase()
    if (ATS.test(site)) return `${site}${path.toLowerCase()}${url.search}`
    return `${url.hostname.replace(/^www\./, '').toLowerCase()}${path}${url.search}`
  } catch { return value }
}
const host = (value: string) => { try { return new URL(value).hostname.replace(/^www\./, '').toLowerCase() } catch { return '' } }
const pathParts = (value: string) => { try { return new URL(value).pathname.split('/').filter(Boolean) } catch { return [] } }
/** The part of a host that names its owner: "careers.figma.com" → "figma". */
const owner = (site: string) => site.split('.').slice(0, -1).filter(label => !/^(?:www|careers?|jobs|boards|job-boards|apply|about|events?|tickets?|m)$/.test(label)).at(-1) ?? site
const SOCIAL = /(?:^|\.)(?:yelp\.[a-z.]+|tripadvisor\.[a-z.]+|reddit\.com|quora\.com|wikipedia\.org|pinterest\.[a-z.]+|instagram\.com|tiktok\.com|youtube\.com|twitter\.com|x\.com|facebook\.com)$/
/** Job boards that hide listings behind sign-in; never fetched. */
const WALLED_BOARD = /(?:^|\.)(?:indeed\.com|linkedin\.com|glassdoor\.[a-z.]+|ziprecruiter\.com|simplyhired\.com|monster\.com|careerbuilder\.com|talent\.com|jooble\.org)$/
// Sites that list other organizations' jobs or events. They help find an option, but never stand for it. Page content is
// checked as well, so a site missing from these lists is still recognized by what it shows.
const JOB_AGGREGATOR = /(?:^|\.)(?:builtin\.com|builtinsf\.com|wellfound\.com|dice\.com|jobright\.ai|remoterocketship\.com|weworkremotely\.com|remotive\.com|flexjobs\.com|levels\.fyi|otta\.com|welcometothejungle\.com|dailyremote\.com|thejobsmap\.com|jobleads\.com|remotesource\.com|startup\.jobs|getlinora\.com|ecoroles\.com|designcodejobs\.com|remoteok\.com|himalayas\.app|workingnomads\.com|jobgether\.com|remote\.co|nodesk\.co|lensa\.com|adzuna\.com|careerjet\.com|hiring\.cafe)$/
const EVENT_AGGREGATOR = /(?:^|\.)(?:jazzdatebook\.com|stayhappening\.com|san-francisco\.events|allevents\.in|ma\.to|bayarearegistry\.com|sfstation\.com|funcheap\.com|do415\.com|songkick\.com|bandsintown\.com|jambase\.com|timeout\.com|offbeatsf\.com|jazzjams\.fyi)$/
const ROUNDUP = /\b(?:\d+\s+(?:best|top|great|fun|cool)|best\b.*\bin\b|top\s+\d+|things to do|ultimate guide|guide to)\b/i
const ATS = /^(?:jobs\.ashbyhq\.com|job-boards\.greenhouse\.io|boards\.greenhouse\.io|jobs\.lever\.co|apply\.workable\.com|jobs\.smartrecruiters\.com)$|\.myworkdayjobs\.com$/
const CLOSED = /(?:this (?:job|posting|position) (?:is no longer (?:available|open|accepting)|has been (?:closed|removed|filled))|(?:applications|this position) (?:are|is) (?:now )?closed|no longer accepting applications|listing (?:is )?(?:no longer available|unavailable)|event (?:has been )?cancell?ed|\bsold out\b|\bfully booked\b|registration (?:is )?closed)/i

/** A search result that is not worth reading at all, or the reason. Listing sites pass: they can lead to an option. */
export function sourceProblem(_topic: WebTopic, url: string, title: string): string | undefined {
  const site = host(url)
  if (SOCIAL.test(site)) return 'a review or social site, not the organizer’s page'
  if (WALLED_BOARD.test(site)) return 'a job board that hides its listings'
  if (ROUNDUP.test(title)) return 'a roundup article, not an organizer’s page'
  return undefined
}

// ---- Reading one page: its own option, not the listings around it ----

const MD_LINK = /\[([^\]]{0,300})\]\((https?:\/\/[^)\s]+)\)/g
const plainLine = (line: string) => line.replace(MD_LINK, '$1').replace(/^\s*(?:#{1,6}|[*-]|\d+\.)\s+/, '').replace(/[↗]/g, '').trim()
const RELATED = /^#{1,4}\s*(?:you (?:may|might) also like|related\b|more (?:events|classes|shows|jobs|like this|from)|similar\b|other (?:events|classes|jobs|shows)|recommended|explore more|also (?:on|at)\b|nearby\b|later upcoming|upcoming (?:events|shows))/i
/** Where a site's shared footer starts: contact details, every location, opening hours. */
const FOOTER = /^(?:contact(?: us)?|follow us|newsletter|subscribe|bottom of page|©.*|copyright\b.*)$/i
const pageLines = (page: EvidencePage) => page.excerpts.join('\n').split('\n')
// A footer marker is a plain line or heading in the second half of the text, never a menu item such as "* [Contact](…)".
const footerStart = (raw: string[]) => raw.findIndex((line, index) => index > Math.max(3, raw.length / 2) && !/^\s*(?:[*+-]|\d+\.)\s/.test(line) && !/\]\(/.test(line) && FOOTER.test(plainLine(line)))
/** The lines that describe the page's own option: links reduced to their words, related listings and the footer cut off. */
function itemLines(page: EvidencePage): string[] {
  const raw = pageLines(page)
  const cuts = [raw.findIndex((line, index) => index > 0 && RELATED.test(line.trim())), footerStart(raw)].filter(index => index >= 0)
  const cut = isEmpty(cuts) ? -1 : Math.min(...cuts)
  return [page.title, ...(cut < 0 ? raw : raw.slice(0, cut))].map(plainLine).filter(line => line && line !== '...')
}
/** The footer's lines, read only for a single-location organizer's address. */
function footerLines(page: EvidencePage): string[] {
  const raw = pageLines(page)
  const start = footerStart(raw)
  return start < 0 ? [] : raw.slice(start).map(plainLine).filter(Boolean)
}
const units = (page: EvidencePage) => itemLines(page).flatMap(line => line.split(/(?<=[.!?])\s+(?=[A-Z])/)).map(line => line.trim()).filter(Boolean)
const find = (page: EvidencePage, test: (line: string) => boolean) => units(page).find(test)
const itemText = (page: EvidencePage) => itemLines(page).join('\n')

const DAY_PATTERNS: Record<string, string> = { monday: 'mon', tuesday: 'tue', wednesday: 'wed', thursday: 'thu', friday: 'fri', saturday: 'sat', sunday: 'sun' }
function dayPattern(schedule: string): RegExp | undefined {
  const days = new Set<string>()
  const lower = schedule.toLowerCase()
  for (const [day, abbr] of Object.entries(DAY_PATTERNS)) if (lower.includes(day.slice(0, 5)) || lower.includes(day)) days.add(`${abbr}(?:${day.slice(3)})?s?\\.?`)
  if (/weekends?/.test(lower)) { days.add('sat(?:urday)?s?\\.?'); days.add('sun(?:day)?s?\\.?'); days.add('weekends?') }
  if (/weekdays?/.test(lower)) for (const [day, abbr] of Object.entries(DAY_PATTERNS).slice(0, 5)) days.add(`${abbr}(?:${day.slice(3)})?s?\\.?`)
  return days.size ? new RegExp(String.raw`\b(?:${[...days].join('|')})(?![a-z])`, 'i') : undefined
}
/** Any weekday mention, used to split a line into the sessions it lists. */
const ANY_DAY = /\b(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)s?\b\.?|\bweek(?:end|day)s?\b/gi
type Part = 'morning' | 'afternoon' | 'evening'
const TIME_TOKEN = /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m|p\.?m)\b/i
function wantedParts(schedule: string): Set<Part> {
  const parts = new Set<Part>()
  if (/\bmornings?\b/i.test(schedule)) parts.add('morning')
  if (/\bafternoons?\b/i.test(schedule)) parts.add('afternoon')
  if (/\b(?:evenings?|nights?)\b/i.test(schedule)) parts.add('evening')
  return parts
}
/** The part of day a session is in, read from its words or its start time. Opening hours over five hours say nothing. */
function partsOf(text: string): Set<Part> {
  const parts = wantedParts(text)
  if (/\btonight\b/i.test(text)) parts.add('evening')
  const range = /\b(\d{1,2})(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:[-–—]|to)\s*(\d{1,2})(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)/i.exec(text)
  const single = /\b(\d{1,2})(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)/i.exec(text)
  const clock = /\b([01]?\d|2[0-3]):[0-5]\d\b/.exec(text)
  const to24 = (hour: number, meridiem: string) => meridiem.startsWith('p') ? (hour % 12) + 12 : hour % 12
  let start: number | undefined
  if (range) {
    const endMeridiem = (range[4] ?? '').toLowerCase()
    const end = to24(Number(range[3]), endMeridiem)
    let begin = to24(Number(range[1]), (range[2] ?? endMeridiem).toLowerCase())
    if (begin > end && !range[2]) begin -= 12
    if (end - begin >= 5) return parts
    start = begin
  } else if (single) start = to24(Number(single[1]), (single[2] ?? '').toLowerCase())
  else if (clock && Number(clock[1]) >= 7) start = Number(clock[1])
  if (start !== undefined) parts.add(start < 12 ? 'morning' : start < 17 ? 'afternoon' : 'evening')
  return parts
}
const hasTime = (text: string) => TIME_TOKEN.test(text) || wantedParts(text).size > 0 || /\btonight\b/i.test(text)
/**
 * Matches the approved days and part of day within one session. "Saturday 10am–12pm · Wednesday 2–4pm" does not confirm
 * a Saturday afternoon: each weekday only takes the time that belongs to it.
 */
// Opening, shop and tour hours say when a place is open, not when a session runs.
const HOURS = /\b(?:shop|store|office|front desk|gallery hours|open(?:ing)? hours|hours of operation|business hours|open studio hours|studio hours|tours?|come by|we(?:'re| are) open)\b/i
function scheduleCheck(schedule: string, all: string[]): { status: CheckStatus; evidence?: string } {
  const lines = all.filter(line => !HOURS.test(line))
  const days = dayPattern(schedule); const wanted = wantedParts(schedule)
  const fits = (parts: Set<Part>) => [...wanted].some(part => parts.has(part))
  if (!days) {
    const line = wanted.size ? lines.find(item => fits(partsOf(item))) : undefined
    return line ? { status: 'confirmed', evidence: line } : { status: 'unknown' }
  }
  let conflict: string | undefined
  for (const [index, line] of lines.entries()) {
    const marks = [...line.matchAll(ANY_DAY)]
    for (const [k, mark] of marks.entries()) {
      if (!days.test(mark[0])) continue
      if (wanted.size === 0) return { status: 'confirmed', evidence: line }
      // "Saturday & Sunday 1–4pm": days joined by a connector share the time that follows them.
      let last = k
      while (marks[last + 1] && /^\s*(?:&|and|or|,|\/|-|–|through|to)\s*$/i.test(line.slice((marks[last]?.index ?? 0) + (marks[last]?.[0].length ?? 0), marks[last + 1]?.index))) last++
      const segment = line.slice(mark.index, marks[last + 1]?.index ?? line.length)
      let parts = partsOf(segment); let evidence = line
      const next = lines[index + 1] ?? ''
      // A session's time can sit on the line below its day, as long as that line starts nothing new.
      if (!hasTime(segment) && last === marks.length - 1 && !new RegExp(ANY_DAY.source, 'i').test(next) && isEmpty(datesIn(next, 2000))) { parts = partsOf(next); evidence = `${line} ${next}` }
      if (fits(parts)) return { status: 'confirmed', evidence }
      if (parts.size > 0) conflict ??= evidence
    }
  }
  return conflict ? { status: 'contradicted', evidence: conflict } : { status: 'unknown' }
}
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
function datesIn(line: string, year: number): string[] {
  const found: string[] = []
  for (const match of line.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) found.push(match.slice(1, 4).join('-'))
  for (const match of line.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/gi)) {
    const month = MONTHS.indexOf((match[1] ?? '').toLowerCase()) + 1
    found.push(`${match[3] ?? year}-${String(month).padStart(2, '0')}-${String(match[2]).padStart(2, '0')}`)
  }
  for (const match of line.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) found.push([match[3], String(match[1]).padStart(2, '0'), String(match[2]).padStart(2, '0')].join('-'))
  return found
}
/** Dates in a line with their year; a date without one is this year, or next year if that is more than six months ago. */
function datesOn(line: string, today: Date): string[] {
  const now = today.toISOString().slice(0, 10)
  const explicit = /\b\d{4}\b/.test(line)
  return datesIn(line, today.getFullYear()).map(date => {
    if (explicit || Date.parse(now) - Date.parse(date) <= 183 * 86400000) return date
    return `${today.getFullYear() + 1}${date.slice(4)}`
  })
}
const RECURRING = /\b(?:every|weekly|ongoing|drop[- ]in|(?:mon|tues|wednes|thurs|fri|satur|sun)days)\b/i
const SCHEDULE_LINE = /\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|\b\d{1,2}(?::\d{2})?\s*(?:a\.?m|p\.?m)\b|\b(?:session|class|classes|workshop|event|course|series|starts?|begins?)\b/i
const PRICE = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g
const PRICE_NOISE = /\b(?:parking|gift cards?|donat\w*|membership|members save|off\b|save \$|shipping|deposit)\b/i
/** Matches the approved city in text; "SF" counts for San Francisco only in capitals. */
function cityPattern(city: string): { test: (text: string) => boolean } {
  const names = [city, ...(/bay area/i.test(city) ? ['San Francisco', 'Oakland', 'Berkeley', 'Bay Area', 'San Jose', 'Albany', 'Emeryville', 'Alameda'] : [])]
  const named = new RegExp(String.raw`(?<![\p{L}])(?:${names.map(escape).join('|')})(?![\p{L}])`, 'iu')
  const short = /san francisco|bay area/i.test(city)
  return { test: text => named.test(text) || (short && /(?<![\p{L}])(?:SF|S\.F\.)(?![\p{L}])/u.test(text)) }
}
/** "2367 Shattuck Ave, Berkeley, CA" → Berkeley: where the option itself takes place. */
const CITY_STATE = /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2}),\s*(?:CA|California)\b/g
/** Lines that frame a listing ("Things to do in San Francisco") place nothing. */
const FRAMING = /\b(?:things to do|browse|all cities|near you|in your area|all events)\b/i
const US = /\b[Uu]nited [Ss]tates\b|\bU\.S\.|\bUSA\b|\bUS\b/
const OTHER_REGION = /\b(?:europe|emea|united kingdom|\buk\b|canada|latam|latin america|apac|asia|india|germany|poland|spain|portugal|brazil|mexico|australia|ireland|netherlands|france)\b/i
const HYBRID = /\b(?:hybrid|on[- ]?site|in[- ]office)\b/i

// ---- What kind of page this is: one option, a list of options, or someone else's listing ----

export type PageKind = { type: 'single' } | { type: 'listing' | 'third-party'; reason: string }
/** A title made only of category words: "Kids + families", "Events calendar", "Open roles". */
const LIST_TITLE_START = /^(?:(?:upcoming|all|our|current|kids|famil(?:y|ies)|events?|calendar|schedule|programs?|classes|workshops|activities|exhibitions?|what'?s on|things to do|listings?|jobs|careers|open|roles|positions|tickets|visit|plan your visit|learn|engage|and|for|\+|&)\s*)+$/i
const LIST_TITLE = /\b(?:events?|concerts|shows|gigs|things to do|listings|classes|workshops)\s+(?:in|near|around|this week|tonight|tomorrow|this weekend)\b|\bcalendar\b|\bschedule\s*(?:&|and)\s*(?:upcoming|tickets)|\bupcoming\s+(?:[\w-]+\s+){0,2}(?:shows|events|concerts)\b|\bevents\s*(?:&|and)\s*tickets\b|\bshows,\s*venues\b|[:|–]\s*(?:events|calendar|schedule|shows|jobs|careers)\s*(?:$|\|)/i
const LIST_COUNT = /\b(\d[\d,]*)\+?\s+(?:[A-Za-z-]+\s+){0,3}(?:events|shows|jobs|roles|openings|positions|listings|concerts|results|jam sessions)\b|\b(?:open roles|upcoming (?:shows|events)|companies hiring|jam sessions)\s+(\d[\d,]*)|^#\s.*\((\d[\d,]*)\)\s*$/gim
const OVERVIEW = /\bwe offer\b[^.\n]{0,40}\b(?:classes|workshops|courses|programs|memberships|events|lessons)\b[^.\n]{0,40}(?:,|\band\b)[^.\n]{0,40}\b(?:classes|workshops|courses|programs|memberships|events|lessons|rentals|parties)\b/i
const THIRD_PARTY = /\b(?:list your event|submit (?:an |your )?event|add (?:an |your )?event|promote your event|browse cities|all cities|search events|find events|events near you|get the app|apply now with|save this job|every save sharpens|jobs you may like|report this job|no longer available on)\b/i
function displayTitle(page: EvidencePage) {
  const raw = page.title.replace(/^job application for\s+/i, '').split(/\s+[|–—]\s+|\s+-\s+(?=[A-Z])|\s@\s/)[0]?.trim() || page.title || host(page.url)
  return clip(raw, 200)
}
/** Distinct named entries with their own date or time, e.g. a calendar of shows at different venues. */
function entryCount(page: EvidencePage): number {
  const names = new Set<string>()
  for (const line of page.excerpts.join('\n').split('\n').map(plainLine)) {
    if (!TIME_TOKEN.test(line) && isEmpty(datesIn(line, 2000))) continue
    const rest = line.replace(ANY_DAY, ' ').replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?/gi, ' ')
      .replace(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m|p\.?m)?\b|\b\d{4}\b/gi, ' ').replace(/[@·|,–—\-:/()$.]+/g, ' ')
      .replace(/\b(?:at|from|to|and|next|tonight|tomorrow|today|session|week|every)\b/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
    if (rest.split(' ').length >= 2) names.add(rest)
  }
  return names.size
}
function listingReason(topic: WebTopic, page: EvidencePage): string | undefined {
  const what = topic.category === 'job' ? 'a list of jobs' : 'a page listing several options'
  const title = displayTitle(page)
  const site = host(page.url)
  if (topic.category === 'job' && ATS.test(site) && pathParts(page.url).length < 2) return 'the employer’s list of jobs'
  const names = topic.category === 'job' && /\s(?:at|@)\s/.test(page.title)
  if (!names && (LIST_TITLE_START.test(title) || LIST_TITLE.test(page.title) || (topic.category === 'job' && /\b(?:jobs|roles|openings|positions)\b/i.test(title)))) return what
  // A page named after a place ("San Francisco – The Pottery Studio") or one that sums up all a studio offers is about
  // the organizer, not one class.
  if (topic.category !== 'job' && (topic.city && cityPattern(topic.city).test(title) && isEmpty(keywords(title.replace(new RegExp(escape(topic.city), 'i'), '').replace(/\b(?:SF|S\.F\.)\b/g, ''))))) return 'the organizer’s page for a whole location'
  if (topic.category !== 'job' && OVERVIEW.test(itemText(page))) return 'the organizer’s overview of everything it offers'
  const raw = page.excerpts.join('\n')
  const count = Math.max(0, ...[...raw.matchAll(LIST_COUNT)].map(match => Number((match[1] ?? match[2] ?? match[3] ?? '0').replace(/,/g, ''))))
  // Entries headed by their own link ("## [Design Engineer](…)"); menus of plain links are navigation, not entries.
  const linked = (raw.match(/^\s*(?:[*-]\s*)?#{2,4}\s*\[[^\]]{3,}\]\(https?:[^)]+\)/gm) ?? []).length
  return count >= 3 || linked >= 3 || entryCount(page) >= 4 ? what : undefined
}
/** Companies a job page names as the employer: "Design Engineer at Vercel", "Enode is hiring", "About Vercel:". */
function employerNames(page: EvidencePage): string[] {
  const names: string[] = []
  const at = /\s(?:at|@)\s+([A-Z0-9][\w&.'-]*(?:\s+[A-Z0-9][\w&.'-]*){0,3})/.exec(page.title)?.[1]
  if (at) names.push(at)
  const text = itemLines(page).slice(0, 40).join('\n')
  for (const pattern of [/\b([A-Z][\w&.'-]*(?:\s[A-Z][\w&.'-]*){0,2}) is (?:hiring|seeking|looking for)\b/, /\bAbout ([A-Z][\w&.'-]*(?:\s[A-Z][\w&.'-]*){0,2})\s*(?::|\n|$)/m, /\b(?:Company|Employer|Hiring company):\s*([A-Z][^\n,]{1,40})/]) {
    const name = pattern.exec(text)?.[1]
    if (name) names.push(name)
  }
  return [...new Set(names.map(name => name.replace(/[:.,]+$/, '').replace(/\s+(?:Careers|Jobs|Inc\.?|LLC)$/i, '').trim()))]
    .filter(name => name.length >= 2 && !/^(?:the|us|you|our|this|role|job|team|remote|company)$/i.test(name))
}
const ownsHost = (name: string, site: string) => { const label = comparable(owner(site)); const key = comparable(name); return label.length >= 3 && key.length >= 3 && (key.includes(label) || label.includes(key)) }
function thirdPartyReason(topic: WebTopic, page: EvidencePage): string | undefined {
  const site = host(page.url)
  const text = page.excerpts.join('\n')
  if (topic.category === 'job') {
    if (JOB_AGGREGATOR.test(site) || WALLED_BOARD.test(site) || THIRD_PARTY.test(text)) return 'a job board, not the employer'
    const names = employerNames(page)
    const named = names.at(0)
    if (!ATS.test(site) && named && !names.some(name => ownsHost(name, site))) return `a repost of ${named}’s job, not ${named}’s own listing`
    return undefined
  }
  if (EVENT_AGGREGATOR.test(site) || JOB_AGGREGATOR.test(site) || THIRD_PARTY.test(text)) return 'a listings site, not the organizer'
  return undefined
}
/** One option on its organizer's or employer's own page, or what the page is instead. */
export function pageKind(topic: WebTopic, page: EvidencePage): PageKind {
  const listing = listingReason(topic, page)
  const third = thirdPartyReason(topic, page)
  if (third) return { type: 'third-party', reason: third }
  return listing ? { type: 'listing', reason: listing } : { type: 'single' }
}

/** Where the option takes place: an address decides; a city named elsewhere only counts when no address is given. */
function placeCheck(city: string, page: EvidencePage): { status: CheckStatus; evidence?: string } {
  const pattern = cityPattern(city)
  const lines = units(page)
  const located = lines.flatMap(line => [...line.matchAll(CITY_STATE)].map(match => ({ line, city: match[1] ?? '' })))
  const here = located.find(item => pattern.test(item.city) || pattern.test(item.line.replace(CITY_STATE, '')))
  if (here) return { status: 'confirmed', evidence: here.line }
  const elsewhere = located.at(0)
  if (elsewhere) return { status: 'contradicted', evidence: elsewhere.line }
  // A footer address speaks for the option only when the organizer has one location.
  const footer = footerLines(page).flatMap(item => [...item.matchAll(CITY_STATE)].map(match => ({ line: item, city: match[1] ?? '' })))
  const footerCities = new Set(footer.map(item => item.city.toLowerCase()))
  const only = footerCities.size === 1 ? footer.at(0) : undefined
  if (only) return pattern.test(only.city) ? { status: 'confirmed', evidence: only.line } : { status: 'contradicted', evidence: only.line }
  const line = lines.find(item => pattern.test(item) && !FRAMING.test(item))
  if (line) return { status: 'confirmed', evidence: line }
  const online = lines.find(item => /\b(?:online only|virtual only|on zoom|via zoom)\b/i.test(item))
  return online ? { status: 'contradicted', evidence: online } : { status: 'unknown' }
}

/** Checks every material condition of the approved scope against one page. Unknown is never confirmed. */
export function pageChecks(topic: WebTopic, page: EvidencePage, today = new Date()): Check[] {
  const checks: Check[] = []
  const add = (id: string, label: string, status: CheckStatus, evidence?: string) => { checks.push({ id, label, status, ...(evidence ? { evidence: clip(evidence, 220) } : {}) }) }
  const kind = pageKind(topic, page)
  if (topic.category === 'job') {
    const site = host(page.url)
    const named = employerNames(page).find(name => ownsHost(name, site))
    // The page itself must be the employer's: its applicant-tracking listing, or a page whose employer owns the site.
    // Words such as "jobs" or "careers" in the address prove nothing.
    const own = ATS.test(site) ? `Listed on ${site}/${pathParts(page.url)[0] ?? ''}` : named ? `${named} lists this job on ${site}` : undefined
    add('employer', 'Employer’s own listing for this job', kind.type !== 'single' ? 'contradicted' : own ? 'confirmed' : 'unknown', kind.type !== 'single' ? kind.reason : own)
  } else add('source', 'Organizer’s page for this option', kind.type === 'single' ? 'confirmed' : 'contradicted', kind.type === 'single' ? undefined : kind.reason)
  const closed = find(page, line => CLOSED.test(line))
  add('open', topic.category === 'job' ? 'Accepting applications' : 'Not sold out or cancelled', closed ? 'contradicted' : 'confirmed', closed)
  if (topic.city && !topic.remoteOnly) {
    const place = placeCheck(topic.city, page)
    add('place', topic.city, place.status, place.evidence)
  }
  if (topic.schedule) {
    const schedule = scheduleCheck(topic.schedule, units(page))
    add('schedule', topic.schedule, schedule.status, schedule.evidence)
  }
  if (topic.start || topic.end) {
    const start = topic.start ?? '0000-01-01'; const end = topic.end ?? '9999-12-31'
    const year = Number((topic.start ?? today.toISOString()).slice(0, 4))
    const line = find(page, item => [year, year + 1].some(value => datesIn(item, value).some(date => date >= start && date <= end)))
    add('dates', topic.start && topic.end ? `${topic.start} to ${topic.end}` : topic.start ? `From ${topic.start}` : `Until ${topic.end ?? ''}`, line ? 'confirmed' : 'unknown', line)
  }
  if (topic.category !== 'job' && !topic.start && !topic.end) {
    // With no dates approved, an option still has to be ahead of us: a session whose only dates have passed is out.
    const now = today.toISOString().slice(0, 10)
    const dated = units(page).filter(line => SCHEDULE_LINE.test(line)).flatMap(line => datesOn(line, today).map(date => ({ line, date })))
    if (isNotEmpty(dated) && dated.every(item => item.date < now) && !units(page).some(line => RECURRING.test(line))) add('upcoming', 'Upcoming dates', 'contradicted', dated[0].line)
  }
  if (topic.maxPrice !== undefined) {
    const price = priceCheck(topic.maxPrice, units(page))
    add('price', topic.maxPrice === 0 ? 'Free' : `Up to $${topic.maxPrice}`, price.status, price.evidence)
  }
  if (topic.category === 'job' && topic.remoteOnly) {
    const region = topic.region ?? 'United States'
    const regionPattern = regionMatcher(region)
    const workplace = /(?:location type|workplace type|work arrangement)\s*:?\s*\n*\s*(hybrid|on[- ]?site)\b[^\n]*/i.exec(itemText(page))?.[0]
    const hybrid = workplace ?? find(page, line => HYBRID.test(line) && /\b(?:role|position|schedule|workplace|office)\b/i.test(line))
    const remoteElsewhere = (line: string) => /\bremote\b/i.test(line) && OTHER_REGION.test(line) && !regionPattern.test(line)
    // A short location line ("Remote - Europe") outweighs company boilerplate that mentions the US.
    const location = find(page, line => line.length <= 80 && remoteElsewhere(line))
    const remote = find(page, line => remoteIn(region, line))
    const elsewhere = find(page, remoteElsewhere)
    add('remote', `Remote · ${region}`, hybrid || location ? 'contradicted' : remote ? 'confirmed' : elsewhere ? 'contradicted' : 'unknown', hybrid ?? location ?? remote ?? elsewhere)
  }
  topic.conditions.forEach((condition, index) => {
    const line = find(page, item => conditionIn(condition, item))
    add(`condition-${index}`, condition, line ? 'confirmed' : 'unknown', line)
  })
  return checks
}
function priceCheck(maxPrice: number, lines: string[]): { status: CheckStatus; evidence?: string } {
  const priced = lines.filter(line => !PRICE_NOISE.test(line)).map(line => ({ line, prices: [...line.matchAll(PRICE)].map(match => Number((match[1] ?? '').replace(/,/g, ''))) })).filter(item => isNotEmpty(item.prices))
  const free = lines.find(line => /\bfree\b(?!\s+(?:parking|wifi|shipping|consultation|trial))/i.test(line) && !PRICE_NOISE.test(line))
  const within = priced.find(item => item.prices.some(price => price <= maxPrice))
  if (within) return { status: 'confirmed', evidence: within.line }
  if (free) return { status: 'confirmed', evidence: free }
  const over = priced.at(0)
  return over ? { status: 'contradicted', evidence: over.line } : { status: 'unknown' }
}
const regionMatcher = (region: string) => /united states|^us$|^usa$/i.test(region) ? US : new RegExp(escape(region), 'i')
const remoteIn = (region: string, line: string) => (/\bremote\b/i.test(line) && regionMatcher(region).test(line)) || (/united states|^us$|^usa$/i.test(region) && /remotely in the u\.s\.|u\.s\.[ -]remote|home teleworkers/i.test(line))
function conditionIn(condition: string, text: string) {
  const words = keywords(condition)
  return isNotEmpty(words) && words.filter(word => hasStem(text, word)).length >= Math.max(1, Math.ceil(words.length / 2))
}

/** Words that describe how an option runs rather than what it is; "weekly ceramics group" is about ceramics. */
const ATTRIBUTE = new Set(['weekly', 'monthly', 'daily', 'regular', 'group', 'groups', 'small', 'beginner', 'beginners', 'local', 'adult', 'adults', 'intro', 'introduction', 'casual', 'community', 'social', 'drop-in', 'friendly'])
/** A page about pottery is about ceramics: a few common names for the same activity. */
const SAME_THING: Record<string, string[]> = {
  cerami: ['pottery', 'clay', 'wheel', 'throwing', 'handbuilding'], potter: ['ceramics', 'clay', 'wheel', 'throwing', 'handbuilding'], clay: ['pottery', 'ceramics'],
  concer: ['show', 'gig', 'performance'], gig: ['concert', 'show'],
}
const matches = (text: string, word: string) => hasStem(text, word) || (SAME_THING[stem(word)] ?? []).some(other => hasStem(text, other))
/** Whether a page is about what the user approved; unrelated search results are dropped before checks. */
export function relevant(topic: WebTopic, page: EvidencePage): boolean {
  const all = keywords(topic.query)
  const core = all.filter(word => !ATTRIBUTE.has(word))
  const words = isEmpty(core) ? all : core
  if (isEmpty(words)) return true
  const text = `${page.title}\n${page.excerpts.join('\n')}`
  return words.filter(word => matches(text, word)).length >= Math.max(1, Math.ceil(words.length / 2))
}

export function verdictOf(checks: Check[]): Verdict {
  if (checks.some(check => check.status === 'contradicted')) return 'rejected'
  return checks.every(check => check.status === 'confirmed') ? 'confirmed' : 'incomplete'
}

function priceText(topic: WebTopic, checks: Check[], page: EvidencePage) {
  const evidence = checks.find(check => check.id === 'price' && check.status === 'confirmed')?.evidence
  if (evidence) {
    const prices = [...evidence.matchAll(PRICE)].map(match => ({ text: match[0].replace(/\s/g, ''), value: Number((match[1] ?? '').replace(/,/g, '')) }))
    const within = prices.find(price => price.value <= (topic.maxPrice ?? Infinity))
    return within?.text ?? (/\bfree\b/i.test(evidence) ? 'Free' : undefined)
  }
  if (topic.category === 'job') {
    const pay = /\$[\d,.]+[kK]?\s*[–—-]\s*\$[\d,.]+[kK]?/.exec(itemText(page))?.[0]
    return pay
  }
  const priced = (item: string) => /\$\s?\d/.test(item) && !PRICE_NOISE.test(item)
  const line = find(page, item => priced(item) && /\b(?:price|cost|fee|tuition|tickets?|admission|per (?:class|person|session|ticket)|each)\b/i.test(item)) ?? find(page, priced)
  return line ? /\$\s?\d[\d,]*(?:\.\d{1,2})?/.exec(line)?.[0]?.replace(/\s/g, '') : undefined
}
function whenText(checks: Check[]) {
  const evidence = checks.find(check => (check.id === 'schedule' || check.id === 'dates') && check.status === 'confirmed')?.evidence
  return evidence ? clip(evidence, 110) : undefined
}
function availabilityOf(page: EvidencePage, checks: Check[]): ExploreFinding['availability'] {
  if (find(page, line => /\b\d+\s+(?:spots?|seats?|places?|spaces?)\s+(?:left|available|remaining)\b|\b(?:spots?|seats?|spaces?) (?:are )?(?:still )?available\b/i.test(line))) return 'spots'
  if (checks.some(check => (check.id === 'schedule' || check.id === 'dates') && check.status === 'confirmed')) return 'schedule'
  const published = find(page, line => /\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i.test(line) && /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m|p\.?m)\b/i.test(line))
  return published ? 'schedule' : 'unknown'
}

/**
 * Whether a reviewer's quote states this very fact: a place quote must name the approved city, a schedule quote must hold
 * the approved day with its own time, and so on. A free-form condition may be confirmed in the page's own words.
 */
function supports(topic: WebTopic, check: Check, quote: string): boolean {
  if (check.id === 'place') return placeCheck(topic.city ?? '', { url: '', title: '', excerpts: [quote] }).status === 'confirmed'
  if (check.id === 'schedule') return scheduleCheck(topic.schedule ?? '', [quote]).status === 'confirmed'
  if (check.id === 'dates') return datesIn(quote, Number((topic.start ?? new Date().toISOString()).slice(0, 4))).some(date => date >= (topic.start ?? '0000') && date <= (topic.end ?? '9999'))
  if (check.id === 'price') return priceCheck(topic.maxPrice ?? 0, [quote]).status === 'confirmed'
  if (check.id === 'remote') return remoteIn(topic.region ?? 'United States', quote)
  // Whether a page is the organizer's or employer's own is read from the page, never taken from a reviewer.
  if (check.id === 'source' || check.id === 'employer' || check.id === 'open') return false
  return check.id.startsWith('condition-')
}
/**
 * Applies a reviewer agent's per-condition judgement. A status counts only with a quote from this option's own text
 * (not a related listing on the same page), and a confirmation only when the quote states that fact.
 */
export function applyAgentChecks(page: EvidencePage, checks: Check[], agent: readonly { id: string; status: CheckStatus; quote: string }[], topic?: WebTopic): Check[] {
  const text = flat(itemText(page))
  return checks.map(check => {
    if (check.status === 'contradicted') return check
    const judged = agent.find(item => item.id === check.id && item.status !== 'unknown')
    if (!judged || flat(judged.quote).length < 4 || !text.includes(flat(judged.quote))) return check
    if (judged.status === 'confirmed' && topic && !supports(topic, check, judged.quote)) return check
    return { ...check, status: judged.status, evidence: clip(judged.quote, 220) }
  })
}

export function reviewPage(topic: WebTopic, page: EvidencePage, checks = pageChecks(topic, page), checkedAt = Date.now()): Review {
  const verdict = verdictOf(checks)
  const missing = checks.filter(check => check.status === 'unknown').map(check => check.label)
  const wrong = checks.find(check => check.status === 'contradicted')
  const confirmed = checks.filter(check => check.status === 'confirmed' && check.id !== 'open' && check.id !== 'employer' && check.id !== 'source').map(check => check.label)
  const exceptions = /with the following exceptions:\s*([^.!\n]{2,70})|\bexcluding\s+([A-Z][^.!\n]{2,60})/.exec(itemText(page))
  const exception = exceptions?.[1] ?? exceptions?.[2]
  const where = topic.category === 'job' ? 'employer’s listing' : 'organizer’s page'
  const why = verdict === 'confirmed'
    ? isEmpty(confirmed) ? `Matches your search on the ${where}.` : `The ${where} confirms ${confirmed.join(', ')}${exception ? `, except ${exception.trim()}` : ''}.`
    : verdict === 'rejected' ? `${wrong?.label ?? 'A condition'} doesn’t match: ${wrong?.evidence ?? 'the page contradicts it'}` : `Not confirmed on the page: ${missing.join(', ')}.`
  const city = checks.find(check => check.id === 'place' && check.status === 'confirmed') ? topic.city : undefined
  const remote = checks.find(check => check.id === 'remote' && check.status === 'confirmed')?.label
  const when = whenText(checks)
  const price = priceText(topic, checks, page)
  const finding = ExploreFindingSchema.parse({
    id: `web:${normalizeUrl(page.url)}`.slice(0, 240), title: topic.category === 'job' ? displayTitle(page).replace(/\s+at\s+[A-Z][\w&.'-]*$/, '') : displayTitle(page),
    subtitle: clip([host(page.url), remote ?? city].filter(Boolean).join(' · '), 240),
    ...(when ? { when } : {}), ...(price ? { price } : {}),
    why: clip(why, 240), url: page.url, source: page.url, state: 'new', availability: topic.category === 'job' ? 'unknown' : availabilityOf(page, checks), checkedAt,
  })
  return { url: page.url, page, checks, verdict, reason: why, finding }
}

/** Deterministic search phrases: what the user wants, their confirmed conditions and the approved place and time. */
export function defaultQueries(topic: WebTopic): string[] {
  const terms = (text: string) => keywords(text).slice(0, 4).join(' ')
  const conditions = topic.conditions.map(terms).filter(Boolean).slice(0, 2).join(' ')
  if (topic.category === 'job') {
    const scope = topic.remoteOnly ? `remote ${topic.region ?? 'United States'}` : topic.city ?? ''
    return [`${topic.query} ${scope} job`, `${topic.query} ${scope} site:jobs.ashbyhq.com OR site:job-boards.greenhouse.io OR site:jobs.lever.co`].map(query => query.replace(/\s+/g, ' ').trim())
  }
  const own = new Set(keywords(topic.query))
  const context = topic.context.map(text => keywords(text).filter(word => !own.has(word)).slice(0, 4).join(' ')).filter(Boolean)[0]
  const kind = topic.category === 'event' ? 'tickets' : ''
  return [...new Set([
    [topic.query, conditions, topic.city, topic.schedule, kind].filter(Boolean).join(' '),
    ...(context ? [[context, topic.query, topic.city].filter(Boolean).join(' ')] : []),
  ].map(query => query.replace(/\s+/g, ' ').trim().slice(0, 160)))]
}
/**
 * Agent-written phrases may not widen the approved place or remote region. A job search always keeps one phrase aimed at
 * applicant-tracking systems, so employers' own listings are among the results and not only job boards.
 */
export function boundQueries(topic: WebTopic, queries: readonly string[]): string[] {
  const scoped = queries.map(query => query.replace(/\s+/g, ' ').trim()).filter(Boolean).map(query => {
    if (topic.city && !topic.remoteOnly && !cityPattern(topic.city).test(query)) return `${query} ${topic.city}`
    if (topic.remoteOnly && !/\bremote\b/i.test(query)) return `${query} remote ${topic.region ?? 'United States'}`
    return query
  })
  const unique = [...new Set(scoped.map(query => query.slice(0, 160)))]
  const ats = topic.category === 'job' && !unique.some(query => /\bsite:/i.test(query)) ? defaultQueries(topic).find(query => /\bsite:/i.test(query)) : undefined
  return ats ? [...unique.slice(0, 2), ats] : unique.slice(0, 3)
}

/** Preferences only reorder confirmed options; they never remove one. */
export function rankByPreference(topic: WebTopic, reviews: Review[]): Review[] {
  const score = (review: Review) => {
    const text = `${review.page.title}\n${review.page.excerpts.join('\n')}`
    const liked = topic.preferences.reduce((sum, preference) => sum + keywords(preference).filter(word => hasStem(text, word)).length, 0)
    return liked * 2 + (review.finding.availability === 'spots' ? 1 : 0) + (review.finding.when ? 0.5 : 0) + (review.finding.price ? 0.25 : 0)
  }
  return [...reviews].sort((a, b) => score(b) - score(a))
}

export const PlanSchema = z.object({ queries: z.array(z.string().min(2).max(160)).min(1).max(3), sources: z.string().min(1).max(200) })
export const ReviewSchema = z.object({ reviews: z.array(z.object({
  url: z.string(), checks: z.array(z.object({ id: z.string(), status: z.enum(['confirmed', 'contradicted', 'unknown']), quote: z.string().max(400) })).max(14),
})).max(8) })
export const RankSchema = z.object({ ids: z.array(z.string()).max(3) })
export type Ask = <T>(assignment: string, data: unknown, schema: z.ZodType<T>) => Promise<T>

export interface WebDeps {
  /** Asks a live agent; absent without a signed-in CLI, when deterministic planning and checks are used alone. */
  ask?: Ask
  search: (objective: string, queries: string[]) => Promise<EvidencePage[]>
  fetch: (objective: string, urls: string[]) => Promise<EvidencePage[]>
  /** Source-verified concert findings from Ticketmaster, when configured. Its failure never blocks web search. */
  ticketmaster?: (topic: WebTopic) => Promise<ExploreFinding[]>
  stage: (stage: 'discovery' | 'verification' | 'shortlist', status: 'running' | 'complete' | 'skipped', message: string) => void
  /** Receives the page behind each confirmed option, for agents that reason across interests. */
  record?: (evidence: { findingId: string; page: EvidencePage }[]) => void
  signal: AbortSignal
  now?: () => number
}

const quoted = (queries: string[]) => queries.map(query => `“${clip(query, 70)}”`).join(', ')
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

// ---- Following a listing to the option's own page ----

const ACTION = /\b(?:get tickets|buy tickets|tickets?|register|registration|rsvp|book(?: now| a spot| a class)?|reserve|sign up|enroll|apply(?: now| here| for this (?:job|role|position))?|official (?:site|page|website)|event (?:website|page)|show details|event details|view (?:event|job|class|details)|more info|details|learn more)\b/i
const NAV = /^(?:home|about(?: us)?|contact(?: us)?|log ?in|sign in|donate|shop|membership|privacy|terms|faq|search|menu|cart|next|previous|more|map|directions|open directions|share|\d+)$/i
const LIST_PATH = /\/(?:venues?|neighbou?rhoods?|musicians?|artists?|category|categories|tags?|cities|city|search|organi[sz]ers?)(?:\/|$)|(?:-jobs|\/jobs|\/events|\/calendar|\/shows\/[a-z-]+)\/?$/i
/**
 * Links on a listing that may lead to one option's own page: links named like the option, or a ticket, registration or
 * application link inside an entry about it. Category, venue and navigation links are left out.
 */
export function leadsFrom(topic: WebTopic, page: EvidencePage): string[] {
  const pageRelevant = relevant(topic, page)
  const scored = new Map<string, number>()
  let entry = ''
  for (const line of page.excerpts.join('\n').split('\n')) {
    if (/^\s*#{1,4}\s/.test(line) || /^\s*(?:[*-]|\d+\.)\s*\[/.test(line)) entry = plainLine(line)
    for (const match of line.matchAll(MD_LINK)) {
      const [, anchor = '', url = ''] = match
      const name = plainLine(anchor)
      if (!ExploreUrl.safeParse(url).success || normalizeUrl(url) === normalizeUrl(page.url) || SOCIAL.test(host(url)) || WALLED_BOARD.test(host(url)) || LIST_PATH.test(url) || NAV.test(name)) continue
      const about = { url, title: `${name} ${entry}`, excerpts: [plainLine(line)] }
      const named = name.length >= 3 && relevant(topic, { url, title: name, excerpts: [] })
      const action = ACTION.test(name) && (pageRelevant || relevant(topic, about))
      if (!named && !action) continue
      const score = (named ? 3 : 2) + (host(url) !== host(page.url) && action ? 1 : 0)
      scored.set(url, Math.max(score, scored.get(url) ?? 0))
    }
  }
  return [...scored.entries()].sort((a, b) => b[1] - a[1]).map(([url]) => url).slice(0, 6)
}

// ---- Ticketmaster findings meet the same approved scope ----

/** "Nov 15, 2026 · 19:30" → "Sunday, Nov 15, 2026 · 7:30 PM", so the day and part of day can be checked. */
function spokenWhen(when: string | undefined): string | undefined {
  const match = when ? /^([A-Z][a-z]{2} \d{1,2}, \d{4})(?: · (\d{1,2}):(\d{2}))?/.exec(when) : null
  if (!match?.[1]) return when
  const day = new Date(`${match[1]} 12:00:00 UTC`)
  if (Number.isNaN(day.getTime())) return when
  const weekday = day.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
  const hour = match[2] === undefined ? undefined : Number(match[2])
  const time = hour === undefined ? '' : ` · ${hour % 12 || 12}:${match[3] ?? '00'} ${hour < 12 ? 'AM' : 'PM'}`
  return `${weekday}, ${match[1]}${time}`
}
/**
 * Checks a Ticketmaster listing against the approved city, days, part of day and conditions. Its dates and price were
 * matched on the venue page before; a published date is a schedule, never a confirmed seat.
 */
export function ticketChecks(topic: WebTopic, finding: ExploreFinding, today = new Date()): { checks: Check[]; finding: ExploreFinding } {
  const when = spokenWhen(finding.when)
  const page = { url: finding.source, title: finding.title, excerpts: [[finding.subtitle, when, finding.price].filter(Boolean).join('\n')] }
  const { start: _start, end: _end, ...scope } = topic
  const checks = pageChecks(scope, page, today).filter(check => check.id !== 'source' && check.id !== 'upcoming')
  return { checks, finding: { ...finding, ...(when ? { when } : {}), availability: 'schedule' } }
}

/** Features that make two findings the same option: one address, or one title with the same time at the same organizer. */
function sameOptionKeys(finding: ExploreFinding): string[] {
  const site = host(finding.source).split('.').slice(-2).join('.')
  const title = comparable(finding.title)
  return [normalizeUrl(finding.url), normalizeUrl(finding.source), ...(title.length >= 4 ? [`${site}|${title}|${comparable(finding.when ?? '')}`] : [])]
}

export async function searchWebTopic(topic: WebTopic, deps: WebDeps): Promise<Extract<ExploreReport, { status: 'complete' }>> {
  const now = deps.now ?? Date.now
  const scope = [topic.city, topic.schedule, topic.start && topic.end ? `${topic.start}–${topic.end}` : undefined, topic.maxPrice !== undefined ? (topic.maxPrice === 0 ? 'free' : `up to $${topic.maxPrice}`) : undefined, topic.remoteOnly ? `remote ${topic.region ?? ''}`.trim() : undefined, ...topic.conditions].filter(Boolean)
  deps.stage('discovery', 'running', 'Choosing search phrases and sources.')
  let queries = defaultQueries(topic)
  let sources = topic.category === 'job' ? 'employer career pages and applicant tracking systems' : topic.category === 'event' ? 'venue and organizer pages' : 'organizer, studio and venue pages'
  if (deps.ask) {
    try {
      const plan = await deps.ask('Act as the Explore search planner. Write one to three short web search phrases that would surface organizer, venue or employer pages offering what the user wants. Use the goal, the confirmed conditions and the user context; use preferences only as optional wording. Keep the approved city, schedule, dates, budget and remote region; never widen them. Name the kind of pages to prefer in `sources`.', { goal: topic.title, query: topic.query, category: topic.category, scope, preferences: topic.preferences, context: topic.context }, PlanSchema)
      queries = boundQueries(topic, plan.queries)
      sources = clip(plan.sources, 120)
    } catch { deps.signal.throwIfAborted() }
  }
  const tm = deps.ticketmaster && topic.category === 'event' ? deps.ticketmaster(topic).then(findings => ({ findings, error: false }), () => { deps.signal.throwIfAborted(); return { findings: [] as ExploreFinding[], error: true } }) : undefined
  const results = await deps.search(`Find ${sources} for: ${topic.query}.${isNotEmpty(scope) ? ` Required: ${scope.join('; ')}.` : ''} Prefer the organizer's own page for one specific class, event or job, with its schedule, location and price.`, queries)
  const ticketed = tm ? await tm : undefined
  const seen = new Set<string>()
  const linked = topic.links.filter(link => { const key = normalizeUrl(link); if (seen.has(key)) return false; seen.add(key); return true })
  const dropped: string[] = []
  const found = results.filter(page => {
    const key = normalizeUrl(page.url)
    if (seen.has(key)) return false
    seen.add(key)
    const problem = sourceProblem(topic, page.url, page.title)
    if (problem) { dropped.push(problem); return false }
    if (!relevant(topic, page)) { dropped.push('unrelated'); return false }
    return true
  })
  // Listing sites are read last: they can only lead to an option's own page.
  const listed = (page: EvidencePage) => JOB_AGGREGATOR.test(host(page.url)) || EVENT_AGGREGATOR.test(host(page.url))
  const ordered = [...found.filter(page => !listed(page)), ...found.filter(listed)]
  const urls = [...linked, ...ordered.map(page => page.url)].slice(0, Math.max(6, linked.length))
  const extra = ticketed ? ticketed.error ? ' Ticketmaster was unavailable, so the web search carried on alone.' : ` Ticketmaster added ${plural(ticketed.findings.length, 'venue-checked listing')}.` : ''
  deps.stage('discovery', 'complete', `Searched ${quoted(queries)}${isNotEmpty(linked) ? ' and the link on your card' : ''}. Sources: ${sources.replace(/^prefer\s+/i, '')}. ${plural(urls.length, 'candidate page')} to check.${extra}`)
  const today = new Date(now())
  const tickets = (ticketed?.findings ?? []).map(finding => ticketChecks(topic, { ...finding, checkedAt: finding.checkedAt ?? now() }, today))
  const ticketFindings = tickets.filter(item => verdictOf(item.checks) === 'confirmed').map(item => item.finding)
  if (isEmpty(urls) && isEmpty(tickets)) {
    const note = `Web search found no organizer pages for “${clip(topic.query, 60)}”${topic.city && !topic.remoteOnly ? ` in ${topic.city}` : ''}. Try broader search words or fewer conditions.`
    deps.stage('verification', 'complete', `Nothing to check. ${note}`)
    deps.stage('shortlist', 'skipped', 'No confirmed options to rank.')
    return { sourceId: topic.sourceId, status: 'complete', findings: [], outcome: 'empty', candidates: 0, note, checkedAt: now() }
  }
  deps.stage('verification', 'running', `Reading ${plural(urls.length, 'page')} and checking ${isEmpty(scope) ? 'what each one offers' : scope.join(', ')}.`)
  const checkedAt = now()
  let reviews: Review[] = []
  // Listings, calendars and job boards are used to find candidates; the option itself is checked on its own page.
  const leads: { url: string; reason: string }[] = []
  const fetchedKeys = new Set(urls.map(normalizeUrl))
  let batch = urls
  for (let round = 0; round < 3 && isNotEmpty(batch); round++) {
    const fetched = await deps.fetch('Extract what is offered, its organizer, location, schedule or dates, price, availability (spots left, sold out, waitlist), links to individual events, classes or job listings, and for jobs the employer, workplace type and eligible regions.', batch)
    // Fetched pages carry the full text; search excerpts stand in for a page the fetch did not return.
    const byUrl = new Map([...(round === 0 ? results : []), ...fetched].map(page => [normalizeUrl(page.url), page]))
    const next: string[] = []
    for (const url of batch) {
      const page = byUrl.get(normalizeUrl(url))
      if (!page) continue
      if (round > 0 && !relevant(topic, page)) { dropped.push('unrelated'); continue }
      const kind = pageKind(topic, page)
      if (kind.type === 'single') { reviews.push(reviewPage(topic, page, pageChecks(topic, page, today), checkedAt)); continue }
      leads.push({ url: page.url, reason: kind.reason })
      for (const link of leadsFrom(topic, page)) if (!fetchedKeys.has(normalizeUrl(link)) && !sourceProblem(topic, link, '')) { fetchedKeys.add(normalizeUrl(link)); next.push(link) }
    }
    if (reviews.filter(review => review.verdict === 'confirmed').length >= 3) break
    batch = next.slice(0, 5)
    if (isNotEmpty(batch)) deps.stage('verification', 'running', `Following ${plural(batch.length, 'link')} from ${plural(leads.length, 'listing page')} to the ${topic.category === 'job' ? 'employers’ own listings' : 'organizers’ own pages'}.`)
  }
  if (deps.ask && isNotEmpty(reviews)) {
    try {
      const judged = await deps.ask('Act as the Explore evidence reviewer. Each page is one candidate option. For each page and each listed condition id, decide confirmed, contradicted or unknown using only that page’s text about this one option, never facts about another session, venue or listing. Quote the exact words from the page that state the fact; a quote that is not on the page, or that does not state that fact for this option, is ignored. A published schedule is not proof that spots are available. Unknown stays unknown.', {
        conditions: reviews[0].checks.map(check => ({ id: check.id, condition: check.label })),
        pages: reviews.map(review => ({ url: review.url, title: review.page.title, text: clip(itemText(review.page), 3500), pageChecks: review.checks.map(check => ({ id: check.id, status: check.status })) })),
      }, ReviewSchema)
      reviews = reviews.map(review => {
        const agent = judged.reviews.find(item => normalizeUrl(item.url) === normalizeUrl(review.url))
        return agent ? reviewPage(topic, review.page, applyAgentChecks(review.page, review.checks, agent.checks, topic), checkedAt) : review
      })
    } catch { deps.signal.throwIfAborted() }
  }
  const confirmed = reviews.filter(review => review.verdict === 'confirmed')
  const incomplete = reviews.filter(review => review.verdict === 'incomplete')
  const rejected = reviews.filter(review => review.verdict === 'rejected')
  // One option can surface from Ticketmaster, the card's link, a listing and web search: keep it once.
  const unique = new Map<string, ExploreFinding>()
  const taken = new Set<string>()
  for (const finding of [...ticketFindings, ...confirmed.map(review => review.finding)]) {
    const keys = sameOptionKeys(finding)
    if (keys.some(key => taken.has(key))) continue
    keys.forEach(key => taken.add(key))
    unique.set(finding.id, finding)
  }
  const missing = [...new Set(incomplete.flatMap(review => review.checks.filter(check => check.status === 'unknown').map(check => check.label)))]
  const leadText = isNotEmpty(leads) ? [`${plural(leads.length, 'listing page')} used only to find specific options (${[...new Set(leads.map(lead => lead.reason))].slice(0, 2).join('; ')})`] : []
  deps.stage('verification', 'complete', [
    `${plural(unique.size, 'option')} confirmed`, ...(isNotEmpty(incomplete) ? [`${incomplete.length} missing ${missing.slice(0, 2).join(' or ')}`] : []), ...(isNotEmpty(rejected) ? [`${rejected.length} didn’t match`] : []),
    ...(tickets.length > ticketFindings.length ? [`${tickets.length - ticketFindings.length} Ticketmaster ${tickets.length - ticketFindings.length === 1 ? 'listing' : 'listings'} outside your scope`] : []), ...leadText,
  ].join(' · ') + '.')
  if (unique.size === 0) {
    const outcome = isNotEmpty(incomplete) || (isEmpty(rejected) && isNotEmpty(leads)) ? 'incomplete' : 'rejected'
    const note = isNotEmpty(incomplete)
      ? `${plural(incomplete.length, 'page')} looked right, but none confirmed ${missing.slice(0, 2).join(' or ')}.`
      : isNotEmpty(rejected) ? `The pages found didn’t match: ${clip(rejected[0].reason, 160)}`
        : isNotEmpty(leads) ? `Only listing pages turned up; none led to ${topic.category === 'job' ? 'an employer’s own listing' : 'an organizer’s page'} that confirmed the details.`
          : 'The Ticketmaster listings found are outside your scope.'
    deps.stage('shortlist', 'skipped', 'No confirmed options to rank.')
    return { sourceId: topic.sourceId, status: 'complete', findings: [], outcome, candidates: reviews.length + leads.length + tickets.length, note, checkedAt }
  }
  deps.stage('shortlist', 'running', 'Ranking the confirmed options.')
  const byId = new Map(confirmed.map(review => [review.finding.id, review]))
  let order = [...ticketFindings.filter(finding => unique.has(finding.id)).map(finding => finding.id), ...rankByPreference(topic, confirmed.filter(review => unique.has(review.finding.id))).map(review => review.finding.id)]
  if (deps.ask && unique.size > 1) {
    try {
      const ranked = await deps.ask('Act as the Explore shortlist agent. Order up to three supplied option ids by how well they serve the goal and the soft preferences. Use only supplied ids.', { goal: topic.title, preferences: topic.preferences, options: [...unique.values()].map(finding => ({ id: finding.id, title: finding.title, when: finding.when, price: finding.price, why: finding.why })) }, RankSchema)
      const valid = ranked.ids.filter(id => unique.has(id))
      if (isNotEmpty(valid)) order = [...new Set([...valid, ...order])]
    } catch { deps.signal.throwIfAborted() }
  }
  const findings = order.slice(0, 3).flatMap(id => { const finding = unique.get(id) ?? byId.get(id)?.finding; return finding ? [finding] : [] })
  deps.record?.(findings.map(finding => {
    const page = byId.get(finding.id)?.page ?? { url: finding.source, title: finding.title, excerpts: [[finding.subtitle, finding.when, finding.price, finding.why].filter(Boolean).join('\n')] }
    return { findingId: finding.id, page }
  }))
  deps.stage('shortlist', 'complete', `Chose ${findings.map(finding => `“${clip(finding.title, 50)}”`).join(', ')}${isNotEmpty(topic.preferences) ? `, ranked by ${topic.preferences.slice(0, 2).join(' and ').toLowerCase()}` : ''}.`)
  return { sourceId: topic.sourceId, status: 'complete', findings, outcome: 'confirmed', candidates: reviews.length + leads.length + tickets.length, checkedAt }
}
