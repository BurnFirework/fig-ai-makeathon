import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, chmod, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { callCli } from '../server/cli'

await test('cancel waits until an owned CLI descendant ignoring SIGTERM has been killed', { skip: process.platform === 'win32' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'unfold-shutdown-'))
  const executable = join(directory, 'cli.cjs'), pidFile = join(directory, 'pid')
  let descendant: number | undefined
  try {
    await writeFile(executable, `#!${process.execPath}\nconst {spawn}=require('node:child_process');const {writeFileSync}=require('node:fs');const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync(${JSON.stringify(pidFile)},String(child.pid));process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);`)
    await chmod(executable, 0o700)
    const controller = new AbortController()
    const running = callCli({ provider: 'codex', binary: executable }, 'Synthetic test', controller.signal)
    const rejection = assert.rejects(running, /Stopped/)
    for (let attempt = 0; attempt < 100; attempt++) {
      try { descendant = Number(await readFile(pidFile, 'utf8')); break } catch { await new Promise(resolve => setTimeout(resolve, 20)) }
    }
    assert.ok(descendant)
    await new Promise(resolve => setTimeout(resolve, 100))
    controller.abort()
    await rejection
    let alive = true
    for (let attempt = 0; attempt < 50; attempt++) {
      try { process.kill(descendant, 0) } catch { alive = false; break }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(alive, false, 'Owned descendant must exit after group termination')
  } finally {
    if (descendant) { try { process.kill(descendant, 'SIGKILL') } catch { /* Exited. */ } }
    await rm(directory, { recursive: true, force: true })
  }
})
