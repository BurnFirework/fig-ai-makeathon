import { createCustomRecordId, PageRecordType, type TLPageId } from '@tldraw/tlschema'
import { T } from '@tldraw/validate'
import { z } from 'zod'
import { ChatSchema, type Chat } from './schema'

export const conversationId = (chatId: string) => createCustomRecordId('unfold_conversation', chatId)
export interface ConversationRecord {
  typeName: 'unfold_conversation'
  id: ReturnType<typeof conversationId>
  pageId: TLPageId
  chat: Chat
}

declare module '@tldraw/tlschema' {
  interface TLGlobalRecordPropsMap { unfold_conversation: ConversationRecord }
}

const RecordSchema = z.object({ typeName: z.literal('unfold_conversation'), id: z.string(), pageId: z.string(), chat: ChatSchema })
function isConversationRecord(value: unknown): value is ConversationRecord {
  const record = RecordSchema.safeParse(value)
  return record.success && PageRecordType.isId(record.data.pageId) && record.data.id === conversationId(record.data.chat.id)
}

export const conversationRecord = {
  scope: 'document' as const,
  validator: new T.Validator<ConversationRecord>(value => {
    if (!isConversationRecord(value)) throw new Error('Invalid conversation record.')
    return value
  }),
}

export function conversationCards(chat: Chat): string[] { return chat.cardIds ?? chat.sourceIds }
