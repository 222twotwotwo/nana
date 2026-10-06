'use strict';
const {load}=require('cheerio');
const {clean,plain}=require('./source-utils');

function aidFromUrl(url) {
  const m=new URL(url).pathname.match(/\/novel\/(\d+)$/);
  if(!m) throw new Error('轻小说文库地址无效');
  return Number(m[1]);
}
function splitChapters(text) {
  const lines=String(text).replace(/\r/g,'').split('\n'), marks=[];
  const re=/^(?:第[0-9一二三四五六七八九十百千万]+卷[^\n]{0,60}|第[0-9一二三四五六七八九十百千万]+章[^\n]{0,60}|序章[^\n]{0,30}|终章[^\n]{0,30}|尾声[^\n]{0,30}|后记[^\n]{0,30})$/;
  for(let i=0;i<lines.length;i++){const title=clean(lines[i]);if(re.test(title)&&!/插图/.test(title))marks.push({i,title});}
  const out=[];
  for(let i=0;i<marks.length;i++){
    const end=i+1<marks.length?marks[i+1].i:lines.length;
    const body=lines.slice(marks[i].i+1,end).join('\n').replace(/^\s*$/gm,'').trim();
    if(body.length>=40) out.push({title:marks[i].title,text:body});
  }
  if(!out.length) throw new Error('轻小说正文未识别出章节');
  return out;
}

function additionalLightNovels(io) {
  const base='https://opds.wol.moe/zh_CN',opdsHost=['opds.wol.moe'],dlHosts=['dl1.wenku8.com','dl2.wenku8.com'];
  const textCache=new Map();
  const getText=async aid=>{
    if(textCache.has(aid)) return textCache.get(aid);
    let last;
    for(const host of dlHosts) try {
      const text=await io.text(`https://${host}/txtutf8/${Math.floor(aid/1000)}/${aid}.txt`,{hosts:[host],maxBytes:60*1024*1024});
      if(text.length>100){textCache.set(aid,text);if(textCache.size>8) textCache.delete(textCache.keys().next().value);return text;}
    } catch(e){last=e;}
    throw last||new Error('轻小说文库正文暂不可用');
  };
  const source={
    id:'wenku8-opds',name:'轻小说文库',type:'novel',base,hosts:opdsHost,
    mediaHosts:['opds.wol.moe'],repository:'https://github.com/WorldObservationLog/wenku8-opds-readme',
    note:'中文轻小说文库 · OPDS 搜索与公开 TXT 章节 · 作品版权和更新状态以源站为准',
    route:'direct',probe:{keyword:'刀剑神域',book:'刀剑神域',chapter:'第二卷'},
    async search(keyword){
      const xml=await io.text(`${base}/search.opds?q=${encodeURIComponent(keyword)}`,{hosts:opdsHost});
      const $=load(xml,{xmlMode:true});
      return $('entry').map((i,e)=>{const el=$(e),id=el.find('id').text().match(/(\d+)$/)?.[1],name=clean(el.find('title').text());if(!id||!name)return null;return {id:`${base}/novel/${id}`,name,author:clean(el.find('author name').text()),intro:plain(el.find('summary').text()),cover:el.find('link[rel="http://opds-spec.org/image"]').attr('href')||''};}).get();
    },
    async detail(url){
      const aid=aidFromUrl(url),raw=await getText(aid),title=clean(raw.match(/^<([^>]+)>$/m)?.[1]||`轻小说 ${aid}`),chapters=splitChapters(raw);
      return {name:title.replace(/^《|》$/g,''),author:'轻小说文库',intro:'来源：Wenku8 OPDS；正文由公开 TXT 节点提供。',cover:`https://opds.wol.moe/cover/${aid}.jpg`,chapters:chapters.map((c,i)=>({title:c.title,url:`${base}/novel/${aid}?chapter=${i}`}))};
    },
    async content(url){
      const u=new URL(url),aid=aidFromUrl(u),idx=Number(u.searchParams.get('chapter'));if(!Number.isInteger(idx)||idx<0) throw new Error('轻小说章节地址无效');
      const chapters=splitChapters(await getText(aid)),c=chapters[idx];if(!c) throw new Error('轻小说章节不存在');return {text:c.text};
    }
  };
  return [source];
}
module.exports={additionalLightNovels,splitChapters};
