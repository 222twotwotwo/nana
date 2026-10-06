'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createSources}=require('../server/sources');
const {readNuxt}=require('../server/source-data');
const {playerData,decodeUrl,hhjxBootstrap,parseDmbusSearch,parseDmbusDetail}=require('../server/additional-anime');
const {splitChapters}=require('../server/additional-lightnovels');
const source=(id,io)=>createSources(io).find(s=>s.id===id);
const nuxt=d=>'window.__NUXT__='+JSON.stringify({data:[d]});

test('Kazumi 番剧播放器只解析静态数据并解码公开地址',()=>{
  const encoded=Buffer.from('%68%74%74%70%73%3A%2F%2Fv1.adkwai.com%2Fepisode.mp4').toString('base64');
  const html=`<script>var player_aaaa={"encrypt":2,"url":"${encoded}"}; throw new Error('must not execute')</script>`;
  assert.equal(playerData(html).encrypt,2);assert.equal(decodeUrl(encoded),'https://v1.adkwai.com/episode.mp4');
  assert.throws(()=>playerData('<script>var x=1</script>'),/未提供公开地址/);
});

test('Kazumi 内置 DM84 源覆盖搜索、目录与静态播放器解析',async()=>{
  const search='<ul class="v_list"><li><div><a class="cover" data-bg="/cover.jpg"></a><a class="title" href="/v/1.html" title="测试番剧">测试番剧</a></div></li></ul>';
  const detail='<h1 class="v_title"><a>测试番剧</a></h1><div class="cover"><img src="/cover.jpg"></div><div id="intro"><p>简介</p></div><ul class="play_list"><li><a href="/p/1-1-1.html">1</a></li></ul>';
  const bootstrap=JSON.stringify({url:'token',t:1,key:'key'});
  let requests=[];
  const s=source('kazumi-dm84',{text:async(url,options)=>{
    requests.push({url,options});
    if(url.includes('/s----------')) return search;
    if(url.includes('/v/')) return detail;
    if(url.includes('/p/')) return '<iframe src="https://hhjx.hhplayer.com/?url=token"></iframe>';
    if(url.includes('hhjx.hhplayer.com/?')) return `<script>window.__HHJX_BOOTSTRAP__=${bootstrap};</script>`;
    return JSON.stringify({code:200,url:'https://video.gtimg.com/demo.mp4'});
  }});
  const rows=await s.search('测试');assert.equal(rows[0].name,'测试番剧');assert.equal(rows[0].id,'https://dmbus.cc/v/1.html');
  const d=await s.detail(rows[0].id);assert.equal(d.chapters[0].url,'https://dmbus.cc/p/1-1-1.html');
  const p=await s.play(d.chapters[0].url);assert.equal(p.stream,'https://video.gtimg.com/demo.mp4');
  assert.equal(requests.at(-1).options.method,'POST');
  assert.deepEqual(hhjxBootstrap(`<script>window.__HHJX_BOOTSTRAP__=${bootstrap};</script>`),{url:'token',t:1,key:'key'});
  assert.equal(parseDmbusSearch(search,'https://dmbus.cc')[0].name,'测试番剧');
  assert.equal(parseDmbusDetail(detail,'https://dmbus.cc').name,'测试番剧');
});

test('7sefun 遇到会员播放器时明确提示原站限制',async()=>{
  const outer='<script>var player_aaaa={"encrypt":0,"url":"https://www.lmm85.com/play/1_1_1.html"}</script>';
  const nested='<script>var player_aaaa={"encrypt":0,"from":"vxdev","url":"opaque-token"}</script>';
  const s=source('kazumi-7sefun',{text:async url=>url.includes('www.lmm85.com')?nested:outer});
  await assert.rejects(s.play('https://www.7sefun.top/vodplay/1-1-1.html'),/原站登录后播放/);
});

test('KazumiRules 索引中的 16 个番剧源全部注册',()=>{
  const names=createSources().filter(s=>s.type==='anime').map(s=>s.name);
  assert.deepEqual(names,['7sefun','DM84','aafun','AGE','akianime','baimao','dalvdm','ezdmw','giriGiriLove','mgnacg','moonci','mutefun','MXdm','sorani','xfdmneo','xfdmnext']);
});

