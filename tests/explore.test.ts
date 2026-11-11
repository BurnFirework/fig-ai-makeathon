import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeFindings, type ExploreFinding } from '../shared/explore'
import { verifiedJob } from '../server/explore'

const url = 'https://jobs.ashbyhq.com/acme/role'
const lead = { job_id: 'feed-1', job_title: 'Design Technologist', employer_name: 'Acme', job_apply_link: url, job_description: '', job_posted_at_datetime_utc: '', employer_website: '' }
const page = { url, title: 'Design Technologist @ Acme', excerpts: ['# Design Technologist\n## Location\nMountain View\n## Location Type\nHybrid\n$110K – $170K'] }

const evidenceCheck = test('employer evidence excludes hybrid and Europe-only jobs from US remote results', () => {
  assert.equal(verifiedJob(lead, [page], true), undefined)
  const europe = { ...page, excerpts: ['# Design Technologist\n## Location\nRemote - Europe\n## Location Type\nRemote'] }
  assert.equal(verifiedJob(lead, [europe], true), undefined)
  const remote = { ...page, excerpts: ['# Design Technologist\n## Location\nRemote - US\n## Location Type\nRemote\nRequisition Number R8030\n$110K – $170K'] }
  const first = verifiedJob(lead, [remote], true)
  const duplicate = verifiedJob({ ...lead, job_id: 'feed-2' }, [remote], true)
  assert.equal(first?.id, 'job:acme:r8030')
  assert.equal(first.id, duplicate?.id)
  assert.equal(first.price, '$110K – $170K')
  const workday = { ...page, excerpts: ['Acme is hiring remote anywhere in the United States with the following exceptions: Hawaii and Alaska.\nEnd Date: December 4, 2026'] }
  assert.equal(verifiedJob(lead, [workday], true)?.when, 'Apply by December 4, 2026')
  assert.equal(verifiedJob(lead, [workday], true)?.why, 'US remote, except Hawaii and Alaska.')
})

const refreshCheck = test('a rerun updates existing findings by identity and preserves unmatched results', () => {
  const first: ExploreFinding = { id: 'ticketmaster:1', title: 'Jazz quartet', subtitle: 'Oakland', why: 'Fits your dates', url, source: url, state: 'new', price: '$35' }
  const previous = [first, { ...first, id: 'ticketmaster:2' }]
  const refreshed = mergeFindings(previous, [{ ...first, price: '$39' }, { ...first, id: 'ticketmaster:3' }])
  assert.deepEqual(refreshed.map(finding => [finding.id, finding.state, finding.price]), [
    ['ticketmaster:1', 'changed', '$39'], ['ticketmaster:3', 'new', '$35'], ['ticketmaster:2', 'seen', '$35'],
  ])
  assert.deepEqual(mergeFindings(previous, [{ ...first, price: '$39' }], false).map(finding => finding.id), ['ticketmaster:1'])
})

await Promise.all([evidenceCheck, refreshCheck])
