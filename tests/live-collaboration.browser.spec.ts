import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

// Opt-in: uses real subscription usage. Start a live helper first, for example
//   PORT=3003 UNFOLD_PROVIDER=claude pnpm exec tsx server/index.ts   (or UNFOLD_PROVIDER=codex)
// then run: UNFOLD_LIVE_URL=http://127.0.0.1:3003 pnpm test:web --project=chromium live-collaboration
// The two goals and answers are typed like a user would; every agent reply, search and decision is live.
// It passes only when the user ends with a real result: an accepted shared idea whose first step cites a source the
// search opened, or a justified “nothing fits” (an honest empty search, or a conflict decision based on research).
// A technical failure (unreadable reply, CLI error, timeout) fails the run even though Retry is offered.
const live = process.env.UNFOLD_LIVE_URL
test.skip(!live, 'Set UNFOLD_LIVE_URL to a running live helper to run this check.')
test.use({ baseURL: live ?? 'http://127.0.0.1:3003' })

const out = 'output/live'
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const panel = (page: Page) => page.getByRole('complementary', { name: 'Node conversation' })
const log: string[] = []
const note = (line: string) => { log.push(`[${new Date().toISOString()}] ${line}`); writeFileSync(`${out}/run.log`, log.join('\n')) }
async function snapshot(page: Page, name: string) {
  await page.screenshot({ path: `${out}/${name}.png` })
  if (await panel(page).count()) writeFileSync(`${out}/${name}.txt`, await panel(page).innerText())
}
async function explore(page: Page, title: string) {
  await button(page, 'Fit board').click()
  const card = page.locator(`.unfold-card:has(input[value="${title}"])`).or(page.locator('.unfold-card', { has: page.getByRole('heading', { name: title, exact: true }) })).first()
  const box = await card.boundingBox()
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3, { steps: 3 })
  const caption = card.getByRole('textbox', { name: 'Inspiration goal' })
  if (await caption.count()) await caption.evaluate(input => { if (input instanceof HTMLElement) input.focus({ preventScroll: true }) })
  await button(page, `Explore ${title}`).click()
}
/** A technical failure is never a search result: record it and fail the run. */
async function failOnTechnicalError(page: Page, stage: string) {
  const paused = page.locator('.link-pill.tone-error')
  const failed = panel(page).locator('.chat-job.error')
  const detail = await paused.count() ? await paused.first().getAttribute('aria-label') : await failed.count() ? await failed.first().innerText() : undefined
  if (!detail) return
  note(`technical failure at ${stage}: ${detail}`)
  await page.screenshot({ path: `${out}/technical-failure.png` })
  throw new Error(`Technical failure at ${stage} (Retry is offered, but this is not a search result): ${detail}`)
}
/** Waits for the request this action started: first for it to begin, then for it to finish. */
async function idle(page: Page, timeout: number) {
  await panel(page).locator('.chat-job.running').waitFor({ timeout: 5000 }).catch(() => { /* It may already have finished. */ })
  await expect(panel(page).locator('.chat-job.running')).toHaveCount(0, { timeout })
}

