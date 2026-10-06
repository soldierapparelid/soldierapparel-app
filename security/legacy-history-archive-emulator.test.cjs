'use strict';
// Genuine pinned Admin SDK + isolated RTDB only. No Auth proof, live archive,
// grant, canonical migration, billing, deployment or immutable IAM is implied.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const PROJECT='demo-soldier-security',HOST='127.0.0.1:9000',URL='https://'+PROJECT+'.firebaseio.com';
const CREDENTIAL_ENV=['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN_FILE','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT'];
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST,HOST);
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,undefined);
assert.ok(CREDENTIAL_ENV.every(k=>process.env[k]===undefined),'real credentials are forbidden');
assert.ok(Number(process.versions.node.split('.')[0])>=22);
const {initializeApp,deleteApp,SDK_VERSION}=require('firebase-admin/app');
const {getDatabase}=require('firebase-admin/database');
assert.equal(SDK_VERSION,'14.5.0');
const Codec=require('../server/production-legacy-history-archive-codec.cjs');
const Publisher=require('../server/production-legacy-history-publisher.cjs');
const Loader=require('../server/production-legacy-history-loader.cjs');
const History=require('../legacy-stored-history.js');
const WORKER='synthetic-worker-a',OTHER='synthetic-worker-b';
const workers={[WORKER]:{division:'jahit',reviewed:true}};
const copy=v=>JSON.parse(JSON.stringify(v));
let sequence=0;
function rows(){return [null,{id:'synthetic-row',tukangId:WORKER,tanggal:null,jumlah:2.5,lolos:0,tarif:13.25,total:987.75,dibayar:'false',quantityBasis:null},{tukangId:WORKER,jumlah:0,total:0,dibayar:0}];}
function products(){
  const jahit=rows();
  return [{id:'synthetic-product',series:'Synthetic',namaBarang:'Fixture',size:null,jahit,
    arsip:[null,{id:'synthetic-archive',jahit:copy(jahit)}],
    potong:[{tukangId:WORKER,total:999}],qc:[{tukangId:WORKER,total:777}],internalCost:555},
    {id:'synthetic-empty',jahit:[],arsip:[]},
    {id:'synthetic-null',jahit:null,arsip:null}];
}
function namespace(ref,tenantId,version){
  assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST,HOST);
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,undefined);
  assert.match(tenantId,/^legacy-archive-proof-[1-9][0-9]*$/);
  assert.ok(version===undefined||['synthetic-version','raw-control'].includes(version));
  assert.equal(ref.toString(),'http://'+HOST+'/legacyStoredHistoryArchives/'+tenantId+(version?'/'+version:''));
}
async function fixture(t){
  const n=++sequence,tenantId='legacy-archive-proof-'+n,version='synthetic-version';
  const credential={getAccessToken:async()=>({access_token:'owner',expires_in:3600})};
  const a=initializeApp({projectId:PROJECT,databaseURL:URL,credential},'history-archive-a-'+n);
  const b=initializeApp({projectId:PROJECT,databaseURL:URL,credential},'history-archive-b-'+n);
  const da=getDatabase(a),db=getDatabase(b),path='legacyStoredHistoryArchives/'+tenantId+'/'+version;
  const parent=db.ref('legacyStoredHistoryArchives/'+tenantId),reference=db.ref(path);
  namespace(parent,tenantId);namespace(reference,tenantId,version);
  t.after(async()=>{try{namespace(parent,tenantId);await parent.remove();}finally{await Promise.all([deleteApp(a),deleteApp(b)]);}});
  const controls={loseAck:false,drift:false,transactions:0,callbacks:0};
  // Fault injection changes acknowledgements/callback environment only. Each
  // reference, URL, snapshot, read and actual transaction remains genuine SDK.
  const originalRef=da.ref;
  Object.defineProperty(da,'ref',{configurable:true,value:function(fixed){
    assert.equal(fixed,path);const real=originalRef.call(this,fixed),transaction=real.transaction;
    namespace(real,tenantId,version);
    Object.defineProperty(real,'transaction',{configurable:true,value:async function(update,complete,applyLocally){
      controls.transactions++;
      const result=await transaction.call(this,current=>{
        controls.callbacks++;
        if(!controls.drift)return update(current);
        controls.drift=false;process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099';
        try{return update(current);}finally{delete process.env.FIREBASE_AUTH_EMULATOR_HOST;}
      },complete,applyLocally);
      if(result.committed&&controls.loseAck){controls.loseAck=false;throw Error('SYNTHETIC_ARCHIVE_ACK_CANARY');}
      return result;
    }});
    return real;
  }});
  const scope={projectId:PROJECT,databaseURL:URL,tenantId,snapshotVersion:version};
  function prepare(source=products()){
    const r=Codec.createLegacyHistoryArchivePreparer({enabled:true,scope,workers}).prepare({products:source});
    assert.equal(r.ok,true);return r;
  }
  function publisher(candidate,database=da){return Publisher.createProductionLegacyHistoryPublisher({enabled:true,scope,publicationProof:candidate.publicationProof,database,testOnlyEmulator:true});}
  function loader(candidate,database=db){return Loader.createProductionLegacyHistoryLoader({enabled:true,scope,publicationProof:candidate.publicationProof,database,testOnlyEmulator:true});}
  async function state(){return (await reference.get()).val();}
  return {a,b,da,db,scope,tenantId,reference,parent,controls,prepare,publisher,loader,state};
}
function successful(result,replayed){
  assert.equal(result.ok,true);assert.equal(result.published,true);assert.equal(result.replayed,replayed);
  for(const k of ['immutableStoreProven','authorizationGranted','legacyAdopted','readyForProduction'])assert.equal(result[k],false);
  assert.equal(Object.isFrozen(result),true);
}
function unavailable(fn){return assert.rejects(fn,e=>e&&e.code==='unavailable'&&e.message==='unavailable');}
test('actual RTDB preserves JSON-string null/absent/zero/empty/type/idless copies and unrepriced own history', {timeout:30000},async t=>{
  const f=await fixture(t),candidate=f.prepare(),original=products();
  const r=await f.publisher(candidate).publish({archive:candidate.archive});successful(r,false);
  assert.deepEqual(await f.state(),candidate.archive);
  const logical=await f.loader(candidate).read();assert.deepEqual(logical,Codec.decodeArchive(candidate.archive,candidate.publicationProof));
  assert.equal(Object.isFrozen(logical.products[0].jahit[1]),true);
  assert.deepEqual(logical.products[0].jahit,rows());assert.equal(logical.products[0].size,null);
  assert.deepEqual(logical.products[1].jahit,[]);assert.equal(logical.products[2].jahit,null);
  assert.equal(Object.hasOwn(logical.products[0].jahit[2],'tarif'),false);
  assert.equal(Object.hasOwn(logical.products[0],'potong'),false);assert.equal(Object.hasOwn(logical.products[0],'qc'),false);assert.equal(Object.hasOwn(logical.products[0],'internalCost'),false);
  const binding={projectId:PROJECT,databaseURL:URL,tenantId:f.tenantId,uid:'synthetic-user',workerId:WORKER,division:'jahit',grantRevision:1};
  const projector=History.createLegacyStoredHistoryProjector({enabled:true,binding});
  const before=projector.project({snapshotVersion:f.scope.snapshotVersion,products:original});
  const after=projector.project({snapshotVersion:f.scope.snapshotVersion,products:logical.products});
  assert.equal(before.ok,true);assert.deepEqual(after,before);
  assert.equal(after.view.records[0].stored.total,987.75);assert.notEqual(after.view.records[0].stored.total,2.5*13.25);
  assert.equal(after.view.records[0].copyCount,2);assert.equal(after.view.records.length,3);
  const raw=f.db.ref('legacyStoredHistoryArchives/'+f.tenantId+'/raw-control');namespace(raw,f.tenantId,'raw-control');
  await raw.set(logical);const pruned=(await raw.get()).val();
  assert.equal(Object.hasOwn(pruned.products[0],'size'),false);
  assert.equal(Object.hasOwn(pruned.products[0].jahit[1],'tanggal'),false);
  assert.equal(Object.hasOwn(pruned.products[1],'jahit'),false);assert.equal(Object.hasOwn(pruned.products[1],'arsip'),false);
  assert.equal(Object.hasOwn(pruned.products[2],'jahit'),false);assert.equal(Object.hasOwn(pruned.products[2],'arsip'),false);
  assert.deepEqual(await f.state(),candidate.archive);
});

