'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createSources}=require('../server/sources');
const {openAudio}=require('../server/audio');
const source=(id,io)=>createSources(io).find(s=>s.id===id);

test('网易云保留曲目身份、受限标记，并区分实际试听与完整音频',async()=>{
  let playback={code:200,url:'http://m701.music.126.net/song.mp3',time:120000,size:2000,freeTrialInfo:null};
  const s=source('netease-music',{json:async url=>url.includes('cloudsearch')?{code:200,result:{songs:[{id:12,name:'歌',ar:[{name:'作者'}],al:{name:'专辑'},dt:120000,privilege:{pl:0}}]}}:{code:200,data:[playback]}});
  const rows=await s.search('歌');assert.equal(rows[0].id,'https://music.163.com/song?id=12');assert.equal(rows[0].restricted,true);
  assert.equal((await s.play(rows[0].id)).preview,false);
  playback={...playback,freeTrialInfo:{start:10,end:40}};
  const p=await s.play(rows[0].id);assert.equal(p.preview,true);assert.equal(p.duration,30);
  playback={code:404,url:null};await assert.rejects(s.play(rows[0].id),/原站/);
  playback={code:200,url:'http://music.126.net.evil.example/a.mp3'};await assert.rejects(s.play(rows[0].id),/不属于/);
  await assert.rejects(s.play('https://music.163.com/other?id=12'),/无效/);
});

test('好听轻音乐使用源站 wd 参数和搜索列表，解析静态 mp3 数据且拒绝跨曲地址',async()=>{
  let script='var mp3="12/mp3/1";throw new Error("never execute")';
  const s=source('htqyy',{text:async(url,options)=>{
    assert.equal(options.headers.Referer,'http://www.htqyy.com/');
    if(url.includes('/play/')) return script;
    assert.equal(new URL(url).searchParams.get('wd'),'天空之城');
    return '<li class="musicItem"><span class="title"><a href="/play/12">天空之城</a></span><span class="artistName">作者</span><a href="/play/12">播放</a></li><aside><a href="/play/99">其他推荐</a></aside>';
  }});
  const rows=await s.search('天空之城');assert.equal(rows.length,1);assert.equal(rows[0].name,'天空之城');
  assert.equal((await s.play(rows[0].id)).stream,'http://s1.htqyy.com/play9/12/mp3/1');
  script='var mp3="13/mp3/1"';await assert.rejects(s.play(rows[0].id),/未提供/);
});

test('Commons 接受真实 application/ogg，Archive 不把详情失败或私有音频当作可用结果',async()=>{
  const commons=source('wikimedia-audio',{json:async()=>({query:{pages:{1:{title:'File:Piano.ogg',imageinfo:[{url:'https://upload.wikimedia.org/wikipedia/commons/a/ab/Piano.ogg',mime:'application/ogg',size:1024}]}}}})});
  assert.equal((await commons.search('piano')).length,1);
  const archive=source('archive-audio',{json:async url=>{if(url.includes('advancedsearch'))return {response:{docs:[{identifier:'demo',title:'Demo'}]}};throw new Error('offline');}});
  await assert.rejects(archive.search('ambient'),/详情暂不可用/);
  const restricted=source('archive-audio',{json:async url=>url.includes('advancedsearch')?{response:{docs:[{identifier:'demo',title:'Demo'}]}}:{files:[{name:'private.mp3',size:3000,private:true}]}});
  assert.equal((await restricted.search('ambient')).length,0);
});

test('音频转发校验数据、范围、大小，沿用代理和 Referer，消费结束取消上游',async()=>{
  let options,cancelled=false;
  const bytes=Buffer.concat([Buffer.from('ID3'),Buffer.alloc(100)]);
  const io={open:async(url,o)=>{options=o;return {response:new Response(new ReadableStream({start(c){c.enqueue(bytes);},cancel(){cancelled=true;}}),{status:206,headers:{'content-type':'audio/mpeg','content-range':'bytes 0-102/1000','content-length':'103'}})};}};
  const s={base:'https://example.com',route:'proxy',audioHosts:['example.com']},p={stream:'https://example.com/a.mp3',referer:'https://example.com/song'};
  const audio=await openAudio(io,s,p,{range:'bytes=0-102'});
  assert.equal(audio.status,206);assert.equal(audio.headers['content-range'],'bytes 0-102/1000');
  assert.equal(options.route,'proxy');assert.equal(options.headers.Referer,p.referer);assert.equal(options.headers.Range,'bytes=0-102');
  for await(const chunk of audio.body) {assert.equal(chunk.length,103);break;}
  assert.equal(cancelled,true);
  await assert.rejects(openAudio(io,s,p,{range:'bytes=0-1,5-6'}),e=>e.status===416);
  await assert.rejects(openAudio({open:async()=>({response:new Response('<html>blocked</html>',{headers:{'content-type':'audio/mpeg'}})})},s,p),/不是有效音频/);
  await assert.rejects(openAudio({open:async()=>({response:new Response(bytes,{headers:{'content-type':'audio/mpeg','content-length':String(101*1024*1024)}})})},s,p),/100 MB/);
});
