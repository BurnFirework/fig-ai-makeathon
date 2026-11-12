export const exploreConcurrency = () => Math.max(1, Math.min(8, Math.trunc(Number(process.env.UNFOLD_EXPLORE_CONCURRENCY)) || 3))

type Waiting = { background: boolean; start: () => void }
const waiting: Waiting[] = []
let running = 0
let backgroundRunning = 0

function drain() {
  const limit = exploreConcurrency()
  while (running < limit + 1) {
    let index = waiting.findIndex(call => !call.background)
    if (index < 0 && backgroundRunning < limit) index = waiting.findIndex(call => call.background)
    if (index < 0) return
    waiting.splice(index, 1)[0]?.start()
  }
}

export function acquireCli(signal: AbortSignal, background: boolean): Promise<() => void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const call: Waiting = { background, start() {
      signal.removeEventListener('abort', cancel)
      running++
      if (background) backgroundRunning++
      resolve(() => {
        running--
        if (background) backgroundRunning--
        drain()
      })
    } }
    function cancel() {
      const index = waiting.indexOf(call)
      if (index >= 0) waiting.splice(index, 1)
      const reason: unknown = signal.reason
      reject(reason instanceof Error ? reason : new Error('Stopped.'))
      drain()
    }
    waiting.push(call)
    signal.addEventListener('abort', cancel, { once: true })
    drain()
  })
}
