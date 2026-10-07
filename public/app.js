
'use strict';
/* ================================================================
   nana · 小说情境伴读 — 单文件应用（v2 复刻设计稿 UI）
   功能层：txt 导入 / 情绪节点预分析（OpenAI 兼容 API）/
           情绪→曲目映射 / Web Audio crossfade 渐入渐出
   UI 层：书库（Books 风）/ 阅读器（纸面排版+悬浮菜单）/ 黑胶播放器
================================================================ */

/* ---------- 常量 ---------- */
const EMOTIONS = [
  {label:'平静', color:'#4a9c9c'},
  {label:'温馨', color:'#d98a4a'},
  {label:'悲伤', color:'#5b7fbf'},
  {label:'紧张', color:'#c05050'},
  {label:'激昂', color:'#d07a1f'},
  {label:'诡异', color:'#7a5bb0'},
  {label:'欢快', color:'#c9a13b'},
  {label:'史诗', color:'#4a5e9e'},
];
const emoColor = l => { const e = EMOTIONS.find(x=>x.label===l); return e ? e.color : '#8a8a8a'; };
const EMO_LABELS = EMOTIONS.map(e=>e.label);

const SAMPLE_BOOK = {
  title:'示例 · 雾海行舟',
  chapters:[
    {title:'第一章 雾港启航', text:
`晨雾未散，青雀港像浸在一碗温开的牛奶里。
沈舟把最后一桶淡水搬上"逐光号"，直起腰，听见甲板下传来妹妹阿螺试笛的声音——断断续续，像溪水绕过石头。
"今天出港？"码头上，老舵手秦伯叼着旱烟，眯眼看天。
"今天。"沈舟说，"雾散之前。"
秦伯笑了笑，把烟锅在鞋底磕了磕："雾海深处，看得清的人反而走得慢。你们这些急的，倒容易撞上运气。"
缆绳解开的时候，海面平静得像一块熨过的蓝布。逐光号缓缓离开泊位，惊起两三只白鹭。
阿螺从舱里探出头，把一支没吹熟的曲子吹完了。这一次，居然一个音都没跑。
沈舟望着越来越小的青雀港，忽然觉得，远方也没什么可怕的。`},
    {title:'第二章 风暴与低吟', text:
`变故发生在第三天黄昏。
先是海鸟成群地往回飞，接着，天边的云像被打翻的墨，一层层压下来。
"收帆！"沈舟的吼声刚落，风就到了。
逐光号像一片叶子被按进浪谷，又被抛上浪峰。阿螺死死抱住桅杆，指节发白。
然后，他们听见了那个声音。
从海底传来的、极低极缓的吟声，像一座山在梦中翻身。
"海蛟……"秦伯的声音在风里发颤，"是老辈人说的守雾海蛟。"
黑影从船底掠过，比整条船还长。吟声第二次响起时，沈舟忽然听懂了什么——那不是威胁，更像……痛。
他深吸一口气，解下缆绳，抓起鱼叉："阿螺，掌舵！秦伯，把左舷的灯全点上！"
"你疯了？"
"它的吟声里有血腥味。"沈舟盯着那片翻涌的黑，"它被渔网缠住了。"
逐光号调转船头，冲向风暴中心。灯火一盏盏亮起来，像一小串不肯认输的星星。`},
    {title:'第三章 灯火归港', text:
`半个月后，逐光号回到了青雀港。
海蛟把他们送出雾海的那晚，天上的月亮大得离谱。此刻桅杆上还挂着那晚留下的一片鳞，风吹过时，叮的一声轻响。
码头上，秦伯的孙女举着灯笼跑来接船，一路上喊"爷爷"喊了十七声。
阿螺跳下舷梯，笛子挂在腰上晃。她现在能吹完整支曲子了，回家要吹给娘听。
沈舟最后一个下船。他回头看了看逐光号——船身添了三道新的疤，像三枚勋章。
"下个月，还出海吗？"秦伯点起旱烟，慢悠悠地问。
沈舟笑了："出海。这次，带上更多的人。"
港口的灯火一盏一盏亮起来，饭菜的香气从巷子深处飘出来，混着咸咸的海风。
有人喊他们回家吃饭了。`}
  ]
};

/* ---------- 工具 ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const sleep = ms => new Promise(r=>setTimeout(r, ms));
const fmtTime = s => { s=Math.max(0,Math.round(s||0)); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); };
const fmtKB = n => n>1048576 ? (n/1048576).toFixed(1)+' MB' : Math.round(n/1024)+' KB';
function hashHue(str){ let h=0; for(const c of String(str)) h=(h*31+c.charCodeAt(0))>>>0; return h%360; }
const hashGrad = str => `linear-gradient(160deg, hsl(${hashHue(str)},34%,46%), hsl(${(hashHue(str)+40)%360},42%,26%))`;
let toastTimer = null;
function toast(msg){
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(()=>t.classList.remove('show'), 2600);
}
/* 通用弹出菜单 */
let activePop = null;
function closePop(){ if(activePop){ activePop.remove(); activePop=null; } }
function showPop(anchor, items){
  closePop();
  const pop = document.createElement('div');
  pop.className = 'pop';
  items.forEach(it=>{
    if(it.sep){ const d=document.createElement('div'); d.className='sep'; pop.appendChild(d); return; }
    const b = document.createElement('button');
    if(it.danger) b.className='danger';
    b.textContent = it.label;
    b.addEventListener('click', ()=>{ closePop(); it.fn(); });
    pop.appendChild(b);
  });
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth;
  pop.style.top = (r.bottom + 8) + 'px';
  pop.style.left = clamp(r.right - pw, 10, window.innerWidth - pw - 10) + 'px';
  activePop = pop;
  setTimeout(()=>document.addEventListener('click', closePop, {once:true}), 0);
}

/* ---------- 设置 / 映射 / 进度 ---------- */
const DEF_SET = {apiBase:'', apiKey:'', model:'', fadeSec:4, volume:0.75, theme:'light', fontSize:20, viewMode:'grid'};
function getSettings(){
  let s = {};
  try{ s = JSON.parse(localStorage.getItem('nr-settings')||'{}'); }catch(e){}
  return Object.assign({}, DEF_SET, s);
}
function saveSettings(patch){
  localStorage.setItem('nr-settings', JSON.stringify(Object.assign(getSettings(), patch)));
}
function getMapping(){ try{ return JSON.parse(localStorage.getItem('nr-mapping')||'{}'); }catch(e){ return {}; } }
function saveMapping(m){ localStorage.setItem('nr-mapping', JSON.stringify(m)); }
function getProgress(){ try{ return JSON.parse(localStorage.getItem('nr-progress')||'{}'); }catch(e){ return {}; } }
function saveProgress(bookId, chIdx, pct){
  const p = getProgress(); p[bookId] = {chIdx, pct, ts:Date.now()};
  localStorage.setItem('nr-progress', JSON.stringify(p));
}
function saveMediaProgress(id,chIdx,media) {
  if(!Number.isFinite(media.duration)||media.duration<=0) return;
  const progress=getProgress();progress[id]={chIdx,pct:media.currentTime/media.duration*100,time:media.currentTime,ts:Date.now()};
  localStorage.setItem('nr-progress',JSON.stringify(progress));
}

