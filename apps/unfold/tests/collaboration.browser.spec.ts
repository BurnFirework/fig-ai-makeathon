import { test, expect, type Page } from '@playwright/test'

// Runs against the static build, so the deterministic preview agents answer in the browser.
// Every agent message, handoff and decision below comes from the real coordinator; nothing is scripted in the page.

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const panel = (page: Page) => page.getByRole('complementary', { name: 'Node conversation' })
const message = (page: Page) => page.getByRole('textbox', { name: 'Message', exact: true })
/** Card actions appear on hover, as for a person using a pointer. */
async function explore(page: Page, title: string) {
  const image = page.getByRole('img', { name: title, exact: true })
  // Opening a chat moves the camera to its card; bring the whole board back into view first.
  await button(page, 'Fit board').click()
  // The canvas hit-tests cards itself, so move the pointer over the card rather than "hovering" a DOM node.
  const box = await (await image.count() ? image : page.locator('.unfold-card', { hasText: title }).first()).boundingBox()
  if (box) { await page.mouse.move(box.x + 4, box.y + 4); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3, { steps: 3 }) }
  // A goal card also shows its actions while its caption has keyboard focus.
  const caption = page.locator('.unfold-card', { has: image }).getByRole('textbox', { name: 'Inspiration goal' })
  if (await caption.count()) await caption.evaluate(input => { if (input instanceof HTMLElement) input.focus({ preventScroll: true }) })
  await button(page, `Explore ${title}`).click()
}

