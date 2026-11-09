// pnpm desktop:package && node --import tsx tests/electron.smoke.mjs
import { _electron, expect } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { decodeWorkspace } from '../shared/workspace-format.ts'
const directory = await mkdtemp(join(tmpdir(), 'unfold-desktop-smoke-'))
const path = join(directory, 'Workspace.unfold')
const executablePath = process.env.UNFOLD_SMOKE_EXECUTABLE || resolve('output/desktop/mac-arm64/Unfold.app/Contents/MacOS/Unfold')
let app
try {
  app = await _electron.launch({ executablePath, cwd: directory, env: { ...process.env, UNFOLD_DESKTOP_USER_DATA: join(directory, 'profile'), UNFOLD_PROVIDER: 'demo' }, timeout: 30000 })
  const page = await app.firstWindow()
  page.on('pageerror', error => console.error('Renderer error:', error))
  await expect(page.getByRole('button', { name: 'Explore a sample board' })).toBeVisible()
  // tldraw can disable production rendering five seconds after the first successful paint.
  await page.waitForTimeout(6000)
  await expect(page.getByTestId('tl-license-expired')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Explore a sample board' })).toBeVisible()
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, path)
  await page.getByRole('button', { name: 'Explore a sample board' }).click()
  await expect(page.locator('.card-inspiration')).toHaveCount(2)
  await page.getByRole('button', { name: /^Mood boards:/ }).click()
  await page.getByRole('menuitem', { name: 'New mood board', exact: true }).click()
  await page.getByRole('textbox', { name: 'Board name', exact: true }).fill('Second desktop board')
  await page.getByRole('button', { name: 'Create board', exact: true }).click()
  await expect(page.locator('.card-inspiration')).toHaveCount(0)
  await page.getByRole('button', { name: 'Explore a sample board' }).click()
  await expect(page.locator('.card-inspiration')).toHaveCount(2)
  await page.getByRole('button', { name: 'Workspace files' }).click()
  await page.getByRole('menuitem', { name: 'Save workspace', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved to file' })).toBeVisible()
  const workspace = decodeWorkspace(new Uint8Array(await readFile(path)))
  if (workspace.catalog.boards.length !== 2 || Object.keys(workspace.assets).length < 2) throw new Error('File did not contain both images')
  // Photos ignore DOM pointer events so tldraw can hit-test the canvas underneath.
  await page.getByRole('img', { name: 'Explore a creative practice', exact: true }).hover({ force: true })
  await page.getByRole('button', { name: 'Explore Explore a creative practice', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Yes, I want to try', exact: false })).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: 'Close chat', exact: true }).click()
  await page.waitForTimeout(1000)
  const result = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    return await window.webContents.executeJavaScript('window.unfoldDesktop.agents.config()')
  })
  if (result.mode !== 'demo') throw new Error('Packaged local agent child did not respond')
  if (process.env.UNFOLD_SMOKE_LIVE === '1') {
    const live = await page.evaluate(async () => {
      const bridge = window.unfoldDesktop.agents
      await bridge.select('codex')
      const requestId = crypto.randomUUID()
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { bridge.cancel(requestId); reject(new Error('Live smoke timed out')) }, 125000)
        const off = bridge.onEvent(payload => { if (payload.requestId === requestId && payload.event.type === 'result') { clearTimeout(timer); off(); offFailure(); resolve(payload.event.result.mode) } })
        const offFailure = bridge.onFailure(payload => { if (payload.requestId === requestId) { clearTimeout(timer); off(); offFailure(); reject(new Error(payload.message)) } })
        bridge.run({ requestId, operation: 'branch', branches: [{ id: 'synthetic', goal: 'Try watercolor painting', revision: 0, answers: [], confirmed: [], assumptions: [], previousSuggestions: [] }], note: 'Ask one short question to clarify this synthetic test goal.' }).catch(reject)
      })
    })
    if (live !== 'live') throw new Error('Real provider was silently replaced with demo')
    console.log('PASS installed Codex discovery and real live request from packaged app outside project cwd')
  }
  await page.screenshot({ path: resolve('output/desktop/smoke.png') })
  await app.close(); app = undefined
  app = await _electron.launch({ executablePath, cwd: directory, env: { ...process.env, UNFOLD_DESKTOP_USER_DATA: join(directory, 'profile'), UNFOLD_PROVIDER: 'demo' } })
  const reopened = await app.firstWindow()
  await expect(reopened.locator('.card-inspiration')).toHaveCount(2)
  const images = reopened.locator('.card-inspiration img')
  await expect(images).toHaveCount(2)
  if (!(await images.evaluateAll(nodes => nodes.every(image => image.complete && image.naturalWidth > 0)))) throw new Error('Saved desktop images failed to decode')
  console.log('PASS packaged macOS: native save, real image archive, AI utility process, reopen with decoded images')
} catch (error) {
  const page = app?.windows()[0]
  if (page && !page.isClosed()) {
    await page.screenshot({ path: resolve('output/desktop/smoke-error.png') }).catch(() => {})
    await writeFile(resolve('output/desktop/smoke-error.txt'), await page.locator('body').innerText()).catch(() => {})
  }
  throw error
} finally {
  // The isolated test profile can be discarded even when a failed UI cannot answer close requests.
  if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}) }
  await rm(directory, { recursive: true, force: true })
}