test('live: two goals, a noticed link, a real conflict, the user’s decision and a sourced first step', async ({ page }) => {
  test.setTimeout(45 * 60_000)
  mkdirSync(out, { recursive: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await expect(page.locator('.mode-label')).toHaveCount(0)
  await button(page, 'Explore a sample board').click()
  await expect(page.getByRole('img', { name: 'Meet new people', exact: true })).toBeVisible()

  for (const [goal, answer] of [
    ['Explore a creative practice', 'I want to try a hands-on pottery class in San Francisco on Saturdays, under $25'],
    ['Meet new people', 'I want to meet new people in San Francisco on Saturday afternoons, in a small group'],
  ] as const) {
    await explore(page, goal)
    await expect(panel(page).locator('.assistant-message, .folded-turn')).not.toHaveCount(0, { timeout: 6 * 60_000 })
    await idle(page, 6 * 60_000)
    note(`${goal}: first reply ready`)
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill(answer)
    await page.getByRole('textbox', { name: 'Message', exact: true }).press('Enter')
    await idle(page, 6 * 60_000)
    await snapshot(page, `branch-${goal.split(' ')[0]?.toLowerCase() ?? 'goal'}`)
    note(`${goal}: answered and replied`)
    await button(page, 'Close chat').click()
  }

  // Nobody pressed Connect goals: the board notices the link on its own.
  await button(page, 'Fit board').click()
  const pill = page.locator('.link-pill:not(.tone-working)').first()
  await expect(pill).toBeVisible({ timeout: 12 * 60_000 })
  note(`link entry: ${await pill.getAttribute('aria-label') ?? ''}`)
  await page.screenshot({ path: `${out}/link-pill.png` })
  await failOnTechnicalError(page, 'link check')
  await pill.click()
  await expect(panel(page)).toBeVisible()
  await snapshot(page, 'link-first')

  // If a condition blocks the idea, the user makes the call; prefer changing the blocking condition.
  const conflict = panel(page).locator('.question-card .conflict-details')
  if (await conflict.count()) {
    const choices = panel(page).locator('.question-card .choice:not(.own)')
    const texts = await choices.allInnerTexts()
    note(`decision offered: ${texts.join(' | ')}`)
    const pick = texts.findIndex(text => /raise|increase|change|relax|flexible|more/i.test(text))
    await choices.nth(pick >= 0 ? pick : 0).click()
    note(`chose: ${texts[pick >= 0 ? pick : 0] ?? ''}`)
    await idle(page, 9 * 60_000)
    await failOnTechnicalError(page, 'after the decision')
    await snapshot(page, 'link-after-decision')
    // A follow-up such as "What's your new budget?" gets a concrete answer, as a person would give.
    for (let round = 1; round <= 2 && !await button(page, 'Accept').count() && await panel(page).locator('.question-card').count(); round++) {
      const options = await panel(page).locator('.question-card .choice:not(.own)').allInnerTexts()
      const amount = options.findIndex(text => /\$\s?\d/.test(text))
      const index = amount >= 0 ? Math.min(options.length - 1, amount + 1) : 0
      note(`follow-up ${round}: ${options.join(' | ')} → ${options[index] ?? ''}`)
      await panel(page).locator('.question-card .choice:not(.own)').nth(index).click()
      await idle(page, 9 * 60_000)
      await failOnTechnicalError(page, `follow-up ${round}`)
      await snapshot(page, `link-follow-up-${round}`)
    }
  } else if (await panel(page).locator('.question-card').count()) {
    note('the agents asked a question without a conflict; answering it')
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Either is fine; keep it in San Francisco on a Saturday')
    await page.getByRole('textbox', { name: 'Message', exact: true }).press('Enter')
    await idle(page, 9 * 60_000)
    await failOnTechnicalError(page, 'after the answer')
    await snapshot(page, 'link-after-answer')
  }

  if (!await button(page, 'Accept').count()) {
    // The other acceptable ending: an honest “nothing fits”, never a technical failure dressed as one.
    await button(page, 'Agent activity').click()
    const activity = await page.locator('.activity-panel').innerText()
    writeFileSync(`${out}/activity.txt`, activity)
    const none = await panel(page).locator('.chat-none').count()
    const decision = panel(page).locator('.question-card .conflict-details')
    const searchedNothing = /No suitable verified option/.test(activity) && !/could not be read|did not complete/i.test(activity)
    note(`no proposal to accept: none=${none} decision=${await decision.count()} searchedNothing=${String(searchedNothing)}`)
    expect(none > 0 || (await decision.count() > 0 && searchedNothing), 'The run ended without a sourced proposal and without a justified “nothing fits”; see link-*.txt').toBe(true)
    if (await decision.count()) expect(await decision.first().innerText()).toMatch(/\S/)
    return
  }
  const links = (scope: ReturnType<typeof panel>) => scope.locator('.chat-outcome .source-chips a').evaluateAll(anchors => anchors.map(anchor => anchor.getAttribute('href') ?? ''))
  const shared = await links(panel(page))
  note(`shared idea sources: ${shared.join(', ') || 'none'}`)
  await button(page, 'Accept').click()
  await expect(page.locator('.card-opportunity')).toHaveCount(1)
  note(`accepted: ${await page.locator('.card-opportunity h2').innerText()}`)
  await button(page, 'Close chat').click()
  await explore(page, await page.locator('.card-opportunity h2').innerText())
  await idle(page, 9 * 60_000)
  await failOnTechnicalError(page, 'first step')
  await snapshot(page, 'first-step')
  const sources = await links(panel(page))
  note(`first step sources: ${sources.join(', ') || 'none'}`)
  // An opportunity without a real source is not a successful search.
  expect([...shared, ...sources].filter(url => /^https?:\/\//.test(url)).length, 'The shared idea or its first step must cite a source the search opened').toBeGreaterThan(0)
  await button(page, 'Agent activity').click()
  writeFileSync(`${out}/activity.txt`, await page.locator('.activity-panel').innerText())
})
