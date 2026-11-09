import { Editor, EditorAtom, type TLShapeId } from 'tldraw'
import type { Handoff } from '../shared/schema'

export interface Activity { id: string; role: string; message: string; time: number; handoff?: Handoff }
export interface UiState {
  mode: 'live' | 'demo'; provider: string; activity: Activity[]; panel: boolean;
  jobs: Record<string, { status: 'running' | 'error'; message: string; handoffs?: Handoff[] }>;
  notice: string; saved: boolean;
  chatView: 'focus' | 'board';
  activeChat: { nodeId: TLShapeId; chatId: string } | null;
  /** Shapes the user asked to remove; the confirmation dialog is open while this is set. */
  removing: TLShapeId[] | null;
}
export const uiState = new EditorAtom<UiState>('unfold-ui', () => ({ mode: 'demo', provider: 'Preview', activity: [], panel: false, jobs: {}, notice: '', saved: true, activeChat: null, chatView: 'focus', removing: null }))
export interface UnfoldActions {
  openChat(id: TLShapeId, chatId?: string): void; newChat(id: TLShapeId): void; closeChat(): void;
  send(id: TLShapeId, chatId: string, text: string, replyTo?: string, stance?: 'refine'): void;
  publish(id: TLShapeId, chatId: string, messageId: string): void;
  /** The user's decision on a shared proposal, separate from whether its card is on the canvas. */
  decide(id: TLShapeId, chatId: string, messageId: string, decision: 'accept' | 'decline' | 'refine' | 'reopen', note?: string): void;
  forgetMemory(id: TLShapeId, chatId: string, entryId: string): void;
  confirmMemory(id: TLShapeId, chatId: string, entryId: string): void;

  connect(ids?: TLShapeId[]): void; manualConnect(a: TLShapeId, b: TLShapeId): void;
  retry(id: string): void; stop(id: string): void;
  updateGoal(id: TLShapeId, goal: string): void;
  complete(id: TLShapeId, reflection: string): void;
  /** Asks for confirmation before removing these shapes; cards take their whole branch with them. */
  requestRemove(ids: TLShapeId[]): void; remove(ids: TLShapeId[]): void;
  importFiles(files: File[]): Promise<void>; samples(): Promise<void>;
}
export const actions = new WeakMap<Editor, UnfoldActions>()
