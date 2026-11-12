import { expect, test, type Page } from '@playwright/test'
import { z } from 'zod'
import { RequestSchema, type Proposal } from '../shared/schema'

// A proposed next step can be refined or turned down from its card in the chat. The local agent API is stubbed and
// records each request, so the test also checks what a refine sends to the agents.
const card = 'Explore a creative practice'
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const panel = (page: Page) => page.getByRole('complementary', { name: 'Node conversation' })
const sources = [{ id: 's1', title: 'Charcoal basics · Meetup', url: 'https://www.meetup.com/sf-drawing/events/1/' }]
const step = (summary: string): Proposal => ({ kind: 'action', title: 'Try a beginner charcoal drawing class', description: '', summary, steps: ['Open the Meetup page', 'Pick a session', 'Register on the studio page'], meta: { time: '2 hours', cost: '$40' }, sources })

async function openChat(page: Page, replies: Proposal[]) {
  const requests: z.infer<typeof RequestSchema>[] = []
  await page.route('**/api/config', route => route.fulfill({ json: { mode: 'demo', provider: 'Preview', providers: [] } }))
  await page.route('**/api/agent', route => {
    const body = RequestSchema.parse(route.request().postDataJSON())
    requests.push(body)
    const proposal = replies[Math.min(requests.length - 1, replies.length - 1)]
    return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'result', result: { requestId: body.requestId, proposal, activity: [], mode: 'demo' } }) + '\n' })
  })
  await page.goto('/')
  await button(page, 'Explore a sample board').click()
  await button(page, 'Fit board').click()
  const image = page.getByRole('img', { name: card, exact: true })
  const box = await image.boundingBox()
  if (box) { await page.mouse.move(box.x + 4, box.y + 4); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3, { steps: 3 }) }
  await button(page, `Explore ${card}`).click()
  return requests
}

test('refining a step already on the canvas updates that card instead of adding another', async ({ page }) => {
  await openChat(page, [step('A Saturday 5–7 PM class in SF.'), step('The same class, on Sunday 2–4 PM.')])
  const outcome = panel(page).locator('.chat-outcome')
  await outcome.first().getByRole('button', { name: 'Add to canvas' }).click()
  await expect(page.locator('.action-body')).toHaveCount(1)
  await expect(outcome.first().getByRole('button', { name: 'Not this' })).toHaveCount(0)
  await outcome.first().getByRole('button', { name: 'Refine' }).click()
  await outcome.first().getByRole('textbox', { name: 'What should change?' }).fill('On Sunday instead')
  await outcome.first().getByRole('textbox', { name: 'What should change?' }).press('Enter')
  await expect(outcome).toHaveCount(2)
  await expect(outcome.first()).toContainText('Revised below: On Sunday instead')
  await outcome.last().getByRole('button', { name: 'Update card on canvas' }).click()
  await expect(page.locator('.action-body')).toHaveCount(1)
  await expect(page.locator('.action-body')).toContainText('on Sunday 2–4 PM')
})

test('Refine and Not this on a proposed step', async ({ page }) => {
  const requests = await openChat(page, [step('A Saturday 5–7 PM class in SF.'), step('The same class, on Sunday 2–4 PM.'), step('A Saturday 5–7 PM class in SF.')])
  const outcome = panel(page).locator('.chat-outcome')
  await expect(outcome.first()).toContainText('Next step')
  await outcome.first().getByRole('button', { name: 'Refine' }).click()
  const field = outcome.first().getByRole('textbox', { name: 'What should change?' })
  await expect(field).toBeFocused()
  await field.fill('On Sunday instead')
  await outcome.first().getByRole('button', { name: 'Ask for a revision' }).click()

  // The agents get the step to revise, with its steps and sources, and the comment.
  await expect(outcome).toHaveCount(2)
  const refine = requests[1]?.focus
  expect(refine).toMatchObject({ kind: 'refine', title: 'Try a beginner charcoal drawing class', note: 'On Sunday instead', sources, steps: ['Open the Meetup page', 'Pick a session', 'Register on the studio page'] })
  await expect(outcome.first()).toContainText('Replaced by the revised step below')
  await expect(outcome.first().getByRole('button', { name: 'Add to canvas' })).toHaveCount(0)
  await expect(outcome.last()).toContainText('Next step · revised')
  await expect(outcome.last()).toContainText('on Sunday 2–4 PM')

  // Not this records a reason and can be reconsidered; then the revision goes on the canvas as one card.
  await outcome.last().getByRole('button', { name: 'Not this' }).click()
  await outcome.last().getByRole('textbox', { name: 'Why not? (optional)' }).fill('Too far from home')
  await outcome.last().getByRole('button', { name: 'Not this' }).click()
  await expect(outcome.last()).toContainText('Not for you: Too far from home')
  await outcome.last().getByRole('button', { name: 'Reconsider' }).click()
  await outcome.last().getByRole('button', { name: 'Add to canvas' }).click()
  await expect(page.locator('.action-body')).toHaveCount(1)
  // Once on the canvas, the step can still be refined but no longer turned down here.
  await expect(outcome.last().getByRole('button', { name: 'Not this' })).toHaveCount(0)
  await expect(outcome.last().getByRole('button', { name: 'Refine' })).toBeVisible()
})

test('a step from a chat that brings two cards together is linked to both', async ({ page }) => {
  await openChat(page, [step('A Saturday 5–7 PM class in SF where you can meet other beginners.')])
  const links = page.locator('.ConnectionShape path')
  const before = await links.count()
  await button(page, 'Board and chat view').click()
  await button(page, 'Attach a card').click()
  await page.getByRole('menuitem', { name: 'Meet new people', exact: true }).click()
  await expect(panel(page).locator('.chat-source-row')).toContainText('Meet new people')
  await panel(page).locator('.chat-outcome').first().getByRole('button', { name: 'Add to canvas' }).click()
  await expect(page.locator('.action-body')).toHaveCount(1)
  await expect(links).toHaveCount(before + 2)
})
