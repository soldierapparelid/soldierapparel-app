'use strict';
// Synthetic identities, data and hosts only. No production connection.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture,POLICY}=require('./fixtures/legacy-lifecycle.cjs');
const F=require('./fixtures/identity-tenant.cjs');
const Finance=require('../server/production-legacy-finance.cjs');
const Codec=require('../legacy-lifecycle-client.js');
const {createLifecycleRuntimeFixture}=require('./helpers/lifecycle-runtime-fixture.cjs');
const {createLifecycleBrowserFixture}=require('./helpers/lifecycle-browser-fixture.cjs');
const {createLifecycleBundleFixture}=require('./helpers/lifecycle-bundle-fixture.cjs');
const owner=()=>F.identity({uid:'owner-1',email:'syntheticowner@gmail.com',googleSubject:'1000099999999'});
const countFields={workerId:'worker-1',quantity:8,workDate:'2026-10-06'};
function runtimeCommand(f,kind,id,extra={}){const r=f.create().read(f.readInput());assert.equal(r.ok,true);return {kind,requestId:'owner-qc-request-'+id,operationId:id,productId:'product-1',expectedGrantRevision:r.view.binding.grantRevision,expectedSourceVersion:r.view.products[0].sourceVersion,...extra};}

test('initialized active owner reads the quantity-only QC lane without a partner enrollment or wage projection',()=>{
 const f=fixture(),before=F.copy(f.root),r=f.read(owner());assert.equal(r.ok,true);assert.equal(r.view.binding.uid,'owner-1');assert.equal(r.view.binding.division,'qc');assert.equal(r.view.binding.workerId,null);assert.equal(r.view.products[0].groups.length,2);
 assert.deepEqual(Codec.normalizeLegacyLifecycleView(r.view,r.view.binding),r.view);
 for(const needle of ['tarif','payroll','total','googleSubject','email','private','authorityTenants','kasbon'])assert.equal(JSON.stringify(r.view).includes(needle),false,needle);
 assert.deepEqual(f.root,before);assert.equal(Finance.createProductionLegacyFinance({enabled:true,binding:f.binding,clock:()=>F.NOW,tariffPolicy:POLICY}).read({root:f.root,identity:owner()}).ok,false);
});

test('owner count and inspection preserve stored money and original QC commands across the shared receipt chain',()=>{
 const f=fixture(),who=owner(),before=F.copy(f.p()),first=f.cmd('appendCount','owner-count-1',countFields,who);f.apply(first,who);
 f.apply(f.cmd('appendCount','quality-count-2',{workerId:'worker-2',quantity:2,workDate:'2026-10-06'}));
 const inspected=f.cmd('inspectCount','owner-quality-1',{countId:'owner-count-1',workDate:'2026-10-06',totals:{ok:5,perbaikan:2,reject:1,offline:0},note:''},who);f.apply(inspected,who);
 assert.deepEqual(f.p().jahit,before.jahit);assert.deepEqual(f.p().potong,before.potong);assert.deepEqual(f.p().arsip,before.arsip);assert.equal(f.p().hitungFisik[0].payroll.rate,3.25);
 assert.equal(f.api.resolve({root:f.root,identity:who,command:first}).receipt.replayed,true);assert.equal(f.api.resolve({root:f.root,identity:who,command:inspected}).receipt.replayed,true);
 assert.equal(f.api.resolve({root:f.root,identity:f.qc,command:first}).ok,false);assert.equal(f.p().hitungFisik.length,2);
});

test('stale, expired and inactive owner contexts reject reads and writes without changing source or receipts',()=>{
 for(const variation of ['expired','inactive','foreign-project','unknown-uid']){const f=fixture(),who=owner(),cmd=f.cmd('appendCount','owner-count-1',countFields,who);f.root.authorityTenants[F.TENANT]=F.copy(f.root.authorityTenants[F.TENANT]);
  if(variation==='expired')who.expiresAtMs=Date.parse(F.NOW);if(variation==='inactive')f.root.authorityTenants[F.TENANT].grants['owner-1'].profile.active=false;if(variation==='foreign-project')who.projectId='demo-other-project';if(variation==='unknown-uid')who.uid='unknown-owner';
  const before=F.copy(f.root);assert.equal(f.read(who).ok,false,variation);assert.equal(f.call(cmd,who).ok,false,variation);assert.deepEqual(f.root,before);
 }
});

