import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeFindings, type ExploreFinding } from '../shared/explore'
import { verifiedJob, selectVerifiedFindings, runExplore, findingEvidence, verifiedEvent, emptySearchNote } from '../server/explore'

const url = 'https://jobs.ashbyhq.com/acme/role'
const lead = { job_id: 'feed-1', job_title: 'Design Technologist', employer_name: 'Acme', job_apply_link: url, job_description: '', job_posted_at_datetime_utc: '', employer_website: '' }
const page = { url, title: 'Design Technologist @ Acme', excerpts: ['# Design Technologist\n## Location\nMountain View\n## Location Type\nHybrid\n$110K – $170K'] }

const evidenceCheck = test('employer evidence excludes hybrid and Europe-only jobs from US remote results', () => {
  assert.equal(verifiedJob(lead, [page], true), undefined)
  const europe = { ...page, excerpts: ['# Design Technologist\n## Location\nRemote - Europe\n## Location Type\nRemote'] }
  assert.equal(verifiedJob(lead, [europe], true), undefined)
  const remote = { ...page, excerpts: ['# Design Technologist\n## Location\nRemote - US\n## Location Type\nRemote\nRequisition Number R8030\n$110K – $170K'] }
  const first = verifiedJob(lead, [remote], true)
  const duplicate = verifiedJob({ ...lead, job_id: 'feed-2' }, [remote], true)
  assert.equal(first?.id, 'job:acme:r8030')
  assert.equal(first.id, duplicate?.id)
  assert.equal(first.price, '$110K – $170K')
  const workday = { ...page, excerpts: ['Acme is hiring remote anywhere in the United States with the following exceptions: Hawaii and Alaska.\nEnd Date: December 4, 2026'] }
  assert.equal(verifiedJob(lead, [workday], true)?.when, 'Apply by December 4, 2026')
  assert.equal(verifiedJob(lead, [workday], true)?.why, 'US remote, except Hawaii and Alaska.')
})

const refreshCheck = test('a rerun updates existing findings by identity and preserves unmatched results', () => {
  const first: ExploreFinding = { id: 'ticketmaster:1', title: 'Jazz quartet', subtitle: 'Oakland', why: 'Fits your dates', url, source: url, state: 'new', price: '$35' }
  const previous = [first, { ...first, id: 'ticketmaster:2' }]
  const refreshed = mergeFindings(previous, [{ ...first, price: '$39' }, { ...first, id: 'ticketmaster:3' }])
  assert.deepEqual(refreshed.map(finding => [finding.id, finding.state, finding.price]), [
    ['ticketmaster:1', 'changed', '$39'], ['ticketmaster:3', 'new', '$35'], ['ticketmaster:2', 'seen', '$35'],
  ])
  assert.deepEqual(mergeFindings(previous, [{ ...first, price: '$39' }], false).map(finding => finding.id), ['ticketmaster:1'])
})

const cancellationCheck = test('cancelling Explore leaves all seven workers terminal without calling a provider', async () => {
  const controller = new AbortController()
  controller.abort()
  const events: import('../shared/schema').AgentEvent[] = []
  await assert.rejects(runExplore({ operation: 'explore', requestId: 'cancelled', topics: [
    { sourceId: 'music', title: 'Jazz', query: 'Jazz', dependencies: [{ id: 'music', revision: 0 }], kind: 'events', cities: ['Oakland'], start: '2026-11-11', end: '2026-11-30' },
    { sourceId: 'work', title: 'Design', query: 'Design engineer', dependencies: [{ id: 'work', revision: 0 }], kind: 'jobs', remoteOnly: true },
  ] }, controller.signal, event => events.push(event)))
  const workers = new Map(events.flatMap(event => event.type === 'explore-worker' ? [[event.worker.id, event.worker] as const] : []))
  assert.equal(workers.size, 7)
  assert.ok([...workers.values()].every(worker => worker.status === 'skipped'))
})

const selectionCheck = test('agent selections preserve verified records and reject invented findings', () => {
  const finding: ExploreFinding = { id: 'ticketmaster:1', title: 'Jazz', subtitle: 'Oakland', why: 'Verified', url, source: url, state: 'new' }
  assert.deepEqual(selectVerifiedFindings([finding.id, finding.id], [finding]), [finding])
  assert.throws(() => selectVerifiedFindings(['invented'], [finding]), /outside its verified input/)
})

const citationCheck = test('reviewers receive complete cited evidence even when it appears after other search results', () => {
  const source = 'https://venue.example/jazz'
  const finding: ExploreFinding = { id: 'jazz', title: 'Jazz', subtitle: 'Oakland', why: 'Verified', url, source, state: 'new' }
  const cited = { url: source, title: 'Jazz tickets', excerpts: ['Navigation '.repeat(600) + 'Tickets $33 on November 15'] }
  const unrelated = Array.from({ length: 11 }, (_, index) => ({ url: `https://unrelated.example/${index}`, title: 'Other', excerpts: [] }))
  assert.deepEqual(findingEvidence([finding], [...unrelated, cited, cited]), [cited])
})

