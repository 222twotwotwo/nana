'use strict';
const { load } = require('cheerio');
const network = require('./network');

const {clean,plain,absolute}=require('./source-utils');
const {additionalNovels}=require('./additional-novels');
const {additionalComics}=require('./additional-comics');
const {additionalAnime}=require('./additional-anime');
const {additionalLightNovels}=require('./additional-lightnovels');
const {additionalMusic}=require('./additional-music');
const {kazumiAnimeSources}=require('./kazumi-anime');

// Decode only P.A.C.K.E.R string data. Never execute JavaScript received from a source.
function unquote(s) {
  return s.replace(/\\(u[0-9a-f]{4}|x[0-9a-f]{2}|[\s\S])/gi, (_,c)=>
    c[0]==='u' || c[0]==='x' ? String.fromCharCode(parseInt(c.slice(1),16)) :
      ({ n:'\n',r:'\r',t:'\t' }[c] ?? c));
}
function comicImages(html) {
  const packed = html.match(/}\s*\(\s*'((?:\\.|[^'\\])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:\\.|[^'\\])*)'\.split\('\|'\)/);
  let code=html;
  if (packed) {
    const base=Number(packed[2]), count=Number(packed[3]), words=unquote(packed[4]).split('|');
    if (base<2 || base>62 || count>10000) throw new Error('不支持的漫画图片编码');
    const alphabet='0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const encode=n=>n<base ? alphabet[n] : encode(Math.floor(n/base))+alphabet[n%base];
    const dict = new Map(Array.from({length:count},(_,i)=>[encode(i),words[i]]));
    code=unquote(packed[1]).replace(/\b\w+\b/g, w=>dict.get(w)||w);
  }
  const arr = code.match(/\bnewImgs\s*=\s*\[([\s\S]*?)\]/)?.[1];
  if (!arr) throw new Error('本话未提供公开图片，可能需登录、付费或源站规则已变更');
  const urls = [...arr.matchAll(/(['"])((?:\\.|(?!\1)[^\\])*)\1/g)].map(m=>unquote(m[2]));
  if (!urls.length || urls.some(u=>!/^https?:\/\//.test(u))) throw new Error('本话图片地址无效');
  return [...new Set(urls)];
}

function createSources(io=network) {
  const kuwoBase='http://appi.kuwo.cn';
  const kuwoHosts=['appi.kuwo.cn'];
  const kuwoGet = async url => {
    network.allowedUrl(url,kuwoHosts);
    const d=await io.json(url,{hosts:kuwoHosts});
    if (d.code!==200 || d.data==null) throw new Error('酷我接口未提供内容，可能已下架或需授权');
    return d.data;
  };
  const kuwo = {
    id:'kuwo', name:'酷我小说', type:'novel', base:kuwoBase, hosts:kuwoHosts,
    mediaHosts:['openbookcover.qpic.cn','.qpic.cn','.kuwo.cn'],
    repository:'https://github.com/XIU2/Yuedu', note:'中文小说 · 公开接口，部分作品可能不可读',
    async search(kw) {
      const rows=await kuwoGet(`${kuwoBase}/novels/api/book/search?keyword=${encodeURIComponent(kw)}&pi=1&ps=30`);
      if (!Array.isArray(rows)) throw new Error('酷我搜索格式已变更');
      return rows.map(x=>({id:`${kuwoBase}/novels/api/book/${x.book_id}`, name:x.title,author:x.author_name,cover:x.cover_url,meta:x.category_name||''}));
    },
    async detail(url) {
      const x=await kuwoGet(url);
      const rows=await kuwoGet(`${kuwoBase}/novels/api/book/${x.book_id}/chapters?paging=0`);
      if (!Array.isArray(rows)) throw new Error('酷我目录格式已变更');
      return {name:x.title, author:x.author_name, intro:plain(x.intro),cover:x.cover_url,
        chapters:rows.map(c=>({title:c.chapter_title,url:`${kuwoBase}/novels/api/book/${x.book_id}/chapters/${c.chapter_id}`}))};
    },
    async content(url) { return {text:plain((await kuwoGet(url)).content)}; }
  };
  const yyBase='http://m.suixkan.com', yyHosts=['m.suixkan.com'];
  const yyPage=async url=>{ network.allowedUrl(url,yyHosts); return load(await io.text(url,{hosts:yyHosts})); };
  const yueyou={
    id:'yueyou',name:'阅友小说',type:'novel',base:yyBase,hosts:yyHosts,
    mediaHosts:['.yueyouxs.com'], repository:'https://github.com/XIU2/Yuedu',note:'中文小说 · 公开章节，付费章节不会解锁',
    async search(kw) {
      const $=await yyPage(`${yyBase}/s/1.html?keyword=${encodeURIComponent(kw)}&page=1`);
      return $('.v-list-item').map((i,e)=>{
        const el=$(e), href=el.attr('onclick')?.match(/['"]([^'"]+)['"]/)?.[1];
        return href ? {id:absolute(href,yyBase),name:clean(el.find('.v-title').text()),author:clean(el.find('.v-author').text()),cover:absolute(el.find('img').attr('src'),yyBase),meta:clean(el.find('.v-words').text())} : null;
      }).get();
    },
    async detail(url) {
      const $=await yyPage(url), toc=$('.sumchapter a').attr('href');
      if (!toc) throw new Error('阅友目录未找到，作品可能已下架');
      const $$=await yyPage(absolute(toc,yyBase));
      return {name:clean($('.face-info-title').text()),author:clean($('.face-info span').first().text()).replace(/^.*：/,''),intro:plain($('#intro').html()),cover:absolute($('.face-cover img').attr('src'),yyBase),
        chapters:$$('.catalog_ls li a').map((i,e)=>({title:clean($$(e).text()),url:absolute($$(e).attr('href'),yyBase)})).get()};
    },
    async content(url) {
      const $=await yyPage(url);
      const text=$('.con').map((i,e)=>plain($(e).html())).get().join('\n').replace(/[（(]本章(?:未完|完)[^）)]*[）)]/g,'');
      if (text.length<80) throw new Error('阅友未提供公开正文，可能需登录或付费');
      return {text};
    }
  };
  function comic(id,name,base,mobile) {
    const hosts=[new URL(base).hostname,new URL(mobile).hostname];
    const page=async url=>{network.allowedUrl(url,hosts); return io.text(url,{hosts});};
    return {id,name,type:'comic',base,hosts, mediaHosts:['.cdndm5.com'],
      repository:'https://github.com/chashaomanhua/manhuadaquan',note:'中文漫画 · 公开章节；与另一漫画源可能共享资源',
      async search(kw) {
        const $=load(await page(`${base}/search?title=${encodeURIComponent(kw)}&language=1&page=1`));
        const nodes=id==='manhuaren' ? $('.book-list li') : $('.banner_detail_form, .mh-list li');
        const result=nodes.map((i,e)=>{
          const el=$(e), a=el.find(id==='manhuaren'?'a':'a').filter((i,a)=>/^\/manhua/.test($(a).attr('href')||'')).first();
          const title=el.find(id==='manhuaren'?'.book-list-info-title':'.title').first().clone();
          title.find('.right').remove();
          const name=clean(title.text());
          const cover=el.find('img').first().attr('src') || el.find('.mh-cover').attr('style')?.match(/url\(['"]?([^)'"\s]+)/)?.[1];
          return a.length && name ? {id:absolute(a.attr('href'),base),name,cover:absolute(cover,base),author:clean(el.find('.author,.subtitle').first().text())} : null;
        }).get();
        return [...new Map(result.map(x=>[x.id,x])).values()];
      },
      async detail(url) {
        const $=load(await page(url));
        const chapters=$('#detail-list-select-1 a').map((i,e)=>({title:clean($(e).text()),url:absolute($(e).attr('href'),mobile)})).get().reverse();
        if (!chapters.length) throw new Error('漫画目录为空，作品可能已下架或需登录');
        const title=id==='manhuaren' ? $('.detail-main-info-title').first().text() : $('.banner_detail_form .title').first().contents().filter((i,n)=>n.type==='text').text();
        return {name:clean(title),author:clean($(id==='manhuaren'?'.detail-main-info-author':'.banner_detail_form .subtitle').first().text()),intro:clean($(id==='manhuaren'?'.detail-desc':'.banner_detail_form .content').first().text()),
          cover:absolute($('.detail-main-bg').attr('src') || $('.banner_detail_form img').first().attr('src'),base),chapters};
      },
      async content(url) { return {images:comicImages(await page(url)),referer:url}; }
    };
  }
  return [kuwo,yueyou,...additionalNovels(io),...additionalLightNovels(io),...additionalMusic(io),comic('manhuaren','漫画人','https://www.manhuaren.com','https://www.manhuaren.com'),comic('dm5','极速漫画','https://www.1kkk.com','https://m.1kkk.com'),...additionalComics(io),...additionalAnime(io),...kazumiAnimeSources(io)];
}
module.exports={ createSources, comicImages, plain };
