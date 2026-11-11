import { expect, test, type Page, type Route } from '@playwright/test'
import { ExploreRequestSchema, type ExploreRequest, type ExploreReport } from '../shared/explore'
import { runCoordinator } from '../shared/coordinator'
import { demoRuntime } from '../shared/preview'
import { RequestSchema } from '../shared/schema'

// Explore board through the interface, with the local agent API stubbed. Each test decides what the agents report.
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
async function selectCard(page: Page, title: string) {
  const bounds = await page.getByRole('textbox', { name: 'Inspiration goal' }).evaluateAll((inputs, wanted) => {
    const input = inputs.find(item => item instanceof HTMLInputElement && item.value === wanted)
    const photo = input?.closest('article')?.querySelector('.inspiration-image')?.getBoundingClientRect()
    return photo ? { x: photo.x + photo.width / 2, y: photo.y + photo.height / 2 } : null
  }, title)
  if (!bounds) throw new Error(`Card “${title}” is missing.`)
  await page.mouse.click(bounds.x, bounds.y)
}

test('a selected idea is searched with its scope; confirmed options, Show on board and a shared step survive reloads', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const requests = await stub(page, request => {
    const reports = request.topics.map(topic => topic.title === pottery ? found(topic.sourceId, 'web:claystudio', 'Intro to the Wheel')
      : requests.length === 1 ? { sourceId: topic.sourceId, status: 'failed' as const, message: 'Web search couldn’t finish. Retry in a moment.' } : found(topic.sourceId, 'web:beta-job', 'Design Engineer · Beta'))
    const complete = reports.filter(report => report.status === 'complete')
    return { reports, ...(complete.length === 2 ? { shared: { title: 'Make room for clay and a new role', summary: 'Book the Saturday class, then apply to the remote role.', checkedAt: Date.now(), items: complete.map(report => ({ sourceId: report.sourceId, finding: report.findings[0] })) } } : {}) }
  })
  await board(page)
  await selectCard(page, pottery)
  await button(page, 'Explore board').click()
  const dialog = page.getByRole('dialog', { name: 'Explore board' })
  await expect(dialog.getByRole('checkbox', { name: pottery })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: jobs })).toHaveCount(0)
  await expect(dialog).not.toContainText('Search type')
  await expect(dialog).not.toContainText('Ticketmaster')
  await expect(dialog.locator('.explore-scope-line')).toHaveText('Pottery wheel class · Saturday')
  await button(page, `Edit search for ${pottery}`).click()
  await dialog.getByLabel('City', { exact: true }).fill('San Francisco')
  await expect(dialog.locator('.explore-scope-line')).toHaveText('Pottery wheel class · San Francisco · Saturday')
  await expect(dialog.getByLabel('Budget ($)')).toHaveValue('')
  await dialog.getByRole('button', { name: /Add interests/ }).click()
  await dialog.getByRole('checkbox', { name: jobs }).check()
  await expect(dialog.getByRole('status')).toHaveText('2 ideas selected')
  await button(page, 'Find options').click()
  await expect(dialog).toBeHidden()

  // Partial success: the panel shows what was added and stays quiet about the failed interest.
  await expect(results(page).getByRole('status')).toHaveText('1 option added to your board')
  await expect(results(page)).not.toContainText('couldn’t finish')
  expect(requests[0]?.topics.map(topic => topic.kind)).toEqual(['web', 'web'])
  expect(requests[0]?.topics.find(topic => topic.title === pottery)).toMatchObject({ city: 'San Francisco', schedule: 'Saturday', query: 'Pottery wheel class' })
  const log = results(page).locator('details.explore-log')
  await expect(log).not.toHaveAttribute('open')
  await expect(results(page).getByText('Search planner', { exact: false }).first()).toBeHidden()
  await log.locator('summary').click()
  await expect(log).toContainText('Searched “Pottery wheel class” for organizer pages')
  await button(page, 'Show on board').click()
  await expect(page.locator('.card-findings.is-selected')).toHaveCount(1)
  await expect(page.locator('.card-findings')).toContainText('Schedule published · spots not confirmed')

  // A second run finds the job too; the shared step appears only after Add to board.
  // With a findings card selected, the idea searched before is ticked again; the failed one waits under Add interests.
  await button(page, 'Explore board').click()
  await expect(dialog.getByRole('checkbox', { name: pottery })).toBeChecked()
  await dialog.getByRole('button', { name: /Add interests/ }).click()
  await dialog.getByRole('checkbox', { name: jobs }).check()
  await button(page, 'Find options').click()
  await expect(results(page).getByRole('status')).toHaveText('1 option added to your board')
  await expect(page.locator('.card-findings')).toHaveCount(2)
  const shared = results(page).getByRole('region', { name: 'Suggested shared step' })
  await expect(shared).toContainText('Make room for clay and a new role')
  await expect(page.locator('.card-explore-shared')).toHaveCount(0)
  await shared.getByRole('button', { name: 'Add to board' }).click()
  await expect(page.locator('.card-explore-shared')).toHaveCount(1)
  // An immediate reload keeps the new cards: Explore writes them at once instead of after the save delay.
  await page.reload()
  await expect(page.locator('.card-findings')).toHaveCount(2)
  await expect(page.locator('.card-explore-shared')).toHaveCount(1)
  await expect(page.getByText('Saved in browser', { exact: true })).toBeAttached()
  await page.reload()
  await expect(page.locator('.card-explore-shared')).toHaveCount(1)

  // Running the same search again reports options that are already saved instead of claiming new ones.
  await selectCard(page, pottery)
  await button(page, 'Explore board').click()
  await button(page, 'Find options').click()
  await expect(results(page).getByRole('status')).toHaveText('The option is already on your board')
  await button(page, 'Show on board').click()
  await expect(page.locator('.card-findings.is-selected')).toHaveCount(1)
})

