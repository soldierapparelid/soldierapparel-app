'use strict';
/* Canonical administrative writer. Disabled by default; trusted server
 * dependencies only. No SDK initialization, bootstrap, legacy import, endpoint,
 * payment or deployment. All writes CAS the SAME authorityTenants ancestor.
 *
 * createProductionTenantAdmin({enabled,projectId,tenantId,databaseURL,database,
 *   auth,admit,clock,maxAttempts?,maxTenantBytes?,testOnlyEmulator?}).execute:
 * {idToken,command}; exact command shapes:
 * - {kind:'setGrant',uid,expectedRevision:null|integer,profile}
 *   null requires an absent explicit UID; updates require the current revision.
 * - {kind:'appendTariff',productId,cycleId,expectedConfigRevision,
 *   expectedTariffRevision,workerId,tariffVersion,effectiveAt,currency:'IDR',rate}
 *   A new, strictly later, positive whole-rupiah version only; effectiveAt must
 *   not precede the fresh trusted server time at callback validation. This is
 *   not a guarantee about time passing after a conditional put is sent.
 * - {kind:'setConfig',productId,cycleId,expectedRevision,
 *   config:{active,reviewedEmptyCycle,tariffPolicy}}
 *   A false review marker can become true only on an empty revision-zero cycle.
 *
 * Actor roles/UID never come from the body. Google token verification with
 * checkRevoked=true and a live active owner grant are mandatory. Every internal
 * callback retry aborts and re-verifies Auth outside the SDK callback. The
 * caller grant and target trust are pinned across attempts. Frozen authority
 * and sibling branches are retained. The last active owner cannot be removed.
 * createCycle accepts a stable requestId, complete explicit assignments and
 * initial historical tariffs. It seeds an inactive/unreviewed EMPTY cycle and
 * a private durable owner receipt in the SAME tenant CAS. It never replaces a
 * cycle. Existing three command shapes retain their earlier conflict semantics
 * and have no durable request receipt; their ambiguous transport result still
 * requires a reviewed server read before resubmission.
 * Firebase Auth revocation and RTDB commit are not a cross-service transaction.
 * No production rate limiter, transport cancellation, admin audit log, or
 * review/migration/assignment/clock policy is supplied by this module.
 */
