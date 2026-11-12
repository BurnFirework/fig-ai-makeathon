import { isEmpty, isNotEmpty } from './arrays'
import type { Chat, ChatMemory, ChatMessage, MemoryEntry, MemoryKey, MemoryUpdate, Stance } from './schema'

/** Keys where a newer statement replaces the active one instead of adding to it. */
const REPLACEABLE = new Set<MemoryKey>(['budget', 'time', 'place', 'group'])
export const MEMORY_LABELS: Record<MemoryKey, string> = { budget: 'Budget', time: 'Time', place: 'Place', group: 'Company', priority: 'Priority', other: 'Condition' }

// JavaScript's \b only knows ASCII letters, so Cyrillic words use explicit letter boundaries.
const words = (alternatives: string, flags = '') => new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${alternatives})(?![\p{L}\p{N}])`, `u${flags}`)
const QUESTION_START = new RegExp(String.raw`^(?:what|how|why|where|when|which|who|can|could|should|would|is|are|do|does|will|что|как|почему|зачем|где|когда|какой|какая|какие|кто|можно|стоит ли|а если|а можно|разве)(?![\p{L}])`, 'iu')
const UNCERTAIN = words("maybe|perhaps|not sure|unsure|don't know|do not know|dunno|possibly|might|just exploring|haven't decided|может быть|не знаю|не уверен|не уверена|наверное|возможно|пока не решил|пока не решила|посмотрим", 'i')
const DECLINE_START = new RegExp(String.raw`^(?:no|nope|nah|not really|not quite|not for me|not interested|нет|неа|не очень|не совсем|не хочу|не интересно|не подходит)(?![\p{L}])`, 'iu')
const DECLINE = words("don't want|do not want|not interested|doesn't work for me|не хочу|не интересно|не подходит|не моё|не мое", 'i')
// A message that asks for something ("Find…", "What to sketch…", "Найди…", "Что нарисовать…") is a request, not a fact about the user.
const REQUEST_START = new RegExp(String.raw`^(?:please\s+|пожалуйста,?\s+)?(?:find|show|suggest|give|make|save|help|plan|create|add|search|look for|tell|list|compare|write|draft|recommend|pick|choose|найди|покажи|предложи|дай|сделай|сохрани|помоги|составь|добавь|поищи|расскажи|напиши|сравни|подбери|выбери|посоветуй)(?![\p{L}])|^(?:what|how|where|which|when) to(?![\p{L}])|^(?:что|как|где|куда|когда|чем)\s+\p{L}+(?:ть|ти|чь)(?:ся)?(?![\p{L}])`, 'iu')
const ACKNOWLEDGEMENT = /^(ok|okay|thanks|thank you|sure|cool|great|got it|ок|окей|спасибо|понятно|хорошо|ладно)[.!\s]*$/iu

const CURRENCY = String.raw`(?:\$|€|£|₽|usd|eur|gbp|rub|рублей|рубля|руб\.?|р\.|долларов|доллара|доллар|евро|dollars?|euros?|pounds?)`
const AMOUNT = new RegExp(String.raw`(?:[$€£₽]\s?\d[\d.,]*(?:\s?k)?|\d[\d.,]*(?:\s?k)?\s?${CURRENCY})`, 'giu')
const NEGATED_BEFORE = /(?:вместо|instead of|rather than|not|не|no longer|was|было|раньше)\s*$/iu
const LIMIT_BEFORE = /(?:under|up to|max(?:imum)?|at most|less than|below|no more than|до|не больше|не дороже|максимум|в пределах|меньше)\s*$/iu
const FREE = words('free|no cost|бесплатн\\p{L}*', 'i')
const TIME = words(String.raw`mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|weekends?|weekdays?|mornings?|afternoons?|evenings?|nights?|tonight|today|tomorrow|next week|this week|\d+\s?(?:hours?|hrs?|h|minutes?|mins?)|\d{1,2}[:.]\d{2}|\d{1,2}\s?(?:am|pm)|понедельн\p{L}*|вторник\p{L}*|сред[ауы]|средам|четверг\p{L}*|пятниц\p{L}*|суббот\p{L}*|воскресень\p{L}*|выходн\p{L}*|будн\p{L}*|утр\p{L}*|вечер\p{L}*|днём|днем|ночью|сегодня|завтра|на неделе|\d+\s?(?:час\p{L}*|минут\p{L}*)`, 'i')
const PLACE = new RegExp(String.raw`(?<![\p{L}])(?:online|remote(?:ly)?|at home|from home|near me|near home|nearby|close to home|close by|онлайн|удалённо|удаленно|дома|из дома|рядом с домом|поблизости|недалеко)(?![\p{L}])|(?<![\p{L}])(?:[Ii]n|[Nn]ear|[Aa]round) [A-Z][\p{L}'-]+(?: [A-Z][\p{L}'-]+)?|(?<![\p{L}])(?:в|во|около|рядом с) [А-ЯЁ][\p{L}-]+`, 'u')
const GROUP = words('alone|by myself|on my own|solo|with (?:my )?(?:friends?|partner|kids|children|family|wife|husband|colleagues|group)|in a group|in groups?|small groups?|один|одна|одной|одному|в одиночку|с друзьями|с другом|с подругой|с семьёй|с семьей|с детьми|с ребёнком|с ребенком|с партнёром|с партнером|с мужем|с женой|в группе|компанией', 'i')
const PRIORITY = words('important|priority|most of all|i prefer|prefer|must|need to|have to|главное|важно|предпочитаю|обязательно|нужно чтобы|лучше всего', 'i')
const TOPICS: { key: MemoryKey; pattern: RegExp }[] = [
  { key: 'budget', pattern: /budget|cost|price|spend|afford|pay|бюджет|стоим|цен[аеуы]|потрат|заплат|сколько.*(денег|стоит)/i },
  { key: 'time', pattern: /when|what time|which day|schedule|how often|how long|how much time|когда|во сколько|время|какие дни|расписан|как часто|сколько времени/i },
  { key: 'place', pattern: /where|location|city|area|neighbou?rhood|online or|где|город|район|место|онлайн или/i },
  { key: 'group', pattern: /alone|with whom|on your own|with others|одн[иао]|с кем/i },
]

// When a reply has no recognizable place, time, budget or company, the question's topic alone is not enough to make it one:
// "Haven't booked yet" to "Where…?" is a status, not a place. Such replies are kept as intent instead.
const NOT_A_VALUE = words("haven't|have not|hasn't|not yet|no idea|doesn't matter|does not matter|no preference|anywhere|wherever|whenever|any ?time|either way|ещё не|еще не|пока не|неважно|без разницы|где угодно|когда угодно|всё равно|все равно", 'i')
const PLACE_WORDS = words('street|st|avenue|ave|road|district|neighbou?rhood|downtown|uptown|city|area|park|center|centre|campus|near|nearby|close to|walking distance|north|south|east|west|side|район\\p{L}*|центр\\p{L}*|улиц\\p{L}*|рядом|недалеко', 'i')
const TIME_WORDS = words('days?|weeks?|weekly|months?|monthly|daily|once|twice|times|hours?|утр\\p{L}*|вечер\\p{L}*|недел\\p{L}*|месяц\\p{L}*|раз в', 'i')
const BUDGET_WORDS = words('cheap|affordable|inexpensive|low|modest|not much|tight|splurge|budget|дешев\\p{L}*|недорог\\p{L}*|бюджет\\p{L}*', 'i')
const GROUP_WORDS = words('alone|friends?|partner|family|kids|group|solo|together|others|people|друз\\p{L}*|семь\\p{L}*|групп\\p{L}*', 'i')
/** Whether a reply can stand as a condition of this kind. */
export function fitsMemoryKey(key: MemoryKey, value: string): boolean {
  const direct = key === 'place' ? PLACE.test(value) : key === 'time' ? TIME.test(value) : key === 'budget' ? budgetText(value) !== undefined : key === 'group' ? GROUP.test(value) : true
  if (direct) return true
  if (NOT_A_VALUE.test(value)) return false
  if (key === 'place') {
    const tokens = value.trim().replace(/[.!]+$/, '').split(/\s+/)
    const named = tokens.length <= 4 && tokens.every(token => /^\p{Lu}[\p{L}.-]*$/u.test(token))
    return named || /\d/.test(value) || PLACE_WORDS.test(value) || tokens.slice(1).some(token => /^\p{Lu}\p{Ll}/u.test(token))
  }
  if (key === 'time') return /\d/.test(value) || TIME_WORDS.test(value)
  if (key === 'budget') return BUDGET_WORDS.test(value)
  if (key === 'group') return GROUP_WORDS.test(value)
  return true
}
const FALLBACK_KEYS = new Set<MemoryKey>(['place', 'time', 'budget', 'group'])
const WISH = words("want|wanna|would like|i'd like|looking for|hoping|interested in|try|learn|join|meet|find|хочу|хотел\\p{L}*|ищу|интересно|попробовать|научиться", 'i')

export interface MemoryDraft { kind: MemoryEntry['kind']; key?: MemoryKey; text: string }

const clip = (text: string, length = 160) => text.replace(/\s+/g, ' ').trim().slice(0, length)
const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}$€£₽]+/gu, ' ').trim()

/** Reads a message's intent without treating every message as a confirmed fact. */
export function classifyMessage(text: string): Stance {
  const value = text.trim()
  if (/\?\s*$/.test(value) || (QUESTION_START.test(value) && value.includes('?'))) return 'question'
  if (DECLINE_START.test(value) || DECLINE.test(value)) return 'decline'
  if (UNCERTAIN.test(value)) return 'uncertain'
  if (REQUEST_START.test(value)) return 'request'
  return 'answer'
}

// "After Sunday" points at a moment already planned; it is not when the user is free.
const RELATIVE_BEFORE = /(?:after|since|following|после|с тех пор как)\s*$/iu
const TIME_ALL = new RegExp(TIME.source, 'giu')
/** Whether a clause states a time the user wants or has, rather than referring to one. */
function statesTime(clause: string): boolean {
  return [...clause.matchAll(TIME_ALL)].some(match => !RELATIVE_BEFORE.test(clause.slice(Math.max(0, match.index - 20), match.index)))
}

function budgetText(text: string): string | undefined {
  const amounts = [...text.matchAll(AMOUNT)].filter(match => !NEGATED_BEFORE.test(text.slice(Math.max(0, (match.index) - 16), match.index)))
  const amount = amounts[0]
  if (amount) {
    const limit = LIMIT_BEFORE.test(text.slice(Math.max(0, amount.index - 16), amount.index))
    return `${MEMORY_LABELS.budget}: ${limit ? 'up to ' : ''}${amount[0].trim()}`
  }
  if (FREE.test(text)) return `${MEMORY_LABELS.budget}: free`
  return undefined
}

/**
 * Turns one user message into memory drafts. Questions, uncertain replies and next moves the agent suggested stay out
 * of memory; a request keeps only the conditions it states ("Find a free class on Saturdays"), not the request itself.
 */
export function interpretMessage(text: string, stance: Stance, question?: string): MemoryDraft[] {
  if (stance === 'question' || stance === 'uncertain' || stance === 'suggestion') return []
  const value = clip(text, 400)
  if (!value || ACKNOWLEDGEMENT.test(value)) return []
  const drafts: MemoryDraft[] = []
  const add = (draft: MemoryDraft) => { if (!drafts.some(existing => existing.key === draft.key && existing.kind === draft.kind && normalize(existing.text) === normalize(draft.text))) drafts.push(draft) }
  if (stance === 'decline') add({ kind: 'declined', text: clip(question ? `Declined: ${question}` : value) })
  const clauses = value.split(/[,;.!\n]+/).map(clause => clause.trim()).filter(Boolean)
  // Clauses that carry no place, time, budget, company or priority, e.g. "I want to meet people through a ceramics group".
  const loose: string[] = []
  for (const clause of clauses) {
    const before = drafts.length
    const budget = budgetText(clause)
    if (budget) add({ kind: 'constraint', key: 'budget', text: budget })
    if (statesTime(clause)) add({ kind: 'constraint', key: 'time', text: `${MEMORY_LABELS.time}: ${clip(clause, 120)}` })
    if (PLACE.test(clause)) add({ kind: 'constraint', key: 'place', text: `${MEMORY_LABELS.place}: ${clip(clause, 120)}` })
    if (GROUP.test(clause)) add({ kind: 'constraint', key: 'group', text: `${MEMORY_LABELS.group}: ${clip(clause, 120)}` })
    if (PRIORITY.test(clause) && !budget) add({ kind: 'constraint', key: 'priority', text: `${MEMORY_LABELS.priority}: ${clip(clause, 140)}` })
    if (drafts.length === before) loose.push(clause)
  }
  if (stance === 'decline' || stance === 'request') return drafts
  if (isEmpty(drafts) && question) {
    const topic = TOPICS.find(item => item.pattern.test(question))
    if (topic && fitsMemoryKey(topic.key, value)) return [{ kind: 'constraint', key: topic.key, text: `${MEMORY_LABELS[topic.key]}: ${clip(value, 120)}` }]
  }
  if (isEmpty(drafts)) add({ kind: 'intent', text: clip(question && value.length < 60 ? `${question} — ${value}` : value, 240) })
  // A stated wish survives next to the conditions extracted from the same message.
  else for (const clause of loose) if (WISH.test(clause) || clause.split(/\s+/).length >= 4) add({ kind: 'intent', text: clip(clause, 240) })
  return drafts
}

/** Adds drafts with replacement semantics; the revision only changes when confirmed conditions change. */
export function applyDrafts(memory: ChatMemory, drafts: MemoryDraft[], sources: string[], by: MemoryEntry['by'], now: number, makeId: () => string, replaces?: string): ChatMemory {
  let entries = [...memory.entries]
  let changed = false
  for (const draft of drafts) {
    const same = entries.find(entry => entry.status === 'active' && entry.kind === draft.kind && entry.key === draft.key && normalize(entry.text) === normalize(draft.text))
    if (same) {
      const merged = [...new Set([...same.sources, ...sources])].slice(-8)
      entries = entries.map(entry => entry.id === same.id ? { ...entry, sources: merged, ...(by === 'you' ? { by } : {}) } : entry)
      continue
    }
    const id = makeId()
    const previous = (replaces ? entries.find(entry => entry.id === replaces && entry.status === 'active') : undefined)
      ?? (draft.kind === 'constraint' && draft.key && REPLACEABLE.has(draft.key) ? entries.find(entry => entry.status === 'active' && entry.kind === 'constraint' && entry.key === draft.key) : undefined)
    if (previous) entries = entries.map(entry => entry.id === previous.id ? { ...entry, status: 'replaced', replacedBy: id } : entry)
    entries.push({ id, kind: draft.kind, ...(draft.key ? { key: draft.key } : {}), text: draft.text, status: 'active', sources: sources.slice(0, 8), by, ...(previous ? { replaces: previous.id } : replaces ? { replaces } : {}), createdAt: now })
    if (draft.kind === 'intent' || draft.kind === 'constraint' || previous) changed = true
  }
  return { revision: memory.revision + (changed ? 1 : 0), entries: entries.slice(-300) }
}

/**
 * Confirmed conditions that stopped holding between two memory states: replaced by a new value or withdrawn.
 * A new condition alone does not count, because cards made before it were not based on anything now untrue.
 */
export function revisedConditions(before: ChatMemory, after: ChatMemory): { before: string; after?: string }[] {
  const now = new Map(after.entries.map(entry => [entry.id, entry]))
  return before.entries.flatMap(entry => {
    if (entry.status !== 'active' || (entry.kind !== 'intent' && entry.kind !== 'constraint')) return []
    const current = now.get(entry.id)
    if (!current || current.status === 'active') return []
    const replacement = current.replacedBy ? now.get(current.replacedBy) : undefined
    return [{ before: entry.text, ...(replacement ? { after: replacement.text } : {}) }]
  })
}

/** Saved chats from before memory existed get the same interpretation, with stable ids. */
export function chatMemory(chat: Pick<Chat, 'memory' | 'messages'>): ChatMemory {
  if (chat.memory) return repairMemory(chat.memory)
  let memory: ChatMemory = { revision: 0, entries: [] }
  for (const message of chat.messages) {
    if (message.role !== 'user') continue
    let index = 0
    memory = applyDrafts(memory, interpretMessage(message.text, message.stance ?? classifyMessage(message.text), questionFor(chat.messages, message)), [message.id], 'you', 0, () => `${message.id}:${index++}`)
  }
  return { ...memory, revision: 0 }
}

/**
 * Earlier versions saved any reply to a "where/when/how much" question as that condition. Such entries are read as the
 * user's intent instead, so a reply like "Haven't booked yet" no longer acts as a place. The saved data is unchanged.
 */
function repairMemory(memory: ChatMemory): ChatMemory {
  const label = (key: MemoryKey) => `${MEMORY_LABELS[key]}: `
  if (!memory.entries.some(entry => misfiled(entry))) return memory
  return { ...memory, entries: memory.entries.map(entry => {
    if (!misfiled(entry) || !entry.key) return entry
    const { key: _key, ...rest } = entry
    return { ...rest, kind: 'intent', text: entry.text.slice(label(entry.key).length) }
  }) }
}
function misfiled(entry: MemoryEntry): boolean {
  if (entry.kind !== 'constraint' || entry.by !== 'you' || !entry.key || !FALLBACK_KEYS.has(entry.key)) return false
  const prefix = `${MEMORY_LABELS[entry.key]}: `
  return entry.text.startsWith(prefix) && !fitsMemoryKey(entry.key, entry.text.slice(prefix.length))
}

export function questionFor(messages: ChatMessage[], message: ChatMessage): string | undefined {
  if (message.role !== 'user' || !message.replyTo) return undefined
  const asked = messages.find(item => item.id === message.replyTo)
  return asked?.role === 'assistant' && asked.proposal.kind === 'question' ? asked.proposal.prompt : undefined
}

/** The user withdraws an entry; it stays as history. */
export function withdrawEntry(memory: ChatMemory, entryId: string): ChatMemory {
  const entry = memory.entries.find(item => item.id === entryId && item.status === 'active')
  if (!entry) return memory
  return { revision: memory.revision + (entry.kind === 'assumption' ? 0 : 1), entries: memory.entries.map(item => item.id === entryId ? { ...item, status: 'withdrawn' } : item) }
}

/** The user confirms an AI assumption explicitly; it then counts as a confirmed condition. */
export function confirmAssumption(memory: ChatMemory, entryId: string, now: number, makeId: () => string): ChatMemory {
  const entry = memory.entries.find(item => item.id === entryId && item.status === 'active' && item.kind === 'assumption')
  if (!entry) return memory
  const withdrawn = { ...memory, entries: memory.entries.map(item => item.id === entryId ? { ...item, status: 'replaced' as const } : item) }
  return applyDrafts(withdrawn, [{ kind: entry.key ? 'constraint' : 'intent', ...(entry.key ? { key: entry.key } : {}), text: entry.text }], entry.sources, 'you', now, makeId, undefined)
}

/**
 * Applies agent-proposed memory. A confirmed kind needs a user message as its basis;
 * anything else is kept as an assumption so AI hypotheses never become confirmed on their own.
 */
export function applyAgentMemory(memory: ChatMemory, updates: MemoryUpdate[], userMessageIds: Set<string>, knownEntryIds: Set<string>, assistantMessageId: string, now: number, makeId: () => string): ChatMemory {
  let next = memory
  for (const update of updates.slice(0, 6)) {
    const grounded = update.kind !== 'assumption' && update.from !== undefined && userMessageIds.has(update.from)
    const draft: MemoryDraft = grounded ? { kind: update.kind, ...(update.key ? { key: update.key } : {}), text: clip(update.text, 400) } : { kind: 'assumption', ...(update.key ? { key: update.key } : {}), text: clip(update.text, 400) }
    const replaces = grounded && update.replaces && knownEntryIds.has(update.replaces) ? update.replaces : undefined
    next = applyDrafts(next, [draft], grounded && update.from ? [update.from] : [assistantMessageId], grounded ? 'you' : 'agent', now, makeId, replaces)
  }
  return next
}

export interface MemoryPart { nodeId: string; chat: Chat; through?: string | undefined }
export interface MemoryItem extends MemoryEntry { chatId: string; nodeId: string; inherited: boolean }
export interface MemoryChange { key?: MemoryKey; before: string; after: string; chatId: string }
export interface MemoryView { active: MemoryItem[]; history: MemoryChange[] }

/**
 * Merges remembered facts along one conversation lineage. Ancestor chats contribute what was known
 * at the point a derived chat started, plus later corrections of those same facts.
 */
export function mergeMemory(parts: MemoryPart[]): MemoryView {
  const items: MemoryItem[] = []
  const last = parts.at(-1)
  for (const part of parts) {
    const entries = chatMemory(part.chat).entries
    let included = entries
    if (part.through) {
      const index = part.chat.messages.findIndex(message => message.id === part.through)
      const visible = new Set(part.chat.messages.slice(0, index + 1).map(message => message.id))
      const ids = new Set(entries.filter(entry => entry.sources.some(source => visible.has(source))).map(entry => entry.id))
      let grew = true
      while (grew) {
        grew = false
        for (const entry of entries) if (!ids.has(entry.id) && entry.replaces && ids.has(entry.replaces)) { ids.add(entry.id); grew = true }
      }
      included = entries.filter(entry => ids.has(entry.id))
    }
    for (const entry of included) items.push({ ...entry, chatId: part.chat.id, nodeId: part.nodeId, inherited: part !== last })
  }
  const history: MemoryChange[] = []
  const state = new Map(items.map(item => [item.id, item]))
  for (const item of items) {
    if (item.status === 'replaced' && item.replacedBy) {
      const next = state.get(item.replacedBy)
      if (next && next.kind !== 'assumption') history.push({ ...(item.key ? { key: item.key } : {}), before: item.text, after: next.text, chatId: next.chatId })
    }
  }
  // A derived conversation can correct an inherited condition.
  const active = items.filter(item => item.status === 'active')
  const result: MemoryItem[] = []
  for (const item of active) {
    const overrides = result.filter(previous => previous.chatId !== item.chatId && (item.replaces === previous.id || (item.kind === 'constraint' && previous.kind === 'constraint' && item.key !== undefined && item.key === previous.key && REPLACEABLE.has(item.key))))
    for (const previous of overrides) {
      result.splice(result.indexOf(previous), 1)
      history.push({ ...(item.key ? { key: item.key } : {}), before: previous.text, after: item.text, chatId: item.chatId })
    }
    if (!result.some(previous => previous.kind === item.kind && previous.key === item.key && normalize(previous.text) === normalize(item.text))) result.push(item)
  }
  return { active: result, history }
}

export function hasMemory(view: MemoryView) { return isNotEmpty(view.active) || isNotEmpty(view.history) }
