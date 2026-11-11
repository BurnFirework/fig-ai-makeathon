import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { extname, join, resolve, sep } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { z } from 'zod'
import { RecoveryConflictError, WorkspaceFiles, atomicWrite } from './workspace-files'
import { WorkspaceSchema, encodeWorkspace } from '../shared/workspace-format'
import { createAgentHost } from './agent-host'

const directory = fileURLToPath(new URL('.', import.meta.url))
const developmentUrl = process.env.UNFOLD_DESKTOP_DEV_URL
if (developmentUrl && !/^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(developmentUrl)) throw new Error('Invalid development URL')
if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'Unfold Development'))
if (process.env.UNFOLD_DESKTOP_USER_DATA) app.setPath('userData', resolve(process.env.UNFOLD_DESKTOP_USER_DATA))
protocol.registerSchemesAsPrivileged([{ scheme: 'unfold', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.whenReady().then(async () => {
  const icon = join(directory, 'icon.png')
  if (!app.isPackaged) app.dock?.setIcon(icon)
  const root = resolve(directory, '../dist')
  protocol.handle('unfold', request => {
    const url = new URL(request.url)
    if (url.host !== 'app' || request.method !== 'GET') return new Response('Forbidden', { status: 403 })
    let path: string
    try { path = resolve(root, '.' + decodeURIComponent(url.pathname)) } catch { return new Response('Bad path', { status: 400 }) }
    if (path !== root && !path.startsWith(root + sep)) return new Response('Forbidden', { status: 403 })
    if (!existsSync(path) || !extname(path)) path = join(root, 'index.html')
    return net.fetch(pathToFileURL(path).toString()).then(response => {
      response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'; frame-src 'none'")
      return response
    })
  })
  const files = new WorkspaceFiles(app.getPath('userData'))
  const window = new BrowserWindow({ width: 1440, height: 960, minWidth: 800, minHeight: 650, title: 'Unfold', icon, webPreferences: { preload: join(directory, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } })
  const agents = createAgentHost(window)
  let mayClose = false
  let dirty = false
  let closePending = false
  let closeListener = false
  function authorized(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) {
    const url = event.senderFrame?.url
    return event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && (developmentUrl ? url?.startsWith(developmentUrl) === true : url?.startsWith('unfold://app/') === true)
  }
  function handle(channel: string, handler: (value: unknown) => unknown) {
    ipcMain.handle(channel, (event, value: unknown) => { if (!authorized(event)) throw new Error('Unauthorized native request'); return handler(value) })
  }
  const saveSchema = z.object({ session: z.string().uuid(), workspace: WorkspaceSchema })
  const filters = [{ name: 'Unfold workspace', extensions: ['unfold'] }]
  handle('workspace:load', async () => {
    try { return await files.load() } catch (error) {
      if (!(error instanceof RecoveryConflictError)) throw error
      const result = await dialog.showMessageBox(window, { type: 'warning', title: 'Recover your boards', message: error.savedAvailable ? `${error.sourceName} and its recovery contain different versions.` : error.message, detail: 'Choose the version to keep in Unfold. The other copy and any original workspace files will be preserved.', buttons: error.savedAvailable ? ['Use saved boards', 'Use recovered edits', 'Cancel'] : ['Use recovered edits', 'Cancel'], defaultId: 0, cancelId: error.savedAvailable ? 2 : 1 })
      if (result.response === (error.savedAvailable ? 2 : 1)) throw error
      return await files.load(error.savedAvailable && result.response === 0 ? 'saved' : 'recovery')
    }
  })
  handle('workspace:save', async value => { const result = await files.save(saveSchema.parse(value)); dirty = false; return result })
  handle('workspace:restore', async () => {
    const selected = await dialog.showOpenDialog(window, { title: 'Restore an Unfold backup', defaultPath: files.directory, filters, properties: ['openFile'] })
    const path = selected.filePaths[0]
    return selected.canceled || !path ? null : files.restoreFile(path)
  })
  handle('workspace:show-data', async () => { await mkdir(files.directory, { recursive: true }); const error = await shell.openPath(files.directory); if (error) throw new Error(error) })
  handle('workspace:export', async value => {
    const workspace = WorkspaceSchema.parse(value)
    const destination = await dialog.showSaveDialog(window, { title: 'Export backup', defaultPath: 'Unfold backup.unfold', filters })
    if (destination.canceled || !destination.filePath) return false
    if (resolve(destination.filePath).startsWith(files.directory + sep)) throw new Error('Choose a backup location outside Unfold’s data folder.')
    await atomicWrite(destination.filePath, encodeWorkspace(workspace)); return true
  })
  ipcMain.on('workspace:close-listener', (event, value: unknown) => { if (authorized(event)) closeListener = value === true })
  ipcMain.on('workspace:dirty', event => { if (authorized(event)) dirty = true })
  handle('workspace:close-ready', async value => {
    const success = z.boolean().parse(value); closePending = false
    if (success) { await agents.dispose(); mayClose = true; window.close() }
  })
  handle('agent:config', () => agents.config())
  handle('agent:select', value => agents.select(z.enum(['demo', 'claude', 'codex']).parse(value)))
  handle('agent:run', value => agents.run(value))
  handle('agent:cancel', value => agents.cancel(z.string().min(1).max(120).parse(value)))
  window.on('close', event => {
    if (mayClose) return
    event.preventDefault()
    if (!closeListener) {
      if (!closePending) { closePending = true; agents.dispose().finally(() => { mayClose = true; window.close() }).catch(() => {}) }
      return
    }
    if (!closePending) { closePending = true; window.webContents.send('workspace:close-requested', { dirty }) }
  })
  window.webContents.on('render-process-gone', () => { closePending = false; closeListener = false; agents.dispose().catch(() => {}) })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(developmentUrl ?? 'unfold://app/')) event.preventDefault() })
  app.on('second-instance', () => { if (window.isMinimized()) window.restore(); window.focus() })
  const command = (value: string) => { window.webContents.send('workspace:command', value) }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Unfold', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'File', submenu: [
      { label: 'Import…', click: () => command('import') },
      { label: 'Export backup…', click: () => command('export') },
      { label: 'Save now', accelerator: 'CmdOrCtrl+S', visible: false, acceleratorWorksWhenHidden: true, click: () => command('save') },
    ] },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]))
  if (developmentUrl) await window.loadURL(developmentUrl)
  else await window.loadURL('unfold://app/index.html')
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', event => { if (!mayClose && !window.isDestroyed()) { event.preventDefault(); window.close() } })
  }).catch((error: unknown) => { dialog.showErrorBox('Unfold could not start', error instanceof Error ? error.message : 'Startup failed'); app.exit(1) })
}