async function sampleBoard(page: Page) {
  page.on('pageerror', error => { throw error })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await button(page, 'Explore a sample board').click()
  await expect(page.getByRole('img', { name: 'Explore a creative practice', exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Meet new people', exact: true })).toBeVisible()
}
/** Opens a goal's own exploration and answers the first preview question. */
async function startGoal(page: Page, goal: string) {
  await explore(page, goal)
  await page.getByRole('button', { name: /Yes, I want to try/ }).click()
  await expect(panel(page).locator('.question-card')).toContainText('feel manageable')
}
async function say(page: Page, text: string) {
  await message(page).fill(text)
  await message(page).press('Enter')
  await expect(panel(page).locator('.chat-job')).toHaveCount(0, { timeout: 10_000 })
}
async function activityText(page: Page) {
  await button(page, 'Agent activity').click()
  const text = await page.locator('.activity-panel').innerText()
  await page.getByRole('button', { name: 'Close activity', exact: true }).click()
  return text
}

test('agents notice a link between two developed goals, raise a real conflict, and follow the user’s decision', async ({ page }) => {
  test.setTimeout(90_000)
  await sampleBoard(page)
  await startGoal(page, 'Explore a creative practice')
  await button(page, 'Close chat').click()
  await startGoal(page, 'Meet new people')
  await button(page, 'Close chat').click()

  // Both goals have a clear intention but share nothing yet: the check runs and stays silent.
  await expect.poll(() => activityText(page), { timeout: 15_000 }).toContain('no useful overlap')
  await expect(page.locator('.link-pill')).toHaveCount(0)
  await expect(page.locator('.card-opportunity')).toHaveCount(0)

  // Each branch gains its own conditions; the second one shares a time with the first.
  await explore(page, 'Explore a creative practice')
  await say(page, 'Saturdays, under $30')
  await button(page, 'Close chat').click()
  await explore(page, 'Meet new people')
  await say(page, 'Saturday afternoons with friends')
  // The user keeps working in this chat; the link must not take it over or open anything.
  const cardAt = () => page.getByRole('img', { name: 'Explore a creative practice', exact: true }).boundingBox()
  const before = await cardAt()
  await expect(page.getByRole('button', { name: /^Link needs your decision with/ })).toHaveCount(2, { timeout: 20_000 })
  await expect(panel(page)).toContainText('Saturday afternoons with friends')
  await expect(panel(page).locator('.collab-stages')).toHaveCount(0)
  expect(await cardAt()).toEqual(before)
  await page.screenshot({ path: '../../output/playwright/link-noticed.png' })
  await expect(page.locator('.card-opportunity')).toHaveCount(0)
  await button(page, 'Close chat').click()
  await button(page, 'Fit board').click()
  await page.screenshot({ path: '../../output/playwright/link-pills.png' })

  // The compact entry opens the shared conversation with the decision: what blocks it, the basis and each effect.
  await page.locator('.link-pill').first().click()
  const stages = panel(page).locator('.collab-stages')
  for (const stage of ['Overlap found', 'Checking both goals', 'Researching a real option', 'Conflict found', 'Your decision needed']) await expect(stages).toContainText(stage)
  const conflict = panel(page).locator('.question-card .conflict-details')
  await expect(conflict).toContainText('Blocked by')
  await expect(conflict).toContainText('Budget: up to $30')
  await expect(conflict).toContainText('$45')
  await expect(conflict.locator('.source-chips a')).toHaveAttribute('href', /eventbrite/)
  await expect(panel(page).locator('.choice-effect').first()).toContainText('keep the condition')
  await page.screenshot({ path: '../../output/playwright/link-decision.png' })
  await panel(page).locator('.agent-trace summary').first().click()
  await expect(panel(page).locator('.agent-trace').first()).toContainText('Research agent → Connection agent')
  await panel(page).locator('.agent-trace summary').first().click()

  // The user changes the condition: the agents search with it and propose a sourced shared idea.
  await page.getByRole('button', { name: /Raise budget to \$45/ }).click()
  await expect(button(page, 'Accept')).toBeVisible({ timeout: 15_000 })
  await expect(stages).toContainText('Proposal ready')
  const proposal = panel(page).locator('.chat-outcome').last()
  await expect(proposal.locator('.source-chips a')).toHaveAttribute('href', /eventbrite/)
  await panel(page).locator('.agent-trace summary').last().click()
  await expect(panel(page).locator('.agent-trace').last()).toContainText('within $45')
  await expect(panel(page).locator('.folded-turn')).toContainText('Raise budget to $45')
  await page.screenshot({ path: '../../output/playwright/link-proposal.png' })

  // Accepting creates exactly one shared card with both sources; Connect goals reopens the same conversation.
  await button(page, 'Accept').click()
  await expect(page.locator('.card-opportunity')).toHaveCount(1)
  await expect(page.locator('.link-pill')).toHaveCount(0)
  await button(page, 'Close chat').click()
  await button(page, 'Connect goals').click()
  await expect(panel(page).locator('.decision-status.accepted')).toBeVisible()
  await expect(page.locator('.card-opportunity')).toHaveCount(1)
  await button(page, 'Close chat').click()

  // After a reload the decision, the shared card and the checks are kept; nothing runs again.
  await page.waitForTimeout(900)
  await page.reload()
  await expect(page.locator('.card-opportunity')).toHaveCount(1)
  await button(page, 'Connect goals').click()
  await expect(panel(page).locator('.decision-status.accepted')).toBeVisible()
  await expect(panel(page).locator('.folded-turn')).toContainText('Raise budget to $45')
  await expect(panel(page).locator('.chat-job')).toHaveCount(0)
  await button(page, 'Close chat').click()
  await page.waitForTimeout(4500)
  await expect(page.locator('.link-pill')).toHaveCount(0)

  // The accepted direction's sources reach the next step: opening the shared card proposes a sourced first step.
  await explore(page, await page.locator('.card-opportunity h2').innerText())
  await expect(panel(page).locator('.chat-outcome .source-chips a')).toHaveAttribute('href', /eventbrite/, { timeout: 15_000 })
  await expect(panel(page).locator('.agent-trace').first()).toContainText('from the accepted shared direction')
})

test('keeping the condition sends the agents to search differently; a declined idea does not come back', async ({ page }) => {
  test.setTimeout(90_000)
  await sampleBoard(page)
  await startGoal(page, 'Explore a creative practice')
  await say(page, 'Saturdays, under $30')
  await button(page, 'Close chat').click()
  await startGoal(page, 'Meet new people')
  await say(page, 'Saturday afternoons with friends')
  await button(page, 'Close chat').click()
  await page.getByRole('button', { name: /^Link needs your decision with/ }).first().click({ timeout: 20_000 })

  await page.getByRole('button', { name: /Keep my budget, search further/ }).click()
  await expect(button(page, 'Accept')).toBeVisible({ timeout: 15_000 })
  const proposal = panel(page).locator('.chat-outcome').last()
  await expect(proposal.locator('.source-chips a')).toHaveAttribute('href', /meetup/)
  await panel(page).locator('.agent-trace summary').last().click()
  await expect(panel(page).locator('.agent-trace').last()).toContainText('Free or low-cost')

  // Decline with a reason: the idea stops and the next change does not bring it back.
  await button(page, 'Decline').click()
  await page.getByRole('textbox', { name: 'Why not? (optional)' }).fill('Too far from home')
  await panel(page).getByRole('button', { name: 'Decline', exact: true }).click()
  await expect(panel(page).locator('.decision-status.declined')).toContainText('Too far from home')
  await button(page, 'Close chat').click()
  await explore(page, 'Meet new people')
  await say(page, 'Small groups')
  await button(page, 'Close chat').click()
  await expect.poll(() => activityText(page), { timeout: 15_000 }).toContain('You declined')
  await expect(page.locator('.link-pill')).toHaveCount(0)
  await expect(page.locator('.card-opportunity')).toHaveCount(0)
})

test('switching boards and changing conditions set late link results aside', async ({ page }) => {
  test.setTimeout(90_000)
  await sampleBoard(page)
  await startGoal(page, 'Explore a creative practice')
  await say(page, 'Saturdays, under $30')
  await button(page, 'Close chat').click()
  await startGoal(page, 'Meet new people')
  await say(page, 'Saturday afternoons with friends')
  await button(page, 'Close chat').click()
  // Switch away while the check is waiting or running: nothing may land on either board.
  await page.getByRole('button', { name: /^Mood boards:/ }).click()
  await page.getByRole('menuitem', { name: 'New mood board', exact: true }).click()
  await page.getByRole('textbox', { name: 'Board name', exact: true }).fill('Elsewhere')
  await page.getByRole('button', { name: 'Create board', exact: true }).click()
  await page.waitForTimeout(6000)
  await expect(page.locator('.link-pill')).toHaveCount(0)
  await page.getByRole('button', { name: /^Mood boards:/ }).click()
  await page.getByRole('menuitem', { name: 'Your next chapter', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Meet new people', exact: true })).toBeVisible()
  await page.waitForTimeout(1500)
  await expect(page.locator('.link-pill')).toHaveCount(0)

  // A condition change while a check runs stops it; the check then runs again with the new condition.
  await explore(page, 'Meet new people')
  await say(page, 'Weekends with friends')
  await expect(page.locator('.link-pill.tone-working')).toHaveCount(2, { timeout: 10_000 })
  await say(page, 'Actually on Sundays')
  await expect(page.getByRole('button', { name: /^(Link needs your|Shared idea ready)/ })).toHaveCount(2, { timeout: 20_000 })
  const text = await activityText(page)
  expect(text).toContain('Conditions changed while the agents checked a link')
})
