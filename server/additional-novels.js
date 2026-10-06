'use strict';
const {load}=require('cheerio');
const {clean,plain,absolute,unique}=require('./source-utils');

function additionalNovels(io) {
  const base='https://www.sudugu.cc',hosts=['www.sudugu.cc'];
  const page=async(url,options={})=>load(await io.text(url,{hosts,...options}));
  const sudugu={
    id:'sudugu',name:'速读谷',type:'novel',base,hosts,mediaHosts:hosts,
    repository:'https://github.com/freeok/so-novel',note:'中文网文 · 搜索至少两个汉字 · 自动合并目录和正文分页',
    probe:{keyword:'剑来',book:'^剑来$',chapter:'^第一章'},
    async search(kw) {
      if(Buffer.byteLength(kw)<4) throw new Error('速读谷要求至少两个汉字，请输入更完整的书名');
      const $=await page(base+'/modules/article/search.php',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({searchkey:kw,action:'login',searchtype:'articlename',submit:''}).toString()});
      return $('.item').map((i,e)=>{const el=$(e),a=el.find('h3 a');return a.length?{id:absolute(a.attr('href'),base),name:clean(a.text()),author:clean(el.find('.itemtxt ul li').first().text()).replace(/^作者[：:]?/,''),cover:absolute(el.find('img').attr('src'),base)}:null;}).get();
    },
    async detail(url) {
      let $=await page(url);
      const result={name:clean($('.itemtxt h1 a').text()),author:clean($('.itemtxt p a').first().text()).replace(/^作者[：:]?/,''),intro:plain($('.des').html()),cover:absolute($('.item img').first().attr('src'),url),chapters:[]};
      const seen=new Set();
      for(let n=0;n<100;n++) {
        if(seen.has(url)) throw new Error('源站目录分页循环，未保存不完整目录');
        seen.add(url);
        if(!$('#list a[href]').length) throw new Error('源站目录分页为空，未保存不完整目录');
        result.chapters.push(...$('#list a[href]').map((i,e)=>({title:clean($(e).text()),url:absolute($(e).attr('href'),url)})).get());
        const next=$('a.gr[href]').filter((i,e)=>clean($(e).text())==='下一页').attr('href');
        if(!next||next.startsWith('#')) {result.chapters=unique(result.chapters);return result;}
        url=absolute(next,url);$=await page(url);
      }
      throw new Error('目录页数超过限制，未保存不完整目录');
    },
    async content(url) {
      const chunks=[],seen=new Set(),start=new URL(url);
      const chapter=start.pathname.replace(/_\d+(?=\.html$)/,'');
      for(let n=0;n<20;n++) {
        if(seen.has(url)) throw new Error('正文分页循环，请稍后重试');
        seen.add(url);const $=await page(url);
        const text=plain($('.con').html()).replace(/[（(]本章(?:未完|完)[^）)]*[）)]/g,'');
        if(text.length<30) throw new Error('正文分页为空，未返回截断章节');
        chunks.push(text);
        const next=$('a[href]').filter((i,e)=>clean($(e).text())==='下一页').attr('href');
        if(!next||next.startsWith('#')) return {text:chunks.join('\n')};
        const target=new URL(next,url);
        if(target.origin!==start.origin||target.pathname.replace(/_\d+(?=\.html$)/,'')!==chapter) throw new Error('正文分页指向其他章节');
        url=target.href;
      }
      throw new Error('正文分页超过限制，未返回截断章节');
    }
  };
  const bbase='https://www.biquge365.net',bhosts=['www.biquge365.net'];
  const bpage=async(url,options={})=>load(await io.text(url,{hosts:bhosts,route:'proxy',...options}));
  const biquge365={
    id:'biquge365',name:'笔趣阁365',type:'novel',base:bbase,hosts:bhosts,mediaHosts:bhosts,route:'proxy',
    repository:'https://github.com/freeok/so-novel',note:'中文网文 · 需要代理 · 搜索显示前 100 项，建议输入完整书名',probe:{keyword:'剑来'},
    async search(kw) {
      const $=await bpage(bbase+'/s.php',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({type:'articlename',s:kw}).toString()});
      return $('div.menu li').map((i,e)=>{const el=$(e),a=el.find('span.name > a');return a.length?{id:absolute(a.attr('href'),bbase),name:clean(a.text()),author:clean(el.find('span.zuo > a').text()),meta:clean(el.find('span.lei > a').text())}:null;}).get().slice(0,100);
    },
    async detail(url) {
      const $=await bpage(url),meta=key=>$(`meta[property="${key}"]`).attr('content')||'';
      const toc=$('a[href]').filter((i,e)=>clean($(e).text())==='全部章节目录').attr('href');
      if(!toc) throw new Error('源站未提供完整目录');
      const $$=await bpage(absolute(toc,url));
      return {name:meta('og:novel:book_name'),author:meta('og:novel:author'),intro:meta('og:description'),cover:meta('og:image'),chapters:unique($$('div.menu > div.border > ul > li > a').map((i,e)=>({title:clean($$(e).text()),url:absolute($$(e).attr('href'),url)})).get())};
    },
    async content(url) {
      const $=await bpage(url);$('#txt p[style],#txt script,#txt .ads').remove();
      return {text:plain($('#txt').html()).replace(/[（(]本章未完[^）)]*[）)]/g,'')};
    }
  };
  const wbase='https://zh.wikisource.org',whosts=['zh.wikisource.org'];
  const wiki=async params=>{
    const d=await io.json(wbase+'/w/api.php?'+new URLSearchParams({format:'json',...params}),{hosts:whosts,route:'proxy'});
    if(d.error) throw new Error('维基文库：'+d.error.info);return d;
  };
  const wikiTitle=url=>{const u=new URL(url);if(!u.pathname.startsWith('/wiki/')) throw new Error('文库页面地址无效');return decodeURIComponent(u.pathname.slice(6));};
  const wikiUrl=title=>wbase+'/wiki/'+encodeURIComponent(title);
  const wikisource={
    id:'wikisource',name:'维基文库',type:'novel',base:wbase,hosts:whosts,mediaHosts:['upload.wikimedia.org'],route:'proxy',
    repository:wbase,note:'中文经典文学、古籍 · 需要代理 · 依原文版本保留简繁体',probe:{keyword:'三國演義',book:'^三國演義$',chapter:'^第一回$'},
    async search(kw) {
      const d=await wiki({action:'query',list:'search',srsearch:'intitle:'+kw,srnamespace:0,srlimit:50});
      return d.query.search.map(x=>({id:wikiUrl(x.title),name:x.title,author:'维基文库',meta:plain(x.snippet)}));
    },
    async detail(url) {
      const {parse:d}=await wiki({action:'parse',page:wikiTitle(url),prop:'text',redirects:1}),$=load(d.text['*']);
      const chapters=unique($('a[title][href]').map((i,e)=>{const a=$(e),title=a.attr('title');return title.startsWith(d.title+'/')&&!a.hasClass('new')&&!/全[覽览文]/.test(title.slice(d.title.length+1))?{title:clean(a.text()),url:wikiUrl(title)}:null;}).get());
      return {name:d.title,author:clean($('#headerContainer a[title^="作者:"]').first().text())||'见原文署名',intro:'来源：中文维基文库；原文及校订的作者、许可和版本见来源页面。',cover:'',chapters:chapters.length?chapters:[{title:d.title,url:wikiUrl(d.title)}]};
    },
    async content(url) {
      const {parse:d}=await wiki({action:'parse',page:wikiTitle(url),prop:'text',redirects:1}),$=load(d.text['*']);
      $('script,style,.mw-editsection,.noprint,#headerContainer,.ws-noexport,.licenseContainer,.navbox,.catlinks,#toc').remove();
      const text=plain($.html());
      if(text.length<80) throw new Error('文库页面没有足够的可读正文');
      return {text:text+'\n\n来源：中文维基文库 '+wikiUrl(d.title)+'\n原文及校订的署名、许可和版本记录见来源页面。'};
    }
  };
  return [sudugu,biquge365,wikisource];
}
module.exports={additionalNovels};
