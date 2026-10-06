'use strict';
const {ReaderService}=require('../server/service');
(async()=>{
  const service=new ReaderService();await service.init();let failed=0;
  const ids=process.argv.slice(2);
  for(const id of ids) service.source(id);
  for(const s of service.sources.filter(s=>!ids.length||ids.includes(s.id)||ids.includes(s.name)||ids.includes(s.id.replace(/^kazumi-/,'')))) {
    const r=await service.check(s.id);
    const detail=s.type==='music'?`音频读取 ${r.audioBytes||0} bytes${r.preview?'（试听片段）':''}`:`${r.chapters||0} 章，${r.characters?`${r.characters} 字`:`${r.images||0} 图 / 下载 ${r.imageBytes?.join(',')||0} bytes`}`;
    console.log(`${r.ok?'PASS':'FAIL'} ${s.name}：${r.sample||''}，${detail} ${r.error||''}`);
    if(!r.ok) failed++;
  }
  console.log('检测结果已保存到 data/health.json；结果仅代表记录中的样本与检测时间。');
  process.exitCode=failed?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
