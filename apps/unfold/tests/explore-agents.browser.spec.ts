import { expect, test } from '@playwright/test'
import { ExploreRequestSchema } from '../shared/explore'

// A shared step is one confirmed option that moves several ideas forward. Here the Saturday wheel group is confirmed for
// both a creative practice and meeting people; the stubbed agents report it for both ideas.
const craft = 'Explore a creative practice'
const people = 'Meet new people'
const wheel = { id: 'web:clay', title: 'Saturday wheel group', subtitle: 'claycollective.example · San Francisco', when: 'Saturdays 1–3:30pm', why: 'The organizer’s page confirms San Francisco, Saturday afternoons.', url: 'https://claycollective.example/wheel', source: 'https://claycollective.example/wheel', state: 'new' as const }
const games = { id: 'web:games', title: 'Board game night', subtitle: 'meetup.com · San Francisco', why: 'The organizer’s page confirms San Francisco.', url: 'https://www.meetup.com/sf-games/', source: 'https://www.meetup.com/sf-games/', state: 'new' as const }

test('a shared step for one option serving two ideas stays single, survives reload and shows no review mark after a dismissal', async ({ page }) => {
  await page.route('**/api/config', route => route.fulfill({ json: { mode: 'demo', provider: 'Preview', providers: [] } }))
  await page.route('**/api/agent', route => {
    const request = ExploreRequestSchema.parse(route.request().postDataJSON())
    const id = (title: string) => request.topics.find(topic => topic.title === title)?.sourceId ?? ''
    const reports = request.topics.map(topic => ({ sourceId: topic.sourceId, status: 'complete', outcome: 'confirmed', checkedAt: Date.now(), findings: topic.title === people ? [wheel, games] : [wheel] }))
    return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'explore-result', result: {
      requestId: request.requestId, reports,
      shared: { title: 'Join the Saturday wheel group', summary: 'A weekly small-group wheel class builds a pottery practice and puts you among the same people every week.', checkedAt: Date.now(), items: [{ sourceId: id(craft), finding: wheel }, { sourceId: id(people), finding: wheel }] },
    } }) + '\n' })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Explore a sample board', exact: true }).click()
  const goals = page.getByRole('textbox', { name: 'Inspiration goal' })
  await expect(goals).toHaveCount(2)
  await goals.first().fill(craft)
  await goals.first().blur()
  await goals.last().fill(people)
  await goals.last().blur()
  const panel = page.getByRole('complementary', { name: 'Explore results' })
  async function run() {
    await page.getByRole('button', { name: 'Explore board', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Explore board' })
    // Every card starts checked; rerun only the original two scopes for this shared-step fixture.
    const selected = await dialog.getByRole('checkbox', { checked: true }).evaluateAll(inputs => inputs.map(input => input.getAttribute('aria-label')))
    for (const name of selected) if (name && ![craft, people].includes(name)) await dialog.getByRole('checkbox', { name, exact: true }).click()
    for (const name of [craft, people]) await expect(dialog.getByRole('checkbox', { name, exact: true })).toBeChecked()
    await page.getByRole('button', { name: 'Find options', exact: true }).click()
    await expect(panel.getByRole('button', { name: 'Edit search' }).or(panel.getByRole('button', { name: 'Show on board' }))).toBeVisible()
  }
  await run()
  // The wheel group sits on both ideas' cards but is one new option.
  await expect(panel.getByRole('status')).toHaveText('2 options added to your board')
  await expect(panel.getByRole('region', { name: 'Suggested shared step' })).toContainText('builds a pottery practice')
  const shared = page.locator('.card-explore-shared')
  await expect(shared).toHaveCount(0)
  await panel.getByRole('button', { name: 'Add to board' }).click()
  await expect(shared).toHaveCount(1)
  await page.getByRole('button', { name: 'Fit board', exact: true }).click()
  await expect(shared.getByRole('link')).toHaveCount(1)
  await expect(page.getByText('Saved in browser', { exact: true })).toBeVisible()
  await page.reload()
  await expect(shared).toHaveCount(1)
  await run()
  await expect(panel.getByRole('status')).toHaveText('These options are already on your board')
  await panel.getByRole('button', { name: 'Add to board' }).click()
  await expect(shared).toHaveCount(1)
  await page.getByRole('button', { name: 'Fit board', exact: true }).click()
  await page.getByRole('button', { name: 'Dismiss Saturday wheel group', exact: true }).first().click()
  // The card is out of date for the agents, but the board shows no review mark on it.
  await expect(shared.locator('.stale-banner')).toHaveCount(0)
  await run()
  await expect(panel.getByRole('button', { name: 'Add to board' })).toHaveCount(1)
  await panel.getByRole('button', { name: 'Add to board' }).click()
  await expect(shared).toHaveCount(1)
  await expect(shared.locator('.stale-banner')).toHaveCount(0)
})
