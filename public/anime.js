'use strict';
let animeRequest=0,animeBook=null,animeEpisode=0,animeHls=null,hlsLoader=null;
function loadHls() {
  if(window.Hls) return Promise.resolve(window.Hls);
  if(hlsLoader) return hlsLoader;
  hlsLoader=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://registry.npmmirror.com/hls.js/1.6.16/files/dist/hls.min.js';
    script.onload=()=>window.Hls?resolve(window.Hls):reject(new Error('HLS 播放器加载失败'));
    script.onerror=()=>reject(new Error('HLS 播放器加载失败'));
    document.head.append(script);
  });
  return hlsLoader;
}
function stopAnime() {
  const video=$('animeVideo');if(video){if(animeBook) saveMediaProgress(animeBook.id,animeEpisode,video);video.pause();video.removeAttribute('src');video.load();}
  if(animeHls){animeHls.destroy();animeHls=null;}
  animeRequest++;
}
async function startAnime(book) {
  stopAnime();animeBook=book;state.store.type='anime';showPage('anime');
  const progress=getProgress()[book.id],idx=clamp(progress?.chIdx||0,0,book.chapters.length-1);
  $('animeBox').innerHTML=`<div class="section-heading"><h1 class="big-title">${esc(book.title)}</h1><button class="btn small" id="animeBack">返回收藏</button></div><p class="muted">${esc(book.sourceName||'番剧')} · ${book.chapters.length} 集</p><div id="animePlayer"></div><h2 class="sec-title">选集</h2><div class="anime-episodes">${book.chapters.map((chapter,i)=>`<button class="btn small" data-ep="${i}">${esc(chapter.title||`第 ${i+1} 集`)}</button>`).join('')}</div>`;
  $('animeBack').onclick=()=>openCategory('anime','library');
  $('animeBox').querySelectorAll('[data-ep]').forEach(button=>button.onclick=()=>playAnime(Number(button.dataset.ep)));
  await playAnime(idx);
}
async function playAnime(idx) {
  stopAnime();const request=animeRequest,book=animeBook,chapter=book.chapters[idx],box=$('animePlayer');animeEpisode=idx;
  const previous=getProgress()[book.id];
  const resume=previous?.chIdx===idx?previous.time||0:0;
  document.querySelectorAll('[data-ep]').forEach(button=>{const on=Number(button.dataset.ep)===idx;button.classList.toggle('primary',on);button.setAttribute('aria-pressed',String(on));});
  box.innerHTML='<p class="store-empty">正在加载播放地址…</p>';
  try {
    const d=(await api('/api/action',{source:book.source,action:'play',value:chapter.url})).data;
    if(request!==animeRequest||state.page!=='anime') return;
    const stream=musicPageUrl(d.stream);if(!stream) throw new Error('播放地址无效');
    const original=musicPageUrl(chapter.url);
    box.innerHTML='<video id="animeVideo" controls playsinline preload="metadata"></video>';
    box.insertAdjacentHTML('beforeend',`<div class="section-heading"><span>${esc(chapter.title)}</span>${original?`<a class="btn small" href="${esc(original)}" target="_blank" rel="noopener noreferrer">原站</a>`:''}</div><p id="animePlayError" class="muted" role="status"></p>`);
    const video=$('animeVideo');let lastSave=0;
    if(/\.m3u8(?:$|[?#])/i.test(stream)) {
      const Hls=await loadHls();
      if(request!==animeRequest||state.page!=='anime') return;
      if(!Hls.isSupported()) throw new Error('当前浏览器不支持 HLS 播放');
      animeHls=new Hls();animeHls.loadSource(stream);animeHls.attachMedia(video);
    } else { video.src=stream;video.load(); }
    video.addEventListener('loadedmetadata',()=>{if(request===animeRequest&&resume>0&&resume<video.duration) video.currentTime=resume;});
    const save=()=>{if(request===animeRequest) saveMediaProgress(book.id,idx,video);};
    video.addEventListener('timeupdate',()=>{if(Date.now()-lastSave>1000){lastSave=Date.now();save();}});
    video.addEventListener('pause',save);video.addEventListener('ended',save);
    video.addEventListener('error',()=>{if(request===animeRequest) $('animePlayError').textContent='视频加载失败，请重试选集或前往原站播放。';});
    if(previous?.chIdx!==idx) saveProgress(book.id,idx,0);
  } catch(e) {
    if(request!==animeRequest||state.page!=='anime') return;
    box.innerHTML=`<p class="store-empty">${esc(e.message)}</p><button class="btn" id="animeRetry">重试</button>${musicPageUrl(chapter.url)?`<a class="btn" href="${esc(musicPageUrl(chapter.url))}" target="_blank" rel="noopener noreferrer">原站</a>`:''}`;
    $('animeRetry').onclick=()=>playAnime(idx);
  }
}
