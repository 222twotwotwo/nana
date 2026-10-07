'use strict';
const {createHash}=require('node:crypto');
const net=require('node:net');
const {JSDOM}=require('jsdom');
const network=require('./network');
const {createKazumiSource}=require('./kazumi-anime');

const MAX_BYTES=1024*1024, MAX_SOURCES=100;
const invalid=message=>Object.assign(new Error(message),{status:400});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function string(value,field,max=4096) {
  if(typeof value!=='string'||!value.trim()||value.length>max) throw invalid(`${field} 缺失、格式错误或过长`);
  return value.trim();
}
function webUrl(value,field) {
  let url;
  try { url=new URL(string(value,field,2048)); } catch { throw invalid(`${field} 必须为完整的 HTTP(S) 公网地址`); }
  const host=url.hostname.replace(/^\[|\]$/g,'');
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port&&!['80','443'].includes(url.port)||
    host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||!host.includes('.')&&!net.isIP(host)||net.isIP(host)&&!network.publicAddress(host)) {
    throw invalid(`${field} 必须为不含账号密码的 HTTP(S) 公网地址（80 / 443 端口）`);
  }
  return url;
}
function jsonPath(value,field) {
  const expression=string(value,field);
  if(!/^\$(?:\[\*\])?(?:\.[\w-]+(?:\[\*\])?)*$/.test(expression)) throw invalid(`${field} 仅支持 $.字段 与 [*] 数组路径`);
  return expression;
}
function requestConfig(value,field) {
  if(!object(value)) throw invalid(`${field} 缺失`);
  webUrl(value.url,`${field}.url`);
  const method=value.method||'GET';
  if(!['GET','POST'].includes(method)||value.bodyType&&value.bodyType!=='json') throw invalid(`${field} 仅支持 GET 或 JSON POST`);
  const out={url:value.url,method};
  for(const key of ['headers','query','body']) {
    if(value[key]===undefined) continue;
    if(!object(value[key])) throw invalid(`${field}.${key} 必须为对象`);
    out[key]=value[key];
  }
  for(const [key,v] of Object.entries(out.headers||{})) {
    if(!/^[\w-]+$/.test(key)||/^(host|content-length|connection|transfer-encoding|proxy-authorization|proxy-connection|upgrade)$/i.test(key)||typeof v!=='string'||/[\r\n]/.test(v)) throw invalid(`${field}.headers 包含无效请求头`);
  }
  return out;
}
function validateRule(raw) {
  if(!object(raw)) throw invalid('每个源必须为 JSON 对象');
  if(raw.bookSourceUrl||raw.type&&raw.type!=='anime') throw invalid('仅支持 Kazumi 番剧规则 JSON');
  if(raw.antiCrawlerConfig?.enabled) throw invalid('暂不支持需要自动验证码或浏览器脚本的规则');
  const name=string(raw.name,'name',80),baseURL=webUrl(raw.baseURL,'baseURL').href;
  const rule={name,baseURL,type:'anime'};
  for(const key of ['userAgent','referer']) if(raw[key]) {
    rule[key]=string(raw[key],key,1024);
    if(/[\r\n]/.test(rule[key])) throw invalid(`${key} 包含无效换行`);
    if(key==='referer') webUrl(rule[key],key);
  }
  if(raw.hostAliases!==undefined) {
    if(!Array.isArray(raw.hostAliases)||raw.hostAliases.length>20) throw invalid('hostAliases 必须是最多 20 个域名的数组');
    rule.hostAliases=raw.hostAliases.map(host=>{
      const url=webUrl('https://'+host,'hostAliases');
      if(url.hostname!==host) throw invalid('hostAliases 只能包含域名');
      return host;
    });
  }
  for(const kind of ['search','chapter']) {
    const mode=raw[kind+'Mode']||'xpath';
    if(!['xpath','api'].includes(mode)) throw invalid(`${kind}Mode 仅支持 xpath 或 api`);
    rule[kind+'Mode']=mode;
    if(mode==='api') {
      const field=kind+'ApiConfig', config=raw[field];
      if(!object(config)) throw invalid(`${field} 缺失`);
      const out={request:requestConfig(config.request,field+'.request')};
      for(const key of kind==='search'?['listPath','namePath','sourcePath']:['roadsPath','episodesPath','episodeNamePath','episodeUrlPath']) out[key]=jsonPath(config[key],field+'.'+key);
      if(kind==='chapter') {
        if(config.format&&config.format!=='nested') throw invalid('chapterApiConfig 仅支持 nested 格式');
        if(config.episodePage?.url) {
          webUrl(config.episodePage.url,field+'.episodePage.url');
          if(Object.keys(config.episodePage.query||{}).length) throw invalid('请把 episodePage.query 参数写入 episodePage.url');
          out.episodePage={url:config.episodePage.url};
        }
      }
      rule[field]=out;
    } else {
      if(kind==='search') {
        if(raw.usePost) throw invalid('XPath 搜索暂不支持 usePost，请使用 API JSON POST 规则');
        webUrl(raw.searchURL,'searchURL');rule.searchURL=raw.searchURL;
        if(!raw.searchURL.includes('@keyword')) throw invalid('searchURL 必须包含 @keyword');
      }
      const window=new JSDOM('<html><body></body></html>').window;
      try {
        for(const key of kind==='search'?['searchList','searchName','searchResult']:['chapterRoads','chapterResult']) {
          const expression=string(raw[key],key);
          try { if(expression!=='//') window.document.evaluate(expression,window.document,null,7,null); }
          catch { throw invalid(`${key} 不是有效的 XPath`); }
          rule[key]=expression;
        }
      } finally { window.close(); }
    }
  }
  return rule;
}
function parseCustomRules(input) {
  let data=input;
  if(typeof input==='string') {
    if(Buffer.byteLength(input)>MAX_BYTES) throw invalid('规则文件不能超过 1 MB');
    try { data=JSON.parse(input.replace(/^\uFEFF/,'')); } catch { throw invalid('无法解析 JSON，请检查文件内容'); }
  }
  if(Buffer.byteLength(JSON.stringify(data)??'')>MAX_BYTES) throw invalid('规则文件不能超过 1 MB');
  const rows=Array.isArray(data)?data:[data];
  if(!rows.length||rows.length>MAX_SOURCES) throw invalid('每次请导入 1–100 个源');
  return [...new Map(rows.map((raw,index)=>{
    try { const rule=validateRule(raw);return [customSourceId(rule),rule]; }
    catch(e) { throw invalid(`第 ${index+1} 个源：${e.message}`); }
  })).values()];
}
function customSourceId(rule) {
  return 'custom-'+createHash('sha256').update(rule.name.toLowerCase()+'\n'+new URL(rule.baseURL).origin).digest('hex').slice(0,20);
}
function customAnimeSource(io,rule) {
  const wrapped={};
  for(const method of ['text','json']) wrapped[method]=(url,options={})=>io[method](url,{...options,publicOnly:true,headers:{
    ...(rule.userAgent?{'User-Agent':rule.userAgent}:{}),...(rule.referer?{Referer:rule.referer}:{}),...options.headers
  }});
  return {...createKazumiSource(wrapped,rule),id:customSourceId(rule),custom:true,
    revision:createHash('sha256').update(JSON.stringify(rule)).digest('hex'),repository:undefined,note:'自定义 Kazumi 源 · 直连失败后使用代理'};
}
module.exports={MAX_BYTES,MAX_SOURCES,parseCustomRules,customSourceId,customAnimeSource};
