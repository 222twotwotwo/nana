'use strict';
/**
 * 移动端竖屏阅读页截图：修前 / 修后对照。
 *
 * 用长正文，竖屏 390x844，截「第一屏」——修前文字右侧被切，
 * 修后完整落在列内。
 *
 *   node scripts/shot-mobile-reader.js [outDir] [baseUrl]
 */
const fs = require('node:fs');
const path = require('node:path');
const ab = require('./lib/agent-browser');

const OUT = path.resolve(process.argv[2] || 'docs/motion-verify/mobile-reader');
const BASE = process.argv[3] || 'http://127.0.0.1:8761/';
fs.mkdirSync(OUT, { recursive: true });

const LONG = Array.from({ length: 60 }, (_, i) =>
  `第${i + 1}段：晨雾未散，青雀港像浸在一碗温开的牛奶里。沈舟把最后一桶淡水搬上逐光号，听见妹妹阿螺试笛的声音，断断续续，像溪水绕过石头。`).join('\n');

const INSTALL = `(async () => {
  localStorage.clear();
  localStorage.setItem('nr-settings', JSON.stringify({apiBase:'',apiKey:'',model:'',fadeSec:4,volume:.75,theme:'light',fontSize:20,viewMode:'grid'}));
  localStorage.setItem('nr-progress','{}'); localStorage.setItem('nr-demo-seed','done');
  const db = await new Promise((res,rej)=>{const q=indexedDB.open('novel-reader',1);
    q.onupgradeneeded=()=>{const d=q.result;
      if(!d.objectStoreNames.contains('books'))d.createObjectStore('books',{keyPath:'id'});
      if(!d.objectStoreNames.contains('music'))d.createObjectStore('music',{keyPath:'id'});
      if(!d.objectStoreNames.contains('analyses'))d.createObjectStore('analyses',{keyPath:'key'});};
    q.onsuccess=()=>res(q.result); q.onerror=()=>rej(q.error);});
  for (const n of ['books','music','analyses']) await new Promise((res,rej)=>{
    const tx=db.transaction(n,'readwrite'); tx.objectStore(n).clear();
    tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);});
  const text=${JSON.stringify(LONG)};
  await new Promise((res,rej)=>{const tx=db.transaction('books','readwrite');
    tx.objectStore('books').put({id:'mob-novel',title:'移动端竖屏排版',author:'测试',type:'novel',
      sourceName:'本地收藏',addedAt:1700000000000,charCount:text.length,
      chapters:[{title:'第一章 雾港启航',text}]});
    tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);});
  db.close(); return 'ok'; })()`;

(async () => {
  for (const [label, w, h] of [['se', 375, 667], ['iphone12', 390, 844], ['promax', 430, 932]]) {
    await ab.open(BASE, { width: w, height: h, settle: 3500 });
    await ab.waitFor(`document.querySelector('#chrome')`, { timeout: 20000 });
    ab.evalJs(INSTALL);
    ab.batch(`open ${BASE}`, `set viewport ${w} ${h}`);
    await ab.sleep(3500);
    await ab.waitFor(`document.querySelector('#chrome')`, { timeout: 20000 });
    await ab.sleep(1200);
    ab.evalJs(`(document.querySelector('#mainSeg button[data-nav=library]').click(), 1)`); await ab.sleep(1200);
    ab.evalJs(`(document.querySelector('#libraryTypeSeg button[data-ctype=novel]').click(), 1)`); await ab.sleep(1400);
    ab.evalJs(`(document.querySelector('#bookGrid .catalog-card .catalog-open')?.click(), 1)`); await ab.sleep(1600);
    ab.evalJs(`(document.querySelector('#smRead')?.click(), 1)`); await ab.sleep(2600);
    // 收起浮动菜单，画面干净
    ab.evalJs(`(document.querySelector('#readerScroll')?.click(), 1)`); await ab.sleep(600);
    ab.shot(path.join(OUT, `reader-${label}-${w}x${h}.png`));
    console.log('  ->', `reader-${label}-${w}x${h}.png`);
  }
  console.log('\n完成 ->', OUT);
  process.exit(0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
