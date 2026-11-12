import { Editor, EditorAtom, type TLShapeId } from 'tldraw'
import type { Handoff } from '../shared/schema'
import type { ExploreReport, ExploreShared, ExploreTopic, ExploreWorker, InvestigationTopic } from '../shared/explore'
import type { BoardEdit } from '../shared/board-edits'

export interface Activity { id: string; role: string; message: string; time: number; handoff?: Handoff }
export interface UiState {
  mode: 'live' | 'demo'; provider: string; activity: Activity[]; panel: boolean;
  jobs: Record<string, { status: 'running' | 'error'; message: string; handoffs?: Handoff[] }>;
  saved: boolean;
  chatView: 'focus' | 'board';
  activeChat: { nodeId: TLShapeId; chatId: string } | null;
  /** Shapes the user asked to remove; the confirmation dialog is open while this is set. */
  removing: TLShapeId[] | null;
  explore: ExploreRun | null;
  /** The Explore board dialog; `reuse` reopens it with the last run's scope (Edit search). */
  exploreDialog: { reuse: boolean; error?: string } | null;
}
/** The latest Explore board run, as the right-hand panel shows it. */
export interface ExploreRun {
  running: boolean
  /** The user stopped it, or the whole request failed (`error`). */
  stopped: boolean; error: string
  workers: ExploreWorker[]
  /** The approved scope of this run, for Edit search and Retry. */
  topics: InvestigationTopic[]
  /** Finding groups holding options this run added, and how many options are new. */
  updatedIds: TLShapeId[]; added: number
  /** Groups holding options this run found again that were already on the board. */
  existingIds: TLShapeId[]; existing: number
  /** Interests whose search failed for a technical reason. */
  failed: string[]
  reports?: ExploreReport[]
  baselines?: InvestigationTopic[]
  /** A shared next step the agents suggested; its card exists only after Add to board. */
  shared?: { plan: ExploreShared; addedId?: TLShapeId }
}
export const uiState = new EditorAtom<UiState>('unfold-ui', () => ({ mode: 'demo', provider: 'Preview', activity: [], panel: false, jobs: {}, saved: true, activeChat: null, chatView: 'focus', removing: null, explore: null, exploreDialog: null }))
export interface ExploreCandidate { topic: InvestigationTopic; selected: boolean; suggested: boolean; reason: string; conditions: string[] }
/** Writes the workspace now instead of after the usual short delay; registered by the workspace for its editor. */
export const saveNow = new WeakMap<Editor, () => void>()

export interface UnfoldActions {
  exploreCandidates(): ExploreCandidate[]
  exploreBoard(topics: ExploreTopic[]): Promise<void>
  stopExplore(): void
  /** Reruns the interests that failed, or the whole last run when it could not finish. */
  retryExplore(): Promise<void>
  /** Creates (or refreshes) the card for the shared step the agents suggested. */
  addSharedStep(): TLShapeId | undefined
  dismissFinding(id: TLShapeId, findingId: string): void
  applyBoardEdits(edits: readonly BoardEdit[]): TLShapeId[]
  openChat(id: TLShapeId, chatId?: string): void;
  /** A separate, empty conversation: the person asks first, or lets the agents suggest. */
  newChat(id: TLShapeId): void;
  /** Lets the agents open an empty conversation with directions of their own. */
  suggest(id: TLShapeId, chatId: string): void;
  closeChat(): void;
  send(id: TLShapeId, chatId: string, text: string, replyTo?: string, stance?: 'refine' | 'suggestion'): void;
  publish(id: TLShapeId, chatId: string, messageId: string): void;
  /** Applies the board changes an answer suggested, or sets them aside (and back) without touching the canvas. */
  addProposedEdits(id: TLShapeId, chatId: string, messageId: string): void;
  /** The user's decision on a shared proposal, separate from whether its card is on the canvas. */
  decide(id: TLShapeId, chatId: string, messageId: string, decision: 'accept' | 'decline' | 'refine' | 'reopen', note?: string): void;
  forgetMemory(id: TLShapeId, chatId: string, entryId: string): void;
  confirmMemory(id: TLShapeId, chatId: string, entryId: string): void;

  connect(ids?: TLShapeId[]): void; manualConnect(a: TLShapeId, b: TLShapeId): void;
  /** Stops or retries the board's own check of whether two goals connect. */
  stopLink(key: string): void; retryLink(a: string, b: string): void;
  retry(id: string): void; stop(id: string): void;
  updateGoal(id: TLShapeId, goal: string): void;
  /** Ticks or unticks one step of a next step's checklist. */
  toggleStep(id: TLShapeId, index: number): void;
  /** Asks for confirmation and offers any cards that would lose their last source. */
  requestRemove(ids: TLShapeId[]): void; remove(ids: TLShapeId[], additionalIds?: readonly TLShapeId[]): void;
  importFiles(files: File[]): Promise<void>; samples(): Promise<void>;
}
export const actions = new WeakMap<Editor, UnfoldActions>()
