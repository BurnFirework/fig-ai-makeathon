import { expect, test, type Page } from '@playwright/test'
import { z } from 'zod'
import type { Proposal } from '../shared/schema'

// An answer in the chat always shows a way on: the agent's own follow-ups, or choices that fit where the chat stands.
// A choice is sent as the user's message, and the buttons leave once the conversation moves on.
const card = 'Explore a creative practice'
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const panel = (page: Page) => page.getByRole('complementary', { name: 'Node conversation' })

test('follow-ups under the latest answer send the chosen message', async ({ page }) => {
  const replies: Proposal[] = [
    { kind: 'reply', text: 'Here are three warm-ups to loosen up before Sunday.', followUps: ['Find the next step', 'Tell you how it went'] },
    { kind: 'reply', text: 'Glad it helped. Charcoal is a good next material to try.' },
  ]
  const sent: string[] = []
  await page.route('**/api/config', route => route.fulfill({ json: { mode: 'demo', provider: 'Preview', providers: [] } }))
  await page.route('**/api/agent', route => {
    const body = z.object({ requestId: z.string(), board: z.object({ messages: z.array(z.object({ text: z.string() })) }).loose().optional() }).loose().parse(route.request().postDataJSON())
    sent.push(body.board?.messages.at(-1)?.text ?? '')
    // Opening Explore asks the agents on its own first, so the reply follows the user's message, not the call order.
    const proposal = sent.at(-1) === 'Easy warm-up exercises' ? replies[0] : replies[1]
    return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'result', result: { requestId: body.requestId, proposal, activity: [], mode: 'demo' } }) + '\n' })
  })
  await page.goto('/')
  await button(page, 'Explore a sample board').click()
  await button(page, 'Fit board').click()
  const image = page.getByRole('img', { name: card, exact: true })
  const box = await image.boundingBox()
  if (box) { await page.mouse.move(box.x + 4, box.y + 4); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3, { steps: 3 }) }
  await button(page, `Explore ${card}`).click()
  await button(page, 'New conversation').click()
  const composer = page.getByRole('textbox', { name: 'Message', exact: true })
  await composer.fill('Easy warm-up exercises')
  await composer.press('Enter')

  const next = panel(page).getByRole('group', { name: 'What next' })
  await expect(next.getByRole('button')).toHaveText(['Find the next step', 'Tell you how it went'])
  await next.getByRole('button', { name: 'Tell you how it went' }).click()
  await expect(panel(page)).toContainText('Charcoal is a good next material')
  expect(sent.at(-1)).toBe('Tell you how it went')
  // Without the agent's own follow-ups, an answer that made no card can be kept as a note or turned into a step.
  await expect(next).toHaveCount(1)
  await expect(next.getByRole('button')).toHaveText(['Save this as a note', 'Find a concrete step'])
})
