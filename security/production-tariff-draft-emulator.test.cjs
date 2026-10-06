'use strict';
// Genuine Admin SDK / RTDB conditional-put proof using synthetic loopback data.
// Token verification is a fixture, so these tests do not prove real Google
// login, deployment, business-data migration, billing or money transfers.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const PROJECT='demo-soldier-security',HOST='127.0.0.1',PORT=9000,URL='https://'+PROJECT+'.firebaseio.com';
const NOW='2026-10-05T03:00:00.000Z',EFFECTIVE='2026-10-05T04:00:00.000Z',LATER='2026-10-05T06:00:00.000Z',ORIGIN='https://soldier.example.invalid',TOKEN='header.payload.signature';
const VIEW='/v1/production/owner/tariffs/view',APPEND='/v1/production/owner/tariffs/append',RESOLVE='/v1/production/owner/tariffs/resolve';
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST,HOST+':'+PORT,'Tariff draft proof requires the isolated loopback emulator');
assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS&&!process.env.FIREBASE_TOKEN,'Tariff draft proof forbids real credential configuration');
assert.ok(Number(process.versions.node.split('.')[0])>=22,'Tariff draft proof requires Node 22 or newer');
const {initializeApp,deleteApp,SDK_VERSION}=require('firebase-admin/app'),{getDatabase}=require('firebase-admin/database');
assert.equal(SDK_VERSION,'14.5.0');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing'),{ref,get,set}=require('firebase/database');
const Authority=require('../server/production-authority.cjs'),Runtime=require('../server/production-runtime.cjs'),Admin=require('../server/production-tenant-admin.cjs');
const copy=v=>JSON.parse(JSON.stringify(v));let sequence=0,env;
before(async()=>{env=await initializeTestEnvironment({projectId:PROJECT,database:{host:HOST,port:PORT,rules:fs.readFileSync(__dirname+'/authority-tenant.rules.json','utf8')}});});
after(async()=>{if(env)await env.cleanup();});
const claims={email_verified:true,firebase:{sign_in_provider:'google.com'}};
const actorContext=()=>({uid:'owner-1',emailVerified:true,provider:'google.com',profile:{active:true,owner:true},now:NOW});
function countedState(productId){
  let state=Authority.createAuthority({product:{id:productId,series:'Synthetic',namaBarang:'Example garment',size:'M',cutQuantity:10},cycleId:'cycle-1',workers:[{id:'worker-1',nama:'Synthetic partner'}],assignments:[{id:'assignment-1',workerId:'worker-1',qty:10}],now:NOW});
  const command=(kind,payload,requestId)=>({requestId,productId,cycleId:'cycle-1',expectedRevision:state.revision,kind,payload});
  state=Authority.applyCommand(state,actorContext(),command('sewing',{id:'sewing-1',assignmentId:'assignment-1',tanggal:'2026-10-05',good:10,reject:0},'synthetic-sewing')).state;
  const context=actorContext();context.selectedTariffs={'count-1':{source:'private-verified-tariff',verified:true,workerId:'worker-1',productId,cycleId:'cycle-1',countId:'count-1',workDate:'2026-10-05',basisAt:'2026-10-05T01:00:00.000Z',effectiveAt:'2026-01-01T00:00:00.000Z',tariffVersion:'tariff-old',currency:'IDR',rate:100,selectedAt:NOW}};
  return Authority.applyCommand(state,context,command('count',{id:'count-1',assignmentId:'assignment-1',tanggal:'2026-10-05',jumlah:10},'synthetic-count')).state;
}
function product(productId){return {cycles:{'cycle-1':{config:{revision:1,active:true,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'},tariffInputs:{revision:1,policy:{version:'policy-1',kind:'jakarta-fixed-local-time',hour:8,minute:0},historyByWorker:{'worker-1':{'tariff-old':{effectiveAt:'2026-01-01T00:00:00.000Z',currency:'IDR',rate:100}}}},wire:Authority.encodeStorage(countedState(productId))}}};}
function seed(tenantId){return {schemaVersion:1,projectId:PROJECT,tenantId,grants:{'owner-1':{revision:7,profile:{active:true,owner:true}},'owner-2':{revision:9,profile:{active:true,owner:true}},'partner-user':{revision:1,profile:{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}}},'qc-user':{revision:1,profile:{active:true,owner:false,modules:{qc:true}}}},products:{'product-1':product('product-1'),'product-2':product('product-2')}};}
const selected=root=>root.products['product-1'].cycles['cycle-1'];
const command=(changes={})=>({kind:'appendTariffVersion',requestId:'tariff-request',productId:'product-1',cycleId:'cycle-1',expectedConfigRevision:1,expectedTariffRevision:1,workerId:'worker-1',tariffVersion:'tariff-new',effectiveAt:EFFECTIVE,currency:'IDR',rate:200,...changes});
const expectedRetired=()=>({requestId:'tariff-request',kind:'retireTariffDraft',productId:'product-1',cycleId:'cycle-1',workerId:'worker-1',tariffVersion:'tariff-new',retiredAt:NOW});
function subscription(reference){let listener,timer;const ready=new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(Error('Synthetic cache preparation failed'));};listener=()=>{clearTimeout(timer);resolve();};timer=setTimeout(abort,5000);reference.on('value',listener,abort);});return {ready,close(){clearTimeout(timer);reference.off('value',listener);}};}
async function fixture(t,{limit=30}={}){
  const n=++sequence,tenantId='tariff-draft-proof-'+n,path='authorityTenants/'+tenantId,credential={getAccessToken:async()=>({access_token:'owner',expires_in:3600})};
  const a=initializeApp({projectId:PROJECT,databaseURL:URL,credential},'tariff-draft-a-'+n);let b,da,db,tenantRef,quotaRef;
  t.after(async()=>{try{if(da)da.goOnline();if(tenantRef)await tenantRef.remove();if(quotaRef)await quotaRef.remove();}finally{await Promise.all([a,b].filter(Boolean).map(app=>Promise.resolve().then(()=>deleteApp(app))));}});
  b=initializeApp({projectId:PROJECT,databaseURL:URL,credential},'tariff-draft-b-'+n);da=getDatabase(a);db=getDatabase(b);tenantRef=db.ref(path);quotaRef=db.ref('serverRateLimits/'+tenantId);
  assert.equal(da.ref(path).toString(),'http://'+HOST+':'+PORT+'/'+path);await tenantRef.set(seed(tenantId));
  const actor={uid:'owner-1',now:NOW,rejectToken:false,provider:'google.com',expired:false},stats={auth:0,authA:0,authB:0,tenantTransactions:0,callbacks:0,on:0,off:0},hooks={interleave:null,loseAcknowledgement:false},pending={promise:null,error:false};
  async function mutate(fn){const warm=subscription(tenantRef);try{await warm.ready;const result=await tenantRef.transaction(value=>{assert.ok(value);const next=copy(value);fn(next);return next;},undefined,false);assert.equal(result.committed,true);}finally{warm.close();}}
  const database={app:da.app,ref(fixed){assert.ok(fixed===path||fixed.startsWith('serverRateLimits/'+tenantId+'/'));const real=da.ref(fixed);return {toString:()=>real.toString(),get:()=>real.get(),on(...args){stats.on++;return real.on(...args);},off(...args){stats.off++;return real.off(...args);},async transaction(update,complete,local){
    if(fixed===path)stats.tenantTransactions++;const result=await real.transaction(value=>{if(fixed===path)stats.callbacks++;const candidate=update(value);if(fixed===path&&candidate!==undefined&&hooks.interleave){const fn=hooks.interleave;hooks.interleave=null;da.goOffline();pending.promise=Promise.resolve().then(fn).catch(()=>{pending.error=true;}).finally(()=>da.goOnline());}return candidate;},complete,local);
    if(fixed===path&&result.committed&&hooks.loseAcknowledgement){hooks.loseAcknowledgement=false;throw Error('Synthetic draft acknowledgement loss');}return result;
  }};}};
  const auth=app=>({app,async verifyIdToken(token,revoked){assert.equal(token,TOKEN);assert.equal(revoked,true);stats.auth++;stats[app===a?'authA':'authB']++;if(actor.rejectToken)throw Error('Synthetic token rejection');return {uid:actor.uid,sub:actor.uid,aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,email_verified:true,firebase:{sign_in_provider:actor.provider},exp:Date.parse(actor.now)/1000+(actor.expired?-1:3600),owner:true};}});
  const options={enabled:true,projectId:PROJECT,databaseURL:URL,tenantId,allowedOrigins:[ORIGIN],clock:()=>actor.now,policy:{rateWindowMs:60000,rateLimit:limit,deadlineMs:10000,maxInFlight:4},testOnlyEmulator:{host:HOST,port:PORT}};
  const runtimeA=Runtime.createProductionRuntime({...options,database,auth:auth(a)}),runtimeB=Runtime.createProductionRuntime({...options,database:db,auth:auth(b)});
  const adminA=Admin.createProductionTenantAdmin({...options,database,auth:auth(a),admit:async()=>true}),adminB=Admin.createProductionTenantAdmin({...options,database:db,auth:auth(b),admit:async()=>true});
  async function run(route=RESOLVE,body={command:command()},{runtime=runtimeA,method='POST',origin=ORIGIN}={}){
    const raw=Buffer.from(JSON.stringify(body)),headers={origin,authorization:'Bearer '+TOKEN,'content-type':'application/json','content-length':String(raw.length)},request={method,url:route,headers,rawHeaders:Object.entries(headers).flat(),rawBody:raw},response={headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=JSON.parse(body);this.writableEnded=true;}};
    await runtime.handler(request,response);if(pending.promise)await pending.promise;assert.equal(pending.error,false,'Independent writer must commit while first SDK is paused');return response;
  }
  async function direct(which,resolve,edit){const result=await (resolve?which.resolveTariffDraft({idToken:TOKEN,command:edit}):which.execute({idToken:TOKEN,command:edit}));if(which===adminA&&pending.promise)await pending.promise;assert.equal(pending.error,false);return result;}
  return {tenantId,path,actor,stats,hooks,mutate,run,runtimeA,runtimeB,append:edit=>direct(adminA,false,edit),resolve:edit=>direct(adminA,true,edit),appendOther:edit=>direct(adminB,false,edit),resolveOther:edit=>direct(adminB,true,edit),state:async()=>(await tenantRef.get()).val(),quota:async()=>(await quotaRef.get()).val()};
}

