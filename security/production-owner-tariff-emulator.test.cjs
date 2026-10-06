'use strict';
// Genuine Admin SDK / RTDB owner-route proof on synthetic loopback data only.
// Token verification remains injected: this does not exercise real Google
// login, real business amounts, production credentials, billing or deployment.
const {test}=require('node:test'),assert=require('node:assert/strict');
const PROJECT='demo-soldier-security',HOST='127.0.0.1',PORT=9000,URL='https://'+PROJECT+'.firebaseio.com';
const NOW='2026-10-05T03:00:00.000Z',EFFECTIVE='2026-10-05T04:00:00.000Z',LATER='2026-10-05T06:00:00.000Z',ORIGIN='https://soldier.example.invalid',TOKEN='header.payload.signature';
const VIEW='/v1/production/owner/tariffs/view',APPEND='/v1/production/owner/tariffs/append';
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST,HOST+':'+PORT,'Owner-route proof requires the isolated loopback emulator');
assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS&&!process.env.FIREBASE_TOKEN,'Owner-route proof forbids real credential configuration');
assert.ok(Number(process.versions.node.split('.')[0])>=22,'Owner-route proof requires Node 22 or newer');
const {initializeApp,deleteApp,SDK_VERSION}=require('firebase-admin/app'),{getDatabase}=require('firebase-admin/database');
assert.equal(SDK_VERSION,'14.5.0');
const Authority=require('../server/production-authority.cjs'),Runtime=require('../server/production-runtime.cjs'),Session=require('../server/production-session-service.cjs');
const copy=v=>JSON.parse(JSON.stringify(v));let sequence=0;
const actorContext=()=>({uid:'owner-1',emailVerified:true,provider:'google.com',profile:{active:true,owner:true},now:NOW});
function countedState(productId){
  let state=Authority.createAuthority({product:{id:productId,series:'Synthetic',namaBarang:'Example garment',size:'M',cutQuantity:10},cycleId:'cycle-1',workers:[{id:'worker-1',nama:'Synthetic assigned partner'},{id:'worker-2',nama:'Synthetic unassigned private name'}],assignments:[{id:'assignment-1',workerId:'worker-1',qty:10}],now:NOW});
  const command=(kind,payload,requestId)=>({requestId,productId,cycleId:'cycle-1',expectedRevision:state.revision,kind,payload});
  state=Authority.applyCommand(state,actorContext(),command('sewing',{id:'sewing-1',assignmentId:'assignment-1',tanggal:'2026-10-05',good:10,reject:0},'synthetic-sewing')).state;
  const context=actorContext();context.selectedTariffs={'count-1':{source:'private-verified-tariff',verified:true,workerId:'worker-1',productId,cycleId:'cycle-1',countId:'count-1',workDate:'2026-10-05',basisAt:'2026-10-05T01:00:00.000Z',effectiveAt:'2026-01-01T00:00:00.000Z',tariffVersion:'tariff-old',currency:'IDR',rate:100,selectedAt:NOW}};
  return Authority.applyCommand(state,context,command('count',{id:'count-1',assignmentId:'assignment-1',tanggal:'2026-10-05',jumlah:10},'synthetic-count')).state;
}
function product(productId){return {cycles:{'cycle-1':{config:{revision:1,active:true,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'},tariffInputs:{revision:1,policy:{version:'policy-1',kind:'jakarta-fixed-local-time',hour:8,minute:0},historyByWorker:{'worker-1':{'tariff-old':{effectiveAt:'2026-01-01T00:00:00.000Z',currency:'IDR',rate:100}}}},wire:Authority.encodeStorage(countedState(productId))}}};}
function seed(tenantId){return {schemaVersion:1,projectId:PROJECT,tenantId,grants:{'owner-1':{revision:7,profile:{active:true,owner:true}},'owner-2':{revision:9,profile:{active:true,owner:true}},'partner-user':{revision:1,profile:{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}}},'qc-user':{revision:1,profile:{active:true,owner:false,modules:{qc:true}}}},products:{'product-1':product('product-1'),'product-2':product('product-2')}};}
const selected=root=>root.products['product-1'].cycles['cycle-1'];
const command=(changes={})=>({kind:'appendTariffVersion',requestId:'tariff-request',productId:'product-1',cycleId:'cycle-1',expectedConfigRevision:1,expectedTariffRevision:1,workerId:'worker-1',tariffVersion:'tariff-new',effectiveAt:EFFECTIVE,currency:'IDR',rate:200,...changes});
function subscription(reference){let listener,timer;const ready=new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(Error('Synthetic cache preparation failed'));};listener=()=>{clearTimeout(timer);resolve();};timer=setTimeout(abort,5000);reference.on('value',listener,abort);});return {ready,close(){clearTimeout(timer);reference.off('value',listener);}};}
async function fixture(t,{limit=30,empty=false}={}){
  const n=++sequence,tenantId='owner-tariff-proof-'+n,path='authorityTenants/'+tenantId,credential={getAccessToken:async()=>({access_token:'owner',expires_in:3600})};
  const a=initializeApp({projectId:PROJECT,databaseURL:URL,credential},'owner-tariff-a-'+n);let b,da,db,tenantRef,quotaRef;
  t.after(async()=>{try{if(da)da.goOnline();if(tenantRef)await tenantRef.remove();if(quotaRef)await quotaRef.remove();}finally{await Promise.all([a,b].filter(Boolean).map(app=>Promise.resolve().then(()=>deleteApp(app))));}});
  b=initializeApp({projectId:PROJECT,databaseURL:URL,credential},'owner-tariff-b-'+n);da=getDatabase(a);db=getDatabase(b);tenantRef=db.ref(path);quotaRef=db.ref('serverRateLimits/'+tenantId);
  assert.equal(da.ref(path).toString(),'http://'+HOST+':'+PORT+'/'+path);if(!empty)await tenantRef.set(seed(tenantId));
  const actor={uid:'owner-1',now:NOW,rejectToken:false,provider:'google.com'},stats={auth:0,tenantReads:0,tenantTransactions:0,callbacks:0,on:0,off:0},hooks={interleave:null,afterTenantRead:null,loseAcknowledgement:false},pending={promise:null,error:false};
  async function mutate(fn){const warm=subscription(tenantRef);try{await warm.ready;const result=await tenantRef.transaction(value=>{assert.ok(value);const next=copy(value);fn(next);return next;},undefined,false);assert.equal(result.committed,true);}finally{warm.close();}}
  const database={app:da.app,ref(fixed){assert.ok(fixed===path||fixed.startsWith('serverRateLimits/'+tenantId+'/'));const real=da.ref(fixed);return {toString:()=>real.toString(),async get(){if(fixed===path)stats.tenantReads++;const snapshot=await real.get();if(fixed===path&&hooks.afterTenantRead){const fn=hooks.afterTenantRead;hooks.afterTenantRead=null;await mutate(fn);}return snapshot;},on(...args){stats.on++;return real.on(...args);},off(...args){stats.off++;return real.off(...args);},async transaction(update,complete,local){
    if(fixed===path)stats.tenantTransactions++;const result=await real.transaction(value=>{if(fixed===path)stats.callbacks++;const candidate=update(value);if(fixed===path&&candidate!==undefined&&hooks.interleave){const fn=hooks.interleave;hooks.interleave=null;da.goOffline();pending.promise=Promise.resolve().then(fn).catch(()=>{pending.error=true;}).finally(()=>da.goOnline());}return candidate;},complete,local);
    if(fixed===path&&result.committed&&hooks.loseAcknowledgement){hooks.loseAcknowledgement=false;throw Error('Synthetic owner-route acknowledgement loss');}return result;
  }};}};
  const auth=app=>({app,async verifyIdToken(token,revoked){assert.equal(token,TOKEN);assert.equal(revoked,true);stats.auth++;if(actor.rejectToken)throw Error('Synthetic token rejection');return {uid:actor.uid,sub:actor.uid,aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,email_verified:true,firebase:{sign_in_provider:actor.provider},exp:Date.parse(actor.now)/1000+3600,owner:true};}});
  const options={enabled:true,projectId:PROJECT,databaseURL:URL,tenantId,allowedOrigins:[ORIGIN],clock:()=>actor.now,policy:{rateWindowMs:60000,rateLimit:limit,deadlineMs:10000,maxInFlight:4},testOnlyEmulator:{host:HOST,port:PORT}};
  const runtimeA=Runtime.createProductionRuntime({...options,database,auth:auth(a)}),runtimeB=Runtime.createProductionRuntime({...options,database:db,auth:auth(b)});
  const reader=Session.createProductionOwnerTariffService({...options,database,auth:auth(a),admit:async scope=>{assert.deepEqual(scope,{projectId:PROJECT,uid:actor.uid});const root=(await tenantRef.get()).val();return root?.grants?.[scope.uid]?.profile?.active===true&&root.grants[scope.uid].profile.owner===true;}});
  async function run(route=VIEW,body={selection:{productId:'product-1',cycleId:'cycle-1'}},{runtime=runtimeA,method='POST',origin=ORIGIN}={}){
    const raw=Buffer.from(JSON.stringify(body)),headers={origin,authorization:'Bearer '+TOKEN,'content-type':'application/json','content-length':String(raw.length)},request={method,url:route,headers,rawHeaders:Object.entries(headers).flat(),rawBody:raw},response={headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=JSON.parse(body);this.writableEnded=true;}};
    await runtime.handler(request,response);if(pending.promise)await pending.promise;assert.equal(pending.error,false,'Independent writer must commit while first SDK is paused');return response;
  }
  return {tenantId,path,options,actor,stats,hooks,mutate,run,runtimeA,runtimeB,reader:selection=>reader.execute({idToken:TOKEN,selection}),state:async()=>(await tenantRef.get()).val(),quota:async()=>(await quotaRef.get()).val()};
}

