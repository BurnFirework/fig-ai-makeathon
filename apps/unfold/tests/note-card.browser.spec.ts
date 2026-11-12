import { expect, test, type Page } from '@playwright/test'

// A note card shows its whole text: it grows with its content instead of scrolling inside a fixed-height card.
// Preview agents make the note from the request, so no model is needed.
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const photo = (page: Page, title: string) => page.locator('.card-inspiration', { has: page.getByRole('img', { name: title, exact: true }) })
const warmups = 'warm-ups: 1. Scribble circles and loops for 2 minutes to relax your wrist. 2. Draw 5 blind contours: look only at the object, not the page. 3. Fill a page with quick 30-second gesture sketches of anything nearby. 4. Draw one cup three times, faster each time. 5. Finish with a slow, careful line drawing of your hand.'

test('a long note grows to show its whole text without an inner scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await button(page, 'Explore a sample board').click()
  await button(page, 'Fit board').click()
  await photo(page, 'Explore a creative practice').getByRole('textbox', { name: 'Inspiration goal' }).focus()
  await button(page, 'Explore Explore a creative practice').click()
  await button(page, 'New conversation').click()
  const composer = page.getByRole('textbox', { name: 'Message', exact: true })
  await composer.fill(`Add a note about ${warmups}`)
  await composer.press('Enter')
  await page.getByRole('complementary', { name: 'Node conversation' }).getByRole('button', { name: 'Add to canvas' }).click()
  const note = page.locator('.unfold-card', { has: page.locator('.artifact-body') })
  await expect(note).toContainText('slow, careful line drawing of your hand')
  await button(page, 'Close chat').click()
  await expect.poll(() => note.locator('.card-content').evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1)
  // The whole text sits inside the card's frame.
  const [card, text] = await Promise.all([note.boundingBox(), note.locator('.artifact-description').boundingBox()])
  expect(card && text && text.y + text.height <= card.y + card.height).toBe(true)
  // A long title wraps instead of being cut off.
  const title = note.getByRole('textbox', { name: 'Card title' })
  const line = (await title.boundingBox())?.height ?? 0
  await title.fill('Warm-up sketches before the meetup on Sunday afternoon')
  await title.press('Enter')
  await expect(title).not.toBeFocused()
  await expect.poll(async () => (await title.boundingBox())?.height ?? 0).toBeGreaterThan(line * 1.5)
  await note.screenshot({ path: '../../output/note-card.png' })
})
