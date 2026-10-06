'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const {IDBFactory}=require('fake-indexeddb');
function setup(t) {
  const root=path.join(__dirname,'../public');
  const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'http://localhost:8761',runScripts:'outside-only'});
  dom.window.indexedDB=new IDBFactory();dom.window.AbortSignal=AbortSignal;
  dom.window.fetch=async()=>({ok:true,json:async()=>({sources:[{id:'kuwo',type:'novel',name:'酷我小说',status:'unchecked'}]})});
  for(const f of ['backup.js','app.js','store.js','catalog.js','music.js','anime.js']) vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),dom.getInternalVMContext());
  t.after(async()=>{await vm.runInContext(`Promise.all([dbAll('books'),dbAll('music')])`,dom.getInternalVMContext());dom.window.close();});
  return {window:dom.window,run:code=>vm.runInContext(code,dom.getInternalVMContext())};
}
test('失败章节保留目录位置，重试成功后离线读取，并发缓存不会互相覆盖',async t=>{
  const {run}=setup(t);
  await run(`dbPut('books',{id:'test',title:'测试',source:'kuwo',chapters:[{title:'一',url:'one'},{title:'二',url:'two'},{title:'三',url:'three'}]})`);
  await run(`initServer()`);
  await run(`getStoreSource=()=>({content:async ch=>{if(ch.url==='two') throw new Error('网络失败');return '正文'.repeat(100);}})`);
  await run(`Promise.all([0,2].map(async i=>ensureChapterText(await dbGet('books','test'),i)))`);
  await assert.rejects(run(`dbGet('books','test').then(b=>ensureChapterText(b,1))`),/网络失败/);
  let book=await run(`dbGet('books','test')`);
  assert.equal(book.chapters.length,3);assert.ok(book.chapters[0].text);assert.ok(book.chapters[2].text);assert.equal(book.chapters[1].text,undefined);
  await run(`getStoreSource=()=>({content:async()=> '重试正文'.repeat(50)})`);
  await run(`dbGet('books','test').then(b=>ensureChapterText(b,1))`);
  await run(`getStoreSource=()=>{throw new Error('离线')}`);
  assert.ok(await run(`dbGet('books','test').then(b=>ensureChapterText(b,1))`));
});
test('后返回的旧章节不能覆盖用户刚切换到的章节',async t=>{
  const {run,window}=setup(t);
  await run(`state.book={id:'race',title:'测试',source:'kuwo',chapters:[{title:'旧章节',url:'one'},{title:'新章节',text:'新正文'}]};state.chIdx=0;let release;ensureChapterText=()=>new Promise(r=>{release=()=>{state.book.chapters[0].text='旧正文';r();}});let oldRender=renderChapter(0);state.chIdx=1;`);
  await run(`renderChapter(1)`);await run(`release();oldRender`);
  assert.match(window.document.getElementById('chapterBody').textContent,/新正文/);
  assert.doesNotMatch(window.document.getElementById('chapterBody').textContent,/旧正文/);
});
test('PC 端纵向滚动，移动端分页并通过滚轮翻页，移除伴读浮条',async t=>{
  const {run,window}=setup(t);
  assert.equal(window.document.getElementById('rdMini'),null);
  await run(`state.page='reader';state.book={id:'paged',title:'分页',chapters:[{title:'一',text:'正文'}]};state.chIdx=0;document.getElementById('chapterBody').classList.remove('comic');Object.defineProperties(document.getElementById('readerScroll'),{clientWidth:{value:1000,configurable:true},clientHeight:{value:600,configurable:true},scrollWidth:{value:2000,configurable:true},scrollHeight:{value:1200,configurable:true}});setReaderLayout();`);
  assert.equal(await run(`document.getElementById('readerScroll').classList.contains('reader-paged')`),false);
  await run(`Object.defineProperties(document.getElementById('readerScroll'),{clientWidth:{value:500,configurable:true},clientHeight:{value:300,configurable:true},scrollWidth:{value:1000,configurable:true},scrollHeight:{value:300,configurable:true}});document.getElementById('readerScroll').scrollLeft=0;document.getElementById('readerScroll').scrollBy=opts=>{document.getElementById('readerScroll').scrollLeft+=opts.left;};setReaderLayout();document.getElementById('readerScroll').dispatchEvent(new WheelEvent('wheel',{deltaY:120}));`);
  assert.equal(await run(`document.getElementById('readerScroll').classList.contains('reader-paged')`),true);
  assert.equal(await run(`document.getElementById('readerScroll').scrollLeft`),500);
  assert.equal(await run(`document.getElementById('chapterBody').style.getPropertyValue('--reader-column-width')`),'229px');
});
test('关闭详情后异步响应不能重新打开弹窗；失败搜索可再次点击',async t=>{
  const {run,window}=setup(t);
  await run(`let resolveDetail,detailStarted;let started=new Promise(r=>detailStarted=r);getStoreSource=()=>({id:'kuwo',name:'测试',detail:()=>new Promise(r=>{resolveDetail=r;detailStarted();})});let opened=openStoreModal({id:'book',srcId:'kuwo'});started;`);
  await run(`closeStoreModal();resolveDetail({name:'晚到',chapters:[]});opened;`);
  assert.equal(window.document.getElementById('storeModal').innerHTML,'');
  await run(`SOURCES=[{id:'kuwo',type:'novel',name:'酷我'}];HAS_SERVER=true;renderStore();getStoreSource=()=>({id:'kuwo',name:'测试',search:async()=>{throw new Error('断线')}});$('storeKw').value='词';doStoreSearch()`);
  assert.equal(window.document.getElementById('btnStoreSearch').disabled,false);
  assert.match(window.document.getElementById('storeGrid').textContent,/断线/);
});
test('书城一次搜索并行查询当前类型全部来源，并在结果中标明来源',async t=>{
  const {run,window}=setup(t);
  await run(`SOURCES=[{id:'one',type:'novel',name:'来源一'},{id:'two',type:'novel',name:'来源二'},{id:'comic',type:'comic',name:'漫画源'}];HAS_SERVER=true;getStoreSource=id=>({id,name:id,search:async()=>id==='one'?[{id:'https://one/book',name:'甲作'}]:id==='two'?(()=>{throw new Error('暂不可用')})():[]});renderStore();$('storeKw').value='剑'`);
  await run(`doStoreSearch()`);
  assert.match(window.document.getElementById('storeStatus').textContent,/1 个来源暂不可用/);
  assert.match(window.document.getElementById('storeGrid').textContent,/甲作/);
  assert.match(window.document.getElementById('storeGrid').textContent,/来源一/);
  assert.equal(window.document.querySelector('#storeSrc'),null);
});
test('旧版本漫画来源编号映射稳定，已有离线小说仍能阅读',async t=>{
  const {run}=setup(t);
  assert.equal(run(`sourceId('srv:comic:0')`),'manhuaren');assert.equal(run(`sourceId('srv:comic:1')`),'dm5');
  assert.equal(await run(`ensureChapterText({chapters:[{text:'旧版已缓存正文'}]},0)`),'旧版已缓存正文');
});
test('备份恢复保留未覆盖书籍，拒绝不符合结构的导入文件',async t=>{
  const {run}=setup(t);
  await run(`dbPut('books',{id:'old',title:'旧书',chapters:[{title:'一',text:'已保存'}]})`);
  await run(`MoyinBackup.restore({stores:{books:[{id:'new',title:'新书',chapters:[{title:'一',text:'新正文'}]}],music:[],analyses:[]},settings:{'nr-progress':{new:{chIdx:0,pct:12}}}})`);
  assert.equal((await run(`dbAll('books')`)).length,2);
  assert.equal(run(`getProgress().new.pct`),12);
  await assert.rejects(run(`MoyinBackup.read({size:10,text:async()=>JSON.stringify({format:'moyin-backup',version:1,stores:{books:[{id:'<script>',title:'bad',chapters:[{}]}],music:[],analyses:[]}})})`),/无效记录编号/);
});

