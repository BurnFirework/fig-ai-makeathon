import { test, expect, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// The live failure of November 10, 2026, end to end through the real local helper and interface, with a test
// double for the Claude Code binary (tests/fixtures/fake-claude.cjs) so no subscription usage is spent.
// Requires a production build (`pnpm build`): the helper serves dist/.
const port = 43131
const base = `http://127.0.0.1:${port}`
const fake = resolve('tests/fixtures/fake-claude.cjs')
let helper: ChildProcess | undefined
let directory = ''
const setResearch = (mode: 'broken' | 'ok') => writeFileSync(join(directory, 'state'), mode)

test.use({ baseURL: base })
test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'unfold-fake-claude-'))
  chmodSync(fake, 0o755)
  setResearch('broken')
  helper = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: process.cwd(), stdio: 'ignore', env: { ...process.env, PORT: String(port), UNFOLD_PROVIDER: 'claude', UNFOLD_CLAUDE_BIN: fake, UNFOLD_FAKE_STATE: join(directory, 'state') } })
  for (let attempt = 0; attempt < 100; attempt++) {
    const ready = await fetch(`${base}/api/config`).then(response => response.ok, () => false)
    if (ready) return
    await new Promise(done => setTimeout(done, 200))
  }
  throw new Error('The local helper did not start.')
})
test.afterAll(() => { helper?.kill(); rmSync(directory, { recursive: true, force: true }) })

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const panel = (page: Page) => page.getByRole('complementary', { name: 'Node conversation' })
async function explore(page: Page, title: string) {
  await button(page, 'Fit board').click()
  const image = page.getByRole('img', { name: title, exact: true })
  const box = await image.boundingBox()
  if (box) { await page.mouse.move(box.x + 4, box.y + 4); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3, { steps: 3 }) }
  const caption = page.locator('.unfold-card', { has: image }).getByRole('textbox', { name: 'Inspiration goal' })
  if (await caption.count()) await caption.evaluate(input => { if (input instanceof HTMLElement) input.focus({ preventScroll: true }) })
  await button(page, `Explore ${title}`).click()
}
async function answer(page: Page, goal: string, text: string) {
  await explore(page, goal)
  await expect(panel(page).locator('.question-card')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(text)
  await page.getByRole('textbox', { name: 'Message', exact: true }).press('Enter')
  await expect(panel(page).locator('.chat-job')).toHaveCount(0, { timeout: 15_000 })
  await button(page, 'Close chat').click()
}

test('a research reply that cannot be read pauses the link with a clear error and a Retry that survives a reload', async ({ page }) => {
  test.setTimeout(120_000)
  page.on('pageerror', error => { throw error })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await button(page, 'Explore a sample board').click()
  await answer(page, 'Explore a creative practice', 'I want to try a hands-on pottery class in San Francisco on Saturdays, under $25')
  await answer(page, 'Meet new people', 'I want to meet new people in San Francisco on Saturday afternoons, in a small group')

  // The board checks the link by itself; the search runs, its reply cannot be read even after one correction.
  await button(page, 'Fit board').click()
  const paused = page.locator('.link-pill.tone-error').first()
  await expect(paused).toBeVisible({ timeout: 60_000 })
  await expect(paused).toHaveAttribute('aria-label', /could not be read.*Retry/)
  await expect(page.locator('.link-pill.tone-error')).toHaveCount(2)
  await expect(page.locator('.link-pill.tone-error').first()).toHaveText('Link paused')
  await expect(page.getByText('The agents could not finish checking a link')).toBeVisible()
  // A technical failure is not a finding: no decision about the budget, no “nothing fits”, no shared conversation.
  await expect(page.locator('.link-pill.tone-decision, .link-pill.tone-ready')).toHaveCount(0)
  await button(page, 'Agent activity').click()
  const activity = page.locator('.activity-panel')
  await expect(activity).toContainText('The search did not complete')
  await expect(activity).not.toContainText('No suitable verified option')
  await page.screenshot({ path: '../../output/playwright/research-failure-paused.png' })
  await button(page, 'Agent activity').click()

  // After a reload the paused check and its Retry are still there (the board saves shortly after each change).
  await expect(page.getByText('Saved in browser', { exact: true })).toBeAttached()
  await page.reload()
  await button(page, 'Fit board').click()
  await expect(page.locator('.link-pill.tone-error').first()).toHaveAttribute('aria-label', /could not be read.*Retry/)
  await expect(page.locator('.link-pill.tone-error').first()).toHaveText('Link paused')

  // Retry uses the latest conditions and, once the search can be read, leads to one shared idea with its source.
  setResearch('ok')
  await page.locator('.link-pill.tone-error').first().click()
  const ready = page.locator('.link-pill.tone-ready')
  await expect(ready.first()).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.link-pill.tone-error')).toHaveCount(0)
  await expect(ready).toHaveCount(2)
  await ready.first().click()
  await expect(panel(page).locator('.chat-outcome h3')).toHaveText('Saturday clay social')
  await expect(panel(page).locator('.chat-outcome .source-chips a')).toHaveAttribute('href', 'https://studio.example/saturday-clay-social')
  await page.screenshot({ path: '../../output/playwright/research-failure-retried.png' })
  await button(page, 'Accept').click()
  await expect(page.locator('.card-opportunity')).toHaveCount(1)
})

test('Connect goals after a paused check runs the same coordination once and leaves no stale paused entry', async ({ page }) => {
  test.setTimeout(120_000)
  setResearch('broken')
  page.on('pageerror', error => { throw error })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await button(page, 'Explore a sample board').click()
  await answer(page, 'Explore a creative practice', 'I want to try a hands-on pottery class in San Francisco on Saturdays, under $25')
  await answer(page, 'Meet new people', 'I want to meet new people in San Francisco on Saturday afternoons, in a small group')
  await button(page, 'Fit board').click()
  await expect(page.locator('.link-pill.tone-error')).toHaveCount(2, { timeout: 60_000 })

  setResearch('ok')
  await button(page, 'Connect goals').click()
  await expect(panel(page).locator('.chat-outcome h3')).toHaveText('Saturday clay social', { timeout: 60_000 })
  await expect(page.locator('.link-pill.tone-error')).toHaveCount(0)
  await expect(page.locator('.link-pill.tone-ready')).toHaveCount(2)
  // Pressing it again reopens the same conversation instead of starting another.
  await button(page, 'Close chat').click()
  await button(page, 'Connect goals').click()
  await expect(panel(page).locator('.chat-outcome')).toHaveCount(1)
})
