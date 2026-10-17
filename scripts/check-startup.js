'use strict';
/** 启动自检：确认重构版页面能正常加载并渲染 */
const ab = require('./lib/agent-browser');

const URL = process.argv[2] || 'http://127.0.0.1:8761/';

(async () => {
  await ab.open(URL, { width: 1258, height: 622, settle: 4000 });

  const info = ab.evalJson(`JSON.stringify({
    title: document.title,
    mounted: !!document.querySelector('#app[data-v-app]'),
    chrome: !!document.querySelector('#chrome'),
    nav: [...document.querySelectorAll('#mainSeg button')].map(b => b.textContent.trim()),
    page: [...document.querySelectorAll('.page')].filter(p => !p.classList.contains('hidden')).map(p => p.id),
    sources: document.querySelector('#storeStatus')?.textContent || '',
    errors: window.__dshErrors || []
  })`);

  console.log('标题      :', info.title);
  console.log('Vue 已挂载:', info.mounted ? '是' : '否');
  console.log('顶部导航  :', info.chrome ? '已渲染' : '缺失', '|', (info.nav || []).join(' / '));
  console.log('当前页面  :', (info.page || []).join(', '));
  console.log('来源状态  :', info.sources || '(空)');

  // 控制台报错
  const errs = ab.evalJs(`(window.__errs||[]).length`);
  console.log('页面报错  :', errs === '0' ? '无' : errs);

  ab.shot('docs/refactor-screens/verify/startup-home.png');
  console.log('截图      : docs/refactor-screens/verify/startup-home.png');
  ab.close();
})().catch(e => { console.error('自检失败:', e.message); process.exit(1); });
