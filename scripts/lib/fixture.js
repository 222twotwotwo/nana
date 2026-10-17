'use strict';
/**
 * 比对用的确定性数据夹具。
 *
 * 像素比对的前提是两版渲染**同一份数据**。旧版内置《示例 · 雾海行舟》，
 * 新版首次启动会去在线来源拉默认内容（结果随网络变化），直接用真实数据比对
 * 会把「数据不同」误判成「样式不同」。
 *
 * 因此这里清空 IndexedDB，写入一份固定的书/音乐，并把 localStorage 也固定下来
 * （含新版种子标记 nr-demo-seed=done，阻止其联网注入）。
 */

/** 固定书目：内联正文，避免比对时联网取章节 */
const BOOKS = [
  {
    id: 'fx-novel-1',
    title: '雾海行舟（示例）',
    author: '测试作者',
    type: 'novel',
    sourceName: '本地收藏',
    addedAt: 1700000000000,
    charCount: 0,
    chapters: [
      {
        title: '第一章 雾港启航',
        text: [
          '晨雾未散，青雀港像浸在一碗温开的牛奶里。',
          '沈舟把最后一桶淡水搬上「逐光号」，直起腰，听见甲板下传来妹妹阿螺试笛的声音——断断续续，像溪水绕过石头。',
          '「今天出港？」码头上，老舵手秦伯叼着旱烟，眯眼看天。',
          '「今天。」沈舟说，「雾散之前。」',
          '秦伯笑了笑，把烟锅在鞋底磕了磕：「雾海深处，看得清的人反而走得慢。你们这些急的，倒容易撞上运气。」',
          '缆绳解开的时候，海面平静得像一块熨过的蓝布。逐光号缓缓离开泊位，惊起两三只白鹭。'
        ].join('\n')
      },
      {
        title: '第二章 风暴与低吟',
        text: [
          '变故发生在第三天黄昏。',
          '先是海鸟成群地往回飞，接着，天边的云像被打翻的墨，一层层压下来。',
          '「收帆！」沈舟的吼声刚落，风就到了。',
          '逐光号像一片叶子被按进浪谷，又被抛上浪峰。阿螺死死抱住桅杆，指节发白。',
          '然后，他们听见了那个声音。从海底传来的、极低极缓的吟声，像一座山在梦中翻身。'
        ].join('\n')
      },
      {
        title: '第三章 灯火归港',
        text: [
          '半个月后，逐光号回到了青雀港。',
          '海蛟把他们送出雾海的那晚，天上的月亮大得离谱。',
          '阿螺站在船头，把那支曲子完整地吹了一遍。这一次，港里所有人都听见了。'
        ].join('\n')
      }
    ]
  },
  {
    id: 'fx-novel-2',
    title: '第二本书·山海拾遗',
    author: '另一位作者',
    type: 'novel',
    sourceName: '本地收藏',
    addedAt: 1690000000000,
    charCount: 0,
    chapters: [{ title: '第一章 拾遗', text: '山与海之间，有一本被遗忘的书。\n它记录着所有被潮水带走的名字。' }]
  }
];

/**
 * 音乐夹具：**带真实可播放音频**。
 * 验证播放/暂停/切歌这类行为时，曲目必须有可播放地址，否则
 * player.crossfadeTo 会抛「曲目没有可播放地址」，测出来的只是错误路径。
 * 音频在页面内用 Web Audio 之外的纯 JS 生成一段正弦波 WAV（无需网络）。
 * tone 用于区分曲目（便于断言「确实换了曲目」）。
 */
const MUSIC = [
  { id: 'fx-music-1', name: '夜雨', sourceName: '本地音乐', tags: ['平静'], duration: 2, addedAt: 1700000000000, tone: 440 },
  { id: 'fx-music-2', name: '海浪', sourceName: '本地音乐', tags: ['温馨'], duration: 2, addedAt: 1699000000000, tone: 523 },
  { id: 'fx-music-3', name: '深渊低鸣', sourceName: '本地音乐', tags: ['紧张'], duration: 2, addedAt: 1698000000000, tone: 330 }
];

/** 固定设置：避免主题/字号/视图差异干扰比对 */
const SETTINGS = {
  apiBase: '', apiKey: '', model: '',
  fadeSec: 4, volume: 0.75, theme: 'light', fontSize: 20, viewMode: 'grid'
};

/** 固定进度：让「继续阅读」区块稳定出现（时间戳也固定） */
const PROGRESS = {
  'fx-novel-1': { chIdx: 0, pct: 0, ts: 1700000000000 }
};

