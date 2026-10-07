'use strict';
// Genuine Admin SDK / RTDB CAS and browser Rules on synthetic loopback data.
// Google token verification is injected; no real login, credential, production
// data, historical repricing, payment, billing or deployment is exercised.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const PROJECT='demo-soldier-security',HOST='127.0.0.1',PORT=9000,URL='https://'+PROJECT+'.firebaseio.com';
const NOW='2026-10-05T03:00:00.000Z',LATER='2026-10-05T03:30:00.000Z',EFFECTIVE='2026-10-05T04:00:00.000Z',NEXT='2026-10-05T05:00:00.000Z',BEYOND='2026-10-05T06:00:00.000Z',DAY='2026-10-05';
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST,HOST+':'+PORT,'Tariff edit proof requires the isolated loopback emulator');
assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS&&!process.env.FIREBASE_TOKEN,'Tariff edit proof forbids real credential configuration');
assert.ok(Number(process.versions.node.split('.')[0])>=22,'Tariff edit proof requires Node 22 or newer');
const {initializeApp,deleteApp,SDK_VERSION}=require('firebase-admin/app'),{getDatabase}=require('firebase-admin/database');
assert.equal(SDK_VERSION,'14.5.0');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing'),{ref,get,set}=require('firebase/database');
const Authority=require('../server/production-authority.cjs'),Admin=require('../server/production-tenant-admin.cjs'),Runtime=require('../server/production-runtime.cjs');
const copy=v=>JSON.parse(JSON.stringify(v));let sequence=0,env;
before(async()=>{env=await initializeTestEnvironment({projectId:PROJECT,database:{host:HOST,port:PORT,rules:fs.readFileSync(__dirname+'/authority-tenant.rules.json','utf8')}});});
after(async()=>{if(env)await env.cleanup();});
const claims={email_verified:true,firebase:{sign_in_provider:'google.com'}};
function context(now=NOW){return {uid:'owner-1',emailVerified:true,provider:'google.com',profile:{active:true,owner:true},now};}
function command(state,kind,payload,requestId){return {requestId,productId:state.productId,cycleId:state.cycleId,expectedRevision:state.revision,kind,payload};}
function countedState(productId,countQuantity=10){
  const initial=Authority.createAuthority({product:{id:productId,series:'Synthetic',namaBarang:'Example',size:'M',cutQuantity:10},cycleId:'cycle-1',workers:[{id:'worker-1',nama:'Synthetic partner'},{id:'worker-2',nama:'Synthetic unassigned partner'}],assignments:[{id:'assignment-1',workerId:'worker-1',qty:10}],now:NOW});
  const sewn=Authority.applyCommand(initial,context(),command(initial,'sewing',{id:'sewing-1',assignmentId:'assignment-1',tanggal:DAY,good:10,reject:0},'synthetic-sewing')).state;
  const actor=context();actor.selectedTariffs={'count-1':{source:'private-verified-tariff',verified:true,workerId:'worker-1',productId,cycleId:'cycle-1',countId:'count-1',workDate:DAY,basisAt:'2026-10-05T01:00:00.000Z',effectiveAt:'2026-01-01T00:00:00.000Z',tariffVersion:'tariff-old',currency:'IDR',rate:100,selectedAt:NOW}};
  return Authority.applyCommand(sewn,actor,command(sewn,'count',{id:'count-1',assignmentId:'assignment-1',tanggal:DAY,jumlah:countQuantity},'synthetic-count')).state;
}
function product(productId,countQuantity=10){return {cycles:{'cycle-1':{config:{revision:1,active:true,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'},tariffInputs:{revision:1,policy:{version:'policy-1',kind:'jakarta-fixed-local-time',hour:8,minute:0},historyByWorker:{'worker-1':{'tariff-old':{effectiveAt:'2026-01-01T00:00:00.000Z',currency:'IDR',rate:100}}}},wire:Authority.encodeStorage(countedState(productId,countQuantity))}}};}
function seed(tenantId,countQuantity=10){return {schemaVersion:1,projectId:PROJECT,tenantId,grants:{'owner-1':{revision:1,profile:{active:true,owner:true}},'owner-2':{revision:1,profile:{active:true,owner:true}},'partner-user':{revision:1,profile:{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}}},'qc-user':{revision:1,profile:{active:true,owner:false,modules:{qc:true}}}},products:{'product-1':product('product-1',countQuantity),'product-2':product('product-2')}};}
const cycle=root=>root.products['product-1'].cycles['cycle-1'];
const earnings=state=>Object.values(state.projection.earningsByWorker['worker-1'].entries||{});
const spec=(changes={})=>({kind:'appendTariffVersion',requestId:'tariff-request',productId:'product-1',cycleId:'cycle-1',expectedConfigRevision:1,expectedTariffRevision:1,workerId:'worker-1',tariffVersion:'tariff-new',effectiveAt:EFFECTIVE,currency:'IDR',rate:200,...changes});
function inspect(root,now=LATER){const current=cycle(root),state=Authority.decodeStorage(current.wire);current.wire=Authority.encodeStorage(Authority.applyCommand(state,context(now),command(state,'inspect',{batchId:'batch-1',entries:[{id:'qc-1',hfId:'count-1',tanggal:DAY,ok:5,perbaikan:3,reject:1,offline:1}]},'synthetic-inspect')).state);}
function subscription(reference){let listener,timer;const ready=new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(Error('Synthetic cache preparation failed'));};listener=()=>{clearTimeout(timer);resolve();};timer=setTimeout(abort,5000);reference.on('value',listener,abort);});return {ready,close(){clearTimeout(timer);reference.off('value',listener);}};}
async function fixture(t,{countQuantity=10}={}){
  const n=++sequence,tenantId='tariff-edit-proof-'+n,path='authorityTenants/'+tenantId,credential={getAccessToken:async()=>({access_token:'owner',expires_in:3600})};
  const a=initializeApp({projectId:PROJECT,databaseURL:URL,credential},'tariff-edit-a-'+n);let b,da,db,rb;
  t.after(async()=>{try{if(da)da.goOnline();if(rb)await rb.remove();if(db)await db.ref('serverRateLimits/'+tenantId).remove();}finally{await Promise.all([a,b].filter(Boolean).map(app=>Promise.resolve().then(()=>deleteApp(app))));}});
  b=initializeApp({projectId:PROJECT,databaseURL:URL,credential},'tariff-edit-b-'+n);da=getDatabase(a);db=getDatabase(b);rb=db.ref(path);assert.equal(da.ref(path).toString(),'http://'+HOST+':'+PORT+'/'+path);await rb.set(seed(tenantId,countQuantity));
  const stats={auth:0,transactions:0,callbacks:0,on:0,off:0},hooks={interleave:null,loseAcknowledgement:false},actor={uid:'owner-1',rejectToken:false,now:NOW},pending={promise:null,error:false};
  async function mutate(fn){const warm=subscription(rb);try{await warm.ready;const result=await rb.transaction(value=>{assert.ok(value);const next=copy(value);fn(next);return next;},undefined,false);assert.equal(result.committed,true);}finally{warm.close();}}
  const database={app:da.app,ref(fixed){assert.equal(fixed,path);const real=da.ref(fixed);return {toString:()=>real.toString(),get:()=>real.get(),on(...args){stats.on++;return real.on(...args);},off(...args){stats.off++;return real.off(...args);},async transaction(update,complete,local){
    stats.transactions++;const result=await real.transaction(value=>{stats.callbacks++;const candidate=update(value);if(candidate!==undefined&&hooks.interleave){const fn=hooks.interleave;hooks.interleave=null;da.goOffline();pending.promise=Promise.resolve().then(()=>fn()).catch(()=>{pending.error=true;}).finally(()=>da.goOnline());}return candidate;},complete,local);
    if(result.committed&&hooks.loseAcknowledgement){hooks.loseAcknowledgement=false;throw Error('Synthetic acknowledgement loss after genuine commit');}return result;
  }};}};
  const auth={async verifyIdToken(token,checkRevoked){assert.equal(checkRevoked,true);stats.auth++;if(actor.rejectToken)throw Error('Synthetic token rejection');return {uid:actor.uid,sub:actor.uid,aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,email_verified:true,firebase:{sign_in_provider:'google.com'},exp:Date.parse(actor.now)/1000+3600,owner:true};}};
  const options={enabled:true,projectId:PROJECT,tenantId,databaseURL:URL,auth,admit:async()=>true,clock:()=>actor.now,testOnlyEmulator:{host:HOST,port:PORT}};
  const admin=Admin.createProductionTenantAdmin({...options,database}),other=Admin.createProductionTenantAdmin({...options,database:db});
  const origin='https://soldier.example.invalid',runtime=Runtime.createProductionRuntime({...options,database:db,auth:{...auth,app:b},allowedOrigins:[origin],policy:{rateWindowMs:60000,rateLimit:20,deadlineMs:10000,maxInFlight:4}});
  async function execute(command){const response=await admin.execute({idToken:'synthetic-token',command});if(pending.promise)await pending.promise;assert.equal(pending.error,false,'Independent canonical writer must commit while first SDK is paused');return response;}
  async function runProduction(command){const raw=Buffer.from(JSON.stringify({command})),headers={origin,authorization:'Bearer header.payload.signature','content-type':'application/json','content-length':String(raw.length)},request={method:'POST',url:'/v1/production/commands',headers,rawHeaders:Object.entries(headers).flat(),rawBody:raw},response={headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=JSON.parse(body);this.writableEnded=true;}};await runtime.handler(request,response);return response;}
  return {tenantId,path,actor,stats,hooks,mutate,execute,runProduction,executeOther:command=>other.execute({idToken:'synthetic-token',command}),state:async()=>(await rb.get()).val()};
}

