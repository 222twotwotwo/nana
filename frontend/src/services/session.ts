import type { PageId } from '../types'

/** 刷新后用于恢复的位置信息：停留在哪个页面、阅读哪本书、第几章 */
export interface AppSession {
  page: PageId
  bookId?: string
  chIdx?: number
}

const KEY = 'nr-session'

export function saveSession(session: AppSession) {
  try { localStorage.setItem(KEY, JSON.stringify(session)) } catch { /* 隐私模式等场景忽略 */ }
}

export function loadSession(): AppSession | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || typeof parsed.page !== 'string') return null
    return parsed as AppSession
  } catch { return null }
}

export function clearSession() {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}
