import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { decodeWorkspace } from '../shared/workspace-format'

test('browser flushes on background and warns only while edits are unsaved', async ({ page }) => {
  page.on('pageerror', error => console.error('BROWSER ERROR', error))
  await page.goto('/')
  const status = page.getByRole('banner').getByRole('status')
  await expect(status).toHaveText('Saved in browser')
  expect(await status.evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(1)
  expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false)
  await page.getByRole('button', { name: 'Mood boards: Your next chapter', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Rename board', exact: true }).click()
  await page.getByRole('textbox', { name: 'Board name', exact: true }).fill('Saved on background')
  const guarded = await page.getByRole('button', { name: 'Save name', exact: true }).evaluate(button => {
    if (!(button instanceof HTMLButtonElement)) throw new Error('Expected a save button')
    button.click()
    // Same-task dispatch exercises the 650ms unsaved window without timing a real tab close.
    return !window.dispatchEvent(new Event('beforeunload', { cancelable: true }))
  })
  expect(guarded).toBe(true)
  await expect(page.getByText('Saved in browser', { exact: true })).toBeAttached()
  expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false)
  await page.getByRole('button', { name: 'Mood boards: Saved on background', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Rename board', exact: true }).click()
  await page.getByRole('textbox', { name: 'Board name', exact: true }).fill('Background flush verified')
  await page.clock.install({ time: new Date('2026-11-08T00:00:00Z') })
  await page.clock.pauseAt(new Date('2026-11-08T00:00:01Z'))
  await page.getByRole('button', { name: 'Save name', exact: true }).evaluate(button => {
    if (!(button instanceof HTMLButtonElement)) throw new Error('Expected a save button')
    button.click()
  })
  await expect(status).toHaveText('Unsaved changes')
  expect(await status.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(1)
  await page.evaluate(() => {
    const open = indexedDB.open.bind(indexedDB)
    indexedDB.open = (name, version) => {
      const request = open(name, version)
      // Hold the real database open callback until the paused test clock resumes.
      Object.defineProperty(request, 'onsuccess', { set(listener: EventListener) {
        request.addEventListener('success', event => { setTimeout(() => listener(event), 1) }, { once: true })
      } })
      return request
    }
    window.dispatchEvent(new Event('blur'))
  })
  // The paused debounce cannot fire. Only blur can start this save.
  await expect(status).toHaveText('Saving…')
  expect(await status.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(1)
  await page.clock.resume()
  await expect(status).toHaveText('Saved in browser')
  expect(await status.evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(1)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Mood boards: Background flush verified', exact: true })).toBeVisible()
})

test('legacy boards and images survive migration, reload and web export', async ({ page }, testInfo) => {
  page.on('pageerror', error => console.error('BROWSER ERROR', error))
  page.on('dialog', async dialog => {
    expect(dialog.type()).toBe('beforeunload')
    await dialog.accept()
  })
  await page.goto(`/tests/fixtures/legacy.html${testInfo.project.name === 'webkit' ? '?inline=1' : ''}`)
  await expect(page.locator('body')).toHaveAttribute('data-seeded', 'true')
  await page.goto('/')
  await expect(page.getByRole('img', { name: 'Legacy image 1', exact: true })).toBeVisible()
  await expect(page.getByText('Saved in browser', { exact: true })).toBeAttached()
  await page.reload()
  await expect(page.getByRole('img', { name: 'Legacy image 1', exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Inspiration goal', exact: true }).focus()
  await page.getByRole('button', { name: 'Explore Legacy image 1', exact: true }).click()
  await expect(page.locator('.assistant-message')).toHaveCount(1)
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('I want a gentle creative activity near home')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  // The answered question folds into one row with the answer; the new reply follows it.
  await expect(page.locator('.folded-turn')).toHaveCount(1)
  await expect(page.locator('.assistant-message')).toHaveCount(1)
  await expect(page.getByText('Saved in browser', { exact: true })).toBeAttached()
  await page.getByRole('button', { name: 'Close chat', exact: true }).click()
  await page.getByRole('button', { name: 'Board menu', exact: true }).click()
  const menu = page.getByRole('menu')
  const exportItem = menu.getByRole('menuitem', { name: 'Export', exact: true })
  await expect(menu.getByText('Boards stay in this browser', { exact: true })).toBeVisible()
  await expect(exportItem).toHaveAccessibleDescription('Boards stay in this browser Export to keep a backup.')
  await expect(page.getByRole('menuitem', { name: 'Import', exact: true })).toHaveCount(0)
  await expect(page.locator('input[aria-label="Import backup"]')).toHaveCount(0)
  const downloading = page.waitForEvent('download')
  await exportItem.click()
  const download = await downloading
  const path = testInfo.outputPath('roundtrip.unfold')
  await download.saveAs(path)
  const workspace = decodeWorkspace(new Uint8Array(await readFile(path)))
  expect(workspace.catalog.boards).toHaveLength(2)
  expect(workspace.appearance).toEqual({ palette: 'sage', pattern: 'grid', tone: 'linen' })
  expect(Object.keys(workspace.assets)).toHaveLength(1)
  await page.getByRole('button', { name: 'Mood boards: Legacy 1', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Legacy 2', exact: true })).toHaveCount(1)
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(page.getByRole('img', { name: 'Legacy image 1', exact: true })).toBeVisible()
  const image = page.getByRole('img', { name: 'Legacy image 1', exact: true })
  await expect(image).toHaveJSProperty('naturalWidth', 2)
  await page.getByRole('textbox', { name: 'Inspiration goal', exact: true }).focus()
  await page.getByRole('button', { name: 'Explore Legacy image 1', exact: true }).click()
  await expect(page.getByRole('log', { name: 'Conversation messages' })).toContainText('I want a gentle creative activity near home')
  await expect(page.locator('.folded-turn')).toHaveCount(1)
  await expect(page.locator('.assistant-message')).toHaveCount(1)
  expect(await page.evaluate(() => localStorage.getItem('unfold-boards-v1'))).toContain('unfold-board-legacy-second')
  await page.getByRole('button', { name: 'Close chat', exact: true }).click()
  const asset = Object.values(workspace.assets)[0]
  expect(asset).toBeDefined()
  if (!asset) throw new Error('Exported image missing')
  await page.locator('input[accept="image/png,image/jpeg,image/webp"]').setInputFiles({ name: 'fresh.png', mimeType: 'image/png', buffer: Buffer.from(asset.data, 'base64') })
  await expect(page.getByRole('img', { name: 'fresh', exact: true })).toBeVisible()
  await expect(page.getByText('Saved in browser', { exact: true })).toBeAttached()
  await page.reload()
  await expect(page.getByRole('img', { name: 'fresh', exact: true })).toBeVisible()
})

test('invalid browser data reports a recoverable error instead of hanging or replacing it', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Saved in browser', { exact: true })).toBeAttached()
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('unfold-workspaces-v1', 1)
      request.onerror = () => reject(request.error ?? new Error('Database unavailable'))
      request.onsuccess = () => {
        const db = request.result
        const transaction = db.transaction('workspaces', 'readwrite')
        transaction.objectStore('workspaces').put({ broken: true }, 'current')
        transaction.oncomplete = () => { db.close(); resolve() }
        transaction.onerror = () => reject(transaction.error ?? new Error('Write failed'))
      }
    })
  })
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('Your saved boards could not be opened.')
  expect(await page.evaluate(() => new Promise<unknown>((resolve, reject) => {
    const opening = indexedDB.open('unfold-workspaces-v1', 1)
    opening.onerror = () => reject(opening.error ?? new Error('Database unavailable'))
    opening.onsuccess = () => {
      const db = opening.result
      const read = db.transaction('workspaces').objectStore('workspaces').get('current')
      read.onsuccess = () => { const value: unknown = read.result; db.close(); resolve(value) }
    }
  }))).toEqual({ broken: true })
})

test('a stale second tab cannot overwrite a newer saved workspace', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Saved in browser', { exact: true })).toBeAttached()
  const other = await page.context().newPage()
  try {
    await other.goto('/')
    await expect(other.getByText('Saved in browser', { exact: true })).toBeAttached()
    await page.getByRole('button', { name: 'Mood boards: Your next chapter', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Rename board', exact: true }).click()
    await page.getByRole('textbox', { name: 'Board name', exact: true }).fill('Newer saved name')
    await page.getByRole('button', { name: 'Save name', exact: true }).click()
    await expect(page.getByText('Saved in browser', { exact: true })).toBeAttached()
    await other.getByRole('button', { name: 'Mood boards: Your next chapter', exact: true }).click()
    await other.getByRole('menuitem', { name: 'Rename board', exact: true }).click()
    await other.getByRole('textbox', { name: 'Board name', exact: true }).fill('Stale name')
    await other.getByRole('button', { name: 'Save name', exact: true }).click()
    await expect(other.getByRole('alert')).toContainText('changed in another tab')
    const status = other.getByRole('banner').getByRole('status')
    await expect(status).toHaveText('Not saved')
    expect(await status.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(1)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Mood boards: Newer saved name', exact: true })).toBeVisible()
  } finally { await other.close() }
})
