export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
export const fmtTime = (s: number) => {
  s = Math.max(0, Math.round(s || 0))
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}
export function hashHue(str: unknown) {
  let h = 0
  for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % 360
}
export const hashGrad = (str: unknown) =>
  `linear-gradient(160deg, hsl(${hashHue(str)},34%,46%), hsl(${(hashHue(str) + 40) % 360},42%,26%))`
