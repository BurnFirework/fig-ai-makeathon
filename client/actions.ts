import { Editor, EditorAtom, type TLShapeId } from 'tldraw'

export interface Activity { id: string; role: string; message: string; time: number }
export interface UiState {
  mode: 'live' | 'demo'; provider: string; activity: Activity[]; panel: boolean;
  jobs: Record<string, { status: 'running' | 'error'; message: string }>;
  notice: string; saved: boolean;
  chatView: 'focus' | 'board';
  activeChat: { nodeId: TLShapeId; chatId: string } | null;
}
export const uiState = new EditorAtom<UiState>('unfold-ui', () => ({ mode: 'demo', provider: 'Preview', activity: [], panel: false, jobs: {}, notice: '', saved: true, activeChat: null, chatView: 'focus' }))
export interface UnfoldActions {
  openChat(id: TLShapeId, chatId?: string): void; newChat(id: TLShapeId): void; closeChat(): void;
  send(id: TLShapeId, chatId: string, text: string, replyTo?: string): void;
  publish(id: TLShapeId, chatId: string, messageId: string): void;

  connect(ids?: TLShapeId[]): void; manualConnect(a: TLShapeId, b: TLShapeId): void;
  retry(id: string): void; stop(id: string): void;
  updateGoal(id: TLShapeId, goal: string): void;
  complete(id: TLShapeId, reflection: string): void; remove(id: TLShapeId): void;
  importFiles(files: File[]): Promise<void>; samples(): Promise<void>;
}
export const actions = new WeakMap<Editor, UnfoldActions>()
