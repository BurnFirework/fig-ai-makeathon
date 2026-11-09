import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { build, Platform } from 'electron-builder'
const require = createRequire(import.meta.url)
// Electron downloads its runtime on first require; resolving package.json alone skips it.
require('electron')
const electronDist = join(dirname(require.resolve('electron/package.json')), 'dist')
await build({ targets: Platform.MAC.createTarget('dir'), config: { electronDist, appId: 'com.unfold.visionboard', productName: 'Unfold', directories: { output: 'output/desktop' }, files: ['dist/**', 'dist-desktop/**', 'package.json'], extraMetadata: { main: 'dist-desktop/main.js' }, asar: true, mac: { icon: 'desktop/icon.png', category: 'public.app-category.productivity', identity: null } } })
