'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const History=require('../legacy-stored-history.js');
const binding={projectId:'synthetic-project',databaseURL:'https://synthetic-project-default-rtdb.firebaseio.com',tenantId:'synthetic-tenant',uid:'synthetic-user-a',workerId:'synthetic-worker-a',division:'jahit',grantRevision:1};
const source=products=>({snapshotVersion:'synthetic-version-1',products});
const row=extra=>({id:'synthetic-row-1',tukangId:binding.workerId,tanggal:'2026-02-01',jumlah:7,lolos:5,rijek:2,tarif:12.5,total:901.75,dibayar:false,...extra});
const product=extra=>({id:'synthetic-product-1',series:'Synthetic series',namaBarang:'Synthetic garment',size:'M',jahit:[row()],...extra});
function projector(fixed=binding){return History.createLegacyStoredHistoryProjector({enabled:true,binding:fixed});}
function projected(products,fixed=binding){const result=projector(fixed).project(source(products));assert.equal(result.ok,true);return result.view;}
function denies(value,code='invalid_source',fixed=binding){assert.deepEqual(projector(fixed).project(value),{ok:false,error:code});}
function decodeDenied(view,fixed=binding){assert.throws(()=>History.normalizeLegacyStoredHistory(view,fixed),e=>e.message==='invalid_history');}
function clone(value){return JSON.parse(JSON.stringify(value));}

