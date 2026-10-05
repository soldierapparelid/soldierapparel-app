'use strict';
/* Server-only, deterministic per-product/cycle transaction core.
 *
 * createAuthority({product:{id,series,namaBarang,size,cutQuantity},cycleId,
 *   workers:[{id,nama}],assignments:[{id,workerId,qty}],now}) bootstraps an EMPTY
 *   reviewed cycle. It is not a legacy importer; names, archives, tariffs,
 *   payments, cutting wages and manually entered warehouse earnings are not
 *   inferred. Bootstrap inputs/assignments must come from a trusted server.
 * applyCommand(state, serverContext, browserCommand) returns
 *   {state,receipt,replayed}. Persist encodeStorage(result.state), NOT the raw
 *   state, with a transaction at ONE per-product ancestor; decodeStorage(value)
 *   restores it before the next command. The envelope contains a private JSON
 *   string plus the public projection. Firebase removes null/empty children;
 *   the string preserves the exact private state and snapshot parentHash:null.
 *   Private authority, snapshots, receipts, outbox and projection are co-located.
 *   Never return that private state to a browser; return only its receipt.
 * project(state) returns the validated operations and per-partner earnings
 *   projection. Rules must deny reads on the ancestor/private siblings and all
 *   browser writes. Each partner may read only earningsByWorker/{their ID}.
 * encodeStorage/decodeStorage are SDK-free wire adapters. The envelope is capped
 *   at 8 MiB UTF-8 including both copies of the projection and is validated on
 *   each decode. Public arrays/maps are compared after Firebase pruning; any
 *   nonempty mismatch fails closed. Never expose privateAuthority to a client.
 *   Public operations.cutQuantity is the trusted upstream witness, not an
 *   invented legacy cutting receipt; UI/codec/Rules must explicitly support it.
 *
 * serverContext = {uid,emailVerified:true,provider:'google.com',profile,now,
 *   selectedTariffs?}. Identity/profile MUST come from verified server auth and
 *   current administrator grants, not the request body. Recheck current access
 *   in the service for transaction retries. now is a server UTC ISO timestamp.
 * selectedTariffs[countId] is a private, verified historical lookup result:
 *   {source:'private-verified-tariff',verified:true,workerId,productId,cycleId,
 *    countId,workDate,basisAt,effectiveAt,tariffVersion,currency:'IDR',rate,
 *    selectedAt}. basisAt is EXPLICIT trusted tariff-selection time for that
 *   Jakarta work day. No current-rate or name fallback exists. Later QC/repairs
 *   never consult the lookup or change the frozen snapshot. New rates are whole
 *   rupiah; fractional legacy rates require a separate reviewed import policy.
 *
 * browserCommand = {requestId,productId,cycleId,expectedRevision,kind,payload}:
 *   sewing: {id,assignmentId,tanggal,good,reject}
 *   count: {id,assignmentId,tanggal,jumlah}; assignment identifies a worker,
 *          capacity is that worker's actual good sewing across assignments.
 *   inspect: {batchId,entries:[{id,hfId,tanggal,ok,perbaikan,reject,offline}]}
 *            batch members belong to ONE assigned worker, like current QC UI.
 *   repair: {id,qcId,tanggal,jumlah}
 *   cancel: {targetType:'sewing'|'count'|'inspect'|'repair',targetId}
 * Sewing partners can record/cancel only their own assigned sewing. QC/owner
 * can count, inspect, repair and cancel related operations; QC cannot set money.
 * Editing, assignment changes, legacy import, settled-period corrections and
 * standalone warehouse writes are unsupported and fail closed. QC zero earns
 * zero; initial warehouse and repair movements are mirrors, never extra pay.
 *
 * Snapshots retain each accepted projection and chained hashes unchanged.
 * Publishing is part of the SAME transaction; an async consumer must use the
 * latest outbox revision, never overwrite this projection from an older event.
 * If an out-of-band consumer is added it needs a separate conditional/versioned
 * publication contract. These functions do not deploy, enable billing, pay,
 * contact a marketplace, log records, or clear drafts. Bounded limits fail
 * before mutation; deployment sizing/retention still needs review.
 */
