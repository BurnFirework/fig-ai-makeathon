// Renders the landing page's board picture from the real app: three photo goals, the cards the agents grew from them,
// and the chat that brought two goals together.
//   cd apps/unfold && node scripts/landing-board/capture.mjs
// Writes ../landing/board.webp (2880×2000). Set OUT=path.png to keep a PNG instead. No agents run: the API is stubbed.
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = fileURLToPath(new URL('../..', import.meta.url))
const out = process.env.OUT ?? fileURLToPath(new URL('../../../landing/board.webp', import.meta.url))
const port = 43191
const viewport = { width: 1440, height: 1000 }
const photos = [
  { file: 'jazz.jpg', goal: 'Live jazz in the Bay Area' },
  { file: 'pottery.jpg', goal: 'Learn to throw on the wheel' },
  { file: 'desk.jpg', goal: 'Remote design engineering roles' },
]

// The scene is built with the app's own editor, so the capture build exposes it.
const exposeEditor = {
  name: 'expose-editor', enforce: 'pre',
  transform(code, id) { return id.endsWith('/client/App.tsx') ? code.replace('onMount={editor => {', 'onMount={editor => { globalThis.__unfoldEditor = editor;') : undefined },
}
const server = await createServer({ root, configFile: join(root, 'vite.config.ts'), plugins: [exposeEditor], logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true, hmr: false } })
await server.listen()
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : { channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 })
  page.on('pageerror', error => console.error('page error:', error.message))
  await page.addInitScript(() => localStorage.setItem('unfold-boards-v1', JSON.stringify({ boards: [{ id: 'unfold-board-v1', name: 'November · Life & work' }], activeId: 'unfold-board-v1' })))
  await page.route('**/api/config', route => route.fulfill({ json: { mode: 'live', provider: 'Claude Code', providers: [] } }))
  // The board checks pairs of goals on its own; answer every check with "no new link" so no status pills appear.
  await page.route('**/api/agent', route => {
    const { requestId } = route.request().postDataJSON()
    return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'result', result: { requestId, proposal: { kind: 'none', reason: 'Already connected.' }, activity: [], mode: 'live' } }) + '\n' })
  })
  await page.goto(`http://127.0.0.1:${port}/`)
  // A Linen canvas sets the picture apart from the page's cream background.
  await page.getByRole('button', { name: 'Board style', exact: true }).click()
  await page.getByRole('radiogroup', { name: 'Canvas color' }).getByRole('radio', { name: 'Linen' }).click()
  await page.getByRole('button', { name: 'Board style', exact: true }).click()
  const input = page.locator('input[accept="image/png,image/jpeg,image/webp"]').first()
  for (const [index, photo] of photos.entries()) {
    await input.setInputFiles({ name: `${photo.goal}.jpg`, mimeType: 'image/jpeg', buffer: readFileSync(join(here, photo.file)) })
    await page.locator('.inspiration-image img').nth(index).waitFor()
  }
  await page.evaluate(buildScene, photos.map(photo => photo.goal))
  await page.mouse.move(viewport.width - 4, viewport.height - 4)
  await page.waitForTimeout(1500)
  await page.evaluate(frameBoard)
  await page.locator('[data-sonner-toaster]').evaluateAll(toasts => toasts.forEach(toast => toast.remove()))
  await page.waitForTimeout(800)
  if (out.endsWith('.png')) await page.screenshot({ path: out })
  else {
    const png = join(mkdtempSync(join(tmpdir(), 'unfold-board-')), 'board.png')
    await page.screenshot({ path: png })
    execFileSync('cwebp', ['-quiet', '-q', '86', '-m', '6', png, '-o', out])
  }
  console.log(`Wrote ${out}`)
} finally {
  await browser.close()
  await server.close()
}