test('actual owner HTTP view reconstructs bounded selected rates without canonical siblings or authority data',{timeout:30000},async t=>{
  const f=await fixture(t),before=await f.state(),response=await f.run();assert.equal(response.statusCode,200);
  assert.deepEqual(response.body,{ok:true,view:{schemaVersion:1,projectId:PROJECT,tenantId:f.tenantId,uid:'owner-1',grantRevision:7,productId:'product-1',cycleId:'cycle-1',configRevision:1,tariffRevision:1,serverTime:NOW,policy:{version:'policy-1',kind:'jakarta-fixed-local-time',hour:8,minute:0},workers:[{workerId:'worker-1',label:'Synthetic assigned partner',assignedQuantity:10,history:[{tariffVersion:'tariff-old',effectiveAt:'2026-01-01T00:00:00.000Z',currency:'IDR',rate:100}]}]}});
  assert.equal(response.headers['Cache-Control'],'no-store');assert.equal(response.headers['Access-Control-Allow-Origin'],ORIGIN);assert.deepEqual(await f.state(),before);assert.equal((await f.quota())['owner-1'].count,1);
  for(const field of ['owner-2','partner-user','qc-user','product-2','worker-2','privateAuthority','snapshots','receipts','frozenPayroll','tariffInputs','tariffCommandLedger',TOKEN])assert.equal(JSON.stringify(response.body).includes(field),false,'Owner tariff view must not leak '+field);
});

