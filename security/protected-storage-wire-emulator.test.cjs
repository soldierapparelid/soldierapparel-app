'use strict';
// Genuine SDK storage/Rules proof in a separate, fixed loopback demo namespace.
// Synthetic claims only; no Google Auth, managed OAuth or production proof.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const HOST='127.0.0.1:9000',PROJECT='demo-soldier-protected-wire';
const CREDENTIAL_ENV=['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN_FILE','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT'];
function fence(){assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST,HOST);assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,undefined);assert.ok(CREDENTIAL_ENV.every(k=>process.env[k]===undefined));}
fence();
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {SDK_VERSION}=require('firebase/app');
const {ref,get,set,remove,runTransaction,onValue}=require('firebase/database');
assert.equal(SDK_VERSION,'10.12.2');
const Scope=require('../server/apps-script/protected-storage-scope.cjs');
const F=require('../tests/fixtures/identity-tenant.cjs');
const binding=Object.freeze({projectId:PROJECT,databaseURL:'https://'+PROJECT+'.firebaseio.com',tenantId:'synthetic-protected-wire-tenant'});
let env,sequence=0;
function bounded(promise,label,ms=7000){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),ms);})]).finally(()=>clearTimeout(timer));}
async function admin(fn){fence();let result;await bounded(env.withSecurityRulesDisabled(async context=>{fence();result=await fn(context.database());}),'synthetic protected storage SDK timeout');fence();return result;}
async function observe(pathname){return admin(async db=>(await get(ref(db,pathname))).val());}
before(async()=>{
  fence();env=await bounded(initializeTestEnvironment({projectId:PROJECT,database:{host:'127.0.0.1',port:9000,rules:fs.readFileSync(path.join(__dirname,'database.rules.json'),'utf8')}}),'synthetic protected namespace initialization timeout');
});
after(async()=>{if(env)await bounded(env.cleanup(),'synthetic protected namespace cleanup timeout');});
function source(photo='structured'){
  const tenant=F.tenant();tenant.projectId=PROJECT;tenant.tenantId=binding.tenantId;
  const rows=[{id:'synthetic-product-1',jahit:[{id:'synthetic-last-report',jumlah:1,tarif:12.5,total:999.75,unknown:{nullField:null,emptyArray:[],emptyMap:{}}}],unknown:null}];
  const production={produksi:rows,emptyList:[],emptyMap:{},nullable:null};
  if(photo!=='absent')production.images=photo==='structured'?{nullable:null,emptyList:[],emptyMap:{},numericMap:{'0':null,'2':{label:'synthetic-image',empty:[]}},unicode:'synthetic-\u2603'}:photo;
  return {soldier:{produksi:production,produksi_meta:{tukangJahit:[]},unknownOwnerOnly:{nullable:null,emptyArray:[],emptyMap:{},decimal:333.75,numericMap:{'0':{marker:'first'},'2':{marker:'third'},'9':null},denseMap:{'0':{marker:'first'},'1':{marker:'second'}}}},authorityTenants:{[binding.tenantId]:tenant},unknownRoot:{nullable:null,emptyArray:[],emptyMap:{},unicode:'synthetic-\u2603'}};
}
function prepared(original,marker){const result=Scope.prepareProtectedMigration({root:original,binding,migrationId:marker,expectedRootETag:'"synthetic-original"'});assert.equal(result.ok,true);assert.equal(typeof result.nextRoot[Scope.KEY].working.data,'string');assert.equal(typeof result.nextRoot[Scope.KEY].photos.data,'string');return result;}
async function acquire(t,original=source()){
  const marker='protected-wire-proof-'+process.pid+'-'+(++sequence),p=prepared(original,marker);let owned=false;
  // Cleanup is registered before SDK reference/transaction construction. It
  // removes only a subtree whose retained manifest still proves this fixture.
  t.after(async()=>{
    if(!owned)return;fence();assert.match(marker,/^protected-wire-proof-[1-9][0-9]*-[1-9][0-9]*$/);
    await admin(async db=>{const branch=ref(db,Scope.KEY),stored=(await get(branch)).val();assert.equal(stored?.manifest?.migrationId,marker);await remove(branch);});
  });
  await admin(async db=>{
    const branch=ref(db,Scope.KEY);let unsubscribe;
    try{
      await bounded(new Promise((resolve,reject)=>{unsubscribe=onValue(branch,snapshot=>resolve(snapshot.exists()),reject);}),'synthetic protected ownership observation timeout',5000);
      const result=await bounded(runTransaction(branch,current=>current===null?p.nextRoot[Scope.KEY]:undefined,{applyLocally:false}),'synthetic protected absent-subtree acquisition timeout');
      assert.equal(result.committed,true,'protected fixture must acquire an absent subtree');owned=true;
    }finally{unsubscribe?.();}
  });
  const scope=Scope.createProtectedStorageScope({enabled:true,binding,migration:p.migration});
  return {original,prepared:p,scope,marker,get:()=>observe(Scope.KEY)};
}
function rollback(stored){const r=Scope.prepareProtectedRollback({protectedRoot:{[Scope.KEY]:stored},expectedRootETag:'"synthetic-wire-observed"'});assert.equal(r.ok,true);return r.nextRoot;}

