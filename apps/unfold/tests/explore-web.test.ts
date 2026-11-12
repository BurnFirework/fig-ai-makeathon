import { test } from 'node:test'
import { z } from 'zod'
import assert from 'node:assert/strict'
import { buildWebTopic, describeTopic, ExploreRequestSchema, mergeFindings, toWebTopic, type ExploreFinding, type ExploreReport, type WebTopic } from '../shared/explore'
import { NodeSchema, type AgentEvent } from '../shared/schema'
import { chooseSharedStep, runExplore } from '../server/explore'
import { applyAgentChecks, boundQueries, normalizeUrl, pageChecks, pageKind, ticketChecks } from '../server/explore-web'
import { classifyMessage, interpretMessage } from '../shared/memory'

// Every scenario runs the real Explore pipeline in its no-agent mode against stubbed Parallel and Ticketmaster
// responses. The stub records what the pipeline asked for, so the tests also check what was searched.

type Page = { url: string; title: string; excerpts: string[] }
interface Stub { search?: Page[] | 'fail'; pages?: Page[]; ticketmaster?: 'fail' | 'empty' }
interface Calls { queries: string[][]; fetched: string[][]; ticketmaster: number }

async function explore(topics: WebTopic[], stub: Stub, keys = false) {
  const realFetch = globalThis.fetch
  const saved = { composio: process.env.COMPOSIO_API_KEY, ticketmaster: process.env.TICKETMASTER_API_KEY }
  if (keys) { process.env.COMPOSIO_API_KEY = 'test'; process.env.TICKETMASTER_API_KEY = 'test' } else { delete process.env.COMPOSIO_API_KEY; delete process.env.TICKETMASTER_API_KEY }
  const calls: Calls = { queries: [], fetched: [], ticketmaster: 0 }
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const body: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : '{}')
    if (url.includes('composio')) {
      calls.ticketmaster++
      if (stub.ticketmaster === 'fail') return Promise.resolve(new Response('unavailable', { status: 503 }))
      return Promise.resolve(Response.json({ successful: true, data: { page: { totalElements: 0 } } }))
    }
    const { params } = z.object({ params: z.object({ name: z.string(), arguments: z.object({ search_queries: z.array(z.string()).optional(), urls: z.array(z.string()).optional() }) }) }).parse(body)
    let results: Page[]
    if (params.name === 'web_search') {
      calls.queries.push(params.arguments.search_queries ?? [])
      if (stub.search === 'fail') return Promise.resolve(new Response('busy', { status: 500 }))
      results = stub.search ?? []
    } else {
      const urls = params.arguments.urls ?? []
      calls.fetched.push(urls)
      const key = (value: string) => value.replace(/[?#].*$/, '').replace(/\/$/, '')
      const pool = [...(stub.pages ?? []), ...(Array.isArray(stub.search) ? stub.search : [])]
      results = urls.flatMap(item => pool.filter(page => key(page.url) === key(item)).slice(0, 1))
    }
    return Promise.resolve(new Response(`data: ${JSON.stringify({ result: { content: [{ text: JSON.stringify({ results }) }] } })}\n`))
  }
  const events: AgentEvent[] = []
  try {
    const request = ExploreRequestSchema.parse({ operation: 'explore', requestId: 'web', topics })
    const result = await runExplore(request, new AbortController().signal, event => events.push(event))
    const workers = new Map(events.flatMap(event => event.type === 'explore-worker' ? [[event.worker.id, event.worker] as const] : []))
    return { result, calls, workers, report: (sourceId: string) => result.reports.find(report => report.sourceId === sourceId) }
  } finally {
    globalThis.fetch = realFetch
    if (saved.composio === undefined) delete process.env.COMPOSIO_API_KEY; else process.env.COMPOSIO_API_KEY = saved.composio
    if (saved.ticketmaster === undefined) delete process.env.TICKETMASTER_API_KEY; else process.env.TICKETMASTER_API_KEY = saved.ticketmaster
  }
}
function complete(report: ExploreReport | undefined): Extract<ExploreReport, { status: 'complete' }> {
  if (report?.status !== 'complete') throw new assert.AssertionError({ message: `Expected a complete report, got ${JSON.stringify(report)}` })
  return report
}
const seed = (sourceId: string, title: string, conditions: string[] = [], links: string[] = []) => buildWebTopic({ sourceId, title, dependencies: [{ id: sourceId, revision: 1 }], conditions, links })

