import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { Ref, WatchSource } from 'vue'
import { cssTimeMs, prefersReducedMotion } from './cssTime'

/**
 * 分段控件的滑动高亮 —— iOS 分段控件的做法：高亮块不是「换一个按钮加底色」，
 * 而是同一块底在按钮之间滑过去。
 *
 * 关键约束（实测得出，见 docs/motion.md「滑动指示器」一节）：
 * 只要把「激活底色」从按钮自身挪到另一个元素上，Chrome 就会放弃次像素
 * （LCD）抗锯齿、改用灰度抗锯齿，静止态文字渲染随之改变。
 * position:relative / z-index / isolation 都不是原因，底色由谁绘制才是。
 *
 * 因此这里做成**瞬时指示器**：
 *   - 静止态：完全没有指示器，底色仍由按钮自己的 .on 绘制 → 与原版逐像素一致
 *   - 滑动中：容器挂 .pill-active，两个按钮的底色交给指示器，
 *             指示器从旧位置滑到新位置
 *   - 滑动结束：移除 .pill-active 并隐藏指示器，底色回到按钮身上
 * 交接瞬间指示器与按钮底色同色、同位置、同圆角，因此看不出切换。
 */
export function useSlidingPill(
  containerRef: Ref<HTMLElement | null>,
  activeSelector = '.on',
  pillClass = 'seg-pill',
  /** 触发滑动的响应式来源：激活项由数据决定时必须传入 */
  source: WatchSource
) {
  const pill = ref<HTMLElement | null>(null)
  /** 滑动进行中：容器加 .pill-active，底色交给指示器 */
  const sliding = ref(false)
  /** 给容器的动态 class */
  const pillActiveClass = 'pill-active'

  let settle: ReturnType<typeof setTimeout> | null = null
  let raf = 0

  const reduced = prefersReducedMotion

  /** 读取令牌时长，保证 JS 与样式表一致（注意 .34s → 340ms 的换算） */
  const duration = () => cssTimeMs('--dur-med', 340)

  /** 相对容器内边距盒的矩形（绝对定位的 left/top 以此为原点） */
  function rectOf(el: HTMLElement) {
    const box = containerRef.value
    if (!box) return null
    const b = box.getBoundingClientRect()
    const a = el.getBoundingClientRect()
    if (!a.width || !a.height) return null
    // getBoundingClientRect 给的是边框盒，容器有 1px 边框，必须减掉
    return {
      x: a.left - b.left - box.clientLeft,
      y: a.top - b.top - box.clientTop,
      w: a.width,
      h: a.height
    }
  }

  /** 把指示器摆到指定矩形；animate=false 时不做过渡 */
  function place(r: { x: number; y: number; w: number; h: number }, animate: boolean) {
    const el = pill.value
    if (!el) return
    if (!animate) el.style.transition = 'none'
    el.style.width = r.w + 'px'
    el.style.height = r.h + 'px'
    el.style.transform = `translate3d(${r.x}px, ${r.y}px, 0)`
    if (!animate) {
      void el.offsetWidth       // 让「无过渡」的定位立即生效
      el.style.transition = ''
    }
  }

  /** 结束滑动：底色交还给按钮 */
  function stop() {
    if (settle) { clearTimeout(settle); settle = null }
    if (raf) { cancelAnimationFrame(raf); raf = 0 }
    sliding.value = false
  }

  onBeforeUnmount(stop)

  /**
   * flush:'pre' 的 watch 在组件重渲染**之前**触发，此刻 DOM 还是旧状态，
   * 正好用来读取「旧激活项」的位置；await nextTick() 之后 DOM 已更新，
   * 再读「新激活项」的位置即可算出滑动轨迹。
   */
  watch(source, async () => {
    const box = containerRef.value
    if (!box) return
    // 旧位置：当前仍是激活态的那个按钮（DOM 尚未更新）
    const prevEl = box.querySelector<HTMLElement>(activeSelector)
    const prevRect = prevEl ? rectOf(prevEl) : null

    await nextTick()

    const el = pill.value
    if (!el) return
    const nextEl = containerRef.value?.querySelector<HTMLElement>(activeSelector)
    const nextRect = nextEl ? rectOf(nextEl) : null

    // 没有目标（例如分类条被隐藏）或位置没变：直接收尾，不播动画
    if (!nextRect || !prevRect || (prevRect.x === nextRect.x && prevRect.y === nextRect.y
      && prevRect.w === nextRect.w && prevRect.h === nextRect.h)) {
      stop()
      return
    }
    if (reduced()) { stop(); return }

    // 上一次滑动还没结束：从指示器当前所在位置续上，避免跳变
    const from = sliding.value && el.style.width ? {
      x: new DOMMatrixReadOnly(getComputedStyle(el).transform).m41,
      y: new DOMMatrixReadOnly(getComputedStyle(el).transform).m42,
      w: parseFloat(el.style.width) || prevRect.w,
      h: parseFloat(el.style.height) || prevRect.h
    } : prevRect

    sliding.value = true
    place(from, false)
    if (settle) clearTimeout(settle)
    raf = requestAnimationFrame(() => {
      raf = 0
      place(nextRect, true)
      settle = setTimeout(stop, duration() + 60)
    })
  }, { flush: 'pre' })

  return { pill, pillClass, pillActiveClass, sliding }
}
