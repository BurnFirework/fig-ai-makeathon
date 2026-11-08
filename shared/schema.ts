import { z } from 'zod'

const safeUrl = z.url().refine(value => ['https:', 'http:'].includes(new URL(value).protocol), 'Expected an HTTP URL')
export const SourceSchema = z.object({ id: z.string(), title: z.string(), url: safeUrl })
export type Source = z.infer<typeof SourceSchema>
export const DependencySchema = z.object({ id: z.string(), revision: z.number().int().nonnegative() })
const base = {
  branchId: z.string(), sequence: z.number(), revision: z.number().int().nonnegative(), stale: z.boolean(),
  dependsOn: z.array(DependencySchema), agent: z.enum(['you', 'branch', 'research', 'connection']), createdAt: z.number(),
}
export const NodeSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('inspiration'), assetId: z.string(), goal: z.string().max(600), started: z.boolean() }),
  z.object({ ...base, type: z.literal('question'), prompt: z.string(), options: z.array(z.string()).min(2).max(4), purpose: z.string() }),
  z.object({ ...base, type: z.literal('answer'), text: z.string().max(2000), questionId: z.string() }),
  z.object({ ...base, type: z.literal('opportunity'), title: z.string(), description: z.string(), benefitA: z.string(), benefitB: z.string(), status: z.enum(['proposed', 'accepted', 'rejected']), refinement: z.string(), sourceBranchIds: z.array(z.string()).length(2) }),
  z.object({ ...base, type: z.literal('action'), title: z.string(), description: z.string(), sources: z.array(SourceSchema), completed: z.boolean(), reflection: z.string() }),
])
export type UnfoldNode = z.infer<typeof NodeSchema>
export function isUnfoldNode(value: unknown): value is UnfoldNode { return NodeSchema.safeParse(value).success }
export const BranchContextSchema = z.object({
  id: z.string(), goal: z.string(), revision: z.number(),
  answers: z.array(z.object({ question: z.string(), answer: z.string() })),
  confirmed: z.array(z.string()), assumptions: z.array(z.string()),
  previousSuggestions: z.array(z.string()),
})
export type BranchContext = z.infer<typeof BranchContextSchema>
export const RequestSchema = z.object({
  requestId: z.string().min(1).max(120), operation: z.enum(['branch', 'connect', 'research']),
  branches: z.array(BranchContextSchema).min(1).max(2),
  image: z.string().max(6_000_000).optional(), note: z.string().max(2000),
})
export type AgentRequest = z.infer<typeof RequestSchema>
export const ProposalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('question'), prompt: z.string().min(1), options: z.array(z.string()).min(2).max(4), purpose: z.string() }),
  z.object({ kind: z.literal('research'), brief: z.string().min(1) }),
  z.object({ kind: z.literal('opportunity'), title: z.string().min(1), description: z.string(), benefitA: z.string(), benefitB: z.string() }),
  z.object({ kind: z.literal('action'), title: z.string().min(1), description: z.string(), sources: z.array(SourceSchema) }),
])
export type Proposal = z.infer<typeof ProposalSchema>
export const ActivitySchema = z.object({ role: z.enum(['branch', 'research', 'connection', 'coordinator']), message: z.string() })
export const ResultSchema = z.object({ requestId: z.string(), proposal: ProposalSchema, activity: z.array(ActivitySchema), mode: z.enum(['live', 'demo']) })
export type AgentResult = z.infer<typeof ResultSchema>
export const EventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('activity'), role: ActivitySchema.shape.role, message: z.string() }),
  z.object({ type: z.literal('result'), result: ResultSchema }),
  z.object({ type: z.literal('error'), message: z.string() }),
])
export type AgentEvent = z.infer<typeof EventSchema>
export function revisionsMatch(dependencies: z.infer<typeof DependencySchema>[], current: Map<string, number>) {
  return dependencies.every(dependency => current.get(dependency.id) === dependency.revision)
}
