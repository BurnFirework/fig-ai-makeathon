import { z } from 'zod'
import { EventSchema, RequestSchema } from './schema'

export const ProviderSchema = z.enum(['claude', 'codex', 'demo'])
export const AgentConfigSchema = z.object({
  mode: z.enum(['live', 'demo']), provider: z.string(),
  providers: z.array(z.object({ id: ProviderSchema, available: z.boolean(), version: z.string(), message: z.string() })),
})
export type AgentConfig = z.infer<typeof AgentConfigSchema>
export const AgentMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('config'), id: z.string() }),
  z.object({ type: z.literal('select'), id: z.string(), provider: ProviderSchema }),
  z.object({ type: z.literal('run'), id: z.string(), request: RequestSchema }),
  z.object({ type: z.literal('cancel'), id: z.string() }),
  z.object({ type: z.literal('stop') }),
])
export const AgentReplySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('config'), id: z.string(), config: AgentConfigSchema }),
  z.object({ type: z.literal('event'), id: z.string(), event: EventSchema }),
  z.object({ type: z.literal('failure'), id: z.string(), message: z.string() }),
])
export const AgentEventEnvelopeSchema = z.object({ requestId: z.string(), event: EventSchema })
export const AgentFailureSchema = z.object({ requestId: z.string(), message: z.string() })
