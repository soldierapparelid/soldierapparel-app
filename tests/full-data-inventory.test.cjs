'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const Inventory=require('../security/full-data-inventory.cjs');
function fixture(){
  const captured={workerId:'worker-1',workerName:'Synthetic private person',rate:123,rateMissing:false,capturedAt:'2026-01-01T00:00:00.000Z'};
  return {soldier:{produksi:{produksi:[{id:'product-1',series:'Example',namaBarang:'Example',size:'M',poAktif:true,poJumlah:8,assignJahit:[{id:'assignment-1',tukangId:'worker-1',qty:8,sisa:0,tanggal:'2026-01-01'}],jahit:[{id:'sewing-1',tukangId:'worker-1',assignmentId:'assignment-1',jumlah:8,rijek:0,lolos:8,quantityBasis:'good-plus-reject',tarif:123,total:984,dibayar:true,tanggal:'2026-01-01'}],hitungFisik:[{id:'count-1',tukangId:'worker-1',jumlah:8,tanggal:'2026-01-01',qcId:'quality-1',workflowVersion:2,countStage:'verified',payroll:captured}],qc:[{id:'quality-1',tukangId:'worker-1',hfId:'count-1',tanggal:'2026-01-02',ok:8,reject:0,perbaikan:0,offline:0,workflowVersion:2,payroll:captured}],arsip:[]}],images:{},cuttingPlans:{}},produksi_meta:{tukang:[],tukangJahit:[{id:'worker-1',nama:'Synthetic private person',pin:'synthetic-pin-never-print',tarif:{'Example|Example':123},tarifHistory:{'Example|Example':[{effectiveAt:'1970-01-01T00:00:00.000Z',rate:123}]}}],kasbonJahit:[{id:'advance-1',tukangId:'worker-1',jumlah:77,sisa:0,cicilan:[{id:'repayment-1',jumlah:77,tanggal:'2026-01-02'}],status:'lunas'}]},produksi_deletions:{},produksi_deleted_ids:[],stokBahan:{pembelian:[],adjustment:[],rolInfo:{},settings:{}},pembelianProduk:{suppliers:[],produk:[],orders:[],pesananOffline:[]},gajiHarian:{karyawan:[],entries:[],kasbon:[]},hpp:{configs:{},marketplace:{},pajak:0.5}},integrationSecrets:{arbitraryToken:'synthetic-token-never-print',opaque:{anything:['private',123456789]}},credentials:'synthetic-password-never-print'};
}
const clone=value=>JSON.parse(JSON.stringify(value));
test('complete synthetic snapshot is reviewed, scoped candidate matches privately, settled records preserved and full rollout stays pending',()=>{
  const source=fixture(),before=clone(source),report=Inventory.inspect(source);
  assert.equal(report.status,'reviewed');assert.equal(report.financeCandidate,'candidate');assert.equal(report.readyForProduction,false);assert.equal(report.fullReconciliation,'pending');
  assert.equal(report.counts.production,1);assert.equal(report.counts.sewingWorkers,1);assert.equal(report.counts.settledRecords,1);
  for(const key of ['sourcePreserved','scopedSourcePreserved','scopedCalculatedEarningsParity','sewingFormulaParity','advanceArithmeticParity','settledEvidencePreserved'])assert.equal(report.checks[key],true);
  assert.deepEqual(source,before);
  const out=JSON.stringify(report);for(const forbidden of ['worker-1','product-1','Synthetic private person','synthetic-pin-never-print','synthetic-token-never-print','synthetic-password-never-print','984','123456789','sourceChecksum','candidate":{'])assert.equal(out.includes(forbidden),false);
});
test('unknown root/family fields and secret-bearing errors stay redacted; missing core source stays unavailable',()=>{
  const source=fixture();source['synthetic-secret-root-name']={password:'synthetic-secret-value'};source.soldier['private-unknown-node']=42;
  const report=Inventory.inspect(source);assert.equal(report.status,'blocked');assert.equal(report.issues.unknown_root,1);assert.equal(report.issues.unknown_legacy_family,1);
  for(const marker of ['synthetic-secret-root-name','synthetic-secret-value','private-unknown-node'])assert.equal(JSON.stringify(report).includes(marker),false);
  assert.equal(Inventory.inspect({}).source.database,'unavailable');assert.equal(Inventory.inspect({}).financeCandidate,'not_checked');
  const missing=fixture();delete missing.soldier.produksi_meta;assert.equal(Inventory.inspect(missing).issues.required_legacy_source_missing,1);
});
test('identity ambiguity, mismatched links, archives and deletion fallback stop without guessing or changing records',()=>{
  const mutations=[s=>s.soldier.produksi_meta.tukangJahit.push(clone(s.soldier.produksi_meta.tukangJahit[0])),s=>s.soldier.produksi.produksi[0].qc[0].hfId='missing-count',s=>s.soldier.produksi.produksi[0].arsip=[{id:'archive-1',qc:[{id:'orphan',tukangId:'worker-1',hfId:'missing',ok:0,tanggal:'2025-12-31'}]}],s=>s.soldier.produksi_deletions={'product-1|jahit|nominal:synthetic-private-money':1},s=>s.soldier.produksi_meta.kasbonJahit[0].tukangId='missing-worker'];
  for(const mutate of mutations){const source=fixture();mutate(source);const before=clone(source),report=Inventory.inspect(source);assert.equal(report.status,'blocked');assert.deepEqual(source,before);assert.equal(JSON.stringify(report).includes('synthetic-private-money'),false);}
});
test('frozen payroll, tariff history and kasbon arithmetic are checked without repricing, rounding or altering settled ledgers',()=>{
  for(const mutate of [s=>s.soldier.produksi.produksi[0].qc[0].payroll={...s.soldier.produksi.produksi[0].qc[0].payroll,rate:456},s=>s.soldier.produksi_meta.tukangJahit[0].tarifHistory['Example|Example'].push({effectiveAt:'1970-01-01T00:00:00.000Z',rate:999}),s=>s.soldier.produksi_meta.kasbonJahit[0].sisa=1,s=>s.soldier.produksi.produksi[0].jahit[0].total=983,s=>s.soldier.produksi.produksi[0].jahit[0].dibayar='true']){
    const source=fixture();mutate(source);const before=clone(source),report=Inventory.inspect(source);assert.equal(report.status,'blocked');assert.deepEqual(source,before);assert.equal(report.checks.settledEvidencePreserved,true);
  }
  const decimalSource=fixture();decimalSource.soldier.stokBahan.pembelian=[{id:'purchase-1',kg:0.1,hargaPerKg:3,total:0.3}];assert.equal(Inventory.inspect(decimalSource).checks.purchaseArithmeticParity,true);
  decimalSource.soldier.stokBahan.pembelian[0].total=0.30000000000000004;assert.equal(Inventory.inspect(decimalSource).checks.purchaseArithmeticParity,false);
});
test('daily payroll, cutting formula and purchased-product payments are checked privately across known families',()=>{
  const source=fixture();source.soldier.produksi_meta.tukang=[{id:'cutting-worker-1',nama:'Synthetic cutting partner'}];
  source.soldier.produksi.produksi[0].potong=[{id:'cut-result-1',jumlah:8,tukangId:'cutting-worker-1',tarif:17,total:136,tanggal:'2026-01-01'}];
  source.soldier.gajiHarian={karyawan:[{id:'daily-worker-1',nama:'Synthetic employee'}],entries:[{id:'daily-entry-1',karyawanId:'daily-worker-1',gajiHari:200,lemburJam:2,lemburTarif:20,lemburTotal:40,lemburSabtuJam:1,lemburSabtuTarif:10,lemburSabtuTotal:10,jumlah:250,dibayar:true}],kasbon:[]};
  source.soldier.pembelianProduk.orders=[{id:'order-1',hargaSatuan:50,totalHarga:100,items:[{id:'item-1',jumlah:2}],pembayaran:[{id:'payment-1',jumlah:10}],penerimaan:[{id:'receipt-1',itemId:'item-1',jumlah:1}]}];
  const before=clone(source),report=Inventory.inspect(source);assert.equal(report.status,'blocked');assert.equal(report.financeCandidate,'blocked');assert.equal(report.issues.scoped_finance_review_required,1);assert.equal(report.checks.dailyFormulaParity,true);assert.equal(report.checks.cuttingFormulaParity,true);assert.equal(report.checks.purchaseArithmeticParity,true);assert.equal(report.counts.settledRecords,2);assert.deepEqual(source,before);
  source.soldier.gajiHarian.entries[0].lemburTotal=41;assert.equal(Inventory.inspect(source).checks.dailyFormulaParity,false);
  source.soldier.pembelianProduk.orders[0].pembayaran[0].jumlah=101;assert.equal(Inventory.inspect(source).issues.purchase_balance_review_required,1);
  source.soldier.produksi.produksi[0].potong[0].tarif='17';assert.equal(Inventory.inspect(source).issues.work_money_formula_review_required,1);
});
test('invalid JSON/getters/prototypes are rejected without reading an accessor or printing private values',()=>{
  const source=fixture();let read=false;Object.defineProperty(source.soldier,'private',{enumerable:true,get(){read=true;throw Error('synthetic-getter-secret');}});
  const report=Inventory.inspect(source);assert.equal(report.issues.invalid_source_json,1);assert.equal(read,false);assert.equal(JSON.stringify(report).includes('synthetic-getter-secret'),false);
  assert.equal(Inventory.inspect(JSON.parse('{"__proto__":{"private":"secret"}}')).issues.invalid_source_json,1);assert.equal({}.private,undefined);
  const nonfinite=fixture();nonfinite.soldier.produksi.produksi[0].poJumlah=Infinity;assert.equal(Inventory.inspect(nonfinite).issues.invalid_source_json,1);
  const tooDeep=fixture();let cursor=tooDeep.integrationSecrets;for(let i=0;i<34;i++){cursor.nested={};cursor=cursor.nested;}assert.equal(Inventory.inspect(tooDeep).issues.invalid_source_json,1);
});
test('optional draft inspection counts pending journals and preserves every payload without adoption or export',()=>{
  const source=fixture(),draft={journal:{version:1,key:'synthetic-journal',owner:'synthetic-account',state:{pending:true,baseKnown:true,revision:1,target:'synthetic-target',base:{secret:'synthetic-draft-secret'},draft:{secret:'synthetic-new-draft-secret'}}}},before=clone(draft);
  const report=Inventory.inspect(source,draft);assert.equal(report.source.draft,'available');assert.equal(report.counts.draftJournals,1);assert.equal(report.counts.draftPending,1);assert.equal(report.checks.draftPreserved,true);assert.equal(report.fullReconciliation,'pending');assert.deepEqual(draft,before);
  for(const marker of ['synthetic-journal','synthetic-account','synthetic-target','synthetic-draft-secret','synthetic-new-draft-secret'])assert.equal(JSON.stringify(report).includes(marker),false);
});
test('CLI only reads local bounded regular files and emits no source, filename, hash or parser excerpts',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'soldier-full-inventory-test-'));
  try{
    const backup=path.join(dir,'private-source.json'),draft=path.join(dir,'private-draft.json'),cli=require.resolve('../security/full-data-inventory.cjs');
    fs.writeFileSync(backup,JSON.stringify(fixture()));fs.writeFileSync(draft,JSON.stringify({journal:{key:'synthetic',state:{pending:false,baseKnown:true,revision:1,target:'synthetic'}}}));
    const before=[fs.readFileSync(backup),fs.readFileSync(draft)];
    const run=spawnSync(process.execPath,[cli,backup,draft],{encoding:'utf8'});assert.equal(run.status,0);assert.equal(run.stderr,'');assert.equal(JSON.parse(run.stdout).fullReconciliation,'pending');
    assert.deepEqual(fs.readdirSync(dir).sort(),['private-draft.json','private-source.json']);assert.deepEqual([fs.readFileSync(backup),fs.readFileSync(draft)],before);
    fs.writeFileSync(backup,'{"password":"synthetic-parser-secret');const malformed=spawnSync(process.execPath,[cli,backup],{encoding:'utf8'});assert.equal(malformed.status,2);assert.equal(malformed.stderr,'');assert.equal(malformed.stdout.includes('synthetic-parser-secret'),false);assert.equal(malformed.stdout.includes('private-source'),false);
    for(const source of ['{"soldier":{},"soldier":{"private":"synthetic-duplicate-secret"}}','{"soldier":{"amount":1,"\\u0061mount":2}}']){
      fs.writeFileSync(backup,source);const duplicate=spawnSync(process.execPath,[cli,backup],{encoding:'utf8'});assert.equal(duplicate.status,2);assert.equal(duplicate.stderr,'');assert.equal(JSON.parse(duplicate.stdout).source.database,'unavailable');assert.equal(duplicate.stdout.includes('synthetic-duplicate-secret'),false);assert.equal(duplicate.stdout.includes('amount'),false);
    }
    fs.writeFileSync(backup,Buffer.from([0x7b,0x22,0x78,0x22,0x3a,0x22,0xff,0x22,0x7d]));const invalidEncoding=spawnSync(process.execPath,[cli,backup],{encoding:'utf8'});assert.equal(invalidEncoding.status,2);assert.equal(JSON.parse(invalidEncoding.stdout).source.database,'unavailable');
    const noSource=spawnSync(process.execPath,[cli,'https://example.invalid/private-token'],{encoding:'utf8'});assert.equal(noSource.status,2);assert.equal(JSON.parse(noSource.stdout).source.database,'unavailable');assert.equal(noSource.stdout.includes('private-token'),false);
    const noDraft=spawnSync(process.execPath,[cli,draft,path.join(dir,'missing-private-draft.json')],{encoding:'utf8'});assert.equal(noDraft.status,2);assert.equal(JSON.parse(noDraft.stdout).source.draft,'unavailable');assert.equal(noDraft.stdout.includes('missing-private-draft'),false);
    fs.writeFileSync(backup,' '.repeat(Inventory.limits.maxBytes+1));const oversized=spawnSync(process.execPath,[cli,backup],{encoding:'utf8'});assert.equal(oversized.status,2);assert.equal(JSON.parse(oversized.stdout).source.database,'unavailable');
    const code=fs.readFileSync(cli,'utf8');for(const marker of ['fetch(','firebase','http.get','writeFile','mkdir','unlink','rename','appendFile'])assert.equal(code.includes(marker),false);
    assert.deepEqual(Inventory.limits,{maxBytes:16777216,maxNodes:250000,maxDepth:32});
  }finally{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('soldier-full-inventory-test-'));fs.rmSync(dir,{recursive:true,force:true});}
});
