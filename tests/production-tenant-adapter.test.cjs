'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Authority=require('../server/production-authority.cjs'),Service=require('../server/production-command-service.cjs'),Adapter=require('../server/production-tenant-adapter.cjs');
const PROJECT='demo-tenant-adapter',TENANT='synthetic-tenant',URL='https://demo-tenant-adapter-default-rtdb.firebaseio.com',NOW='2026-10-05T03:00:00.000Z',DAY='2026-10-05';
const copy=v=>JSON.parse(JSON.stringify(v));
function prune(v){if(v===null)return undefined;if(v&&typeof v==='object'){const out={};for(const [k,item]of Object.entries(v)){const next=prune(item);if(next!==undefined)out[k]=next;}return Object.keys(out).length?out:undefined;}return v;}
function initial(productId='product-1'){
  return Authority.createAuthority({product:{id:productId,series:'Synthetic',namaBarang:'Example',size:'M',cutQuantity:10},cycleId:'cycle-1',workers:[{id:'worker-1',nama:'Synthetic first partner'},{id:'worker-2',nama:'Synthetic second partner'}],assignments:[{id:'assignment-1',workerId:'worker-1',qty:10}],now:NOW});
}
function product(productId){return {cycles:{'cycle-1':{config:{revision:1,active:true,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'},tariffInputs:{revision:1,policy:{version:'policy-1',kind:'jakarta-fixed-local-time',hour:8,minute:0},historyByWorker:{'worker-1':{'tariff-1':{effectiveAt:'2026-01-01T00:00:00.000Z',currency:'IDR',rate:100}}}},wire:prune(Authority.encodeStorage(initial(productId)))}}};}
function setup(overrides={}){
  const store={tenant:{schemaVersion:1,projectId:PROJECT,tenantId:TENANT,grants:{'caller-1':{revision:1,profile:{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}}},'other-user':{revision:7,profile:{active:true,owner:false,workerId:'worker-2',modules:{jahit:true}}}},products:{'product-1':product('product-1'),'product-2':product('product-2')}}};
  const counts={refs:0,reads:0,transactions:0,callbacks:0,writes:0,auth:0},hooks={beforeCallback:null,afterCandidate:null,result:null,cold:false};
  const snapshot=value=>({val:()=>copy(value)});
  const reference={toString:()=>URL+'/authorityTenants/'+TENANT,on(event,callback){assert.equal(event,'value');callback(snapshot(store.tenant));},off(event){assert.equal(event,'value');},async get(){counts.reads++;return snapshot(store.tenant);},async transaction(update,onComplete,applyLocally){
    counts.transactions++;assert.equal(onComplete,undefined);assert.equal(applyLocally,false);
    if(hooks.beforeCallback)hooks.beforeCallback();
    const before=copy(store.tenant),source=hooks.cold?null:copy(store.tenant);hooks.cold=false;counts.callbacks++;
    let candidate=update(source);if(source!==null)assert.deepEqual(source,before,'callback must not mutate the SDK source');
    if(candidate!==undefined&&hooks.afterCandidate){const hook=hooks.afterCandidate;hooks.afterCandidate=null;hook();counts.callbacks++;candidate=update(copy(store.tenant));}
    if(hooks.result)return hooks.result(candidate);
    if(candidate===undefined)return {committed:false,snapshot:snapshot(store.tenant)};
    store.tenant=prune(copy(candidate));counts.writes++;return {committed:true,snapshot:snapshot(store.tenant)};
  }};
  const database={app:{options:{projectId:PROJECT,databaseURL:URL}},ref(path){counts.refs++;assert.equal(path,'authorityTenants/'+TENANT);return reference;}};
  const options={enabled:true,projectId:PROJECT,databaseURL:URL,tenantId:TENANT,database,...overrides};
  let adapter;
  const create=()=>{adapter=Adapter.createProductionTenantAdapter(options);return adapter;};
  const auth={async verifyIdToken(token,revoked){counts.auth++;assert.equal(revoked,true);return {uid:'caller-1',sub:'caller-1',aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,email_verified:true,firebase:{sign_in_provider:'google.com'},exp:Date.parse(NOW)/1000+3600};}};
  const service=()=>{const a=adapter||create();return Service.createProductionCommandService({enabled:true,projectId:PROJECT,auth,repository:a.repository,gateway:a.gateway,clock:()=>NOW,admit:async()=>true});};
  const command=(kind='sewing',payload={id:'sewing-1',assignmentId:'assignment-1',tanggal:DAY,good:10,reject:0},requestId='request-1',revision=Authority.decodeStorage(store.tenant.products['product-1'].cycles['cycle-1'].wire).revision)=>({idToken:'synthetic-token',command:{requestId,productId:'product-1',cycleId:'cycle-1',expectedRevision:revision,kind,payload}});
  return {store,counts,hooks,reference,database,options,create,service,command,cycle:()=>store.tenant.products['product-1'].cycles['cycle-1']};
}
async function sewn(){const f=setup();assert.equal((await f.service().execute(f.command())).ok,true);f.store.tenant.grants['caller-1']={revision:2,profile:{active:true,owner:false,modules:{qc:true}}};return f;}
const count=f=>f.command('count',{id:'count-1',assignmentId:'assignment-1',tanggal:DAY,jumlah:10},'count-request');
const tariffQuery=()=>({projectId:PROJECT,productId:'product-1',cycleId:'cycle-1',workerId:'worker-1',countId:'count-1',workDate:DAY,selectedAt:NOW});
const denies=fn=>assert.throws(fn,error=>error instanceof Authority.AuthorityError&&error.message===error.code);

test('adapter defaults off without creating a Reference or making reads/writes',async()=>{
  const f=setup();delete f.options.enabled;const a=f.create();await assert.rejects(a.repository.readGrant({projectId:PROJECT,uid:'caller-1'}),Authority.AuthorityError);
  assert.deepEqual(f.counts,{refs:0,reads:0,transactions:0,callbacks:0,writes:0,auth:0});
});

test('fixed app/project/database/tenant binding rejects forged URLs and paths before data operations',()=>{
  for(const values of [{projectId:'bad-project'},{tenantId:'../unsafe'},{databaseURL:'https://example.invalid/'},{databaseURL:URL+'/private'},{databaseURL:'https://user:private@demo-tenant-adapter.firebaseio.com/'},{maxTenantBytes:8*1024*1024+1}]){const f=setup(values);denies(f.create);assert.equal(f.counts.reads,0);assert.equal(f.counts.transactions,0);}
  const f=setup();f.reference.toString=()=>URL+'/authorityTenants/different';denies(f.create);assert.equal(f.counts.reads,0);
  const changed=setup();changed.create();changed.database.app.options.projectId='demo-other-project';denies(()=>changed.create());assert.equal(changed.counts.reads,0);
});

test('runtime binding and unsafe queries are rechecked before any source read',async()=>{
  const f=setup(),a=f.create();f.database.app.options.databaseURL='https://demo-other-project.firebaseio.com';await assert.rejects(a.repository.readGrant({projectId:PROJECT,uid:'caller-1'}),Authority.AuthorityError);assert.equal(f.counts.reads,0);
  for(const q of [{projectId:'demo-other-project',uid:'caller-1'},{projectId:PROJECT,uid:'../unsafe'},{projectId:PROJECT,uid:'caller-1',profile:{owner:true}}]){const f=setup();await assert.rejects(f.create().repository.readGrant(q),Authority.AuthorityError);assert.equal(f.counts.reads,0);}
  const missing=setup();delete missing.store.tenant.grants['caller-1'];assert.equal((await missing.service().execute(missing.command())).error,'access_denied');assert.equal(missing.counts.writes,0);
});

test('TESTONLY emulator binding requires demo scope, exact loopback port and matching environment',()=>{
  const previous=process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  try{
    process.env.FIREBASE_DATABASE_EMULATOR_HOST='127.0.0.1:9000';
    for(const override of [{},{testOnlyEmulator:{host:'example.invalid',port:9000}},{testOnlyEmulator:{host:'127.0.0.1',port:9001}},{testOnlyEmulator:{host:'localhost',port:9000}},{testOnlyEmulator:{host:'127.0.0.1',port:9000},projectId:'production-project'}]){const f=setup(override);denies(f.create);assert.equal(f.counts.reads,0);}
    const f=setup({databaseURL:'https://'+PROJECT+'.firebaseio.com',testOnlyEmulator:{host:'127.0.0.1',port:9000}});f.database.app.options.databaseURL=f.options.databaseURL;f.reference.toString=()=> 'http://127.0.0.1:9000/authorityTenants/'+TENANT;assert.ok(f.create());assert.equal(f.counts.reads,0);
    process.env.FIREBASE_DATABASE_EMULATOR_HOST='example.invalid:9000';denies(f.create);
  }finally{if(previous===undefined)delete process.env.FIREBASE_DATABASE_EMULATOR_HOST;else process.env.FIREBASE_DATABASE_EMULATOR_HOST=previous;}
});

test('injected Reference interface commits the envelope, preserving all other canonical tenant branches',async()=>{
  const f=setup(),before=copy(f.store.tenant),request=f.command(),source=copy(request),response=await f.service().execute(request);
  assert.equal(response.ok,true);assert.equal(f.counts.writes,1);assert.deepEqual(f.store.tenant.grants,before.grants);assert.deepEqual(f.store.tenant.products['product-2'],before.products['product-2']);assert.deepEqual(f.cycle().config,before.products['product-1'].cycles['cycle-1'].config);assert.deepEqual(f.cycle().tariffInputs,before.products['product-1'].cycles['cycle-1'].tariffInputs);assert.deepEqual(request,source);
  assert.equal(Authority.decodeStorage(f.cycle().wire).revision,1);assert.deepEqual(Object.keys(response.receipt).sort(),['acceptedAt','requestId','revision']);for(const forbidden of ['privateAuthority','worker-1','rate','tariff','profile','synthetic-token'])assert.equal(JSON.stringify(response).includes(forbidden),false);
});

test('repository and callback select the same explicitly configured Jakarta historical basis',async()=>{
  const f=await sewn(),a=f.create(),selection=await a.repository.selectTariff(tariffQuery());
  assert.equal(selection.selection.basisAt,'2026-10-05T01:00:00.000Z');assert.equal(selection.selection.rate,100);assert.equal(selection.selection.tariffVersion,'tariff-1');
  assert.equal((await f.service().execute(count(f))).ok,true);const frozen=Authority.decodeStorage(f.cycle().wire).frozenPayroll['count-1'];assert.deepEqual(frozen,selection.selection);
});

test('missing or malformed policy/history, duplicate effective times and fractional rates cannot be guessed',async()=>{
  for(const mutate of [f=>{delete f.cycle().tariffInputs.policy;},f=>{f.cycle().tariffInputs.policy.hour=8.5;},f=>{f.cycle().tariffInputs.policy.kind='current-rate';},f=>{f.cycle().tariffInputs.historyByWorker['worker-1']['tariff-1'].rate=100.5;},f=>{f.cycle().tariffInputs.historyByWorker['worker-1']['tariff-2']={effectiveAt:'2026-01-01T00:00:00.000Z',currency:'IDR',rate:200};},f=>{delete f.cycle().tariffInputs.historyByWorker['worker-1'];}]){
    const f=await sewn();mutate(f);const before=copy(f.store.tenant),response=await f.service().execute(count(f));assert.equal(response.ok,false);assert.equal(f.counts.writes,1);assert.deepEqual(f.store.tenant,before);
  }
  const future=await sewn();future.cycle().tariffInputs.policy.hour=23;assert.equal((await future.service().execute(count(future))).ok,false);assert.equal(future.counts.writes,1);
});

test('revoke, rebound, config and tariff changes before the callback cannot commit stale trust',async()=>{
  for(const mutate of [f=>{f.store.tenant.grants['caller-1'].profile.active=false;},f=>{f.store.tenant.grants['caller-1'].profile.workerId='worker-2';f.store.tenant.grants['caller-1'].revision++;},f=>{f.cycle().config.revision++;}]){
    const f=setup();f.hooks.beforeCallback=()=>mutate(f);const response=await f.service().execute(f.command());assert.equal(response.ok,false);assert.equal(f.counts.writes,0);assert.equal(Authority.decodeStorage(f.cycle().wire).revision,0);
  }
  const f=await sewn();f.hooks.beforeCallback=()=>{f.cycle().tariffInputs.historyByWorker['worker-1']['tariff-2']={effectiveAt:'2026-10-05T00:00:00.000Z',currency:'IDR',rate:200};f.cycle().tariffInputs.revision++;};
  assert.equal((await f.service().execute(count(f))).error,'conflict');assert.equal(f.counts.writes,1);assert.equal(Authority.decodeStorage(f.cycle().wire).frozenPayroll['count-1'],undefined);
});

test('interleaved grant/config/tariff writes discard speculative candidates and reverify outside retries',async()=>{
  for(const mutate of [f=>{f.store.tenant.grants['caller-1'].profile.active=false;},f=>{f.store.tenant.grants['caller-1'].profile.workerId='worker-2';f.store.tenant.grants['caller-1'].revision++;},f=>{f.cycle().config.revision++;}]){
    const f=setup();f.hooks.afterCandidate=()=>mutate(f);const response=await f.service().execute(f.command());assert.equal(response.ok,false);assert.equal(f.counts.auth,2);assert.equal(f.counts.writes,0);assert.equal(Authority.decodeStorage(f.cycle().wire).revision,0);
  }
  const f=await sewn(),before=copy(f.cycle().wire);f.hooks.afterCandidate=()=>{f.cycle().tariffInputs.historyByWorker['worker-1']['tariff-2']={effectiveAt:'2026-10-05T00:00:00.000Z',currency:'IDR',rate:200};f.cycle().tariffInputs.revision++;};assert.equal((await f.service().execute(count(f))).error,'conflict');assert.equal(f.counts.writes,1);assert.deepEqual(f.cycle().wire,before);assert.equal(f.counts.auth,3);
});

test('unrelated sibling changes survive a retry while the requested product still commits once',async()=>{
  const f=setup();f.hooks.afterCandidate=()=>{f.store.tenant.grants['other-user'].revision++;const old=Authority.decodeStorage(f.store.tenant.products['product-2'].cycles['cycle-1'].wire),next=Authority.applyCommand(old,{uid:'other-user',emailVerified:true,provider:'google.com',profile:{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}},now:NOW},{requestId:'other-request',productId:'product-2',cycleId:'cycle-1',expectedRevision:0,kind:'sewing',payload:{id:'other-sewing',assignmentId:'assignment-1',tanggal:DAY,good:5,reject:0}});f.store.tenant.products['product-2'].cycles['cycle-1'].wire=prune(Authority.encodeStorage(next.state));};
  const response=await f.service().execute(f.command());assert.equal(response.ok,true);assert.equal(f.counts.auth,2);assert.equal(f.counts.writes,1);assert.equal(f.counts.transactions,2);assert.equal(f.store.tenant.grants['other-user'].revision,8);assert.equal(Authority.decodeStorage(f.store.tenant.products['product-2'].cycles['cycle-1'].wire).revision,1);assert.equal(Authority.decodeStorage(f.cycle().wire).revision,1);
});

test('cold null callback aborts without bootstrap and the next outer fresh read can commit',async()=>{
  const f=setup();f.hooks.cold=true;const response=await f.service().execute(f.command());assert.equal(response.ok,true);assert.equal(f.counts.auth,2);assert.equal(f.counts.transactions,2);assert.equal(f.counts.writes,1);
  const absent=setup();absent.store.tenant=null;assert.equal((await absent.service().execute(absent.command('sewing',{},'request-1',0))).ok,false);assert.equal(absent.counts.writes,0);assert.equal(absent.store.tenant,null);
});

test('total tenant bounds reject both oversized inputs and growing output before any write',async()=>{
  const small=setup({maxTenantBytes:512});assert.equal((await small.service().execute(small.command())).error,'capacity_limit');assert.equal(small.counts.writes,0);
  const f=setup();f.options.maxTenantBytes=Buffer.byteLength(JSON.stringify(f.store.tenant),'utf8')+16;const before=copy(f.store.tenant);assert.equal((await f.service().execute(f.command())).error,'capacity_limit');assert.equal(f.counts.writes,0);assert.deepEqual(f.store.tenant,before);
});

test('forged tenant metadata, wire scope and unexpected fields fail closed without dropping source',async()=>{
  for(const mutate of [f=>{f.store.tenant.projectId='demo-other-project';},f=>{f.store.tenant.tenantId='other-tenant';},f=>{f.cycle().wire=f.store.tenant.products['product-2'].cycles['cycle-1'].wire;},f=>{f.store.tenant.privateFinance={pin:'synthetic-private-pin',amount:999};}]){
    const f=setup();mutate(f);const before=copy(f.store.tenant),response=await f.service().execute(f.command('sewing',{},'request-1',0));assert.equal(response.ok,false);assert.equal(f.counts.writes,0);assert.deepEqual(f.store.tenant,before);assert.equal(JSON.stringify(response).includes('synthetic-private-pin'),false);
  }
});

test('only the actual commit snapshot can yield a receipt; dependency errors are generic',async()=>{
  const f=setup(),before=copy(f.store.tenant);f.hooks.result=candidate=>{assert.ok(candidate);return {committed:true,snapshot:{val:()=>copy(before)}};};assert.equal((await f.service().execute(f.command())).ok,false);assert.equal(f.counts.writes,0);
  const failure=setup();failure.reference.get=async()=>{throw Error('synthetic-token-pin-money');};const response=await failure.service().execute(failure.command());assert.equal(response.ok,false);assert.equal(JSON.stringify(response).includes('synthetic-token-pin-money'),false);assert.equal(failure.counts.writes,0);
});

test('stored getters and SDK snapshot failures cannot execute or echo private source',async()=>{
  const f=setup(),value=copy(f.store.tenant);let called=0;Object.defineProperty(value.grants['caller-1'].profile,'pin',{enumerable:true,get(){called++;throw Error('synthetic-private-getter');}});f.reference.get=async()=>({val:()=>value});
  const response=await f.service().execute(f.command());assert.equal(response.ok,false);assert.equal(called,0);assert.equal(f.counts.writes,0);assert.equal(JSON.stringify(response).includes('synthetic-private-getter'),false);
  const failure=setup();failure.reference.get=async()=>({val(){throw Error('synthetic-private-snapshot');}});await assert.rejects(failure.create().repository.readGrant({projectId:PROJECT,uid:'caller-1'}),error=>error instanceof Authority.AuthorityError&&!error.message.includes('synthetic-private-snapshot'));
});

test('accepted count replay survives catalog changes while a later revoked grant still denies access',async()=>{
  const f=await sewn(),request=count(f),first=await f.service().execute(request),frozen=copy(Authority.decodeStorage(f.cycle().wire).frozenPayroll);assert.equal(first.ok,true);
  f.cycle().tariffInputs.revision++;f.cycle().tariffInputs.historyByWorker['worker-1']['tariff-2']={effectiveAt:'2026-10-05T00:00:00.000Z',currency:'IDR',rate:999};const again=await f.service().execute(request);assert.equal(again.ok,true);assert.equal(again.replayed,true);assert.deepEqual(again.receipt,first.receipt);assert.deepEqual(Authority.decodeStorage(f.cycle().wire).frozenPayroll,frozen);
  f.store.tenant.grants['caller-1'].profile.active=false;assert.equal((await f.service().execute(request)).error,'access_denied');assert.deepEqual(Authority.decodeStorage(f.cycle().wire).frozenPayroll,frozen);
});
