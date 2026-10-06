'use strict';
// Isolated source-OFF root CAS adapter. No SDK initialization, HTTP/runtime
// registration, logger, credential, archive publisher or v1 normalization.
const Core=require('./production-legacy-operations.cjs');
const Identity=require('./production-enrollment-identity.cjs');
const CREDENTIAL_ENV=['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN_FILE','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT'];
const DEMO_PROJECT='demo-soldier-security',DEMO_HOST='127.0.0.1:9000',DEMO_URL='https://'+DEMO_PROJECT+'.firebaseio.com';
const DEMO_CREDENTIAL_SOURCE="async()=>({access_token:'owner',expires_in:3600})";
const CODES=new Set(['service_disabled','unavailable','invalid_request','access_denied','not_ready','conflict','capacity_limit','result_unknown','rate_limited','busy']);
const MAX_COMMAND_BYTES=4096,MAX_TOKEN_BYTES=16384,WARM_TIMEOUT_MS=5000;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
class LegacyServiceError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new LegacyServiceError(code);};
const rejected=error=>Object.freeze(error==='result_unknown'?{ok:false,error,retrySameCommand:true}:{ok:false,error});
function field(v,k,code='unavailable'){const d=v&&typeof v==='object'?Object.getOwnPropertyDescriptor(v,k):null;if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail(code);return d.value;}
function exact(v,required,optional=[],code='unavailable'){if(!plain(v)||Reflect.ownKeys(v).some(k=>typeof k!=='string'||!required.includes(k)&&!optional.includes(k))||required.some(k=>!Object.hasOwn(v,k)))fail(code);for(const k of Reflect.ownKeys(v))field(v,k,code);}
function method(v,k){let p=v;for(let n=0;p&&typeof p==='object'&&n<8;n++,p=Object.getPrototypeOf(p)){const d=Object.getOwnPropertyDescriptor(p,k);if(d){if(!Object.hasOwn(d,'value')||typeof d.value!=='function')fail('unavailable');return d.value;}}fail('unavailable');}
function origin(v){let u;try{if(typeof v!=='string')fail('unavailable');u=new URL(v);}catch{fail('unavailable');}if(u.protocol!=='https:'||u.origin!==v||u.username||u.password||u.port||u.search||u.hash||u.pathname!=='/'||!/^([a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app)$/.test(u.hostname))fail('unavailable');return v;}
function instant(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v).toISOString()!==v||Date.parse(v)<0)fail('unavailable');return v;}
function code(error){try{if(error instanceof LegacyServiceError||error instanceof Core.LegacyOperationsError){const d=Object.getOwnPropertyDescriptor(error,'code');if(d&&Object.hasOwn(d,'value')&&CODES.has(d.value))return d.value;}}catch{}return 'unavailable';}
function canonical(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value)){const parts=[];for(let i=0;i<value.length;i++)parts.push(canonical(value[i]));return '['+parts.join(',')+']';}
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
const same=(a,b)=>canonical(Core.copyLegacyRoot(a))===canonical(Core.copyLegacyRoot(b));
function copySdkRoot(value){
  // DataSnapshot.val()/CAS current may contain holes produced by RTDB numeric
  // child normalization. Fill only those SDK representation gaps with null;
  // caller commands and the pure core still reject sparse JSON arrays.
  const seen=new Set();let nodes=0,bytes=0;
  const count=t=>{bytes+=Buffer.byteLength(t,'utf8');if(bytes>Core.MAX_ROOT_BYTES)fail('capacity_limit');};
  function visit(v,depth){
    if(++nodes>150000||depth>32)fail('capacity_limit');
    if(v===null||typeof v==='string'||typeof v==='boolean'){count(JSON.stringify(v));return v;}
    if(typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=Number.MAX_SAFE_INTEGER&&!Object.is(v,-0)){count(JSON.stringify(v));return v;}
    if(!v||typeof v!=='object'||seen.has(v))fail('not_ready');const array=Array.isArray(v),names=Reflect.ownKeys(v);
    if(array?Object.getPrototypeOf(v)!==Array.prototype:!plain(v))fail('not_ready');if(names.length>150000)fail('capacity_limit');
    let keys=names,length=0;
    if(array){
      const d=Object.getOwnPropertyDescriptor(v,'length');if(!d||!Object.hasOwn(d,'value')||!Number.isSafeInteger(d.value)||d.value<0||d.value>150000||names.some(k=>typeof k!=='string'||k!=='length'&&(!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=d.value))||Reflect.ownKeys(Array.prototype).some(k=>typeof k==='string'&&/^(0|[1-9][0-9]*)$/.test(k)))fail('not_ready');length=d.value;keys=Array.from({length},(_,i)=>String(i));
    }else if(names.some(k=>typeof k!=='string'||['__proto__','constructor','prototype','.priority','.value'].includes(k)))fail('not_ready');
    seen.add(v);const out=array?[]:Object.create(null);count(array?'[':'{');
    for(let i=0;i<keys.length;i++){
      const k=keys[i],d=Object.getOwnPropertyDescriptor(v,k);if(i)count(',');if(!array){count(JSON.stringify(k));count(':');}
      if(!d&&!array||d&&(!d.enumerable||!Object.hasOwn(d,'value')))fail('not_ready');
      const selected=visit(d?d.value:null,depth+1);Object.defineProperty(out,k,{value:selected,enumerable:true,writable:true,configurable:true});
    }
    count(array?']':'}');seen.delete(v);return out;
  }
  if(!plain(value))fail('not_ready');return Core.copyLegacyRoot(visit(value,0));
}
function selected(result,keys){exact(result,keys);if(field(result,'ok')!==true)fail('unavailable');return result;}
function unwrap(result,keys){
  if(plain(result)&&Reflect.ownKeys(result).length===2&&Object.hasOwn(result,'error')){exact(result,['ok','error']);if(result.ok===false&&CODES.has(result.error))fail(result.error);}
  return selected(result,keys);
}
function receipt(result){const r=field(result,'receipt');exact(r,['ok','replayed','operationId']);if(r.ok!==true||typeof r.replayed!=='boolean'||typeof r.operationId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(r.operationId)||['__proto__','constructor','prototype'].includes(r.operationId))fail('unavailable');return Object.freeze({ok:true,replayed:r.replayed,operationId:r.operationId});}
function createProductionLegacyOperationsService(options){
  let enabled=false;try{const d=plain(options)&&Object.getOwnPropertyDescriptor(options,'enabled');enabled=!!d&&Object.hasOwn(d,'value')&&d.value===true;}catch{}
  if(!enabled)return Object.freeze({read:async()=>rejected('service_disabled'),execute:async()=>rejected('service_disabled'),resolve:async()=>rejected('service_disabled')});
  let scope,database,auth,app,clock,admit,core,verifier,ref,refMethod,get,transaction,on,off,string,verifyMethod,userMethod,credentialMethod,url,emulator=false,highWater=-1,inFlight=false,currentOperation;
  function environment(){
    if(process.env.FIREBASE_AUTH_EMULATOR_HOST!==undefined||CREDENTIAL_ENV.some(k=>process.env[k]!==undefined))fail('unavailable');
    if(emulator){if(scope.projectId!==DEMO_PROJECT||scope.databaseURL!==DEMO_URL||process.env.FIREBASE_DATABASE_EMULATOR_HOST!==DEMO_HOST)fail('unavailable');}
    else if(process.env.FIREBASE_DATABASE_EMULATOR_HOST!==undefined)fail('unavailable');
  }
  function demoCredential(){const credential=field(app.options,'credential');exact(credential,['getAccessToken']);const fn=field(credential,'getAccessToken');if(typeof fn!=='function'||Function.prototype.toString.call(fn)!==DEMO_CREDENTIAL_SOURCE||credentialMethod&&fn!==credentialMethod)fail('unavailable');return fn;}
  function check(operation=currentOperation){
    try{
      environment();
      if(database.app!==app||auth.app!==app||field(app.options,'projectId')!==scope.projectId||field(app.options,'databaseURL')!==scope.databaseURL||method(database,'ref')!==refMethod||method(auth,'verifyIdToken')!==verifyMethod||method(auth,'getUser')!==userMethod)fail('unavailable');
      if(emulator)demoCredential();
      if(ref&&(method(ref,'get')!==get||method(ref,'transaction')!==transaction||method(ref,'on')!==on||method(ref,'off')!==off||method(ref,'toString')!==string||string.call(ref)!==url))fail('unavailable');
      // Trusted SDK getter / URL callbacks are observable rebinding boundaries.
      if(database.app!==app||auth.app!==app||field(app.options,'projectId')!==scope.projectId||field(app.options,'databaseURL')!==scope.databaseURL||method(database,'ref')!==refMethod||method(auth,'verifyIdToken')!==verifyMethod||method(auth,'getUser')!==userMethod||ref&&(method(ref,'get')!==get||method(ref,'transaction')!==transaction||method(ref,'on')!==on||method(ref,'off')!==off||method(ref,'toString')!==string))fail('unavailable');
      if(emulator)demoCredential();
      environment();
    }catch{if(operation)operation.drift=true;fail('unavailable');}
  }
  function now(){const value=instant(clock()),ms=Date.parse(value);check();if(ms<highWater)fail('unavailable');highWater=ms;return value;}
  try{
    exact(options,['enabled','projectId','databaseURL','tenantId','database','auth','clock','admit','tariffPolicy'],['testOnlyEmulator']);
    scope=Object.freeze({projectId:field(options,'projectId'),databaseURL:origin(field(options,'databaseURL')),tenantId:field(options,'tenantId')});
    if(typeof scope.projectId!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(scope.projectId)||typeof scope.tenantId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(scope.tenantId)||['__proto__','constructor','prototype'].includes(scope.tenantId))fail('unavailable');
    if(Object.hasOwn(options,'testOnlyEmulator')){const flag=field(options,'testOnlyEmulator');if(typeof flag!=='boolean')fail('unavailable');emulator=flag;}
    const tariffPolicy=Core.copyLegacyRoot(field(options,'tariffPolicy'));exact(tariffPolicy,['version','reviewed','timeZone','quantityBasis']);
    if(tariffPolicy.version!=='legacy-jahit-current-v1'||tariffPolicy.reviewed!==true||tariffPolicy.timeZone!=='Asia/Jakarta'||tariffPolicy.quantityBasis!=='good-plus-reject')fail('unavailable');Object.freeze(tariffPolicy);
    database=field(options,'database');auth=field(options,'auth');clock=field(options,'clock');admit=field(options,'admit');if(typeof clock!=='function'||typeof admit!=='function')fail('unavailable');
    app=database.app;refMethod=method(database,'ref');verifyMethod=method(auth,'verifyIdToken');userMethod=method(auth,'getUser');if(emulator)credentialMethod=demoCredential();url=(emulator?'http://'+DEMO_HOST:scope.databaseURL)+'/';check();
    ref=refMethod.call(database,'');get=method(ref,'get');transaction=method(ref,'transaction');on=method(ref,'on');off=method(ref,'off');string=method(ref,'toString');check();
    core=Core.createProductionLegacyOperations({enabled:true,binding:scope,clock:now,tariffPolicy});
    verifier=Identity.createProductionSessionIdentityVerifier({enabled:true,projectId:scope.projectId,auth,clock:now});
  }catch{return Object.freeze({read:async()=>rejected('unavailable'),execute:async()=>rejected('unavailable'),resolve:async()=>rejected('unavailable')});}
  function request(raw,reading){
    exact(raw,reading?['idToken']:['idToken','command'],[],'invalid_request');const idToken=field(raw,'idToken','invalid_request');
    if(typeof idToken!=='string'||!idToken||Buffer.byteLength(idToken,'utf8')>MAX_TOKEN_BYTES||/[\r\n]/.test(idToken))fail('invalid_request');
    if(reading)return {idToken};let command;
    try{command=Core.copyLegacyRoot(field(raw,'command','invalid_request'));if(Buffer.byteLength(Core.serializeLegacyRoot(command),'utf8')>MAX_COMMAND_BYTES)fail('invalid_request');}catch{fail('invalid_request');}
    return {idToken,command};
  }
  async function verify(token,operation){check(operation);const result=await verifier.verify({idToken:token});check(operation);now();if(!result||result.ok!==true){if(result&&['invalid_request','access_denied','unavailable'].includes(result.error))fail(result.error);fail('access_denied');}return result.identity;}
  function timely(who){if(Date.parse(now())>=who.expiresAtMs)fail('access_denied');}
  function snapshotValue(snapshot,operation){
    check(operation);const val=method(snapshot,'val'),pointer=snapshot.ref,pointerString=method(pointer,'toString');
    if(pointerString.call(pointer)!==url){operation.drift=true;fail('unavailable');}check(operation);const value=val.call(snapshot);check(operation);
    const after=snapshot.ref,afterString=method(after,'toString');
    if(method(snapshot,'val')!==val||method(pointer,'toString')!==pointerString||pointerString.call(pointer)!==url||afterString!==pointerString||afterString.call(after)!==url){operation.drift=true;fail('unavailable');}check(operation);
    return copySdkRoot(value);
  }
  async function readRoot(operation){check(operation);const snap=await get.call(ref);check(operation);now();return snapshotValue(snap,operation);}
  function capture(root,who,operation){check(operation);timely(who);const result=unwrap(core.capture({root,identity:who}),['ok','context']);check(operation);timely(who);return result.context;}
  function continuity(initial,current,operation){if(!same(initial,current)){operation.drift=true;fail('access_denied');}}
  function sameIdentity(a,b){return same(a,{...b,verifiedAt:a.verifiedAt});}
  async function admission(who,operation){check(operation);if(await admit(Object.freeze({projectId:scope.projectId,uid:who.uid}))!==true)fail('rate_limited');check(operation);timely(who);}
  async function confirmation(input,identity,context,operation,replayed){
    if(operation.drift)fail('result_unknown');const finalIdentity=await verify(input.idToken,operation);if(!sameIdentity(identity,finalIdentity))fail('access_denied');
    const root=await readRoot(operation);continuity(context,capture(root,finalIdentity,operation),operation);
    const resolved=unwrap(core.resolve({root,identity:finalIdentity,command:input.command}),['ok','receipt']),r=receipt(resolved);if(r.replayed!==true)fail('result_unknown');check(operation);timely(finalIdentity);return Object.freeze({...r,replayed});
  }
  async function run(raw,kind){
    if(inFlight)return rejected('busy');inFlight=true;let dispatched=false;const operation={drift:false};currentOperation=operation;
    try{
      const input=request(raw,kind==='read'),identity=await verify(input.idToken,operation),initial=await readRoot(operation),context=capture(initial,identity,operation);
      if(kind==='read'){
        // Validate the scoped view before charging a trusted UID quota; the
        // final response is rebuilt after fresh Auth and root context checks.
        unwrap(core.read({root:initial,identity}),['ok','view']);await admission(identity,operation);
        const finalIdentity=await verify(input.idToken,operation);if(!sameIdentity(identity,finalIdentity))fail('access_denied');
        const root=await readRoot(operation);continuity(context,capture(root,finalIdentity,operation),operation);
        const result=unwrap(core.read({root,identity:finalIdentity}),['ok','view']);check(operation);timely(finalIdentity);return Object.freeze({ok:true,view:result.view});
      }
      const proposal=unwrap((kind==='resolve'?core.resolve:core.append).call(core,{root:initial,identity,command:input.command}),kind==='resolve'?['ok','receipt']:['ok','next','receipt']);
      const proposedReceipt=receipt(proposal);await admission(identity,operation);
      if(kind==='resolve'||proposedReceipt.replayed)return await confirmation(input,identity,context,operation,true);
      let listener,timer,response,terminal,candidate;
      const ready=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new LegacyServiceError('unavailable')),WARM_TIMEOUT_MS);listener=()=>{clearTimeout(timer);resolve();};try{on.call(ref,'value',listener,reject);}catch{reject(new LegacyServiceError('unavailable'));}});
      try{
        await ready;check(operation);timely(identity);
        // Re-read after the admission/warm callbacks; no cache observation is
        // itself authority. Every CAS invocation validates actual root state.
        const before=await readRoot(operation);continuity(context,capture(before,identity,operation),operation);unwrap(core.append({root:before,identity,command:input.command}),['ok','next','receipt']);
        check(operation);timely(identity);dispatched=true;
        response=await transaction.call(ref,current=>{
          if(operation.drift)return undefined;
          try{
            check(operation);timely(identity);const observed=copySdkRoot(current);continuity(context,capture(observed,identity,operation),operation);
            candidate=unwrap(core.append({root:observed,identity,command:input.command}),['ok','next','receipt']);check(operation);timely(identity);
            return receipt(candidate).replayed?undefined:candidate.next;
          }catch(error){terminal=code(error);return undefined;}
        },undefined,false);
        check(operation);
      }finally{clearTimeout(timer);try{off.call(ref,'value',listener);}catch{}}
      const committed=field(response,'committed');if(typeof committed!=='boolean')fail('result_unknown');
      if(!committed){dispatched=false;if(operation.drift)fail('unavailable');if(terminal)fail(terminal);return await confirmation(input,identity,context,operation,true);}
      // A mutation can already exist. ACK/schema/Auth uncertainty must retain
      // the original requestId and payload; it never implies a rollback.
      const committedRoot=snapshotValue(field(response,'snapshot'),operation);continuity(context,capture(committedRoot,identity,operation),operation);
      if(!candidate||!same(committedRoot,candidate.next))fail('result_unknown');return await confirmation(input,identity,context,operation,false);
    }catch(error){return rejected(dispatched?'result_unknown':code(error));}finally{currentOperation=undefined;inFlight=false;}
  }
  return Object.freeze({read:raw=>run(raw,'read'),execute:raw=>run(raw,'execute'),resolve:raw=>run(raw,'resolve')});
}
module.exports=Object.freeze({createProductionLegacyOperationsService,MAX_COMMAND_BYTES,MAX_TOKEN_BYTES,WARM_TIMEOUT_MS});