const cases: Promise<void>[] = []

cases.push(test('Saturday pottery in San Francisco: scope from the card and chat, one class confirmed on its studio page', async () => {
  const topic = seed('pottery', 'Try a Saturday pottery wheel class', ['Place: In San Francisco', 'Priority: Beginner-friendly', 'Company: small group'])
  assert.equal(topic.query, 'Pottery wheel class')
  assert.equal(topic.city, 'San Francisco')
  assert.equal(topic.schedule, 'Saturday')
  assert.deepEqual(topic.preferences, ['Small group preferred'])
  assert.equal(describeTopic(topic), 'Pottery wheel class · San Francisco · Saturday · Beginner-friendly')
  const studio = { url: 'https://claystudio.example/wheel-intro', title: 'Intro to the Wheel | Clay Studio', excerpts: ['Beginner wheel throwing class for adults.\nSaturdays, 2:30pm–4:30pm at our Mission studio, San Francisco.\n$89 per class. Small groups of 6.\n3 spots left this month.'] }
  const sundays = { url: 'https://potteryplace.example/classes', title: 'Pottery wheel classes for beginners', excerpts: ['Beginner wheel classes on Sundays in San Francisco. $75.'] }
  const roundup = { url: 'https://citymag.example/best-pottery', title: 'The 10 best pottery classes in San Francisco', excerpts: ['Beginner pottery wheel class Saturdays, San Francisco, $40'] }
  const review = { url: 'https://www.yelp.com/biz/clay', title: 'Clay Studio - Yelp', excerpts: ['Pottery wheel class Saturday San Francisco beginner'] }
  const { calls, report, workers } = await explore([topic], { search: [studio, sundays, roundup, review] })
  assert.match(calls.queries[0]?.[0] ?? '', /Pottery wheel class beginner-friendly San Francisco Saturday/i)
  assert.deepEqual(calls.fetched[0], [studio.url, sundays.url], 'roundups and review sites are never treated as organizer pages')
  const done = complete(report('pottery'))
  assert.equal(done.outcome, 'confirmed')
  assert.deepEqual(done.findings.map(finding => finding.url), [studio.url])
  const found = done.findings.at(0)
  assert.equal(found?.price, '$89')
  assert.equal(found.availability, 'spots')
  assert.match(found.when ?? '', /Saturdays, 2:30pm/)
  assert.match(found.why, /San Francisco, Saturday, Beginner-friendly/)
  assert.match(workers.get('pottery:verification')?.message ?? '', /1 option confirmed · 1 missing Saturday/)
}))

cases.push(test('chat answers that are not places, times or amounts never become search filters', () => {
  const topic = seed('pottery', 'Try a Saturday pottery wheel class', ['Place: Haven\'t booked yet', 'Time: Saturday afternoons', 'Company: Preferably in a small group', 'Budget: not much', 'Time: whenever works'])
  assert.equal(topic.city, undefined)
  assert.equal(topic.schedule, 'Saturday afternoons')
  assert.equal(topic.maxPrice, undefined)
  assert.deepEqual(topic.conditions, [])
  assert.deepEqual(topic.preferences, ['Small group preferred'])
  assert.deepEqual(topic.context, ['Place: Haven\'t booked yet', 'Budget: not much', 'Time: whenever works'])
  assert.equal(describeTopic(topic), 'Pottery wheel class · Saturday afternoons')
  assert.equal(seed('a', 'Pottery', ['Place: Oakland']).city, 'Oakland')
  assert.equal(seed('b', 'Pottery', ['Place: near the Mission']).city, undefined)
  assert.deepEqual(seed('c', 'Pottery', ['Priority: I prefer quiet studios']).preferences, ['Quiet studios preferred'])
}))

