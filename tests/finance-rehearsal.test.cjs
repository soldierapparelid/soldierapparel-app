'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {prepareCandidate}=require('../security/finance-rehearsal.cjs');
const payroll=require('../production-payroll.js');
function fixture(){
  const snapshot={workerId:'worker-1',workerName:'Synthetic worker',rate:123,rateMissing:false,capturedAt:'2026-01-01T00:00:00.000Z'};
  return {workers:[{id:'worker-1',nama:'Synthetic worker',pin:'synthetic-pin',tarif:{'Example|Example':9999},tarifHistory:{'Example|Example':[{effectiveAt:'1970-01-01T00:00:00.000Z',rate:123},{effectiveAt:'2026-02-01T00:00:00.000Z',rate:9999}]}}],advances:[{id:'advance-1',tukangId:'worker-1',jumlah:77,sisa:33,cicilan:[{id:'payment-1',jumlah:44}]}],production:[{id:'product-1',series:'Example',namaBarang:'Example',size:'M',poAktif:true,poJumlah:8,poKet:'private memo',assignJahit:[{id:'assignment-1',tukangId:'worker-1',qty:8,sisa:0,tanggal:'2026-01-01'}],jahit:[{id:'sewing-1',tukangId:'worker-1',assignmentId:'assignment-1',jumlah:8,rijek:0,lolos:8,tarif:123,total:984,dibayar:false,tanggal:'2026-01-01'}],hitungFisik:[{id:'count-1',tukangId:'worker-1',tukang:'Synthetic worker',jumlah:8,tanggal:'2026-01-01',qcId:'quality-1',workflowVersion:2,countStage:'verified',payroll:snapshot}],qc:[{id:'quality-1',tukangId:'worker-1',tukangJahit:'Synthetic worker',hfId:'count-1',tanggal:'2026-01-02',ok:6,perbaikan:2,reject:0,offline:0,workflowVersion:2,payroll:snapshot}],gudang:[{id:'warehouse-1',qcId:'quality-1',jumlah:4,status:'ok',tanggal:'2026-01-02',payroll:snapshot,payrollStage:'initial'},{id:'repair-1',qcId:'quality-1',jumlah:2,status:'ok',tanggal:'2026-01-03',payroll:snapshot,payrollStage:'repair'}],arsip:[]}]};
}
test('separates operational allowlist and preserves exact rates, advances and source without mutation',()=>{
  const source=fixture(),before=JSON.stringify(source),result=prepareCandidate(source);
  assert.equal(result.report.status,'candidate');assert.equal(result.report.readyForProduction,false);
  assert.equal(JSON.stringify(source),before);assert.deepEqual(result.candidate.privateFinance.legacySource,source);
  assert.deepEqual(result.candidate.soldier.workerDirectory,{'worker-1':{id:'worker-1',nama:'Synthetic worker'}});
  const operations=result.candidate.soldier.operationsV2;
  for(const field of ['tarif','total','dibayar','payroll','pin','tarifHistory','cicilan','poKet'])assert.equal(JSON.stringify(operations).includes('"'+field+'"'),false);
  assert.equal(Object.keys(result.candidate.privateFinance.payrollSnapshots).length,5);
  assert.deepEqual(payroll.collectProduct(source.production[0],source.workers),payroll.collectProduct(result.candidate.privateFinance.legacySource.production[0],result.candidate.privateFinance.legacySource.workers));
  assert.ok(payroll.collectProduct(source.production[0],source.workers).every(row=>row.tarif===123));
  const earnings=Object.values(result.candidate.maklonEarnings['worker-1'].entries);
  assert.equal(earnings.reduce((sum,row)=>sum+row.jumlah,0),6);assert.equal(earnings.reduce((sum,row)=>sum+row.total,0),738);
  assert.ok(earnings.every(row=>row.tarif===123));
  for(const key of ['pin','cicilan','kasbon','dibayar','tarifHistory','rawWorker','payroll'])assert.equal(JSON.stringify(result.candidate.maklonEarnings).includes('"'+key+'"'),false);
});
test('archive and repair source identities remain separate, deterministic and cancelled payroll stays cancelled',()=>{
  const source=fixture();const old=structuredClone(source.production[0]);
  delete old.series;delete old.namaBarang;delete old.size;delete old.poAktif;delete old.poJumlah;
  delete old.arsip;
  old.id='archive-1';old.tanggalArsip='2026-01-04';old.hitungFisik[0].payrollCancelled=true;
  for(const field of ['assignJahit','jahit','hitungFisik','qc','gudang'])for(const entry of old[field]){entry.id='old-'+entry.id;for(const link of ['assignmentId','hfId','qcId'])if(entry[link])entry[link]='old-'+entry[link];}
  source.production[0].arsip=[old];
  const one=prepareCandidate(source),two=prepareCandidate(JSON.parse(JSON.stringify(source)));
  assert.equal(one.report.status,'candidate');assert.deepEqual(one.candidate,two.candidate);
  assert.equal(one.report.counts.archives,1);assert.equal(Object.keys(one.candidate.privateFinance.payrollSnapshots).length,10);
  assert.equal(one.candidate.privateFinance.legacySource.production[0].arsip[0].hitungFisik[0].payrollCancelled,true);
  assert.equal(one.candidate.soldier.operationsV2.products['product-1'].arsip[0].hitungFisik[0].payrollCancelled,true);
});
test('unknown fields, fractional counts, missing IDs and unsafe prototype IDs block without a candidate',()=>{
  for(const mutate of [s=>s.production[0].unexpectedFinancialField='synthetic secret',s=>s.production[0].jahit[0].jumlah=1.5,s=>delete s.production[0].jahit[0].id,s=>s.workers[0].id='__proto__',s=>s.production[0].qc[0].tanggal='2026-02-31']){
    const source=fixture();mutate(source);const result=prepareCandidate(source);
    assert.equal(result.report.status,'blocked');assert.equal(result.candidate,undefined);
    assert.equal(JSON.stringify(result.report).includes('synthetic secret'),false);
  }
});
test('ambiguous, missing and conflicting relationships stop rather than infer a worker from a name',()=>{
  for(const mutate of [s=>s.production[0].qc[0].hfId='absent',s=>s.production[0].gudang[0].qcId='absent',s=>s.production[0].hitungFisik[0].qcId='absent',s=>delete s.production[0].hitungFisik[0].tukangId,s=>s.production[0].qc.push({...s.production[0].qc[0],id:'quality-2'}),s=>s.workers.push({...s.workers[0]})]){
    const source=fixture();mutate(source);const result=prepareCandidate(source);assert.equal(result.report.status,'blocked');assert.equal(result.candidate,undefined);
  }
});
test('malformed and oversized structures are denied without running getters or exposing values',()=>{
  const source=fixture();Object.defineProperty(source.production[0],'password',{get(){throw Error('sensitive-getter');},enumerable:true});
  assert.deepEqual(prepareCandidate(source).report.issues,{invalid_source:1});
  const poisoned=JSON.parse('{"__proto__":{"polluted":true}}');assert.equal(prepareCandidate(poisoned).report.status,'blocked');assert.equal({}.polluted,undefined);
  const invalid=fixture();invalid.production[0].jahit[0].total=Infinity;assert.equal(prepareCandidate(invalid).report.status,'blocked');
});
test('missing or conflicting historical rates stop rather than republishing earnings at the current tariff',()=>{
  for(const mutate of [s=>delete s.production[0].hitungFisik[0].payroll,s=>s.production[0].hitungFisik[0].payroll.rateMissing=true,s=>s.production[0].qc[0].payroll.rate=0,s=>s.production[0].hitungFisik[0].payroll.workerId='unmapped']){
    const source=fixture();mutate(source);const result=prepareCandidate(source);
    assert.equal(result.report.status,'blocked');assert.equal(result.candidate,undefined);
  }
});
test('linked frozen rates and conflicting IDs reused across PO cycles require private review',()=>{
  const source=fixture();source.production[0].qc[0].payroll={...source.production[0].qc[0].payroll,rate:456};
  assert.ok(prepareCandidate(source).report.issues.conflicting_frozen_rate);
  const duplicated=fixture(),archive=structuredClone(duplicated.production[0]);for(const key of ['series','namaBarang','size','poAktif','poJumlah','arsip'])delete archive[key];
  archive.id='archive-1';archive.hitungFisik[0].jumlah=7;duplicated.production[0].arsip=[archive];
  assert.ok(prepareCandidate(duplicated).report.issues.cross_cycle_id_conflict);
});
test('approved counts retain source identity without provisional status and current combined-QC links survive projection',()=>{
  const source=fixture();source.production[0].qc[0].qcBatchId='batch-1';
  source.production[0].gudang[0].hfId='count-1';source.production[0].gudang[0].workflowVersion=2;
  const result=prepareCandidate(source);assert.equal(result.report.status,'candidate');
  const entries=Object.values(result.candidate.maklonEarnings['worker-1'].entries);assert.ok(entries.every(row=>row.provisional===false));
  assert.equal(result.candidate.soldier.operationsV2.products['product-1'].qc[0].qcBatchId,'batch-1');
  const pending=fixture();delete pending.production[0].hitungFisik[0].qcId;pending.production[0].qc=[];pending.production[0].gudang=[];
  const waiting=prepareCandidate(pending);assert.equal(waiting.report.status,'candidate');assert.ok(Object.values(waiting.candidate.maklonEarnings['worker-1'].entries).every(row=>row.provisional===true));
});
test('local CLI emits redacted counts only and never exports candidate data or parser error excerpts',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'soldier-finance-test-'));
  try{
    const file=path.join(dir,'scope.json'),cli=path.resolve(__dirname,'../security/inspect-finance.cjs');
    fs.writeFileSync(file,JSON.stringify(fixture()));const run=spawnSync(process.execPath,[cli,file],{encoding:'utf8'});
    assert.equal(run.status,0);assert.equal(run.stderr,'');assert.equal(JSON.parse(run.stdout).readyForProduction,false);
    for(const value of ['Synthetic worker','synthetic-pin','private memo','123','9999','scope.json'])assert.equal(run.stdout.includes(value),false);
    assert.deepEqual(fs.readdirSync(dir),['scope.json']);
    fs.writeFileSync(file,'{"secret":"synthetic parser secret');const bad=spawnSync(process.execPath,[cli,file],{encoding:'utf8'});
    assert.equal(bad.status,2);assert.equal(bad.stderr,'');assert.equal(bad.stdout.includes('synthetic parser secret'),false);
  }finally{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('soldier-finance-test-'));fs.rmSync(dir,{recursive:true,force:true});}
});
module.exports={fixture};
