import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { parseAgentRequest } from './runtime'
import { runAgents } from './agents'
import { discoverProviders, providerConfig, publicConfig, selectProvider } from './cli'
import { z } from 'zod'

if (existsSync('.env')) process.loadEnvFile('.env')
const port = Number(process.env.PORT || 3001)
await discoverProviders()
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' }

async function* requestBytes(request: IncomingMessage) {
  const chunks: AsyncIterable<unknown> = request
  for await (const chunk of chunks) yield z.instanceof(Buffer).parse(chunk)
}

async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  const pathname = new URL(request.url || '/', 'http://localhost').pathname
  const hostname = (request.headers.host || '').split(':')[0] || ''
  if (!['127.0.0.1', 'localhost'].includes(hostname)) { response.writeHead(403); response.end('Local connections only.'); return }
  if (request.method === 'POST' && pathname.startsWith('/api/')) {
    const origin = request.headers.origin
    const allowedOrigins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, 'http://127.0.0.1:5173', 'http://localhost:5173']
    if ((origin && !allowedOrigins.includes(origin)) || !request.headers['content-type']?.startsWith('application/json')) { response.writeHead(403); response.end('Use the local Unfold application.'); return }
  }
  if (request.method === 'GET' && pathname === '/api/config') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(publicConfig())); return
  }
  if (request.method === 'POST' && pathname === '/api/provider') {
    try {
      let body = ''
      for await (const bytes of requestBytes(request)) { body += bytes.toString(); if (body.length > 1024) throw new Error('Request too large.') }
      const data = z.object({ provider: z.enum(['claude', 'codex', 'demo']) }).parse(JSON.parse(body))
      await selectProvider(data.provider)
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(publicConfig()))
    } catch (error) { response.writeHead(400, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Provider unavailable.' })) }
    return
  }
  if (request.method === 'POST' && pathname === '/api/agent') {
    const controller = new AbortController()
    response.on('close', () => controller.abort())
    const timeout = setTimeout(() => controller.abort(), 270_000)
    try {
      const chunks: Buffer[] = []; let size = 0
      for await (const bytes of requestBytes(request)) {
        size += bytes.length
        if (size > 8_000_000) { response.writeHead(413); response.end('Image or request is too large.'); return }
        chunks.push(bytes)
      }
      const parsed = parseAgentRequest(JSON.parse(Buffer.concat(chunks).toString()))
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' })
      const emit = (event: unknown) => { if (!response.destroyed) response.write(JSON.stringify(event) + '\n') }
      const result = await runAgents(parsed, providerConfig(), controller.signal, emit)
      if (!controller.signal.aborted) emit({ type: 'result', result })
    } catch (error) {
      if (!response.headersSent) response.writeHead(400, { 'Content-Type': 'application/x-ndjson' })
      if (!response.destroyed) response.write(JSON.stringify({ type: 'error', message: controller.signal.aborted ? 'The request timed out or was stopped. Please retry.' : error instanceof Error ? error.message : 'Something went wrong. Please retry.' }) + '\n')
    } finally { clearTimeout(timeout); response.end() }
    return
  }
  if (request.method !== 'GET') { response.writeHead(405); response.end(); return }
  const root = resolve('dist')
  let decodedPath: string
  try { decodedPath = decodeURIComponent(pathname) } catch { response.writeHead(400); response.end('Invalid path.'); return }
  const file = resolve(root, '.' + decodedPath)
  if (file !== root && !file.startsWith(root + sep)) { response.writeHead(403); response.end(); return }
  const target = existsSync(file) && extname(file) ? file : extname(pathname) ? '' : resolve(root, 'index.html')
  if (!target || !existsSync(target)) { response.writeHead(404); response.end('Run pnpm dev, or build the app first.'); return }
  response.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream' })
  response.end(readFileSync(target))
}

createServer((request, response) => {
  handleRequest(request, response).catch(() => {
    if (!response.headersSent) response.writeHead(500)
    response.end('The server could not complete this request.')
  })
}).listen(port, '127.0.0.1', () => process.stdout.write(`Unfold API listening at http://127.0.0.1:${port}\n`))
