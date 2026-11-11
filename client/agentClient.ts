import { type AgentEvent, type AgentRequest, type AgentResult, EventSchema } from '../shared/schema'
import { AgentConfigSchema, AgentEventEnvelopeSchema, AgentFailureSchema, ProviderSchema, type AgentConfig } from '../shared/agent-contract'
import { demoRuntime } from '../shared/preview'
import { runCoordinator } from '../shared/coordinator'
import { z } from 'zod'

const previewConfig: AgentConfig = { mode: 'demo', provider: 'Preview', providers: [{ id: 'demo', available: true, version: '', message: 'Local preview; no model or search.' }] }
let localPreview = false
export async function getAgentConfig(): Promise<AgentConfig> {
  const desktop = typeof window === 'undefined' ? undefined : window.unfoldDesktop
  if (desktop) return AgentConfigSchema.parse(await desktop.agents.config())
  try {
    const response = await fetch('/api/config')
    if (!response.ok) throw new Error('No local runtime')
    const result = AgentConfigSchema.parse(await response.json()); localPreview = false; return result
  } catch { localPreview = true; return previewConfig }
}
export async function selectAgentProvider(value: string): Promise<AgentConfig> {
  const provider = ProviderSchema.parse(value)
  const desktop = typeof window === 'undefined' ? undefined : window.unfoldDesktop
  if (desktop) return AgentConfigSchema.parse(await desktop.agents.select(provider))
  if (localPreview) {
    if (provider !== 'demo') throw new Error('Live AI requires the desktop app or local helper.')
    return previewConfig
  }
  const response = await fetch('/api/provider', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }) })
  if (!response.ok) {
    const detail = await response.json().then((body: unknown) => z.object({ error: z.string() }).safeParse(body).data?.error, () => undefined)
    throw new Error(detail || 'Provider unavailable. Check its installation and sign-in.')
  }
  const config = await fetch('/api/config')
  if (!config.ok) throw new Error('Provider configuration is unavailable.')
  return AgentConfigSchema.parse(await config.json())
}
export async function requestAgent(request: AgentRequest, signal: AbortSignal, onEvent: (event: Extract<AgentEvent, { type: 'activity' | 'handoff' }>) => void): Promise<AgentResult> {
  signal.throwIfAborted()
  const bridge = typeof window === 'undefined' ? undefined : window.unfoldDesktop
  if (bridge) return new Promise<AgentResult>((resolve, reject) => {
    const finish = (error?: Error, result?: AgentResult) => { unsubscribe(); unsubscribeFailure(); signal.removeEventListener('abort', abort); clearTimeout(timer); if (error) reject(error); else if (result) resolve(result) }
    const abort = () => { bridge.agents.cancel(request.requestId).catch(() => {}); finish(new Error('Stopped.')) }
    const unsubscribe = bridge.agents.onEvent(value => {
      const parsed = AgentEventEnvelopeSchema.safeParse(value)
      if (!parsed.success || parsed.data.requestId !== request.requestId) return
      const event = parsed.data.event
      if (event.type === 'activity' || event.type === 'handoff') onEvent(event)
      else if (event.type === 'result') finish(undefined, event.result)
      else finish(new Error(event.message))
    })
    const unsubscribeFailure = bridge.agents.onFailure(value => {
      const parsed = AgentFailureSchema.safeParse(value)
      if (parsed.success && parsed.data.requestId === request.requestId) finish(new Error(parsed.data.message))
    })
    const timer = setTimeout(() => { bridge.agents.cancel(request.requestId).catch(() => {}); finish(new Error('The request timed out. Please retry.')) }, 510_000)
    signal.addEventListener('abort', abort, { once: true })
    bridge.agents.run(request).catch((error: unknown) => finish(error instanceof Error ? error : new Error('Local agents unavailable.')))
  })
  // A helper that was restarting when the page loaded may be back: reconnect instead of staying in preview.
  if (localPreview) await getAgentConfig()
  if (localPreview) {
    onEvent({ type: 'activity', role: 'coordinator', message: 'Preview agents only. No live model or web search is being used.' })
    return runCoordinator(request, demoRuntime(200), signal, event => { if (event.type === 'activity' || event.type === 'handoff') onEvent(event) })
  }
  const response = await fetch('/api/agent', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
  if (!response.ok) throw new Error(`Agent request failed (${response.status}). Please retry.`)
  if (!response.body) throw new Error('The agent returned an empty response.')
  const reader = response.body.getReader(); const decoder = new TextDecoder()
  let buffer = ''; let result: AgentResult | undefined
  const accept = (line: string) => {
    if (!line.trim()) return
    // A reply that does not match the contract is reported plainly, never as raw validation output.
    const parsed = EventSchema.safeParse(JSON.parse(line))
    if (!parsed.success) throw new Error('The agents returned a reply Unfold could not read. Nothing was added; please retry.')
    const event = parsed.data
    if (event.type === 'error') throw new Error(event.message)
    if (event.type === 'activity' || event.type === 'handoff') onEvent(event)
    if (event.type === 'result') result = event.result
  }
  try {
    let chunk = await reader.read()
    while (!chunk.done) {
      buffer += decoder.decode(chunk.value, { stream: true })
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) { accept(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1) }
      chunk = await reader.read()
    }
    buffer += decoder.decode(); accept(buffer)
  } finally { reader.releaseLock() }
  signal.throwIfAborted()
  if (!result || result.requestId !== request.requestId) throw new Error('The agent response was incomplete. Please retry.')
  return result
}
