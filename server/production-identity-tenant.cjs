'use strict';
// Initial identity-only candidate. No SDK, clock, writer, registry, runtime,
// Auth proof, v1 import/normalization, production migration or logging.
const MAX_BYTES=65536,MAX_WORKERS=128,MAX_DEPTH=16,MAX_NODES=4096;
const ROOT_KEYS=['schemaVersion','projectId','tenantId','initialization','workerCatalog','grants'];
const INIT_KEYS=['schemaVersion','kind','reviewed','bootstrapId','initializedAt','ownerUid','ownerGrantRevision'];
const RESERVED=new Set(['__proto__','constructor','prototype']);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
class InitialIdentityTenantError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new InitialIdentityTenantError(code);};
const ERROR_CODES=new Set(['invalid_identity_tenant','scope_mismatch','capacity_limit','unsupported_storage_key']);
function errorCode(error){
  try{
    if(error instanceof InitialIdentityTenantError){const descriptor=Object.getOwnPropertyDescriptor(error,'code');if(descriptor&&Object.hasOwn(descriptor,'value')&&typeof descriptor.value==='string'&&ERROR_CODES.has(descriptor.value))return descriptor.value;}
  }catch{}
  return 'invalid_identity_tenant';
}
function define(target,key,value){Object.defineProperty(target,key,{value,enumerable:true,writable:true,configurable:true});}
function field(value,key){
  if(!plain(value))fail('invalid_identity_tenant');
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(!descriptor||!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))fail('invalid_identity_tenant');
  return descriptor.value;
}
function exact(value,keys){
  if(!plain(value))fail('invalid_identity_tenant');
  const names=Reflect.ownKeys(value);
  if(names.length!==keys.length||keys.some(key=>!names.includes(key)))fail('invalid_identity_tenant');
  for(const key of keys)field(value,key);
}
function safeId(value){return typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value)&&!RESERVED.has(value);}
function storageId(value){
  if(!safeId(value))fail('invalid_identity_tenant');
  // Numeric map keys can become arrays in RTDB val(). Do not rename IDs.
  if(/^\d+$/.test(value))fail('unsupported_storage_key');
  return value;
}
function timestamp(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||Number.isNaN(Date.parse(value))||new Date(value).toISOString()!==value)fail('invalid_identity_tenant');
  return value;
}
function freeze(value){
  if(value&&typeof value==='object'){
    for(const key of Reflect.ownKeys(value)){if(key!=='length')freeze(Object.getOwnPropertyDescriptor(value,key).value);}
    Object.freeze(value);
  }
  return value;
}
function copyJSON(value){
  // Descriptor-only traversal and primitive string rendering. No object or
  // array JSON.stringify(), inherited toJSON, getters or coercion hooks.
  const seen=new Set();let nodes=0,bytes=0;
  const count=text=>{bytes+=Buffer.byteLength(text,'utf8');if(bytes>MAX_BYTES)fail('capacity_limit');};
  function visit(input,depth){
    if(++nodes>MAX_NODES||depth>MAX_DEPTH)fail('capacity_limit');
    if(input===null||typeof input==='string'||typeof input==='boolean'){count(JSON.stringify(input));return input;}
    if(typeof input==='number'&&Number.isFinite(input)&&Math.abs(input)<=Number.MAX_SAFE_INTEGER&&!Object.is(input,-0)){count(JSON.stringify(input));return input;}
    if(input===null||typeof input!=='object'||seen.has(input))fail('invalid_identity_tenant');
    const array=Array.isArray(input);
    if(array?Object.getPrototypeOf(input)!==Array.prototype:!plain(input))fail('invalid_identity_tenant');
    seen.add(input);const names=Reflect.ownKeys(input);let length;
    if(names.length>MAX_NODES)fail('capacity_limit');
    if(array){
      const descriptor=Object.getOwnPropertyDescriptor(input,'length');
      if(!descriptor||!Object.hasOwn(descriptor,'value')||!Number.isSafeInteger(descriptor.value)||descriptor.value<0)fail('invalid_identity_tenant');
      length=descriptor.value;if(length>MAX_NODES)fail('capacity_limit');
      if(names.length!==length+1||names.some(key=>typeof key!=='string'||key!=='length'&&(!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=length)))fail('invalid_identity_tenant');
    }else if(names.some(key=>typeof key!=='string'||RESERVED.has(key)))fail('invalid_identity_tenant');
    const output=array?[]:{};count(array?'[':'{');
    const keys=array?Array.from({length},(_,index)=>String(index)):names.slice().sort();
    for(let index=0;index<keys.length;index++){
      const key=keys[index],descriptor=Object.getOwnPropertyDescriptor(input,key);
      if(!descriptor||!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))fail('invalid_identity_tenant');
      if(index)count(',');if(!array){count(JSON.stringify(key));count(':');}
      define(output,key,visit(descriptor.value,depth+1));
    }
    count(array?']':'}');seen.delete(input);return output;
  }
  return visit(value,0);
}
function scope(value){
  exact(value,['projectId','tenantId']);
  const projectId=field(value,'projectId'),tenantId=field(value,'tenantId');
  if(typeof projectId!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)||!safeId(tenantId))fail('invalid_identity_tenant');
  return {projectId,tenantId};
}
function catalog(value){
  exact(value,['schemaVersion','revision','reviewed','workers']);
  if(value.schemaVersion!==1||value.revision!==1||value.reviewed!==true)fail('invalid_identity_tenant');
  if(!plain(value.workers))fail('invalid_identity_tenant');
  const ids=Object.keys(value.workers);if(ids.length<1||ids.length>MAX_WORKERS)fail('capacity_limit');
  for(const workerId of ids){
    storageId(workerId);const row=field(value.workers,workerId);exact(row,['division','reviewed']);
    if(!['jahit','potong'].includes(row.division)||row.reviewed!==true)fail('invalid_identity_tenant');
  }
}
function validateInitialIdentityTenant(value,binding){
  try{
    const fixed=scope(copyJSON(binding)),copied=copyJSON(value);exact(copied,ROOT_KEYS);
    if(copied.schemaVersion!==2)fail('invalid_identity_tenant');
    if(copied.projectId!==fixed.projectId||copied.tenantId!==fixed.tenantId)fail('scope_mismatch');
    const initial=copied.initialization;exact(initial,INIT_KEYS);
    if(initial.schemaVersion!==1||initial.kind!=='reviewed-identity-only-v1'||initial.reviewed!==true||initial.ownerGrantRevision!==1||!safeId(initial.bootstrapId))fail('invalid_identity_tenant');
    timestamp(initial.initializedAt);storageId(initial.ownerUid);catalog(copied.workerCatalog);
    if(!plain(copied.grants)||Object.keys(copied.grants).length!==1||!Object.hasOwn(copied.grants,initial.ownerUid))fail('invalid_identity_tenant');
    const owner=field(copied.grants,initial.ownerUid);exact(owner,['revision','profile']);exact(owner.profile,['active','owner']);
    if(owner.revision!==1||owner.profile.active!==true||owner.profile.owner!==true)fail('invalid_identity_tenant');
    return freeze(copied);
  }catch(error){fail(errorCode(error));}
}
const rejected=error=>Object.freeze({ok:false,error});
function createInitialIdentityTenantPreparer(options){
  let enabled=false;
  try{const descriptor=plain(options)&&Object.getOwnPropertyDescriptor(options,'enabled');enabled=!!descriptor&&Object.hasOwn(descriptor,'value')&&descriptor.value===true;}catch{}
  if(!enabled)return Object.freeze({prepare:()=>rejected('service_disabled')});
  let fixed;
  try{const config=copyJSON(options);exact(config,['enabled','scope']);fixed=freeze(scope(config.scope));}catch{return Object.freeze({prepare:()=>rejected('invalid_configuration')});}
  return Object.freeze({prepare(request){
    try{
      const input=copyJSON(request);exact(input,['ownerUid','bootstrapId','initializedAt','workerCatalog']);
      storageId(input.ownerUid);const grants={};define(grants,input.ownerUid,{revision:1,profile:{active:true,owner:true}});
      const tenant=validateInitialIdentityTenant({schemaVersion:2,projectId:fixed.projectId,tenantId:fixed.tenantId,initialization:{schemaVersion:1,kind:'reviewed-identity-only-v1',reviewed:true,bootstrapId:input.bootstrapId,initializedAt:input.initializedAt,ownerUid:input.ownerUid,ownerGrantRevision:1},workerCatalog:input.workerCatalog,grants},fixed);
      return freeze({ok:true,preparedOnly:true,readyForProduction:false,authorizationGranted:false,authProven:false,grantWritten:false,migrated:false,tenant});
    }catch(error){return rejected(errorCode(error));}
  }});
}
module.exports=Object.freeze({MAX_BYTES,MAX_WORKERS,MAX_DEPTH,MAX_NODES,InitialIdentityTenantError,validateInitialIdentityTenant,createInitialIdentityTenantPreparer});