test('actual resolver retires an absent exact draft without changing rates, frozen wages or authority wire',{timeout:30000},async t=>{
  const f=await fixture(t),before=await f.state(),response=await f.run(),after=await f.state();assert.equal(response.statusCode,200);assert.deepEqual(response.body,{ok:true,outcome:'retired',receipt:expectedRetired(),replayed:false});
  assert.equal(response.headers['Cache-Control'],'no-store');assert.equal(response.headers['Access-Control-Allow-Origin'],ORIGIN);assert.deepEqual(after.products,before.products);assert.deepEqual(after.grants,before.grants);assert.equal(Object.keys(after.tariffCommandLedger.entries).length,1);
  const entry=Object.values(after.tariffCommandLedger.entries)[0];assert.equal(entry.retiredAt,NOW);assert.equal(Object.hasOwn(entry,'acceptedAt'),false);assert.deepEqual(entry.receipt,response.body.receipt);assert.equal(Authority.decodeStorage(selected(after).wire).frozenPayroll['count-1'].rate,100);assert.equal(selected(after).tariffInputs.revision,1);assert.equal(f.stats.on,f.stats.off);
  for(const field of ['rate','commandJson','commandHash','profile','privateAuthority',TOKEN])assert.equal(JSON.stringify(response.body).includes(field),false,'Resolution receipt must not expose '+field);
});

