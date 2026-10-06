'use strict';
// Real Admin SDK reads on synthetic loopback RTDB fixtures only. Google token
// verification is injected; this does not prove real Auth login/revocation.
const {test}=require('node:test'),assert=require('node:assert/strict');
const PROJECT='demo-soldier-security',HOST='127.0.0.1',PORT=9000,URL='https://'+PROJECT+'.firebaseio.com',NOW='2026-10-05T03:00:00.000Z';
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST,HOST+':'+PORT,'Session proof requires the isolated loopback emulator');
assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS&&!process.env.FIREBASE_TOKEN,'Session proof forbids real credential configuration');
assert.ok(Number(process.versions.node.split('.')[0])>=22,'Session proof requires Node 22 or newer');
const {initializeApp,deleteApp,SDK_VERSION}=require('firebase-admin/app'),{getDatabase}=require('firebase-admin/database');
assert.equal(SDK_VERSION,'14.5.0');
const Authority=require('../server/production-authority.cjs'),{createProductionSessionService}=require('../server/production-session-service.cjs');
const copy=v=>JSON.parse(JSON.stringify(v));let sequence=0;
function cycle(productId,cycleId,workerId){
  const state=Authority.createAuthority({product:{id:productId,series:'Synthetic',namaBarang:'Synthetic garment',size:'M',cutQuantity:10},cycleId,workers:[{id:'worker-1',nama:'Synthetic first private name'},{id:'worker-2',nama:'Synthetic second private name'}],assignments:[{id:'assignment-1',workerId,qty:10}],now:NOW});
  return {config:{revision:1,active:true,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'},tariffInputs:{revision:1,policy:{version:'policy-1',kind:'jakarta-fixed-local-time',hour:8,minute:0},historyByWorker:{[workerId]:{'tariff-1':{effectiveAt:'2026-01-01T00:00:00.000Z',currency:'IDR',rate:137}}}},wire:Authority.encodeStorage(state)};
}
function seed(tenantId){return {schemaVersion:1,projectId:PROJECT,tenantId,
  grants:{'caller-1':{revision:7,profile:{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}}},'other-uid':{revision:9,profile:{active:true,owner:false,workerId:'worker-2',modules:{jahit:true}}}},
  products:{'product-1':{cycles:{'cycle-1':cycle('product-1','cycle-1','worker-1'),'cycle-2':cycle('product-1','cycle-2','worker-1')}},'product-2':{cycles:{'cycle-1':cycle('product-2','cycle-1','worker-2')}}}
};}
function subscription(ref){let listener,timer;const ready=new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(Error('synthetic cache preparation failed'));};listener=()=>{clearTimeout(timer);resolve();};timer=setTimeout(abort,5000);ref.on('value',listener,abort);});return {ready,close(){clearTimeout(timer);ref.off('value',listener);}};}
async function fixture(t,{empty=false}={}){
  const n=++sequence,tenantId='session-proof-'+n,path='authorityTenants/'+tenantId,credential={getAccessToken:async()=>({access_token:'owner',expires_in:3600})};
  const a=initializeApp({projectId:PROJECT,databaseURL:URL,credential},'session-proof-a-'+n);let b,da,db,rb;
  t.after(async()=>{try{if(da)da.goOnline();if(rb)await rb.remove();}finally{await Promise.all([a,b].filter(Boolean).map(app=>Promise.resolve().then(()=>deleteApp(app))));}});
  b=initializeApp({projectId:PROJECT,databaseURL:URL,credential},'session-proof-b-'+n);da=getDatabase(a);db=getDatabase(b);rb=db.ref(path);
  assert.equal(da.ref(path).toString(),'http://'+HOST+':'+PORT+'/'+path);if(!empty)await rb.set(seed(tenantId));
  const stats={refs:0,reads:0,auth:0,admit:0},hooks={afterRead:null},actor={uid:'caller-1'};
  async function mutate(fn){const warm=subscription(rb);try{await warm.ready;const result=await rb.transaction(value=>{assert.ok(value);const next=copy(value);fn(next);return next;},undefined,false);assert.equal(result.committed,true);}finally{warm.close();}}
  const database={app:da.app,ref(fixed){assert.equal(fixed,path);stats.refs++;const real=da.ref(fixed);return {toString:()=>real.toString(),async get(){stats.reads++;const snapshot=await real.get();if(hooks.afterRead){const interleave=hooks.afterRead;hooks.afterRead=null;await mutate(interleave);}return snapshot;}};}};
  const auth={async verifyIdToken(token,checkRevoked){assert.equal(token,'synthetic-token');assert.equal(checkRevoked,true);stats.auth++;return {uid:actor.uid,sub:actor.uid,aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,email_verified:true,firebase:{sign_in_provider:'google.com'},exp:Date.parse(NOW)/1000+3600,owner:true};}};
  const options={enabled:true,projectId:PROJECT,tenantId,databaseURL:URL,database,auth,admit:async()=>{stats.admit++;return true;},clock:()=>NOW,testOnlyEmulator:{host:HOST,port:PORT}};
  const service=createProductionSessionService(options);
  return {actor,hooks,stats,mutate,options,tenantId,execute:()=>service.execute({idToken:'synthetic-token'}),state:async()=> (await rb.get()).val()};
}
test('cold real SDK get produces one scoped manifest with preserved private codec state and no private response fields',{timeout:30000},async t=>{
  const f=await fixture(t),before=await f.state(),response=await f.execute();
  assert.deepEqual(response,{ok:true,session:{schemaVersion:1,projectId:PROJECT,databaseURL:URL,tenantId:f.tenantId,uid:'caller-1',grantRevision:7,profile:{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}},cycles:[{productId:'product-1',cycleId:'cycle-1'},{productId:'product-1',cycleId:'cycle-2'}],workerLabels:['cycle-1','cycle-2'].map(cycleId=>({productId:'product-1',cycleId,workers:[{workerId:'worker-1',label:'Synthetic first private name'}]}))}});
  assert.deepEqual(f.stats,{refs:1,reads:1,auth:1,admit:1});assert.deepEqual(await f.state(),before);
  const decoded=Authority.decodeStorage(before.products['product-1'].cycles['cycle-1'].wire);
  assert.deepEqual(decoded.sewing,{});assert.equal(decoded.snapshots.v0000000000.parentHash,null,'wire string preserves the private null value through real RTDB');
  for(const value of ['privateAuthority','tariffInputs','Synthetic second private name','other-uid','assignment-1','137','synthetic-token'])assert.equal(JSON.stringify(response).includes(value),false);
});
test('canonical owner/QC/global roles, own cutting assignment and non-operational roles are filtered by actual SDK snapshot',{timeout:30000},async t=>{
  const f=await fixture(t);
  for(const [profile,count]of [[{active:true,owner:true},3],[{active:true,owner:false,workerId:'worker-2',modules:{qc:true}},3],[{active:true,owner:false,workerId:'worker-2',modules:{potong:true}},1],[{active:true,owner:false,modules:{hpp:true,pembelian:true,gaji:true,nota:true,retur:true}},0]]){
    await f.mutate(root=>{root.grants['caller-1'].profile=profile;root.grants['caller-1'].revision++;});const response=await f.execute();assert.equal(response.ok,true);assert.equal(response.session.cycles.length,count);assert.deepEqual(response.session.profile,profile);
    assert.deepEqual(response.session.workerLabels.map(e=>({productId:e.productId,cycleId:e.cycleId})),response.session.cycles);
    const global=profile.owner||profile.modules?.qc;
    for(const labels of response.session.workerLabels)assert.deepEqual(labels.workers.map(w=>w.workerId),global?['worker-1','worker-2']:['worker-2']);
  }
  assert.equal(f.stats.reads,4);
});
test('one real snapshot retains consistent grant and cycle view when B revokes after A read; next read denies',{timeout:30000},async t=>{
  const f=await fixture(t);f.hooks.afterRead=root=>{root.grants['caller-1'].profile.active=false;root.grants['caller-1'].revision++;root.products['product-1'].cycles['cycle-1'].config.active=false;};
  const first=await f.execute();assert.equal(first.ok,true);assert.equal(first.session.grantRevision,7);assert.equal(first.session.cycles.length,2);assert.equal(f.stats.reads,1);assert.equal(first.session.workerLabels.length,2);
  assert.deepEqual(await f.execute(),{ok:false,error:'access_denied'});assert.equal(f.stats.reads,2);assert.equal((await f.state()).grants['caller-1'].profile.active,false);
});
test('owner product labels use one actual SDK snapshot and remain absent for QC after grant replacement',{timeout:30000},async t=>{
  const f=await fixture(t);await f.mutate(root=>{root.grants['caller-1'].profile={active:true,owner:true};root.grants['caller-1'].revision++;root.products['product-2'].cycles['cycle-1'].config.active=false;});
  const before=await f.state(),result=await f.execute();assert.equal(result.ok,true);assert.equal(f.stats.reads,1);assert.deepEqual(await f.state(),before);
  assert.deepEqual(result.session.cycleLabels,['cycle-1','cycle-2'].map(cycleId=>({productId:'product-1',cycleId,series:'Synthetic',namaBarang:'Synthetic garment',size:'M'})));
  assert.ok(Object.isFrozen(result.session.cycleLabels[0]));assert.equal(JSON.stringify(result.session.cycleLabels).includes('tariffInputs'),false);
  await f.mutate(root=>{root.grants['caller-1'].profile={active:true,owner:false,modules:{qc:true}};root.grants['caller-1'].revision++;});const qc=await f.execute();assert.equal(qc.ok,true);assert.equal(Object.hasOwn(qc.session,'cycleLabels'),false);assert.equal(f.stats.reads,2);
});
test('inactive/unreviewed cycles remain excluded and tampered foreign-cycle projections stop the entire initial view',{timeout:30000},async t=>{
  const f=await fixture(t);await f.mutate(root=>{root.products['product-1'].cycles['cycle-1'].config.active=false;root.products['product-1'].cycles['cycle-2'].config.reviewedEmptyCycle=false;});assert.deepEqual((await f.execute()).session.cycles,[]);
  await f.mutate(root=>{root.products['product-2'].cycles['cycle-1'].wire.projection.operations.id='wrong-product';});const before=await f.state();assert.equal((await f.execute()).ok,false);assert.deepEqual(await f.state(),before);
});
test('unknown caller and absent namespace fail closed without bootstrap; manifest limits never silently truncate',{timeout:30000},async t=>{
  const f=await fixture(t);f.actor.uid='unlisted-caller';assert.deepEqual(await f.execute(),{ok:false,error:'access_denied'});f.actor.uid='caller-1';
  const limited=createProductionSessionService({...f.options,maxCycles:1});assert.deepEqual(await limited.execute({idToken:'synthetic-token'}),{ok:false,error:'capacity_limit'});
  const empty=await fixture(t,{empty:true});assert.deepEqual(await empty.execute(),{ok:false,error:'not_ready'});assert.equal(await empty.state(),null);assert.equal(empty.stats.reads,1);
});
