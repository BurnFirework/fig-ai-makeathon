import type { Workspace } from './workspace-format'

export interface DesktopSession { workspace: Workspace | null; session: string; notice: string | null }
export interface DesktopAck { session: string; revision: number; savedAt: number }
export interface DesktopSave { workspace: Workspace; session: string }
export type DesktopCommand = 'save' | 'import' | 'export'
export interface DesktopFiles {
  load(): Promise<DesktopSession>
  save(value: DesktopSave): Promise<DesktopAck>
  restoreBackup(): Promise<DesktopSession | null>
  showDataFolder(): Promise<void>
  exportCopy(workspace: Workspace): Promise<boolean>
  markDirty(): void
  subscribeCommands(listener: (command: DesktopCommand) => void): () => void
  onCloseRequested(listener: () => void): () => void
  closeReady(success: boolean): Promise<void>
}

export interface DesktopAgents {
  config(): Promise<import('./agent-contract').AgentConfig>
  select(provider: string): Promise<import('./agent-contract').AgentConfig>
  run(request: import('./agent-contract').RuntimeRequest): Promise<void>
  cancel(requestId: string): Promise<void>
  onEvent(listener: (payload: { requestId: string; event: import('./schema').AgentEvent }) => void): () => void
  onFailure(listener: (payload: { requestId: string; message: string }) => void): () => void
}
declare global {
  interface Window { unfoldDesktop?: DesktopFiles & { agents: DesktopAgents } }
}
