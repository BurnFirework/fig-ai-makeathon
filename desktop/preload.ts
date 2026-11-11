import { contextBridge, ipcRenderer } from 'electron'
import { z } from 'zod'
import type { DesktopFiles } from '../shared/desktop-contract'
import { WorkspaceSchema } from '../shared/workspace-format'
import { AgentConfigSchema, AgentEventEnvelopeSchema, AgentFailureSchema } from '../shared/agent-contract'
import type { RuntimeRequest } from '../shared/agent-contract'

const session = z.object({ workspace: WorkspaceSchema.nullable(), session: z.string(), notice: z.string().nullable() })
const ack = z.object({ session: z.string(), revision: z.number(), savedAt: z.number() })
async function invoke(channel: string, payload?: unknown): Promise<unknown> { return await ipcRenderer.invoke(channel, payload) }
function subscribe<T>(channel: string, schema: z.ZodType<T>, listener: (payload: T) => void) {
  const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => { const parsed = schema.safeParse(payload); if (parsed.success) listener(parsed.data) }
  ipcRenderer.on(channel, handler)
  return () => { ipcRenderer.removeListener(channel, handler) }
}
const files: DesktopFiles = {
  load: async () => session.parse(await invoke('workspace:load')),
  save: async value => ack.parse(await invoke('workspace:save', value)),
  restoreBackup: async () => session.nullable().parse(await invoke('workspace:restore')),
  showDataFolder: async () => { await invoke('workspace:show-data') },
  exportCopy: async workspace => z.boolean().parse(await invoke('workspace:export', workspace)),
  subscribeCommands: listener => subscribe('workspace:command', z.enum(['save', 'import', 'export']), listener),
  onCloseRequested: listener => { ipcRenderer.send('workspace:close-listener', true); const off = subscribe('workspace:close-requested', z.object({dirty:z.boolean()}), listener); return () => { off(); ipcRenderer.send('workspace:close-listener', false) } },
  markDirty: () => { ipcRenderer.send('workspace:dirty') },
  closeReady: async success => { await invoke('workspace:close-ready', success) },
}
contextBridge.exposeInMainWorld('unfoldDesktop', {
  ...files,
  agents: {
    config: async () => AgentConfigSchema.parse(await invoke('agent:config')),
    select: async (provider: string) => AgentConfigSchema.parse(await invoke('agent:select', provider)),
    run: async (request: RuntimeRequest) => { await invoke('agent:run', request) },
    cancel: async (requestId: string) => { await invoke('agent:cancel', requestId) },
    onEvent: (listener: (payload: z.infer<typeof AgentEventEnvelopeSchema>) => void) => subscribe('agent:event', AgentEventEnvelopeSchema, listener),
    onFailure: (listener: (payload: z.infer<typeof AgentFailureSchema>) => void) => subscribe('agent:failure', AgentFailureSchema, listener),
  },
})
