// The API server only accepts POSTs from origins it trusts (CSRF protection for the local CLI).
// In development the page is served by Vite, which falls back to 5174, 5175… when 5173 is busy.
// The Vite proxy uses this to vouch for pages served by that same dev server, whatever port it got.

export const API_ORIGIN = 'http://127.0.0.1:3001'
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * Returns the origin to forward to the API for a request arriving at the Vite dev server,
 * or undefined to forward the original Origin unchanged (the API then applies its own check).
 * Only a same-origin request from a loopback dev server page is vouched for.
 */
export function devProxyOrigin(origin: string | undefined, host: string | undefined): string | undefined {
  if (!origin || !host) return undefined
  let url: URL
  try { url = new URL(origin) } catch { return undefined }
  if (url.protocol !== 'http:' || url.host !== host || !LOOPBACK_HOSTS.has(url.hostname)) return undefined
  return API_ORIGIN
}