test('default OFF never reads binding, source, selector or dependency getters',()=>{
  let reads=0;const input={};Object.defineProperty(input,'products',{get(){reads++;throw Error('synthetic-secret');}});
  const options={enabled:false};Object.defineProperty(options,'binding',{get(){reads++;throw Error('synthetic-secret');}});
  assert.deepEqual(History.createLegacyStoredHistoryProjector(options).project(input),{ok:false,error:'service_disabled'});
  Object.defineProperty(options,'enabled',{get(){reads++;throw Error('synthetic-secret');}});
  assert.deepEqual(History.createLegacyStoredHistoryProjector(options).project(input),{ok:false,error:'service_disabled'});
  assert.equal(reads,0);
});
test('enabled fixed binding requires exact own fields and only cutting or sewing',()=>{
  for(const bad of [null,{}, {...binding,workerId:''},{...binding,uid:'../synthetic-secret'},{...binding,division:'qc'},{...binding,division:'owner'},{...binding,databaseURL:'https://example.invalid'},{...binding,databaseURL:binding.databaseURL+'/'},{...binding,databaseURL:binding.databaseURL+'?token=synthetic-secret'},{...binding,grantRevision:0},{...binding,grantRevision:'1'},{...binding,modules:{jahit:true}},{...binding,active:true},Object.create(binding)]){
    assert.deepEqual(projector(bad).project(source([])),{ok:false,error:'invalid_binding'});
  }
  let reads=0;const bad={...binding};Object.defineProperty(bad,'workerId',{enumerable:true,get(){reads++;return binding.workerId;}});
  assert.deepEqual(projector(bad).project(source([])),{ok:false,error:'invalid_binding'});assert.equal(reads,0);
});
test('project has no caller worker, UID, role, label or email selector',()=>{
  for(const extra of [{workerId:'synthetic-worker-b'},{uid:'synthetic-user-b'},{profile:{owner:true}},{requestedWorkerId:binding.workerId},{email:'synthetic@example.invalid'}])denies({...source([product()]),...extra});
  const fixed={...binding},client=projector(fixed);fixed.workerId='synthetic-worker-b';
  const input=source([product({jahit:[row(),row({id:'synthetic-row-2',tukangId:'synthetic-worker-b',total:321})]})]);
  const result=client.project(input);assert.equal(result.ok,true);assert.equal(result.view.binding.workerId,binding.workerId);assert.equal(result.view.records.length,1);assert.equal(result.view.records[0].stored.total,901.75);
});
test('stored quantities, fractional tariffs and mismatched totals are independently preserved',()=>{
  const input=source([product({jahit:[row({jumlah:7.25,lolos:1,rijek:30,tarif:12.5,total:901.75,kiloan:1.125,quantityBasis:'legacy-stored'})]})]),before=clone(input);
  const output=projector().project(input);assert.equal(output.ok,true);const record=output.view.records[0];
  assert.deepEqual(record.stored,{tanggal:'2026-02-01',jumlah:7.25,lolos:1,rijek:30,kiloan:1.125,tarif:12.5,total:901.75,dibayar:false,quantityBasis:'legacy-stored'});
  assert.notEqual(record.stored.total,record.stored.jumlah*record.stored.tarif);assert.deepEqual(input,before);
  assert.equal(Object.hasOwn(output.view,'total'),false);assert.equal(Object.hasOwn(record,'paymentEvidence'),false);
});
test('absent values, stored nulls and numeric zeros remain distinct without defaults',()=>{
  const input=row({tanggal:null,jumlah:0,tarif:null,total:0});delete input.lolos;delete input.rijek;delete input.dibayar;
  const value=projected([product({jahit:[input]})]);assert.deepEqual(value.records[0].stored,{tanggal:null,jumlah:0,tarif:null,total:0});
  assert.equal(Object.hasOwn(value.records[0].stored,'lolos'),false);assert.equal(Object.hasOwn(value.records[0].stored,'dibayar'),false);
  assert.deepEqual(History.normalizeLegacyStoredHistory(value,binding),value);
});
test('unavailable source remains null while known empty maps or arrays are available',()=>{
  const absent=projected(null);assert.equal(absent.availability,'unavailable');assert.equal(absent.records,null);
  for(const empty of [[],{}]){const value=projected(empty);assert.equal(value.availability,'available');assert.deepEqual(value.records,[]);}
  denies({snapshotVersion:'synthetic-version-1'});denies(source(undefined));
});
test('division-bound projector cannot expose matching-ID other-family or inferred QC/gudang wages',()=>{
  const p=product({jahit:[row()],potong:[row({total:888})],qc:[row({total:777})],hitungFisik:[row({total:666})],gudang:[row({total:555})],bayarJahit:[row({total:444})]});
  const sewing=projected([p]);assert.equal(sewing.records.length,1);assert.equal(sewing.records[0].stored.total,901.75);
  const cutting=projected([p],{...binding,division:'potong'});assert.equal(cutting.records.length,1);assert.equal(cutting.records[0].stored.total,888);assert.equal(cutting.records[0].division,'potong');
  const qcOnly=projected([product({jahit:[],qc:[row()],gudang:[row()]})]);assert.deepEqual(qcOnly.records,[]);
});
test('ownership is exact stored worker ID, with no name, case, substring or map-key fallback',()=>{
  const rows=[row({id:'synthetic-1',tukangId:'SYNTHETIC-WORKER-A'}),row({id:'synthetic-2',tukangId:binding.workerId+'-other'}),row({id:'synthetic-3',tukangId:null,tukangNama:binding.workerId}),row({id:'synthetic-4',tukangId:undefined})];
  delete rows[3].tukangId;
  const value=projected({syntheticProduct:product({jahit:{[binding.workerId]:rows[0],a:rows[1],b:rows[2],c:rows[3]}})});assert.deepEqual(value.records,[]);
});
test('allowlist drops every unknown record and product field without reading their getters',()=>{
  let reads=0;const r=row(),p=product({jahit:[r]});
  for(const [target,key] of [[r,'pin'],[r,'deviceInfo'],[r,'bankAccount'],[r,'tukangNama'],[r,'inputAt'],[p,'internalCost'],[p,'bayarJahit'],[p,'qc'],[p,'gudang'],[p,'potong']])Object.defineProperty(target,key,{enumerable:true,get(){reads++;throw Error('synthetic-secret');}});
  const value=projected([p]),encoded=JSON.stringify(value);
  assert.equal(reads,0);for(const key of ['pin','deviceInfo','bankAccount','tukangNama','inputAt','internalCost','bayarJahit','qc','gudang','potong'])assert.equal(encoded.includes('"'+key+'"'),false);
});
test('other-worker amount getters are not read and no ignored-worker totals or counts are exposed',()=>{
  let reads=0;const other=row({id:'synthetic-row-other',tukangId:'synthetic-worker-b'});Object.defineProperty(other,'total',{enumerable:true,get(){reads++;throw Error('synthetic-secret');}});
  const value=projected([product({jahit:[row(),other]})]);assert.equal(reads,0);assert.equal(value.records.length,1);assert.deepEqual(Object.keys(value).sort(),['availability','binding','coverage','records','schemaVersion','snapshotVersion']);
});
test('matched selected-field accessors fail generically without execution or partial output',()=>{
  for(const field of ['tukangId','jumlah','tarif','total','id']){
    let reads=0;const r=row();Object.defineProperty(r,field,{enumerable:true,get(){reads++;throw Error('synthetic-secret');}});
    denies(source([product({jahit:[r]})]));assert.equal(reads,0);
  }
  let reads=0;const p=product();Object.defineProperty(p,'namaBarang',{enumerable:true,get(){reads++;throw Error('synthetic-secret');}});denies(source([p]));assert.equal(reads,0);
});
test('malicious source inspection errors cannot expose error hooks or escape generic result',()=>{
  let errorReads=0;const thrown=new Proxy({}, {getOwnPropertyDescriptor(){errorReads++;throw Error('synthetic-secret');}});
  const badSource=new Proxy(source([]),{getPrototypeOf(){throw thrown;}});
  assert.deepEqual(projector().project(badSource),{ok:false,error:'invalid_source'});assert.equal(errorReads,1);
});
test('archive codec follows only direct stored families and uses parent product metadata',()=>{
  const value=projected([product({jahit:[],arsip:[{id:'synthetic-archive-1',namaBarang:'Do not substitute archive metadata',jahit:[row()],arsip:[{jahit:[row({id:'synthetic-nested',total:100})]}]}]})]);
  assert.equal(value.records.length,1);assert.equal(value.records[0].product.namaBarang,'Synthetic garment');assert.deepEqual(value.records[0].locations,[{type:'archive',archiveId:'synthetic-archive-1'}]);
  const archivedFlag=projected([product({arsip:true})]);assert.equal(archivedFlag.records.length,1);
});
test('exact explicit-ID current/archive copies collapse without summation and retain provenance',()=>{
  const value=projected([product({arsip:[{id:'synthetic-archive-a',jahit:[row()]},{id:'synthetic-archive-b',jahit:[row()]}]})]);
  assert.equal(value.records.length,1);assert.equal(value.records[0].stored.total,901.75);assert.equal(value.records[0].copyCount,3);
  assert.deepEqual(value.records[0].locations,[{type:'current'},{type:'archive',archiveId:'synthetic-archive-a'},{type:'archive',archiveId:'synthetic-archive-b'}]);
  assert.deepEqual(History.normalizeLegacyStoredHistory(value,binding),value);
});
test('conflicting stored values, absence/null or payment markers sharing an explicit ID fail closed',()=>{
  for(const change of [{total:901.76},{tarif:13},{jumlah:8},{dibayar:1},{lolos:null}])denies(source([product({arsip:[{id:'synthetic-archive-a',jahit:[row(change)]}]})]),'conflicting_record');
  const absent=row();delete absent.lolos;denies(source([product({arsip:[{jahit:[absent]}]})]),'conflicting_record');
  denies(source([product(),product({namaBarang:'Different product label'})]),'conflicting_record');
});
test('explicit same row IDs on distinct products remain separate and never share a dedup key',()=>{
  const value=projected([product(),product({id:'synthetic-product-2'})]);assert.equal(value.records.length,2);assert.equal(value.records[0].copyCount,1);assert.equal(value.records[1].copyCount,1);
});
test('idless identical rows stay distinct; no source ID is invented from map keys or content',()=>{
  const r=row();delete r.id;
  const value=projected([product({jahit:{syntheticMapKey:r},arsip:[{jahit:[{...r}]}]})]);assert.equal(value.records.length,2);
  for(const record of value.records){assert.equal(Object.hasOwn(record,'sourceRecordId'),false);assert.equal(record.copyCount,1);}
  assert.equal(JSON.stringify(value).includes('syntheticMapKey'),false);
});
test('frozen outputs are fresh copies and input edits cannot change later displayed history',()=>{
  const input=source([product()]),result=projector().project(input);assert.equal(result.ok,true);
  input.products[0].jahit[0].total=1;input.products[0].size='XL';
  assert.equal(result.view.records[0].stored.total,901.75);assert.equal(result.view.records[0].product.size,'M');
  for(const v of [result,result.view,result.view.binding,result.view.records,result.view.records[0],result.view.records[0].stored,result.view.records[0].product,result.view.records[0].locations,result.view.records[0].locations[0]])assert.equal(Object.isFrozen(v),true);
});
test('typed stored scalars reject coercion, negative/nonfinite values and unsupported markers',()=>{
  for(const [key,value] of [['jumlah','7'],['total',-1],['tarif',Infinity],['rijek',NaN],['kiloan',-0],['lolos',Number.MAX_SAFE_INTEGER+1],['dibayar',2],['dibayar',{}],['tanggal','bad\ntext'],['quantityBasis','x'.repeat(65)]])denies(source([product({jahit:[row({[key]:value})]})]));
  for(const dibayar of [true,false,0,1,'true','false',null])assert.equal(projected([product({jahit:[row({dibayar})]})]).records[0].stored.dibayar,dibayar);
  assert.equal(projected([product({jahit:[row({tanggal:'legacy date not interpreted'})]})]).records[0].stored.tanggal,'legacy date not interpreted');
});
test('array/map source collections preserve null/sparse RTDB slots without interpreting keys as IDs',()=>{
  const sparse=[];sparse[2]=row();sparse[3]=null;
  const value=projected({p:product({jahit:sparse,arsip:{a:null,b:{jahit:{r:row({id:'synthetic-row-2'})}}}})});assert.equal(value.records.length,2);assert.deepEqual(value.records[1].locations,[{type:'archive'}]);
  denies(source([product({jahit:[false]})]));denies(source([product({jahit:1})]));
  const list=[row()];list.extra=row();denies(source([product({jahit:list})]));
});
test('codec rejects binding swaps, cross-worker records, unknown fields and malformed provenance',()=>{
  const valid=projected([product()]);
  for(const changed of [{...binding,uid:'synthetic-user-b'},{...binding,workerId:'synthetic-worker-b'},{...binding,division:'potong'},{...binding,tenantId:'synthetic-tenant-b'},{...binding,projectId:'synthetic-project-b'},{...binding,databaseURL:'https://synthetic-project-other.firebaseio.com'},{...binding,grantRevision:2}])decodeDenied(valid,changed);
  const mutations=[v=>v.records[0].workerId='synthetic-worker-b',v=>v.records[0].division='potong',v=>v.records[0].stored.internalCost=500,v=>v.records[0].sourceRecordId='',v=>v.records[0].copyCount=2,v=>v.records[0].locations[0].archiveId='synthetic-archive',v=>v.records[0].locations[0].type='qc',v=>v.records.push(clone(v.records[0])),v=>v.availability='unavailable',v=>v.snapshotVersion='../synthetic-secret'];
  for(const mutate of mutations){const v=clone(valid);mutate(v);decodeDenied(v);}
});
test('codec requires dense own DTO arrays, rejects inherited identity and runs no field getters',()=>{
  const value=clone(projected([product()]));value.records.length=2;decodeDenied(value);
  const inherited=clone(projected([product()]));const actual=inherited.records[0];delete actual.workerId;Object.setPrototypeOf(actual,{workerId:binding.workerId});decodeDenied(inherited);
  let reads=0;const accessor=clone(projected([product()]));Object.defineProperty(accessor.records[0].stored,'total',{enumerable:true,get(){reads++;throw Error('synthetic-secret');}});decodeDenied(accessor);assert.equal(reads,0);
});
test('inherited object/array JSON hooks cannot run or change projection, copies or codec values',()=>{
  const input=source([product({arsip:[{id:'synthetic-archive-a',jahit:[row()]}]})]);let calls=0,projectResult,decoded;
  const objectHook=Object.getOwnPropertyDescriptor(Object.prototype,'toJSON'),arrayHook=Object.getOwnPropertyDescriptor(Array.prototype,'toJSON');
  try{
    Object.defineProperty(Object.prototype,'toJSON',{configurable:true,get(){calls++;throw Error('synthetic-secret');}});
    Object.defineProperty(Array.prototype,'toJSON',{configurable:true,value(){calls++;return ['synthetic-corrupted'];}});
    projectResult=projector().project(input);if(projectResult.ok)decoded=History.normalizeLegacyStoredHistory(projectResult.view,binding);
  }finally{
    if(objectHook)Object.defineProperty(Object.prototype,'toJSON',objectHook);else delete Object.prototype.toJSON;
    if(arrayHook)Object.defineProperty(Array.prototype,'toJSON',arrayHook);else delete Array.prototype.toJSON;
  }
  assert.equal(calls,0);assert.equal(projectResult.ok,true);assert.equal(projectResult.view.records[0].copyCount,2);assert.equal(decoded.records[0].stored.total,901.75);
});
test('inherited selected fields supply neither worker ownership nor stored amount defaults',()=>{
  const originalWorker=Object.getOwnPropertyDescriptor(Object.prototype,'tukangId'),originalTotal=Object.getOwnPropertyDescriptor(Object.prototype,'total');let reads=0,result;
  const missingWorker=row();delete missingWorker.tukangId;const missingTotal=row({id:'synthetic-row-2'});delete missingTotal.total;
  try{
    Object.defineProperty(Object.prototype,'tukangId',{configurable:true,get(){reads++;return binding.workerId;}});
    Object.defineProperty(Object.prototype,'total',{configurable:true,get(){reads++;return 999;}});
    result=projector().project(source([product({jahit:[missingWorker,missingTotal]})]));
  }finally{
    if(originalWorker)Object.defineProperty(Object.prototype,'tukangId',originalWorker);else delete Object.prototype.tukangId;
    if(originalTotal)Object.defineProperty(Object.prototype,'total',originalTotal);else delete Object.prototype.total;
  }
  assert.equal(reads,0);assert.equal(result.ok,true);assert.equal(result.view.records.length,1);assert.equal(Object.hasOwn(result.view.records[0].stored,'total'),false);
});
test('fixed product, archive, source-row, output-row and duplicate-copy limits reject oversized sources',()=>{
  denies(source(new Array(History.LIMITS.products+1)),'capacity_limit');
  denies(source([product({arsip:new Array(History.LIMITS.archivesPerProduct+1)})]),'capacity_limit');
  denies(source([product({jahit:new Array(History.LIMITS.sourceRows+1)})]),'capacity_limit');
  const rows=Array.from({length:History.LIMITS.records+1},(_,i)=>row({id:'synthetic-row-'+i}));denies(source([product({jahit:rows})]),'capacity_limit');
  const copies=Array.from({length:History.LIMITS.copies+1},()=>row());denies(source([product({jahit:copies})]),'capacity_limit');
});
test('total direct-archive and projected-byte budgets are enforced independently',()=>{
  const products=Array.from({length:33},(_,i)=>product({id:'synthetic-product-'+i,jahit:[],arsip:Array.from({length:256},()=>({jahit:[]}))}));denies(source(products),'capacity_limit');
  const large=product({series:'x'.repeat(256),namaBarang:'y'.repeat(256),size:'z'.repeat(256),jahit:Array.from({length:1500},(_,i)=>row({id:'synthetic-row-'+i}))});denies(source([large]),'capacity_limit');
});
test('normalizer also enforces byte bounds and never converts unavailable or idless data into zero',()=>{
  const value=projected([product()]),large=clone(value);large.records=[];
  for(let i=0;i<1500;i++){const r=clone(value.records[0]);r.sourceRecordId='synthetic-row-'+i;r.product={series:'x'.repeat(256),namaBarang:'y'.repeat(256),size:'z'.repeat(256)};large.records.push(r);}decodeDenied(large);
  const missing=History.normalizeLegacyStoredHistory(projected(null),binding);assert.equal(missing.records,null);assert.equal(missing.availability,'unavailable');
});