const {createHash}=require('node:crypto');
const MAX=Number.MAX_SAFE_INTEGER,MAX_NODES=500000,MAX_RECORDS=5000,MAX_REVISIONS=MAX_RECORDS-1;
const STORAGE_FORMAT='soldier-authority-v3',MAX_STORAGE_BYTES=8*1024*1024;
const dangerous=new Set(['__proto__','constructor','prototype']);
const safeId=value=>typeof value==='string'&&value.length>0&&value.length<=128&&!dangerous.has(value)&&/^[A-Za-z0-9_-]+$/.test(value);
class AuthorityError extends Error{constructor(code){super(code);this.name='AuthorityError';this.code=code;}}
const fail=code=>{throw new AuthorityError(code);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function assertJson(value,code='invalid_state',depth=0,tracker={nodes:0}){
  if(++tracker.nodes>MAX_NODES||depth>64)fail(code);
  if(value===null||typeof value==='boolean'||typeof value==='string')return;
  if(typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=MAX)return;
  if(!value||typeof value!=='object'||(!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value))))fail(code);
  const own=Reflect.ownKeys(value);if(own.some(key=>typeof key!=='string'))fail(code);
  if(Array.isArray(value)&&Object.keys(value).length!==value.length)fail(code);
  for(const key of own){
    if(Array.isArray(value)&&key==='length')continue;
    if(dangerous.has(key))fail(code);
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor||!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))fail(code);
    assertJson(descriptor.value,code,depth+1,tracker);
  }
}
function exact(value,required,optional=[],code='invalid_state'){
  if(!object(value)||Object.keys(value).some(key=>!required.includes(key)&&!optional.includes(key))||required.some(key=>!Object.hasOwn(value,key)))fail(code);
}
function id(value,code='invalid_state'){if(!safeId(value))fail(code);return value;}
function text(value,code='invalid_state'){if(typeof value!=='string'||value.length>256||/[\u0000-\u001f\u007f]/.test(value))fail(code);return value;}
function integer(value,positive=false,code='invalid_state'){if(!Number.isSafeInteger(value)||value<(positive?1:0))fail(code);return value;}
function date(value,code='invalid_state'){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)fail(code);return value;
}
function instant(value,code='invalid_state'){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||Number.isNaN(Date.parse(value))||new Date(value).toISOString()!==value)fail(code);return value;
}
const workDay=value=>new Date(Date.parse(value)+7*60*60*1000).toISOString().slice(0,10);
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(object(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';return JSON.stringify(value);}
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
function add(a,b,code='quantity_overflow'){const sum=a+b;if(!Number.isSafeInteger(sum)||sum<0)fail(code);return sum;}
const sum=values=>values.reduce((a,b)=>add(a,b),0);
const rows=value=>Object.values(value).sort((a,b)=>a.id.localeCompare(b.id));
const active=value=>rows(value).filter(row=>!row.cancelled);
const snapshotKey=revision=>'v'+String(revision).padStart(10,'0');
const sourceKey=(state,...parts)=>hash(['authority-v3',state.productId,state.cycleId,...parts]);
const receiptKey=(uid,requestId)=>hash([uid,requestId]);
const currentRepairs=(state,q)=>active(state.repairs).filter(row=>row.qcId===q.id);
const repaired=(state,q)=>sum(currentRepairs(state,q).map(row=>row.jumlah));
function basics(row,required){
  exact(row,[...required,'createdAt','actorUid','cancelled'],['cancelledAt','cancelledBy','cancelledRevision']);
  id(row.id);instant(row.createdAt);id(row.actorUid);if(typeof row.cancelled!=='boolean')fail('invalid_state');
  if(row.cancelled){instant(row.cancelledAt);id(row.cancelledBy);integer(row.cancelledRevision,true);}
  else if(['cancelledAt','cancelledBy','cancelledRevision'].some(key=>Object.hasOwn(row,key)))fail('invalid_state');
}
function frozenTariff(value,state,h,code='invalid_state'){
  exact(value,['source','verified','workerId','productId','cycleId','countId','workDate','basisAt','effectiveAt','tariffVersion','currency','rate','selectedAt'],[],code);
  if(value.source!=='private-verified-tariff'||value.verified!==true||value.currency!=='IDR'||value.workerId!==h.workerId||value.productId!==state.productId||value.cycleId!==state.cycleId||value.countId!==h.id||value.workDate!==h.tanggal||value.selectedAt!==h.createdAt)fail(code);
  id(value.tariffVersion,code);integer(value.rate,true,code);instant(value.selectedAt,code);instant(value.basisAt,code);instant(value.effectiveAt,code);
  if(workDay(value.basisAt)!==h.tanggal||Date.parse(value.effectiveAt)>Date.parse(value.basisAt)||Date.parse(value.basisAt)>Date.parse(value.selectedAt))fail(code);
}
function workerCapacity(state,workerId){
  const sewing=active(state.sewing).filter(row=>row.workerId===workerId),counts=active(state.counts).filter(row=>row.workerId===workerId);
  return {sewn:sum(sewing.map(row=>row.lolos)),counted:sum(counts.map(row=>row.jumlah))};
}
function countChronologyValid(state,workerId,excludedSewingId){
  const sewing=active(state.sewing).filter(row=>row.workerId===workerId&&row.id!==excludedSewingId),counts=active(state.counts).filter(row=>row.workerId===workerId);
  for(const h of counts){
    const available=sum(sewing.filter(row=>row.tanggal<=h.tanggal).map(row=>row.lolos)),used=sum(counts.filter(row=>row.tanggal<=h.tanggal).map(row=>row.jumlah));
    if(used>available)return false;
  }
  return true;
}
function readyForQc(state){
  const assignments=rows(state.assignments),sewing=active(state.sewing),counts=active(state.counts);
  const assigned=sum(assignments.map(row=>row.qty)),rawSewn=sum(sewing.map(row=>row.jumlah)),rejected=sum(sewing.map(row=>row.rijek)),good=sum(sewing.map(row=>row.lolos)),counted=sum(counts.map(row=>row.jumlah));
  return assigned===rawSewn&&counted===state.product.cutQuantity-rejected&&good===counted&&counted>0;
}
function calculate(state){
  const operations={id:state.productId,series:state.product.series,namaBarang:state.product.namaBarang,size:state.product.size,cutQuantity:state.product.cutQuantity,poJumlah:state.product.cutQuantity,poAktif:true};
  const assignments=rows(state.assignments).map(row=>({id:row.id,tukangId:row.workerId,qty:row.qty,sisa:row.qty-sum(active(state.sewing).filter(s=>s.assignmentId===row.id).map(s=>s.jumlah))}));
  const sewing=active(state.sewing).map(row=>({id:row.id,assignmentId:row.assignmentId,tukangId:row.workerId,tanggal:row.tanggal,jumlah:row.jumlah,rijek:row.rijek,lolos:row.lolos,quantityBasis:'good-plus-reject',inputAt:row.createdAt}));
  const counts=active(state.counts).map(row=>{const out={id:row.id,tukangId:row.workerId,tanggal:row.tanggal,jumlah:row.jumlah,workflowVersion:2,countStage:'verified',inputAt:row.createdAt};if(row.qcId)out.qcId=row.qcId;return out;});
  const inspections=active(state.inspections).map(q=>({id:q.id,hfId:q.hfId,qcBatchId:q.batchId,tukangId:q.workerId,tanggal:q.tanggal,ok:add(q.initial.ok,repaired(state,q)),perbaikan:q.initial.perbaikan-repaired(state,q),reject:q.initial.reject,offline:q.initial.offline,workflowVersion:2,autoFromCount:false,inputAt:q.createdAt}));
  const warehouse=[];
  function movement(q,status,jumlah,tanggal,stage,origin){if(!jumlah)return;warehouse.push({id:sourceKey(state,'warehouse',q.id,status,origin),qcId:q.id,hfId:q.hfId,tukangId:q.workerId,tanggal,jumlah,status,payrollStage:stage,workflowVersion:2});}
  for(const q of active(state.inspections)){
    movement(q,'ok',q.initial.ok,q.tanggal,'initial','initial');movement(q,'kotor',q.initial.perbaikan-repaired(state,q),q.tanggal,'initial','initial');movement(q,'reject',q.initial.reject,q.tanggal,'initial','initial');movement(q,'offline',q.initial.offline,q.tanggal,'initial','initial');
    for(const repair of currentRepairs(state,q))movement(q,'ok',repair.jumlah,repair.tanggal,'repair',repair.id);
  }
  const sellable=warehouse.filter(row=>row.status==='ok').map(row=>({id:sourceKey(state,'sellable',row.id),gudangId:row.id,qcId:row.qcId,hfId:row.hfId,tanggal:row.tanggal,jumlah:row.jumlah}));
  for(const [field,value]of Object.entries({assignJahit:assignments,jahit:sewing,hitungFisik:counts,qc:inspections,gudang:warehouse,bigSaller:sellable}))if(value.length)operations[field]=value;
  const earningsByWorker={};
  for(const worker of rows(state.workers))earningsByWorker[worker.id]={workerId:worker.id,nama:worker.nama,entries:{}};
  function earning(h,quantity,type,source,dateValue,provisional){
    if(!quantity)return;const tariff=state.frozenPayroll[h.id],total=quantity*tariff.rate;if(!Number.isSafeInteger(total)||total<0)fail('money_overflow');
    const sourceId=sourceKey(state,type,...source),entries=earningsByWorker[h.workerId].entries;
    if(Object.hasOwn(entries,sourceId))fail('invalid_state');
    entries[sourceId]={sourceId,productId:state.productId,series:state.product.series,namaBarang:state.product.namaBarang,size:state.product.size,tanggal:dateValue,jumlah:quantity,tarif:tariff.rate,total,sourceType:type,provisional};
  }
  for(const h of active(state.counts)){
    const q=h.qcId?state.inspections[h.qcId]:null;
    if(!q)earning(h,h.jumlah,'hitungFisik',[h.id],h.tanggal,true);
    else if(!q.cancelled){earning(h,q.initial.ok,'hitungFisik',[h.id],h.tanggal,false);for(const repair of currentRepairs(state,q))earning(h,repair.jumlah,'qcRepair',[q.id,repair.id],repair.tanggal,false);}
  }
  for(const worker of Object.values(earningsByWorker)){
    const entries=Object.values(worker.entries);entries.reduce((total,row)=>add(total,row.total,'money_overflow'),0);
    if(entries.length===0)delete worker.entries;
  }
  return {revision:state.revision,operations,earningsByWorker};
}
function authorityBody(state){return {schemaVersion:state.schemaVersion,productId:state.productId,cycleId:state.cycleId,product:state.product,workers:state.workers,assignments:state.assignments,sewing:state.sewing,counts:state.counts,inspections:state.inspections,repairs:state.repairs,frozenPayroll:state.frozenPayroll,receipts:state.receipts,revision:state.revision};}
function validateState(state){
  assertJson(state);exact(state,['schemaVersion','productId','cycleId','product','workers','assignments','sewing','counts','inspections','repairs','frozenPayroll','revision','receipts','snapshots','outbox','projection']);
  if(state.schemaVersion!==3)fail('invalid_state');id(state.productId);id(state.cycleId);integer(state.revision);if(state.revision>MAX_REVISIONS)fail('state_capacity');
  exact(state.product,['id','series','namaBarang','size','cutQuantity']);if(state.product.id!==state.productId)fail('invalid_state');for(const key of ['series','namaBarang','size'])text(state.product[key]);integer(state.product.cutQuantity,true);
  for(const field of ['workers','assignments','sewing','counts','inspections','repairs','frozenPayroll','receipts','snapshots'])if(!object(state[field])||Object.keys(state[field]).length>MAX_RECORDS)fail('state_capacity');
  for(const [key,worker]of Object.entries(state.workers)){exact(worker,['id','nama']);id(key);if(worker.id!==key||!text(worker.nama).trim())fail('invalid_state');}
  for(const [key,a]of Object.entries(state.assignments)){exact(a,['id','workerId','qty']);id(key);if(a.id!==key||!Object.hasOwn(state.workers,a.workerId))fail('invalid_state');integer(a.qty,true);}
  if(sum(rows(state.assignments).map(a=>a.qty))>state.product.cutQuantity)fail('invalid_state');
  for(const [key,s]of Object.entries(state.sewing)){
    basics(s,['id','assignmentId','workerId','tanggal','jumlah','lolos','rijek']);id(key);date(s.tanggal);const a=state.assignments[s.assignmentId];if(s.id!==key||!a||a.workerId!==s.workerId)fail('invalid_state');
    integer(s.jumlah,true);integer(s.lolos);integer(s.rijek);if(add(s.lolos,s.rijek)!==s.jumlah)fail('invalid_state');
  }
  for(const a of rows(state.assignments))if(sum(active(state.sewing).filter(s=>s.assignmentId===a.id).map(s=>s.jumlah))>a.qty)fail('invalid_state');
  for(const [key,h]of Object.entries(state.counts)){
    basics(h,['id','assignmentId','workerId','tanggal','jumlah',...(Object.hasOwn(h,'qcId')?['qcId']:[])]);id(key);date(h.tanggal);integer(h.jumlah,true);const a=state.assignments[h.assignmentId];
    if(h.id!==key||!a||a.workerId!==h.workerId||!Object.hasOwn(state.frozenPayroll,key))fail('invalid_state');frozenTariff(state.frozenPayroll[key],state,h);
    if(h.qcId){const q=state.inspections[h.qcId];if(!q||q.hfId!==h.id||q.workerId!==h.workerId||h.cancelled!==q.cancelled)fail('invalid_state');}
  }
  for(const key of Object.keys(state.frozenPayroll))if(!Object.hasOwn(state.counts,key))fail('invalid_state');
  for(const worker of rows(state.workers)){const capacity=workerCapacity(state,worker.id);if(capacity.counted>capacity.sewn||!countChronologyValid(state,worker.id))fail('invalid_state');}
  const batchWorkers=new Map();
  for(const [key,q]of Object.entries(state.inspections)){
    basics(q,['id','hfId','workerId','batchId','tanggal','initial']);id(key);id(q.batchId);date(q.tanggal);exact(q.initial,['ok','perbaikan','reject','offline']);for(const value of Object.values(q.initial))integer(value);
    const h=state.counts[q.hfId];if(q.id!==key||!h||h.qcId!==q.id||h.workerId!==q.workerId||q.cancelled!==h.cancelled||q.tanggal<h.tanggal||sum(Object.values(q.initial))!==h.jumlah)fail('invalid_state');
    if(batchWorkers.has(q.batchId)&&batchWorkers.get(q.batchId)!==q.workerId)fail('invalid_state');batchWorkers.set(q.batchId,q.workerId);
    if(repaired(state,q)>q.initial.perbaikan)fail('invalid_state');
  }
  for(const [key,r]of Object.entries(state.repairs)){
    basics(r,['id','qcId','workerId','tanggal','jumlah']);id(key);date(r.tanggal);integer(r.jumlah,true);const q=state.inspections[r.qcId];if(r.id!==key||!q||q.workerId!==r.workerId||r.tanggal<q.tanggal||q.cancelled&&!r.cancelled)fail('invalid_state');
  }
  const receiptRevisions=new Set();
  for(const [key,receipt]of Object.entries(state.receipts)){
    exact(receipt,['uid','requestId','payloadHash','revision','acceptedAt','kind','workerId']);id(receipt.uid);id(receipt.requestId);integer(receipt.revision,true);instant(receipt.acceptedAt);
    if(key!==receiptKey(receipt.uid,receipt.requestId)||!/^([a-f0-9]{64})$/.test(receipt.payloadHash)||receipt.revision>state.revision||!['sewing','count','inspect','repair','cancel'].includes(receipt.kind)||receipt.workerId!==null&&!Object.hasOwn(state.workers,receipt.workerId)||receiptRevisions.has(receipt.revision)||state.snapshots[snapshotKey(receipt.revision)]?.acceptedAt!==receipt.acceptedAt)fail('invalid_state');
    receiptRevisions.add(receipt.revision);
  }
  if(Object.keys(state.receipts).length!==state.revision||Object.keys(state.snapshots).length!==state.revision+1)fail('invalid_state');
  let parentHash=null;
  for(let revision=0;revision<=state.revision;revision++){
    const s=state.snapshots[snapshotKey(revision)];exact(s,['revision','acceptedAt','sourceHash','projectionHash','parentHash','hash','projection']);integer(s.revision);instant(s.acceptedAt);
    if(s.revision!==revision||s.parentHash!==parentHash||s.projection.revision!==revision||s.projectionHash!==hash(s.projection)||s.hash!==hash({revision:s.revision,acceptedAt:s.acceptedAt,sourceHash:s.sourceHash,projectionHash:s.projectionHash,parentHash:s.parentHash})||!/^[a-f0-9]{64}$/.test(s.sourceHash))fail('invalid_state');
    parentHash=s.hash;
  }
  exact(state.outbox,['revision','snapshotKey','snapshotHash','state']);
  const latest=state.snapshots[snapshotKey(state.revision)];
  if(state.outbox.revision!==state.revision||state.outbox.snapshotKey!==snapshotKey(state.revision)||state.outbox.snapshotHash!==latest.hash||state.outbox.state!=='ready'||latest.sourceHash!==hash(authorityBody(state))||canonical(state.projection)!==canonical(calculate(state))||canonical(state.projection)!==canonical(latest.projection))fail('invalid_state');
}
function finalize(state,now){
  state.projection=calculate(state);
  const previous=state.revision?state.snapshots[snapshotKey(state.revision-1)]:null;
  const value={revision:state.revision,acceptedAt:now,sourceHash:hash(authorityBody(state)),projectionHash:hash(state.projection),parentHash:previous?previous.hash:null};
  value.hash=hash(value);value.projection=clone(state.projection);state.snapshots[snapshotKey(state.revision)]=value;
  state.outbox={revision:state.revision,snapshotKey:snapshotKey(state.revision),snapshotHash:value.hash,state:'ready'};
  validateState(state);return freeze(state);
}
function createAuthority(spec){
  assertJson(spec,'invalid_bootstrap');exact(spec,['product','cycleId','workers','assignments','now'],[],'invalid_bootstrap');instant(spec.now,'invalid_bootstrap');
  exact(spec.product,['id','series','namaBarang','size','cutQuantity'],[],'invalid_bootstrap');id(spec.product.id,'invalid_bootstrap');id(spec.cycleId,'invalid_bootstrap');
  if(!Array.isArray(spec.workers)||!Array.isArray(spec.assignments)||spec.workers.length>MAX_RECORDS||spec.assignments.length>MAX_RECORDS)fail('invalid_bootstrap');
  const workers={},assignments={};
  for(const worker of spec.workers){exact(worker,['id','nama'],[],'invalid_bootstrap');id(worker.id,'invalid_bootstrap');if(Object.hasOwn(workers,worker.id))fail('invalid_bootstrap');workers[worker.id]=clone(worker);}
  for(const assignment of spec.assignments){exact(assignment,['id','workerId','qty'],[],'invalid_bootstrap');id(assignment.id,'invalid_bootstrap');if(Object.hasOwn(assignments,assignment.id))fail('invalid_bootstrap');assignments[assignment.id]=clone(assignment);}
  return finalize({schemaVersion:3,productId:spec.product.id,cycleId:spec.cycleId,product:clone(spec.product),workers,assignments,sewing:{},counts:{},inspections:{},repairs:{},frozenPayroll:{},revision:0,receipts:{},snapshots:{},outbox:{},projection:{}},spec.now);
}
function validateContext(context){
  assertJson(context,'access_denied');exact(context,['uid','emailVerified','provider','profile','now'],['selectedTariffs'],'access_denied');id(context.uid,'access_denied');instant(context.now,'access_denied');
  if(context.emailVerified!==true||context.provider!=='google.com'||!object(context.profile)||context.profile.active!==true)fail('access_denied');
  if(context.profile.workerId!==undefined)id(context.profile.workerId,'access_denied');
}
function validateCommand(command){
  assertJson(command,'invalid_command');exact(command,['requestId','productId','cycleId','expectedRevision','kind','payload'],[],'invalid_command');id(command.requestId,'invalid_command');id(command.productId,'invalid_command');id(command.cycleId,'invalid_command');integer(command.expectedRevision,false,'invalid_command');
  const p=command.payload;
  if(command.kind==='sewing'){exact(p,['id','assignmentId','tanggal','good','reject'],[],'invalid_command');id(p.id,'invalid_command');id(p.assignmentId,'invalid_command');date(p.tanggal,'invalid_command');integer(p.good,false,'invalid_command');integer(p.reject,false,'invalid_command');if(!add(p.good,p.reject))fail('invalid_command');}
  else if(command.kind==='count'){exact(p,['id','assignmentId','tanggal','jumlah'],[],'invalid_command');id(p.id,'invalid_command');id(p.assignmentId,'invalid_command');date(p.tanggal,'invalid_command');integer(p.jumlah,true,'invalid_command');}
  else if(command.kind==='inspect'){
    exact(p,['batchId','entries'],[],'invalid_command');id(p.batchId,'invalid_command');if(!Array.isArray(p.entries)||!p.entries.length||p.entries.length>100)fail('invalid_command');
    for(const entry of p.entries){exact(entry,['id','hfId','tanggal','ok','perbaikan','reject','offline'],[],'invalid_command');id(entry.id,'invalid_command');id(entry.hfId,'invalid_command');date(entry.tanggal,'invalid_command');for(const key of ['ok','perbaikan','reject','offline'])integer(entry[key],false,'invalid_command');}
  }else if(command.kind==='repair'){exact(p,['id','qcId','tanggal','jumlah'],[],'invalid_command');id(p.id,'invalid_command');id(p.qcId,'invalid_command');date(p.tanggal,'invalid_command');integer(p.jumlah,true,'invalid_command');}
  else if(command.kind==='cancel'){exact(p,['targetType','targetId'],[],'invalid_command');id(p.targetId,'invalid_command');if(!['sewing','count','inspect','repair'].includes(p.targetType))fail('unsupported_command');}
  else fail('unsupported_command');
}
function commandWorker(state,command){
  const p=command.payload;
  if(command.kind==='sewing'||command.kind==='count'){const a=state.assignments[p.assignmentId];if(!a)fail('invalid_relationship');return a.workerId;}
  if(command.kind==='inspect'){
    const workers=new Set();for(const entry of p.entries){const h=state.counts[entry.hfId];if(!h)fail('invalid_relationship');workers.add(h.workerId);}if(workers.size!==1)fail('invalid_relationship');return [...workers][0];
  }
  if(command.kind==='repair'){const q=state.inspections[p.qcId];if(!q)fail('invalid_relationship');return q.workerId;}
  const fields={sewing:'sewing',count:'counts',inspect:'inspections',repair:'repairs'},row=state[fields[p.targetType]][p.targetId];if(!row)fail('invalid_relationship');return row.workerId;
}
function authorize(context,command,workerId){
  if(context.profile.owner===true)return;
  const permissions=context.profile.modules||{};
  if(command.kind==='sewing'||command.kind==='cancel'&&command.payload.targetType==='sewing'){
    if(permissions.jahit!==true||context.profile.workerId!==workerId)fail('access_denied');
  }else if(permissions.qc!==true)fail('access_denied');
}
function record(context,revision,values){return {...values,createdAt:context.now,actorUid:context.uid,cancelled:false};}
function newId(collection,key){if(Object.hasOwn(collection,key))fail('reused_record_id');}
function cancelRecord(row,context,revision){if(row.cancelled)fail('invalid_transition');row.cancelled=true;row.cancelledAt=context.now;row.cancelledBy=context.uid;row.cancelledRevision=revision;}
function cancelCount(state,h,context){
  cancelRecord(h,context,state.revision);
  if(h.qcId){const q=state.inspections[h.qcId];cancelRecord(q,context,state.revision);for(const r of active(state.repairs).filter(row=>row.qcId===q.id))cancelRecord(r,context,state.revision);}
}
function mutate(state,context,command,workerId){
  const p=command.payload,today=workDay(context.now);
  if(command.kind==='sewing'){
    newId(state.sewing,p.id);if(p.tanggal>today)fail('invalid_transition');const amount=add(p.good,p.reject),a=state.assignments[p.assignmentId];
    if(add(sum(active(state.sewing).filter(row=>row.assignmentId===a.id).map(row=>row.jumlah)),amount)>a.qty)fail('capacity_exceeded');
    state.sewing[p.id]=record(context,state.revision,{id:p.id,assignmentId:a.id,workerId,tanggal:p.tanggal,jumlah:amount,lolos:p.good,rijek:p.reject});
  }else if(command.kind==='count'){
    newId(state.counts,p.id);if(p.tanggal>today)fail('invalid_transition');
    const h=record(context,state.revision,{id:p.id,assignmentId:p.assignmentId,workerId,tanggal:p.tanggal,jumlah:p.jumlah});
    const candidate={...state,counts:{...state.counts,[p.id]:h}};
    if(!countChronologyValid(candidate,workerId))fail('capacity_exceeded');
    const selected=context.selectedTariffs&&context.selectedTariffs[p.id];if(!selected)fail('frozen_tariff_required');frozenTariff(selected,state,h,'invalid_tariff_snapshot');
    state.counts[p.id]=h;state.frozenPayroll[p.id]=clone(selected);
  }else if(command.kind==='inspect'){
    if(!readyForQc(state))fail('workflow_not_ready');if(rows(state.inspections).some(q=>q.batchId===p.batchId))fail('reused_record_id');const seen=new Set();
    for(const entry of p.entries){
      newId(state.inspections,entry.id);if(seen.has(entry.hfId))fail('invalid_relationship');seen.add(entry.hfId);const h=state.counts[entry.hfId];
      if(h.cancelled||h.qcId||entry.tanggal<h.tanggal||entry.tanggal>today||sum([entry.ok,entry.perbaikan,entry.reject,entry.offline])!==h.jumlah)fail('invalid_transition');
      const initial={ok:entry.ok,perbaikan:entry.perbaikan,reject:entry.reject,offline:entry.offline};
      state.inspections[entry.id]=record(context,state.revision,{id:entry.id,hfId:h.id,workerId,batchId:p.batchId,tanggal:entry.tanggal,initial});h.qcId=entry.id;
    }
  }else if(command.kind==='repair'){
    newId(state.repairs,p.id);const q=state.inspections[p.qcId];if(q.cancelled||state.counts[q.hfId].cancelled||p.tanggal<q.tanggal||p.tanggal>today||add(repaired(state,q),p.jumlah)>q.initial.perbaikan)fail('invalid_transition');
    state.repairs[p.id]=record(context,state.revision,{id:p.id,qcId:q.id,workerId,tanggal:p.tanggal,jumlah:p.jumlah});
  }else if(p.targetType==='sewing'){
    const s=state.sewing[p.targetId],remaining=workerCapacity(state,s.workerId).sewn-s.lolos;
    if(remaining<workerCapacity(state,s.workerId).counted||!countChronologyValid(state,s.workerId,s.id))fail('dependent_records_exist');cancelRecord(s,context,state.revision);
  }else if(p.targetType==='count')cancelCount(state,state.counts[p.targetId],context);
  else if(p.targetType==='inspect')cancelCount(state,state.counts[state.inspections[p.targetId].hfId],context);
  else cancelRecord(state.repairs[p.targetId],context,state.revision);
}
function applyCommand(state,context,command){
  validateState(state);validateContext(context);validateCommand(command);
  if(command.productId!==state.productId||command.cycleId!==state.cycleId)fail('invalid_relationship');
  const workerId=commandWorker(state,command);authorize(context,command,workerId);
  const key=receiptKey(context.uid,command.requestId),payloadHash=hash(command),existing=state.receipts[key];
  if(existing){if(existing.payloadHash!==payloadHash)fail('request_id_conflict');if(existing.workerId!==workerId)fail('access_denied');return freeze({state:freeze(clone(state)),receipt:clone(existing),replayed:true});}
  if(command.expectedRevision!==state.revision)fail('stale_revision');if(state.revision>=MAX_REVISIONS)fail('state_capacity');
  if(Date.parse(context.now)<Date.parse(state.snapshots[snapshotKey(state.revision)].acceptedAt))fail('invalid_server_time');
  const next=clone(state);next.revision++;mutate(next,context,command,workerId);
  const receipt={uid:context.uid,requestId:command.requestId,payloadHash,revision:next.revision,acceptedAt:context.now,kind:command.kind,workerId};next.receipts[key]=receipt;
  return freeze({state:finalize(next,context.now),receipt:clone(receipt),replayed:false});
}
function project(state){validateState(state);return freeze(clone(state.projection));}
function storageLimit(value){if(Buffer.byteLength(typeof value==='string'?value:canonical(value),'utf8')>MAX_STORAGE_BYTES)fail('storage_capacity');}
// RTDB prunes null and empty children and may return arrays as numeric maps.
// Normalize only the public comparison, never the exact private authority JSON.
function firebaseShape(value){
  if(value===null)return undefined;
  if(value&&typeof value==='object'){
    const out={};for(const [key,child]of Object.entries(value)){const normalized=firebaseShape(child);if(normalized!==undefined)out[key]=normalized;}
    return Object.keys(out).length?out:undefined;
  }
  return value;
}
function encodeStorage(state){
  validateState(state);
  const wire={storageFormat:STORAGE_FORMAT,productId:state.productId,cycleId:state.cycleId,revision:state.revision,privateAuthority:canonical(state),projection:clone(state.projection)};
  storageLimit(wire);return freeze(wire);
}
function decodeStorage(wire){
  assertJson(wire,'invalid_storage');exact(wire,['storageFormat','productId','cycleId','revision','privateAuthority','projection'],[],'invalid_storage');
  if(wire.storageFormat!==STORAGE_FORMAT||typeof wire.privateAuthority!=='string')fail('invalid_storage');
  storageLimit(wire.privateAuthority);storageLimit(wire);
  try{
    id(wire.productId,'invalid_storage');id(wire.cycleId,'invalid_storage');integer(wire.revision,false,'invalid_storage');
    const state=JSON.parse(wire.privateAuthority);validateState(state);
    if(state.productId!==wire.productId||state.cycleId!==wire.cycleId||state.revision!==wire.revision||canonical(firebaseShape(wire.projection))!==canonical(firebaseShape(state.projection)))fail('invalid_storage');
    return freeze(state);
  }catch(error){if(error instanceof SyntaxError||error instanceof AuthorityError)fail('invalid_storage');throw error;}
}
module.exports=Object.freeze({AuthorityError,createAuthority,applyCommand,project,validateState,encodeStorage,decodeStorage});
