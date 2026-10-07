const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
function setup(sources=[],progress={}) {
  const app={page:'home',showPage(page){this.page=page;}},search={};
  const server={SOURCES:{value:sources},getStoreSource:id=>sources.find(s=>s.id===id),sourceId:id=>id,initServer:async()=>{}};
  const modules={'vue':{reactive:x=>x},'../stores/app':{useAppStore:()=>app},'../stores/search':{useSearchStore:()=>search},'./server':server,'./settings':{getProgress:()=>progress}};
  const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/services/anime.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const context={exports:{},require:id=>{if(!modules[id])throw new Error('unexpected module '+id);return modules[id];}};
  vm.runInNewContext(code,context);return context.exports;
}
const title='无职转生Ⅲ 到了异世界就拿出真本事热度：88171°C';
const source=(id,extra)=>({id,name:id,type:'anime',status:'healthy',...extra});

test('污染标题生成短词，但短词不会放宽季数或 Part 匹配',async()=>{
  const keywords=[],details=[];
  const api=setup([source('mx',{
    search:async word=>{keywords.push(word);return word==='无职转生'?[
      {id:'wrong-season',name:'无职转生Ⅱ 到了异世界就拿出真本事'},
      {id:'wrong-part',name:'无职转生Ⅲ 到了异世界就拿出真本事 Part 2'},
      {id:'correct',name:'无职转生到了异世界就拿出真本事第三季'}
    ]:[];},
    detail:async id=>{details.push(id);return {chapters:[{title:'第01集',url:'one'},{title:'第02集',url:'two'}]};}
  })]);
  const alt=await api.findAlternativeAnime({title},new Set(),{title:'2'});
  assert.equal(alt.srcId,'correct');assert.equal(alt.index,1);
  assert.ok(keywords.every(word=>!word.includes('热度')));assert.ok(keywords.includes('无职转生'));
  assert.deepEqual(details,['correct']);
});

test('同集的两条线路合并，旧目录第二条线路的续播时间和集数保留',async()=>{
  const api=setup([],{book:{chIdx:2,time:83,pct:10}});
  await api.startAnime({id:'book',title,chapters:[{title:'第01集',url:'a1'},{title:'第02集',url:'a2'},{title:'第01集',url:'b1'},{title:'第02集',url:'b2'}]});
  assert.equal(api.animeState.book.title,'无职转生Ⅲ 到了异世界就拿出真本事');
  assert.equal(api.animeState.book.chapters.length,2);
  assert.equal(api.animeState.book.chapters[0].alternatives[0],'b1');
  assert.equal(api.animeState.episode,0);assert.equal(api.animeState.resumeTime,83);
});

test('无对应集数时不按数组下标误播，搜索与目录错误分别报告',async()=>{
  const reports=[],api=setup([
    source('offline',{search:async()=>{throw new Error('代理也连接失败');}}),
    source('short',{search:async()=>[{id:'same',name:'测试第三季'}],detail:async()=>({chapters:[{title:'第01集',url:'one'}]})}),
    source('broken',{search:async()=>[{id:'same',name:'测试第三季'}],detail:async()=>{throw new Error('目录解析失败');}})
  ]);
  assert.equal(await api.findAlternativeAnime({title:'测试第三季'},new Set(),{title:'第02集'},r=>reports.push(r)),null);
  assert.ok(reports.some(r=>r.source==='offline'&&r.stage==='搜索'&&r.message.includes('代理')));
  assert.ok(reports.some(r=>r.source==='short'&&r.stage==='目录'&&r.message==='没有对应集数'));
  assert.ok(reports.some(r=>r.source==='broken'&&r.stage==='目录'&&r.message==='目录解析失败'));
});

test('迟到目录不能切换新选集，备用源探测不会提前改写当前收藏',async()=>{
  let release,current=true;
  const api=setup([source('slow',{search:async()=>[{id:'same',name:'测试第三季'}],detail:()=>new Promise(r=>{release=r;})})]);
  const book={id:'original',title:'测试第三季',chapters:[{title:'第01集',url:'original'}]};
  api.animeState.book=book;
  const work=api.findAlternativeAnime(book,new Set(),book.chapters[0],()=>{},()=>current);
  await new Promise(r=>setImmediate(r));current=false;
  release({chapters:[{title:'第01集',url:'late'}]});
  assert.equal(await work,null);assert.equal(api.animeState.book,book);
});

test('手动选源只查询指定来源，仍严格匹配季数和集数',async()=>{
  const queried=[],details=[];
  const api=setup(['other','chosen'].map(id=>source(id,{
    search:async()=>{queried.push(id);return [
      {id:'wrong-season',name:'测试第二季'},
      {id:'missing-episode',name:'测试第三季'},
      {id:'correct',name:'测试第三季'}
    ];},
    detail:async key=>{details.push(key);return {chapters:[{title:key==='correct'?'第02集':'第01集',url:key}]};}
  })));
  const alt=await api.findAlternativeAnime({title:'测试第三季'},new Set(),{title:'2'},()=>{},()=>true,'chosen');
  assert.equal(alt.source,'chosen');assert.equal(alt.chapters[alt.index].url,'correct');
  assert.deepEqual(queried,['chosen']);assert.deepEqual(details,['missing-episode','correct']);
});

test('手动所选来源不可用时不查询其他可用来源',async()=>{
  const queried=[],reports=[];
  const api=setup([
    source('working',{search:async()=>{queried.push('working');return [{id:'ok',name:'测试'}];},detail:async()=>({chapters:[{title:'1',url:'ok'}]})}),
    source('offline',{search:async()=>{queried.push('offline');throw new Error('无法连接');}})
  ]);
  assert.equal(await api.findAlternativeAnime({title:'测试'},new Set(),{title:'1'},r=>reports.push(r),()=>true,'offline'),null);
  assert.deepEqual(queried,['offline']);assert.equal(reports.at(-1).message,'无法连接');
  assert.equal(await api.findAlternativeAnime({title:'测试'},new Set(),{title:'1'},()=>{},()=>true,'removed'),null);
  assert.deepEqual(queried,['offline']);
});

test('短关键词重复命中已失败的目录时，最终保留实际失败原因',async()=>{
  const reports=[],keywords=[],api=setup([source('chosen',{
    search:async word=>{keywords.push(word);return [{id:'same',name:'测试番剧第三季'}];},
    detail:async()=>{throw new Error('番剧详情或目录为空');}
  })]);
  assert.equal(await api.findAlternativeAnime({title:'测试番剧第三季'},new Set(),{title:'1'},r=>reports.push(r),()=>true,'chosen'),null);
  assert.deepEqual(keywords,['测试番剧第三季','测试番剧']);
  assert.equal(reports.at(-1).stage,'目录');assert.equal(reports.at(-1).message,'番剧详情或目录为空');
});
