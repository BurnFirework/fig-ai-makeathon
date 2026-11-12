import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Arch, build, Platform } from 'electron-builder'

const releaseMac = process.argv.includes('--release-mac')
if (releaseMac && (process.platform !== 'darwin' || process.arch !== 'arm64')) {
  throw new Error('Run the macOS release build with native Node.js on an Apple Silicon Mac.')
}

const require = createRequire(import.meta.url)
// Electron downloads its runtime on first require; resolving package.json alone skips it.
require('electron')
const electronDist = join(dirname(require.resolve('electron/package.json')), 'dist')

await build({
  targets: releaseMac ? Platform.MAC.createTarget('dmg', Arch.arm64) : Platform.current().createTarget('dir'),
  publish: 'never',
  config: {
    electronDist,
    appId: 'com.unfold.visionboard',
    productName: 'Unfold',
    directories: { output: releaseMac ? '../../output/desktop-release' : '../../output/desktop' },
    files: ['dist/**', 'dist-desktop/**', 'package.json'],
    extraMetadata: { main: 'dist-desktop/main.js' },
    asar: true,
    forceCodeSigning: releaseMac,
    mac: {
      icon: 'desktop/icon.png',
      category: 'public.app-category.productivity',
      ...(releaseMac
        // Submit the final disk image to Apple after packaging.
        ? { type: 'distribution', hardenedRuntime: true, notarize: false }
        : { identity: null }),
    },
    dmg: { sign: true, writeUpdateInfo: false },
    linux: { icon: 'desktop/icon.png', category: 'Graphics' },
  },
})
