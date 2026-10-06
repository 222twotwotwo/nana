'use strict';
const network=require('./network');
const {clean}=require('./source-utils');
const {communityMusic}=require('./community-music');

function additionalMusic(io) {
  const base='https://archive.org',hosts=['archive.org','www.archive.org'];
  const json=async url=>io.json(url,{hosts,route:'proxy'});
  const archive={
    id:'archive-audio',name:'Internet Archive 音频',type:'music',base,hosts,mediaHosts:[...hosts,'.archive.org'],audioHosts:[...hosts,'.archive.org'],route:'proxy',
    repository:'https://archive.org/developers/metadata.html',
    note:'公开音频元数据与直接音频文件 · 以授权和源站标注为准 · 需要代理',
    probe:{keyword:'ambient'},
    async search(keyword) {
      const q=`title:("${keyword.replace(/["\\()]/g,' ')}") AND mediatype:audio AND NOT access-restricted-item:true`;
      const u=`${base}/advancedsearch.php?${new URLSearchParams({q,'fl[]':'identifier,title,creator,description','rows':'12','page':'1','output':'json'})}`;
      const d=await json(u),docs=d.response?.docs||[],out=[];
      let failures=0;
      for(let i=0;i<docs.length;i+=3) {
        const rows=await Promise.all(docs.slice(i,i+3).map(async row=>{
        if(!row.identifier || !row.title) return null;
        try {
          const meta=await json(`${base}/metadata/${encodeURIComponent(row.identifier)}`);
          if(meta.is_dark || String(meta.metadata?.['access-restricted-item'])==='true') return null;
          const file=(meta.files||[]).filter(f=>!f.private && /\.(?:mp3|ogg|m4a|wav)$/i.test(f.name||'') && Number(f.size)>0 && Number(f.size)<=100*1024*1024).sort((a,b)=>Number(a.size)-Number(b.size))[0];
          if(!file) return null;
          const path=file.name.split('/').map(encodeURIComponent).join('/');
          return {id:`${base}/download/${encodeURIComponent(row.identifier)}/${path}`,name:clean(file.title||row.title),author:clean(Array.isArray(row.creator)?row.creator.join(', '):row.creator||'Internet Archive'),meta:'公开音频',cover:`${base}/services/img/${encodeURIComponent(row.identifier)}`,pageUrl:`${base}/details/${encodeURIComponent(row.identifier)}`,size:Number(file.size||0),format:file.format||''};
        } catch {failures++;return null;}
        }));
        out.push(...rows.filter(Boolean));
      }
      if(!out.length && failures) throw new Error('Internet Archive 音频详情暂不可用，请重试');
      return out;
    },
    async play(url) {
      const u=network.allowedUrl(url,hosts);
      if(!/^\/download\/[^/]+\/.+\.(?:mp3|ogg|m4a|wav)$/i.test(u.pathname)) throw new Error('音频地址不是公开音频文件');
      return {stream:u.href,referer:`${base}/`};
    }
  };
  const commonsBase='https://commons.wikimedia.org',commonsHosts=['commons.wikimedia.org','upload.wikimedia.org'];
  const commons={
    id:'wikimedia-audio',name:'Wikimedia Commons 音频',type:'music',base:commonsBase,hosts:commonsHosts,mediaHosts:commonsHosts,audioHosts:['upload.wikimedia.org'],route:'proxy',
    repository:'https://commons.wikimedia.org/wiki/Commons:Audio_files',
    note:'维基共享资源公开音频 · 以文件页授权标注为准 · 需要代理',probe:{keyword:'piano'},
    async search(keyword) {
      const params=new URLSearchParams({action:'query',generator:'search',gsrsearch:`${keyword} filetype:audio`,gsrnamespace:'6',gsrlimit:'12',prop:'imageinfo',iiprop:'url|size|mime',iiurlwidth:'320',format:'json',origin:'*'});
      const d=await io.json(`${commonsBase}/w/api.php?${params}`,{hosts:commonsHosts,route:'proxy'});
      if(d.error) throw new Error('Wikimedia 搜索暂不可用');
      return Object.values(d.query?.pages||{}).flatMap(row=>{
        const info=row.imageinfo?.[0],mime=info?.mime||'';
        if(!info?.url || !/^(?:audio\/(?:mpeg|ogg|wav|x-wav|mp4|aac|flac)|application\/ogg)$/i.test(mime) || Number(info.size||0)>100*1024*1024) return [];
        return [{id:info.url,name:clean(row.title?.replace(/^File:/i,'')),author:'Wikimedia Commons',meta:'授权见原站文件页',pageUrl:info.descriptionurl||`${commonsBase}/wiki/${encodeURIComponent(row.title)}`,duration:Number(info.duration||0),cover:info.thumburl||'',size:Number(info.size||0),format:mime}];
      });
    },
    async play(url) {
      const u=network.allowedUrl(url,['upload.wikimedia.org']);
      if(!/^\/wikipedia\/commons\/.+\.(?:mp3|ogg|oga|wav|m4a|aac|flac)$/i.test(u.pathname)) throw new Error('音频地址不是公开音频文件');
      return {stream:u.href,referer:`${commonsBase}/`};
    }
  };
  return [...communityMusic(io),archive,commons];
}
module.exports={additionalMusic};
