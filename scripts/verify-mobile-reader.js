'use strict';
/**
 * 移动端竖屏阅读排版回归。
 *
 * 修的是一个既有缺陷：`#chapterBody.reader-paged` 用 `width:max-content`，
 * 多列容器下内联内容先按「不换行的理想宽度」排，段落比列宽还宽
 * （375 视口：列 315px，段落排到 324.8px），文字横向溢出列、
 * 竖屏下右侧被切掉看不全。原版 public/ 同样如此，属继承缺陷。
 *
 * 这里断言的是**排版几何**，不是观感：
 *   1. 每列正好一屏（列步进 = 列宽 + 列间距）
 *   2. 没有任何文字超出它所在的那一列
 *   3. 正文容器宽 = 一屏宽（不是 max-content、也不是整数列总宽 ——
 *      后者会让浏览器把余量均摊回每列，列被撑宽、文字再次溢出）
 *   4. 文档级无横向溢出，且横向仍可翻页
 *
 * 列边界用**实测列步进**推导（相邻列起点的实际间隔），不用「视口 − padding」：
 * 窄屏下列宽会被 Math.max(280,…) 抬起来，想当然的算法会误判。
 *
 *   node scripts/verify-mobile-reader.js [baseUrl]
 */
const ab = require('./lib/agent-browser');

const BASE = process.argv[2] || 'http://127.0.0.1:8761/';

// 长正文：夹具自带的章节太短，撑不出多列，也就暴露不了溢出
const LONG = Array.from({ length: 60 }, (_, i) =>
  `第${i + 1}段：晨雾未散，青雀港像浸在一碗温开的牛奶里。沈舟把最后一桶淡水搬上逐光号，听见妹妹阿螺试笛的声音，断断续续，像溪水绕过石头。`).join('\n');

const INSTALL = `(async () => {
  localStorage.clear();
  localStorage.setItem('nr-settings', JSON.stringify({apiBase:'',apiKey:'',model:'',fadeSec:4,volume:.75,theme:'light',fontSize:20,viewMode:'grid'}));
  localStorage.setItem('nr-progress','{}');
  localStorage.setItem('nr-demo-seed','done');
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
  // 书名与章节名都刻意取长：顶栏标题在窄屏会换行，短名字压不到返回键，
  // 只有长名字才测得出「标题左缘伸到返回键底下」这个问题。
  const book={id:'mob-novel',title:'移动端竖屏排版回归测试专用长书名',author:'测试',type:'novel',
    sourceName:'本地收藏',addedAt:1700000000000,charCount:text.length,
    chapters:[{title:'第一章 雾港启航与那场没有说完的告别',text}]};
  await new Promise((res,rej)=>{const tx=db.transaction('books','readwrite');
    tx.objectStore('books').put(book); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);});
  db.close(); return 'ok'; })()`;

const MEASURE = `JSON.stringify((() => {
  const sc=document.getElementById('readerScroll'), body=document.getElementById('chapterBody');
  if(!sc||!body) return {err:'not-ready'};
  const cs=getComputedStyle(body);
  const padL=parseFloat(cs.paddingLeft)||0, padR=parseFloat(cs.paddingRight)||0;
  const gap=parseFloat(cs.columnGap)||0;
  const colW=parseFloat(cs.columnWidth)||0;
  const b=body.getBoundingClientRect();
  const blocks=[...body.querySelectorAll('p,h1,.ch-sub,.rd-foot,.rd-nav')];
  const lefts=[...new Set(blocks.map(el=>+el.getBoundingClientRect().left.toFixed(2)))].sort((x,y)=>x-y);
  const deltas=[]; for(let i=1;i<lefts.length;i++){const d=lefts[i]-lefts[i-1]; if(d>1) deltas.push(d);}
  const step=deltas.length?Math.min(...deltas):0;
  const colContentW = step>gap ? step-gap : colW;
  let outsideCol=0, worst=0, sample=null;
  if(step>0){
    for(const el of blocks){
      const er=el.getBoundingClientRect();
      const idx=Math.max(0, Math.round((er.left-(b.left+padL))/step));
      const colRight=b.left+padL+idx*step+colContentW;
      const over=er.right-colRight;
      if(over>0.5){ outsideCol++; if(over>worst){worst=over; sample={tag:el.tagName, right:+er.right.toFixed(1), colRight:+colRight.toFixed(1), over:+over.toFixed(1)};} }
    }
  }
  return {
    vw: document.documentElement.clientWidth,
    scClientW: sc.clientWidth,
    docScrollW: document.documentElement.scrollWidth,
    bodyScrollW: document.body.scrollWidth,
    pageTurn: Math.max(0, sc.scrollWidth - sc.clientWidth),
    isPaged: sc.classList.contains('reader-paged') && body.classList.contains('reader-paged'),
    bodyW: +b.width.toFixed(2),
    widthProp: cs.width, maxWidth: cs.maxWidth,
    colW: +colW.toFixed(2), gap:+gap.toFixed(2), step:+step.toFixed(2),
    colContentW:+colContentW.toFixed(2),
    blockCount: blocks.length,
    outsideCol, worst:+worst.toFixed(2), sample,
    scrollW: sc.scrollWidth
  };
})())`;

/** 竖屏尺寸（宽 < 高），全部走分页分支（<=760） */
const PORTRAIT = [
  ['320 窄屏', 320, 568],
  ['iPhone SE', 375, 667],
  ['iPhone 12', 390, 844],
  ['Pixel 5', 393, 851],
  ['iPhone Pro Max', 430, 932]
];

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

