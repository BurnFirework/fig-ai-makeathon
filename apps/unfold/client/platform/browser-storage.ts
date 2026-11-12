import { parseWorkspace, type Workspace } from '../../shared/workspace-format'

const DB_NAME = 'unfold-workspaces-v1'
const STORE = 'workspaces'
const KEY = 'current'

function connect(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Browser storage is unavailable.'))
    request.onblocked = () => reject(new Error('Close older Unfold tabs to upgrade browser storage.'))
  })
}
export async function readBrowserWorkspace(): Promise<Workspace | null> {
  const db = await connect()
  try {
    return await new Promise<Workspace | null>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(KEY)
      request.onsuccess = () => { try { resolve(request.result === undefined ? null : parseWorkspace(request.result)) } catch (error) { reject(error instanceof Error ? error : new Error('Saved workspace is invalid.')) } }
      request.onerror = () => reject(request.error ?? new Error('Could not read browser storage.'))
    })
  } finally { db.close() }
}
export async function commitBrowserWorkspace(workspace: Workspace, expected: { id: string; revision: number } | null): Promise<void> {
  const db = await connect()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite')
      const store = transaction.objectStore(STORE)
      const request = store.get(KEY)
      let failure: Error | null = null
      request.onsuccess = () => {
        try {
        const previous = request.result === undefined ? undefined : parseWorkspace(request.result)
        if ((expected === null && previous !== undefined) || (expected !== null && (!previous || previous.id !== expected.id || previous.revision !== expected.revision))) {
          failure = new Error('This workspace changed in another tab. Export your changes, then reload to continue safely.')
          transaction.abort()
          return
        }
        store.put(workspace, KEY)
        } catch (error) { failure = error instanceof Error ? error : new Error('Saved workspace is invalid.'); transaction.abort() }
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(failure ?? transaction.error ?? new Error('Could not save your workspace. Export a backup before closing.'))
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Could not save your workspace. Export a backup before closing.'))
    })
  } finally { db.close() }
}
