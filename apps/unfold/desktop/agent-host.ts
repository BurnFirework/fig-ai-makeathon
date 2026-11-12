import { utilityProcess, type BrowserWindow } from 'electron'
import { join, delimiter } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { AgentReplySchema, type AgentConfig } from '../shared/agent-contract'
import { parseAgentRequest } from '../server/runtime'

export function createAgentHost(window: BrowserWindow) {
  let child: ReturnType<typeof utilityProcess.fork> | undefined
  let ready: Promise<void> | undefined
  const lifecycle = { disposed: false }
  const isDisposed = () => lifecycle.disposed
  const pending = new Map<string, { resolve: (config: AgentConfig) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  const active = new Set<string>()
  const failAll = () => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Local agent process stopped. Try again.')) }
    pending.clear()
    for (const requestId of active) if (!window.isDestroyed()) window.webContents.send('agent:failure', { requestId, message: 'Local agent process stopped. Try again.' })
    active.clear()
  }
  const start = () => {
    if (isDisposed()) return Promise.reject(new Error('Agent host has closed'))
    if (ready) return ready
    ready = (async () => {
      const env = { ...process.env }
      if (process.platform === 'darwin') {
        try {
          const { COMPOSIO_API_KEY: _composio, TICKETMASTER_API_KEY: _ticketmaster, ...shellEnv } = env
          const result = await promisify(execFile)(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "%s" "$PATH"'], { timeout: 5000, maxBuffer: 64_000, env: shellEnv })
          env.PATH = result.stdout.trim()
        } catch { /* Known executable directories remain available if shell discovery fails. */ }
      }
      env.PATH = [...new Set([env.PATH || '', '/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local/bin')])].join(delimiter)
      if (isDisposed()) throw new Error('Agent host has closed')
      const host = utilityProcess.fork(join(import.meta.dirname, 'agent-entry.js'), [], { env, serviceName: 'Unfold agents', stdio: 'pipe' })
      child = host
      host.stdout?.on('data', () => {})
      host.stderr?.on('data', () => {})
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { host.kill(); reject(new Error('Local agents did not start in time.')) }, 20_000)
        host.on('message', (value: unknown) => {
          const parsed = AgentReplySchema.safeParse(value)
          if (!parsed.success) return
          const message = parsed.data
          if (message.type === 'ready') { clearTimeout(timer); resolve(); return }
          if (message.type === 'config') {
            const waiter = pending.get(message.id)
            if (waiter) { clearTimeout(waiter.timer); waiter.resolve(message.config); pending.delete(message.id) }
          } else if (message.type === 'event') {
            if (!active.has(message.id)) return
            if (!window.isDestroyed()) window.webContents.send('agent:event', { requestId: message.id, event: message.event })
            if (message.event.type === 'result' || message.event.type === 'explore-result' || message.event.type === 'error') active.delete(message.id)
          } else {
            const waiter = pending.get(message.id)
            if (waiter) { clearTimeout(waiter.timer); waiter.reject(new Error(message.message)); pending.delete(message.id) }
            active.delete(message.id)
            if (!window.isDestroyed()) window.webContents.send('agent:failure', { requestId: message.id, message: message.message })
          }
        })
        host.once('exit', () => { clearTimeout(timer); ready = undefined; child = undefined; failAll(); reject(new Error('Local agent process exited.')) })
      })
    })()
    ready.catch(() => { ready = undefined })
    return ready
  }
  const configRequest = async (provider?: 'claude' | 'codex' | 'demo') => {
    await start()
    const id = crypto.randomUUID()
    return new Promise<AgentConfig>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Provider discovery timed out.')) }, 20_000)
      pending.set(id, { resolve, reject, timer })
      child?.postMessage(provider ? { type: 'select', id, provider } : { type: 'config', id })
    })
  }
  return {
    config: () => configRequest(),
    select: (provider: 'claude' | 'codex' | 'demo') => configRequest(provider),
    async run(value: unknown) { const request = parseAgentRequest(value); active.add(request.requestId); try { await start(); if (!isDisposed() && active.has(request.requestId)) child?.postMessage({ type: 'run', id: request.requestId, request }) } catch (error) { active.delete(request.requestId); throw error } },
    cancel(requestId: string) { active.delete(requestId); child?.postMessage({ type: 'cancel', id: requestId }) },
    async dispose() {
      lifecycle.disposed = true
      active.clear()
      child?.postMessage({ type: 'stop' })
      if (child) {
        const host = child
        await new Promise<void>(resolve => { const timer = setTimeout(() => { host.kill(); resolve() }, 2500); host.once('exit', () => { clearTimeout(timer); resolve() }) })
      }
      failAll()
    },
  }
}
