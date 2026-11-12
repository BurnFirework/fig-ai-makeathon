import { z } from 'zod'

const root = 'https://backend.composio.dev/api/v3.1'
/** Shared demo key with a limited balance, public on purpose so the demo works without setup. It may run out or be revoked; set COMPOSIO_API_KEY to use your own. */
const bundledComposioKey ='ak_P5DvM_8M2oLSs87M_o1E'
const object = z.record(z.string(), z.unknown())

const inputSchema = z.object({ type: z.literal('object'), properties: z.record(z.string(), z.unknown()), required: z.array(z.string()).optional() }).passthrough()
/** Meta replies may wrap schemas, but a success envelope alone never grants execution. */
function hasToolSchema(value: unknown, slug: string, matched = false): boolean {
  if (Array.isArray(value)) return value.some(item => hasToolSchema(item, slug, matched))
  const parsed = object.safeParse(value)
  if (!parsed.success || parsed.data.successful === false || parsed.data.success === false || parsed.data.error) return false
  const item = parsed.data
  const own = matched || item.tool_slug === slug || item.slug === slug || item.name === slug
  if (own && (inputSchema.safeParse(item.input_schema).success || inputSchema.safeParse(item.input_parameters).success || inputSchema.safeParse(item.parameters).success)) return true
  return Object.entries(item).some(([key, child]) => hasToolSchema(child, slug, own || key === slug))
}

function failedReply(value: unknown): boolean {
  const parsed = object.safeParse(value)
  if (!parsed.success) return false
  const item = parsed.data
  return item.successful === false || item.success === false || Boolean(item.error) || failedReply(item.data) || failedReply(item.result)
}

export const researchSessionPolicy = {
  tags: { enable: ['readOnlyHint'], disable: ['createHint', 'updateHint', 'destructiveHint'] },
  manage_connections: { enable: false, enable_connection_removal: false },
  workbench: { enable: false, enable_tool_execution: false, enable_proxy_execution: false },
  proxy_execute: { enable: false },
}
/** All credentials and session execution stay in the local runtime. No arbitrary URL or proxy execution. */
export class ExploreTools {
  private session?: string
  private discovered = new Set<string>()
  private schemas = new Set<string>()
  constructor(private signal: AbortSignal, private connectionNeeded?: (toolkit: string, url: string) => void) {}
  private async request(path: string, body: unknown) {
    const key = process.env.COMPOSIO_API_KEY || bundledComposioKey
    const response = await fetch(root + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.any([this.signal, AbortSignal.timeout(45_000)]) })
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403
      ? 'Research connection needs access: use a key with Session management Read/Write and Session tool execution Write, then retry.'
      : `Research service could not respond (${response.status}). Retry this card.`)
    return object.parse(await response.json())
  }
  private async path() {
    if (!this.session) {
      const result = await this.request('/tool_router/session', { user_id: process.env.COMPOSIO_USER_ID || 'unfold-explore', ...researchSessionPolicy })
      this.session = z.string().regex(/^trs_[\w-]+$/).parse(result.session_id)
    }
    return `/tool_router/session/${this.session}`
  }
  async discover(query: string) {
    const result = await this.request(`${await this.path()}/search`, { queries: [{ use_case: query }], search_strategy: 'tool_search' })
    const schemas = object.parse(result.tool_schemas ?? {})
    for (const [slug, value] of Object.entries(schemas)) if (!slug.startsWith('COMPOSIO_')) {
      this.discovered.add(slug)
      const schema = object.safeParse(value)
      if (schema.success && hasToolSchema(schema.data, slug, true)) this.schemas.add(slug)
    }
    const statuses = z.array(z.object({ toolkit: z.string(), has_active_connection: z.boolean(), instant_account: z.unknown().optional() })).safeParse(result.toolkit_connection_statuses)
    for (const status of statuses.success ? statuses.data : []) {
      if (status.has_active_connection || status.instant_account || !this.connectionNeeded) continue
      try {
        const link = await this.request(`${await this.path()}/link`, { toolkit: status.toolkit })
        const url = z.url({ protocol: /^https$/ }).parse(link.redirect_url)
        this.connectionNeeded(status.toolkit, url)
      } catch { this.signal.throwIfAborted() /* Connection setup is optional; other research continues. */ }
    }
    return result
  }
  async schema(slug: string) {
    this.check(slug)
    const result = await this.request(`${await this.path()}/execute`, { tool_slug: 'COMPOSIO_GET_TOOL_SCHEMAS', arguments: { tool_slugs: [slug] } })
    if (result.result_type !== 'completed' || !hasToolSchema(result.data, slug)) throw new Error('The tool schema could not be loaded. Try another research tool.')
    this.schemas.add(slug)
    return result
  }
  private check(slug: string) {
    if (!this.discovered.has(slug) || slug.startsWith('COMPOSIO_')) throw new Error('Discover a read-only research tool before using it.')
  }
  async execute(slug: string, args: Record<string, unknown>, account?: string) {
    this.check(slug)
    if (!this.schemas.has(slug)) throw new Error('Load this tool’s input schema before executing it.')
    // The session enforces read-only tags again at execution, not just discovery.
    const result = await this.request(`${await this.path()}/execute`, { tool_slug: slug, arguments: args, ...(account ? { account } : {}), enable_auto_workbench_offload: false })
    if (result.result_type !== 'completed') throw new Error(result.result_type === 'input_required' ? 'This tool needs your connection or approval. Connect its toolkit in Composio and retry; external actions are not authorized by Explore.' : 'This research tool failed or was blocked. Try another read-only source or reconnect its toolkit.')
    if (failedReply(result)) throw new Error('This research tool returned an error. Try another read-only source or reconnect its toolkit.')
    return result
  }
}
