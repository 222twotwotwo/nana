import { reactive } from 'vue'

export const DEF_SET = {
  apiBase: '', apiKey: '', model: '',
  fadeSec: 4, volume: 0.75, theme: 'light', fontSize: 20, viewMode: 'grid'
}
export type Settings = typeof DEF_SET

function load(): Partial<Settings> {
  try { return JSON.parse(localStorage.getItem('nr-settings') || '{}') } catch { return {} }
}

export const settings = reactive<Settings>({ ...DEF_SET, ...load() })

export function saveSettings(patch: Partial<Settings>) {
  Object.assign(settings, patch)
  localStorage.setItem('nr-settings', JSON.stringify({ ...settings }))
}

export function getMapping(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem('nr-mapping') || '{}') } catch { return {} }
}
export function saveMapping(m: Record<string, string>) {
  localStorage.setItem('nr-mapping', JSON.stringify(m))
}

export interface ProgressEntry { chIdx: number; pct: number; ts: number; time?: number }
export function getProgress(): Record<string, ProgressEntry> {
  try { return JSON.parse(localStorage.getItem('nr-progress') || '{}') } catch { return {} }
}
export function saveProgressRaw(p: Record<string, ProgressEntry>) {
  localStorage.setItem('nr-progress', JSON.stringify(p))
}
export function saveProgress(bookId: string, chIdx: number, pct: number) {
  const p = getProgress()
  p[bookId] = { chIdx, pct, ts: Date.now() }
  saveProgressRaw(p)
}
export function saveMediaProgress(id: string, chIdx: number, media: { duration?: number; currentTime?: number }) {
  const duration = media.duration
  if (!Number.isFinite(duration) || (duration as number) <= 0) return
  const progress = getProgress()
  progress[id] = { chIdx, pct: (media.currentTime || 0) / (duration as number) * 100, time: media.currentTime || 0, ts: Date.now() }
  saveProgressRaw(progress)
}
export function clearProgress(id: string) {
  const progress = getProgress()
  delete progress[id]
  saveProgressRaw(progress)
}
