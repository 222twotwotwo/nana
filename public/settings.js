async function renderSettings(){
  const s = getSettings();
  $('settingsBox').innerHTML = `
    <h1 class="big-title">设置</h1>
    <p class="muted" style="margin:-14px 0 18px">填写任意 OpenAI 兼容接口（DeepSeek / Kimi / 通义 / 本地 Ollama…），用于预分析小说情绪</p>
    <div class="card">
      <label class="fld">API 地址（Base URL，自动拼接 /chat/completions）</label>
      <input type="text" id="setBase" placeholder="例如 https://api.deepseek.com/v1 或 http://localhost:11434/v1" value="${esc(s.apiBase)}">
      <label class="fld">API Key（可留空，本地服务无需）</label>
      <input type="password" id="setKey" placeholder="sk-..." value="${esc(s.apiKey)}">
      <label class="fld">模型名</label>
      <input type="text" id="setModel" placeholder="例如 deepseek-chat / gpt-4o-mini / qwen2.5:7b" value="${esc(s.model)}">
      <div class="row" style="margin-top:14px">
        <button class="btn primary" id="btnTest">测试连接</button>
        <span class="muted" id="testInfo"></span>
      </div>
    </div>
    <div class="card">
      <b style="letter-spacing:2px">内容来源 · 连接状态</b>
      <p class="muted" style="margin:8px 0">检测包含搜索、目录、样本正文和漫画首尾图片下载。结果只代表检测时的样本。</p>
      <div id="sourceHealth">正在读取来源状态…</div>
      <p class="muted" style="margin-top:12px">第三方来源仅供个人使用；登录、付费或下架内容可能无法打开。四类收藏和阅读、播放进度保存在当前浏览器，请通过固定地址访问。</p>
    </div>
    <div class="card">
      <label class="fld">渐入渐出时长：<b id="fadeVal">${s.fadeSec}</b> 秒</label>
      <input type="range" id="setFade" min="1" max="10" step="0.5" value="${s.fadeSec}" style="width:100%">
      <label class="fld">默认音量：<b id="volVal">${Math.round(s.volume*100)}%</b></label>
      <input type="range" id="setVol" min="0" max="100" value="${Math.round(s.volume*100)}" style="width:100%">
    </div>
    <div class="card">
      <b>备份与迁移</b>
      <p class="muted" style="margin:8px 0">导出小说、漫画、音乐、番剧收藏，以及分析、进度与设置（不含 API Key）。可在另一浏览器或访问地址恢复。</p>
      <div class="row"><button class="btn" id="exportBackup">导出备份</button><button class="btn" id="importBackup">恢复备份</button><input id="backupFile" type="file" accept=".json" class="hidden"></div>
    </div>
    <div class="card">
      <div class="row">
        <button class="btn danger" id="btnWipe">清空所有数据</button>
        <span class="muted">删除全部书籍、音乐、分析与设置，不可恢复</span>
      </div>
    </div>`;
  $('setBase').addEventListener('change', e=>saveSettings({apiBase:e.target.value.trim()}));
  $('setKey').addEventListener('change', e=>saveSettings({apiKey:e.target.value.trim()}));
  $('setModel').addEventListener('change', e=>saveSettings({model:e.target.value.trim()}));
  $('setFade').addEventListener('input', e=>{
    saveSettings({fadeSec:+e.target.value});
    $('fadeVal').textContent = e.target.value;
  });
  $('setVol').addEventListener('input', e=>{
    saveSettings({volume:e.target.value/100});
    $('volVal').textContent = e.target.value+'%';
  });
  renderSourceHealth();
  $('exportBackup').onclick=async()=>{try{const n=await MoyinBackup.export();toast(`已导出 ${n} 本书和音乐、阅读进度`);}catch(e){toast(e.message);}};
  $('importBackup').onclick=()=>$('backupFile').click();
  $('backupFile').onchange=async e=>{
    try {
      const data=await MoyinBackup.read(e.target.files[0]);
      if(!confirm(`恢复 ${data.stores.books.length} 本书、${data.stores.music.length} 首音乐？同编号记录将被替换，其余记录保留。`)) return;
      await MoyinBackup.restore(data);applyTheme();toast('恢复完成');renderSettings();
    }catch(err){toast('恢复失败：'+err.message);}
  };

  $('btnTest').addEventListener('click', async ()=>{
    const info = $('testInfo');
    info.textContent = '连接中…';
    try{
      await callLLM([{role:'user', content:'只回复两个字：好的'}], 8);
      info.textContent = '✓ 连接成功';
    }catch(e){ info.textContent = '✗ ' + e.message; }
  });
  $('btnWipe').addEventListener('click', async ()=>{
    if(!confirm('将删除所有书籍、音乐、情境分析与设置，且不可恢复。确定继续？')) return;
    if(player.ctx) player.fadeStop();
    (await idb()).close();
    _dbP = null;
    const deletion = indexedDB.deleteDatabase('novel-reader');
    deletion.onblocked = ()=>toast('请关闭其他墨音标签页后重试');
    deletion.onsuccess = ()=>location.reload();
    localStorage.removeItem('nr-settings');
    localStorage.removeItem('nr-mapping');
    localStorage.removeItem('nr-progress');

  });
}


(async function init(){
  applyTheme();
  await ensureSampleBook();
  showPage('home');
  await initServer();
  if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
})();