const Authority=require('./production-authority.cjs');
const Ledger=require('./production-owner-ledger.cjs');
const MAX_BYTES=8*1024*1024,MAX_REQUEST=32768,MAX_NODES=500000,WARM_MS=5000;
const forbidden=new Set(['__proto__','constructor','prototype']);
const modules=new Set(['potong','jahit','qc','laporan','stok','gaji','hpp','pembelian','nota','retur']);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const safe=v=>typeof v==='string'&&v.length>0&&v.length<=128&&!forbidden.has(v)&&/^[A-Za-z0-9_-]+$/.test(v);
class TenantAdminError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new TenantAdminError(code);};
function json(v,code='not_ready',depth=0,seen=new Set(),budget={nodes:0}){
  if(++budget.nodes>MAX_NODES||depth>64)fail(code==='invalid_request'?code:'capacity_limit');
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
function exact(v,required,optional=[],code='not_ready'){if(!object(v)||required.some(k=>!Object.hasOwn(v,k))||Object.keys(v).some(k=>!required.includes(k)&&!optional.includes(k)))fail(code);}
function integer(v,min=0,code='not_ready'){if(!Number.isSafeInteger(v)||v<min)fail(code);}
function id(v,code='access_denied'){if(!safe(v))fail(code);return v;}
function instant(v,code='not_ready'){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v).toISOString()!==v)fail(code);return v;}
const copy=v=>JSON.parse(JSON.stringify(v));
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':object(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const same=(a,b)=>canonical(a)===canonical(b);
function bytes(v,max,code='capacity_limit'){if(Buffer.byteLength(JSON.stringify(v),'utf8')>max)fail(code);}
function map(v){if(!object(v))fail('not_ready');for(const key of Object.keys(v))id(key);}
function profile(v,code='not_ready'){
  exact(v,['active','owner'],['workerId','modules'],code);if(typeof v.active!=='boolean'||typeof v.owner!=='boolean')fail(code);
  if(Object.hasOwn(v,'workerId'))id(v.workerId,code);
  if(Object.hasOwn(v,'modules')&&(!object(v.modules)||Object.keys(v.modules).some(k=>!modules.has(k)||typeof v.modules[k]!=='boolean')))fail(code);
}
function config(v){exact(v,['revision','active','reviewedEmptyCycle','tariffPolicy']);integer(v.revision);if(typeof v.active!=='boolean'||typeof v.reviewedEmptyCycle!=='boolean'||v.tariffPolicy!=='explicit-historical-jakarta-v1')fail('not_ready');}
function tariffInputs(v){
  exact(v,['revision','policy','historyByWorker']);integer(v.revision);
  exact(v.policy,['version','kind','hour','minute']);id(v.policy.version);integer(v.policy.hour);integer(v.policy.minute);
  if(v.policy.kind!=='jakarta-fixed-local-time'||v.policy.hour>23||v.policy.minute>59)fail('not_ready');map(v.historyByWorker);
  for(const history of Object.values(v.historyByWorker)){
    map(history);const times=new Set();for(const rate of Object.values(history)){
      exact(rate,['effectiveAt','currency','rate']);instant(rate.effectiveAt);integer(rate.rate,1);
      if(rate.currency!=='IDR'||times.has(rate.effectiveAt))fail('not_ready');times.add(rate.effectiveAt);
    }
  }
}
function tenant(v,binding,max){
  json(v);bytes(v,max);exact(v,['schemaVersion','projectId','tenantId','grants','products'],['ownerCommandLedger']);
  if(v.schemaVersion!==1)fail('not_ready');if(v.projectId!==binding.projectId||v.tenantId!==binding.tenantId)fail('access_denied');
  map(v.grants);map(v.products);
  for(const grant of Object.values(v.grants)){exact(grant,['revision','profile']);integer(grant.revision);profile(grant.profile);}
  for(const [productId,p]of Object.entries(v.products)){
    exact(p,['cycles']);map(p.cycles);for(const [cycleId,c]of Object.entries(p.cycles)){
      exact(c,['config','tariffInputs','wire']);config(c.config);tariffInputs(c.tariffInputs);
      const state=Authority.decodeStorage(c.wire);if(state.productId!==productId||state.cycleId!==cycleId)fail('access_denied');
    }
  }
  Ledger.validateOwnerLedger(v.ownerCommandLedger,v.products);
  return v;
}
function owner(v,uid){const grant=Object.hasOwn(v.grants,uid)?v.grants[uid]:null;if(!grant||grant.profile.active!==true||grant.profile.owner!==true)fail('access_denied');return grant;}
function cycle(v,c){if(!Object.hasOwn(v.products,c.productId)||!Object.hasOwn(v.products[c.productId].cycles,c.cycleId))fail('access_denied');return v.products[c.productId].cycles[c.cycleId];}
function shape(c){
  const code='invalid_request';
  if(!object(c))fail(code);
  if(c.kind==='createCycle'){
    Ledger.validateCreateCycleCommand(c);
  }else if(c.kind==='setGrant'){
    exact(c,['kind','uid','expectedRevision','profile'],[],code);id(c.uid,code);if(c.expectedRevision!==null)integer(c.expectedRevision,0,code);profile(c.profile,code);
    // RTDB drops empty maps: require omission instead of a non-roundtrip grant.
    if(c.profile.modules&&Object.keys(c.profile.modules).length===0)fail(code);
  }else if(c.kind==='appendTariff'){
    exact(c,['kind','productId','cycleId','expectedConfigRevision','expectedTariffRevision','workerId','tariffVersion','effectiveAt','currency','rate'],[],code);
    for(const field of ['productId','cycleId','workerId','tariffVersion'])id(c[field],code);
    integer(c.expectedConfigRevision,0,code);integer(c.expectedTariffRevision,0,code);integer(c.rate,1,code);instant(c.effectiveAt,code);if(c.currency!=='IDR')fail(code);
  }else if(c.kind==='setConfig'){
    exact(c,['kind','productId','cycleId','expectedRevision','config'],[],code);id(c.productId,code);id(c.cycleId,code);integer(c.expectedRevision,0,code);
    exact(c.config,['active','reviewedEmptyCycle','tariffPolicy'],[],code);if(typeof c.config.active!=='boolean'||typeof c.config.reviewedEmptyCycle!=='boolean'||c.config.tariffPolicy!=='explicit-historical-jakarta-v1')fail(code);
  }else fail(code);
}
function target(v,c){
  if(c.kind==='createCycle'){
    if(!Object.hasOwn(v.products,c.product.id)||!Object.hasOwn(v.products[c.product.id].cycles,c.cycleId))return null;
    const current=v.products[c.product.id].cycles[c.cycleId];
    // RTDB prunes empty projection children. Compare the validated private
    // state, not pruned and unpruned wire representations of the same seed.
    return {config:copy(current.config),tariffInputs:copy(current.tariffInputs),state:Authority.decodeStorage(current.wire)};
  }
  if(c.kind==='setGrant')return Object.hasOwn(v.grants,c.uid)?copy(v.grants[c.uid]):null;
  const current=cycle(v,c);return c.kind==='setConfig'?copy(current.config):{config:copy(current.config),tariffInputs:copy(current.tariffInputs)};
}
function checkExpected(v,c){
  if(c.kind==='createCycle'){
    if(target(v,c)!==null)fail('conflict');
  }else if(c.kind==='setGrant'){
    const g=Object.hasOwn(v.grants,c.uid)?v.grants[c.uid]:null;
    if(c.expectedRevision===null?g!==null:g===null||g.revision!==c.expectedRevision)fail('conflict');
  }else{
    const current=cycle(v,c);
    if(c.kind==='setConfig'?current.config.revision!==c.expectedRevision:current.config.revision!==c.expectedConfigRevision||current.tariffInputs.revision!==c.expectedTariffRevision)fail('conflict');
  }
}
function increment(v){if(v>=Number.MAX_SAFE_INTEGER)fail('capacity_limit');return v+1;}
function apply(v,c,now,uid){
  checkExpected(v,c);const next=copy(v);let revision;
  if(c.kind==='createCycle'){
    const seed=Ledger.createCycleSeed(c,now);
    if(!Object.hasOwn(next.products,c.product.id))next.products[c.product.id]={cycles:{}};
    next.products[c.product.id].cycles[c.cycleId]=seed;
    const initial=Authority.decodeStorage(seed.wire).snapshots.v0000000000;
    next.ownerCommandLedger=Ledger.appendOwnerLedger(next.ownerCommandLedger,{uid,command:c,acceptedAt:now,initialSnapshotHash:initial.hash},next.products);
    return {next,revision:0,receipt:Ledger.getOwnerReceipt(next.ownerCommandLedger,uid,c)};
  }else if(c.kind==='setGrant'){
    if(Object.hasOwn(c.profile,'workerId')){
      const known=Object.values(v.products).some(p=>Object.values(p.cycles).some(current=>Object.hasOwn(Authority.decodeStorage(current.wire).workers,c.profile.workerId)));
      if(!known)fail('not_ready');
    }
    if(c.profile.active&& !c.profile.owner && (c.profile.modules?.jahit===true||c.profile.modules?.potong===true)&&!Object.hasOwn(c.profile,'workerId'))fail('not_ready');
    const current=Object.hasOwn(v.grants,c.uid)?v.grants[c.uid]:null;revision=current?increment(current.revision):1;
    next.grants[c.uid]={revision,profile:copy(c.profile)};
    if(!Object.values(next.grants).some(g=>g.profile.active===true&&g.profile.owner===true))fail('not_ready');
  }else{
    const current=cycle(v,c),state=Authority.decodeStorage(current.wire),out=cycle(next,c);
    if(c.kind==='appendTariff'){
      if(!Object.hasOwn(state.workers,c.workerId)||!Object.values(state.assignments).some(a=>a.workerId===c.workerId))fail('not_ready');
      const history=current.tariffInputs.historyByWorker[c.workerId]||{};
      if(Object.hasOwn(history,c.tariffVersion)||c.effectiveAt<now||Object.values(history).some(rate=>rate.effectiveAt>=c.effectiveAt))fail('conflict');
      revision=increment(current.tariffInputs.revision);out.tariffInputs.revision=revision;
      if(!Object.hasOwn(out.tariffInputs.historyByWorker,c.workerId))out.tariffInputs.historyByWorker[c.workerId]={};
      out.tariffInputs.historyByWorker[c.workerId][c.tariffVersion]={effectiveAt:c.effectiveAt,currency:c.currency,rate:c.rate};
    }else{
      if(c.config.reviewedEmptyCycle===true&&current.config.reviewedEmptyCycle!==true&&state.revision!==0)fail('not_ready');
      revision=increment(current.config.revision);out.config={revision,...copy(c.config)};
    }
  }
  return {next,revision};
}
function identity(v,projectId,now){
  json(v,'access_denied');if(!object(v)||!safe(v.uid)||v.sub!==v.uid||v.aud!==projectId||v.iss!=='https://securetoken.google.com/'+projectId||v.email_verified!==true||!object(v.firebase)||v.firebase.sign_in_provider!=='google.com'||!Number.isSafeInteger(v.exp)||v.exp*1000<=Date.parse(now))fail('access_denied');return v.uid;
}
function databaseURL(value){
  if(typeof value!=='string')fail('access_denied');let u;try{u=new URL(value);}catch{fail('access_denied');}
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||u.pathname!=='/'||!/^([a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app)$/.test(u.hostname))fail('access_denied');return u.origin;
}
const rejected=code=>Object.freeze({ok:false,error:code});
function errorCode(error){if(error instanceof TenantAdminError||error instanceof Ledger.OwnerLedgerError)return error.code;if(error instanceof Authority.AuthorityError)return ['storage_capacity','state_capacity'].includes(error.code)?'capacity_limit':'not_ready';return 'unavailable';}
function createProductionTenantAdmin(options={}){
  const {projectId,tenantId,database,auth,admit,clock}=options,enabled=options.enabled===true,maxAttempts=options.maxAttempts===undefined?3:options.maxAttempts;
  let ref,binding,emulator=null,max=MAX_BYTES;
  function checkBinding(){
    try{
      if(emulator?process.env.FIREBASE_DATABASE_EMULATOR_HOST!==emulator.host+':9000':process.env.FIREBASE_DATABASE_EMULATOR_HOST!==undefined)fail('access_denied');
      if(!database||!database.app||!database.app.options||database.app.options.projectId!==projectId||databaseURL(database.app.options.databaseURL)!==binding.databaseURL||typeof database.ref!=='function')fail('access_denied');
      if(ref&&ref.toString()!==binding.referenceURL+'/authorityTenants/'+tenantId)fail('access_denied');
    }catch(error){if(error instanceof TenantAdminError)throw error;fail('unavailable');}
  }
  if(enabled){
    try{
      if(typeof projectId!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId))fail('access_denied');id(tenantId);
      if(!auth||typeof auth.verifyIdToken!=='function'||typeof admit!=='function'||typeof clock!=='function'||!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>5)fail('unavailable');
      max=options.maxTenantBytes===undefined?MAX_BYTES:options.maxTenantBytes;integer(max,1);if(max>MAX_BYTES)fail('capacity_limit');const url=databaseURL(options.databaseURL);
      if(options.testOnlyEmulator!==undefined){
        json(options.testOnlyEmulator,'access_denied');exact(options.testOnlyEmulator,['host','port'],[],'access_denied');const e=options.testOnlyEmulator;
        if(!projectId.startsWith('demo-')||!['127.0.0.1','localhost'].includes(e.host)||e.port!==9000||url!=='https://'+projectId+'.firebaseio.com')fail('access_denied');emulator=copy(e);
      }
      binding={projectId,tenantId,databaseURL:url,referenceURL:emulator?'http://'+emulator.host+':9000':url};checkBinding();ref=database.ref('authorityTenants/'+tenantId);
      if(!ref||['get','transaction','toString','on','off'].some(k=>typeof ref[k]!=='function'))fail('unavailable');checkBinding();
    }catch(error){if(error instanceof TenantAdminError)throw error;fail('unavailable');}
  }
  async function read(){checkBinding();let snapshot;try{snapshot=await ref.get();}catch{fail('unavailable');}checkBinding();if(!snapshot||typeof snapshot.val!=='function')fail('unavailable');let value;try{value=snapshot.val();}catch{fail('unavailable');}return tenant(value,binding,max);}
  async function transact(update){
    let listener,timer,cold=false,calls=0,terminal=null,candidate=null,result;
    const ready=new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new TenantAdminError('unavailable'));};listener=()=>{clearTimeout(timer);resolve();};timer=setTimeout(abort,WARM_MS);try{ref.on('value',listener,abort);}catch{abort();}});
    try{
      await ready;checkBinding();result=await ref.transaction(value=>{
        if(value===null){cold=true;return undefined;}calls++;if(calls>1){candidate=null;return undefined;}
        try{checkBinding();const current=tenant(value,binding,max);candidate=update(current);tenant(candidate.next,binding,max);return candidate.next;}
        catch(error){terminal=errorCode(error);candidate=null;return undefined;}
      },undefined,false);
    }catch(error){if(error instanceof TenantAdminError)throw error;fail('unavailable');}
    finally{clearTimeout(timer);try{ref.off('value',listener);}catch{}}
    if(terminal==='retry_read')return {retryable:true};
    if(terminal)fail(terminal);checkBinding();if(!result||typeof result.committed!=='boolean')fail('unavailable');
    if(!result.committed)return {retryable:cold||calls>1};
    if(cold||!candidate||calls!==1||!result.snapshot||typeof result.snapshot.val!=='function')fail('unavailable');let value;try{value=result.snapshot.val();}catch{fail('unavailable');}
    try{return {retryable:false,committed:tenant(value,binding,max),candidate};}catch{fail('unavailable');}
  }
  async function execute(request){
    if(!enabled)return rejected('service_disabled');
    try{
      json(request,'invalid_request');exact(request,['idToken','command'],[],'invalid_request');if(typeof request.idToken!=='string'||!request.idToken||request.idToken.length>16384||/[\r\n]/.test(request.idToken))fail('invalid_request');bytes(request.command,MAX_REQUEST,'invalid_request');const command=copy(request.command);shape(command);
      let lastNow=null,pinned=null,admitted=false;
      const readNow=()=>{const now=instant(clock(),'unavailable');if(lastNow&&now<lastNow)fail('unavailable');lastNow=now;return now;};
      for(let attempt=0;attempt<maxAttempts;attempt++){
        checkBinding();let verified;try{verified=await auth.verifyIdToken(request.idToken,true);}catch{fail('access_denied');}const uid=identity(verified,projectId,readNow());
        if(!admitted){if(await admit({projectId,uid})!==true)fail('rate_limited');admitted=true;}
        const observed=await read(),caller=copy(owner(observed,uid));
        if(pinned&&(!same(caller,pinned.caller)||uid!==pinned.uid))fail('access_denied');
        if(command.kind==='createCycle'){
          const receipt=Ledger.getOwnerReceipt(observed.ownerCommandLedger,uid,command);
          if(receipt)return Object.freeze({ok:true,receipt,replayed:true});
        }
        checkExpected(observed,command);const observedTarget=target(observed,command);
        if(pinned&&!same(observedTarget,pinned.target))fail('conflict');
        // Pure preflight detects unsafe changes before creating a listener.
        const preview=apply(observed,command,readNow(),uid);tenant(preview.next,binding,max);if(!pinned)pinned={uid,caller,target:copy(observedTarget)};
        const result=await transact(current=>{
          if(!same(owner(current,uid),caller))fail('access_denied');
          // A concurrent identical create must be replayed only after a fresh
          // Auth verification and canonical owner read, never as a no-op write.
          if(command.kind==='createCycle'&&Ledger.getOwnerReceipt(current.ownerCommandLedger,uid,command))fail('retry_read');
          if(!same(target(current,command),observedTarget))fail('conflict');return apply(current,command,readNow(),uid);
        });
        if(result.committed){
          if(!same(target(result.committed,command),target(result.candidate.next,command)))fail('unavailable');
          if(command.kind==='createCycle'){
            const receipt=Ledger.getOwnerReceipt(result.committed.ownerCommandLedger,uid,command);
            if(!receipt||!same(receipt,result.candidate.receipt))fail('unavailable');
            return Object.freeze({ok:true,receipt,replayed:false});
          }
          return Object.freeze({ok:true,kind:command.kind,revision:result.candidate.revision});
        }
        if(!result.retryable)fail('unavailable');
      }
      return rejected('conflict');
    }catch(error){return rejected(errorCode(error));}
  }
  return Object.freeze({execute});
}
module.exports=Object.freeze({createProductionTenantAdmin,TenantAdminError});
