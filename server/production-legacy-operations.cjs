'use strict';
// Pure, source-OFF compatible lane. A trusted SDK adapter must execute append
// against the full RTDB root in one CAS; this module does not verify a token.
const Crypto=require('node:crypto');
const State=require('./production-identity-state.cjs');
const Email=require('./production-enrollment-identity.cjs');
const Workflow=require('../production-workflow.js');
const Payroll=require('../production-payroll.js');
const MAX_ROOT_BYTES=8*1024*1024,MAX_NODES=150000,MAX_PRODUCTS=2000,MAX_ROWS=40000,MAX_RECEIPTS=10000;
const MAX_MARKER_BYTES=256*1024;
const POLICY='legacy-jahit-current-v1',LEDGER='legacyOperationReceipts';
const RESERVED=new Set(['__proto__','constructor','prototype']);
const CODES=new Set(['service_disabled','unavailable','invalid_request','access_denied','not_ready','conflict','capacity_limit','result_unknown']);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const safe=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!RESERVED.has(v);
class LegacyOperationsError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new LegacyOperationsError(code);};
function field(v,k,code='not_ready'){const d=v&&typeof v==='object'?Object.getOwnPropertyDescriptor(v,k):null;if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail(code);return d.value;}
function exact(v,keys,code='not_ready'){if(!plain(v)||Reflect.ownKeys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail(code);for(const k of keys)field(v,k,code);}
function optional(v,k,fallback){return Object.hasOwn(v,k)?field(v,k):fallback;}
function text(v){if(typeof v!=='string'||v.length>256||/[\u0000-\u001f\u007f-\u009f]/.test(v))fail('not_ready');return v;}
function id(v,code='not_ready'){if(!safe(v))fail(code);return v;}
function newStorageId(v,code='not_ready'){id(v,code);if(/^\d+$/.test(v))fail(code);return v;}
function storedId(v){if(typeof v==='number'&&Number.isSafeInteger(v)&&v>=0)v=String(v);return id(v);}
function integer(v,min=0,code='not_ready'){if(!Number.isSafeInteger(v)||v<min)fail(code);return v;}
function instant(v,code='not_ready'){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v).toISOString()!==v||Date.parse(v)<0)fail(code);return v;}
function workDate(v,code='invalid_request'){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||v.startsWith('0000'))fail(code);const d=new Date(v+'T00:00:00.000Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==v)fail(code);return v;}
function serializeLegacyRoot(value){
  let bytes=0,nodes=0;const seen=new Set();
  function count(t){bytes+=Buffer.byteLength(t,'utf8');if(bytes>MAX_ROOT_BYTES)fail('capacity_limit');return t;}
  function visit(v,depth){
    if(++nodes>MAX_NODES||depth>32)fail('capacity_limit');
    if(v===null||typeof v==='string'||typeof v==='boolean')return count(JSON.stringify(v));
    if(typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=Number.MAX_SAFE_INTEGER&&!Object.is(v,-0))return count(JSON.stringify(v));
    if(!v||typeof v!=='object'||seen.has(v))fail('not_ready');const array=Array.isArray(v);
    if(array?Object.getPrototypeOf(v)!==Array.prototype:!plain(v))fail('not_ready');
    const names=Reflect.ownKeys(v);if(names.length>MAX_NODES)fail('capacity_limit');
    let keys=names;
    if(array){const d=Object.getOwnPropertyDescriptor(v,'length');if(!d||!Object.hasOwn(d,'value')||d.value>MAX_NODES||names.length!==d.value+1||names.some(k=>typeof k!=='string'||k!=='length'&&(!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=d.value)))fail('not_ready');keys=Array.from({length:d.value},(_,i)=>String(i));}
    else if(names.some(k=>typeof k!=='string'||RESERVED.has(k)||k==='.priority'||k==='.value'))fail('not_ready');
    seen.add(v);const parts=[];count(array?'[':'{');
    for(let i=0;i<keys.length;i++){const k=keys[i],d=Object.getOwnPropertyDescriptor(v,k);if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail('not_ready');if(i)count(',');const prefix=array?'':count(JSON.stringify(k))+count(':');parts.push(prefix+visit(d.value,depth+1));}
    count(array?']':'}');seen.delete(v);return (array?'[':'{')+parts.join(',')+(array?']':'}');
  }
  if(!plain(value))fail('not_ready');return visit(value,0);
}
function copyLegacyRoot(value){return JSON.parse(serializeLegacyRoot(value));}
function stable(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(stable).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';}
const digest=v=>Crypto.createHash('sha256').update(stable(v)).digest('hex');
function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
function rows(v){if(v==null)return [];if(!Array.isArray(v)&&!plain(v))fail('not_ready');const values=Array.isArray(v)?v:Object.values(v);if(values.length>MAX_ROWS)fail('capacity_limit');return values.filter(x=>x!==null).map(x=>{if(!plain(x))fail('not_ready');return x;});}
function markerValue(v){
  if(typeof v!=='string')return v;if(Buffer.byteLength(v,'utf8')>MAX_MARKER_BYTES)fail('capacity_limit');let parsed;try{parsed=JSON.parse(v);}catch{fail('not_ready');}
  // Reject duplicate/escaped-alias keys before JSON's last value could hide a
  // deletion. Strings remain verbatim in the candidate root.
  const stack=[];for(let i=0;i<v.length;i++){
    const ch=v[i];if(ch==='"'){let end=i+1;for(;end<v.length;end++){if(v[end]==='\\'){end++;continue;}if(v[end]==='"')break;}
      const top=stack[stack.length-1];if(top?.type==='object'&&top.key){const k=JSON.parse(v.slice(i,end+1));if(top.keys.has(k)||RESERVED.has(k))fail('not_ready');top.keys.add(k);top.key=false;}i=end;
    }else if(ch==='{'||ch==='['){stack.push(ch==='{'?{type:'object',keys:new Set(),key:true}:{type:'array'});if(stack.length>8)fail('not_ready');}
    else if(ch==='}'||ch===']')stack.pop();else if(ch===','&&stack[stack.length-1]?.type==='object')stack[stack.length-1].key=true;
  }return copyLegacyRoot({marker:parsed}).marker;
}
function deletionMarkers(soldier){
  const products=new Set(),operations=new Set(),pairs=new Set();const deleted=markerValue(optional(soldier,'produksi_deleted_ids',null));
  if(deleted!=null){if(!Array.isArray(deleted)&&!plain(deleted))fail('not_ready');if(Buffer.byteLength(stable(deleted),'utf8')>MAX_MARKER_BYTES||Object.keys(deleted).length>MAX_ROWS)fail('capacity_limit');for(const value of Object.values(deleted))if(value!==null)products.add(storedId(value));}
  const log=markerValue(optional(soldier,'produksi_deletions',null));
  if(log!=null){if(!plain(log))fail('not_ready');if(Buffer.byteLength(stable(log),'utf8')>MAX_MARKER_BYTES||Object.keys(log).length>MAX_ROWS)fail('capacity_limit');
    for(const [key,value]of Object.entries(log)){
      if(key.length>2048||typeof value!=='number'||!Number.isSafeInteger(value)||value<0)fail('not_ready');
      const match=/^([A-Za-z0-9_-]{1,128})\|jahit\|id:([A-Za-z0-9_-]{1,128})$/.exec(key);if(!match)continue;
      id(match[1]);id(match[2]);operations.add(match[2]);pairs.add(match[1]+'|'+match[2]);
    }
  }return {products,operations,pairs};
}
function unique(rowsValue,selectedId){const matches=rowsValue.filter(v=>Object.hasOwn(v,'id')&&storedId(v.id)===selectedId);if(matches.length!==1)fail('not_ready');return matches[0];}
function marked(v){return v===true||v===1||v==='true';}
function ignored(p){if(p.status!=null)text(p.status);return marked(p.deleted)||marked(p.isDeleted)||!!p.deletedAt||marked(p.cancelled)||marked(p.canceled)||!!p.cancelledAt||!!p.canceledAt||/^(deleted|cancelled|canceled|dihapus|dibatalkan|batal)$/i.test(p.status||'');}
function active(p){return p.poAktif===true&&!ignored(p)&&p.arsip!==true;}
function errorCode(e){try{if(e instanceof LegacyOperationsError&&CODES.has(e.code))return e.code;if(e instanceof State.IdentityStateError&&CODES.has(e.code))return e.code;}catch{}return 'unavailable';}
function createProductionLegacyOperations(options){
  let enabled=false;try{const d=plain(options)&&Object.getOwnPropertyDescriptor(options,'enabled');enabled=!!d&&Object.hasOwn(d,'value')&&d.value===true;}catch{}
  const disabled=()=>Object.freeze({ok:false,error:'service_disabled'});
  if(!enabled)return Object.freeze({read:disabled,append:disabled,resolve:disabled,capture:disabled});
  let binding,clock,policy,highWater=-1;
  try{
    exact(options,['enabled','binding','clock','tariffPolicy'],'unavailable');
    binding=copyLegacyRoot(field(options,'binding','unavailable'));exact(binding,['projectId','databaseURL','tenantId'],'unavailable');
    if(typeof binding.projectId!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(binding.projectId))fail('unavailable');id(binding.tenantId,'unavailable');if(/^\d+$/.test(binding.tenantId))fail('unavailable');
    const u=new URL(binding.databaseURL);if(u.protocol!=='https:'||u.origin!==binding.databaseURL||u.port||u.username||u.password||u.search||u.hash||!/^([a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app)$/.test(u.hostname))fail('unavailable');freeze(binding);
    policy=copyLegacyRoot(field(options,'tariffPolicy','unavailable'));exact(policy,['version','reviewed','timeZone','quantityBasis'],'unavailable');
    if(policy.version!==POLICY||policy.reviewed!==true||policy.timeZone!=='Asia/Jakarta'||policy.quantityBasis!=='good-plus-reject')fail('unavailable');freeze(policy);
    clock=field(options,'clock','unavailable');if(typeof clock!=='function')fail('unavailable');
  }catch{const unavailable=()=>Object.freeze({ok:false,error:'unavailable'});return Object.freeze({read:unavailable,append:unavailable,resolve:unavailable,capture:unavailable});}
  function now(){const value=instant(clock(),'unavailable'),ms=Date.parse(value);if(ms<highWater)fail('unavailable');highWater=ms;return value;}
  function context(root,identity,time){
    exact(identity,['projectId','uid','email','googleSubject','authTimeMs','issuedAtMs','expiresAtMs','verifiedAt'],'access_denied');
    if(identity.projectId!==binding.projectId||!Email.isEnrollmentEmail(identity.email))fail('access_denied');id(identity.uid,'access_denied');id(identity.googleSubject,'access_denied');
    for(const k of ['authTimeMs','issuedAtMs','expiresAtMs'])integer(identity[k],0,'access_denied');instant(identity.verifiedAt,'access_denied');
    const n=Date.parse(time);if(identity.authTimeMs>identity.issuedAtMs||identity.issuedAtMs>=identity.expiresAtMs||identity.authTimeMs>n||identity.issuedAtMs>n||identity.expiresAtMs<=n||Date.parse(identity.verifiedAt)>n||Date.parse(identity.verifiedAt)<identity.issuedAtMs)fail('access_denied');
    if(!plain(root.authorityTenants)||!Object.hasOwn(root.authorityTenants,binding.tenantId))fail('not_ready');
    const tenant=State.validateIdentityTenant(root.authorityTenants[binding.tenantId],{projectId:binding.projectId,tenantId:binding.tenantId});
    const grant=State.readIdentityGrant(tenant,{uid:identity.uid,googleSubject:identity.googleSubject}),p=grant.profile;
    if(p.owner!==false||!plain(p.modules)||Object.keys(p.modules).length!==1||p.modules.jahit!==true||!safe(p.workerId)||tenant.workerCatalog.workers[p.workerId]?.division!=='jahit')fail('access_denied');
    return {binding:{...binding,uid:identity.uid,workerId:p.workerId,division:'jahit',grantRevision:grant.revision},initialization:tenant.initialization,workerCatalog:tenant.workerCatalog,grant};
  }
  function source(root,c){
    if(!plain(root.soldier)||!plain(root.soldier.produksi)||!Object.hasOwn(root.soldier.produksi,'produksi')||!plain(root.soldier.produksi_meta))fail('not_ready');
    const products=rows(root.soldier.produksi.produksi),workers=rows(root.soldier.produksi_meta.tukangJahit);if(products.length>MAX_PRODUCTS||workers.length>128)fail('capacity_limit');
    const ids=new Set();for(const p of products){const key=storedId(p.id);if(ids.has(key))fail('not_ready');ids.add(key);}
    const worker=unique(workers,c.binding.workerId);if(worker.deleted||worker.active===false)fail('not_ready');text(worker.nama);return {products,workers,worker,markers:deletionMarkers(root.soldier)};
  }
  function assignmentRows(p){const list=rows(p.assignJahit),seen=new Set();for(const a of list){const aid=storedId(a.id);if(seen.has(aid))fail('not_ready');seen.add(aid);if(!safe(a.tukangId)||!Number.isSafeInteger(a.qty)||a.qty<=0)fail('not_ready');}return list;}
  function archiveAssignments(p){const found=[];if(p.arsip==null||p.arsip===false)return found;for(const archive of rows(p.arsip))for(const a of rows(archive.assignJahit))if(a.id!=null)found.push(storedId(a.id));return found;}
  function archives(p){return p.arsip==null||typeof p.arsip==='boolean'?[]:rows(p.arsip);}
  function strictSewing(p,assignments,markers){
    const sewing=rows(p.jahit).filter(j=>j.id==null||!markers?.pairs.has(storedId(p.id)+'|'+storedId(j.id))),seen=new Set();
    for(const j of sewing){
      if(j.id!=null){const jid=storedId(j.id);if(seen.has(jid))fail('not_ready');seen.add(jid);}
      // Names alone are never authority for an own projection or progress.
      if(!safe(j.tukangId))fail('not_ready');
      if(j.assignmentId!=null){const aid=storedId(j.assignmentId);const a=assignments.filter(x=>storedId(x.id)===aid);if(a.length!==1||a[0].tukangId!==j.tukangId)fail('not_ready');}
    }
    return sewing;
  }
  function viewProduct(p,c,workers,markers){
    const assignments=assignmentRows(p),own=assignments.filter(a=>a.tukangId===c.binding.workerId&&!ignored(a));if(!own.length)return null;
    if(p.poJumlah!=null&&(!Number.isSafeInteger(p.poJumlah)||p.poJumlah<0))fail('not_ready');if(p.poTanggal!=null)text(p.poTanggal);
    const sewing=strictSewing(p,assignments,markers),operational={...p,jahit:sewing},archived=archiveAssignments(p);
    if(own.some(a=>archived.includes(storedId(a.id))))fail('not_ready');
    const product={productId:storedId(p.id),series:text(p.series||''),namaBarang:text(p.namaBarang||''),size:text(p.size||''),assignments:[],reports:[],hasUnlistedLegacy:false};
    for(const a of own){const progress=Workflow.assignmentProgress(operational,a,workers);if(!progress.known||progress.rawSewn>progress.assigned)fail('not_ready');product.assignments.push({assignmentId:storedId(a.id),assigned:integer(progress.assigned,1),reportedGood:integer(progress.good),reportedReject:integer(progress.rejected),remaining:integer(progress.remaining)});}
    for(const j of sewing.filter(j=>j.tukangId===c.binding.workerId&&!ignored(j))){
      if(j.id==null||j.assignmentId==null){product.hasUnlistedLegacy=true;continue;}
      const completed=integer(j.jumlah),reject=integer(j.rijek==null?0:j.rijek),good=integer(j.lolos==null?completed-reject:j.lolos);if(good+reject!==completed)fail('not_ready');
      product.reports.push({operationId:storedId(j.id),assignmentId:storedId(j.assignmentId),workDate:workDate(j.tanggal,'not_ready'),good,reject,completed});
    }
    // This public version hashes only this DTO and non-financial PO controls;
    // it must not become a dictionary fingerprint of private wage amounts.
    product.sourceVersion=digest({product,poAktif:p.poAktif,poJumlah:p.poJumlah??null,poTanggal:p.poTanggal??null,archiveCount:archives(p).length});return product;
  }
  function view(root,c){const s=source(root,c),products=[];for(const p of s.products)if(active(p)&&!s.markers.products.has(storedId(p.id))){const item=viewProduct(p,c,s.workers,s.markers);if(item)products.push(item);}const result={schemaVersion:1,binding:c.binding,workerLabel:s.worker.nama,products};if(Buffer.byteLength(stable(result),'utf8')>1024*1024)fail('capacity_limit');return freeze(result);}
  function command(v){
    exact(v,['kind','requestId','operationId','productId','assignmentId','expectedGrantRevision','expectedSourceVersion','workDate','good','reject'],'invalid_request');
    if(v.kind!=='appendJahit')fail('invalid_request');for(const k of ['requestId','operationId'])newStorageId(v[k],'invalid_request');for(const k of ['productId','assignmentId'])id(v[k],'invalid_request');integer(v.expectedGrantRevision,1,'invalid_request');
    if(typeof v.expectedSourceVersion!=='string'||!/^[a-f0-9]{64}$/.test(v.expectedSourceVersion))fail('invalid_request');if(v.workDate!==null)workDate(v.workDate);integer(v.good,0,'invalid_request');integer(v.reject,0,'invalid_request');const total=v.good+v.reject;if(!Number.isSafeInteger(total)||total<=0)fail('invalid_request');return v;
  }
  function ledger(root){
    if(!Object.hasOwn(root,LEDGER))return null;if(!plain(root[LEDGER]))fail('not_ready');if(!Object.hasOwn(root[LEDGER],binding.tenantId))return null;const l=root[LEDGER][binding.tenantId];
    exact(l,['schemaVersion','projectId','tenantId','policyVersion','commands']);if(l.schemaVersion!==1||l.projectId!==binding.projectId||l.tenantId!==binding.tenantId||l.policyVersion!==POLICY||!plain(l.commands))fail('not_ready');
    if(Object.keys(l.commands).length>MAX_RECEIPTS)fail('capacity_limit');for(const [key,r]of Object.entries(l.commands)){
      newStorageId(key);exact(r,['uid','googleSubject','workerId','grantRevision','operationId','productId','assignmentId','payloadHash','identityGuard','poGuard','assignmentGuard','recordDigest','createdAt']);
      for(const k of ['uid','googleSubject','workerId','operationId','productId','assignmentId'])id(r[k]);newStorageId(r.operationId);integer(r.grantRevision,1);instant(r.createdAt);if(Date.parse(r.createdAt)>highWater)fail('not_ready');for(const k of ['payloadHash','identityGuard','poGuard','assignmentGuard','recordDigest'])if(typeof r[k]!=='string'||!/^[a-f0-9]{64}$/.test(r[k]))fail('not_ready');
    }return l;
  }
  function selected(root,c,cmd){const s=source(root,c),p=unique(s.products,cmd.productId);if(!active(p)||s.markers.products.has(cmd.productId)||s.markers.operations.has(cmd.operationId))fail('conflict');const assignments=assignmentRows(p),a=unique(assignments,cmd.assignmentId);if(a.tukangId!==c.binding.workerId||ignored(a)||archiveAssignments(p).includes(cmd.assignmentId))fail('access_denied');strictSewing(p,assignments,s.markers);return {...s,p,a};}
  const poGuard=p=>digest({poAktif:p.poAktif,poJumlah:p.poJumlah??null,poTanggal:p.poTanggal??null,arsip:p.arsip??null});
  const assignmentGuard=a=>digest({id:a.id,tukangId:a.tukangId,qty:a.qty});
  const identityGuard=c=>digest({initialization:c.initialization,workerCatalog:c.workerCatalog});
  function receiptCheck(root,c,who,cmd,l,s){
    const r=l&&Object.hasOwn(l.commands,cmd.requestId)?l.commands[cmd.requestId]:null;if(!r)return null;
    if(r.uid!==c.binding.uid||r.googleSubject!==who.googleSubject||r.workerId!==c.binding.workerId||r.grantRevision!==c.binding.grantRevision||r.payloadHash!==digest(cmd)||r.identityGuard!==identityGuard(c)||r.createdAt<c.initialization.initializedAt||r.operationId!==cmd.operationId||r.productId!==cmd.productId||r.assignmentId!==cmd.assignmentId||r.poGuard!==poGuard(s.p)||r.assignmentGuard!==assignmentGuard(s.a))fail('conflict');
    const row=unique(rows(s.p.jahit),cmd.operationId);if(digest(row)!==r.recordDigest)fail('conflict');return {ok:true,replayed:true,operationId:r.operationId};
  }
  function prepare(raw,resolving){
    exact(raw,['root','identity','command'],'invalid_request');const root=copyLegacyRoot(raw.root),who=copyLegacyRoot(raw.identity),cmd=command(copyLegacyRoot(raw.command)),time=now(),c=context(root,who,time);
    if(cmd.expectedGrantRevision!==c.binding.grantRevision)fail('conflict');const s=selected(root,c,cmd),l=ledger(root),replayed=receiptCheck(root,c,who,cmd,l,s);
    if(replayed)return resolving?freeze({ok:true,receipt:replayed}):freeze({ok:true,next:root,receipt:replayed});if(resolving)fail('result_unknown');
    if(l&&Object.keys(l.commands).length>=MAX_RECEIPTS)fail('capacity_limit');if(l&&Object.values(l.commands).some(r=>r.operationId===cmd.operationId))fail('conflict');
    // Never reuse an existing operation identity in a current or archived PO.
    for(const product of s.products)for(const snapshot of [product,...archives(product)])if(rows(snapshot.jahit).some(j=>j.id!=null&&storedId(j.id)===cmd.operationId))fail('conflict');
    const current=viewProduct(s.p,c,s.workers,s.markers);if(!current||current.sourceVersion!==cmd.expectedSourceVersion)fail('conflict');const aView=current.assignments.find(a=>a.assignmentId===cmd.assignmentId);if(!aView||cmd.good+cmd.reject>aView.remaining)fail('conflict');
    if(!plain(s.worker.tarif))fail('not_ready');const rawKey=s.p.series+'|'+s.p.namaBarang,sanKey=rawKey.replace(/[.#$\/\[\]]/g,'_');
    // Existing appendJahit chooses current sanitized-key OR raw-key rate and
    // calls no date-based historical selection. Require a reviewed policy.
    const selectedRate=s.worker.tarif[sanKey]||s.worker.tarif[rawKey];if(!['number','string'].includes(typeof selectedRate)||typeof selectedRate==='string'&&(!selectedRate.trim()||!/^\s*\d+(?:\.\d+)?\s*$/.test(selectedRate)))fail('not_ready');
    const rate=Payroll.rateFor({tarif:{[sanKey]:selectedRate}},s.p.series,s.p.namaBarang);const total=cmd.good*rate;if(!Number.isFinite(rate)||rate<=0||rate>Number.MAX_SAFE_INTEGER||!Number.isFinite(total)||total>Number.MAX_SAFE_INTEGER)fail('not_ready');
    const day=new Date(Date.parse(time)+7*3600000).toISOString().slice(0,10),date=cmd.workDate===null?day:cmd.workDate;if(date>day)fail('invalid_request');
    const row={id:cmd.operationId,tanggal:date,jumlah:cmd.good+cmd.reject,rijek:cmd.reject,lolos:cmd.good,quantityBasis:'good-plus-reject',tukangId:c.binding.workerId,tukangNama:s.worker.nama,tarif:rate,total,dibayar:false,assignmentId:cmd.assignmentId,inputAt:time};
    // Preserve the existing collection shape and every untouched old row.
    if(s.p.jahit==null)s.p.jahit=[];
    if(Array.isArray(s.p.jahit))s.p.jahit.push(row);else if(plain(s.p.jahit)){if(Object.hasOwn(s.p.jahit,cmd.operationId))fail('conflict');s.p.jahit[cmd.operationId]=row;}else fail('not_ready');
    const after=Workflow.assignmentProgress({...s.p,jahit:strictSewing(s.p,assignmentRows(s.p),s.markers)},s.a,s.workers);if(!after.known||after.rawSewn>after.assigned)fail('conflict');s.a.sisa=after.remaining;s.a.editedAt=time;
    const entry={uid:c.binding.uid,googleSubject:who.googleSubject,workerId:c.binding.workerId,grantRevision:c.binding.grantRevision,operationId:cmd.operationId,productId:cmd.productId,assignmentId:cmd.assignmentId,payloadHash:digest(cmd),identityGuard:identityGuard(c),poGuard:poGuard(s.p),assignmentGuard:assignmentGuard(s.a),recordDigest:digest(row),createdAt:time};
    if(!root[LEDGER])root[LEDGER]={};if(!l)root[LEDGER][binding.tenantId]={schemaVersion:1,projectId:binding.projectId,tenantId:binding.tenantId,policyVersion:POLICY,commands:{}};
    root[LEDGER][binding.tenantId].commands[cmd.requestId]=entry;serializeLegacyRoot(root);return freeze({ok:true,next:root,receipt:{ok:true,replayed:false,operationId:cmd.operationId}});
  }
  function protect(fn){try{return fn();}catch(e){return Object.freeze({ok:false,error:errorCode(e)});}}
  function capture(raw){return protect(()=>{exact(raw,['root','identity'],'invalid_request');const root=copyLegacyRoot(raw.root),who=copyLegacyRoot(raw.identity);return freeze({ok:true,context:context(root,who,now())});});}
  function read(raw){return protect(()=>{exact(raw,['root','identity'],'invalid_request');const root=copyLegacyRoot(raw.root),who=copyLegacyRoot(raw.identity),c=context(root,who,now());return freeze({ok:true,view:view(root,c)});});}
  return Object.freeze({read,capture,append:raw=>protect(()=>prepare(raw,false)),resolve:raw=>protect(()=>prepare(raw,true))});
}
module.exports=Object.freeze({createProductionLegacyOperations,LegacyOperationsError,MAX_ROOT_BYTES,copyLegacyRoot,serializeLegacyRoot});
