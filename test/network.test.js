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

test('自动路由直连成功不使用代理，连接失败和 503 才回退且保留 POST',async t=>{
  const direct=new MockAgent(),proxy=new MockAgent();direct.disableNetConnect();proxy.disableNetConnect();
  const realDirect=dispatcherFor('direct'),realProxy=dispatcherFor('proxy');
  const originals=[realDirect.dispatch,realProxy.dispatch];
  realDirect.dispatch=direct.dispatch.bind(direct);realProxy.dispatch=proxy.dispatch.bind(proxy);
  t.after(async()=>{[realDirect.dispatch,realProxy.dispatch]=originals;await direct.close();await proxy.close();});
  const options={hosts:['example.com'],route:'auto'};
  direct.get('https://example.com').intercept({path:'/ok'}).reply(200,'direct');
  assert.equal((await request('https://example.com/ok',options)).bytes.toString(),'direct');
  direct.get('https://example.com').intercept({path:'/reset'}).replyWithError(Object.assign(new Error('reset'),{code:'ECONNRESET'}));
  proxy.get('https://example.com').intercept({path:'/reset'}).reply(200,'proxy');
  assert.equal((await request('https://example.com/reset',options)).bytes.toString(),'proxy');
  const bodies=[];
  const postReply=(statusCode,data)=>options=>{
    bodies.push((async()=>{let text='';for await(const chunk of options.body) text+=Buffer.from(chunk).toString();return text;})());
    return {statusCode,data};
  };
  direct.get('https://example.com').intercept({path:'/post',method:'POST'}).reply(postReply(503,'unavailable'));
  proxy.get('https://example.com').intercept({path:'/post',method:'POST'}).reply(postReply(200,'post fallback'));
  assert.equal((await request('https://example.com/post',{...options,method:'POST',body:'query=test'})).bytes.toString(),'post fallback');
  assert.deepEqual(await Promise.all(bodies),['query=test','query=test']);
  direct.get('https://example.com').intercept({path:'/both'}).reply(503,'');
  proxy.get('https://example.com').intercept({path:'/both'}).reply(502,'');
  await assert.rejects(request('https://example.com/both',options),/直连失败.*503.*代理重试失败.*502/);
  direct.assertNoPendingInterceptors();proxy.assertNoPendingInterceptors();
});

test('自动路由不通过代理重试地址校验失败、内网、登录限制或已取消的请求',async t=>{
  const direct=new MockAgent(),proxy=new MockAgent();direct.disableNetConnect();proxy.disableNetConnect();
  const realDirect=dispatcherFor('direct'),realProxy=dispatcherFor('proxy'),originals=[realDirect.dispatch,realProxy.dispatch];
  let proxyCalls=0;
  realDirect.dispatch=direct.dispatch.bind(direct);realProxy.dispatch=(...args)=>{proxyCalls++;return proxy.dispatch(...args);};
  t.after(async()=>{[realDirect.dispatch,realProxy.dispatch]=originals;await direct.close();await proxy.close();});
  const options={hosts:['example.com'],route:'auto'};
  direct.get('https://example.com').intercept({path:'/escape'}).reply(302,'',{headers:{location:'http://127.0.0.1/private'}});
  await assert.rejects(request('https://example.com/escape',options),/不属于/);
  direct.get('https://example.com').intercept({path:'/private'}).replyWithError(Object.assign(new Error('private'),{code:'ERR_PRIVATE_ADDRESS'}));
  await assert.rejects(request('https://example.com/private',options),/ERR_PRIVATE_ADDRESS/);
  direct.get('https://example.com').intercept({path:'/login'}).reply(401,'');
  await assert.rejects(request('https://example.com/login',options),/401/);
  const abort=new AbortController();abort.abort();
  await assert.rejects(request('https://example.com/cancel',{...options,signal:abort.signal}));
  assert.equal(proxyCalls,0);direct.assertNoPendingInterceptors();
});