cases.push(test('a museum art program starts from the card link and keeps one finding across sources', async () => {
  const link = 'https://www.famsf.org/events/family-art-making'
  const topic = seed('museum', 'Free Family Art Making at de Young', ['Budget: free'], [link])
  assert.equal(topic.maxPrice, 0)
  const page = { url: link, title: 'Family Art Making | de Young', excerpts: ['Family Art Making. Saturdays, 11 am–3 pm. Free; no registration needed.\nde Young museum, Golden Gate Park, San Francisco.'] }
  const { calls, report } = await explore([topic], { search: [{ ...page, url: `${link}?utm_source=newsletter` }, { url: 'https://other.example/art', title: 'Adult watercolor night', excerpts: ['Watercolor for adults, $45'] }], pages: [page] })
  assert.deepEqual(calls.fetched.at(0), [link], 'the card’s link is checked first, and the same page from web search is not fetched again')
  const done = complete(report('museum'))
  assert.equal(done.findings.length, 1)
  assert.deepEqual(done.findings.map(finding => [finding.price, finding.availability]), [['Free', 'schedule']], 'a published schedule is not a confirmed seat')
}))

cases.push(test('a concert search carries on through the web when Ticketmaster is empty, failing or not configured', async () => {
  const topic = seed('jazz', 'Live jazz in Oakland')
  assert.equal(topic.category, 'event')
  assert.equal(topic.city, 'Oakland')
  const venue = { url: 'https://jazzroom.example/calendar/quartet', title: 'Late Set: Quartet Night | The Jazz Room', excerpts: ['Live jazz quartet, November 20 at 8pm. The Jazz Room, Oakland. Tickets $35.'] }
  for (const [ticketmaster, keys] of [['fail', true], ['empty', true], [undefined, false]] as const) {
    const { calls, report, workers } = await explore([topic], { search: [venue], ...(ticketmaster ? { ticketmaster } : {}) }, keys)
    assert.equal(calls.ticketmaster > 0, keys)
    const done = complete(report('jazz'))
    assert.deepEqual(done.findings.map(finding => finding.url), [venue.url])
    if (ticketmaster === 'fail') assert.match(workers.get('jazz:discovery')?.message ?? '', /Ticketmaster was unavailable/)
  }
}))

cases.push(test('a US remote job is confirmed only on the employer listing and only when its region matches', async () => {
  const topic = seed('work', 'Remote design engineering roles')
  assert.equal(topic.category, 'job')
  assert.equal(topic.remoteOnly, true)
  assert.equal(topic.region, 'United States')
  const europe = { url: 'https://job-boards.greenhouse.io/acme/jobs/1', title: 'Design Engineer @ Acme', excerpts: ['# Design Engineer\nLocation: Remote - Europe\nWe build design tools.'] }
  const us = { url: 'https://jobs.ashbyhq.com/beta/123', title: 'Design Engineer @ Beta', excerpts: ['# Design Engineer\nRemote - US.\nWe hire anywhere in the United States with the following exceptions: Hawaii and Alaska.\n$140K – $180K'] }
  const aggregator = { url: 'https://www.linkedin.com/jobs/view/999', title: 'Design Engineer - Gamma', excerpts: ['Remote, United States. Design engineering role.'] }
  const { calls, report } = await explore([topic], { search: [europe, us, aggregator] })
  assert.ok(calls.queries[0]?.some(query => /site:jobs\.ashbyhq\.com/.test(query)))
  assert.ok(calls.queries[0]?.every(query => /remote United States/.test(query)))
  const done = complete(report('work'))
  assert.deepEqual(done.findings.map(finding => finding.url), [us.url])
  assert.match(done.findings[0]?.why ?? '', /except Hawaii and Alaska/)
  assert.equal(done.findings[0]?.price, '$140K – $180K')
  assert.equal(pageChecks(topic, europe).find(check => check.id === 'remote')?.status, 'contradicted')
  // Phrases a planner agent writes keep one applicant-tracking search, so employers’ own listings are among the results.
  assert.ok(boundQueries(topic, ['remote design engineer jobs', 'design engineer careers']).some(query => /site:jobs\.ashbyhq\.com/.test(query)))
  assert.equal(normalizeUrl('https://jobs.ashbyhq.com/Ashby/fd86/application?embed=true'), normalizeUrl('https://jobs.ashbyhq.com/ashby/fd86'))
}))

cases.push(test('"Meet new people" searches with the conversation’s place and wish', async () => {
  const topic = seed('people', 'Meet new people', ['Place: In San Francisco', 'I want to meet people through a weekly hobby group'])
  assert.equal(topic.city, 'San Francisco')
  assert.equal(topic.query, 'Weekly hobby group', 'the wish names how to meet people, so it is what gets searched')
  assert.deepEqual(topic.context, ['I want to meet people through a weekly hobby group'])
  const group = { url: 'https://www.meetup.com/sf-board-games/', title: 'Weekly Board Game Night | SF Hobby Group', excerpts: ['Join our weekly hobby group to meet new people. Every Thursday 7pm in the Mission, San Francisco.'] }
  const { calls, report } = await explore([topic], { search: [group] })
  assert.ok(calls.queries[0]?.some(query => /Weekly hobby group San Francisco/.test(query)), JSON.stringify(calls.queries))
  assert.deepEqual(complete(report('people')).findings.map(finding => finding.url), [group.url])
}))

