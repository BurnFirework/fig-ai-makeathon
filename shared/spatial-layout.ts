export interface Point { x: number; y: number }
export interface Rect extends Point { w: number; h: number; id: string }
export function curveControls(start: Point, end: Point, sideways = false): [Point, Point] {
  if (sideways) {
    const reach = Math.max(30, Math.abs(end.x - start.x) / 2)
    return [{ x: start.x + reach, y: start.y }, { x: end.x - reach, y: end.y }]
  }
  const dx = end.x - start.x, dy = end.y - start.y
  const distance = Math.hypot(dx, dy) || 1
  const bend = Math.min(110, Math.max(25, distance * 0.16))
  const ox = -dy / distance * bend, oy = dx / distance * bend
  return [{ x: start.x + dx / 3 + ox, y: start.y + dy / 3 + oy }, { x: start.x + 2 * dx / 3 + ox, y: start.y + 2 * dy / 3 + oy }]
}
export function curvePoints(start: Point, end: Point, sideways = false): Point[] {
  const [a, b] = curveControls(start, end, sideways)
  return Array.from({ length: 25 }, (_, index) => {
    const t = index / 24, u = 1 - t
    return { x: u ** 3 * start.x + 3 * u ** 2 * t * a.x + 3 * u * t ** 2 * b.x + t ** 3 * end.x, y: u ** 3 * start.y + 3 * u ** 2 * t * a.y + 3 * u * t ** 2 * b.y + t ** 3 * end.y }
  })
}
const overlaps = (a: Rect, b: Rect, gap = 35) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y
const inside = (point: Point, rect: Rect) => point.x > rect.x - 12 && point.x < rect.x + rect.w + 12 && point.y > rect.y - 12 && point.y < rect.y + rect.h + 12
function crossing(a: Point, b: Point, c: Point, d: Point) {
  const side = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
}
/** Score nearby open positions without moving existing cards. Curves and node crossings matter more than distance. */
export function placeNear(sources: Rect[], size: { w: number; h: number }, occupied: Rect[], connections: Point[][], origin: Point = { x: 0, y: 0 }, inputFractions: readonly number[] = []): Point {
  const first = sources[0]
  const center = first ? { x: sources.reduce((sum, source) => sum + source.x + source.w / 2, 0) / sources.length, y: Math.max(...sources.map(source => source.y + source.h)) } : origin
  if (!first) {
    const candidate = { id: '', x: center.x - size.w / 2, y: center.y - size.h / 2, ...size }
    if (!occupied.some(rect => overlaps(candidate, rect)) && !connections.some(path => path.some(point => inside(point, candidate)))) return { x: candidate.x, y: candidate.y }
  }
  let best: { point: Point; score: number } | undefined
  for (let ring = 1; ring <= Math.max(6, Math.ceil(Math.sqrt(occupied.length)) + 3); ring++) {
    for (let step = 0; step < 20; step++) {
      const angle = Math.PI * 2 * step / 20 + Math.PI / 10
      const candidate: Rect = { id: '', x: center.x + Math.cos(angle) * ring * 370 - size.w / 2, y: center.y + Math.sin(angle) * ring * 260 - size.h / 2, ...size }
      if (occupied.some(rect => overlaps(candidate, rect))) continue
      let score = Math.hypot(candidate.x + size.w / 2 - center.x, candidate.y - center.y)
      // Prefer lower diagonal growth, but consider other free space before stretching across the board.
      if (candidate.y < center.y) score += 160
      for (const path of connections) if (path.some(point => inside(point, candidate))) score += 18_000
      for (const [sourceIndex, source] of sources.entries()) {
        const path = curvePoints({ x: source.x + source.w / 2, y: source.y + source.h }, { x: candidate.x + size.w * (inputFractions[sourceIndex] ?? 0.5), y: candidate.y })
        for (const rect of occupied) {
          const ownSource = rect.id === source.id
          const intersects = ownSource
            ? path.slice(1).some(point => point.x > rect.x + 3 && point.x < rect.x + rect.w - 3 && point.y > rect.y + 3 && point.y < rect.y + rect.h - 3)
            : path.some(point => inside(point, rect))
          if (intersects) score += ownSource ? 80_000 : 20_000
        }
        // Top input ports must be approached from outside, not through the destination body.
        if (path.slice(0, -1).some(point => point.x > candidate.x + 3 && point.x < candidate.x + candidate.w - 3 && point.y > candidate.y + 3 && point.y < candidate.y + candidate.h - 3)) score += 80_000
        for (let i = 1; i < path.length; i++) {
          const a = path[i - 1], b = path[i]
          if (!a || !b) continue
          for (const existing of connections) for (let j = 1; j < existing.length; j++) {
            const c = existing[j - 1], d = existing[j]
            if (c && d && crossing(a, b, c, d)) score += 800
          }
        }
      }
      if (!best || score < best.score) best = { point: { x: candidate.x, y: candidate.y }, score }
    }
    if (best && best.score < ring * 260) break
  }
  return best?.point ?? { x: Math.max(...occupied.map(rect => rect.x + rect.w), center.x) + 80, y: center.y + 80 }
}
