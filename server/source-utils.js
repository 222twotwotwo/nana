'use strict';
const {load}=require('cheerio');
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const absolute=(u,base)=>u?new URL(u,base).href:'';
const unique=rows=>[...new Map(rows.map(x=>[x.url||x.id,x])).values()];
function plain(html) {
  const $=load(String(html||'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/(?:p|div)>/gi,'\n'));
  $('script,style').remove();
  return $.root().text().split('\n').map(s=>s.trim()).filter(Boolean).join('\n');
}
module.exports={clean,absolute,unique,plain};
