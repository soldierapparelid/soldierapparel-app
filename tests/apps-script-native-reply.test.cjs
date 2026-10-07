'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {normalizeAppsScriptDataReply:normalize}=require('../apps-script-native-reply.js');
const {createLifecycleBrowserFixture:fixture}=require('./helpers/lifecycle-browser-fixture.cjs');
const foreign=value=>vm.runInNewContext('JSON.parse(seed)',{seed:JSON.stringify(value)}),normal=value=>JSON.parse(JSON.stringify(value));
test('data-only copy accepts foreign native Object/Array prototypes while creating local dense arrays',()=>{
  const original=foreign({ok:true,view:{values:[{name:'Example',totals:{ok:3,perbaikan:1}}],nothing:null}}),before=JSON.stringify(original),copy=normalize(original);
  assert.notEqual(Object.getPrototypeOf(original),Object.prototype);assert.deepEqual(normal(copy),JSON.parse(before));assert.equal(Object.getPrototypeOf(copy),null);assert.equal(Object.getPrototypeOf(copy.view.values),Array.prototype);assert.notEqual(copy.view,original.view);assert.equal(JSON.stringify(original),before);
});
test('foreign null-prototype data objects remain valid without inheriting receiver methods',()=>{
  const value=vm.runInNewContext("const o=Object.create(null);o.ok=true;o.rows=[Object.assign(Object.create(null),{count:1})];o;");assert.deepEqual(normal(normalize(value)),{ok:true,rows:[{count:1}]});
});

test('serialized gateway replies retain nested null fields through the actual controller pipeline',async()=>{
  const f=fixture();f.controls.reply=r=>JSON.stringify(r);const c=f.create();assert.equal((await c.connect()).ok,true);c.selectProduct('product-1');assert.equal((await c.submit('appendCount',{workerId:'worker-1',workDate:'2026-10-06',quantity:8})).ok,true);assert.equal(f.states.at(-1).view.products[0].counts[0].qcId,null);assert.equal(f.native.stats.writes,1);c.dispose();
  const g=fixture(),request={kind:'read',idToken:g.native.readInput().idToken};assert.deepEqual(JSON.parse(g.gateway.dispatchJson(request)),JSON.parse(JSON.stringify(g.gateway.dispatch(request))));assert.equal(JSON.parse(g.gateway.dispatchJson(request,request)).error,'invalid_request');
});

