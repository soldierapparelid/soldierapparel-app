'use strict';
// Genuine RTDB SDK loopback proof, synthetic Auth only. Fence before SDK load.
const {test}=require('node:test'),assert=require('node:assert/strict');
const HOST='127.0.0.1:9000',PROJECT='demo-soldier-security',URL='https://'+PROJECT+'.firebaseio.com';
const CREDENTIAL_ENV=['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN_FILE','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT'];
const fence=()=>{assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST,HOST);assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,undefined);assert.ok(CREDENTIAL_ENV.every(k=>process.env[k]===undefined));};fence();
const {initializeApp,deleteApp,SDK_VERSION}=require('firebase-admin/app'),{getDatabase}=require('firebase-admin/database');assert.equal(SDK_VERSION,'14.5.0');
const Service=require('../server/production-legacy-operations-service.cjs'),Core=require('../server/production-legacy-operations.cjs'),State=require('../server/production-identity-state.cjs'),F=require('../tests/fixtures/identity-tenant.cjs');
const POLICY={version:'legacy-jahit-current-v1',reviewed:true,timeZone:'Asia/Jakarta',quantityBasis:'good-plus-reject'},TOKEN='synthetic.operations.token';let sequence=0;
function soldierFixture(numericMaps=false){
  const product={id:'product-1',series:'Synthetic',namaBarang:'Shirt',size:'M',poAktif:true,poJumlah:20,poTanggal:'2026-10-01',assignJahit:[{id:'assignment-1',tukangId:'worker-1',qty:20,sisa:16}],jahit:[{id:'old-operation',tanggal:'2026-10-01',jumlah:4,lolos:3,rijek:1,tukangId:'worker-1',assignmentId:'assignment-1',tarif:10,total:999.75,dibayar:true}],arsip:[]};
  const other={id:'product-other',series:'Other',namaBarang:'Synthetic',size:'L',poAktif:true,poJumlah:10,assignJahit:[{id:'assignment-other',tukangId:'worker-2',qty:10,sisa:10}],jahit:[]};
  const workers=[{id:'worker-1',nama:'Synthetic Partner',tarif:{'Synthetic|Shirt':12.5}},{id:'worker-2',nama:'Other Partner',tarif:{'Other|Synthetic':20}}];
  if(numericMaps){product.assignJahit={'0':product.assignJahit[0]};product.jahit={'old-report':product.jahit[0]};}
  return {produksi:{produksi:numericMaps?{'0':product,'2':other}:[product,other]},produksi_meta:{tukangJahit:numericMaps?{'0':workers[0],'2':workers[1]}:workers},unknownOwnerOnly:{untouchedFraction:23.5,emptyArray:[],emptyMap:{},...(numericMaps?{numericDensity:{'0':{keep:'first'},'2':{keep:'third'}}}:{marker:'synthetic'})}};
}
async function fixture(t,numericMaps=false){
  fence();const n=++sequence,marker='legacy-operations-root-proof-'+process.pid+'-'+n,tenantId=marker,credential={getAccessToken:async()=>({access_token:'owner',expires_in:3600})},app=initializeApp({projectId:PROJECT,databaseURL:URL,credential},marker),database=getDatabase(app),rootRef=database.ref(''),soldierRef=database.ref('soldier'),tenantRef=database.ref('authorityTenants/'+tenantId),ledgerRef=database.ref('legacyOperationReceipts/'+tenantId);
  assert.equal(rootRef.toString(),'http://'+HOST+'/');let acquired=false;
  t.after(async()=>{try{fence();assert.match(marker,/^legacy-operations-root-proof-[1-9][0-9]*-[1-9][0-9]*$/);if(acquired){const current=(await soldierRef.get()).val();assert.equal(current.__legacyOperationsFixture,marker);await soldierRef.remove();}await tenantRef.remove();await ledgerRef.remove();}finally{await deleteApp(app);}});
  // Own only an absent synthetic subtree. Never reset/delete the RTDB root or
  // overwrite another fixture's soldier branch; the server retries this CAS.
  const soldier={...soldierFixture(numericMaps),__legacyOperationsFixture:marker};
  const acquiredResult=await soldierRef.transaction(current=>current===null?soldier:undefined,undefined,false);assert.equal(acquiredResult.committed,true,'soldier fixture must acquire an absent marked subtree');acquired=true;
  const seed=F.tenant();seed.projectId=PROJECT;seed.tenantId=tenantId;const tenant=State.claimIdentityEnrollment(seed,F.identity({projectId:PROJECT}),F.NOW).next;await tenantRef.set(tenant);
  const control={uid:'partner-1',subject:'1000123456789',email:F.EMAIL,disabled:false},seconds=Date.parse(F.NOW)/1000;
  const auth={app,async verifyIdToken(token,revoked){fence();assert.equal(token,TOKEN);assert.equal(revoked,true);return {uid:control.uid,sub:control.uid,aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,email:control.email,email_verified:true,firebase:{sign_in_provider:'google.com',identities:{'google.com':[control.subject]}},auth_time:seconds-86400,iat:seconds-60,exp:seconds+3600};},async getUser(uid){fence();return {uid,email:control.email,emailVerified:true,disabled:control.disabled,providerData:[{providerId:'google.com',uid:control.subject,email:control.email}]};}};
  const options={enabled:true,projectId:PROJECT,databaseURL:URL,tenantId,database,auth,clock:()=>F.NOW,admit:async()=>true,tariffPolicy:POLICY,testOnlyEmulator:true},get=async()=>{fence();return (await rootRef.get()).val();},service=Service.createProductionLegacyOperationsService(options);
  // Source version comes from actual SDK storage representation, after null
  // pruning/numeric-map normalization. No serialized seed is adopted as proof.
  const view=await service.read({idToken:TOKEN});assert.equal(view.ok,true);const command={kind:'appendJahit',requestId:'request-1',operationId:'operation-1',productId:'product-1',assignmentId:'assignment-1',expectedGrantRevision:1,expectedSourceVersion:view.view.products.find(p=>p.productId==='product-1').sourceVersion,workDate:null,good:2,reject:1};
  return {marker,tenantId,rootRef,soldierRef,tenantRef,ledgerRef,options,control,view,command,get,service,input:()=>({idToken:TOKEN,command:{...command}})};
}
function product(root){return Object.values(root.soldier.produksi.produksi).find(p=>p&&p.id==='product-1');}
function sewing(p){return Object.values(p.jahit||{}).filter(Boolean);}
test('genuine root CAS preserves SDK-pruned old money and unknown source data with exact replay/resolve',{timeout:30000},async t=>{
  const f=await fixture(t),before=await f.get(),old=sewing(product(before))[0],unknown=before.soldier.unknownOwnerOnly;
  assert.equal(Object.hasOwn(unknown,'emptyArray'),false);assert.equal(Object.hasOwn(unknown,'emptyMap'),false);
  assert.deepEqual(await f.service.execute(f.input()),{ok:true,replayed:false,operationId:'operation-1'});const after=await f.get();
  assert.deepEqual(sewing(product(after))[0],old);assert.equal(old.total,999.75);assert.deepEqual(after.soldier.unknownOwnerOnly,unknown);assert.deepEqual(after.authorityTenants,before.authorityTenants);
  for(const k of Object.keys(before))if(!['soldier','legacyOperationReceipts'].includes(k))assert.deepEqual(after[k],before[k]);
  assert.equal(sewing(product(after)).filter(r=>r.id==='operation-1').length,1);assert.equal(after.legacyOperationReceipts[f.tenantId].commands['request-1'].operationId,'operation-1');
  assert.deepEqual(await f.service.resolve(f.input()),{ok:true,replayed:true,operationId:'operation-1'});assert.deepEqual(await f.service.execute(f.input()),{ok:true,replayed:true,operationId:'operation-1'});assert.deepEqual(await f.get(),after);
});
test('genuine numeric collection normalization and map-shaped reports remain compatible across root ACK',{timeout:30000},async t=>{
  const f=await fixture(t,true),before=await f.get(),old=sewing(product(before))[0],unknown=before.soldier.unknownOwnerOnly;
  assert.deepEqual(await f.service.execute(f.input()),{ok:true,replayed:false,operationId:'operation-1'});const after=await f.get();assert.deepEqual(after.soldier.unknownOwnerOnly,unknown);assert.deepEqual(sewing(product(after))[0],old);assert.equal(Array.isArray(product(after).jahit),false);assert.equal(product(after).jahit['operation-1'].total,25);assert.deepEqual(await f.service.resolve(f.input()),{ok:true,replayed:true,operationId:'operation-1'});
});
test('genuine CAS observes a revoked retained grant and cannot append a report afterward',{timeout:30000},async t=>{
  const f=await fixture(t),before=await f.get(),next=State.revokeIdentityEnrollment(before.authorityTenants[f.tenantId],F.revokeCommand(),F.NOW).next;await f.tenantRef.set(next);
  const response=await f.service.execute(f.input());assert.equal(response.ok,false);const after=await f.get();assert.deepEqual(after.soldier,before.soldier);assert.equal(after.legacyOperationReceipts?.[f.tenantId],undefined);
});
test('genuine committed root with injected ACK loss resolves only its retained exact command',{timeout:30000},async t=>{
  const f=await fixture(t),genuine=f.rootRef;let lost=false;
  const wrapped={toString:genuine.toString.bind(genuine),get:genuine.get.bind(genuine),on:genuine.on.bind(genuine),off:genuine.off.bind(genuine),async transaction(...args){const r=await genuine.transaction(...args);if(r.committed&&!lost){lost=true;throw Error('SYNTHETIC_ACK_LOSS_AFTER_REAL_ROOT_COMMIT');}return r;}};
  f.options.database={app:f.options.database.app,ref(path){assert.equal(path,'');return wrapped;}};const service=Service.createProductionLegacyOperationsService(f.options);
  assert.deepEqual(await service.execute(f.input()),{ok:false,error:'result_unknown',retrySameCommand:true});assert.equal(sewing(product(await f.get())).filter(r=>r.id==='operation-1').length,1);
  assert.deepEqual(await service.resolve(f.input()),{ok:true,replayed:true,operationId:'operation-1'});assert.deepEqual(await service.resolve({idToken:TOKEN,command:{...f.command,good:3}}),{ok:false,error:'conflict'});
});
test('genuine read-only missing-receipt resolution and wrong source version leave root source unchanged',{timeout:30000},async t=>{
  const f=await fixture(t),before=await f.get();assert.deepEqual(await f.service.resolve(f.input()),{ok:false,error:'result_unknown',retrySameCommand:true});assert.deepEqual(await f.service.execute({idToken:TOKEN,command:{...f.command,expectedSourceVersion:'0'.repeat(64)}}),{ok:false,error:'conflict'});assert.deepEqual(await f.get(),before);
});
test('genuine product tombstone arriving before root CAS prevents a compatible append',{timeout:30000},async t=>{
  const f=await fixture(t),genuine=f.rootRef,before=await f.get(),markerRef=f.options.database.ref('soldier/produksi_deleted_ids');
  const wrapped={toString:genuine.toString.bind(genuine),get:genuine.get.bind(genuine),on:genuine.on.bind(genuine),off:genuine.off.bind(genuine),async transaction(...args){await markerRef.set('["product-1"]');return genuine.transaction(...args);}};
  f.options.database={app:f.options.database.app,ref(path){assert.equal(path,'');return wrapped;}};const response=await Service.createProductionLegacyOperationsService(f.options).execute(f.input());assert.equal(response.ok,false);
  const after=await f.get();assert.deepEqual(product(after),product(before));assert.equal(after.soldier.produksi_deleted_ids,'["product-1"]');assert.equal(after.legacyOperationReceipts?.[f.tenantId],undefined);
});
test('genuine explicit row tombstone blocks exact replay without removing the old committed source row',{timeout:30000},async t=>{
  const f=await fixture(t);assert.equal((await f.service.execute(f.input())).ok,true);const before=await f.get(),marker='{"product-1|jahit|id:operation-1":'+Date.parse(F.NOW)+'}';await f.options.database.ref('soldier/produksi_deletions').set(marker);
  assert.equal((await f.service.resolve(f.input())).ok,false);assert.equal((await f.service.execute(f.input())).ok,false);const after=await f.get();assert.deepEqual(product(after),product(before));assert.equal(after.soldier.produksi_deletions,marker);assert.deepEqual(after.legacyOperationReceipts,before.legacyOperationReceipts);
});