/* ---------- IndexedDB ---------- */
let _dbP = null;
function idb(){
  if(_dbP) return _dbP;
  _dbP = new Promise((res, rej)=>{
    const r = indexedDB.open('novel-reader', 1);
    r.onupgradeneeded = e => {
      const db = e.target.result;
      if(!db.objectStoreNames.contains('books')) db.createObjectStore('books', {keyPath:'id'});
      if(!db.objectStoreNames.contains('music')) db.createObjectStore('music', {keyPath:'id'});
      if(!db.objectStoreNames.contains('analyses')) db.createObjectStore('analyses', {keyPath:'key'});
    };
    r.onsuccess = ()=>res(r.result);
    r.onerror = ()=>rej(r.error);
  });
  return _dbP;
}
async function dbPut(store, val){
  const db = await idb();
  return new Promise((res,rej)=>{
    const tx = db.transaction(store,'readwrite');
    tx.objectStore(store).put(val);
    tx.oncomplete = res; tx.onerror = ()=>rej(tx.error);
  });
}
async function dbGet(store, key){
  const db = await idb();
  return new Promise((res,rej)=>{
    const tx = db.transaction(store,'readonly');
    const rq = tx.objectStore(store).get(key);
    rq.onsuccess = ()=>res(rq.result); rq.onerror = ()=>rej(rq.error);
  });
}
async function dbDel(store, key){
  const db = await idb();
  return new Promise((res,rej)=>{
    const tx = db.transaction(store,'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = res; tx.onerror = ()=>rej(tx.error);
  });
}
async function dbAll(store){
  const db = await idb();
  return new Promise((res,rej)=>{
    const tx = db.transaction(store,'readonly');
    const rq = tx.objectStore(store).getAll();
    rq.onsuccess = ()=>res(rq.result||[]); rq.onerror = ()=>rej(rq.error);
  });
}
const anaKey = (bookId, chIdx) => bookId + ':' + chIdx;

/* ---------- 全局状态 ---------- */
const CONTENT_TYPES={
  novel:{label:'小说',unit:'本',part:'章',verb:'阅读',placeholder:'搜索书名、作者或关键词，例如：剑来'},
  comic:{label:'漫画',unit:'部',part:'话',verb:'阅读',placeholder:'搜索漫画名称或关键词，例如：剑魂'},
  music:{label:'音乐',unit:'首',part:'',verb:'播放',placeholder:'搜索歌曲、歌手或配乐，例如：天空之城'},
  anime:{label:'番剧',unit:'部',part:'集',verb:'播放',placeholder:'搜索番剧名称或关键词，例如：火影'}
};
const state = {
  page:'home',
  book:null, chIdx:0, nodes:[],
  playingEmotion:null, ambOn:false,
  batchStop:false,
  cineBookId:null,
  libQuery:'',
  muSelected:null,
  store:{type:'novel', items:[], det:null, stop:false},
};

/* ================================================================
   配乐引擎：双 Audio 元素 + GainNode crossfade（渐入渐出）
================================================================ */
const player = {
  ctx:null, ga:null, gb:null,
  a:null, b:null, active:'a',
  currentId:null, currentMusic:null,
  playRequest:0, lastError:'',
  listeners:[],
  get fadeSec(){ return getSettings().fadeSec; },
  get volume(){ return getSettings().volume; },
  on(f){ this.listeners.push(f); },
  emit(){ this.listeners.forEach(f=>{ try{f();}catch(e){} }); },

  ensureCtx(){
    if(!this.ctx){
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.a = new Audio(); this.b = new Audio();
      this.a.loop = true; this.b.loop = true;
      for(const el of [this.a,this.b]) {
        el.addEventListener('error',()=>{if(el===this.activeEl()&&this.currentMusic){this.lastError='音频加载失败，请重试或打开原站';toast(this.lastError);this.emit();}});
        el.addEventListener('loadedmetadata',()=>{if(el===this.activeEl()) this.emit();});
      }
      this.ga = this.ctx.createGain(); this.gb = this.ctx.createGain();
      this.ctx.createMediaElementSource(this.a).connect(this.ga).connect(this.ctx.destination);
      this.ctx.createMediaElementSource(this.b).connect(this.gb).connect(this.ctx.destination);
      this.ga.gain.value = 0; this.gb.gain.value = 0;
    }
    if(this.ctx.state === 'suspended') this.ctx.resume();
  },

  activeEl(){ return this.active==='a' ? this.a : this.b; },

  async crossfadeTo(music){
    if(!music) return;
    if(music.id === this.currentId){ if(!this.isPlaying()) await this.togglePause();this.emit();return true; }
    this.ensureCtx();
    const request=++this.playRequest;
    this.lastError='';
    const inEl  = this.active==='a' ? this.b : this.a;
    const inGn  = this.active==='a' ? this.gb : this.ga;
    const outEl = this.active==='a' ? this.a : this.b;
    const outGn = this.active==='a' ? this.ga : this.gb;
    try{
      inEl.pause();
      if(inEl.src?.startsWith('blob:')) URL.revokeObjectURL(inEl.src);
      inGn.gain.cancelScheduledValues(this.ctx.currentTime);inGn.gain.setValueAtTime(0,this.ctx.currentTime);
      if(music.blob){
        inEl.removeAttribute('crossorigin');
        inEl.src = URL.createObjectURL(music.blob);
      }else if(music.source && (music.sourceUrl||music.audio)){
        inEl.removeAttribute('crossorigin');
        inEl.src = '/api/audio?'+new URLSearchParams({source:music.source,url:music.sourceUrl||music.audio});
      }else if(music.audio){
        inEl.crossOrigin='anonymous';inEl.src=music.audio;
      }else throw new Error('曲目没有可播放地址');
      await inEl.play();
    }catch(e){
      if(request!==this.playRequest) return false;
      this.lastError=e.name==='NotAllowedError'?'请点击播放按钮允许浏览器播放音频':'音频加载失败，请重试或打开原站';
      toast(this.lastError);this.emit();return false;
    }
    if(request!==this.playRequest) return false;
    const t = this.ctx.currentTime;
    const v = Math.max(this.volume, 0.0001);
    const F = this.fadeSec;
    inGn.gain.cancelScheduledValues(t);
    inGn.gain.setValueAtTime(0.0001, t);
    inGn.gain.exponentialRampToValueAtTime(v, t + F);
    const cur = Math.max(outGn.gain.value, 0.0001);
    outGn.gain.cancelScheduledValues(t);
    outGn.gain.setValueAtTime(cur, t);
    outGn.gain.exponentialRampToValueAtTime(0.0001, t + F);
    const oldUrl = outEl.src;
    setTimeout(()=>{
      if(outEl!==this.activeEl() && outEl.src === oldUrl){
        outEl.pause();
        try{ URL.revokeObjectURL(oldUrl); }catch(e){}
      }
    }, F*1000 + 400);
    this.active = this.active==='a' ? 'b' : 'a';
    this.currentId = music.id;
    this.currentMusic = music;
    this.emit();
    return true;
  },

  setVolume(v){
    saveSettings({volume:v});
    if(!this.ctx) return;
    const gn = this.active==='a' ? this.ga : this.gb;
    const t = this.ctx.currentTime;
    gn.gain.cancelScheduledValues(t);
    gn.gain.setValueAtTime(Math.max(gn.gain.value, 0.0001), t);
    gn.gain.exponentialRampToValueAtTime(Math.max(v, 0.0001), t + 0.15);
  },

  fadeStop(){
    const request=++this.playRequest;
    if(!this.ctx) return;
    const el = this.activeEl();
    const gn = this.active==='a' ? this.ga : this.gb;
    const t = this.ctx.currentTime;
    const cur = Math.max(gn.gain.value, 0.0001);
    gn.gain.cancelScheduledValues(t);
    gn.gain.setValueAtTime(cur, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(this.fadeSec, 2));
    const url = el.src;
    setTimeout(()=>{ if(request===this.playRequest && el.src===url){ el.pause(); try{URL.revokeObjectURL(url);}catch(e){} } }, 2400);
    this.currentId = null;
    this.currentMusic = null;
    this.emit();
  },

  isPlaying(){
    const el = this.activeEl();
    return !!(this.ctx && el.src && !el.paused);
  },
  async togglePause(){
    if(!this.ctx) return null;
    const el = this.activeEl();
    if(!el.src) return null;
    let r;
    if(el.paused){try{await el.play();this.lastError='';r='playing';}catch(e){this.lastError='播放失败，请重试或打开原站';toast(this.lastError);}} else { el.pause(); r='paused'; }
    this.emit();
    return r;
  },
  seek(frac){
    const el = this.activeEl();
    if(this.ctx && el.src && el.duration) el.currentTime = clamp(frac,0,1) * el.duration;
  }
};

/* ================================================================
   情境分析（OpenAI 兼容 API）
================================================================ */
async function callLLM(messages, maxTokens){
  const s = getSettings();
  if(!s.apiBase || !s.model) throw new Error('请先在「设置」中填写模型 API 地址与模型名');
  let base = s.apiBase.trim().replace(/\/+$/,'');
  if(!/\/chat\/completions$/.test(base)) base += '/chat/completions';
  const headers = {'Content-Type':'application/json'};
  if(s.apiKey) headers['Authorization'] = 'Bearer ' + s.apiKey;
  const res = await fetch(base, {
    method:'POST', headers,
    body: JSON.stringify({model:s.model, messages, temperature:0.2, max_tokens:maxTokens})
  });
  if(!res.ok) throw new Error('API ' + res.status + '：' + (await res.text()).slice(0,180));
  const data = await res.json();
  const c = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if(!c) throw new Error('模型未返回内容');
  return c;
}
function normEmotion(e){
  e = String(e||'').trim();
  const hit = EMOTIONS.find(x=>x.label===e) ||
              EMOTIONS.find(x=>e.includes(x.label) || x.label.includes(e));
  return hit ? hit.label : e;
}
function parseNodes(raw){
  let t = String(raw).trim().replace(/^```(?:json)?/i,'').replace(/```\s*$/,'').trim();
  const i = t.indexOf('['), j = t.lastIndexOf(']');
  if(i>=0 && j>i) t = t.slice(i, j+1);
  const arr = JSON.parse(t);
  if(!Array.isArray(arr)) throw new Error('返回的不是数组');
  let nodes = arr.map(n=>({
    at: clamp(Math.round(+n.at || 0), 0, 100),
    emotion: normEmotion(n.emotion),
    note: String(n.note||'').trim().slice(0,30)
  })).filter(n=>n.emotion);
  nodes.sort((a,b)=>a.at-b.at);
  if(nodes.length && nodes[0].at > 2) nodes.unshift({at:0, emotion:nodes[0].emotion, note:'起始'});
  if(!nodes.length) throw new Error('无有效节点');
  return nodes;
}
async function analyzeChapter(bookId, chIdx){
  const book = await dbGet('books', bookId);
  await ensureChapterText(book, chIdx);
  const ch = book.chapters[chIdx];
  const MAXC = 6000;
  const text = ch.text.length > MAXC ? ch.text.slice(0, MAXC) + '\n（后文截断）' : ch.text;
  const user =
`请分析这章小说的情绪走向，用于自动配乐。

可选情绪标签（必须从此列表中选择）：${EMO_LABELS.join('、')}

章节《${ch.title}》：
${text}

输出要求：JSON 数组，包含 3-6 个情绪节点，按文本进度排列：
[{"at": 0-100 整数, "emotion": "标签", "note": "不超过15字的情绪说明"}]
第一个节点 at 必须为 0。只输出 JSON 数组，不要输出其他任何内容。`;
  const raw = await callLLM([
    {role:'system', content:'你是专业的小说配乐导演，擅长把文字情绪转化为音乐节点。只输出 JSON。'},
    {role:'user', content:user}
  ], 700);
  const nodes = parseNodes(raw);
  await dbPut('analyses', {key:anaKey(bookId, chIdx), bookId, chIdx, nodes, ts:Date.now()});
  return nodes;
}

/* ================================================================
   导航 / 主题
================================================================ */
function applyTheme(){
  const s = getSettings();
  document.body.classList.toggle('dark', s.theme==='dark');
  if($('mfTheme')) $('mfTheme').textContent = s.theme==='dark' ? '☀' : '☾';
}
function showPage(page){
  if(page==='store') page='home';
  if(state.page==='anime'&&page!=='anime') stopAnime();
  if(state.page!==page) {player.playRequest++;closeStoreModal();}
  state.page = page;
  document.querySelectorAll('.page').forEach(p=>p.classList.add('hidden'));
  $('page-'+page).classList.remove('hidden');
  const chromePages = ['home','library','anime','music','cine','settings'];
  $('chrome').classList.toggle('hidden', !chromePages.includes(page));
  document.querySelectorAll('#mainSeg button').forEach(b=>{
    b.classList.toggle('on', b.dataset.nav===page);
  });
  if(page==='home') renderHome();
  if(page==='library') renderLibrary();
  if(page==='cine') renderCine();
  if(page==='settings') renderSettings();
  if(page==='music') updateMusicUI();
  $('btnViewMode').classList.toggle('hidden',page!=='library');
  if(page!=='reader') closeRdMenu();
}
$('mainSeg').addEventListener('click', e=>{
  const b = e.target.closest('button[data-nav]');
  if(!b) return;
  if(b.dataset.nav==='search'){
    openDiscovery();
    return;
  }
  if(b.dataset.nav==='home') state.store.discover=false;
  showPage(b.dataset.nav);
});
$('btnViewMode').addEventListener('click', ()=>{
  const cur = getSettings().viewMode;
  saveSettings({viewMode: cur==='grid'?'list':'grid'});
  renderLibrary();
});
$('btnMore').addEventListener('click', e=>{
  e.stopPropagation();
  showPop($('btnMore'), [
    {label:'♪  音乐播放器', fn:()=>{if(player.currentMusic) showPage('music');else openCategory('music');}},
    {label:'🎼 情境配乐', fn:()=>showPage('cine')},
    {label:'⚙ 设置', fn:()=>showPage('settings')},
    {sep:true},
    {label:'＋ 导入 txt 小说', fn:()=>$('fileImport').click()},
    {label: getSettings().theme==='dark' ? '☀ 浅色模式' : '☾ 深色模式', fn:toggleTheme},
  ]);
});
function toggleTheme(){
  saveSettings({theme: getSettings().theme==='dark' ? 'light':'dark'});
  applyTheme();
}
$('mfTheme').addEventListener('click', toggleTheme);
$('mfInfo').addEventListener('click', ()=>
  toast('阅读时滚到情绪节点，音乐会渐入渐出切换 · 在「情境配乐」页预设'));

/* ================================================================
   书籍导入与切分
================================================================ */
function splitChapters(raw){
  const text = raw.replace(/\r\n?/g,'\n');
  const re = /^[ \t]*(第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章回节卷集部幕][^\n]{0,50}|序章|序言|楔子|引子|尾声|终章|番外[^\n]{0,30})[ \t]*$/gim;
  const marks = []; let m;
  while((m = re.exec(text))) marks.push({i:m.index, title:m[0].trim()});
  const chapters = [];
  if(marks.length >= 2){
    const pre = text.slice(0, marks[0].i).trim();
    if(pre) chapters.push({title:'开篇', text:pre});
    marks.forEach((mk,k)=>{
      const end = k+1 < marks.length ? marks[k+1].i : text.length;
      const body = text.slice(mk.i, end).replace(/^[^\n]*\n/,'').trim();
      chapters.push({title:mk.title, text:body});
    });
  }else{
    const paras = text.split(/\n{2,}/).map(s=>s.trim()).filter(Boolean);
    let buf = [], cnt = 0, idx = 1;
    for(const p of paras){
      buf.push(p); cnt += p.length;
      if(cnt >= 4000){ chapters.push({title:'片段 '+idx, text:buf.join('\n\n')}); buf=[]; cnt=0; idx++; }
    }
    if(buf.length) chapters.push({title:'片段 '+idx, text:buf.join('\n\n')});
  }
  return chapters;
}
async function importTxtFile(file){
  let text;
  const buf = await file.arrayBuffer();
  try{ text = new TextDecoder('utf-8', {fatal:true}).decode(buf); }
  catch(e){ text = new TextDecoder('gb18030').decode(buf); }
  if(text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const chapters = splitChapters(text);
  if(!chapters.length){ toast('未能从文件解析出内容'); return; }
  const book = {
    id: uid(),
    title: file.name.replace(/\.txt$/i,''),
    addedAt: Date.now(),
    charCount: text.length,
    chapters
  };
  await dbPut('books', book);
  toast(`已导入《${book.title}》共 ${chapters.length} 章`);
  if(state.page==='library') renderLibrary();
  if(state.page==='home') renderHome();
}
async function ensureSampleBook(){
  const books = await dbAll('books');
  if(books.length) return;
  await dbPut('books', {
    id:'sample', title:SAMPLE_BOOK.title, addedAt:Date.now(),
    charCount:SAMPLE_BOOK.chapters.reduce((n,c)=>n+c.text.length,0),
    chapters:SAMPLE_BOOK.chapters
  });
}

/* ================================================================
   主页
================================================================ */
let homeRender=0;
async function renderHome(){
  const request=++homeRender;
  renderStore();
  const items=(await Promise.all(Object.keys(CONTENT_TYPES).map(type=>savedContent(type)))).flat().sort((a,b)=>b.addedAt-a.addedAt);
  if(request!==homeRender||state.page!=='home') return;
  const progress=getProgress();
  const recent=items.filter(item=>progress[item.localId]).sort((a,b)=>(progress[b.localId].ts||0)-(progress[a.localId].ts||0))[0]||items[0];
  const meta=recent?CONTENT_TYPES[recent.type]:CONTENT_TYPES[state.store.type];
  const resume=$('homeContinue');
  const cineButton=recent?.type==='novel'?'<button class="btn" id="homeCine">情境配乐 ♪</button>':'';
  resume.innerHTML=recent?`<h2 class="sec-title">${progress[recent.localId]?'继续':'开始'}${meta.verb}</h2><div class="home-resume" data-type="${recent.type}">${coverHTML(recent)}<div class="resume-copy"><h3>${esc(recent.name)}</h3><p class="muted">${esc(recent.author||recent.sourceName)}</p><p class="resume-progress">${esc(progressLabel(recent))}</p><div class="resume-actions"><button class="btn" id="homeResume">${progress[recent.localId]?'继续':'开始'}${meta.verb}</button>${cineButton}</div></div></div>`:`<div class="home-empty"><h2>收藏喜欢的${meta.label}</h2><p class="muted">找到喜欢的内容，随时回来继续${meta.verb}。</p><div class="resume-actions"><button class="btn" id="homeEmptySearch">搜索${meta.label}</button></div></div>`;
  if(recent) $('homeResume').onclick=async()=>{try{if(recent.type==='music') player.ensureCtx();await openCatalogContent(await dbGet(recent.type==='music'?'music':'books',recent.localId),recent.type);}catch(e){toast(e.message);}};
  else $('homeEmptySearch').onclick=()=>openDiscovery();
  if(cineButton) $('homeCine').onclick=()=>{state.cineBookId=recent.localId;showPage('cine');};
  const box=$('homeRecent');
  box.innerHTML=items.length?`<div class="section-heading"><h2 class="sec-title">最近收藏</h2></div><div class="home-wall"></div>`:'';
  if(!items.length) return;
  for(const item of items.slice(0,16)) box.querySelector('.home-wall').append(createContentCard(item));
}
/* ================================================================
   书库
================================================================ */
function coverInner(title, coverUrl){
  const g = hashGrad(title);
  if(!coverUrl) return `<div class="cover cv-placeholder">${esc(title.slice(0,24))}</div>`;
  return `<div class="cover" style="background:${g}"><img class="cv-img" src="${esc(coverUrl)}" referrerpolicy="no-referrer" loading="lazy" onerror="this.parentElement.classList.add('cv-placeholder');this.parentElement.style.background='';this.remove()"><span class="cv-fallback">${esc(title.slice(0,24))}</span></div>`;
}
let libraryRender=0;
async function renderLibrary(){
  const request=++libraryRender,type=state.store.type,meta=CONTENT_TYPES[type];
  renderCategoryButtons();
  $('libraryAmbience').classList.toggle('hidden',type!=='music');
  const items=await savedContent(type);
  if(request!==libraryRender||state.store.type!==type) return;
  const list=items;
  const grid=$('bookGrid'),mode=getSettings().viewMode;
  grid.classList.toggle('listview',mode==='list');
  $('btnViewMode').textContent=mode==='grid'?'☰':'▦';
  grid.innerHTML='';
  const add=document.createElement('button');add.className='library-add';
  add.setAttribute('aria-label',`添加${meta.label}`);add.title=`添加${meta.label}`;
  add.innerHTML='<span class="cover"><span aria-hidden="true">＋</span></span>';
  add.onclick=()=>{
    if(type==='novel'||type==='music') showPop(add,[
      {label:type==='novel'?'导入 TXT 文件':'导入音频文件',fn:() => $(type==='novel'?'fileImport':'fileMusic').click()},
      {label:`搜索${meta.label}`,fn:()=>openDiscovery(type)}
    ]);
    else openDiscovery(type);
  };
  grid.append(add);
  for(const item of list) grid.append(createContentCard(item));
  if(!list.length){const empty=document.createElement('p');empty.className='muted store-empty';empty.textContent=`点击＋添加喜欢的${meta.label}。`;grid.append(empty);}
}
$('libraryTypeSeg').onclick=e=>{const button=e.target.closest('[data-ctype]');if(button) openCategory(button.dataset.ctype,'library');};

$('fileImport').addEventListener('change', async e=>{
  for(const f of e.target.files) await importTxtFile(f);
  e.target.value='';
});
['dragover','dragenter'].forEach(ev=>document.addEventListener(ev, e=>e.preventDefault()));
document.addEventListener('drop', e=>{
  e.preventDefault();
  if(state.page!=='library' && state.page!=='home') return;
  [...(e.dataTransfer.files||[])].filter(f=>/\.txt$/i.test(f.name)).forEach(importTxtFile);
});

/* ================================================================
   阅读器
================================================================ */
function setReaderLayout(){
  const sc=$('readerScroll'),body=$('chapterBody');
  if(!sc||!body) return;
  const viewportW=sc.clientWidth||window.innerWidth||800;
  const paged=!body.classList.contains('comic')&&viewportW<=760;
  sc.classList.toggle('reader-paged',paged);
  body.classList.toggle('reader-paged',paged);
  if(!paged){
    body.style.removeProperty('--reader-column-width');
    body.style.removeProperty('--reader-column-gap');
    return;
  }
  const viewportH=sc.clientHeight||window.innerHeight||600;
  const spread=viewportW>viewportH;
  const gap=spread?42:30;
  const css=getComputedStyle(body);
  const side=(parseFloat(css.paddingLeft)||0)+(parseFloat(css.paddingRight)||0);
  const available=Math.max(280,viewportW-side-(spread?gap:0));
  const columnW=spread?Math.floor(available/2):available;
  body.style.setProperty('--reader-column-width',columnW+'px');
  body.style.setProperty('--reader-column-gap',gap+'px');
}
function turnReaderPage(direction){
  const sc=$('readerScroll'),body=$('chapterBody');
  if(!sc||!body||body.classList.contains('comic')||!state.book) return;
  const max=Math.max(0,sc.scrollWidth-sc.clientWidth),atStart=sc.scrollLeft<=2,atEnd=sc.scrollLeft>=max-2;
  if(direction<0&&atStart&&state.chIdx>0){state.chIdx--;state.playingEmotion=null;renderDrawer();renderChapter(state.chIdx);return;}
  if(direction>0&&atEnd&&state.chIdx<state.book.chapters.length-1){state.chIdx++;state.playingEmotion=null;renderDrawer();renderChapter(state.chIdx);return;}
  sc.scrollBy({left:direction*Math.max(1,sc.clientWidth),behavior:'smooth'});
}
window.addEventListener('resize',()=>{
  if(state.page!=='reader'||$('chapterBody')?.classList.contains('comic')) return;
  const pct=scrollPct(),sc=$('readerScroll');setReaderLayout();
  if(sc.classList.contains('reader-paged')) sc.scrollLeft=pct/100*Math.max(0,sc.scrollWidth-sc.clientWidth);
  else sc.scrollTop=pct/100*Math.max(0,sc.scrollHeight-sc.clientHeight);
  updateFab();
});
async function startReading(bookId, chIdx){
  const book = await dbGet('books', bookId);
  if(!book){ toast('书籍不存在'); return; }
  if(book.type==='anime') return startAnime(book);
  state.store.type=book.type||'novel';
  state.book = book;
  const p = getProgress()[bookId];
  state.chIdx = clamp(chIdx!=null ? chIdx : (p ? p.chIdx : 0), 0, book.chapters.length-1);
  state.playingEmotion = null;
  showPage('reader');
  $('chDrawer').classList.remove('open');
  closeRdMenu();
  renderDrawer();
  renderChapter(state.chIdx);
  state.ambOn = false;
}

function renderDrawer(){
  const d = $('chDrawer');
  d.innerHTML = state.book.chapters.map((c,i)=>
    `<div class="ch-item ${i===state.chIdx?'cur':''}" data-i="${i}">${esc(c.title)}</div>`).join('');
  d.querySelectorAll('.ch-item').forEach(it=>it.addEventListener('click', ()=>{
    state.chIdx = +it.dataset.i;
    state.playingEmotion = null;
    renderDrawer(); renderChapter(state.chIdx);
  }));
}

let chapterRequest = 0;
async function renderChapter(idx){
  const request = ++chapterRequest;
  if(state.book.type==='comic'){ return renderComicChapter(idx); }
  const book = state.book;
  const ch = book.chapters[idx];
  if(!ch) return;
  if(!ch.text && ch.url){
    $('chapterBody').innerHTML = '<p class="muted">正在加载本章…</p>';
    try { await ensureChapterText(book, idx); }
    catch(e) {
      if(request !== chapterRequest) return;
      $('chapterBody').innerHTML = `<p>${esc(e.message)}</p><button class="btn" id="retryChapter">重试本章</button>`;
      $('retryChapter').onclick = ()=>renderChapter(idx);
      return;
    }
  }
  if(request !== chapterRequest || state.book.id !== book.id) return;
  const s = getSettings();
  const body = $('chapterBody');
  body.classList.remove('comic');
  setReaderLayout();
  const paras = (ch.text || '').split('\n').map(l=>l.trim()).filter(Boolean);
  body.innerHTML = `<h1>${esc(ch.title)}</h1>
    <div class="ch-sub">《${esc(state.book.title)}》 · ${idx+1}/${state.book.chapters.length}</div>`
    + paras.map(p=>`<p>${esc(p)}</p>`).join('')
    + `<div class="rd-foot">— ${idx+1} / ${state.book.chapters.length} —</div>
       <div class="rd-nav">
         ${idx>0?'<button class="btn small" data-navch="prev">上一章</button>':''}
         ${idx<state.book.chapters.length-1?'<button class="btn small" data-navch="next">下一章</button>':''}
       </div>`;
  body.style.fontSize = s.fontSize + 'px';
  body.querySelectorAll('[data-navch]').forEach(b=>b.addEventListener('click', ()=>{
    const next = b.dataset.navch==='prev' ? state.chIdx-1 : state.chIdx+1;
    if(next>=0 && next<state.book.chapters.length){
      state.chIdx = next; state.playingEmotion = null;
      renderDrawer(); renderChapter(next);
    }
  }));
  $('rdHeadTitle').innerHTML = `<b>${esc(state.book.title)}</b> ${esc(ch.title)}`;
  const an = await dbGet('analyses', anaKey(state.book.id, idx));
  if(request !== chapterRequest) return;
  state.nodes = an ? an.nodes : [];
  const p = getProgress()[state.book.id];
  const sc = $('readerScroll');
  const pct = p && p.chIdx===idx ? p.pct||0 : 0;
  if(sc.classList.contains('reader-paged')){
    sc.scrollTop = 0;
    sc.scrollLeft = pct/100 * Math.max(0,sc.scrollWidth - sc.clientWidth);
  }else{
    sc.scrollLeft = 0;
    sc.scrollTop = pct/100 * Math.max(0,sc.scrollHeight - sc.clientHeight);
  }
  saveProgress(book.id, idx, p && p.chIdx===idx ? p.pct||0 : 0);
  updateFab();
  updateEmotion(true);
}

/* 右下悬浮菜单（复刻图书 App） */
function updateFab(){
  const pct = state.book ? Math.round((state.chIdx + scrollPct()/100)/state.book.chapters.length*100) : 0;
  $('fabText').textContent = `目录 · ${pct}%`;
}
function closeRdMenu(){ const m = $('rdMenu'); if(m) m.classList.add('hidden'); }
$('fabBar').addEventListener('click', e=>{
  e.stopPropagation();
  const m = $('rdMenu');
  if(!m.classList.contains('hidden')){ closeRdMenu(); return; }
  const analyzed = state.nodes.length ? state.nodes.length+' 个节点' : '未分析';
  const cineRow = (!state.book.type || state.book.type==='novel') ? `
    <div class="rm-row" id="rmCine">🎼 情境配乐<span class="rm-r">${analyzed}</span></div>
    <div class="rm-sep"></div>` : '';
  m.innerHTML = `
    <div class="rm-row" id="rmToc">☰ 章节目录<span class="rm-r">${state.chIdx+1}/${state.book.chapters.length}</span></div>
    <div class="rm-sep"></div>${cineRow}
    <div class="rm-row" id="rmFont">主题与设置<span class="rm-r">大小</span></div>
    <div class="rm-panel hidden" id="rmFontPanel">
      <div class="row">
        <button class="btn small" id="rmfMinus">A−</button>
        <button class="btn small" id="rmfPlus">A+</button>
        <div class="grow"></div>
        <button class="btn small" id="rmfTheme">${getSettings().theme==='dark'?'☀ 浅色':'☾ 深色'}</button>
      </div>
    </div>
    <div class="rm-sep"></div>
    <div class="rm-btns">
      <button id="rmBack" title="返回收藏">⤴</button>
      <button id="rmAmb" class="${state.ambOn?'on':''}" title="伴读开关">♪</button>
      <button id="rmToc2" title="章节列表">☰</button>
    </div>`;
  m.classList.remove('hidden');
  $('rmToc').addEventListener('click', toggleDrawer);
  $('rmToc2').addEventListener('click', toggleDrawer);
  if($('rmCine')) $('rmCine').addEventListener('click', ()=>{
    state.cineBookId=state.book.id; closeRdMenu(); showPage('cine');
  });
  $('rmFont').addEventListener('click', ()=>$('rmFontPanel').classList.toggle('hidden'));
  $('rmfMinus').addEventListener('click', ()=>bumpFont(-1));
  $('rmfPlus').addEventListener('click', ()=>bumpFont(1));
  $('rmfTheme').addEventListener('click', ()=>{ toggleTheme(); $('rmfTheme').textContent = getSettings().theme==='dark'?'☀ 浅色':'☾ 深色'; });
  $('rmBack').addEventListener('click', ()=>{ closeRdMenu(); showPage('library'); });
  $('rmAmb').addEventListener('click', ()=>{ toggleAmb(); $('rmAmb').classList.toggle('on', state.ambOn); });
});
function toggleDrawer(){ $('chDrawer').classList.toggle('open'); }
function bumpFont(d){
  const v = clamp(getSettings().fontSize + d, 14, 28);
  saveSettings({fontSize:v});
  $('chapterBody').style.fontSize = v + 'px';
}

function toggleAmb(){
  state.ambOn = !state.ambOn;
  if(state.ambOn){
    player.ensureCtx();
    state.playingEmotion = null;
    updateEmotion(true);
    toast('伴读已开启 — 滚动到情绪节点自动切换');
  }else{
    player.fadeStop();
  }
}

/* 滚动 → 情绪触发 */
function scrollPct(){
  const sc = $('readerScroll');
  const horizontal=sc.classList.contains('reader-paged');
  const max = horizontal ? sc.scrollWidth - sc.clientWidth : sc.scrollHeight - sc.clientHeight;
  const position=horizontal ? sc.scrollLeft : sc.scrollTop;
  return max>0 ? clamp(position/max*100, 0, 100) : 0;
}
let lastSave = 0, lastEmit = 0;
$('readerScroll').addEventListener('wheel', e=>{
  const body=$('chapterBody');
  if(state.page!=='reader'||!body||body.classList.contains('comic')||!$('readerScroll').classList.contains('reader-paged')) return;
  const delta=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY;
  if(!delta) return;
  e.preventDefault();
  turnReaderPage(delta>0?1:-1);
},{passive:false});
$('readerScroll').addEventListener('scroll', ()=>{
  const now = Date.now();
  if(now - lastSave > 600){ lastSave = now; saveProgress(state.book.id, state.chIdx, scrollPct()); updateFab(); }
  if(now - lastEmit > 300){ lastEmit = now; updateEmotion(); }
});
function currentEmotionNode(pct){
  if(!state.nodes.length) return null;
  let node = state.nodes[0];
  for(const n of state.nodes){ if(n.at <= pct + 0.5) node = n; else break; }
  return node;
}
function updateEmotion(force){
  const node = currentEmotionNode(scrollPct());
  if(!node){ state.playingEmotion = null; return; }
  if(node.emotion !== state.playingEmotion || force){
    state.playingEmotion = node.emotion;
    tryPlayForEmotion(node.emotion);
  }
}
async function tryPlayForEmotion(emotion){
  if(!state.ambOn) return;
  const mapping = getMapping();
  const mid = mapping[emotion];
  if(!mid) return;
  const music = await dbGet('music', mid);
  if(!music){ toast(`「${emotion}」绑定的曲目已被删除`); return; }
  state.muSelected = music;
  await player.crossfadeTo(music);
}

/* ================================================================
   音乐页（黑胶播放器）
================================================================ */
function hueBg(music){
  const h = hashHue(music ? music.name : 'mooin');
  return `linear-gradient(168deg, hsl(${h},26%,44%) 0%, hsl(${h},30%,32%) 55%, hsl(${h},34%,16%) 100%)`;
}
function updateMusicUI(){
  if(state.page!=='music') return;
  const m = player.currentMusic || state.muSelected;
  const playing = player.isPlaying();
  $('muBg').style.background = hueBg(m);
  $('muTitle').textContent = state.playingEmotion && state.ambOn ? `情境 · ${state.playingEmotion}` : '音 乐';
  if(m){
    $('muName').textContent = m.name;
    $('muCover').innerHTML = `${esc(m.name.slice(0,4))}<small>MOOIN</small>`;
    const emo = state.ambOn && state.playingEmotion ? state.playingEmotion : (m.tags?.[0]||'');
    $('muEmo').textContent = m.preview?'试听片段':emo||m.sourceName||'本地配乐';
    $('muEmo').style.background = emo ? emoColor(emo) : '#777';
    $('muState').textContent = player.lastError || (playing ? '正在播放' : (player.currentMusic ? '已暂停' : '已选择'));
    $('muNote').textContent = state.ambOn && state.playingEmotion ? `情境配乐 · 「${state.playingEmotion}」触发` : '自由聆听模式';
    $('muLyric').textContent = m.author||'让音乐陪你读下去';
  }else{
    $('muName').textContent = '未在播放';
    $('muCover').textContent = '♪';
    $('muEmo').textContent = '—'; $('muEmo').style.background = '#777';
    $('muState').textContent = player.lastError||'搜索音乐，或上传本地曲目';
    $('muNote').textContent = '';
    $('muLyric').textContent = '为阅读选一首配乐';
  }
  $('muPlay').textContent = playing ? '⏸' : '▶';
  $('disc').classList.toggle('spin', !!player.currentMusic);
  $('disc').classList.toggle('paused', !playing);
  $('tonearm').classList.toggle('on', !!player.currentMusic);
  $('muVol').value = Math.round(getSettings().volume*100);
  renderMusicList();
}
player.on(()=>updateMusicUI());

async function renderMusicList(){
  const musics = await dbAll('music');
  musics.sort((a,b)=>b.addedAt-a.addedAt);
  const list = $('musicList');
  $('musicCount').textContent=musics.length;
  list.innerHTML = musics.length ? '' : '<p class="music-empty muted">还没有曲目。到「发现音乐」搜索并添加，或上传本地文件、合成氛围音。</p>';
  musics.forEach(m=>{
    const isCur = player.currentMusic && player.currentMusic.id===m.id;
    const row = document.createElement('div');
    row.className = 'music-row';
    row.innerHTML = `
      <button class="m-play ${isCur?'cur':''}">${isCur && player.isPlaying()?'⏸':'▶'}</button>
      <div class="grow" style="min-width:0">
        <div class="music-name ${isCur?'now':''}">${esc(m.name)}</div>
        <div class="muted">${esc(m.sourceName||'本地音乐')}${m.preview?' · 试听片段':''}${m.duration ? ' · '+fmtTime(m.duration) : ''}${m.author ? ' · '+esc(m.author) : ''}</div>
      </div>
      <div class="chips">${EMOTIONS.map(e=>`<span class="chip ${(m.tags||[]).includes(e.label)?'on':''}" data-tag="${e.label}" style="${(m.tags||[]).includes(e.label)?'background:'+e.color:''}">${e.label}</span>`).join('')}</div>
      <button class="btn small danger" data-del>✕</button>`;
    row.querySelector('.m-play').addEventListener('click', async ()=>{
      if(isCur){ player.togglePause(); return; }
      state.muSelected = m;
      try{await startMusic(m);}catch(e){toast(e.message);}
    });
    row.querySelectorAll('.chip').forEach(ch=>ch.addEventListener('click', async ()=>{
      const t = ch.dataset.tag;
      m.tags = (m.tags||[]).includes(t) ? m.tags.filter(x=>x!==t) : [...(m.tags||[]), t];
      await dbPut('music', m);
      renderMusicList(); updateMusicUI();
    }));
    row.querySelector('[data-del]').addEventListener('click', ()=>removeCollection(m,'music'));
    list.appendChild(row);
  });
}

/* 音乐页控件 */
$('muBack').addEventListener('click', ()=>openCategory('music','library'));
$('muReplay').addEventListener('click', async ()=>{
  const m = player.currentMusic || state.muSelected;
  if(!m){ toast('还没有选中曲目'); return; }
  try{await startMusic(m,false);}catch(e){toast(e.message);}
});
$('muPlay').addEventListener('click', async ()=>{
  if(!player.currentMusic){
    const m = state.muSelected || (await dbAll('music'))[0];
    if(!m){ toast('音乐库为空，请先添加曲目'); return; }
    try{await startMusic(m);}catch(e){toast(e.message);}
    return;
  }
  player.togglePause();
});
async function neighborMusic(dir){
  const musics = await dbAll('music');
  musics.sort((a,b)=>b.addedAt-a.addedAt);
  if(!musics.length){ toast('音乐库为空'); return null; }
  const cur = player.currentMusic || state.muSelected;
  let i = musics.findIndex(m=>cur && m.id===cur.id);
  i = i<0 ? 0 : (i + dir + musics.length) % musics.length;
  return musics[i];
}
$('muNext').addEventListener('click', async ()=>{
  const m = await neighborMusic(1);
  if(m){try{await startMusic(m);}catch(e){toast(e.message);}}
});
$('muPrev').addEventListener('click', async ()=>{
  const m = await neighborMusic(-1);
  if(m){try{await startMusic(m);}catch(e){toast(e.message);}}
});
$('muShuffle').addEventListener('click', async ()=>{
  const musics = await dbAll('music');
  if(!musics.length){ toast('音乐库为空'); return; }
  const m = musics[Math.floor(Math.random()*musics.length)];
  try{await startMusic(m);}catch(e){toast(e.message);}
});
$('muListBtn').addEventListener('click', ()=>$('muDrawer').scrollIntoView({block:'start'}));
$('muDrawerClose').addEventListener('click', ()=>$('muName').scrollIntoView({block:'center'}));
$('muSeek').addEventListener('input', e=>{
  const el = player.activeEl();
  if(el && el.duration) $('muCur').textContent = fmtTime(e.target.value/1000*el.duration);
});
$('muSeek').addEventListener('change', e=>player.seek(e.target.value/1000));
$('muVol').addEventListener('input', e=>player.setVolume(e.target.value/100));
setInterval(()=>{
  if(state.page!=='music') return;
  const el = player.activeEl();
  if(player.ctx && el && el.src && el.duration){
    $('muSeek').value = Math.round(el.currentTime/el.duration*1000);
    $('muCur').textContent = fmtTime(el.currentTime);
    $('muDur').textContent = fmtTime(el.duration);
  }else{
    $('muSeek').value = 0; $('muCur').textContent='0:00'; $('muDur').textContent='0:00';
  }
}, 400);

/* 上传 + 合成氛围音 */
async function addMusicFile(file){
  const music = {id:uid(), name:file.name.replace(/\.[^.]+$/,''), size:file.size, tags:[], blob:file, addedAt:Date.now(), duration:0};
  await dbPut('music', music);
  const a = new Audio(URL.createObjectURL(file));
  a.addEventListener('loadedmetadata', async ()=>{
    music.duration = a.duration || 0;
    URL.revokeObjectURL(a.src);
    await dbPut('music', music);
    renderMusicList();
  });
}
function encodeWav(buffer){
  const nCh = buffer.numberOfChannels, len = buffer.length, sr = buffer.sampleRate;
  const bytes = 44 + len*nCh*2;
  const ab = new ArrayBuffer(bytes), v = new DataView(ab);
  const ws = (o,s)=>{ for(let i=0;i<s.length;i++) v.setUint8(o+i, s.charCodeAt(i)); };
  ws(0,'RIFF'); v.setUint32(4, bytes-8, true); ws(8,'WAVE'); ws(12,'fmt ');
  v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,nCh,true);
  v.setUint32(24,sr,true); v.setUint32(28,sr*nCh*2,true); v.setUint16(32,nCh*2,true); v.setUint16(34,16,true);
  ws(36,'data'); v.setUint32(40, len*nCh*2, true);
  const chans = []; for(let c=0;c<nCh;c++) chans.push(buffer.getChannelData(c));
  let off = 44;
  for(let i=0;i<len;i++) for(let c=0;c<nCh;c++){
    const s = clamp(chans[c][i], -1, 1);
    v.setInt16(off, s<0 ? s*0x8000 : s*0x7FFF, true); off += 2;
  }
  return new Blob([ab], {type:'audio/wav'});
}
async function synthAmbience(kind){
  const sr = 44100, dur = 45;
  const ctx = new OfflineAudioContext(2, sr*dur, sr);
  const len = sr*dur;
  const buf = ctx.createBuffer(2, len, sr);
  for(let c=0;c<2;c++){
    const d = buf.getChannelData(c);
    for(let i=0;i<len;i++) d[i] = Math.random()*2-1;
  }
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const filt = ctx.createBiquadFilter();
  const g = ctx.createGain();
  let name='', tag='';
  if(kind==='rain'){ filt.type='lowpass'; filt.frequency.value=2600; g.gain.value=0.22; name='夜雨'; tag='平静'; }
  if(kind==='wave'){ filt.type='lowpass'; filt.frequency.value=650; g.gain.value=0.05; name='海浪'; tag='温馨'; }
  if(kind==='drone'){ filt.type='lowpass'; filt.frequency.value=180; filt.Q.value=1.2; g.gain.value=0.5; name='深渊低鸣'; tag='紧张'; }
  const lfo = ctx.createOscillator();
  const lfoG = ctx.createGain();
  if(kind==='wave'){ lfo.frequency.value=0.1; lfoG.gain.value=0.3; }
  else if(kind==='drone'){ lfo.frequency.value=0.07; lfoG.gain.value=0.12; }
  else { lfo.frequency.value=0.2; lfoG.gain.value=0.06; }
  lfo.connect(lfoG).connect(g.gain);
  src.connect(filt).connect(g).connect(ctx.destination);
  src.start(); lfo.start();
  const rendered = await ctx.startRendering();
  const blob = encodeWav(rendered);
  const music = {id:uid(), name, size:blob.size, tags:[tag], blob, addedAt:Date.now(), duration:dur};
  await dbPut('music', music);
  return music;
}
$('fileMusic').addEventListener('change', async e=>{
  for(const f of e.target.files) await addMusicFile(f);
  e.target.value=''; toast('已加入收藏');renderMusicList();if(state.page==='library') renderLibrary();
});
document.querySelectorAll('[data-synth]').forEach(b=>b.addEventListener('click', async ()=>{
  b.disabled = true;
  try{ await synthAmbience(b.dataset.synth); toast('氛围音已加入收藏');renderMusicList();updateMusicUI();if(state.page==='library') renderLibrary(); }
  catch(e){ toast('生成失败：'+e.message); }
  b.disabled = false;
}));

