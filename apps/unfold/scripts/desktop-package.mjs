import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Arch, build, Platform } from 'electron-builder'

const releaseMac = process.argv[2] === '--release-mac'
const releaseLinux = process.argv[2] === '--release-linux'
if (releaseMac && (process.platform !== 'darwin' || process.arch !== 'arm64')) {
  throw new Error('Run the macOS release build with native Node.js on an Apple Silicon Mac.')
}
if (releaseLinux && (process.platform !== 'linux' || process.arch !== 'x64')) {
  throw new Error('Run the Linux release build with x64 Node.js on Linux.')
}

let targets = Platform.current().createTarget('dir')
if (releaseMac) targets = Platform.MAC.createTarget('dmg', Arch.arm64)
if (releaseLinux) targets = Platform.LINUX.createTarget(['deb', 'AppImage'], Arch.x64)

const require = createRequire(import.meta.url)
// Electron downloads its runtime on first require; resolving package.json alone skips it.
require('electron')
const electronDist = join(dirname(require.resolve('electron/package.json')), 'dist')

await build({
  targets,
  publish: 'never',
  config: {
    electronDist,
    appId: 'com.unfold.visionboard',
    productName: 'Unfold',
    directories: { output: releaseMac || releaseLinux ? '../../output/desktop-release' : '../../output/desktop' },
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
    deb: {
      maintainer: 'Unfold <47900108+OlegBezr@users.noreply.github.com>',
      fpm: ['--depends', 'libgbm1', '--depends', 'libasound2t64 | libasound2'],
    },
    appImage: { artifactName: '${productName}-${version}-${arch}.${ext}' },
  },
})
