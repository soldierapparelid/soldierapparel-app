'use strict';
// Internal, synchronous, source-OFF coordinator. No RPC, deployment, logger,
// native initialization, credential persistence, owner/QC or enrollment writer.
const Identity=require('./current-google-identity.cjs');
const Transport=require('./rest-root-adapter.cjs');
const Core=require('../production-legacy-operations.cjs');
const Finance=require('../production-legacy-finance.cjs');
const MAX_COMMAND_BYTES=4096,MAX_TOKEN_BYTES=16384;
const DEFAULT_CONFIGURATION=Object.freeze({enabled:false,binding:Object.freeze({projectId:'',databaseURL:'',tenantId:'',apiKey:''})});
const ERRORS=new Set(['service_disabled','unavailable','invalid_request','access_denied','not_ready','conflict','capacity_limit','result_unknown','rate_limited','busy']);
const IDENTITY_KEYS=['projectId','uid','email','googleSubject','authTimeMs','issuedAtMs','expiresAtMs','verifiedAt'];
const COMMAND_KEYS=['kind','requestId','operationId','productId','assignmentId','expectedGrantRevision','expectedSourceVersion','workDate','good','reject'];
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const safe=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
const rejected=error=>Object.freeze(error==='result_unknown'?{ok:false,error,retrySameCommand:true}:{ok:false,error});
class RuntimeError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new RuntimeError(code);};
function field(v,k,code='unavailable'){const d=v&&typeof v==='object'?Object.getOwnPropertyDescriptor(v,k):null;if(!d?.enumerable||!Object.hasOwn(d,'value'))fail(code);return d.value;}
function exact(v,keys,code='unavailable'){if(!plain(v)||Reflect.ownKeys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail(code);for(const k of keys)field(v,k,code);}
function method(v,k){for(let p=v,n=0;p&&typeof p==='object'&&n<8;p=Object.getPrototypeOf(p),n++){const d=Object.getOwnPropertyDescriptor(p,k);if(d){if(!Object.hasOwn(d,'value')||typeof d.value!=='function')fail('unavailable');return d.value;}}fail('unavailable');}
function canonical(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';}
function same(a,b){return canonical(Core.copyLegacyRoot(a))===canonical(Core.copyLegacyRoot(b));}
function sameIdentity(a,b){return same(a,{...b,verifiedAt:a.verifiedAt});}
function unwrap(v,keys){
  if(plain(v)&&Object.hasOwn(v,'error')){const error=field(v,'error');exact(v,error==='result_unknown'&&Object.hasOwn(v,'retrySameCommand')?['ok','error','retrySameCommand']:['ok','error']);if(v.ok===false&&ERRORS.has(error)){if(Object.hasOwn(v,'retrySameCommand')&&v.retrySameCommand!==true)fail('unavailable');fail(error);}fail('unavailable');}
  exact(v,keys);if(v.ok!==true)fail('unavailable');return v;
}
function receipt(v){const r=field(v,'receipt');exact(r,['ok','replayed','operationId']);if(r.ok!==true||typeof r.replayed!=='boolean'||!safe(r.operationId))fail('unavailable');return Object.freeze({ok:true,replayed:r.replayed,operationId:r.operationId});}
function createAppsScriptLegacyRuntime(options={}){
  let enabled=false;try{const d=plain(options)&&Object.getOwnPropertyDescriptor(options,'enabled');enabled=!!d&&Object.hasOwn(d,'value')&&d.value===true;}catch{}
  const denied=error=>Object.freeze({read:()=>rejected(error),readFinance:()=>rejected(error),execute:()=>rejected(error),resolve:()=>rejected(error)});
  if(!enabled)return denied('service_disabled');
  let binding,host,script,fetch,oauth,clock,requestAdmission,identityAdmission,verifier,transport,core,finance;
  let highWater=-1,drift=false,busy=false,currentToken='',lastIdentity=null,verificationFailure=null;
  function check(){if(drift)fail('unavailable');try{if(method(host,'fetch')!==fetch||method(script,'getOAuthToken')!==oauth)fail('unavailable');}catch{drift=true;fail('unavailable');}}
  function now(){check();const v=clock();check();if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v||Date.parse(v)<0||Date.parse(v)<highWater)fail('unavailable');highWater=Date.parse(v);return v;}
  function verify(){
    try{check();if(!currentToken)fail('access_denied');const r=unwrap(verifier.verify({idToken:currentToken}),['ok','identity']);check();exact(r.identity,IDENTITY_KEYS,'access_denied');
      lastIdentity=Object.freeze({...r.identity});if(lastIdentity.expiresAtMs<=Date.parse(now()))fail('access_denied');return lastIdentity;
    }catch(error){verificationFailure=error instanceof RuntimeError&&['invalid_request','access_denied','unavailable'].includes(error.code)?error.code:'unavailable';throw error;}
  }
  try{
    exact(options,['enabled','binding','urlFetchApp','scriptApp','clock','requestAdmission','identityAdmission','tariffPolicy']);
    const selected=field(options,'binding');exact(selected,['projectId','databaseURL','tenantId','apiKey']);binding=Object.freeze({...selected});
    if(typeof binding.projectId!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(binding.projectId)||!safe(binding.tenantId)||/^\d+$/.test(binding.tenantId)||typeof binding.apiKey!=='string'||!/^[A-Za-z0-9_-]{20,128}$/.test(binding.apiKey)||typeof binding.databaseURL!=='string'||binding.databaseURL.length>256||!/^https:\/\/([a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app)$/.test(binding.databaseURL))fail('unavailable');
    const tariffPolicy=Core.copyLegacyRoot(field(options,'tariffPolicy'));exact(tariffPolicy,['version','reviewed','timeZone','quantityBasis']);if(tariffPolicy.version!=='legacy-jahit-current-v1'||tariffPolicy.reviewed!==true||tariffPolicy.timeZone!=='Asia/Jakarta'||tariffPolicy.quantityBasis!=='good-plus-reject')fail('unavailable');Object.freeze(tariffPolicy);
    host=field(options,'urlFetchApp');script=field(options,'scriptApp');fetch=method(host,'fetch');oauth=method(script,'getOAuthToken');clock=field(options,'clock');requestAdmission=field(options,'requestAdmission');identityAdmission=field(options,'identityAdmission');
    if([clock,requestAdmission,identityAdmission].some(v=>typeof v!=='function'))fail('unavailable');check();
    verifier=Identity.createAppsScriptSessionGoogleIdentityVerifier({enabled:true,binding:{projectId:binding.projectId,apiKey:binding.apiKey},urlFetchApp:host,clock:now});
    const rootBinding=Object.freeze({projectId:binding.projectId,databaseURL:binding.databaseURL,tenantId:binding.tenantId});
    transport=Transport.createAppsScriptRestRootAdapter({enabled:true,binding:rootBinding,urlFetchApp:host,scriptApp:script,verifyCurrentIdentity:verify,clock:now});
    const pureOptions={enabled:true,binding:rootBinding,clock:now,tariffPolicy};core=Core.createProductionLegacyOperations(pureOptions);finance=Finance.createProductionLegacyFinance(pureOptions);
  }catch{return denied('unavailable');}
  function request(raw,kind){
    const reading=kind==='read'||kind==='readFinance';exact(raw,reading?['idToken']:['idToken','command'],'invalid_request');const token=field(raw,'idToken','invalid_request');
    if(typeof token!=='string'||!token||token.length>MAX_TOKEN_BYTES||/[\r\n]/.test(token))fail('invalid_request');
    if(reading)return {token,command:null};let command;
    try{command=Core.copyLegacyRoot(field(raw,'command','invalid_request'));if(Buffer.byteLength(Core.serializeLegacyRoot(command),'utf8')>MAX_COMMAND_BYTES)fail('invalid_request');}catch{fail('invalid_request');}
    exact(command,COMMAND_KEYS,'invalid_request');if(command.kind!=='appendJahit')fail('invalid_request');
    for(const k of ['requestId','operationId','productId','assignmentId'])if(!safe(command[k]))fail('invalid_request');
    if(/^\d+$/.test(command.requestId)||/^\d+$/.test(command.operationId)||!Number.isSafeInteger(command.expectedGrantRevision)||command.expectedGrantRevision<1||typeof command.expectedSourceVersion!=='string'||!/^[a-f0-9]{64}$/.test(command.expectedSourceVersion))fail('invalid_request');
    for(const k of ['good','reject'])if(!Number.isSafeInteger(command[k])||command[k]<0)fail('invalid_request');if(!Number.isSafeInteger(command.good+command.reject)||command.good+command.reject<1)fail('invalid_request');
    const day=command.workDate;if(day!==null&&(typeof day!=='string'||!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+'T00:00:00.000Z'))||new Date(day+'T00:00:00.000Z').toISOString().slice(0,10)!==day))fail('invalid_request');
    return {token,command};
  }
  function admission(kind){
    // Shared durable admission must reserve the accepted-response envelope
    // BEFORE any Google/database call. Native buffering can exceed this parser
    // envelope: it is not a measured download ceiling or a free-capacity proof.
    // Process-local counters or unconditional true are invalid in production.
    const write=kind==='execute',budget=Object.freeze({projectId:binding.projectId,kind,now:now(),maxDatabaseDownloadBytes:(write?3:2)*Transport.MAX_BYTES,maxGoogleLookupCount:write?14:10});
    if(requestAdmission(budget)!==true)fail('rate_limited');check();
    const who=verify(),initial=Object.freeze({...who});
    if(identityAdmission(Object.freeze({projectId:binding.projectId,uid:who.uid,email:who.email,googleSubject:who.googleSubject,kind,now:now()}))!==true)fail('access_denied');check();
    if(who.expiresAtMs<=Date.parse(now()))fail('access_denied');return initial;
  }
  function readRoot(initial){
    verificationFailure=null;const observed=transport.read();check();if(verificationFailure)fail(verificationFailure);
    const r=unwrap(observed,['ok','etag','root']);if(!lastIdentity||!sameIdentity(initial,lastIdentity))fail('access_denied');return r;
  }
  function capture(root){const r=unwrap(core.capture({root,identity:lastIdentity}),['ok','context']);check();return r.context;}
  function continuity(context,current){if(!same(context,current))fail('access_denied');}
  function confirmed(initial,context,command,replayed){
    const latest=readRoot(initial);continuity(context,capture(latest.root));const r=receipt(unwrap(core.resolve({root:latest.root,identity:lastIdentity,command}),['ok','receipt']));
    if(r.replayed!==true)fail('result_unknown');if(lastIdentity.expiresAtMs<=Date.parse(now()))fail('access_denied');check();return Object.freeze({...r,replayed});
  }
  function run(raw,kind,args){
    if(busy)return rejected('busy');busy=true;let writeAttempted=false,parsed=null;
    try{
      if(args!==1)fail('invalid_request');parsed=request(raw,kind);currentToken=parsed.token;const initial=admission(kind),first=readRoot(initial),context=capture(first.root);
      if(kind==='read'||kind==='readFinance'){
        const lane=kind==='read'?core:finance;unwrap(lane.read({root:first.root,identity:lastIdentity}),['ok','view']);
        const latest=readRoot(initial);continuity(context,capture(latest.root));const r=unwrap(lane.read({root:latest.root,identity:lastIdentity}),['ok','view']);
        if(lastIdentity.expiresAtMs<=Date.parse(now()))fail('access_denied');check();return Object.freeze({ok:true,view:r.view});
      }
      const resolving=kind==='resolve',proposal=unwrap((resolving?core.resolve:core.append)({root:first.root,identity:lastIdentity,command:parsed.command}),resolving?['ok','receipt']:['ok','next','receipt']),proposedReceipt=receipt(proposal);
      if(resolving||proposedReceipt.replayed)return confirmed(initial,context,parsed.command,true);
      // The candidate and its durable receipt derive from the exact root whose
      // ETag guards this ONE PUT. A fresh account check runs inside transport;
      // a changed grant/root makes If-Match fail. Never retry a conflict here.
      check();writeAttempted=true;const ack=transport.compareAndSwap({expectedETag:first.etag,next:proposal.next});
      if(plain(ack)&&Reflect.ownKeys(ack).length===2&&ack.ok===false&&ack.error==='conflict'){exact(ack,['ok','error']);writeAttempted=false;fail('conflict');}
      unwrap(ack,['ok','storageAcknowledged','etag']);if(ack.storageAcknowledged!==true||!lastIdentity||!sameIdentity(initial,lastIdentity))fail('result_unknown');check();
      return confirmed(initial,context,parsed.command,false);
    }catch(error){let code='unavailable';try{if(error instanceof RuntimeError&&ERRORS.has(error.code))code=error.code;}catch{}return rejected(writeAttempted?'result_unknown':code);}
    finally{currentToken='';lastIdentity=null;verificationFailure=null;if(parsed)parsed.token='';parsed=null;busy=false;}
  }
  return Object.freeze({read:function(raw){return run(raw,'read',arguments.length);},readFinance:function(raw){return run(raw,'readFinance',arguments.length);},execute:function(raw){return run(raw,'execute',arguments.length);},resolve:function(raw){return run(raw,'resolve',arguments.length);}});
}
module.exports=Object.freeze({createAppsScriptLegacyRuntime,DEFAULT_CONFIGURATION,MAX_COMMAND_BYTES,MAX_TOKEN_BYTES});