test('genuine SDK retains complete scalar envelopes and exact original null/empty/map/decimal shape',{timeout:30000},async t=>{
  const f=await acquire(t),stored=await f.get();
  assert.deepEqual(stored,f.prepared.nextRoot[Scope.KEY]);
  assert.equal(stored.working.data,f.prepared.nextRoot[Scope.KEY].working.data);assert.equal(stored.photos.data,f.prepared.nextRoot[Scope.KEY].photos.data);
  assert.deepEqual(rollback(stored),f.original);
  const decoded=f.scope.readWorking({working:stored.working});assert.equal(decoded.ok,true);
  const expected=F.copy(f.original);delete expected.soldier.produksi.images;assert.deepEqual(decoded.root,expected);
  assert.equal(Array.isArray(decoded.root.soldier.unknownOwnerOnly.denseMap),false);
  assert.deepEqual(Object.keys(decoded.root.soldier.unknownOwnerOnly.numericMap),['0','2','9']);
  assert.equal(decoded.root.soldier.unknownOwnerOnly.decimal,333.75);
});

test('genuine SDK preserves explicit empty/null/absent photo variants without inventing images',{timeout:30000},async t=>{
  const original=source(null),f=await acquire(t,original);
  for(const variant of [null,[],{},'absent']){
    const next=source(variant),p=prepared(next,f.marker);await admin(db=>set(ref(db,Scope.KEY),p.nextRoot[Scope.KEY]));
    const stored=await f.get();assert.deepEqual(stored,p.nextRoot[Scope.KEY]);assert.deepEqual(rollback(stored),next);
    assert.equal(Object.hasOwn(rollback(stored).soldier.produksi,'images'),variant!=='absent');
  }
});

test('genuine SDK deleting the last report retains an explicit empty array and preserves separate photos',{timeout:30000},async t=>{
  const f=await acquire(t),before=await f.get(),decoded=f.scope.readWorking({working:before.working});assert.equal(decoded.ok,true);
  const next=F.copy(decoded.root);next.soldier.produksi.produksi[0].jahit=[];next.soldier.unknownOwnerOnly.newEmptyMap={};
  const proposal=f.scope.prepareWorkingWrite({working:before.working,nextRoot:next,expectedRevision:1});assert.equal(proposal.ok,true);
  await admin(db=>set(ref(db,Scope.PATHS.working),proposal.nextWorking));const after=await f.get();
  assert.deepEqual(after.photos,before.photos);assert.deepEqual(after.manifest,before.manifest);assert.equal(after.working.revision,2);
  const read=f.scope.readWorking({working:after.working});assert.equal(read.ok,true);assert.deepEqual(read.root,next);
  assert.ok(Array.isArray(read.root.soldier.produksi.produksi[0].jahit));assert.equal(read.root.soldier.produksi.produksi[0].jahit.length,0);
  assert.deepEqual(read.root.soldier.unknownOwnerOnly.newEmptyMap,{});
  const expected=F.copy(f.original);expected.soldier.produksi.produksi[0].jahit=[];expected.soldier.unknownOwnerOnly.newEmptyMap={};assert.deepEqual(rollback(after),expected);
});