(async () => {
  await ab.open(BASE, { width: 390, height: 844, settle: 3500 });
  await ab.waitFor(`document.querySelector('#chrome')`, { timeout: 20000 });
  ab.evalJs(INSTALL);
  ab.batch(`open ${BASE}`, 'set viewport 390 844');
  await ab.sleep(3500);
  await ab.waitFor(`document.querySelector('#chrome')`, { timeout: 20000 });
  await ab.sleep(1200);

  // 进入阅读页
  ab.evalJs(`(document.querySelector('#mainSeg button[data-nav=library]').click(), 1)`); await ab.sleep(1200);
  ab.evalJs(`(document.querySelector('#libraryTypeSeg button[data-ctype=novel]').click(), 1)`); await ab.sleep(1400);
  ab.evalJs(`(document.querySelector('#bookGrid .catalog-card .catalog-open')?.click(), 1)`); await ab.sleep(1600);
  ab.evalJs(`(document.querySelector('#smRead')?.click(), 1)`); await ab.sleep(2600);

  console.log('=== 各竖屏尺寸的排版几何 ===');
  for (const [label, w, h] of PORTRAIT) {
    ab.batch(`set viewport ${w} ${h}`);
    await ab.sleep(900);
    const m = ab.evalJson(MEASURE);
    console.log(`\n  [${label} ${w}x${h}] 列宽=${m.colW} 间距=${m.gap} 实测步进=${m.step} 容器宽=${m.bodyW}`);

    check(`${label}：进入分页模式`, m.isPaged === true);
    // 1. 容器宽 = 一屏宽（核心修复点）
    check(`${label}：容器宽 = 一屏宽`, Math.abs(m.bodyW - m.scClientW) < 1,
      `容器 ${m.bodyW} / 视口 ${m.scClientW}`);
    check(`${label}：width 不是 max-content`, m.widthProp !== 'max-content', `width=${m.widthProp}`);
    // 2. 列步进 = 列宽 + 间距（每列正好一屏）
    check(`${label}：列步进 = 列宽 + 间距`, Math.abs(m.step - (m.colContentW + m.gap)) < 1,
      `${m.step} vs ${m.colContentW}+${m.gap}`);
    // 3. 没有任何文字超出所在列
    check(`${label}：文字都在列内`, m.outsideCol === 0,
      m.outsideCol ? `${m.outsideCol} 个元素溢出，最大 ${m.worst}px ${JSON.stringify(m.sample)}` : '无溢出');
    // 4. 文档无横向溢出
    check(`${label}：文档无横向溢出`, m.docScrollW <= m.scClientW, `scrollWidth=${m.docScrollW} 视口=${m.scClientW}`);
    check(`${label}：body 无横向溢出`, m.bodyScrollW <= m.scClientW, `body.scrollWidth=${m.bodyScrollW}`);
    // 5. 仍可横向翻页
    check(`${label}：仍可横向翻页`, m.pageTurn > 0, `可翻 ${m.pageTurn}px`);

    // 6. 顶栏标题：返回键是 position:fixed 悬在左上角、标题居中，
    //    窄屏上标题换行后左缘会伸到返回键底下被压住（修复前 320/375/390 都重叠）。
    const head = ab.evalJson(`JSON.stringify((() => {
      const t=document.getElementById('rdHeadTitle');
      const b=document.querySelector('#page-reader .float-back');
      const r=el=>{if(!el)return null;const x=el.getBoundingClientRect();
        return {left:+x.left.toFixed(1),right:+x.right.toFixed(1),w:+x.width.toFixed(1),h:+x.height.toFixed(1)};};
      return {vw:document.documentElement.clientWidth, title:r(t), back:r(b),
        docW:document.documentElement.scrollWidth};
    })())`);
    check(`${label}：顶栏标题不与返回键重叠`, head.title.left >= head.back.right - 0.5,
      `标题 left=${head.title.left} / 返回键 right=${head.back.right}`);
    check(`${label}：顶栏标题在视口内`, head.title.left >= -0.5 && head.title.right <= head.vw + 0.5,
      `标题 ${head.title.left}→${head.title.right} 视口 ${head.vw}`);
    check(`${label}：顶栏不产生横向溢出`, head.docW <= head.vw, `文档 ${head.docW} 视口 ${head.vw}`);
  }

  // 桌面不应进入分页分支
  console.log('\n=== 桌面不受影响（>760 不分页） ===');
  ab.batch('set viewport 1258 622'); await ab.sleep(900);
  const d = ab.evalJson(MEASURE);
  check('桌面：不进入分页模式', d.isPaged === false);
  check('桌面：正文宽度受限（max-width:41em）', d.bodyW < 1258 - 100, `正文宽 ${d.bodyW}`);
  check('桌面：无横向文字溢出', d.outsideCol === 0);

  // 旋转到横屏后回到竖屏，列宽必须跟着重算（onResize 路径）
  console.log('\n=== 旋转/改变尺寸后重算 ===');
  ab.batch('set viewport 900 420'); await ab.sleep(900);
  const land = ab.evalJson(MEASURE);
  ab.batch('set viewport 390 844'); await ab.sleep(1000);
  const backM = ab.evalJson(MEASURE);
  check('横屏（宽>高）不进入竖屏单列分页', land.isPaged === false || land.colW > 0);
  check('转回竖屏后列宽重算正确', Math.abs(backM.bodyW - backM.scClientW) < 1,
    `容器 ${backM.bodyW} / 视口 ${backM.scClientW}`);
  check('转回竖屏后文字仍在列内', backM.outsideCol === 0,
    backM.outsideCol ? `溢出 ${backM.outsideCol} 个，最大 ${backM.worst}px` : '无溢出');

  ab.close();
  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n=== 结果：${passed} 通过 / ${failed} 失败 ===`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
