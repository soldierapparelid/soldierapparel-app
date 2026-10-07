'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Controller=require('../legacy-lifecycle-controller.js');
const {createLifecycleBrowserFixture:fixture}=require('./helpers/lifecycle-browser-fixture.cjs');
const copy=v=>JSON.parse(JSON.stringify(v)),date='2026-10-06',totals=(ok,perbaikan=0,reject=0,offline=0)=>({ok,perbaikan,reject,offline});
const state=f=>f.states.at(-1),product=f=>state(f).view.products[0];
async function connected(f){const c=f.create();assert.equal((await c.connect()).ok,true);assert.equal(c.selectProduct('product-1').ok,true);return c;}
function openJahit(f){const root=f.native.root,j=root.soldier.produksi.produksi[0].jahit[0];j.jumlah=j.lolos=6;j.total=15;f.native.root=root;}
test('SOURCE OFF observes neither dependency getters nor arbitrary form inputs',async()=>{
  let hits=0;const options={enabled:false};for(const k of ['createBridge','onState','newId','isCurrent'])Object.defineProperty(options,k,{get(){hits++;throw Error();}});
  const c=Controller.createLegacyLifecycleController(options),raw=new Proxy({},{get(){hits++;throw Error();},ownKeys(){hits++;throw Error();}});
  for(const r of [await c.connect(),c.selectProduct(raw),await c.refresh(),await c.refreshFinance(),await c.submit(raw,raw),await c.retry(raw)])assert.equal(r.error,'service_disabled');assert.equal(hits,0);
});
test('actual pipeline QC connection excludes finance and denies finance before a fresh token or RPC',async()=>{
  const f=fixture(),c=await connected(f),before={tokens:f.tokens,calls:f.calls.length};assert.equal(state(f).binding.division,'qc');assert.equal(state(f).binding.workerId,null);assert.equal(state(f).finance,null);
  assert.equal((await c.refreshFinance()).error,'access_denied');assert.deepEqual({tokens:f.tokens,calls:f.calls.length},before);
  for(const secret of ['tarif','payroll','PIN','email','googleSubject','privateCash','SYNTHETIC_CASH_PRIVATE'])assert.equal(JSON.stringify(state(f)).includes(secret),false);c.dispose();
});
test('all eight QC forms run through the actual codec, durable bridge, coordinator and native-host fixtures',async()=>{
  const f=fixture(),c=await connected(f),original=copy(f.native.root.soldier.produksi.produksi[0].jahit);
  assert.equal((await c.submit('appendCount',{workerId:'worker-1',workDate:date,quantity:7})).ok,true);let id=product(f).counts[0].countId;
  assert.equal((await c.submit('editCount',{operationId:id,workDate:date,quantity:8})).ok,true);
  assert.equal((await c.submit('deleteCount',{operationId:id})).ok,true);assert.equal(product(f).counts.length,0);
  assert.equal((await c.submit('appendCount',{workerId:'worker-1',workDate:date,quantity:3})).ok,true);
  assert.equal((await c.submit('appendCount',{workerId:'worker-1',workDate:date,quantity:5})).ok,true);
  assert.equal((await c.submit('appendCount',{workerId:'worker-2',workDate:date,quantity:2})).ok,true);
  const own=product(f).counts.filter(h=>h.workerId==='worker-1'),other=product(f).counts.find(h=>h.workerId==='worker-2');assert.equal(product(f).readyForQC,true);
  assert.equal((await c.submit('inspectCount',{countId:other.countId,workDate:date,totals:totals(2),note:''})).ok,true);
  assert.equal((await c.submit('inspectCounts',{countIds:own.map(h=>h.countId),workDate:date,totals:totals(5,2,1),note:'Synthetic group'})).ok,true);
  const otherQC=product(f).inspections.find(q=>q.workerId==='worker-2');assert.equal((await c.submit('editQC',{operationId:otherQC.operationId,workDate:date,totals:totals(1,1),note:'Synthetic correction'})).ok,true);
  const group=product(f).inspections.filter(q=>q.workerId==='worker-1');assert.equal((await c.submit('editQCGroup',{operationId:group[0].batchId,qcIds:group.map(q=>q.operationId),totals:totals(6,1,1),note:'Synthetic group correction'})).ok,true);
  assert.equal((await c.submit('repairQC',{operationId:otherQC.operationId,workDate:date,quantity:1})).ok,true);
  const p=f.native.root.soldier.produksi.produksi[0];assert.deepEqual(p.jahit,original);assert.equal(p.gudang.filter(g=>g.payrollStage==='repair').reduce((n,g)=>n+g.jumlah,0),1);
  assert.deepEqual(state(f).pending,[]);assert.equal(state(f).finance,null);assert.equal(f.calls.filter(q=>q.kind==='execute').length,11);c.dispose();
});
test('three own Jahit forms retain historic rows and archives, then expose only own finance',async()=>{
  const f=fixture('jahit');openJahit(f);const before=copy(f.native.root.soldier.produksi.produksi[0]),c=await connected(f);
  assert.equal((await c.submit('appendJahit',{assignmentId:'assignment-1',workDate:null,good:2,reject:0})).ok,true);const id=product(f).reports.find(r=>r.operationId!=='sewn-1').operationId;
  assert.equal((await c.submit('editJahit',{operationId:id,workDate:date,good:1,reject:0})).ok,true);
  assert.equal((await c.submit('deleteJahit',{operationId:id})).ok,true);const p=f.native.root.soldier.produksi.produksi[0];assert.deepEqual(p.jahit,before.jahit);assert.deepEqual(p.arsip,before.arsip);
  assert.equal((await c.refreshFinance()).ok,true);assert.equal(state(f).finance.workerLabel,'Synthetic partner');assert.ok(state(f).finance.storedJahit.records.some(r=>r.stored.total===333.75));
  for(const marker of ['worker-2','private-advance','PIN','SYNTHETIC_CASH_PRIVATE','198'])assert.equal(JSON.stringify(state(f).finance).includes(marker),false);c.dispose();
});
test('role, credential, price, stale version and unknown field overrides fail before new ids or dispatch',async()=>{
  const f=fixture(),c=await connected(f),base={workerId:'worker-1',workDate:date,quantity:1},before={calls:f.calls.length,ids:f.ids,writes:f.native.stats.writes};
  for(const extra of [{tarif:1},{total:1},{role:'owner'},{idToken:'secret'},{uid:'owner'},{expectedSourceVersion:'a'.repeat(64)},{quantity:0},{workDate:'2026-02-30'}])assert.equal((await c.submit('appendCount',{...base,...extra})).error,'invalid_request');
  assert.equal((await c.submit('appendJahit',{assignmentId:'assignment-1',workDate:null,good:1,reject:0})).error,'conflict');
  assert.equal((await c.submit('appendCount',{...base,workerId:'foreign'})).error,'conflict');assert.deepEqual({calls:f.calls.length,ids:f.ids,writes:f.native.stats.writes},before);
  let hits=0;const raw={workerId:'worker-1',workDate:date};Object.defineProperty(raw,'quantity',{enumerable:true,get(){hits++;return 1;}});assert.equal((await c.submit('appendCount',raw)).error,'invalid_request');assert.equal(hits,0);c.dispose();
});
test('lost acknowledgement retains one exact command, blocks a replacement and resolves without a second write',async()=>{
  const f=fixture(),c=await connected(f);f.controls.failure=(q,r)=>q.kind==='execute'&&r.ok;
  assert.equal((await c.submit('appendCount',{workerId:'worker-1',workDate:date,quantity:8})).error,'result_unknown');const original=copy(state(f).pending[0]);assert.equal(f.native.stats.writes,1);
  assert.equal((await c.submit('appendCount',{workerId:'worker-2',workDate:date,quantity:2})).error,'pending_review');assert.equal(f.ids,1);
  f.controls.failure=null;assert.equal((await c.retry(original.requestId)).ok,true);assert.equal(f.native.stats.writes,1);assert.deepEqual(f.calls.filter(q=>q.kind==='resolve').at(-1).command,original);assert.deepEqual(state(f).pending,[]);c.dispose();
});
test('reloaded controller resolves a dispatched command from durable storage without creating a replacement id',async()=>{
  const f=fixture(),first=await connected(f);f.controls.failure=(q,r)=>q.kind==='execute'&&r.ok;await first.submit('appendCount',{workerId:'worker-1',workDate:date,quantity:8});const original=copy(state(f).pending[0]);first.dispose();
  f.controls.failure=null;const second=await connected(f);assert.deepEqual(state(f).pending,[original]);assert.equal((await second.retry(original.requestId)).ok,true);assert.equal(f.native.stats.writes,1);assert.equal(f.ids,1);second.dispose();
});
test('unconfirmed storage admission does not dispatch; retry keeps the original in-memory command',async()=>{
  const f=fixture(),c=await connected(f);f.indexed.control.putFail=true;
  assert.equal((await c.submit('appendCount',{workerId:'worker-1',workDate:date,quantity:8})).error,'unavailable');
  const original=copy(state(f).pending[0]);assert.equal(f.native.stats.writes,0);assert.equal(f.calls.filter(q=>q.kind==='execute').length,0);
  assert.equal((await c.submit('appendCount',{workerId:'worker-2',workDate:date,quantity:2})).error,'pending_review');assert.equal(f.ids,1);
  f.indexed.control.putFail=false;assert.equal((await c.retry(original.requestId)).ok,true);assert.deepEqual(f.calls.find(q=>q.kind==='execute').command,original);assert.equal(f.native.stats.writes,1);assert.deepEqual(state(f).pending,[]);c.dispose();
});
test('revocation during token refresh clears operations, finance, selection and pending before dispatch resumes',async()=>{
  const f=fixture('jahit');openJahit(f);const c=await connected(f);await c.refreshFinance();let release,started;const ready=new Promise(r=>{started=r;});f.controls.tokenGate=()=>{started();return new Promise(r=>{release=r;});};
  const submitting=c.submit('appendJahit',{assignmentId:'assignment-1',workDate:null,good:1,reject:0});await ready;assert.equal((await c.refresh()).error,'busy');f.signout();release();assert.equal((await submitting).error,'access_denied');
  assert.equal(state(f).phase,'blocked');for(const k of ['binding','view','finance','productId'])assert.equal(state(f)[k],null);assert.deepEqual(state(f).pending,[]);assert.equal(f.native.stats.writes,0);
});
test('malformed scoped views cannot reach ready or publish cash in QC state',async()=>{
  for(const mutate of [r=>{r.view.products[0].tarif=1;return r;},r=>{r.view.binding.uid='foreign';return r;}]){const f=fixture();f.controls.reply=(r,q)=>q.kind==='read'&&r.ok?mutate(r):r;const c=f.create();assert.equal((await c.connect()).ok,false);assert.equal(f.states.some(s=>s.phase==='ready'),false);assert.equal(state(f).view,null);assert.equal(f.native.stats.writes,0);c.dispose();}
});
test('callback failure before opening prevents any bridge or native request',async()=>{
  let opened=0;const f=fixture(),c=f.create({onState(){throw Error('SYNTHETIC_UI_ERROR');},createBridge(){opened++;throw Error();}});assert.equal((await c.connect()).ok,false);assert.equal(opened,0);assert.equal(f.calls.length,0);
});
test('signout during id generation prevents retention or dispatch of the constructed command',async()=>{
  const f=fixture(),c=f.create({newId(){f.signout();return 'synthetic-after-signout';}});await c.connect();c.selectProduct('product-1');assert.equal((await c.submit('appendCount',{workerId:'worker-1',workDate:date,quantity:1})).error,'access_denied');assert.equal(f.native.stats.writes,0);assert.deepEqual(state(f).pending,[]);assert.equal(state(f).view,null);
});
