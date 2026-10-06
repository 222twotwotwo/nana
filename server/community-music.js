'use strict';
const {load}=require('cheerio');
const network=require('./network');
const {clean}=require('./source-utils');

// API shapes researched from Listen1 and MusicFree; only site data is parsed.
function communityMusic(io) {
  const neteaseBase='https://music.163.com',neteaseHosts=['music.163.com'];
  const neteaseGet=url=>io.json(url,{hosts:neteaseHosts,headers:{Referer:neteaseBase+'/'}});
  const netease={
    id:'netease-music',name:'网易云音乐',type:'music',base:neteaseBase,hosts:neteaseHosts,
    mediaHosts:['.music.126.net'],audioHosts:['.music.126.net'],
    repository:'https://github.com/listen1/listen1_chrome_extension',
    note:'中外歌曲 · 官方公开播放接口 · 受限曲目请在原站收听，试听片段会单独标注',probe:{keyword:'起风了',book:'^起风了$'},
    async search(keyword) {
      const d=await neteaseGet(`${neteaseBase}/api/cloudsearch/pc?${new URLSearchParams({s:keyword,type:'1',limit:'30',offset:'0'})}`);
      if(d.code!==200 || !d.result) throw new Error('网易云搜索暂不可用，请稍后重试');
      return (d.result.songs||[]).filter(s=>s.id&&s.name).map(s=>({
        id:`${neteaseBase}/song?id=${s.id}`,pageUrl:`${neteaseBase}/song?id=${s.id}`,name:clean(s.name),
        author:(s.ar||[]).map(a=>clean(a.name)).join(' / '),cover:s.al?.picUrl||'',meta:clean(s.al?.name),duration:Number(s.dt||0)/1000,
        restricted:s.privilege?.pl===0,format:'MP3'
      }));
    },
    async play(value) {
      const u=network.allowedUrl(value,neteaseHosts),id=u.searchParams.get('id');
      if(u.pathname!=='/song' || !/^\d+$/.test(id||'')) throw new Error('无效网易云歌曲地址');
      const d=await neteaseGet(`${neteaseBase}/api/song/enhance/player/url?${new URLSearchParams({ids:JSON.stringify([Number(id)]),br:'128000'})}`),p=d.data?.[0];
      if(d.code!==200 || !p?.url || p.code!==200) throw new Error('该曲目暂不提供公开播放，请在网易云原站收听');
      const stream=network.allowedUrl(p.url,['.music.126.net']).href;
      return {stream,referer:neteaseBase+'/',preview:!!p.freeTrialInfo,size:Number(p.size||0),duration:p.freeTrialInfo?Number(p.freeTrialInfo.end-p.freeTrialInfo.start):Number(p.time||0)/1000};
    }
  };
  const base='http://www.htqyy.com',hosts=['www.htqyy.com'];
  const page=url=>io.text(url,{hosts,headers:{Referer:base+'/'}});
  const htqyy={
    id:'htqyy',name:'好听轻音乐',type:'music',base,hosts,mediaHosts:['i.htqyy.com'],audioHosts:['s1.htqyy.com'],
    repository:'https://github.com/hebijunge/musicfree-plugins',
    note:'纯音乐、钢琴与影视配乐 · 站点公开 MP3 · 可直连',probe:{keyword:'天空之城'},
    async search(keyword) {
      const $=load(await page(`${base}/home/search?${new URLSearchParams({wd:keyword,p:'1'})}`)),seen=new Set();
      return $('.musicItem').map((i,e)=>{
        const row=$(e),a=row.find('.title a[href^="/play/"]').first(),id=a.attr('href')?.match(/^\/play\/(\d+)$/)?.[1];
        if(!id||seen.has(id)) return null;seen.add(id);
        return {id:`${base}/play/${id}`,pageUrl:`${base}/play/${id}`,name:clean(a.text()),author:clean(row.find('.artistName').text())||'好听轻音乐',meta:clean(row.find('.albumName').text()),cover:`http://i.htqyy.com/img8/0/${id}.jpg`,format:'MP3'};
      }).get().slice(0,30);
    },
    async play(value) {
      const u=network.allowedUrl(value,hosts),id=u.pathname.match(/^\/play\/(\d+)$/)?.[1];
      if(!id) throw new Error('无效轻音乐曲目地址');
      const html=await page(u.href),file=html.match(/\bvar\s+mp3\s*=\s*["'](\d+\/mp3\/1)["']/)?.[1];
      if(!file || file.split('/')[0]!==id) throw new Error('原站未提供该曲目的公开音频');
      return {stream:`http://s1.htqyy.com/play9/${file}`,referer:base+'/'};
    }
  };
  return [netease,htqyy];
}
module.exports={communityMusic};
