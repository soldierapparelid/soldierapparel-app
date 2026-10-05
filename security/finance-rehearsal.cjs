'use strict';
const {createHash}=require('node:crypto');
const schema=require('./finance-schema.cjs');
const payroll=require('../production-payroll.js');
const MAX_NODES=250000,MAX_DEPTH=32;
const safeId=value=>typeof value==='string'&&value.length>0&&value.length<=128&&!['__proto__','constructor','prototype'].includes(value)&&/^[a-zA-Z0-9_-]+$/.test(value);
function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
function assertJson(value,depth=0,state={nodes:0}){
  if(++state.nodes>MAX_NODES||depth>MAX_DEPTH)throw new Error('invalid_source');
  if(value===null||typeof value==='boolean'||typeof value==='string')return;
  if(typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER)return;
  if(!value||typeof value!=='object'||(!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value))))throw new Error('invalid_source');
  if(Array.isArray(value)&&Object.keys(value).length!==value.length)throw new Error('invalid_source');
  for(const key of Object.keys(value)){
    if(['__proto__','constructor','prototype'].includes(key))throw new Error('invalid_source');
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor||!Object.hasOwn(descriptor,'value'))throw new Error('invalid_source');
    assertJson(descriptor.value,depth+1,state);
  }
}
function valid(value,rule){
  if(rule.kind==='id')return safeId(value);
  if(rule.kind==='text')return typeof value==='string'&&value.length<=256&&!/[\u0000-\u001f\u007f]/.test(value);
  if(rule.kind==='date')return typeof value==='string'&&(value===''||/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value);
  if(rule.kind==='count')return Number.isSafeInteger(value)&&value>=0;
  if(rule.kind==='bool')return typeof value==='boolean';
  return rule.kind==='enum'&&rule.values.includes(value);
}
function prepareCandidate(input){
  const issues={},stats={products:0,archives:0,workers:0,advances:0,operationalRecords:0,privateFields:0,payrollSnapshots:0};
  const issue=code=>{issues[code]=(issues[code]||0)+1;};
  const report=()=>({status:Object.keys(issues).length?'blocked':'candidate',readyForProduction:false,issues:{...issues},counts:{...stats}});
  try{assertJson(input);}catch{return {report:{...report(),status:'blocked',issues:{invalid_source:1}}};}
  const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
  if(!object(input)||Object.keys(input).some(key=>!['production','workers','advances'].includes(key))||!Object.hasOwn(input,'production')||!Object.hasOwn(input,'workers')||!Object.hasOwn(input,'advances'))return {report:{...report(),status:'blocked',issues:{invalid_scope:1}}};
  function list(value){
    if(value==null)return [];
    if(!Array.isArray(value)&&!object(value)){issue('invalid_collection');return [];}
    const values=Array.isArray(value)?value:Object.values(value),seen=new Set();
    return values.filter(row=>{
      if(row===null)return false; // RTDB sparse array placeholders do not contain records.
      if(!object(row)){issue('invalid_record');return false;}
      if(!safeId(row.id)){issue('missing_or_invalid_id');return false;}
      if(seen.has(row.id)){issue('duplicate_id');return false;}seen.add(row.id);return true;
    });
  }
  function project(row,fields,privateFields){
    const out={};
    for(const [key,value]of Object.entries(row)){
      if(Object.hasOwn(fields,key)){
        if(!valid(value,fields[key]))issue('invalid_operational_value');else out[key]=value;
      }else if(privateFields.includes(key))stats.privateFields++;
      else issue('unknown_field');
    }
    return out;
  }
  const source=JSON.parse(JSON.stringify(input)),workers=list(source.workers),products=list(source.production),advances=list(source.advances);
  const directory={},workerIds=new Set(workers.map(row=>row.id)),snapshots={};
  for(const worker of workers){
    if(Object.keys(worker).some(key=>!['id','nama','name',...schema.privateWorker].includes(key)))issue('unknown_worker_field');
    const name=worker.nama??worker.name;
    if(!valid(name,{kind:'text'})||!name.trim()||(worker.nama!=null&&worker.name!=null&&worker.nama!==worker.name))issue('invalid_worker_name');
    else directory[worker.id]={id:worker.id,nama:name};
  }
  stats.workers=workers.length;stats.products=products.length;stats.advances=advances.length;
  for(const advance of advances)if(!safeId(advance.tukangId)||!workerIds.has(advance.tukangId))issue('unmapped_advance');
  function cycle(row,productId,archiveId){
    const scalars=archiveId===null?schema.product:schema.archive,collections=Object.keys(schema.rows),out={};
    const known=new Set([...Object.keys(scalars),...schema.privateProduct,...collections,...(archiveId===null?['arsip']:[])]);
    if(Object.keys(row).some(key=>!known.has(key)))issue('unknown_field');
    Object.assign(out,project(Object.fromEntries(Object.entries(row).filter(([key])=>!collections.includes(key)&&key!=='arsip')),scalars,schema.privateProduct));
    const records={};
    for(const [field,fields]of Object.entries(schema.rows)){
      // Older BigSeller toggle is a boolean; preserve that flag without pretending it is a movement.
      if(['bigSaller','bigSeller'].includes(field)&&typeof row[field]==='boolean'){out[field]=row[field];continue;}
      records[field]=list(row[field]);
      const projectedRows=records[field].map(entry=>{
        const projected=project(entry,fields,schema.privateRow);
        if(projected.tukangId&&!workerIds.has(projected.tukangId))issue('unmapped_worker');
        if(entry.payroll&&(!object(entry.payroll)||!workerIds.has(entry.payroll.workerId)))issue('unmapped_payroll');
        // Do not infer identity from a mutable display name.
        if(['assignJahit','jahit','hitungFisik','qc'].includes(field)&&!projected.tukangId)issue('unmapped_worker');
        const sourceRef={productId,archiveId,collection:field,recordId:entry.id};
        if(Object.keys(entry).some(key=>['tarif','total','dibayar','payroll'].includes(key))){
          snapshots[hash(sourceRef)]={source:sourceRef,record:JSON.parse(JSON.stringify(entry))};stats.payrollSnapshots++;
        }
        stats.operationalRecords++;return projected;
      });
      // RTDB omits empty collections. Keep them only in the exact private source.
      if(projectedRows.length)out[field]=projectedRows;
    }
    const lookup=field=>new Map((records[field]||[]).map(entry=>[entry.id,entry]));
    const counts=lookup('hitungFisik'),checks=lookup('qc'),assignments=lookup('assignJahit');
    const frozenValid=(entry,snapshot)=>object(snapshot)&&snapshot.rateMissing===false&&typeof snapshot.rate==='number'&&Number.isFinite(snapshot.rate)&&snapshot.rate>0&&snapshot.rate<=Number.MAX_SAFE_INTEGER&&workerIds.has(snapshot.workerId)&&(!entry.tukangId||entry.tukangId===snapshot.workerId);
    // A missing historical snapshot must not be silently repriced from today's tariff.
    for(const entry of records.hitungFisik||[])if(entry.jumlah>0&&!entry.payrollCancelled&&!frozenValid(entry,entry.payroll))issue('frozen_rate_review_required');
    for(const entry of records.qc||[])if(entry.ok>0&&!entry.payrollCancelled){
      const captured=entry.payroll||(entry.hfId&&counts.get(entry.hfId)?.payroll);
      if(!frozenValid(entry,captured))issue('frozen_rate_review_required');
    }
    for(const entry of records.gudang||[])if(!entry.qcId&&entry.jumlah>0&&entry.status==='ok'&&!entry.payrollCancelled&&!frozenValid(entry,entry.payroll))issue('frozen_rate_review_required');
    for(const entry of records.jahit||[])if(entry.assignmentId&&!assignments.has(entry.assignmentId))issue('missing_assignment');
    for(const entry of records.hitungFisik||[])if(entry.qcId&&!checks.has(entry.qcId))issue('missing_qc');
    const linked=new Set();
    for(const entry of records.qc||[])if(entry.hfId){
      const count=counts.get(entry.hfId);
      if(!count)issue('missing_count');
      else if(count.tukangId!==entry.tukangId||(count.qcId&&count.qcId!==entry.id))issue('conflicting_link');
      if(linked.has(entry.hfId))issue('ambiguous_count');linked.add(entry.hfId);
    }
    for(const entry of records.gudang||[])if(entry.qcId&&!checks.has(entry.qcId))issue('missing_qc');
    return out;
  }
  const operations={schemaVersion:2,products:{}},earnings={};
  for(const worker of workers)earnings[worker.id]={workerId:worker.id,nama:directory[worker.id]?.nama||'',entries:{}};
  for(const product of products){
    const projected=cycle(product,product.id,null);
    if(typeof product.arsip==='boolean')projected.arsip=product.arsip;
    else{const archives=list(product.arsip).map(archive=>{stats.archives++;return cycle(archive,product.id,archive.id);});if(archives.length)projected.arsip=archives;}
    operations.products[product.id]=projected;
    for(const row of payroll.collectProduct(product,workers)){
      if(row.needsReview||row.missingWorker||row.missingRate||!earnings[row.workerId]){issue('payroll_review_required');continue;}
      if(!Number.isSafeInteger(row.jumlah)||!Number.isFinite(row.tarif)||row.tarif<=0||!Number.isFinite(row.total)||row.total<0||row.total>Number.MAX_SAFE_INTEGER){issue('payroll_review_required');continue;}
      const sourceId=hash(row.sourceId);
      if(earnings[row.workerId].entries[sourceId]){issue('duplicate_earning_source');continue;}
      // Approved transparency: the trusted owner can publish these work/earnings
      // facts without exposing PINs, advances or unrelated financial records.
      earnings[row.workerId].entries[sourceId]={sourceId,productId:row.productId,series:row.series,namaBarang:row.namaBarang,size:row.size,tanggal:row.tanggal,jumlah:row.jumlah,tarif:row.tarif,total:row.total,sourceType:row.sourceType,provisional:row.sourceType==='hitungFisik'};
    }
  }
  if(Object.keys(issues).length)return {report:report()};
  for(const row of Object.values(earnings))if(Object.keys(row.entries).length===0)delete row.entries;
  // Keep the exact scoped source, not a recomputation with current tariffs.
  const candidate={soldier:{workerDirectory:directory,operationsV2:operations},maklonEarnings:earnings,privateFinance:{schemaVersion:2,sourceChecksum:hash(source),legacySource:source,payrollSnapshots:snapshots}};
  if(canonical(candidate.privateFinance.legacySource)!==canonical(input))return {report:{...report(),status:'blocked',issues:{preservation_failed:1}}};
  return {report:{...report(),sourcePreserved:true},candidate};
}
module.exports={prepareCandidate,canonical,safeId,valid};
