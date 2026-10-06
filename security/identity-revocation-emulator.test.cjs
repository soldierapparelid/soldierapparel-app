'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const HOST='127.0.0.1:9000',PROJECT='demo-soldier-security',URL='https://'+PROJECT+'.firebaseio.com';
const CREDENTIAL_ENV=['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN_FILE','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT'];
const fence=()=>{assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST,HOST);assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,undefined);assert.ok(CREDENTIAL_ENV.every(k=>process.env[k]===undefined));};fence();
const {initializeApp,deleteApp,SDK_VERSION}=require('firebase-admin/app'),{getDatabase}=require('firebase-admin/database');assert.equal(SDK_VERSION,'14.5.0');
const Service=require('../server/production-identity-revocation-service.cjs'),State=require('../server/production-identity-state.cjs'),F=require('../tests/fixtures/identity-tenant.cjs');let sequence=0;
async function fixture(t){
  fence();const n=++sequence,tenantId='identity-revocation-proof-'+n,app=initializeApp({projectId:PROJECT,databaseURL:URL,credential:{getAccessToken:async()=>({access_token:'owner',expires_in:3600})}},'identity-revocation-'+n),database=getDatabase(app),ref=database.ref('authorityTenants/'+tenantId);
  assert.equal(ref.toString(),'http://'+HOST+'/authorityTenants/'+tenantId);t.after(async()=>{try{fence();assert.match(tenantId,/^identity-revocation-proof-[1-9][0-9]*$/);await ref.remove();}finally{await deleteApp(app);}});
  const seed=F.tenant();seed.projectId=PROJECT;seed.tenantId=tenantId;const value=State.claimIdentityEnrollment(seed,F.identity({projectId:PROJECT}),F.NOW).next;await ref.set(value);
  const control={uid:'owner-1',disabled:false},seconds=Date.parse(F.NOW)/1000;
  const auth={app:{options:{projectId:PROJECT}},async verifyIdToken(_token,revoked){fence();assert.equal(revoked,true);return {uid:control.uid,sub:control.uid,aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,email:'syntheticowner@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com',identities:{'google.com':['owner-google']}},auth_time:seconds-86400,iat:seconds-60,exp:seconds+3600};},async getUser(uid){fence();return {uid,email:'syntheticowner@gmail.com',emailVerified:true,disabled:control.disabled,providerData:[{providerId:'google.com',uid:'owner-google',email:'syntheticowner@gmail.com'}]};}};
  const options={enabled:true,projectId:PROJECT,databaseURL:URL,tenantId,database,auth,clock:()=>F.NOW,admit:async()=>true,testOnlyEmulator:true},request={idToken:'synthetic-owner-token',command:F.revokeCommand()};
  return {value,scope:{projectId:PROJECT,tenantId},control,ref,options,request,create:()=>Service.createProductionIdentityRevocationService(options),get:async()=>{fence();return (await ref.get()).val();}};
}
test('genuine SDK owner adapter commits a retained revoke and exposes no private identifiers',{timeout:30000},async t=>{
  const f=await fixture(t),service=f.create(),response=await service.execute(f.request);assert.deepEqual(response,{ok:true,replayed:false,approvalRevision:3,grantRevision:2});
  const stored=await f.get();State.validateIdentityTenant(stored,f.scope);assert.equal(stored.grants['partner-1'].profile.active,false);assert.equal(stored.grants['partner-1'].revision,2);
  assert.deepEqual(stored.initialization,f.value.initialization);assert.deepEqual(stored.workerCatalog,f.value.workerCatalog);assert.deepEqual(stored.enrollmentRegistry.approvals['approval-q'],f.value.enrollmentRegistry.approvals['approval-q']);
  assert.deepEqual(await service.resolve(f.request),{ok:true,replayed:true,approvalRevision:3,grantRevision:2});assert.deepEqual(await service.execute(f.request),{ok:true,replayed:true,approvalRevision:3,grantRevision:2});assert.deepEqual(await f.get(),stored);
});
test('genuine SDK adapter rejects a partner and disabled owner without changing canonical data',{timeout:30000},async t=>{
  const f=await fixture(t),before=await f.get();f.control.uid='partner-1';assert.equal((await f.create().execute(f.request)).ok,false);f.control.uid='owner-1';f.control.disabled=true;assert.deepEqual(await f.create().execute(f.request),{ok:false,error:'access_denied'});assert.deepEqual(await f.get(),before);
});
test('genuine pending revoke creates no grant and exact command replay survives RTDB storage',{timeout:30000},async t=>{
  const f=await fixture(t);f.request.command={requestId:'revoke-quality-pending',approvalId:'approval-q',expectedApprovalRevision:1};const response=await f.create().execute(f.request);assert.deepEqual(response,{ok:true,replayed:false,approvalRevision:2});const stored=await f.get();assert.deepEqual(stored.grants,f.value.grants);assert.equal(stored.enrollmentRegistry.approvals['approval-q'].status,'revoked');assert.deepEqual(await f.create().resolve(f.request),{ok:true,replayed:true,approvalRevision:2});
});
test('genuine adapter rejects mismatched revisions and readonly resolution of an absent receipt',{timeout:30000},async t=>{
  const f=await fixture(t),before=await f.get();assert.deepEqual(await f.create().resolve(f.request),{ok:false,error:'result_unknown',retrySameCommand:true});assert.deepEqual(await f.create().execute({...f.request,command:{...f.request.command,expectedGrantRevision:2}}),{ok:false,error:'conflict'});assert.deepEqual(await f.get(),before);
});
test('real commit with an injected lost acknowledgment resolves only through the same retained command',{timeout:30000},async t=>{
  const f=await fixture(t),genuine=f.options.database.ref('authorityTenants/'+f.scope.tenantId);let lost=false;
  const wrapped={toString:genuine.toString.bind(genuine),get:genuine.get.bind(genuine),on:genuine.on.bind(genuine),off:genuine.off.bind(genuine),async transaction(...args){const result=await genuine.transaction(...args);if(result.committed&&!lost){lost=true;throw Error('SYNTHETIC_ACK_LOSS_AFTER_REAL_COMMIT');}return result;}};
  f.options.database={app:f.options.database.app,ref(path){assert.equal(path,'authorityTenants/'+f.scope.tenantId);return wrapped;}};const service=f.create();assert.deepEqual(await service.execute(f.request),{ok:false,error:'result_unknown',retrySameCommand:true});assert.equal((await f.get()).grants['partner-1'].profile.active,false);
  assert.deepEqual(await service.resolve(f.request),{ok:true,replayed:true,approvalRevision:3,grantRevision:2});assert.deepEqual(await service.resolve({...f.request,command:{...f.request.command,requestId:'foreign-command'}}),{ok:false,error:'conflict'});
});
