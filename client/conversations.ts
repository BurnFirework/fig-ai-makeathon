import type { Editor } from 'tldraw'
import { conversationCards, conversationId } from '../shared/conversation-record'
import type { Chat } from '../shared/schema'

export function conversations(editor: Editor): Chat[] {
  const pageId = editor.getCurrentPageId()
  return editor.store.query.records('unfold_conversation').get().filter(record => record.pageId === pageId).map(record => record.chat)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

export function conversationAt(editor: Editor, id: string): Chat | undefined {
  const pageId = editor.getCurrentPageId()
  return editor.store.query.records('unfold_conversation').get().find(record => record.id === conversationId(id) && record.pageId === pageId)?.chat
}

export function conversationsFor(editor: Editor, nodeId: string): Chat[] {
  return conversations(editor).filter(chat => conversationCards(chat).includes(nodeId))
}

export function putConversation(editor: Editor, chat: Chat) {
  editor.store.put([{ typeName: 'unfold_conversation', id: conversationId(chat.id), pageId: editor.getCurrentPageId(), chat }])
}
