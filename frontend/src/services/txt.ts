import { dbAll, dbPut } from './idb'
import { uid } from '../utils'
import { useAppStore } from '../stores/app'
import { useLibStore } from '../stores/lib'
import type { BookRecord, Chapter } from '../types'

export function splitChapters(raw: string): Chapter[] {
  const text = raw.replace(/\r\n?/g, '\n')
  const re = /^[ \t]*(第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章回节卷集部幕][^\n]{0,50}|序章|序言|楔子|引子|尾声|终章|番外[^\n]{0,30})[ \t]*$/gim
  const marks: Array<{ i: number; title: string }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) marks.push({ i: m.index, title: m[0].trim() })
  const chapters: Chapter[] = []
  if (marks.length >= 2) {
    const pre = text.slice(0, marks[0].i).trim()
    if (pre) chapters.push({ title: '开篇', text: pre })
    marks.forEach((mk, k) => {
      const end = k + 1 < marks.length ? marks[k + 1].i : text.length
      const body = text.slice(mk.i, end).replace(/^[^\n]*\n/, '').trim()
      chapters.push({ title: mk.title, text: body })
    })
  } else {
    const paras = text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean)
    let buf: string[] = [], cnt = 0, idx = 1
    for (const p of paras) {
      buf.push(p); cnt += p.length
      if (cnt >= 4000) { chapters.push({ title: '片段 ' + idx, text: buf.join('\n\n') }); buf = []; cnt = 0; idx++ }
    }
    if (buf.length) chapters.push({ title: '片段 ' + idx, text: buf.join('\n\n') })
  }
  return chapters
}

export async function importTxtFile(file: File) {
  let text: string
  const buf = await file.arrayBuffer()
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf) }
  catch { text = new TextDecoder('gb18030').decode(buf) }
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  const chapters = splitChapters(text)
  if (!chapters.length) { useAppStore().toast('未能从文件解析出内容'); return }
  const book: BookRecord = {
    id: uid(),
    title: file.name.replace(/\.txt$/i, ''),
    addedAt: Date.now(),
    charCount: text.length,
    chapters
  }
  await dbPut('books', book)
  useAppStore().toast(`已导入《${book.title}》共 ${chapters.length} 章`)
  useLibStore().bump()
}

export async function ensureSampleBook() {
  const books = await dbAll('books')
  if (books.length) return
  const { SAMPLE_BOOK } = await import('../constants')
  await dbPut('books', {
    id: 'sample', title: SAMPLE_BOOK.title, addedAt: Date.now(),
    charCount: SAMPLE_BOOK.chapters.reduce((n, c) => n + c.text!.length, 0),
    chapters: SAMPLE_BOOK.chapters
  })
}
