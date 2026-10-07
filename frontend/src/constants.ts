export const EMOTIONS: Array<{ label: string; color: string }> = [
  { label: '平静', color: '#4a9c9c' },
  { label: '温馨', color: '#d98a4a' },
  { label: '悲伤', color: '#5b7fbf' },
  { label: '紧张', color: '#c05050' },
  { label: '激昂', color: '#d07a1f' },
  { label: '诡异', color: '#7a5bb0' },
  { label: '欢快', color: '#c9a13b' },
  { label: '史诗', color: '#4a5e9e' }
]

export const emoColor = (l: string) => {
  const e = EMOTIONS.find(x => x.label === l)
  return e ? e.color : '#8a8a8a'
}
export const EMO_LABELS = EMOTIONS.map(e => e.label)

export const CONTENT_TYPES = {
  novel: { label: '小说', unit: '本', part: '章', verb: '阅读', placeholder: '搜索书名、作者或关键词' },
  comic: { label: '漫画', unit: '部', part: '话', verb: '阅读', placeholder: '搜索漫画名称或关键词' },
  music: { label: '音乐', unit: '首', part: '', verb: '播放', placeholder: '搜索歌曲、歌手或配乐' },
  anime: { label: '番剧', unit: '部', part: '集', verb: '播放', placeholder: '搜索番剧名称或关键词' }
} as const

