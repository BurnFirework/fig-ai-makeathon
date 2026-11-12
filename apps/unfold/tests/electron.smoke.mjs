// pnpm desktop:package && pnpm test:desktop
import { _electron, expect } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { decodeWorkspace } from '../shared/workspace-format.ts'
const directory = await mkdtemp(join(tmpdir(), 'unfold-desktop-smoke-'))
const path = join(directory, 'Workspace.unfold')
const libraryPath = join(directory, 'profile', 'workspaces', 'default.unfold')
const packagedExecutable = process.platform === 'darwin'
  ? `mac${process.arch === 'arm64' ? '-arm64' : ''}/Unfold.app/Contents/MacOS/Unfold`
  : process.platform === 'win32' ? `win${process.arch === 'x64' ? '' : `-${process.arch}`}-unpacked/Unfold.exe` : `linux${process.arch === 'x64' ? '' : `-${process.arch}`}-unpacked/unfold`
const workspaceRoot = resolve(import.meta.dirname, '../../..')
const output = join(workspaceRoot, 'output/desktop')
const executablePath = process.env.UNFOLD_SMOKE_EXECUTABLE
  ? resolve(workspaceRoot, process.env.UNFOLD_SMOKE_EXECUTABLE)
  : join(output, packagedExecutable)