test('retired draft replay survives later config, tariff and clock advances; the original late append stays blocked',{timeout:30000},async t=>{
  const f=await fixture(t),edit=command(),retired=await f.resolve(edit);assert.equal(retired.outcome,'retired');
  assert.equal((await f.append(command({requestId:'next-request',tariffVersion:'tariff-next',effectiveAt:'2026-10-05T05:00:00.000Z',rate:300}))).ok,true);
  await f.mutate(root=>{selected(root).config.revision++;selected(root).config.active=false;});f.actor.now=LATER;const before=await f.state(),transactions=f.stats.tenantTransactions,replay=await f.resolve(edit);assert.deepEqual(replay,{...retired,replayed:true});assert.equal(f.stats.tenantTransactions,transactions);
  assert.equal((await f.append(edit)).error,'draft_retired');assert.equal((await f.append({...edit,rate:201})).error,'conflict');assert.equal((await f.resolve({...edit,rate:201})).error,'conflict');assert.deepEqual(await f.state(),before);assert.equal(Object.keys(before.tariffCommandLedger.entries).length,2);
});

test('accepted-first resolution returns the original append receipt without undoing or repricing it',{timeout:30000},async t=>{
  const f=await fixture(t),edit=command(),accepted=await f.append(edit);assert.equal(accepted.ok,true);f.actor.now=LATER;const before=await f.state(),transactions=f.stats.tenantTransactions,response=await f.run();assert.equal(response.statusCode,200);assert.deepEqual(response.body,{ok:true,outcome:'accepted',receipt:accepted.receipt,replayed:true});assert.equal(f.stats.tenantTransactions,transactions);assert.deepEqual(await f.state(),before);assert.equal(selected(before).tariffInputs.revision,2);assert.equal(selected(before).tariffInputs.historyByWorker['worker-1']['tariff-new'].rate,200);assert.equal(Object.keys(before.tariffCommandLedger.entries).length,1);
});