/* ================================================================
   情境配乐预设页
================================================================ */
async function renderCine(){
  const books = (await dbAll('books')).filter(b=>!b.type);
  const box = $('cineBox');
  if(!books.length){
    box.innerHTML = '<h1 class="big-title">情境配乐</h1><p class="muted">书库为空，请先导入小说（漫画暂不支持情绪分析）</p>';
    return;
  }
  books.sort((a,b)=>b.addedAt-a.addedAt);
  if(!state.cineBookId || !books.find(b=>b.id===state.cineBookId)) state.cineBookId = books[0].id;
  const book = books.find(b=>b.id===state.cineBookId);
  const analyses = await dbAll('analyses');

  box.innerHTML = `
    <h1 class="big-title">情境配乐</h1>
    <p class="muted" style="margin:-14px 0 18px">AI 预分析每章情绪节点（可手动编辑），再把情绪绑定到曲目——阅读时自动渐入渐出切换</p>
    <div class="row" style="margin-bottom:14px">
      <select class="sel" id="cineBookSel" style="max-width:280px">
        ${books.map(b=>`<option value="${b.id}" ${b.id===state.cineBookId?'selected':''}>《${esc(b.title)}》</option>`).join('')}
      </select>
      <button class="btn primary" id="btnBatch">⚡ 批量分析未分析章节</button>
      <span class="muted" id="batchInfo"></span>
    </div>
    <div id="chCards"></div>
    <div class="card">
      <div class="row" style="margin-bottom:6px">
        <b style="letter-spacing:2px">情绪 → 曲目映射</b>
        <span class="muted">阅读时按此表选曲</span>
        <div class="grow"></div>
        <button class="btn small" id="btnAutoMap">按曲目标签自动映射</button>
      </div>
      <div id="mapRows"></div>
    </div>`;

  $('cineBookSel').addEventListener('change', e=>{ state.cineBookId = e.target.value; renderCine(); });
  $('btnBatch').addEventListener('click', ()=>batchAnalyze(state.cineBookId));
  $('btnAutoMap').addEventListener('click', async ()=>{
    const musics = await dbAll('music');
    const mapping = getMapping();
    let n = 0;
    for(const m of musics){
      for(const t of m.tags){
        if(!mapping[t]){ mapping[t] = m.id; n++; break; }
      }
    }
    saveMapping(mapping);
    toast(n ? `已自动映射 ${n} 个情绪` : '没有可自动映射的情绪（先给曲目打标签）');
    renderCine();
  });

  const cards = $('chCards');
  for(let i=0;i<book.chapters.length;i++){
    const a = analyses.find(x=>x.key===anaKey(book.id,i));
    const card = document.createElement('div');
    card.className = 'card ch-card';
    card.innerHTML = `
      <div class="ch-head">
        <span class="muted" style="min-width:2.2em">${i+1}.</span>
        <b class="grow">${esc(book.chapters[i].title)}</b>
        <span class="st ${a?'done':''}">${a ? a.nodes.length+' 个情绪节点' : '未分析'}</span>
        <button class="btn small" data-ana>${a?'重新分析':'AI 分析'}</button>
        <button class="btn small" data-fold>${a?'编辑':'手动添加'}</button>
      </div>
      <div class="nodes hidden"></div>`;
    const nodesBox = card.querySelector('.nodes');
    const renderNodes = async ()=>{
      const an = await dbGet('analyses', anaKey(book.id,i));
      const nodes = an ? an.nodes : [{at:0, emotion:'平静', note:''}];
      nodesBox.innerHTML = nodes.map(n=>`
        <div class="node-row">
          <span class="muted">at%</span>
          <input type="number" class="n-at" min="0" max="100" value="${n.at}">
          <select class="n-em">${EMOTIONS.map(e=>`<option ${e.label===n.emotion?'selected':''}>${e.label}</option>`).join('')}${EMO_LABELS.includes(n.emotion)?'':`<option selected>${esc(n.emotion)}</option>`}</select>
          <input type="text" class="n-note" value="${esc(n.note)}" placeholder="情绪说明（可空）">
          <button class="btn small danger" data-nodel>✕</button>
        </div>`).join('') +
        '<div class="row"><button class="btn small" data-nadd>＋ 添加节点</button><span class="muted">at 为情绪出现位置（章节进度 0-100%），修改即时保存</span></div>';
      const persist = async ()=>{
        const ns = [...nodesBox.querySelectorAll('.node-row')].map(r=>({
          at: clamp(parseInt(r.querySelector('.n-at').value)||0, 0, 100),
          emotion: r.querySelector('.n-em').value,
          note: r.querySelector('.n-note').value.trim()
        })).filter(n=>n.emotion);
        ns.sort((a,b)=>a.at-b.at);
        if(ns.length) await dbPut('analyses', {key:anaKey(book.id,i), bookId:book.id, chIdx:i, nodes:ns, ts:Date.now()});
        else await dbDel('analyses', anaKey(book.id,i));
        const st = card.querySelector('.st');
        st.className = 'st '+(ns.length?'done':'');
        st.textContent = ns.length ? ns.length+' 个情绪节点' : '未分析';
      };
      nodesBox.addEventListener('change', persist);
      nodesBox.addEventListener('click', async e=>{
        if(e.target.closest('[data-nadd]')){
          const rows = [...nodesBox.querySelectorAll('.node-row')];
          const last = rows[rows.length-1];
          const html = last.outerHTML.replace(/value="\d+"/, 'value="50"');
          nodesBox.querySelector('.row').insertAdjacentHTML('beforebegin', html);
          persist();
        }
        if(e.target.closest('[data-nodel]')){
          if(nodesBox.querySelectorAll('.node-row').length <= 1){ toast('至少保留一个节点'); return; }
          e.target.closest('.node-row').remove();
          persist();
        }
      });
    };
    card.querySelector('[data-ana]').addEventListener('click', async e=>{
      const b = e.target.closest('button');
      b.disabled = true; b.textContent = '分析中…';
      try{
        await analyzeChapter(book.id, i);
        toast(`《${book.chapters[i].title}》分析完成`);
        renderCine();
      }catch(err){ toast('分析失败：'+err.message); b.disabled=false; b.textContent='AI 分析'; }
    });
    card.querySelector('[data-fold]').addEventListener('click', async ()=>{
      nodesBox.classList.toggle('hidden');
      if(!nodesBox.classList.contains('hidden') && !nodesBox.innerHTML) await renderNodes();
    });
    cards.appendChild(card);
  }

  const musics = await dbAll('music');
  const mapping = getMapping();
  const mapRows = $('mapRows');
  EMOTIONS.forEach(e=>{
    const row = document.createElement('div');
    row.className = 'map-row';
    const cur = mapping[e.label] || '';
    row.innerHTML = `
      <span class="dot" style="background:${e.color}"></span>
      <b style="min-width:3em">${e.label}</b>
      <select>
        <option value="">（未绑定）</option>
        ${musics.map(m=>`<option value="${m.id}" ${m.id===cur?'selected':''}>${esc(m.name)}</option>`).join('')}
      </select>`;
    row.querySelector('select').addEventListener('change', async ev=>{
      const mp = getMapping();
      if(ev.target.value) mp[e.label] = ev.target.value; else delete mp[e.label];
      saveMapping(mp);
      toast(ev.target.value ? `「${e.label}」已绑定` : `「${e.label}」已解绑`);
    });
    mapRows.appendChild(row);
  });
}

