'use strict';
const {randomBytes,createHmac,timingSafeEqual}=require('node:crypto');
const {lookup}=require('node:dns/promises');
const net=require('node:net');
const network=require('./network');

// Only server-resolved streams and their playlist children receive signed URLs.
class VideoRelay {
  constructor(io=network,resolve=lookup) { this.io=io;this.resolve=resolve;this.secret=randomBytes(32); }
  sign(data) {
    const payload=Buffer.from(JSON.stringify(data)).toString('base64url');
    return '/api/video?ticket='+payload+'.'+createHmac('sha256',this.secret).update(payload).digest('base64url');
  }
  url(play) { return this.sign({url:play.stream,referer:play.referer||'',expires:Date.now()+8*3600000}); }
  verify(ticket) {
    if(typeof ticket!=='string'||ticket.length>16384) throw Object.assign(new Error('播放凭据无效'),{status:403});
    const [payload,signature,...extra]=ticket.split('.');
    const expected=createHmac('sha256',this.secret).update(payload).digest();
    const actual=Buffer.from(signature||'','base64url');
    if(extra.length||actual.length!==expected.length||!timingSafeEqual(actual,expected)) throw Object.assign(new Error('播放凭据无效'),{status:403});
    const data=JSON.parse(Buffer.from(payload,'base64url').toString());
    if(data.expires<Date.now()) throw Object.assign(new Error('播放凭据已过期，请重试选集'),{status:403});
    return data;
  }
  async open(ticket,{range,signal}={}) {
    const data=this.verify(ticket),url=network.mediaAllowed(data.url,[]);
    const host=url.hostname.replace(/^\[|\]$/g,'');
    // Validate before a proxy can resolve an upstream-supplied playlist hostname.
    const addresses=net.isIP(host)?[{address:host}]:await this.resolve(host,{all:true});
    if(!addresses.length||addresses.some(x=>!network.publicAddress(x.address))) throw new Error('禁止访问内网视频地址');
    if(range&&!/^bytes=(?:\d{1,16}-\d{0,16}|-\d{1,16})$/.test(range)) throw Object.assign(new Error('仅支持单段视频范围请求'),{status:416});
    const {response:r,url:resolved}=await this.io.open(url.href,{hosts:[url.hostname],route:'auto',timeout:20000,streaming:true,signal,headers:{Referer:data.referer,...(range?{Range:range}:{})}});
    const type=r.headers.get('content-type')||'application/octet-stream';
    if(/\.m3u8(?:$|[?#])/i.test(resolved)||/mpegurl/i.test(type)) {
      const parts=[];let size=0;
      for await(const chunk of r.body) {size+=chunk.length;if(size>2*1024*1024) throw new Error('播放列表过大');parts.push(chunk);}
      const text=Buffer.concat(parts).toString('utf8');
      if(!text.trimStart().startsWith('#EXTM3U')) throw new Error('源站未返回有效播放列表');
      const child=value=>this.sign({...data,url:network.mediaAllowed(new URL(value,resolved).href,[]).href});
      const playlist=text.split(/\r?\n/).map(line=>{
        if(!line.trim()) return line;
        return line.startsWith('#')?line.replace(/URI="([^"]+)"/g,(_,uri)=>`URI="${child(uri)}"`):child(line.trim());
      }).join('\n');
      return {status:200,headers:{'Content-Type':'application/vnd.apple.mpegurl','Cache-Control':'private, no-store'},body:[Buffer.from(playlist)]};
    }
    if(/(?:text\/html|javascript|application\/json)/i.test(type)) {await r.body.cancel();throw new Error('源站返回的不是视频数据');}
    const headers={'Content-Type':type,'Cache-Control':'private, no-store'};
    for(const key of ['content-length','content-range','accept-ranges']) if(r.headers.has(key)) headers[key]=r.headers.get(key);
    return {status:r.status,headers,body:r.body};
  }
}
module.exports={VideoRelay};