/** Runs in the page: lays out the cards, links and the shared conversation around the three photos. */
async function buildScene(goals) {
  const editor = globalThis.__unfoldEditor
  const { createOrUpdateConnectionBinding } = await import('/client/connection/ConnectionBindingUtil.tsx')
  const { getNextConnectionIndex } = await import('/client/connection/keepConnectionsAtBottom.tsx')
  const { putConversation } = await import('/client/conversations.ts')
  const { actions, uiState } = await import('/client/actions.ts')
  const photo = goal => editor.getCurrentPageShapes().find(shape => shape.type === 'node' && shape.props.node.goal === goal)
  const [jazz, pottery, desk] = goals.map(photo)
  const now = Date.now(); let order = 0
  const base = (branchId, agent) => ({ branchId, sequence: now + ++order, revision: 0, stale: false, dependsOn: [], agent, createdAt: now + order })
  const note = (branchId, title, description, exploration) => ({ ...base(branchId, exploration ? 'branch' : 'you'), type: 'artifact', content: { kind: 'note', title, description }, ...(exploration ? { exploration: { sourceId: branchId, id: `idea-${order}`, kind: exploration, sources: [] } } : {}) })
  const day = 24 * 3600 * 1000
  const finding = (id, title, subtitle, when, price, why, url, availability) => ({ id, title, subtitle, when, price, why, url, source: url, state: 'new', availability, checkedAt: now - day })
  const sources = {
    wheel: { id: 's-wheel', title: 'Intro to the wheel · Clay Hours', url: 'https://www.clayhours.studio/intro-wheel' },
    lantern: { id: 's-lantern', title: 'Early trio set · The Lantern Room', url: 'https://www.lanternroomsf.com/calendar' },
  }

  const ids = {
    jazzNote: 'shape:landing-jazz-note', findings: 'shape:landing-jazz-findings', potteryQuestion: 'shape:landing-pottery-question',
    shared: 'shape:landing-shared', step: 'shape:landing-step', deskNote: 'shape:landing-desk-note', deskCompare: 'shape:landing-desk-compare', deskIdea: 'shape:landing-desk-idea',
  }
  const cards = [
    { id: jazz.id, x: 0, y: 0 },
    { id: ids.findings, x: 420, y: 0, node: { ...base(jazz.id, 'research'), type: 'findings', checkedAt: now - day, dismissed: [],
      topic: { kind: 'web', category: 'event', sourceId: jazz.id, title: 'Live jazz in the Bay Area', query: 'Small-room jazz sets in San Francisco or Oakland', dependencies: [{ id: jazz.id, revision: 0 }], city: 'San Francisco', conditions: [], preferences: [], context: [], links: [] },
      findings: [
        finding('f1', 'Early trio set · The Lantern Room', 'lanternroomsf.com · Mission, San Francisco', 'Sat, Nov 21, 7:00 PM', '$28', 'A 60-seat room with a set that ends before nine.', sources.lantern.url, 'schedule'),
        finding('f2', 'Late night quartet · Harbor Listening Bar', 'harborlistening.com · Oakland', 'Fri, Nov 27, 9:30 PM', '$35', 'Vinyl bar with live sets on Fridays, easy from BART.', 'https://www.harborlistening.com/live', 'spots'),
        finding('f3', 'Sunday jam session · Corner Note', 'cornernote.org · Inner Sunset, San Francisco', 'Sun, Nov 22, 5:00 PM', 'Free', 'Open jam with a house band; drop in any time.', 'https://www.cornernote.org/jam', 'schedule'),
      ] } },
    { id: pottery.id, x: 840, y: 0 },
    { id: desk.id, x: 1260, y: 0 },
    { id: ids.jazzNote, x: 0, y: 372, node: note(jazz.id, 'An evening worth going out for', 'Small venues, a warm room, and a set I can share with a friend. San Francisco or Oakland, up to $40 a ticket.') },
    { id: ids.potteryQuestion, x: 840, y: 372, node: note(pottery.id, 'Wheel first, or hand-building?', 'A drop-in wheel night is the quickest way to feel the clay; a four-week course builds the habit. Which fits your weeks right now?', 'question') },
    { id: ids.shared, x: 420, y: 660, node: { ...base('shape:landing-shared', 'connection'), type: 'opportunity', status: 'accepted', refinement: '', sourceBranchIds: [jazz.id, pottery.id],
      title: 'Creative Saturdays in the Mission', description: 'An afternoon at the wheel, then an early jazz set a few blocks away: one day out that feeds both goals, with Sunday left free for rest.',
      benefitA: 'Live jazz: a small room, done before nine', benefitB: 'Pottery: a beginner session, clay and firing included', sources: [sources.wheel, sources.lantern] } },
    { id: ids.step, x: 420, y: 1040, node: { ...base('shape:landing-shared', 'research'), type: 'action', completed: false, reflection: '', description: '',
      title: 'Book a wheel class and an early set', summary: 'Intro wheel session 2–4:30 PM, then the 7 PM trio set ten minutes away.',
      meta: { time: 'Sat · 2–9 PM', cost: 'About $95', place: 'Mission, SF' }, steps: ['Pick a Saturday with an open wheel slot', 'Reserve two seats for the 7 PM set', 'Ask Maya to come along'], doneSteps: [0], sources: [sources.wheel, sources.lantern] } },
    { id: ids.deskNote, x: 1260, y: 372, node: note(desk.id, 'What I want to make', 'Thoughtful interfaces, interaction prototypes and design systems, on a team where craft and engineering sit together.') },
    { id: ids.deskCompare, x: 1260, y: 640, node: note(desk.id, 'Product team or design systems?', 'Product roles ship features you can point to; systems roles shape how everyone builds. Your note leans toward prototypes, which product teams ask for most.', 'comparison') },
    { id: ids.deskIdea, x: 1260, y: 960, node: note(desk.id, 'Share one prototype a week', 'A small interactive piece every Friday gives hiring teams something to open, and keeps Saturdays free for the studio.', 'idea') },
  ]
  const link = (from, to, input = 'input', output = 'output', relationship = 'develops') => {
    const id = `shape:landing-link-${++order}`
    editor.createShape({ id, type: 'connection', props: { relationship }, index: getNextConnectionIndex(editor) })
    createOrUpdateConnectionBinding(editor, id, from, { portId: output, terminal: 'start' })
    createOrUpdateConnectionBinding(editor, id, to, { portId: input, terminal: 'end' })
  }
  editor.run(() => {
    for (const card of cards) {
      if (card.node) editor.createShape({ id: card.id, type: 'node', x: card.x, y: card.y, props: { node: card.node } })
      else editor.updateShape({ id: card.id, type: 'node', x: card.x, y: card.y, props: { node: { ...editor.getShape(card.id).props.node, started: true } } })
    }
    link(jazz.id, ids.findings, 'side-in', 'side-out')
    link(jazz.id, ids.jazzNote)
    link(pottery.id, ids.potteryQuestion)
    link(ids.jazzNote, ids.shared, 'goal-0')
    link(ids.potteryQuestion, ids.shared, 'goal-1')
    link(ids.shared, ids.step)
    link(desk.id, ids.deskNote)
    link(ids.deskNote, ids.deskCompare)
    link(ids.deskCompare, ids.deskIdea)
    link(ids.deskIdea, ids.step, 'input', 'output', 'reference')
  })

  const assistant = (id, proposal, extra = {}) => ({ id, role: 'assistant', proposal, dependsOn: [], ...extra })
  const handoff = (from, to, task, summary, outcome, labels = {}) => ({ from, to, task, summary, outcome, ...labels })
  const chat = {
    id: 'landing-shared-chat', title: 'Live jazz + pottery', sourceIds: [jazz.id, pottery.id], branchIds: [jazz.id, pottery.id], operation: 'connect', createdAt: now,
    messages: [
      assistant('m1', { kind: 'question', prompt: 'Both goals point to the same free day. How should that Saturday feel?', options: ['A class, then music', 'Just one, done well'], purpose: 'It decides whether the agents plan one outing or two.' }),
      { id: 'm2', role: 'user', text: 'A class in the afternoon, then music in the evening', replyTo: 'm1', stance: 'answer' },
      assistant('m3', { kind: 'opportunity', title: 'Creative Saturdays in the Mission', description: 'An afternoon at the wheel, then an early jazz set a few blocks away: one day out that feeds both goals.', benefitA: 'Live jazz: a small room, done before nine', benefitB: 'Pottery: a beginner session, clay and firing included', sources: [sources.wheel, sources.lantern] },
        { outcomeId: ids.shared, decision: { status: 'accepted', note: '', at: now }, trace: [
          handoff('coordinator', 'connection', 'overlap', 'Both goals mention Saturdays and San Francisco.', 'found'),
          handoff('connection', 'research', 'research', 'Find a beginner wheel class and a jazz set close together.', 'found'),
          handoff('connection', 'branch', 'check-fit', 'A 7 PM set fits “up to $40, done early”.', 'fits', { toLabel: 'Live jazz' }),
          handoff('connection', 'you', 'propose', 'One shared Saturday, ready for your decision.', 'proposed'),
        ] }),
      assistant('m4', { kind: 'action', title: 'Book a wheel class and an early set', description: '', summary: 'Intro wheel session 2–4:30 PM, then the 7 PM trio set ten minutes away.', meta: { time: 'Sat · 2–9 PM', cost: 'About $95', place: 'Mission, SF' }, steps: ['Pick a Saturday with an open wheel slot', 'Reserve two seats for the 7 PM set', 'Ask Maya to come along'], sources: [sources.wheel, sources.lantern] },
        { outcomeId: ids.step, trace: [
          handoff('research', 'connection', 'research', 'Checked both pages: open slots on Nov 21 and 28.', 'found'),
          handoff('connection', 'you', 'propose', 'A first step with times, prices and links.', 'proposed'),
        ] }),
      assistant('m5', { kind: 'reply', text: 'It’s on your canvas under the shared direction. Both pages list open slots on November 21 and 28.', followUps: ['Check Sundays too', 'Find a cheaper set'] }),
    ],
  }
  putConversation(editor, chat)
  actions.get(editor).openChat(jazz.id, chat.id)
  uiState.update(editor, state => ({ ...state, chatView: 'board' }))
}

