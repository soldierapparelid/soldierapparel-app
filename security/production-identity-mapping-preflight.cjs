'use strict';
// Offline identity review only. No SDK, network, filesystem, command-line,
// grant write, history adoption, or live Auth verification belongs here.
const MAX_BYTES=65536,MAX_NODES=8192,MAX_DEPTH=12,MAX_ROWS=512;
const forbidden=new Set(['__proto__','constructor','prototype']);
// Same explicit module/identity/profile vocabulary as the canonical admin.
// Its service validators are internal and must not be loaded to review a file.
const modules=new Set(['potong','jahit','qc','laporan','stok','gaji','hpp','pembelian','nota','retur']);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const safeId=v=>typeof v==='string'&&v.length>0&&v.length<=128&&!forbidden.has(v)&&/^[A-Za-z0-9_-]+$/.test(v);
const project=v=>typeof v==='string'&&/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(v);
const instant=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString()===v;
const division=v=>v==='jahit'||v==='potong';
function exact(v,required,optional=[]){return object(v)&&required.every(k=>Object.hasOwn(v,k))&&Reflect.ownKeys(v).every(k=>typeof k==='string'&&(required.includes(k)||optional.includes(k)));}
function databaseURL(v){
  if(typeof v!=='string')return false;
  let u;try{u=new URL(v);}catch{return false;}
  return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&u.pathname==='/'&&v===u.origin&&/^([a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app)$/.test(u.hostname);
}
function regularJson(v,depth=0,seen=new Set(),budget={nodes:0,bytes:0}){
  if(++budget.nodes>MAX_NODES||depth>MAX_DEPTH)throw Error('invalid_manifest');
  const addBytes=n=>{budget.bytes+=n;if(budget.bytes>MAX_BYTES)throw Error('capacity_limit');};
  if(v===null){addBytes(4);return;}
  if(typeof v==='boolean'){addBytes(v?4:5);return;}
  if(typeof v==='string'){
    // Only serialize primitive strings, never a caller object. Primitive
    // strings/keys cannot execute inherited Object/Array toJSON hooks.
    if(v.length>MAX_BYTES)throw Error('capacity_limit');
    addBytes(Buffer.byteLength(JSON.stringify(v),'utf8'));return;
  }
  if(typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=Number.MAX_SAFE_INTEGER){addBytes(Buffer.byteLength(JSON.stringify(v),'utf8'));return;}
  if(!v||typeof v!=='object'||seen.has(v)||(Array.isArray(v)?Object.getPrototypeOf(v)!==Array.prototype:!object(v)))throw Error('invalid_manifest');
  // A regular JSON tree cannot express shared object aliases. Keep every
  // visited object in this set, rejecting both aliases and cycles.
  seen.add(v);const keys=Reflect.ownKeys(v),array=Array.isArray(v);let children=0;addBytes(2);
  for(const key of keys){
    if(typeof key!=='string'||forbidden.has(key))throw Error('invalid_manifest');
    if(array&&key==='length')continue;
    const d=Object.getOwnPropertyDescriptor(v,key);
    if(!d||!d.enumerable||!Object.hasOwn(d,'value')||array&&(!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=v.length))throw Error('invalid_manifest');
    if(children++)addBytes(1);
    if(!array){if(key.length>MAX_BYTES)throw Error('capacity_limit');addBytes(Buffer.byteLength(JSON.stringify(key),'utf8')+1);}
    regularJson(d.value,depth+1,seen,budget);
  }
  if(array&&keys.length!==v.length+1)throw Error('invalid_manifest');
}
function counts(){return {legacyWorkers:0,canonicalWorkers:0,workerMappings:0,authObservations:0,proposedProfiles:0,activeOwners:0,activePartners:0,pendingCuttingWorkers:0};}
function result(status,totals,issues){return Object.freeze({status,readyForProduction:false,liveAuthProven:false,authorizationGranted:false,counts:Object.freeze({...totals}),issues:Object.freeze({...issues})});}
const disabled=result('disabled',counts(),{});
const badConfiguration=result('blocked',counts(),{invalid_configuration:1});
function profile(v){
  if(!exact(v,['active','owner'],['workerId','modules'])||typeof v.active!=='boolean'||typeof v.owner!=='boolean'||Object.hasOwn(v,'workerId')&&!safeId(v.workerId))return false;
  if(Object.hasOwn(v,'modules')&&(!object(v.modules)||!Object.keys(v.modules).length||Object.keys(v.modules).some(k=>!modules.has(k)||typeof v.modules[k]!=='boolean')))return false;
  return true;
}
function createIdentityMappingPreflight(options){
  // OFF inspects only the own-data switch, never input, scope or option getters.
  let enabled;try{enabled=object(options)&&Object.getOwnPropertyDescriptor(options,'enabled');}catch{}
  if(!enabled||!Object.hasOwn(enabled,'value')||enabled.value!==true)return Object.freeze({inspect:()=>disabled});
  let binding;
  try{
    regularJson(options);if(!exact(options,['enabled','projectId','databaseURL','tenantId'])||!project(options.projectId)||!databaseURL(options.databaseURL)||!safeId(options.tenantId))throw Error();
    binding=Object.freeze({projectId:options.projectId,databaseURL:options.databaseURL,tenantId:options.tenantId});
  }catch{return Object.freeze({inspect:()=>badConfiguration});}
  function inspect(manifest){
    const totals=counts(),issues={};
    const issue=code=>{issues[code]=(issues[code]||0)+1;};
    try{
      regularJson(manifest);
      if(!exact(manifest,['schemaVersion','scope','source','review','legacyWorkers','canonicalWorkers','workerMappings','authObservations','proposedProfiles','pendingWorkers'])||manifest.schemaVersion!==1)return result('blocked',totals,{invalid_manifest:1});
      if(!exact(manifest.scope,['projectId','databaseURL','tenantId'])||Object.keys(binding).some(k=>manifest.scope[k]!==binding[k]))issue('scope_mismatch');
      const sourceValid=exact(manifest.source,['snapshotSha256','exportedAt','sourceSchemaVersion'])&&typeof manifest.source.snapshotSha256==='string'&&/^[a-f0-9]{64}$/.test(manifest.source.snapshotSha256)&&instant(manifest.source.exportedAt)&&safeId(manifest.source.sourceSchemaVersion);
      if(!sourceValid)issue('invalid_source_evidence');
      const reviewValid=exact(manifest.review,['reviewedAt'])&&instant(manifest.review.reviewedAt);
      if(!reviewValid)issue('invalid_review_timestamp');
      if(sourceValid&&reviewValid&&manifest.source.exportedAt>manifest.review.reviewedAt)issue('source_after_review');
      const fields=['legacyWorkers','canonicalWorkers','workerMappings','authObservations','proposedProfiles','pendingWorkers'];
      if(fields.some(k=>!Array.isArray(manifest[k])||manifest[k].length>MAX_ROWS))return result('blocked',totals,{invalid_collection:1});
      for(const k of fields)if(k!=='pendingWorkers')totals[k]=manifest[k].length;
      const legacy=new Map(),canonical=new Map();
      function catalog(rows,map,duplicate){for(const row of rows){
        if(!exact(row,['workerId','division'])||!safeId(row.workerId)||!division(row.division)){issue('invalid_worker_catalog');continue;}
        if(map.has(row.workerId)){issue(duplicate);continue;}map.set(row.workerId,row.division);
      }}
      catalog(manifest.legacyWorkers,legacy,'duplicate_legacy_worker');catalog(manifest.canonicalWorkers,canonical,'duplicate_canonical_worker');
      if(!legacy.size)issue('missing_legacy_catalog');
      const mappings=new Map(),targets=new Set();
      for(const row of manifest.workerMappings){
        if(!exact(row,['legacyWorkerId','canonicalWorkerId'])||!safeId(row.legacyWorkerId)||!safeId(row.canonicalWorkerId)){issue('invalid_worker_mapping');continue;}
        if(mappings.has(row.legacyWorkerId)||targets.has(row.canonicalWorkerId)){issue('ambiguous_worker_mapping');continue;}
        mappings.set(row.legacyWorkerId,row.canonicalWorkerId);targets.add(row.canonicalWorkerId);
        if(!legacy.has(row.legacyWorkerId))issue('unknown_legacy_worker');
        if(!canonical.has(row.canonicalWorkerId))issue('unknown_canonical_worker');
        if(legacy.has(row.legacyWorkerId)&&canonical.has(row.canonicalWorkerId)&&legacy.get(row.legacyWorkerId)!==canonical.get(row.canonicalWorkerId))issue('division_mismatch');
      }
      const pending=new Set();
      for(const row of manifest.pendingWorkers){
        if(!exact(row,['legacyWorkerId','division'])||!safeId(row.legacyWorkerId)||row.division!=='potong'||legacy.get(row.legacyWorkerId)!=='potong'){issue('invalid_pending_worker');continue;}
        if(pending.has(row.legacyWorkerId)){issue('duplicate_pending_worker');continue;}pending.add(row.legacyWorkerId);
        if(mappings.has(row.legacyWorkerId))issue('pending_worker_mapping_conflict');
      }
      totals.pendingCuttingWorkers=pending.size;
      for(const id of legacy.keys())if(!mappings.has(id)&&!pending.has(id))issue('missing_worker_mapping');
      for(const id of canonical.keys())if(!targets.has(id))issue('unmapped_canonical_worker');
      const observations=new Map();
      for(const row of manifest.authObservations){
        if(!exact(row,['uid','projectId','provider','emailVerified','observedAt'])||!safeId(row.uid)||!project(row.projectId)||row.provider!=='google.com'||row.emailVerified!==true||!instant(row.observedAt)){issue('invalid_auth_observation');continue;}
        if(observations.has(row.uid)){issue('duplicate_observed_uid');continue;}observations.set(row.uid,row);
        if(row.projectId!==binding.projectId)issue('observation_scope_mismatch');
        if(reviewValid&&row.observedAt>manifest.review.reviewedAt)issue('observation_after_review');
      }
      const profiles=new Set(),boundWorkers=new Set();
      for(const row of manifest.proposedProfiles){
        if(!exact(row,['uid','reviewed','profile'])||!safeId(row.uid)||row.reviewed!==true||!profile(row.profile)){issue('invalid_proposed_profile');continue;}
        if(profiles.has(row.uid)){issue('duplicate_profile_uid');continue;}profiles.add(row.uid);
        if(!observations.has(row.uid))issue('missing_auth_observation');
        const p=row.profile;
        const observation=observations.get(row.uid);
        if(p.active&&p.owner&&observation&&observation.projectId===binding.projectId&&reviewValid&&observation.observedAt<=manifest.review.reviewedAt)totals.activeOwners++;
        if(Object.hasOwn(p,'workerId')){
          if(!canonical.has(p.workerId)||!targets.has(p.workerId))issue('profile_worker_missing');
          if(boundWorkers.has(p.workerId))issue('ambiguous_profile_binding');boundWorkers.add(p.workerId);
        }
        const jahit=Object.hasOwn(p,'modules')&&Object.hasOwn(p.modules,'jahit')&&p.modules.jahit===true;
        const potong=Object.hasOwn(p,'modules')&&Object.hasOwn(p.modules,'potong')&&p.modules.potong===true;
        if(p.active&&!p.owner&&(jahit||potong)){
          totals.activePartners++;
          if(!Object.hasOwn(p,'workerId'))issue('missing_partner_binding');
          else if((jahit&&canonical.get(p.workerId)!=='jahit')||(potong&&canonical.get(p.workerId)!=='potong'))issue('division_mismatch');
        }
      }
      for(const uid of observations.keys())if(!profiles.has(uid))issue('unbound_auth_observation');
      for(const id of canonical.keys())if(!boundWorkers.has(id))issue('unbound_canonical_worker');
      if(!totals.activeOwners)issue('missing_owner');
      const blocked=Object.keys(issues).length>0;
      if(pending.size)issues.pending_cutting_identity=pending.size;
      return result(blocked?'blocked':pending.size?'pending':'reviewed_mapping',totals,issues);
    }catch{return result('blocked',counts(),{invalid_manifest:1});}
  }
  return Object.freeze({inspect});
}
module.exports=Object.freeze({createIdentityMappingPreflight,limits:Object.freeze({maxBytes:MAX_BYTES,maxNodes:MAX_NODES,maxDepth:MAX_DEPTH,maxRows:MAX_ROWS})});