test('KazumiRules 允许已登记的搜索跳转域名',()=>{
  const baimao=source('kazumi-baimao'), xfdmneo=source('kazumi-xfdmneo');
  assert.ok(baimao.hosts.includes('www.bmmdmm.com'));
  assert.ok(xfdmneo.hosts.includes('xifan.moe'));
});

test('KazumiRules API 番剧源转换搜索与嵌套选集',async()=>{
  const s=source('kazumi-sorani',{json:async(url,options)=>url.includes('/video?')?{data:{records:[{id:7,title:'API番剧'}]}}:{data:{title:'API番剧',episodes:[{episodeLabel:'第1集',episodeOrder:1}]}}});
  const rows=await s.search('API');assert.equal(rows[0].id,'https://www.sorani.net/7');
  const d=await s.detail(rows[0].id);assert.equal(d.name,'API番剧');assert.equal(d.chapters[0].url,'https://www.sorani.net/anime/mal/7/episode/1');
});

test('轻小说文库按卷章标题拆分公开 TXT，过滤插图节点',()=>{
  const chapters=splitChapters('第一卷 序章\n'+('正文内容。'.repeat(20))+'\n第一卷 插图\n图片\n第二卷 第一章\n'+('更多正文内容。'.repeat(20)));
  assert.equal(chapters.length,2);assert.equal(chapters[0].title,'第一卷 序章');assert.equal(chapters[1].title,'第二卷 第一章');
});

test('轻小说文库搜索覆盖无职转生与败犬女主别名',async()=>{
  const xml=name=>`<feed><entry><title>${name}</title><id>urn:wenku8articleid:3057</id><author><name>作者</name></author></entry></feed>`;
  const s=source('wenku8-opds',{text:async url=>url.includes('search.opds')?xml('败北女角太多了！(败犬女主太多了！)'):'<败北女角太多了！>\n第一卷 序章\n'+'正文。'.repeat(50)});
  assert.equal((await s.search('败犬女主太多了'))[0].id,'https://opds.wol.moe/zh_CN/novel/3057');
  assert.match((await s.detail('https://opds.wol.moe/zh_CN/novel/3057')).name,/败北女角/);
});

test('在线音乐源解析公开音频并保留代理路由',async()=>{
  const archive=source('archive-audio',{json:async url=>url.includes('/advancedsearch.php')
    ? {response:{docs:[{identifier:'demo',title:'Ambient Demo',creator:'作者'}]}}
    : {files:[{name:'cover.jpg',size:'1000'},{name:'track.mp3',size:'2000',format:'VBR MP3'}]}});
  const rows=await archive.search('ambient');
  assert.equal(rows.length,1);assert.equal(rows[0].size,2000);assert.match(rows[0].id,/archive\.org\/download\/demo\/track\.mp3/);
  assert.equal(archive.route,'proxy');
  assert.deepEqual(await archive.play(rows[0].id),{stream:rows[0].id,referer:'https://archive.org/'});
  await assert.rejects(archive.play('https://example.com/track.mp3'),/不属于该书源/);

  const commons=source('wikimedia-audio',{json:async()=>({query:{pages:{1:{title:'File:Piano.ogg',imageinfo:[{url:'https://upload.wikimedia.org/wikipedia/commons/p/p1/Piano.ogg',thumburl:'https://upload.wikimedia.org/thumb/p/p1/Piano.ogg/320px-Piano.ogg',size:3000,mime:'audio/ogg'}]}}}})});
  const commonRows=await commons.search('piano');
  assert.equal(commonRows[0].name,'Piano.ogg');assert.equal(commons.route,'proxy');
  assert.equal((await commons.play(commonRows[0].id)).stream,commonRows[0].id);
});

test('Nuxt 只解释数据、共享参数与数组赋值，不执行源站代码',()=>{
  const d=readNuxt('window.__NUXT__=(function(a,b){a[0]=b;b.title="书名";return {data:a};})(Array(1),{});');
  assert.equal(d.data[0].title,'书名');
  for(const body of [
    'window.__NUXT__=(function(){throw new Error("执行");})()',
    'window.__NUXT__=(function(a){a.__proto__={};return a;})({})',
    'window.__NUXT__=(function(a){a["constructor"]={};return a;})({})',
    'window.__NUXT__=(function(a){a.push(1);return a;})([])',
    'window.__NUXT__=Array(100001)',
    'window.__NUXT__=globalThis.process.exit()',
    'window.__NUXT__={get data(){return 1}}'
  ]) assert.throws(()=>readNuxt(body));
});

