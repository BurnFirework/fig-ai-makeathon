import { test, expect, type Page } from '@playwright/test'

const recording = process.env.UNFOLD_RECORD_BOARD === '1'
test.use({ video: recording ? { mode: 'on', size: { width: 1280, height: 900 } } : 'off' })

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const photo = (page: Page, title: string) => page.locator('.card-inspiration', { has: page.getByRole('img', { name: title, exact: true }) })
const conversation = (page: Page) => page.getByRole('complementary', { name: 'Node conversation' })

async function caption(page: Page, text: string) {
  if (!recording) return
  await page.evaluate(message => {
    let label = document.getElementById('walkthrough-caption')
    if (!label) {
      label = document.createElement('div')
      label.id = 'walkthrough-caption'
      Object.assign(label.style, { position: 'fixed', zIndex: '10000', left: '50%', bottom: '86px', transform: 'translateX(-50%)', background: '#292321', color: '#fff', borderRadius: '12px', padding: '13px 20px', font: '600 16px/1.4 system-ui', maxWidth: '650px', textAlign: 'center', pointerEvents: 'none' })
      document.body.append(label)
    }
    label.textContent = message
  }, text)
  await page.waitForTimeout(2000)
}

async function send(page: Page, text: string) {
  const composer = page.getByRole('textbox', { name: 'Message', exact: true })
  await composer.fill(text)
  await composer.press('Enter')
}

async function openPhoto(page: Page, title: string, start = false) {
  await button(page, 'Fit board').click()
  await photo(page, title).getByRole('textbox', { name: 'Inspiration goal' }).focus()
  await button(page, `Explore ${title}`).click()
  if (!start) return
  // Start with your own request: a new conversation stays empty until you write.
  await button(page, 'New conversation').click()
  await expect(page.getByRole('button', { name: 'Suggest directions', exact: true })).toBeVisible()
}

test('two cards share a conversation that asks, creates, reuses images, and undoes a whole edit', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await button(page, 'Explore a sample board').click()
  for (const [before, after] of [['Explore a creative practice', 'Room photo'], ['Meet new people', 'Materials palette']] as const) {
    const field = photo(page, before).getByRole('textbox', { name: 'Inspiration goal' })
    await field.fill(after)
    await field.blur()
  }
  await expect(photo(page, 'Materials palette')).toBeVisible()
  await caption(page, 'Unfold · Two existing photo cards. This recording uses preview agents.')
  await openPhoto(page, 'Room photo', true)
  await button(page, 'Board and chat view').click()
  await button(page, 'Attach a card').click()
  await page.getByRole('menuitem', { name: 'Materials palette', exact: true }).click()
  await expect(conversation(page).getByRole('button', { name: 'Materials palette', exact: true })).toBeVisible()
  await caption(page, 'Attach the palette to this conversation. Either card can reopen the same discussion.')
  await send(page, 'Create a moodboard using Materials palette, but ask me about the mood first.')
  await expect(conversation(page)).toContainText('What mood should the board capture?')
  await expect(page.locator('.card-artifact')).toHaveCount(0)
  await caption(page, 'Unfold asks a question while the direction is still open.')
  await conversation(page).getByRole('button', { name: /Help me choose/ }).click()
  await expect(conversation(page)).toContainText('Which direction feels closer to what you want?')
  await expect(page.locator('.card-artifact')).toHaveCount(0)
  await caption(page, 'An uncertain answer leads to another question in the same chat.')
  await conversation(page).getByRole('button', { name: /Warm and calm/ }).click()
  const moodboard = page.locator('.card-artifact').filter({ has: page.getByLabel('Moodboard images') })
  await expect(moodboard.getByRole('textbox', { name: 'Card title' })).toHaveValue('Warm and calm moodboard')
  await expect(moodboard.locator('img')).toHaveCount(2)
  await expect(page.locator('.card-inspiration')).toHaveCount(2)
  await expect(page.locator('.ConnectionShape path[stroke-dasharray]')).toHaveCount(1)
  await caption(page, 'The agent creates a composition using both existing images. The dashed line marks a reference.')
  await button(page, 'Close chat').click()
  await openPhoto(page, 'Materials palette')
  await expect(conversation(page)).toContainText('I made “Warm and calm moodboard”')
  await caption(page, 'Opening the palette brings back the same question, answer, and result.')
  await send(page, 'Add a note about oak and warm light.')
  const note = page.locator('.card-artifact').filter({ hasText: 'oak and warm light' })
  await expect(note).toBeVisible()
  await expect(page.locator('.ConnectionShape path')).toHaveCount(3)
  await caption(page, 'The same conversation creates another card directly from a clear request.')
  await button(page, 'More canvas actions').click()
  await page.getByRole('menuitem', { name: 'Undo', exact: true }).click()
  await expect(note).toHaveCount(0)
  await expect(page.locator('.ConnectionShape path')).toHaveCount(2)
  await expect(moodboard).toBeVisible()
  await caption(page, 'One Undo removes the new note and its link together.')
  await button(page, 'More canvas actions').click()
  await page.getByRole('menuitem', { name: 'Redo', exact: true }).click()
  await expect(note).toBeVisible()
  await expect(page.getByText('Saved in browser', { exact: true })).toBeVisible()
  await page.reload()
  await expect(moodboard).toBeVisible()
  await openPhoto(page, 'Room photo')
  await expect(conversation(page)).toContainText('I added a design note to the board.')
  await caption(page, 'After reload, the cards and shared conversation are still on this device.')
})

