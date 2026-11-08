import { Editor, EditorAtom, type TLShapeId } from 'tldraw'

export interface Activity { id: string; role: string; message: string; time: number }
export interface UiState {
  mode: 'live' | 'demo'; provider: string; activity: Activity[]; panel: boolean;
  jobs: Record<string, { status: 'running' | 'error'; message: string }>;
  notice: string; saved: boolean;
}
export const uiState = new EditorAtom<UiState>('unfold-ui', () => ({ mode: 'demo', provider: 'Preview', activity: [], panel: false, jobs: {}, notice: '', saved: true }))
export const collapsedBranches = new EditorAtom<string[]>('unfold-collapsed', () => [])
export interface UnfoldActions {
  start(id: TLShapeId): void; answer(id: TLShapeId, choice: string, comment: string): void;
  connect(ids?: TLShapeId[]): void; manualConnect(a: TLShapeId, b: TLShapeId): void;
  research(id: TLShapeId, note?: string): void; retry(id: TLShapeId): void; stop(id: TLShapeId): void;
  decide(id: TLShapeId, accepted: boolean): void; refine(id: TLShapeId, note: string): void;
  updateGoal(id: TLShapeId, goal: string): void; updateAnswer(id: TLShapeId, text: string): void;
  complete(id: TLShapeId, reflection: string): void; remove(id: TLShapeId): void;
  collapse(branchId: string): void; moveBranch(branchId: string): void;
  importFiles(files: File[]): Promise<void>; samples(): Promise<void>;
}
export const actions = new WeakMap<Editor, UnfoldActions>()
