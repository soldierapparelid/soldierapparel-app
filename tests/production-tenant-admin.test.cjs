'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),Authority=require('../server/production-authority.cjs'),Admin=require('../server/production-tenant-admin.cjs');
const PROJECT='demo-tenant-admin',TENANT='synthetic-tenant',URL='https://demo-tenant-admin.firebaseio.com',NOW='2026-10-05T03:00:00.000Z',LATER='2026-10-05T04:00:00.000Z';
const copy=v=>structuredClone(v);
function prune(v){if(v===null)return undefined;if(v&&typeof v==='object'){const next={};for(const [key,value]of Object.entries(v)){const item=prune(value);if(item!==undefined)next[key]=item;}return Object.keys(next).length?next:undefined;}return v;}
function authority(id='product-1'){return Authority.createAuthority({product:{id,series:'Synthetic',namaBarang:'Example',size:'M',cutQuantity:10},cycleId:'cycle-1',workers:[{id:'worker-1',nama:'Synthetic first partner'},{id:'worker-2',nama:'Synthetic second partner'}],assignments:[{id:'assignment-1',workerId:'worker-1',qty:10}],now:NOW});}
function product(id){return {cycles:{'cycle-1':{config:{revision:1,active:true,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'},tariffInputs:{revision:1,policy:{version:'policy-1',kind:'jakarta-fixed-local-time',hour:8,minute:0},historyByWorker:{'worker-1':{'tariff-1':{effectiveAt:'2026-01-01T00:00:00.000Z',currency:'IDR',rate:100}}}},wire:prune(Authority.encodeStorage(authority(id)))}}};}
function setup(overrides={}){
  const store={tenant:{schemaVersion:1,projectId:PROJECT,tenantId:TENANT,grants:{'owner-1':{revision:1,profile:{active:true,owner:true}},'worker-user':{revision:2,profile:{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}}}},products:{'product-1':product('product-1'),'product-2':product('product-2')}}};
  const stats={refs:0,reads:0,auth:0,admit:0,on:0,off:0,transactions:0,callbacks:0,writes:0},hooks={before:null,after:null,cold:false,result:null},listeners=new Set();
  const snapshot=value=>({val:()=>copy(value)});
  const reference={toString:()=>URL+'/authorityTenants/'+TENANT,
    async get(){stats.reads++;return snapshot(store.tenant);},
    on(event,callback){assert.equal(event,'value');stats.on++;listeners.add(callback);callback(snapshot(store.tenant));},
    off(event,callback){assert.equal(event,'value');assert.ok(listeners.has(callback));listeners.delete(callback);stats.off++;},
    async transaction(update,complete,local){
      assert.equal(complete,undefined);assert.equal(local,false);stats.transactions++;
      if(hooks.before){const change=hooks.before;hooks.before=null;change();}
      let source=hooks.cold?null:copy(store.tenant);hooks.cold=false;const before=copy(source);stats.callbacks++;let candidate=update(source);assert.deepEqual(source,before,'SDK callback input must remain immutable');
      if(candidate!==undefined&&hooks.after){const change=hooks.after;hooks.after=null;change();source=copy(store.tenant);const fresh=copy(source);stats.callbacks++;candidate=update(source);assert.deepEqual(source,fresh);}
      if(hooks.result)return hooks.result(candidate);
      if(candidate===undefined)return {committed:false,snapshot:snapshot(store.tenant)};
      store.tenant=prune(copy(candidate));stats.writes++;return {committed:true,snapshot:snapshot(store.tenant)};
    }};
  const database={app:{options:{projectId:PROJECT,databaseURL:URL}},ref(path){stats.refs++;assert.equal(path,'authorityTenants/'+TENANT);return reference;}};
  const decoded={uid:'owner-1',sub:'owner-1',aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,email_verified:true,firebase:{sign_in_provider:'google.com'},exp:Date.parse(NOW)/1000+3600};
  const auth={async verifyIdToken(token,checkRevoked){assert.equal(token,'synthetic-token');assert.equal(checkRevoked,true);stats.auth++;return copy(decoded);}};
  const options={enabled:true,projectId:PROJECT,tenantId:TENANT,databaseURL:URL,database,auth,clock:()=>NOW,admit:async()=>{stats.admit++;return true;},...overrides};
  const create=()=>Admin.createProductionTenantAdmin(options);
  const request=command=>({idToken:'synthetic-token',command});
  const command=()=>({kind:'setGrant',uid:'worker-user',expectedRevision:2,profile:{active:false,owner:false,workerId:'worker-1',modules:{jahit:true}}});
  return {store,stats,hooks,listeners,reference,database,decoded,options,create,request,command,cycle:()=>store.tenant.products['product-1'].cycles['cycle-1']};
}
const tariff=()=>({kind:'appendTariff',productId:'product-1',cycleId:'cycle-1',expectedConfigRevision:1,expectedTariffRevision:1,workerId:'worker-1',tariffVersion:'tariff-2',effectiveAt:LATER,currency:'IDR',rate:200});
const config=()=>({kind:'setConfig',productId:'product-1',cycleId:'cycle-1',expectedRevision:1,config:{active:false,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'}});

test('admin defaults disabled without a Reference, token verification, listener or data operations',async()=>{
  const f=setup();delete f.options.enabled;assert.deepEqual(await f.create().execute(f.request(f.command())),{ok:false,error:'service_disabled'});assert.ok(Object.values(f.stats).every(n=>n===0));
});
test('project/instance/tenant bindings and runtime rebinding fail before source operations',async()=>{
  for(const values of [{projectId:'different-project'},{tenantId:'../unsafe'},{databaseURL:'https://example.invalid'},{databaseURL:URL+'/private'},{maxTenantBytes:8*1024*1024+1},{maxAttempts:6}]){
    const f=setup(values);assert.throws(f.create,Admin.TenantAdminError);assert.equal(f.stats.reads,0);assert.equal(f.stats.transactions,0);
  }
  const f=setup(),admin=f.create();f.database.app.options.projectId='different-project';assert.equal((await admin.execute(f.request(f.command()))).error,'access_denied');assert.equal(f.stats.auth,0);assert.equal(f.stats.reads,0);
});
test('TESTONLY emulator binding requires exact demo scope, port and environment; production rejects emulator environment',()=>{
  const previous=process.env.FIREBASE_DATABASE_EMULATOR_HOST;try{
    process.env.FIREBASE_DATABASE_EMULATOR_HOST='127.0.0.1:9000';const off=setup();assert.throws(off.create,Admin.TenantAdminError);
    for(const testOnlyEmulator of [{host:'example.invalid',port:9000},{host:'localhost',port:9000},{host:'127.0.0.1',port:9001}])assert.throws(setup({testOnlyEmulator}).create,Admin.TenantAdminError);
    const f=setup({testOnlyEmulator:{host:'127.0.0.1',port:9000}});f.reference.toString=()=> 'http://127.0.0.1:9000/authorityTenants/'+TENANT;assert.ok(f.create());assert.equal(f.stats.reads,0);
  }finally{if(previous===undefined)delete process.env.FIREBASE_DATABASE_EMULATOR_HOST;else process.env.FIREBASE_DATABASE_EMULATOR_HOST=previous;}
});
test('only a freshly verified Google identity with a live canonical active owner grant may administer',async()=>{
  for(const mutate of [f=>f.decoded.email_verified=false,f=>f.decoded.firebase.sign_in_provider='password',f=>f.decoded.aud='different-project',f=>f.decoded.sub='different-user',f=>f.decoded.exp=0,f=>f.decoded.uid='../unsafe',f=>f.store.tenant.grants['owner-1'].profile.owner=false,f=>f.store.tenant.grants['owner-1'].profile.active=false,f=>delete f.store.tenant.grants['owner-1']]){
    const f=setup();mutate(f);const before=copy(f.store.tenant);assert.equal((await f.create().execute(f.request(f.command()))).error,'access_denied');assert.deepEqual(f.store.tenant,before);assert.equal(f.stats.writes,0);
  }
});
test('grant revocation/rebinding/upsert use strict explicit UID revisions and preserve every other branch',async()=>{
  const f=setup(),admin=f.create(),before=copy(f.store.tenant);const response=await admin.execute(f.request(f.command()));
  assert.deepEqual(response,{ok:true,kind:'setGrant',revision:3});assert.deepEqual(f.store.tenant.products,before.products);assert.deepEqual(f.store.tenant.grants['owner-1'],before.grants['owner-1']);assert.equal(f.store.tenant.grants['worker-user'].profile.active,false);
  const rebound={kind:'setGrant',uid:'worker-user',expectedRevision:3,profile:{active:true,owner:false,workerId:'worker-2',modules:{jahit:true}}};assert.equal((await admin.execute(f.request(rebound))).ok,true);assert.equal(f.store.tenant.grants['worker-user'].profile.workerId,'worker-2');
  const fresh={kind:'setGrant',uid:'new-user',expectedRevision:null,profile:{active:true,owner:false,modules:{qc:true}}};assert.deepEqual(await admin.execute(f.request(fresh)),{ok:true,kind:'setGrant',revision:1});const accepted=copy(f.store.tenant);
  assert.equal((await admin.execute(f.request(fresh))).error,'conflict');assert.equal((await admin.execute(f.request(f.command()))).error,'conflict');assert.deepEqual(f.store.tenant,accepted);assert.equal(f.stats.on,f.stats.off);assert.equal(f.listeners.size,0);
  for(const field of ['worker-1','worker-2','synthetic-token','profile','privateAuthority'])assert.equal(JSON.stringify(response).includes(field),false);
});
test('unknown worker bindings, active sewing without worker and removal of the last active owner are held',async()=>{
  for(const command of [{kind:'setGrant',uid:'worker-user',expectedRevision:2,profile:{active:true,owner:false,workerId:'unmapped-worker',modules:{jahit:true}}},{kind:'setGrant',uid:'worker-user',expectedRevision:2,profile:{active:true,owner:false,modules:{jahit:true}}},{kind:'setGrant',uid:'owner-1',expectedRevision:1,profile:{active:false,owner:false}}]){
    const f=setup(),before=copy(f.store.tenant);assert.equal((await f.create().execute(f.request(command))).error,'not_ready');assert.deepEqual(f.store.tenant,before);assert.equal(f.stats.on,0);assert.equal(f.stats.writes,0);
  }
  const f=setup();f.store.tenant.grants['second-owner']={revision:1,profile:{active:true,owner:true}};assert.equal((await f.create().execute(f.request({kind:'setGrant',uid:'owner-1',expectedRevision:1,profile:{active:false,owner:false}}))).ok,true);assert.equal(f.store.tenant.grants['second-owner'].profile.active,true);
});
test('historical tariff additions append only a new forward whole-IDR version and never touch frozen authority or previous rates',async()=>{
  const f=setup(),before=copy(f.store.tenant),response=await f.create().execute(f.request(tariff()));assert.deepEqual(response,{ok:true,kind:'appendTariff',revision:2});
  const added=f.cycle().tariffInputs;assert.deepEqual(added.historyByWorker['worker-1']['tariff-1'],before.products['product-1'].cycles['cycle-1'].tariffInputs.historyByWorker['worker-1']['tariff-1']);assert.deepEqual(f.cycle().wire,before.products['product-1'].cycles['cycle-1'].wire);assert.deepEqual(f.store.tenant.products['product-2'],before.products['product-2']);assert.deepEqual(f.store.tenant.grants,before.grants);
  assert.deepEqual(added.historyByWorker['worker-1']['tariff-2'],{effectiveAt:LATER,currency:'IDR',rate:200});assert.equal(JSON.stringify(response).includes('200'),false);
  for(const mutate of [c=>c.tariffVersion='tariff-1',c=>c.effectiveAt='2026-01-01T00:00:00.000Z',c=>c.expectedConfigRevision=0,c=>c.expectedTariffRevision=0,c=>c.workerId='worker-2',c=>c.workerId='missing-worker']){
    const f=setup(),command=tariff();mutate(command);const before=copy(f.store.tenant);assert.equal((await f.create().execute(f.request(command))).ok,false);assert.deepEqual(f.store.tenant,before);assert.equal(f.stats.writes,0);
  }
});
test('tariff append reads fresh monotonic server time after warming and internal retry instead of backdating from request time',async()=>{
  for(const phase of ['before','after']){
    let now=NOW;const f=setup({clock:()=>now}),before=copy(f.store.tenant);f.decoded.exp=Date.parse(NOW)/1000+7200;
    f.hooks[phase]=()=>{now='2026-10-05T04:01:00.000Z';};
    assert.equal((await f.create().execute(f.request(tariff()))).error,'conflict');assert.deepEqual(f.store.tenant,before);assert.equal(f.stats.writes,0);assert.equal(f.stats.on,f.stats.off);if(phase==='after')assert.equal(f.stats.auth,2);
  }
  let now=NOW;const backwards=setup({clock:()=>now}),before=copy(backwards.store.tenant);backwards.hooks.before=()=>{now='2026-10-05T02:59:00.000Z';};
  assert.equal((await backwards.create().execute(backwards.request(tariff()))).error,'unavailable');assert.deepEqual(backwards.store.tenant,before);assert.equal(backwards.stats.writes,0);assert.equal(backwards.listeners.size,0);
});
test('config changes retain policy/state and can review only an actual empty new authority cycle',async()=>{
  const f=setup(),before=copy(f.cycle().wire);assert.deepEqual(await f.create().execute(f.request(config())),{ok:true,kind:'setConfig',revision:2});assert.equal(f.cycle().config.active,false);assert.deepEqual(f.cycle().wire,before);
  const empty=setup();empty.cycle().config.reviewedEmptyCycle=false;const review=config();review.config.active=true;assert.equal((await empty.create().execute(empty.request(review))).ok,true);
  const used=setup(),old=Authority.decodeStorage(used.cycle().wire),result=Authority.applyCommand(old,{uid:'owner-1',emailVerified:true,provider:'google.com',profile:{active:true,owner:true},now:NOW},{requestId:'synthetic-sewing',productId:'product-1',cycleId:'cycle-1',expectedRevision:0,kind:'sewing',payload:{id:'sewing-1',assignmentId:'assignment-1',tanggal:'2026-10-05',good:5,reject:0}});
  used.cycle().wire=prune(Authority.encodeStorage(result.state));used.cycle().config.reviewedEmptyCycle=false;const beforeUsed=copy(used.store.tenant);assert.equal((await used.create().execute(used.request(review))).error,'not_ready');assert.deepEqual(used.store.tenant,beforeUsed);assert.equal(used.stats.writes,0);
});
test('actor revoke/rebind/role/config and target changes before callback discard stale administrative authority',async()=>{
  for(const mutate of [f=>{f.store.tenant.grants['owner-1'].profile.active=false;},f=>{f.store.tenant.grants['owner-1'].profile.workerId='worker-2';f.store.tenant.grants['owner-1'].revision++;},f=>{f.store.tenant.grants['owner-1'].profile.owner=false;},f=>{f.store.tenant.grants['worker-user'].revision++;}]){
    const f=setup();f.hooks.before=()=>mutate(f);assert.equal((await f.create().execute(f.request(f.command()))).ok,false);assert.equal(f.stats.writes,0);assert.equal(f.stats.on,f.stats.off);
  }
  for(const mutate of [f=>f.cycle().config.revision++,f=>f.cycle().tariffInputs.revision++]){const f=setup();f.hooks.before=()=>mutate(f);assert.equal((await f.create().execute(f.request(tariff()))).error,'conflict');assert.equal(f.stats.writes,0);}
});
test('internal SDK retry aborts then rechecks Auth/owner/target outside the callback',async()=>{
  for(const mutate of [f=>{f.store.tenant.grants['owner-1'].profile.active=false;},f=>{f.store.tenant.grants['owner-1'].revision++;},f=>{f.store.tenant.grants['worker-user'].revision++;}]){
    const f=setup();f.hooks.after=()=>mutate(f);assert.equal((await f.create().execute(f.request(f.command()))).ok,false);assert.equal(f.stats.auth,2);assert.equal(f.stats.writes,0);assert.equal(f.stats.on,f.stats.off);
  }
  const f=setup();f.hooks.after=()=>{f.options.auth.verifyIdToken=async()=>{f.stats.auth++;throw Error('synthetic-private-revocation');};};const response=await f.create().execute(f.request(f.command()));assert.equal(response.error,'access_denied');assert.equal(f.stats.writes,0);assert.equal(JSON.stringify(response).includes('synthetic-private-revocation'),false);
});
test('unrelated canonical writes survive ancestor CAS retry without stale sibling overwrite',async()=>{
  const f=setup();f.hooks.after=()=>{f.store.tenant.products['product-2'].cycles['cycle-1'].config.revision++;f.store.tenant.grants['sibling-user']={revision:5,profile:{active:true,owner:false,modules:{qc:true}}};};
  assert.equal((await f.create().execute(f.request(f.command()))).ok,true);assert.equal(f.stats.auth,2);assert.equal(f.stats.transactions,2);assert.equal(f.stats.writes,1);assert.equal(f.store.tenant.products['product-2'].cycles['cycle-1'].config.revision,2);assert.equal(f.store.tenant.grants['sibling-user'].revision,5);assert.equal(f.store.tenant.grants['worker-user'].revision,3);
});
test('cold null callbacks retry without bootstrap and an actually missing tenant fails closed',async()=>{
  const f=setup();f.hooks.cold=true;assert.equal((await f.create().execute(f.request(f.command()))).ok,true);assert.equal(f.stats.auth,2);assert.equal(f.stats.writes,1);
  const absent=setup();absent.store.tenant=null;assert.equal((await absent.create().execute(absent.request(absent.command()))).ok,false);assert.equal(absent.stats.writes,0);assert.equal(absent.store.tenant,null);
});
test('only the committed snapshot acknowledges a change; speculative or corrupt results cannot claim success',async()=>{
  const f=setup(),before=copy(f.store.tenant);f.hooks.result=candidate=>({committed:true,snapshot:{val:()=>copy(before)}});assert.equal((await f.create().execute(f.request(f.command()))).error,'unavailable');assert.equal(f.stats.writes,0);assert.equal(f.listeners.size,0);
  const corrupt=setup();corrupt.hooks.result=()=>({committed:true,snapshot:{val(){throw Error('synthetic-private-snapshot');}}});const response=await corrupt.create().execute(corrupt.request(corrupt.command()));assert.equal(response.error,'unavailable');assert.equal(JSON.stringify(response).includes('synthetic-private-snapshot'),false);assert.equal(corrupt.listeners.size,0);
});
test('unknown body money/PIN/actor claims, invalid rates/revisions and getter/prototype inputs never mutate or echo',async()=>{
  for(const mutate of [c=>c.actor={owner:true},c=>c.pin='synthetic-private-pin',c=>c.total=999,c=>c.expectedRevision='2',c=>c.profile.email='synthetic@example.invalid',c=>c.profile.modules={},c=>c.uid='../unsafe']){
    const f=setup(),command=f.command();mutate(command);const response=await f.create().execute(f.request(command));assert.equal(response.error,'invalid_request');assert.equal(f.stats.auth,0);assert.equal(f.stats.writes,0);assert.equal(JSON.stringify(response).includes('synthetic-private-pin'),false);
  }
  for(const mutate of [c=>c.rate=0,c=>c.rate=1.5,c=>c.currency='USD',c=>c.effectiveAt='not-a-date']){const f=setup(),command=tariff();mutate(command);assert.equal((await f.create().execute(f.request(command))).error,'invalid_request');assert.equal(f.stats.writes,0);}
  const f=setup(),command=f.command();let called=0;Object.defineProperty(command,'pin',{enumerable:true,get(){called++;throw Error('synthetic-private-getter');}});assert.equal((await f.create().execute(f.request(command))).error,'invalid_request');assert.equal(called,0);
  const prototype=setup();assert.equal((await prototype.create().execute(Object.assign(Object.create({owner:true}),prototype.request(prototype.command())))).error,'invalid_request');
});
test('source getters, malformed branches, tenant budgets and rate limiting are safe failures',async()=>{
  const f=setup(),raw=copy(f.store.tenant);let called=0;Object.defineProperty(raw.grants['owner-1'].profile,'pin',{enumerable:true,get(){called++;throw Error('synthetic-private-source');}});f.reference.get=async()=>({val:()=>raw});const response=await f.create().execute(f.request(f.command()));assert.equal(response.ok,false);assert.equal(called,0);assert.equal(JSON.stringify(response).includes('synthetic-private-source'),false);
  const small=setup({maxTenantBytes:512});assert.equal((await small.create().execute(small.request(small.command()))).error,'capacity_limit');assert.equal(small.stats.writes,0);
  const rate=setup({admit:async()=>false});assert.equal((await rate.create().execute(rate.request(rate.command()))).error,'rate_limited');assert.equal(rate.stats.reads,0);
  const wrong=setup();wrong.store.tenant.privateFinance={pin:'synthetic-private-pin',money:999};assert.equal((await wrong.create().execute(wrong.request(wrong.command()))).error,'not_ready');assert.equal(wrong.stats.writes,0);
});
test('warm listener rejection and SDK failures always remove their own listener without leaking dependency errors',async()=>{
  for(const which of ['warm','transaction']){
    const f=setup();if(which==='warm')f.reference.on=(event,callback,abort)=>{f.stats.on++;f.listeners.add(callback);abort(Error('synthetic-private-listener'));};else f.reference.transaction=async()=>{throw Error('synthetic-private-transaction');};
    const response=await f.create().execute(f.request(f.command()));assert.equal(response.error,'unavailable');assert.equal(f.listeners.size,0);assert.equal(f.stats.on,f.stats.off);assert.equal(JSON.stringify(response).includes('synthetic-private-'),false);assert.equal(f.stats.writes,0);
  }
});
