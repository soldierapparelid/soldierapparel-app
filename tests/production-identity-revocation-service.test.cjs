'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Service=require('../server/production-identity-revocation-service.cjs'),State=require('../server/production-identity-state.cjs');
const F=require('./fixtures/identity-tenant.cjs');
function fixture(value=F.claimed()){
  const store={value:F.copy(value)},stats={verify:0,users:0,reads:0,transactions:0,commits:0,admit:0,off:0},hooks={},control={now:F.NOW};
  const second=Date.parse(F.NOW)/1000,token={uid:'owner-1',sub:'owner-1',aud:F.PROJECT,iss:'https://securetoken.google.com/'+F.PROJECT,email:'syntheticowner@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com',identities:{'google.com':['owner-google-subject']}},auth_time:second-86400,iat:second-60,exp:second+3600};
  const record={uid:'owner-1',email:token.email,emailVerified:true,disabled:false,providerData:[{providerId:'google.com',uid:'owner-google-subject',email:token.email}]};
  const app={options:{projectId:F.PROJECT,databaseURL:F.URL}},authApp={options:{projectId:F.PROJECT}};
  const snap=(value=store.value)=>({ref:reference,val:()=>F.copy(value)});
  const reference={toString:()=>F.URL+'/authorityTenants/'+F.TENANT,async get(){stats.reads++;if(hooks.read)hooks.read(stats.reads);return snap();},on(_event,cb){if(hooks.warm)hooks.warm();queueMicrotask(cb);},off(){stats.off++;},async transaction(update,_complete,applyLocally){
    stats.transactions++;assert.equal(applyLocally,false);if(hooks.callback)hooks.callback();
    if(hooks.cold){assert.equal(update(null),undefined);return {committed:false,snapshot:snap()};}
    let candidate=update(F.copy(store.value));if(hooks.retry){hooks.retry();candidate=update(F.copy(store.value));}
    if(candidate===undefined)return {committed:false,snapshot:snap()};store.value=F.copy(candidate);stats.commits++;
    if(hooks.afterCommit)hooks.afterCommit();if(hooks.loseAck){hooks.loseAck=false;throw Error('PRIVATE_SYNTHETIC_ACK');}
    if(hooks.badAck)return {committed:true,snapshot:snap({broken:true})};if(hooks.badFlag)return {committed:'unknown',snapshot:snap()};return {committed:true,snapshot:snap()};
  }};
  const database={app,ref(path){assert.equal(path,'authorityTenants/'+F.TENANT);return reference;}};
  const auth={app:authApp,async verifyIdToken(_token,revoked){stats.verify++;assert.equal(revoked,true);if(hooks.verify)await hooks.verify(stats.verify);return F.copy(token);},async getUser(uid){stats.users++;assert.equal(uid,token.uid);if(hooks.user)hooks.user(stats.users);return F.copy(record);}};
  const options={enabled:true,projectId:F.PROJECT,databaseURL:F.URL,tenantId:F.TENANT,database,auth,clock:()=>control.now,admit:async q=>{stats.admit++;assert.deepEqual(q,{projectId:F.PROJECT,uid:token.uid});if(hooks.admit)hooks.admit();return hooks.denyAdmit!==true;}};
  const request={idToken:'synthetic.owner.token',command:F.revokeCommand()},create=()=>Service.createProductionIdentityRevocationService(options);
  return {store,stats,hooks,control,token,record,options,database,auth,app,authApp,reference,request,create};
}
function safeResponse(v){const text=JSON.stringify(v);for(const secret of ['synthetic.owner.token','syntheticowner@gmail.com','owner-google-subject','owner-1','partner-1','approval-1','PRIVATE_SYNTHETIC'])assert.equal(text.includes(secret),false);assert.ok(Object.isFrozen(v));}
test('OFF touches no request, credential, SDK, clock or non-enabled option accessor',async()=>{
  let calls=0;const options={enabled:false};for(const k of ['database','auth','clock'])Object.defineProperty(options,k,{get(){calls++;throw Error('private');}});
  const request={get idToken(){calls++;throw Error('private');}};const service=Service.createProductionIdentityRevocationService(options);assert.deepEqual(await service.execute(request),{ok:false,error:'service_disabled'});assert.deepEqual(await service.resolve(request),{ok:false,error:'service_disabled'});assert.equal(calls,0);
});
test('owner ordinary session revokes only the selected grant and retains unrelated state',async()=>{
  const f=fixture(),before=F.copy(f.store.value),result=await f.create().execute(f.request);assert.deepEqual(result,{ok:true,replayed:false,approvalRevision:3,grantRevision:2});safeResponse(result);
  assert.equal(f.stats.commits,1);assert.equal(f.stats.verify,2);assert.equal(f.stats.users,2);assert.equal(f.stats.off,1);
  assert.deepEqual(f.store.value.initialization,before.initialization);assert.deepEqual(f.store.value.workerCatalog,before.workerCatalog);assert.deepEqual(f.store.value.enrollmentRegistry.approvals['approval-q'],before.enrollmentRegistry.approvals['approval-q']);State.validateIdentityTenant(f.store.value,{projectId:F.PROJECT,tenantId:F.TENANT});
});
test('replay and readonly resolve confirm the same retained command without a second mutation',async()=>{
  const f=fixture(),service=f.create();await service.execute(f.request);const before=F.copy(f.store.value);const result=await service.execute(f.request),resolved=await service.resolve(f.request);
  assert.deepEqual(result,{ok:true,replayed:true,approvalRevision:3,grantRevision:2});assert.deepEqual(resolved,result);assert.equal(f.stats.commits,1);assert.deepEqual(f.store.value,before);
});
test('pending revocation creates no UID grant and no fabricated wage or production fact',async()=>{
  const f=fixture(F.tenant());f.request.command={requestId:'pending-revoke',approvalId:'approval-1',expectedApprovalRevision:1};const before=F.copy(f.store.value.grants),result=await f.create().execute(f.request);
  assert.deepEqual(result,{ok:true,replayed:false,approvalRevision:2});assert.deepEqual(f.store.value.grants,before);assert.equal(Object.hasOwn(f.store.value,'products'),false);safeResponse(result);
});
test('unknown, partner, QC and token-supplied owner roles cannot authorize the writer',async()=>{
  for(const uid of ['unknown','partner-1','quality-1']){const f=fixture();f.token.uid=f.token.sub=f.record.uid=uid;f.token.owner=true;f.token.profile={owner:true};const result=await f.create().execute(f.request);assert.equal(result.ok,false);assert.equal(f.stats.transactions,0);assert.equal(f.stats.commits,0);safeResponse(result);}
});
test('disabled, expired, wrong provider/project and mismatched current Google records deny before CAS',async()=>{
  for(const mutate of [f=>{f.record.disabled=true;},f=>{f.token.exp=Date.parse(F.NOW)/1000;},f=>{f.token.firebase.sign_in_provider='password';},f=>{f.token.aud='demo-other-project';},f=>{f.record.providerData[0].uid='replacement-subject';}]){const f=fixture();mutate(f);const result=await f.create().execute(f.request);assert.equal(result.ok,false);assert.equal(f.stats.transactions,0);safeResponse(result);}
});
test('body roles, unexpected command fields, request selectors and token getters never become authority',async()=>{
  for(const request of [{idToken:'synthetic.owner.token',command:F.revokeCommand(),owner:true},{idToken:'synthetic.owner.token',command:{...F.revokeCommand(),profile:{owner:true}}},{idToken:'synthetic.owner.token',command:{...F.revokeCommand(),uid:'partner-1'}}]){const f=fixture(),result=await f.create().execute(request);assert.equal(result.ok,false);assert.equal(f.stats.commits,0);safeResponse(result);}
  let calls=0;const f=fixture();assert.deepEqual(await f.create().execute({get idToken(){calls++;throw Error('private');},command:F.revokeCommand()}),{ok:false,error:'invalid_request'});assert.equal(calls,0);assert.equal(f.stats.verify,0);
});
test('incorrect revisions and a different command cannot overwrite or acknowledge another revoke',async()=>{
  const f=fixture(),service=f.create();await service.execute(f.request);const before=F.copy(f.store.value);const result=await service.resolve({...f.request,command:{...f.request.command,requestId:'different-revoke'}});assert.deepEqual(result,{ok:false,error:'conflict'});assert.deepEqual(f.store.value,before);assert.equal(f.stats.commits,1);
});
test('uncertain acknowledgments remain unknown until a fresh same-command resolve',async()=>{
  for(const flag of ['loseAck','badAck','badFlag']){const f=fixture();f.hooks[flag]=true;const service=f.create(),result=await service.execute(f.request);assert.deepEqual(result,{ok:false,error:'result_unknown',retrySameCommand:true});assert.equal(f.stats.commits,1);safeResponse(result);assert.deepEqual(await service.resolve(f.request),{ok:true,replayed:true,approvalRevision:3,grantRevision:2});}
});
test('resolve without a retained receipt is read-only and remains unknown',async()=>{
  const f=fixture(),before=F.copy(f.store.value),result=await f.create().resolve(f.request);assert.deepEqual(result,{ok:false,error:'result_unknown',retrySameCommand:true});assert.equal(f.stats.transactions,0);assert.deepEqual(f.store.value,before);
});
test('canonical owner or catalog drift before the callback aborts every mutation',async()=>{
  for(const mutate of [f=>{f.store.value.grants['owner-1'].profile.active=false;},f=>{f.store.value.initialization.bootstrapId='changed-bootstrap';},f=>{f.store.value.workerCatalog.workers['worker-2'].division='potong';}]){const f=fixture();f.hooks.callback=()=>mutate(f);const result=await f.create().execute(f.request);assert.equal(result.ok,false);assert.equal(f.stats.commits,0);safeResponse(result);}
});
test('unrelated canonical enrollment during a callback retry is preserved',async()=>{
  const f=fixture();f.hooks.retry=()=>{f.store.value=F.copy(State.claimIdentityEnrollment(f.store.value,F.identity({uid:'quality-1',email:F.QC_EMAIL,googleSubject:'2000123456789'}),F.NOW).next);};
  assert.equal((await f.create().execute(f.request)).ok,true);assert.equal(f.store.value.grants['quality-1'].profile.modules.qc,true);assert.equal(f.store.value.grants['partner-1'].profile.active,false);
});
test('scope or pinned SDK method drift is latched across later retry callbacks',async()=>{
  const f=fixture(),original=f.reference.get;f.hooks.callback=()=>{f.reference.get=async()=>{throw Error('private');};};f.hooks.retry=()=>{f.reference.get=original;};
  const result=await f.create().execute(f.request);assert.equal(result.ok,false);assert.equal(f.stats.commits,0);safeResponse(result);
});
test('post-commit Auth disable or token expiry never reports the mutation as definitely unsaved',async()=>{
  for(const mutate of [f=>{f.record.disabled=true;},f=>{f.control.now='2026-10-06T05:00:00.000Z';}]){const f=fixture();f.hooks.afterCommit=()=>mutate(f);const result=await f.create().execute(f.request);assert.deepEqual(result,{ok:false,error:'result_unknown',retrySameCommand:true});assert.equal(f.stats.commits,1);}
});
test('expiry while warming denies before any callback write and cleans subscriptions',async()=>{
  const f=fixture();f.hooks.warm=()=>{f.control.now='2026-10-06T05:00:00.000Z';};const result=await f.create().execute(f.request);assert.equal(result.ok,false);assert.equal(f.stats.commits,0);assert.equal(f.stats.off,1);
});
test('cold null cannot bootstrap a tenant, and rejected admission performs no mutation',async()=>{
  const cold=fixture();cold.hooks.cold=true;assert.equal((await cold.create().execute(cold.request)).ok,false);assert.equal(cold.stats.commits,0);
  const denied=fixture();denied.hooks.denyAdmit=true;assert.deepEqual(await denied.create().execute(denied.request),{ok:false,error:'rate_limited'});assert.equal(denied.stats.transactions,0);
});
test('configuration rebinding, foreign snapshot and ordinary production emulator environment are rejected',async()=>{
  const bad=fixture();bad.app.options.databaseURL='https://demo-other-project.firebaseio.com';assert.deepEqual(await bad.create().execute(bad.request),{ok:false,error:'unavailable'});assert.equal(bad.stats.commits,0);
  const foreign=fixture();foreign.reference.get=async()=>({ref:{toString:()=>F.URL+'/authorityTenants/other'},val:()=>foreign.store.value});assert.deepEqual(await foreign.create().execute(foreign.request),{ok:false,error:'unavailable'});assert.equal(foreign.stats.transactions,0);
  const previous=process.env.FIREBASE_DATABASE_EMULATOR_HOST;try{process.env.FIREBASE_DATABASE_EMULATOR_HOST='127.0.0.1:9000';const f=fixture();assert.deepEqual(await f.create().execute(f.request),{ok:false,error:'unavailable'});}finally{if(previous===undefined)delete process.env.FIREBASE_DATABASE_EMULATOR_HOST;else process.env.FIREBASE_DATABASE_EMULATOR_HOST=previous;}
});
test('one in-flight operation stays held through SDK awaits without inspecting a concurrent request',async()=>{
  const f=fixture();let release;f.hooks.verify=()=>new Promise(resolve=>{release=resolve;});const service=f.create(),pending=service.execute(f.request);await new Promise(resolve=>setImmediate(resolve));let reads=0;
  assert.deepEqual(await service.resolve({get idToken(){reads++;throw Error('private');}}),{ok:false,error:'busy'});assert.equal(reads,0);f.hooks.verify=null;release();assert.equal((await pending).ok,true);
});
