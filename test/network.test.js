'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {MockAgent}=require('undici');
process.env.MOYIN_PROXY='http://127.0.0.1:7897';
const {request,dispatcherFor}=require('../server/network');

test('配置代理后仍按来源分流；POST 重定向转 GET，每次跳转均校验域名',async t=>{
  const direct=new MockAgent(),proxy=new MockAgent();direct.disableNetConnect();proxy.disableNetConnect();
  const realDirect=dispatcherFor('direct'),realProxy=dispatcherFor('proxy');
  const dispatchDirect=realDirect.dispatch,dispatchProxy=realProxy.dispatch;
  realDirect.dispatch=direct.dispatch.bind(direct);realProxy.dispatch=proxy.dispatch.bind(proxy);
  t.after(async()=>{realDirect.dispatch=dispatchDirect;realProxy.dispatch=dispatchProxy;await direct.close();await proxy.close();});
  direct.get('https://example.com').intercept({path:'/search',method:'POST'}).reply(302,'',{headers:{location:'/result'}});
  direct.get('https://example.com').intercept({path:'/result',method:'GET'}).reply(200,'direct result');
  proxy.get('https://example.com').intercept({path:'/search'}).reply(200,'proxy result');
  const d=await request('https://example.com/search',{hosts:['example.com'],method:'POST',body:'s=test'});
  assert.equal(d.bytes.toString(),'direct result');
  const p=await request('https://example.com/search',{hosts:['example.com'],route:'proxy'});assert.equal(p.bytes.toString(),'proxy result');
  direct.get('https://example.com').intercept({path:'/escape'}).reply(302,'',{headers:{location:'http://127.0.0.1/private'}});
  await assert.rejects(request('https://example.com/escape',{hosts:['example.com']}),/不属于/);
  direct.assertNoPendingInterceptors();proxy.assertNoPendingInterceptors();
});
