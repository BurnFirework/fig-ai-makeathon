import { test } from 'node:test'
import assert from 'node:assert/strict'
import { API_ORIGIN, devProxyOrigin } from '../server/dev-origin'

const cases: Promise<void>[] = []
cases.push(test('the dev proxy vouches for its own page on any loopback port', () => {
  assert.equal(devProxyOrigin('http://127.0.0.1:5173', '127.0.0.1:5173'), API_ORIGIN)
  assert.equal(devProxyOrigin('http://127.0.0.1:5174', '127.0.0.1:5174'), API_ORIGIN)
  assert.equal(devProxyOrigin('http://localhost:5180', 'localhost:5180'), API_ORIGIN)
}))

cases.push(test('the dev proxy leaves other origins for the API to reject', () => {
  assert.equal(devProxyOrigin('https://evil.example', '127.0.0.1:5174'), undefined)
  assert.equal(devProxyOrigin('http://127.0.0.1:6006', '127.0.0.1:5174'), undefined)
  assert.equal(devProxyOrigin('http://evil.example:5174', 'evil.example:5174'), undefined)
  assert.equal(devProxyOrigin('null', '127.0.0.1:5174'), undefined)
  assert.equal(devProxyOrigin(undefined, '127.0.0.1:5174'), undefined)
}))
await Promise.all(cases)
