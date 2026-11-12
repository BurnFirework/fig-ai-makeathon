import { expect, test, type Page } from '@playwright/test'

// Agents never change the board on their own: a note they suggest waits in the chat until the user adds it.
// It is decided like a next step: Refine asks for a revised note in the user's words, Not this asks why and is
// remembered, and Reconsider brings the choice back. Preview agents only.
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const photo = (page: Page, title: string) => page.locator('.card-inspiration', { has: page.getByRole('img', { name: title, exact: true }) })
const conversation = (page: Page) => page.getByRole('complementary', { name: 'Node conversation' })

test('a suggested note changes nothing until it is added', async ({ page }) => {
  await page.goto('/')
  await button(page, 'Explore a sample board').click()
  await button(page, 'Fit board').click()
  await photo(page, 'Explore a creative practice').getByRole('textbox', { name: 'Inspiration goal' }).focus()
  await button(page, 'Explore Explore a creative practice').click()
  await button(page, 'New conversation').click()
  const links = page.locator('.ConnectionShape path')
  const before = await links.count()
  const composer = page.getByRole('textbox', { name: 'Message', exact: true })
  await composer.fill('Add a note about warm light and oak.')
  await composer.press('Enter')

  const suggestion = conversation(page).getByRole('group', { name: 'Suggested for your canvas' })
  await expect(suggestion).toContainText('Design note')
  await expect(suggestion).toContainText('warm light and oak')
  await expect(page.locator('.card-artifact')).toHaveCount(0)
  // While the suggestion waits, the chat offers no other next moves.
  await expect(conversation(page).getByRole('group', { name: 'What next' })).toHaveCount(0)

  // Refine sends a comment; the revised note replaces the first one, which can no longer be added.
  await suggestion.getByRole('button', { name: 'Refine' }).click()
  await suggestion.getByRole('textbox', { name: 'What should change?' }).fill('Add brass details')
  await suggestion.getByRole('button', { name: 'Ask for a revision' }).click()
  const suggestions = conversation(page).getByRole('group', { name: 'Suggested for your canvas' })
  await expect(suggestions).toHaveCount(2)
  await expect(suggestions.first()).toContainText('Replaced by the revised note below')
  await expect(suggestions.first().getByRole('button', { name: 'Add to canvas' })).toHaveCount(0)
  const revised = suggestions.last()
  await expect(revised).toContainText('warm light and oak')
  await expect(revised).toContainText('Add brass details')

  // Not this asks why, keeps the reason and leaves the canvas as it was.
  await revised.getByRole('button', { name: 'Not this' }).click()
  await revised.getByRole('textbox', { name: 'Why not? (optional)' }).fill('Too formal for this room')
  await revised.getByRole('button', { name: 'Not this' }).click()
  await expect(revised).toContainText('Not for you: Too formal for this room')
  await expect(page.locator('.card-artifact')).toHaveCount(0)
  await expect(conversation(page).getByRole('group', { name: 'What next' })).toBeVisible()

  await revised.getByRole('button', { name: 'Reconsider' }).click()
  await revised.getByRole('button', { name: 'Add to canvas' }).click()
  await expect(page.locator('.card-artifact')).toHaveCount(1)
  await expect(page.locator('.card-artifact')).toContainText('Add brass details')
  await expect(links).toHaveCount(before + 1)
  await expect(suggestions).toHaveCount(1)
  // The answer now links to the card it added.
  await expect(conversation(page).getByRole('log').getByRole('button', { name: 'Design note' })).toBeVisible()
})
