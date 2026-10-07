'use strict';
// Pure live read, source-OFF. Identity is a trusted verified input to compatible
// capture, NOT an ID token accepted by this module. No SDK/network/write/pay.
const Core=require('./production-legacy-operations.cjs');
const MAX_VIEW_BYTES=1024*1024,MAX_RECORDS=4096,MAX_ROWS=40000,MAX_MARKER_BYTES=1024*1024;
const CODES=new Set(['service_disabled','unavailable','invalid_request','access_denied','not_ready','conflict','capacity_limit']);
const FAMILIES=new Set(['jahit','hitungFisik','qc','gudang']);
const RESERVED=new Set(['__proto__','constructor','prototype']);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const safe=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!RESERVED.has(v);
const present=(v,k)=>Object.hasOwn(v,k)&&v[k]!==undefined&&v[k]!==null&&v[k]!=='';
class LegacyFinanceError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new LegacyFinanceError(code);};
function exact(v,keys,code='not_ready'){if(!plain(v)||Reflect.ownKeys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail(code);for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail(code);}}
function rows(v){if(v===undefined||v===null)return [];if(!Array.isArray(v)&&!plain(v))fail('not_ready');const values=Object.values(v);if(values.length>MAX_ROWS)fail('capacity_limit');return values.filter(x=>x!==null).map(x=>{if(!plain(x))fail('not_ready');return x;});}
function text(v,max=256){if(typeof v!=='string'||v.length>max||/[\u0000-\u001f\u007f-\u009f]/.test(v))fail('not_ready');return v;}
function id(v){if(!safe(v))fail('not_ready');return v;}
function amount(v){if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>Number.MAX_SAFE_INTEGER||Object.is(v,-0))fail('not_ready');return v;}
function pcs(v,positive=false){if(!Number.isSafeInteger(v)||v<(positive?1:0))fail('not_ready');return v;}
function date(v){text(v,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||v.startsWith('0000')||Number.isNaN(Date.parse(v+'T00:00:00.000Z'))||new Date(v+'T00:00:00.000Z').toISOString().slice(0,10)!==v)fail('not_ready');return v;}
function instant(v){text(v,24);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v).toISOString()!==v)fail('not_ready');return v;}
function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':plain(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
const marked=v=>v===true||v===1||v==='true';
const ignored=v=>marked(v.deleted)||marked(v.isDeleted)||!!v.deletedAt||marked(v.cancelled)||marked(v.canceled)||!!v.cancelledAt||!!v.canceledAt||marked(v.payrollCancelled)||/^(deleted|cancelled|canceled|dihapus|dibatalkan|batal)$/i.test(typeof v.status==='string'?v.status:'');
// Only exact known IDs can supply ownership. Unknown label aliases are ignored;
// conflicting/unknown strong IDs prevent an otherwise own candidate admission.
function ownership(row,known,own){
  const strong=[row.payroll?.workerId,row.tukangId,row.workerId].filter(v=>v!==undefined&&v!==null&&v!==''),weak=[row.tukang,row.tukangJahit].filter(v=>v!==undefined&&v!==null&&v!=='');
  const values=[...strong,...weak].filter(v=>typeof v==='string'&&known.has(v)),ids=new Set(values);
  if(ids.has(own)&&(ids.size!==1||strong.some(v=>typeof v!=='string'||!known.has(v))))fail('not_ready');
  return ids.size===1&&ids.has(own)&&strong.every(v=>typeof v==='string'&&known.has(v));
}
function parseMarker(v){
  if(typeof v!=='string')return v;if(Buffer.byteLength(v,'utf8')>MAX_MARKER_BYTES)fail('capacity_limit');
  // Marker strings contain only a flat primitive array/map. Reject duplicate
  // decoded object keys before JSON.parse could select a target silently.
  const tokens=v.match(/"(?:[^"\\]|\\.)*"|[^\s]/g)||[];if(tokens.length>MAX_ROWS*8)fail('capacity_limit');
  if(tokens[0]==='{'){const keys=new Set();for(let i=1;i<tokens.length;i++)if(tokens[i]===':'){const keyToken=tokens[i-1];if(!keyToken?.startsWith('"'))fail('not_ready');let key;try{key=JSON.parse(keyToken);}catch{fail('not_ready');}if(keys.has(key))fail('not_ready');keys.add(key);}}
  try{return JSON.parse(v);}catch{fail('not_ready');}
}
function markers(soldier){
  const products=new Set(),pairs=new Set(),opaque=new Set(),deleted=parseMarker(soldier.produksi_deleted_ids??null);
  if(deleted!==null){if(!Array.isArray(deleted)&&!plain(deleted))fail('not_ready');if(Object.keys(deleted).length>MAX_ROWS||Buffer.byteLength(stable(deleted),'utf8')>MAX_MARKER_BYTES)fail('capacity_limit');for(const value of Object.values(deleted))if(value!==null)products.add(id(value));}
  const log=parseMarker(soldier.produksi_deletions??null);if(log!==null){if(!plain(log)||Object.keys(log).length>MAX_ROWS)fail('not_ready');if(Buffer.byteLength(stable(log),'utf8')>MAX_MARKER_BYTES)fail('capacity_limit');for(const [key,stamp]of Object.entries(log)){pcs(stamp);const match=/^([A-Za-z0-9_-]{1,128})\|(jahit|hitungFisik|qc|gudang)\|id:([A-Za-z0-9_-]{1,128})$/.exec(key);if(match){id(match[1]);id(match[3]);pairs.add(match[1]+'|'+match[2]+'|'+match[3]);}else {const prefix=/^([A-Za-z0-9_-]{1,128})\|(jahit|hitungFisik|qc|gudang)\|/.exec(key);if(prefix)opaque.add(prefix[1]+'|'+prefix[2]);}}}
  return {products,pairs,opaque};
}
const deleted=(m,p,f,r)=>present(r,'id')&&m.pairs.has(p+'|'+f+'|'+id(r.id));
function metadata(p){return {series:text(p.series??''),namaBarang:text(p.namaBarang??''),size:text(p.size??'')};}
function stored(row,fields){const out={};for(const k of fields)if(Object.hasOwn(row,k)){const value=row[k];if(value!==null){if(['jumlah','lolos','rijek','tarif','total','sisa'].includes(k))amount(value);else if(k==='dibayar'){if(![true,false,0,1,'true','false'].includes(value))fail('not_ready');}else text(value,k==='keterangan'?512:64);}out[k]=value;}return out;}
function createProductionLegacyFinance(options={}){
  let enabled=false;try{const d=plain(options)&&Object.getOwnPropertyDescriptor(options,'enabled');enabled=!!d&&Object.hasOwn(d,'value')&&d.value===true;}catch{}
  if(!enabled)return Object.freeze({read:()=>Object.freeze({ok:false,error:'service_disabled'})});
  let capture,lastTime=null;
  try{exact(options,['enabled','binding','clock','tariffPolicy'],'unavailable');if(typeof options.clock!=='function')fail('unavailable');const trustedClock=options.clock;capture=Core.createProductionLegacyOperations({...options,clock:()=>{lastTime=trustedClock();return lastTime;}}).capture;}catch{return Object.freeze({read:()=>Object.freeze({ok:false,error:'unavailable'})});}
  function read(input){try{
    exact(input,['root','identity'],'invalid_request');const root=Core.copyLegacyRoot(input.root),identity=Core.copyLegacyRoot(input.identity),captured=capture({root,identity});
    if(captured.ok!==true){if(!CODES.has(captured.error))fail('unavailable');return Object.freeze({ok:false,error:captured.error});}
    const privateBinding=captured.context.binding,binding={};for(const key of ['projectId','databaseURL','tenantId','uid','workerId','division','grantRevision'])binding[key]=privateBinding[key];
    const own=binding.workerId,known=new Set(Object.keys(captured.context.workerCatalog.workers).filter(k=>captured.context.workerCatalog.workers[k].division==='jahit'));
    if(!plain(root.soldier)||!plain(root.soldier.produksi)||!plain(root.soldier.produksi_meta))fail('not_ready');
    const workers=rows(root.soldier.produksi_meta.tukangJahit),matches=workers.filter(w=>w.id===own);if(matches.length!==1||matches[0].deleted||matches[0].active===false)fail('not_ready');const workerLabel=text(matches[0].nama);
    const products=rows(root.soldier.produksi.produksi);if(products.length>2000)fail('capacity_limit');const productIds=new Set(),m=markers(root.soldier),reports=[],slip=[],advances=[];let rowCount=0,archiveCount=0,storedDeletionReview=false;
    function countRows(v){const result=rows(v);rowCount+=result.length;if(rowCount>MAX_ROWS)fail('capacity_limit');return result;}
    function reportLane(p,pid,contexts){const seen=new Map();for(const c of contexts)for(const row of countRows(c.jahit)){if(!ownership(row,known,own)||ignored(row)||deleted(m,pid,'jahit',row))continue;
      const record={productId:pid,product:metadata(p),stored:stored(row,['tanggal','jumlah','lolos','rijek','tarif','total','dibayar','quantityBasis'])};if(present(row,'id'))record.sourceRecordId=id(row.id);
      // Ambiguous signature tombstones do not become identities. These records
      // stay stored observations only; they never enter the slip payout lane.
      if(m.opaque.has(pid+'|jahit'))storedDeletionReview=true;
      if(record.sourceRecordId){const previous=seen.get(record.sourceRecordId);if(previous){if(stable(previous)!==stable(record))fail('not_ready');continue;}seen.set(record.sourceRecordId,record);}
      reports.push(record);if(reports.length>MAX_RECORDS)fail('capacity_limit');}}
    function stagedLane(p,pid,contexts){
      const selected={},maps={},candidates={};for(const family of ['hitungFisik','qc','gudang']){selected[family]=[];maps[family]=new Map();candidates[family]=[];for(const c of contexts)for(const row of countRows(c[family])){
        candidates[family].push(row);
        // Old aliases/unsupported non-v2 rows are retained in source and omitted
        // without returning their count, names or amounts to any partner.
        if(row.workflowVersion!==2)continue;const ownRow=ownership(row,known,own);if(!ownRow)continue;const rid=id(row.id);
        if(m.opaque.has(pid+'|'+family))fail('not_ready');if(ignored(row)||deleted(m,pid,family,row))continue;
        const old=maps[family].get(rid);if(old){if(stable(old)!==stable(row))fail('not_ready');continue;}maps[family].set(rid,row);selected[family].push(row);
      }}
      function frozen(row){if(!plain(row.payroll)||row.payroll.workerId!==own||row.payroll.rateMissing!==false)fail('not_ready');const rate=amount(row.payroll.rate);if(rate<=0)fail('not_ready');instant(row.payroll.capturedAt);return rate;}
      const usedQc=new Set(),usedWarehouse=new Set();
      function earning(h,quantity,sourceType,when,provisional,repairId=null){if(!quantity)return;pcs(quantity,true);const rate=frozen(h),total=quantity*rate;amount(total);const entry={productId:pid,product:metadata(p),countId:id(h.id),sourceType,tanggal:date(when),jumlah:quantity,tarif:rate,total,provisional};if(repairId!==null)entry.repairId=repairId;slip.push(entry);if(slip.length>MAX_RECORDS)fail('capacity_limit');}
      for(const h of selected.hitungFisik){if(h.countStage!=='verified')fail('not_ready');const quantity=pcs(h.jumlah,true),rate=frozen(h),day=date(h.tanggal);
        // A tombstoned/cancelled QC must not resurrect provisional count pay.
        const linkedQuality=candidates.qc.filter(q=>q.hfId===h.id||present(h,'qcId')&&q.id===h.qcId);
        if(present(h,'qcId')&&m.pairs.has(pid+'|qc|'+id(h.qcId))||linkedQuality.some(q=>ignored(q)||deleted(m,pid,'qc',q)))continue;
        // An explicit linked but inadmissible QC is unknown evidence, never an
        // absent inspection that may resurrect provisional wages.
        if(linkedQuality.some(q=>q.workflowVersion!==2||!ownership(q,known,own)||!maps.qc.has(id(q.id))||stable(maps.qc.get(q.id))!==stable(q)))fail('not_ready');
        const quality=selected.qc.filter(q=>q.hfId===h.id||present(h,'qcId')&&q.id===h.qcId);if(quality.length>1)fail('not_ready');
        if(!quality.length){if(present(h,'qcId'))fail('not_ready');earning(h,quantity,'hitungFisik',day,true);continue;}
        const q=quality[0];if(q.hfId!==h.id||present(h,'qcId')&&h.qcId!==q.id||usedQc.has(q.id))fail('not_ready');usedQc.add(q.id);if(frozen(q)!==rate)fail('not_ready');const qcDay=date(q.tanggal);if(qcDay<day)fail('not_ready');
        const ok=pcs(q.ok),repairPending=pcs(q.perbaikan),reject=pcs(q.reject),offline=pcs(q.offline);if(ok+repairPending+reject+offline!==quantity)fail('not_ready');
        const linkedWarehouse=candidates.gudang.filter(g=>g.qcId===q.id||g.hfId===h.id);
        if(linkedWarehouse.some(g=>g.workflowVersion!==2||!ownership(g,known,own)||ignored(g)||deleted(m,pid,'gudang',g)||!maps.gudang.has(id(g.id))||stable(maps.gudang.get(g.id))!==stable(g)))fail('not_ready');
        const mirrors=selected.gudang.filter(g=>g.qcId===q.id);let initialOk=0,repaired=0;const repairs=[];
        for(const g of mirrors){usedWarehouse.add(g.id);if(g.hfId!==h.id||frozen(g)!==rate)fail('not_ready');const movementDay=date(g.tanggal),amountPcs=pcs(g.jumlah,true);text(g.status,32);if(!['ok','kotor','perbaikan','reject','offline'].includes(g.status)||!['initial','repair'].includes(g.payrollStage))fail('not_ready');
          if(g.payrollStage==='repair'){if(g.status!=='ok'||movementDay<qcDay)fail('not_ready');repaired+=amountPcs;if(!Number.isSafeInteger(repaired))fail('not_ready');repairs.push(g);}else if(g.status==='ok'){initialOk+=amountPcs;if(!Number.isSafeInteger(initialOk))fail('not_ready');}
        }
        if(repaired>ok||initialOk!==ok-repaired)fail('not_ready');
        earning(h,ok-repaired,'hitungFisik',day,false);for(const g of repairs)earning(h,g.jumlah,'qcRepair',g.tanggal,false,id(g.id));
      }
      // Own orphan/dangling stages cannot be admitted as standalone earnings.
      if(selected.qc.some(q=>!usedQc.has(q.id))||selected.gudang.some(g=>!usedWarehouse.has(g.id)))fail('not_ready');
    }
    let slipError=null;
    for(const p of products){const pid=id(p.id);if(productIds.has(pid))fail('not_ready');productIds.add(pid);if(m.products.has(pid)||ignored(p))continue;
      const archives=p.arsip==null||typeof p.arsip==='boolean'?[]:rows(p.arsip);archiveCount+=archives.length;if(archives.length>256||archiveCount>8192)fail('capacity_limit');const contexts=[p,...archives];reportLane(p,pid,contexts);
      if(slipError===null)try{stagedLane(p,pid,contexts);}catch(error){if(error instanceof LegacyFinanceError&&error.code==='not_ready'){slipError='pending_review';slip.length=0;}else throw error;}
    }
    const loanIdentities=new Map();for(const kb of countRows(root.soldier.produksi_meta.kasbonJahit)){if(!ownership(kb,known,own)||ignored(kb))continue;const record={stored:stored(kb,['tanggal','jumlah','sisa','status','keterangan']),cicilan:[]};if(present(kb,'id'))record.sourceRecordId=id(kb.id);
      const seen=new Map();for(const c of countRows(kb.cicilan)){if(ignored(c))continue;const item={stored:stored(c,['tanggal','jumlah','keterangan'])};if(Object.hasOwn(c,'ket'))item.stored.ket=text(c.ket,512);if(present(c,'id')){item.sourceRecordId=id(c.id);const previous=seen.get(c.id);if(previous){if(stable(previous)!==stable(item))fail('not_ready');continue;}seen.set(c.id,item);}record.cicilan.push(item);if(record.cicilan.length>MAX_RECORDS)fail('capacity_limit');}
      if(record.sourceRecordId){const previous=loanIdentities.get(record.sourceRecordId);if(previous){if(stable(previous)!==stable(record))fail('not_ready');continue;}loanIdentities.set(record.sourceRecordId,record);}advances.push(record);if(advances.length>512)fail('capacity_limit');
    }
    const view={schemaVersion:1,binding,observedAt:instant(lastTime),workerLabel,storedJahit:{availability:'available',basis:'stored_values_only',deletionSignatures:storedDeletionReview?'pending_review':'no_scoped_opaque_marker',records:reports},slip:{availability:slipError?'pending_review':'available',coverage:'explicit_frozen_verified_v2_only',entries:slipError?null:slip,paymentEvidence:'not_proven'},kasbon:{availability:'available',basis:'stored_values_only',records:advances},historicalAliases:'excluded_owner_review',combinedPayout:null};
    if(Buffer.byteLength(stable(view),'utf8')>MAX_VIEW_BYTES)fail('capacity_limit');return freeze({ok:true,view});
  }catch(error){let code='unavailable';try{if((error instanceof LegacyFinanceError||error instanceof Core.LegacyOperationsError)&&CODES.has(error.code))code=error.code;}catch{}return Object.freeze({ok:false,error:code});}}
  return Object.freeze({read});
}
module.exports=Object.freeze({createProductionLegacyFinance,LegacyFinanceError,MAX_VIEW_BYTES,MAX_RECORDS});