test('genuine retired-first ancestor CAS defeats an already speculative late append from another Admin app',{timeout:30000},async t=>{
  const f=await fixture(t),edit=command(),before=await f.state();let winner;f.hooks.interleave=async()=>{winner=await f.resolveOther(edit);assert.equal(winner.outcome,'retired');};const loser=await f.append(edit),after=await f.state();assert.equal(loser.error,'draft_retired');assert.ok(f.stats.callbacks>=2);assert.ok(f.stats.auth>=1);assert.equal(winner.replayed,false);assert.deepEqual(after.products,before.products);assert.equal(Object.keys(after.tariffCommandLedger.entries).length,1);assert.deepEqual(Object.values(after.tariffCommandLedger.entries)[0].receipt,winner.receipt);assert.equal(f.stats.on,f.stats.off);
});

test('genuine append-first ancestor CAS resolves the original accepted receipt instead of creating a retirement',{timeout:30000},async t=>{
  const f=await fixture(t),edit=command(),before=await f.state();let winner;f.hooks.interleave=async()=>{winner=await f.appendOther(edit);assert.equal(winner.ok,true);};const resolved=await f.resolve(edit),after=await f.state();assert.deepEqual(resolved,{ok:true,outcome:'accepted',receipt:winner.receipt,replayed:true});assert.ok(f.stats.callbacks>=2);assert.ok(f.stats.authA>=2,'The losing resolver itself must freshly reverify Auth before receipt replay');assert.equal(f.stats.authB,1);assert.equal(Object.keys(after.tariffCommandLedger.entries).length,1);assert.equal(Object.hasOwn(Object.values(after.tariffCommandLedger.entries)[0],'retiredAt'),false);assert.equal(selected(after).tariffInputs.revision,2);assert.deepEqual(selected(after).wire,selected(before).wire);assert.equal(f.stats.on,f.stats.off);
});

