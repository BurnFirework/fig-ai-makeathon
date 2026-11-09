import { build } from 'esbuild'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
await mkdir('dist-desktop', { recursive: true })
// Native PNG rendering of public/favicon.svg, shared by development and packaged apps.
await copyFile('desktop/icon.png', 'dist-desktop/icon.png')
await build({ entryPoints: ['desktop/main.ts', 'desktop/agent-entry.ts'], outdir: 'dist-desktop', bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['electron'], sourcemap: true })
await build({ entryPoints: ['desktop/preload.ts'], outfile: 'dist-desktop/preload.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] })
await writeFile('dist-desktop/package.json', JSON.stringify({ type: 'module' }))
