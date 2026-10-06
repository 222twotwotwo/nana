'use strict';
const {load}=require('cheerio');
const network=require('./network');
const {clean,absolute,plain}=require('./source-utils');

function decodeUrl(value) {
  let out=String(value||'');
  if(/^[A-Za-z0-9+/]+={0,2}$/.test(out) && out.length%4===0) {
    try {
      const decoded=Buffer.from(out,'base64').toString('utf8');
      if(/%[0-9a-f]{2}/i.test(decoded)) out=decoded;
    } catch {}
  }
  for(let i=0;i<2 && /%(?:[0-9a-f]{2})/i.test(out);i++) {
    try { out=decodeURIComponent(out); } catch { throw new Error('番剧播放地址编码无效'); }
  }
  return out;
}
function playerData(html) {
  const start=String(html).search(/\bplayer_aaaa\s*=\s*\{/);
  if(start<0) throw new Error('番剧播放页未提供公开地址');
  const open=String(html).indexOf('{',start); let depth=0,quote='',esc=false;
  for(let i=open;i<html.length;i++) {
    const c=html[i];
    if(quote){ if(esc) esc=false; else if(c==='\\') esc=true; else if(c===quote) quote=''; continue; }
    if(c==='"'){quote=c;continue;} if(c==='{') depth++; else if(c==='}' && --depth===0){
      try { return JSON.parse(html.slice(open,i+1)); } catch { throw new Error('番剧播放数据格式无效'); }
    }
  }
  throw new Error('番剧播放数据不完整');
}

function hhjxBootstrap(html) {
  const match=String(html).match(/window\.__HHJX_BOOTSTRAP__\s*=\s*(\{[\s\S]*?\});/);
  if(!match) throw new Error('番剧播放页未提供解析参数');
  try { return JSON.parse(match[1]); } catch { throw new Error('番剧解析参数格式无效'); }
}

function parseDmbusSearch(html, base) {
  const $=load(html), rows=[];
  $('.v_list li').each((i,e)=>{
    const el=$(e), a=el.find('a.title').first();
    const id=absolute(a.attr('href'),base), name=clean(a.attr('title')||a.text());
    const image=el.find('a.cover').attr('data-bg')||el.find('img').attr('data-src')||el.find('img').attr('src');
    if(id && name) rows.push({id,name,cover:absolute(image,base),meta:clean(el.find('.desc').text())});
  });
  return [...new Map(rows.map(x=>[x.id,x])).values()].slice(0,50);
}

function parseDmbusDetail(html, base) {
  const $=load(html);
  const name=clean($('.v_title a').first().text()||$('title').text().replace(/^《|》.*$/g,''));
  const cover=$('.v_content .cover img').first().attr('src')||$('meta[property="og:image"]').attr('content');
  const intro=plain($('#intro').html()||'');
  const chapters=$('.play_list a[href*="/p/"]').map((i,e)=>({title:clean($(e).text())||`第${i+1}集`,url:absolute($(e).attr('href'),base)})).get();
  if(!name || !chapters.length) throw new Error('动漫巴士详情或目录为空');
  return {name,cover:absolute(cover,base),intro,chapters:[...new Map(chapters.map(x=>[x.url,x])).values()]};
}

function additionalDmbus(io) {
  const base='https://dmbus.cc';
  const hosts=['dmbus.cc','www.dmbus.cc'];
  const playerHosts=['hhjx.hhplayer.com'];
  const mediaHosts=['.gtimg.com','.qq.com','.qpic.cn','.dmbus.cc','.hhplayer.com','.dytt-tvs.com'];
  const page=async url=>{ network.allowedUrl(url,hosts); return io.text(url,{hosts,route:'direct'}); };
  return {
    id:'kazumi-dm84',name:'DM84',type:'anime',base,hosts,mediaHosts,route:'direct',
    repository:'https://github.com/Predidit/Kazumi',
    note:'Kazumi 番剧源 · 动漫巴士公开搜索、目录与播放地址',
    probe:{keyword:'火影',book:'^火影忍者$',chapter:'^1$'},
    async search(keyword) {
      return parseDmbusSearch(await page(`${base}/s----------.html?wd=${encodeURIComponent(keyword)}`),base);
    },
    async detail(url) { return parseDmbusDetail(await page(url),base); },
    async play(episodeUrl) {
      const episodeHtml=await page(episodeUrl);
      const iframe=load(episodeHtml)('iframe[src]').first().attr('src');
      if(!iframe) throw new Error('动漫巴士播放页未提供播放器');
      const playerUrl=absolute(iframe,episodeUrl);
      network.allowedUrl(playerUrl,playerHosts);
      const playerHtml=await io.text(playerUrl,{hosts:playerHosts,route:'direct'});
      const bootstrap=hhjxBootstrap(playerHtml);
      const apiUrl=new URL('/api/parse',playerUrl).href;
      const payload={url:bootstrap.url,t:bootstrap.t,key:bootstrap.key,client_fallback:false};
      if(bootstrap.act===99) payload.act=99;
      const raw=await io.text(apiUrl,{hosts:playerHosts,route:'direct',method:'POST',headers:{Origin:'https://hhjx.hhplayer.com',Referer:playerUrl,'Content-Type':'application/json'},body:JSON.stringify(payload)});
      let result; try { result=JSON.parse(raw); } catch { throw new Error('番剧解析接口返回无效'); }
      if(result.code!==200 || typeof result.url!=='string' || !result.url) throw new Error(result.msg||'番剧播放地址解析失败');
      network.allowedUrl(result.url,mediaHosts);
      return {stream:result.url,referer:episodeUrl};
    }
  };
}

function additionalAnime(io) {
  const base='https://www.7sefun.top';
  const hosts=['www.7sefun.top','www.lmm85.com','www.lm85.com'];
  const mediaHosts=['.adkwai.com','.qpic.cn','.lmm85.com','.lm85.com','.dytt-tupian.com'];
  const page=async url=>{ network.allowedUrl(url,hosts); return io.text(url,{hosts,route:'direct'}); };
  return [{
    id:'kazumi-7sefun',name:'7sefun',type:'anime',base,hosts,mediaHosts,route:'direct',
    repository:'https://github.com/Predidit/Kazumi',
    note:'Kazumi 番剧源 · 公开搜索、目录与播放地址',
    probe:{keyword:'火影',book:'^火影忍者$',chapter:'^第0'},
    async search(keyword) {
      const $=load(await page(`${base}/vodsearch/-------------.html?wd=${encodeURIComponent(keyword)}`));
      const rows=[];
      $('a[href*="/voddetail/"]').each((i,e)=>{
        const href=$(e).attr('href'), id=absolute(href,base);
        if(!id || rows.some(x=>x.id===id)) return;
        const card=$(e).closest('.video');
        const name=clean($(e).attr('title')||$(e).find('img').attr('alt')||card.find('.video-by,.title,.name').first().text()||$(e).text());
        const cover=$(e).find('img').attr('data-src')||$(e).find('img').attr('src')||card.find('img').first().attr('src');
        if(name) rows.push({id,name,cover:absolute(cover,base)});
      });
      return rows.slice(0,50);
    },
    async detail(url) {
      const $=load(await page(url));
      const name=clean($('.video-p-name').first().contents().filter((i,n)=>n.type==='text').text()||$('title').text().replace(/简介.*$/,''));
      const cover=$('.video-author img,.video-detail img').first().attr('src');
      const intro=plain($('.video-p-subtitle').first().html()||'');
      const chapters=$('.vod-play-list-container a[href*="/vodplay/"]').map((i,e)=>({title:clean($(e).text()||$(e).attr('title')),url:absolute($(e).attr('href'),base)})).get();
      if(!name || !chapters.length) throw new Error('番剧详情或目录为空');
      return {name,cover:absolute(cover,base),intro,chapters:[...new Map(chapters.map(x=>[x.url,x])).values()]};
    },
    async play(episodeUrl) {
      let current=episodeUrl, referer=episodeUrl;
      for(let depth=0;depth<3;depth++) {
        const html=await page(current);
        const direct=html.match(/https?:[^\s"'<>\\]+\.(?:mp4|m3u8)(?:\?[^\s"'<>\\]*)?/i)?.[0];
        if(direct) { network.allowedUrl(direct,mediaHosts); return {stream:direct,referer}; }
        const data=playerData(html);
        const decoded=decodeUrl(data.url);
        if(/\.(?:mp4|m3u8)(?:$|[?#])/i.test(decoded)) {
          network.allowedUrl(decoded,mediaHosts);
          return {stream:decoded,referer};
        }
        // Some 7sefun episodes delegate to lmm85's member-only browser player.
        // Do not bypass that restriction or return an iframe that the source forbids.
        if(data.from==='vxdev' && current.startsWith('https://www.lmm85.com/')) {
          throw new Error('该集需要在 7sefun 原站登录后播放');
        }
        network.allowedUrl(decoded,hosts);
        current=decoded;
        referer=episodeUrl;
      }
      throw new Error('番剧播放地址仍是中转页，请打开原站播放');
    }
  },additionalDmbus(io)];
}
module.exports={additionalAnime,decodeUrl,playerData,hhjxBootstrap,parseDmbusSearch,parseDmbusDetail};