test('四类共用搜索，切换分类后迟到的旧结果不会污染新分类',async t=>{
  const {run,window}=setup(t);
  await run(`SOURCES=[{id:'one',type:'music',name:'音乐源'},{id:'two',type:'anime',name:'番剧源'},{id:'fail',type:'anime',name:'失败源'}];HAS_SERVER=true;let releaseMusic;api=async(path,b)=>{if(b.value==='旧')return new Promise(r=>releaseMusic=()=>r({data:[{id:'old',name:'旧曲'}]}));if(b.source==='fail')throw new Error('源站断线');return {data:[{id:'new',name:'新番'}]};};openCategory('music');$('storeKw').value='旧';let oldMusicSearch=doStoreSearch();`);
  await run(`openCategory('anime');$('storeKw').value='新';doStoreSearch()`);
  await run(`releaseMusic();oldMusicSearch`);
  assert.match(window.document.getElementById('storeGrid').textContent,/新番/);
  assert.doesNotMatch(window.document.getElementById('storeGrid').textContent,/旧曲/);
  assert.match(window.document.getElementById('storeErrors').textContent,/失败源：源站断线/);
  assert.equal(window.document.getElementById('btnStoreSearch').disabled,false);
  assert.equal(run('state.store.type'),'anime');
});

test('同曲并发添加去重，保存稳定来源地址及试听标记，可备份恢复',async t=>{
  const {run}=setup(t);
  await run(`let musicItem={id:'https://music.163.com/song?id=12',type:'music',name:'试听歌',preview:true};let musicSource={id:'netease-music',type:'music',name:'网易云'};Promise.all([saveCatalogItem(musicSource,musicItem,musicItem),saveCatalogItem(musicSource,musicItem,musicItem)])`);
  const rows=await run(`dbAll('music')`);assert.equal(rows.length,1);assert.equal(rows[0].sourceUrl,'https://music.163.com/song?id=12');assert.equal(rows[0].audio,undefined);assert.equal(rows[0].preview,true);
  await run(`MoyinBackup.restore({stores:{books:[],analyses:[],music:[{id:'restored',source:'netease-music',sourceUrl:'https://music.163.com/song?id=12'}]}})`);
  await assert.rejects(run(`MoyinBackup.restore({stores:{music:[{id:'bad',source:'netease-music',sourceUrl:'https://evil.example/song'}]}})`),/无效音乐来源/);
});