test('genuine future tariff append creates one private receipt and survives RTDB pruning without repricing',{timeout:30000},async t=>{
  const f=await fixture(t),before=await f.state(),command=spec(),result=await f.execute(command),after=await f.state();
  assert.deepEqual(result,{ok:true,receipt:{requestId:command.requestId,kind:'appendTariffVersion',productId:'product-1',cycleId:'cycle-1',workerId:'worker-1',tariffVersion:'tariff-new',revision:2,acceptedAt:NOW},replayed:false});
  assert.equal(Object.keys(after.tariffCommandLedger.entries).length,1);assert.equal(cycle(after).tariffInputs.revision,2);assert.deepEqual(cycle(after).tariffInputs.historyByWorker['worker-1']['tariff-new'],{effectiveAt:EFFECTIVE,currency:'IDR',rate:200});
  assert.deepEqual(cycle(after).wire,cycle(before).wire);assert.deepEqual(cycle(after).config,cycle(before).config);assert.deepEqual(after.products['product-2'],before.products['product-2']);assert.deepEqual(after.grants,before.grants);
  const historical=Authority.decodeStorage(cycle(after).wire);assert.equal(historical.frozenPayroll['count-1'].rate,100);assert.deepEqual(historical.frozenPayroll,Authority.decodeStorage(cycle(before).wire).frozenPayroll);assert.equal(earnings(historical).reduce((total,row)=>total+row.total,0),1000);assert.ok(earnings(historical).every(row=>row.tarif===100&&row.provisional===true));assert.equal(Object.hasOwn(cycle(after).wire.projection.earningsByWorker['worker-2'],'entries'),false);assert.equal(f.stats.on,f.stats.off);
  const transactions=f.stats.transactions,replay=await f.execute(command);assert.deepEqual(replay,{...result,replayed:true});assert.equal(f.stats.transactions,transactions);assert.deepEqual(await f.state(),after);
  for(const field of ['rate','commandJson','synthetic-token','profile','privateAuthority'])assert.equal(JSON.stringify(result).includes(field),false);
});

