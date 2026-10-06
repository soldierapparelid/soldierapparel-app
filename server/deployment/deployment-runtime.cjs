'use strict';
// Shared fixed host assembly. Importing this module does not import a Google
// SDK, read credentials, initialize an app, listen, bill or deploy.
const Http=require('../production-http-handler.cjs');
const Runtime=require('../production-runtime.cjs');
const HistoryCodec=require('../production-legacy-history-archive-codec.cjs');
const APP_NAME='soldier-production-runtime-v1',FUNCTION_NAME='soldierProduction',CLOUD_RUN_SERVICE='soldier-production';
const LIMITS=Object.freeze({region:'asia-southeast1',memory:'512MiB',cpu:1,minInstances:0,maxInstances:1,concurrency:1,timeoutSeconds:60,maxHeaderBytes:32768,maxHeaderPairs:128,maxBodyBytes:32768});
const POLICY=Object.freeze({rateWindowMs:60000,rateLimit:30,deadlineMs:25000,maxInFlight:1});
const ENROLLMENT_PATH='/v1/production/enrollment/claim';
const REVOCATION_PATHS=Object.freeze(['/v1/production/owner/access/revoke','/v1/production/owner/access/resolve']);
const HISTORY_PATH='/v1/production/history/own';
const PATHS=Object.freeze(['/v1/production/session','/v1/production/commands','/v1/production/owner/tariffs/view','/v1/production/owner/tariffs/append','/v1/production/owner/tariffs/resolve',ENROLLMENT_PATH,...REVOCATION_PATHS,HISTORY_PATH]);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
function exact(v,keys){return plain(v)&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return d&&d.enumerable&&Object.hasOwn(d,'value');});}
function dense(v,max){return Array.isArray(v)&&Object.getPrototypeOf(v)===Array.prototype&&v.length<=max&&Reflect.ownKeys(v).length===v.length+1&&Reflect.ownKeys(v).every(k=>k==='length'||typeof k==='string'&&/^(0|[1-9][0-9]*)$/.test(k)&&Number(k)<v.length&&Object.getOwnPropertyDescriptor(v,k)?.enumerable&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'));}
function origin(v){try{const u=new URL(v);return typeof v==='string'&&u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&u.origin===v;}catch{return false;}}
function safeId(v){return typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!['__proto__','prototype','constructor'].includes(v);}
function validateConfiguration(value){
  const keys=['enabled','projectId','databaseURL','tenantId','allowedOrigins','serviceAccount'];
  const hasEnrollment=plain(value)&&Object.hasOwn(value,'enrollmentEnabled');
  const hasRevocation=plain(value)&&Object.hasOwn(value,'identityRevocationEnabled');
  const hasHistory=plain(value)&&Object.hasOwn(value,'legacyHistoryEnabled'),hasArchive=plain(value)&&Object.hasOwn(value,'legacyHistoryArchive');
  if(!exact(value,[...keys,...(hasEnrollment?['enrollmentEnabled']:[]),...(hasRevocation?['identityRevocationEnabled']:[]),...(hasHistory?['legacyHistoryEnabled']:[]),...(hasArchive?['legacyHistoryArchive']:[])])||typeof value.enabled!=='boolean'||hasEnrollment&&typeof value.enrollmentEnabled!=='boolean'||hasRevocation&&typeof value.identityRevocationEnabled!=='boolean'||hasHistory&&typeof value.legacyHistoryEnabled!=='boolean')return null;
  if(value.enabled!==true)return Object.freeze({enabled:false});
  const {projectId,databaseURL,tenantId,allowedOrigins,serviceAccount}=value;
  if(typeof projectId!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)||projectId.startsWith('demo-')||!safeId(tenantId)||!dense(allowedOrigins,8)||!allowedOrigins.length||!allowedOrigins.every(origin)||new Set(allowedOrigins).size!==allowedOrigins.length||serviceAccount!=='soldier-production-runtime@'+projectId+'.iam.gserviceaccount.com')return null;
  try{const u=new URL(databaseURL);if(typeof databaseURL!=='string'||u.protocol!=='https:'||u.origin!==databaseURL||u.port||u.username||u.password||!/^([a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app)$/.test(u.hostname))return null;}catch{return null;}
  let legacyHistoryArchive;
  if(value.legacyHistoryEnabled===true){try{if(!hasArchive||!exact(value.legacyHistoryArchive,['snapshotVersion','publicationProof']))return null;const archive=value.legacyHistoryArchive,scope={projectId,databaseURL,tenantId,snapshotVersion:archive.snapshotVersion};legacyHistoryArchive=Object.freeze({snapshotVersion:archive.snapshotVersion,publicationProof:HistoryCodec.validatePublicationProof(archive.publicationProof,scope)});}catch{return null;}}
  else if(hasArchive&&value.legacyHistoryArchive!==null)return null;
  return Object.freeze({enabled:true,projectId,databaseURL,tenantId,allowedOrigins:Object.freeze([...allowedOrigins]),serviceAccount,...(hasEnrollment?{enrollmentEnabled:value.enrollmentEnabled}:{}),...(hasRevocation?{identityRevocationEnabled:value.identityRevocationEnabled}:{}),...(hasHistory?{legacyHistoryEnabled:value.legacyHistoryEnabled}:{}),...(legacyHistoryArchive?{legacyHistoryArchive}:{})});
}
function environmentMatches(env,config,host){
  if(!plain(env))return false;
  // ADC must come from the managed runtime identity. Never follow a key-file
  // path, local emulator, user ADC override or a differently bound host.
  for(const key of Reflect.ownKeys(env)){
    if(typeof key!=='string')return false;
    if(/EMULATOR/.test(key)||['GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE'].includes(key)){
      const d=Object.getOwnPropertyDescriptor(env,key);if(!d||!Object.hasOwn(d,'value')||d.value!==undefined)return false;
    }
  }
  const read=key=>{const d=Object.getOwnPropertyDescriptor(env,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
  const project=read('GOOGLE_CLOUD_PROJECT'),legacy=read('GCLOUD_PROJECT');
  if(!(project===config.projectId||legacy===config.projectId)||(project!==undefined&&project!==config.projectId)||(legacy!==undefined&&legacy!==config.projectId))return false;
  if(host==='functions')return read('FUNCTION_TARGET')===FUNCTION_NAME&&typeof read('K_SERVICE')==='string'&&/^[a-z][a-z0-9-]{0,62}$/.test(read('K_SERVICE'));
  if(host!=='cloud-run')return false;
  const port=read('PORT'),revision=read('K_REVISION');
  return read('FUNCTION_TARGET')===undefined&&read('FUNCTION_SIGNATURE_TYPE')===undefined&&read('K_SERVICE')===CLOUD_RUN_SERVICE&&read('K_CONFIGURATION')===CLOUD_RUN_SERVICE&&typeof revision==='string'&&revision.length<=63&&new RegExp('^'+CLOUD_RUN_SERVICE+'-[a-z0-9][a-z0-9-]*$').test(revision)&&typeof port==='string'&&/^[1-9][0-9]{0,4}$/.test(port)&&Number(port)<=65535;
}
function reply(res,status,error,originValue,retry,enrollment=false){
  if(res.destroyed||res.writableEnded)return;
  res.statusCode=status;res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Origin');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Type','application/json; charset=utf-8');
  if(originValue)res.setHeader('Access-Control-Allow-Origin',originValue);
  const body={ok:false,error};if(retry)body[enrollment?'retrySameIdentity':'retrySameCommand']=true;res.end(JSON.stringify(body));
}
function headerGate(req,config){
  if(!req||typeof req!=='object'||!plain(req.headers)||!dense(req.rawHeaders,LIMITS.maxHeaderPairs*2)||req.rawHeaders.length%2)return {status:400,error:'invalid_request'};
  let size=0;const seen=new Set();
  for(let i=0;i<req.rawHeaders.length;i+=2){
    const name=req.rawHeaders[i],value=req.rawHeaders[i+1];
    if(typeof name!=='string'||!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)||typeof value!=='string'||/[\r\n\0]/.test(value))return {status:400,error:'invalid_request'};
    size+=Buffer.byteLength(name,'utf8')+Buffer.byteLength(value,'utf8')+4;if(size>LIMITS.maxHeaderBytes)return {status:431,error:'invalid_request'};
    const key=name.toLowerCase();if(['authorization','origin','content-type','content-length','content-encoding','transfer-encoding','expect','trailer','access-control-request-method','access-control-request-headers'].includes(key)){if(seen.has(key))return {status:400,error:'invalid_request'};seen.add(key);}
  }
  const h=req.headers,requestOrigin=h.origin;
  if(!config.allowedOrigins.includes(requestOrigin))return {status:403,error:'access_denied'};
  if(!PATHS.includes(req.url)||req.url===ENROLLMENT_PATH&&config.enrollmentEnabled!==true||REVOCATION_PATHS.includes(req.url)&&config.identityRevocationEnabled!==true||req.url===HISTORY_PATH&&config.legacyHistoryEnabled!==true)return {status:400,error:'invalid_request',origin:requestOrigin};
  const session=req.url===PATHS[0]||req.url===HISTORY_PATH,method=session?'GET':'POST';
  const read=session||req.url===PATHS[2],length=h['content-length'],transfer=h['transfer-encoding'];
  if(h.trailer!==undefined||h.upgrade!==undefined||transfer!==undefined&&transfer!=='chunked'||transfer!==undefined&&length!==undefined||h.expect!==undefined&&(typeof h.expect!=='string'||!/^100-continue$/i.test(h.expect)))return {status:400,error:'invalid_request',origin:requestOrigin};
  if(length!==undefined&&(typeof length!=='string'||!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>LIMITS.maxBodyBytes))return {status:400,error:'invalid_request',origin:requestOrigin};
  if(req.method==='OPTIONS'){if(transfer!==undefined||length!==undefined&&length!=='0')return {status:400,error:'invalid_request',origin:requestOrigin};return {preflight:true,origin:requestOrigin,session,read};}
  if(req.method!==method)return {status:405,error:'invalid_request',origin:requestOrigin};
  if(typeof h.authorization!=='string'||h.authorization.length>16391||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(h.authorization))return {status:400,error:'invalid_request',origin:requestOrigin};
  if(session){if(h['content-type']!==undefined||h['content-encoding']!==undefined||transfer!==undefined||length!==undefined&&length!=='0')return {status:400,error:'invalid_request',origin:requestOrigin};}
  else{
    if(typeof h['content-type']!=='string'||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(h['content-type'])||h['content-encoding']!==undefined||length==='0')return {status:400,error:'invalid_request',origin:requestOrigin};
  }
  return {origin:requestOrigin,session,read};
}
function requestGate(req,config){
  const gate=headerGate(req,config);if(gate.status)return gate;
  const body=req.rawBody,length=req.headers['content-length'];
  if(gate.session||gate.preflight){if(body!==undefined&&(!Buffer.isBuffer(body)||body.length!==0))return {status:400,error:'invalid_request',origin:gate.origin};}
  else if(!Buffer.isBuffer(body)||!body.length||body.length>LIMITS.maxBodyBytes||length!==undefined&&Number(length)!==body.length)return {status:400,error:'invalid_request',origin:gate.origin};
  return gate;
}
function loadAdminSdk(){
  const app=require('firebase-admin/app'),auth=require('firebase-admin/auth'),database=require('firebase-admin/database');
  return {applicationDefault:app.applicationDefault,initializeApp:app.initializeApp,getApps:app.getApps,getAuth:auth.getAuth,getDatabase:database.getDatabase};
}
function createDeployment(options={}){
  const host=options.host;
  const configuration=validateConfiguration(options.configuration);
  if(!configuration||configuration.enabled!==true||!['functions','cloud-run'].includes(host))return Object.freeze({enabled:false,handler:Http.createProductionHttpHandler(),gate:()=>({status:503,error:'service_disabled'})});
  const environment=options.environment===undefined?()=>Object.assign(Object.create(null),process.env):options.environment,load=options.loadAdminSdk===undefined?loadAdminSdk:options.loadAdminSdk,create=options.createRuntime===undefined?Runtime.createProductionRuntime:options.createRuntime;
  if(typeof environment!=='function'||typeof load!=='function'||typeof create!=='function')return Object.freeze({enabled:false,handler:Http.createProductionHttpHandler(),gate:()=>({status:503,error:'service_disabled'})});

  const stub=Object.freeze({execute:async()=>({ok:false,error:'unavailable'}),resolve:async()=>({ok:false,error:'unavailable'}),resolveTariffDraft:async()=>({ok:false,error:'unavailable'})});
  const preflight=Http.createProductionHttpHandler({enabled:true,allowedOrigins:configuration.allowedOrigins,deadlineMs:POLICY.deadlineMs,maxInFlight:POLICY.maxInFlight,service:stub,sessionService:stub,ownerTariffService:stub,ownerTariffWriter:stub,...(configuration.enrollmentEnabled===true?{enrollmentService:stub}:{}),...(configuration.identityRevocationEnabled===true?{identityRevocationService:stub}:{}),...(configuration.legacyHistoryEnabled===true?{legacyHistoryService:stub,historyBinding:{projectId:configuration.projectId,databaseURL:configuration.databaseURL,tenantId:configuration.tenantId}}:{}),ownerBinding:{projectId:configuration.projectId,tenantId:configuration.tenantId}});
  let initialized=null;
  function ready(){
    if(initialized===null)initialized=Promise.resolve().then(()=>{
      if(!environmentMatches(environment(),configuration,host))throw Error('unavailable');
      const sdk=load();if(!sdk||['applicationDefault','initializeApp','getApps','getAuth','getDatabase'].some(k=>typeof sdk[k]!=='function'))throw Error('unavailable');
      const apps=sdk.getApps();if(!Array.isArray(apps)||apps.some(a=>a?.name===APP_NAME))throw Error('unavailable');
      const app=sdk.initializeApp({projectId:configuration.projectId,databaseURL:configuration.databaseURL,credential:sdk.applicationDefault()},APP_NAME);
      if(!app||app.name!==APP_NAME||app.options?.projectId!==configuration.projectId||app.options?.databaseURL!==configuration.databaseURL||!environmentMatches(environment(),configuration,host))throw Error('unavailable');
      const database=sdk.getDatabase(app),auth=sdk.getAuth(app);
      if(database?.app!==app||auth?.app!==app)throw Error('unavailable');
      const runtime=create({enabled:true,projectId:configuration.projectId,databaseURL:configuration.databaseURL,tenantId:configuration.tenantId,allowedOrigins:configuration.allowedOrigins,database,auth,policy:POLICY,enrollmentEnabled:configuration.enrollmentEnabled===true,identityRevocationEnabled:configuration.identityRevocationEnabled===true,legacyHistoryEnabled:configuration.legacyHistoryEnabled===true,...(configuration.legacyHistoryEnabled===true?{legacyHistoryArchive:configuration.legacyHistoryArchive}:{})});
      if(!runtime||typeof runtime.handler!=='function')throw Error('unavailable');return runtime;
    });
    return initialized;
  }
  function gate(req){try{if(!environmentMatches(environment(),configuration,host))return {status:503,error:'unavailable'};return headerGate(req,configuration);}catch{return {status:503,error:'unavailable'};}}
  async function handler(req,res){
    let gated;
    try{
      if(!environmentMatches(environment(),configuration,host)){reply(res,503,'unavailable',undefined,![PATHS[0],PATHS[2],HISTORY_PATH].includes(req?.url),req?.url===ENROLLMENT_PATH);return;}
      gated=requestGate(req,configuration);
      if(gated.status){reply(res,gated.status,gated.error,gated.origin,false);return;}
      if(gated.preflight){await preflight(req,res);return;}
      if(req.aborted||res.destroyed||res.writableEnded)return;
      const runtime=await ready();if(!environmentMatches(environment(),configuration,host)){reply(res,503,'unavailable',gated.origin,!gated.read,req?.url===ENROLLMENT_PATH);return;}
      // The existing handler owns token verification and canonical authorization.
      // Return its promise: never depend on a database write after res.end().
      if(req.aborted||res.destroyed||res.writableEnded)return;
      await runtime.handler(req,res);
    }catch{reply(res,503,'unavailable',gated?.origin,![PATHS[0],PATHS[2],HISTORY_PATH].includes(req?.url),req?.url===ENROLLMENT_PATH);}
  }
  return Object.freeze({enabled:true,handler,gate});
}
function validateEnvironment(value,configuration,host){try{const fixed=validateConfiguration(configuration);return fixed?.enabled===true&&['functions','cloud-run'].includes(host)&&environmentMatches(value,fixed,host);}catch{return false;}}
module.exports=Object.freeze({createDeployment,validateConfiguration,validateEnvironment,LIMITS,POLICY,PATHS,FUNCTION_NAME,CLOUD_RUN_SERVICE});
