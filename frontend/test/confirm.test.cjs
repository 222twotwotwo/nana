const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');

/** 加载 confirm.ts，vue 以最小 ref 替身注入（仅读写 value，满足服务层语义） */
function loadConfirm(){
  const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/services/confirm.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const context={exports:{},require:id=>{if(id!=='vue')throw new Error('unexpected module '+id);return{ref:v=>({value:v})};}};
  vm.runInNewContext(code,context);
  return context.exports;
}

test('确认返回 true，取消返回 false，弹窗随之关闭',async()=>{
  const c=loadConfirm();
  const p=c.confirmDialog({title:'移出收藏',message:'将「缘之空」移出收藏？',danger:true,okText:'移出'});
  assert.equal(c.confirmPending().opts.title,'移出收藏');
  assert.equal(c.confirmPending().opts.message,'将「缘之空」移出收藏？');
  assert.equal(c.confirmPending().opts.danger,true);
  assert.equal(c.confirmPending().opts.okText,'移出');
  c.settleConfirm(true);
  assert.equal(await p,true);
  assert.equal(c.confirmPending(),null);
});

test('取消后再次 settle 无副作用',async()=>{
  const c=loadConfirm();
  const p=c.confirmDialog({message:'清空全部数据？'});
  c.settleConfirm(false);
  assert.equal(await p,false);
  assert.doesNotThrow(()=>c.settleConfirm(true));
  assert.equal(c.confirmPending(),null);
});

test('未决时弹出新确认，旧弹窗按取消处理且新弹窗可正常确认',async()=>{
  const c=loadConfirm();
  const p1=c.confirmDialog({message:'第一个'});
  const p2=c.confirmDialog({message:'第二个'});
  assert.equal(await p1,false);
  assert.equal(c.confirmPending().opts.message,'第二个');
  c.settleConfirm(true);
  assert.equal(await p2,true);
  assert.equal(c.confirmPending(),null);
});