test('速读谷完整目录跨页合并、去重并在末页占位链接停止',async()=>{
  const calls=[];
  const s=source('sudugu',{text:async url=>{
    calls.push(url);
    return url.endsWith('/2')?'<div id="list"><a href="/1/2.html">二</a><a href="/1/3.html">三</a></div><a class="gr" href="#">下一页</a>':'<div class="itemtxt"><h1><a>书名</a></h1></div><div id="list"><a href="/1/1.html">一</a><a href="/1/2.html">二</a></div><a class="gr" href="/1/2">下一页</a>';
  }});
  const d=await s.detail('https://www.sudugu.cc/1/');
  assert.equal(d.chapters.length,3);assert.equal(calls.length,2);assert.equal(d.chapters.at(-1).title,'三');
});

test('速读谷合并同章所有分页，停止于下一章；拒绝循环、空白和跨章链接',async()=>{
  const calls=[],a='第一部分内容。'.repeat(10),b='第二部分内容。'.repeat(10);
  const s=source('sudugu',{text:async url=>{calls.push(url);return url.includes('_2')?`<div class="con">${b}</div><a href="/1/11.html">下一章</a>`:`<div class="con">${a}</div><a href="/1/10_2.html">下一页</a>`;}});
  const d=await s.content('https://www.sudugu.cc/1/10.html');
  assert.equal(d.text,a+'\n'+b);assert.equal(calls.length,2);
  for(const html of [`<div class="con">${a}</div><a href="/1/11.html">下一页</a>`,`<div class="con">${a}</div><a href="/1/10.html">下一页</a>`,'<div class="con"></div>']) {
    await assert.rejects(source('sudugu',{text:async()=>html}).content('https://www.sudugu.cc/1/10.html'));
  }
});

test('速读谷短关键词明确报错，正常搜索发送编码后的表单',async()=>{
  let sent;
  const s=source('sudugu',{text:async(url,options)=>{sent=options;return '<div class="item"><h3><a href="/1/">剑来</a></h3></div>';}});
  await assert.rejects(s.search('剑'),/两个汉字/);
  assert.equal((await s.search('剑来'))[0].name,'剑来');
  assert.equal(sent.method,'POST');assert.equal(new URLSearchParams(sent.body).get('searchkey'),'剑来');
});

test('笔趣阁读取全目录链接，正文保留页面内的后半章',async()=>{
  const s=source('biquge365',{text:async(url,opts)=>{
    assert.equal(opts.route,'proxy');
    if(url.includes('/newbook/')) return '<div class="menu"><div class="border"><ul><li><a href="/chapter/1/1.html">第一章</a></li><li><a href="/chapter/1/2.html">第二章</a></li></ul></div></div>';
    if(url.includes('/chapter/')) return '<div id="txt"><p style="font-weight:bold">广告</p>上半章<br>（本章未完，请点击下一页继续阅读）下半章</div>';
    return '<meta property="og:novel:book_name" content="书名"><a href="/newbook/1/">全部章节目录</a><a href="/chapter/1/2.html">最新章节</a>';
  }});
  const d=await s.detail('https://www.biquge365.net/book/1/');assert.equal(d.chapters.length,2);
  assert.equal((await s.content(d.chapters[0].url)).text,'上半章\n下半章');
});