/**
 * 额外夹具（可选）：覆盖默认夹具没有的类型。
 *
 *   - `type` 缺省的书 → 情境配乐页（`filter(b => !b.type)`）要的就是这一类，
 *     默认夹具两本书都带 type:'novel'，所以情境配乐页在默认夹具下始终是空态，
 *     无法验证「节点编辑区展开」等交互动画。
 *   - `type:'anime'` 的书 → 番剧页。
 */
const EXTRA_BOOKS = [
  {
    id: 'fx-cine-book',
    title: '情境配乐示例·雾海行舟',
    author: '测试作者',
    sourceName: '本地收藏',
    addedAt: 1700500000000,
    charCount: 0,
    chapters: [
      { title: '第一卷 幼年期 序章', text: '晨雾未散，青雀港像浸在一碗温开的牛奶里。\n沈舟把最后一桶淡水搬上「逐光号」。' },
      { title: '第一卷 幼年期 第一话', text: '变故发生在第三天黄昏。\n先是海鸟成群地往回飞，接着，天边的云像被打翻的墨。' },
      { title: '第一卷 幼年期 第二话', text: '半个月后，逐光号回到了青雀港。\n阿螺站在船头，把那支曲子完整地吹了一遍。' }
    ]
  },
  {
    id: 'fx-anime-book',
    title: '示例番剧',
    source: 'original',
    sourceName: 'original',
    animeSourceMode: 'auto',
    type: 'anime',
    addedAt: 1700400000000,
    chapters: [
      { title: '第01集', url: 'https://example.invalid/anime/ep1' },
      { title: '第02集', url: 'https://example.invalid/anime/ep2' }
    ]
  }
];

/** 生成在页面里执行的安装脚本（幂等：先清空各 store 再写入） */
function installScript(extraBooks = EXTRA_BOOKS) {
  return `(async () => {
    const BOOKS = ${JSON.stringify(BOOKS)}.concat(${JSON.stringify(extraBooks)});
    const MUSIC = ${JSON.stringify(MUSIC)};
    const SETTINGS = ${JSON.stringify(SETTINGS)};
    const PROGRESS = ${JSON.stringify(PROGRESS)};

    // localStorage：固定设置/进度，并阻止新版联网注入默认内容
    localStorage.clear();
    localStorage.setItem('nr-settings', JSON.stringify(SETTINGS));
    localStorage.setItem('nr-progress', JSON.stringify(PROGRESS));
    localStorage.setItem('nr-mapping', '{}');
    localStorage.setItem('nr-demo-seed', 'done');

    const db = await new Promise((res, rej) => {
      const q = indexedDB.open('novel-reader', 1);
      q.onupgradeneeded = () => {
        const d = q.result;
        if (!d.objectStoreNames.contains('books')) d.createObjectStore('books', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('music')) d.createObjectStore('music', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('analyses')) d.createObjectStore('analyses', { keyPath: 'key' });
      };
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });

    for (const name of ['books', 'music', 'analyses']) {
      await new Promise((res, rej) => {
        const tx = db.transaction(name, 'readwrite');
        tx.objectStore(name).clear();
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    }
    for (const b of BOOKS) {
      // 番剧夹具的章节只有 url、没有 text，这里必须容错，
      // 否则整个夹具安装脚本会在装到番剧书时抛 TypeError。
      b.charCount = b.chapters.reduce((n, c) => n + (c.text || '').length, 0);
      await new Promise((res, rej) => {
        const tx = db.transaction('books', 'readwrite');
        tx.objectStore('books').put(b);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    }
    for (const m of MUSIC) {
      // 为每首曲目生成一段可播放的 WAV blob（正弦波），
      // 否则播放/暂停/切歌测试只会走到「没有可播放地址」的错误分支。
      const sr = 8000, secs = Math.min(2, m.duration || 2), n = sr * secs;
      const bytes = 44 + n * 2;
      const ab = new ArrayBuffer(bytes), v = new DataView(ab);
      const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      ws(0, 'RIFF'); v.setUint32(4, bytes - 8, true); ws(8, 'WAVE'); ws(12, 'fmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
      ws(36, 'data'); v.setUint32(40, n * 2, true);
      const freq = m.tone || 440;
      for (let i = 0; i < n; i++) {
        // 淡入淡出，避免起止爆音
        const env = Math.min(1, i / 200, (n - i) / 200);
        v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * freq * i / sr) * 12000 * env, true);
      }
      const rec = { ...m, duration: secs, size: bytes, blob: new Blob([ab], { type: 'audio/wav' }) };
      delete rec.tone;
      await new Promise((res, rej) => {
        const tx = db.transaction('music', 'readwrite');
        tx.objectStore('music').put(rec);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    }
    db.close();
    return 'ok';
  })()`;
}

module.exports = { BOOKS, MUSIC, SETTINGS, PROGRESS, EXTRA_BOOKS, installScript };
