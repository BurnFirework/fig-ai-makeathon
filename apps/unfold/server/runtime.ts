import { runAgents } from './agents'
import { runExplore } from './explore'
import type { CliConfig } from './cli'
import { NodeSchema, ChatSchema } from '../shared/schema'
import type { AgentEvent } from '../shared/schema'
import type { RuntimeRequest } from '../shared/agent-contract'
import { RuntimeRequestSchema } from '../shared/agent-contract'

export function parseAgentRequest(value: unknown) {
  const request = RuntimeRequestSchema.parse(value)
  if (request.operation === 'explore') {
    if (request.board) {
      const ids = new Set(request.board.cards.map(card => card.id))
      if (ids.size !== request.board.cards.length || request.topics.some(topic => !ids.has(topic.sourceId))) throw new Error('The board snapshot is incomplete. Retry the exploration.')
      request.board.cards.forEach(card => { NodeSchema.parse(card.node); if (card.image && !/^data:image\/(png|jpeg|webp);base64,/.test(card.image)) throw new Error('Unsupported image.') })
      request.board.conversations.forEach(chat => ChatSchema.parse(chat))
    }
    return request
  }
  if (request.operation === 'connect' && request.branches.length !== 2) throw new Error('Choose two different branches.')
  if (request.branches.length === 2 && request.branches[0]?.id === request.branches[1]?.id) throw new Error('Choose two different branches.')
  if (request.image && !/^data:image\/(png|jpeg|webp);base64,/.test(request.image)) throw new Error('Unsupported image.')
  return request
}


export async function runRuntime(request: RuntimeRequest, config: CliConfig, signal: AbortSignal, emit: (event: AgentEvent) => void) {
  const event: AgentEvent = request.operation === 'explore'
    ? { type: 'explore-result', result: await runExplore(request, signal, emit, config) }
    : { type: 'result', result: await runAgents(request, config, signal, emit) }
  signal.throwIfAborted()
  emit(event)
}
