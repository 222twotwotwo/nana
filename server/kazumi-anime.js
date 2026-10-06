'use strict';
const {JSDOM}=require('jsdom');
const network=require('./network');
const {clean,absolute}=require('./source-utils');
const {decodeUrl,playerData,hhjxBootstrap}=require('./additional-anime');
const rules=require('./kazumi-rules.json');

const SKIP=new Set(['7sefun','DM84']);
const XPATH_SNAPSHOT=7;

function replace(value, vars) {
  return String(value).replace(/@([a-z]+)/gi,(_,key)=>encodeURIComponent(String(vars[key]??'')));
}
function pathValues(value, expression) {
  if(!expression) return [];
  const path=String(expression).replace(/^\$\.?/,'').split('.').filter(Boolean);
  let values=[value];
  for(const part of path) {
    const wildcard=part.endsWith('[*]'), key=wildcard?part.slice(0,-3):part;
    const next=[];
    for(const item of values) {
      if(item==null) continue;
      if(key && typeof item==='object' && Object.hasOwn(item,key)) next.push(item[key]);
      else if(!key) next.push(item);
    }
    values=wildcard?next.flatMap(x=>Array.isArray(x)?x:[]):next;
  }
  return values;
}
function template(value, vars) {
  if(typeof value==='string') return replace(value,vars);
  if(Array.isArray(value)) return value.map(x=>template(x,vars));
  if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,template(v,vars)]));
  return value;
}
function hostOf(url) { try{return new URL(url).hostname;}catch{return null;} }
function requestHosts(config) {
  const urls=[config.baseURL,config.searchApiConfig?.request?.url,config.chapterApiConfig?.request?.url,config.chapterApiConfig?.episodePage?.url];
  return [...new Set([...urls.map(hostOf),...(config.hostAliases||[])].filter(Boolean))];
}
function parseDocument(html) { return new JSDOM(String(html)).window.document; }
function nodes(doc, context, expression) {
  let x=String(expression||'').trim();
  if(x==='//') return [doc];
  if(context.nodeType!==9 && x.startsWith('//')) x='.'+x;
  if(context.nodeType!==9 && x.startsWith('/self::')) x=x.slice(1);
  try {
    const result=doc.evaluate(x,context,null,XPATH_SNAPSHOT,null), out=[];
    for(let i=0;i<result.snapshotLength;i++) out.push(result.snapshotItem(i));
    return out;
  } catch { return []; }
}
function textValue(node) { return clean(node?.nodeType===3||node?.nodeType===4?node.nodeValue:node?.textContent||''); }
function firstNode(doc, context, expression) { return nodes(doc,context,expression)[0]; }
function xpathSearch(config, html) {
  const doc=parseDocument(html), out=[];
  for(const item of nodes(doc,doc,config.searchList)) {
    const name=textValue(firstNode(doc,item,config.searchName));
    let link=firstNode(doc,item,config.searchResult);
    if(link?.nodeType!==1) link=link?.parentElement;
    const href=link?.getAttribute?.('href');
    if(name&&href) out.push({id:absolute(href,config.baseURL),name});
  }
  return [...new Map(out.map(x=>[x.id,x])).values()].slice(0,50);
}
function xpathChapters(config, html) {
  const doc=parseDocument(html), chapters=[];
  const roads=config.chapterRoads==='//'?[doc]:nodes(doc,doc,config.chapterRoads);
  roads.forEach((road,roadIndex)=>nodes(doc,road,config.chapterResult).forEach((episode,index)=>{
    let link=episode?.nodeType===1?episode:episode?.parentElement;
    const href=link?.getAttribute?.('href'); if(!href) return;
    const title=textValue(episode)||`第${index+1}集`;
    chapters.push({title,url:absolute(href,config.baseURL),road:roadIndex});
  }));
  return [...new Map(chapters.map(x=>[x.url,x])).values()];
}
async function apiRequest(io, request, vars, hosts) {
  const url=replace(request.url,vars), options={hosts,route:'direct',method:request.method||'GET',headers:request.headers||{}};
  if(options.method==='GET') {
    const u=new URL(url); for(const [k,v] of Object.entries(template(request.query||{},vars))) u.searchParams.set(k,String(v));
    return io.json(u.href,options);
  }
  options.body=JSON.stringify(template(request.body||{},vars));
  options.headers={'Content-Type':'application/json',...options.headers};
  return io.json(url,options);
}
function apiSearch(config, data) {
  return pathValues(data,config.searchApiConfig.listPath).map(item=>({
    id:String(pathValues(item,config.searchApiConfig.sourcePath)[0]??''),
    name:clean(String(pathValues(item,config.searchApiConfig.namePath)[0]??''))
  })).filter(x=>x.id&&x.name).map(x=>({...x,id:absolute(x.id,config.baseURL)}));
}
function apiChapters(config, data, source) {
  const cc=config.chapterApiConfig, roads=pathValues(data,cc.roadsPath), out=[];
  for(const road of roads) for(const ep of pathValues(road,cc.episodesPath)) {
    const raw=pathValues(ep,cc.episodeUrlPath)[0]; if(raw==null) continue;
    const vars={source,episodeUrl:raw};
    const page=cc.episodePage?.url?replace(cc.episodePage.url,vars):String(raw);
    out.push({title:clean(String(pathValues(ep,cc.episodeNamePath)[0]??''))||`第${out.length+1}集`,url:absolute(page,config.baseURL)});
  }
  return [...new Map(out.map(x=>[x.url,x])).values()];
}
async function resolvePlay(io, url, hosts, mediaHosts, depth=0) {
  if(depth>3) throw new Error('番剧播放地址仍是中转页，请打开原站播放');
  network.allowedUrl(url,hosts);
  const html=await io.text(url,{hosts,route:'direct'});
  const direct=html.match(/https?:[^\s"'<>\\]+\.(?:mp4|m3u8)(?:\?[^\s"'<>\\]*)?/i)?.[0];
  if(direct){network.allowedUrl(direct,mediaHosts);return {stream:direct,referer:url};}
  try { const data=playerData(html), decoded=decodeUrl(data.url); network.allowedUrl(decoded,[...hosts,...mediaHosts]); if(/\.(?:mp4|m3u8)(?:$|[?#])/i.test(decoded)){network.allowedUrl(decoded,mediaHosts);return {stream:decoded,referer:url};} return resolvePlay(io,decoded,[...hosts,...mediaHosts],mediaHosts,depth+1); } catch {}
  const iframe=parseDocument(html).querySelector('iframe[src]')?.getAttribute('src');
  if(iframe) { const frame=absolute(iframe,url); try { const bootstrap=hhjxBootstrap(await io.text(frame,{hosts:[hostOf(frame)],route:'direct'})); const api=new URL('/api/parse',frame).href; const raw=await io.text(api,{hosts:[hostOf(frame)],route:'direct',method:'POST',headers:{Origin:`${new URL(frame).origin}`,Referer:frame,'Content-Type':'application/json'},body:JSON.stringify({url:bootstrap.url,t:bootstrap.t,key:bootstrap.key,client_fallback:false})}); const result=JSON.parse(raw); if(result.code===200&&result.url){network.allowedUrl(result.url,mediaHosts);return {stream:result.url,referer:url};} } catch {} return resolvePlay(io,frame,[...hosts,hostOf(frame)],mediaHosts,depth+1); }
  throw new Error('番剧播放页未提供公开地址');
}
function kazumiAnimeSources(io) {
  return rules.filter(config=>!SKIP.has(config.name)).map(config=>{
    const base=new URL(config.baseURL).origin+'/', hosts=requestHosts(config), mediaHosts=[...new Set([...hosts,'.gtimg.com','.qq.com','.qpic.cn','.adkwai.com','.bilivideo.com','.m3u8.live'])];
    const page=async url=>{network.allowedUrl(url,hosts);return io.text(url,{hosts,route:'direct'});};
    return {id:`kazumi-${config.name.toLowerCase()}`,name:config.name,type:'anime',base,hosts,mediaHosts,route:'direct',repository:'https://github.com/Predidit/KazumiRules',note:`KazumiRules ${config.name} · 自动适配公开搜索、目录与播放地址`,
      async search(keyword){if(config.searchMode==='api') return apiSearch(config,await apiRequest(io,config.searchApiConfig.request,{keyword},hosts));return xpathSearch(config,await page(replace(config.searchURL,{keyword})));},
      async detail(url){if(config.chapterMode==='api'){const source=url.split('/').pop(),data=await apiRequest(io,config.chapterApiConfig.request,{source},hosts),name=clean(String(pathValues(data,'$.data.title')[0]??pathValues(data,'$.title')[0]??config.name));return {name,chapters:apiChapters(config,data,source)};} const html=await page(url), chapters=xpathChapters(config,html); if(!chapters.length) throw new Error('番剧详情或目录为空'); return {name:clean(parseDocument(html).querySelector('title')?.textContent?.replace(/.*?[《]/,'').replace(/[》].*$/,'')||config.name),chapters};},
      async play(url){return resolvePlay(io,url,hosts,mediaHosts);}
    };
  });
}
module.exports={kazumiAnimeSources,pathValues,xpathSearch,xpathChapters};
