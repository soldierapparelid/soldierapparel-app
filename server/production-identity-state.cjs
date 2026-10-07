'use strict';
// Identity-only v2 state and pure transitions. No SDK, writer, Auth proof,
// clock, log, v1 normalization, production cycles, tariffs or wage calculation.
const Initial=require('./production-identity-tenant.cjs');
const Registry=require('./production-enrollment-registry.cjs');
const Email=require('./production-enrollment-identity.cjs');
const MAX_BYTES=192*1024,MAX_NODES=32768,MAX_DEPTH=16,FRESH_MS=300000;
const ROOT=['schemaVersion','projectId','tenantId','initialization','workerCatalog','grants'];
const RESERVED=new Set(['__proto__','constructor','prototype']);
const CODES=new Set(['not_ready','access_denied','capacity_limit','rate_limited','conflict','invalid_request']);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const safe=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!RESERVED.has(v);
class IdentityStateError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new IdentityStateError(code);};
function protect(fn){try{return fn();}catch(error){
  let code='not_ready';try{if(error instanceof IdentityStateError){const d=Object.getOwnPropertyDescriptor(error,'code');if(d&&Object.hasOwn(d,'value')&&CODES.has(d.value))code=d.value;}}catch{}
  fail(code);
}}
function put(v,k,value){Object.defineProperty(v,k,{value,enumerable:true,writable:true,configurable:true});}
function copy(value){
  let bytes=0,nodes=0;const seen=new Set();
  const count=text=>{bytes+=Buffer.byteLength(text,'utf8');if(bytes>MAX_BYTES)fail('capacity_limit');};
  function visit(v,depth){
    if(++nodes>MAX_NODES||depth>MAX_DEPTH)fail('capacity_limit');
    if(v===null||typeof v==='string'||typeof v==='boolean'){count(JSON.stringify(v));return v;}
    if(typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=Number.MAX_SAFE_INTEGER&&!Object.is(v,-0)){count(JSON.stringify(v));return v;}
    if(!v||typeof v!=='object'||seen.has(v))fail('not_ready');
    const array=Array.isArray(v);if(array?Object.getPrototypeOf(v)!==Array.prototype:!plain(v))fail('not_ready');
    const keys=Reflect.ownKeys(v);if(keys.length>MAX_NODES)fail('capacity_limit');
    let names=keys.slice().sort();
    if(array){const d=Object.getOwnPropertyDescriptor(v,'length');if(!d||!Object.hasOwn(d,'value')||d.value>MAX_NODES)fail('capacity_limit');
      if(keys.length!==d.value+1||keys.some(k=>typeof k!=='string'||k!=='length'&&(!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=d.value)))fail('not_ready');
      names=Array.from({length:d.value},(_,i)=>String(i));
    }else if(keys.some(k=>typeof k!=='string'||RESERVED.has(k)))fail('not_ready');
    seen.add(v);const out=array?[]:{};count(array?'[':'{');
    for(let i=0;i<names.length;i++){const k=names[i],d=Object.getOwnPropertyDescriptor(v,k);
      if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail('not_ready');
      if(i)count(',');if(!array){count(JSON.stringify(k));count(':');}put(out,k,visit(d.value,depth+1));
    }count(array?']':'}');seen.delete(v);return out;
  }return visit(value,0);
}
function exact(v,required,optional=[]){if(!plain(v)||required.some(k=>!Object.hasOwn(v,k))||Object.keys(v).some(k=>!required.includes(k)&&!optional.includes(k)))fail('not_ready');}
function storageId(v){if(!safe(v)||/^\d+$/.test(v))fail('not_ready');return v;}
function integer(v,min=1,max=Number.MAX_SAFE_INTEGER){if(!Number.isSafeInteger(v)||v<min||v>max)fail('not_ready');}
function instant(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v).toISOString()!==v||Date.parse(v)<0)fail('not_ready');return v;}
function freeze(v){if(v&&typeof v==='object'){for(const k of Object.keys(v))freeze(v[k]);Object.freeze(v);}return v;}
function stable(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(stable).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';}
const equal=(a,b)=>stable(a)===stable(b);
function increment(v){if(v>=Number.MAX_SAFE_INTEGER)fail('capacity_limit');return v+1;}
function baseRegistry(registry){
  const base=copy(registry);exact(base,['schemaVersion','approvals']);if(!plain(base.approvals))fail('not_ready');
  for(const [id,row]of Object.entries(base.approvals)){storageId(id);if(!plain(row))fail('not_ready');delete row.revocation;}
  return base;
}
function validate(value,binding){
  const fixed=copy(binding),v=copy(value);exact(fixed,['projectId','tenantId']);exact(v,ROOT,['enrollmentRegistry']);
  if(!plain(v.grants)||!plain(v.initialization))fail('not_ready');const ownerUid=v.initialization.ownerUid;storageId(ownerUid);
  if(!Object.hasOwn(v.grants,ownerUid))fail('not_ready');
  const initial={};for(const k of ROOT)put(initial,k,k==='grants'?{[ownerUid]:v.grants[ownerUid]}:v[k]);
  try{Initial.validateInitialIdentityTenant(initial,fixed);}catch{fail('not_ready');}
  const grantIds=Object.keys(v.grants);if(grantIds.length>Registry.MAX_ROWS+1)fail('capacity_limit');grantIds.forEach(storageId);
  const registry=Object.hasOwn(v,'enrollmentRegistry')?v.enrollmentRegistry:undefined;
  if(registry===undefined){if(grantIds.length!==1)fail('not_ready');return freeze(v);}
  let entries;try{entries=Registry.inspectEnrollmentRegistry(baseRegistry(registry));}catch{fail('not_ready');}
  if(!entries)fail('not_ready');const claimed=new Set(),commands=new Set();
  for(const [approvalId,base]of entries){
    const row=registry.approvals[approvalId];exact(row,['email','profile','reviewed','approvedAt','expiresAt','revision','status'],['claim','admission','revocation']);
    if(row.approvedAt<v.initialization.initializedAt)fail('not_ready');
    if(Object.hasOwn(row.profile,'workerId')){
      storageId(row.profile.workerId);const worker=Object.hasOwn(v.workerCatalog.workers,row.profile.workerId)?v.workerCatalog.workers[row.profile.workerId]:null;
      if(!worker||worker.division!=='jahit'||worker.reviewed!==true)fail('not_ready');
    }
    if(row.status==='pending'&&(row.revision!==1||Object.hasOwn(row,'admission')))fail('not_ready');
    if(row.status==='revoked'){
      if(!Object.hasOwn(row,'revocation'))fail('not_ready');const receipt=row.revocation;
      exact(receipt,['requestId','revokedAt','approvalRevision'],['grantRevision']);storageId(receipt.requestId);instant(receipt.revokedAt);integer(receipt.approvalRevision);
      if(commands.has(receipt.requestId)||receipt.approvalRevision===Number.MAX_SAFE_INTEGER||row.revision!==receipt.approvalRevision+1||receipt.revokedAt<row.approvedAt||Object.hasOwn(row,'claim')&&receipt.revokedAt<row.claim.claimedAt)fail('not_ready');commands.add(receipt.requestId);
      if(Object.hasOwn(row,'claim')){if(receipt.grantRevision!==row.claim.grantRevision)fail('not_ready');}
      else if(Object.hasOwn(receipt,'grantRevision')||Object.hasOwn(row,'admission')||receipt.approvalRevision!==1)fail('not_ready');
    }else if(Object.hasOwn(row,'revocation'))fail('not_ready');
    if(Object.hasOwn(row,'claim')){
      const claim=row.claim;storageId(claim.uid);if(claim.uid===ownerUid||!Object.hasOwn(v.grants,claim.uid)||!Object.hasOwn(row,'admission'))fail('not_ready');claimed.add(claim.uid);
      const expected={revision:row.status==='claimed'?1:2,profile:copy(row.profile)};expected.profile.active=row.status==='claimed';
      if(!equal(v.grants[claim.uid],expected))fail('not_ready');
    }
  }
  if(grantIds.some(uid=>uid!==ownerUid&&!claimed.has(uid)))fail('not_ready');return freeze(v);
}
function validateIdentityTenant(value,binding){return protect(()=>validate(value,binding));}
function readIdentityGrant(tenant,identityBinding){return protect(()=>{
  const input=copy(tenant),v=validate(input,{projectId:input.projectId,tenantId:input.tenantId}),who=copy(identityBinding);
  exact(who,['uid','googleSubject']);storageId(who.uid);if(!safe(who.googleSubject))fail('access_denied');
  const grant=Object.hasOwn(v.grants,who.uid)?v.grants[who.uid]:null;if(!grant||grant.profile.active!==true)fail('access_denied');
  if(who.uid!==v.initialization.ownerUid){
    const rows=Object.values(v.enrollmentRegistry?.approvals||{}).filter(row=>row.claim&&(row.claim.uid===who.uid||row.claim.googleSubject===who.googleSubject));
    if(rows.length!==1||rows[0].status!=='claimed'||rows[0].claim.uid!==who.uid||rows[0].claim.googleSubject!==who.googleSubject)fail('access_denied');
  }
  return freeze(copy(grant));
});}
function identity(value,projectId,now){
  const v=copy(value);exact(v,['projectId','uid','email','googleSubject','authTimeMs','issuedAtMs','expiresAtMs','verifiedAt']);
  if(v.projectId!==projectId||!safe(v.googleSubject)||!Email.isEnrollmentEmail(v.email))fail('access_denied');storageId(v.uid);instant(v.verifiedAt);
  for(const k of ['authTimeMs','issuedAtMs','expiresAtMs'])integer(v[k],0);const n=Date.parse(now),verified=Date.parse(v.verifiedAt);
  if(v.authTimeMs>v.issuedAtMs||v.issuedAtMs>=v.expiresAtMs||v.authTimeMs>n||v.issuedAtMs>n||n>=v.expiresAtMs||verified>n||verified<v.issuedAtMs||n-v.authTimeMs>FRESH_MS||n-v.issuedAtMs>FRESH_MS)fail('access_denied');return v;
}
function lookup(v,who){
  if(!Object.hasOwn(v,'enrollmentRegistry'))fail('not_ready');const entries=Object.entries(v.enrollmentRegistry.approvals);
  const retained=entries.filter(([,row])=>row.claim&&(row.claim.uid===who.uid||row.claim.googleSubject===who.googleSubject));
  if(retained.length){if(retained.length!==1||retained[0][1].claim.uid!==who.uid||retained[0][1].claim.googleSubject!==who.googleSubject)fail('access_denied');return {approvalId:retained[0][0],row:retained[0][1]};}
  const matched=entries.find(([,row])=>row.email===who.email);if(!matched)fail('access_denied');return {approvalId:matched[0],row:matched[1]};
}
function lookupIdentityEnrollment(tenant,who){return protect(()=>{
  const source=copy(tenant),v=validate(source,{projectId:source.projectId,tenantId:source.tenantId}),input=copy(who);
  exact(input,['projectId','uid','email','googleSubject','authTimeMs','issuedAtMs','expiresAtMs','verifiedAt']);
  if(input.projectId!==v.projectId||!safe(input.uid)||!safe(input.googleSubject)||!Email.isEnrollmentEmail(input.email))fail('access_denied');
  return freeze(copy(lookup(v,input)));
});}
function claimIdentityEnrollment(tenant,verifiedIdentity,now){return protect(()=>{
  // Read no properties through caller accessors before copying.
  const input=copy(tenant),v=validate(input,{projectId:input.projectId,tenantId:input.tenantId});instant(now);
  const who=identity(verifiedIdentity,v.projectId,now),found=lookup(v,who),row=found.row;
  if(who.uid===v.initialization.ownerUid||row.status==='revoked')fail('access_denied');
  const replayed=row.status==='claimed';
  if(replayed){if(row.claim.uid!==who.uid||row.claim.googleSubject!==who.googleSubject||now<row.claim.claimedAt)fail('access_denied');}
  else if(now<row.approvedAt||now>=row.expiresAt||Object.hasOwn(v.grants,who.uid))fail('access_denied');
  const started=Math.floor(Date.parse(now)/Registry.ADMISSION_WINDOW_MS)*Registry.ADMISSION_WINDOW_MS,admission=row.admission;
  if(admission&&started<admission.windowStartedAt)fail('access_denied');const count=admission&&started===admission.windowStartedAt?admission.count:0;
  if(count>=Registry.ADMISSION_LIMIT)fail('rate_limited');
  const next=copy(v),selected=next.enrollmentRegistry.approvals[found.approvalId];selected.revision=increment(row.revision);selected.admission={windowStartedAt:started,count:count+1};
  if(!replayed){selected.status='claimed';selected.claim={uid:who.uid,googleSubject:who.googleSubject,claimedAt:now,grantRevision:1};put(next.grants,who.uid,{revision:1,profile:copy(row.profile)});}
  return freeze({next:validate(next,{projectId:v.projectId,tenantId:v.tenantId}),approvalId:found.approvalId,replayed,grantRevision:1});
});}
function revokeIdentityEnrollment(tenant,command,now){return protect(()=>{
  const input=copy(tenant),v=validate(input,{projectId:input.projectId,tenantId:input.tenantId}),cmd=copy(command);instant(now);
  exact(cmd,['requestId','approvalId','expectedApprovalRevision'],['expectedGrantRevision']);storageId(cmd.requestId);storageId(cmd.approvalId);integer(cmd.expectedApprovalRevision);
  if(Object.hasOwn(cmd,'expectedGrantRevision'))integer(cmd.expectedGrantRevision);
  const approvals=Object.hasOwn(v,'enrollmentRegistry')?v.enrollmentRegistry.approvals:null,row=approvals&&Object.hasOwn(approvals,cmd.approvalId)?approvals[cmd.approvalId]:null;if(!row)fail('access_denied');
  if(Object.entries(approvals).some(([id,r])=>id!==cmd.approvalId&&r.revocation?.requestId===cmd.requestId))fail('conflict');
  const hasClaim=Object.hasOwn(row,'claim');if(hasClaim!==Object.hasOwn(cmd,'expectedGrantRevision'))fail('invalid_request');
  if(row.status==='revoked'){
    const receipt=row.revocation;if(receipt.requestId!==cmd.requestId||receipt.approvalRevision!==cmd.expectedApprovalRevision||hasClaim&&receipt.grantRevision!==cmd.expectedGrantRevision||now<receipt.revokedAt)fail('conflict');
    return freeze({next:v,approvalId:cmd.approvalId,replayed:true,approvalRevision:row.revision,...(hasClaim?{grantRevision:v.grants[row.claim.uid].revision}:{})});
  }
  if(row.revision!==cmd.expectedApprovalRevision||hasClaim&&v.grants[row.claim.uid].revision!==cmd.expectedGrantRevision)fail('conflict');
  if(now<row.approvedAt||hasClaim&&now<row.claim.claimedAt)fail('access_denied');
  const next=copy(v),selected=next.enrollmentRegistry.approvals[cmd.approvalId];selected.status='revoked';selected.revision=increment(row.revision);
  selected.revocation={requestId:cmd.requestId,revokedAt:now,approvalRevision:row.revision};
  if(hasClaim){const grant=next.grants[row.claim.uid];selected.revocation.grantRevision=grant.revision;grant.profile.active=false;grant.revision=increment(grant.revision);}
  return freeze({next:validate(next,{projectId:v.projectId,tenantId:v.tenantId}),approvalId:cmd.approvalId,replayed:false,approvalRevision:selected.revision,...(hasClaim?{grantRevision:next.grants[row.claim.uid].revision}:{})});
});}
module.exports=Object.freeze({IdentityStateError,MAX_BYTES,validateIdentityTenant,readIdentityGrant,lookupIdentityEnrollment,claimIdentityEnrollment,revokeIdentityEnrollment});