test('actual RTDB distinguishes an unavailable entire source from a known empty source', {timeout:30000},async t=>{
  for(const source of [null,[]]){
    const f=await fixture(t),candidate=f.prepare(source);successful(await f.publisher(candidate).publish({archive:candidate.archive}),false);
    const logical=await f.loader(candidate).read();assert.deepEqual(logical.products,source);assert.deepEqual(await f.state(),candidate.archive);
  }
});

test('independent genuine SDK publishers replay an exact version without replacing any stored byte', {timeout:30000},async t=>{
  const f=await fixture(t),candidate=f.prepare();successful(await f.publisher(candidate).publish({archive:candidate.archive}),false);
  const before=await f.state();successful(await f.publisher(candidate,f.db).publish({archive:candidate.archive}),true);
  successful(await f.publisher(candidate,f.db).resolve({archive:candidate.archive}),true);assert.deepEqual(await f.state(),before);
  const changed=products();changed[0].jahit[1].total=1;changed[0].arsip[1].jahit[1].total=1;
  const other=f.prepare(changed);assert.deepEqual(await f.publisher(other,f.db).publish({archive:other.archive}),{ok:false,error:'conflict'});
  assert.deepEqual(await f.state(),before);assert.equal(f.controls.transactions,1);
});

test('competing independent genuine SDK transactions retain exactly one reviewed version', {timeout:30000},async t=>{
  const f=await fixture(t),a=f.prepare(),source=products();source[0].jahit[1].total=123;source[0].arsip[1].jahit[1].total=123;
  const b=f.prepare(source),responses=await Promise.all([f.publisher(a).publish({archive:a.archive}),f.publisher(b,f.db).publish({archive:b.archive})]);
  assert.equal(responses.filter(r=>r.ok).length,1);assert.equal(responses.filter(r=>r.error==='conflict').length,1);
  const stored=await f.state(),winner=stored.digest===a.archive.digest?a:b,loser=winner===a?b:a;
  assert.deepEqual(stored,winner.archive);assert.deepEqual(await f.loader(winner).read(),Codec.decodeArchive(winner.archive,winner.publicationProof));
  await unavailable(()=>f.loader(loser).read());assert.deepEqual(await f.publisher(loser,f.db).resolve({archive:loser.archive}),{ok:false,error:'conflict'});
  assert.deepEqual(await f.state(),stored);
});

