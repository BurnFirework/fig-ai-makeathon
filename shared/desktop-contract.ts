import type { Workspace } from './workspace-format'

export interface DesktopSession { workspace: Workspace | null; session: string; name: string | null }
export interface DesktopAck { session: string; revision: number; name: string | null; savedAt: number }
export interface DesktopSave { workspace: Workspace; session: string }
export type DesktopCommand = 'save' | 'saveAs' | 'open' | 'new'
export interface DesktopFiles {
  load(): Promise<DesktopSession>
  save(value: DesktopSave): Promise<DesktopAck>
  saveAs(value: DesktopSave): Promise<DesktopAck | null>
  open(): Promise<DesktopSession | null>
  newWorkspace(): Promise<DesktopSession>
  exportCopy(workspace: Workspace): Promise<boolean>
  markDirty(): void
  subscribeCommands(listener: (command: DesktopCommand) => void): () => void
  onCloseRequested(listener: () => void): () => void
  closeReady(success: boolean): Promise<void>
}

export interface DesktopAgents {
  config(): Promise<import('./agent-contract').AgentConfig>
  select(provider: string): Promise<import('./agent-contract').AgentConfig>
  run(request: import('./schema').AgentRequest): Promise<void>
  cancel(requestId: string): Promise<void>
  onEvent(listener: (payload: { requestId: string; event: import('./schema').AgentEvent }) => void): () => void
  onFailure(listener: (payload: { requestId: string; message: string }) => void): () => void
}
declare global {
  interface Window { unfoldDesktop?: DesktopFiles & { agents: DesktopAgents } }
}
