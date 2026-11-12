import assert from 'node:assert/strict'
import { expect, test, type Page, type Route } from '@playwright/test'
import { ExploreRequestSchema, type ExploreRequest, type ExploreReport } from '../shared/explore'
import { runCoordinator } from '../shared/coordinator'
import { demoRuntime } from '../shared/preview'
import { RequestSchema } from '../shared/schema'

// Cards move from anywhere on them; their buttons, links and title fields keep working.
const pottery = 'Try a Saturday pottery wheel class'
const jobs = 'Remote design engineering roles'
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const results = (page: Page) => page.getByRole('complementary', { name: 'Explore results' })

async function only(page: Page, names: string[]) {
  const dialog = page.getByRole('dialog', { name: 'Explore board' })
  const selected = await dialog.getByRole('checkbox', { checked: true }).evaluateAll(inputs => inputs.map(input => input.getAttribute('aria-label')))
  for (const name of selected) if (name && !names.includes(name)) await dialog.getByRole('checkbox', { name, exact: true }).click()
}

type Reply = (request: ExploreRequest) => { reports: ExploreReport[]; shared?: unknown } | 'error' | 'hold'
async function stub(page: Page, reply: Reply) {
  const requests: ExploreRequest[] = []
  await page.route('**/api/config', route => route.fulfill({ json: { mode: 'demo', provider: 'Preview', providers: [] } }))
  await page.route('**/api/agent', async (route: Route) => {
    const body: unknown = route.request().postDataJSON()
    // Chat requests get the preview agents' answers; only Explore runs are scripted by the test.
    const chat = RequestSchema.safeParse(body)
    if (chat.success) return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'result', result: await runCoordinator(chat.data, demoRuntime(0), new AbortController().signal, () => {}) }) + '\n' })
    const request = ExploreRequestSchema.parse(body)
    requests.push(request)
    const answer = reply(request)
    if (answer === 'error') return route.fulfill({ status: 500, body: 'down' })
    if (answer === 'hold') { await new Promise(resolve => setTimeout(resolve, 4000)); return route.fulfill({ status: 500, body: 'late' }).catch(() => {}) }
    const workers = request.topics.flatMap(topic => (['discovery', 'verification', 'shortlist'] as const).map(stage => ({ type: 'explore-worker', worker: {
      id: `${topic.sourceId}:${stage}`, sourceId: topic.sourceId, stage, status: 'complete',
      label: stage === 'discovery' ? 'Search planner' : stage === 'verification' ? 'Source checker' : 'Shortlist agent',
      message: stage === 'discovery' ? `Searched “${topic.query}” for organizer pages. 3 candidate pages to check.` : stage === 'verification' ? '1 option confirmed · 2 didn’t match.' : 'Chose “Intro to the Wheel”.',
    } })))
    return route.fulfill({ contentType: 'application/x-ndjson', body: [...workers, { type: 'explore-result', result: { requestId: request.requestId, ...answer } }].map(event => JSON.stringify(event)).join('\n') + '\n' })
  })
  return requests
}
const found = (sourceId: string, id: string, title: string) => ({ sourceId, status: 'complete' as const, outcome: 'confirmed' as const, checkedAt: Date.now(), findings: [{
  id, title, subtitle: 'claystudio.example · San Francisco', when: 'Saturdays, 2:30pm–4:30pm', price: '$89', availability: 'schedule' as const,
  why: 'The organizer’s page confirms San Francisco, Saturday.', url: `https://example.com/${id}`, source: `https://example.com/${id}`, state: 'new' as const, checkedAt: Date.now(),
}] })
const none = (sourceId: string) => ({ sourceId, status: 'complete' as const, outcome: 'incomplete' as const, checkedAt: Date.now(), findings: [], note: '2 pages looked right, but none confirmed Saturday.' })
const titleOf = (request: ExploreRequest, sourceId: string) => request.topics.find(topic => topic.sourceId === sourceId)?.title

async function board(page: Page) {
  await page.goto('/')
  await button(page, 'Explore a sample board').click()
  const goals = page.getByRole('textbox', { name: 'Inspiration goal' })
  await expect(goals).toHaveCount(2)
  await goals.first().fill(pottery)
  await goals.first().blur()
  await goals.last().fill(jobs)
  await goals.last().blur()
  await button(page, 'Fit board').click()
}

const box = async (page: Page, selector: string) => {
  const bounds = await page.locator(selector).first().boundingBox()
  if (!bounds) throw new Error(`${selector} is not on screen.`)
  return bounds
}
async function drag(page: Page, from: { x: number; y: number }, by: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + by.x / 2, from.y + by.y / 2, { steps: 4 })
  await page.mouse.move(from.x + by.x, from.y + by.y, { steps: 4 })
  await page.mouse.up()
}

test('a card moves when dragged by its text or title; a click on the title edits it and buttons still act', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await stub(page, request => ({ reports: request.topics.map(topic => found(topic.sourceId, 'web:claystudio', 'Intro to the Wheel')) }))
  await board(page)

  // The goal field under the photo: a drag moves the card and does not start editing.
  const goal = page.getByRole('textbox', { name: 'Inspiration goal' }).first()
  const card = page.locator('.card-inspiration').first()
  const field = await goal.boundingBox()
  const before = await card.boundingBox()
  if (!field || !before) throw new Error('The first card is missing.')
  await drag(page, { x: field.x + 30, y: field.y + field.height / 2 }, { x: 140, y: 60 })
  const after = await card.boundingBox()
  expect(after && Math.abs(after.x - before.x - 140) < 12 && Math.abs(after.y - before.y - 60) < 12, JSON.stringify({ before, after })).toBe(true)
  await expect(goal).not.toBeFocused()
  // A plain click on it edits the goal.
  const moved = await goal.boundingBox()
  if (!moved) throw new Error('The goal field is missing.')
  await page.mouse.click(moved.x + 30, moved.y + moved.height / 2)
  await expect(goal).toBeFocused()
  await page.keyboard.press('Escape')

  // Found options: dragged by the text of an option, the whole card moves.
  await page.getByRole('button', { name: 'Explore board', exact: true }).click()
  await page.getByRole('button', { name: 'Find options', exact: true }).click()
  await expect(results(page).getByRole('status')).toHaveText(/added to your board/)
  await page.getByRole('button', { name: 'Close Explore results' }).click()
  const findings = page.locator('.card-findings').first()
  const start = await findings.boundingBox()
  const why = await box(page, '.card-findings .finding-why')
  if (!start) throw new Error('No found options card.')
  await drag(page, { x: why.x + 20, y: why.y + why.height / 2 }, { x: -80, y: 120 })
  const end = await findings.boundingBox()
  expect(end && Math.abs(end.x - start.x + 80) < 12 && Math.abs(end.y - start.y - 120) < 12, JSON.stringify({ start, end })).toBe(true)

  // Its buttons still act on a press instead of dragging.
  await page.getByRole('button', { name: 'Fit board', exact: true }).click()
  await findings.getByRole('button', { name: /^Dismiss / }).first().click()
  await expect(findings).toContainText('All findings dismissed.')
})
