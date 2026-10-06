'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {ReaderService}=require('../server/service');
const {createServer}=require('../server/index');
async function setup(t,source={},io) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'moyin-test-'));
  const s=new ReaderService({dataDir:dir,io,sources:[{id:'test',name:'测试',type:'novel',base:'https://example.com',hosts:['example.com'],mediaHosts:['example.com'],...source}]});
  await s.init();t.after(()=>{
    if(path.dirname(path.resolve(dir))!==path.resolve(os.tmpdir())||!path.basename(dir).startsWith('moyin-test-')) throw new Error('拒绝清理非测试目录');
    return fs.rm(dir,{recursive:true,force:true});
  });return s;
}
test('缓存合并同一请求，重启后可用；失败响应不入缓存',async t=>{
  let calls=0,fail=true;
  const s=await setup(t,{search:async()=>{calls++;await new Promise(r=>setTimeout(r,10));if(fail) throw new Error('失败');return [{id:'book'}];}});
  await assert.rejects(s.action('test','search','词'));
  fail=false;
  const [a,b]=await Promise.all([s.action('test','search','词'),s.action('test','search','词')]);
  assert.deepEqual(a,b);assert.equal(calls,2);
  const next=new ReaderService({sources:s.sources,dataDir:s.dataDir});await next.init();
  await next.action('test','search','词');assert.equal(calls,2);
});
test('空正文失败，健康状态有失败环节，过期结果不伪装实时可用',async t=>{
  const s=await setup(t,{search:async()=>[{id:'https://example.com/book',name:'书'}],detail:async()=>({name:'书',chapters:[{title:'一',url:'https://example.com/one'}]}),content:async()=>({text:''})});
  const r=await s.check('test');assert.equal(r.ok,false);assert.equal(r.stage,'content');assert.equal(s.list()[0].status,'failed');
  s.health.test={ok:true,checkedAt:new Date(Date.now()-86400001).toISOString()};assert.equal(s.list()[0].status,'stale');
});
test('图片必须是实际图片，HTML 响应不能通过代理',async t=>{
  const s=await setup(t,{}, {request:async()=>({bytes:Buffer.from('<html>blocked</html>'),type:'image/jpeg'})});
  await assert.rejects(s.image('test','https://example.com/test.jpg'),/不是有效图片/);
});

test('检测使用来源指定关键词和章节，并将图片按来源代理路由下载',async t=>{
  const routes=[];
  const s=await setup(t,{type:'comic',route:'proxy',probe:{keyword:'两个字',book:'^目标$',chapter:'^第一话$'},
    search:async kw=>{assert.equal(kw,'两个字');return [{id:'https://example.com/other',name:'其他'},{id:'https://example.com/book',name:'目标'}];},
    detail:async url=>{assert.equal(url,'https://example.com/book');return {name:'目标',chapters:[{title:'预告',url:'https://example.com/preview'},{title:'第一话',url:'https://example.com/one'}]};},
    content:async url=>{assert.equal(url,'https://example.com/one');return {images:['https://example.com/first','https://example.com/middle','https://example.com/last']};}
  },{request:async(url,options)=>{routes.push(options.route);return {bytes:Buffer.from([255,216,255])};}});
  const r=await s.check('test');assert.equal(r.ok,true);assert.equal(r.sampleChapter,'第一话');assert.equal(r.route,'proxy');assert.deepEqual(routes,['proxy','proxy','proxy']);
});
test('HTTP 不暴露私有文件或接受任意规则和跨站写入',async t=>{
  const s=await setup(t),server=createServer(s);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
  const base='http://127.0.0.1:'+server.address().port;
  for(const url of ['/data/health.json','/.server/shuyuan_novel.json','/package.json','/../package.json','/api/lg/custom','/missing.js']) assert.equal((await fetch(base+url)).status,404);
  assert.equal((await fetch(base+'/')).status,200);
  const post=(body,headers={})=>fetch(base+'/api/action',{method:'POST',headers:{'content-type':'application/json',...headers},body});
  assert.equal((await post('invalid')).status,400);
  assert.equal((await post('{}',{origin:'https://attacker.example'})).status,403);
  assert.equal((await post(JSON.stringify({source:'test',action:'content',value:'http://127.0.0.1/'}))).status,502);
  assert.equal((await post(JSON.stringify({source:'test',action:'eval',value:'x'}))).status,400);
});

test('音乐 HTTP 支持实际 Range 播放，检测下载音频而非只判断 URL',async t=>{
  let valid=true;
  const bytes=Buffer.concat([Buffer.from('ID3'),Buffer.alloc(4093)]);
  const s=await setup(t,{type:'music',search:async()=>[{id:'https://example.com/song',name:'测试歌曲'}],play:async()=>({stream:'https://example.com/audio.mp3'})},{open:async(url,options)=>{
    assert.equal(options.headers.Range,'bytes=0-4095');
    return {response:new Response(valid?bytes:Buffer.from('<html>denied</html>'),{status:206,headers:{'content-type':'audio/mpeg','content-range':'bytes 0-4095/9000'}})};
  }});
  const server=createServer(s);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
  const base='http://127.0.0.1:'+server.address().port;
  const url=base+'/api/audio?'+new URLSearchParams({source:'test',url:'https://example.com/song'});
  const response=await fetch(url,{headers:{Range:'bytes=0-4095'}});
  assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,4096);
  assert.equal((await s.check('test')).audioBytes,4096);
  valid=false;const check=await s.check('test');assert.equal(check.ok,false);assert.equal(check.stage,'audio');
  assert.equal((await fetch(base+'/music.js')).status,200);
  assert.equal((await fetch(base+'/api/audio?source=test&url=http://127.0.0.1/private')).status,502);
});
