import { type AgentEvent, type AgentRequest, type AgentResult, EventSchema } from '../shared/schema'

export async function requestAgent(request: AgentRequest, signal: AbortSignal, onActivity: (event: Extract<AgentEvent, { type: 'activity' }>) => void): Promise<AgentResult> {
  const response = await fetch('/api/agent', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
  if (!response.ok) throw new Error(`Agent request failed (${response.status}). Please retry.`)
  if (!response.body) throw new Error('The agent returned an empty response.')
  const reader = response.body.getReader(); const decoder = new TextDecoder()
  let buffer = ''; let result: AgentResult | undefined
  const accept = (line: string) => {
    if (!line.trim()) return
    const event = EventSchema.parse(JSON.parse(line))
    if (event.type === 'error') throw new Error(event.message)
    if (event.type === 'activity') onActivity(event)
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
