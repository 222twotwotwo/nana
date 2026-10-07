const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');

function makeStorage(){const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};}

/**
 * 加载 seed.ts，替换其依赖模块；saveCatalogItem 以忠实缩写版记录入库行为。
 * sourcesSpec: [{id,type,search,detail}] 会同时作为 SOURCES 与 getStoreSource 的返回。
 */
function setup({books=[],music=[],analyses=[],progress={},storage=new Map(),sources=[]}={}) {
  const store={books:[...books],music:[...music],analyses:[...analyses]};
  const db={
    async all(name){return store[name].map(x=>({...x}));},
    async put(name,val){const i=store[name].findIndex(x=>x.id===val.id);if(i>=0)store[name][i]={...val};else store[name].push({...val});},
    async del(name,key){const i=store[name].findIndex(x=>(name==='analyses'?x.key:x.id)===key);if(i>=0)store[name].splice(i,1);}
  };
  const idb={dbAll:n=>db.all(n),dbDel:(n,k)=>db.del(n,k),dbPut:(n,v)=>db.put(n,v),dbGet:(n,k)=>Promise.resolve(store[n].find(x=>x.id===k))};
  const calls={saved:[],bumps:0,initServer:0};
  const catalog={saveCatalogItem:async(src,item,det)=>{
    const record=src.type==='music'
      ?{id:'m-'+(calls.saved.length+1),source:src.id,sourceName:src.name,author:det.author||item.author,cover:det.cover||item.cover,addedAt:item.addedAt,name:det.name||item.name,sourceUrl:item.id,pageUrl:item.pageUrl||'',tags:[],duration:Number(item.duration||0),preview:!!item.preview}
      :{id:'b-'+(calls.saved.length+1),source:src.id,sourceName:src.name,author:det.author||item.author,cover:det.cover||item.cover,addedAt:item.addedAt,srcId:item.id,title:det.name,intro:det.intro||'',charCount:0,chapters:det.chapters.map(ch=>({...ch})),...(src.type==='novel'?{}:{type:src.type})};
    const exists=store[src.type==='music'?'music':'books'].find(r=>r.source===src.id&&(src.type==='music'?r.sourceUrl:r.srcId)===item.id);
    if(exists)return exists;
    calls.saved.push({source:src.id,item,det});
    await db.put(src.type==='music'?'music':'books',record);
    return record;
  }};
  const progressState=JSON.parse(JSON.stringify(progress));
  // getProgress 返回同一活对象（与真实实现逐次解析等价），saveProgressRaw 记录调用即可
  const settings={getProgress:()=>progressState,saveProgressRaw(){},saveProgress(){},clearProgress(id){delete progressState[id];},saveMapping(){},getMapping:()=>({})};
  const server={SOURCES:{value:sources.map(s=>({id:s.id,type:s.type,name:s.id,status:'ok'}))},HAS_SERVER:{value:true},initServer:async()=>{calls.initServer++;},
    getStoreSource:id=>{const s=sources.find(x=>x.id===id);return s?{id:s.id,name:s.id,type:s.type,search:s.search,detail:s.detail}:null;},sourceId:id=>id,mediaUrl:(s,u)=>u};
  const modules={
    './idb':idb,
    './server':server,
    './catalog':catalog,
    './settings':settings,
    '../stores/lib':{useLibStore:()=>({bump(){calls.bumps++;}})}
  };
  const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/services/seed.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const storageStub={getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
  const context={exports:{},require:id=>{if(!modules[id])throw new Error('unexpected module '+id);return modules[id];},localStorage:storageStub,storage,console:{warn(){},log(){}}};
  vm.runInNewContext(code,context);
  const seed=context.exports;
  return {seed,store,calls,progressState,storage};
}

const animeHit=(id,name,cover)=>({id,name,cover});
const animeDetail=(name,cover)=>({name,cover,intro:'简介'+name,chapters:[{title:'第1集',url:'https://example.com/1'}]});
const novelDetail=name=>({name,author:'轻小说文库',intro:'简介',cover:'https://example.com/'+name+'.jpg',chapters:[{title:'第一章',url:'https://example.com/c1'}]});
const songItem={id:'https://music.163.com/song?id=1',name:'未完成ランデヴー',author:'Lezel',cover:'https://example.com/song.jpg',duration:200};
const comicDetail={name:'战姬求生记',author:'otosama',intro:'故事简介',cover:'https://example.com/comic.jpg',chapters:[{title:'第1话',url:'https://example.com/m1'}]};

function workingSources(){return[
  {id:'kazumi-7sefun',type:'anime',search:async kw=>kw==='傷物語'?[animeHit('https://7s/k1','傷物語1 鉄血篇','https://7s/c1.jpg')]:kw==='无职转生'?[animeHit('https://7s/m1','无职转生：到了异世界就拿出真本事','https://7s/cm.jpg')]:kw==='缘之空'?[animeHit('https://7s/y1','缘之空热度：204005℃','https://7s/cy.jpg')]:kw==='学生会也有洞'?[animeHit('https://7s/s1','学生会也有洞！','https://7s/cs.jpg')]:[],
   detail:async id=>animeDetail('标题'+id,'https://7s/detail.jpg')},
  {id:'netease-music',type:'music',search:async()=>[songItem],detail:async()=>{throw new Error('音乐无详情');}},
  {id:'wenku8-opds',type:'novel',search:async kw=>[{id:'https://opds/novel/'+kw,name:kw.includes('败')?'败北女角太多了！(败犬女主太多了！)':'无职转生～到了异世界就拿出真本事～'}],
   detail:async id=>novelDetail('书'+id)},
  {id:'dm5',type:'comic',search:async()=>[{id:'https://1kkk/m1',name:'战姬求生记·背负异世界剑与魔法',cover:'https://1kkk/c.jpg'}],detail:async()=>comicDetail},
  {id:'kazumi-mxdm',type:'anime',search:async()=>[{id:'https://mx/s1',name:'学生会也有洞！'}],detail:async()=>({name:'学生会也有洞！',chapters:[{title:'第1集',url:'https://mx/1'}]})}
];}

test('空书库首次启动：8 条默认内容按截图顺序入库并写入进度',async()=>{
  const env=setup({sources:workingSources()});
  await env.seed.ensureSeedLibrary();
  await env.seed.runSeedBackground();
  assert.equal(env.store.books.length,7);
  assert.equal(env.store.music.length,1);
  assert.equal(env.calls.saved.length,8);
  // addedAt 降序 = 截图行序：傷物語 → 未完成ランデヴー → 无职转生 → 败北女角 → 缘之空 → 学生会 → 战姬 → 无职转生小说
  const rows=[...env.store.books,...env.store.music].sort((a,b)=>b.addedAt-a.addedAt).map(r=>r.title||r.name);
  assert.deepEqual(rows,['标题https://7s/k1','未完成ランデヴー','标题https://7s/m1','书https://opds/novel/败北女角','标题https://7s/y1','标题https://7s/s1','战姬求生记','书https://opds/novel/无职转生']);
  // 进度：hero 是音乐（ts 最新），其余按截图百分比
  const p=env.progressState;
  const musicRow=env.store.music[0];
  const kizu=env.store.books.find(b=>b.srcId==='https://7s/k1');
  assert.equal(p[musicRow.id].pct,6);assert.equal(p[musicRow.id].time,10);
  assert.equal(p[kizu.id].pct,1);
  assert.ok(p[musicRow.id].ts>Math.max(...Object.values(p).map(e=>e.ts).filter(t=>t!==p[musicRow.id].ts)));
  assert.equal(env.storage.get('nr-demo-seed'),'done');
  assert.ok(env.calls.bumps>=8);
});

test('仅剩旧示例书时替换，不残留示例进度与分析',async()=>{
  const env=setup({books:[{id:'sample',title:'示例 · 雾海行舟',chapters:[]}],analyses:[{key:'sample:0',bookId:'sample'}],progress:{sample:{chIdx:0,pct:50,ts:1}},sources:workingSources()});
  await env.seed.ensureSeedLibrary();
  await env.seed.runSeedBackground();
  assert.equal(env.store.books.find(b=>b.id==='sample'),undefined);
  assert.equal(env.progressState.sample,undefined);
  assert.equal(env.store.analyses.length,0);
  assert.equal(env.store.books.length,7);
});

test('已有真实收藏时不注入默认内容',async()=>{
  const env=setup({books:[{id:'mine',title:'我的书',chapters:[]}],sources:workingSources()});
  await env.seed.ensureSeedLibrary();
  assert.equal(env.store.books.length,1);
  assert.equal(env.calls.saved.length,0);
  assert.equal(env.storage.has('nr-demo-seed'),false);
});

test('已完成一次注入后不再重复（用户删光默认内容也不会复活）',async()=>{
  const env=setup({sources:workingSources()});
  env.storage.set('nr-demo-seed','done');
  await env.seed.ensureSeedLibrary();
  assert.equal(env.store.books.length,0);
  assert.equal(env.calls.saved.length,0);
});

test('24 小时内的失败尝试不重复打扰，全部成功后标记 done',async()=>{
  const env=setup({sources:[]}); // 无可用来源 → 全部失败
  await env.seed.ensureSeedLibrary();
  await env.seed.runSeedBackground();
  assert.equal(env.store.books.length,0);
  const first=env.storage.get('nr-demo-seed');
  assert.notEqual(first,'done');assert.ok(Number(first)>0);
  // 同一个时间戳内再次启动：不再尝试
  await env.seed.ensureSeedLibrary();
  assert.equal(env.store.books.length,0);
});

test('首选来源无封面时换备用来源；音乐无封面也照常入库',async()=>{
  const sources=[
    // 7sefun：命中「学生会也有洞」但详情无封面 → 应放弃并换下一来源
    {id:'kazumi-7sefun',type:'anime',search:async kw=>kw==='学生会也有洞'?[animeHit('https://7s/s1','学生会也有洞！')]:[],
     detail:async()=>({name:'学生会也有洞！',chapters:[{title:'第1集',url:'https://7s/1'}]})},
    // dm84：同一作品且带封面 → 应被采用
    {id:'kazumi-dm84',type:'anime',search:async kw=>kw==='学生会也有洞'?[animeHit('https://dm/s1','学生会也有洞！','https://dm/c.jpg')]:[],
     detail:async()=>({name:'学生会也有洞！',cover:'https://dm/detail.jpg',intro:'简介',chapters:[{title:'第1集',url:'https://dm/1'}]})},
    {id:'netease-music',type:'music',search:async()=>[{id:'https://music.163.com/song?id=2',name:'未完成ランデヴー',author:'Lezel',duration:200}],detail:async()=>{throw new Error('x');}}
  ];
  const env=setup({sources});
  await env.seed.ensureSeedLibrary();
  await env.seed.runSeedBackground();
  const anime=env.store.books.find(b=>b.type==='anime');
  assert.equal(anime.source,'kazumi-dm84');
  assert.equal(anime.cover,'https://dm/detail.jpg');
  assert.equal(env.store.music.length,1);
});
