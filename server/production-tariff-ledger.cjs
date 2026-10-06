'use strict';
// Private retained receipts and immutable retirement fences for tariff drafts. No SDK, endpoint,
// authorization, credential storage, transfer, deployment, or browser export.
// The containing tenant CAS must authorize an active owner and persist the
// history version + ledger together. Existing wages are never repriced here.
const {createHash}=require('node:crypto');
const Authority=require('./production-authority.cjs');
const MAX_ENTRIES=256,MAX_LEDGER_BYTES=1024*1024,MAX_COMMAND_BYTES=32768;
const forbidden=new Set(['__proto__','constructor','prototype']);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
class TariffLedgerError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new TariffLedgerError(code);};
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
function integer(v,min=0,code='not_ready'){if(!Number.isSafeInteger(v)||v<min)fail(code);}
function instant(v,code='not_ready'){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v).toISOString()!==v)fail(code);return v;}
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':object(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
const copy=v=>JSON.parse(JSON.stringify(v));
function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
function bytes(v,max,code='capacity_limit'){if(Buffer.byteLength(typeof v==='string'?v:JSON.stringify(v),'utf8')>max)fail(code);}
function validateTariffCommand(command){
  const code='invalid_request';json(command,code);bytes(command,MAX_COMMAND_BYTES,code);
  exact(command,['kind','requestId','productId','cycleId','expectedConfigRevision','expectedTariffRevision','workerId','tariffVersion','effectiveAt','currency','rate'],code);
  if(command.kind!=='appendTariffVersion')fail(code);
  for(const field of ['requestId','productId','cycleId','workerId','tariffVersion'])id(command[field],code);
  integer(command.expectedConfigRevision,0,code);integer(command.expectedTariffRevision,0,code);integer(command.rate,1,code);instant(command.effectiveAt,code);
  if(command.currency!=='IDR'||command.expectedTariffRevision>=Number.MAX_SAFE_INTEGER)fail(code);return command;
}
function validateTariffLedger(value,products){
  if(value===undefined)return null;
  json(value);bytes(value,MAX_LEDGER_BYTES);exact(value,['schemaVersion','entries']);
  if(value.schemaVersion!==1||!object(value.entries)||Object.keys(value.entries).length<1)fail('not_ready');
  if(Object.keys(value.entries).length>MAX_ENTRIES)fail('capacity_limit');const targets=new Set(),revisions=new Set();
  for(const [key,entry]of Object.entries(value.entries)){
    const retired=object(entry)&&Object.hasOwn(entry,'retiredAt');
    exact(entry,['uid','requestId','commandHash','commandJson','productId','cycleId','workerId','tariffVersion',retired?'retiredAt':'acceptedAt','receipt']);
    for(const field of ['uid','requestId','productId','cycleId','workerId','tariffVersion'])id(entry[field]);instant(retired?entry.retiredAt:entry.acceptedAt);
    if(!/^[a-f0-9]{64}$/.test(key)||key!==hash([entry.uid,entry.requestId])||!/^[a-f0-9]{64}$/.test(entry.commandHash)||typeof entry.commandJson!=='string')fail('not_ready');
    bytes(entry.commandJson,MAX_COMMAND_BYTES);let command;try{command=JSON.parse(entry.commandJson);}catch{fail('not_ready');}
    try{validateTariffCommand(command);}catch(error){if(error instanceof TariffLedgerError&&error.code==='capacity_limit')throw error;fail('not_ready');}
    if(canonical(command)!==entry.commandJson||hash(command)!==entry.commandHash||['requestId','productId','cycleId','workerId','tariffVersion'].some(field=>command[field]!==entry[field]))fail('not_ready');
    if(!object(products)||!Object.hasOwn(products,entry.productId)||!object(products[entry.productId].cycles)||!Object.hasOwn(products[entry.productId].cycles,entry.cycleId))fail('not_ready');
    const cycle=products[entry.productId].cycles[entry.cycleId];let state;try{state=Authority.decodeStorage(cycle.wire);}catch{fail('not_ready');}
    if(state.productId!==entry.productId||state.cycleId!==entry.cycleId||!Object.hasOwn(state.workers,entry.workerId)||!Object.values(state.assignments).some(a=>a.workerId===entry.workerId))fail('not_ready');
    const allocated=Object.values(state.assignments).filter(a=>a.workerId===entry.workerId).reduce((total,a)=>total+a.qty,0);
    if(!Number.isSafeInteger(allocated)||!Number.isSafeInteger(allocated*command.rate))fail('not_ready');
    if(retired){
      // A fence remembers the ORIGINAL draft even after its schedule/revisions
      // have expired. It does not claim an accepted tariff target or revision.
      exact(entry.receipt,['requestId','kind','productId','cycleId','workerId','tariffVersion','retiredAt']);
      if(canonical(entry.receipt)!==canonical({requestId:entry.requestId,kind:'retireTariffDraft',productId:entry.productId,cycleId:entry.cycleId,workerId:entry.workerId,tariffVersion:entry.tariffVersion,retiredAt:entry.retiredAt}))fail('not_ready');
    }else{
      const target=canonical([entry.productId,entry.cycleId,entry.workerId,entry.tariffVersion]);if(targets.has(target))fail('not_ready');targets.add(target);
      if(command.effectiveAt<entry.acceptedAt)fail('not_ready');
      exact(entry.receipt,['requestId','kind','productId','cycleId','workerId','tariffVersion','revision','acceptedAt']);
      if(canonical(entry.receipt)!==canonical({requestId:entry.requestId,kind:'appendTariffVersion',productId:entry.productId,cycleId:entry.cycleId,workerId:entry.workerId,tariffVersion:entry.tariffVersion,revision:command.expectedTariffRevision+1,acceptedAt:entry.acceptedAt}))fail('not_ready');
      const revisionKey=canonical([entry.productId,entry.cycleId,entry.receipt.revision]);if(revisions.has(revisionKey))fail('not_ready');revisions.add(revisionKey);
      if(!object(cycle.config)||!Number.isSafeInteger(cycle.config.revision)||command.expectedConfigRevision>cycle.config.revision||!object(cycle.tariffInputs)||!Number.isSafeInteger(cycle.tariffInputs.revision)||entry.receipt.revision>cycle.tariffInputs.revision)fail('not_ready');
      const version=cycle.tariffInputs.historyByWorker?.[entry.workerId]?.[entry.tariffVersion];
      if(canonical(version)!==canonical({effectiveAt:command.effectiveAt,currency:command.currency,rate:command.rate}))fail('not_ready');
    }
  }
  return value;
}
function getTariffOutcome(value,uid,command){
  id(uid,'access_denied');validateTariffCommand(command);if(value===undefined||value===null)return null;
  const key=hash([uid,command.requestId]),entry=Object.hasOwn(value.entries,key)?value.entries[key]:null;
  if(!entry)return null;if(entry.commandHash!==hash(command)||entry.commandJson!==canonical(command))fail('conflict');return freeze({outcome:Object.hasOwn(entry,'retiredAt')?'retired':'accepted',receipt:copy(entry.receipt)});
}
function getTariffReceipt(value,uid,command){
  const found=getTariffOutcome(value,uid,command);if(found?.outcome==='retired')fail('draft_retired');return found?found.receipt:null;
}
function appendTariffLedger(value,{uid,command,acceptedAt},products){
  id(uid,'access_denied');validateTariffCommand(command);instant(acceptedAt);
  if(value!==undefined&&value!==null)validateTariffLedger(value,products);
  const next=value===undefined||value===null?{schemaVersion:1,entries:{}}:copy(value),key=hash([uid,command.requestId]);if(Object.hasOwn(next.entries,key))fail('conflict');
  const receipt={requestId:command.requestId,kind:'appendTariffVersion',productId:command.productId,cycleId:command.cycleId,workerId:command.workerId,tariffVersion:command.tariffVersion,revision:command.expectedTariffRevision+1,acceptedAt};
  next.entries[key]={uid,requestId:command.requestId,commandHash:hash(command),commandJson:canonical(command),productId:command.productId,cycleId:command.cycleId,workerId:command.workerId,tariffVersion:command.tariffVersion,acceptedAt,receipt};
  validateTariffLedger(next,products);return next;
}
function appendTariffRetirement(value,{uid,command,retiredAt},products){
  id(uid,'access_denied');validateTariffCommand(command);instant(retiredAt);
  if(value!==undefined&&value!==null)validateTariffLedger(value,products);
  const next=value===undefined||value===null?{schemaVersion:1,entries:{}}:copy(value),key=hash([uid,command.requestId]);if(Object.hasOwn(next.entries,key))fail('conflict');
  const receipt={requestId:command.requestId,kind:'retireTariffDraft',productId:command.productId,cycleId:command.cycleId,workerId:command.workerId,tariffVersion:command.tariffVersion,retiredAt};
  next.entries[key]={uid,requestId:command.requestId,commandHash:hash(command),commandJson:canonical(command),productId:command.productId,cycleId:command.cycleId,workerId:command.workerId,tariffVersion:command.tariffVersion,retiredAt,receipt};
  validateTariffLedger(next,products);return next;
}
module.exports=Object.freeze({TariffLedgerError,validateTariffCommand,validateTariffLedger,getTariffOutcome,getTariffReceipt,appendTariffLedger,appendTariffRetirement});
