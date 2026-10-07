'use strict';
// Synthetic loopback SDK/CAS proof only. Fail BEFORE SDK import/initialization
// unless the existing isolated demo emulator is explicitly present.
const {test}=require('node:test'),assert=require('node:assert/strict');
const PROJECT='demo-soldier-security',HOST='127.0.0.1',PORT=9000,NOW='2026-10-05T03:00:00.000Z',DAY='2026-10-05',URL='https://'+PROJECT+'.firebaseio.com';
assert.ok(process.env.FIREBASE_DATABASE_EMULATOR_HOST===HOST+':'+PORT,'SDK proof requires the isolated loopback emulator');
assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS&&!process.env.FIREBASE_TOKEN,'SDK proof forbids real credential configuration');
assert.ok(Number(process.versions.node.split('.')[0])>=22,'SDK proof requires Node 22 or newer');
const {initializeApp,deleteApp,SDK_VERSION}=require('firebase-admin/app'),{getDatabase}=require('firebase-admin/database');
assert.equal(SDK_VERSION,'14.5.0');
const Authority=require('../server/production-authority.cjs'),Adapter=require('../server/production-tenant-adapter.cjs'),Service=require('../server/production-command-service.cjs');
const copy=v=>JSON.parse(JSON.stringify(v));let sequence=0;
function initial(id){return Authority.createAuthority({product:{id,series:'Synthetic',namaBarang:'Example',size:'M',cutQuantity:10},cycleId:'cycle-1',workers:[{id:'worker-1',nama:'Synthetic partner'}],assignments:[{id:'assignment-1',workerId:'worker-1',qty:10}],now:NOW});}
function product(id){return {cycles:{'cycle-1':{config:{revision:1,active:true,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'},tariffInputs:{revision:1,policy:{version:'policy-1',kind:'jakarta-fixed-local-time',hour:8,minute:0},historyByWorker:{'worker-1':{'tariff-1':{effectiveAt:'2026-01-01T00:00:00.000Z',currency:'IDR',rate:100}}}},wire:Authority.encodeStorage(initial(id))}}};}
function seed(tenantId){return {schemaVersion:1,projectId:PROJECT,tenantId,grants:{'caller-1':{revision:1,profile:{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}}},'other-user':{revision:3,profile:{active:true,owner:false,modules:{qc:true}}}},products:{'product-1':product('product-1'),'product-2':product('product-2')}};}
function subscription(ref){let listener,timer;const ready=new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(Error('fixture cache preparation failed'));};listener=()=>{clearTimeout(timer);resolve();};timer=setTimeout(abort,5000);ref.on('value',listener,abort);});return {ready,close(){clearTimeout(timer);ref.off('value',listener);}};}
async function fixture(t,{empty=false}={}){
  const n=++sequence,tenantId='sdk-proof-'+n;
  // This static emulator-only credential never reads ADC/key files or mints a
  // real token; the loopback/demo checks above precede SDK initialization.
  const credential={getAccessToken:async()=>({access_token:'owner',expires_in:3600})};
  const a=initializeApp({projectId:PROJECT,databaseURL:URL,credential},'sdk-proof-a-'+n);let b,da,db,rb;
  // Register as soon as A exists, so B initialization/binding failures also
  // release A. Cleanup failure must never prevent either app from closing.
  t.after(async()=>{try{if(da)da.goOnline();if(rb)await rb.remove();}finally{await Promise.all([a,b].filter(Boolean).map(app=>Promise.resolve().then(()=>deleteApp(app))));}});
  b=initializeApp({projectId:PROJECT,databaseURL:URL,credential},'sdk-proof-b-'+n);
  da=getDatabase(a);db=getDatabase(b);const path='authorityTenants/'+tenantId,ra=da.ref(path);rb=db.ref(path);
  assert.equal(ra.toString(),'http://'+HOST+':'+PORT+'/'+path);
  if(!empty)await rb.set(seed(tenantId));
  const stats={auth:0,transactions:0,callbacks:0},hooks={interleave:null},pending={promise:null,error:false};
  async function mutate(fn){const warm=subscription(rb);try{await warm.ready;const result=await rb.transaction(value=>{assert.ok(value,'fixture tenant must exist');const next=copy(value);fn(next);return next;},undefined,false);assert.equal(result.committed,true);}finally{warm.close();}}
  const database={app:da.app,ref(fixedPath){assert.equal(fixedPath,path);const real=da.ref(fixedPath);return {toString:()=>real.toString(),get:()=>real.get(),on:(...args)=>real.on(...args),off:(...args)=>real.off(...args),transaction(update,complete,local){
    stats.transactions++;return real.transaction(value=>{
      stats.callbacks++;const candidate=update(value);
      if(candidate!==undefined&&hooks.interleave){
        const fn=hooks.interleave;hooks.interleave=null;
        // Pause A before its conditional put is sent. B commits using a real
        // independent Admin app/tenant CAS, then A resumes with a stale hash.
        da.goOffline();pending.promise=mutate(fn).catch(()=>{pending.error=true;}).finally(()=>da.goOnline());
      }
      return candidate;
    },complete,local);
  }};}};
  const adapter=Adapter.createProductionTenantAdapter({enabled:true,projectId:PROJECT,databaseURL:URL,tenantId,database,testOnlyEmulator:{host:HOST,port:PORT}});
  const auth={async verifyIdToken(token,revoked){assert.equal(revoked,true);stats.auth++;return {uid:'caller-1',sub:'caller-1',aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,email_verified:true,firebase:{sign_in_provider:'google.com'},exp:Date.parse(NOW)/1000+3600};}};
  const service=Service.createProductionCommandService({enabled:true,projectId:PROJECT,auth,repository:adapter.repository,gateway:adapter.gateway,clock:()=>NOW,admit:async()=>true});
  async function state(){return (await rb.get()).val();}
  const command=(kind='sewing',payload={id:'sewing-1',assignmentId:'assignment-1',tanggal:DAY,good:10,reject:0},requestId='request-1',revision=0)=>({idToken:'synthetic-token',command:{requestId,productId:'product-1',cycleId:'cycle-1',expectedRevision:revision,kind,payload}});
  async function execute(request){const response=await service.execute(request);if(pending.promise)await pending.promise;assert.equal(pending.error,false,'independent writer must commit during pause');return response;}
  return {tenantId,da,db,ra,rb,adapter,service,stats,hooks,mutate,state,command,execute};
}
const cycle=root=>root.products['product-1'].cycles['cycle-1'];
const wireState=root=>Authority.decodeStorage(cycle(root).wire);
async function countedFixture(t){const f=await fixture(t);assert.equal((await f.execute(f.command())).ok,true);await f.mutate(root=>{root.grants['caller-1'].revision++;root.grants['caller-1'].profile={active:true,owner:false,modules:{qc:true}};});return f;}
const countCommand=f=>f.command('count',{id:'count-1',assignmentId:'assignment-1',tanggal:DAY,jumlah:10},'count-request',1);

test('pinned Admin SDK has independent loopback references and a cold service commits an actual receipt', {timeout:30000},async t=>{
  const f=await fixture(t),before=await f.state(),request=f.command(),response=await f.execute(request),after=await f.state();
  assert.equal(response.ok,true);assert.equal(response.receipt.revision,1);assert.deepEqual(Object.keys(response.receipt).sort(),['acceptedAt','requestId','revision']);
  // decodeStorage verifies keys derived from UID + request ID. Match the
  // actual committed receipt, never assume request ID is the storage key.
  const stored=Object.values(wireState(after).receipts);assert.equal(stored.length,1);
  const [receipt]=stored;assert.equal(receipt.requestId,request.command.requestId);assert.equal(receipt.uid,'caller-1');assert.equal(receipt.kind,'sewing');assert.equal(receipt.workerId,'worker-1');
  assert.deepEqual({requestId:receipt.requestId,revision:receipt.revision,acceptedAt:receipt.acceptedAt},response.receipt);
  assert.deepEqual(after.grants,before.grants);assert.deepEqual(after.products['product-2'],before.products['product-2']);
  for(const field of ['privateAuthority','worker-1','tariff','rate','synthetic-token'])assert.equal(JSON.stringify(response).includes(field),false);
  const replay=await f.execute(request);assert.equal(replay.ok,true);assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,response.receipt);assert.deepEqual(wireState(await f.state()),wireState(after));
});

