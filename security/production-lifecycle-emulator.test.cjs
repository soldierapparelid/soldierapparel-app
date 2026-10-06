'use strict';
// Genuine Firebase Admin SDK transactions, RTDB pruning and browser Rules with
// synthetic loopback data. Auth verification is injected: no real Google sign
// in, revocation, credential, deployment, legacy import or financial evidence.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const PROJECT='demo-soldier-security',HOST='127.0.0.1',PORT=9000,URL='https://'+PROJECT+'.firebaseio.com',NOW='2026-10-05T03:00:00.000Z',DAY='2026-10-05';
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST,HOST+':'+PORT,'Lifecycle proof requires the isolated loopback emulator');
assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS&&!process.env.FIREBASE_TOKEN,'Lifecycle proof forbids real credential configuration');
assert.ok(Number(process.versions.node.split('.')[0])>=22,'Lifecycle proof requires Node 22 or newer');
const {initializeApp,deleteApp,SDK_VERSION}=require('firebase-admin/app'),{getDatabase}=require('firebase-admin/database');
assert.equal(SDK_VERSION,'14.5.0');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {ref,get,set}=require('firebase/database');
const Authority=require('../server/production-authority.cjs'),Admin=require('../server/production-tenant-admin.cjs');
const copy=v=>JSON.parse(JSON.stringify(v));let sequence=0,env;
before(async()=>{env=await initializeTestEnvironment({projectId:PROJECT,database:{host:HOST,port:PORT,rules:fs.readFileSync(__dirname+'/authority-tenant.rules.json','utf8')}});});
after(async()=>{if(env)await env.cleanup();});
const claims={email_verified:true,firebase:{sign_in_provider:'google.com'}};
function spec(productId='product-new',cycleId='cycle-new',requestId='create-request'){
  return {kind:'createCycle',requestId,product:{id:productId,series:'Synthetic',namaBarang:'Example',size:'M',cutQuantity:10},cycleId,workers:[{id:'worker-1',nama:'Synthetic partner'}],assignments:[{id:'assignment-new',workerId:'worker-1',qty:10}],tariffPolicy:{version:'policy-new',kind:'jakarta-fixed-local-time',hour:8,minute:0},initialTariffs:[{workerId:'worker-1',tariffVersion:'tariff-new',effectiveAt:'2026-01-01T00:00:00.000Z',currency:'IDR',rate:100}]};
}
function oldProduct(){
  const state=Authority.createAuthority({product:{id:'product-old',series:'Synthetic old',namaBarang:'Example old',size:'L',cutQuantity:2},cycleId:'cycle-old',workers:[{id:'worker-1',nama:'Synthetic partner'}],assignments:[{id:'assignment-old',workerId:'worker-1',qty:2}],now:NOW});
  return {cycles:{'cycle-old':{config:{revision:1,active:true,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'},tariffInputs:{revision:1,policy:{version:'policy-old',kind:'jakarta-fixed-local-time',hour:8,minute:0},historyByWorker:{'worker-1':{'tariff-old':{effectiveAt:'2026-01-01T00:00:00.000Z',currency:'IDR',rate:50}}}},wire:Authority.encodeStorage(state)}}};
}
function seed(tenantId){return {schemaVersion:1,projectId:PROJECT,tenantId,grants:{'owner-1':{revision:1,profile:{active:true,owner:true}},'owner-2':{revision:1,profile:{active:true,owner:true}},'partner-user':{revision:1,profile:{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}}},'qc-user':{revision:1,profile:{active:true,owner:false,modules:{qc:true}}}},products:{'product-old':oldProduct()}};}
function subscription(reference){let listener,timer;const ready=new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(Error('Synthetic cache preparation failed'));};listener=()=>{clearTimeout(timer);resolve();};timer=setTimeout(abort,5000);reference.on('value',listener,abort);});return {ready,close(){clearTimeout(timer);reference.off('value',listener);}};}
async function fixture(t){
  const n=++sequence,tenantId='lifecycle-proof-'+n,path='authorityTenants/'+tenantId,credential={getAccessToken:async()=>({access_token:'owner',expires_in:3600})};
  const a=initializeApp({projectId:PROJECT,databaseURL:URL,credential},'lifecycle-a-'+n);let b,da,db,rb;
  t.after(async()=>{try{if(da)da.goOnline();if(rb)await rb.remove();}finally{await Promise.all([a,b].filter(Boolean).map(app=>Promise.resolve().then(()=>deleteApp(app))));}});
  b=initializeApp({projectId:PROJECT,databaseURL:URL,credential},'lifecycle-b-'+n);da=getDatabase(a);db=getDatabase(b);rb=db.ref(path);assert.equal(da.ref(path).toString(),'http://'+HOST+':'+PORT+'/'+path);await rb.set(seed(tenantId));
  const stats={auth:0,transactions:0,callbacks:0,on:0,off:0},hooks={interleave:null,loseAcknowledgement:false},actor={uid:'owner-1',rejectToken:false},pending={promise:null,error:false};
  async function mutate(fn){const warm=subscription(rb);try{await warm.ready;const result=await rb.transaction(value=>{assert.ok(value);const next=copy(value);fn(next);return next;},undefined,false);assert.equal(result.committed,true);}finally{warm.close();}}
  const database={app:da.app,ref(fixed){assert.equal(fixed,path);const real=da.ref(fixed);return {toString:()=>real.toString(),get:()=>real.get(),on(...args){stats.on++;return real.on(...args);},off(...args){stats.off++;return real.off(...args);},async transaction(update,complete,local){
    stats.transactions++;const result=await real.transaction(value=>{stats.callbacks++;const candidate=update(value);if(candidate!==undefined&&hooks.interleave){const fn=hooks.interleave;hooks.interleave=null;da.goOffline();pending.promise=Promise.resolve().then(()=>fn()).catch(()=>{pending.error=true;}).finally(()=>da.goOnline());}return candidate;},complete,local);
    if(result.committed&&hooks.loseAcknowledgement){hooks.loseAcknowledgement=false;throw Error('Synthetic acknowledgement loss after genuine commit');}return result;
  }};}};
  const auth={async verifyIdToken(token,checkRevoked){assert.equal(checkRevoked,true);stats.auth++;if(actor.rejectToken)throw Error('Synthetic token rejection');return {uid:actor.uid,sub:actor.uid,aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,email_verified:true,firebase:{sign_in_provider:'google.com'},exp:Date.parse(NOW)/1000+3600,owner:true};}};
  const options={enabled:true,projectId:PROJECT,tenantId,databaseURL:URL,auth,admit:async()=>true,clock:()=>NOW,testOnlyEmulator:{host:HOST,port:PORT}};
  const admin=Admin.createProductionTenantAdmin({...options,database}),other=Admin.createProductionTenantAdmin({...options,database:db});
  async function execute(command){const response=await admin.execute({idToken:'synthetic-token',command});if(pending.promise)await pending.promise;assert.equal(pending.error,false,'Independent canonical writer must commit while first SDK is paused');return response;}
  return {tenantId,path,actor,stats,hooks,mutate,execute,executeOther:command=>other.execute({idToken:'synthetic-token',command}),state:async()=>(await rb.get()).val()};
}
const current=root=>root.products['product-new'].cycles['cycle-new'];

