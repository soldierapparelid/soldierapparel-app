'use strict';
// Fixed-scope owner-only SDK adapter, source OFF. No SDK initialization, route,
// bootstrap, reassignment, role editor, wage operation or automatic deployment.
const State=require('./production-identity-state.cjs');
const Identity=require('./production-enrollment-identity.cjs');
const Data=require('./production-enrollment-registry.cjs');
const CREDENTIAL_ENV=['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN_FILE','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT'];
const CODES=new Set(['service_disabled','unavailable','invalid_request','access_denied','capacity_limit','rate_limited','busy','conflict','not_ready','result_unknown']);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
class RevocationError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new RevocationError(code);};
const rejected=error=>Object.freeze(error==='result_unknown'?{ok:false,error,retrySameCommand:true}:{ok:false,error});
function field(v,k,code='unavailable'){const d=v&&typeof v==='object'?Object.getOwnPropertyDescriptor(v,k):null;if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail(code);return d.value;}
function exact(v,required,optional=[],code='unavailable'){if(!plain(v)||Reflect.ownKeys(v).some(k=>typeof k!=='string'||!required.includes(k)&&!optional.includes(k))||required.some(k=>!Object.hasOwn(v,k)))fail(code);for(const k of Reflect.ownKeys(v))field(v,k,code);}
function method(v,k){let p=v;for(let n=0;p&&typeof p==='object'&&n<8;n++,p=Object.getPrototypeOf(p)){const d=Object.getOwnPropertyDescriptor(p,k);if(d){if(!Object.hasOwn(d,'value')||typeof d.value!=='function')fail('unavailable');return d.value;}}fail('unavailable');}
function origin(value){if(typeof value!=='string')fail('unavailable');let u;try{u=new URL(value);}catch{fail('unavailable');}if(u.protocol!=='https:'||u.origin!==value||u.username||u.password||u.port||u.search||u.hash||u.pathname!=='/'||!/^([a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app)$/.test(u.hostname))fail('unavailable');return value;}
function instant(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v).toISOString()!==v||Date.parse(v)<0)fail('unavailable');return v;}
const same=(a,b)=>Data.serializeEnrollmentData(a)===Data.serializeEnrollmentData(b);
function code(error){try{if(error instanceof RevocationError||error instanceof State.IdentityStateError){const d=Object.getOwnPropertyDescriptor(error,'code');if(d&&Object.hasOwn(d,'value')&&CODES.has(d.value))return d.value;}}catch{}return 'unavailable';}
function createProductionIdentityRevocationService(options){
  let enabled=false;try{const d=plain(options)&&Object.getOwnPropertyDescriptor(options,'enabled');enabled=!!d&&Object.hasOwn(d,'value')&&d.value===true;}catch{}
  if(!enabled)return Object.freeze({execute:async()=>rejected('service_disabled'),resolve:async()=>rejected('service_disabled')});
  let scope,database,auth,app,authApp,clock,admit,verifier,ref,refMethod,get,transaction,on,off,string,verifyMethod,userMethod,credentialMethod,emulator=false,url,highWater=-1,inFlight=false;
  function now(){const value=instant(clock()),ms=Date.parse(value);if(ms<highWater)fail('unavailable');highWater=ms;return value;}
  function environment(){
    if(process.env.FIREBASE_AUTH_EMULATOR_HOST!==undefined)fail('unavailable');
    if(emulator){if(scope.projectId!=='demo-soldier-security'||scope.databaseURL!=='https://demo-soldier-security.firebaseio.com'||process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000'||CREDENTIAL_ENV.some(k=>process.env[k]!==undefined))fail('unavailable');}
    else if(process.env.FIREBASE_DATABASE_EMULATOR_HOST!==undefined)fail('unavailable');
  }
  function check(operation){
    try{
      environment();
      if(database.app!==app||field(app.options,'projectId')!==scope.projectId||field(app.options,'databaseURL')!==scope.databaseURL||method(database,'ref')!==refMethod||auth.app!==authApp||field(authApp.options,'projectId')!==scope.projectId||method(auth,'verifyIdToken')!==verifyMethod||method(auth,'getUser')!==userMethod)fail('unavailable');
      if(emulator){const credential=field(app.options,'credential');exact(credential,['getAccessToken']);if(field(credential,'getAccessToken')!==credentialMethod)fail('unavailable');}
      if(ref&&(method(ref,'get')!==get||method(ref,'transaction')!==transaction||method(ref,'on')!==on||method(ref,'off')!==off||method(ref,'toString')!==string||string.call(ref)!==url))fail('unavailable');
      // URL callbacks themselves are another observable rebinding boundary.
      if(database.app!==app||field(app.options,'projectId')!==scope.projectId||field(app.options,'databaseURL')!==scope.databaseURL||method(database,'ref')!==refMethod)fail('unavailable');environment();
      if(auth.app!==authApp||method(auth,'verifyIdToken')!==verifyMethod||method(auth,'getUser')!==userMethod||ref&&(method(ref,'get')!==get||method(ref,'transaction')!==transaction||method(ref,'on')!==on||method(ref,'off')!==off||method(ref,'toString')!==string))fail('unavailable');
    }catch{if(operation)operation.drift=true;fail('unavailable');}
  }
  try{
    exact(options,['enabled','projectId','databaseURL','tenantId','database','auth','clock','admit'],['testOnlyEmulator']);
    scope={projectId:field(options,'projectId'),databaseURL:origin(field(options,'databaseURL')),tenantId:field(options,'tenantId')};
    if(typeof scope.projectId!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(scope.projectId)||typeof scope.tenantId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(scope.tenantId)||['__proto__','constructor','prototype'].includes(scope.tenantId))fail('unavailable');Object.freeze(scope);
    if(Object.hasOwn(options,'testOnlyEmulator')){if(typeof options.testOnlyEmulator!=='boolean')fail('unavailable');emulator=options.testOnlyEmulator;}
    database=field(options,'database');auth=field(options,'auth');clock=field(options,'clock');admit=field(options,'admit');if(typeof clock!=='function'||typeof admit!=='function')fail('unavailable');
    app=database.app;authApp=auth.app;refMethod=method(database,'ref');verifyMethod=method(auth,'verifyIdToken');userMethod=method(auth,'getUser');
    if(emulator){const credential=field(app.options,'credential');exact(credential,['getAccessToken']);credentialMethod=field(credential,'getAccessToken');if(typeof credentialMethod!=='function')fail('unavailable');}
    url=(emulator?'http://127.0.0.1:9000':scope.databaseURL)+'/authorityTenants/'+scope.tenantId;check();ref=refMethod.call(database,'authorityTenants/'+scope.tenantId);get=method(ref,'get');transaction=method(ref,'transaction');on=method(ref,'on');off=method(ref,'off');string=method(ref,'toString');check();
    verifier=Identity.createProductionSessionIdentityVerifier({enabled:true,projectId:scope.projectId,auth,clock:now});
  }catch{return Object.freeze({execute:async()=>rejected('unavailable'),resolve:async()=>rejected('unavailable')});}
  function request(value){
    exact(value,['idToken','command'],[],'invalid_request');const idToken=field(value,'idToken','invalid_request');
    if(typeof idToken!=='string'||!idToken||Buffer.byteLength(idToken,'utf8')>16384||/[\r\n]/.test(idToken))fail('invalid_request');
    let command;try{command=Data.copyEnrollmentData(field(value,'command','invalid_request'));if(Buffer.byteLength(Data.serializeEnrollmentData(command),'utf8')>4096)fail('invalid_request');}catch{fail('invalid_request');}
    return {idToken,command};
  }
  async function verify(token,operation){
    check(operation);const result=await verifier.verify({idToken:token});check(operation);now();
    if(!result||result.ok!==true){if(result&&['invalid_request','access_denied','unavailable'].includes(result.error))fail(result.error);fail('access_denied');}return result.identity;
  }
  function owner(value,identity,operation){
    check(operation);if(Date.parse(now())>=identity.expiresAtMs)fail('access_denied');const current=State.validateIdentityTenant(value,{projectId:scope.projectId,tenantId:scope.tenantId});
    const grant=State.readIdentityGrant(current,{uid:identity.uid,googleSubject:identity.googleSubject});
    if(identity.uid!==current.initialization.ownerUid||grant.profile.owner!==true||grant.profile.active!==true)fail('access_denied');return current;
  }
  function snapshotValue(snapshot,operation){
    check(operation);const val=method(snapshot,'val'),pointer=snapshot.ref,pointerString=method(pointer,'toString');
    if(pointerString.call(pointer)!==url){operation.drift=true;fail('unavailable');}check(operation);const value=val.call(snapshot);check(operation);
    const after=snapshot.ref,afterString=method(after,'toString');
    if(method(snapshot,'val')!==val||method(pointer,'toString')!==pointerString||pointerString.call(pointer)!==url||afterString!==pointerString||afterString.call(after)!==url){operation.drift=true;fail('unavailable');}check(operation);return value;
  }
  async function read(identity,operation){check(operation);const snap=await get.call(ref);check(operation);now();return owner(snapshotValue(snap,operation),identity,operation);}
  function receipt(proposal,replayed){const value={ok:true,replayed,approvalRevision:proposal.approvalRevision};if(Object.hasOwn(proposal,'grantRevision'))value.grantRevision=proposal.grantRevision;return Object.freeze(value);}
  function continuity(a,b,operation){if(!same(a.initialization,b.initialization)||!same(a.workerCatalog,b.workerCatalog)){operation.drift=true;fail('access_denied');}}
  async function confirm(input,initialIdentity,initial,operation,replayed){
    if(operation.drift)fail('result_unknown');const finalIdentity=await verify(input.idToken,operation);
    if(!same(finalIdentity,{...initialIdentity,verifiedAt:finalIdentity.verifiedAt}))fail('access_denied');
    const current=await read(finalIdentity,operation);continuity(initial,current,operation);const resolved=State.revokeIdentityEnrollment(current,input.command,now());
    if(!resolved.replayed)fail('result_unknown');check(operation);return receipt(resolved,replayed);
  }
  async function run(raw,resolving){
    if(inFlight)return rejected('busy');inFlight=true;let dispatched=false,operation={drift:false};
    try{
      const input=request(raw),identity=await verify(input.idToken,operation),initial=await read(identity,operation),proposal=State.revokeIdentityEnrollment(initial,input.command,now());
      if(resolving||proposal.replayed){if(!proposal.replayed)fail('result_unknown');return await confirm(input,identity,initial,operation,true);}
      check(operation);if(await admit(Object.freeze({projectId:scope.projectId,uid:identity.uid}))!==true)fail('rate_limited');check(operation);now();
      let listener,timer,response,terminal,candidate;
      const ready=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new RevocationError('unavailable')),5000);listener=()=>{clearTimeout(timer);resolve();};try{on.call(ref,'value',listener,reject);}catch{reject(new RevocationError('unavailable'));}});
      try{
        await ready;check(operation);now();dispatched=true;
        response=await transaction.call(ref,current=>{
          if(operation.drift)return undefined;
          try{check(operation);now();if(current===null){terminal='not_ready';return undefined;}const observed=owner(current,identity,operation);continuity(initial,observed,operation);candidate=State.revokeIdentityEnrollment(observed,input.command,now());return candidate.replayed?undefined:candidate.next;}catch(error){terminal=code(error);return undefined;}
        },undefined,false);
        check(operation);
      }finally{clearTimeout(timer);try{off.call(ref,'value',listener);}catch{}}
      const didCommit=field(response,'committed');if(typeof didCommit!=='boolean')fail('result_unknown');
      if(!didCommit){dispatched=false;if(operation.drift)fail('unavailable');if(terminal)fail(terminal);return await confirm(input,identity,initial,operation,true);}
      // A real mutation may already exist. Any malformed acknowledgment or
      // failed final Auth/read confirmation remains unknown, never "not saved".
      const committed=owner(snapshotValue(field(response,'snapshot'),operation),identity,operation);continuity(initial,committed,operation);
      if(!candidate||!same(committed,candidate.next))fail('result_unknown');return await confirm(input,identity,initial,operation,false);
    }catch(error){return rejected(dispatched?'result_unknown':code(error));}finally{inFlight=false;}
  }
  return Object.freeze({execute:raw=>run(raw,false),resolve:raw=>run(raw,true)});
}
module.exports=Object.freeze({createProductionIdentityRevocationService});