test('without a selection, new ideas are listed but not ticked', async ({ page }) => {
  await stub(page, () => ({ reports: [] }))
  await board(page)
  await page.keyboard.press('Escape')
  await page.mouse.click(720, 900)
  await button(page, 'Explore board').click()
  const dialog = page.getByRole('dialog', { name: 'Explore board' })
  await expect(dialog.getByRole('checkbox', { name: pottery })).not.toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: jobs })).not.toBeChecked()
  await expect(button(page, 'Find options')).toBeDisabled()
})

test('no confirmed options offers Edit search with the same scope; a failure offers Retry; Stop ends the run', async ({ page }) => {
  let mode: 'none' | 'error' | 'hold' | 'found' = 'none'
  const requests = await stub(page, request => mode === 'error' ? 'error' : mode === 'hold' ? 'hold'
    : { reports: request.topics.map(topic => mode === 'found' ? found(topic.sourceId, 'web:x', `Option for ${titleOf(request, topic.sourceId) ?? ''}`) : none(topic.sourceId)) })
  await board(page)
  await selectCard(page, pottery)
  await button(page, 'Explore board').click()
  const dialog = page.getByRole('dialog', { name: 'Explore board' })
  await button(page, `Edit search for ${pottery}`).click()
  await dialog.getByLabel('City', { exact: true }).fill('Oakland')
  await button(page, 'Find options').click()
  await expect(results(page).getByRole('status')).toHaveText('No confirmed options found')
  await expect(page.locator('.card-findings')).toHaveCount(0)
  await button(page, 'Edit search').click()
  await expect(dialog.getByLabel('City', { exact: true })).toHaveValue('Oakland')
  mode = 'error'
  await button(page, 'Find options').click()
  await expect(results(page).getByRole('status')).toHaveText('Search couldn’t finish')
  mode = 'found'
  await button(page, 'Retry').click()
  await expect(results(page).getByRole('status')).toHaveText('1 option added to your board')
  expect(requests.at(-1)?.topics[0]).toMatchObject({ city: 'Oakland' })
  mode = 'hold'
  await selectCard(page, jobs)
  await button(page, 'Explore board').click()
  await button(page, 'Find options').click()
  await expect(results(page).getByRole('status')).toHaveText('Finding options…')
  await results(page).getByRole('button', { name: 'Stop' }).click()
  await expect(results(page).getByRole('status')).toHaveText('Search stopped')
  await expect(button(page, 'Edit search')).toBeVisible()
})