test('actual cold null namespace aborts without bootstrap or executing the service updater', {timeout:30000},async t=>{
  const f=await fixture(t,{empty:true});let calls=0;
  const result=await f.adapter.gateway.run({projectId:PROJECT,productId:'product-1',cycleId:'cycle-1',expectedTrust:{projectId:PROJECT,uid:'caller-1',grant:{projectId:PROJECT,uid:'caller-1',revision:1,profile:{active:true,owner:false,modules:{jahit:true}}},cycleConfig:product('product-1').cycles['cycle-1'].config,tariff:null},update(){calls++;throw Error('empty namespace must not reach updater');}});
  assert.deepEqual(result,{committed:false,retryable:true});assert.equal(calls,0);assert.equal(await f.state(),null);
});

for(const [name,change,error]of [
  ['revocation',root=>{root.grants['caller-1'].profile.active=false;root.grants['caller-1'].revision++;},'access_denied'],
  ['rebinding',root=>{root.grants['caller-1'].profile.workerId='different-worker';root.grants['caller-1'].revision++;},'access_denied'],
  ['config change',root=>{cycle(root).config.revision++;},'conflict']
])test('real tenant CAS discards a speculative candidate after '+name,{timeout:30000},async t=>{
  const f=await fixture(t),before=await f.state();f.hooks.interleave=change;const response=await f.execute(f.command()),after=await f.state();
  assert.equal(response.error,error);assert.ok(f.stats.callbacks>=2);assert.equal(f.stats.auth,2);assert.deepEqual(cycle(after).wire,cycle(before).wire);assert.equal(wireState(after).revision,0);
});

