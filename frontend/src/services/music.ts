import { reactive } from 'vue'
import { dbAll, dbPut } from './idb'
import { player } from './audio'
import { getProgress, saveMediaProgress } from './settings'
import { api } from './server'
import { uid } from '../utils'
import { useAppStore } from '../stores/app'
import { useLibStore } from '../stores/lib'
import type { MusicRecord } from '../types'

/** 全局共享的「当前选中曲目」（原 state.muSelected） */
export const musicState = reactive<{ muSelected: MusicRecord | null }>({ muSelected: null })

export function musicPageUrl(value?: string) {
  try {
    const u = new URL(value as string)
    return ['http:', 'https:'].includes(u.protocol) ? u.href : ''
  } catch { return '' }
}

export async function startMusic(music: MusicRecord, resume = true): Promise<boolean> {
  const request = ++player.playRequest
  player.ensureCtx()
  const progress = getProgress()[music.id]
  const same = player.currentId === music.id
  if (!same && music.source && (music.sourceUrl || music.audio)) {
    const d = (await api('/api/action', { source: music.source, action: 'play', value: music.sourceUrl || music.audio })).data
    if (request !== player.playRequest) return false
    music = { ...music, preview: !!d.preview, duration: Number(d.duration || music.duration || 0), size: Number(d.size || music.size || 0) }
    await dbPut('music', music)
    if (request !== player.playRequest) return false
  }
  musicState.muSelected = music
  useAppStore().showPage('music')
  const played = await player.crossfadeTo(music)
  if (played) {
    const el = player.activeEl()
    const t = progress?.time ?? 0
    if (!resume) el.currentTime = 0
    else if (!same && t > 0 && t < el.duration) el.currentTime = t
    saveMediaProgress(music.id, 0, el)
  }
  return played
}

export async function neighborMusic(dir: number): Promise<MusicRecord | null> {
  const musics = await dbAll<MusicRecord>('music')
  musics.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
  if (!musics.length) { useAppStore().toast('音乐库为空'); return null }
  const cur = player.currentMusic || musicState.muSelected
  let i = musics.findIndex(m => cur && m.id === cur.id)
  i = i < 0 ? 0 : (i + dir + musics.length) % musics.length
  return musics[i]
}

export async function addMusicFile(file: File) {
  const music: any = { id: uid(), name: file.name.replace(/\.[^.]+$/, ''), size: file.size, tags: [], blob: file, addedAt: Date.now(), duration: 0 }
  await dbPut('music', music)
  const a = new Audio(URL.createObjectURL(file))
  a.addEventListener('loadedmetadata', async () => {
    music.duration = a.duration || 0
    URL.revokeObjectURL(a.src)
    await dbPut('music', music)
    useLibStore().bump()
  })
}

function encodeWav(buffer: AudioBuffer): Blob {
  const nCh = buffer.numberOfChannels, len = buffer.length, sr = buffer.sampleRate
  const bytes = 44 + len * nCh * 2
  const ab = new ArrayBuffer(bytes), v = new DataView(ab)
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  ws(0, 'RIFF'); v.setUint32(4, bytes - 8, true); ws(8, 'WAVE'); ws(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nCh, true)
  v.setUint32(24, sr, true); v.setUint32(28, sr * nCh * 2, true); v.setUint16(32, nCh * 2, true); v.setUint16(34, 16, true)
  ws(36, 'data'); v.setUint32(40, len * nCh * 2, true)
  const chans: Float32Array[] = []
  for (let c = 0; c < nCh; c++) chans.push(buffer.getChannelData(c))
  let off = 44
  for (let i = 0; i < len; i++) for (let c = 0; c < nCh; c++) {
    const s = Math.max(-1, Math.min(1, chans[c][i]))
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true); off += 2
  }
  return new Blob([ab], { type: 'audio/wav' })
}

export async function synthAmbience(kind: 'rain' | 'wave' | 'drone'): Promise<MusicRecord> {
  const sr = 44100, dur = 45
  const ctx = new OfflineAudioContext(2, sr * dur, sr)
  const len = sr * dur
  const buf = ctx.createBuffer(2, len, sr)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  }
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true
  const filt = ctx.createBiquadFilter()
  const g = ctx.createGain()
  let name = '', tag = ''
  if (kind === 'rain') { filt.type = 'lowpass'; filt.frequency.value = 2600; g.gain.value = 0.22; name = '夜雨'; tag = '平静' }
  if (kind === 'wave') { filt.type = 'lowpass'; filt.frequency.value = 650; g.gain.value = 0.05; name = '海浪'; tag = '温馨' }
  if (kind === 'drone') { filt.type = 'lowpass'; filt.frequency.value = 180; filt.Q.value = 1.2; g.gain.value = 0.5; name = '深渊低鸣'; tag = '紧张' }
  const lfo = ctx.createOscillator()
  const lfoG = ctx.createGain()
  if (kind === 'wave') { lfo.frequency.value = 0.1; lfoG.gain.value = 0.3 }
  else if (kind === 'drone') { lfo.frequency.value = 0.07; lfoG.gain.value = 0.12 }
  else { lfo.frequency.value = 0.2; lfoG.gain.value = 0.06 }
  lfo.connect(lfoG).connect(g.gain)
  src.connect(filt).connect(g).connect(ctx.destination)
  src.start(); lfo.start()
  const rendered = await ctx.startRendering()
  const blob = encodeWav(rendered)
  const music: any = { id: uid(), name, size: blob.size, tags: [tag], blob, addedAt: Date.now(), duration: dur }
  await dbPut('music', music)
  return music
}

/** 全局周期保存播放进度（原 music.js 的 setInterval） */
export function startMediaProgressTicker() {
  setInterval(() => {
    if (player.currentMusic && player.isPlaying()) saveMediaProgress(player.currentMusic.id, 0, player.activeEl())
  }, 1000)
}