test('found options sit beside their card, can be searched again or removed, and a second child branches sideways', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await stub(page, request => ({ reports: request.topics.map(topic => found(topic.sourceId, 'web:claystudio', 'Intro to the Wheel')) }))
  await board(page)
  // Search the rightmost card, so the spot beside it is free; the other card gets the notes.
  const photos = await page.locator('.card-inspiration').evaluateAll(cards => cards.map(card => ({ x: card.getBoundingClientRect().x, goal: card.querySelector('input')?.value ?? '' })))
  const right = photos.reduce((a, b) => (b.x > a.x ? b : a)).goal, left = right === jobs ? pottery : jobs
  await selectCard(page, right)
  await button(page, 'Explore board').click()
  await button(page, 'Find options').click()
  await expect(results(page).getByRole('status')).toHaveText('1 option added to your board')

  // Beside the searched card, level with its top, joined from the side by a dashed line, not under it.
  const photo = (goal: string) => page.locator('.card-inspiration', { has: page.getByRole('img', { name: goal, exact: true }) })
  const searched = photo(right)
  const options = page.locator('.card-findings')
  await expect(options).toContainText(`for “${right}”`)
  const [source, beside] = await Promise.all([searched.boundingBox(), options.boundingBox()])
  expect(source && beside && beside.x > source.x + source.width && Math.abs(beside.y - source.y) < 40, JSON.stringify({ source, beside })).toBe(true)
  await expect(page.locator('.ConnectionShape path[stroke-dasharray]')).toHaveCount(1)

  // Search again reopens Explore board with that card ticked.
  // Like every card, its actions show on hover.
  await options.hover()
  await options.getByRole('button', { name: 'Search again' }).click()
  const dialog = page.getByRole('dialog', { name: 'Explore board' })
  await expect(dialog.getByRole('checkbox', { name: right })).toBeChecked()
  await page.keyboard.press('Escape')

  // A note goes under its card; a second note from the same card branches next to the first instead of under it.
  const card = photo(left)
  const send = async (text: string) => {
    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    await composer.fill(text); await composer.press('Enter')
    await page.getByRole('complementary', { name: 'Node conversation' }).getByRole('button', { name: 'Add to canvas' }).last().click()
  }
  await card.getByRole('textbox', { name: 'Inspiration goal' }).focus()
  await button(page, `Explore ${left}`).click()
  await button(page, 'New conversation').click()
  await send('Add a note about glaze colors.')
  await send('Add a note about apron and towel.')
  await button(page, 'Close chat').click()
  const first = page.locator('.card-artifact', { hasText: 'glaze colors' }), second = page.locator('.card-artifact', { hasText: 'apron and towel' })
  const [a, b, c] = await Promise.all([card.boundingBox(), first.boundingBox(), second.boundingBox()])
  expect(a && b && Math.abs(b.x - a.x) < 5 && b.y > a.y + a.height).toBe(true)
  expect(b && c && c.x > b.x + b.width && Math.abs(c.y - b.y) < 5).toBe(true)

  await button(page, 'Fit board').click()
  await page.screenshot({ path: 'output/findings-layout.png' })

  // Removing the options removes only that card.
  await options.hover()
  await options.getByRole('button', { name: `Remove found options for ${right}` }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^Remove/ }).click()
  await expect(options).toHaveCount(0)
  await expect(page.locator('.card-artifact')).toHaveCount(2)
})