test('a rehashed blob written by a separate genuine SDK handle cannot replace the trusted loader proof', {timeout:30000},async t=>{
  const f=await fixture(t),candidate=f.prepare();successful(await f.publisher(candidate).publish({archive:candidate.archive}),false);
  const source=Codec.decodeArchive(candidate.archive,candidate.publicationProof),changed=copy(source);changed.products[0].jahit[1].total=1;
  const payload=Codec.canonicalJSON(changed),digest=createHash('sha256').update(Codec.canonicalJSON({domain:Codec.DIGEST_DOMAIN,schemaVersion:1,scope:f.scope,codec:Codec.ARCHIVE_CODEC,payload})).digest('hex');
  const forged={...copy(candidate.archive),payload,digest};await f.reference.set(forged);
  await unavailable(()=>f.loader(candidate).read());
  assert.deepEqual(await f.publisher(candidate,f.db).resolve({archive:candidate.archive}),{ok:false,error:'conflict'});assert.deepEqual(await f.state(),forged);
});

test('injected lost acknowledgement after a real commit recovers only the exact fixed archive', {timeout:30000},async t=>{
  const f=await fixture(t),candidate=f.prepare();f.controls.loseAck=true;
  const result=await f.publisher(candidate).publish({archive:candidate.archive});successful(result,true);
  assert.equal(f.controls.transactions,1);assert.ok(f.controls.callbacks>=1);assert.deepEqual(await f.state(),candidate.archive);
  successful(await f.publisher(candidate,f.db).resolve({archive:candidate.archive}),true);
  assert.deepEqual(await f.loader(candidate).read(),Codec.decodeArchive(candidate.archive,candidate.publicationProof));
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_ARCHIVE_ACK_CANARY'),false);
});

test('observed callback scope drift is latched even when restored; a separate resolve rechecks scope', {timeout:30000},async t=>{
  const f=await fixture(t),candidate=f.prepare();await f.reference.set(candidate.archive);f.controls.drift=true;
  assert.deepEqual(await f.publisher(candidate).publish({archive:candidate.archive}),{ok:false,error:'result_unknown',retrySameSnapshot:true});
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,undefined);assert.deepEqual(await f.state(),candidate.archive);
  successful(await f.publisher(candidate,f.db).resolve({archive:candidate.archive}),true);
});