cases.push(test('one chat message about a weekly ceramics group carries the wish and the conditions into Explore', async () => {
  const text = 'I want to meet new people through a weekly ceramics group. In San Francisco. Saturday afternoons only. Preferably in a small group.'
  const drafts = interpretMessage(text, classifyMessage(text))
  assert.deepEqual(drafts.map(draft => [draft.kind, draft.text]), [
    ['constraint', 'Place: In San Francisco'], ['constraint', 'Time: Saturday afternoons only'], ['constraint', 'Company: Preferably in a small group'],
    ['intent', 'I want to meet new people through a weekly ceramics group'],
  ])
  const topic = seed('people', 'Meet new people', drafts.map(draft => draft.text))
  assert.equal(topic.query, 'Weekly ceramics group')
  assert.equal(topic.city, 'San Francisco')
  assert.equal(topic.schedule, 'Saturday afternoons')
  assert.deepEqual(topic.preferences, ['Small group preferred'])
  assert.deepEqual(topic.context, ['I want to meet new people through a weekly ceramics group'])
  assert.equal(describeTopic(topic), 'Weekly ceramics group · San Francisco · Saturday afternoons')
  const studio = { url: 'https://claycollective.example/saturday-wheel-group', title: 'Saturday Wheel Group | Clay Collective', excerpts: ['A weekly ceramics group for adults. Saturdays 1–3:30pm at 455 Valencia St, San Francisco, CA. Small groups of 8, meet fellow makers. $45 per session.'] }
  const { calls, report } = await explore([topic], { search: [studio] })
  assert.ok(calls.queries[0]?.every(query => /ceramics group/i.test(query)), JSON.stringify(calls.queries))
  assert.deepEqual(complete(report('people')).findings.map(finding => finding.url), [studio.url])
  // A message with only conditions, or a short reply, adds no stray wish.
  assert.deepEqual(interpretMessage('In Oakland, Sundays', 'answer').map(draft => draft.kind), ['constraint', 'constraint'])
  assert.deepEqual(interpretMessage('Sounds good. In Oakland', 'answer').map(draft => draft.kind), ['constraint'])
}))

cases.push(test('empty results, unconfirmed facts and technical failures stay distinct', async () => {
  const empty = await explore([seed('a', 'Try a Saturday pottery wheel class', ['Place: In San Francisco'])], { search: [] })
  assert.equal(complete(empty.report('a')).outcome, 'empty')
  const unknown = await explore([seed('b', 'Try a Saturday pottery wheel class', ['Place: In San Francisco'])], { search: [{ url: 'https://studio.example/wheel', title: 'Pottery wheel class', excerpts: ['Wheel classes in San Francisco. Call for times.'] }] })
  const incomplete = complete(unknown.report('b'))
  assert.equal(incomplete.outcome, 'incomplete')
  assert.equal(incomplete.findings.length, 0)
  assert.match(incomplete.note ?? '', /none confirmed Saturday/)
  const failed = await explore([seed('c', 'Try a Saturday pottery wheel class')], { search: 'fail' })
  assert.deepEqual(failed.report('c'), { sourceId: 'c', status: 'failed', message: 'Web search couldn’t finish. Retry in a moment.' })
}))

cases.push(test('a class whose only dates have passed is not confirmed, while a recurring one is', () => {
  const topic = seed('pottery', 'Try a Saturday pottery wheel class', ['Place: In San Francisco'])
  const today = new Date('2026-11-11T12:00:00Z')
  const past = { url: 'https://clayroom.example/intro', title: 'Intro to Clay', excerpts: ['Intro to Clay Saturday @11am-1:30pm, September 5th - October 10th. San Francisco.'] }
  assert.equal(pageChecks(topic, past, today).find(check => check.id === 'upcoming')?.status, 'contradicted')
  const next = { ...past, excerpts: ['Intro to Clay Saturday @11am-1:30pm, January 9th - February 13th. San Francisco.'] }
  assert.equal(pageChecks(topic, next, today).find(check => check.id === 'upcoming'), undefined)
  const recurring = { ...past, excerpts: ['Wheel class every Saturday at 2pm in San Francisco. Updated March 3, 2025.'] }
  assert.equal(pageChecks(topic, recurring, today).find(check => check.id === 'upcoming'), undefined)
}))

