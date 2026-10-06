'use strict';
const { fetch, Agent, ProxyAgent } = require('undici');
const dns = require('node:dns');
const net = require('node:net');
const iconv = require('iconv-lite');
const path = require('node:path');
try { process.loadEnvFile(path.join(__dirname,'../.env')); } catch(e) { if(e.code!=='ENOENT') throw e; }

function publicAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a,b] = ip.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 || (a===169&&b===254) ||
      (a===172&&b>=16&&b<=31) || (a===192&&b===168) || (a===100&&b>=64&&b<=127));
  }
  // Only global unicast IPv6. Mapped IPv4 and local/link-local ranges are excluded.
  return net.isIPv6(ip) && /^[23][0-9a-f]{3}:/i.test(ip);
}
const directDispatcher = new Agent({
  connect: { lookup(host, options, callback) {
    dns.lookup(host, { ...options, all:true }, (err, addresses) => {
      if (err) return callback(err);
      if (!addresses.length || addresses.some(a=>!publicAddress(a.address))) return callback(new Error('禁止访问内网地址'));
      callback(null, options.all ? addresses : addresses[0].address, addresses[0].family);
    });
  } }
});
const proxyDispatcher = process.env.MOYIN_PROXY ? new ProxyAgent(process.env.MOYIN_PROXY) : null;
function dispatcherFor(route) {
  if(route==='direct') return directDispatcher;
  if(route!=='proxy') throw new Error('无效网络路由');
  if(!proxyDispatcher) throw new Error('该来源需要代理，请在 .env 设置 MOYIN_PROXY 后重启服务');
  return proxyDispatcher;
}
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';
function allowedUrl(value, hosts) {
  let u;
  try { u = new URL(value); } catch { throw new Error('无效来源地址'); }
  if (!['http:','https:'].includes(u.protocol) || u.username || u.password ||
      (u.port && !['80','443'].includes(u.port)) ||
      !hosts.some(h=>h.startsWith('.') ? u.hostname.endsWith(h) : u.hostname===h)) {
    throw new Error('地址不属于该书源');
  }
  return u;
}
async function open(value, { hosts, headers={}, timeout=20000, route='direct', method='GET', body, signal:externalSignal }={}) {
  let u = allowedUrl(value, hosts);
  const dispatcher=dispatcherFor(route);
  const signal = externalSignal ? AbortSignal.any([externalSignal,AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
  for (let n=0; n<5; n++) {
    let res;
    try { res = await fetch(u, { dispatcher, signal, method, body, redirect:'manual', headers:{ 'User-Agent':UA, ...headers } }); }
    catch(e) { throw new Error(signal.aborted ? '源站请求超时，请稍后重试' : `源站连接失败：${e.cause?.code || e.message}`); }
    if ([301,302,303,307,308].includes(res.status)) {
      await res.body?.cancel();
      u = allowedUrl(new URL(res.headers.get('location'), u).href, hosts);
      if(res.status===303 || ([301,302].includes(res.status)&&method==='POST')) { method='GET'; body=undefined; }
      continue;
    }
    if (!res.ok) { await res.body?.cancel(); throw Object.assign(new Error(`源站 HTTP ${res.status}`),res.status===416?{status:416}:{}); }
    return {response:res,url:u.href};
  }
  throw new Error('源站重定向过多');
}
async function request(value, options={}) {
  const {response:res,url}=await open(value,options),maxBytes=options.maxBytes??5*1024*1024;
  const parts=[]; let size=0;
  for await (const part of res.body) {
    size+=part.length;
    if (size>maxBytes) throw new Error('源站响应超过大小限制');
    parts.push(part);
  }
  return {bytes:Buffer.concat(parts),type:res.headers.get('content-type')||'',url};
}
async function text(url, options) {
  const r = await request(url, options);
  const charset = r.type.match(/charset=([\w-]+)/i)?.[1] || 'utf8';
  return iconv.decode(r.bytes, iconv.encodingExists(charset) ? charset : 'utf8');
}
async function json(url, options) {
  const raw = await text(url, options);
  try { return JSON.parse(raw); } catch { throw new Error('源站未返回 JSON，可能需要验证或接口已变更'); }
}
module.exports = { open, request, text, json, allowedUrl, publicAddress, dispatcherFor };
