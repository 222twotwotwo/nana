'use strict';
function renderCategoryButtons() {
  document.querySelectorAll('[data-stype],[data-ctype]').forEach(button=>{
    const on=(button.dataset.stype||button.dataset.ctype)===state.store.type;
    button.classList.toggle('on',on);button.setAttribute('aria-pressed',String(on));
  });
}
function openCategory(type,page='home') {
  if(!CONTENT_TYPES[type]) return;
  if(state.store.type!==type) {
    resetSearch();state.store.type=type;$('storeKw').value='';player.playRequest++;
  }
  showPage(page);
}
function openDiscovery(type=state.store.type) {
  state.store.discover=true;openCategory(type);$('storeKw').focus();
}
$('closeSearch').onclick=()=>{state.store.discover=false;renderHome();};
function storedItem(record,type) {
  return {id:type==='music'?record.sourceUrl||record.audio:record.srcId,srcId:record.source,localId:record.id,type,
    name:record.title||record.name,author:record.author,cover:record.cover,sourceName:record.sourceName||SOURCES.find(s=>s.id===sourceId(record.source))?.name||'本地收藏',
    duration:record.duration,preview:record.preview,pageUrl:record.pageUrl,parts:record.chapters?.length,meta:record.intro||'',addedAt:record.addedAt||0};
}
async function savedContent(type) {
  const rows=await dbAll(type==='music'?'music':'books');
  return rows.filter(row=>type==='music'||(row.type||'novel')===type).sort((a,b)=>b.addedAt-a.addedAt).map(row=>storedItem(row,type));
}
function progressLabel(item) {
  const p=getProgress()[item.localId],meta=CONTENT_TYPES[item.type];
  if(!p) return '未'+meta.verb;
  if(item.type==='music') return `已播放 ${fmtTime(p.time||0)}`;
  return `第 ${p.chIdx+1} ${meta.part} · ${Math.round(p.pct||0)}%`;
}
function createContentCard(item) {
  const el=document.createElement('div');el.className='bk sr catalog-card'+(item.localId?' saved':'');el.dataset.type=item.type;
  const progress=getProgress()[item.localId];
  const percent=progress?clamp(progress.pct||0,0,100):0;
  el.innerHTML=`<button class="catalog-open" aria-label="${esc(item.name+' · '+(item.sourceName||'')+(item.localId?' · '+progressLabel(item):''))}">${coverHTML(item)}<div class="catalog-copy"><div class="sr-name">${esc(item.name)}</div><div class="sr-meta">${esc(item.author||item.meta||CONTENT_TYPES[item.type].label)}</div><div class="sr-source">${esc(item.sourceName||'')}</div></div></button>${item.localId?`<div class="bc-foot"><span title="${esc(progressLabel(item))}">${progress?Math.round(percent)+'%':'未'+CONTENT_TYPES[item.type].verb}</span><button class="bc-more" aria-label="${esc(item.name)}的详情与操作">⋯</button></div>`:''}`;
  el.querySelector('.catalog-open').onclick=()=>openStoreModal(item);
  if(item.localId) el.querySelector('.bc-more').onclick=()=>openStoreModal(item);
  return el;
}
function renderStore() {
  const st=state.store,meta=CONTENT_TYPES[st.type],srcs=SOURCES.filter(s=>s.type===st.type);
  renderCategoryButtons();
  $('homeSearch').classList.toggle('hidden',!st.discover);
  $('homeOverview').classList.toggle('hidden',!!st.discover);
  document.querySelectorAll('#mainSeg button').forEach(button=>button.classList.toggle('on',button.dataset.nav===(state.page==='home'&&st.discover?'search':state.page)));
  $('btnStoreSearch').disabled=!!st.loading;
  $('storeKw').placeholder=meta.placeholder;
  if(!st.searched&&!st.loading) st.status=HAS_SERVER?`同时搜索 ${srcs.length} 个${meta.label}来源`:'在线来源未连接，搜索时将重试连接。已收藏内容可在收藏页打开。';
  $('storeStatus').textContent=st.status||'';
  $('storeErrors').textContent=st.error||'';
  renderStoreResults();
}
function coverHTML(item) {return coverInner(item.name||'未命名',item.cover);}
function renderStoreResults() {
  const st=state.store,grid=$('storeGrid'),meta=CONTENT_TYPES[st.type];
  grid.innerHTML='';
  if(!st.items.length) {
    grid.innerHTML=`<p class="muted store-empty">${esc(st.loading?'正在搜索…':st.error||(st.searched?'没有找到相关内容，换个关键词试试。':`搜索喜欢的${meta.label}，打开详情后可${meta.verb}或加入收藏。`))}</p>`;
    return;
  }
  for(const item of st.items) grid.append(createContentCard(item));
}
let searchRequest=0;
async function doStoreSearch() {
  const kw=$('storeKw').value.trim(),st=state.store,type=st.type,meta=CONTENT_TYPES[type];
  if(!kw) return toast('请输入关键词');
  const request=++searchRequest;
  Object.assign(st,{discover:true,loading:true,searched:true,items:[],error:'',status:'正在连接来源…'});renderStore();
  try {
    if(!HAS_SERVER||!SOURCES.length) await initServer();
    if(request!==searchRequest) return;
    const srcs=SOURCES.filter(s=>s.type===type);
    if(!HAS_SERVER||!srcs.length) throw new Error(`暂无可用${meta.label}来源，请稍后重试`);
    let complete=0;const failed=[],seen=new Set();
    await Promise.all(srcs.map(async source=>{
      try {
        const rows=await getStoreSource(source.id).search(kw);
        if(request!==searchRequest) return;
        for(const item of rows) {
          const key=source.id+':'+item.id;if(seen.has(key)) continue;seen.add(key);
          st.items.push({...item,type,srcId:source.id,sourceName:source.name});
        }
      } catch(error) {failed.push(source.name+'：'+error.message);}
      finally {
        complete++;
        if(request===searchRequest) {
          st.status=`找到 ${st.items.length} ${meta.unit} · 已完成 ${complete}/${srcs.length} 个来源${failed.length?`，${failed.length} 个来源暂不可用`:''}`;
          st.error=failed.join('；');renderStore();
        }
      }
    }));
    if(request!==searchRequest) return;
    const norm=s=>String(s||'').toLocaleLowerCase().replace(/[\s《》「」【】:：·,.，。!?！？]/g,'');
    const rank=item=>{const n=norm(item.name),k=norm(kw);return n===k?0:n.startsWith(k)?1:n.includes(k)?2:3;};
    st.items.sort((a,b)=>rank(a)-rank(b)||a.name.localeCompare(b.name,'zh-CN'));
  } catch(e) {if(request===searchRequest) st.error=e.message;}
  finally {if(request===searchRequest){st.loading=false;renderStore();}}
}
$('storeBar').onsubmit=e=>{e.preventDefault();doStoreSearch();};
function resetSearch() {
  searchRequest++;closeStoreModal();Object.assign(state.store,{loading:false,items:[],error:'',status:'',searched:false});
}
if($('storeTypeSeg')) $('storeTypeSeg').onclick=e=>{const button=e.target.closest('[data-stype]');if(button) openCategory(button.dataset.stype);};
let modalRequest=0,cacheJob=null;
function closeStoreModal() {
  modalRequest++;if(cacheJob) cacheJob.stop=true;
  $('storeModal').classList.add('hidden');$('storeModal').innerHTML='';
}
function modalFrame(content) {
  const modal=$('storeModal');modal.classList.remove('hidden');
  modal.innerHTML=`<div class="sm-box"><button class="sm-close" id="smClose" aria-label="关闭">✕</button>${content}</div>`;
  $('smClose').onclick=closeStoreModal;modal.onclick=e=>{if(e.target===modal) closeStoreModal();};
}
document.addEventListener('keydown',e=>{if(e.key==='Escape') closeStoreModal();});
const collectionWrites=new Map();
async function openCatalogContent(record,type) {
  if(!record) throw new Error('这项收藏已被移除');
  if(type==='music') return startMusic(record);
  if(type==='anime') return startAnime(record);
  return startReading(record.id);
}
async function saveCatalogItem(src,item,det) {
  const type=item.type||src.type,store=type==='music'?'music':'books',key=type+':'+src.id+':'+item.id;
  if(collectionWrites.has(key)) return collectionWrites.get(key);
  const work=(async()=>{
    const rows=await dbAll(store);
    const existing=rows.find(row=>item.localId?row.id===item.localId:sourceId(row.source)===src.id&&(type==='music'?(row.sourceUrl||row.audio):row.srcId)===item.id);
    if(existing) return existing;
    const common={id:uid(),source:src.id,sourceName:src.name,author:det.author||item.author,cover:det.cover||item.cover,addedAt:Date.now()};
    const record=type==='music'?{...common,name:det.name||item.name,sourceUrl:item.id,pageUrl:item.pageUrl||'',tags:[],duration:Number(item.duration||0),preview:!!item.preview}:
      {...common,srcId:item.id,title:det.name,intro:det.intro||'',charCount:0,chapters:det.chapters.map(ch=>({...ch})),...(type==='novel'?{}:{type})};
    await dbPut(store,record);return record;
  })();
  collectionWrites.set(key,work);
  try{return await work;}finally{collectionWrites.delete(key);}
}
async function removeCollection(record,type) {
  if(!confirm(`将「${record.title||record.name}」移出收藏？${type==='novel'?'已缓存正文和情境分析也将删除。':''}`)) return false;
  await dbDel(type==='music'?'music':'books',record.id);
  if(type==='music') {
    if(player.currentMusic?.id===record.id) player.fadeStop();
    if(state.muSelected?.id===record.id) state.muSelected=null;
    const mapping=getMapping();Object.keys(mapping).forEach(key=>{if(mapping[key]===record.id) delete mapping[key];});saveMapping(mapping);
    renderMusicList();
  } else if(type==='novel') {
    for(const row of (await dbAll('analyses')).filter(row=>row.bookId===record.id)) await dbDel('analyses',row.key);
  }
  const progress=getProgress();delete progress[record.id];localStorage.setItem('nr-progress',JSON.stringify(progress));
  closeStoreModal();if(state.page==='home') renderHome();if(state.page==='library') renderLibrary();
  return true;
}
async function openStoreModal(item) {
  const request=++modalRequest,src=getStoreSource(item.srcId),type=item.type||src?.type||state.store.type,meta=CONTENT_TYPES[type];
  modalFrame('<p class="store-empty">正在读取作品详情…</p>');
  try {
    const rows=await dbAll(type==='music'?'music':'books');
    let saved=rows.find(row=>item.localId?row.id===item.localId:sourceId(row.source)===src?.id&&(type==='music'?(row.sourceUrl||row.audio):row.srcId)===item.id);
    if(request!==modalRequest) return;
    if(item.localId&&!saved) throw new Error('这项收藏已被移除');
    if(!saved&&!src) throw new Error('该来源未连接，请稍后重试');
    const source=src||{id:saved.source,name:saved.sourceName||'本地收藏',type};
    const det=saved?{...saved,name:saved.title||saved.name}:type==='music'?{...item,intro:item.restricted?'原站可能限制播放，可前往原站查看。':item.preview?'此曲目为试听片段。':item.meta||'在线曲目，播放时获取音频。'}:await source.detail(item.id);
    if(request!==modalRequest) return;
    const original=musicPageUrl(item.pageUrl||saved?.pageUrl||item.id);
    modalFrame(`<div class="sm-head">${coverHTML({...item,cover:det.cover||item.cover})}<div class="grow"><div class="sm-title">${esc(det.name)}</div><div class="sm-meta">${meta.label} · ${esc(source.name)}</div><div class="sm-meta">${esc(det.author||item.author||'')}${type==='music'?(det.duration?' · '+fmtTime(det.duration):''):` · ${det.chapters.length} ${meta.part}`}</div></div></div>
      <p class="sm-intro">${esc(det.intro||item.meta||'暂无简介')}</p>
      <div class="row"><button class="btn primary" id="smRead">${saved?'继续':'开始'}${meta.verb}</button><button class="btn" id="smSave" ${saved?'disabled':''}>${saved?'已收藏':'加入收藏'}</button>${original?`<a class="btn" href="${esc(original)}" target="_blank" rel="noopener noreferrer">原站</a>`:''}${saved?'<button class="btn danger" id="smRemove">移出收藏</button>':''}</div>
      <p class="muted detail-note">开始${meta.verb}后自动加入收藏，方便下次继续。${type==='novel'?'正文按需缓存。':type==='music'&&det.preview?'当前为试听片段。':''}</p>
      ${type==='novel'&&source.id?'<button class="btn small" id="smCache">缓存前 50 章</button>':''}<div id="smProgress"></div>`);
    const save=async()=>{saved=await saveCatalogItem(source,{...item,type},det);return saved;};
    const setBusy=busy=>{if(request===modalRequest){$('smRead').disabled=busy;$('smSave').disabled=busy||!!saved;if($('smCache')) $('smCache').disabled=busy;}};
    $('smSave').onclick=async()=>{
      setBusy(true);
      try {await save();if(request===modalRequest){$('smSave').textContent='已收藏';toast('已加入收藏');if(state.page==='home') renderHome();}}
      catch(e){toast(e.message);}finally{setBusy(false);}
    };
    $('smRead').onclick=async()=>{
      setBusy(true);
      try {
        if(type==='music') player.ensureCtx();
        const record=await save();if(request!==modalRequest) return;
        closeStoreModal();
        await openCatalogContent(record,type);
      } catch(e) {toast(e.message);setBusy(false);}
    };
    if($('smRemove')) $('smRemove').onclick=()=>removeCollection(saved,type);
    if($('smCache')) $('smCache').onclick=async()=>{
      setBusy(true);try{await cacheChapters(await save());}catch(e){toast(e.message);}finally{setBusy(false);}
    };
  } catch(e) {
    if(request!==modalRequest) return;
    modalFrame(`<p class="store-empty">${esc(e.message)}</p><button class="btn" id="smRetry">重试</button>`);
    $('smRetry').onclick=()=>openStoreModal(item);
  }
}
