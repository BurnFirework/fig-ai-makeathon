import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { build, Platform } from 'electron-builder'
const require = createRequire(import.meta.url)
const electronDist = join(dirname(require.resolve('electron/package.json')), 'dist')
await build({ targets: Platform.MAC.createTarget('dir'), config: { electronDist, appId: 'com.unfold.visionboard', productName: 'Unfold', directories: { output: 'output/desktop' }, files: ['dist/**', 'dist-desktop/**', 'package.json'], extraMetadata: { main: 'dist-desktop/main.js' }, asar: true, mac: { category: 'public.app-category.productivity', identity: null } } })
