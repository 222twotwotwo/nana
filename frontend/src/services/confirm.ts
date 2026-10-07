import { ref } from 'vue'

/**
 * 应用内确认弹窗：替代浏览器原生 confirm()，与 App 美术风格统一。
 * confirmDialog() 返回 Promise，resolve(true)=确认、resolve(false)=取消。
 */
export interface ConfirmOptions {
  title?: string
  message: string
  okText?: string
  cancelText?: string
  /** 危险操作：确认键显示为实心红色 */
  danger?: boolean
}

type Pending = { opts: ConfirmOptions; resolve: (v: boolean) => void }

const pending = ref<Pending | null>(null)

/** 弹出确认框；同一时间只保留一个，新弹窗会把未决的旧弹窗按取消处理 */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  if (pending.value) pending.value.resolve(false)
  return new Promise(resolve => { pending.value = { opts, resolve } })
}

/** 供 AppConfirm.vue 渲染读取 */
export function confirmPending() { return pending.value }

/** 结束当前弹窗；无弹窗时调用无副作用 */
export function settleConfirm(v: boolean) {
  const p = pending.value
  if (!p) return
  pending.value = null
  p.resolve(v)
}
