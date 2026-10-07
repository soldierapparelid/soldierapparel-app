'use strict';
const readReviewedLegacyHtml=require('./helpers/legacy-html-source.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=readReviewedLegacyHtml('laporan-produksi.html');
// Verified unmodified main handler at commit 2c3e873; synthetic inputs only.
const originalHandler = "$('#entrySave').onclick = () => {\n  try{\n    if(!entryState){ alert('State kosong. Coba buka modal lagi.'); return; }\n    const { mode, id, kind } = entryState;\n    let idx = entryState.idx;\n    const p = DB.produksi.find(x => x.id === id);\n    if(!p){ alert('Barang tidak ketemu'); return; }\n    if(mode==='edit' && entryState.snapshot){idx=mutationIndex(p[kind],entryState.snapshot);if(idx<0){mutationConflict();return;}}\n    const tanggal = $('#entryTanggal').value || today();\n    const isJahit = kind === 'bayarJahit';\n    const isGudang = kind === 'gudang';\n    let jumlah = 0;\n    if(!isJahit){\n      jumlah = Number($('#entryJumlah').value) || 0;\n      if(!Number.isSafeInteger(jumlah) || jumlah <= 0){ alert('Isi jumlah pcs bulat lebih dari 0'); return; }\n    }\n    const status = isGudang ? $('#entryStatus').value : null;\n    const ket = isGudang ? ($('#entryKet').value||'').trim() : null;\n    ensureArrays(p);\n    if(!Array.isArray(p[kind])) p[kind] = [];\n    if(mode === 'add'){\n      if(isJahit) p[kind].push({ id:uid(), tanggal });\n      else if(isGudang) p[kind].push({ id:uid(), tanggal, jumlah, status, ket });\n      else p[kind].push({ id:uid(), tanggal, jumlah });\n    } else {\n      const entry = p[kind][idx];\n      if(!entry){ alert('Entri tidak ditemukan (idx '+idx+')'); return; }\n      entry.tanggal = tanggal;\n      entry.editedAt = new Date().toISOString();\n      if(!isJahit) entry.jumlah = jumlah;\n      if(isGudang){ entry.status = status; entry.ket = ket; }\n    }\n    entryState = null;\n    $('#entryOv').classList.remove('on');\n    _markMod(id, kind);\n    saveLocal();\n    openDetail(id);\n    markEdited(id);\n    renderTable();\n    renderRingkas();\n  }catch(err){\n    console.error('Save error:', err);\n    alert('Error save: '+err.message+'\\n\\nBuka F12 Console untuk detail.');\n  }\n};";
function extract(start,end){const from=source.indexOf(start),to=source.indexOf(end,from);assert.ok(from>=0&&to>from);return source.slice(from,to);}
const fixedHandler=source.match(/\$\('#entrySave'\)\.onclick = \(\) => \{[\s\S]*?\n\};/)[0];
const clone=value=>structuredClone(value);
const fixture=()=>({id:'synthetic-cutting-record',tanggal:'2026-01-01',jumlah:2,tarif:3,total:6,tukangId:'synthetic-worker',tukangNama:'Synthetic partner',dibayar:false,bahanList:[{jenis:'Synthetic fabric',kg:1}],rols:[{purchaseId:'synthetic-roll',kg:1}],receipt:{reference:'synthetic-receipt',approved:true},extraMetadata:'preserve'});
function harness(record=fixture(),{original=false,kind='potong',quantity=record.jumlah,date='2026-01-02'}={}){
  const fields=new Map(),alerts=[],events=[],product={id:'synthetic-product',[kind]:[record],unrelated:[{id:'synthetic-other-record'}]};
  const $=selector=>{if(!fields.has(selector))fields.set(selector,{value:'',classList:{remove(){}}});return fields.get(selector);};
  $('#entryTanggal').value=date;$('#entryJumlah').value=String(quantity);$('#entryStatus').value='ok';$('#entryKet').value='Synthetic note';
  const context={$ ,DB:{produksi:[product]},entryState:null,today:()=> '2026-01-02',alert:message=>alerts.push(message),ensureArrays:()=>events.push('normalize'),_markMod:()=>events.push('mark'),saveLocal:()=>events.push('save'),openDetail(){},markEdited(){},renderTable(){},renderRingkas(){},console:{error(){}}};
  vm.createContext(context);
  vm.runInContext(extract('function mutationFingerprint(value){','function mutationConflict(){'),context);
  context.mutationConflict=()=>alerts.push('stale_form');
  context.entryState={mode:'edit',id:product.id,kind,idx:0,snapshot:context.mutationSnapshot(record)};
  if(!original)vm.runInContext(extract('function cuttingQuantityEdit(entry,jumlah){',"$('#entrySave').onclick"),context);
  vm.runInContext(original?originalHandler:fixedHandler,context);
  return {record,product,context,alerts,events,save:()=>$('#entrySave').onclick()};
}
test('verified original handler reproduces changed quantity with stale recorded total',()=>{
  const run=harness(fixture(),{original:true,quantity:4});run.save();
  assert.equal(run.record.jumlah,4);assert.equal(run.record.tarif,3);assert.equal(run.record.total,6);assert.notEqual(run.record.total,run.record.jumlah*run.record.tarif);
});
test('valid tuple quantity edit retains frozen tariff and all identities/metadata while updating total with native multiplication',()=>{
  const run=harness(fixture(),{quantity:4}),before=clone(run.record),unrelated=clone(run.product.unrelated);run.save();
  assert.equal(run.record.jumlah,4);assert.equal(run.record.tarif,before.tarif);assert.equal(run.record.total,4*before.tarif);assert.equal(run.events.filter(event=>event==='save').length,1);
  const retained=clone(run.record);delete retained.editedAt;retained.jumlah=before.jumlah;retained.total=before.total;retained.tanggal=before.tanggal;
  assert.deepEqual(retained,before);assert.deepEqual(run.product.unrelated,unrelated);
});
test('inconsistent, partial, negative, nonnumeric or nonfinite tuples hold every source value before normalization or persistence',()=>{
  const mutations=[record=>record.total=7,record=>delete record.tarif,record=>delete record.total,record=>record.tarif='3',record=>record.total=null,record=>record.tarif=-3,record=>record.total=Infinity,record=>record.jumlah='2'];
  for(const mutate of mutations){const record=fixture();mutate(record);const before=clone(record),run=harness(record,{quantity:4});run.save();
    assert.deepEqual(record,before);assert.deepEqual(run.events,[]);assert.ok(run.alerts.includes('Catatan upah potong perlu diperiksa owner. Jumlah, tarif, dan total belum diubah.'));
  }
});
test('date-only and unchanged-quantity edits retain inconsistent/partial totals and preserve a legacy numeric-string quantity',()=>{
  for(const mutate of [record=>record.total=7,record=>delete record.tarif,record=>delete record.total,record=>{record.jumlah='2';record.tarif='3';}]){
    const record=fixture();mutate(record);const before=clone(record),run=harness(record,{quantity:2});run.save();
    assert.equal(record.jumlah,before.jumlah);assert.equal(record.tarif,before.tarif);assert.equal(record.total,before.total);assert.equal(Object.hasOwn(record,'total'),Object.hasOwn(before,'total'));assert.equal(record.tanggal,'2026-01-02');assert.ok(record.editedAt);assert.ok(run.events.includes('save'));
  }
});
test('operations-only cutting records retain existing quantity edit behavior without adding monetary fields or IDs',()=>{
  const record={tanggal:'2026-01-01',jumlah:2,ket:'Synthetic legacy note'},run=harness(record,{quantity:4});run.save();
  assert.equal(record.jumlah,4);for(const key of ['id','tarif','total'])assert.equal(Object.hasOwn(record,key),false);assert.equal(record.ket,'Synthetic legacy note');assert.ok(run.events.includes('save'));
});
test('native floating precision is preserved; decimal-rounded historical totals are held instead of corrected',()=>{
  const valid=fixture();valid.jumlah=3;valid.tarif=0.1;valid.total=3*0.1;const run=harness(valid,{quantity:7});run.save();assert.equal(valid.total,7*0.1);assert.notEqual(valid.total,0.7);assert.equal(valid.tarif,0.1);
  const rounded=fixture();rounded.jumlah=3;rounded.tarif=0.1;rounded.total=0.3;const before=clone(rounded),held=harness(rounded,{quantity:7});held.save();assert.deepEqual(rounded,before);assert.deepEqual(held.events,[]);
});
test('finite multiplication overflow and already-overflowing source tuples are held without partial mutation',()=>{
  for(const [oldQuantity,newQuantity]of [[1,2],[2,3]]){const record=fixture();record.jumlah=oldQuantity;record.tarif=1e308;record.total=1e308;const before=clone(record),run=harness(record,{quantity:newQuantity});run.save();assert.deepEqual(record,before);assert.deepEqual(run.events,[]);}
});
test('zero-rate recorded tuples remain zero-rate without reading current tariffs',()=>{
  const record=fixture();record.tarif=0;record.total=0;const run=harness(record,{quantity:4});run.save();assert.equal(record.tarif,0);assert.equal(record.total,0);assert.equal(record.jumlah,4);
});
test('actual stale snapshot guard blocks overwrite after another edit, including IDless histories',()=>{
  for(const idless of [false,true]){const record=fixture();if(idless)delete record.id;const run=harness(record,{quantity:4});record.jumlah=5;record.total=15;const changed=clone(record);run.save();assert.deepEqual(record,changed);assert.deepEqual(run.events,[]);assert.ok(run.alerts.includes('stale_form'));}
});
test('unchanged quantity leaves settled evidence and monetary metadata intact; other stage editing remains unchanged',()=>{
  const settled=fixture();settled.dibayar=true;settled.dibayarAt='2026-01-01T00:00:00.000Z';const run=harness(settled,{quantity:2});run.save();assert.equal(settled.total,6);assert.equal(settled.dibayar,true);assert.equal(settled.dibayarAt,'2026-01-01T00:00:00.000Z');
  const other={id:'synthetic-gudang',tanggal:'2026-01-01',jumlah:2,status:'reject',ket:'Before',total:7},otherRun=harness(other,{kind:'gudang',quantity:4});otherRun.save();assert.equal(other.jumlah,4);assert.equal(other.status,'ok');assert.equal(other.total,7);
});

test('changed quantity holds supported paid flags and any existing payment timestamp before any mutation or persistence',()=>{
  for(const marker of [{dibayar:true},{dibayar:1},{dibayar:'true'},{dibayar:false,dibayarAt:'2026-01-01T00:00:00.000Z'},{dibayar:false,dibayarAt:null},{dibayarAt:''}]){
    const record=Object.assign(fixture(),marker),before=clone(record),run=harness(record,{quantity:4});run.save();
    assert.deepEqual(record,before);assert.deepEqual(run.events,[]);assert.equal(run.context.entryState.mode,'edit');
    assert.ok(run.alerts.includes('Catatan upah potong perlu diperiksa owner. Jumlah, tarif, dan total belum diubah.'));
  }
  const operationsOnly={tanggal:'2026-01-01',jumlah:2,dibayar:true},before=clone(operationsOnly),run=harness(operationsOnly,{quantity:4});run.save();
  assert.deepEqual(operationsOnly,before);assert.deepEqual(run.events,[]);
});

test('date-only edits retain every supported paid marker and preserve exact recorded quantity, rate, total and receipt evidence',()=>{
  for(const marker of [{dibayar:true},{dibayar:1},{dibayar:'true'},{dibayar:false,dibayarAt:'2026-01-01T00:00:00.000Z'},{dibayar:false,dibayarAt:null},{dibayarAt:''}]){
    const record=Object.assign(fixture(),marker),before=clone(record),run=harness(record,{quantity:2});run.save();
    const retained=clone(record);delete retained.editedAt;retained.tanggal=before.tanggal;
    assert.deepEqual(retained,before);assert.equal(record.tanggal,'2026-01-02');assert.ok(run.events.includes('save'));
  }
});

test('actual stale guard holds a payment recorded after the edit form opens',()=>{
  const record=fixture(),run=harness(record,{quantity:4});record.dibayar=true;record.dibayarAt='2026-01-01T00:00:00.000Z';const before=clone(record);run.save();
  assert.deepEqual(record,before);assert.deepEqual(run.events,[]);assert.ok(run.alerts.includes('stale_form'));
});
test('invalid submitted quantity is rejected by existing UI validation without touching the recorded tuple',()=>{
  for(const quantity of [Infinity,NaN,-1,0,2.5]){const record=fixture(),before=clone(record),run=harness(record,{quantity});run.save();assert.deepEqual(record,before);assert.deepEqual(run.events,[]);}
});
