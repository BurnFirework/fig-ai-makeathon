import assert from 'node:assert/strict'
import { expect, test, type Page } from '@playwright/test'
import { ExploreRequestSchema, type ExploreReport } from '../shared/explore'
import type { AgentEvent } from '../shared/schema'

declare global { interface Window { exploreFixture: { requests: unknown[]; streams: ReadableStreamDefaultController<Uint8Array>[] } } }
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const panel = (page: Page) => page.getByRole('complementary', { name: 'Explore results' })
async function setup(page: Page) {
  await page.route('**/api/config', route => route.fulfill({ json: { mode: 'demo', provider: 'Preview', providers: [] } }))
  await page.addInitScript(() => {
    window.exploreFixture = { requests: [], streams: [] }
    const fetch = window.fetch.bind(window)
    window.fetch = (input, init) => {
      if (input === '/api/agent' && typeof init?.body === 'string') {
        const request: unknown = JSON.parse(init.body)
        if (typeof request === 'object' && request !== null && 'operation' in request && request.operation === 'explore') {
          window.exploreFixture.requests.push(request)
          // Intentionally ignores abort: the client must fence late responses itself.
          return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) { window.exploreFixture.streams.push(controller) } }), { headers: { 'Content-Type': 'application/x-ndjson' } }))
        }
      }
      return fetch(input, init)
    }
  })
  await page.goto('/')
  await button(page, 'Explore a sample board').click()
}
async function begin(page: Page, index: number, onlyOne = false) {
  await button(page, 'Explore board').click()
  if (onlyOne) while (await page.getByRole('checkbox', { checked: true }).count() > 1) await page.getByRole('checkbox', { checked: true }).last().click()
  await button(page, 'Find options').click()
  await expect.poll(() => page.evaluate(() => window.exploreFixture.requests.length)).toBe(index + 1)
  return ExploreRequestSchema.parse(await page.evaluate(index => window.exploreFixture.requests[index], index))
}
async function emit(page: Page, index: number, events: AgentEvent[], close = false) {
  await page.evaluate(({ index, events, close }) => {
    const stream = window.exploreFixture.streams[index]
    if (!stream) throw new Error('Missing fixture stream')
    stream.enqueue(new TextEncoder().encode(events.map(event => JSON.stringify(event)).join('\n') + '\n'))
    if (close) stream.close()
  }, { index, events, close })
}
const report = (sourceId: string, title: string, count = 1): ExploreReport => ({ sourceId, status: 'complete', checkedAt: Date.now(), findings: [], usedCardIds: [sourceId], developments: Array.from({ length: count }, (_, i) => ({ id: `local-${i}`, kind: 'idea', title: `${title} ${i}`, text: 'A proposed small experiment. Simulated UI response, not live research.', sources: [] })) })

test('incremental additions persist before final, stop fences late replies, and generated cards join larger independent runs', async ({ page }) => {
  await setup(page)
  const first = await begin(page, 0)
  expect(first.topics).toHaveLength(2)
  expect(first.board?.cards).toHaveLength(2)
  assert.ok(first.topics[0] && first.topics[1])
  const early = report(first.topics[0].sourceId, 'Early', 5)
  await emit(page, 0, [{ type: 'explore-report', report: early }])
  await button(page, 'Fit board').click()
  await expect(page.locator('.card-artifact')).toHaveCount(5)
  await panel(page).getByRole('button', { name: 'Stop', exact: true }).click()
  const late = report(first.topics[1].sourceId, 'Cancelled')
  await emit(page, 0, [{ type: 'explore-report', report: late }, { type: 'explore-result', result: { requestId: first.requestId, reports: [early, late] } }], true)
  await expect(panel(page).getByRole('status')).toHaveText('Search stopped')
  await expect(page.locator('.card-artifact')).toHaveCount(5)
  await page.reload()
  await button(page, 'Fit board').click()
  await expect(page.locator('.card-artifact')).toHaveCount(5)
  const next = await begin(page, 0)
  expect(next.topics).toHaveLength(7)
  expect(new Set(next.topics.map(topic => topic.sourceId)).size).toBe(7)
  expect(next.board?.cards).toHaveLength(7)
  const reports = next.topics.map((topic, i) => report(topic.sourceId, `Independent ${i}`))
  await emit(page, 0, [...reports.map(report => ({ type: 'explore-report' as const, report })), { type: 'explore-result', result: { requestId: next.requestId, reports } }], true)
  await expect(panel(page).getByRole('status')).toHaveText('7 options added to your board')
  await button(page, 'Fit board').click()
  await expect(page.locator('.card-artifact')).toHaveCount(12)
  await expect(page.getByRole('region', { name: 'Suggested shared step' })).toHaveCount(0)
})

test('source edits reject captured replies, retry reads current scope, and one card can run alone', async ({ page }) => {
  await setup(page)
  const first = await begin(page, 0)
  const goal = page.getByRole('textbox', { name: 'Inspiration goal', exact: true }).first()
  const original = await goal.inputValue()
  const source = first.topics.find(topic => topic.title === original)
  assert.ok(source)
  await goal.fill('Changed while research is running')
  await goal.blur()
  const stale = report(source.sourceId, 'Stale')
  await emit(page, 0, [{ type: 'explore-report', report: stale }, { type: 'explore-result', result: { requestId: first.requestId, reports: [stale] } }], true)
  await expect(panel(page).getByRole('status')).toHaveText('Search couldn’t finish')
  await expect(page.locator('.card-artifact')).toHaveCount(0)
  await panel(page).getByRole('button', { name: 'Retry', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.exploreFixture.requests.length)).toBe(2)
  const retry = ExploreRequestSchema.parse(await page.evaluate(() => window.exploreFixture.requests[1]))
  expect(retry.topics.find(topic => topic.sourceId === source.sourceId)?.title).toBe('Changed while research is running')
  await panel(page).getByRole('button', { name: 'Stop', exact: true }).click()
  await emit(page, 1, [{ type: 'explore-result', result: { requestId: retry.requestId, reports: [] } }], true)
  const one = await begin(page, 2, true)
  expect(one.topics).toHaveLength(1)
  expect(one.board?.cards).toHaveLength(2)
  assert.ok(one.topics[0])
  const complete = report(one.topics[0].sourceId, 'One owner')
  await emit(page, 2, [{ type: 'explore-report', report: complete }, { type: 'explore-result', result: { requestId: one.requestId, reports: [complete] } }], true)
  await expect(panel(page).getByRole('status')).toHaveText('1 option added to your board')
  await button(page, 'Fit board').click()
  await expect(page.locator('.card-artifact')).toHaveCount(1)
  await expect(page.locator('.stale-banner')).toHaveCount(0)
})