test('genuine SDK owner photo update retains explicit empty/null shape without changing working records',{timeout:30000},async t=>{
  const f=await acquire(t),before=await f.get(),who=F.identity({projectId:PROJECT,uid:'owner-1',email:'synthetic.owner@gmail.com',googleSubject:'synthetic-owner-google'}),images={present:true,value:{nullable:null,emptyList:[],emptyMap:{},numericMap:{'0':null,'8':{marker:'synthetic'}}}};
  const proposal=f.scope.prepareOwnerPhotoWrite({working:before.working,photos:before.photos,identity:who,now:F.NOW,expectedWorkingRevision:1,expectedPhotoRevision:1,images});assert.equal(proposal.ok,true);
  await admin(db=>set(ref(db,Scope.PATHS.photos),proposal.nextPhotos));const after=await f.get();assert.deepEqual(after.working,before.working);assert.deepEqual(after.manifest,before.manifest);assert.equal(after.photos.revision,2);
  const read=f.scope.readOwnerPhotos({working:after.working,photos:after.photos,identity:who,now:F.NOW});assert.equal(read.ok,true);assert.deepEqual(read.images,images);
  const expected=F.copy(f.original);expected.soldier.produksi.images=images.value;assert.deepEqual(rollback(after),expected);
});

test('genuine restrictive Rules deny all direct internal envelope reads/writes including an approved owner',{timeout:30000},async t=>{
  const f=await acquire(t),before=await f.get(),suffix=process.pid+'-'+sequence,users=[['owner',{active:true,owner:true}],['jahit',{active:true,modules:{jahit:true}}],['qc',{active:true,modules:{qc:true}}]],positivePath='soldier/produksi/protected-wire-control-'+suffix;
  const ownedPaths=[];
  t.after(async()=>{for(const pathname of ownedPaths)await admin(async db=>{const pointer=ref(db,pathname),v=(await get(pointer)).val();assert.equal(v?.__protectedWireMarker,f.marker);await remove(pointer);});});
  await admin(async db=>{
    const positive=ref(db,positivePath);assert.equal((await get(positive)).exists(),false);await set(positive,{__protectedWireMarker:f.marker});ownedPaths.push(positivePath);
    for(const [role,profile]of users){const pathname='accessControl/users/protected-wire-'+role+'-'+suffix,pointer=ref(db,pathname);assert.equal((await get(pointer)).exists(),false);await set(pointer,{...profile,__protectedWireMarker:f.marker});ownedPaths.push(pathname);}
  });
  const clients=[env.unauthenticatedContext().database()];
  for(const [role]of users){const client=env.authenticatedContext('protected-wire-'+role+'-'+suffix,{email:'synthetic.'+role+'@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}}).database();await bounded(assertSucceeds(get(ref(client,positivePath))),'synthetic approved positive control timeout');clients.push(client);}
  const targets=[Scope.PATHS.root,Scope.PATHS.working,Scope.PATHS.working+'/data',Scope.PATHS.photos,Scope.PATHS.photos+'/data'];
  for(const client of clients)for(const pathname of targets){
    fence();await bounded(assertFails(get(ref(client,pathname))),'synthetic protected denied read timeout');await bounded(assertFails(set(ref(client,pathname),'synthetic-denied-replacement')),'synthetic protected denied replacement timeout');await bounded(assertFails(remove(ref(client,pathname))),'synthetic protected denied deletion timeout');
  }
  assert.deepEqual(await f.get(),before);
});
