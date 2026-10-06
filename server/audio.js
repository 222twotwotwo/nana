'use strict';
const MAX_AUDIO=100*1024*1024;
function audioType(b) {
  if(b.subarray(0,3).toString()==='ID3'||(b[0]===255&&(b[1]&0xe0)===0xe0)) return 'audio/mpeg';
  if(b.subarray(0,4).toString()==='OggS') return 'audio/ogg';
  if(b.subarray(0,4).toString()==='fLaC') return 'audio/flac';
  if(b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WAVE') return 'audio/wav';
  if(b.subarray(4,8).toString()==='ftyp') return 'audio/mp4';
  return null;
}
async function openAudio(io,source,play,{range,signal}={}) {
  if(range && !/^bytes=(?:\d{1,16}-\d{0,16}|-\d{1,16})$/.test(range)) throw Object.assign(new Error('仅支持单段音频范围请求'),{status:416});
  const {response:r}=await io.open(play.stream,{hosts:source.audioHosts||source.mediaHosts,route:source.route||'direct',headers:{Referer:play.referer||source.base+'/',...(range?{Range:range}:{})},timeout:120000,signal});
  const reader=r.body.getReader();
  try {
    const type=r.headers.get('content-type')||'',contentRange=r.headers.get('content-range');
    if(!/^(?:audio\/|application\/(?:ogg|octet-stream))/i.test(type)) throw new Error('源站返回的不是音频');
    const total=Number(contentRange?.split('/')[1]||r.headers.get('content-length')||0);
    if(total>MAX_AUDIO) throw new Error('音频超过 100 MB 限制');
    let first=Buffer.alloc(0);
    while(first.length<12) {
      const chunk=await reader.read();if(chunk.done) break;
      first=Buffer.concat([first,Buffer.from(chunk.value)]);
    }
    if(!first.length) throw new Error('源站返回空音频');
    const fromStart=r.status!==206||/^bytes 0-/i.test(contentRange||'');
    const detected=fromStart?audioType(first):null;
    if(fromStart&&!detected) throw new Error('源站返回的不是有效音频文件');
    const headers={'Content-Type':detected||type,'Cache-Control':'private, no-store'};
    for(const key of ['content-length','content-range','accept-ranges']) if(r.headers.has(key)) headers[key]=r.headers.get(key);
    async function* body() {
      let size=first.length;
      try {
        yield first;
        while(true) {
          const chunk=await reader.read();if(chunk.done) break;
          size+=chunk.value.length;if(size>MAX_AUDIO) throw new Error('音频超过 100 MB 限制');
          yield chunk.value;
        }
      } finally {await reader.cancel().catch(()=>{});}
    }
    return {status:r.status,headers,body:body()};
  } catch(e) {await reader.cancel().catch(()=>{});throw e;}
}
module.exports={openAudio,audioType};
