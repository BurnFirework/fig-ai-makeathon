import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { z } from 'zod'
import { type Source, SourceSchema } from '../shared/schema'

const exec = promisify(execFile)
export type CliProvider = 'claude' | 'codex' | 'demo'
export interface CliConfig { provider: CliProvider; binary: string; model?: string }
export interface ProviderStatus { id: CliProvider; available: boolean; version: string; message: string }
let active: CliConfig = { provider: 'demo', binary: '' }
let statuses: ProviderStatus[] = []

function candidates(provider: 'claude' | 'codex') {
  const override = provider === 'claude' ? process.env.UNFOLD_CLAUDE_BIN : process.env.UNFOLD_CODEX_BIN
  return override ? [override] : provider === 'codex' ? [resolve('node_modules/.bin/codex'), 'codex'] : ['claude']
}
async function probe(provider: 'claude' | 'codex'): Promise<{ config?: CliConfig; status: ProviderStatus }> {
  for (const binary of candidates(provider)) {
    try {
      const { stdout } = await exec(binary, ['--version'], { timeout: 7000, maxBuffer: 32_000 })
      return { config: { provider, binary, ...(process.env.UNFOLD_MODEL ? { model: process.env.UNFOLD_MODEL } : {}) }, status: { id: provider, available: true, version: stdout.trim(), message: 'Installed. Uses your existing CLI sign-in.' } }
    } catch { /* Try the next configured local binary. */ }
  }
  return { status: { id: provider, available: false, version: '', message: `Install and sign in to ${provider === 'claude' ? 'Claude Code' : 'Codex CLI'} on this computer.` } }
}
export async function discoverProviders() {
  const [claude, codex] = await Promise.all([probe('claude'), probe('codex')])
  statuses = [claude.status, codex.status, { id: 'demo', available: true, version: '', message: 'Sample responses; no model or search.' }]
  const preferred = process.env.UNFOLD_PROVIDER || 'auto'
  active = (preferred === 'demo' ? undefined : preferred === 'claude' ? claude.config : preferred === 'codex' ? codex.config : claude.config || codex.config) || { provider: 'demo', binary: '' }
}
export function providerConfig() { return active }
export function publicConfig() { return { mode: active.provider === 'demo' ? 'demo' : 'live', provider: active.provider === 'claude' ? 'Claude Code' : active.provider === 'codex' ? 'Codex CLI' : 'Preview', providers: statuses } }
export async function selectProvider(provider: CliProvider) {
  if (provider === 'demo') { active = { provider: 'demo', binary: '' }; return }
  const result = await probe(provider)
  if (!result.config) throw new Error(result.status.message)
  active = result.config
}