test('direct owner view derives grant and tariff selection from exactly one genuine SDK snapshot',{timeout:30000},async t=>{
  const f=await fixture(t),before=await f.state(),result=await f.reader({productId:'product-1',cycleId:'cycle-1'});assert.equal(result.ok,true);assert.equal(result.view.grantRevision,7);assert.equal(result.view.tariffRevision,1);assert.equal(f.stats.tenantReads,1);assert.equal(f.stats.auth,1);assert.equal(f.stats.tenantTransactions,0);assert.deepEqual(await f.state(),before);
});

test('partner, QC and ungranted token owner claims cannot read/edit rates or create a quota bucket',{timeout:30000},async t=>{
  const f=await fixture(t),before=await f.state();for(const uid of ['partner-user','qc-user','unlisted-user']){f.actor.uid=uid;const view=await f.run(),edit=await f.run(APPEND,{command:command()});assert.equal(view.body.ok,false);assert.equal(edit.body.ok,false);assert.equal(await f.quota(),null);}
  assert.deepEqual(await f.state(),before);assert.equal(f.stats.tenantTransactions,0);
});

test('owner tariff view is withheld when canonical owner is revoked after its snapshot',{timeout:30000},async t=>{
  const f=await fixture(t);f.hooks.afterTenantRead=root=>{root.grants['owner-1'].profile.active=false;root.grants['owner-1'].revision++;};const result=await f.reader({productId:'product-1',cycleId:'cycle-1'});assert.equal(result.ok,false);assert.equal(Object.hasOwn(result,'view'),false);assert.equal(f.stats.tenantReads,1);assert.equal(f.stats.tenantTransactions,0);assert.equal(await f.quota(),null);
  assert.equal((await f.reader({productId:'product-1',cycleId:'cycle-1'})).ok,false);
});