test('real tariff version interleaving cannot publish a stale price or count', {timeout:30000},async t=>{
  const f=await countedFixture(t),before=await f.state();f.hooks.interleave=root=>{const input=cycle(root).tariffInputs;input.revision++;input.historyByWorker['worker-1']['tariff-2']={effectiveAt:'2026-10-05T00:00:00.000Z',currency:'IDR',rate:200};};
  const response=await f.execute(countCommand(f)),after=await f.state();assert.equal(response.error,'conflict');assert.equal(f.stats.auth,3);assert.deepEqual(cycle(after).wire,cycle(before).wire);assert.equal(wireState(after).frozenPayroll['count-1'],undefined);
});

test('real unrelated tenant sibling interleaving survives retry and the command commits once', {timeout:30000},async t=>{
  const f=await fixture(t);f.hooks.interleave=root=>{
    root.grants['other-user'].revision++;
    const c=root.products['product-2'].cycles['cycle-1'],old=Authority.decodeStorage(c.wire),next=Authority.applyCommand(old,{uid:'owner-fixture',emailVerified:true,provider:'google.com',profile:{active:true,owner:true},now:NOW},{requestId:'sibling-request',productId:'product-2',cycleId:'cycle-1',expectedRevision:0,kind:'sewing',payload:{id:'sibling-sewing',assignmentId:'assignment-1',tanggal:DAY,good:5,reject:0}});c.wire=Authority.encodeStorage(next.state);
  };
  const response=await f.execute(f.command()),after=await f.state();assert.equal(response.ok,true);assert.equal(f.stats.auth,2);assert.ok(f.stats.transactions>=2);assert.equal(after.grants['other-user'].revision,4);assert.equal(wireState(after).revision,1);assert.equal(Object.keys(wireState(after).sewing).length,1);assert.equal(Authority.decodeStorage(after.products['product-2'].cycles['cycle-1'].wire).revision,1);
});

test('actual committed count receipt replays after catalog changes with its original frozen rate', {timeout:30000},async t=>{
  const f=await countedFixture(t),request=countCommand(f),first=await f.execute(request);assert.equal(first.ok,true);const frozen=copy(wireState(await f.state()).frozenPayroll);
  await f.mutate(root=>{const input=cycle(root).tariffInputs;input.revision++;input.historyByWorker['worker-1']['tariff-2']={effectiveAt:'2026-10-05T00:00:00.000Z',currency:'IDR',rate:999};});
  const replay=await f.execute(request);assert.equal(replay.ok,true);assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,first.receipt);assert.deepEqual(wireState(await f.state()).frozenPayroll,frozen);
});