test('serialized input rejects duplicate escaped keys, pollution, deep and oversized JSON',()=>{
  for(const raw of ['{"ok":true,"ok":false}','{"ok":true,"\\u006fk":false}','{"__proto__":{}}','['.repeat(18)+'0'+']'.repeat(18),JSON.stringify({note:'x'.repeat(1048704)})])assert.throws(()=>normalize(raw));
  assert.deepEqual(normal(normalize('{"ok":true,"view":{"counts":[{"qcId":null}]}}')),{ok:true,view:{counts:[{qcId:null}]}});
});
test('own and inherited toJSON are never invoked while copying received data',()=>{
  const value=vm.runInNewContext("let calls=0;Object.prototype.toJSON=function(){calls++;throw Error('private');};const value={ok:true,rows:[{count:1}]};({value,calls:()=>calls});");assert.deepEqual(normal(normalize(value.value)),{ok:true,rows:[{count:1}]});assert.equal(value.calls(),0);
  let calls=0;assert.throws(()=>normalize({ok:true,toJSON(){calls++;throw Error('private');}}));assert.equal(calls,0);
});
test('own accessors and descriptor-hidden data are rejected without invoking getters',()=>{
  let calls=0;const value={ok:true};Object.defineProperty(value,'view',{enumerable:true,get(){calls++;return {};}});assert.throws(()=>normalize(value));assert.equal(calls,0);
  const hidden={ok:true};Object.defineProperty(hidden,'private',{value:'private'});assert.throws(()=>normalize(hidden));
});
test('classes, dates, maps, boxed primitives and array subclasses are rejected across realms',()=>{
  for(const expression of ["new (class Example{constructor(){this.ok=true;}})()","new Date()","new Map()","new String('private')","new (class Example extends Array{})(1)"]){assert.throws(()=>normalize(vm.runInNewContext(expression)));}
});
test('pollution keys, sparse arrays, array extras, symbols and cycles fail closed',()=>{
  for(const value of [foreign(JSON.parse('{"__proto__":{},"ok":true}')),foreign({constructor:'private'}),[,,],Object.assign([1],{private:true}),{[Symbol('private')]:1}])assert.throws(()=>normalize(value));
  const cycle={};cycle.self=cycle;assert.throws(()=>normalize(cycle));
});
test('non-JSON, unsafe numbers and negative zero are rejected without coercion',()=>{
  for(const value of [undefined,NaN,Infinity,-0,Number.MAX_SAFE_INTEGER+1,1n,()=>{},Symbol('private')])assert.throws(()=>normalize({value}));assert.deepEqual(normal(normalize({value:0.25})),{value:0.25});
});
test('encoded bytes, depth and node ceilings bound escaped strings and large dense input',()=>{
  assert.throws(()=>normalize({note:'\n'.repeat(600000)}));assert.throws(()=>normalize({note:'🙂'.repeat(270000)}));let value=null;for(let i=0;i<18;i++)value={value};assert.throws(()=>normalize(value));assert.throws(()=>normalize(Array(100001).fill(null)));
  const dense=normalize(Array(12000).fill(1));assert.equal(dense.length,12000);
});
test('actual browser/controller pipeline accepts foreign native replies and preserves scoped quantities',async()=>{
  const f=fixture();f.controls.reply=r=>foreign(r);const c=f.create();assert.equal((await c.connect()).ok,true);assert.equal(c.selectProduct('product-1').ok,true);assert.equal((await c.submit('appendCount',{workerId:'worker-1',workDate:'2026-10-06',quantity:8})).ok,true);assert.equal(f.states.at(-1).view.products[0].counts.length,1);assert.equal(f.native.stats.writes,1);c.dispose();
});

test('native reply field ordering can change between scoped read and post-write refresh',async()=>{
  const reverse=v=>Array.isArray(v)?v.map(reverse):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reverse(x)])):v;
  const f=fixture();let reads=0;f.controls.reply=(r,q)=>foreign(q.kind==='read'&&++reads>1?reverse(r):r);const c=f.create();assert.equal((await c.connect()).ok,true);c.selectProduct('product-1');assert.equal((await c.submit('appendCount',{workerId:'worker-1',workDate:'2026-10-06',quantity:8})).ok,true);assert.equal(f.states.at(-1).phase,'ready');assert.equal(f.states.at(-1).view.products[0].counts.length,1);assert.equal(f.native.stats.writes,1);c.dispose();
});
test('normalization does not admit extra QC prices, foreign identity or raw-root fields into the view',async()=>{
  for(const mutate of [r=>{r.view.products[0].tarif=1;},r=>{r.view.binding.uid='foreign';},r=>{r.root={private:'secret'};}]){const f=fixture();f.controls.reply=(r,q)=>{if(r.ok&&q.kind==='read')mutate(r);return foreign(r);};const c=f.create();assert.equal((await c.connect()).ok,false);assert.equal(f.states.some(s=>s.phase==='ready'),false);assert.equal(f.states.at(-1).view,null);assert.equal(f.native.stats.writes,0);c.dispose();}
});
test('malformed native write reply retains uncertainty and resolves the original receipt once',async()=>{
  const f=fixture(),c=f.create();await c.connect();c.selectProduct('product-1');f.controls.reply=(r,q)=>q.kind==='execute'?new Date():foreign(r);
  assert.equal((await c.submit('appendCount',{workerId:'worker-1',workDate:'2026-10-06',quantity:8})).error,'result_unknown');const id=f.states.at(-1).pending[0].requestId;f.controls.reply=r=>foreign(r);assert.equal((await c.retry(id)).ok,true);assert.equal(f.native.stats.writes,1);c.dispose();
});