test('a UI note can be reused by an agent and survives removal of a referencing card', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await button(page, 'Explore a sample board').click()
  await button(page, 'Fit board').click()
  await button(page, 'More canvas actions').click()
  await page.getByRole('menuitem', { name: 'Add a note', exact: true }).click()
  await page.getByRole('textbox', { name: 'Note title' }).fill('Palette note')
  await page.getByRole('textbox', { name: 'Note text' }).fill('Keep the warm oak and pale stone.')
  await button(page, 'Add note').click()
  await expect(page.locator('.card-artifact')).toContainText('warm oak and pale stone')
  await expect(page.locator('.ConnectionShape path[stroke-dasharray]')).toHaveCount(1)
  await openPhoto(page, 'Explore a creative practice', true)
  await send(page, 'Rename this card to Room photo')
  await expect(conversation(page)).toContainText('Renamed the card to “Room photo”.')
  await send(page, 'Link this card to Palette note')
  await expect(conversation(page)).toContainText('Linked this card to “Palette note”.')
  await expect(page.locator('.ConnectionShape path[stroke-dasharray]')).toHaveCount(2)
  await button(page, 'Close chat').click()
  await button(page, 'Fit board').click()
  await photo(page, 'Room photo').getByRole('textbox', { name: 'Inspiration goal' }).focus()
  await button(page, 'Remove Room photo').click()
  await page.getByRole('dialog').getByRole('button', { name: /^Remove/ }).click()
  await expect(photo(page, 'Room photo')).toHaveCount(0)
  await expect(page.locator('.card-artifact')).toContainText('warm oak and pale stone')
  await expect(page.locator('.ConnectionShape path[stroke-dasharray]')).toHaveCount(1)
})

test('removing the last image offers to keep or remove its moodboard', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await button(page, 'Explore a sample board').click()
  const first = 'Explore a creative practice'
  const second = 'Meet new people'
  await openPhoto(page, first, true)
  await send(page, `Create a moodboard using ${second}.`)
  const moodboard = page.locator('.card-artifact').filter({ has: page.getByLabel('Moodboard images') })
  await expect(moodboard.locator('img')).toHaveCount(2)
  await button(page, 'Close chat').click()

  const dialog = page.getByRole('dialog')
  const removePhoto = async (title: string) => {
    await button(page, 'Fit board').click()
    await photo(page, title).getByRole('textbox', { name: 'Inspiration goal' }).focus()
    await button(page, `Remove ${title}`).click()
  }

  await removePhoto(first)
  await expect(dialog.getByRole('list')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(photo(page, first)).toHaveCount(0)
  await expect(moodboard.getByRole('img', { name: second })).toBeVisible()
  await expect(moodboard.getByText('Source image removed')).toHaveCount(1)
  await expect(page.locator('.ConnectionShape path')).toHaveCount(1)

  await removePhoto(second)
  await expect(dialog.getByRole('list', { name: 'Cards that would lose their last source' })).toHaveText('Room moodboard')
  await dialog.getByRole('button', { name: 'Keep linked card', exact: true }).click()
  await expect(photo(page, second)).toHaveCount(0)
  await expect(moodboard.getByText('Source image removed')).toHaveCount(2)
  await expect(page.locator('.ConnectionShape path')).toHaveCount(0)

  await button(page, 'More canvas actions').click()
  await page.getByRole('menuitem', { name: 'Undo', exact: true }).click()
  await expect(moodboard.getByRole('img', { name: second })).toBeVisible()
  await removePhoto(second)
  await dialog.getByRole('button', { name: 'Remove linked card too', exact: true }).click()
  await expect(photo(page, second)).toHaveCount(0)
  await expect(moodboard).toHaveCount(0)
})
