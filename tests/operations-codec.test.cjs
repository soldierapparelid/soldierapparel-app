'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Codec=require('../operations-codec.js'),Sync=require('../production-sync.js');
const schema=require('../security/finance-schema.cjs');
function fixture(){
  return {'product-1':{id:'product-1',series:'Example',namaBarang:'Example',size:'M',poAktif:true,poJumlah:8,poTanggal:'2026-01-01',
    assignJahit:[null,{id:'assignment-1',tukangId:'worker-1',qty:8,sisa:8,tanggal:'2026-01-01'}],
    jahit:[{id:'sewing-1',tukangId:'worker-1',assignmentId:'assignment-1',jumlah:2,rijek:0,lolos:2,quantityBasis:'good-plus-reject',tanggal:'2026-01-02'}],
    hitungFisik:[null,{id:'count-1',jumlah:2,tukangId:'worker-1',qcId:'quality-1',workflowVersion:2,countStage:'verified',tanggal:'2026-01-02'}],
    qc:{'quality-1':{id:'quality-1',tukangId:'worker-1',hfId:'count-1',qcBatchId:'batch-1',ok:2,reject:0,perbaikan:0,offline:0,workflowVersion:2,tanggal:'2026-01-03'}},
    gudang:[{id:'warehouse-1',jumlah:2,status:'ok',qcId:'quality-1',hfId:'count-1',workflowVersion:2,payrollStage:'initial',tanggal:'2026-01-03'}],
    bigSaller:false,arsip:[null,{id:'archive-1',tanggalArsip:'2025-12-31',potong:[null,{id:'cut-1',jumlah:4,tanggal:'2025-12-30'}]}]
  },'product-2':{id:'product-2',series:'Example',namaBarang:'Example',size:'L',poAktif:false,poJumlah:0,arsip:true}};
}
const clone=value=>JSON.parse(JSON.stringify(value));
test('browser UMD matches the reviewed operational allowlist and has no CJS runtime dependency',()=>{
  assert.deepEqual(Codec.schema,{rows:{...schema.rows,...schema.canonicalRows},product:schema.product,archive:schema.archive});
  const source=fs.readFileSync(require.resolve('../operations-codec.js'),'utf8'),context=vm.createContext({});
  vm.runInContext(source,context);assert.equal(typeof context.SoldierOperationsCodec.encode,'function');
  assert.equal(source.includes('require('),false);assert.ok(Object.isFrozen(Codec.schema.rows.qc));
});
test('no-op map to view roundtrip preserves nested null positions, archives, ID maps and relationship IDs exactly',()=>{
  const input=fixture(),before=clone(input),view=Codec.decode(input),roundtrip=Codec.encode(view);
  assert.deepEqual(roundtrip,input);assert.deepEqual(input,before);
  assert.equal(view[0].assignJahit[0],null);assert.equal(view[0].hitungFisik[0],null);assert.equal(view[0].arsip[0],null);
  assert.equal(view[0].qc['quality-1'].hfId,'count-1');assert.equal(view[0].gudang[0].qcId,'quality-1');
  assert.deepEqual(Codec.encode([]),{});assert.deepEqual(Codec.decode({}),[]);
  view[0].jahit[0].jumlah=3;assert.equal(input['product-1'].jahit[0].jumlah,2);
});