const eventPriceCheck = test('event prices prefer structured provider data and exclude unrelated venue prices', () => {
  const eventUrl = 'https://www.ticketmaster.com/event/1'
  const venuePage = { url: 'https://jazzhouse.example/event/1', title: 'Jazz quartet', excerpts: ['# Other concert\n$0.00\n# Jazz quartet\nNovember 15, 2026\n$33 - $79'] }
  const event = { id: '1', name: 'Jazz quartet', url: eventUrl, dates: { start: { localDate: '2026-11-15', localTime: '19:00' } }, _embedded: { venues: [{ name: 'Jazz House', city: { name: 'Oakland' } }] } }
  const topic = { sourceId: 'jazz', title: 'Jazz', query: 'Jazz', dependencies: [{ id: 'jazz', revision: 1 }], kind: 'events' as const, cities: ['Oakland'], start: '2026-11-13', end: '2026-11-30', maxPrice: 60 }
  assert.equal(verifiedEvent(event, [venuePage], topic)?.price, '$33–$79')
  assert.equal(verifiedEvent({ ...event, priceRanges: [{ min: 40, max: 50, currency: 'USD' }] }, [venuePage], topic)?.price, '$40–$50')
})

const emptyCheck = test('an interest Ticketmaster does not list ends every agent with a plain reason', async () => {
  const realFetch = globalThis.fetch
  const keys = { composio: process.env.COMPOSIO_API_KEY, ticketmaster: process.env.TICKETMASTER_API_KEY }
  process.env.COMPOSIO_API_KEY = 'test'; process.env.TICKETMASTER_API_KEY = 'test'
  let calls = 0
  globalThis.fetch = () => { calls += 1; return Promise.resolve(new Response(JSON.stringify({ successful: true, data: { page: { totalElements: 0 } } }))) }
  try {
    const events: import('../shared/schema').AgentEvent[] = []
    const topic = (sourceId: string, query: string) => ({ sourceId, title: query, query, dependencies: [{ id: sourceId, revision: 0 }], kind: 'events' as const, cities: ['San Francisco'], start: '2026-11-11', end: '2026-12-11' })
    const result = await runExplore({ operation: 'explore', requestId: 'empty', topics: [topic('pottery', 'Try a Saturday pottery wheel class'), topic('people', 'Meet new people')] }, new AbortController().signal, event => events.push(event))
    const workers = new Map(events.flatMap(event => event.type === 'explore-worker' ? [[event.worker.id, event.worker] as const] : []))
    assert.equal(calls, 2, 'one provider search per interest and no page fetches for an empty list')
    assert.ok([...workers.values()].every(worker => worker.status === 'complete' || worker.status === 'skipped'))
    assert.match(workers.get('pottery:verification')?.message ?? '', /Ticketmaster lists no events for “Try a Saturday pottery wheel class” in San Francisco/)
    assert.equal(workers.get('pottery:shortlist')?.status, 'skipped')
    assert.match(workers.get('shared:synthesis')?.message ?? '', /no interest returned confirmed options/)
    const report = result.reports[0]
    assert.equal(report?.status === 'complete' && report.note, emptySearchNote(topic('pottery', 'Try a Saturday pottery wheel class'), 0))
  } finally {
    globalThis.fetch = realFetch
    process.env.COMPOSIO_API_KEY = keys.composio; process.env.TICKETMASTER_API_KEY = keys.ticketmaster
    if (keys.composio === undefined) delete process.env.COMPOSIO_API_KEY
    if (keys.ticketmaster === undefined) delete process.env.TICKETMASTER_API_KEY
  }
})

const emptyNoteCheck = test('empty searches separate "provider had nothing" from "sources did not confirm"', () => {
  const events = { sourceId: 'jazz', title: 'Jazz', query: 'Jazz', dependencies: [{ id: 'jazz', revision: 0 }], kind: 'events' as const, cities: ['Oakland'], start: '2026-11-11', end: '2026-11-30', maxPrice: 40 }
  assert.match(emptySearchNote(events, 3), /listed 3 events, but no venue or ticket page confirmed the date and price/)
  const jobs = { sourceId: 'work', title: 'Design', query: 'Design engineer', dependencies: [{ id: 'work', revision: 0 }], kind: 'jobs' as const, remoteOnly: true }
  assert.match(emptySearchNote(jobs, 0), /JSearch found no US remote jobs matching “Design engineer”/)
  assert.match(emptySearchNote(jobs, 1), /listed 1 job, but no employer listing confirmed US remote work/)
})

await Promise.all([evidenceCheck, refreshCheck, cancellationCheck, selectionCheck, citationCheck, eventPriceCheck, emptyCheck, emptyNoteCheck])
