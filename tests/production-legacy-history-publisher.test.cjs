'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Publisher=require('../server/production-legacy-history-publisher.cjs');
const Codec=require('../server/production-legacy-history-archive-codec.cjs');
const copy=v=>structuredClone(v);
const scope=()=>({projectId:'demo-history-publisher',databaseURL:'https://demo-history-publisher.firebaseio.com',tenantId:'synthetic-publisher-tenant',snapshotVersion:'synthetic-publisher-version'});
const CREDENTIAL_ENV=['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN_FILE','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT'];
function prepare(s=scope(),total=37.25){
  const answer=Codec.createLegacyHistoryArchivePreparer({enabled:true,scope:s,workers:{'synthetic-worker':{division:'jahit',reviewed:true}}}).prepare({products:[{id:'synthetic-product',jahit:[{id:'synthetic-row',tukangId:'synthetic-worker',jumlah:1.5,tarif:2,total,dibayar:false}],arsip:[]}]});
  assert.equal(answer.ok,true);return answer;
}
function fixture(s=scope()){
  const prepared=prepare(s),store={archive:null},hooks={transaction:null,get:null,val:null},stats={refs:0,transactions:0,callbacks:0,reads:0,values:0,writes:0};
  const state={app:{options:{projectId:s.projectId,databaseURL:s.databaseURL}},url:s.databaseURL+'/legacyStoredHistoryArchives/'+s.tenantId+'/'+s.snapshotVersion};
  class Snapshot{get ref(){return reference;}val(){stats.values++;if(hooks.val)hooks.val(this);return copy(store.archive);}}
  class Reference{
    toString(){return state.url;}
    async get(){stats.reads++;if(hooks.get)return await hooks.get();return new Snapshot();}
    async transaction(update,completion,applyLocally){
      stats.transactions++;assert.equal(completion,undefined);assert.equal(applyLocally,false);
      const run=current=>{stats.callbacks++;return update(current);};
      if(hooks.transaction)return await hooks.transaction(run);
      const candidate=run(copy(store.archive));const committed=candidate!==undefined;
      if(committed){stats.writes++;store.archive=copy(candidate);}return {committed,snapshot:new Snapshot()};
    }
  }
  const reference=new Reference();class Database{get app(){return state.app;}ref(path){stats.refs++;assert.equal(path,'legacyStoredHistoryArchives/'+s.tenantId+'/'+s.snapshotVersion);return reference;}}
  const database=new Database(),options={enabled:true,scope:s,publicationProof:copy(prepared.publicationProof),database};
  return {options,prepared,store,hooks,stats,state,reference,database,Snapshot,create:()=>Publisher.createProductionLegacyHistoryPublisher(options),request:()=>({archive:copy(prepared.archive)})};
}
function unknown(answer){assert.deepEqual(answer,{ok:false,error:'result_unknown',retrySameSnapshot:true});}

test('default OFF ignores getters, dependencies and publication input',async()=>{
  let reads=0;const options={enabled:false};for(const key of ['scope','publicationProof','database','testOnlyEmulator'])Object.defineProperty(options,key,{get(){reads++;throw Error('synthetic-secret');}});
  const request={};Object.defineProperty(request,'archive',{get(){reads++;throw Error('synthetic-secret');}});const publisher=Publisher.createProductionLegacyHistoryPublisher(options);
  assert.deepEqual(await publisher.publish(request),{ok:false,error:'service_disabled'});assert.deepEqual(await publisher.resolve(request),{ok:false,error:'service_disabled'});assert.equal(reads,0);
});

test('fixed path create-only publication preserves bytes and separates evidence from readiness',async()=>{
  const f=fixture(),before=copy(f.prepared.archive),answer=await f.create().publish(f.request());
  assert.equal(answer.ok,true);assert.equal(answer.published,true);assert.equal(answer.replayed,false);assert.deepEqual(answer.publicationEvidence,f.prepared.publicationProof);assert.equal(Object.isFrozen(answer.publicationEvidence.scope),true);
  for(const key of ['immutableStoreProven','authorizationGranted','legacyAdopted','readyForProduction'])assert.equal(answer[key],false);
  assert.deepEqual(f.store.archive,before);assert.equal(f.stats.refs,1);assert.equal(f.stats.writes,1);assert.equal(f.stats.reads,0);assert.equal(Object.hasOwn(answer,'archive'),false);assert.equal(Object.hasOwn(answer,'payload'),false);
});

