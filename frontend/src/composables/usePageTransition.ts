import { computed, onBeforeUnmount, reactive, watch } from 'vue'
import type { PageId } from '../types'
import { cssTimeMs, prefersReducedMotion } from './cssTime'

/**
 * 页面切换动画状态机。
 *
 * 背景：App.vue 始终渲染全部页面，用 .hidden（display:none）切换。这样切换是
 * 瞬时的，滚动位置与已加载数据得以保留。要在不改变这套结构的前提下加动画，
 * 就必须在切换的**一个渲染周期内**让「离场页」与「入场页」同时可见：
 *
 *   1. 页面变化（watch 默认 pre-flush，在重渲染之前触发）
 *      → 记录 from/to/direction，标记 running，phase='from'
 *   2. 重渲染：离场页去掉 hidden 并临时绝对定位（脱离文档流，
 *      因此不影响入场页占据 main 的 flex 槽位）；两者都处于 from 态
 *   3. rAF 中强制一次样式读取，再把 phase 切到 'to' → CSS 过渡启动
 *   4. 过渡结束：清除所有标记，离场页重新 hidden，入场页回到自然态
 *
 * 静止态（非切换期）入场页不带任何定位/过渡类，几何与原版完全一致。
 */

export type TransitionDirection = 'forward' | 'back' | 'lateral'

/**
 * 页面层级：数字越大越「深」。
 * 前进 = 走向更深的层级（库墙 → 阅读页），后退 = 返回更浅的层级。
 */
const LEVEL: Record<PageId, number> = {
  home: 0,
  library: 0,
  settings: 1,
  cine: 1,
  reader: 2,
  music: 2,
  anime: 2
}

export function directionFor(from: PageId, to: PageId): TransitionDirection {
  const a = LEVEL[from] ?? 0
  const b = LEVEL[to] ?? 0
  if (b > a) return 'forward'
  if (b < a) return 'back'
  return 'lateral'
}

/** 从 CSS 令牌读取时长，保证 JS 与样式表始终一致（reduced-motion 下会被压到 1ms） */
function readDuration(name: string, fallback: number): number {
  return cssTimeMs(name, fallback)
}

export interface PageTransitionState {
  running: boolean
  from: PageId | null
  to: PageId | null
  direction: TransitionDirection
  /** 'from' = 已就位但未启动；'to' = 过渡进行中 */
  phase: 'from' | 'to'
}

export function usePageTransition(current: () => PageId) {
  const state = reactive<PageTransitionState>({
    running: false, from: null, to: null, direction: 'lateral', phase: 'from'
  })

  let timer: ReturnType<typeof setTimeout> | null = null
  let raf = 0

  /** 立即结束当前动画并清理：用于动画进行中又发生新跳转的情况 */
  function finish() {
    if (timer) { clearTimeout(timer); timer = null }
    if (raf) { cancelAnimationFrame(raf); raf = 0 }
    state.running = false
    state.from = null
    state.to = null
    state.phase = 'from'
  }

  function start(from: PageId, to: PageId) {
    finish()
    if (from === to) return
    state.from = from
    state.to = to
    state.direction = directionFor(from, to)
    state.phase = 'from'
    state.running = true

    // 后台标签页里 rAF 被节流，会卡在 from 态（元素保持透明）；此时直接跳过动画
    if (typeof document !== 'undefined' && document.hidden) { finish(); return }
    if (prefersReducedMotion()) { finish(); return }

    raf = requestAnimationFrame(() => {
      raf = 0
      // 强制一次样式读取，确保 from 态已被浏览器采纳，过渡才会真正运行
      void document.body.offsetHeight
      state.phase = 'to'
      timer = setTimeout(finish, readDuration('--dur-slow', 460) + 80)
    })
  }

  /** 监听页面变化；组件卸载时自动清理 */
  function watchPage() {
    const stop = watch(current, (to, from) => {
      if (!from || from === to) return
      start(from, to)
    })
    onBeforeUnmount(() => { stop(); finish() })
    return stop
  }

  /** 某个页面根节点应带的 class */
  function pageClass(id: PageId): string[] {
    if (state.running) {
      if (id === state.to) return ['pg-entering', 'pg-' + state.direction, 'pg-' + state.phase]
      if (id === state.from) return ['pg-leaving', 'pg-' + state.direction, 'pg-' + state.phase]
      return ['hidden']
    }
    return id === current() ? [] : ['hidden']
  }

  return {
    state,
    pageClass,
    start,
    finish,
    watchPage,
    running: computed(() => state.running)
  }
}