cases.push(test('an agent may only confirm a fact it quotes from this option’s text, and the quote must state that fact', () => {
  const topic = seed('pottery', 'Try a Saturday pottery wheel class', ['Priority: Beginner-friendly'])
  const page = { url: 'https://studio.example/wheel', title: 'Wheel class', excerpts: ['Pottery wheel class. No experience needed. Afternoon sessions on weekdays.\n## You may also like\nSaturday Raku firing, 2pm'] }
  const checks = pageChecks(topic, page)
  assert.equal(checks.find(check => check.id === 'schedule')?.status, 'unknown')
  assert.equal(checks.find(check => check.id === 'condition-0')?.status, 'unknown')
  const judge = (id: string, quote: string) => applyAgentChecks(page, checks, [{ id, status: 'confirmed', quote }], topic).find(check => check.id === id)?.status
  assert.equal(judge('condition-0', 'Every class is beginner-friendly'), 'unknown', 'a quote that is not on the page is ignored')
  assert.equal(judge('condition-0', 'No experience needed'), 'confirmed')
  assert.equal(judge('schedule', 'Afternoon sessions on weekdays'), 'unknown', 'a quote that is on the page but does not say Saturday confirms nothing')
  assert.equal(judge('schedule', 'Saturday Raku firing, 2pm'), 'unknown', 'a related listing on the same page is another option')
}))

