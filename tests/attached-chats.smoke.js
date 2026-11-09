// Against a separate preview server after pnpm build:
// PORT=3002 UNFOLD_PROVIDER=demo pnpm exec node --import tsx server/index.ts
// pnpm dlx @playwright/cli -s=attached-chats open http://127.0.0.1:3002 --idle-timeout=900000
// pnpm dlx @playwright/cli -s=attached-chats run-code "$(cat tests/attached-chats.smoke.js)"
// pnpm dlx @playwright/cli -s=attached-chats close
// Uses this browser session's isolated storage. Creates sample and migration boards.
async (page) => {
  const assert = (value, message) => { if (!value) throw new Error(message) }
  const button = name => page.getByRole('button', { name, exact: true })
  const cards = () => page.locator('.unfold-card').count()
  const panel = page.getByRole('complementary', { name: 'Node conversation' })
  const message = page.getByRole('textbox', { name: 'Message', exact: true })
  const results = []
  await page.setViewportSize({ width: 1440, height: 1000 })
  await button('Board settings').click()
  await page.getByRole('combobox', { name: 'Agent provider' }).waitFor()
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: /^Mood boards:/ }).click()
  await page.getByRole('menuitem', { name: 'New mood board', exact: true }).click()
  await page.getByRole('textbox', { name: 'Board name', exact: true }).fill('Attached chats verification')
  await page.getByRole('button', { name: 'Create board', exact: true }).click()
  await button('Explore a sample board').click()
  await button('Explore Explore a creative practice').click()
  await page.getByRole('button', { name: 'Yes, I want to try', exact: false }).waitFor()
  assert(await button('Focus view').getAttribute('aria-pressed') === 'true', 'Focus must be the default chat view')
  assert(await page.getByRole('region', { name: 'Conversation source content' }).locator('img').count() === 1, 'Focus must show its source image above the conversation')
  assert(await cards() === 2, 'Starting a chat must not add nodes')
  await message.fill('A draft that survives switching views')
  await button('Board and chat view').click()
  assert(await message.inputValue() === 'A draft that survives switching views', 'Switch to board lost the draft')
  await button('Focus view').click()
  assert(await message.inputValue() === 'A draft that survives switching views', 'Switch to focus lost the draft')
  await message.fill('')
  await page.screenshot({ path: 'output/playwright/final-focus-chat.png' })
  await page.getByRole('button', { name: 'Yes, I want to try', exact: false }).click()
  await page.getByRole('button', { name: 'One hour, low budget', exact: false }).waitFor()
  await message.fill('One hour, under $50, in Oakland. I want to make something with my hands.')
  await message.press('Enter')
  await button('Add to canvas').waitFor()
  assert(await cards() === 2, 'Messages or proposed outcomes added unwanted nodes')
  assert(await page.locator('.chat-message').count() === 5, 'The conversation must retain all five messages')
  await button('Add to canvas').click()
  await page.locator('.card-action').waitFor()
  assert(await cards() === 3, 'Publishing must add exactly one outcome')
  assert(await button('Add to canvas').count() === 0, 'A published outcome must not be publishable twice')
  await button('View on canvas').click()
  assert(await button('Board and chat view').getAttribute('aria-pressed') === 'true', 'View on canvas must reveal the board')
  await button('More canvas actions').click()
  await page.getByRole('menuitem', { name: 'Undo', exact: true }).click()
  await page.locator('.card-action').waitFor({ state: 'hidden' })
  assert(await button('Add to canvas').count() === 1, 'Undo must restore the unpublished outcome')
  await button('More canvas actions').click()
  await page.getByRole('menuitem', { name: 'Redo', exact: true }).click()
  await page.locator('.card-action').waitFor()
  assert(await cards() === 3, 'Redo must restore exactly one outcome')
  await page.screenshot({ path: 'output/playwright/final-board-chat.png' })
  results.push('two chat views preserve drafts; five messages stay off-canvas; explicit publication, undo and redo')

  await button('Close chat').click()
  await button('Explore Find one beginner-friendly session').click()
  await page.locator('.chat-outcome').waitFor()
  const breadcrumbs = page.getByRole('navigation', { name: 'Exploration breadcrumbs' })
  assert((await breadcrumbs.innerText()).includes('Explore a creative practice'), 'Outcome breadcrumbs must contain its original inspiration')
  assert((await breadcrumbs.innerText()).includes('Find one beginner-friendly session'), 'Outcome breadcrumbs must contain its current source')
  await breadcrumbs.getByRole('button', { name: 'Explore a creative practice', exact: true }).click()
  await panel.waitFor({ state: 'hidden' })
  await button('Explore Explore a creative practice').click()
  await button('New conversation').click()
  await page.getByRole('button', { name: 'Yes, I want to try', exact: false }).waitFor()
  assert(await page.locator('.chat-message').count() === 1, 'New conversation must not contain sibling messages')
  await button('Switch conversation').click()
  await page.getByRole('menuitem', { name: 'Exploration 1', exact: true }).click()
  assert(await page.locator('.chat-message').count() === 5, 'Switching chats must restore its history')
  await button('Close chat').click()
  await button('Connect goals').click()
  await button('Add to canvas').waitFor()
  assert(await cards() === 3, 'Shared proposals must remain in chat until explicitly added')
  await button('Focus view').click()
  assert(await page.getByRole('region', { name: 'Conversation source content' }).locator('img').count() === 2, 'A shared chat must show both sources')
  await button('Add to canvas').click()
  await page.locator('.card-opportunity').waitFor()
  assert(await cards() === 4, 'Adding a shared outcome must create only one node')
  await button('View on canvas').click()
  await button('Close chat').click()
  await button('Explore A first experience, together').click()
  await button('Add to canvas').waitFor()
  assert(await cards() === 4, 'Research handoff must produce a chat proposal before a new node')
  results.push('source breadcrumbs, isolated sibling chats, shared outcomes, and research follow-up')

  // A failed request can be retried without appending the user message twice.
  await page.route('**/api/agent', route => route.fulfill({ status: 503, body: 'Temporary test failure' }), { times: 1 })
  await message.fill('Please keep this within Oakland')
  await message.press('Enter')
  await button('Retry request').waitFor()
  const messagesBeforeRetry = await page.locator('.chat-message').count()
  await button('Retry request').click()
  await page.locator('.chat-job').waitFor({ state: 'hidden' })
  assert(await page.locator('.chat-message').count() === messagesBeforeRetry + 1, 'Retry must add one assistant reply without duplicating user input')
  await message.fill('Try another local option')
  await message.press('Enter')
  await button('Stop request').click()
  const stoppedCount = await page.locator('.chat-message').count()
  await page.waitForTimeout(850)
  assert(await page.locator('.chat-message').count() === stoppedCount, 'A stopped response must not arrive late')
  assert(await cards() === 4, 'Retry and stop must not create nodes')
  await page.reload()
  await page.locator('.card-opportunity').waitFor()
  assert(await cards() === 4, 'Reload must restore only inspirations and published outcomes')
  await button('Explore Explore a creative practice').click()
  assert(await page.locator('.chat-outcome').count() === 1, 'Reload must restore the latest saved shared chat')
  await button('Switch conversation').click()
  await page.getByRole('menuitem', { name: 'Exploration 1', exact: true }).click()
  assert(await page.locator('.chat-message').count() === 5, 'Reload must preserve the earlier full conversation')
  assert(await page.locator('.focus-content img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), 'Persisted source images must decode')
  results.push('request failure/retry, stop with no late reply, and saved chats/images after reload')

  // Inspect the current layout, including a narrow focused view.
  await page.setViewportSize({ width: 390, height: 844 })
  await button('Focus view').click()
  const escaped = await panel.evaluate(panel => {
    const frame = panel.getBoundingClientRect()
    return [...panel.querySelectorAll('.chat-panel-header button, .chat-compose, .chat-view-controls')].some(control => {
      const box = control.getBoundingClientRect()
      return box.left < frame.left || box.right > frame.right + 1 || box.bottom > frame.bottom + 1
    })
  })
  assert(!escaped, 'Chat controls must fit the focused view')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await button('Close chat').click()
  await page.getByRole('button', { name: /^Mood boards:/ }).click()
  await page.getByRole('menuitem', { name: 'New mood board', exact: true }).click()
  await page.getByRole('textbox', { name: 'Board name', exact: true }).fill('Legacy migration')
  await page.getByRole('button', { name: 'Create board', exact: true }).click()
  await page.getByRole('button', { name: 'Mood boards: Legacy migration', exact: true }).waitFor()
  assert(await cards() === 0, 'A new board must be independent')
  await page.evaluate(() => {
    const el = document.querySelector('.chrome')
    let fiber = el[Object.keys(el).find(key => key.startsWith('__reactFiber'))]
    let editor
    for (; fiber; fiber = fiber.return) for (let context = fiber.dependencies?.firstContext; context; context = context.next) if (context.memoizedValue?.getCurrentPageShapes) editor = context.memoizedValue
    if (!editor) throw new Error('Canvas editor not found')
    const base = { branchId: 'shape:legacy-root', sequence: 0, revision: 0, stale: false, dependsOn: [], agent: 'you', createdAt: 0 }
    editor.createShapes([
      { id: 'shape:legacy-root', type: 'node', x: 100, y: 180, props: { node: { ...base, type: 'inspiration', assetId: '', goal: 'Legacy inspiration', started: true } } },
      { id: 'shape:legacy-question', type: 'node', x: 100, y: 600, props: { node: { ...base, sequence: 1, type: 'question', prompt: 'Where?', options: ['Oakland', 'Elsewhere'], purpose: 'Stay local' } } },
      { id: 'shape:legacy-answer', type: 'node', x: 100, y: 1000, props: { node: { ...base, sequence: 2, type: 'answer', text: 'Oakland, under $50', questionId: 'shape:legacy-question' } } },
      { id: 'shape:legacy-outcome', type: 'node', x: 100, y: 1300, props: { node: { ...base, sequence: 3, agent: 'research', type: 'action', title: 'Preserved outcome', description: 'A saved next step', sources: [], completed: true, reflection: 'I tried it', dependsOn: [{ id: 'shape:legacy-answer', revision: 0 }] } } },
      { id: 'shape:legacy-connection', type: 'connection' },
    ])
    editor.createBindings([
      { type: 'connection', fromId: 'shape:legacy-connection', toId: 'shape:legacy-answer', props: { portId: 'output', terminal: 'start' } },
      { type: 'connection', fromId: 'shape:legacy-connection', toId: 'shape:legacy-outcome', props: { portId: 'input', terminal: 'end' } },
    ])
  })
  // tldraw's existing IndexedDB writer is asynchronous.
  await page.waitForTimeout(900)
  await page.reload()
  await button('Explore Legacy inspiration').waitFor()
  assert(await cards() === 2, 'Legacy question/answer cards must fold into their inspiration')
  assert(await page.locator('.card-action').count() === 1, 'Migration must preserve outcomes')
  await button('Explore Legacy inspiration').click()
  await page.getByText('Oakland, under $50', { exact: true }).waitFor()
  assert(await page.locator('.chat-message').count() === 3, 'Migration must preserve the question, answer and linked outcome')
  await page.reload()
  await button('Explore Legacy inspiration').waitFor()
  assert(await cards() === 2, 'Reload must not repeat migration')
  results.push('narrow focused layout, independent boards, and legacy migration with reload')
  return results
}
