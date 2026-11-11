import { AgentMessageSchema } from '../shared/agent-contract'
import { runAgents } from '../server/agents'
import { discoverProviders, publicConfig, selectProvider, providerConfig } from '../server/cli'
import { parseAgentRequest } from '../server/runtime'

const port = process.parentPort
const running = new Map<string, AbortController>()
const state = { stopping: false }
const isStopping = () => state.stopping
port.on('message', ({ data }: { data: unknown }) => {
  const message = AgentMessageSchema.parse(data)
  const execute = async () => {
    if (message.type === 'stop') {
      state.stopping = true
      for (const controller of running.values()) controller.abort()
      if (!running.size) process.exit(0)
      return
    }
    if (message.type === 'cancel') { running.get(message.id)?.abort(); return }
    if (isStopping()) throw new Error('Agent host is stopping')
    if (message.type === 'config' || message.type === 'select') {
      if (message.type === 'select') await selectProvider(message.provider)
      port.postMessage({ type: 'config', id: message.id, config: publicConfig() }); return
    }
    if (running.has(message.id)) throw new Error('Duplicate agent request')
    const controller = new AbortController()
    running.set(message.id, controller)
    const timer = setTimeout(() => controller.abort(), 500_000)
    try {
      const request = parseAgentRequest(message.request)
      const result = await runAgents(request, providerConfig(), controller.signal, event => port.postMessage({ type: 'event', id: message.id, event }))
      controller.signal.throwIfAborted()
      port.postMessage({ type: 'event', id: message.id, event: { type: 'result', result } })
    } finally { clearTimeout(timer); running.delete(message.id); if (isStopping() && !running.size) process.exit(0) }
  }
  execute().catch((error: unknown) => {
    if ('id' in message) port.postMessage({ type: 'failure', id: message.id, message: error instanceof Error ? error.message : 'Agent request failed' })
  })
})
await discoverProviders()
port.postMessage({ type: 'ready' })
