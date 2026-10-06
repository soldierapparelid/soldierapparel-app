'use strict';
// Real RTDB SDK against an isolated demo only. Auth is an injected verifier;
// this fixture does not prove real Google login, production access or billing.
const {test}=require('node:test'),assert=require('node:assert/strict');
const PROJECT='demo-soldier-security',HOST='127.0.0.1:9000',URL='https://'+PROJECT+'.firebaseio.com';
const CREDENTIAL_ENV=['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN_FILE','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT'];
const fence=()=>{assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST,HOST);assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,undefined);assert.ok(CREDENTIAL_ENV.every(k=>process.env[k]===undefined),'real credentials forbidden');};
fence();const {initializeApp,deleteApp,SDK_VERSION}=require('firebase-admin/app'),{getDatabase}=require('firebase-admin/database');assert.equal(SDK_VERSION,'14.5.0');
const State=require('../server/production-identity-state.cjs'),Service=require('../server/production-enrollment-service.cjs'),Adapter=require('../server/production-tenant-adapter.cjs'),Session=require('../server/production-session-service.cjs');
const F=require('../tests/fixtures/identity-tenant.cjs');let sequence=0;
async function fixture(t){
  fence();const n=++sequence,tenantId='identity-state-proof-'+n;
  const app=initializeApp({projectId:PROJECT,databaseURL:URL,credential:{getAccessToken:async()=>({access_token:'owner',expires_in:3600})}},'identity-state-'+n),database=getDatabase(app);
  const ref=database.ref('authorityTenants/'+tenantId);assert.equal(ref.toString(),'http://'+HOST+'/authorityTenants/'+tenantId);
  t.after(async()=>{try{fence();assert.match(tenantId,/^identity-state-proof-[1-9][0-9]*$/);await ref.remove();}finally{await deleteApp(app);}});
  const seed=F.tenant();seed.projectId=PROJECT;seed.tenantId=tenantId;
  const who=F.identity({projectId:PROJECT}),seconds=Date.parse(F.NOW)/1000;
  const auth={app:{options:{projectId:PROJECT}},async verifyIdToken(_token,revoked){fence();assert.equal(revoked,true);return {uid:who.uid,sub:who.uid,aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,email:who.email,email_verified:true,firebase:{sign_in_provider:'google.com',identities:{'google.com':[who.googleSubject]}},auth_time:seconds-1,iat:seconds-1,exp:seconds+3600};},async getUser(uid){fence();assert.equal(uid,who.uid);return {uid,email:who.email,emailVerified:true,disabled:false,providerData:[{providerId:'google.com',uid:who.googleSubject,email:who.email}]};}};
  const scope={projectId:PROJECT,tenantId},options={enabled:true,projectId:PROJECT,databaseURL:URL,tenantId,database,auth,clock:()=>F.NOW,testOnlyEmulator:{host:'127.0.0.1',port:9000}};
  const get=async()=>{fence();return (await ref.get()).val();};await ref.set(seed);
  return {seed,scope,options,who,ref,get,claim:()=>Service.createProductionEnrollmentService(options).execute({idToken:'synthetic-identity-token'})};
}
test('genuine SDK preserves owner, reviewed catalog and private pending approvals without production facts',{timeout:30000},async t=>{
  const f=await fixture(t),stored=await f.get();assert.deepEqual(stored,f.seed);assert.deepEqual(State.validateIdentityTenant(stored,f.scope),f.seed);
  for(const key of ['products','ownerCommandLedger','tariffCommandLedger','rates','money'])assert.equal(Object.hasOwn(stored,key),false);
});
test('genuine enrollment CAS grants only the reviewed sewing identity and keeps unrelated QC pending',{timeout:30000},async t=>{
  const f=await fixture(t);assert.deepEqual(await f.claim(),{ok:true});const stored=await f.get();State.validateIdentityTenant(stored,f.scope);
  assert.deepEqual(stored.grants['partner-1'],{revision:1,profile:{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}}});
  assert.deepEqual(stored.workerCatalog,f.seed.workerCatalog);assert.deepEqual(stored.initialization,f.seed.initialization);assert.deepEqual(stored.enrollmentRegistry.approvals['approval-q'],f.seed.enrollmentRegistry.approvals['approval-q']);assert.equal(Object.hasOwn(stored,'products'),false);
});
test('genuine separate service instances share persisted enrollment quota and keep one grant',{timeout:30000},async t=>{
  const f=await fixture(t);for(let n=0;n<8;n++)assert.deepEqual(await f.claim(),{ok:true});assert.deepEqual(await f.claim(),{ok:false,error:'rate_limited'});
  const stored=await f.get();assert.equal(stored.grants['partner-1'].revision,1);assert.equal(stored.enrollmentRegistry.approvals['approval-1'].admission.count,8);State.validateIdentityTenant(stored,f.scope);
});
test('genuine retained revoke CAS and exact replay preserve identity, disable grant and deny enrollment',{timeout:30000},async t=>{
  const f=await fixture(t);assert.deepEqual(await f.claim(),{ok:true});const before=await f.get(),cmd=F.revokeCommand();
  // Test-owned SDK transaction exercises the pure transition. There is no
  // implemented production owner-authenticated revocation writer in this test.
  // A genuine SDK get() does not keep the transaction cache populated. Hold
  // a bounded subscription; its snapshot is never used as commit authority.
  let listener,timer,result;
  const ready=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('synthetic warm timeout')),5000);listener=()=>{clearTimeout(timer);resolve();};f.ref.on('value',listener,reject);});
  try{await ready;result=await f.ref.transaction(value=>{fence();if(value===null)return;return State.revokeIdentityEnrollment(value,cmd,F.NOW).next;},undefined,false);}finally{clearTimeout(timer);f.ref.off('value',listener);}
  assert.equal(result.committed,true);
  const stored=await f.get(),replay=State.revokeIdentityEnrollment(stored,cmd,F.NOW);assert.equal(replay.replayed,true);assert.deepEqual(replay.next,stored);
  assert.equal(stored.grants['partner-1'].revision,2);assert.equal(stored.grants['partner-1'].profile.active,false);assert.deepEqual(stored.enrollmentRegistry.approvals['approval-1'].claim,before.enrollmentRegistry.approvals['approval-1'].claim);
  assert.deepEqual(await f.claim(),{ok:false,error:'access_denied'});State.validateIdentityTenant(await f.get(),f.scope);
});
test('genuine v2 access readers expose only self while production and tariff validators remain v1-only',{timeout:30000},async t=>{
  const f=await fixture(t);assert.deepEqual(await f.claim(),{ok:true});const adapter=Adapter.createProductionTenantAdapter(f.options);
  const grant=await adapter.repository.readGrant({projectId:PROJECT,uid:'partner-1'});assert.equal(grant.profile.workerId,'worker-1');
  const response=await Session.createProductionSessionService({...f.options,admit:async()=>true}).execute({idToken:'synthetic-token'});assert.equal(response.ok,true);assert.deepEqual(response.session.cycles,[]);assert.deepEqual(response.session.workerLabels,[]);
  assert.equal(JSON.stringify(response).includes('enrollmentRegistry'),false);await assert.rejects(adapter.repository.readCycle({projectId:PROJECT,productId:'invented-product',cycleId:'invented-cycle'}));
  assert.throws(()=>Adapter.validateCanonicalTenant(f.seed,f.scope));
});
test('genuine stored orphan and foreign-production additions are rejected without implicit repair',{timeout:30000},async t=>{
  const f=await fixture(t);assert.deepEqual(await f.claim(),{ok:true});const baseline=await f.get();
  for(const mutate of [v=>{v.grants.orphan={revision:1,profile:{active:true,owner:false,modules:{qc:true}}};},v=>{v.grants['partner-1'].profile.workerId='worker-2';},v=>{v.products={invented:{cycles:{invented:{active:true}}}};},v=>{v.enrollmentRegistry.approvals['approval-1'].status='revoked';}]){
    const value=F.copy(baseline);mutate(value);fence();await f.ref.set(value);const stored=await f.get();assert.throws(()=>State.validateIdentityTenant(stored,f.scope));assert.equal((await f.claim()).ok,false);assert.deepEqual(await f.get(),stored);
  }
});
