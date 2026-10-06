'use strict';
// Genuine isolated storage-shape rehearsal only, not an operator writer or
// production Auth, grant, membership, revocation or migration proof.
const {test}=require('node:test'),assert=require('node:assert/strict');
const PROJECT='demo-soldier-security',HOST='127.0.0.1:9000',URL='https://'+PROJECT+'.firebaseio.com';
const CREDENTIAL_ENV=['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN_FILE','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT'];
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST,HOST);
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,undefined);
assert.ok(CREDENTIAL_ENV.every(k=>process.env[k]===undefined),'real credentials are forbidden');
assert.ok(Number(process.versions.node.split('.')[0])>=22);
const {initializeApp,deleteApp,SDK_VERSION}=require('firebase-admin/app');
const {getDatabase}=require('firebase-admin/database');
assert.equal(SDK_VERSION,'14.5.0');
const Identity=require('../server/production-identity-tenant.cjs');
const Adapter=require('../server/production-tenant-adapter.cjs');
const copy=v=>JSON.parse(JSON.stringify(v));
const OWNER='synthetic-owner',WORKER='synthetic-worker';
let sequence=0;
function prepare(scope,extra={}){
  return Identity.createInitialIdentityTenantPreparer({enabled:true,scope}).prepare({ownerUid:OWNER,bootstrapId:'synthetic-bootstrap',initializedAt:'2026-10-06T01:00:00.000Z',workerCatalog:{schemaVersion:1,revision:1,reviewed:true,workers:{[WORKER]:{division:'jahit',reviewed:true}}},...extra});
}
function fenced(ref,tenantId,child){
  assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST,HOST);
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,undefined);
  assert.match(tenantId,/^identity-initial-proof-[1-9][0-9]*$/);
  assert.ok(child===undefined||['candidate','v1-control','numeric-control'].includes(child));
  assert.equal(ref.toString(),'http://'+HOST+'/identityTenantInitialProof/'+tenantId+(child?'/'+child:''));
}
async function fixture(t){
  const n=++sequence,tenantId='identity-initial-proof-'+n;
  const credential={getAccessToken:async()=>({access_token:'owner',expires_in:3600})};
  const app=initializeApp({projectId:PROJECT,databaseURL:URL,credential},'identity-initial-'+n),db=getDatabase(app);
  const parent=db.ref('identityTenantInitialProof/'+tenantId);fenced(parent,tenantId);
  t.after(async()=>{try{fenced(parent,tenantId);await parent.remove();}finally{await deleteApp(app);}});
  const scope={projectId:PROJECT,tenantId};
  function ref(child){const r=parent.child(child);fenced(r,tenantId,child);return r;}
  const prepared=prepare(scope);assert.equal(prepared.ok,true);
  const candidate=prepared.tenant;
  assert.ok(candidate&&candidate.schemaVersion===2,'preparer must return a candidate initial tenant');
  return {scope,ref,parent,candidate,prepared};
}

test('genuine SDK roundtrip preserves the entire initial identity-only v2 without fake production facts', {timeout:30000},async t=>{
  const f=await fixture(t),ref=f.ref('candidate');await ref.set(f.candidate);const stored=(await ref.get()).val();
  assert.deepEqual(stored,f.candidate);assert.deepEqual(Identity.validateInitialIdentityTenant(stored,f.scope),f.candidate);
  assert.deepEqual(Object.keys(stored).sort(),['grants','initialization','projectId','schemaVersion','tenantId','workerCatalog']);
  assert.deepEqual(Object.keys(stored.grants),[OWNER]);assert.deepEqual(stored.grants[OWNER],{revision:1,profile:{active:true,owner:true}});
  assert.equal(Object.isFrozen(Identity.validateInitialIdentityTenant(stored,f.scope).workerCatalog.workers),true);
  for(const k of ['authProven','grantWritten','authorizationGranted','migrated','readyForProduction'])assert.equal(f.prepared[k],false);
  assert.equal(f.prepared.preparedOnly,true);
});

test('actual pruning cannot turn an incomplete populated v1 into an accepted empty identity tenant', {timeout:30000},async t=>{
  const f=await fixture(t),ref=f.ref('v1-control');
  const v1={schemaVersion:1,projectId:PROJECT,tenantId:f.scope.tenantId,grants:copy(f.candidate.grants),products:{}};
  await ref.set(v1);const stored=(await ref.get()).val();assert.equal(Object.hasOwn(stored,'products'),false);
  assert.throws(()=>Adapter.validateCanonicalTenant(stored,f.scope));assert.throws(()=>Identity.validateInitialIdentityTenant(stored,f.scope));
  assert.throws(()=>Adapter.validateCanonicalTenant(f.candidate,f.scope),'v1 production validator remains closed to identity-only v2');
});

test('actual SDK numeric-key map coercion is modeled by rejection without changing selected IDs', {timeout:30000},async t=>{
  const f=await fixture(t),ref=f.ref('numeric-control');await ref.set({workers:{0:{division:'jahit',reviewed:true}},grants:{0:{revision:1,profile:{active:true,owner:true}}}});
  const stored=(await ref.get()).val();assert.equal(Array.isArray(stored.workers),true);assert.equal(Array.isArray(stored.grants),true);
  assert.equal(prepare(f.scope,{ownerUid:'0'}).ok,false);
  assert.equal(prepare(f.scope,{workerCatalog:{schemaVersion:1,revision:1,reviewed:true,workers:{0:{division:'jahit',reviewed:true}}}}).ok,false);
  assert.equal((await f.ref('candidate').get()).val(),null);
});

test('independent SDK-stored owner, catalog and foreign-production tampering remains invalid', {timeout:30000},async t=>{
  const f=await fixture(t),ref=f.ref('candidate');
  for(const change of [v=>{v.grants['synthetic-other']=copy(v.grants[OWNER]);},v=>{v.grants[OWNER].profile.workerId=WORKER;},v=>{v.workerCatalog.workers[WORKER].reviewed=false;},v=>{v.initialization.ownerUid='synthetic-other';},v=>{v.products={synthetic:{cycles:{future:{active:true}}}};},v=>{v.ownerCommandLedger={schemaVersion:1};}]){
    const candidate=copy(f.candidate);change(candidate);await ref.set(candidate);const stored=(await ref.get()).val();assert.throws(()=>Identity.validateInitialIdentityTenant(stored,f.scope));
  }
  await ref.set(f.candidate);assert.deepEqual(Identity.validateInitialIdentityTenant((await ref.get()).val(),f.scope),f.candidate);
});