test('existing exact archive is not rewritten; transaction replay uses exact readback evidence',async()=>{
  const f=fixture();f.store.archive=copy(f.prepared.archive);const before=copy(f.store.archive),answer=await f.create().publish(f.request());
  assert.equal(answer.ok,true);assert.equal(answer.replayed,true);assert.deepEqual(f.store.archive,before);assert.equal(f.stats.writes,0);assert.equal(f.stats.reads,1);assert.equal(f.stats.callbacks,1);
});

test('a different existing value or malformed tombstone conflicts and is never overwritten',async()=>{
  for(const value of [prepare(scope(),99).archive,{},false,'synthetic-conflict']){
    const f=fixture();f.store.archive=copy(value);const answer=await f.create().publish(f.request());assert.deepEqual(answer,{ok:false,error:'conflict'});assert.deepEqual(f.store.archive,value);assert.equal(f.stats.writes,0);assert.equal(f.stats.reads,1);
  }
});

test('lost ACK recovers only exact saved bytes at the same pinned version',async()=>{
  const f=fixture();f.hooks.transaction=run=>{const value=run(null);f.stats.writes++;f.store.archive=copy(value);throw Error('synthetic-secret-ack');};
  const answer=await f.create().publish(f.request());assert.equal(answer.ok,true);assert.equal(answer.replayed,true);assert.equal(f.stats.writes,1);assert.equal(f.stats.reads,1);
});

test('unknown ACK with null/read failure stays unknown; separate resolve may establish later exact evidence',async()=>{
  for(const unreadable of [false,true]){
    const f=fixture();f.hooks.transaction=()=>{throw Error('synthetic-secret-ack');};if(unreadable)f.hooks.get=()=>{throw Error('synthetic-secret-read');};const publisher=f.create();unknown(await publisher.publish(f.request()));
    f.hooks.get=null;f.store.archive=copy(f.prepared.archive);const answer=await publisher.resolve(f.request());assert.equal(answer.ok,true);assert.equal(answer.replayed,true);assert.equal(f.stats.writes,0);assert.equal(f.stats.transactions,1);
  }
  const empty=fixture();unknown(await empty.create().resolve(empty.request()));assert.equal(empty.stats.transactions,0);
});

test('SDK transaction result accessors never execute; independently valid readback can confirm',async()=>{
  for(const key of ['committed','snapshot']){
    const f=fixture();let calls=0;f.hooks.transaction=run=>{f.store.archive=copy(run(null));const result={committed:true};Object.defineProperty(result,key,{enumerable:true,get(){calls++;throw Error('synthetic-secret');}});return result;};
    const answer=await f.create().publish(f.request());assert.equal(answer.ok,true);assert.equal(answer.replayed,true);assert.equal(calls,0);assert.equal(f.stats.reads,1);
  }
});

test('observed callback scope drift stays latched after restore, preventing same-operation recovery success',async()=>{
  const f=fixture();f.store.archive=copy(f.prepared.archive);f.hooks.transaction=run=>{
    f.state.app.options.projectId='demo-other';assert.equal(run(null),undefined);f.state.app.options.projectId=f.options.scope.projectId;assert.equal(run(null),undefined);return {committed:false,snapshot:new f.Snapshot()};
  };
  const publisher=f.create();unknown(await publisher.publish(f.request()));assert.equal(f.stats.reads,0);assert.equal(f.stats.writes,0);
  const fresh=await publisher.resolve(f.request());assert.equal(fresh.ok,true);assert.equal(fresh.replayed,true);assert.equal(f.stats.reads,1);
});

