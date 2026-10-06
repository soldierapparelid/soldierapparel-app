'use strict';
// Initial read view only: no SDK initialization, subscription, transaction,
// bootstrap, legacy adoption or durable permission. Commands and Rules must
// independently recheck canonical grants after this snapshot is returned.
//
// createProductionSessionService({enabled, projectId, databaseURL, tenantId,
//   database, auth, admit, clock, maxTenantBytes?, maxCycles?,
//   maxResponseBytes?, testOnlyEmulator?}).execute({idToken})
// returns {ok:true,session:{schemaVersion:1,projectId,databaseURL,tenantId,uid,
//   grantRevision,profile,cycles:[{productId,cycleId}],
//   workerLabels:[{productId,cycleId,workers:[{workerId,label}]}],
//   cycleLabels?:[{productId,cycleId,series,namaBarang,size}]}}
// or {ok:false,error}. Labels are display-only, never identity or assignments.
// Binding/limits/SDK/auth/admission are trusted server options, never a body.
// One canonical tenant Reference.get() supplies both profile and manifest.
const Authority=require('./production-authority.cjs');
const Ledger=require('./production-owner-ledger.cjs');
const TariffLedger=require('./production-tariff-ledger.cjs');
const EnrollmentRegistry=require('./production-enrollment-registry.cjs');
const IdentityState=require('./production-identity-state.cjs');
const MAX_BYTES=8*1024*1024,MAX_NODES=500000,PORT=9000,MAX_CYCLE_WORKERS=128,MAX_LABELS=1024;
const forbidden=new Set(['__proto__','constructor','prototype']);
const modules=new Set(['potong','jahit','qc','laporan','stok','gaji','hpp','pembelian','nota','retur']);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const safe=v=>typeof v==='string'&&v.length>0&&v.length<=128&&!forbidden.has(v)&&/^[A-Za-z0-9_-]+$/.test(v);
class SessionError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new SessionError(code);};
function json(v,error,depth=0,seen=new Set(),budget={nodes:0}){
  if(++budget.nodes>MAX_NODES||depth>64)fail('capacity_limit');
  if(v===null||typeof v==='string'||typeof v==='boolean')return;
  if(typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=Number.MAX_SAFE_INTEGER)return;
  if(!v||typeof v!=='object'||seen.has(v)||(Array.isArray(v)?Object.getPrototypeOf(v)!==Array.prototype:![Object.prototype,null].includes(Object.getPrototypeOf(v))))fail(error);
  seen.add(v);const keys=Reflect.ownKeys(v);
  for(const key of keys){
    if(typeof key!=='string'||forbidden.has(key))fail(error);
    if(Array.isArray(v)&&key==='length')continue;
    const d=Object.getOwnPropertyDescriptor(v,key);
    if(!d||!d.enumerable||!Object.hasOwn(d,'value')||Array.isArray(v)&&(!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=v.length))fail(error);
    json(d.value,error,depth+1,seen,budget);
  }
  if(Array.isArray(v)&&keys.length!==v.length+1)fail(error);seen.delete(v);
}
function exact(v,required,optional=[],error='not_ready'){if(!object(v)||required.some(k=>!Object.hasOwn(v,k))||Object.keys(v).some(k=>!required.includes(k)&&!optional.includes(k)))fail(error);}
function integer(v,min=0,max=Number.MAX_SAFE_INTEGER,error='not_ready'){if(!Number.isSafeInteger(v)||v<min||v>max)fail(error);}
function id(v,error='not_ready'){if(!safe(v))fail(error);return v;}
function label(v){if(typeof v!=='string'||v.length>256||!v.trim()||/[\u0000-\u001f\u007f-\u009f]/.test(v))fail('not_ready');return v.trim();}
function productLabel(v){if(typeof v!=='string'||v.length>256||/[\u0000-\u001f\u007f-\u009f]/.test(v))fail('not_ready');return v;}
function instant(v,error='not_ready'){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v).toISOString()!==v)fail(error);return v;}
const copy=EnrollmentRegistry.copyEnrollmentData;
function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
function size(v,max){if(Buffer.byteLength(EnrollmentRegistry.serializeEnrollmentData(v),'utf8')>max)fail('capacity_limit');}
function map(v){if(!object(v))fail('not_ready');for(const key of Object.keys(v))id(key);}
function profile(p){
  exact(p,['active','owner'],['workerId','modules']);if(typeof p.active!=='boolean'||typeof p.owner!=='boolean')fail('not_ready');
  if(p.workerId!==undefined)id(p.workerId);
  if(p.modules!==undefined&&(!object(p.modules)||Object.keys(p.modules).some(k=>!modules.has(k)||typeof p.modules[k]!=='boolean')))fail('not_ready');
}
function config(c){exact(c,['revision','active','reviewedEmptyCycle','tariffPolicy']);integer(c.revision);if(typeof c.active!=='boolean'||typeof c.reviewedEmptyCycle!=='boolean'||c.tariffPolicy!=='explicit-historical-jakarta-v1')fail('not_ready');}
function tariffInputs(v){
  exact(v,['revision','policy','historyByWorker']);integer(v.revision);
  exact(v.policy,['version','kind','hour','minute']);id(v.policy.version);if(v.policy.kind!=='jakarta-fixed-local-time')fail('not_ready');integer(v.policy.hour,0,23);integer(v.policy.minute,0,59);
  map(v.historyByWorker);
  for(const history of Object.values(v.historyByWorker)){
    map(history);const instants=new Set();
    for(const rate of Object.values(history)){
      exact(rate,['effectiveAt','currency','rate']);instant(rate.effectiveAt);integer(rate.rate,1);
      if(rate.currency!=='IDR'||instants.has(rate.effectiveAt))fail('not_ready');instants.add(rate.effectiveAt);
    }
  }
}
function databaseURL(value){
  if(typeof value!=='string')fail('access_denied');let u;try{u=new URL(value);}catch{fail('access_denied');}
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||u.pathname!=='/'||!/^([a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app)$/.test(u.hostname))fail('access_denied');return u.origin;
}
function identity(token,projectId,now){
  json(token,'access_denied');
  if(!object(token)||!safe(token.uid)||token.sub!==token.uid||token.aud!==projectId||token.iss!=='https://securetoken.google.com/'+projectId||token.email_verified!==true||!object(token.firebase)||token.firebase.sign_in_provider!=='google.com'||!Number.isSafeInteger(token.exp)||token.exp*1000<=Date.parse(now))fail('access_denied');return token.uid;
}
function manifest(v,binding,uid,maxBytes,maxCycles,buildCatalog=true,googleSubject=null){
  json(v,'not_ready');size(v,maxBytes);
  if(!object(v))fail('not_ready');
  if(Object.getOwnPropertyDescriptor(v,'schemaVersion')?.value===2){
    // This view conveys only access identity. It must never manufacture an
    // empty production schema, expose the registry/catalog or imply wages.
    if(!buildCatalog)fail('not_ready');let value;
    try{value=IdentityState.validateIdentityTenant(v,{projectId:binding.projectId,tenantId:binding.tenantId});}catch{fail('not_ready');}
    let current;try{current=IdentityState.readIdentityGrant(value,{uid,googleSubject});}catch{fail('access_denied');}
    const p=current.profile,allowedProfile={active:true,owner:p.owner};
    if(Object.hasOwn(p,'workerId'))allowedProfile.workerId=p.workerId;
    if(Object.hasOwn(p,'modules'))allowedProfile.modules=copy(p.modules);
    return {schemaVersion:1,projectId:binding.projectId,databaseURL:binding.databaseURL,tenantId:binding.tenantId,uid,grantRevision:current.revision,profile:allowedProfile,cycles:[],workerLabels:[]};
  }
  // Same exact canonical schema as the reviewed adapter. Its Authority codec
  // validates private JSON and public projection parity after RTDB pruning.
  exact(v,['schemaVersion','projectId','tenantId','grants','products'],['ownerCommandLedger','tariffCommandLedger','enrollmentRegistry']);
  if(v.schemaVersion!==1)fail('not_ready');if(v.projectId!==binding.projectId||v.tenantId!==binding.tenantId)fail('access_denied');map(v.grants);map(v.products);
  for(const g of Object.values(v.grants)){exact(g,['revision','profile']);integer(g.revision);profile(g.profile);}
  if(!Object.hasOwn(v.grants,uid)||v.grants[uid].profile.active!==true)fail('access_denied');
  const current=v.grants[uid],p=current.profile,permissions=p.modules||{};
  const all=p.owner===true||permissions.qc===true||permissions.laporan===true||permissions.stok===true;
  const partner=permissions.jahit===true||permissions.potong===true;
  if(!p.owner&&partner&&!safe(p.workerId))fail('not_ready');
  const cycles=[],workerLabels=[],cycleLabels=[];let labelCount=0;
  for(const productId of Object.keys(v.products).sort()){
    const product=v.products[productId];exact(product,['cycles']);map(product.cycles);
    for(const cycleId of Object.keys(product.cycles).sort()){
      const c=product.cycles[cycleId];exact(c,['config','tariffInputs','wire']);config(c.config);tariffInputs(c.tariffInputs);
      const state=Authority.decodeStorage(c.wire);
      if(state.productId!==productId||state.cycleId!==cycleId)fail('access_denied');
      const own=partner&&safe(p.workerId)&&Object.hasOwn(state.workers,p.workerId)&&Object.values(state.assignments).some(a=>a.workerId===p.workerId);
      if(buildCatalog&&c.config.active===true&&c.config.reviewedEmptyCycle===true&&(all||own)){
        if(cycles.length>=maxCycles)fail('capacity_limit');cycles.push({productId,cycleId});
        // One snapshot supplies both the grant and these cycle-specific labels.
        // A worker's historical name may differ between cycles; do not flatten
        // names or use them to infer identity. Partner-only roles receive self.
        const workerIds=all?Object.keys(state.workers).sort():[p.workerId];
        labelCount+=workerIds.length;if(workerIds.length>MAX_CYCLE_WORKERS||labelCount>MAX_LABELS)fail('capacity_limit');
        workerLabels.push({productId,cycleId,workers:workerIds.map(workerId=>({workerId,label:label(state.workers[workerId].nama)}))});
        if(p.owner===true)cycleLabels.push({productId,cycleId,series:productLabel(state.product.series),namaBarang:productLabel(state.product.namaBarang),size:productLabel(state.product.size)});
      }
    }
  }
  try{Ledger.validateOwnerLedger(v.ownerCommandLedger,v.products);}catch(error){fail(error&&['storage_capacity','capacity_limit'].includes(error.code)?'capacity_limit':'not_ready');}
  try{TariffLedger.validateTariffLedger(v.tariffCommandLedger,v.products);}catch(error){fail(error&&['storage_capacity','capacity_limit'].includes(error.code)?'capacity_limit':'not_ready');}
  try{EnrollmentRegistry.validateEnrollmentRegistry(Object.hasOwn(v,'enrollmentRegistry')?v.enrollmentRegistry:undefined,v.grants,v.products);}catch(error){fail(error&&error.code==='capacity_limit'?'capacity_limit':'not_ready');}
  // Reconstruct fields explicitly: no canonical grant/SDK/token spread into
  // the response. Only this caller's optional binding and boolean modules.
  const allowedProfile={active:true,owner:p.owner};
  if(p.workerId!==undefined)allowedProfile.workerId=p.workerId;
  if(p.modules!==undefined)allowedProfile.modules=copy(p.modules);
  const session={schemaVersion:1,projectId:binding.projectId,databaseURL:binding.databaseURL,tenantId:binding.tenantId,uid,grantRevision:current.revision,profile:allowedProfile,cycles,workerLabels};
  if(buildCatalog&&p.owner===true)session.cycleLabels=cycleLabels;
  return session;
}
function errorCode(error){
  if(error instanceof SessionError)return error.code;
  if(error instanceof Authority.AuthorityError)return ['storage_capacity','state_capacity'].includes(error.code)?'capacity_limit':error.code==='access_denied'?'access_denied':'not_ready';
  return 'unavailable';
}
const rejected=error=>Object.freeze({ok:false,error});
function ownerTariffView(value,session,selection,now){
  if(session.profile.owner!==true)fail('access_denied');
  const {productId,cycleId}=selection,cycle=value.products[productId]?.cycles?.[cycleId];
  if(!cycle||cycle.config.active!==true||cycle.config.reviewedEmptyCycle!==true)fail('not_ready');
  const state=Authority.decodeStorage(cycle.wire),quantities=new Map();
  for(const assignment of Object.values(state.assignments)){
    const quantity=(quantities.get(assignment.workerId)||0)+assignment.qty;
    integer(quantity,1);quantities.set(assignment.workerId,quantity);
  }
  if(quantities.size>MAX_CYCLE_WORKERS)fail('capacity_limit');let count=0;
  const workers=[...quantities.keys()].sort().map(workerId=>{
    const assignedQuantity=quantities.get(workerId),source=cycle.tariffInputs.historyByWorker[workerId];
    if(!source||!Object.keys(source).length)fail('not_ready');
    const history=Object.keys(source).map(tariffVersion=>{
      if(++count>512)fail('capacity_limit');const entry=source[tariffVersion];
      if(!Number.isSafeInteger(assignedQuantity*entry.rate))fail('not_ready');
      return {tariffVersion,effectiveAt:entry.effectiveAt,currency:'IDR',rate:entry.rate};
    }).sort((a,b)=>a.effectiveAt.localeCompare(b.effectiveAt));
    return {workerId,label:label(state.workers[workerId].nama),assignedQuantity,history};
  });
  if(!workers.length)fail('not_ready');
  const policy=cycle.tariffInputs.policy;
  return {schemaVersion:1,projectId:session.projectId,tenantId:session.tenantId,uid:session.uid,grantRevision:session.grantRevision,productId,cycleId,configRevision:cycle.config.revision,tariffRevision:cycle.tariffInputs.revision,serverTime:now,policy:{version:policy.version,kind:'jakarta-fixed-local-time',hour:policy.hour,minute:policy.minute},workers};
}
function createReadService(options={},ownerTariffs=false){
  const {database,auth,admit,clock,projectId,tenantId}=options,enabled=options.enabled===true;
  let configured=false,binding,reference=null,emulator=null,maxBytes,maxCycles,maxResponseBytes;
  function checkBinding(){
    if(emulator?process.env.FIREBASE_DATABASE_EMULATOR_HOST!==emulator.host+':'+PORT:process.env.FIREBASE_DATABASE_EMULATOR_HOST!==undefined)fail('access_denied');
    if(!database||typeof database.ref!=='function'||!database.app||!database.app.options||database.app.options.projectId!==projectId||databaseURL(database.app.options.databaseURL)!==binding.databaseURL)fail('access_denied');
    if(reference&&reference.toString()!==binding.referenceURL+'/authorityTenants/'+tenantId)fail('access_denied');
  }
  if(enabled){try{
    if(typeof projectId!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId))fail('access_denied');id(tenantId,'access_denied');
    maxBytes=options.maxTenantBytes===undefined?MAX_BYTES:options.maxTenantBytes;integer(maxBytes,1,MAX_BYTES,'unavailable');
    maxCycles=options.maxCycles===undefined?256:options.maxCycles;integer(maxCycles,1,2048,'unavailable');
    maxResponseBytes=options.maxResponseBytes===undefined?65536:options.maxResponseBytes;integer(maxResponseBytes,1,ownerTariffs?65536:1024*1024,'unavailable');
    if(!auth||typeof auth.verifyIdToken!=='function'||typeof admit!=='function'||typeof clock!=='function')fail('unavailable');
    const url=databaseURL(options.databaseURL);
    if(options.testOnlyEmulator!==undefined){
      json(options.testOnlyEmulator,'access_denied');exact(options.testOnlyEmulator,['host','port'],[],'access_denied');const e=options.testOnlyEmulator;
      if(!projectId.startsWith('demo-')||!['127.0.0.1','localhost'].includes(e.host)||e.port!==PORT||url!=='https://'+projectId+'.firebaseio.com')fail('access_denied');emulator=copy(e);
    }
    binding={projectId,tenantId,databaseURL:url,referenceURL:emulator?'http://'+emulator.host+':'+PORT:url};checkBinding();configured=true;
  }catch{configured=false;}}
  async function execute(request){
    if(!enabled)return rejected('service_disabled');if(!configured)return rejected('unavailable');
    try{
      json(request,'invalid_request');exact(request,ownerTariffs?['idToken','selection']:['idToken'],[],'invalid_request');
      if(ownerTariffs){exact(request.selection,['productId','cycleId'],[],'invalid_request');id(request.selection.productId,'invalid_request');id(request.selection.cycleId,'invalid_request');}
      if(typeof request.idToken!=='string'||!request.idToken||Buffer.byteLength(request.idToken,'utf8')>16384||/[\r\n]/.test(request.idToken))fail('invalid_request');
      checkBinding();let token;try{token=await auth.verifyIdToken(request.idToken,true);}catch{fail('access_denied');}
      const now=instant(clock(),'unavailable'),uid=identity(token,projectId,now);
      if(!ownerTariffs&&await admit({projectId,uid})!==true)fail('rate_limited');checkBinding();
      if(!reference){reference=database.ref('authorityTenants/'+tenantId);if(!reference||typeof reference.get!=='function'||typeof reference.toString!=='function')fail('access_denied');}
      checkBinding();let snapshot;try{snapshot=await reference.get();}catch{fail('unavailable');}
      checkBinding();if(!snapshot||typeof snapshot.val!=='function')fail('unavailable');let value;try{value=snapshot.val();}catch{fail('unavailable');}
      // Owner tariff views validate the whole tenant but do not build an
      // unrelated session catalog or apply its separate label-count bounds.
      let subject=null;
      if(value!==null&&typeof value==='object'&&Object.getOwnPropertyDescriptor(value,'schemaVersion')?.value===2){
        const firebase=token.firebase,identities=Object.getOwnPropertyDescriptor(firebase,'identities')?.value,google=identities&&Object.getOwnPropertyDescriptor(identities,'google.com')?.value;
        if(Object.hasOwn(firebase,'tenant')||!Array.isArray(google)||google.length!==1||!safe(google[0]))fail('access_denied');subject=google[0];
      }
      const session=manifest(value,binding,uid,maxBytes,maxCycles,!ownerTariffs,subject);
      const response=ownerTariffs?{ok:true,view:ownerTariffView(value,session,request.selection,now)}:{ok:true,session};size(response,maxResponseBytes);
      // The view and owner grant come from one validated snapshot. Admission
      // happens only after owner authorization and may repeat a live grant
      // check; this read never confers a lasting permission to append a rate.
      if(ownerTariffs&&await admit({projectId,uid})!==true)fail('rate_limited');checkBinding();
      return freeze(response);
    }catch(error){return rejected(errorCode(error));}
  }
  return Object.freeze({execute});
}
const createProductionSessionService=options=>createReadService(options,false);
const createProductionOwnerTariffService=options=>createReadService(options,true);
module.exports=Object.freeze({createProductionSessionService,createProductionOwnerTariffService});
