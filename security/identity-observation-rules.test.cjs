'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const HOST='127.0.0.1:9000',PROJECT='demo-soldier-security',TENANT='identity-observation-test',T='authorityTenants/'+TENANT;
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST,HOST);assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,undefined);
for(const k of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN_FILE','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT'])assert.equal(process.env[k],undefined);
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing'),{ref,get,set,update,onValue}=require('firebase/database');
const State=require('../server/production-identity-state.cjs'),F=require('../tests/fixtures/identity-tenant.cjs');let env;
const claims={aud:PROJECT,email_verified:true,firebase:{sign_in_provider:'google.com'}};
const db=(uid,changes={})=>env.authenticatedContext(uid,{...claims,...changes}).database();
const leaves=['revision','profile/active','profile/owner','profile/workerId',...['potong','jahit','qc','laporan','stok','gaji','hpp','pembelian','nota','retur'].map(m=>'profile/modules/'+m)];
function fixture(){const seed=F.tenant();seed.projectId=PROJECT;seed.tenantId=TENANT;let value=State.claimIdentityEnrollment(seed,F.identity({projectId:PROJECT}),F.NOW).next;return State.claimIdentityEnrollment(value,F.identity({projectId:PROJECT,uid:'quality-1',email:F.QC_EMAIL,googleSubject:'2000123456789'}),F.NOW).next;}
async function seed(value=fixture()){await env.withSecurityRulesDisabled(async c=>set(ref(c.database(),T),value));}
before(async()=>{env=await initializeTestEnvironment({projectId:PROJECT,database:{host:'127.0.0.1',port:9000,rules:fs.readFileSync(__dirname+'/identity-access.rules.json','utf8')}});await seed();});after(async()=>{if(env)await env.cleanup();});
test('v2 owner, sewing and QC observe only their own fourteen fixed scalar leaves',async()=>{
  await seed();for(const uid of ['owner-1','partner-1','quality-1'])for(const leaf of leaves)await assertSucceeds(get(ref(db(uid),T+'/grants/'+uid+'/'+leaf)));
  for(const uid of ['owner-1','partner-1','quality-1'])for(const other of ['owner-1','partner-1','quality-1'].filter(x=>x!==uid))await assertFails(get(ref(db(uid),T+'/grants/'+other+'/revision')));
});
test('grant and profile ancestors, private approvals/catalog/archive and legacy money cannot be discovered',async()=>{
  await seed();for(const uid of ['owner-1','partner-1','quality-1'])for(const p of ['',T,T+'/grants',T+'/grants/'+uid,T+'/grants/'+uid+'/profile',T+'/grants/'+uid+'/profile/modules',T+'/workerCatalog',T+'/initialization',T+'/enrollmentRegistry','legacyStoredHistoryArchives','soldier','serverRateLimits'])await assertFails(get(p?ref(db(uid),p):ref(db(uid))));
});
test('every browser role remains unable to create or edit a grant, catalog, approval or arbitrary leaf',async()=>{
  await seed();for(const uid of ['owner-1','partner-1','quality-1']){for(const p of [T+'/grants/'+uid+'/revision',T+'/grants/'+uid+'/profile/owner',T+'/enrollmentRegistry',T+'/workerCatalog',T+'/initialization'])await assertFails(set(ref(db(uid),p),1));await assertFails(update(ref(db(uid),T),{schemaVersion:1}));}
});
test('unauthenticated, unknown, non-Google, unverified and mismatched project claims fail closed',async()=>{
  await seed();const p=T+'/grants/partner-1/revision';await assertFails(get(ref(env.unauthenticatedContext().database(),p)));await assertFails(get(ref(db('unknown'),T+'/grants/unknown/revision')));
  for(const patch of [{email_verified:false},{aud:'demo-other-project'},{firebase:{sign_in_provider:'password'}}])await assertFails(get(ref(db('partner-1',patch),p)));
});
test('retained inactive grant revision and false active leaf remain observable to clear stale UI',async()=>{
  const initial=fixture(),revoked=State.revokeIdentityEnrollment(initial,F.revokeCommand(),F.NOW).next;await seed(revoked);
  assert.equal((await assertSucceeds(get(ref(db('partner-1'),T+'/grants/partner-1/revision')))).val(),2);assert.equal((await assertSucceeds(get(ref(db('partner-1'),T+'/grants/partner-1/profile/active')))).val(),false);
  for(const p of [T+'/products',T+'/products/fake/cycles/fake/wire/projection/operations','legacyStoredHistoryArchives/anything'])await assertFails(get(ref(db('partner-1'),p)));
});
test('malformed initialization, owner, catalog or mixed self profiles cannot pass the v2 metadata gate',async()=>{
  const changes=[v=>{v.initialization.ownerUid='missing-owner';},v=>{v.initialization.reviewed=false;},v=>{v.grants['owner-1'].revision=2;},v=>{v.workerCatalog.revision=2;},v=>{v.workerCatalog.workers['worker-1'].division='potong';},v=>{v.grants['partner-1'].profile.modules.qc=true;},v=>{v.grants['partner-1'].profile.workerId='worker-missing';},v=>{v.products={fake:{active:true}};}];
  for(const mutate of changes){const v=F.copy(fixture());mutate(v);await seed(v);await assertFails(get(ref(db('partner-1'),T+'/grants/partner-1/revision')));}
});
test('observer metadata grants no business authorization even when a privileged fixture injects an orphan',async()=>{
  const v=F.copy(fixture());v.grants.orphan={revision:1,profile:{active:true,owner:false,modules:{qc:true}}};await seed(v);
  // Rules expose only self scalars. The server's complete-state validator
  // independently rejects orphan grants; observation is not authorization.
  await assertSucceeds(get(ref(db('orphan'),T+'/grants/orphan/revision')));assert.throws(()=>State.validateIdentityTenant(v,{projectId:PROJECT,tenantId:TENANT}));
  for(const p of [T+'/grants/partner-1/revision',T+'/products/fake/cycles/fake/wire/projection/operations',T+'/enrollmentRegistry'])await assertFails(get(ref(db('orphan'),p)));
});
test('actual self-leaf subscription observes revocation without exposing another grant or private registry',async()=>{
  await seed();const observed=[],client=db('partner-1');let unsubscribe,timer;
  const result=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('synthetic observation timeout')),5000);unsubscribe=onValue(ref(client,T+'/grants/partner-1/profile/active'),s=>{observed.push(s.val());if(s.val()===false)resolve();},reject);});
  try{for(let n=0;n<50&&observed.length===0;n++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(observed[0],true);await seed(State.revokeIdentityEnrollment(fixture(),F.revokeCommand(),F.NOW).next);await result;assert.deepEqual(observed,[true,false]);}finally{clearTimeout(timer);if(unsubscribe)unsubscribe();}
});