test('scope/env/reference drift across awaited transaction denies without recovery reads',async()=>{
  for(const change of [f=>f.state.app.options.projectId='demo-other',f=>f.state.url+='/other',f=>f.reference.get=async()=>new f.Snapshot(),f=>f.database.ref=()=>f.reference]){
    const f=fixture();f.hooks.transaction=run=>{f.store.archive=copy(run(null));change(f);return {committed:true,snapshot:new f.Snapshot()};};unknown(await f.create().publish(f.request()));assert.equal(f.stats.reads,0);
  }
});

test('snapshot getter/method anomalies never expose data and observed snapshot drift stays latched',async()=>{
  for(const variant of ['val_getter','val_drift','wrong_ref','scope_change']){
    const f=fixture();let calls=0;f.hooks.transaction=run=>{
      f.store.archive=copy(run(null));const snapshot={ref:f.reference,val(){calls++;if(variant==='val_drift')this.val=()=>f.store.archive;if(variant==='scope_change')f.state.app.options.databaseURL='https://demo-other.firebaseio.com';return f.store.archive;}};
      if(variant==='val_getter')Object.defineProperty(snapshot,'val',{enumerable:true,get(){calls++;throw Error('synthetic-secret');}});
      if(variant==='wrong_ref')snapshot.ref={toString:()=>f.state.url+'/other'};return {committed:true,snapshot};
    };
    const answer=await f.create().publish(f.request());if(variant==='val_getter'){assert.equal(answer.ok,true);assert.equal(answer.replayed,true);assert.equal(calls,0);}else{unknown(answer);assert.equal(f.stats.reads,0);}
  }
});

test('SDK callbacks changing binding during URL/val are detected before evidence',async()=>{
  const f=fixture();f.store.archive=copy(f.prepared.archive);f.hooks.get=()=>({ref:{toString(){f.state.app.options.projectId='demo-other';return f.state.url;}},val(){assert.fail('val must not dispatch');}});
  unknown(await f.create().resolve(f.request()));assert.equal(f.stats.reads,1);
  const warm=fixture(),publisher=warm.create();warm.reference.toString=()=>{warm.state.app.options.projectId='demo-other';return warm.state.url;};assert.deepEqual(await publisher.publish(warm.request()),{ok:false,error:'unavailable'});assert.equal(warm.stats.transactions,0);
});

test('invalid selectors/getters/proofs/archive inputs cannot dispatch any transaction',async()=>{
  let calls=0;const f=fixture(),publisher=f.create(),getter={};Object.defineProperty(getter,'archive',{enumerable:true,get(){calls++;return f.prepared.archive;}});
  for(const request of [getter,{archive:f.prepared.archive,workerId:'other'},{archive:{...f.prepared.archive,digest:'a'.repeat(64)}},{archive:prepare(scope(),1).archive},{}])assert.deepEqual(await publisher.publish(request),{ok:false,error:'invalid_request'});
  assert.equal(calls,0);assert.equal(f.stats.transactions,0);assert.equal(f.stats.reads,0);
  const invalid=fixture();Object.defineProperty(invalid.options,'publicationProof',{enumerable:true,get(){calls++;throw Error('synthetic-secret');}});assert.deepEqual(await invalid.create().publish(invalid.request()),{ok:false,error:'unavailable'});assert.equal(calls,0);assert.equal(invalid.stats.refs,0);
});

test('trusted options are copied and caller mutation cannot redirect or replace the anchor',async()=>{
  const f=fixture(),publisher=f.create();f.options.scope.snapshotVersion='other';f.options.publicationProof.digest='0'.repeat(64);const answer=await publisher.publish(f.request());assert.equal(answer.ok,true);assert.equal(answer.publicationEvidence.scope.snapshotVersion,'synthetic-publisher-version');assert.deepEqual(f.store.archive,f.prepared.archive);
});