test('晚到的音乐取链不抢播后来选择的曲目',async t=>{
  const {run}=setup(t);
  await run(`player.ensureCtx=()=>{};player.activeEl=()=>({duration:100,currentTime:0});let played=[];player.crossfadeTo=async m=>{player.playRequest++;played.push(m.name);return true;};let releaseTrack;api=async(path,b)=>b.value==='old'?new Promise(r=>releaseTrack=()=>r({data:{}})):{data:{}};let oldTrack=startMusic({id:'old',name:'旧曲',source:'test',sourceUrl:'old'});`);
  await run(`startMusic({id:'new',name:'新曲',source:'test',sourceUrl:'new'})`);
  await run(`releaseTrack();oldTrack`);
  assert.deepEqual(Array.from(run('played')),['新曲']);
});

test('主页为混合展示墙，共用详情和收藏操作，各类并发收藏均去重',async t=>{
  const {run,window}=setup(t);
  assert.equal(window.document.querySelector('#storeTypeSeg'),null);
  assert.deepEqual([...window.document.querySelectorAll('#mainSeg button')].map(el=>el.textContent),['主页','书库','']);
  await run(`SOURCES=Object.keys(CONTENT_TYPES).map(type=>({id:type,type,name:type+'来源'}));HAS_SERVER=true;api=async(path,b)=>({data:{name:'测试'+b.source,chapters:[{title:'一',url:'https://example.com/one'}]}});`);
  for(const type of ['novel','comic','music','anime']) {
    await run(`openCategory('${type}');openStoreModal({id:'https://example.com/${type}',srcId:'${type}',type:'${type}',name:'测试${type}'})`);
    assert.equal(window.document.getElementById('smRead').textContent,['novel','comic'].includes(type)?'开始阅读':'开始播放');
    assert.equal(window.document.getElementById('smSave').textContent,'加入收藏');
    assert.equal(window.document.querySelector('#storeModal a').textContent,'原站');
    await run(`Promise.all([$('smSave').onclick(),$('smSave').onclick()])`);
    assert.equal((await run(`savedContent('${type}')`)).length,1);
    assert.equal(window.document.getElementById('smSave').textContent,'已收藏');
  }
});
test('主页展示墙混合显示不同内容类型',async t=>{
  const {run,window}=setup(t);
  await run(`Promise.all([dbPut('books',{id:'anime-wall',type:'anime',title:'番剧墙',addedAt:30,chapters:[{title:'一',url:'https://example.com/a'}]}),dbPut('books',{id:'comic-wall',type:'comic',title:'漫画墙',addedAt:20,chapters:[{title:'一'}]}),dbPut('music',{id:'music-wall',title:'音乐墙',addedAt:10,source:'test',sourceUrl:'https://example.com/m.mp3'})]).then(()=>renderHome())`);
  assert.equal(window.document.querySelector('#storeTypeSeg'),null);
  assert.equal(window.document.querySelectorAll('#homeRecent .home-wall .catalog-card').length,3);
  assert.match(window.document.querySelector('#homeRecent').textContent,/番剧墙/);
  assert.match(window.document.querySelector('#homeRecent').textContent,/漫画墙/);
  assert.match(window.document.querySelector('#homeRecent').textContent,/音乐墙/);
});