/** Runs in the page: fits every card into the canvas area left of the chat. */
async function frameBoard() {
  const editor = globalThis.__unfoldEditor
  // Off-screen cards are not rendered, so zoom out first to measure all of them.
  editor.setCamera({ x: 200, y: 300, z: 0.3 })
  await new Promise(resolve => setTimeout(resolve, 600))
  const chat = document.querySelector('.chat-panel').getBoundingClientRect()
  const toolbar = document.querySelector('[aria-label="Canvas tools"]')?.getBoundingClientRect()
  const top = chat.top + 28, bottom = (toolbar?.top ?? innerHeight) - 20, left = 28, right = chat.left - 28
  // Measured from the rendered cards: their heights fit their content, which the shape bounds do not know.
  const corners = [...document.querySelectorAll('.unfold-card')].flatMap(card => { const box = card.getBoundingClientRect(); return box.width === 0 ? [] : [editor.screenToPage({ x: box.left, y: box.top }), editor.screenToPage({ x: box.right, y: box.bottom })] })
  const bounds = { minX: Math.min(...corners.map(p => p.x)), minY: Math.min(...corners.map(p => p.y)), maxX: Math.max(...corners.map(p => p.x)), maxY: Math.max(...corners.map(p => p.y)) }
  const z = Math.min((right - left) / (bounds.maxX - bounds.minX), (bottom - top) / (bounds.maxY - bounds.minY))
  const viewport = editor.getViewportScreenBounds()
  const centerX = (left + right) / 2 - viewport.x, centerY = (top + bottom) / 2 - viewport.y
  editor.setCamera({ x: centerX / z - (bounds.minX + bounds.maxX) / 2, y: centerY / z - (bounds.minY + bounds.maxY) / 2, z })
  // Start the chat view on a whole message, so nothing is cut through under its header.
  const log = document.querySelector('.chat-messages'), step = log?.querySelector('#message-m4')
  if (log && step) log.scrollTop += step.getBoundingClientRect().top - log.getBoundingClientRect().top - 24
}