test('raw SDK exceptions/accessors never escape fixed error result',async()=>{
  const f=fixture();let reads=0;const hostile={};for(const key of ['message','code','cause'])Object.defineProperty(hostile,key,{get(){reads++;throw Error('synthetic-secret');}});f.hooks.transaction=()=>{throw hostile;};f.hooks.get=()=>{throw hostile;};const answer=await f.create().publish(f.request());unknown(answer);assert.equal(reads,0);assert.deepEqual(Object.keys(answer).sort(),['error','ok','retrySameSnapshot']);
});

test('inherited toJSON hooks never run in desired copies/transaction/readback comparison',async()=>{
  const f=fixture(),request=f.request(),publisher=f.create(),oldObject=Object.getOwnPropertyDescriptor(Object.prototype,'toJSON'),oldArray=Object.getOwnPropertyDescriptor(Array.prototype,'toJSON');let calls=0,answer;
  try{Object.defineProperty(Object.prototype,'toJSON',{configurable:true,get(){calls++;throw Error('synthetic-secret');}});Object.defineProperty(Array.prototype,'toJSON',{configurable:true,value(){calls++;return [];}});answer=await publisher.publish(request);}finally{if(oldObject)Object.defineProperty(Object.prototype,'toJSON',oldObject);else delete Object.prototype.toJSON;if(oldArray)Object.defineProperty(Array.prototype,'toJSON',oldArray);else delete Array.prototype.toJSON;}
  assert.equal(answer.ok,true);assert.equal(calls,0);
});

test('racing identical publishers create once and report exact replay without overwrite',async()=>{
  const f=fixture(),first=f.create(),second=f.create(),answers=await Promise.all([first.publish(f.request()),second.publish(f.request())]);assert.equal(answers.every(a=>a.ok),true);assert.equal(answers.filter(a=>!a.replayed).length,1);assert.equal(f.stats.writes,1);assert.equal(f.stats.transactions,2);assert.deepEqual(f.store.archive,f.prepared.archive);
});

test('repeated CAS callbacks retain a fixed detached candidate and never replace a concurrent value',async()=>{
  for(const conflict of [false,true]){
    const f=fixture(),request=f.request(),other=prepare(scope(),99).archive;
    f.hooks.transaction=run=>{
      const first=run(null);first.scope.snapshotVersion='synthetic-callback-mutation';first.payload='synthetic-callback-mutation';request.archive.payload='synthetic-request-mutation';
      const retry=run(null);assert.deepEqual(retry,f.prepared.archive);assert.notEqual(retry,first);
      if(conflict){f.store.archive=copy(other);assert.equal(run(copy(other)),undefined);return {committed:false,snapshot:new f.Snapshot()};}
      f.store.archive=copy(retry);f.stats.writes++;return {committed:true,snapshot:new f.Snapshot()};
    };
    const answer=await f.create().publish(request);
    if(conflict){assert.deepEqual(answer,{ok:false,error:'conflict'});assert.equal(f.stats.writes,0);assert.deepEqual(f.store.archive,other);assert.equal(f.stats.callbacks,3);}
    else{assert.equal(answer.ok,true);assert.deepEqual(f.store.archive,f.prepared.archive);assert.equal(f.stats.writes,1);assert.equal(f.stats.callbacks,2);}
  }
});

test('production emulator guards reject before SDK construction and after transaction dispatch',async()=>{
  for(const key of ['FIREBASE_DATABASE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST']){
    const prior=process.env[key];try{process.env[key]='127.0.0.1:9000';const cold=fixture();assert.deepEqual(await cold.create().publish(cold.request()),{ok:false,error:'unavailable'});assert.equal(cold.stats.refs,0);delete process.env[key];const warm=fixture();warm.hooks.transaction=run=>{const value=run(null);warm.store.archive=copy(value);process.env[key]='127.0.0.1:9000';return {committed:true,snapshot:new warm.Snapshot()};};unknown(await warm.create().publish(warm.request()));assert.equal(warm.stats.reads,0);}finally{if(prior===undefined)delete process.env[key];else process.env[key]=prior;}
  }
});