test('音乐打开恢复进度，重播从头开始，播放时保留来源试听信息',async t=>{
  const {run}=setup(t);
  await run(`player.ensureCtx=()=>{};let media={duration:100,currentTime:0};player.activeEl=()=>media;player.crossfadeTo=async m=>{player.playRequest++;player.currentId=m.id;player.currentMusic=m;return true;};let resolutions=0;api=async()=>{resolutions++;return {data:{preview:true,duration:100}};};let track={id:'resume',name:'续播歌曲',source:'test',sourceUrl:'https://example.com/song'};saveMediaProgress(track.id,0,{duration:100,currentTime:35});startMusic(track);`);
  assert.equal(run('media.currentTime'),35);
  assert.equal(run('player.currentMusic.preview'),true);
  assert.equal((await run(`dbGet('music','resume')`)).preview,true);
  await run('startMusic(player.currentMusic,false)');
  assert.equal(run('media.currentTime'),0);
  assert.equal(run('getProgress().resume.time'),0);
  assert.equal(run('resolutions'),1);
});

test('四类收藏过滤兼容旧数据，番剧和观看进度可用原备份格式恢复',async t=>{
  const {run,window}=setup(t);
  await run(`MoyinBackup.restore({stores:{books:[{id:'novel',title:'旧小说',chapters:[{title:'一',text:'正文'}]},{id:'comic',type:'comic',title:'旧漫画',chapters:[{title:'一'}]},{id:'anime',type:'anime',title:'新番剧',chapters:[{title:'第1集',url:'https://example.com/1'}]}],music:[{id:'music',name:'本地歌曲'}],analyses:[]},settings:{'nr-progress':{anime:{chIdx:0,time:45,pct:50}}}})`);
  for(const type of ['novel','comic','music','anime']) {
    await run(`state.store.type='${type}';renderLibrary()`);
    assert.equal(window.document.querySelectorAll('#bookGrid .catalog-card').length,1);
    assert.equal((await run(`savedContent('${type}')`))[0].localId,type);
  }
  assert.equal(run(`getProgress().anime.time`),45);
  await run(`SOURCES=[];openStoreModal({type:'novel',localId:'novel',name:'旧小说'})`);
  assert.equal(window.document.getElementById('smRead').textContent,'继续阅读');
});

