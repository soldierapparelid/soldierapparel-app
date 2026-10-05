'use strict';
// Real RTDB SDK/CAS tests with synthetic loopback fixtures. Token verification
// stays synthetic: this suite proves no real Google login/Auth revocation.
const {test}=require('node:test'),assert=require('node:assert/strict');
const PROJECT='demo-soldier-security',HOST='127.0.0.1',PORT=9000,URL='https://'+PROJECT+'.firebaseio.com',NOW='2026-10-05T03:00:00.000Z',LATER='2026-10-05T04:00:00.000Z';
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST,HOST+':'+PORT,'Admin writer proof requires the isolated loopback emulator');
assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS&&!process.env.FIREBASE_TOKEN,'Admin writer proof forbids real credential configuration');
assert.ok(Number(process.versions.node.split('.')[0])>=22,'Admin writer proof requires Node 22 or newer');
const {initializeApp,deleteApp,SDK_VERSION}=require('firebase-admin/app'),{getDatabase}=require('firebase-admin/database');
assert.equal(SDK_VERSION,'14.5.0');
const Authority=require('../server/production-authority.cjs'),Admin=require('../server/production-tenant-admin.cjs');
const copy=v=>JSON.parse(JSON.stringify(v));let sequence=0;
function initial(id){return Authority.createAuthority({product:{id,series:'Synthetic',namaBarang:'Example',size:'M',cutQuantity:10},cycleId:'cycle-1',workers:[{id:'worker-1',nama:'Synthetic first partner'},{id:'worker-2',nama:'Synthetic second partner'}],assignments:[{id:'assignment-1',workerId:'worker-1',qty:10}],now:NOW});}
function product(id){return {cycles:{'cycle-1':{config:{revision:1,active:true,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'},tariffInputs:{revision:1,policy:{version:'policy-1',kind:'jakarta-fixed-local-time',hour:8,minute:0},historyByWorker:{'worker-1':{'tariff-1':{effectiveAt:'2026-01-01T00:00:00.000Z',currency:'IDR',rate:100}}}},wire:Authority.encodeStorage(initial(id))}}};}
function seed(tenantId){return {schemaVersion:1,projectId:PROJECT,tenantId,grants:{'owner-1':{revision:1,profile:{active:true,owner:true}},'worker-user':{revision:2,profile:{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}}}},products:{'product-1':product('product-1'),'product-2':product('product-2')}};}
function subscription(ref){let listener,timer;const ready=new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(Error('synthetic cache preparation failed'));};listener=()=>{clearTimeout(timer);resolve();};timer=setTimeout(abort,5000);ref.on('value',listener,abort);});return {ready,close(){clearTimeout(timer);ref.off('value',listener);}};}
async function fixture(t,{empty=false}={}){
  const n=++sequence,tenantId='admin-proof-'+n,credential={getAccessToken:async()=>({access_token:'owner',expires_in:3600})};
  const a=initializeApp({projectId:PROJECT,databaseURL:URL,credential},'admin-proof-a-'+n);let b,da,db,rb;
  t.after(async()=>{try{if(da)da.goOnline();if(rb)await rb.remove();}finally{await Promise.all([a,b].filter(Boolean).map(app=>Promise.resolve().then(()=>deleteApp(app))));}});
  b=initializeApp({projectId:PROJECT,databaseURL:URL,credential},'admin-proof-b-'+n);da=getDatabase(a);db=getDatabase(b);const path='authorityTenants/'+tenantId;rb=db.ref(path);
  assert.equal(da.ref(path).toString(),'http://'+HOST+':'+PORT+'/'+path);if(!empty)await rb.set(seed(tenantId));
  const stats={auth:0,transactions:0,callbacks:0,on:0,off:0},hooks={interleave:null},pending={promise:null,error:false},actor={uid:'owner-1'};
  async function mutate(fn){const warm=subscription(rb);try{await warm.ready;const result=await rb.transaction(value=>{assert.ok(value);const next=copy(value);fn(next);return next;},undefined,false);assert.equal(result.committed,true);}finally{warm.close();}}
  const database={app:da.app,ref(fixed){assert.equal(fixed,path);const real=da.ref(fixed);return {toString:()=>real.toString(),get:()=>real.get(),on(...args){stats.on++;return real.on(...args);},off(...args){stats.off++;return real.off(...args);},transaction(update,complete,local){
    stats.transactions++;return real.transaction(value=>{stats.callbacks++;const candidate=update(value);if(candidate!==undefined&&hooks.interleave){const fn=hooks.interleave;hooks.interleave=null;da.goOffline();pending.promise=mutate(fn).catch(()=>{pending.error=true;}).finally(()=>da.goOnline());}return candidate;},complete,local);
  }};}};
  const auth={async verifyIdToken(token,checkRevoked){assert.equal(checkRevoked,true);stats.auth++;return {uid:actor.uid,sub:actor.uid,aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,email_verified:true,firebase:{sign_in_provider:'google.com'},exp:Date.parse(NOW)/1000+3600,owner:true};}};
  const admin=Admin.createProductionTenantAdmin({enabled:true,projectId:PROJECT,tenantId,databaseURL:URL,database,auth,admit:async()=>true,clock:()=>NOW,testOnlyEmulator:{host:HOST,port:PORT}});
  const command=()=>({kind:'setGrant',uid:'worker-user',expectedRevision:2,profile:{active:false,owner:false,workerId:'worker-1',modules:{jahit:true}}});
  async function execute(command){const response=await admin.execute({idToken:'synthetic-token',command});if(pending.promise)await pending.promise;assert.equal(pending.error,false,'independent canonical writer must commit while A is paused');return response;}
  return {actor,stats,hooks,mutate,execute,command,state:async()=> (await rb.get()).val()};
}
const cycle=root=>root.products['product-1'].cycles['cycle-1'];
const append=()=>({kind:'appendTariff',productId:'product-1',cycleId:'cycle-1',expectedConfigRevision:1,expectedTariffRevision:1,workerId:'worker-1',tariffVersion:'tariff-2',effectiveAt:LATER,currency:'IDR',rate:200});

test('cold canonical admin grant CAS commits the exact explicit revision and retains sibling data', {timeout:30000},async t=>{
  const f=await fixture(t),before=await f.state(),response=await f.execute(f.command()),after=await f.state();
  assert.deepEqual(response,{ok:true,kind:'setGrant',revision:3});assert.equal(after.grants['worker-user'].revision,3);assert.equal(after.grants['worker-user'].profile.active,false);assert.deepEqual(after.grants['owner-1'],before.grants['owner-1']);assert.deepEqual(after.products,before.products);assert.equal(f.stats.on,f.stats.off);
  assert.equal((await f.execute(f.command())).error,'conflict');assert.deepEqual(await f.state(),after);
  for(const field of ['worker-1','synthetic-token','privateAuthority','profile','rate'])assert.equal(JSON.stringify(response).includes(field),false);
});
test('real new tariff version and config changes preserve every previous rate and frozen authority snapshot', {timeout:30000},async t=>{
  const f=await fixture(t);await f.mutate(root=>{
    const c=cycle(root),context={uid:'owner-1',emailVerified:true,provider:'google.com',profile:{active:true,owner:true},now:NOW};
    const sewn=Authority.applyCommand(Authority.decodeStorage(c.wire),context,{requestId:'sewing-fixture',productId:'product-1',cycleId:'cycle-1',expectedRevision:0,kind:'sewing',payload:{id:'sewing-1',assignmentId:'assignment-1',tanggal:'2026-10-05',good:10,reject:0}}).state;
    context.selectedTariffs={'count-1':{source:'private-verified-tariff',verified:true,workerId:'worker-1',productId:'product-1',cycleId:'cycle-1',countId:'count-1',workDate:'2026-10-05',basisAt:'2026-10-05T01:00:00.000Z',effectiveAt:'2026-01-01T00:00:00.000Z',tariffVersion:'tariff-1',currency:'IDR',rate:100,selectedAt:NOW}};
    c.wire=Authority.encodeStorage(Authority.applyCommand(sewn,context,{requestId:'count-fixture',productId:'product-1',cycleId:'cycle-1',expectedRevision:1,kind:'count',payload:{id:'count-1',assignmentId:'assignment-1',tanggal:'2026-10-05',jumlah:10}}).state);
  });
  const before=await f.state();assert.deepEqual(await f.execute(append()),{ok:true,kind:'appendTariff',revision:2});
  const command={kind:'setConfig',productId:'product-1',cycleId:'cycle-1',expectedRevision:1,config:{active:false,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'}};assert.deepEqual(await f.execute(command),{ok:true,kind:'setConfig',revision:2});
  const after=await f.state();assert.deepEqual(cycle(after).wire,cycle(before).wire);assert.deepEqual(Authority.decodeStorage(cycle(after).wire).frozenPayroll,Authority.decodeStorage(cycle(before).wire).frozenPayroll);assert.deepEqual(cycle(after).tariffInputs.historyByWorker['worker-1']['tariff-1'],cycle(before).tariffInputs.historyByWorker['worker-1']['tariff-1']);assert.deepEqual(after.products['product-2'],before.products['product-2']);assert.deepEqual(after.grants,before.grants);assert.equal(f.stats.on,f.stats.off);
});
for(const [name,mutate,error]of [
  ['owner revocation',root=>{root.grants['owner-1'].profile.active=false;root.grants['owner-1'].revision++;},'access_denied'],
  ['owner rebinding',root=>{root.grants['owner-1'].profile.workerId='worker-2';root.grants['owner-1'].revision++;},'access_denied'],
  ['target grant revision',root=>{root.grants['worker-user'].revision++;},'conflict']
])test('actual admin CAS rejects its speculative grant after '+name,{timeout:30000},async t=>{
  const f=await fixture(t),before=await f.state();f.hooks.interleave=mutate;const response=await f.execute(f.command()),after=await f.state();assert.equal(response.error,error);assert.equal(f.stats.auth,2);assert.ok(f.stats.callbacks>=2);assert.equal(after.grants['worker-user'].profile.active,true);assert.deepEqual(after.products,before.products);assert.equal(f.stats.on,f.stats.off);
});
test('actual tariff/config fence refuses a stale administrative append after a concurrent new version', {timeout:30000},async t=>{
  const f=await fixture(t),before=await f.state();f.hooks.interleave=root=>{const c=cycle(root);c.config.revision++;c.tariffInputs.revision++;c.tariffInputs.historyByWorker['worker-1']['concurrent-version']={effectiveAt:'2026-10-05T03:30:00.000Z',currency:'IDR',rate:150};};
  const response=await f.execute(append()),after=await f.state();assert.equal(response.error,'conflict');assert.equal(f.stats.auth,2);assert.deepEqual(cycle(after).wire,cycle(before).wire);assert.equal(Object.hasOwn(cycle(after).tariffInputs.historyByWorker['worker-1'],'tariff-2'),false);assert.equal(cycle(after).tariffInputs.historyByWorker['worker-1']['concurrent-version'].rate,150);assert.equal(f.stats.on,f.stats.off);
});
test('actual unrelated canonical sibling changes survive admin retry while its intended grant commits once', {timeout:30000},async t=>{
  const f=await fixture(t);f.hooks.interleave=root=>{root.products['product-2'].cycles['cycle-1'].config.revision++;root.grants['sibling-user']={revision:5,profile:{active:true,owner:false,modules:{qc:true}}};};
  assert.equal((await f.execute(f.command())).ok,true);const after=await f.state();assert.equal(f.stats.auth,2);assert.ok(f.stats.transactions>=2);assert.equal(after.grants['worker-user'].revision,3);assert.equal(after.products['product-2'].cycles['cycle-1'].config.revision,2);assert.equal(after.grants['sibling-user'].revision,5);assert.equal(f.stats.on,f.stats.off);
});
test('token owner claim without a live canonical owner cannot write, and an absent namespace is never bootstrapped', {timeout:30000},async t=>{
  const f=await fixture(t),before=await f.state();f.actor.uid='worker-user';assert.equal((await f.execute(f.command())).error,'access_denied');assert.deepEqual(await f.state(),before);assert.equal(f.stats.transactions,0);
  const empty=await fixture(t,{empty:true});assert.equal((await empty.execute(empty.command())).ok,false);assert.equal(await empty.state(),null);assert.equal(empty.stats.transactions,0);
});
