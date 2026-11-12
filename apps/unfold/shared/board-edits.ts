import { z } from 'zod'

const id = z.string().min(1).max(160)
const title = z.string().trim().min(1).max(600)
const description = z.string().trim().min(1).max(1200)
export const RelationshipSchema = z.enum(['develops', 'reference'])
export type Relationship = z.infer<typeof RelationshipSchema>

export const CardContentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('note'), title, description }),
  z.strictObject({ kind: z.literal('moodboard'), title, description, items: z.array(z.strictObject({ nodeId: id, caption: z.string().trim().min(1).max(100) })).min(1).max(4) }),
])

export const BoardEditsSchema = z.array(z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('updateNode'), nodeId: id, title, description: description.optional() }),
  z.strictObject({ kind: z.literal('createNode'), content: CardContentSchema, links: z.array(z.strictObject({ nodeId: id, relationship: RelationshipSchema })).max(8) }),
  z.strictObject({ kind: z.literal('connectNodes'), from: id, to: id, relationship: RelationshipSchema }),
  z.strictObject({ kind: z.literal('attachNodeToConversation'), conversationId: id, nodeId: id }),
])).max(12)
export type BoardEdit = z.infer<typeof BoardEditsSchema>[number]

export const BoardContextSchema = z.object({
  conversationId: id,
  focusId: id,
  selectedIds: z.array(id).max(24).default([]),
  attachedIds: z.array(id).max(24),
  cards: z.array(z.object({ id, title: z.string().max(600), description: z.string().max(1200).optional(), image: z.boolean(), revision: z.number().int().nonnegative() })).max(40),
  links: z.array(z.object({ from: id, to: id, relationship: RelationshipSchema })).max(80),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(2000) })).max(16),
})
export type BoardContext = z.infer<typeof BoardContextSchema>

export function editedNodeIds(edit: BoardEdit): string[] {
  switch (edit.kind) {
    case 'updateNode': case 'attachNodeToConversation': return [edit.nodeId]
    case 'connectNodes': return [edit.from, edit.to]
    case 'createNode': return [...edit.links.map(link => link.nodeId), ...(edit.content.kind === 'moodboard' ? edit.content.items.map(item => item.nodeId) : [])]
  }
}

/** Validates the complete batch before any write. The caller supplies only records the actor can edit. */
export function validateBoardEdits(value: unknown, board: {
  cards: readonly { id: string; image: boolean; editable?: boolean; acceptsDescription?: boolean }[]
  conversationIds: readonly string[]
  revisions: ReadonlyMap<string, number>
  links?: readonly { from: string; to: string; relationship: Relationship }[]
}, expected: readonly { id: string; revision: number }[] = []): BoardEdit[] {
  const parsed = BoardEditsSchema.safeParse(value)
  if (!parsed.success) throw new Error('Check the card text and links, then try the edit again.')
  const edits = parsed.data
  if (!expected.every(input => board.revisions.get(input.id) === input.revision)) throw new Error('A card or conversation changed while the agent worked. Retry with the latest board.')
  const cards = new Map(board.cards.map(card => [card.id, card]))
  const links = [...(board.links ?? [])].filter(link => link.relationship === 'develops')
  for (const edit of edits) {
    if (editedNodeIds(edit).some(nodeId => !cards.has(nodeId))) throw new Error('This edit refers to an unavailable card.')
    switch (edit.kind) {
      case 'attachNodeToConversation':
        if (!board.conversationIds.includes(edit.conversationId)) throw new Error('This edit refers to an unavailable conversation.')
        break
      case 'updateNode': {
        const card = cards.get(edit.nodeId)
        if (card?.editable === false || (edit.description !== undefined && card?.acceptsDescription === false)) throw new Error('This card cannot accept that edit.')
        break
      }
      case 'createNode':
        if (edit.content.kind === 'moodboard' && (new Set(edit.content.items.map(item => item.nodeId)).size !== edit.content.items.length || edit.content.items.some(item => !cards.get(item.nodeId)?.image))) throw new Error('Use distinct image cards already on the board for a moodboard.')
        break
      case 'connectNodes': {
        if (edit.from === edit.to) throw new Error('Choose two different cards for a link.')
        if (edit.relationship !== 'develops') break
        const reachable = new Set([edit.to])
        for (const from of reachable) for (const link of links) if (link.from === from) reachable.add(link.to)
        if (reachable.has(edit.from)) throw new Error('This link would create a cycle in the card’s development history.')
        links.push(edit)
        break
      }
    }
  }
  return edits
}
