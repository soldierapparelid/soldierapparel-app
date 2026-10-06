'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Authority=require('../server/production-authority.cjs'),{createProductionSessionService}=require('../server/production-session-service.cjs');
const PROJECT='demo-session-view',URL='https://'+PROJECT+'.firebaseio.com',TENANT='synthetic-tenant',NOW='2026-10-05T03:00:00.000Z';
const copy=v=>structuredClone(v);
function prune(v){if(v===null)return undefined;if(v&&typeof v==='object'){const next={};for(const [key,value]of Object.entries(v)){const child=prune(value);if(child!==undefined)next[key]=child;}return Object.keys(next).length?next:undefined;}return v;}
function cycle(productId,cycleId,workerId='worker-1'){
  const state=Authority.createAuthority({product:{id:productId,series:'Synthetic',namaBarang:'Synthetic garment',size:'M',cutQuantity:10},cycleId,workers:[{id:'worker-1',nama:'Synthetic first private name'},{id:'worker-2',nama:'Synthetic second private name'}],assignments:[{id:'assignment-1',workerId,qty:10}],now:NOW});
  return {config:{revision:1,active:true,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'},tariffInputs:{revision:1,policy:{version:'policy-1',kind:'jakarta-fixed-local-time',hour:8,minute:0},historyByWorker:{[workerId]:{'tariff-1':{effectiveAt:'2026-01-01T00:00:00.000Z',currency:'IDR',rate:137}}}},wire:prune(Authority.encodeStorage(state))};
}
function fixture(overrides={}){
  const store={value:{schemaVersion:1,projectId:PROJECT,tenantId:TENANT,grants:{'caller-1':{revision:7,profile:{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}}},'other-uid':{revision:9,profile:{active:true,owner:false,workerId:'worker-2',modules:{jahit:true}}}},products:{'product-2':{cycles:{'cycle-1':cycle('product-2','cycle-1','worker-2')}},'product-1':{cycles:{'cycle-2':cycle('product-1','cycle-2'),'cycle-1':cycle('product-1','cycle-1')}}}}};
  const stats={refs:0,reads:0,auth:0,admit:0},hooks={afterAuth:null,afterRead:null};
  const reference={toString:()=>URL+'/authorityTenants/'+TENANT,async get(){stats.reads++;const value=copy(store.value);if(hooks.afterRead)hooks.afterRead();return {val:()=>value};}};
  const database={app:{options:{projectId:PROJECT,databaseURL:URL}},ref(path){stats.refs++;assert.equal(path,'authorityTenants/'+TENANT);return reference;}};
  const token={uid:'caller-1',sub:'caller-1',aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,email_verified:true,firebase:{sign_in_provider:'google.com'},exp:Date.parse(NOW)/1000+3600,owner:true};
  const auth={async verifyIdToken(value,revoked){stats.auth++;assert.equal(value,'synthetic-token');assert.equal(revoked,true);if(hooks.afterAuth)hooks.afterAuth();return copy(token);}};
  const options={enabled:true,projectId:PROJECT,databaseURL:URL,tenantId:TENANT,database,auth,admit:async scope=>{stats.admit++;assert.deepEqual(scope,{projectId:PROJECT,uid:'caller-1'});return true;},clock:()=>NOW,...overrides};
  return {store,stats,hooks,reference,database,token,options,execute:request=>createProductionSessionService(options).execute(request===undefined?{idToken:'synthetic-token'}:request),profile:()=>store.value.grants['caller-1'].profile};
}
function replaceWorkers(f,productId,cycleId,workers){
  const target=f.store.value.products[productId].cycles[cycleId],old=Authority.decodeStorage(target.wire);
  target.wire=prune(Authority.encodeStorage(Authority.createAuthority({product:old.product,cycleId,workers,assignments:Object.values(old.assignments),now:NOW})));
}
test('owner product labels are rebuilt from the same visible snapshot, preserve raw canonical metadata and add no reads or money',async()=>{
  const f=fixture();f.profile().owner=true;
  const target=f.store.value.products['product-1'].cycles['cycle-1'],state=Authority.decodeStorage(target.wire);target.wire=prune(Authority.encodeStorage(Authority.createAuthority({product:{...state.product,series:'  Synthetic  ',size:''},cycleId:state.cycleId,workers:Object.values(state.workers),assignments:Object.values(state.assignments),now:NOW})));
  f.store.value.products['product-2'].cycles['cycle-1'].config.active=false;
  const before=copy(f.store.value),result=await f.execute();assert.equal(result.ok,true);assert.equal(result.session.cycleLabels.length,2);
  assert.deepEqual(result.session.cycleLabels[0],{productId:'product-1',cycleId:'cycle-1',series:'  Synthetic  ',namaBarang:'Synthetic garment',size:''});
  assert.ok(Object.isFrozen(result.session.cycleLabels[0]));assert.deepEqual(f.store.value,before);assert.deepEqual(f.stats,{refs:1,reads:1,auth:1,admit:1});
  assert.deepEqual(result.session.cycleLabels.map(({productId,cycleId})=>({productId,cycleId})),result.session.cycles);
  for(const field of ['tariffInputs','rate','privateAuthority','email','receipts','assignments'])assert.equal(JSON.stringify(result.session.cycleLabels).includes(field),false);
});
test('product labels remain owner-only despite global operational modules and never rewrite old data',async()=>{
  for(const profile of [{active:true,owner:false,modules:{qc:true}},{active:true,owner:false,modules:{laporan:true}},{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}},{active:true,owner:false,workerId:'worker-1',modules:{potong:true}}]){const f=fixture();f.store.value.grants['caller-1'].profile=profile;const before=copy(f.store.value),result=await f.execute();assert.equal(result.ok,true);assert.equal(Object.hasOwn(result.session,'cycleLabels'),false);assert.deepEqual(f.store.value,before);}
});
test('owner product label controls fail with generic code before any output and source remains untouched',async()=>{
  const f=fixture();f.profile().owner=true;const target=f.store.value.products['product-1'].cycles['cycle-1'],state=Authority.decodeStorage(target.wire);target.wire=prune(Authority.encodeStorage(Authority.createAuthority({product:{...state.product,namaBarang:'Synthetic\u0085control'},cycleId:state.cycleId,workers:Object.values(state.workers),assignments:Object.values(state.assignments),now:NOW})));const before=copy(f.store.value);assert.deepEqual(await f.execute(),{ok:false,error:'not_ready'});assert.deepEqual(f.store.value,before);
});
test('disabled service does not verify, admit, make a Reference or read',async()=>{
  const f=fixture();delete f.options.enabled;assert.deepEqual(await f.execute(),{ok:false,error:'service_disabled'});assert.deepEqual(f.stats,{refs:0,reads:0,auth:0,admit:0});
});
test('one real-shaped canonical snapshot returns only own allowlisted profile and assigned active known cycle IDs',async()=>{
  const f=fixture(),before=copy(f.store.value),response=await f.execute();
  assert.deepEqual(response,{ok:true,session:{schemaVersion:1,projectId:PROJECT,databaseURL:URL,tenantId:TENANT,uid:'caller-1',grantRevision:7,profile:{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}},cycles:[{productId:'product-1',cycleId:'cycle-1'},{productId:'product-1',cycleId:'cycle-2'}],workerLabels:['cycle-1','cycle-2'].map(cycleId=>({productId:'product-1',cycleId,workers:[{workerId:'worker-1',label:'Synthetic first private name'}]}))}});
  assert.deepEqual(f.stats,{refs:1,reads:1,auth:1,admit:1});assert.deepEqual(f.store.value,before);
  for(const privateField of ['privateAuthority','tariffInputs','Synthetic second private name','assignment-1','other-uid','synthetic-token','receipts','137'])assert.equal(JSON.stringify(response).includes(privateField),false);
  assert.ok(Object.isFrozen(response)&&Object.isFrozen(response.session)&&Object.isFrozen(response.session.profile.modules)&&Object.isFrozen(response.session.cycles[0]));
  assert.ok(Object.isFrozen(response.session.workerLabels[0].workers[0]));
});
test('manifest global modules match canonical operation Rules; owner token claims never enlarge partner scope',async()=>{
  for(const profile of [{active:true,owner:true},{active:true,owner:false,modules:{qc:true}},{active:true,owner:false,modules:{laporan:true}},{active:true,owner:false,modules:{stok:true}},{active:true,owner:false,workerId:'worker-2',modules:{qc:true,jahit:true}}]){
    const f=fixture();f.store.value.grants['caller-1'].profile=profile;const response=await f.execute();assert.equal(response.ok,true);assert.equal(response.session.cycles.length,3);assert.deepEqual(response.session.profile,profile);
  }
  const f=fixture();f.store.value.grants['caller-1'].profile={active:true,owner:false,workerId:'worker-2',modules:{potong:true}};assert.deepEqual((await f.execute()).session.cycles,[{productId:'product-2',cycleId:'cycle-1'}]);
});
test('labels are cycle-specific presentation from visible authority workers; partners receive self and globals visible catalog only',async()=>{
  const f=fixture();replaceWorkers(f,'product-1','cycle-1',[{id:'worker-1',nama:'  Synthetic cycle one  '},{id:'worker-2',nama:'Synthetic other visible worker'}]);replaceWorkers(f,'product-1','cycle-2',[{id:'worker-1',nama:'Synthetic cycle two'},{id:'worker-2',nama:'Synthetic other visible worker'}]);
  const before=copy(f.store.value),response=await f.execute();assert.equal(response.ok,true);
  assert.deepEqual(response.session.workerLabels.map(e=>e.workers),[[{workerId:'worker-1',label:'Synthetic cycle one'}],[{workerId:'worker-1',label:'Synthetic cycle two'}]]);
  assert.equal(JSON.stringify(response).includes('Synthetic other visible worker'),false);assert.deepEqual(f.store.value,before);
  for(const profile of [{active:true,owner:true},{active:true,owner:false,modules:{qc:true}},{active:true,owner:false,modules:{laporan:true}},{active:true,owner:false,modules:{stok:true}},{active:true,owner:false,workerId:'worker-1',modules:{qc:true,jahit:true}}]){
    f.store.value.grants['caller-1'].profile=profile;f.store.value.products['product-2'].cycles['cycle-1'].config.active=false;const view=await f.execute();assert.equal(view.ok,true);assert.equal(view.session.workerLabels.length,2);
    assert.deepEqual(view.session.workerLabels.map(e=>e.workers.map(w=>w.workerId)),[['worker-1','worker-2'],['worker-1','worker-2']]);
    for(const field of ['privateAuthority','tariffInputs','other-uid','receipts','rate','pin','email'])assert.equal(Object.hasOwn(view.session.workerLabels[0],field),false);
  }
});
test('labels share the grant/manifest snapshot; controls hold with code-only errors and no source mutation',async()=>{
  const f=fixture();f.hooks.afterRead=()=>replaceWorkers(f,'product-1','cycle-1',[{id:'worker-1',nama:'Synthetic changed later'},{id:'worker-2',nama:'Synthetic other'}]);
  const first=await f.execute();assert.equal(first.session.workerLabels[0].workers[0].label,'Synthetic first private name');assert.equal((await f.execute()).session.workerLabels[0].workers[0].label,'Synthetic changed later');assert.equal(f.stats.reads,2);
  const invalid=fixture();replaceWorkers(invalid,'product-1','cycle-1',[{id:'worker-1',nama:'Synthetic\u0085control'},{id:'worker-2',nama:'Synthetic other'}]);const before=copy(invalid.store.value);assert.deepEqual(await invalid.execute(),{ok:false,error:'not_ready'});assert.deepEqual(invalid.store.value,before);
});
test('visible label count and response byte bounds hold large catalogs explicitly without truncation',async()=>{
  const large=fixture();large.profile().owner=true;replaceWorkers(large,'product-1','cycle-1',Array.from({length:129},(_,i)=>({id:'worker-'+(i+1),nama:'Synthetic label '+i})));assert.deepEqual(await large.execute(),{ok:false,error:'capacity_limit'});
  const bytes=fixture();bytes.profile().owner=true;const workers=Array.from({length:128},(_,i)=>({id:'worker-'+(i+1),nama:'S'.repeat(256)}));for(const c of ['cycle-1','cycle-2'])replaceWorkers(bytes,'product-1',c,workers);assert.deepEqual(await bytes.execute(),{ok:false,error:'capacity_limit'});
  const total=fixture();total.profile().owner=true;total.store.value.products={'product-1':{cycles:{}}};for(let i=1;i<=9;i++){const id='cycle-'+i;total.store.value.products['product-1'].cycles[id]=cycle('product-1',id);replaceWorkers(total,'product-1',id,Array.from({length:128},(_,n)=>({id:'worker-'+(n+1),nama:'Synthetic '+n})));}assert.deepEqual(await total.execute(),{ok:false,error:'capacity_limit'});
});
test('inactive/unreviewed cycles and unassigned partner catalog membership are excluded; non-operational accounts get an empty manifest',async()=>{
  const f=fixture();f.store.value.products['product-1'].cycles['cycle-1'].config.active=false;f.store.value.products['product-1'].cycles['cycle-2'].config.reviewedEmptyCycle=false;assert.deepEqual((await f.execute()).session.cycles,[]);
  for(const profile of [{active:true,owner:false,workerId:'unassigned-worker',modules:{jahit:true}},{active:true,owner:false,modules:{hpp:true,pembelian:true,gaji:true,nota:true,retur:true}},{active:true,owner:false}]){
    const f=fixture();f.store.value.grants['caller-1'].profile=profile;assert.deepEqual((await f.execute()).session.cycles,[]);
  }
  const invalid=fixture();delete invalid.profile().workerId;assert.deepEqual(await invalid.execute(),{ok:false,error:'not_ready'});
});
test('snapshot consistency survives an independent subsequent grant and cycle change; result conveys no durable permission',async()=>{
  const f=fixture();f.hooks.afterRead=()=>{f.profile().active=false;f.store.value.grants['caller-1'].revision++;f.store.value.products['product-1'].cycles['cycle-1'].config.active=false;};
  const service=createProductionSessionService(f.options),first=await service.execute({idToken:'synthetic-token'});assert.equal(first.ok,true);assert.equal(first.session.grantRevision,7);assert.equal(first.session.cycles.length,2);assert.equal(f.stats.reads,1);
  assert.deepEqual(await service.execute({idToken:'synthetic-token'}),{ok:false,error:'access_denied'});assert.equal(f.stats.reads,2);
});
test('fresh revoke-aware verified Google identity strictly binds current UID/sub/project/issuer/expiry',async()=>{
  for(const mutate of [t=>t.email_verified=false,t=>t.firebase.sign_in_provider='password',t=>t.uid='../unsafe',t=>t.sub='other-uid',t=>t.aud='different-project',t=>t.iss='https://example.invalid',t=>t.exp=Date.parse(NOW)/1000,t=>t.exp='9999999999']){
    const f=fixture();mutate(f.token);assert.deepEqual(await f.execute(),{ok:false,error:'access_denied'});assert.equal(f.stats.reads,0);assert.equal(f.stats.refs,0);assert.equal(f.stats.admit,0);
  }
  const f=fixture();let now=NOW;f.options.clock=()=>now;f.hooks.afterAuth=()=>{now='2026-10-05T05:00:00.000Z';};assert.equal((await f.execute()).error,'access_denied');assert.equal(f.stats.reads,0);
  const revoked=fixture();revoked.options.auth.verifyIdToken=async()=>{throw Error('synthetic-private-revocation');};assert.deepEqual(await revoked.execute(),{ok:false,error:'access_denied'});
});
test('unknown/revoked callers, malformed own profiles and counterfeit owner body claims cannot obtain a view',async()=>{
  for(const mutate of [f=>delete f.store.value.grants['caller-1'],f=>f.profile().active=false,f=>f.profile().owner='true',f=>f.profile().modules.money=true,f=>f.profile().email='synthetic@example.invalid']){
    const f=fixture();mutate(f);assert.equal((await f.execute()).ok,false);assert.equal(f.stats.reads,1);
  }
  for(const request of [{idToken:'synthetic-token',owner:true},{idToken:'synthetic-token',tenantId:'other'},{idToken:'synthetic-token',uid:'other-uid'},{idToken:'synthetic-token',cycles:[]},{idToken:'synthetic-token',pin:'synthetic-private-pin'},null,{},[],{idToken:'x\ny'},{idToken:'x'.repeat(16385)}]){
    const f=fixture();assert.deepEqual(await f.execute(request),{ok:false,error:'invalid_request'});assert.equal(f.stats.auth,0);assert.equal(f.stats.reads,0);
  }
});
test('getter/prototype/sparse-array inputs and SDK data never invoke getters or leak exceptions',async()=>{
  let touched=0;const request={};Object.defineProperty(request,'idToken',{enumerable:true,get(){touched++;return 'synthetic-token';}});assert.equal((await fixture().execute(request)).error,'invalid_request');assert.equal(touched,0);
  const source=fixture();Object.defineProperty(source.store.value.grants['caller-1'].profile,'workerId',{enumerable:true,get(){touched++;return 'worker-1';}});source.reference.get=async()=>({val:()=>source.store.value});assert.equal((await source.execute()).error,'not_ready');assert.equal(touched,0);
  const polluted=fixture();polluted.store.value.products['product-1'].cycles['cycle-1'].config=Object.assign(Object.create({private:'synthetic'}),polluted.store.value.products['product-1'].cycles['cycle-1'].config);polluted.reference.get=async()=>({val:()=>polluted.store.value});assert.equal((await polluted.execute()).error,'not_ready');
  const f=fixture();f.reference.get=async()=>{throw Error('synthetic-secret-SDK-message');};assert.deepEqual(await f.execute(),{ok:false,error:'unavailable'});
});
test('unknown namespace/schema/fields, malformed tariffs and mismatched/tampered projection fail closed even outside caller scope',async()=>{
  for(const mutate of [f=>f.store.value=null,f=>f.store.value.schemaVersion=2,f=>f.store.value.privateExtra='synthetic',f=>f.store.value.products['product-2'].cycles['cycle-1'].config.extra=true,f=>f.store.value.products['product-2'].cycles['cycle-1'].tariffInputs.historyByWorker['worker-2']['tariff-1'].rate=-1,f=>f.store.value.products['product-2'].cycles['cycle-1'].wire.projection.operations.id='wrong-product',f=>f.store.value.products['product-2'].cycles['cycle-1'].wire.productId='wrong-product']){
    const f=fixture();mutate(f);assert.equal((await f.execute()).ok,false);
  }
  for(const field of ['projectId','tenantId']){const f=fixture();f.store.value[field]='wrong-binding';assert.deepEqual(await f.execute(),{ok:false,error:'access_denied'});}
});
test('cycle/response/tenant limits fail explicitly without a partial manifest or admission bypass',async()=>{
  for(const options of [{maxCycles:1},{maxResponseBytes:1},{maxTenantBytes:1}]){const f=fixture(options);assert.deepEqual(await f.execute(),{ok:false,error:'capacity_limit'});assert.equal(f.stats.reads,1);}
  const f=fixture({maxCycles:2});assert.equal((await f.execute()).session.cycles.length,2);
  const denied=fixture({admit:async()=>false});assert.deepEqual(await denied.execute(),{ok:false,error:'rate_limited'});assert.equal(denied.stats.reads,0);assert.equal(denied.stats.refs,0);
});
test('fixed server binding rejects URL routes/query/credentials and never permits runtime DB/project/reference rebinding',async()=>{
  for(const options of [{projectId:'other-project'},{tenantId:'../other'},{databaseURL:URL+'/path'},{databaseURL:URL+'?secret=synthetic'},{databaseURL:'https://user:password@demo-session-view.firebaseio.com'},{maxCycles:0},{maxCycles:2049},{maxResponseBytes:1024*1024+1},{maxTenantBytes:8*1024*1024+1}]){
    const f=fixture(options);assert.deepEqual(await f.execute(),{ok:false,error:'unavailable'});assert.equal(f.stats.reads,0);assert.equal(f.stats.refs,0);
  }
  const f=fixture(),service=createProductionSessionService(f.options);f.database.app.options.projectId='different-project';assert.equal((await service.execute({idToken:'synthetic-token'})).error,'access_denied');assert.equal(f.stats.auth,0);
  const pointer=fixture();pointer.hooks.afterAuth=()=>{pointer.database.app.options.databaseURL='https://different-project.firebaseio.com';};assert.equal((await pointer.execute()).error,'access_denied');assert.equal(pointer.stats.reads,0);
  const ref=fixture();ref.reference.toString=()=>URL+'/authorityTenants/other-tenant';assert.equal((await ref.execute()).error,'access_denied');assert.equal(ref.stats.reads,0);
});
test('TESTONLY mode is exact demo loopback; production refuses an emulator environment and no listener is required',async()=>{
  const previous=process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  try{
    process.env.FIREBASE_DATABASE_EMULATOR_HOST='127.0.0.1:9000';assert.equal((await fixture().execute()).error,'unavailable');
    for(const testOnlyEmulator of [{host:'example.invalid',port:9000},{host:'localhost',port:9000},{host:'127.0.0.1',port:9001}])assert.equal((await fixture({testOnlyEmulator}).execute()).error,'unavailable');
    const f=fixture({testOnlyEmulator:{host:'127.0.0.1',port:9000}});f.reference.toString=()=> 'http://127.0.0.1:9000/authorityTenants/'+TENANT;assert.equal((await f.execute()).ok,true);assert.equal(f.stats.reads,1);
  }finally{if(previous===undefined)delete process.env.FIREBASE_DATABASE_EMULATOR_HOST;else process.env.FIREBASE_DATABASE_EMULATOR_HOST=previous;}
});
test('bad server clocks/admission/snapshot acknowledgment yield fixed errors only',async()=>{
  for(const clock of [()=>null,()=> '2026-10-05',()=> '2026-02-30T00:00:00.000Z',()=>{throw Error('synthetic-clock-secret');}]){const f=fixture({clock});assert.deepEqual(await f.execute(),{ok:false,error:'unavailable'});assert.equal(f.stats.reads,0);}
  for(const get of [async()=>({}),async()=>({val(){throw Error('synthetic-snapshot-secret');}})]){const f=fixture();f.reference.get=get;assert.deepEqual(await f.execute(),{ok:false,error:'unavailable'});}
  const failed=fixture({admit:async()=>{throw Error('synthetic-admission-secret');}});assert.deepEqual(await failed.execute(),{ok:false,error:'unavailable'});
});
