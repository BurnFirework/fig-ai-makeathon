import { expect, test, type Page } from '@playwright/test'
import { z } from 'zod'
import type { Proposal } from '../shared/schema'

// A question's "Something else…" opens a field in the question itself, and an open question shows it straight away.
// The local agent API is stubbed: the first reply offers an invitation ("Share my city") next to a real answer.
const card = 'Explore a creative practice'
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const panel = (page: Page) => page.getByRole('complementary', { name: 'Node conversation' })

test('Something else opens an answer field in the question; invitations are not offered as answers', async ({ page }) => {
  const replies: Proposal[] = [
    { kind: 'question', prompt: 'Which city or area should I search for classes?', options: ['Share my city', 'Near downtown'], purpose: 'Classes are local.', placeholder: 'Type a city or area' },
    { kind: 'question', prompt: 'Which neighborhood is easiest for you?', options: [], purpose: 'Shorter trips make it easier to keep going.', placeholder: 'Type a neighborhood' },
    { kind: 'reply', text: 'Thanks, I will look near the Mission.' },
  ]
  const sent: { text: string }[] = []
  await page.route('**/api/config', route => route.fulfill({ json: { mode: 'demo', provider: 'Preview', providers: [] } }))
  await page.route('**/api/agent', route => {
    const body = z.object({ requestId: z.string() }).loose().parse(route.request().postDataJSON())
    const proposal = replies[Math.min(sent.length, replies.length - 1)]
    sent.push({ text: JSON.stringify(body).includes('San Francisco') ? 'San Francisco' : '' })
    return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'result', result: { requestId: body.requestId, proposal, activity: [], mode: 'demo' } }) + '\n' })
  })
  await page.goto('/')
  await button(page, 'Explore a sample board').click()
  await button(page, 'Fit board').click()
  // Card actions appear on hover.
  const image = page.getByRole('img', { name: card, exact: true })
  const box = await image.boundingBox()
  if (box) { await page.mouse.move(box.x + 4, box.y + 4); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3, { steps: 3 }) }
  await button(page, `Explore ${card}`).click()

  const question = panel(page).locator('.question-card')
  await expect(question).toContainText('Which city or area should I search for classes?')
  await expect(question.getByRole('button', { name: /Share my city/ })).toHaveCount(0)
  await expect(question.getByRole('button', { name: /Near downtown/ })).toBeVisible()
  await question.getByRole('button', { name: 'Something else…' }).click()
  const field = question.getByRole('textbox', { name: 'Your answer' })
  await expect(field).toBeFocused()
  await expect(field).toHaveAttribute('placeholder', 'Type a city or area')
  await field.press('Escape')
  await expect(field).toHaveCount(0)
  await expect(panel(page)).toBeVisible()
  await question.getByRole('button', { name: 'Something else…' }).click()
  await question.getByRole('textbox', { name: 'Your answer' }).fill('San Francisco')
  await question.getByRole('textbox', { name: 'Your answer' }).press('Enter')
  // The answered question folds into one line: the question and the typed answer.
  await expect(panel(page).getByRole('button', { name: 'Which city or area should I search for classes? San Francisco' })).toBeVisible()
  expect(sent.at(-1)?.text).toBe('San Francisco')

  // An open question has no ready answers: its field is already open and cannot be closed.
  await expect(question).toContainText('Which neighborhood is easiest for you?')
  const open = question.getByRole('textbox', { name: 'Your answer' })
  await expect(open).toBeVisible()
  await expect(open).toHaveAttribute('placeholder', 'Type a neighborhood')
  await expect(question.getByRole('button', { name: 'Cancel' })).toHaveCount(0)
  await open.fill('The Mission')
  await question.getByRole('button', { name: 'Send' }).click()
  await expect(panel(page).getByRole('button', { name: 'Which neighborhood is easiest for you? The Mission' })).toBeVisible()
})
