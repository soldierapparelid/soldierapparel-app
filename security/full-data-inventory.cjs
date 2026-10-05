'use strict';
// Local read-only inventory. Never import this module into a worker browser.
const fs=require('node:fs'),{createHash}=require('node:crypto');
const Finance=require('./finance-rehearsal.cjs'),Payroll=require('../production-payroll.js');
const MAX_BYTES=16*1024*1024,MAX_NODES=250000,MAX_DEPTH=32;
const own=(value,key)=>Object.hasOwn(value,key),object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const safeId=Finance.safeId,finite=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER;
const money=value=>finite(value)&&value>=0,count=value=>Number.isSafeInteger(value)&&value>=0;
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().replace(/\.000Z$/,'Z')===value.replace(/\.000Z$/,'Z');
const rootKeys=new Set(['soldier','accessControl','integrationSecrets','credentials','secrets','privateFinance','maklonEarnings']);
const soldierKeys=new Set(['produksi','produksi_meta','produksi_deletions','produksi_deleted_ids','stokBahan','pembelianProduk','gajiHarian','hpp','productionPhotos','operationsV2','workerDirectory']);
const metaKeys=new Set(['tukang','tarif','tarifJahit','tarifJenis','jenisBahan','tukangJahit','kasbonJahit']);
function assertJson(value,depth=0,state={nodes:0},ancestors=new Set()){
  if(++state.nodes>MAX_NODES||depth>MAX_DEPTH)throw Error('invalid_json');
  if(value===null||typeof value==='string'||typeof value==='boolean')return;
  if(finite(value))return;
  if(!value||typeof value!=='object'||ancestors.has(value))throw Error('invalid_json');
  if(Array.isArray(value)?Object.getPrototypeOf(value)!==Array.prototype:![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('invalid_json');
  ancestors.add(value);const keys=Reflect.ownKeys(value);
  for(const key of keys){
    if(typeof key!=='string'||['__proto__','constructor','prototype'].includes(key))throw Error('invalid_json');
    if(Array.isArray(value)&&key==='length')continue;
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor||!own(descriptor,'value')||!descriptor.enumerable)throw Error('invalid_json');
    if(Array.isArray(value)&&(!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=value.length))throw Error('invalid_json');
    assertJson(descriptor.value,depth+1,state,ancestors);
  }
  if(Array.isArray(value)&&keys.length!==value.length+1)throw Error('invalid_json');
  ancestors.delete(value);
}
// Exact decimal arithmetic uses the stored numeric representation. No coercion,
// tolerance, rounding or automatic correction is applied to a ledger.
function decimal(value){
  if(!finite(value))throw Error('invalid_number');
  const [mantissa,exponent='0']=value.toString().split('e'),parts=mantissa.split('.');
  let n=BigInt(parts.join('')),scale=(parts[1]||'').length-Number(exponent);
  if(scale<0){n*=10n**BigInt(-scale);scale=0;}return {n,scale};
}
function add(a,b){const scale=Math.max(a.scale,b.scale);return {n:a.n*10n**BigInt(scale-a.scale)+b.n*10n**BigInt(scale-b.scale),scale};}
const sum=values=>values.reduce((total,value)=>add(total,decimal(value)),{n:0n,scale:0});
const multiply=(a,b)=>{a=decimal(a);b=decimal(b);return {n:a.n*b.n,scale:a.scale+b.scale};};
const equal=(a,b)=>a.n*10n**BigInt(b.scale)===b.n*10n**BigInt(a.scale);
const greater=(a,b)=>a.n*10n**BigInt(b.scale)>b.n*10n**BigInt(a.scale);
const digest=value=>createHash('sha256').update(Finance.canonical(value)).digest('hex');
function emptyReport(){return {status:'source_unavailable',readyForProduction:false,source:{database:'unavailable',draft:'not_supplied'},financeCandidate:'not_checked',fullReconciliation:'pending',
  counts:{production:0,archives:0,operationRecords:0,sewingWorkers:0,cuttingWorkers:0,advances:0,settledRecords:0,deletionMarkers:0,deletedProducts:0,materialPurchases:0,materialAdjustments:0,cuttingPlans:0,purchaseOrders:0,offlineOrders:0,dailyWorkers:0,dailyEntries:0,costingConfigurations:0,opaquePrivateFamilies:0,draftJournals:0,draftPending:0},
  checks:{sourcePreserved:null,draftPreserved:null,scopedSourcePreserved:null,scopedCalculatedEarningsParity:null,sewingFormulaParity:null,cuttingFormulaParity:null,advanceArithmeticParity:null,dailyFormulaParity:null,purchaseArithmeticParity:null,settledEvidencePreserved:null},issues:{}};}
function inspect(root,draft){
  const report=emptyReport(),issue=code=>{report.issues[code]=(report.issues[code]||0)+1;};
  try{assertJson(root);}catch{report.status='blocked';report.source.database='invalid';issue('invalid_source_json');return report;}
  if(!object(root)||!object(root.soldier)){issue('required_legacy_source_missing');return report;}
  report.source.database='available';let original;
  try{original=digest(root);}catch{report.status='blocked';issue('invalid_source_json');return report;}
  const soldier=root.soldier;
  if(Object.keys(root).some(key=>!rootKeys.has(key)))issue('unknown_root');
  if(Object.keys(soldier).some(key=>!soldierKeys.has(key)))issue('unknown_legacy_family');
  // Credentials, secret material, newer finance and account grants are opaque:
  // preserve them intact, without interpreting any internal fields or values.
  report.counts.opaquePrivateFamilies=['accessControl','integrationSecrets','credentials','secrets','privateFinance','maklonEarnings'].filter(key=>own(root,key)).length;
  function rows(value,requireIdentity=true){
    if(value==null)return [];
    if(!Array.isArray(value)&&!object(value)){issue('invalid_collection_type');return [];}
    const result=[],seen=new Set();
    for(const [key,row]of Object.entries(value)){
      if(row===null)continue;
      if(!object(row)){issue('invalid_record_type');continue;}
      if(requireIdentity){
        if(!own(row,'id')||!safeId(row.id)){issue('missing_or_invalid_record_id');continue;}
        if(seen.has(row.id)){issue('ambiguous_record_id');continue;}seen.add(row.id);
        // Firebase may return array histories as numeric-index maps. Identity
        // still comes from each explicit record, never from the index key.
        if(!Array.isArray(value)&&! /^(0|[1-9][0-9]*)$/.test(key)&&key!==row.id)issue('map_identity_mismatch');
      }
      result.push(row);
    }
    return result;
  }
  function shape(value,allowed){if(!object(value)){issue('invalid_family_type');return false;}if(Object.keys(value).some(key=>!allowed.includes(key)))issue('unknown_family_field');return true;}
  function checkedParity(name,condition){report.checks[name]=report.checks[name]===false?false:!!condition;if(!condition)issue('money_arithmetic_review_required');}
  function paid(row){
    if(own(row,'dibayar')){
      if(typeof row.dibayar!=='boolean')issue('settlement_flag_review_required');
      else if(row.dibayar){report.counts.settledRecords++;if(own(row,'dibayarAt')&&!timestamp(row.dibayarAt))issue('settlement_date_review_required');}
    }
  }
  function advances(value,workerIds,workerField){
    const list=rows(value);report.counts.advances+=list.length;
    for(const row of list){
      if(!safeId(row[workerField])||!workerIds.has(row[workerField]))issue('unmapped_financial_worker');
      const payments=rows(row.cicilan);
      if(!money(row.jumlah)||!money(row.sisa)||payments.some(payment=>!money(payment.jumlah))){issue('invalid_advance_amount');continue;}
      if(payments.some(payment=>own(payment,'tanggal')&&!date(payment.tanggal)))issue('invalid_ledger_date');
      const remaining=sum([row.sisa,...payments.map(payment=>payment.jumlah)]);
      checkedParity('advanceArithmeticParity',equal(decimal(row.jumlah),remaining));
      if(own(row,'status')&&!['aktif','lunas'].includes(row.status))issue('advance_status_review_required');
      if(row.status==='lunas'&&row.sisa!==0)issue('advance_status_review_required');
      if(row.status==='aktif'&&row.sisa===0)issue('advance_status_review_required');
    }
  }
  let container=null,production=[],workers=[],cutters=[],metadata=null;
  if(!own(soldier,'produksi')||!own(soldier,'produksi_meta'))issue('required_legacy_source_missing');
  if(own(soldier,'produksi')){
    if(Array.isArray(soldier.produksi)){production=rows(soldier.produksi);issue('legacy_production_wrapper_review_required');}
    else if(shape(soldier.produksi,['produksi','images','cuttingPlans'])){container=soldier.produksi;production=rows(container.produksi);}
  }
  if(own(soldier,'produksi_meta')&&shape(soldier.produksi_meta,[...metaKeys])){
    metadata=soldier.produksi_meta;workers=rows(metadata.tukangJahit);cutters=rows(metadata.tukang);
  }
  report.counts.production=production.length;report.counts.sewingWorkers=workers.length;report.counts.cuttingWorkers=cutters.length;
  const workerIds=new Set(workers.map(row=>row.id)),cutterIds=new Set(cutters.map(row=>row.id)),productIds=new Set(production.map(row=>row.id));
  for(const worker of workers){
    if(own(worker,'tarif')&&!object(worker.tarif))issue('invalid_tariff_map');
    else for(const rate of Object.values(worker.tarif||{}))if(!money(rate)||rate===0)issue('invalid_tariff_value');
    if(own(worker,'tarifHistory')&&!object(worker.tarifHistory))issue('invalid_tariff_history');
    else for(const history of Object.values(worker.tarifHistory||{})){
      const entries=rows(history,false),seen=new Set();
      for(const entry of entries){
        if(!timestamp(entry.effectiveAt)||!money(entry.rate)||entry.rate===0||Object.keys(entry).some(key=>!['effectiveAt','rate'].includes(key)))issue('invalid_tariff_history');
        if(seen.has(entry.effectiveAt))issue('ambiguous_tariff_history');seen.add(entry.effectiveAt);
      }
    }
  }
  if(metadata)advances(metadata.kasbonJahit,workerIds,'tukangId');
  for(const product of production){
    const archives=typeof product.arsip==='boolean'?[]:rows(product.arsip);report.counts.archives+=archives.length;
    for(const cycle of [...archives,product]){
      for(const family of ['potong','assignJahit','jahit','hitungFisik','qc','gudang','bigSaller','bigSeller']){
        if(['bigSaller','bigSeller'].includes(family)&&typeof cycle[family]==='boolean')continue;
        const records=rows(cycle[family]);report.counts.operationRecords+=records.length;
        for(const row of records){
          paid(row);
          for(const key of ['jumlah','qty','sisa','rijek','lolos','ok','reject','perbaikan','kotor','offline'])if(own(row,key)&&!count(row[key]))issue('invalid_operation_count');
          if(own(row,'tanggal')&&!date(row.tanggal))issue('invalid_work_date');
          if(family==='potong'&&(!safeId(row.tukangId)||!cutterIds.has(row.tukangId)))issue('unmapped_cutting_worker');
          if(own(row,'payroll')){
            const captured=row.payroll;
            if(!object(captured)||!safeId(captured.workerId)||!workerIds.has(captured.workerId)||typeof captured.rateMissing!=='boolean'||!money(captured.rate)||(!captured.rateMissing&&captured.rate===0))issue('invalid_frozen_payroll');
            else if(own(captured,'capturedAt')&&!timestamp(captured.capturedAt))issue('invalid_frozen_payroll_date');
          }
          if(['potong','jahit'].includes(family)&&(own(row,'tarif')||own(row,'total'))){
            let quantity=family==='potong'?row.jumlah:row.lolos;
            if(family==='jahit'&&quantity===undefined&&row.quantityBasis==='good-plus-reject'&&count(row.jumlah)&&count(row.rijek))quantity=row.jumlah-row.rijek;
            if(!count(quantity)||!money(row.tarif)||!money(row.total))issue('work_money_formula_review_required');
            else checkedParity(family==='potong'?'cuttingFormulaParity':'sewingFormulaParity',equal(multiply(quantity,row.tarif),decimal(row.total)));
          }
        }
      }
      const settlement=rows(cycle.bayarJahit,false);
      for(const row of settlement){report.counts.settledRecords++;if(!safeId(row.id))issue('settlement_identity_review_required');if(!date(row.tanggal))issue('settlement_date_review_required');}
    }
  }
  if(container){
    const plans=rows(container.cuttingPlans);report.counts.cuttingPlans=plans.length;
    for(const plan of plans){
      const refs=rows(plan.products);if(!refs.length)issue('cutting_plan_reference_review_required');
      for(const ref of refs)if(!productIds.has(ref.id)||typeof ref.cycle!=='string'||!ref.cycle)issue('cutting_plan_reference_review_required');
      if(own(plan,'rolls')&&!Array.isArray(plan.rolls)&&!object(plan.rolls))issue('cutting_plan_material_review_required');
      for(const roll of rows(plan.rolls,false))if(!safeId(roll.purchaseId)||!money(roll.kg)||!['kg','yard','meter'].includes(roll.unit||'kg'))issue('cutting_plan_material_review_required');
    }
  }
  if(own(soldier,'produksi_deletions')){
    let deletion=soldier.produksi_deletions;
    if(typeof deletion==='string'){try{deletion=parsePrivateJson(deletion);assertJson(deletion);}catch{issue('invalid_deletion_log');deletion=null;}}
    if(deletion!==null&&!object(deletion))issue('invalid_deletion_log');
    else for(const [key,value]of Object.entries(deletion||{})){
      report.counts.deletionMarkers++;
      if(!Number.isSafeInteger(value)||value<0)issue('invalid_deletion_marker');
      const parts=key.split('|');if(parts.length!==3||!safeId(parts[0])||!['potong','assignJahit','jahit','hitungFisik','qc','gudang','bigSaller','bigSeller','bayarJahit'].includes(parts[1])||!parts[2].startsWith('id:')||!safeId(parts[2].slice(3)))issue('legacy_deletion_identity_review_required');
    }
  }
  if(own(soldier,'produksi_deleted_ids')){
    let ids=soldier.produksi_deleted_ids;
    if(typeof ids==='string'){try{ids=parsePrivateJson(ids);assertJson(ids);}catch{ids=null;issue('invalid_deleted_product_list');}}
    if(ids!==null&&!Array.isArray(ids)&&!object(ids))issue('invalid_deleted_product_list');
    else{const seen=new Set();for(const id of Object.values(ids||{})){if(id===null)continue;report.counts.deletedProducts++;if(!safeId(id)||seen.has(id))issue('invalid_deleted_product_identity');seen.add(id);}}
  }
  if(own(soldier,'stokBahan')&&shape(soldier.stokBahan,['pembelian','adjustment','rolInfo','settings'])){
    const purchases=rows(soldier.stokBahan.pembelian),adjustments=rows(soldier.stokBahan.adjustment);report.counts.materialPurchases=purchases.length;report.counts.materialAdjustments=adjustments.length;
    for(const row of purchases)if(!money(row.kg)||!money(row.hargaPerKg)||!money(row.total))issue('material_amount_review_required');else checkedParity('purchaseArithmeticParity',equal(multiply(row.kg,row.hargaPerKg),decimal(row.total)));
    for(const row of adjustments)if(!finite(row.kg))issue('material_amount_review_required');
  }
  if(own(soldier,'pembelianProduk')&&shape(soldier.pembelianProduk,['suppliers','produk','orders','pesananOffline'])){
    const data=soldier.pembelianProduk;rows(data.suppliers);rows(data.produk);
    const orders=rows(data.orders),offline=rows(data.pesananOffline);report.counts.purchaseOrders=orders.length;report.counts.offlineOrders=offline.length;
    for(const [list,isOffline]of [[orders,false],[offline,true]])for(const order of list){
      const items=rows(order.items),payments=rows(order.pembayaran),receipts=rows(order.penerimaan),itemIds=new Set(items.map(item=>item.id));
      for(const payment of payments)if(!money(payment.jumlah))issue('invalid_purchase_payment');
      for(const receipt of receipts)if(!itemIds.has(receipt.itemId)||!count(receipt.jumlah))issue('invalid_purchase_receipt');
      const total=isOffline?order.hargaTotal:order.totalHarga;
      if(!money(total)||payments.some(payment=>!money(payment.jumlah)))issue('purchase_total_review_required');
      else if(greater(sum(payments.map(payment=>payment.jumlah)),decimal(total)))issue('purchase_balance_review_required');
      if(items.length&&items.every(item=>count(isOffline?item.qty:item.jumlah)&&money(isOffline?item.harga:order.hargaSatuan))&&money(total)){
        const calculated=items.reduce((acc,item)=>add(acc,multiply(isOffline?item.qty:item.jumlah,isOffline?item.harga:order.hargaSatuan)),{n:0n,scale:0});
        checkedParity('purchaseArithmeticParity',equal(calculated,decimal(total)));
      }else issue('purchase_item_formula_review_required');
    }
  }
  if(own(soldier,'gajiHarian')&&shape(soldier.gajiHarian,['karyawan','entries','kasbon'])){
    const employees=rows(soldier.gajiHarian.karyawan),entries=rows(soldier.gajiHarian.entries),ids=new Set(employees.map(row=>row.id));report.counts.dailyWorkers=employees.length;report.counts.dailyEntries=entries.length;
    for(const row of entries){
      if(!ids.has(row.karyawanId))issue('unmapped_daily_worker');paid(row);
      if(![row.gajiHari,row.lemburTotal,row.lemburSabtuTotal,row.jumlah].every(money))issue('invalid_daily_payroll_amount');
      else checkedParity('dailyFormulaParity',equal(sum([row.gajiHari,row.lemburTotal,row.lemburSabtuTotal]),decimal(row.jumlah)));
      for(const fields of [['lemburJam','lemburTarif','lemburTotal'],['lemburSabtuJam','lemburSabtuTarif','lemburSabtuTotal']]){
        if(fields.some(key=>own(row,key))){
          if(!fields.every(key=>money(row[key])))issue('daily_overtime_formula_review_required');
          else checkedParity('dailyFormulaParity',equal(multiply(row[fields[0]],row[fields[1]]),decimal(row[fields[2]])));
        }
      }
    }
    advances(soldier.gajiHarian.kasbon,ids,'karyawanId');
  }
  if(own(soldier,'hpp')&&shape(soldier.hpp,['configs','marketplace','pajak'])){
    if(!object(soldier.hpp.configs))issue('invalid_costing_map');else report.counts.costingConfigurations=Object.keys(soldier.hpp.configs).length;
  }
  if(metadata&&container){
    const scoped={production:container.produksi??null,workers:metadata.tukangJahit??null,advances:metadata.kasbonJahit??null},rehearsal=Finance.prepareCandidate(scoped);
    report.financeCandidate=rehearsal.report.status;
    if(rehearsal.report.status!=='candidate')issue('scoped_finance_review_required');
    else{
      report.checks.scopedSourcePreserved=equalDigest(scoped,rehearsal.candidate.privateFinance.legacySource);
      const inputRows=production.flatMap(product=>Payroll.collectProduct(product,workers)),candidateRows=Object.values(rehearsal.candidate.maklonEarnings).flatMap(worker=>Object.values(worker.entries||{}));
      const validAmounts=inputRows.every(row=>money(row.total))&&candidateRows.every(row=>money(row.total));
      report.checks.scopedCalculatedEarningsParity=validAmounts&&equal(sum(inputRows.map(row=>row.total)),sum(candidateRows.map(row=>row.total)));
      if(!report.checks.scopedSourcePreserved||!report.checks.scopedCalculatedEarningsParity)issue('scoped_finance_preservation_failed');
    }
  }
  if(draft!==undefined){
    report.source.draft='available';
    try{
      assertJson(draft);const before=digest(draft),allowed=new Set(['version','key','owner','exportedAt','state','persisted','recovery','storageState','journal','projectionFailure','production','meta','storage','local','pendingDeletions','produksi','tarifTukang','tanggal','hppData']);
      if(!object(draft)||Object.keys(draft).some(key=>!allowed.has(key)))issue('unknown_draft_format');
      let found=false;
      const walk=(value,depth=0)=>{
        if(depth>MAX_DEPTH){issue('invalid_draft_journal');return;}
        if(!object(value))return;
        if(own(value,'state')){
          found=true;report.counts.draftJournals++;const state=value.state;
          if(!object(state)||typeof state.pending!=='boolean'||typeof state.baseKnown!=='boolean'||!count(state.revision)||typeof state.target!=='string'||typeof value.key!=='string'||!value.key)issue('invalid_draft_journal');
          else if(state.pending)report.counts.draftPending++;
        }
        for(const key of ['journal','production','meta','produksi','tarifTukang'])if(own(value,key))walk(value[key],depth+1);
      };
      walk(draft);if(!found)issue('draft_manual_reconciliation_required');
      report.checks.draftPreserved=before===digest(draft);if(!report.checks.draftPreserved)issue('draft_preservation_failed');
    }catch{report.source.draft='invalid';issue('invalid_draft_source');}
  }
  report.checks.sourcePreserved=original===digest(root);
  report.checks.settledEvidencePreserved=report.checks.sourcePreserved;
  if(!report.checks.sourcePreserved)issue('source_preservation_failed');
  report.status=Object.keys(report.issues).length?'blocked':'reviewed';
  return report;
}
function equalDigest(a,b){return digest(a)===digest(b);}
// Native JSON.parse accepts duplicate object keys by silently choosing the last
// one. Check the bounded grammar first so private ledger identities/amounts are
// never adopted from ambiguous source text. Errors contain no source excerpts.
function parsePrivateJson(text){
  let cursor=0,nodes=0;const primitive=/-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null/y;
  const space=()=>{while(cursor<text.length&&/[\t\r\n ]/.test(text[cursor]))cursor++;};
  const invalid=()=>{throw Error('invalid_json');};
  function stringToken(key=false){
    if(text[cursor]!=='"')invalid();const start=cursor++;
    while(cursor<text.length){
      const character=text[cursor++];
      if(character==='"')return key?JSON.parse(text.slice(start,cursor)):undefined;
      if(character==='\\')cursor++;
    }
    invalid();
  }
  function value(depth){
    if(++nodes>MAX_NODES||depth>MAX_DEPTH)invalid();space();
    if(text[cursor]==='{'){
      cursor++;space();const keys=new Set();if(text[cursor]==='}'){cursor++;return;}
      while(cursor<text.length){
        space();const key=stringToken(true);if(keys.has(key))invalid();keys.add(key);space();
        if(text[cursor++]!==':')invalid();value(depth+1);space();
        if(text[cursor]==='}'){cursor++;return;}if(text[cursor++]!==',')invalid();
      }
      invalid();
    }
    if(text[cursor]==='['){
      cursor++;space();if(text[cursor]===']'){cursor++;return;}
      while(cursor<text.length){value(depth+1);space();if(text[cursor]===']'){cursor++;return;}if(text[cursor++]!==',')invalid();}
      invalid();
    }
    if(text[cursor]==='"'){stringToken();return;}
    primitive.lastIndex=cursor;const match=primitive.exec(text);if(!match)invalid();cursor=primitive.lastIndex;
  }
  value(0);space();if(cursor!==text.length)invalid();return JSON.parse(text);
}
function readLocal(file){
  if(typeof file!=='string'||!file||/^[a-z]{2,}:|^\\\\|^\/\//i.test(file))throw Error('source_unavailable');
  const descriptor=fs.openSync(file,'r');
  try{
    const before=fs.fstatSync(descriptor);if(!before.isFile()||before.size>MAX_BYTES)throw Error('source_unavailable');
    // Even if the file grows after the stat, never read beyond the byte limit.
    const buffer=Buffer.alloc(before.size+1);let length=0;
    while(length<buffer.length){const read=fs.readSync(descriptor,buffer,length,buffer.length-length,null);if(!read)break;length+=read;}
    const after=fs.fstatSync(descriptor);
    if(length>MAX_BYTES||length!==before.size||before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('source_unavailable');
    const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer.subarray(0,length));
    return parsePrivateJson(text);
  }finally{fs.closeSync(descriptor);}
}
function main(args,write=text=>process.stdout.write(text)){
  let report=emptyReport();
  try{
    if(!Array.isArray(args)||args.length<1||args.length>2)throw Error('source_unavailable');
    let root;try{root=readLocal(args[0]);}catch{report.issues.source_unavailable=1;write(JSON.stringify(report)+'\n');return 2;}
    let draft;
    if(args.length===2){try{draft=readLocal(args[1]);}catch{report=inspect(root);report.status='blocked';report.source.draft='unavailable';report.issues.draft_source_unavailable=1;write(JSON.stringify(report)+'\n');return 2;}}
    report=inspect(root,draft);write(JSON.stringify(report)+'\n');return report.status==='reviewed'?0:2;
  }catch{report=emptyReport();report.issues.source_unavailable=1;write(JSON.stringify(report)+'\n');return 2;}
}
if(require.main===module)process.exitCode=main(process.argv.slice(2));
module.exports={inspect,main,limits:Object.freeze({maxBytes:MAX_BYTES,maxNodes:MAX_NODES,maxDepth:MAX_DEPTH})};
