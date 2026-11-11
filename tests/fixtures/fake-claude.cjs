#!/usr/bin/env node
// A stand-in for the `claude` CLI used by tests/research-failure.browser.spec.ts. It answers Unfold's prompts in
// Claude Code's stream-json format, so the real local helper, coordinator and interface run unchanged.
// The file named by UNFOLD_FAKE_STATE selects the research behaviour: "broken" reproduces the live failure of
// November 10, 2026 (a research reply longer than the schema allows that stays unreadable after one correction),
// "ok" returns a short reply that cites a page the search opened.
const { readFileSync } = require('node:fs')

const args = process.argv.slice(2)
if (args.includes('--version')) { process.stdout.write('2.0.0 (Claude Code, test double)\n'); process.exit(0) }
if (args[0] === 'auth') process.exit(0)

const state = () => { try { return readFileSync(process.env.UNFOLD_FAKE_STATE ?? '', 'utf8').trim() } catch { return 'ok' } }
const out = event => process.stdout.write(JSON.stringify(event) + '\n')
const reply = value => out({ type: 'result', subtype: 'success', is_error: false, result: typeof value === 'string' ? value : JSON.stringify(value) })
const SOURCE = { title: 'Saturday clay social', url: 'https://studio.example/saturday-clay-social' }
const candidate = { title: 'Small-group clay social', description: 'A Saturday hand-building session in San Francisco with a few other beginners.', benefitA: 'Hands-on creative practice', benefitB: 'Meet a few people while making' }

let input = ''
process.stdin.on('data', chunk => { input += chunk })
process.stdin.on('end', () => {
  const content = JSON.parse(input).message.content
  const text = content.find(part => part.type === 'text').text
  const broken = state() === 'broken'
  if (text.includes('Role: formatter')) return reply(broken ? 'I could not shorten this; here is the research in prose instead.' : { status: 'found', summary: 'Saturday clay social, 2–4 p.m., $20.', sources: [SOURCE], limits: '' })
  if (text.includes('Role: research agent')) {
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebSearch', input: { query: 'clay social San Francisco Saturday' } }] } })
    out({ type: 'user', message: { content: [{ type: 'tool_result', content: `Saturday clay social ${SOURCE.url}` }] } })
    if (broken) return reply({ status: 'found', summary: 'A Saturday clay social in San Francisco. '.repeat(45), sources: [SOURCE], limits: '' })
    return reply({ status: 'found', summary: 'Saturday clay social in San Francisco, 2–4 p.m., $20 per person, up to 8 people.', sources: [SOURCE], limits: 'Spots left were not shown.' })
  }
  if (text.includes('Role: connection agent')) {
    if (text.includes('First decide whether these two goals')) return reply({ next: 'check', candidate })
    if (text.includes('New research result, not yet built into the candidate')) return reply({ next: 'revise', candidate: { ...candidate, title: 'Saturday clay social', sources: [SOURCE] }, reason: 'Built on the class the search found.' })
    return reply({ next: 'research', brief: 'Small-group clay class in San Francisco on Saturday under $25', mustMatch: ['San Francisco', 'Saturday', 'Budget: up to $25', 'Small group'], reason: 'The price needs a real option.' })
  }
  if (text.includes('Role: branch agent for the goal')) return reply({ fit: 'fits', reason: 'Matches this goal if the price is within the budget.', conflicts: [], missing: null, verify: text.includes('$25') ? 'Budget: up to $25' : null })
  // Branch exploration: one question each time; the user's answers carry the conditions.
  return reply({ next: 'ask', question: { prompt: 'What would make this easy to start?', options: ['A weekend slot', 'Something cheap'], purpose: 'To find a first step that fits.' } })
})
