'use strict';
const {load}=require('cheerio');
const {clean,absolute,unique}=require('./source-utils');
const {readNuxt}=require('./source-data');

function additionalComics(io) {
  const kbase='https://www.kuaikanmanhua.com',khosts=['www.kuaikanmanhua.com','api.kkmh.com'];
  const kpage=async url=>readNuxt(await io.text(url,{hosts:khosts})).data[0];
  const free=c=>c.is_free===true&&!c.locked&&!c.need_vip&&!c.is_vip_exclusive;
  const kuaikan={
    id:'kuaikan',name:'快看漫画',type:'comic',base:kbase,hosts:khosts,mediaHosts:['.v3mh.com','.kkmh.com'],
    repository:'https://github.com/keiyoushi/extensions-source',note:'国漫、韩漫 · 官方公开章节，付费及下架作品可能不可读',probe:{keyword:'拔剑九亿次',book:'^拔剑九亿次$',chapter:'^第0'},
    async search(kw) {
      const d=await io.json('https://api.kkmh.com/v1/search/topic?'+new URLSearchParams({q:kw,since:0,size:50}),{hosts:khosts});
      if(!Array.isArray(d.data?.hit)) throw new Error('快看搜索暂不可用');
      return d.data.hit.filter(x=>x.content_carrier===0).map(x=>({id:kbase+'/web/topic/'+x.id,name:x.title,author:x.user?.nickname||'',cover:x.vertical_image_url,meta:(x.category||[]).join(' / ')}));
    },
    async detail(url) {
      const d=await kpage(url),t=d.topicInfo;
      if(!t?.title||!Array.isArray(d.comics)) throw new Error('快看作品已下架或暂未开放网页阅读');
      const chapters=d.comics.filter(free).map(c=>({title:c.title,url:kbase+'/web/comic/'+c.id}));
      if(!chapters.length) throw new Error('该作品没有公开免费章节，请在快看官方查看');
      return {name:t.title,author:t.user?.nickname||'',intro:`网页公开可读 ${chapters.length} / ${d.comics.length} 话。${t.description||''}`,cover:t.vertical_image_url,chapters};
    },
    async content(url) {
      const id=new URL(url).pathname.match(/^\/web\/comic\/(\d+)$/)?.[1];
      if(!id) throw new Error('快看章节地址无效');
      const d=await kpage(kbase+'/webs/comic-next/'+id),c=d.res?.data?.comic_info;
      if(!c||!free(c)) throw new Error('本话未公开免费内容，请在快看官方查看');
      const images=(c.comic_images||[]).map(x=>x.url).filter(Boolean);
      if(!images.length) throw new Error('快看未提供本话图片');
      return {images,referer:url};
    }
  };
  const wbase='https://www.webtoons.com',whosts=['www.webtoons.com','m.webtoons.com'];
  const wpage=async url=>load(await io.text(url,{hosts:whosts,route:'proxy'}));
  const webtoon={
    id:'webtoon-zh',name:'WEBTOON 繁体中文',type:'comic',base:wbase,hosts:whosts,mediaHosts:['webtoon-phinf.pstatic.net','swebtoon-phinf.pstatic.net'],route:'proxy',
    repository:'https://www.webtoons.com/zh-hant/',note:'繁体中文漫画 · 需要代理 · 仅网页公开话数，部分作品需官方 App',probe:{keyword:'愛'},
    async search(kw) {
      const $=await wpage(wbase+'/zh-hant/search?keyword='+encodeURIComponent(kw));
      return unique($('a._card_item').map((i,e)=>{const a=$(e),href=a.attr('href');return href&&a.attr('data-title-unsuitable-for-children')!=='true'?{id:absolute(href,wbase),name:clean(a.find('.info_text .title').text()),author:clean(a.find('.author').text()),cover:absolute(a.find('img').attr('src'),wbase)}:null;}).get());
    },
    async detail(url) {
      const titleNo=new URL(url).searchParams.get('title_no');
      if(!/^\d+$/.test(titleNo||'')) throw new Error('WEBTOON 作品地址无效');
      const $=await wpage(url),meta=key=>$(`meta[property="${key}"]`).attr('content')||'';
      const chapters=[],seen=new Set();let cursor='';
      for(let n=0;n<100;n++) {
        const query=new URLSearchParams({pageSize:500,readingLanguageCode:'zh-hant'});
        if(cursor) query.set('cursor',cursor);
        const d=await io.json(`https://m.webtoons.com/api/v1/webtoon/${titleNo}/episodes?${query}`,{hosts:whosts,route:'proxy'});
        if(!d.success||!Array.isArray(d.result?.episodeList)) throw new Error('WEBTOON 目录接口暂不可用');
        chapters.push(...d.result.episodeList.filter(x=>x.viewerLink?.startsWith('/zh-hant/')).map(x=>({title:x.episodeTitle,url:absolute(x.viewerLink,wbase),order:x.episodeNo})));
        const next=d.result.nextCursor;
        if(!next) return {name:meta('og:title'),author:meta('com-linewebtoon:webtoon:author'),intro:'以下为当前网页公开话数。'+meta('og:description'),cover:meta('og:image'),chapters:unique(chapters).sort((a,b)=>a.order-b.order).map(({order,...c})=>c)};
        if(seen.has(String(next))) throw new Error('WEBTOON 目录分页循环');
        seen.add(String(next));cursor=String(next);
      }
      throw new Error('WEBTOON 目录超出分页限制');
    },
    async content(url) {
      const $=await wpage(url),images=$('#_imageList img[data-url]').map((i,e)=>absolute($(e).attr('data-url'),url)).get();
      if(!images.length) throw new Error('本话未提供公开图片，可能需官方 App 或登录');
      return {images,referer:url};
    }
  };
  const mbase='https://api.mangadex.org',mhosts=['api.mangadex.org'];
  const mget=async url=>{
    const d=await io.json(url,{hosts:mhosts});
    if(d.result!=='ok') throw new Error('MangaDex 接口暂不可用');return d;
  };
  const title=t=>t.attributes.altTitles?.find(x=>x.zh)?.zh||t.attributes.altTitles?.find(x=>x['zh-hk'])?.['zh-hk']||t.attributes.title.zh||t.attributes.title['zh-hk']||Object.values(t.attributes.title)[0];
  const author=t=>t.relationships?.filter(x=>x.type==='author').map(x=>x.attributes?.name).filter(Boolean).join(' / ')||'';
  const cover=t=>{const file=t.relationships?.find(x=>x.type==='cover_art')?.attributes?.fileName;return file?`https://uploads.mangadex.org/covers/${t.id}/${file}.256.jpg`:'';};
  const uuid=url=>{const id=new URL(url).pathname.split('/').at(-1);if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)) throw new Error('MangaDex 地址无效');return id;};
  const mangadex={
    id:'mangadex-zh',name:'MangaDex 中文',type:'comic',base:mbase,hosts:mhosts,mediaHosts:['uploads.mangadex.org','.mangadex.network','.mangadex.org'],
    repository:'https://api.mangadex.org/docs/',note:'简体／繁体译本 · 仅中文章节，部分作品中文更新不齐全 · 搜索最多 100 项',probe:{keyword:'剑'},
    async search(kw) {
      const query=new URLSearchParams({title:kw,limit:100});
      for(const lang of ['zh','zh-hk']) query.append('availableTranslatedLanguage[]',lang);
      for(const type of ['cover_art','author']) query.append('includes[]',type);
      for(const rating of ['safe','suggestive']) query.append('contentRating[]',rating);
      const d=await mget(mbase+'/manga?'+query);
      return d.data.map(t=>({id:mbase+'/manga/'+t.id,name:title(t),author:author(t),cover:cover(t),meta:'中文译本'}));
    },
    async detail(url) {
      const id=uuid(url),{data:t}=await mget(`${mbase}/manga/${id}?includes[]=cover_art&includes[]=author`),chapters=[];
      let offset=0;
      while(offset<10000) {
        const q=new URLSearchParams({limit:500,offset,'order[chapter]':'asc',includeExternalUrl:0});
        for(const lang of ['zh','zh-hk']) q.append('translatedLanguage[]',lang);
        q.append('includes[]','scanlation_group');
        const d=await mget(`${mbase}/manga/${id}/feed?${q}`);
        for(const c of d.data) {
          const a=c.attributes;
          if(!['zh','zh-hk'].includes(a.translatedLanguage)||a.isUnavailable||a.externalUrl||!a.pages) continue;
          const group=c.relationships?.find(r=>r.type==='scanlation_group')?.attributes?.name;
          chapters.push({title:`${a.volume?'卷 '+a.volume+' · ':''}${a.chapter?'第 '+a.chapter+' 话':''} ${a.title||''} [${a.translatedLanguage==='zh'?'简中':'繁中'}${group?' · '+group:''}]`.trim(),url:mbase+'/chapter/'+c.id});
        }
        offset+=d.data.length;
        if(offset>=d.total) {
          const desc=t.attributes.description||{};
          return {name:title(t),author:author(t),cover:cover(t),intro:desc.zh||desc['zh-hk']||desc.en||'',chapters:unique(chapters)};
        }
        if(!d.data.length) throw new Error('MangaDex 目录分页提前结束');
      }
      throw new Error('中文章节超过接口上限，未返回不完整目录');
    },
    async content(url) {
      const d=await mget(mbase+'/at-home/server/'+uuid(url));
      if(!d.baseUrl||!d.chapter?.data?.length) throw new Error('MangaDex 图片暂不可用');
      return {images:d.chapter.data.map(file=>`${d.baseUrl}/data/${d.chapter.hash}/${file}`),referer:url};
    }
  };
  return [kuaikan,webtoon,mangadex];
}
module.exports={additionalComics};
