'use strict';
// Private, optional owner lifecycle journal. No SDK, authorization, network,
// deployment, legacy import, or browser projection. The containing tenant CAS
// must authorize an active owner and persist seed + journal together.
const {createHash}=require('node:crypto');
const Authority=require('./production-authority.cjs');
const MAX_ENTRIES=256,MAX_LEDGER_BYTES=1024*1024,MAX_COMMAND_BYTES=32768;
const forbidden=new Set(['__proto__','constructor','prototype']);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
class OwnerLedgerError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new OwnerLedgerError(code);};
function json(v,code='not_ready',depth=0,seen=new Set(),budget={nodes:0}){
  if(++budget.nodes>500000||depth>64)fail('capacity_limit');
  if(v===null||typeof v==='string'||typeof v==='boolean')return;
  if(typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=Number.MAX_SAFE_INTEGER)return;
  if(!v||typeof v!=='object'||seen.has(v)||(Array.isArray(v)?Object.getPrototypeOf(v)!==Array.prototype:![Object.prototype,null].includes(Object.getPrototypeOf(v))))fail(code);
  seen.add(v);const keys=Reflect.ownKeys(v);
  for(const key of keys){
    if(typeof key!=='string'||forbidden.has(key))fail(code);if(Array.isArray(v)&&key==='length')continue;
    const d=Object.getOwnPropertyDescriptor(v,key);
    if(!d||!d.enumerable||!Object.hasOwn(d,'value')||Array.isArray(v)&&(!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=v.length))fail(code);
    json(d.value,code,depth+1,seen,budget);
  }
  if(Array.isArray(v)&&keys.length!==v.length+1)fail(code);seen.delete(v);
}
function exact(v,required,code='not_ready'){if(!object(v)||required.some(k=>!Object.hasOwn(v,k))||Object.keys(v).some(k=>!required.includes(k)))fail(code);}
function id(v,code='not_ready'){if(typeof v!=='string'||v.length<1||v.length>128||forbidden.has(v)||!/^[A-Za-z0-9_-]+$/.test(v))fail(code);return v;}
function text(v,code){if(typeof v!=='string'||v.length>256||!v.trim()||/[\u0000-\u001f\u007f-\u009f]/.test(v))fail(code);}
function integer(v,min=0,code='not_ready'){if(!Number.isSafeInteger(v)||v<min)fail(code);}
function instant(v,code='not_ready'){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v).toISOString()!==v)fail(code);return v;}
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':object(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
// Inputs have passed the own-data JSON walk; canonical text never delegates
// object serialization to an inherited toJSON hook.
const copy=v=>JSON.parse(canonical(v));
function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
function bytes(v,max,code='capacity_limit'){if(Buffer.byteLength(typeof v==='string'?v:canonical(v),'utf8')>max)fail(code);}
function validateCreateCycleCommand(command,now){
  const code='invalid_request';json(command,code);bytes(command,MAX_COMMAND_BYTES,code);
  exact(command,['kind','requestId','product','cycleId','workers','assignments','tariffPolicy','initialTariffs'],code);
  if(command.kind!=='createCycle')fail(code);id(command.requestId,code);id(command.cycleId,code);
  exact(command.product,['id','series','namaBarang','size','cutQuantity'],code);id(command.product.id,code);
  for(const key of ['series','namaBarang','size'])text(command.product[key],code);integer(command.product.cutQuantity,1,code);
  if(!Array.isArray(command.workers)||command.workers.length<1||command.workers.length>128||!Array.isArray(command.assignments)||command.assignments.length<1||command.assignments.length>256||!Array.isArray(command.initialTariffs)||command.initialTariffs.length<1||command.initialTariffs.length>128)fail(code);
  const workers=new Set(),assignments=new Set(),assignedWorkers=new Set(),tariffWorkers=new Set(),allocated=new Map();let quantity=0;
  for(const worker of command.workers){exact(worker,['id','nama'],code);id(worker.id,code);text(worker.nama,code);if(workers.has(worker.id))fail(code);workers.add(worker.id);}
  for(const assignment of command.assignments){
    exact(assignment,['id','workerId','qty'],code);id(assignment.id,code);id(assignment.workerId,code);integer(assignment.qty,1,code);
    if(assignments.has(assignment.id)||!workers.has(assignment.workerId))fail(code);assignments.add(assignment.id);assignedWorkers.add(assignment.workerId);
    quantity+=assignment.qty;if(!Number.isSafeInteger(quantity))fail(code);allocated.set(assignment.workerId,(allocated.get(assignment.workerId)||0)+assignment.qty);
  }
  // Assignment mutation is deliberately unsupported. A partial allocation
  // would leave the later QC gate permanently unreachable.
  if(quantity!==command.product.cutQuantity)fail(code);
  exact(command.tariffPolicy,['version','kind','hour','minute'],code);id(command.tariffPolicy.version,code);integer(command.tariffPolicy.hour,0,code);integer(command.tariffPolicy.minute,0,code);
  if(command.tariffPolicy.kind!=='jakarta-fixed-local-time'||command.tariffPolicy.hour>23||command.tariffPolicy.minute>59)fail(code);
  if(now!==undefined)instant(now,code);
  for(const tariff of command.initialTariffs){
    exact(tariff,['workerId','tariffVersion','effectiveAt','currency','rate'],code);id(tariff.workerId,code);id(tariff.tariffVersion,code);instant(tariff.effectiveAt,code);integer(tariff.rate,1,code);
    if(!assignedWorkers.has(tariff.workerId)||tariffWorkers.has(tariff.workerId)||tariff.currency!=='IDR'||!Number.isSafeInteger(allocated.get(tariff.workerId)*tariff.rate)||now!==undefined&&tariff.effectiveAt>now)fail(code);tariffWorkers.add(tariff.workerId);
  }
  if(tariffWorkers.size!==assignedWorkers.size)fail(code);return command;
}
function createCycleSeed(command,now){
  validateCreateCycleCommand(command,now);
  const state=Authority.createAuthority({product:copy(command.product),cycleId:command.cycleId,workers:copy(command.workers),assignments:copy(command.assignments),now});
  const historyByWorker={};for(const tariff of command.initialTariffs)historyByWorker[tariff.workerId]={[tariff.tariffVersion]:{effectiveAt:tariff.effectiveAt,currency:tariff.currency,rate:tariff.rate}};
  return {config:{revision:1,active:false,reviewedEmptyCycle:false,tariffPolicy:'explicit-historical-jakarta-v1'},tariffInputs:{revision:1,policy:copy(command.tariffPolicy),historyByWorker},wire:Authority.encodeStorage(state)};
}
function validateOwnerLedger(value,products){
  if(value===undefined)return null;
  json(value);bytes(value,MAX_LEDGER_BYTES);exact(value,['schemaVersion','entries']);
  if(value.schemaVersion!==1||!object(value.entries)||Object.keys(value.entries).length<1)fail('not_ready');
  if(Object.keys(value.entries).length>MAX_ENTRIES)fail('capacity_limit');
  const targets=new Set();
  for(const [key,entry]of Object.entries(value.entries)){
    exact(entry,['uid','requestId','commandHash','commandJson','productId','cycleId','acceptedAt','initialSnapshotHash','receipt']);
    id(entry.uid);id(entry.requestId);id(entry.productId);id(entry.cycleId);instant(entry.acceptedAt);
    const target=canonical([entry.productId,entry.cycleId]);if(targets.has(target))fail('not_ready');targets.add(target);
    if(!/^[a-f0-9]{64}$/.test(key)||key!==hash([entry.uid,entry.requestId])||!/^[a-f0-9]{64}$/.test(entry.commandHash)||!/^[a-f0-9]{64}$/.test(entry.initialSnapshotHash)||typeof entry.commandJson!=='string')fail('not_ready');
    bytes(entry.commandJson,MAX_COMMAND_BYTES);let command;try{command=JSON.parse(entry.commandJson);}catch{fail('not_ready');}
    try{validateCreateCycleCommand(command,entry.acceptedAt);}catch(error){if(error instanceof OwnerLedgerError&&error.code==='capacity_limit')throw error;fail('not_ready');}
    if(canonical(command)!==entry.commandJson||hash(command)!==entry.commandHash||command.requestId!==entry.requestId||command.product.id!==entry.productId||command.cycleId!==entry.cycleId)fail('not_ready');
    exact(entry.receipt,['requestId','kind','productId','cycleId','revision','acceptedAt']);
    if(canonical(entry.receipt)!==canonical({requestId:entry.requestId,kind:'createCycle',productId:entry.productId,cycleId:entry.cycleId,revision:0,acceptedAt:entry.acceptedAt}))fail('not_ready');
    if(!object(products)||!Object.hasOwn(products,entry.productId)||!object(products[entry.productId].cycles)||!Object.hasOwn(products[entry.productId].cycles,entry.cycleId))fail('not_ready');
    const cycle=products[entry.productId].cycles[entry.cycleId];let state;try{state=Authority.decodeStorage(cycle.wire);}catch{fail('not_ready');}
    const initial=state.snapshots.v0000000000;
    if(state.productId!==entry.productId||state.cycleId!==entry.cycleId||!initial||initial.hash!==entry.initialSnapshotHash||initial.acceptedAt!==entry.acceptedAt||canonical(state.product)!==canonical(command.product))fail('not_ready');
    const workers=Object.fromEntries(command.workers.map(worker=>[worker.id,worker])),assignments=Object.fromEntries(command.assignments.map(assignment=>[assignment.id,assignment]));
    if(canonical(state.workers)!==canonical(workers)||canonical(state.assignments)!==canonical(assignments)||canonical(cycle.tariffInputs.policy)!==canonical(command.tariffPolicy))fail('not_ready');
    for(const tariff of command.initialTariffs){
      const original=cycle.tariffInputs.historyByWorker?.[tariff.workerId]?.[tariff.tariffVersion];
      if(canonical(original)!==canonical({effectiveAt:tariff.effectiveAt,currency:tariff.currency,rate:tariff.rate}))fail('not_ready');
    }
  }
  return value;
}
function getOwnerReceipt(value,uid,command){
  id(uid,'access_denied');validateCreateCycleCommand(command);if(value===undefined||value===null)return null;
  const key=hash([uid,command.requestId]),entry=Object.hasOwn(value.entries,key)?value.entries[key]:null;
  if(!entry)return null;if(entry.commandHash!==hash(command)||entry.commandJson!==canonical(command))fail('conflict');return freeze(copy(entry.receipt));
}
function appendOwnerLedger(value,{uid,command,acceptedAt,initialSnapshotHash},products){
  id(uid,'access_denied');validateCreateCycleCommand(command,acceptedAt);instant(acceptedAt);if(!/^[a-f0-9]{64}$/.test(initialSnapshotHash))fail('not_ready');
  if(value!==undefined&&value!==null)validateOwnerLedger(value,products);
  const next=value===undefined||value===null?{schemaVersion:1,entries:{}}:copy(value),key=hash([uid,command.requestId]);
  if(Object.hasOwn(next.entries,key))fail('conflict');
  const receipt={requestId:command.requestId,kind:'createCycle',productId:command.product.id,cycleId:command.cycleId,revision:0,acceptedAt};
  next.entries[key]={uid,requestId:command.requestId,commandHash:hash(command),commandJson:canonical(command),productId:command.product.id,cycleId:command.cycleId,acceptedAt,initialSnapshotHash,receipt};
  validateOwnerLedger(next,products);return next;
}
module.exports=Object.freeze({OwnerLedgerError,validateCreateCycleCommand,createCycleSeed,validateOwnerLedger,getOwnerReceipt,appendOwnerLedger});
