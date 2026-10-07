import { dbGet, dbPut, anaKey } from './idb'
import { settings } from './settings'
import { EMOTIONS, EMO_LABELS } from '../constants'
import { clamp } from '../utils'
import { ensureChapterText } from './chapters'
import type { EmotionNode } from '../types'

export async function callLLM(messages: Array<{ role: string; content: string }>, maxTokens: number): Promise<string> {
  const s = settings
  if (!s.apiBase || !s.model) throw new Error('请先在「设置」中填写模型 API 地址与模型名')
  let base = s.apiBase.trim().replace(/\/+$/, '')
  if (!/\/chat\/completions$/.test(base)) base += '/chat/completions'
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (s.apiKey) headers['Authorization'] = 'Bearer ' + s.apiKey
  const res = await fetch(base, {
    method: 'POST', headers,
    body: JSON.stringify({ model: s.model, messages, temperature: 0.2, max_tokens: maxTokens })
  })
  if (!res.ok) throw new Error('API ' + res.status + '：' + (await res.text()).slice(0, 180))
  const data = await res.json()
  const c = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
  if (!c) throw new Error('模型未返回内容')
  return c
}

export function normEmotion(e: unknown) {
  e = String(e || '').trim()
  const hit = EMOTIONS.find(x => x.label === e) ||
    EMOTIONS.find(x => (e as string).includes(x.label) || x.label.includes(e as string))
  return hit ? hit.label : e as string
}

export function parseNodes(raw: string): EmotionNode[] {
  let t = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim()
  const i = t.indexOf('['), j = t.lastIndexOf(']')
  if (i >= 0 && j > i) t = t.slice(i, j + 1)
  const arr = JSON.parse(t)
  if (!Array.isArray(arr)) throw new Error('返回的不是数组')
  let nodes: EmotionNode[] = arr.map((n: any) => ({
    at: clamp(Math.round(+n.at || 0), 0, 100),
    emotion: normEmotion(n.emotion),
    note: String(n.note || '').trim().slice(0, 30)
  })).filter(n => n.emotion)
  nodes.sort((a, b) => a.at - b.at)
  if (nodes.length && nodes[0].at > 2) nodes.unshift({ at: 0, emotion: nodes[0].emotion, note: '起始' })
  if (!nodes.length) throw new Error('无有效节点')
  return nodes
}

export async function analyzeChapter(bookId: string, chIdx: number): Promise<EmotionNode[]> {
  const book = await dbGet('books', bookId)
  await ensureChapterText(book, chIdx)
  const ch = book.chapters[chIdx]
  const MAXC = 6000
  const text = ch.text.length > MAXC ? ch.text.slice(0, MAXC) + '\n（后文截断）' : ch.text
  const user =
`请分析这章小说的情绪走向，用于自动配乐。

可选情绪标签（必须从此列表中选择）：${EMO_LABELS.join('、')}

章节《${ch.title}》：
${text}

输出要求：JSON 数组，包含 3-6 个情绪节点，按文本进度排列：
[{"at": 0-100 整数, "emotion": "标签", "note": "不超过15字的情绪说明"}]
第一个节点 at 必须为 0。只输出 JSON 数组，不要输出其他任何内容。`
  const raw = await callLLM([
    { role: 'system', content: '你是专业的小说配乐导演，擅长把文字情绪转化为音乐节点。只输出 JSON。' },
    { role: 'user', content: user }
  ], 700)
  const nodes = parseNodes(raw)
  await dbPut('analyses', { key: anaKey(bookId, chIdx), bookId, chIdx, nodes, ts: Date.now() })
  return nodes
}
