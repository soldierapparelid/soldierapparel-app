'use strict';
// Isolated, read-only and source OFF. No SDK initialization, route, logger,
// grant writer, tenant bootstrap, archive publisher or legacy-root fallback.
const Adapter=require('./production-tenant-adapter.cjs');
const Authority=require('./production-authority.cjs');
const Data=require('./production-enrollment-registry.cjs');
const History=require('../legacy-stored-history.js');
const MAX_HISTORY_BYTES=8*1024*1024,MAX_WORKERS=128,MAX_TOKEN_BYTES=16384,MAX_PROVIDERS=16;
const SOURCE_POLICY='same-stable-id-stored-history-v1';
const reserved=new Set(['__proto__','constructor','prototype']);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const safe=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!reserved.has(v);
const project=v=>typeof v==='string'&&/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(v);
const instant=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString()===v;
const result=error=>Object.freeze({ok:false,error});
class ReadError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new ReadError(code);};
function field(v,k,code='not_ready'){
  if(!object(v))fail(code);const d=Object.getOwnPropertyDescriptor(v,k);
  if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail(code);return d.value;
}
function exact(v,required,optional=[],code='not_ready'){
  if(!plain(v))fail(code);const keys=Reflect.ownKeys(v);
  if(keys.some(k=>typeof k!=='string'||!required.includes(k)&&!optional.includes(k))||required.some(k=>!keys.includes(k)))fail(code);
  for(const k of keys)field(v,k,code);
}
function regular(v,code){
  if(!plain(v))fail(code);
  for(const k of Reflect.ownKeys(v)){if(typeof k!=='string'||reserved.has(k))fail(code);field(v,k,code);}
}
function method(v,k){
  if(!object(v))fail('unavailable');let p=v;
  for(let depth=0;p&&depth<8;depth++,p=Object.getPrototypeOf(p)){
    const d=Object.getOwnPropertyDescriptor(p,k);
    if(d){if(!Object.hasOwn(d,'value')||typeof d.value!=='function')fail('unavailable');return d.value;}
  }
  fail('unavailable');
}
function databaseOrigin(v){
  if(typeof v!=='string')fail('unavailable');let u;try{u=new URL(v);}catch{fail('unavailable');}
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||u.origin!==v||u.pathname!=='/'||!/^([a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app)$/.test(u.hostname))fail('unavailable');return v;
}
function seconds(v){if(!Number.isSafeInteger(v)||v<=0||v>Math.floor(Number.MAX_SAFE_INTEGER/1000))fail('access_denied');return v*1000;}
function email(v){return typeof v==='string'&&v.length>=3&&v.length<=254&&!/[\s\u0000-\u001f\u007f-\u009f]/.test(v)&&/^[^@]+@[^@]+$/.test(v);}
function timely(v,now){
  // Ordinary read sessions allow an older original authentication. Enrollment's
  // separate five-minute policy is unchanged and is never overridden here.
  if(v.authTimeMs>v.issuedAtMs||v.issuedAtMs>=v.expiresAtMs||v.authTimeMs>now||v.issuedAtMs>now||now>=v.expiresAtMs)fail('access_denied');
}
function identity(token,projectId,now){
  regular(token,'access_denied');const uid=field(token,'uid','access_denied');
  if(!safe(uid)||field(token,'sub','access_denied')!==uid||field(token,'aud','access_denied')!==projectId||field(token,'iss','access_denied')!=='https://securetoken.google.com/'+projectId||field(token,'email_verified','access_denied')!==true)fail('access_denied');
  const address=field(token,'email','access_denied');if(!email(address))fail('access_denied');
  const firebase=field(token,'firebase','access_denied');regular(firebase,'access_denied');
  if(field(firebase,'sign_in_provider','access_denied')!=='google.com'||Object.hasOwn(firebase,'tenant')&&field(firebase,'tenant','access_denied')!==undefined)fail('access_denied');
  const identities=field(firebase,'identities','access_denied');regular(identities,'access_denied');const google=field(identities,'google.com','access_denied');
  if(!Array.isArray(google)||Object.getPrototypeOf(google)!==Array.prototype||google.length!==1||Reflect.ownKeys(google).length!==2)fail('access_denied');
  const d=Object.getOwnPropertyDescriptor(google,'0');if(!d||!d.enumerable||!Object.hasOwn(d,'value')||!safe(d.value))fail('access_denied');
  const selected={projectId,uid,email:address,googleSubject:d.value,authTimeMs:seconds(field(token,'auth_time','access_denied')),issuedAtMs:seconds(field(token,'iat','access_denied')),expiresAtMs:seconds(field(token,'exp','access_denied'))};
  timely(selected,now);return Object.freeze(selected);
}
function currentUser(v,expected){
  // Real Admin UserRecord/UserInfo may have class prototypes. Only required
  // own data fields are selected; no unrelated record is serialized or logged.
  if(field(v,'uid','access_denied')!==expected.uid||field(v,'disabled','access_denied')!==false||field(v,'emailVerified','access_denied')!==true||field(v,'email','access_denied')!==expected.email)fail('access_denied');
  if(Object.hasOwn(v,'tenantId')){const tenant=field(v,'tenantId','access_denied');if(tenant!==undefined&&tenant!==null)fail('access_denied');}
  const providers=field(v,'providerData','access_denied');
  if(!Array.isArray(providers)||Object.getPrototypeOf(providers)!==Array.prototype||providers.length<1||providers.length>MAX_PROVIDERS||Reflect.ownKeys(providers).length!==providers.length+1)fail('access_denied');
  let google=null;
  for(let i=0;i<providers.length;i++){
    const d=Object.getOwnPropertyDescriptor(providers,String(i));if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail('access_denied');
    const p=d.value,id=field(p,'providerId','access_denied');if(typeof id!=='string'||!id||id.length>128||/[\u0000-\u0020\u007f-\uffff]/.test(id))fail('access_denied');
    if(id==='google.com'){if(google)fail('access_denied');google=p;}
  }
  if(!google||field(google,'uid','access_denied')!==expected.googleSubject||field(google,'email','access_denied')!==expected.email)fail('access_denied');
}
function sameIdentity(a,b){return ['projectId','uid','email','googleSubject','authTimeMs','issuedAtMs','expiresAtMs'].every(k=>a[k]===b[k]);}
function grant(g,projectId,uid){
  exact(g,['projectId','uid','revision','profile'],[],'access_denied');
  if(g.projectId!==projectId||g.uid!==uid||!Number.isSafeInteger(g.revision)||g.revision<1)fail('access_denied');
  const p=g.profile;exact(p,['active','owner','workerId','modules'],[],'access_denied');
  if(p.active!==true||p.owner!==false||!safe(p.workerId))fail('access_denied');regular(p.modules,'access_denied');
  const active=Object.keys(p.modules).filter(k=>field(p.modules,k,'access_denied')===true);
  if(Object.keys(p.modules).some(k=>typeof field(p.modules,k,'access_denied')!=='boolean')||active.length!==1||!['jahit','potong'].includes(active[0]))fail('access_denied');
  return {value:Data.copyEnrollmentData(g),division:active[0]};
}
function sourceData(value,fixed,selected){
  let copied;
  try{
    if(Buffer.byteLength(Data.serializeEnrollmentData(value),'utf8')>MAX_HISTORY_BYTES)fail('capacity_limit');
    copied=Data.copyEnrollmentData(value);
  }catch(error){if(error instanceof ReadError)throw error;fail('not_ready');}
  exact(copied,['schemaVersion','scope','policy','reviewed','immutable','workers','products']);
  exact(copied.scope,['projectId','databaseURL','tenantId','snapshotVersion']);
  if(copied.schemaVersion!==1||copied.policy!==SOURCE_POLICY||copied.reviewed!==true||copied.immutable!==true)fail('not_ready');
  if(['projectId','databaseURL','tenantId','snapshotVersion'].some(k=>copied.scope[k]!==fixed[k]))fail('access_denied');
  regular(copied.workers,'not_ready');const ids=Object.keys(copied.workers);if(ids.length>MAX_WORKERS)fail('capacity_limit');
  for(const id of ids){
    if(!safe(id))fail('not_ready');const w=copied.workers[id];exact(w,['division','reviewed']);
    if(!['jahit','potong'].includes(w.division)||w.reviewed!==true)fail('not_ready');
  }
  // A reviewed, explicit SAME stable ID must exist. There is no alias, name,
  // email or canonical-to-legacy remapping fallback, even if rows look alike.
  if(!Object.hasOwn(copied.workers,selected.value.profile.workerId)||copied.workers[selected.value.profile.workerId].division!==selected.division)fail('not_ready');
  return copied.products;
}
function createProductionLegacyHistoryService(options){
  let enabled;try{enabled=plain(options)&&Object.getOwnPropertyDescriptor(options,'enabled');}catch{}
  if(!enabled||!Object.hasOwn(enabled,'value')||enabled.value!==true)return Object.freeze({execute:async()=>result('service_disabled')});
  let fixed,database,auth,source,sourceRead,admit,clock,reference,getReference,referenceString,app,databaseApp,verifyIdToken,getUser,refMethod;
  function checkBinding(){
    try{
      if(auth.app!==app||field(auth.app.options,'projectId','unavailable')!==fixed.projectId||method(auth,'verifyIdToken')!==verifyIdToken||method(auth,'getUser')!==getUser)fail('unavailable');
      if(database.app!==databaseApp||field(database.app.options,'projectId','unavailable')!==fixed.projectId||databaseOrigin(field(database.app.options,'databaseURL','unavailable'))!==fixed.databaseURL||method(database,'ref')!==refMethod)fail('unavailable');
      if(process.env.FIREBASE_DATABASE_EMULATOR_HOST!==undefined||process.env.FIREBASE_AUTH_EMULATOR_HOST!==undefined)fail('unavailable');
      if(reference&&(method(reference,'get')!==getReference||method(reference,'toString')!==referenceString||referenceString.call(reference)!==fixed.databaseURL+'/authorityTenants/'+fixed.tenantId))fail('unavailable');
      exact(source,['projectId','databaseURL','tenantId','snapshotVersion','path','read'],[],'unavailable');
      if(['projectId','databaseURL','tenantId','snapshotVersion'].some(k=>field(source,k,'unavailable')!==fixed[k])||field(source,'path','unavailable')!==fixed.path||field(source,'read','unavailable')!==sourceRead)fail('unavailable');
    }catch{fail('unavailable');}
  }
  try{
    exact(options,['enabled','projectId','databaseURL','tenantId','snapshotVersion','database','auth','historySource','admit','clock'],[],'unavailable');
    fixed={projectId:options.projectId,databaseURL:databaseOrigin(options.databaseURL),tenantId:options.tenantId,snapshotVersion:options.snapshotVersion};
    if(!project(fixed.projectId)||!safe(fixed.tenantId)||!safe(fixed.snapshotVersion))fail('unavailable');
    fixed.path='legacyStoredHistoryArchives/'+fixed.tenantId+'/'+fixed.snapshotVersion;Object.freeze(fixed);
    database=options.database;auth=options.auth;source=options.historySource;admit=options.admit;clock=options.clock;
    if(typeof admit!=='function'||typeof clock!=='function')fail('unavailable');
    verifyIdToken=method(auth,'verifyIdToken');getUser=method(auth,'getUser');refMethod=method(database,'ref');app=auth.app;databaseApp=database.app;sourceRead=field(source,'read','unavailable');if(typeof sourceRead!=='function')fail('unavailable');checkBinding();
    reference=refMethod.call(database,'authorityTenants/'+fixed.tenantId);getReference=method(reference,'get');referenceString=method(reference,'toString');checkBinding();
  }catch{return Object.freeze({execute:async()=>result('unavailable')});}
  async function execute(request){
    try{
      exact(request,['idToken'],[],'invalid_request');const idToken=field(request,'idToken','invalid_request');
      if(typeof idToken!=='string'||!idToken||Buffer.byteLength(idToken,'utf8')>MAX_TOKEN_BYTES||/[\r\n]/.test(idToken))fail('invalid_request');
      let previous=null;
      function now(){const value=clock();if(!instant(value))fail('unavailable');const ms=Date.parse(value);if(ms<0||previous!==null&&ms<previous)fail('unavailable');previous=ms;return ms;}
      async function verify(){
        checkBinding();now();checkBinding();let token;try{token=await verifyIdToken.call(auth,idToken,true);}catch{fail('access_denied');}
        checkBinding();const selected=identity(token,fixed.projectId,now());checkBinding();let record;try{record=await getUser.call(auth,selected.uid);}catch{fail('access_denied');}
        checkBinding();timely(selected,now());checkBinding();currentUser(record,selected);return selected;
      }
      async function readGrant(uid){
        checkBinding();let value;
        try{
          const snapshot=await getReference.call(reference);checkBinding();now();
          value=method(snapshot,'val').call(snapshot);
          Adapter.validateCanonicalTenant(value,{projectId:fixed.projectId,tenantId:fixed.tenantId});
        }
        catch(error){
          let code='not_ready';try{if(error instanceof Authority.AuthorityError){if(error.code==='access_denied')code='access_denied';else if(['storage_capacity','state_capacity'].includes(error.code))code='capacity_limit';}}catch{}
          fail(code);
        }
        checkBinding();now();
        if(!Object.hasOwn(value.grants,uid))fail('access_denied');
        const selected=grant({projectId:fixed.projectId,uid,...Data.copyEnrollmentData(value.grants[uid])},fixed.projectId,uid),catalog=[];
        // Catalog membership and grant come from the SAME fully validated
        // tenant snapshot. An archive declaration cannot manufacture it.
        for(const productId of Object.keys(value.products).sort()){
          const cycles=value.products[productId].cycles;
          for(const cycleId of Object.keys(cycles).sort()){
            const state=Authority.decodeStorage(cycles[cycleId].wire);
            if(Object.hasOwn(state.workers,selected.value.profile.workerId))catalog.push({productId,cycleId,worker:Data.copyEnrollmentData(state.workers[selected.value.profile.workerId])});
          }
        }
        if(!catalog.length)fail('not_ready');selected.catalog=catalog;return selected;
      }
      const initialIdentity=await verify(),initialGrant=await readGrant(initialIdentity.uid),fingerprint=Data.serializeEnrollmentData(initialGrant);
      checkBinding();timely(initialIdentity,now());checkBinding();let admitted;try{admitted=await admit(Object.freeze({projectId:fixed.projectId,uid:initialIdentity.uid}));}catch{fail('unavailable');}
      checkBinding();timely(initialIdentity,now());if(admitted!==true)fail('rate_limited');
      const before=await readGrant(initialIdentity.uid);if(Data.serializeEnrollmentData(before)!==fingerprint)fail('access_denied');
      timely(initialIdentity,now());checkBinding();let stored;try{stored=await sourceRead.call(source);}catch{fail('unavailable');}
      checkBinding();timely(initialIdentity,now());
      const products=sourceData(stored,fixed,before),binding={projectId:fixed.projectId,databaseURL:fixed.databaseURL,tenantId:fixed.tenantId,uid:initialIdentity.uid,workerId:before.value.profile.workerId,division:before.division,grantRevision:before.value.revision};
      const projected=History.createLegacyStoredHistoryProjector({enabled:true,binding}).project({snapshotVersion:fixed.snapshotVersion,products});
      if(projected.ok!==true)fail(projected.error==='capacity_limit'?'capacity_limit':'not_ready');
      const finalIdentity=await verify();if(!sameIdentity(initialIdentity,finalIdentity))fail('access_denied');
      const finalGrant=await readGrant(finalIdentity.uid);if(Data.serializeEnrollmentData(finalGrant)!==fingerprint)fail('access_denied');
      // Independent final Auth and canonical snapshots are an observed fence,
      // not an atomic Auth+database revocation guarantee or lasting permission.
      checkBinding();timely(finalIdentity,now());checkBinding();
      return Object.freeze({ok:true,view:History.normalizeLegacyStoredHistory(projected.view,binding)});
    }catch(error){let code='unavailable';try{if(error instanceof ReadError)code=error.code;}catch{}return result(code);}
  }
  return Object.freeze({execute});
}
module.exports=Object.freeze({createProductionLegacyHistoryService,SOURCE_POLICY,MAX_HISTORY_BYTES,MAX_WORKERS});
