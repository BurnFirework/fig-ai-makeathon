import { ExploreFindingSchema, ExploreResultSchema, ExploreTopicSchema, ExploreWorkerSchema } from './explore'
import { z } from 'zod'
import { BoardContextSchema, BoardEditsSchema, CardContentSchema } from './board-edits'

const safeUrl = z.url().refine(value => ['https:', 'http:'].includes(new URL(value).protocol), 'Expected an HTTP URL')
export const SourceSchema = z.object({ id: z.string(), title: z.string(), url: safeUrl })
export type Source = z.infer<typeof SourceSchema>
/** Quick facts shown as chips on a next step: how long, how much, where. */
export const ActionMetaSchema = z.object({ time: z.string().max(40).optional(), cost: z.string().max(40).optional(), place: z.string().max(60).optional() })
/** A next step reads as a one-line summary and a short checklist; `description` keeps any extra detail. All optional for older boards. */
const ActionShape = { summary: z.string().max(300).optional(), steps: z.array(z.string().max(200)).max(4).optional(), meta: ActionMetaSchema.optional() }
export const DependencySchema = z.object({ id: z.string(), revision: z.number().int().nonnegative() })
/** A decision only the user can make: which condition blocks the shared idea, what the agents based that on, and what each answer changes. */
export const ConflictSchema = z.object({
  condition: z.string().max(240), basis: z.string().max(600),
  sources: z.array(SourceSchema).max(4).default([]),
  /** One effect per option, in the same order. */
  effects: z.array(z.string().max(240)).max(4).default([]),
})
export type Conflict = z.infer<typeof ConflictSchema>
export const ProposalSchema = z.discriminatedUnion('kind', [
  /** A chat answer; followUps are what the user might say next, offered as buttons under the latest answer. */
  z.object({ kind: z.literal('reply'), text: z.string().min(1).max(1200), followUps: z.array(z.string().min(1).max(60)).max(3).optional() }),
  z.object({ kind: z.literal('question'), prompt: z.string().min(1),
    /** Ready answers to pick. Empty for an open question (a city, a name), which the user answers in their own words. */
    options: z.array(z.string()).max(4), purpose: z.string(), conflict: ConflictSchema.optional(),
    /** A hint for the user's own answer, e.g. "Type a city or area". */
    placeholder: z.string().max(80).optional() }),
  z.object({ kind: z.literal('research'), brief: z.string().min(1) }),
  z.object({ kind: z.literal('opportunity'), title: z.string().min(1), description: z.string(), benefitA: z.string(), benefitB: z.string(),
    /** Real options the research agent found, when the direction relies on them. */
    sources: z.array(SourceSchema).max(6).optional(),
    /** Points a branch agent accepted only partly; the user sees them before deciding. */
    openPoints: z.array(z.string().max(240)).max(3).optional() }),
  z.object({ kind: z.literal('action'), title: z.string().min(1), description: z.string(), sources: z.array(SourceSchema), ...ActionShape }),
  /** The connection agent found no useful overlap between two goals. Never shown as a proposal. */
  z.object({ kind: z.literal('none'), reason: z.string().max(400) }),
])
export type Proposal = z.infer<typeof ProposalSchema>
/** How a user message should be read: only answers can become confirmed facts. */
/** How a user message reads: `request` asks for something; `suggestion` is a next move the agent offered and the user clicked. */
export const StanceSchema = z.enum(['answer', 'question', 'decline', 'uncertain', 'refine', 'request', 'suggestion'])
export type Stance = z.infer<typeof StanceSchema>
export const MemoryKeySchema = z.enum(['budget', 'time', 'place', 'group', 'priority', 'other'])
export type MemoryKey = z.infer<typeof MemoryKeySchema>
/** One remembered fact. Corrections replace an entry and keep the old one as history. */
export const MemoryEntrySchema = z.object({
  id: z.string(), kind: z.enum(['intent', 'constraint', 'assumption', 'declined']), key: MemoryKeySchema.optional(),
  text: z.string().max(400), status: z.enum(['active', 'replaced', 'withdrawn']),
  /** Message ids the entry was taken from. */
  sources: z.array(z.string()).max(8), by: z.enum(['you', 'agent']),
  replaces: z.string().optional(), replacedBy: z.string().optional(), createdAt: z.number(),
})
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>
/** The revision increases only when confirmed conditions change, so dependent results can be marked for review. */
export const ChatMemorySchema = z.object({ revision: z.number().int().nonnegative(), entries: z.array(MemoryEntrySchema).max(300) })
export type ChatMemory = z.infer<typeof ChatMemorySchema>
export const DecisionSchema = z.object({ status: z.enum(['accepted', 'declined', 'refine', 'superseded']), note: z.string().max(600), at: z.number() })
export type Decision = z.infer<typeof DecisionSchema>
export const AgentRoleSchema = z.enum(['branch', 'research', 'connection', 'coordinator', 'you'])
/** A summary of one real task request or result between agents, written for the user. */
export const HandoffSchema = z.object({
  from: AgentRoleSchema, to: AgentRoleSchema, fromLabel: z.string().max(80).optional(), toLabel: z.string().max(80).optional(),
  task: z.enum(['overlap', 'research', 'check-fit', 'propose', 'ask', 'refine-search', 'revise', 'limit']),
  summary: z.string().max(500),
  // "failed": a step could not produce a usable reply (a technical failure, never a finding).
  outcome: z.enum(['requested', 'found', 'none', 'failed', 'fits', 'partial', 'conflict', 'proposed', 'waiting', 'stopped']),
})
export type Handoff = z.infer<typeof HandoffSchema>
export const ChatMessageSchema = z.discriminatedUnion('role', [
  z.object({ id: z.string(), role: z.literal('user'), text: z.string().max(2000), replyTo: z.string().optional(), stance: StanceSchema.optional() }),
  z.object({
    id: z.string(), role: z.literal('assistant'), proposal: ProposalSchema, dependsOn: z.array(DependencySchema), outcomeId: z.string().optional(), outcomeIds: z.array(z.string()).max(12).optional(),
    decision: DecisionSchema.optional(), revises: z.string().optional(), trace: z.array(HandoffSchema).max(24).optional(),
    /** Research briefs this reply ran, so later searches in the conversation differ. */
    searches: z.array(z.string().max(800)).max(6).optional(),
    /** Board changes the agents suggest; nothing changes on the canvas until the user adds them. */
    proposedEdits: BoardEditsSchema.optional(), editsDeclined: z.boolean().optional(),
  }),
])
export const ChatSchema = z.object({
  id: z.string(), title: z.string().max(120), contextChats: z.array(z.object({ nodeId: z.string(), chatId: z.string(), messageId: z.string().optional() })).optional(), sourceIds: z.array(z.string()).min(1).max(2),
  cardIds: z.array(z.string()).optional(),
  branchIds: z.array(z.string()).min(1).max(2), operation: z.enum(['branch', 'connect', 'research']),
  messages: z.array(ChatMessageSchema), createdAt: z.number(), memory: ChatMemorySchema.optional(),
})
export type Chat = z.infer<typeof ChatSchema>
export type ChatMessage = z.infer<typeof ChatMessageSchema>
/** The last automatic check of a pair of goals, kept on the inspiration whose id sorts first so a reload never repeats it. */
export const LinkScanSchema = z.object({
  // "error": the check could not finish (a technical failure, not a finding); it waits for Retry.
  otherId: z.string(), signature: z.string().max(4000), status: z.enum(['none', 'found', 'error']),
  reason: z.string().max(400), chatId: z.string().optional(), at: z.number(),
})
const base = {
  chats: z.array(ChatSchema).optional(),
  origin: z.object({ nodeId: z.string(), chatId: z.string(), messageId: z.string(), inputs: z.array(DependencySchema).optional() }).optional(),
  branchId: z.string(), sequence: z.number(), revision: z.number().int().nonnegative(), stale: z.boolean(),
  dependsOn: z.array(DependencySchema), agent: z.enum(['you', 'branch', 'research', 'connection']), createdAt: z.number(),
}
export const NodeSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('findings'), topic: ExploreTopicSchema, checkedAt: z.number(),
    findings: z.array(ExploreFindingSchema).max(30), dismissed: z.array(z.string()).max(500), expanded: z.boolean().optional(), fit: z.number().nonnegative().max(4000).optional() }),
  z.object({ ...base, type: z.literal('artifact'), content: CardContentSchema, fit: z.number().nonnegative().max(4000).optional() }),
  z.object({ ...base, type: z.literal('inspiration'), assetId: z.string(), goal: z.string().max(600), started: z.boolean(), links: z.array(LinkScanSchema).max(40).optional() }),
  z.object({ ...base, type: z.literal('question'), prompt: z.string(), options: z.array(z.string()).min(2).max(4), purpose: z.string() }),
  z.object({ ...base, type: z.literal('answer'), text: z.string().max(2000), questionId: z.string() }),
  z.object({ ...base, type: z.literal('opportunity'), title: z.string(), description: z.string(), benefitA: z.string(), benefitB: z.string(), status: z.enum(['proposed', 'accepted', 'rejected']), refinement: z.string(), sourceBranchIds: z.array(z.string()).length(2), sources: z.array(SourceSchema).max(6).optional() }),
  z.object({ ...base, type: z.literal('action'), title: z.string(), description: z.string(), sources: z.array(SourceSchema), completed: z.boolean(), reflection: z.string(), ...ActionShape, doneSteps: z.array(z.number().int().nonnegative()).max(4).optional(),
    /** Card view state: details unfolded, and the measured height when the estimate falls short. */
    expanded: z.boolean().optional(), fit: z.number().nonnegative().max(4000).optional() }),
])
export type UnfoldNode = z.infer<typeof NodeSchema>
export type LinkScan = z.infer<typeof LinkScanSchema>
export function isUnfoldNode(value: unknown): value is UnfoldNode { return NodeSchema.safeParse(value).success }
export const BranchContextSchema = z.object({
  id: z.string(), goal: z.string(), revision: z.number(),
  answers: z.array(z.object({ question: z.string(), answer: z.string(), stance: StanceSchema.optional(), messageId: z.string().optional() })),
  /** Active confirmed intents and conditions, newest correction only. */
  confirmed: z.array(z.string()), assumptions: z.array(z.string()),
  previousSuggestions: z.array(z.string()),
  memory: z.array(z.object({ id: z.string(), kind: MemoryEntrySchema.shape.kind, key: MemoryKeySchema.optional(), text: z.string(), from: z.string().optional() })).max(120).default([]),
  changes: z.array(z.object({ key: MemoryKeySchema.optional(), before: z.string(), after: z.string() })).max(60).default([]),
  declined: z.array(z.object({ idea: z.string(), reason: z.string() })).max(40).default([]),
})
export type BranchContext = z.infer<typeof BranchContextSchema>
export const MemoryUpdateSchema = z.object({
  kind: MemoryEntrySchema.shape.kind, key: MemoryKeySchema.optional(), text: z.string().min(1).max(400),
  from: z.string().max(120).optional(), replaces: z.string().max(160).optional(),
})
export type MemoryUpdate = z.infer<typeof MemoryUpdateSchema>
/** The user asked to change one proposal. A next step also carries its steps and sources, so its revision can keep them. */
export const FocusSchema = z.object({ kind: z.literal('refine'), title: z.string().max(200), description: z.string().max(2000), note: z.string().max(2000),
  steps: z.array(z.string().max(200)).max(4).optional(), sources: z.array(SourceSchema).max(6).optional() })
