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

/**
 * 删除整个数据库。其它标签页仍持有连接时浏览器会阻塞删除，
 * 此时以 `'blocked'` 结束（而不是假装成功），由调用方提示用户。
 */
export async function deleteDatabase(): Promise<'success' | 'blocked' | 'error'> {
  const db = await idb().catch(() => null)
  db?.close()
  _dbP = null
  return new Promise(resolve => {
    const deletion = indexedDB.deleteDatabase('novel-reader')
    deletion.onblocked = () => resolve('blocked')
    deletion.onsuccess = () => resolve('success')
    deletion.onerror = () => resolve('error')
  })
}

export const anaKey = (bookId: string, chIdx: number) => bookId + ':' + chIdx
