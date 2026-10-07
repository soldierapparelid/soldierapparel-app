'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Authority=require('../server/production-authority.cjs');
const Service=require('../server/production-legacy-history-service.cjs');
const PROJECT='demo-legacy-history',URL='https://'+PROJECT+'.firebaseio.com',TENANT='synthetic-tenant',VERSION='synthetic-archive-version',NOW='2026-02-01T04:00:00.000Z';
const REQUEST={idToken:'synthetic-token'},copy=v=>structuredClone(v);
function prune(v){if(v===null)return undefined;if(v&&typeof v==='object'){const out={};for(const [k,x]of Object.entries(v)){const child=prune(x);if(child!==undefined)out[k]=child;}return Object.keys(out).length?out:undefined;}return v;}
function fixture(){
  const state=Authority.createAuthority({product:{id:'synthetic-product',series:'Synthetic',namaBarang:'Synthetic garment',size:'M',cutQuantity:10},cycleId:'synthetic-cycle',workers:[{id:'synthetic-worker-a',nama:'Synthetic A'},{id:'synthetic-worker-b',nama:'Synthetic B'}],assignments:[{id:'synthetic-assignment',workerId:'synthetic-worker-a',qty:10}],now:NOW});
  const store={value:{schemaVersion:1,projectId:PROJECT,tenantId:TENANT,grants:{'synthetic-user-a':{revision:4,profile:{active:true,owner:false,workerId:'synthetic-worker-a',modules:{jahit:true}}}},products:{'synthetic-product':{cycles:{'synthetic-cycle':{config:{revision:1,active:true,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'},tariffInputs:{revision:1,policy:{version:'synthetic-policy',kind:'jakarta-fixed-local-time',hour:8,minute:0},historyByWorker:{'synthetic-worker-a':{'synthetic-tariff':{effectiveAt:'2026-01-01T00:00:00.000Z',currency:'IDR',rate:13}}}},wire:prune(Authority.encodeStorage(state))}}}}}};
  const token={uid:'synthetic-user-a',sub:'synthetic-user-a',aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,email:'synthetic-history@example.invalid',email_verified:true,firebase:{sign_in_provider:'google.com',identities:{'google.com':['synthetic-google-a']}},auth_time:Date.parse(NOW)/1000-86400,iat:Date.parse(NOW)/1000-60,exp:Date.parse(NOW)/1000+3600,owner:true};
  const user={uid:token.uid,email:token.email,emailVerified:true,disabled:false,providerData:[{providerId:'google.com',uid:'synthetic-google-a',email:token.email}]};
  const history={schemaVersion:1,scope:{projectId:PROJECT,databaseURL:URL,tenantId:TENANT,snapshotVersion:VERSION},policy:Service.SOURCE_POLICY,reviewed:true,immutable:true,workers:{'synthetic-worker-a':{division:'jahit',reviewed:true},'synthetic-worker-b':{division:'jahit',reviewed:true}},products:[{id:'synthetic-product',series:'Synthetic stored',namaBarang:'Synthetic old garment',size:'L',jahit:[{id:'synthetic-row-a',tukangId:'synthetic-worker-a',tanggal:'2025-12-01',jumlah:9,tarif:12.5,total:999.75,dibayar:false,pin:'synthetic-secret-pin'},{id:'synthetic-row-b',tukangId:'synthetic-worker-b',jumlah:3,tarif:99,total:297}],internalCost:123,arsip:[]}]};
  const stats={refs:0,grantReads:0,verify:0,getUser:0,admit:0,historyReads:0,writes:0},hooks={verify:null,getUser:null,grant:null,admit:null,history:null};
  const reference={toString:()=>URL+'/authorityTenants/'+TENANT,async get(){stats.grantReads++;const value=copy(store.value);if(hooks.grant)await hooks.grant(stats.grantReads);return {val:()=>value};},transaction(){stats.writes++;throw Error('no writes');},on(){throw Error('no listener');},off(){throw Error('no listener');}};
  const database={app:{options:{projectId:PROJECT,databaseURL:URL}},ref(path){stats.refs++;assert.equal(path,'authorityTenants/'+TENANT);return reference;}};
  const auth={app:{options:{projectId:PROJECT}},async verifyIdToken(value,revoked){stats.verify++;assert.equal(value,REQUEST.idToken);assert.equal(revoked,true);if(hooks.verify)await hooks.verify(stats.verify);return copy(token);},async getUser(uid){stats.getUser++;assert.equal(uid,token.uid);if(hooks.getUser)await hooks.getUser(stats.getUser);return copy(user);}};
  const historySource={...history.scope,path:'legacyStoredHistoryArchives/'+TENANT+'/'+VERSION,async read(){stats.historyReads++;assert.equal(arguments.length,0);assert.equal(this,historySource);if(hooks.history)await hooks.history();return history;}};
  let time=NOW;
  const options={enabled:true,projectId:PROJECT,databaseURL:URL,tenantId:TENANT,snapshotVersion:VERSION,database,auth,historySource,admit:async q=>{stats.admit++;assert.deepEqual(q,{projectId:PROJECT,uid:token.uid});if(hooks.admit)await hooks.admit();return true;},clock:()=>time};
  return {store,token,user,history,stats,hooks,reference,database,auth,historySource,options,setTime:v=>time=v,grant:()=>store.value.grants['synthetic-user-a'],execute:request=>Service.createProductionLegacyHistoryService(options).execute(request===undefined?REQUEST:request)};
}
function absentView(result,error){assert.deepEqual(result,{ok:false,error});assert.equal(Object.hasOwn(result,'view'),false);}
test('source OFF is inert for getters, malformed requests and SDK dependencies',async()=>{
  let reads=0;const options={enabled:false};for(const k of ['database','auth','historySource','clock'])Object.defineProperty(options,k,{enumerable:true,get(){reads++;throw Error('synthetic-secret');}});
  const request={};Object.defineProperty(request,'idToken',{get(){reads++;throw Error('synthetic-secret');}});
  absentView(await Service.createProductionLegacyHistoryService(options).execute(request),'service_disabled');assert.equal(reads,0);
  const f=fixture();delete f.options.enabled;absentView(await f.execute(),'service_disabled');assert.deepEqual(f.stats,{refs:0,grantReads:0,verify:0,getUser:0,admit:0,historyReads:0,writes:0});
});
test('fully validated tenant and ordinary older Google authentication return exact stored own history only',async()=>{
  const f=fixture(),before=copy(f.store.value),history=copy(f.history),answer=await f.execute();assert.equal(answer.ok,true);
  assert.deepEqual(answer.view.binding,{projectId:PROJECT,databaseURL:URL,tenantId:TENANT,uid:'synthetic-user-a',workerId:'synthetic-worker-a',division:'jahit',grantRevision:4});
  assert.equal(answer.view.records.length,1);assert.deepEqual(answer.view.records[0].stored,{tanggal:'2025-12-01',jumlah:9,tarif:12.5,total:999.75,dibayar:false});assert.notEqual(answer.view.records[0].stored.total,9*12.5);
  assert.deepEqual(f.stats,{refs:1,grantReads:3,verify:2,getUser:2,admit:1,historyReads:1,writes:0});assert.deepEqual(f.store.value,before);assert.deepEqual(f.history,history);
  const encoded=JSON.stringify(answer);for(const marker of ['synthetic-token','synthetic-secret-pin','synthetic-worker-b','internalCost','synthetic-history@example.invalid','synthetic-google-a','tariffInputs','synthetic-tariff'])assert.equal(encoded.includes(marker),false);
  for(const v of [answer,answer.view,answer.view.binding,answer.view.records,answer.view.records[0].stored])assert.equal(Object.isFrozen(v),true);
});
test('freshly refreshed normal ID token still checks disabled, revoked and current Google record',async()=>{
  const normal=fixture();normal.token.auth_time-=30*86400;normal.token.iat=Date.parse(NOW)/1000;assert.equal((await normal.execute()).ok,true);
  const disabled=fixture();disabled.token.iat=Date.parse(NOW)/1000;disabled.user.disabled=true;absentView(await disabled.execute(),'access_denied');assert.equal(disabled.stats.historyReads,0);
  const revoked=fixture();revoked.auth.verifyIdToken=async()=>{throw Error('synthetic-revocation-secret');};absentView(await revoked.execute(),'access_denied');
  const mismatched=fixture();mismatched.token.iat=Date.parse(NOW)/1000;mismatched.user.providerData[0].uid='synthetic-google-other';absentView(await mismatched.execute(),'access_denied');
});
test('no client worker, source path, version, UID, owner profile, label or email selector is accepted',async()=>{
  for(const extra of [{workerId:'synthetic-worker-b'},{uid:'synthetic-user-b'},{source:'soldier/produksi'},{path:'soldier'},{snapshotVersion:'other'},{profile:{owner:true}},{email:'synthetic@example.invalid'},{label:'Synthetic A'}]){
    const f=fixture();absentView(await f.execute({...REQUEST,...extra}),'invalid_request');assert.equal(f.stats.verify,0);assert.equal(f.stats.historyReads,0);
  }
  for(const request of [null,[],{}, {idToken:'x\ny'},{idToken:'x'.repeat(16385)}]){const f=fixture();absentView(await f.execute(request),'invalid_request');assert.equal(f.stats.verify,0);}
});
test('signed identity guards reject wrong UID/sub/project/issuer/provider/tenant and invalid timing',async()=>{
  for(const mutate of [t=>t.sub='synthetic-other',t=>t.uid='../unsafe',t=>t.aud='demo-other',t=>t.iss='https://example.invalid',t=>t.email_verified=false,t=>t.firebase.sign_in_provider='password',t=>t.firebase.tenant='synthetic-auth-tenant',t=>t.firebase.identities['google.com']=[],t=>t.firebase.identities['google.com'].push('synthetic-second'),t=>t.exp=Date.parse(NOW)/1000,t=>t.iat=Date.parse(NOW)/1000+1,t=>t.auth_time=t.iat+1,t=>t.exp='9999999999',t=>t.email='bad address']){
    const f=fixture();mutate(f.token);absentView(await f.execute(),'access_denied');assert.equal(f.stats.historyReads,0);assert.equal(f.stats.admit,0);
  }
});
test('current UserRecord must have exact UID, verified email, enabled account and unique exact Google subject',async()=>{
  for(const mutate of [u=>u.uid='synthetic-other',u=>u.disabled=true,u=>u.emailVerified=false,u=>u.email='synthetic-other@example.invalid',u=>u.tenantId='synthetic-auth-tenant',u=>u.providerData=[],u=>u.providerData[0].email='synthetic-other@example.invalid',u=>u.providerData[0].uid='synthetic-google-other',u=>u.providerData.push(copy(u.providerData[0]))]){const f=fixture();mutate(f.user);absentView(await f.execute(),'access_denied');assert.equal(f.stats.historyReads,0);}
});
test('real-shaped UserRecord/Auth prototypes are supported without reading irrelevant fields or accessors',async()=>{
  class AdminRecord{}class AdminProvider{}const f=fixture();
  const record=Object.assign(new AdminRecord(),f.user);record.providerData=record.providerData.map(x=>Object.assign(new AdminProvider(),x));let reads=0;
  Object.defineProperty(record,'irrelevant',{get(){reads++;throw Error('synthetic-secret');}});f.auth.getUser=async()=>record;
  class AdminAuth{verifyIdToken(...args){return f.auth.verifyIdToken(...args);}getUser(){return record;}}
  const auth=Object.assign(new AdminAuth(),{app:f.auth.app});f.options.auth=auth;assert.equal((await f.execute()).ok,true);assert.equal(reads,0);
});
test('owner, QC-only, inactive, unbound, mixed privilege or unknown UID grants are denied before history',async()=>{
  for(const change of [g=>g.profile.owner=true,g=>g.profile.modules={qc:true},g=>g.profile.active=false,g=>delete g.profile.workerId,g=>g.profile.modules={jahit:true,qc:true},g=>g.profile.modules={jahit:true,potong:true},g=>g.revision=0]){
    const f=fixture();change(f.grant());const result=await f.execute();assert.equal(result.ok,false);assert.equal(f.stats.historyReads,0);assert.equal(f.stats.admit,0);
  }
  const unknown=fixture();delete unknown.store.value.grants['synthetic-user-a'];absentView(await unknown.execute(),'access_denied');assert.equal(unknown.stats.historyReads,0);
});
test('entire canonical tenant validation is mandatory even for unrelated products/ledgers',async()=>{
  for(const mutate of [f=>f.store.value=null,f=>delete f.store.value.products,f=>f.store.value.schemaVersion=2,f=>f.store.value.projectId='demo-other',f=>f.store.value.products['synthetic-product'].cycles['synthetic-cycle'].tariffInputs.historyByWorker['synthetic-worker-a']['synthetic-tariff'].rate=-1,f=>f.store.value.products['synthetic-product'].cycles['synthetic-cycle'].wire.projection.operations.id='synthetic-other']){
    const f=fixture();mutate(f);assert.equal((await f.execute()).ok,false);assert.equal(f.stats.historyReads,0);assert.equal(f.stats.admit,0);
  }
});
test('historical reads need reviewed exact same-ID source worker, not an active current assignment',async()=>{
  const known=fixture();known.store.value.products['synthetic-product'].cycles['synthetic-cycle'].config.active=false;assert.equal((await known.execute()).ok,true);
  for(const mutate of [f=>delete f.history.workers['synthetic-worker-a'],f=>f.history.workers['synthetic-worker-a'].reviewed=false,f=>f.history.workers['synthetic-worker-a'].division='potong',f=>f.history.workers['synthetic-worker-a'].legacyWorkerId='synthetic-worker-b',f=>f.history.workers['synthetic-worker-a'].division='qc',f=>f.history.workers['synthetic-worker-a'].status='pending']){
    const f=fixture();mutate(f);absentView(await f.execute(),'not_ready');
  }
  const remap=fixture();remap.grant().profile.workerId='synthetic-canonical-different';absentView(await remap.execute(),'not_ready');
});
test('archive same-ID declaration cannot manufacture missing canonical worker catalog membership',async()=>{
  const f=fixture();f.grant().profile.workerId='synthetic-absent';f.history.workers['synthetic-absent']={division:'jahit',reviewed:true};f.history.products[0].jahit.push({id:'synthetic-absent-row',tukangId:'synthetic-absent',jumlah:1,tarif:5,total:50});
  absentView(await f.execute(),'not_ready');assert.equal(f.stats.historyReads,0);assert.equal(f.stats.admit,0);
});
test('canonical worker membership or catalog drift during load denies a view without name-based ownership',async()=>{
  const missing=fixture();missing.hooks.history=()=>{const c=missing.store.value.products['synthetic-product'].cycles['synthetic-cycle'],old=Authority.decodeStorage(c.wire);c.wire=prune(Authority.encodeStorage(Authority.createAuthority({product:old.product,cycleId:old.cycleId,workers:[{id:'synthetic-worker-b',nama:'Synthetic A'}],assignments:[{id:'synthetic-assignment',workerId:'synthetic-worker-b',qty:10}],now:NOW})));};
  absentView(await missing.execute(),'not_ready');assert.equal(missing.stats.historyReads,1);
  const changed=fixture();changed.hooks.history=()=>{const c=changed.store.value.products['synthetic-product'].cycles['synthetic-cycle'],old=Authority.decodeStorage(c.wire);c.wire=prune(Authority.encodeStorage(Authority.createAuthority({product:old.product,cycleId:old.cycleId,workers:[{id:'synthetic-worker-a',nama:'Synthetic changed label'},{id:'synthetic-worker-b',nama:'Synthetic B'}],assignments:Object.values(old.assignments),now:NOW})));};
  absentView(await changed.execute(),'access_denied');
});
test('cutting scope selects only stored cutting records with its exact reviewed worker',async()=>{
  const f=fixture();f.grant().profile.modules={potong:true};f.history.workers['synthetic-worker-a'].division='potong';f.history.products[0].potong=[{id:'synthetic-cut',tukangId:'synthetic-worker-a',jumlah:2.5,tarif:31.5,total:600}];
  const answer=await f.execute();assert.equal(answer.ok,true);assert.equal(answer.view.records.length,1);assert.equal(answer.view.records[0].division,'potong');assert.equal(answer.view.records[0].stored.total,600);
});
test('null stored history is unavailable while an explicitly reviewed empty dataset is available',async()=>{
  const missing=fixture();missing.history.products=null;const first=await missing.execute();assert.equal(first.ok,true);assert.equal(first.view.availability,'unavailable');assert.equal(first.view.records,null);
  const empty=fixture();empty.history.products=[];const second=await empty.execute();assert.equal(second.ok,true);assert.equal(second.view.availability,'available');assert.deepEqual(second.view.records,[]);
});
test('trusted loader descriptor must match immutable fixed origin/path/version with no live-root fallback',async()=>{
  for(const mutate of [f=>f.historySource.path='soldier/produksi',f=>f.historySource.databaseURL='https://demo-other.firebaseio.com',f=>f.historySource.tenantId='synthetic-other',f=>f.historySource.snapshotVersion='synthetic-other',f=>f.historySource.projectId='demo-other',f=>f.options.databaseURL=URL+'/',f=>f.options.snapshotVersion='../unsafe']){
    const f=fixture();mutate(f);absentView(await f.execute(),'unavailable');assert.equal(f.stats.historyReads,0);
  }
  for(const mutate of [h=>h.scope.snapshotVersion='synthetic-other',h=>h.scope.tenantId='synthetic-other',h=>h.scope.projectId='demo-other',h=>h.scope.databaseURL='https://demo-other.firebaseio.com']){const f=fixture();mutate(f.history);absentView(await f.execute(),'access_denied');}
  for(const mutate of [h=>h.reviewed=false,h=>h.immutable=false,h=>h.policy='inferred-aliases',h=>h.scope.path='soldier',h=>h.schemaVersion=2]){const f=fixture();mutate(f.history);absentView(await f.execute(),'not_ready');}
});
test('grant revocation, worker/division/revision/profile drift during admission stops before load',async()=>{
  for(const mutate of [g=>g.profile.active=false,g=>g.profile.workerId='synthetic-worker-b',g=>g.revision++,g=>g.profile.modules={potong:true},g=>g.profile.modules.stok=false]){
    const f=fixture();f.hooks.admit=()=>mutate(f.grant());absentView(await f.execute(),'access_denied');assert.equal(f.stats.historyReads,0);
  }
});
test('grant revocation or worker/division/revision drift during loader or final Auth returns no DTO',async()=>{
  for(const at of ['history','verify'])for(const mutate of [g=>g.profile.active=false,g=>g.profile.workerId='synthetic-worker-b',g=>g.revision++,g=>g.profile.modules={potong:true},g=>g.profile.modules.stok=false]){
    const f=fixture();if(at==='history')f.hooks.history=()=>mutate(f.grant());else f.hooks.verify=n=>{if(n===2)mutate(f.grant());};absentView(await f.execute(),'access_denied');assert.equal(f.stats.historyReads,1);
  }
});
test('revoked/disabled identity and UID/email/subject drift during loader fail the final Auth fence',async()=>{
  const revoked=fixture();revoked.hooks.verify=n=>{if(n===2)throw Error('synthetic-revocation');};absentView(await revoked.execute(),'access_denied');
  const disabled=fixture();disabled.hooks.history=()=>{disabled.user.disabled=true;};absentView(await disabled.execute(),'access_denied');
  for(const mutate of [f=>{f.token.uid='synthetic-user-b';f.token.sub='synthetic-user-b';f.user.uid='synthetic-user-b';},f=>{f.token.email='synthetic-other@example.invalid';f.user.email=f.token.email;f.user.providerData[0].email=f.token.email;},f=>{f.token.firebase.identities['google.com'][0]='synthetic-google-b';f.user.providerData[0].uid='synthetic-google-b';}]){const f=fixture();f.hooks.history=()=>mutate(f);absentView(await f.execute(),'access_denied');}
});
test('expiry and clock reversal at each asynchronous fence deny without source or error details',async()=>{
  for(const stage of ['verify','getUser','grant','admit','history']){
    const f=fixture();f.hooks[stage]=()=>f.setTime('2026-02-01T06:00:00.000Z');absentView(await f.execute(),'access_denied');
  }
  const backwards=fixture();backwards.hooks.history=()=>backwards.setTime('2026-02-01T03:59:59.000Z');absentView(await backwards.execute(),'unavailable');
  const badClock=fixture();badClock.options.clock=()=> '2026-02-30T00:00:00.000Z';absentView(await badClock.execute(),'unavailable');assert.equal(badClock.stats.historyReads,0);
});
test('loader function/descriptor, SDK app/ref and project/database drift are checked after awaits',async()=>{
  for(const mutate of [f=>f.historySource.path='soldier',f=>f.historySource.read=async()=>f.history,f=>f.historySource.snapshotVersion='other',f=>f.auth.app.options.projectId='demo-other',f=>f.auth.getUser=async()=>f.user,f=>f.database.app.options.databaseURL='https://demo-other.firebaseio.com',f=>f.database.ref=()=>f.reference]){
    const f=fixture(),service=Service.createProductionLegacyHistoryService(f.options);f.hooks.history=()=>mutate(f);absentView(await service.execute(REQUEST),'unavailable');
  }
  const pointer=fixture();pointer.reference.toString=()=>URL+'/authorityTenants/other';assert.equal((await pointer.execute()).ok,false);assert.equal(pointer.stats.historyReads,0);
});
test('clock callback scope drift cannot dispatch a wrong-bound SDK method',async()=>{
  for(const at of [1,2]){
    const f=fixture();let calls=0;f.options.clock=()=>{if(++calls===at)f.auth.app.options.projectId='demo-other';return NOW;};
    absentView(await f.execute(),'unavailable');assert.equal(f.stats.verify,at===1?0:1);assert.equal(f.stats.getUser,0);assert.equal(f.stats.historyReads,0);
  }
});
test('production candidate rejects database and Auth emulator environments before dispatch and after load',async()=>{
  for(const name of ['FIREBASE_DATABASE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST']){
    const previous=process.env[name];
    try{
      process.env[name]='127.0.0.1:9099';const f=fixture();absentView(await f.execute(),'unavailable');assert.equal(f.stats.verify,0);assert.equal(f.stats.getUser,0);assert.equal(f.stats.historyReads,0);assert.equal(f.stats.grantReads,0);
      delete process.env[name];const warm=fixture(),service=Service.createProductionLegacyHistoryService(warm.options);warm.hooks.history=()=>{process.env[name]='127.0.0.1:9099';};absentView(await service.execute(REQUEST),'unavailable');assert.equal(warm.stats.verify,1);assert.equal(warm.stats.historyReads,1);
    }finally{if(previous===undefined)delete process.env[name];else process.env[name]=previous;}
  }
});
test('malformed selected fields/worker status and conflicting immutable copies never produce partial views',async()=>{
  const invalid=fixture();invalid.history.products[0].jahit[0].total='999';absentView(await invalid.execute(),'not_ready');
  const conflict=fixture();conflict.history.products[0].arsip=[{id:'synthetic-archive',jahit:[{...conflict.history.products[0].jahit[0],total:999.76}]}];absentView(await conflict.execute(),'not_ready');
  const matching=fixture();matching.history.products[0].arsip=[{id:'synthetic-archive',jahit:[copy(matching.history.products[0].jahit[0])]}];const result=await matching.execute();assert.equal(result.ok,true);assert.equal(result.view.records.length,1);assert.equal(result.view.records[0].copyCount,2);assert.equal(result.view.records[0].stored.total,999.75);
});
test('descriptor getters and inherited serialization hooks cannot execute or alter private outputs',async()=>{
  let reads=0;const request={};Object.defineProperty(request,'idToken',{enumerable:true,get(){reads++;return 'synthetic-token';}});absentView(await fixture().execute(request),'invalid_request');
  const source=fixture();Object.defineProperty(source.history.scope,'snapshotVersion',{enumerable:true,get(){reads++;return VERSION;}});absentView(await source.execute(),'not_ready');
  const loader=fixture();Object.defineProperty(loader.historySource,'read',{enumerable:true,get(){reads++;return async()=>loader.history;}});absentView(await loader.execute(),'unavailable');assert.equal(reads,0);
  const f=fixture(),service=Service.createProductionLegacyHistoryService(f.options),oldObject=Object.getOwnPropertyDescriptor(Object.prototype,'toJSON'),oldArray=Object.getOwnPropertyDescriptor(Array.prototype,'toJSON');let answer;
  try{
    Object.defineProperty(Object.prototype,'toJSON',{configurable:true,get(){reads++;throw Error('synthetic-secret');}});Object.defineProperty(Array.prototype,'toJSON',{configurable:true,value(){reads++;return [];}});
    answer=await service.execute(REQUEST);
  }finally{if(oldObject)Object.defineProperty(Object.prototype,'toJSON',oldObject);else delete Object.prototype.toJSON;if(oldArray)Object.defineProperty(Array.prototype,'toJSON',oldArray);else delete Array.prototype.toJSON;}
  assert.equal(reads,0);assert.equal(answer.ok,true);assert.equal(answer.view.records[0].stored.total,999.75);
});
test('selected token/UserRecord accessors fail without invocation; unknown record fields stay private',async()=>{
  let reads=0;const f=fixture();f.auth.verifyIdToken=async()=>{const token=copy(f.token);Object.defineProperty(token,'email',{enumerable:true,get(){reads++;return token.email;}});return token;};absentView(await f.execute(),'access_denied');assert.equal(reads,0);
  const user=fixture();user.auth.getUser=async()=>{const record=copy(user.user);Object.defineProperty(record,'providerData',{enumerable:true,get(){reads++;return [];}});return record;};absentView(await user.execute(),'access_denied');assert.equal(reads,0);
});
test('fixed admission, capacity and dependency failures are generic and perform no writes',async()=>{
  const denied=fixture();denied.options.admit=async()=>false;absentView(await denied.execute(),'rate_limited');assert.equal(denied.stats.historyReads,0);
  const failed=fixture();failed.historySource.read=async()=>{throw Error('synthetic-secret-history');};absentView(await failed.execute(),'unavailable');
  const failedAuth=fixture();failedAuth.auth.getUser=async()=>{throw Error('synthetic-secret-user');};absentView(await failedAuth.execute(),'access_denied');
  const large=fixture();large.history.products[0].unused='x'.repeat(Service.MAX_HISTORY_BYTES);absentView(await large.execute(),'capacity_limit');assert.equal(large.stats.writes,0);
  const workers=fixture();workers.history.workers={};for(let i=0;i<Service.MAX_WORKERS+1;i++)workers.history.workers['synthetic-worker-'+i]={division:'jahit',reviewed:true};absentView(await workers.execute(),'capacity_limit');
});
