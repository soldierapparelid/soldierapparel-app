'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const State=require('../server/production-identity-state.cjs');
const Adapter=require('../server/production-tenant-adapter.cjs');
const Enrollment=require('../server/production-enrollment-service.cjs');
const Session=require('../server/production-session-service.cjs');
const History=require('../server/production-legacy-history-service.cjs');
const F=require('./fixtures/identity-tenant.cjs');
function fixture(value=F.claimed()){
  const store={value:F.copy(value)},stats={auth:0,users:0,gets:0,transactions:0,commits:0,history:0,offs:0},hooks={};
  const who=F.identity(),seconds=Date.parse(F.NOW)/1000;
  const token={uid:who.uid,sub:who.uid,aud:F.PROJECT,iss:'https://securetoken.google.com/'+F.PROJECT,email:who.email,email_verified:true,firebase:{sign_in_provider:'google.com',identities:{'google.com':[who.googleSubject]}},auth_time:seconds-1,iat:seconds-1,exp:seconds+3600};
  const record={uid:who.uid,email:who.email,emailVerified:true,disabled:false,providerData:[{providerId:'google.com',uid:who.googleSubject,email:who.email}]};
  const snapshot=()=>({val:()=>F.copy(store.value)});
  const ref={toString:()=>F.URL+'/authorityTenants/'+F.TENANT,async get(){stats.gets++;return snapshot();},on(event,cb){assert.equal(event,'value');queueMicrotask(cb);},off(){stats.offs++;},async transaction(update,_complete,applyLocally){
    stats.transactions++;assert.equal(applyLocally,false);if(hooks.callback)hooks.callback();const next=update(F.copy(store.value));
    if(next===undefined)return {committed:false,snapshot:snapshot()};store.value=F.copy(next);stats.commits++;
    if(hooks.loseAck){hooks.loseAck=false;throw Error('SYNTHETIC_PRIVATE_ACK');}return {committed:true,snapshot:snapshot()};
  }};
  const database={app:{options:{projectId:F.PROJECT,databaseURL:F.URL}},ref(path){assert.equal(path,'authorityTenants/'+F.TENANT);return ref;}};
  const auth={app:{options:{projectId:F.PROJECT}},async verifyIdToken(_value,revoked){stats.auth++;assert.equal(revoked,true);return F.copy(token);},async getUser(uid){stats.users++;assert.equal(uid,record.uid);return F.copy(record);}};
  const scope={enabled:true,projectId:F.PROJECT,databaseURL:F.URL,tenantId:F.TENANT,database,auth,clock:()=>F.NOW};
  const request={idToken:'synthetic-identity-token'},history={schemaVersion:1,scope:{projectId:F.PROJECT,databaseURL:F.URL,tenantId:F.TENANT,snapshotVersion:'archive-1'},policy:History.SOURCE_POLICY,reviewed:true,immutable:true,workers:{'worker-1':{division:'jahit',reviewed:true},'worker-2':{division:'jahit',reviewed:true}},products:[{id:'old-product',namaBarang:'Synthetic old item',jahit:[{id:'old-row',tukangId:'worker-1',jumlah:2.5,tarif:7,total:55.75,dibayar:false},{id:'foreign-row',tukangId:'worker-2',jumlah:4,tarif:20,total:80}]}]};
  const historySource={...history.scope,path:'legacyStoredHistoryArchives/'+F.TENANT+'/archive-1',async read(){stats.history++;if(hooks.history)hooks.history();return F.copy(history);}};
  return {store,stats,hooks,token,record,scope,request,history,historySource,ref,
    session:()=>Session.createProductionSessionService({...scope,admit:async()=>true}).execute(request),
    enroll:()=>Enrollment.createProductionEnrollmentService(scope).execute(request),
    readHistory:()=>History.createProductionLegacyHistoryService({...scope,snapshotVersion:'archive-1',historySource,admit:async()=>true}).execute(request)};
}
test('adapter grants admit validated v2 identity without permitting production reads or commands',async()=>{
  const f=fixture(),adapter=Adapter.createProductionTenantAdapter(f.scope);
  assert.deepEqual(await adapter.repository.readGrant({projectId:F.PROJECT,uid:'partner-1'}),{projectId:F.PROJECT,uid:'partner-1',revision:1,profile:{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}}});
  await assert.rejects(adapter.repository.readCycle({projectId:F.PROJECT,productId:'fake-product',cycleId:'fake-cycle'}));
  await assert.rejects(adapter.repository.selectTariff({projectId:F.PROJECT,productId:'fake-product',cycleId:'fake-cycle',workerId:'worker-1',countId:'fake-count',workDate:'2026-10-06',selectedAt:F.NOW}));
  const result=await adapter.gateway.run({projectId:F.PROJECT,productId:'fake-product',cycleId:'fake-cycle',expectedTrust:{projectId:F.PROJECT,uid:'partner-1',grant:{},cycleConfig:{},tariff:null},update(){throw Error('must not run');}}).catch(()=>null);
  assert.equal(result,null);assert.equal(f.stats.commits,0);
});
test('session DTO returns only this active caller with empty cycle lists and no roster, catalog or money',async()=>{
  const f=fixture();f.token.auth_time-=86400;const response=await f.session();assert.equal(response.ok,true);
  assert.deepEqual(response.session,{schemaVersion:1,projectId:F.PROJECT,databaseURL:F.URL,tenantId:F.TENANT,uid:'partner-1',grantRevision:1,profile:{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}},cycles:[],workerLabels:[]});
  const text=JSON.stringify(response);for(const key of ['enrollmentRegistry','workerCatalog','initialization','syntheticpartner@gmail.com','owner-1','worker-2','total'])assert.equal(text.includes(key),false);
});
test('owner identity session exposes no catalog and its tariff view stays closed until a v1 production migration',async()=>{
  const f=fixture();f.token.uid=f.token.sub='owner-1';const session=await f.session();assert.equal(session.ok,true);assert.deepEqual(session.session.profile,{active:true,owner:true});
  const result=await Session.createProductionOwnerTariffService({...f.scope,admit:async()=>true}).execute({...f.request,selection:{productId:'fake-product',cycleId:'fake-cycle'}});
  assert.deepEqual(result,{ok:false,error:'not_ready'});assert.equal(f.stats.commits,0);
});
test('first v2 enrollment commits catalog-only identity and quota in one CAS without adding production facts',async()=>{
  const f=fixture(F.tenant()),before=F.copy(f.store.value);assert.deepEqual(await f.enroll(),{ok:true});
  assert.equal(f.stats.commits,1);assert.equal(f.stats.users,1);assert.equal(f.stats.offs,1);
  assert.deepEqual(f.store.value.initialization,before.initialization);assert.deepEqual(f.store.value.workerCatalog,before.workerCatalog);assert.equal(Object.hasOwn(f.store.value,'products'),false);
  State.validateIdentityTenant(f.store.value,{projectId:F.PROJECT,tenantId:F.TENANT});assert.equal((await f.session()).ok,true);
});
test('v2 enrollment acknowledgment loss preserves one grant and a verified replay resolves safely',async()=>{
  const f=fixture(F.tenant());f.hooks.loseAck=true;assert.deepEqual(await f.enroll(),{ok:false,error:'result_unknown'});
  assert.equal(f.store.value.grants['partner-1'].revision,1);assert.deepEqual(await f.enroll(),{ok:true});assert.equal(f.store.value.grants['partner-1'].revision,1);
});
test('a pending v2 revocation before the enrollment callback cannot produce a grant',async()=>{
  const f=fixture(F.tenant());f.hooks.callback=()=>{f.store.value=F.copy(State.revokeIdentityEnrollment(f.store.value,{requestId:'pending-revoke',approvalId:'approval-1',expectedApprovalRevision:1},F.NOW).next);};
  assert.deepEqual(await f.enroll(),{ok:false,error:'access_denied'});assert.equal(f.stats.commits,0);assert.equal(Object.hasOwn(f.store.value.grants,'partner-1'),false);
});
test('v2 retained revocation denies enrollment and session while preserving inactive observation for admission checks',async()=>{
  const revoked=State.revokeIdentityEnrollment(F.claimed(),F.revokeCommand(),F.NOW).next,f=fixture(revoked);
  assert.deepEqual(await f.enroll(),{ok:false,error:'access_denied'});assert.deepEqual(await f.session(),{ok:false,error:'access_denied'});assert.equal(f.stats.commits,0);
  const grant=await Adapter.createProductionTenantAdapter(f.scope).repository.readGrant({projectId:F.PROJECT,uid:'partner-1'});assert.equal(grant.profile.active,false);assert.equal(grant.revision,2);
});
test('v2 stored history uses same-snapshot catalog binding and returns exact stored own values',async()=>{
  const f=fixture();f.token.auth_time-=86400;const before=F.copy(f.store.value),response=await f.readHistory();assert.equal(response.ok,true);
  assert.equal(response.view.records.length,1);assert.deepEqual(response.view.records[0].stored,{jumlah:2.5,tarif:7,total:55.75,dibayar:false});assert.equal(response.view.binding.workerId,'worker-1');
  for(const marker of ['worker-2','foreign-row','enrollmentRegistry','initialization',F.EMAIL])assert.equal(JSON.stringify(response).includes(marker),false);
  assert.equal(f.stats.auth,2);assert.equal(f.stats.users,2);assert.equal(f.stats.commits,0);assert.deepEqual(f.store.value,before);
});
test('history rejects revoked, QC, owner and forged grants before accessing stored wages',async()=>{
  for(const kind of ['revoked','qc','owner','forged']){
    const f=fixture();if(kind==='revoked')f.store.value=F.copy(State.revokeIdentityEnrollment(f.store.value,F.revokeCommand(),F.NOW).next);
    if(kind==='qc'){f.store.value=F.copy(State.claimIdentityEnrollment(f.store.value,F.identity({uid:'quality-1',email:F.QC_EMAIL,googleSubject:'2000123456789'}),F.NOW).next);f.token.uid=f.token.sub=f.record.uid='quality-1';f.token.email=f.record.email=f.record.providerData[0].email=F.QC_EMAIL;f.token.firebase.identities['google.com']=[f.record.providerData[0].uid='2000123456789'];}
    if(kind==='owner'){f.token.uid=f.token.sub=f.record.uid='owner-1';}
    if(kind==='forged')f.store.value.grants['partner-1'].profile.workerId='worker-2';
    assert.equal((await f.readHistory()).ok,false);assert.equal(f.stats.history,0);
  }
});
test('v2 reads reject a replacement Google subject for the same UID even when current Auth matches',async()=>{
  const f=fixture();f.token.firebase.identities['google.com']=['replacement-subject'];f.record.providerData[0].uid='replacement-subject';
  assert.deepEqual(await f.session(),{ok:false,error:'access_denied'});assert.deepEqual(await f.readHistory(),{ok:false,error:'access_denied'});assert.equal(f.stats.history,0);
});
test('catalog provenance and grant revocation after archive loading discard the entire history response',async()=>{
  for(const change of [f=>{f.store.value=F.copy(State.revokeIdentityEnrollment(f.store.value,F.revokeCommand(),F.NOW).next);},f=>{f.store.value.initialization.bootstrapId='changed-bootstrap';},f=>{f.store.value.workerCatalog.workers['worker-1'].division='potong';}]){
    const f=fixture();f.hooks.history=()=>change(f);const answer=await f.readHistory();assert.equal(answer.ok,false);assert.equal(Object.hasOwn(answer,'view'),false);assert.equal(f.stats.history,1);
  }
});
test('v2 session and enrollment reject foreign-production additions rather than pruning them',async()=>{
  for(const field of ['products','ownerCommandLedger','tariffCommandLedger']){const f=fixture(F.tenant());f.store.value[field]={};assert.equal((await f.session()).ok,false);assert.equal((await f.enroll()).ok,false);assert.equal(f.stats.commits,0);}
});
test('absent tenant preserves the existing fixed not_ready session response',async()=>{
  const f=fixture();f.store.value=null;assert.deepEqual(await f.session(),{ok:false,error:'not_ready'});assert.equal(f.stats.commits,0);
});
