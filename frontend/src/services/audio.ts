import { settings, saveSettings } from './settings'
import { clamp } from '../utils'

type Listener = () => void

class Player {
  ctx: AudioContext | null = null
  ga: GainNode | null = null
  gb: GainNode | null = null
  a: HTMLAudioElement | null = null
  b: HTMLAudioElement | null = null
  active: 'a' | 'b' = 'a'
  currentId: string | null = null
  currentMusic: any = null
  playRequest = 0
  lastError = ''
  private listeners: Listener[] = []

  get fadeSec() { return settings.fadeSec }
  get volume() { return settings.volume }

  on(f: Listener) { this.listeners.push(f) }
  emit() { this.listeners.forEach(f => { try { f() } catch { /* noop */ } }) }

  ensureCtx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      this.a = new Audio(); this.b = new Audio()
      this.a.loop = true; this.b.loop = true
      for (const el of [this.a, this.b] as HTMLAudioElement[]) {
        el.addEventListener('error', () => {
          if (el === this.activeEl() && this.currentMusic) {
            this.lastError = '音频加载失败，请重试或打开原站'
            import('../stores/app').then(({ useAppStore }) => useAppStore().toast(this.lastError))
            this.emit()
          }
        })
        el.addEventListener('loadedmetadata', () => { if (el === this.activeEl()) this.emit() })
      }
      this.ga = this.ctx.createGain(); this.gb = this.ctx.createGain()
      this.ctx.createMediaElementSource(this.a).connect(this.ga).connect(this.ctx.destination)
      this.ctx.createMediaElementSource(this.b).connect(this.gb).connect(this.ctx.destination)
      this.ga.gain.value = 0; this.gb.gain.value = 0
    }
    if (this.ctx.state === 'suspended') this.ctx.resume()
  }

  activeEl(): HTMLAudioElement { return this.active === 'a' ? this.a! : this.b! }

  async crossfadeTo(music: any): Promise<boolean> {
    if (!music) return false
    if (music.id === this.currentId) {
      if (!this.isPlaying()) await this.togglePause()
      this.emit()
      return true
    }
    this.ensureCtx()
    const request = ++this.playRequest
    this.lastError = ''
    const inEl = this.active === 'a' ? this.b! : this.a!
    const inGn = this.active === 'a' ? this.gb! : this.ga!
    const outEl = this.active === 'a' ? this.a! : this.b!
    const outGn = this.active === 'a' ? this.ga! : this.gb!
    try {
      inEl.pause()
      if (inEl.src?.startsWith('blob:')) URL.revokeObjectURL(inEl.src)
      inGn.gain.cancelScheduledValues(this.ctx!.currentTime)
      inGn.gain.setValueAtTime(0, this.ctx!.currentTime)
      if (music.blob) {
        inEl.removeAttribute('crossorigin')
        inEl.src = URL.createObjectURL(music.blob)
      } else if (music.source && (music.sourceUrl || music.audio)) {
        inEl.removeAttribute('crossorigin')
        inEl.src = '/api/audio?' + new URLSearchParams({ source: music.source, url: music.sourceUrl || music.audio })
      } else if (music.audio) {
        inEl.crossOrigin = 'anonymous'
        inEl.src = music.audio
      } else throw new Error('曲目没有可播放地址')
      await inEl.play()
    } catch (e: any) {
      if (request !== this.playRequest) return false
      this.lastError = e.name === 'NotAllowedError' ? '请点击播放按钮允许浏览器播放音频' : '音频加载失败，请重试或打开原站'
      import('../stores/app').then(({ useAppStore }) => useAppStore().toast(this.lastError))
      this.emit()
      return false
    }
    if (request !== this.playRequest) return false
    const t = this.ctx!.currentTime
    const v = Math.max(this.volume, 0.0001)
    const F = this.fadeSec
    inGn.gain.cancelScheduledValues(t)
    inGn.gain.setValueAtTime(0.0001, t)
    inGn.gain.exponentialRampToValueAtTime(v, t + F)
    const cur = Math.max(outGn.gain.value, 0.0001)
    outGn.gain.cancelScheduledValues(t)
    outGn.gain.setValueAtTime(cur, t)
    outGn.gain.exponentialRampToValueAtTime(0.0001, t + F)
    const oldUrl = outEl.src
    setTimeout(() => {
      if (outEl !== this.activeEl() && outEl.src === oldUrl) {
        outEl.pause()
        try { URL.revokeObjectURL(oldUrl) } catch { /* noop */ }
      }
    }, F * 1000 + 400)
    this.active = this.active === 'a' ? 'b' : 'a'
    this.currentId = music.id
    this.currentMusic = music
    this.emit()
    return true
  }

  setVolume(v: number) {
    saveSettings({ volume: v })
    if (!this.ctx) return
    const gn = this.active === 'a' ? this.ga! : this.gb!
    const t = this.ctx.currentTime
    gn.gain.cancelScheduledValues(t)
    gn.gain.setValueAtTime(Math.max(gn.gain.value, 0.0001), t)
    gn.gain.exponentialRampToValueAtTime(Math.max(v, 0.0001), t + 0.15)
  }

  fadeStop() {
    const request = ++this.playRequest
    if (!this.ctx) return
    const el = this.activeEl()
    const gn = this.active === 'a' ? this.ga! : this.gb!
    const t = this.ctx.currentTime
    const cur = Math.max(gn.gain.value, 0.0001)
    gn.gain.cancelScheduledValues(t)
    gn.gain.setValueAtTime(cur, t)
    gn.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(this.fadeSec, 2))
    const url = el.src
    setTimeout(() => {
      if (request === this.playRequest && el.src === url) {
        el.pause()
        try { URL.revokeObjectURL(url) } catch { /* noop */ }
      }
    }, 2400)
    this.currentId = null
    this.currentMusic = null
    this.emit()
  }

  isPlaying(): boolean {
    const el = this.activeEl()
    return !!(this.ctx && el.src && !el.paused)
  }

  async togglePause(): Promise<'playing' | 'paused' | null> {
    if (!this.ctx) return null
    const el = this.activeEl()
    if (!el.src) return null
    let r: 'playing' | 'paused' | null = null
    if (el.paused) {
      try { await el.play(); this.lastError = ''; r = 'playing' }
      catch {
        this.lastError = '播放失败，请重试或打开原站'
        import('../stores/app').then(({ useAppStore }) => useAppStore().toast(this.lastError))
      }
    } else { el.pause(); r = 'paused' }
    this.emit()
    return r
  }

  seek(frac: number) {
    const el = this.activeEl()
    if (this.ctx && el.src && el.duration) el.currentTime = clamp(frac, 0, 1) * el.duration
  }
}

export const player = new Player()
