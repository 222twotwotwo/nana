'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createSources,comicImages}=require('../server/sources');
const {allowedUrl,publicAddress}=require('../server/network');

test('阅友合并全部分页区块，不把首屏当成完整章节',async()=>{
  const a='上半段正文。'.repeat(20),b='下半段正文。'.repeat(20);
  const s=createSources({text:async()=>`<div class="con"><p>${a}</p><p>（本章未完，请翻页）</p></div><div class="section none"><div class="con"><p>${b}</p></div></div>`}).find(s=>s.id==='yueyou');
  const {text}=await s.content('http://m.suixkan.com/r/1/2.html');
  assert.ok(text.includes(a));assert.ok(text.includes(b));assert.ok(!text.includes('本章未完'));
});
test('极速漫画提取书名，不包含评分；目录恢复为正序并使用移动阅读地址',async()=>{
  const html='<div class="banner_detail_form"><p class="title">测试漫画<span>7.0分</span></p></div><div id="detail-list-select-1"><a href="/vol2-2/">第2卷</a><a href="/vol1-1/">第1卷</a></div>';
  const s=createSources({text:async()=>html}).find(s=>s.id==='dm5');
  const d=await s.detail('https://www.1kkk.com/manhua1/');
  assert.equal(d.name,'测试漫画');assert.equal(d.chapters[0].title,'第1卷');assert.equal(d.chapters[0].url,'https://m.1kkk.com/vol1-1/');
});
test('极速漫画搜索首条结果不会把评分写进书名',async()=>{
  const html='<div class="banner_detail_form"><a href="/manhua1/"><img src="https://img.cdndm5.com/a.jpg"></a><p class="title">测试漫画<span class="right">7.0分</span></p></div>';
  const s=createSources({text:async()=>html}).find(s=>s.id==='dm5');
  const items=await s.search('测试');assert.equal(items[0].name,'测试漫画');
});
test('漫画解包只读字符串，不执行源站代码',()=>{
  const packed=String.raw`eval(function(p,a,c,k,e,d){return p;}('0 1=[\'2://3.4/5.6\'];',7,7,'var|newImgs|https|img|cdndm5.com|page|jpg'.split('|'),0,{})); throw new Error('must not execute');`;
  assert.deepEqual(comicImages(packed),['https://img.cdndm5.com/page.jpg']);
  assert.throws(()=>comicImages('<html>请登录购买</html>'),/未提供公开图片/);
});
test('来源地址限制覆盖协议、用户凭据、伪后缀与内网',()=>{
  const hosts=['www.manhuaren.com','.cdndm5.com'];
  for(const u of ['file:///etc/passwd','http://localhost/','http://127.0.0.1/','https://www.manhuaren.com.evil.example/','https://u:p@www.manhuaren.com/','https://www.manhuaren.com:8000/']) assert.throws(()=>allowedUrl(u,hosts));
  assert.equal(allowedUrl('https://a.cdndm5.com/a.jpg',hosts).hostname,'a.cdndm5.com');
  for(const ip of ['127.0.0.1','10.0.0.1','172.16.2.1','192.168.1.1','169.254.169.254','::1','::ffff:127.0.0.1']) assert.equal(publicAddress(ip),false);
  assert.equal(publicAddress('8.8.8.8'),true);
});