// Opt out only for this isolated test profile in containers without sandbox support.
const args = process.env.UNFOLD_SMOKE_NO_SANDBOX === '1' ? ['--no-sandbox'] : []
let app
try {
  app = await _electron.launch({ executablePath, args, cwd: directory, env: { ...process.env, UNFOLD_DESKTOP_USER_DATA: join(directory, 'profile'), UNFOLD_PROVIDER: 'demo' }, timeout: 30000 })
  const page = await app.firstWindow()
  const blockedAssets = []
  page.on('console', message => { if (/violates.*(?:img-src|font-src)/i.test(message.text())) blockedAssets.push(message.text()) })
  page.on('pageerror', error => console.error('Renderer error:', error))
  await expect(page.getByRole('button', { name: 'Explore a sample board' })).toBeVisible()
  await page.evaluate(async () => { await document.fonts.ready })
  if (blockedAssets.length) throw new Error(`Packaged canvas assets were blocked: ${blockedAssets.join('\n')}`)
  if (!await page.evaluate(() => Array.from(document.fonts).some(font => font.status === 'loaded' && /tldraw/.test(font.family)))) throw new Error('Packaged tldraw fonts did not load')
  // tldraw can disable production rendering five seconds after the first successful paint.
  await page.waitForTimeout(6000)
  await expect(page.getByTestId('tl-license-expired')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Explore a sample board' })).toBeVisible()
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => { throw new Error('Normal desktop use must not ask for a save location') }
    dialog.showOpenDialog = async () => { throw new Error('Normal desktop use must not ask for a workspace') }
  })
  await page.getByRole('button', { name: 'Explore a sample board' }).click()
  await expect(page.locator('.card-inspiration')).toHaveCount(2)
  await page.getByRole('button', { name: /^Mood boards:/ }).click()
  await page.getByRole('menuitem', { name: 'New mood board', exact: true }).click()
  await page.getByRole('textbox', { name: 'Board name', exact: true }).fill('Second desktop board')
  await page.getByRole('button', { name: 'Create board', exact: true }).click()
  await expect(page.locator('.card-inspiration')).toHaveCount(0)
  await page.getByRole('button', { name: 'Explore a sample board' }).click()
  await expect(page.locator('.card-inspiration')).toHaveCount(2)
  await expect(page.getByRole('status').filter({ hasText: 'Saved on this device' })).toBeVisible()
  const workspace = decodeWorkspace(new Uint8Array(await readFile(libraryPath)))
  if (workspace.catalog.boards.length !== 2 || Object.keys(workspace.assets).length < 2) throw new Error('File did not contain both images')
  await page.getByRole('button', { name: 'Board menu', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: /Save|New workspace|Open workspace/ })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: 'Show data folder', exact: true })).toBeVisible()
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, path)
  await page.getByRole('menuitem', { name: 'Export backup', exact: true }).click()
  await expect.poll(async () => { try { return decodeWorkspace(new Uint8Array(await readFile(path))).catalog.boards.length } catch { return 0 } }).toBe(2)
  await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => { throw new Error('Autosave must not ask for a location') } })
  await page.getByRole('button', { name: 'Board menu', exact: true }).click()
  const choosing = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: 'Import', exact: true }).click()
  await (await choosing).setFiles(path)
  await expect(page.getByRole('status').filter({ hasText: 'Saved on this device' })).toBeVisible()
  await expect.poll(async () => decodeWorkspace(new Uint8Array(await readFile(libraryPath))).catalog.boards.length).toBe(4)
  if (decodeWorkspace(new Uint8Array(await readFile(path))).catalog.boards.length !== 2) throw new Error('Import altered its source backup')
  // Photos ignore DOM pointer events so tldraw can hit-test the canvas underneath.
  await page.getByRole('img', { name: 'Explore a creative practice', exact: true }).hover({ force: true })
  await page.getByRole('button', { name: 'Explore Explore a creative practice', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Yes, I want to try', exact: false })).toBeVisible({ timeout: 30000 })
  const composer = page.getByRole('textbox', { name: 'Message', exact: true })
  await composer.fill('Add a note about light and color.')
  await composer.press('Enter')
  await page.getByRole('group', { name: 'Suggested for your canvas' }).getByRole('button', { name: 'Add to canvas', exact: true }).click()
  await expect(page.locator('.card-artifact')).toContainText('light and color')
  await expect(page.getByRole('status').filter({ hasText: 'Saved on this device' })).toBeVisible()
  await expect.poll(async () => {
    const saved = decodeWorkspace(new Uint8Array(await readFile(libraryPath)))
    const board = saved.boards[saved.catalog.activeId]
    return Object.values(board?.document.store ?? {}).some(record => record.typeName === 'unfold_conversation' && record.chat.messages.some(message => message.role === 'assistant' && message.outcomeIds?.length))
  }).toBe(true)
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
      const note = 'Create one note titled Warm oak with a description about soft daylight. Add it to the board now.'
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { bridge.cancel(requestId); reject(new Error('Live smoke timed out')) }, 125000)
        const off = bridge.onEvent(payload => { if (payload.requestId === requestId && payload.event.type === 'result') { clearTimeout(timer); off(); offFailure(); resolve(payload.event.result) } })
        const offFailure = bridge.onFailure(payload => { if (payload.requestId === requestId) { clearTimeout(timer); off(); offFailure(); reject(new Error(payload.message)) } })
        bridge.run({ requestId, operation: 'branch', branches: [{ id: 'synthetic', goal: 'Study room materials', revision: 0, answers: [], confirmed: [], assumptions: [], previousSuggestions: [] }], note, board: { conversationId: 'synthetic-chat', focusId: 'synthetic', attachedIds: ['synthetic'], selectedIds: ['synthetic'], cards: [{ id: 'synthetic', title: 'Room materials', image: false, revision: 0 }], links: [], messages: [{ role: 'user', text: note }] } }).catch(reject)
      })
    })
    if (live.mode !== 'live' || !live.edits.some(edit => edit.kind === 'createNode' && edit.content.kind === 'note')) throw new Error('Codex did not return a structured board edit')
    console.log('PASS installed Codex returned a structured board edit from the packaged app outside project cwd')
  }
  await page.screenshot({ path: join(output, 'smoke.png') })
  await app.close(); app = undefined
  app = await _electron.launch({ executablePath, args, cwd: directory, env: { ...process.env, UNFOLD_DESKTOP_USER_DATA: join(directory, 'profile'), UNFOLD_PROVIDER: 'demo' } })
  const reopened = await app.firstWindow()
  await expect(reopened.getByRole('status').filter({ hasText: 'Saved on this device' })).toBeVisible()
  await expect(reopened.locator('.card-inspiration')).toHaveCount(2)
  await expect(reopened.locator('.card-artifact')).toContainText('light and color')
  const images = reopened.locator('.card-inspiration img')
  await expect(images).toHaveCount(2)
  if (!(await images.evaluateAll(nodes => nodes.every(image => image.complete && image.naturalWidth > 0)))) throw new Error('Saved desktop images failed to decode')
  if (decodeWorkspace(new Uint8Array(await readFile(libraryPath))).catalog.boards.length !== 4) throw new Error('Imported boards were not retained after restart')
  console.log('PASS packaged desktop: local save, export/import, generated card and conversation, quit and reopen')
  await app.close(); app = undefined
  const recoveryPath = join(directory, 'profile', 'workspaces', 'recovery.json')
  await writeFile(libraryPath, 'damaged library')
  await writeFile(recoveryPath, '{truncated')
  app = await _electron.launch({ executablePath, args, cwd: directory, env: { ...process.env, UNFOLD_DESKTOP_USER_DATA: join(directory, 'profile'), UNFOLD_PROVIDER: 'demo' } })
  const recoveryPage = await app.firstWindow()
  await expect(recoveryPage.getByRole('alert')).toContainText('library and its recovery could not be read')
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, path)
  await recoveryPage.getByRole('button', { name: 'Restore backup…', exact: true }).click()
  await expect(recoveryPage.locator('.card-inspiration')).toHaveCount(2)
  await expect(recoveryPage.getByRole('status').filter({ hasText: 'Saved on this device' })).toBeVisible()
  console.log('PASS packaged desktop: damaged library offers backup restore without silently replacing saved boards')
} catch (error) {
  const page = app?.windows()[0]
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(output, 'smoke-error.png') }).catch(() => {})
    await writeFile(join(output, 'smoke-error.txt'), await page.locator('body').innerText()).catch(() => {})
  }
  throw error
} finally {
  // The isolated test profile can be discarded even when a failed UI cannot answer close requests.
  if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}) }
  await rm(directory, { recursive: true, force: true })
}
