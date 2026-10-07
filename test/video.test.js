'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {VideoRelay}=require('../server/video');
const ticket=url=>new URL(url,'http://localhost').searchParams.get('ticket');
const publicLookup=async()=>[{address:'93.184.216.34'}];
async function contents(body) {const chunks=[];for await(const chunk of body) chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);}

test('视频中继重写 HLS 子列表、密钥和分片，保留 Range 并使用自动路由',async()=>{
  const io={open:async(url,options)=>{
    assert.equal(options.route,'auto');assert.equal(options.headers.Referer,'https://example.com/episode');
    if(url.endsWith('/master.m3u8')) return {url,response:new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhls/index.m3u8',{headers:{'content-type':'application/vnd.apple.mpegurl'}})};
    if(url.endsWith('/hls/index.m3u8')) return {url,response:new Response('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:5,\nsegment.ts',{headers:{'content-type':'application/vnd.apple.mpegurl'}})};
    assert.equal(options.headers.Range,'bytes=0-4095');
    assert.ok(url.endsWith('/hls/segment.ts'));
    return {url,response:new Response(Buffer.alloc(4096,71),{status:206,headers:{'content-type':'video/mp2t','content-range':'bytes 0-4095/10000'}})};
  }};
  const relay=new VideoRelay(io,publicLookup);
  const root=relay.url({stream:'https://example.com/master.m3u8',referer:'https://example.com/episode'});
  const master=await contents((await relay.open(ticket(root))).body);
  const sub=master.toString().split('\n').at(-1);assert.ok(sub.startsWith('/api/video?ticket='));
  const playlist=(await contents((await relay.open(ticket(sub))).body)).toString();
  const key=playlist.match(/URI="([^"]+)"/)[1];
  assert.equal(relay.verify(ticket(key)).url,'https://example.com/hls/key.bin');
  const segment=playlist.split('\n').at(-1);
  const response=await relay.open(ticket(segment),{range:'bytes=0-4095'});
  assert.equal(response.status,206);assert.equal(response.headers['content-range'],'bytes 0-4095/10000');
  assert.equal((await contents(response.body)).length,4096);
});

test('视频中继拒绝篡改、过期和私网目标，不能变成任意网址代理',async()=>{
  let calls=0;
  const relay=new VideoRelay({open:async()=>{calls++;throw new Error('must not fetch');}},async()=>[{address:'127.0.0.1'}]);
  const valid=ticket(relay.url({stream:'https://example.com/video.mp4'}));
  await assert.rejects(relay.open('tampered.'+valid),/凭据无效/);
  await assert.rejects(relay.open(ticket(relay.sign({url:'https://example.com/a',expires:1}))),/过期/);
  await assert.rejects(relay.open(valid),/内网/);
  await assert.rejects(relay.open(ticket(relay.url({stream:'http://169.254.169.254/latest'}))),/内网/);
  await assert.rejects(relay.open(ticket(relay.url({stream:'file:///private'}))),/无效媒体地址/);
  assert.equal(calls,0);
});

test('视频中继拒绝假播放列表和 HTML，保留取消信号',async()=>{
  const abort=new AbortController();
  const relay=new VideoRelay({open:async(url,options)=>{
    assert.equal(options.signal,abort.signal);
    return {url,response:new Response('<html>blocked</html>',{headers:{'content-type':'text/html'}})};
  }},publicLookup);
  await assert.rejects(relay.open(ticket(relay.url({stream:'https://example.com/index.m3u8'})),{signal:abort.signal}),/有效播放列表/);
  await assert.rejects(relay.open(ticket(relay.url({stream:'https://example.com/video.mp4'})),{signal:abort.signal}),/不是视频数据/);
});