test('canonical repair IDs roundtrip without finance, actor identities or silent unknown fields',()=>{
  const input=fixture();input['product-1'].repairs=[{id:'repair-1',qcId:'quality-1',tukangId:'worker-1',tanggal:'2026-01-03',jumlah:1,inputAt:'2026-01-03T03:00:00.000Z'}];
  const before=clone(input);assert.deepEqual(Codec.encode(Codec.decode(input)),input);assert.deepEqual(input,before);
  for(const field of ['tarif','total','payroll','actorUid','workerName']){const bad=clone(input);bad['product-1'].repairs[0][field]=1;assert.throws(()=>Codec.decode(bad),/operations_unknown_field/);}
  const duplicate=clone(input);duplicate['product-1'].repairs.push(clone(duplicate['product-1'].repairs[0]));assert.throws(()=>Codec.decode(duplicate),/operations_duplicate_id/);
  const mismatch=clone(input);mismatch['product-1'].repairs={'repair-other':mismatch['product-1'].repairs[0]};assert.throws(()=>Codec.decode(mismatch),/operations_key_id_mismatch/);
});
test('valid view edits encode back under product IDs without numeric reindexing or mutating snapshots',()=>{
  const input=fixture(),before=clone(input),view=Codec.decode(input);
  view.reverse();view.find(row=>row.id==='product-1').jahit.push({id:'sewing-2',tukangId:'worker-1',assignmentId:'assignment-1',jumlah:1,rijek:0,lolos:1,tanggal:'2026-01-04'});
  const encoded=Codec.encode(view);assert.deepEqual(Object.keys(encoded),['product-2','product-1']);assert.equal(encoded['product-1'].jahit.length,2);assert.equal(Object.hasOwn(encoded,'0'),false);
  assert.deepEqual(input,before);encoded['product-1'].jahit[1].jumlah=7;assert.equal(view[1].jahit[1].jumlah,1);
});
test('map merge retains disjoint concurrent record edits, identity keys and immutable source snapshots',()=>{
  const base=fixture(),local=clone(base),remote=clone(base),originals=[clone(base),clone(local),clone(remote)];
  local['product-1'].jahit[0].jumlah=3;local['product-1'].jahit[0].lolos=3;
  remote['product-1'].jahit.push({id:'sewing-2',tukangId:'worker-1',assignmentId:'assignment-1',jumlah:1,rijek:0,lolos:1,tanggal:'2026-01-04'});
  originals[1]=clone(local);originals[2]=clone(remote);
  const merge=Codec.createMerge(Sync.merge,{fields:['jahit']}),result=merge(base,local,remote);
  assert.equal(result.ok,true);assert.deepEqual(result.conflicts,[]);assert.equal(result.value['product-1'].jahit.length,2);assert.equal(result.value['product-1'].jahit[0].jumlah,3);
  assert.deepEqual([base,local,remote],originals);assert.deepEqual(Codec.merge(base,base,base,Sync.merge,{fields:['jahit']}).value,base);
});
test('conflicting records and changed PO cycles stop without returning a candidate map',()=>{
  const base=fixture(),local=clone(base),remote=clone(base);
  local['product-1'].jahit[0].jumlah=3;remote['product-1'].jahit[0].jumlah=4;
  const result=Codec.merge(base,local,remote,Sync.merge,{fields:['jahit']});assert.equal(result.ok,false);assert.ok(result.conflicts.length);assert.equal(Object.hasOwn(result,'value'),false);
  const changed=clone(base);changed['product-1'].poAktif=false;
  assert.equal(Codec.merge(base,local,changed,Sync.merge,{fields:['jahit']}).ok,false);
});
test('duplicates and key-id mismatches reject at every mapped collection',()=>{
  const view=Codec.decode(fixture());view.push(clone(view[0]));assert.throws(()=>Codec.encode(view),/operations_duplicate_id/);
  const nested=fixture();nested['product-1'].jahit.push(clone(nested['product-1'].jahit[0]));assert.throws(()=>Codec.decode(nested),/operations_duplicate_id/);
  const wrong=fixture();wrong['product-1'].id='product-other';assert.throws(()=>Codec.decode(wrong),/operations_key_id_mismatch/);
  const wrongNested=fixture();wrongNested['product-1'].qc['quality-1'].id='quality-other';assert.throws(()=>Codec.decode(wrongNested),/operations_key_id_mismatch/);
  const archiveDuplicate=fixture();archiveDuplicate['product-1'].arsip.push(clone(archiveDuplicate['product-1'].arsip[1]));assert.throws(()=>Codec.decode(archiveDuplicate),/operations_duplicate_id/);
});
test('money, PINs, notes, unknown fields and wrong types fail without dropping data or coercing values',()=>{
  for(const [place,key,value]of [['product','harga',123],['product','unexpected','secret'],['sewing','tarif',123],['sewing','total',246],['sewing','dibayar',true],['sewing','pin','synthetic'],['sewing','payroll',{}],['sewing','ket','private'],['sewing','jumlah','2'],['sewing','jumlah',1.5],['sewing','jumlah',-1],['sewing','tukangId',1],['sewing','tanggal','2026-02-31']]){
    const input=fixture(),record=place==='product'?input['product-1']:input['product-1'].jahit[0];record[key]=value;
    const before=clone(input);assert.throws(()=>Codec.decode(input),/operations_(unknown_field|invalid_value)/);assert.deepEqual(input,before);
    assert.throws(()=>Codec.merge(fixture(),input,fixture(),Sync.merge),/operations_(unknown_field|invalid_value)/);
  }
  for(const id of ['__proto__','constructor','prototype','../other','',' spaced ',42]){const input=fixture();input['product-1'].jahit[0].id=id;assert.throws(()=>Codec.decode(input),/operations_invalid_id/);}
});
test('invalid JSON, prototypes, getters, sparse holes, symbols and bad merge results are rejected without executing accessors',()=>{
  const input=fixture();let accessed=false;Object.defineProperty(input['product-1'],'secret',{enumerable:true,get(){accessed=true;throw Error('secret');}});
  assert.throws(()=>Codec.decode(input),/operations_invalid_json/);assert.equal(accessed,false);
  assert.throws(()=>Codec.decode(JSON.parse('{"__proto__":{"id":"bad"}}')),/operations_invalid_json/);assert.equal({}.polluted,undefined);
  const inherited=Object.create({id:'product-1'});assert.throws(()=>Codec.decode({'product-1':inherited}),/operations_invalid_json/);
  for(const mutate of [s=>s['product-1'].poJumlah=Infinity,s=>s['product-1'].poJumlah=NaN,s=>s['product-1'].jahit[0].jumlah=undefined,s=>delete s['product-1'].assignJahit[0],s=>s[Symbol('private')]=true,s=>s['product-1'].arsip.push(s['product-1'])]){const source=fixture();mutate(source);assert.throws(()=>Codec.decode(source),/operations_invalid_json/);}
  assert.throws(()=>Codec.decode(null),/operations_invalid_map/);assert.throws(()=>Codec.encode([null]),/operations_invalid_id/);
  assert.throws(()=>Codec.createMerge(Sync.merge,{fields:['tarif']}),/operations_invalid_merge_options/);
  assert.throws(()=>Codec.merge(fixture(),fixture(),fixture(),()=>({ok:true,conflicts:[],value:[{id:'product-1',payroll:{}}]})),/operations_unknown_field/);
});