test('genuine empty cycle creation survives RTDB pruning with one private receipt and unchanged siblings',{timeout:30000},async t=>{
  const f=await fixture(t),before=await f.state(),command=spec(),result=await f.execute(command),after=await f.state();
  assert.equal(result.ok,true);assert.equal(result.replayed,false);assert.deepEqual(result.receipt,{requestId:command.requestId,kind:'createCycle',productId:command.product.id,cycleId:command.cycleId,revision:0,acceptedAt:NOW});
  assert.deepEqual(after.products['product-old'],before.products['product-old']);assert.deepEqual(after.grants,before.grants);assert.equal(Object.keys(after.ownerCommandLedger.entries).length,1);
  const stored=current(after),decoded=Authority.decodeStorage(stored.wire);assert.equal(stored.config.active,false);assert.equal(stored.config.reviewedEmptyCycle,false);assert.equal(stored.config.revision,1);assert.equal(stored.tariffInputs.revision,1);assert.equal(decoded.revision,0);assert.equal(Object.keys(decoded.snapshots).length,1);assert.deepEqual(decoded.sewing,{});assert.deepEqual(decoded.counts,{});
  assert.equal(decoded.assignments['assignment-new'].qty,10);assert.equal(stored.tariffInputs.historyByWorker['worker-1']['tariff-new'].rate,100);assert.equal(Object.hasOwn(stored.wire.projection.earningsByWorker['worker-1'],'entries'),false,'RTDB must prune the public empty map while private state remains exact');
  for(const field of ['privateAuthority','rate','worker-1','synthetic-token','commandJson'])assert.equal(JSON.stringify(result).includes(field),false);assert.equal(f.stats.on,f.stats.off);
});
test('lost genuine commit acknowledgement replays the same receipt after config and production revision advance',{timeout:30000},async t=>{
  const f=await fixture(t),command=spec();f.hooks.loseAcknowledgement=true;const unknown=await f.execute(command);assert.equal(unknown.ok,false);assert.equal(unknown.error,'unavailable');
  const accepted=await f.state();assert.equal(Object.keys(accepted.ownerCommandLedger.entries).length,1);assert.equal(Authority.decodeStorage(current(accepted).wire).revision,0);
  assert.equal((await f.execute({kind:'setConfig',productId:'product-new',cycleId:'cycle-new',expectedRevision:1,config:{active:true,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'}})).ok,true);
  await f.mutate(root=>{const c=current(root),state=Authority.decodeStorage(c.wire);c.wire=Authority.encodeStorage(Authority.applyCommand(state,{uid:'owner-1',emailVerified:true,provider:'google.com',profile:{active:true,owner:true},now:NOW},{requestId:'sewing-after-create',productId:'product-new',cycleId:'cycle-new',expectedRevision:0,kind:'sewing',payload:{id:'sewing-new',assignmentId:'assignment-new',tanggal:DAY,good:10,reject:0}}).state);});
  const progressed=await f.state(),transactions=f.stats.transactions,replay=await f.execute(command);assert.equal(replay.ok,true);assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,{requestId:command.requestId,kind:'createCycle',productId:'product-new',cycleId:'cycle-new',revision:0,acceptedAt:NOW});assert.deepEqual(await f.state(),progressed);assert.equal(f.stats.transactions,transactions,'Replay must not write or restore a revision-zero seed');assert.equal(f.stats.on,f.stats.off);
});
test('an existing cycle cannot be reset or reused and conflicting request payloads cannot overwrite the original ledger',{timeout:30000},async t=>{
  const f=await fixture(t),command=spec();assert.equal((await f.execute(command)).ok,true);const before=await f.state();
  const changed=copy(command);changed.initialTariffs[0].rate=200;assert.equal((await f.execute(changed)).error,'conflict');
  const reused=copy(command);reused.requestId='different-request';assert.equal((await f.execute(reused)).error,'conflict');assert.deepEqual(await f.state(),before);
  const another=spec('product-new','cycle-distinct','distinct-request');assert.equal((await f.execute(another)).ok,true);const after=await f.state();assert.deepEqual(current(after),current(before));assert.equal(Object.keys(after.ownerCommandLedger.entries).length,2);assert.equal(Object.keys(after.products['product-new'].cycles).length,2);
});
test('a current owner grant is required even for a durable replay and injected owner claims confer no access',{timeout:30000},async t=>{
  const f=await fixture(t),command=spec();f.actor.uid='partner-user';let before=await f.state();assert.equal((await f.execute(command)).error,'access_denied');assert.deepEqual(await f.state(),before);assert.equal(f.stats.transactions,0);
  f.actor.uid='owner-1';assert.equal((await f.execute(command)).ok,true);await f.mutate(root=>{root.grants['owner-1'].profile.active=false;root.grants['owner-1'].revision++;});before=await f.state();const transactions=f.stats.transactions;assert.equal((await f.execute(command)).error,'access_denied');assert.deepEqual(await f.state(),before);assert.equal(f.stats.transactions,transactions);
  f.actor.uid='owner-2';f.actor.rejectToken=true;assert.equal((await f.execute(spec('product-other','cycle-other','other-request'))).error,'access_denied');assert.deepEqual(await f.state(),before);
});
test('actual ancestor CAS rejects a speculative seed after owner grant revocation',{timeout:30000},async t=>{
  const f=await fixture(t),before=await f.state();f.hooks.interleave=()=>f.mutate(root=>{root.grants['owner-1'].profile.active=false;root.grants['owner-1'].revision++;});
  const result=await f.execute(spec()),after=await f.state();assert.equal(result.error,'access_denied');assert.ok(f.stats.callbacks>=2);assert.equal(f.stats.auth,2);assert.equal(Object.hasOwn(after.products,'product-new'),false);assert.equal(Object.hasOwn(after,'ownerCommandLedger'),false);assert.deepEqual(after.products,before.products);assert.equal(f.stats.on,f.stats.off);
});
test('two real SDK writers racing for one absent cycle cannot both create it',{timeout:30000},async t=>{
  const f=await fixture(t);let winning;f.hooks.interleave=async()=>{winning=await f.executeOther(spec('product-new','cycle-new','winning-request'));assert.equal(winning.ok,true);};
  const losing=await f.execute(spec()),after=await f.state();assert.equal(losing.error,'conflict');assert.ok(f.stats.callbacks>=2);assert.equal(Object.keys(after.ownerCommandLedger.entries).length,1);assert.equal(Object.keys(after.products['product-new'].cycles).length,1);assert.equal(Authority.decodeStorage(current(after).wire).revision,0);assert.equal(f.stats.on,f.stats.off);
});
test('actual unrelated cycle creation survives retry without losing either private receipt or old product',{timeout:30000},async t=>{
  const f=await fixture(t),before=await f.state();f.hooks.interleave=async()=>{assert.equal((await f.executeOther(spec('product-sibling','cycle-sibling','sibling-request'))).ok,true);};
  const result=await f.execute(spec()),after=await f.state();assert.equal(result.ok,true);assert.equal(result.replayed,false);assert.ok(f.stats.callbacks>=2);assert.ok(f.stats.auth>=2);assert.equal(Object.keys(after.ownerCommandLedger.entries).length,2);assert.deepEqual(after.products['product-old'],before.products['product-old']);assert.equal(Authority.decodeStorage(current(after).wire).revision,0);assert.equal(after.products['product-sibling'].cycles['cycle-sibling'].wire.revision,0);assert.equal(f.stats.on,f.stats.off);
});
test('concurrent identical creation returns the winning durable receipt after fresh Auth without a second write',{timeout:30000},async t=>{
  const f=await fixture(t),command=spec();let winning,transactionsAtWinner;f.hooks.interleave=async()=>{transactionsAtWinner=f.stats.transactions;winning=await f.executeOther(command);assert.equal(winning.ok,true);assert.equal(winning.replayed,false);};
  const replay=await f.execute(command),after=await f.state();assert.equal(replay.ok,true);assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,winning.receipt);assert.ok(f.stats.auth>=2);assert.ok(f.stats.callbacks>=2);assert.equal(f.stats.transactions,transactionsAtWinner,'After the stale speculative transaction aborts, read-only replay must not issue another transaction');assert.equal(Object.keys(after.ownerCommandLedger.entries).length,1);assert.equal(Authority.decodeStorage(current(after).wire).revision,0);assert.equal(f.stats.on,f.stats.off);
});
test('browser Rules deny the private owner ledger, command and receipt leaves, ancestors and all forged writes',{timeout:30000},async t=>{
  const f=await fixture(t);assert.equal((await f.execute(spec())).ok,true);const stored=await f.state(),entry=Object.keys(stored.ownerCommandLedger.entries)[0],ledger=f.path+'/ownerCommandLedger',entryPath=ledger+'/entries/'+entry;assert.ok(entry);
  for(const uid of ['owner-1','partner-user','qc-user']){
    const db=env.authenticatedContext(uid,claims).database();for(const path of [f.path,ledger,ledger+'/entries',entryPath,entryPath+'/commandJson',entryPath+'/receipt',entryPath+'/receipt/acceptedAt'])await assertFails(get(ref(db,path)));
    for(const path of [ledger,entryPath+'/commandJson',entryPath+'/receipt/acceptedAt'])await assertFails(set(ref(db,path),'forged'));
    const operations=await assertSucceeds(get(ref(db,f.path+'/products/product-old/cycles/cycle-old/wire/projection/operations')));assert.equal(operations.val().id,'product-old');
  }
  assert.deepEqual(await f.state(),stored,'Denied browser writes must not change the private ledger');
});
