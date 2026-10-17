/**
 * 读取 CSS 自定义属性里的**时间**值并换算成毫秒。
 *
 * 坑：getPropertyValue('--dur-med') 返回的是 CSS 时间字面量（如 ".34s"），
 * parseFloat 会得到 0.34 —— 那是「秒」，不是 340。直接当毫秒用会让定时器
 * 提前两个数量级触发（动画被腰斩）。这里显式识别 s / ms 单位。
 */
export function cssTimeMs(name: string, fallbackMs: number): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallbackMs
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!raw) return fallbackMs
  const n = parseFloat(raw)
  if (!Number.isFinite(n) || n < 0) return fallbackMs
  // 无单位时按毫秒理解（与 CSS 自定义属性常见的写法一致）
  if (/ms$/i.test(raw)) return n
  if (/s$/i.test(raw)) return n * 1000
  return n
}

/** 是否处于「减弱动效」偏好 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