test('书库移除顶部导入和发现按钮，每个分类首位提供透明加号入口',async t=>{
  const {run,window}=setup(t);
  await run(`MoyinBackup.restore({stores:{books:[{id:'novel',title:'小说',chapters:[{title:'一',text:'正文'}]},{id:'comic',type:'comic',title:'漫画',chapters:[{title:'一'}]},{id:'anime',type:'anime',title:'番剧',chapters:[{title:'一',url:'https://example.com/1'}]}],music:[],analyses:[]}})`);
  assert.equal(window.document.getElementById('btnImport2'),null);
  assert.equal(window.document.getElementById('libraryDiscover'),null);
  for(const type of ['novel','comic','music','anime']) {
    await run(`state.store.type='${type}';renderLibrary()`);
    assert.equal(window.document.querySelectorAll('#bookGrid .library-add').length,1);
    assert.equal(window.document.querySelector('#bookGrid .library-add .cover').textContent.trim(),'＋');
  }
  assert.equal(window.document.querySelector('#bookGrid .library-add').getAttribute('aria-label'),'添加番剧');
});

test('书库不再显示收藏搜索模块',async t=>{
  const {run,window}=setup(t);
  await run(`state.store.type='novel';renderLibrary()`);
  assert.equal(window.document.getElementById('searchBar'),null);
  assert.equal(window.document.getElementById('searchInput'),null);
  assert.equal(window.document.getElementById('libCount'),null);
});

test('主页移除快捷入口，情境配乐放入继续阅读模块',async t=>{
  const {run,window}=setup(t);
  await run(`dbPut('books',{id:'cine-novel',title:'情境小说',chapters:[{title:'第一章',text:'正文'}],addedAt:1}).then(()=>{state.page='home';state.store.type='novel';return renderHome();})`);
  assert.equal(window.document.querySelector('.quick'),null);
  assert.equal(window.document.querySelector('#homeContinue #homeCine')?.textContent,'情境配乐 ♪');
  await run(`$('homeCine').onclick()`);
  assert.equal(run('state.cineBookId'),'cine-novel');
  await run(`dbPut('books',{id:'cine-anime',type:'anime',title:'番剧',chapters:[{title:'第一集',url:'https://example.com/1'}],addedAt:2}).then(()=>{state.page='home';return renderHome();})`);
  assert.equal(window.document.querySelector('#homeContinue #homeCine'),null);
});

test('番剧切集忽略迟到地址，离开时保存时间，重新打开恢复原集数和时间',async t=>{
  const {run,window}=setup(t);
  window.HTMLMediaElement.prototype.pause=function(){};window.HTMLMediaElement.prototype.load=function(){};
  await run(`let show={id:'show',type:'anime',title:'番剧',source:'test',chapters:[{title:'第一集',url:'one'},{title:'第二集',url:'two'}]};let releaseEpisode;api=async(path,b)=>b.value==='one'?new Promise(r=>releaseEpisode=()=>r({data:{stream:'https://example.com/old.mp4'}})):{data:{stream:'https://example.com/new.mp4'}};let opening=startAnime(show);`);
  await run(`playAnime(1)`);
  await run(`releaseEpisode();opening`);
  assert.equal(window.document.getElementById('animeVideo').src,'https://example.com/new.mp4');
  await run(`Object.defineProperty($('animeVideo'),'duration',{value:120});$('animeVideo').currentTime=45;showPage('library');`);
  assert.equal(run(`getProgress().show.chIdx`),1);assert.equal(run(`getProgress().show.time`),45);
  await run(`startAnime(show)`);
  await run(`Object.defineProperty($('animeVideo'),'duration',{value:120});$('animeVideo').dispatchEvent(new Event('loadedmetadata'))`);
  assert.equal(window.document.getElementById('animeVideo').currentTime,45);
});