export const RequestSchema = z.object({
  requestId: z.string().min(1).max(120), operation: z.enum(['branch', 'connect', 'research']),
  board: BoardContextSchema.optional(),
  branches: z.array(BranchContextSchema).min(1).max(2),
  image: z.string().max(6_000_000).optional(), note: z.string().max(2000),
  /** The user asked to revise this proposal. */
  focus: FocusSchema.optional(),
  /** The conversation continues from this outcome already on the board. */
  outcome: z.object({ title: z.string().max(200), description: z.string().max(2000), sources: z.array(SourceSchema).max(6).optional() }).optional(),
  /** Who started a connection: the board noticed it, or the user asked. */
  trigger: z.enum(['auto', 'manual']).optional(),
  /** Searches this conversation already ran, so a new one must differ. */
  priorBriefs: z.array(z.string().max(800)).max(6).optional(),
  /** Sources the research agent found earlier in this conversation (each seen in its own search tool events), so a later turn can build on them. */
  priorSources: z.array(SourceSchema).max(6).optional(),
})
export type AgentRequest = z.infer<typeof RequestSchema>
export const ActivitySchema = z.object({ role: z.enum(['branch', 'research', 'connection', 'coordinator']), message: z.string() })
export const ResultSchema = z.object({
  requestId: z.string(), proposal: ProposalSchema, activity: z.array(ActivitySchema), mode: z.enum(['live', 'demo']),
  edits: BoardEditsSchema.default([]), usedNodeIds: z.array(z.string()).max(40).default([]),
  handoffs: z.array(HandoffSchema).max(24).default([]), memory: z.array(MemoryUpdateSchema).max(8).default([]),
  searches: z.array(z.string().max(800)).max(6).default([]),
})
export type AgentResult = z.infer<typeof ResultSchema>
export const EventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('explore-worker'), worker: ExploreWorkerSchema }),
  z.object({ type: z.literal('activity'), role: ActivitySchema.shape.role, message: z.string() }),
  z.object({ type: z.literal('handoff'), handoff: HandoffSchema }),
  z.object({ type: z.literal('result'), result: ResultSchema }),
  z.object({ type: z.literal('explore-result'), result: ExploreResultSchema }),
  z.object({ type: z.literal('error'), message: z.string() }),
])
export type AgentEvent = z.infer<typeof EventSchema>
/** Dependency id for a chat's remembered conditions. */
export const memoryKey = (chatId: string) => `memory:${chatId}`
export function revisionsMatch(dependencies: z.infer<typeof DependencySchema>[], current: Map<string, number>) {
  return dependencies.every(dependency => current.get(dependency.id) === dependency.revision)
}
