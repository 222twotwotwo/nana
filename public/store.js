'use strict';
let SOURCES=[], HAS_SERVER=false;
const SOURCE_ALIASES={'srv:novel:0':'kuwo','srv:novel:1':'yueyou','srv:comic:0':'manhuaren','srv:comic:1':'dm5'};
const sourceId=id=>SOURCE_ALIASES[id]||id;
async function api(path,body) {
  const r=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(90000)});
  const d=await r.json();
  if(!r.ok) throw new Error(d.error||`请求失败 ${r.status}`);
  return d;
}
async function initServer() {
  try { SOURCES=(await api('/api/sources')).sources;HAS_SERVER=true; }
  catch { HAS_SERVER=false; }
  if(state.page==='home') renderHome();
  if(state.page==='settings') renderSourceHealth();
}
function mediaUrl(source,url,referer='') {
  if(!url) return '';
  return '/api/image?'+new URLSearchParams({source:sourceId(source),url,referer});
}
function getStoreSource(id) {
  const meta=SOURCES.find(s=>s.id===sourceId(id));
  if(!meta) return null;
  const action=async(action,value)=>(await api('/api/action',{source:meta.id,action,value})).data;
  return {...meta,
    async search(kw) { return (await action('search',kw)).map(x=>({...x,srcId:meta.id,cover:mediaUrl(meta.id,x.cover)})); },
    async detail(url) { const d=await action('detail',url);return {...d,srcId:url,cover:mediaUrl(meta.id,d.cover)}; },
    async content(ch) { return (await action('content',ch.url||ch.ref)).text; },
    async pages(book,ch) { const d=await action('content',ch.url||ch.ref);return d.images.map(url=>mediaUrl(meta.id,url,d.referer)); }
  };
}
const writes=new Map(),chapterLoads=new Map();
async function saveChapter(book,idx,text) {
  const work=(writes.get(book.id)||Promise.resolve()).catch(()=>{}).then(async()=>{
    const current=await dbGet('books',book.id);
    if(!current) throw new Error('书籍已从书库移除');
    current.chapters[idx].text=text;
    current.charCount=current.chapters.reduce((n,c)=>n+(c.text?.length||0),0);
    await dbPut('books',current);
    book.chapters[idx].text=text; book.charCount=current.charCount;
  });
  writes.set(book.id,work);
  try { await work; } finally { if(writes.get(book.id)===work) writes.delete(book.id); }
}
async function ensureChapterText(book,idx) {
  if(book.chapters[idx].text) return book.chapters[idx].text;
  const key=book.id+':'+idx;
  if(chapterLoads.has(key)) return chapterLoads.get(key);
  const work=(async()=>{
    if(!SOURCES.length) await initServer();
    const src=getStoreSource(book.source);
    if(!src) throw new Error('来源暂不可用，请启动服务或到主页重新搜索并收藏。已缓存章节仍可阅读。');
    const text=await src.content(book.chapters[idx]);
    if(!text || text.length<80) throw new Error('本章正文为空，请稍后重试或更换来源');
    await saveChapter(book,idx,text);return text;
  })();
  chapterLoads.set(key,work);
  try { return await work; } finally { chapterLoads.delete(key); }
}
async function cacheChapters(book) {
  const job={stop:false};cacheJob=job;
  const count=Math.min(50,book.chapters.length);let done=0,failed=0;
  $('smProgress').innerHTML='<div class="prog"><i id="smProgBar"></i></div><div class="row"><span class="muted grow" id="smProgText"></span><button class="btn small" id="smStop">停止缓存</button></div>';
  $('smStop').onclick=()=>{job.stop=true;};
  for(let i=0;i<count&&!job.stop;i++) {
    try {await ensureChapterText(book,i);}catch{failed++;}
    done++;
    if(cacheJob===job&&$('smProgText')) {
      $('smProgBar').style.width=(done/count*100)+'%';
      $('smProgText').textContent=`已处理 ${done}/${count} 章 · ${failed} 章失败，目录已保留`;
    }
    await sleep(300);
  }
  toast(`${job.stop?'已停止':'缓存完成'}：${done-failed} 章可离线阅读${failed?`，${failed} 章待重试`:''}`);
  if(cacheJob===job) cacheJob=null;
}
async function renderComicChapter(idx) {
  const book=state.book,ch=book.chapters[idx],request=chapterRequest;
  const body=$('chapterBody');body.classList.add('comic');body.style.fontSize='';setReaderLayout();
  body.innerHTML=`<h1>${esc(ch.title)}</h1><div class="ch-sub">《${esc(book.title)}》 · ${idx+1}/${book.chapters.length}</div><div class="comic-wrap" id="comicWrap"><p class="muted">正在加载图片…</p></div><div class="rd-nav">${idx>0?'<button class="btn small" data-step="-1">上一话</button>':''}${idx<book.chapters.length-1?'<button class="btn small" data-step="1">下一话</button>':''}</div>`;
  body.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>{state.chIdx=idx+Number(b.dataset.step);renderDrawer();renderChapter(state.chIdx);});
  $('rdHeadTitle').innerHTML=`<b>${esc(book.title)}</b> ${esc(ch.title)}`;
  state.nodes=[];updateFab();
  try {
    if(!SOURCES.length) await initServer();
    const src=getStoreSource(book.source);
    if(!src) throw new Error('原漫画来源未接入，请到主页重新搜索并收藏。');
    const pages=await src.pages(book,ch);
    if(request!==chapterRequest||state.book.id!==book.id) return;
    const wrap=$('comicWrap');wrap.innerHTML='';
    for(const [i,url] of pages.entries()) {
      const figure=document.createElement('div'),img=document.createElement('img');
      img.alt=`${ch.title} · 第 ${i+1} 页`;img.loading=i<2?'eager':'lazy';img.src=url;
      img.onerror=()=>{
        const retry=document.createElement('button');retry.className='btn';retry.textContent=`第 ${i+1} 页加载失败，点击重试`;
        retry.onclick=()=>{retry.remove();img.src=url+'&retry='+Date.now();};
        if(!figure.querySelector('button')) figure.append(retry);
      };
      figure.append(img);wrap.append(figure);
    }
    const p=getProgress()[book.id],scroll=$('readerScroll');
    saveProgress(book.id,idx,p&&p.chIdx===idx?p.pct||0:0);
    const restore=()=>{if(request===chapterRequest) scroll.scrollTop=(p&&p.chIdx===idx?(p.pct||0)/100:0)*(scroll.scrollHeight-scroll.clientHeight);};
    // Restore once the first visible page establishes a height; later images load lazily.
    const first=wrap.querySelector('img');if(first.complete) restore();else first.addEventListener('load',restore,{once:true});
  } catch(e) {
    if(request!==chapterRequest) return;
    $('comicWrap').innerHTML=`<p>${esc(e.message)}</p><button class="btn" id="retryComic">重试本话</button>`;
    $('retryComic').onclick=()=>renderChapter(idx);
  }
  updateEmotion(true);
}
async function renderSourceHealth() {
  const box=$('sourceHealth');if(!box) return;
  if(!HAS_SERVER) {box.innerHTML='<p>服务未连接，请运行 npm start 后刷新页面。</p>';return;}
  const labels={healthy:'样本可读',failed:'检测失败',stale:'检测已过期',unchecked:'尚未检测'};
  box.innerHTML=SOURCES.map(s=>`<div class="source-row"><div><b>${esc(s.name)}</b> · ${labels[s.status]}<p class="muted">${esc(s.note)}</p><p class="muted">${s.health?esc(new Date(s.health.checkedAt).toLocaleString('zh-CN')+' · '+(s.health.ok?`${s.health.sample} / ${s.type==='music'?`音频已读取 ${s.health.audioBytes||0} 字节${s.health.preview?'（试听）':''}`:`${s.health.chapters} 章`}`:`${s.health.stage}：${s.health.error}`)):'点击检测确认当前网络可用性'}</p></div><button class="btn small" data-check="${s.id}">重新检测</button></div>`).join('');
  box.querySelectorAll('[data-check]').forEach(b=>b.onclick=async()=>{
    b.disabled=true;b.textContent='检测中…';
    try {
      const r=(await api('/api/check',{source:b.dataset.check})).data;
      SOURCES=(await api('/api/sources')).sources;
      toast(r.ok?'样本链路检测通过':`检测失败：${r.error}`);renderSourceHealth();
    }catch(e){toast(e.message);b.disabled=false;b.textContent='重新检测';}
  });
}