cases.push(test('a job board’s list never becomes a confirmed job; the employer’s own listing it leads to does', async () => {
  const topic = seed('work', 'Remote design engineering roles')
  const board = { url: 'https://dailyremote.com/remote-design-jobs', title: 'Remote Design Jobs ($85K–$188K) | DailyRemote', excerpts: ['# Remote Design Jobs (3,343)\n## [Design Engineer](https://remotejobhub.example/jobs/acme-design-engineer) 17 applicants\nAcme · Full Time · 4 hours ago\nUnited States\n## [Product Designer](https://dailyremote.com/remote-job/product-designer-1)\nGamma · Contract'] }
  // A page on an unknown site with "jobs" in its address that reposts another company's job.
  const repost = { url: 'https://remotejobhub.example/jobs/acme-design-engineer', title: 'Design Engineer at Acme | RemoteJobHub', excerpts: ['# Design Engineer\nAcme is hiring a Design Engineer. Remote - United States.\n[Apply for this job](https://jobs.ashbyhq.com/acme/77)'] }
  const direct = { url: 'https://jobs.ashbyhq.com/acme/77', title: 'Design Engineer @ Acme', excerpts: ['# Design Engineer\nLocation: Remote - United States\nWe build design tools. $150K – $190K'] }
  assert.equal(pageKind(topic, board).type, 'third-party')
  assert.equal(pageChecks(topic, board).find(check => check.id === 'employer')?.status, 'contradicted')
  assert.equal(pageKind(topic, repost).type, 'third-party')
  assert.equal(pageChecks(topic, repost).find(check => check.id === 'employer')?.status, 'contradicted', 'jobs in the address does not make it the employer’s page')
  assert.equal(pageKind(topic, { url: 'https://careers.figma.com/jobs/1', title: 'Design Engineer at Figma', excerpts: ['About Figma: we build design tools.'] }).type, 'single')
  const { calls, report, workers } = await explore([topic], { search: [board], pages: [repost, direct] })
  assert.deepEqual(calls.fetched.flat(), [board.url, repost.url, 'https://dailyremote.com/remote-job/product-designer-1', direct.url])
  const done = complete(report('work'))
  assert.deepEqual(done.findings.map(finding => finding.url), [direct.url])
  assert.match(done.findings[0]?.why ?? '', /^The employer’s listing confirms Remote · United States/)
  assert.match(workers.get('work:verification')?.message ?? '', /listing pages? used only to find specific options \(a job board, not the employer/)
}))

cases.push(test('a third-party show calendar leads to the venue’s concert page, which is what reaches the board', async () => {
  const topic = seed('jazz', 'Live jazz in San Francisco')
  const calendar = { url: 'https://jazzlistings.example/sf', title: 'Live Jazz in SF Bay | Shows, Venues & Calendar', excerpts: ['# Live Jazz in SF Bay\nList your event\n### Tierney Sutton Duo\n[SFJAZZ Center](https://jazzlistings.example/sf/venue/sfjazz-center) / San Francisco\nSat, Nov 21, 7:30 PM [Get tickets ↗](https://www.sfjazz.org/tickets/tierney-sutton)\n### Will Bernard Trio\nSun, Nov 22, 6:00 PM Mr. Tipple’s, 39 Fell St, San Francisco, CA\n### Late jam\nFri, Nov 20, 9 PM, 2020 Addison St, Berkeley, CA'] }
  const show = { url: 'https://www.sfjazz.org/tickets/tierney-sutton', title: 'Tierney Sutton Duo | SFJAZZ', excerpts: ['Tierney Sutton Duo. Live jazz vocals.\nSaturday, November 21, 2026 at 7:30 PM\nSFJAZZ Center, 201 Franklin St, San Francisco, CA. Tickets $45–$85.'] }
  // An event page on a listings site, with no link to its organizer, cannot stand for the show.
  const listed = { url: 'https://jazzlistings.example/event/42', title: 'Bay jazz brunch | Jazz Listings', excerpts: ['Live jazz brunch. Sunday, November 22, 11am. San Francisco. Submit your event to reach more fans.'] }
  for (const [ticketmaster, keys] of [['empty', true], [undefined, false]] as const) {
    const { calls, report } = await explore([topic], { search: [calendar, listed], pages: [show], ...(ticketmaster ? { ticketmaster } : {}) }, keys)
    assert.ok(calls.fetched[1]?.includes(show.url), JSON.stringify(calls.fetched))
    const done = complete(report('jazz'))
    assert.deepEqual(done.findings.map(finding => finding.url), [show.url])
    assert.equal(done.findings[0]?.availability, 'schedule')
  }
}))

cases.push(test('an address in Berkeley rules out a San Francisco search, and another session’s time does not confirm the wanted one', () => {
  const jazz = seed('jazz', 'Live jazz in San Francisco')
  const berkeley = { url: 'https://freight.example/quartet', title: 'Quartet Night | Freight', excerpts: ['Jazz across San Francisco and the Bay Area\nQuartet Night\nSaturday, Nov 21, 8pm\nFreight & Salvage, 2020 Addison St, Berkeley, CA 94704'] }
  assert.equal(pageChecks(jazz, berkeley).find(check => check.id === 'place')?.status, 'contradicted')
  const pottery = seed('pottery', 'Try a pottery wheel class', ['Place: In San Francisco', 'Time: Saturday afternoons'])
  const schedule = (excerpt: string) => pageChecks(pottery, { url: 'https://clayco.example/wheel', title: 'Wheel Basics | Clay Co', excerpts: [`${excerpt}\n123 Valencia St, San Francisco, CA`] }).find(check => check.id === 'schedule')?.status
  assert.equal(schedule('Saturday, Nov 14 · 10am–12pm · Wednesday, Nov 18 · 2–4pm'), 'contradicted')
  assert.equal(schedule('Saturdays 10am–12pm\nWednesdays 2–4pm'), 'contradicted')
  assert.equal(schedule('Saturday, Nov 14\nWednesday, Nov 18, 2–4pm'), 'unknown')
  assert.equal(schedule('Saturday & Sunday 1–4pm'), 'confirmed')
  assert.equal(schedule('Saturday, Nov 14\n2:00–4:00 pm'), 'confirmed')
  assert.equal(schedule('Open Saturday 10am – 9pm'), 'unknown', 'opening hours are not a session time')
  assert.equal(schedule('Come by for a tour or to sign up in our shop: Tuesday, Thursday, Saturday noon to 4pm'), 'unknown', 'shop and tour hours are not a session')
  // A studio's page for a whole location, or its overview of everything it offers, only leads to a class.
  assert.equal(pageKind(pottery, { url: 'https://thepotterystudio.example/pages/san-francisco', title: 'SAN FRANCISCO – The Pottery Studio', excerpts: ['Our location in the Mission District.'] }).type, 'listing')
  assert.equal(pageKind(pottery, { url: 'https://studio.example/about', title: 'About us', excerpts: ['We offer classes, memberships, and workshops for all levels.'] }).type, 'listing')
}))

cases.push(test('Ticketmaster listings meet the same city, days and conditions, and a date is a schedule, not a seat', () => {
  const topic = seed('jazz', 'Live jazz in San Francisco', ['Time: Saturday evenings'])
  const listing: ExploreFinding = { id: 'ticketmaster:1', title: 'Quartet Night', subtitle: 'SFJAZZ Center · San Francisco', when: 'Nov 21, 2026 · 19:30', price: '$45–$85', why: 'Venue page', url: 'https://www.ticketmaster.com/event/1', source: 'https://www.sfjazz.org/q', state: 'new' }
  const fits = ticketChecks(topic, listing)
  assert.ok(fits.checks.every(check => check.status === 'confirmed'), JSON.stringify(fits.checks))
  assert.equal(fits.finding.when, 'Saturday, Nov 21, 2026 · 7:30 PM')
  assert.equal(fits.finding.availability, 'schedule')
  assert.equal(ticketChecks(topic, { ...listing, subtitle: 'Freight & Salvage · Berkeley, CA' }).checks.find(check => check.id === 'place')?.status, 'contradicted')
  assert.equal(ticketChecks(topic, { ...listing, when: 'Nov 22, 2026 · 19:30' }).checks.find(check => check.id === 'schedule')?.status, 'unknown', 'a Sunday show is not a Saturday one')
  assert.equal(ticketChecks(topic, { ...listing, when: 'Nov 21, 2026 · 13:00' }).checks.find(check => check.id === 'schedule')?.status, 'contradicted')
}))

cases.push(test('Family Art Making is kept as one program; general Kids + families pages only lead to it', async () => {
  const topic = seed('museum', 'Family Art Making at the de Young', ['Budget: free'])
  const general = (url: string) => ({ url, title: 'Kids + families | Fine Arts Museums of San Francisco', excerpts: ['Kids + families\nJump to\n* What\'s on\nBe curious with us! Join us every Saturday for [Family Art Making](https://www.famsf.org/events/family-art-making), free with museum admission.\n* [Tips for visiting with kids](https://www.famsf.org/visit/kids)'] })
  const program = { url: 'https://www.famsf.org/events/family-art-making', title: 'Family Art Making | Fine Arts Museums of San Francisco', excerpts: ['Family Art Making\nSaturdays, 10:30 am–12:30 pm\nFree; no registration needed. de Young, Golden Gate Park, San Francisco, CA'] }
  const copy = { ...program, url: 'https://www.famsf.org/index.php/events/family-art-making' }
  const { report, workers } = await explore([topic], { search: [general('https://www.famsf.org/kids-families'), general('https://www.famsf.org/learn-engage/kids-families'), copy], pages: [program] })
  const done = complete(report('museum'))
  assert.deepEqual(done.findings.map(finding => finding.title), ['Family Art Making'])
  assert.match(workers.get('museum:verification')?.message ?? '', /1 option confirmed · 2 listing pages used only to find specific options/)
}))

cases.push(test('a shared step needs one option that serves several goals; jazz and jobs never make one', async () => {
  const jazz = seed('jazz', 'Live jazz in Oakland')
  const work = seed('work', 'Remote design engineering roles')
  const venue = { url: 'https://jazzroom.example/calendar/quartet', title: 'Late Set: Quartet Night | The Jazz Room', excerpts: ['Live jazz quartet, November 20 at 8pm. The Jazz Room, Oakland. Tickets $35.'] }
  const job = { url: 'https://jobs.ashbyhq.com/beta/123', title: 'Design Engineer @ Beta', excerpts: ['# Design Engineer\nRemote - US.\n$140K – $180K'] }
  const both = await explore([jazz, work], { search: [venue, job] })
  assert.equal(both.result.shared, undefined)
  assert.match(both.workers.get('shared:synthesis')?.message ?? '', /^No shared step\./)
  const items = [{ sourceId: 'jazz', finding: complete(both.report('jazz')).findings[0] }, { sourceId: 'work', finding: complete(both.report('work')).findings[0] }].flatMap(item => item.finding ? [{ sourceId: item.sourceId, finding: item.finding }] : [])
  const pages = new Map(items.map(item => [item.finding.id, item.sourceId === 'jazz' ? venue : job]))
  const jazzId = items[0]?.finding.id ?? ''
  const claimed = chooseSharedStep([jazz, work], items, pages, { decision: 'shared', reason: 'Both are worth doing.', findingId: jazzId, serves: ['jazz', 'work'], quote: 'Live jazz quartet', title: 'Review SF jazz shows and remote design engineering roles', summary: 'Check the show, then apply.' })
  assert.equal(claimed.shared, undefined, 'a jazz page says nothing about design roles')
  assert.equal(chooseSharedStep([jazz, work], items, pages, { decision: 'none', reason: 'Each option serves its own goal.' }).shared, undefined)

  // A weekly group wheel class serves a creative practice and meeting people when its page confirms both.
  const craft = seed('craft', 'Explore a creative practice', ['I want to try pottery'])
  const people = seed('people', 'Meet new people', ['I want to meet new people through a weekly ceramics group', 'Place: In San Francisco'])
  const studio = { url: 'https://claycollective.example/saturday-wheel-group', title: 'Saturday Wheel Group | Clay Collective', excerpts: ['A weekly ceramics group for adults learning pottery on the wheel. Saturdays 1–3:30pm at 455 Valencia St, San Francisco, CA. Small groups of 8, meet fellow makers.'] }
  const run = await explore([craft, people], { search: [studio] })
  assert.deepEqual(run.result.shared?.items.map(item => [item.sourceId, item.finding.url]), [['craft', studio.url], ['people', studio.url]], 'without an agent, the same option confirmed for both ideas is suggested')
  const first = run.result.shared.items.at(0)
  assert.ok(first)
  const finding = first.finding
  const agreed = chooseSharedStep([craft, people], [{ sourceId: 'craft', finding }], new Map([[finding.id, studio]]), { decision: 'shared', reason: 'The page confirms a weekly group format.', findingId: finding.id, serves: ['craft', 'people'], quote: 'A weekly ceramics group for adults', title: 'Join the Saturday wheel group', summary: 'A weekly small-group wheel class builds a pottery practice and puts you among the same people every week.' })
  assert.deepEqual(agreed.shared?.items.map(item => item.sourceId), ['craft', 'people'])
}))

cases.push(test('saved Events and Jobs searches still load and rerun as web searches; old findings keep their check date', () => {
  const events = { kind: 'events' as const, sourceId: 'jazz', title: 'Live jazz', query: 'Jazz', dependencies: [{ id: 'jazz', revision: 1 }], cities: ['Oakland'], start: '2026-11-13', end: '2026-11-30', maxPrice: 60 }
  const jobs = { kind: 'jobs' as const, sourceId: 'work', title: 'Design roles', query: 'Design Engineer OR Design Technologist', dependencies: [{ id: 'work', revision: 1 }], remoteOnly: true }
  const finding: ExploreFinding = { id: 'ticketmaster:1', title: 'Jazz quartet', subtitle: 'Oakland', why: 'Fits your dates', url: 'https://example.com/a', source: 'https://example.com/a', state: 'new' }
  const node = { branchId: 'jazz', sequence: 1, revision: 0, stale: false, dependsOn: [], agent: 'research', createdAt: 1, type: 'findings', topic: events, checkedAt: 1000, findings: [finding], dismissed: [] }
  assert.ok(NodeSchema.safeParse(node).success)
  assert.ok(NodeSchema.safeParse({ ...node, topic: jobs }).success)
  assert.deepEqual(toWebTopic(events), { ...toWebTopic(events), kind: 'web', category: 'event', city: 'Oakland', start: '2026-11-13', end: '2026-11-30', maxPrice: 60 })
  assert.equal(toWebTopic(jobs).query, 'Design Engineer')
  assert.equal(toWebTopic(jobs).region, 'United States')
  const merged = mergeFindings([finding, { ...finding, id: 'ticketmaster:2', checkedAt: 2000 }], [{ ...finding, checkedAt: 5000 }], true, 1000)
  assert.deepEqual(merged.map(item => [item.id, item.checkedAt]), [['ticketmaster:1', 5000], ['ticketmaster:2', 2000]])
  assert.equal(mergeFindings([finding], [], true, 1000)[0]?.checkedAt, 1000, 'an unchecked old finding keeps the group’s earlier check date')
}))

await Promise.all(cases)