test('actual owner append preserves old rates, frozen payroll and authority wire; view excludes durable private ledger',{timeout:30000},async t=>{
  const f=await fixture(t),before=await f.state(),response=await f.run(APPEND,{command:command()}),after=await f.state();assert.equal(response.statusCode,200);assert.equal(response.body.ok,true);assert.equal(response.body.replayed,false);assert.equal(response.body.receipt.revision,2);
  assert.deepEqual(selected(after).wire,selected(before).wire);assert.deepEqual(selected(after).config,selected(before).config);assert.deepEqual(after.grants,before.grants);assert.deepEqual(after.products['product-2'],before.products['product-2']);assert.equal(Object.keys(after.tariffCommandLedger.entries).length,1);assert.equal(selected(after).tariffInputs.historyByWorker['worker-1']['tariff-old'].rate,100);assert.equal(selected(after).tariffInputs.historyByWorker['worker-1']['tariff-new'].rate,200);assert.equal(Authority.decodeStorage(selected(after).wire).frozenPayroll['count-1'].rate,100);
  const view=await f.run();assert.equal(view.body.view.tariffRevision,2);assert.deepEqual(view.body.view.workers[0].history.map(row=>row.tariffVersion),['tariff-old','tariff-new']);for(const field of ['tariffCommandLedger','commandJson','commandHash','frozenPayroll','privateAuthority',TOKEN])assert.equal(JSON.stringify(view.body).includes(field),false);
  for(const field of ['rate','tariffInputs','commandJson',TOKEN])assert.equal(JSON.stringify(response.body).includes(field),false);assert.equal(f.stats.on,f.stats.off);
});

test('lost actual owner-route acknowledgement replays exact durable command after time advances on another runtime',{timeout:30000},async t=>{
  const f=await fixture(t),edit=command();f.hooks.loseAcknowledgement=true;const lost=await f.run(APPEND,{command:edit});assert.equal(lost.statusCode,503);assert.equal(lost.body.retrySameCommand,true);assert.equal(JSON.stringify(lost.body).includes('Synthetic owner-route acknowledgement loss'),false);
  const committed=await f.state(),receipt=Object.values(committed.tariffCommandLedger.entries)[0].receipt;f.actor.now=LATER;const replay=await f.run(APPEND,{command:edit},{runtime:f.runtimeB});assert.equal(replay.statusCode,200);assert.deepEqual(replay.body,{ok:true,receipt,replayed:true});assert.deepEqual(await f.state(),committed);assert.equal(Object.keys(committed.tariffCommandLedger.entries).length,1);
  const changed=await f.run(APPEND,{command:{...edit,rate:201}},{runtime:f.runtimeB});assert.equal(changed.statusCode,409);assert.deepEqual(await f.state(),committed);
});

test('genuine owner ancestor CAS rejects a speculative new rate after mid-transaction revocation',{timeout:30000},async t=>{
  const f=await fixture(t),before=await f.state();f.hooks.interleave=()=>f.mutate(root=>{root.grants['owner-1'].profile.active=false;root.grants['owner-1'].revision++;});const response=await f.run(APPEND,{command:command()});assert.equal(response.body.ok,false);const after=await f.state();assert.ok(f.stats.callbacks>=2);assert.ok(f.stats.auth>=2);assert.deepEqual(after.products,before.products);assert.equal(Object.hasOwn(after,'tariffCommandLedger'),false);assert.equal(f.stats.on,f.stats.off);
});

test('fresh Google verification and current owner grant precede accepted receipt replay',{timeout:30000},async t=>{
  const f=await fixture(t),edit=command();assert.equal((await f.run(APPEND,{command:edit})).body.ok,true);const accepted=await f.state();f.actor.rejectToken=true;assert.equal((await f.run(APPEND,{command:edit})).body.ok,false);assert.deepEqual(await f.state(),accepted);f.actor.rejectToken=false;f.actor.provider='password';assert.equal((await f.run()).body.ok,false);assert.deepEqual(await f.state(),accepted);f.actor.provider='google.com';await f.mutate(root=>{root.grants['owner-1'].profile.owner=false;root.grants['owner-1'].revision++;});assert.equal((await f.run(APPEND,{command:edit})).body.ok,false);assert.equal(Object.keys((await f.state()).tariffCommandLedger.entries).length,1);
});

