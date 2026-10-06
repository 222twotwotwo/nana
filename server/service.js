'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {createSources}=require('./sources');
const network=require('./network');
const {openAudio}=require('./audio');

const DAY=86400000;
class ReaderService {
  constructor({sources=createSources(),dataDir=path.join(__dirname,'../data'),io=network}={}) {
    this.sources=sources; this.dataDir=dataDir; this.io=io;
    this.pending=new Map(); this.health={}; this.active=new Map();
  }
  async init() {
    await fs.mkdir(path.join(this.dataDir,'cache'),{recursive:true});
    try { this.health=JSON.parse(await fs.readFile(path.join(this.dataDir,'health.json'),'utf8')); } catch {}
    await this.pruneCache();
  }
  async pruneCache() {
    const dir=path.join(this.dataDir,'cache'), rows=[];
    for(const name of await fs.readdir(dir)) {
      if(!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const file=path.join(dir,name),stat=await fs.stat(file);
      rows.push({file,time:stat.mtimeMs,size:stat.size});
    }
    let size=0;
    for(const [i,r] of rows.sort((a,b)=>b.time-a.time).entries()) {
      size+=r.size;
      if(i>=2000 || size>100*1024*1024 || Date.now()-r.time>30*DAY) await fs.unlink(r.file);
    }
  }
  source(id) {
    const aliases={'srv:novel:0':'kuwo','srv:novel:1':'yueyou','srv:comic:0':'manhuaren','srv:comic:1':'dm5','7sefun':'kazumi-7sefun','dm84':'kazumi-dm84'};
    const requested=String(id||''), target=aliases[requested] || requested;
    const s=this.sources.find(s=>s.id===target || s.id===`kazumi-${requested.toLowerCase()}` || s.name.toLowerCase()===requested.toLowerCase());
    if(!s) throw Object.assign(new Error('该书源未接入，请在书城选择当前可用来源'),{status:404});
    return s;
  }
  list() {
    return this.sources.map(({id,name,type,base,repository,note,route='direct'})=>{
      const check=this.health[id] || null;
      return {id,name,type,base,repository,note,route,health:check,
        status:!check?'unchecked':Date.now()-Date.parse(check.checkedAt)>DAY?'stale':check.ok?'healthy':'failed'};
    });
  }
  async cached(key,ttl,loader) {
    if(this.pending.has(key)) return this.pending.get(key);
    const promise=(async()=>{
      const file=path.join(this.dataDir,'cache',createHash('sha256').update(key).digest('hex')+'.json');
      try { const c=JSON.parse(await fs.readFile(file,'utf8')); if(Date.now()-c.at<ttl) return c.data; } catch {}
      const data=await loader();
      await fs.writeFile(file,JSON.stringify({at:Date.now(),data}));
      return data;
    })();
    this.pending.set(key,promise);
    try{return await promise;}finally{this.pending.delete(key);}
  }
  async action(id,action,value,{fresh=false}={}) {
    const s=this.source(id);
    if(!['search','detail','content','play'].includes(action)) throw Object.assign(new Error('未知操作'),{status:400});
    if(action==='play' && !['anime','music'].includes(s.type)) throw Object.assign(new Error('该来源不支持媒体播放'),{status:400});
    if(typeof value!=='string' || !value.trim() || value.length>(action==='search'?100:2048)) throw Object.assign(new Error('搜索词或地址无效'),{status:400});
    if(action!=='search') network.allowedUrl(value,s.hosts);
    if(typeof s[action]!=='function') throw Object.assign(new Error('该来源不支持此操作'),{status:400});
    const run=async()=>{
      if((this.active.get(s.id)||0)>=3) throw Object.assign(new Error('该书源请求过多，请稍后重试'),{status:429});
      this.active.set(s.id,(this.active.get(s.id)||0)+1);
      try {
        const d=await s[action](value);
        if(action==='detail' && (!d.name || !d.chapters?.length)) throw new Error('源站详情或目录为空');
        if(action==='content' && (s.type==='novel' ? !d.text || d.text.length<80 : !d.images?.length)) throw new Error('源站没有可读内容');
        if(action==='play' && (!['anime','music'].includes(s.type) || !d.stream)) throw new Error('源站没有可播放地址');
        if(action==='play') network.allowedUrl(d.stream,s.audioHosts||s.mediaHosts);
        return d;
      } finally { this.active.set(s.id,this.active.get(s.id)-1); }
    };
    const cacheVersion=s.type==='music'?'v4':s.type==='anime'?'v4':'v3';
    return fresh?run():this.cached(`${s.id}:${cacheVersion}:${action}:${value}`,action==='search'?300000:action==='detail'?3600000:action==='play'?300000:s.type==='comic'?300000:30*DAY,run);
  }
  async audio(id,url,options) {
    const s=this.source(id);
    if(s.type!=='music') throw Object.assign(new Error('该来源不支持音频播放'),{status:400});
    const play=await this.action(id,'play',url);
    return openAudio(this.io,s,play,options);
  }
  async image(id,url,referer) {
    const s=this.source(id);
    const headers={Referer:referer?network.allowedUrl(referer,s.hosts).href:s.base+'/'};
    const r=await this.io.request(url,{hosts:s.mediaHosts,headers,maxBytes:12*1024*1024,route:s.imageRoute||s.route||'direct'});
    const b=r.bytes;
    const type=b[0]===255&&b[1]===216?'image/jpeg':b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':b.subarray(0,3).toString()==='GIF'?'image/gif':b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP'?'image/webp':null;
    if(!type) throw new Error('源站返回的不是有效图片');
    return {bytes:b,type};
  }
  async check(id) {
    const s=this.source(id),key='check:'+s.id;
    if(this.pending.has(key)) return this.pending.get(key);
    const promise=(async()=>{
      const t=Date.now(), out={checkedAt:new Date().toISOString(),ok:false,stage:'search',keyword:s.probe?.keyword||'剑',route:s.route||'direct'};
      try {
        const items=await this.action(id,'search',out.keyword,{fresh:true});
        out.books=items.length; if(!items.length) throw new Error('样本关键词无搜索结果');
        const item=s.probe?.book?items.find(x=>new RegExp(s.probe.book).test(x.name)):items[0];
        if(!item) throw new Error('未找到指定检测作品');
        out.sample=item.name; out.stage=s.type==='music'?'play':'detail';
        if(s.type==='music') {
          const p=await this.action(id,'play',item.id,{fresh:true});
          if(!p.stream) throw new Error('源站没有可播放地址');
          out.stream=p.stream; out.stage='audio';
          const audio=await openAudio(this.io,s,p,{range:'bytes=0-4095'});
          out.audioBytes=0;out.audioType=audio.headers['Content-Type'];out.preview=!!p.preview;
          for await(const chunk of audio.body) {out.audioBytes+=chunk.length;if(out.audioBytes>=4096) break;}
        } else {
        const d=await this.action(id,'detail',item.id,{fresh:true});
        out.chapters=d.chapters.length; out.stage='content';
        const chapter=s.probe?.chapter?d.chapters.find(x=>new RegExp(s.probe.chapter).test(x.title)):d.chapters[0];
        if(!chapter) throw new Error('未找到指定检测章节');
        const c=await this.action(id,s.type==='anime'?'play':'content',chapter.url,{fresh:true});
        out.sampleChapter=chapter.title;
        if(s.type==='novel') out.characters=c.text.length;
        else if(s.type==='anime') { out.stream=c.stream; out.stage='stream'; }
        else {
          out.images=c.images.length; out.stage='image';
          const samples=[...new Set([c.images[0],c.images[Math.floor(c.images.length/2)],c.images.at(-1)])];
          out.imageBytes=[];
          for(const url of samples) out.imageBytes.push((await this.image(id,url,c.referer)).bytes.length);
        }
        }
        out.ok=true; out.stage='complete';
      } catch(e) {out.error=e.message;}
      out.durationMs=Date.now()-t; this.health[s.id]=out;
      // Serialize health writes to avoid losing another source's concurrent result.
      this.healthWrite=(this.healthWrite||Promise.resolve()).catch(()=>{}).then(()=>fs.writeFile(path.join(this.dataDir,'health.json'),JSON.stringify(this.health,null,2)));
      await this.healthWrite;
      return out;
    })();
    this.pending.set(key,promise);
    try{return await promise;}finally{this.pending.delete(key);}
  }
}
module.exports={ReaderService};