test('partner identity and caller role overrides do not adopt the owner QC lane',()=>{
 const f=fixture(),who=owner(),cmd=f.cmd('appendCount','owner-count-1',countFields,who),before=F.copy(f.root);
 assert.equal(f.call(cmd,f.partner).ok,false);for(const extra of [{owner:true},{role:'owner'},{uid:'owner-1'},{division:'qc'},{total:1}])assert.equal(f.call({...cmd,...extra},who).ok,false);
 assert.equal(f.call(f.cmd('editJahit','sewn-1',{workDate:'2026-10-05',good:8,reject:0},who),who).ok,false);assert.deepEqual(f.root,before);
});

test('Apps Script authenticates owner QC reads through the current account and denies owner finance on this lane',()=>{
 const f=createLifecycleRuntimeFixture('owner'),api=f.create(),r=api.read(f.readInput());assert.equal(r.ok,true);assert.equal(r.view.binding.division,'qc');assert.equal(f.stats.google,4);assert.equal(f.stats.reads,2);assert.equal(f.stats.writes,0);
 assert.deepEqual(api.readFinance(f.readInput()),{ok:false,error:'access_denied'});f.account.disabled=true;assert.equal(api.read(f.readInput()).ok,false);assert.equal(f.stats.writes,0);
});

test('Apps Script owner QC missing acknowledgement resolves once and current-account revocation blocks later confirmation',()=>{
 const f=createLifecycleRuntimeFixture('owner'),cmd=runtimeCommand(f,'appendCount','owner-count-1',countFields);f.hooks.afterPut=()=>{throw Error('SYNTHETIC_ACK_LOSS');};
 assert.deepEqual(f.create().execute(f.input(cmd)),{ok:false,error:'result_unknown',retrySameCommand:true});delete f.hooks.afterPut;
 assert.deepEqual(f.create().resolve(f.input(cmd)),{ok:true,replayed:true,operationId:cmd.operationId});assert.equal(f.stats.writes,1);
 f.account.disabled=true;assert.equal(f.create().resolve(f.input(cmd)).ok,false);assert.equal(f.stats.writes,1);
});

test('owner QC browser pipeline preserves its one pending command after reload and never requests partner finance',async()=>{
 const f=createLifecycleBrowserFixture('owner'),state=()=>f.states.at(-1),first=f.create();assert.equal((await first.connect()).ok,true);assert.equal(first.selectProduct('product-1').ok,true);assert.equal(state().binding.division,'qc');
 const calls=f.calls.length;assert.equal((await first.refreshFinance()).error,'access_denied');assert.equal(f.calls.length,calls);
 f.controls.failure=(q,r)=>q.kind==='execute'&&r.ok;assert.equal((await first.submit('appendCount',countFields)).error,'result_unknown');const original=F.copy(state().pending[0]);first.dispose();
 f.controls.failure=null;const second=f.create();assert.equal((await second.connect()).ok,true);second.selectProduct('product-1');assert.deepEqual(state().pending,[original]);assert.equal((await second.retry(original.requestId)).ok,true);assert.deepEqual(state().pending,[]);assert.equal(f.native.stats.writes,1);assert.equal(f.ids,1);assert.equal(state().finance,null);second.dispose();
});

test('generated V8 and JSON RPC graph carries the initialized owner as QC and confirms a quantity command',()=>{
 const f=createLifecycleBundleFixture('owner'),gateway=f.fixture.gateway(),request=f.realm({kind:'read',idToken:f.seed.token});const r=JSON.parse(gateway.dispatchJson(request));assert.equal(r.ok,true);assert.equal(r.view.binding.division,'qc');
 for(const needle of ['tarif','payroll','total','email','googleSubject','SYNTHETIC_PIN'])assert.equal(JSON.stringify(r.view).includes(needle),false);
 const cmd=f.realm({kind:'appendCount',requestId:'generated-owner-qc-request',operationId:'generated-owner-count',productId:'product-1',expectedGrantRevision:r.view.binding.grantRevision,expectedSourceVersion:r.view.products[0].sourceVersion,...countFields});
 assert.deepEqual(JSON.parse(gateway.dispatchJson(f.realm({kind:'execute',idToken:f.seed.token,command:cmd}))),{ok:true,replayed:false,operationId:cmd.operationId});assert.equal(f.fixture.stats.writes,1);
 assert.deepEqual(JSON.parse(gateway.dispatchJson(f.realm({kind:'readFinance',idToken:f.seed.token}))),{ok:false,error:'access_denied'});
});
