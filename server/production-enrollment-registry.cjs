'use strict';
// Server-only approval codec and pure transition. No SDK, I/O, bootstrap writer,
// email normalization, client roster or authorization from request claims.
const Authority=require('./production-authority.cjs');
const Identity=require('./production-enrollment-identity.cjs');
const MAX_ROWS=128,MAX_BYTES=64*1024,ADMISSION_LIMIT=8,ADMISSION_WINDOW_MS=60000;
const MAX_NODES=500000,MAX_AGE_MS=300000;
const forbidden=new Set(['__proto__','constructor','prototype']);
const modules=new Set(['potong','jahit','qc','laporan','stok','gaji','hpp','pembelian','nota','retur']);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const own=(v,key)=>Object.getOwnPropertyDescriptor(v,key)?.value;
const put=(v,key,value)=>Object.defineProperty(v,key,{value,enumerable:true,writable:true,configurable:true});
const safe=v=>typeof v==='string'&&v.length>0&&v.length<=128&&!forbidden.has(v)&&/^[A-Za-z0-9_-]+$/.test(v);
class EnrollmentRegistryError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new EnrollmentRegistryError(code);};
function json(v,depth=0,seen=new Set(),budget={nodes:0}){
  if(++budget.nodes>MAX_NODES||depth>64)fail('capacity_limit');
  if(v===null||typeof v==='string'||typeof v==='boolean')return;
  if(typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=Number.MAX_SAFE_INTEGER)return;
  if(!v||typeof v!=='object'||seen.has(v)||(Array.isArray(v)?Object.getPrototypeOf(v)!==Array.prototype:![Object.prototype,null].includes(Object.getPrototypeOf(v))))fail('not_ready');
  seen.add(v);const keys=Reflect.ownKeys(v);
  for(const key of keys){
    if(typeof key!=='string'||forbidden.has(key))fail('not_ready');if(Array.isArray(v)&&key==='length')continue;
    const d=Object.getOwnPropertyDescriptor(v,key);
    if(!d||!d.enumerable||!Object.hasOwn(d,'value')||Array.isArray(v)&&(!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=v.length))fail('not_ready');
    json(d.value,depth+1,seen,budget);
  }
  if(Array.isArray(v)&&keys.length!==v.length+1)fail('not_ready');seen.delete(v);
}
function exact(v,required,optional=[]){if(!object(v)||required.some(key=>!Object.hasOwn(v,key))||Object.keys(v).some(key=>!required.includes(key)&&!optional.includes(key)))fail('not_ready');}
function integer(v,min=0,max=Number.MAX_SAFE_INTEGER){if(!Number.isSafeInteger(v)||v<min||v>max)fail('not_ready');}
function id(v){if(!safe(v))fail('not_ready');return v;}
function instant(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v).toISOString()!==v)fail('not_ready');return v;}
function descriptorText(v){
  if(v===null)return 'null';if(typeof v!=='object')return JSON.stringify(v);
  if(Array.isArray(v)){const parts=[];for(let index=0;index<v.length;index++)parts.push(descriptorText(Object.getOwnPropertyDescriptor(v,String(index)).value));return '['+parts.join(',')+']';}
  return '{'+Object.keys(v).map(key=>JSON.stringify(key)+':'+descriptorText(Object.getOwnPropertyDescriptor(v,key).value)).join(',')+'}';
}
function serializeEnrollmentData(v){return protect(()=>{json(v);return descriptorText(v);});}
function copyEnrollmentData(v){return protect(()=>JSON.parse(serializeEnrollmentData(v)));}
const copy=copyEnrollmentData;
function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
function protect(fn){try{return fn();}catch(error){if(error instanceof EnrollmentRegistryError)throw error;fail('not_ready');}}
function map(v){if(!object(v))fail('not_ready');for(const key of Object.keys(v))id(key);}
function approvedProfile(v){
  exact(v,['active','owner','modules'],['workerId']);
  if(v.active!==true||v.owner!==false)fail('not_ready');exact(v.modules,[],['jahit','qc']);
  const keys=Object.keys(v.modules);if(keys.length!==1||v.modules[keys[0]]!==true)fail('not_ready');
  if(keys[0]==='jahit'){if(!Object.hasOwn(v,'workerId'))fail('not_ready');id(v.workerId);}
  else if(Object.hasOwn(v,'workerId'))fail('not_ready');
}
function canonicalGrants(v){
  map(v);for(const grant of Object.values(v)){
    exact(grant,['revision','profile']);integer(grant.revision);const p=grant.profile;
    exact(p,['active','owner'],['workerId','modules']);if(typeof p.active!=='boolean'||typeof p.owner!=='boolean')fail('not_ready');
    if(Object.hasOwn(p,'workerId'))id(p.workerId);
    if(Object.hasOwn(p,'modules')&&(!object(p.modules)||Object.keys(p.modules).some(key=>!modules.has(key)||typeof p.modules[key]!=='boolean')))fail('not_ready');
  }
}
function parseRegistry(v){
  if(v===undefined)return null;
  json(v);if(Buffer.byteLength(serializeEnrollmentData(v),'utf8')>MAX_BYTES)fail('capacity_limit');
  exact(v,['schemaVersion','approvals']);if(v.schemaVersion!==1)fail('not_ready');map(v.approvals);
  const list=Object.entries(v.approvals);if(list.length<1)fail('not_ready');if(list.length>MAX_ROWS)fail('capacity_limit');
  const emails=new Set(),workers=new Set(),uids=new Set(),subjects=new Set();
  for(const [,row]of list){
    exact(row,['email','profile','reviewed','approvedAt','expiresAt','revision','status'],['claim','admission']);
    if(!Identity.isEnrollmentEmail(row.email)||emails.has(row.email)||row.reviewed!==true||!['pending','claimed','revoked'].includes(row.status))fail('not_ready');emails.add(row.email);
    approvedProfile(row.profile);instant(row.approvedAt);instant(row.expiresAt);integer(row.revision,1);
    if(row.approvedAt>=row.expiresAt)fail('not_ready');
    if(Object.hasOwn(row.profile,'workerId')){if(workers.has(row.profile.workerId))fail('not_ready');workers.add(row.profile.workerId);}
    if(Object.hasOwn(row,'claim')){
      if(row.status==='pending')fail('not_ready');exact(row.claim,['uid','googleSubject','claimedAt','grantRevision']);
      id(row.claim.uid);id(row.claim.googleSubject);instant(row.claim.claimedAt);integer(row.claim.grantRevision,1);
      if(row.revision<2||row.claim.grantRevision!==1||row.claim.claimedAt<row.approvedAt||row.claim.claimedAt>=row.expiresAt||uids.has(row.claim.uid)||subjects.has(row.claim.googleSubject))fail('not_ready');
      uids.add(row.claim.uid);subjects.add(row.claim.googleSubject);
    }else if(row.status==='claimed')fail('not_ready');
    if(Object.hasOwn(row,'admission')){
      exact(row.admission,['windowStartedAt','count']);integer(row.admission.windowStartedAt);integer(row.admission.count,1,ADMISSION_LIMIT);
      if(row.admission.windowStartedAt%ADMISSION_WINDOW_MS!==0||row.admission.windowStartedAt<Math.floor(Date.parse(row.approvedAt)/ADMISSION_WINDOW_MS)*ADMISSION_WINDOW_MS)fail('not_ready');
    }
  }
  return list;
}
function states(products){
  map(products);const out=[];
  for(const [productId,p]of Object.entries(products)){
    exact(p,['cycles']);map(p.cycles);
    for(const [cycleId,c]of Object.entries(p.cycles)){
      exact(c,['config','tariffInputs','wire']);exact(c.config,['revision','active','reviewedEmptyCycle','tariffPolicy']);integer(c.config.revision);
      if(typeof c.config.active!=='boolean'||typeof c.config.reviewedEmptyCycle!=='boolean'||c.config.tariffPolicy!=='explicit-historical-jakarta-v1')fail('not_ready');
      const state=Authority.decodeStorage(c.wire);if(state.productId!==productId||state.cycleId!==cycleId)fail('not_ready');out.push({config:c.config,state});
    }
  }
  return out;
}
function validateEnrollmentRegistry(registry,grants,products){return protect(()=>{
  const entries=parseRegistry(registry);if(entries===null)return registry;
  json(grants);json(products);canonicalGrants(grants);const decoded=states(products);
  for(const [,row]of entries){
    const workerId=own(row.profile,'workerId');
    if(workerId!==undefined&&!decoded.some(({state})=>Object.hasOwn(state.workers,workerId)))fail('not_ready');
    const claim=own(row,'claim');
    if(claim){
      if(!Object.hasOwn(grants,claim.uid))fail('not_ready');const current=grants[claim.uid];
      if(current.revision<claim.grantRevision)fail('not_ready');
      if(workerId!==undefined?(!Object.hasOwn(current.profile,'workerId')||current.profile.workerId!==workerId):Object.hasOwn(current.profile,'workerId'))fail('not_ready');
    }
    if(workerId!==undefined&&Object.entries(grants).some(([uid,grant])=>own(grant.profile,'workerId')===workerId&&(!claim||uid!==claim.uid)))fail('not_ready');
  }
  return registry;
});}
function lookupEnrollmentApproval(registry,email){return protect(()=>{
  if(!Identity.isEnrollmentEmail(email))fail('access_denied');const entries=parseRegistry(registry);if(entries===null)return null;
  const found=entries.find(([,row])=>row.email===email);return found?freeze({approvalId:found[0],row:copy(found[1])}):null;
});}
function lookupEnrollmentClaim(registry,identity){return protect(()=>{
  json(identity);exact(identity,['projectId','uid','email','googleSubject','authTimeMs','issuedAtMs','expiresAtMs','verifiedAt']);
  if(!safe(identity.uid)||!safe(identity.googleSubject))fail('access_denied');
  const entries=parseRegistry(registry);if(entries===null)return null;
  const matching=entries.filter(([,row])=>{const claim=own(row,'claim');return claim&&(claim.uid===identity.uid||claim.googleSubject===identity.googleSubject);});
  if(!matching.length)return null;
  const claim=matching.length===1?own(matching[0][1],'claim'):null;
  if(matching.length!==1||claim.uid!==identity.uid||claim.googleSubject!==identity.googleSubject)fail('access_denied');
  return freeze({approvalId:matching[0][0],row:copy(matching[0][1])});
});}
function verifiedIdentity(v,projectId,now){
  json(v);exact(v,['projectId','uid','email','googleSubject','authTimeMs','issuedAtMs','expiresAtMs','verifiedAt']);
  if(v.projectId!==projectId||!safe(v.uid)||!safe(v.googleSubject)||!Identity.isEnrollmentEmail(v.email))fail('access_denied');
  for(const field of ['authTimeMs','issuedAtMs','expiresAtMs'])integer(v[field]);instant(v.verifiedAt);
  const ms=Date.parse(now),verifiedMs=Date.parse(v.verifiedAt);
  if(v.authTimeMs>v.issuedAtMs||v.issuedAtMs>=v.expiresAtMs||v.authTimeMs>ms||v.issuedAtMs>ms||v.expiresAtMs<=ms||verifiedMs>ms||verifiedMs<v.issuedAtMs||ms-v.authTimeMs>MAX_AGE_MS||ms-v.issuedAtMs>MAX_AGE_MS)fail('access_denied');
}
function increment(value){if(value>=Number.MAX_SAFE_INTEGER)fail('capacity_limit');return value+1;}
function admit(row,now){
  const windowStartedAt=Math.floor(Date.parse(now)/ADMISSION_WINDOW_MS)*ADMISSION_WINDOW_MS;
  const admission=own(row,'admission');
  if(admission&&windowStartedAt<admission.windowStartedAt)fail('access_denied');
  const count=admission&&windowStartedAt===admission.windowStartedAt?admission.count:0;
  if(count>=ADMISSION_LIMIT)fail('rate_limited');return {windowStartedAt,count:count+1};
}
function matchesProfile(current,approved){
  const currentModules=own(current,'modules');
  return current.active===true&&current.owner===false&&Object.hasOwn(current,'workerId')===Object.hasOwn(approved,'workerId')&&own(current,'workerId')===own(approved,'workerId')&&object(currentModules)&&Object.keys(currentModules).length===1&&Object.keys(approved.modules).every(key=>Object.hasOwn(currentModules,key)&&own(currentModules,key)===true);
}
function claimEnrollment(tenant,identity,now){return protect(()=>{
  json(tenant);exact(tenant,['schemaVersion','projectId','tenantId','grants','products'],['ownerCommandLedger','tariffCommandLedger','enrollmentRegistry']);
  if(tenant.schemaVersion!==1||typeof tenant.projectId!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(tenant.projectId))fail('not_ready');id(tenant.tenantId);instant(now);
  const registry=own(tenant,'enrollmentRegistry');
  canonicalGrants(tenant.grants);validateEnrollmentRegistry(registry,tenant.grants,tenant.products);verifiedIdentity(identity,tenant.projectId,now);
  if(!Object.values(tenant.grants).some(grant=>grant.profile.active===true&&grant.profile.owner===true))fail('not_ready');
  // A retained identity always wins over a newly observed email. Partial UID or
  // subject matches fail closed; there is no fallback into another approval.
  const found=lookupEnrollmentClaim(registry,identity)||lookupEnrollmentApproval(registry,identity.email);if(!found||found.row.status==='revoked')fail('access_denied');
  const {approvalId,row}=found;let replayed=false,grantRevision=1;
  if(row.status==='claimed'){
    const claim=row.claim,current=tenant.grants[claim.uid];
    if(claim.uid!==identity.uid||claim.googleSubject!==identity.googleSubject||now<claim.claimedAt||!current||!matchesProfile(current.profile,row.profile))fail('access_denied');
    replayed=true;grantRevision=current.revision;
  }else{
    if(now<row.approvedAt||now>=row.expiresAt||Object.hasOwn(tenant.grants,identity.uid)||Object.values(registry.approvals).some(other=>{const claim=own(other,'claim');return claim&&(claim.uid===identity.uid||claim.googleSubject===identity.googleSubject);}))fail('access_denied');
    const workerId=own(row.profile,'workerId');
    if(workerId!==undefined&&!states(tenant.products).some(({config,state})=>config.active===true&&config.reviewedEmptyCycle===true&&Object.hasOwn(state.workers,workerId)&&Object.values(state.assignments).some(assignment=>assignment.workerId===workerId)))fail('not_ready');
  }
  const admission=admit(row,now),next=copy(tenant),selected=next.enrollmentRegistry.approvals[approvalId];
  put(selected,'admission',admission);selected.revision=increment(row.revision);
  if(!replayed){selected.status='claimed';put(selected,'claim',{uid:identity.uid,googleSubject:identity.googleSubject,claimedAt:now,grantRevision:1});put(next.grants,identity.uid,{revision:1,profile:copy(row.profile)});}
  validateEnrollmentRegistry(next.enrollmentRegistry,next.grants,next.products);
  return freeze({next,approvalId,replayed,grantRevision});
});}
module.exports=Object.freeze({EnrollmentRegistryError,validateEnrollmentRegistry,lookupEnrollmentApproval,lookupEnrollmentClaim,claimEnrollment,serializeEnrollmentData,copyEnrollmentData,MAX_ROWS,MAX_BYTES,ADMISSION_LIMIT,ADMISSION_WINDOW_MS});
