'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');

// Inventory and homepage reachability only. This does not claim that chapters work.
(async()=>{
  const report={checkedAt:new Date().toISOString(),scope:'仓库版本、规则格式和源站首页连通性；首页成功不代表可读，完整链路见 data/health.json',repositories:[]};
  for(const [repo,file] of [['XIU2/Yuedu','shuyuan'],['chashaomanhua/manhuadaquan','All.json']]) {
    const get=async p=>{const r=await fetch('https://api.github.com/repos/'+repo+p,{signal:AbortSignal.timeout(20000)});if(!r.ok) throw new Error('GitHub HTTP '+r.status);return r.json();};
    const meta=await get(''),contents=await get('/contents/'+file);
    const raw=Buffer.from(contents.content,'base64').toString('utf8');
    const definitions=JSON.parse(raw.replace(/,\s*([\]}])/g,'$1'));
    const row={repo,url:meta.html_url,pushedAt:meta.pushed_at,fileSha:contents.sha,license:meta.license?.spdx_id||null,count:definitions.length,sources:[]};
    const queue=definitions.slice();
    await Promise.all(Array.from({length:5},async()=>{
      while(queue.length) {
        const d=queue.shift(),r={name:d.bookSourceName,url:d.bookSourceUrl,containsJs:/@js:|<js>/.test(JSON.stringify(d)),readability:'未作完整链路验证'};
        try {
          const response=await fetch(d.bookSourceUrl,{signal:AbortSignal.timeout(12000)});
          r.httpStatus=response.status;r.finalUrl=response.url;await response.body?.cancel();
        } catch(e) {r.error=e.cause?.code||e.message;}
        row.sources.push(r);
      }
    }));
    report.repositories.push(row);console.log(repo,row.count+' sources inspected');
  }
  await fs.mkdir(path.join(__dirname,'../docs'),{recursive:true});
  await fs.writeFile(path.join(__dirname,'../docs/upstream-audit.json'),JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
