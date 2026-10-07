'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const Loader=require('../server/production-legacy-history-loader.cjs');
const Codec=require('../server/production-legacy-history-archive-codec.cjs');
const scope=()=>({projectId:'demo-history-loader',databaseURL:'https://demo-history-loader.firebaseio.com',tenantId:'synthetic-history-tenant',snapshotVersion:'synthetic-history-version'});
const copy=v=>structuredClone(v),worker='synthetic-sewing-worker';
function prepared(s=scope(),products){
  const source=products===undefined?[{id:'synthetic-product',series:'Synthetic',namaBarang:'Example',size:'M',jahit:[{id:'synthetic-row',tukangId:worker,tanggal:'synthetic-date',jumlah:3,tarif:0,total:7.5,dibayar:false,lolos:null}],arsip:[]}]:products;
  const answer=Codec.createLegacyHistoryArchivePreparer({enabled:true,scope:s,workers:{[worker]:{division:'jahit',reviewed:true}}}).prepare({products:source});
  assert.equal(answer.ok,true);return answer;
}
function fixture({s=scope(),products}={}){
  const preparedResult=prepared(s,products),store={archive:copy(preparedResult.archive)},hooks={get:null,val:null},stats={refs:0,reads:0,values:0,writes:0};
  const state={app:{options:{projectId:s.projectId,databaseURL:s.databaseURL}},url:s.databaseURL+'/legacyStoredHistoryArchives/'+s.tenantId+'/'+s.snapshotVersion};
  class Reference{toString(){return state.url;}async get(){stats.reads++;if(hooks.get)await hooks.get();return new Snapshot();}}
  class Snapshot{get ref(){return reference;}val(){stats.values++;if(hooks.val)hooks.val(this);return copy(store.archive);}}
  const reference=new Reference();class Database{get app(){return state.app;}ref(p){stats.refs++;assert.equal(p,'legacyStoredHistoryArchives/'+s.tenantId+'/'+s.snapshotVersion);return reference;}}
  const database=new Database(),options={enabled:true,scope:s,database,publicationProof:copy(preparedResult.publicationProof)};
  return {options,reference,database,state,stats,store,hooks,preparedResult,create:()=>Loader.createProductionLegacyHistoryLoader(options)};
}
function reviewedPayloadFixture(payload){
  const f=fixture();f.store.archive.payload=payload;
  const digest=createHash('sha256').update(Codec.canonicalJSON({domain:Codec.DIGEST_DOMAIN,schemaVersion:1,scope:f.options.scope,codec:Codec.ARCHIVE_CODEC,payload}),'utf8').digest('hex');
  f.store.archive.digest=digest;f.options.publicationProof.digest=digest;return f;
}
async function denied(source,code='unavailable'){
  await assert.rejects(()=>source.read(),error=>{
    assert.equal(error instanceof Loader.LegacyHistoryLoaderError,true);assert.equal(error.message,code);assert.equal(error.code,code);
    for(const marker of ['synthetic-secret','synthetic-date','synthetic-product','synthetic-history-tenant','7.5'])assert.equal(String(error).includes(marker),false);return true;
  });
}
test('default OFF does not read config/proof/SDK or initialize dependencies',async()=>{
  let reads=0;const options={enabled:false};for(const key of ['scope','database','publicationProof','testOnlyEmulator'])Object.defineProperty(options,key,{enumerable:true,get(){reads++;throw Error('synthetic-secret');}});
  await denied(Loader.createProductionLegacyHistoryLoader(options),'service_disabled');assert.equal(reads,0);
  const inherited=Object.create({enabled:true});await denied(Loader.createProductionLegacyHistoryLoader(inherited),'service_disabled');
});
test('fixed SDK descriptor returns frozen logical source with exact null/absent/zero/empty fidelity',async()=>{
  const f=fixture(),source=f.create(),before=copy(f.store.archive),answer=await source.read();
  assert.deepEqual(Object.keys(source).sort(),['databaseURL','path','projectId','read','snapshotVersion','tenantId']);assert.equal(Object.isFrozen(source),true);
  assert.equal(answer.scope.snapshotVersion,f.options.scope.snapshotVersion);assert.equal(answer.products[0].jahit[0].lolos,null);assert.equal(Object.hasOwn(answer.products[0].jahit[0],'rijek'),false);assert.equal(answer.products[0].jahit[0].tarif,0);assert.equal(answer.products[0].jahit[0].total,7.5);assert.deepEqual(answer.products[0].arsip,[]);
  for(const value of [answer,answer.scope,answer.workers,answer.products,answer.products[0],answer.products[0].jahit[0]])assert.equal(Object.isFrozen(value),true);
  assert.deepEqual(f.store.archive,before);assert.deepEqual(f.stats,{refs:1,reads:1,values:1,writes:0});
});
test('known empty and missing-null histories survive string storage pruning distinctly',async()=>{
  function prune(v){if(v===null)return undefined;if(v&&typeof v==='object'){const out={};for(const [k,x]of Object.entries(v)){const p=prune(x);if(p!==undefined)out[k]=p;}return Object.keys(out).length?out:undefined;}return v;}
  const empty=fixture({products:[]});empty.store.archive=prune(empty.store.archive);assert.deepEqual((await empty.create().read()).products,[]);
  const missing=fixture({products:null});missing.store.archive=prune(missing.store.archive);assert.equal((await missing.create().read()).products,null);
});
test('read accepts no caller selectors or arguments and never falls back to a legacy root',async()=>{
  const f=fixture(),source=f.create();for(const args of [[undefined],[{}],[{workerId:'other',path:'soldier',snapshotVersion:'other'}]])await assert.rejects(()=>source.read(...args),error=>error.code==='invalid_request');assert.equal(f.stats.reads,0);assert.equal(f.stats.refs,1);
  f.store.archive=null;await denied(source);assert.equal(f.stats.refs,1);
});
test('constructor rejects wrong scope/app/reference and malformed proof before any read',async()=>{
  for(const change of [f=>f.state.app.options.projectId='demo-other',f=>f.state.app.options.databaseURL='https://demo-other.firebaseio.com',f=>f.state.url+='/other',f=>f.options.publicationProof.scope.snapshotVersion='other',f=>f.options.publicationProof.digest='0'.repeat(64),f=>f.options.publicationProof.reviewed=false,f=>f.options.scope.path='soldier',f=>f.options.clientWorkerId='other']){
    const f=fixture();change(f);const source=f.create();if(Object.hasOwn(source,'path')){f.store.archive.digest='1'.repeat(64);}
    await denied(source);assert.equal(f.stats.reads,Object.hasOwn(source,'path')?1:0);
  }
});
test('proof/option getters do not execute and unrelated SDK credential fields are never serialized',async()=>{
  let reads=0;for(const target of ['scope','publicationProof']){const f=fixture();Object.defineProperty(f.options,target,{enumerable:true,get(){reads++;throw Error('synthetic-secret');}});await denied(f.create());assert.equal(f.stats.refs,0);}
  const f=fixture();Object.defineProperty(f.options.publicationProof,'digest',{enumerable:true,get(){reads++;throw Error('synthetic-secret');}});await denied(f.create());assert.equal(f.stats.refs,0);
  const safe=fixture();Object.defineProperty(safe.state.app.options,'credential',{get(){reads++;throw Error('synthetic-secret');}});assert.equal((await safe.create().read()).products.length,1);assert.equal(reads,0);
});
test('app, scope, methods and reference path drift after get or val return no logical data',async()=>{
  for(const at of ['get','val'])for(const change of [f=>f.state.app={options:copy(f.state.app.options)},f=>f.state.app.options.projectId='demo-other',f=>f.state.app.options.databaseURL='https://demo-other.firebaseio.com',f=>f.state.url+='/changed',f=>f.database.ref=()=>f.reference,f=>f.reference.get=async()=>({}),f=>f.reference.toString=()=>f.state.url]){
    const f=fixture(),source=f.create();f.hooks[at]=()=>change(f);await denied(source);assert.equal(f.stats.reads,1);assert.equal(f.stats.writes,0);
  }
});
test('snapshot val/getter/URL anomalies fail without calling selected data accessors',async()=>{
  let calls=0;
  for(const variant of ['getter','wrong_ref','method_drift']){
    const f=fixture();f.reference.get=async()=>{const snapshot={ref:{toString:()=>f.state.url+(variant==='wrong_ref'?'/other':'')},val(){calls++;if(variant==='method_drift')this.val=()=>f.store.archive;return f.store.archive;}};
      if(variant==='getter')Object.defineProperty(snapshot,'val',{get(){calls++;throw Error('synthetic-secret');}});return snapshot;};
    await denied(f.create());
  }
  assert.equal(calls,1);
});
test('edited payload and self-recomputed digest cannot replace an independently pinned proof',async()=>{
  const f=fixture(),source=f.create(),other=prepared(scope(),[{id:'synthetic-product',jahit:[{tukangId:worker,total:999}]}]);f.store.archive=copy(other.archive);await denied(source);
  // Updating the original caller object after construction does not re-anchor
  // the trusted copy. The replacement bytes still fail the original proof.
  f.options.publicationProof.digest=other.publicationProof.digest;await denied(source);
  const changed=fixture(),loaded=changed.create();changed.store.archive.payload+=' ';await denied(loaded);
});
test('unknown fields, bad scalar data, duplicate/prototype/nonfinite JSON and oversized text fail closed',async()=>{
  const mutations=[a=>a.unexpected='synthetic-secret',a=>a.scope.tenantId='other',a=>a.digest='F'.repeat(64),a=>a.codec='other',a=>a.payload='{"schemaVersion":1,"schemaVersion":1}',a=>a.payload='{"__proto__":{}}',a=>a.payload='{"n":1e999}',a=>a.payload='x'.repeat(Codec.MAX_PAYLOAD_BYTES+1)];
  for(const change of mutations){const f=fixture(),source=f.create();change(f.store.archive);await denied(source);}
  const invalid=fixture();let reads=0;Object.defineProperty(invalid.store.archive,'payload',{get(){reads++;throw Error('synthetic-secret');},enumerable:true});
  // A trusted SDK val may return an object with hostile descriptors; the codec
  // must reject it without executing the payload accessor.
  const direct=fixture();direct.reference.get=async()=>({ref:direct.reference,val:()=>invalid.store.archive});await denied(direct.create());assert.equal(reads,0);
});
test('even independently anchored malformed payload bytes must satisfy the strict logical codec',async()=>{
  const valid=fixture().store.archive.payload,logical=JSON.parse(valid);logical.products[0].jahit[0].total='synthetic-invalid-number';
  const payloads=[valid.replace('{','{"schemaVersion":1,'),valid.replace('{','{"__proto__":{},'),valid.replace('"schemaVersion":1','"schemaVersion":1e999'),Codec.canonicalJSON(logical),' '+valid];
  for(const payload of payloads){const f=reviewedPayloadFixture(payload);await denied(f.create());assert.equal(f.stats.values,1);}
});
test('SDK exceptions are fixed generic errors without raw messages, fields, causes or logger calls',async()=>{
  for(const at of ['get','val']){
    const f=fixture(),source=f.create();f.hooks[at]=()=>{throw Object.assign(Error('synthetic-secret-token-money'),{code:'synthetic-secret-code',cause:'synthetic-secret-cause'});};
    await assert.rejects(()=>source.read(),e=>{assert.deepEqual(Object.keys(e),['code']);assert.equal(e.message,'unavailable');assert.equal(e.code,'unavailable');assert.equal(Object.hasOwn(e,'cause'),false);return true;});
  }
  let getters=0;const hostile=fixture(),source=hostile.create();hostile.hooks.get=()=>{const error={};for(const key of ['code','message'])Object.defineProperty(error,key,{get(){getters++;throw Error('synthetic-secret');}});throw error;};await denied(source);assert.equal(getters,0);
});
test('production rejects database/Auth emulator presence before SDK binding and after await',async()=>{
  for(const name of ['FIREBASE_DATABASE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST']){
    const previous=process.env[name];try{process.env[name]='127.0.0.1:9000';const cold=fixture();await denied(cold.create());assert.equal(cold.stats.refs,0);delete process.env[name];const warm=fixture(),source=warm.create();warm.hooks.get=()=>{process.env[name]='127.0.0.1:9000';};await denied(source);assert.equal(warm.stats.values,0);}finally{if(previous===undefined)delete process.env[name];else process.env[name]=previous;}
  }
});
test('explicit emulator hook requires exact demo project/URL/env and own fixture credential',async()=>{
  const names=['FIREBASE_DATABASE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN'],prior=Object.fromEntries(names.map(k=>[k,process.env[k]]));
  try{
    for(const k of names)delete process.env[k];process.env.FIREBASE_DATABASE_EMULATOR_HOST='127.0.0.1:9000';
    const normal=fixture();normal.options.testOnlyEmulator=true;await denied(normal.create());assert.equal(normal.stats.refs,0);
    const demo=()=>{const f=fixture({s:{...scope(),projectId:'demo-soldier-security',databaseURL:'https://demo-soldier-security.firebaseio.com'}});f.options.testOnlyEmulator=true;f.state.app.options.credential={getAccessToken:async()=>({access_token:'owner',expires_in:3600})};f.state.url=f.state.url.replace(f.options.scope.databaseURL,'http://127.0.0.1:9000');return f;};
    assert.equal((await demo().create().read()).schemaVersion,1);
    for(const change of [f=>f.state.url=f.state.url.replace('127.0.0.1','localhost'),f=>delete f.state.app.options.credential,f=>f.state.app.options.credential=Object.create({getAccessToken:async()=>({access_token:'owner',expires_in:3600})})]){const f=demo();change(f);await denied(f.create());}
    for(const [key,val]of [['FIREBASE_DATABASE_EMULATOR_HOST','localhost:9000'],['FIREBASE_AUTH_EMULATOR_HOST','127.0.0.1:9099'],['GOOGLE_APPLICATION_CREDENTIALS','synthetic-forbidden-file'],['FIREBASE_TOKEN','synthetic-forbidden-token']]){const f=demo();process.env[key]=val;await denied(f.create());assert.equal(f.stats.refs,0);if(key==='FIREBASE_DATABASE_EMULATOR_HOST')process.env[key]='127.0.0.1:9000';else delete process.env[key];}
  }finally{for(const k of names){if(prior[k]===undefined)delete process.env[k];else process.env[k]=prior[k];}}
});
