'use strict';
const {parseExpressionAt}=require('acorn');

// Nuxt's server-rendered payload is a literal object wrapped in a parameterized
// function. Interpret data nodes only; never execute the supplied function.
function readNuxt(script) {
  const offset=script.indexOf('window.__NUXT__=');
  if(offset<0 || script.length>2*1024*1024) throw new Error('未找到有效的页面数据');
  const root=parseExpressionAt(script,offset+'window.__NUXT__='.length,{ecmaVersion:2020});
  let nodes=0;
  function read(n,env=Object.create(null),depth=0) {
    if(++nodes>200000||depth>100) throw new Error('页面数据过于复杂');
    const next=x=>read(x,env,depth+1);
    if(n.type==='Literal'&&!n.regex) return n.value;
    if(n.type==='Identifier'&&Object.hasOwn(env,n.name)) return env[n.name];
    if(n.type==='ArrayExpression') return n.elements.map(x=>x?next(x):null);
    if(n.type==='ObjectExpression') {
      const obj=Object.create(null);
      for(const p of n.properties) {
        if(p.type!=='Property'||p.kind!=='init'||p.method||p.computed) throw new Error('页面包含非数据表达式');
        const key=p.key.name??p.key.value;
        if(['__proto__','constructor','prototype'].includes(key)) throw new Error('页面数据键无效');
        obj[key]=next(p.value);
      }
      return obj;
    }
    if(n.type==='UnaryExpression'&&['!','-','+','void'].includes(n.operator)) {
      const value=next(n.argument);return n.operator==='!'?!value:n.operator==='-'?-value:n.operator==='+'?+value:null;
    }
    if(n.type==='CallExpression'&&n.callee.type==='Identifier'&&n.callee.name==='Array'&&n.arguments.length===1&&n.arguments[0].type==='Literal') {
      const size=n.arguments[0].value;
      if(!Number.isInteger(size)||size<0||size>100000) throw new Error('页面数组长度无效');
      nodes+=size;
      if(nodes>200000) throw new Error('页面数据过于复杂');
      return Array(size).fill(null);
    }
    if(n.type==='CallExpression'&&n.callee.type==='FunctionExpression') {
      const f=n.callee;
      if(f.params.some(p=>p.type!=='Identifier')||f.body.body.at(-1)?.type!=='ReturnStatement') throw new Error('页面包含非数据函数');
      const values=n.arguments.map(next),scope=Object.create(null);
      f.params.forEach((p,i)=>{scope[p.name]=values[i];});
      for(const statement of f.body.body.slice(0,-1)) {
        const a=statement.expression;
        if(statement.type!=='ExpressionStatement'||a?.type!=='AssignmentExpression'||a.operator!=='='||a.left.type!=='MemberExpression'||a.left.object.type!=='Identifier') throw new Error('页面包含非数据赋值');
        const target=scope[a.left.object.name];
        const key=a.left.computed?read(a.left.property,scope,depth+1):a.left.property.name;
        if(!target||typeof target!=='object'||!['string','number'].includes(typeof key)||['__proto__','constructor','prototype'].includes(String(key))) throw new Error('页面数据键无效');
        if(Array.isArray(target)&&(!Number.isInteger(Number(key))||Number(key)<0||Number(key)>100000)) throw new Error('页面数组索引无效');
        target[key]=read(a.right,scope,depth+1);
      }
      return read(f.body.body.at(-1).argument,scope,depth+1);
    }
    throw new Error('页面包含不支持的数据表达式：'+n.type);
  }
  return read(root);
}
module.exports={readNuxt};
