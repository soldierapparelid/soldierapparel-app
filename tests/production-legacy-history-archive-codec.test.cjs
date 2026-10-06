'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const C=require('../server/production-legacy-history-archive-codec.cjs');
const History=require('../legacy-stored-history.js');
const scope={projectId:'demo-archive-codec',databaseURL:'https://demo-archive-codec.firebaseio.com',tenantId:'synthetic-tenant',snapshotVersion:'synthetic-version'};
const workers={'synthetic-worker-a':{division:'jahit',reviewed:true}};
const row=extra=>({id:'synthetic-row',tukangId:'synthetic-worker-a',tanggal:null,jumlah:2.5,tarif:13.25,total:987.75,dibayar:'false',...extra});
const products=()=>[{id:'synthetic-product',series:'Synthetic',namaBarang:'Synthetic garment',size:'M',jahit:[row()],arsip:[]}];
function prepare(input=products(),s=scope,w=workers){return C.createLegacyHistoryArchivePreparer({enabled:true,scope:s,workers:w}).prepare({products:input});}
function valid(input=products()){const r=prepare(input);assert.equal(r.ok,true);return r;}
function denied(fn){assert.throws(fn,e=>e instanceof C.ArchiveError&&['invalid_archive','invalid_proof','scope_mismatch','capacity_limit'].includes(e.code));}
function forge(inner,raw){const payload=raw===undefined?C.canonicalJSON(inner):raw,digest=crypto.createHash('sha256').update(C.canonicalJSON({domain:C.DIGEST_DOMAIN,schemaVersion:1,scope,codec:C.ARCHIVE_CODEC,payload})).digest('hex');return {archive:{schemaVersion:1,scope,codec:C.ARCHIVE_CODEC,payload,digest},publicationProof:{schemaVersion:1,scope,codec:C.ARCHIVE_CODEC,digest,reviewed:true,immutable:true}};}
function prune(v){if(v===null)return undefined;if(v&&typeof v==='object'){const out={};for(const [k,x]of Object.entries(v)){const p=prune(x);if(p!==undefined)out[k]=p;}return Object.keys(out).length?out:undefined;}return v;}
test('default OFF reads no scope/catalog/request getters and claims no preparation',()=>{
  let reads=0;const options={enabled:false};for(const key of ['scope','workers'])Object.defineProperty(options,key,{get(){reads++;throw Error('synthetic-secret');}});const request={};Object.defineProperty(request,'products',{get(){reads++;throw Error('synthetic-secret');}});
  assert.deepEqual(C.createLegacyHistoryArchivePreparer(options).prepare(request),{ok:false,error:'service_disabled'});assert.equal(reads,0);
});
test('prepared candidate is immutable data only and retains quantity/rate/total independently',()=>{
  const input=products(),before=structuredClone(input),result=valid(input),inner=C.decodeArchive(result.archive,result.publicationProof);
  assert.deepEqual(inner.products[0].jahit[0],row());assert.notEqual(inner.products[0].jahit[0].total,2.5*13.25);assert.deepEqual(input,before);
  for(const key of ['published','immutableStoreProven','authorizationGranted','legacyAdopted','readyForProduction'])assert.equal(result[key],false);assert.equal(result.preparedOnly,true);
  assert.equal(Object.isFrozen(result.archive),true);assert.equal(Object.isFrozen(inner.products[0].jahit[0]),true);
});
test('canonical ordering is recursive and independent of input insertion order',()=>{
  const reordered={};for(const k of Object.keys(row()).reverse())reordered[k]=row()[k];const input=products();input[0].jahit=[reordered];
  const first=valid(),second=valid(input);assert.equal(first.archive.payload,second.archive.payload);assert.equal(first.archive.digest,second.archive.digest);
  assert.equal(C.canonicalJSON({b:{d:1,c:2},a:[{z:1,y:2}]}),'\u007b"a":[{"y":2,"z":1}],"b":{"c":2,"d":1}}');
});
test('unknown credentials, internal finance, non-reviewed workers and other source families are never copied/read',()=>{
  let reads=0;const p=products()[0],r=p.jahit[0],other=row({id:'synthetic-other',tukangId:'synthetic-worker-other'});p.jahit.push(other);
  for(const [v,k] of [[r,'pin'],[r,'bankAccount'],[r,'tukangNama'],[r,'deviceInfo'],[other,'total'],[p,'hpp'],[p,'qc'],[p,'gudang'],[p,'bayarJahit'],[p,'potong']])Object.defineProperty(v,k,{enumerable:true,get(){reads++;throw Error('synthetic-secret');}});
  const inner=C.decodeArchive(valid([p]).archive,valid([p]).publicationProof);assert.equal(reads,0);assert.equal(inner.products[0].jahit.length,1);
  for(const name of ['pin','bankAccount','tukangNama','deviceInfo','hpp','qc','gudang','bayarJahit','potong','synthetic-worker-other'])assert.equal(C.canonicalJSON(inner).includes('"'+name+'"'),false);
});
test('missing/null/zero/decimal/types and explicit missing/null/empty row IDs remain distinct',()=>{
  const list=[row({id:null,jumlah:0,total:0}),row({id:'',tarif:null}),row({id:'synthetic-last',lolos:0,rijek:null,kiloan:1.25,quantityBasis:null})];delete list[2].tanggal;delete list[2].id;
  const p=products()[0];p.jahit=list;p.size=null;const inner=C.decodeArchive(valid([p]).archive,valid([p]).publicationProof);
  assert.deepEqual(inner.products[0].jahit,list);assert.equal(Object.hasOwn(inner.products[0].jahit[2],'id'),false);assert.equal(Object.hasOwn(inner.products[0].jahit[2],'tanggal'),false);assert.equal(inner.products[0].size,null);
});
test('current/direct archives retain explicit IDs, idless mirror copies and null entries without inferred links',()=>{
  const p=products()[0];delete p.jahit[0].id;p.jahit.unshift(null);p.arsip=[null,{id:'synthetic-archive',jahit:[structuredClone(p.jahit[1])],label:'Do not copy',arsip:[{jahit:[row({total:99})]}]}];
  const inner=C.decodeArchive(valid([p]).archive,valid([p]).publicationProof);assert.equal(inner.products[0].jahit.length,2);assert.equal(inner.products[0].arsip.length,2);assert.equal(inner.products[0].arsip[1].id,'synthetic-archive');assert.deepEqual(inner.products[0].jahit[1],inner.products[0].arsip[1].jahit[0]);assert.equal(Object.hasOwn(inner.products[0].arsip[1],'arsip'),false);assert.equal(Object.hasOwn(inner.products[0].arsip[1],'label'),false);
});
test('duplicate explicit row copies are stored independently and never added, collapsed or repriced',()=>{
  const p=products()[0];p.arsip=[{id:'synthetic-archive',jahit:[row({total:1})]}];const result=valid([p]),inner=C.decodeArchive(result.archive,result.publicationProof);
  assert.equal(inner.products[0].jahit[0].id,inner.products[0].arsip[0].jahit[0].id);assert.equal(inner.products[0].jahit[0].total,987.75);assert.equal(inner.products[0].arsip[0].jahit[0].total,1);
  const reader=History.createLegacyStoredHistoryProjector({enabled:true,binding:{projectId:scope.projectId,databaseURL:scope.databaseURL,tenantId:scope.tenantId,uid:'synthetic-reader',workerId:'synthetic-worker-a',division:'jahit',grantRevision:1}});
  assert.deepEqual(reader.project({snapshotVersion:scope.snapshotVersion,products:inner.products}),{ok:false,error:'conflicting_record'});assert.equal(result.readyForProduction,false);
});
test('payload STRING survives modeled RTDB pruning while null/absent/empty remain exact',()=>{
  const p=products()[0];p.jahit=[row({jumlah:null,total:0}),null];p.arsip=[];p.size=null;const result=valid([p]),stored=prune(result.archive),decoded=C.decodeArchive(stored,result.publicationProof);
  assert.deepEqual(stored,result.archive);assert.deepEqual(decoded.products[0].jahit,p.jahit);assert.deepEqual(decoded.products[0].arsip,[]);assert.equal(decoded.products[0].size,null);
  for(const input of [null,[],[null], [{id:'synthetic-empty',jahit:null,arsip:null}], [{id:'synthetic-empty',jahit:[],arsip:true}]]){const r=valid(input);assert.deepEqual(C.decodeArchive(prune(r.archive),r.publicationProof).products,input);}
});
test('object maps normalize to deterministic arrays, retaining only original IDs without key fallback',()=>{
  const r=row();delete r.id;const p=products()[0];p.jahit={z:r,a:null};p.arsip={z:{jahit:[row()]},a:null};const result=valid({z:p,a:null}),inner=C.decodeArchive(result.archive,result.publicationProof);
  assert.equal(inner.products[0],null);assert.equal(inner.products[1].jahit[0],null);assert.equal(Object.hasOwn(inner.products[1].jahit[1],'id'),false);assert.equal(Object.hasOwn(inner.products[1].arsip[1],'id'),false);assert.equal(Object.hasOwn(inner.products[1],'z'),false);
});
test('unsupported selected types, missing product IDs, sparse arrays and getters fail without coercion',()=>{
  for(const change of [{jumlah:'2.5'},{tarif:Infinity},{total:-1},{rijek:-0},{dibayar:2},{id:'../bad'}]){const p=products()[0];p.jahit=[row(change)];assert.deepEqual(prepare([p]),{ok:false,error:'invalid_source'});}
  const p=products()[0];delete p.id;assert.equal(prepare([p]).ok,false);const sparse=[];sparse[1]=products()[0];assert.equal(prepare(sparse).ok,false);
  let reads=0;const hostile={toString(){reads++;return 'synthetic-worker-a';},[Symbol.toPrimitive](){reads++;return 'synthetic-worker-a';}};
  const x=products()[0];x.jahit[0].tukangId=hostile;assert.equal(prepare([x]).ok,false);
  for(const k of ['projectId','databaseURL'])assert.equal(prepare(products(),{...scope,[k]:hostile}).ok,false);assert.equal(reads,0);
  const getter=products()[0];Object.defineProperty(getter.jahit[0],'total',{enumerable:true,get(){reads++;return 0;}});assert.equal(prepare([getter]).ok,false);assert.equal(reads,0);
});
test('fixed reviewed catalog rejects aliases, caller selectors and unreviewed/unsupported scope',()=>{
  for(const w of [{},{'synthetic-worker-a':{division:'qc',reviewed:true}},{'synthetic-worker-a':{division:'jahit',reviewed:false}},{'synthetic-worker-a':{division:'jahit',reviewed:true,legacyWorkerId:'other'}}])assert.equal(prepare(products(),scope,w).ok,false);
  const preparer=C.createLegacyHistoryArchivePreparer({enabled:true,scope,workers});assert.equal(preparer.prepare({products:products(),workerId:'synthetic-other'}).ok,false);
  assert.equal(prepare(products(),{...scope,snapshotVersion:'../bad'}).ok,false);
});
test('separate proof pins scope/version/payload digest, never trusts the blob self-hash',()=>{
  const r=valid();for(const mutate of [a=>a.digest='a'.repeat(64),a=>a.payload+=' ',a=>a.scope.snapshotVersion='synthetic-other',a=>a.scope.tenantId='synthetic-other',a=>a.scope.projectId='demo-other',a=>a.codec='other']){const a=structuredClone(r.archive);mutate(a);denied(()=>C.decodeArchive(a,r.publicationProof));}
  const altered=JSON.parse(r.archive.payload);altered.products[0].jahit[0].total=1;const forged=forge(altered);denied(()=>C.decodeArchive(forged.archive,r.publicationProof));
  denied(()=>C.validatePublicationProof(r.publicationProof,{...scope,snapshotVersion:'synthetic-other'}));
});
test('strict canonical parsing rejects duplicates, escaped aliases, trailing whitespace and unsupported payload fields',()=>{
  const r=valid(),inner=JSON.parse(r.archive.payload);for(const payload of [r.archive.payload+' ',r.archive.payload.replace('"immutable":true','"immutable":true,"immutable":false'),r.archive.payload.replace('"immutable":true','"\\u0069mmutable":true'),'{"__proto__":{}}']){const f=forge(inner,payload);denied(()=>C.decodeArchive(f.archive,f.publicationProof));}
  for(const mutate of [x=>x.products[0].jahit[0].pin='synthetic-secret',x=>x.products[0].jahit.push(row({tukangId:'unknown'})),x=>x.products[0].internalCost=5,x=>x.workers['synthetic-worker-a'].email='synthetic@example.invalid',x=>x.products[0].jahit[0].total='987']){const x=structuredClone(inner);mutate(x);const f=forge(x);denied(()=>C.decodeArchive(f.archive,f.publicationProof));}
});
test('digest canonical scope/domain covers worker review and produces frozen detached source',()=>{
  const r=valid(),digest=crypto.createHash('sha256').update(C.canonicalJSON({domain:C.DIGEST_DOMAIN,schemaVersion:1,scope,codec:C.ARCHIVE_CODEC,payload:r.archive.payload})).digest('hex');assert.equal(digest,r.archive.digest);
  const inner=C.decodeArchive(r.archive,r.publicationProof);assert.equal(Object.isFrozen(inner.workers),true);assert.equal(Object.isFrozen(inner.products),true);
  const options={enabled:true,scope:structuredClone(scope),workers:structuredClone(workers)},prepared=C.createLegacyHistoryArchivePreparer(options);options.scope.snapshotVersion='other';options.workers['synthetic-worker-a'].reviewed=false;assert.equal(prepared.prepare({products:products()}).archive.scope.snapshotVersion,scope.snapshotVersion);
});
test('inherited serialization hooks never execute during preparation/digest/decode',()=>{
  const input=products(),oldObject=Object.getOwnPropertyDescriptor(Object.prototype,'toJSON'),oldArray=Object.getOwnPropertyDescriptor(Array.prototype,'toJSON');let calls=0,result,decoded;
  try{Object.defineProperty(Object.prototype,'toJSON',{configurable:true,get(){calls++;throw Error('synthetic-secret');}});Object.defineProperty(Array.prototype,'toJSON',{configurable:true,value(){calls++;return [];}});result=prepare(input);if(result.ok)decoded=C.decodeArchive(result.archive,result.publicationProof);}finally{if(oldObject)Object.defineProperty(Object.prototype,'toJSON',oldObject);else delete Object.prototype.toJSON;if(oldArray)Object.defineProperty(Array.prototype,'toJSON',oldArray);else delete Array.prototype.toJSON;}
  assert.equal(calls,0);assert.equal(result.ok,true);assert.equal(decoded.products[0].jahit[0].total,987.75);
});
test('fixed product/row/worker/payload bounds reject capacity overflow without partial archives',()=>{
  assert.equal(prepare(Array.from({length:2001},()=>({id:'synthetic-empty',jahit:[]}))).error,'capacity_limit');
  const p=products()[0];p.jahit=Array.from({length:40001},()=>row());assert.equal(prepare([p]).error,'capacity_limit');
  const many={};for(let i=0;i<C.MAX_WORKERS+1;i++)many['synthetic-worker-'+i]={division:'jahit',reviewed:true};assert.equal(prepare(products(),scope,many).ok,false);
  const r=valid(),tooLarge={...r.archive,payload:'x'.repeat(C.MAX_PAYLOAD_BYTES+1)};denied(()=>C.decodeArchive(tooLarge,r.publicationProof));
});
