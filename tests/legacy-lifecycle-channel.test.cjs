'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Codec=require('../legacy-lifecycle-client.js');
const Server=require('../server/production-legacy-lifecycle.cjs');
const Gateway=require('../server/apps-script/lifecycle-rpc-gateway.cjs');
const Bridge=require('../apps-script-lifecycle-bridge.js');
const {fixture:production}=require('./fixtures/legacy-lifecycle.cjs');
const {createLifecycleRuntimeFixture,KEY,OAUTH}=require('./helpers/lifecycle-runtime-fixture.cjs');
const {fakeIndexedDB}=require('./helpers/command-indexeddb-fixture.cjs');
const copy=v=>JSON.parse(JSON.stringify(v));
const DB='soldier-apps-script-lifecycle-journal:v1',DEPLOYMENT='https://script.google.com/macros/s/SYNTHETIC_LIFECYCLE_000000000000/dev';
function gatewayFixture(division='qc'){
  const f=createLifecycleRuntimeFixture(division),runtime=f.create(),gateway=Gateway.createAppsScriptLifecycleRpcGateway({enabled:true,binding:f.f.binding,runtime});
  const request=(kind,command)=>command?{kind,idToken:f.readInput().idToken,command}:{kind,idToken:f.readInput().idToken};
  return {...f,runtime,gateway,request,native:f};
}
function browserFixture(division='qc',idb=fakeIndexedDB()){
  const f=gatewayFixture(division),controls={failure:null,result:null,drop:null,tokenGate:null},listeners=new Set(),views=[],finances=[],clears=[],calls=[];let active=true,tokens=0;
  const user={uid:f.who.uid,emailVerified:true,providerData:[{providerId:'google.com'}],async getIdToken(force){assert.equal(force,true);tokens++;if(controls.tokenGate)await controls.tokenGate();return f.readInput().idToken;}},auth={currentUser:user,app:{options:{projectId:f.f.binding.projectId,databaseURL:f.f.binding.databaseURL}}};
  function runner(failure,success){return {withFailureHandler(fn){return runner(fn,success);},withSuccessHandler(fn){return runner(failure,fn);},soldierLifecycleRpc(raw){const q=copy(raw);calls.push(q);queueMicrotask(()=>{try{const result=copy(f.gateway.dispatch(q));if(controls.drop?.(q,result))return;if(controls.failure?.(q,result)){failure(Error('SYNTHETIC_PRIVATE_ERROR'));return;}success(controls.result?controls.result(result,q):result);}catch{failure(Error('SYNTHETIC_PRIVATE_ERROR'));}});}};}
  const options={enabled:true,...f.f.binding,deploymentURL:DEPLOYMENT,auth,indexedDB:idb.api,scriptRun:runner(),subscribeAuth(cb){listeners.add(cb);return ()=>listeners.delete(cb);},isCurrent:()=>active,onView:v=>views.push(v),onFinance:v=>finances.push(v),onClear:v=>clears.push(v)};
  const create=changes=>Bridge.createAppsScriptLifecycleBridge({...options,...changes});
  const journalValues=()=>[...(idb.databases.get(DB)?.stores.get('journals')?.values()||[])];
  return {f,idb,options,create,auth,user,controls,listeners,views,finances,clears,calls,journalValues,get tokens(){return tokens;},signout(){active=false;auth.currentUser=null;for(const cb of [...listeners])cb(null);}};
}
test('lifecycle codec accepts actual scoped QC and own Jahit projections, preserving source inputs',()=>{
  const f=production();f.ready();f.inspect();const qc=f.read().view,own=f.read(f.partner).view,before=copy(qc);
  assert.deepEqual(Codec.normalizeLegacyLifecycleView(qc,qc.binding),qc);assert.deepEqual(Codec.normalizeLegacyLifecycleView(own,own.binding),own);assert.deepEqual(qc,before);
  assert.equal(Object.isFrozen(Codec.normalizeLegacyLifecycleView(qc,qc.binding).products[0].inspections[0].totals),true);
  for(const needle of ['tarif','payroll','PIN','email','googleSubject','authorityTenants','private'])assert.equal(JSON.stringify(qc).includes(needle),false);
});
test('QC codec rejects financial extras, foreign bindings, duplicate rows and sparse/prototype/getter data',()=>{
  const f=production();f.ready();f.inspect();const v=f.read().view;
  for(const mutate of [v=>v.products[0].tarif=3,v=>v.products[0].counts[0].payroll={rate:3},v=>v.products[0].inspections[0].totals.amount=1,v=>v.binding.uid='foreign-user',v=>v.products.push(copy(v.products[0])),v=>v.products[0].counts.push(copy(v.products[0].counts[0])),v=>delete v.products[0].counts[0],v=>v.products[0].inspections[0].workDate='2026-02-30',v=>v.products[0].inspections[0].totals.ok=Number.MAX_SAFE_INTEGER]){
    const raw=copy(v);mutate(raw);assert.throws(()=>Codec.normalizeLegacyLifecycleView(raw,v.binding));
  }
  let hits=0;const raw=copy(v);Object.defineProperty(raw.products[0],'private',{enumerable:true,get(){hits++;throw Error('PRIVATE');}});assert.throws(()=>Codec.normalizeLegacyLifecycleView(raw,v.binding));assert.equal(hits,0);
  assert.throws(()=>Codec.normalizeLifecycleBinding({...v.binding,workerId:'worker-1'}));assert.throws(()=>Codec.normalizeLegacyLifecycleFinanceView({},v.binding));
});
test('all eleven browser command schemas agree with the authoritative lifecycle normalizer',()=>{
  const base={requestId:'request-1',operationId:'operation-1',productId:'product-1',expectedGrantRevision:1,expectedSourceVersion:'a'.repeat(64)},date='2026-10-06',totals={ok:1,perbaikan:0,reject:0,offline:0};
  const cases={appendJahit:{assignmentId:'assignment-1',workDate:null,good:1,reject:0},editJahit:{workDate:date,good:1,reject:0},deleteJahit:{},appendCount:{workerId:'worker-1',workDate:date,quantity:1},editCount:{workDate:date,quantity:1},deleteCount:{},inspectCount:{countId:'count-1',workDate:date,totals,note:''},inspectCounts:{countIds:['count-1','count-2'],workDate:date,totals,note:''},editQC:{workDate:date,totals,note:''},editQCGroup:{qcIds:['qc-1','qc-2'],totals,note:''},repairQC:{workDate:date,quantity:1}};
  for(const [kind,extra] of Object.entries(cases)){const cmd={kind,...base,...extra};assert.deepEqual(Codec.normalizeLegacyLifecycleCommand(cmd,1),Server.normalizeLegacyLifecycleCommand(cmd));assert.equal(Object.isFrozen(Codec.normalizeLegacyLifecycleCommand(cmd)),true);}
});
test('commands exclude credentials, prices and role overrides and enforce ids, dates, totals and limits',()=>{
  const f=production(),cmd=f.cmd('appendCount','count-1',{workerId:'worker-1',workDate:'2026-10-06',quantity:1});
  for(const extra of [{idToken:'secret'},{total:1},{tarif:1},{role:'owner'},{uid:'owner-1'},{quantity:0},{quantity:-0},{quantity:1.5},{requestId:'1'},{operationId:'1'},{requestId:'x'.repeat(97)},{expectedGrantRevision:2},{workDate:'2026-02-30'},{expectedSourceVersion:'invalid'}])assert.throws(()=>Codec.normalizeLegacyLifecycleCommand({...cmd,...extra},1));
  const groups={...cmd,kind:'inspectCounts',countIds:['count-1','count-1'],totals:{ok:1,perbaikan:0,reject:0,offline:0},note:''};delete groups.workerId;delete groups.quantity;assert.throws(()=>Codec.normalizeLegacyLifecycleCommand(groups));groups.countIds=Array.from({length:129},(_,i)=>'count-'+i);assert.throws(()=>Codec.normalizeLegacyLifecycleCommand(groups));
});
test('local command check limits own records and roles but server retains authoritative dependency checks',()=>{
  const f=production(),qc=f.read().view,own=f.read(f.partner).view,count=f.cmd('appendCount','count-1',{workerId:'worker-1',workDate:'2026-10-06',quantity:8});
  assert.equal(Codec.commandMatchesView(qc,count),true);assert.equal(Codec.commandMatchesView(qc,{...count,quantity:9}),false);assert.equal(Codec.commandMatchesView(qc,{...count,workerId:'foreign'}),false);assert.equal(Codec.commandMatchesView(own,count),false);
  const edit=f.cmd('editJahit','sewn-1',{good:8,reject:0,workDate:'2026-10-05'},f.partner);assert.equal(Codec.commandMatchesView(own,edit),true);assert.equal(Codec.commandMatchesView(own,{...edit,operationId:'sewn-2'}),false);assert.equal(Codec.commandMatchesView(own,{...edit,expectedSourceVersion:'b'.repeat(64)}),false);
});
test('source-OFF gateway and bridge inspect no dependency, storage or request getters',async()=>{
  let hits=0;const o={enabled:false};for(const k of ['runtime','binding','auth','indexedDB'])Object.defineProperty(o,k,{get(){hits++;throw Error('PRIVATE');}});const raw=new Proxy({},{get(){hits++;throw Error('PRIVATE');},ownKeys(){hits++;throw Error('PRIVATE');}});
  assert.deepEqual(Gateway.createAppsScriptLifecycleRpcGateway(o).dispatch(raw),{ok:false,error:'service_disabled'});
  const b=Bridge.createAppsScriptLifecycleBridge(o);for(const r of [await b.connect(),await b.prepare(raw),await b.send(raw),await b.pending(),await b.readOwnOperations(raw),await b.readOwnFinance(raw)])assert.deepEqual(r,{ok:false,error:'service_disabled'});assert.equal(hits,0);
});
test('gateway composes actual synthetic current-account/root/coordinator runtime and excludes money from QC',()=>{
  const f=gatewayFixture(),r=f.gateway.dispatch(f.request('read'));assert.equal(r.ok,true);assert.equal(r.view.binding.workerId,null);assert.equal(r.view.binding.division,'qc');assert.equal(f.stats.reads,2);assert.equal(f.stats.google,10);
  for(const canary of [KEY,OAUTH,'SYNTHETIC_PIN','tarif','payroll',f.who.email,'authorityTenants'])assert.equal(JSON.stringify(r).includes(canary),false);
  assert.deepEqual(f.gateway.dispatch(f.request('readFinance')),{ok:false,error:'access_denied'});assert.equal(f.stats.writes,0);
});
test('gateway rejects invalid selectors and commands before admission, lookup or managed OAuth',()=>{
  const f=gatewayFixture(),cmd=f.native.command('appendCount','count-1',{workerId:'worker-1',workDate:'2026-10-06',quantity:8});
  for(const mutate of [q=>q.uid='owner-1',q=>q.kind='ownerRead',q=>q.command.tarif=1,q=>q.command.kind='pay',q=>q.idToken='bad']){const raw=f.request('execute',copy(cmd)),before={...f.stats};mutate(raw);assert.equal(f.gateway.dispatch(raw).error,'invalid_request');assert.deepEqual(f.stats,before);}
  const raw=f.request('read'),before={...f.stats};let hits=0;Object.defineProperty(raw,'idToken',{enumerable:true,get(){hits++;throw Error('PRIVATE');}});assert.equal(f.gateway.dispatch(raw).error,'invalid_request');assert.equal(hits,0);assert.deepEqual(f.stats,before);
});
test('gateway lost ACK uses exact-command resolution without repeating root write',()=>{
  const f=gatewayFixture(),cmd=f.native.command('appendCount','count-1',{workerId:'worker-1',workDate:'2026-10-06',quantity:8});f.hooks.afterPut=()=>{throw Error('PRIVATE');};
  assert.deepEqual(f.gateway.dispatch(f.request('execute',cmd)),{ok:false,error:'result_unknown',retrySameCommand:true});delete f.hooks.afterPut;
  assert.deepEqual(f.gateway.dispatch(f.request('resolve',cmd)),{ok:true,replayed:true,operationId:'count-1'});assert.equal(f.stats.writes,1);
});
test('gateway rejects raw roots or QC finance replies, and retains uncertainty for malformed write receipts',()=>{
  const f=production(),valid=f.read();for(const change of [v=>({...v,root:f.root}),v=>{v.view.products[0].cost=1;return v;},v=>{v.view.binding.projectId='demo-other';return v;},v=>Promise.resolve(v)]){
    const reply=change(copy(valid)),fn=()=>reply,g=Gateway.createAppsScriptLifecycleRpcGateway({enabled:true,binding:f.binding,runtime:{read:fn,readFinance:fn,execute:fn,resolve:fn}});assert.deepEqual(g.dispatch({kind:'read',idToken:'a.b.c'}),{ok:false,error:'unavailable'});
  }
  const cmd=f.cmd('deleteCount','count-1'),fn=()=>({ok:true,replayed:false,operationId:'wrong',root:{private:true}}),g=Gateway.createAppsScriptLifecycleRpcGateway({enabled:true,binding:f.binding,runtime:{read:fn,readFinance:fn,execute:fn,resolve:fn}});assert.deepEqual(g.dispatch({kind:'execute',idToken:'a.b.c',command:cmd}),{ok:false,error:'result_unknown',retrySameCommand:true});
});
test('gateway clears retained transient token, rejects reentry and latches method drift',()=>{
  const f=production();let held,g;const fn=q=>{held=q;assert.deepEqual(g.dispatch({kind:'read',idToken:'a.b.c'}),{ok:false,error:'busy'});return {ok:false,error:'not_ready'};},runtime={read:fn,readFinance:fn,execute:fn,resolve:fn};g=Gateway.createAppsScriptLifecycleRpcGateway({enabled:true,binding:f.binding,runtime});assert.equal(g.dispatch({kind:'read',idToken:'a.b.c'}).error,'not_ready');assert.equal(held.idToken,'');runtime.read=()=>({ok:false,error:'access_denied'});assert.equal(g.dispatch({kind:'read',idToken:'a.b.c'}).error,'unavailable');runtime.read=fn;assert.equal(g.dispatch({kind:'read',idToken:'a.b.c'}).error,'unavailable');
});
test('QC browser bridge reads operational DTOs and denies finance locally without another token or RPC',async()=>{
  const f=browserFixture(),b=f.create(),r=await b.connect();assert.equal(r.ok,true);assert.deepEqual(r.profile,{active:true,owner:false,modules:{qc:true}});const before={tokens:f.tokens,calls:f.calls.length};assert.deepEqual(await b.readOwnFinance(),{ok:false,error:'access_denied'});assert.deepEqual({tokens:f.tokens,calls:f.calls.length},before);assert.equal((await b.readOwnOperations('other-worker')).error,'invalid_request');assert.equal(f.idb.databases.has('soldier-apps-script-legacy-journal:v1'),false);b.dispose();assert.equal(f.listeners.size,0);
});
test('QC journal retains lost-ACK count and resolves after reload with no duplicate wage or row',async()=>{
  const f=browserFixture(),b=f.create();await b.connect();const cmd=f.f.native.command('appendCount','count-1',{workerId:'worker-1',quantity:8,workDate:'2026-10-06'});assert.equal((await b.prepare(cmd)).ok,true);f.controls.failure=q=>q.kind==='execute';assert.equal((await b.send(cmd.requestId)).error,'result_unknown');assert.equal(f.f.stats.writes,1);b.dispose();f.controls.failure=null;
  const c=f.create();await c.connect();assert.deepEqual(await c.send(cmd.requestId),{ok:true,replayed:true,operationId:'count-1'});assert.equal(f.f.stats.writes,1);assert.equal((await c.pending()).commands.length,0);assert.equal(f.f.native.root.soldier.produksi.produksi[0].hitungFisik.length,1);for(const value of [f.f.readInput().idToken,OAUTH,KEY])assert.equal(f.journalValues()[0].includes(value),false);c.dispose();
});
test('successive own edits and deletion keep distinct request evidence for the same record',async()=>{
  const f=browserFixture('jahit'),b=f.create();await b.connect();const original=f.f.native.command('editJahit','sewn-1',{good:8,reject:0,workDate:'2026-10-05'});await b.prepare(original);assert.equal((await b.send(original.requestId)).ok,true);await b.readOwnOperations();
  const next=f.f.native.command('editJahit','sewn-1',{good:8,reject:0,workDate:'2026-10-04'});assert.equal((await b.prepare(next)).ok,true);assert.equal((await b.send(next.requestId)).ok,true);await b.readOwnOperations();
  const del=f.f.native.command('deleteJahit','sewn-1');assert.equal((await b.prepare(del)).ok,true);assert.equal((await b.send(del.requestId)).ok,true);assert.equal(f.f.stats.writes,3);
  assert.equal((await b.send(original.requestId)).replayed,true);assert.equal(f.f.stats.writes,3);assert.equal(JSON.parse(f.journalValues()[0]).entries.length,3);assert.equal(f.f.native.root.soldier.produksi.produksi[0].jahit.some(r=>r.id==='sewn-1'),false);assert.deepEqual((await b.readOwnFinance()).view.storedJahit.records.map(r=>r.stored.total),[333.75]);b.dispose();
});
test('QC browser count, inspection, repair and cascade delete retain earlier request resolution',async()=>{
  const f=browserFixture(),b=f.create();await b.connect();
  async function send(kind,id,extra={}){const cmd=f.f.native.command(kind,id,extra);await b.readOwnOperations();assert.equal((await b.prepare(cmd)).ok,true);assert.equal((await b.send(cmd.requestId)).ok,true);return cmd;}
  const original=await send('appendCount','count-1',{workerId:'worker-1',quantity:8,workDate:'2026-10-06'});await send('appendCount','count-2',{workerId:'worker-2',quantity:2,workDate:'2026-10-06'});
  await send('inspectCount','quality-1',{countId:'count-1',workDate:'2026-10-06',totals:{ok:5,perbaikan:2,reject:1,offline:0},note:'Checked'});await send('repairQC','quality-1',{workDate:'2026-10-06',quantity:1});await send('deleteCount','count-1');
  assert.equal((await b.send(original.requestId)).replayed,true);assert.equal(f.f.stats.writes,5);const p=f.f.native.root.soldier.produksi.produksi[0];assert.equal(p.hitungFisik.length,1);assert.equal(p.qc.length,0);assert.equal(p.gudang.length,0);assert.equal(p.jahit[0].total,20);assert.equal(p.jahit[1].total,198);assert.equal(JSON.parse(f.journalValues()[0]).entries.length,5);b.dispose();
});
test('two browser tabs cannot replace a request payload; separate requests can target the same record',async()=>{
  const f=browserFixture('jahit'),a=f.create(),b=f.create();await a.connect();await b.connect();const cmd=f.f.native.command('editJahit','sewn-1',{good:8,reject:0,workDate:'2026-10-05'}),r=await Promise.all([a.prepare(cmd),b.prepare({...cmd,workDate:'2026-10-04'})]);assert.equal(r.filter(x=>x.ok).length,1);assert.equal(r.find(x=>!x.ok).error,'invalid_request');assert.equal((await a.prepare({...cmd,requestId:'different-request'})).ok,true);assert.equal(f.f.stats.writes,0);a.dispose();b.dispose();
});
test('journal write failures and accepted-resolution uncertainty never imply new safe execution',async()=>{
  const f=browserFixture(),b=f.create();await b.connect();const cmd=f.f.native.command('appendCount','count-1',{workerId:'worker-1',quantity:8,workDate:'2026-10-06'});f.idb.control.putFail=true;assert.equal((await b.prepare(cmd)).error,'unavailable');assert.equal(f.f.stats.writes,0);f.idb.control.putFail=false;await b.prepare(cmd);assert.equal((await b.send(cmd.requestId)).ok,true);
  f.controls.result=(v,q)=>q.kind==='resolve'?{ok:false,error:'result_unknown',retrySameCommand:true}:v;assert.equal((await b.send(cmd.requestId)).error,'result_unknown');assert.equal(f.calls.at(-1).kind,'resolve');assert.equal(f.f.stats.writes,1);b.dispose();
});
test('signout during refresh clears views and prevents any write while retaining the prepared report',async()=>{
  const f=browserFixture(),b=f.create();await b.connect();const cmd=f.f.native.command('appendCount','count-1',{workerId:'worker-1',quantity:8,workDate:'2026-10-06'});await b.prepare(cmd);let release,start;const began=new Promise(r=>{start=r;});f.controls.tokenGate=()=>{start();return new Promise(r=>{release=r;});};const result=b.send(cmd.requestId);await began;f.signout();release();assert.equal((await result).error,'access_denied');assert.equal(f.calls.length,1);assert.equal(f.f.stats.writes,0);assert.equal(f.clears.length,1);assert.equal(f.journalValues()[0].includes(cmd.requestId),true);
});
test('foreign account/role/price replies fail before view publication or storage and role commands stay denied',async()=>{
  for(const change of [v=>v.view.binding.uid='other-user',v=>v.view.binding.workerId='worker-1',v=>v.root={private:true},v=>v.view.products[0].cost=1]){const f=browserFixture();f.controls.result=v=>{change(v);return v;};assert.equal((await f.create().connect()).ok,false);assert.equal(f.views.length,0);assert.equal(f.idb.stats.opens,0);}
  const f=browserFixture('jahit'),b=f.create();await b.connect();const cmd=f.f.native.command('appendCount','count-1',{workerId:'worker-1',quantity:1,workDate:'2026-10-06'});assert.equal((await b.prepare(cmd)).error,'conflict');assert.equal(f.calls.length,1);b.dispose();
});
test('deployment and grant-revision journals remain isolated; corrupt duplicate keys are preserved and rejected',async()=>{
  const f=browserFixture('jahit'),b=f.create();await b.connect();const cmd=f.f.native.command('editJahit','sewn-1',{good:8,reject:0,workDate:'2026-10-05'});await b.prepare(cmd);b.dispose();const changed=f.create({deploymentURL:DEPLOYMENT.replace('/dev','/exec')});assert.equal((await changed.connect()).error,'unavailable');
  const map=f.idb.databases.get(DB).stores.get('journals'),key=[...map.keys()][0],raw=map.get(key),bad=raw.replace('"schemaVersion":1','"schemaVersion":1,"\\u0073chemaVersion":1');map.set(key,bad);assert.equal((await f.create().connect()).error,'unavailable');assert.equal(map.get(key),bad);assert.equal(f.f.stats.writes,0);
  map.set(key,raw);f.controls.result=v=>{if(v.view)v.view.binding.grantRevision=2;return v;};const next=f.create();assert.equal((await next.connect()).ok,true);assert.deepEqual((await next.pending()).commands,[]);assert.equal(f.journalValues().some(v=>v.includes(cmd.requestId)),true);next.dispose();
});
