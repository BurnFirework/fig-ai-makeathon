import { test, expect } from '@playwright/test'

test('board intro appears only while there are no inspiration images', async ({ page }) => {
  await page.goto('/')
  const intro = page.locator('.board-heading')
  await expect(intro).toBeVisible()
  await expect(intro).toContainText('A SPACE FOR WHAT’S NEXT')
  await expect(page.getByRole('toolbar', { name: 'Canvas tools' })).toHaveCount(0)

  await page.locator('input[accept="image/png,image/jpeg,image/webp"]').setInputFiles({
    name: 'inspiration.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=', 'base64'),
  })
  await expect(page.getByRole('img', { name: 'inspiration', exact: true })).toBeVisible()
  await expect(intro).toHaveCount(0)
  await expect(page.getByRole('toolbar', { name: 'Canvas tools' })).toBeVisible()

  await page.getByRole('textbox', { name: 'Inspiration goal', exact: true }).focus()
  await page.getByRole('button', { name: 'Remove inspiration', exact: true }).click()
  await expect(intro).toBeVisible()
})
