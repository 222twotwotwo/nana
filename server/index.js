'use strict';
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pipeline}=require('node:stream/promises');
const {ReaderService}=require('./service');
const {VideoRelay}=require('./video');
const PUBLIC=path.join(__dirname,'../public');
const DIST=path.join(__dirname,'../dist');
function json(res,status,data) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(data));
}
async function body(req,limit=8192) {
  const parts=[];let size=0;
  for await(const c of req) {
    size+=c.length;
    if(size>limit) throw Object.assign(new Error('请求体过大'),{status:413});
    parts.push(c);
  }
  try{return JSON.parse(Buffer.concat(parts).toString());}catch{throw Object.assign(new Error('请求必须为 JSON'),{status:400});}
}
function createServer(service) {
  const video=new VideoRelay(service.io);
  return http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    try {
      const url=new URL(req.url,'http://localhost');
      if(!['GET','POST','HEAD'].includes(req.method)) return json(res,405,{error:'不支持该方法'});
      if(req.method==='POST') {
        if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}` && req.headers.origin!==`https://${req.headers.host}`) return json(res,403,{error:'不允许跨站请求'});
        if(!req.headers['content-type']?.startsWith('application/json')) return json(res,415,{error:'需要 application/json'});
      }
      if(url.pathname==='/api/health' && req.method==='GET') return json(res,200,{ok:true,version:'3.0.0'});
      if(url.pathname==='/api/sources' && req.method==='GET') return json(res,200,{sources:service.list()});
      if(url.pathname==='/api/sources/import' && req.method==='POST') {
        const b=await body(req,2*1024*1024+1024);
        const result=await service.importSources(b?.rules);
        return json(res,200,{...result,sources:service.list()});
      }
      if(url.pathname==='/api/sources/remove' && req.method==='POST') {
        const b=await body(req),result=await service.removeSource(b?.source);
        return json(res,200,{...result,sources:service.list()});
      }
      if(url.pathname==='/api/action' && req.method==='POST') {
        const b=await body(req);
        const data=await service.action(b.source,b.action,b.value);
        if(b.action==='play'&&service.source(b.source).type==='anime') return json(res,200,{data:{...data,playbackUrl:video.url(data)}});
        return json(res,200,{data});
      }
      if(url.pathname==='/api/check' && req.method==='POST') {
        const b=await body(req), s=service.source(b.source), last=service.health[s.id];
        if(last && (!s.custom||last.revision===s.revision) && Date.now()-Date.parse(last.checkedAt)<60000) return json(res,200,{data:last});
        return json(res,200,{data:await service.check(s.id)});
      }
      if(url.pathname==='/api/image' && req.method==='GET') {
        const r=await service.image(url.searchParams.get('source'),url.searchParams.get('url'),url.searchParams.get('referer'));
        res.writeHead(200,{'Content-Type':r.type,'Cache-Control':'private, max-age=86400'});return res.end(r.bytes);
      }
      if(url.pathname==='/api/audio' && req.method==='GET') {
        const abort=new AbortController();res.on('close',()=>abort.abort());
        const audio=await service.audio(url.searchParams.get('source'),url.searchParams.get('url'),{range:req.headers.range,signal:abort.signal});
        res.writeHead(audio.status,audio.headers);
        await pipeline(audio.body,res);return;
      }
      if(url.pathname==='/api/video' && req.method==='GET') {
        const abort=new AbortController();res.on('close',()=>abort.abort());
        const stream=await video.open(url.searchParams.get('ticket'),{range:req.headers.range,signal:abort.signal});
        res.writeHead(stream.status,stream.headers);
        await pipeline(stream.body,res);return;
      }
      if(url.pathname.startsWith('/api/')) return json(res,404,{error:'接口不存在'});
      if(req.method==='POST') return json(res,405,{error:'静态文件仅支持 GET'});
      // Serve static assets: Vue build output (dist/) first, legacy public/ files as fallback.
      // Never expose source rules, settings or data.
      let rel=decodeURIComponent(url.pathname);
      if(rel==='/') rel='/index.html';
      const candidates=[path.join(DIST,rel),path.join(PUBLIC,rel)];
      const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.map':'application/json; charset=utf-8','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg'};
      let bytes=null,file=null;
      for(const candidate of candidates) {
        if(!candidate.startsWith(DIST+path.sep)&&!candidate.startsWith(PUBLIC+path.sep)) continue;
        try { bytes=await fs.readFile(candidate); file=candidate; break; } catch {}
      }
      if(!bytes) return json(res,404,{error:'文件不存在'});
      res.writeHead(200,{'Content-Type':types[path.extname(file).toLowerCase()]||'application/octet-stream','Cache-Control':'no-cache'});
      res.end(req.method==='HEAD'?undefined:bytes);
    } catch(e) { if(!res.headersSent) json(res,e.status||502,{error:e.message}); else res.end(); }
  });
}
async function start() {
  const service=new ReaderService(); await service.init();
  const server=createServer(service),port=Number(process.env.PORT||8761),host=process.env.HOST||'127.0.0.1';
  server.listen(port,host,()=>console.log(`墨音已启动：http://${host}:${port}`));
  server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`端口 ${port} 已占用，可设置 PORT 使用其他端口`:e.message);process.exitCode=1;});
  const timer=setInterval(()=>service.pruneCache().catch(console.error),3600000);timer.unref();
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>process.exit(0)));
}
if(require.main===module) start().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={createServer,start};
