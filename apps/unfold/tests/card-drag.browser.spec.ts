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

test('notes and steps move from their text; titles, checkboxes, evidence and links keep their own press', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await stub(page, request => {
    const reports = request.topics.map((topic, index) => ({
      ...found(topic.sourceId, 'web:shared-wheel', 'Intro to the Wheel'),
      ...(index === 0 ? { developments: [{ id: 'idea-1', kind: 'idea' as const, title: 'Sketch the wheel class first', text: 'Draw the studio before the class to warm up your hands.', sources: [{ title: 'Studio page', url: 'https://example.com/web:shared-wheel', quote: 'Beginners welcome every Saturday.' }] }] } : {}),
    }))
    return { reports, shared: { title: 'Take the wheel class together', summary: 'One class serves both ideas.', checkedAt: Date.now(), items: reports.map(report => ({ sourceId: report.sourceId, finding: report.findings[0] })) } }
  })
  await board(page)
  await page.getByRole('button', { name: 'Explore board', exact: true }).click()
  await page.getByRole('button', { name: 'Find options', exact: true }).click()
  await expect(results(page).getByRole('status')).toHaveText(/added to your board/)
  await results(page).getByRole('region', { name: 'Suggested shared step' }).getByRole('button', { name: 'Add to board' }).click()
  await page.getByRole('button', { name: 'Close Explore results' }).click()
  await page.getByRole('button', { name: 'Fit board', exact: true }).click()

  // A suggested note: its title field drags the card, a click edits it, and Enter saves the new title.
  const note = page.locator('.card-artifact', { hasText: 'Draw the studio' })
  const title = note.getByRole('textbox', { name: 'Card title' })
  const field = await title.boundingBox(), before = await note.boundingBox()
  if (!field || !before) throw new Error('The suggested note is missing.')
  await drag(page, { x: field.x + 40, y: field.y + field.height / 2 }, { x: 0, y: -90 })
  const after = await note.boundingBox()
  expect(after && Math.abs(after.y - before.y + 90) < 12 && Math.abs(after.x - before.x) < 12, JSON.stringify({ before, after })).toBe(true)
  await expect(title).not.toBeFocused()
  await title.click()
  await expect(title).toBeFocused()
  await page.keyboard.type(' today')
  await page.keyboard.press('Enter')
  await expect(title).toHaveValue('Sketch the wheel class first today')

  // Source evidence opens on a press, and a press on its link does not move the card.
  const placed = await note.boundingBox()
  await note.locator('summary', { hasText: 'Source evidence' }).click()
  await expect(note.locator('details')).toHaveAttribute('open')
  const link = await note.getByRole('link', { name: /Studio page/ }).boundingBox()
  if (!link || !placed) throw new Error('The evidence link is missing.')
  await page.context().route('https://example.com/**', route => route.fulfill({ body: 'ok' }))
  await drag(page, { x: link.x + 10, y: link.y + link.height / 2 }, { x: 60, y: 60 })
  const still = await note.boundingBox()
  expect(still && Math.abs(still.x - placed.x) < 2 && Math.abs(still.y - placed.y) < 2, JSON.stringify({ placed, still })).toBe(true)

  // The shared plan: a step's checkbox toggles without moving it, and its text drags it.
  const plan = page.locator('.card-explore-shared')
  const box1 = await plan.boundingBox()
  await plan.getByRole('checkbox').first().click()
  await expect(plan.getByRole('checkbox').first()).toHaveAttribute('aria-checked', 'true')
  const box2 = await plan.boundingBox()
  expect(box1 && box2 && Math.abs(box1.x - box2.x) < 2 && Math.abs(box1.y - box2.y) < 2).toBe(true)
  const step = await plan.locator('.action-steps li span').first().boundingBox()
  if (!step || !box2) throw new Error('The plan step is missing.')
  await drag(page, { x: step.x + 10, y: step.y + step.height / 2 }, { x: 70, y: 40 })
  const box3 = await plan.boundingBox()
  expect(box3 && Math.abs(box3.x - box2.x - 70) < 12 && Math.abs(box3.y - box2.y - 40) < 12, JSON.stringify({ box2, box3 })).toBe(true)
})

test('double-clicking a photo opens its conversation; double-clicking the goal only edits it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await stub(page, () => ({ reports: [] }))
  await board(page)
  const chat = page.getByRole('complementary', { name: 'Node conversation' })
  const goal = await page.getByRole('textbox', { name: 'Inspiration goal' }).first().boundingBox()
  if (!goal) throw new Error('The goal field is missing.')
  await page.mouse.dblclick(goal.x + 30, goal.y + goal.height / 2)
  await expect(page.getByRole('textbox', { name: 'Inspiration goal' }).first()).toBeFocused()
  await expect(chat).toBeHidden()
  await page.keyboard.press('Escape')
  const photo = await box(page, '.inspiration-image')
  await page.mouse.dblclick(photo.x + photo.width / 2, photo.y + photo.height / 2)
  await expect(chat).toBeVisible()
  await expect(page.locator('.chat-is-open')).toHaveCount(1)
})