test('lost acknowledgement replays its original durable receipt after later production, config, tariff and time changes',{timeout:30000},async t=>{
  const f=await fixture(t),command=spec();f.hooks.loseAcknowledgement=true;assert.equal((await f.execute(command)).error,'unavailable');
  const committed=await f.state(),original=Object.values(committed.tariffCommandLedger.entries)[0].receipt;assert.equal(Object.keys(committed.tariffCommandLedger.entries).length,1);
  f.actor.now=LATER;await f.mutate(root=>inspect(root));assert.equal((await f.execute({kind:'setConfig',productId:'product-1',cycleId:'cycle-1',expectedRevision:1,config:{active:false,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'}})).ok,true);
  assert.equal((await f.execute(spec({requestId:'second-tariff-request',tariffVersion:'tariff-next',effectiveAt:NEXT,expectedConfigRevision:2,expectedTariffRevision:2,rate:300}))).ok,true);
  const beforeReplay=await f.state(),historical=Authority.decodeStorage(cycle(beforeReplay).wire);assert.equal(historical.revision,3);assert.equal(historical.frozenPayroll['count-1'].rate,100);assert.equal(earnings(historical).reduce((total,row)=>total+row.total,0),500);assert.ok(earnings(historical).every(row=>row.tarif===100&&row.provisional===false));
  f.actor.now=BEYOND;const transactions=f.stats.transactions,replay=await f.execute(command);assert.deepEqual(replay,{ok:true,receipt:original,replayed:true});assert.equal(f.stats.transactions,transactions);assert.deepEqual(await f.state(),beforeReplay);assert.equal(Object.keys(beforeReplay.tariffCommandLedger.entries).length,2);assert.equal(f.stats.on,f.stats.off);
});

test('actual assembled production runtime selects an edited rate for future work and retains the old frozen count',{timeout:30000},async t=>{
  const f=await fixture(t,{countQuantity:5}),before=Authority.decodeStorage(cycle(await f.state()).wire);assert.equal(before.frozenPayroll['count-1'].rate,100);assert.equal((await f.execute(spec())).ok,true);
  f.actor.now='2026-10-06T03:00:00.000Z';const request={requestId:'future-count-request',productId:'product-1',cycleId:'cycle-1',expectedRevision:2,kind:'count',payload:{id:'count-new',assignmentId:'assignment-1',tanggal:'2026-10-06',jumlah:5}},response=await f.runProduction(request);assert.equal(response.statusCode,200);assert.equal(response.body.ok,true);
  const root=await f.state(),state=Authority.decodeStorage(cycle(root).wire);assert.equal(state.revision,3);assert.equal(state.frozenPayroll['count-new'].rate,200);assert.equal(state.frozenPayroll['count-new'].tariffVersion,'tariff-new');assert.deepEqual(state.frozenPayroll['count-1'],before.frozenPayroll['count-1']);assert.deepEqual(state.snapshots.v0000000002,before.snapshots.v0000000002);assert.equal(earnings(state).reduce((total,row)=>total+row.total,0),1500);assert.deepEqual(earnings(state).map(row=>row.tarif).sort((a,b)=>a-b),[100,200]);assert.equal(Object.keys(root.tariffCommandLedger.entries).length,1);
  for(const field of ['rate','tariffInputs','privateAuthority','synthetic-token'])assert.equal(JSON.stringify(response.body).includes(field),false,'The command receipt must not expose private rate inputs');
});

test('accepted tariff receipt rejects changed payload, another request for its version and non-owner replay',{timeout:30000},async t=>{
  const f=await fixture(t),command=spec();assert.equal((await f.execute(command)).ok,true);const before=await f.state();
  assert.equal((await f.execute({...command,rate:999})).error,'conflict');assert.equal((await f.execute({...command,requestId:'new-request',expectedTariffRevision:2})).error,'conflict');
  f.actor.uid='partner-user';assert.equal((await f.execute(command)).error,'access_denied');f.actor.uid='owner-2';assert.equal((await f.execute(command)).error,'conflict');
  assert.deepEqual(await f.state(),before);assert.equal(Object.keys(before.tariffCommandLedger.entries).length,1);
});

test('revoked owner or rejected Google token cannot replay an accepted tariff receipt',{timeout:30000},async t=>{
  const f=await fixture(t),command=spec();assert.equal((await f.execute(command)).ok,true);await f.mutate(root=>{root.grants['owner-1'].profile.active=false;root.grants['owner-1'].revision++;});
  const before=await f.state(),transactions=f.stats.transactions;assert.equal((await f.execute(command)).error,'access_denied');assert.equal(f.stats.transactions,transactions);assert.deepEqual(await f.state(),before);
  f.actor.uid='owner-2';f.actor.rejectToken=true;assert.equal((await f.execute(spec({requestId:'other-request',tariffVersion:'tariff-other',expectedTariffRevision:2,effectiveAt:NEXT}))).error,'access_denied');assert.deepEqual(await f.state(),before);
});

test('actual ancestor CAS rejects a speculative tariff after owner revocation',{timeout:30000},async t=>{
  const f=await fixture(t),before=await f.state();f.hooks.interleave=()=>f.mutate(root=>{root.grants['owner-1'].profile.active=false;root.grants['owner-1'].revision++;});
  assert.equal((await f.execute(spec())).error,'access_denied');const after=await f.state();assert.ok(f.stats.callbacks>=2);assert.equal(f.stats.auth,2);assert.equal(Object.hasOwn(after,'tariffCommandLedger'),false);assert.deepEqual(after.products,before.products);assert.equal(f.stats.on,f.stats.off);
});

test('two genuine writers cannot both accept different tariff versions from one expected revision',{timeout:30000},async t=>{
  const f=await fixture(t);let winner;f.hooks.interleave=async()=>{winner=await f.executeOther(spec({requestId:'winner-request',tariffVersion:'tariff-winner',rate:150}));assert.equal(winner.ok,true);};
  assert.equal((await f.execute(spec())).error,'conflict');const after=await f.state();assert.ok(f.stats.callbacks>=2);assert.equal(Object.keys(after.tariffCommandLedger.entries).length,1);assert.equal(cycle(after).tariffInputs.revision,2);assert.equal(Object.hasOwn(cycle(after).tariffInputs.historyByWorker['worker-1'],'tariff-new'),false);assert.equal(cycle(after).tariffInputs.historyByWorker['worker-1']['tariff-winner'].rate,150);assert.equal(f.stats.on,f.stats.off);
});

test('concurrent identical tariff returns the winning receipt after fresh Auth without a second transaction',{timeout:30000},async t=>{
  const f=await fixture(t),command=spec();let winner,transactionsAtWinner;f.hooks.interleave=async()=>{transactionsAtWinner=f.stats.transactions;winner=await f.executeOther(command);assert.equal(winner.ok,true);assert.equal(winner.replayed,false);};
  const replay=await f.execute(command),after=await f.state();assert.equal(replay.ok,true);assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,winner.receipt);assert.ok(f.stats.auth>=2);assert.ok(f.stats.callbacks>=2);assert.equal(f.stats.transactions,transactionsAtWinner);assert.equal(Object.keys(after.tariffCommandLedger.entries).length,1);assert.equal(cycle(after).tariffInputs.revision,2);assert.equal(f.stats.on,f.stats.off);
});

test('concurrent later production is preserved by tariff retry with frozen wages retained',{timeout:30000},async t=>{
  const f=await fixture(t),before=await f.state();f.hooks.interleave=()=>f.mutate(root=>inspect(root,NOW));
  const result=await f.execute(spec()),after=await f.state();assert.equal(result.ok,true);assert.equal(result.replayed,false);assert.ok(f.stats.callbacks>=2);assert.ok(f.stats.auth>=2);const state=Authority.decodeStorage(cycle(after).wire);assert.equal(state.revision,3);assert.equal(state.inspections['qc-1'].initial.ok,5);assert.deepEqual(state.frozenPayroll,Authority.decodeStorage(cycle(before).wire).frozenPayroll);assert.equal(Object.keys(after.tariffCommandLedger.entries).length,1);assert.deepEqual(after.products['product-2'],before.products['product-2']);assert.equal(f.stats.on,f.stats.off);
});

test('browser Rules deny private tariff command and receipt leaves while preserving own wage access',{timeout:30000},async t=>{
  const f=await fixture(t);assert.equal((await f.execute(spec())).ok,true);const stored=await f.state(),entry=Object.keys(stored.tariffCommandLedger.entries)[0],ledger=f.path+'/tariffCommandLedger',entryPath=ledger+'/entries/'+entry;assert.ok(entry);
  for(const uid of ['owner-1','partner-user','qc-user']){
    const db=env.authenticatedContext(uid,claims).database();for(const path of [f.path,ledger,ledger+'/entries',entryPath,entryPath+'/commandJson',entryPath+'/receipt',entryPath+'/receipt/acceptedAt'])await assertFails(get(ref(db,path)));
    for(const path of [ledger,entryPath+'/commandJson',entryPath+'/receipt/acceptedAt'])await assertFails(set(ref(db,path),'forged'));
    const operations=await assertSucceeds(get(ref(db,f.path+'/products/product-1/cycles/cycle-1/wire/projection/operations')));assert.equal(operations.val().id,'product-1');
    const wage=ref(db,f.path+'/products/product-1/cycles/cycle-1/wire/projection/earningsByWorker/worker-1');if(uid==='qc-user')await assertFails(get(wage));else assert.equal((await assertSucceeds(get(wage))).val().workerId,'worker-1');
  }
  assert.deepEqual(await f.state(),stored,'Denied browser writes must not change private tariff history or receipts');
});