test('concurrent identical resolvers produce one genuine tombstone and the same durable receipt',{timeout:30000},async t=>{
  const f=await fixture(t),edit=command();let winner,transactions;f.hooks.interleave=async()=>{transactions=f.stats.tenantTransactions;winner=await f.resolveOther(edit);assert.equal(winner.replayed,false);};const replay=await f.resolve(edit),after=await f.state();assert.deepEqual(replay,{...winner,replayed:true});assert.ok(f.stats.callbacks>=2);assert.ok(f.stats.authA>=2,'The losing resolver itself must freshly reverify Auth before receipt replay');assert.equal(f.stats.authB,1);assert.equal(f.stats.tenantTransactions,transactions);assert.equal(Object.keys(after.tariffCommandLedger.entries).length,1);assert.equal(selected(after).tariffInputs.revision,1);assert.equal(f.stats.on,f.stats.off);
});

test('lost retirement acknowledgement is resolved exactly on another runtime before any new draft is allowed',{timeout:30000},async t=>{
  const f=await fixture(t),edit=command();f.hooks.loseAcknowledgement=true;const lost=await f.run();assert.equal(lost.statusCode,503);assert.equal(lost.body.retrySameCommand,true);assert.equal(JSON.stringify(lost.body).includes('Synthetic draft acknowledgement loss'),false);const committed=await f.state(),receipt=Object.values(committed.tariffCommandLedger.entries)[0].receipt;
  f.actor.now=LATER;const replay=await f.run(RESOLVE,{command:edit},{runtime:f.runtimeB});assert.equal(replay.statusCode,200);assert.deepEqual(replay.body,{ok:true,outcome:'retired',receipt,replayed:true});const late=await f.run(APPEND,{command:edit},{runtime:f.runtimeB});assert.equal(late.statusCode,409);assert.equal(late.body.error,'draft_retired');assert.deepEqual(await f.state(),committed);assert.equal(Object.keys(committed.tariffCommandLedger.entries).length,1);
});

test('genuine ancestor CAS rejects speculative retirement after canonical owner revocation',{timeout:30000},async t=>{
  const f=await fixture(t),before=await f.state();f.hooks.interleave=()=>f.mutate(root=>{root.grants['owner-1'].profile.active=false;root.grants['owner-1'].revision++;});const response=await f.run();assert.equal(response.body.ok,false);const after=await f.state();assert.ok(f.stats.callbacks>=2);assert.ok(f.stats.auth>=2);assert.deepEqual(after.products,before.products);assert.equal(Object.hasOwn(after,'tariffCommandLedger'),false);assert.equal(f.stats.on,f.stats.off);
});

test('fresh Google verification and current owner grant precede accepted and retired resolution replay',{timeout:30000},async t=>{
  for(const mode of ['accepted','retired']){const f=await fixture(t),edit=command();assert.equal((await (mode==='accepted'?f.append(edit):f.resolve(edit))).ok,true);const before=await f.state();for(const reject of ['rejectToken','expired']){f.actor[reject]=true;assert.equal((await f.run()).body.ok,false);f.actor[reject]=false;}f.actor.provider='password';assert.equal((await f.run()).body.ok,false);f.actor.provider='google.com';await f.mutate(root=>{root.grants['owner-1'].profile.owner=false;root.grants['owner-1'].revision++;});assert.equal((await f.run()).body.ok,false);const after=await f.state();assert.deepEqual(after.products,before.products);assert.deepEqual(after.tariffCommandLedger,before.tariffCommandLedger);}
});

test('non-owner resolution cannot read a command outcome, mutate a tenant or create a quota bucket',{timeout:30000},async t=>{
  const f=await fixture(t),before=await f.state();for(const uid of ['partner-user','qc-user','unlisted-user']){f.actor.uid=uid;const response=await f.run();assert.equal(response.body.ok,false);assert.equal(Object.hasOwn(response.body,'outcome'),false);assert.equal(Object.hasOwn(response.body,'receipt'),false);assert.equal(await f.quota(),null);}assert.deepEqual(await f.state(),before);assert.equal(f.stats.tenantTransactions,0);
});

