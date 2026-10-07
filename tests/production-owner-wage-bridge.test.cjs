'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Bridge=require('../production-owner-wage-bridge.js');
const {fixture,tick,PROJECT,URL,ENDPOINT}=require('./helpers/owner-wage-bridge-fixture.cjs');
const selection={productId:'product-1',cycleId:'cycle-1',workerId:'worker-1'};
const projection='authorityTenants/tenant-1/products/product-1/cycles/cycle-1/wire/projection/';
const revision='authorityTenants/tenant-1/grants/caller-1/revision';
function empty(f){assert.equal(f.subscribers.size,0);assert.equal(f.authSubscribers.size,0);assert.equal(f.stats.writes,0);}
function gate(){let announce,release;const arrived=new Promise(r=>{announce=r;});return {arrived,wait(){announce();return new Promise(r=>{release=r;});},release(){release();}};}
test('OFF bridge does not execute enabled or other supplied option getters',async()=>{
  for(const enabled of [false,undefined]){let reads=0;const o={enabled};Object.defineProperty(o,'auth',{get(){reads++;throw Error();}});const b=Bridge.createBridge(o);assert.deepEqual(await b.connect(),{ok:false,error:'service_disabled'});assert.deepEqual(b.select(selection),{ok:false,error:'service_disabled'});assert.deepEqual(b.clearSelection(),{ok:false,error:'service_disabled'});b.dispose();assert.equal(reads,0);}
  let reads=0;const b=Bridge.createBridge({get enabled(){reads++;return true;}});assert.equal((await b.connect()).error,'service_disabled');assert.equal(reads,0);
});
test('browser UMD exposes an inactive bridge without Auth, fetch, SDK or persistence globals',async()=>{
  const context=vm.createContext({});vm.runInContext(fs.readFileSync(require.resolve('../production-owner-wage-bridge.js'),'utf8'),context);assert.equal(typeof context.SoldierProductionOwnerWageBridge.createBridge,'function');assert.equal((await vm.runInContext('SoldierProductionOwnerWageBridge.createBridge().connect()',context)).error,'service_disabled');assert.equal(vm.runInContext('SoldierProductionOwnerWageBridge.createBridge().select({})',context).error,'service_disabled');
});
test('owner session only opens fourteen own grant leaves before a synchronous selected read',async()=>{
  const f=fixture(),b=f.create(),result=await b.connect();assert.equal(result.ok,true);assert.deepEqual(result.scope,{projectId:PROJECT,databaseURL:URL,tenantId:'tenant-1',uid:'caller-1',grantRevision:1});assert.deepEqual(result.profile,{active:true,owner:true});assert.deepEqual(result.catalog,f.catalogs[0]);assert.equal(f.stats.tokens,1);assert.equal(f.stats.fetch,1);assert.equal(f.subscribers.size,14);assert.ok(f.stats.refPaths.every(p=>p.startsWith('authorityTenants/tenant-1/grants/caller-1/')));assert.equal(f.views.length,0);
  const selected=b.select(selection);assert.deepEqual(selected,{ok:true});assert.equal(selected.then,undefined);await tick();assert.equal(f.subscribers.size,17);assert.deepEqual(f.stats.refPaths.slice(14),[projection+'operations',projection+'revision',projection+'earningsByWorker/worker-1']);assert.equal(f.views.at(-1).summary.calculatedTotal,1000);assert.equal(f.views.at(-1).summary.provisionalTotal,1000);assert.equal(f.views.at(-1).summary.paymentEvidence,'not_in_this_data');assert.deepEqual(f.clears,['loading','selection_changed']);b.dispose();empty(f);
});
test('incomplete grant gate cannot publish the catalog or subscribe to business leaves',async()=>{
  const f=fixture();f.controls.holdPaths.add(revision);const b=f.create({requestTimeoutMs:1000}),pending=b.connect();await tick();assert.equal(f.catalogs.length,0);assert.deepEqual(b.select(selection),{ok:false,error:'not_ready'});assert.equal(f.stats.refs,14);f.emit(revision);assert.equal((await pending).ok,true);assert.equal(f.catalogs.length,1);b.dispose();empty(f);
});
test('switching worker clears the previous financial view before subscribing and ignores stale events',async()=>{
  const f=fixture(),events=[],b=f.create({onClear:code=>{f.clears.push(code);events.push(['clear',code,f.stats.refs]);}});await b.connect();b.select(selection);await tick();const old=[...f.subscribers.get(projection+'earningsByWorker/worker-1')][0],oldViews=f.views.length;
  assert.deepEqual(b.select({...selection,workerId:'worker-2'}),{ok:true});assert.deepEqual(events.at(-1),['clear','selection_changed',17]);assert.equal(f.subscribers.has(projection+'earningsByWorker/worker-1'),false);old.next({val:()=>{throw Error('stale snapshot must not be read');}});await tick();assert.equal(f.views.length,oldViews+1);assert.equal(f.views.at(-1).selection.workerId,'worker-2');assert.equal(f.views.at(-1).summary.calculatedTotal,0);assert.deepEqual(b.clearSelection(),{ok:true});assert.equal(f.subscribers.size,14);assert.equal(f.clears.at(-1),'selection_cleared');b.dispose();empty(f);
});
test('missing wage leaf remains unavailable instead of fabricating a zero amount',async()=>{
  const f=fixture(),b=f.create();delete f.projection.earningsByWorker['worker-1'];await b.connect();b.select(selection);await tick();assert.equal(f.views.at(-1).availability,'unavailable');assert.equal(f.views.at(-1).earnings,null);assert.equal(f.views.at(-1).summary,null);b.dispose();empty(f);
});
test('unknown catalog tuple and accessor selection clear old reads without running getters',async()=>{
  const f=fixture(),b=f.create();await b.connect();b.select(selection);await tick();const before=f.stats.refs;assert.deepEqual(b.select({...selection,workerId:'unlisted-worker'}),{ok:false,error:'invalid_request'});assert.equal(f.stats.refs,before);assert.equal(f.subscribers.size,14);
  let reads=0;const input={...selection};Object.defineProperty(input,'productId',{enumerable:true,get(){reads++;return 'product-1';}});assert.deepEqual(b.select(input),{ok:false,error:'invalid_request'});assert.equal(reads,0);assert.equal(f.subscribers.size,14);assert.deepEqual(b.select(selection),{ok:true});await tick();assert.equal(f.views.at(-1).selection.workerId,'worker-1');b.dispose();empty(f);
});
test('reentrant selection callbacks cannot replace the outer fixed read scope',async()=>{
  const f=fixture();let b,nested;b=f.create({onClear:code=>{f.clears.push(code);if(code==='selection_changed')nested=b.select({...selection,workerId:'worker-2'});}});await b.connect();assert.deepEqual(b.select(selection),{ok:true});assert.deepEqual(nested,{ok:false,error:'not_ready'});await tick();assert.equal(f.views.at(-1).selection.workerId,'worker-1');assert.equal(f.subscribers.size,17);b.dispose();empty(f);
});
test('QC and sewing partner sessions are denied before owner reads',async()=>{
  for(const role of ['qc','jahit']){const f=fixture(role),b=f.create();assert.deepEqual(await b.connect(),{ok:false,error:'access_denied'});assert.equal(f.stats.refs,0);assert.equal(f.catalogs.length,0);assert.equal(f.views.length,0);assert.deepEqual(f.clears,['access_denied']);empty(f);}
});
test('revoked active, owner or grant revision synchronously clears all access',async()=>{
  for(const field of ['active','owner','revision']){const f=fixture(),b=f.create();await b.connect();b.select(selection);await tick();if(field==='revision')f.grant.revision++;else f.grant.profile[field]=false;f.notify();assert.equal(f.clears.at(-1),'access_changed');empty(f);assert.deepEqual(b.select(selection),{ok:false,error:'access_denied'});assert.deepEqual(await b.connect(),{ok:false,error:'access_denied'});assert.equal(f.stats.fetch,1);}
});
test('account, app identity and current-scope changes prevent subsequent financial updates',async()=>{
  for(const change of ['logout','same_uid_user','db_app','auth_app','current']){const f=fixture();let current=true;const b=f.create({isCurrent:()=>current});await b.connect();b.select(selection);await tick();const before=f.views.length;if(change==='logout')f.switchUser(null);else if(change==='same_uid_user')f.switchUser({...f.user});else if(change==='db_app')f.database.app={options:{...f.auth.app.options}};else if(change==='auth_app')f.auth.app={options:{...f.auth.app.options}};else current=false;f.notify();assert.equal(f.views.length,before);empty(f);assert.deepEqual(b.clearSelection(),{ok:false,error:'access_denied'});}
});
test('same UID replacement during awaited fresh token never sends the old token',async()=>{
  const f=fixture(),g=gate();f.controls.tokenGate=()=>g.wait();const b=f.create(),pending=b.connect();await g.arrived;f.switchUser({...f.user});assert.deepEqual(await pending,{ok:false,error:'access_denied'});g.release();await tick();assert.equal(f.stats.fetch,0);assert.equal(f.stats.refs,0);empty(f);
});
test('logout during awaited session cancels request and cannot hydrate after a late response',async()=>{
  const f=fixture(),g=gate();let signal;f.controls.fetchGate=init=>{signal=init.signal;return g.wait();};const b=f.create(),pending=b.connect();await g.arrived;f.switchUser(null);assert.deepEqual(await pending,{ok:false,error:'access_denied'});assert.equal(signal.aborted,true);g.release();await tick();assert.equal(f.stats.refs,0);assert.equal(f.catalogs.length,0);empty(f);
});
test('token and session deadlines return bounded errors and suppress late work',async()=>{
  for(const phase of ['token','fetch']){const f=fixture(),g=gate();f.controls[phase==='token'?'tokenGate':'fetchGate']=()=>g.wait();const b=f.create({requestTimeoutMs:100}),pending=b.connect();await g.arrived;assert.deepEqual(await pending,{ok:false,error:'unavailable'});g.release();await tick();assert.equal(f.stats.refs,0);assert.equal(f.stats.fetch,phase==='token'?0:1);assert.equal(f.catalogs.length,0);empty(f);}
});
test('missing grant deadline removes all watchers and cancels readiness',async()=>{
  const f=fixture();f.controls.watchNever=true;const b=f.create({requestTimeoutMs:100});assert.deepEqual(await b.connect(),{ok:false,error:'unavailable'});assert.equal(f.stats.refs,14);assert.equal(f.catalogs.length,0);empty(f);assert.deepEqual(b.select(selection),{ok:false,error:'unavailable'});
});
test('invalid fixed configuration rejects without invoking network, SDK or supplied accessors',async()=>{
  for(const extra of [{endpointURL:ENDPOINT+'?x=1'},{endpointURL:ENDPOINT.replace('https:','http:')},{endpointURL:ENDPOINT.replace('/v1/production/session','/v1/production/command')},{databaseURL:URL+'/'},{tenantId:'../tenant'},{requestTimeoutMs:99},{requestTimeoutMs:60001},{unknownOption:true}]){const f=fixture(),b=f.create(extra);assert.deepEqual(await b.connect(),{ok:false,error:'unavailable'});assert.equal(f.stats.fetch,0);assert.equal(f.stats.refs,0);empty(f);}
  const f=fixture();let reads=0;const options={...f.options};Object.defineProperty(options,'fetch',{enumerable:true,get(){reads++;return f.options.fetch;}});assert.deepEqual(await Bridge.createBridge(options).connect(),{ok:false,error:'unavailable'});assert.equal(reads,0);empty(f);
});
test('foreign SDK binding and unverified or non-Google account cannot start an owner request',async()=>{
  for(const change of [f=>{f.database.app={options:{...f.auth.app.options}};},f=>{f.auth.app.options.projectId='foreign-project';},f=>{f.auth.app.options.databaseURL=URL+'/foreign';},f=>{f.user.emailVerified=false;},f=>{f.user.providerData=[{providerId:'password'}];},f=>{f.auth.currentUser=null;}]){const f=fixture();change(f);const b=f.create();assert.deepEqual(await b.connect(),{ok:false,error:'access_denied'});assert.equal(f.stats.fetch,0);assert.equal(f.stats.refs,0);empty(f);}
});
test('malformed fresh token cannot reach HTTP or expose token diagnostics',async()=>{
  for(const token of ['synthetic private token','a.b','a.b.c\r\n', 'a'.repeat(16385)]){const f=fixture();f.controls.token=token;assert.deepEqual(await f.create().connect(),{ok:false,error:'unavailable'});assert.equal(f.stats.fetch,0);assert.equal(f.stats.refs,0);assert.ok(f.clears.every(code=>!code.includes(token)));empty(f);}
});
test('malformed or foreign session fields cannot reach any grant or wage reference',async()=>{
  for(const change of [r=>{r.session.uid='caller-2';},r=>{r.session.projectId='foreign-project';},r=>{r.session.databaseURL='https://foreign.firebaseio.com';},r=>{r.session.tenantId='tenant-2';},r=>{r.session.profile.active=false;},r=>{r.session.profile.secret='synthetic-private-value';},r=>{r.extra=true;},r=>{r.session.cycles=[{productId:'../private',cycleId:'cycle-1'}];}]){const f=fixture();f.controls.sessionMutate=change;assert.equal((await f.create().connect()).ok,false);assert.equal(f.stats.refs,0);assert.equal(f.catalogs.length,0);empty(f);}
});
test('escaped duplicate keys, prototype names, excessive JSON depth and syntax are rejected',async()=>{
  for(const change of [raw=>raw.replace('"ok":true','"ok":false,"\\u006fk":true'),raw=>raw.replace('"ok":true','"ok":true,"__proto__":{}'),raw=>raw.replace('"ok":true','"ok":true,"constructor":{}'),raw=>raw.replace('"ok":true','"ok":true,"prototype":{}'),()=>'{"ok":true,"session":'+ '['.repeat(17)+'0'+']'.repeat(17)+'}',()=>'{"ok":true,']){const f=fixture();f.controls.rawSession=change;assert.deepEqual(await f.create().connect(),{ok:false,error:'unavailable'});assert.equal(f.stats.refs,0);empty(f);}
});
test('redirected, opaque, non-JSON, non-success and mismatched response endpoints fail closed',async()=>{
  for(const change of [r=>{r.redirected=true;},r=>{r.type='opaque';},r=>{r.url=ENDPOINT+'?forwarded=1';},r=>{r.headers=new Headers({'Content-Type':'text/html'});},r=>{r.headers=new Headers({'Content-Type':'application/json; charset=latin1'});},r=>{r.status=500;},r=>{r.body=null;}]){const f=fixture();f.controls.responseMutate=change;assert.deepEqual(await f.create().connect(),{ok:false,error:'unavailable'});assert.equal(f.stats.refs,0);empty(f);}
});
test('bounded streamed bytes reject large bodies, invalid UTF8 and misleading length headers',async()=>{
  for(const variant of ['large','invalid_utf8','noncanonical_length','large_length']){const f=fixture();f.controls.responseFactory=()=>{const bytes=variant==='large'?new Uint8Array(65537).fill(32):variant==='invalid_utf8'?new Uint8Array([0xc3,0x28]):undefined,r=f.response(200,undefined,bytes);if(variant==='large')r.headers.delete('content-length');if(variant==='noncanonical_length')r.headers.set('content-length','01');if(variant==='large_length')r.headers.set('content-length','65537');return r;};assert.deepEqual(await f.create().connect(),{ok:false,error:'unavailable'});assert.equal(f.stats.refs,0);empty(f);}
});
test('HTTP streams can split UTF8 and omit length while preserving fixed request options',async()=>{
  const f=fixture();f.session.workerLabels[0].workers[0].label='Synthetic é';const bytes=new TextEncoder().encode(JSON.stringify({ok:true,session:f.session})),split=bytes.indexOf(0xc3)+1;f.controls.responseFactory=()=>({...f.response(),headers:new Headers({'content-type':'application/json'}),body:new ReadableStream({start(c){c.enqueue(bytes.slice(0,split));c.enqueue(bytes.slice(split));c.close();}})});const b=f.create();assert.equal((await b.connect()).ok,true);assert.equal(f.catalogs[0].cycles[0].workers[0].label,'Synthetic é');assert.equal(f.stats.fetchOptions[0].headers.Authorization,'Bearer header.payload.signature');assert.equal(f.stats.fetchOptions[0].signal.aborted,false);b.dispose();empty(f);
});
test('never-ending stream deadline cancels its reader before any database read',async()=>{
  const f=fixture();let cancel=0;f.controls.responseFactory=()=>({...f.response(),headers:new Headers({'content-type':'application/json'}),body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){cancel++;}})});const b=f.create({requestTimeoutMs:100});assert.deepEqual(await b.connect(),{ok:false,error:'unavailable'});await tick();assert.equal(cancel,1);assert.equal(f.stats.refs,0);empty(f);
});
test('explicit session access denial terminates without retrying or subscribing',async()=>{
  const f=fixture();f.controls.responseFactory=()=>f.response(403,JSON.stringify({ok:false,error:'access_denied'}));const b=f.create();assert.deepEqual(await b.connect(),{ok:false,error:'access_denied'});assert.deepEqual(await b.connect(),{ok:false,error:'access_denied'});assert.equal(f.stats.fetch,1);assert.equal(f.stats.refs,0);assert.deepEqual(f.clears,['access_denied']);empty(f);
});
test('bad SDK reference URL and reference or subscription exceptions cannot leave partial watchers',async()=>{
  for(const fault of ['badRefURL','refThrow','onValueThrow']){const f=fixture();f.controls[fault]=true;assert.deepEqual(await f.create().connect(),{ok:false,error:'unavailable'});assert.equal(f.catalogs.length,0);empty(f);}
});
test('synchronous initial denial or SDK error releases late-returned unsubscribe handles',async()=>{
  for(const fault of ['watchMismatch','watchFail','authFailure']){const f=fixture();f.controls.syncWatch=true;f.controls[fault]=true;assert.equal((await f.create().connect()).ok,false);await tick();assert.equal(f.catalogs.length,0);empty(f);}
});
test('selected read errors terminate the owner view without leaking a SDK message',async()=>{
  const f=fixture(),b=f.create();await b.connect();b.select(selection);await tick();const [{failed}]=[...f.subscribers.get(projection+'earningsByWorker/worker-1')];failed(Error('synthetic-private-sdk-message'));assert.equal(f.clears.at(-1),'read_failed');empty(f);assert.deepEqual(b.select(selection),{ok:false,error:'unavailable'});assert.ok(!JSON.stringify(f.clears).includes('synthetic-private'));
});
test('selected projection tampering or backward revision clears all subscriptions',async()=>{
  for(const tamper of ['wage_total','worker_id','operations_product','revision_backwards']){const f=fixture(),b=f.create();await b.connect();b.select(selection);await tick();if(tamper==='wage_total')Object.values(f.projection.earningsByWorker['worker-1'].entries)[0].total++;if(tamper==='worker_id')f.projection.earningsByWorker['worker-1'].workerId='worker-2';if(tamper==='operations_product')f.projection.operations.id='product-2';if(tamper==='revision_backwards')f.projection.revision--;const before=f.views.length;f.notify();assert.equal(f.clears.at(-1),'invalid_view');empty(f);assert.ok(f.views.length<=before+2);assert.deepEqual(await b.connect(),{ok:false,error:'unavailable'});}
});
test('catalog and view callback exceptions clear access without recursive terminal callbacks',async()=>{
  for(const callback of ['onCatalog','onView']){const f=fixture(),b=f.create({[callback]:()=>{throw Error('synthetic-private-ui-message');}});const connected=await b.connect();if(callback==='onCatalog')assert.equal(connected.ok,false);else{assert.equal(connected.ok,true);b.select(selection);await tick();}assert.equal(f.clears.at(-1),'callback_failed');assert.equal(f.clears.filter(c=>c==='callback_failed').length,1);empty(f);assert.deepEqual(await b.connect(),{ok:false,error:'unavailable'});}
});
test('transient clear callback exception fails closed and dispose clears once even after failure',async()=>{
  const f=fixture();let calls=0;const b=f.create({onClear:()=>{calls++;throw Error('synthetic-private-ui-message');}});assert.deepEqual(await b.connect(),{ok:false,error:'unavailable'});assert.equal(calls,2);b.dispose();b.dispose();assert.equal(calls,2);empty(f);
});
test('repeated and concurrent connects share one fresh session and one grant gate',async()=>{
  const f=fixture(),b=f.create(),[a,c]=await Promise.all([b.connect(),b.connect()]);assert.equal(a.ok,true);assert.equal(c.ok,true);assert.equal((await b.connect()).ok,true);assert.equal(f.stats.tokens,1);assert.equal(f.stats.fetch,1);assert.equal(f.stats.refs,14);b.dispose();assert.deepEqual(await b.connect(),{ok:false,error:'access_denied'});assert.equal(f.clears.filter(code=>code==='disposed').length,1);empty(f);
});
test('enabled bridge never accesses browser persistence or ambient fetch',async()=>{
  const names=['localStorage','sessionStorage','indexedDB','fetch'],old=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));let reads=0;
  try{
    for(const name of names)Object.defineProperty(globalThis,name,{configurable:true,get(){reads++;throw Error('ambient access forbidden');}});
    const f=fixture(),b=f.create();assert.equal((await b.connect()).ok,true);assert.deepEqual(b.select(selection),{ok:true});await tick();assert.equal(f.views.at(-1).availability,'available');b.clearSelection();b.dispose();empty(f);assert.equal(reads,0);
  }finally{for(const name of names){const d=old.get(name);if(d)Object.defineProperty(globalThis,name,d);else delete globalThis[name];}}
});
test('optional reviewed catalog labels pass through without additional product reads',async()=>{
  const f=fixture();f.session.cycleLabels=[{productId:'product-1',cycleId:'cycle-1',series:'Synthetic',namaBarang:'Example',size:'M'}];const b=f.create(),result=await b.connect();assert.equal(result.ok,true);assert.deepEqual(result.catalog.cycles[0].product,{series:'Synthetic',namaBarang:'Example',size:'M'});assert.equal(f.stats.refs,14);b.select(selection);await tick();assert.equal(f.views.at(-1).availability,'available');assert.equal(f.stats.refs,17);b.dispose();empty(f);
});