const RecordSchema = z.record(z.string(), z.unknown())
export function readCliEvent(line: string, provider: 'claude' | 'codex') {
  const parsed = RecordSchema.safeParse(JSON.parse(line))
  if (!parsed.success) return { text: '', searched: false, urls: [] as string[], error: '' }
  const event = parsed.data
  const item = RecordSchema.safeParse(event.item)
  const message = RecordSchema.safeParse(event.message)
  let text = ''; let searched = false; let error = ''
  if (provider === 'codex' && event.type === 'item.completed' && item.success) {
    if (item.data.type === 'agent_message' && typeof item.data.text === 'string') text = item.data.text
    if (item.data.type === 'web_search') searched = true
  }
  if (provider === 'claude') {
    if (event.type === 'result') {
      if (event.is_error) error = typeof event.result === 'string' ? event.result : 'Claude Code could not complete this request.'
      else if (event.structured_output) text = JSON.stringify(event.structured_output)
      else if (typeof event.result === 'string') text = event.result
    }
    if (message.success && Array.isArray(message.data.content)) {
      searched = message.data.content.some(part => { const block = RecordSchema.safeParse(part); return block.success && block.data.type === 'tool_use' && block.data.name === 'WebSearch' })
    }
  }
  if (event.type === 'turn.failed' || event.type === 'error') error = 'The CLI request failed. Check that you are signed in and have subscription usage available.'
  // Evidence URLs come from tool events, never from the final assistant message.
  const toolResult = provider === 'claude' && event.type === 'user' && message.success && Array.isArray(message.data.content) && message.data.content.some(part => { const block = RecordSchema.safeParse(part); return block.success && block.data.type === 'tool_result' })
  const evidence = (provider === 'codex' && item.success && item.data.type === 'web_search') || toolResult
  const urls = evidence ? [...line.matchAll(/https?:\/\/[^\s"<>\\]+/g)].map(match => match[0].replace(/[),.;]+$/, '')) : []
  return { text, searched, urls, error }
}

export async function callCli(config: CliConfig, prompt: string, signal: AbortSignal, options: { search?: boolean; image?: string } = {}): Promise<{ text: string; sources: Source[] }> {
  if (config.provider === 'demo') throw new Error('Preview mode has no live provider.')
  const provider = config.provider
  const directory = await mkdtemp(join(tmpdir(), 'unfold-agent-'))
  try {
    let imagePath: string | undefined
    if (options.image) {
      const image = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(options.image)
      if (!image?.[1] || !image[2]) throw new Error('Unsupported image input.')
      imagePath = join(directory, `inspiration.${image[1] === 'jpeg' ? 'jpg' : image[1]}`)
      await writeFile(imagePath, Buffer.from(image[2], 'base64'), { mode: 0o600 })
    }
    const args = provider === 'codex'
      ? ['exec', '--json', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '--sandbox', 'read-only', '--disable', 'shell_tool', '--disable', 'hooks', '-c', `web_search="${options.search ? 'live' : 'disabled'}"`, ...(config.model ? ['--model', config.model] : []), ...(imagePath ? ['--image', imagePath] : []), '-']
      : ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--max-turns', '8', '--permission-mode', 'dontAsk', '--tools', options.search ? 'WebSearch,WebFetch' : '', '--allowedTools', options.search ? 'WebSearch,WebFetch' : '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '', '--settings', '{"disableAllHooks":true}', ...(config.model ? ['--model', config.model] : [])]
    const env = { ...process.env }
    // Subscription login stays with the CLI; don't silently choose API-key billing.
    for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDECODE']) delete env[key]
    let input = prompt
    if (provider === 'claude') {
      const content: unknown[] = [{ type: 'text', text: prompt }]
      if (options.image) { const match = /^data:([^;]+);base64,(.+)$/.exec(options.image); if (match) content.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }) }
      input = JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n'
    }
    const output = await new Promise<{ text: string; searched: boolean; urls: string[] }>((resolve, reject) => {
      const child = spawn(config.binary, args, { cwd: directory, env, stdio: ['pipe', 'pipe', 'pipe'], shell: false, detached: process.platform !== 'win32' })
      let buffer = ''; let text = ''; let searched = false; let stderr = ''; let total = 0; let eventError = ''
      const urls = new Set<string>()
      const kill = () => { try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGTERM') } catch { /* Already exited. */ } }
      const timer = setTimeout(kill, 115_000)
      const abort = () => kill()
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) kill()
      child.stdin.on('error', () => {})
      child.stdout.on('data', (chunk: Buffer) => {
        total += chunk.length
        if (total > 5_000_000) { eventError = 'The provider returned too much data.'; kill(); return }
        buffer += chunk.toString()
        let newline: number
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
          if (!line.trim()) continue
          try { const event = readCliEvent(line, provider); if (event.text) text = event.text; searched ||= event.searched; event.urls.forEach(url => urls.add(url)); if (event.error) eventError = event.error } catch { /* Non-protocol diagnostic, not an application result. */ }
        }
      })
      child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000) })
      child.on('error', error => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new Error(`Could not launch ${provider}: ${error.message}`)) })
      child.on('close', code => {
        clearTimeout(timer); signal.removeEventListener('abort', abort)
        if (signal.aborted) { reject(new Error('Stopped.')); return }
        if (code !== 0 || eventError || !text) { reject(new Error(eventError || `${provider === 'claude' ? 'Claude Code' : 'Codex CLI'} could not complete the request. Run its login command and check subscription availability.${/auth|login|sign in/i.test(stderr) ? ' Sign-in is required.' : ''}`)); return }
        resolve({ text, searched, urls: [...urls] })
      })
      child.stdin.end(input)
    })
    signal.throwIfAborted()
    if (!options.search) return { text: output.text, sources: [] }
    if (!output.searched) throw new Error('The research agent did not execute web search. Please retry; no search result was assumed.')
    const result = z.object({ text: z.string(), sources: z.array(SourceSchema).min(1) }).parse(JSON.parse(output.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()))
    const sources = result.sources.filter(source => output.urls.some(url => url === source.url || url.replace(/\/$/, '') === source.url.replace(/\/$/, '')))
    if (!sources.length) throw new Error('Research did not return sources visible in its tool results. Ask the agent to open and verify the source pages, then retry.')
    return { text: result.text, sources }
  } finally { await rm(directory, { recursive: true, force: true }) }
}