async function batchAnalyze(bookId){
  const book = await dbGet('books', bookId);
  const todo = [];
  for(let i=0;i<book.chapters.length;i++){
    if(!(await dbGet('analyses', anaKey(bookId,i)))) todo.push(i);
  }
  if(!todo.length){ toast('所有章节都已分析过了'); return; }
  state.batchStop = false;
  const btn = $('btnBatch'), info = $('batchInfo');
  btn.textContent = '⏹ 停止批量分析';
  btn.onclick = ()=>{ state.batchStop = true; };
  let ok = 0, fail = 0;
  for(let n=0; n<todo.length; n++){
    if(state.batchStop) break;
    info.textContent = `分析中 ${n+1}/${todo.length}：${book.chapters[todo[n]].title}`;
    try{ await analyzeChapter(bookId, todo[n]); ok++; }
    catch(e){ fail++; console.warn(e); }
    await sleep(300);
  }
  btn.textContent = '⚡ 批量分析未分析章节';
  btn.onclick = ()=>batchAnalyze(bookId);
  info.textContent = '';
  toast(`批量分析结束：成功 ${ok} 章${fail?`，失败 ${fail} 章`:''}`);
  renderCine();
}

/* ================================================================
   在线内容目录：网络层 + 公开源 + 搜索 / 收藏 + 漫画阅读
================================================================ */
