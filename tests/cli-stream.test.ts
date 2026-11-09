import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { callCli } from '../server/cli'

await test('CLI preserves split UTF-8 and consumes the last JSON line without a newline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'unfold-utf8-'))
  try {
    const executable = join(directory, 'codex.cjs')
    await writeFile(executable, `#!${process.execPath}\nconst bytes=Buffer.from(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'café 🎨'}}));const cut=bytes.indexOf(Buffer.from('🎨'))+1;process.stdout.write(bytes.subarray(0,cut));setTimeout(()=>process.stdout.end(bytes.subarray(cut)),50);`)
    await chmod(executable, 0o700)
    const result = await callCli({ provider: 'codex', binary: executable }, 'Synthetic test', new AbortController().signal)
    assert.equal(result.text, 'café 🎨')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