test('resolution shares the fixed owner quota with view and append across genuine runtime instances',{timeout:30000},async t=>{
  const f=await fixture(t,{limit:1}),before=await f.state(),view=await f.run(VIEW,{selection:{productId:'product-1',cycleId:'cycle-1'}});assert.equal(view.statusCode,200);const resolve=await f.run(RESOLVE,{command:command()},{runtime:f.runtimeB});assert.equal(resolve.statusCode,429);assert.deepEqual(resolve.body,{ok:false,error:'rate_limited'});assert.equal((await f.quota())['owner-1'].count,1);assert.deepEqual(await f.state(),before);assert.equal(f.stats.tenantTransactions,0);
});

test('retirement HTTP boundary accepts only the original exact future-tariff command with fixed origin and path',{timeout:30000},async t=>{
  const f=await fixture(t),before=await f.state();for(const body of [{command:command(),owner:true},{command:command(),idToken:TOKEN},{command:{...command(),kind:'retireTariffDraft'}},{command:{...command(),profile:{owner:true}}},{command:{...command(),tenantId:f.tenantId}},{selection:{productId:'product-1',cycleId:'cycle-1'}},{command:{kind:'setGrant',uid:'forged-owner',expectedRevision:null,profile:{active:true,owner:true}}}])assert.equal((await f.run(RESOLVE,body)).statusCode,400);
  for(const options of [{method:'GET'},{origin:'https://untrusted.example.invalid'}])assert.equal((await f.run(RESOLVE,{command:command()},options)).body.ok,false);assert.equal((await f.run(RESOLVE+'?uid=owner-2')).body.ok,false);assert.deepEqual(await f.state(),before);assert.equal(await f.quota(),null);assert.equal(f.stats.tenantTransactions,0);
});

test('malformed retained retirement union holds all privileged services without leaking its private content',{timeout:30000},async t=>{
  const corruptions=[entry=>{entry.receipt.kind='appendTariffVersion';},entry=>{entry.acceptedAt=NOW;},entry=>{entry.commandHash='a'.repeat(64);},entry=>{entry.commandJson='Synthetic private invalid command';},entry=>{entry.receipt.retiredAt=LATER;},entry=>{entry.retiredAt='not-a-date';}];
  for(const corrupt of corruptions){const f=await fixture(t);assert.equal((await f.resolve(command())).ok,true);await f.mutate(root=>corrupt(Object.values(root.tariffCommandLedger.entries)[0]));const before=await f.state();for(const [route,body]of [[RESOLVE,{command:command()}],[APPEND,{command:command()}],[VIEW,{selection:{productId:'product-1',cycleId:'cycle-1'}}]]){const response=await f.run(route,body);assert.equal(response.body.ok,false);for(const field of ['outcome','receipt','view'])assert.equal(Object.hasOwn(response.body,field),false);assert.equal(JSON.stringify(response.body).includes('Synthetic private invalid command'),false);}assert.deepEqual(await f.state(),before);}
});

test('browser Rules deny retirement tombstones and receipts while preserving permitted own wage reads',{timeout:30000},async t=>{
  const f=await fixture(t);assert.equal((await f.resolve(command())).outcome,'retired');const stored=await f.state(),key=Object.keys(stored.tariffCommandLedger.entries)[0],ledger=f.path+'/tariffCommandLedger',entry=ledger+'/entries/'+key;
  for(const uid of ['owner-1','partner-user','qc-user']){const db=env.authenticatedContext(uid,claims).database();for(const path of [f.path,ledger,entry,entry+'/commandJson',entry+'/retiredAt',entry+'/receipt',entry+'/receipt/retiredAt'])await assertFails(get(ref(db,path)));for(const path of [ledger,entry+'/commandJson',entry+'/retiredAt',entry+'/receipt/retiredAt'])await assertFails(set(ref(db,path),'forged'));const wage=ref(db,f.path+'/products/product-1/cycles/cycle-1/wire/projection/earningsByWorker/worker-1');if(uid==='qc-user')await assertFails(get(wage));else assert.equal((await assertSucceeds(get(wage))).val().workerId,'worker-1');}
  assert.deepEqual(await f.state(),stored,'Denied browser writes must not change the tombstone, wages or rates');
});
