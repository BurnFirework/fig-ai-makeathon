import { runAgents } from './agents'
import { runExplore } from './explore'
import type { CliConfig } from './cli'
import type { AgentEvent } from '../shared/schema'
import type { RuntimeRequest } from '../shared/agent-contract'
import { RuntimeRequestSchema } from '../shared/agent-contract'

export function parseAgentRequest(value: unknown) {
  const request = RuntimeRequestSchema.parse(value)
  if (request.operation === 'explore') return request
  if (request.operation === 'connect' && request.branches.length !== 2) throw new Error('Choose two different branches.')
  if (request.branches.length === 2 && request.branches[0]?.id === request.branches[1]?.id) throw new Error('Choose two different branches.')
  if (request.image && !/^data:image\/(png|jpeg|webp);base64,/.test(request.image)) throw new Error('Unsupported image.')
  return request
}


export async function runRuntime(request: RuntimeRequest, config: CliConfig, signal: AbortSignal, emit: (event: AgentEvent) => void) {
  const event: AgentEvent = request.operation === 'explore'
    ? { type: 'explore-result', result: await runExplore(request, signal, emit) }
    : { type: 'result', result: await runAgents(request, config, signal, emit) }
  signal.throwIfAborted()
  emit(event)
}