test('source-only emulator test hook requires exact demo scope/env/credential and pins fixture method',async()=>{
  const names=['FIREBASE_DATABASE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST',...CREDENTIAL_ENV],prior=Object.fromEntries(names.map(k=>[k,process.env[k]]));
  try{
    for(const k of names)delete process.env[k];process.env.FIREBASE_DATABASE_EMULATOR_HOST='127.0.0.1:9000';
    const demo=()=>{const f=fixture({...scope(),projectId:'demo-soldier-security',databaseURL:'https://demo-soldier-security.firebaseio.com'});f.options.testOnlyEmulator=true;f.state.app.options.credential={getAccessToken:async()=>({access_token:'owner',expires_in:3600})};f.state.url=f.state.url.replace(f.options.scope.databaseURL,'http://127.0.0.1:9000');return f;};
    assert.equal((await demo().create().publish(demo().request())).ok,true);
    for(const change of [f=>f.state.url=f.state.url.replace('127.0.0.1','localhost'),f=>delete f.state.app.options.credential,f=>f.state.app.options.credential.extra=true,f=>f.state.app.options.credential=Object.create({getAccessToken:async()=>({})})]){const f=demo();change(f);assert.deepEqual(await f.create().publish(f.request()),{ok:false,error:'unavailable'});assert.equal(f.stats.transactions,0);}
    const ordinary=fixture();ordinary.options.testOnlyEmulator=true;assert.deepEqual(await ordinary.create().publish(ordinary.request()),{ok:false,error:'unavailable'});assert.equal(ordinary.stats.refs,0);
    for(const [key,value]of [['FIREBASE_DATABASE_EMULATOR_HOST','localhost:9000'],['FIREBASE_AUTH_EMULATOR_HOST','127.0.0.1:9099'],...CREDENTIAL_ENV.map(k=>[k,'synthetic-forbidden-value'])]){const f=demo();process.env[key]=value;assert.deepEqual(await f.create().publish(f.request()),{ok:false,error:'unavailable'});assert.equal(f.stats.refs,0);if(key==='FIREBASE_DATABASE_EMULATOR_HOST')process.env[key]='127.0.0.1:9000';else delete process.env[key];}
    const warm=demo(),publisher=warm.create();warm.state.app.options.credential.getAccessToken=async()=>({access_token:'owner',expires_in:3600});assert.deepEqual(await publisher.publish(warm.request()),{ok:false,error:'unavailable'});assert.equal(warm.stats.transactions,0);
  }finally{for(const k of names){if(prior[k]===undefined)delete process.env[k];else process.env[k]=prior[k];}}
});

test('test-mode FirebaseApp.options copies preserve the pinned app and credential function',async()=>{
  const names=['FIREBASE_DATABASE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST',...CREDENTIAL_ENV],prior=Object.fromEntries(names.map(k=>[k,process.env[k]]));
  try{
    for(const k of names)delete process.env[k];process.env.FIREBASE_DATABASE_EMULATOR_HOST='127.0.0.1:9000';
    const f=fixture({...scope(),projectId:'demo-soldier-security',databaseURL:'https://demo-soldier-security.firebaseio.com'}),backing=f.state.app.options;
    f.options.testOnlyEmulator=true;f.state.url=f.state.url.replace(f.options.scope.databaseURL,'http://127.0.0.1:9000');
    backing.credential={getAccessToken:async()=>({access_token:'owner',expires_in:3600})};let optionCopies=0;
    Object.defineProperty(f.state.app,'options',{get(){optionCopies++;return {...backing,credential:{...backing.credential}};}});
    const publisher=f.create(),answer=await publisher.publish(f.request());assert.equal(answer.ok,true);assert.equal(f.stats.writes,1);assert.ok(optionCopies>1);
    backing.credential.getAccessToken=async()=>({access_token:'owner',expires_in:3600});assert.deepEqual(await publisher.resolve(f.request()),{ok:false,error:'unavailable'});assert.equal(f.stats.reads,0);
  }finally{for(const k of names){if(prior[k]===undefined)delete process.env[k];else process.env[k]=prior[k];}}
});
