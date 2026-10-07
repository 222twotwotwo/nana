let _dbP: Promise<IDBDatabase> | null = null

const STORES: Array<[string, string]> = [['books', 'id'], ['music', 'id'], ['analyses', 'key']]

export function idb(): Promise<IDBDatabase> {
  if (_dbP) return _dbP
  _dbP = new Promise((res, rej) => {
    const r = indexedDB.open('novel-reader', 1)
    r.onupgradeneeded = () => {
      const db = r.result
      for (const [name, keyPath] of STORES)
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath })
    }
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  return _dbP
}

export async function dbPut(store: string, val: any) {
  const db = await idb()
  return new Promise<void>((res, rej) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(val)
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
  })
}

export async function dbGet<T = any>(store: string, key: string): Promise<T | undefined> {
  const db = await idb()
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly')
    const rq = tx.objectStore(store).get(key)
    rq.onsuccess = () => res(rq.result)
    rq.onerror = () => rej(rq.error)
  })
}

export async function dbDel(store: string, key: string) {
  const db = await idb()
  return new Promise<void>((res, rej) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).delete(key)
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
  })
}

export async function dbAll<T = any>(store: string): Promise<T[]> {
  const db = await idb()
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly')
    const rq = tx.objectStore(store).getAll()
    rq.onsuccess = () => res(rq.result || [])
    rq.onerror = () => rej(rq.error)
  })
}

export async function deleteDatabase() {
  const db = await idb().catch(() => null)
  db?.close()
  _dbP = null
  return new Promise<void>(res => {
    const deletion = indexedDB.deleteDatabase('novel-reader')
    deletion.onblocked = () => res()
    deletion.onsuccess = () => res()
    deletion.onerror = () => res()
  })
}

export const anaKey = (bookId: string, chIdx: number) => bookId + ':' + chIdx