test('快看仅列免费章节，使用完整原始图片数组而非两张首屏图',async()=>{
  const unlocked={id:1,title:'第一话',is_free:true,locked:false,need_vip:false,is_vip_exclusive:false};
  const all=Array.from({length:7},(_,i)=>({url:'https://a.v3mh.com/'+i+'.jpg'}));
  const s=source('kuaikan',{text:async url=>url.includes('/topic/')?nuxt({topicInfo:{title:'漫画'},comics:[unlocked,{...unlocked,id:2,locked:true},{...unlocked,id:3,is_free:false}]}):nuxt({comicInfo:{...unlocked,comicImages:all.slice(0,2)},res:{data:{comic_info:{...unlocked,comic_images:all}}}})});
  const d=await s.detail('https://www.kuaikanmanhua.com/web/topic/1');assert.equal(d.chapters.length,1);
  assert.equal((await s.content(d.chapters[0].url)).images.length,7);
  const locked=source('kuaikan',{text:async()=>nuxt({res:{data:{comic_info:{...unlocked,locked:true,comic_images:all}}}})});
  await assert.rejects(locked.content(d.chapters[0].url),/未公开免费/);
});

test('WEBTOON 目录跟随游标、按话数排列，搜索不越过年龄限制',async()=>{
  const s=source('webtoon-zh',{text:async()=>'<meta property="og:title" content="漫画"><a class="_card_item" href="/zh-hant/a/list?title_no=1"><div class="info_text"><b class="title">漫画</b></div></a><a class="_card_item" data-title-unsuitable-for-children="true" href="/zh-hant/b/list?title_no=2"></a>',json:async(url,options)=>{
    assert.equal(options.route,'proxy');const second=new URL(url).searchParams.get('cursor')==='next';
    return {success:true,result:{episodeList:[{episodeNo:second?1:2,episodeTitle:second?'第一话':'第二话',viewerLink:'/zh-hant/a/viewer?title_no=1&episode_no='+(second?1:2)}],nextCursor:second?0:'next'}};
  }});
  assert.equal((await s.search('愛')).length,1);
  const d=await s.detail('https://www.webtoons.com/zh-hant/a/list?title_no=1');assert.deepEqual(d.chapters.map(x=>x.title),['第一话','第二话']);
});

test('MangaDex 中文目录分页并排除其他语言、外链和失效章，图片使用顶层 baseUrl',async()=>{
  const id='c8b3d40c-86b8-41cd-a793-c280d5b9da10',calls=[];
  const s=source('mangadex-zh',{json:async url=>{
    calls.push(url);const u=new URL(url);
    if(u.pathname.includes('at-home')) return {result:'ok',baseUrl:'https://cdn.mangadex.network',chapter:{hash:'hash',data:['a.jpg']}};
    if(u.pathname.endsWith('/feed')) {
      assert.deepEqual(u.searchParams.getAll('translatedLanguage[]'),['zh','zh-hk']);
      const offset=Number(u.searchParams.get('offset'));
      const row=(lang,other={})=>({id:id+lang,attributes:{translatedLanguage:lang,pages:10,chapter:'1',...other}});
      return {result:'ok',total:5,data:offset===0?[row('zh'),row('en'),row('zh-hk',{externalUrl:'https://example.com'}),row('zh',{isUnavailable:true})]:[row('zh-hk')]};
    }
    return {result:'ok',data:{id,attributes:{title:{en:'Title'},altTitles:[{'zh-hk':'中文名'}],description:{}},relationships:[]}};
  }});
  const d=await s.detail('https://api.mangadex.org/manga/'+id);
  assert.equal(d.name,'中文名');assert.equal(d.chapters.length,2);assert.ok(calls.some(url=>new URL(url).searchParams.get('offset')==='4'));
  const c=await s.content('https://api.mangadex.org/chapter/'+id);assert.deepEqual(c.images,['https://cdn.mangadex.network/data/hash/a.jpg']);
});

test('维基文库只收本书子页目录，单页正文保留来源并拒绝空正文',async()=>{
  let html='<div id="headerContainer">导航</div><p>'+'原文内容。'.repeat(30)+'</p>';
  const s=source('wikisource',{json:async()=>({parse:{title:'测试',text:{'*':html}}})});
  assert.equal((await s.detail('https://zh.wikisource.org/wiki/测试')).chapters.length,1);
  const text=(await s.content('https://zh.wikisource.org/wiki/测试')).text;assert.ok(text.includes('原文内容'));assert.ok(text.includes('来源：中文维基文库'));assert.ok(!text.includes('导航'));
  html='<div id="headerContainer">导航</div>';await assert.rejects(s.content('https://zh.wikisource.org/wiki/测试'),/可读正文/);
});