test('independent owner view and append share the real private quota and cannot mutate business state when limited',{timeout:30000},async t=>{
  const f=await fixture(t,{limit:1}),before=await f.state(),view=await f.run();assert.equal(view.statusCode,200);const append=await f.run(APPEND,{command:command()},{runtime:f.runtimeB});assert.equal(append.statusCode,429);assert.deepEqual(append.body,{ok:false,error:'rate_limited'});assert.equal((await f.quota())['owner-1'].count,1);assert.deepEqual(await f.state(),before);
});

test('malformed foreign projection or durable tariff ledger holds the entire owner view without private response',{timeout:30000},async t=>{
  for(const corrupt of [root=>{root.products['product-2'].cycles['cycle-1'].wire.projection.operations.id='wrong-product';},root=>{root.tariffCommandLedger={schemaVersion:1,entries:{forged:{receipt:{private:'Synthetic forbidden data'}}}};}]){
    const f=await fixture(t);await f.mutate(corrupt);const before=await f.state(),response=await f.run();assert.equal(response.body.ok,false);assert.equal(Object.hasOwn(response.body,'view'),false);assert.deepEqual(await f.state(),before);assert.equal(JSON.stringify(response.body).includes('Synthetic forbidden data'),false);assert.equal(f.stats.tenantTransactions,0);
  }
});

test('unreviewed, inactive, unknown or absent selected cycles never return a tariff view or bootstrap data',{timeout:30000},async t=>{
  for(const mutate of [root=>{selected(root).config.active=false;},root=>{selected(root).config.reviewedEmptyCycle=false;}]){const f=await fixture(t);await f.mutate(mutate);const before=await f.state(),response=await f.run();assert.equal(response.body.ok,false);assert.equal(Object.hasOwn(response.body,'view'),false);assert.deepEqual(await f.state(),before);}
  const f=await fixture(t);assert.equal((await f.run(VIEW,{selection:{productId:'unknown-product',cycleId:'cycle-1'}})).body.ok,false);assert.equal((await f.run(VIEW,{selection:{productId:'product-1',cycleId:'unknown-cycle'}})).body.ok,false);
  const empty=await fixture(t,{empty:true});assert.equal((await empty.run()).body.ok,false);assert.equal(await empty.state(),null);assert.equal(await empty.quota(),null);
});

test('a genuine valid 513-rate history is held in full rather than silently truncating owner data',{timeout:30000},async t=>{
  const f=await fixture(t);await f.mutate(root=>{const c=selected(root),history=c.tariffInputs.historyByWorker['worker-1'];for(let i=1;i<=512;i++)history['synthetic-rate-'+i]={effectiveAt:new Date(Date.parse('2026-01-01T00:00:00.000Z')+i*60000).toISOString(),currency:'IDR',rate:100+i};c.tariffInputs.revision=513;});
  const before=await f.state(),response=await f.run();assert.equal(response.body.ok,false);assert.equal(response.body.error,'capacity_limit');assert.equal(Object.hasOwn(response.body,'view'),false);assert.deepEqual(await f.state(),before);assert.equal(f.stats.tenantTransactions,0);
});

test('owner HTTP boundary exposes only appendTariffVersion and exact view selection, never grant or lifecycle writes',{timeout:30000},async t=>{
  const f=await fixture(t),before=await f.state();for(const edit of [{kind:'setGrant',uid:'forged-owner',expectedRevision:null,profile:{active:true,owner:true}},{kind:'createCycle',requestId:'forged-create'},{kind:'setConfig',productId:'product-1',cycleId:'cycle-1',expectedRevision:1,config:{active:false,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'}},{kind:'appendTariff',productId:'product-1',cycleId:'cycle-1'}]){const response=await f.run(APPEND,{command:edit});assert.equal(response.statusCode,400);}
  for(const body of [{selection:{productId:'product-1',cycleId:'cycle-1',owner:true}},{selection:{productId:'product-1',cycleId:'cycle-1'},profile:{owner:true}},{selection:{productId:'product-1',cycleId:'cycle-1'},idToken:TOKEN},{command:command()}])assert.equal((await f.run(VIEW,body)).statusCode,400);
  assert.equal((await f.run(APPEND,{command:command()}, {method:'GET'})).body.ok,false);assert.equal((await f.run(VIEW+'?uid=owner-2')).body.ok,false);assert.equal((await f.run(VIEW,undefined,{origin:'https://untrusted.example.invalid'})).body.ok,false);assert.deepEqual(await f.state(),before);assert.equal(await f.quota(),null);assert.equal(f.stats.tenantTransactions,0);
});
