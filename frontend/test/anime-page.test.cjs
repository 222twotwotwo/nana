const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const {parse,compileScript}=require('@vue/compiler-sfc');
const descriptor=parse(fs.readFileSync(path.join(__dirname,'../src/components/pages/AnimePage.vue'),'utf8')).descriptor;
const code=ts.transpileModule(compileScript(descriptor,{id:'test'}).content,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const alternative=(source,index=0)=>({source,sourceName:source,srcId:source,chapters:[{title:'第02集',url:source+'-two'},{title:'第01集',url:source+'-one'}],index});

function setup({find=async()=>null,play=async()=>({data:{stream:'https://example.com/video.mp4'}}),mode}={}) {
  let request=0,page;
  const queries=[],plays=[],saved=[],progress=[];
  const state={book:{id:'book',title:'测试第三季',source:'original',sourceName:'original',animeSourceMode:mode,chapters:[{title:'第01集',url:'one'},{title:'第02集',url:'two'}]},episode:1,resumeTime:83};
  const app={page:'anime',toast(){}};
  const listeners=new Map();
  const video={currentTime:0,duration:1000,pause(){},load(){this.currentTime=0;},removeAttribute(){},
    addEventListener:(name,fn)=>listeners.set(name,fn),
    removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);},
    emit:name=>listeners.get(name)?.()
  };
  const modules={
    vue:{defineComponent:x=>x,ref:value=>({value}),computed:get=>({get value(){return get();}}),watch(){},onBeforeUnmount(){},nextTick:async()=>page.setVideo(video)},
    '../../stores/app':{useAppStore:()=>app},
    '../../stores/search':{useSearchStore:()=>({})},
    '../../services/anime':{animeState:state,bumpAnimeRequest:()=>++request,currentAnimeRequest:()=>request,registerAnimeStop(){},episodeKey:title=>title,
      findAlternativeAnime:(...args)=>{queries.push(args);return find(...args);}},
    '../../services/server':{SOURCES:{value:['original','first','second'].map(id=>({id,name:id,type:'anime'}))},sourceId:id=>id,
      api:(url,body)=>{plays.push(body);return play(body);}},
    '../../services/settings':{getProgress:()=>({}),saveMediaProgress:(id,idx,video)=>progress.push({id,idx,time:video.currentTime})},
    '../../services/idb':{dbPut:async(store,book)=>{saved.push(book);}},
    '../../services/music':{musicPageUrl:url=>url}
  };
  const context={exports:{},setTimeout:()=>1,clearTimeout(){},require:id=>{if(!modules[id])throw new Error('unexpected module '+id);return modules[id];}};
  vm.runInNewContext(code,context);
  page=context.exports.default.setup({}, {expose(){}});
  return {page,state,app,video,queries,plays,saved,progress};
}

test('手动失败仅尝试同源线路，切回自动后才允许跨源',async()=>{
  const h=setup({mode:'manual',play:async()=>{throw new Error('连接失败');}});
  h.state.book.chapters[1].alternatives=['second-line'];
  await h.page.start();
  assert.equal(h.queries.length,0);assert.equal(h.plays.length,2);
  assert.equal(h.page.manualSource.value,'original');assert.equal(h.page.view.value.mode,'error');
  assert.equal(h.saved.length,0);
  await h.page.selectSource('');
  assert.equal(h.queries.length,1);assert.equal(h.page.manualSource.value,'');
  assert.equal(h.state.book.animeSourceMode,'auto');
});

test('手动切源保留对应集和进度，媒体加载后才保存选择',async()=>{
  const h=setup({find:async()=>alternative('first')});
  await h.page.start();
  h.video.currentTime=125;
  await h.page.selectSource('first');
  assert.equal(h.queries[0][2].title,'第02集');assert.equal(h.queries[0][5],'first');
  assert.equal(h.state.episode,0);assert.equal(h.state.book.animeSourceMode,'manual');
  assert.equal(h.saved.length,0);
  h.video.emit('loadedmetadata');assert.equal(h.video.currentTime,125);
  h.video.emit('loadeddata');
  assert.equal(h.saved[0].source,'first');assert.equal(h.saved[0].animeSourceMode,'manual');
  assert.deepEqual(h.progress.at(-1),{id:'book',idx:0,time:125});
});

test('快速切源忽略旧响应，最新选择继承停止前的播放进度',async()=>{
  const pending=new Map();
  const h=setup({find:(book,tried,chapter,note,current,selected)=>new Promise(resolve=>pending.set(selected,resolve))});
  await h.page.start();h.video.currentTime=125;
  const first=h.page.selectSource('first');
  const second=h.page.selectSource('second');
  pending.get('second')(alternative('second'));await second;
  pending.get('first')(alternative('first'));await first;
  assert.equal(h.state.book.source,'second');assert.equal(h.page.manualSource.value,'second');
  assert.equal(h.plays.length,2);
  h.video.emit('loadedmetadata');assert.equal(h.video.currentTime,125);
});

test('失败的手动查找不改写收藏，重试继续保留进度',async()=>{
  let available=false;
  const h=setup({find:async()=>available?alternative('first'):null});
  await h.page.start();h.video.currentTime=125;
  const original=h.state.book;
  await h.page.selectSource('first');
  assert.equal(h.state.book,original);assert.equal(h.saved.length,0);
  assert.equal(h.page.view.value.mode,'error');assert.equal(h.page.manualSource.value,'first');
  available=true;h.page.retry();await flush();
  h.video.emit('loadedmetadata');assert.equal(h.video.currentTime,125);
  assert.equal(h.state.book.source,'first');
});

test('已选新源的加载失败后重试保留进度，离开页面后的查找结果无效',async()=>{
  let failed=true;
  const h=setup({find:async()=>alternative('first'),play:async body=>{
    if(body.source==='first'&&failed)throw new Error('加载失败');
    return {data:{stream:'https://example.com/video.mp4'}};
  }});
  await h.page.start();h.video.currentTime=125;
  await h.page.selectSource('first');assert.equal(h.page.view.value.mode,'error');
  failed=false;h.page.retry();await flush();
  h.video.emit('loadedmetadata');assert.equal(h.video.currentTime,125);
  let resolve;
  const leaving=setup({find:()=>new Promise(r=>{resolve=r;})});
  await leaving.page.start();const original=leaving.state.book;
  const work=leaving.page.selectSource('first');leaving.app.page='home';
  resolve(alternative('first'));await work;
  assert.equal(leaving.state.book,original);assert.equal(leaving.plays.length,1);
});
