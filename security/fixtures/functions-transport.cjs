'use strict';
// Synthetic transport fixture only. No real token verification, database SDK,
// credential lookup, cloud project, deployment, or business values are used.
const Http=require('../../server/production-http-handler.cjs');
const Deployment=require('../../server/deployment/functions-adapter.cjs');
const PROJECT='soldier-transport-proof',DATABASE='https://soldier-transport-proof-default-rtdb.firebaseio.com',ORIGIN='https://transport.example.invalid';
const NOW='2026-01-01T00:00:00.000Z',TOKEN='header.payload.signature';
const PATHS=Object.freeze({command:'/v1/production/commands',session:'/v1/production/session',view:'/v1/production/owner/tariffs/view',append:'/v1/production/owner/tariffs/append',resolve:'/v1/production/owner/tariffs/resolve'});
const configuration=()=>({enabled:true,projectId:PROJECT,databaseURL:DATABASE,tenantId:'transport-tenant',allowedOrigins:[ORIGIN],serviceAccount:'soldier-production-runtime@'+PROJECT+'.iam.gserviceaccount.com'});
const tariffCommand=()=>({kind:'appendTariffVersion',requestId:'transport-tariff-request',productId:'transport-product',cycleId:'transport-cycle',expectedConfigRevision:0,expectedTariffRevision:0,workerId:'transport-worker',tariffVersion:'transport-tariff-version',effectiveAt:'2026-01-01T01:00:00.000Z',currency:'IDR',rate:100});
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function createFixture({deadlineMs=1000}={}){
  const counts={entries:0,load:0,adc:0,initialize:0,runtime:0,requests:0,operations:0,session:0,view:0,append:0,resolve:0,settled:0};
  const captures=[];let nextPause=null;
  async function operation(kind,args,build){
    counts[kind]++;const pause=nextPause;nextPause=null;
    if(pause){pause.started.resolve();await pause.release.promise;}
    const result=build(args);if(pause)pause.completed.resolve();return result;
  }
  const service={execute:args=>operation('operations',args,({idToken,command})=>{
    if(idToken!==TOKEN||typeof command.requestId!=='string')return {ok:false,error:'access_denied'};
    return {ok:true,receipt:{requestId:command.requestId,revision:1,acceptedAt:NOW},replayed:false};
  })};
  const sessionService={execute:args=>operation('session',args,()=>({ok:true,session:{schemaVersion:1,projectId:PROJECT,databaseURL:DATABASE,tenantId:'transport-tenant',uid:'transport-owner',grantRevision:0,profile:{active:true,owner:true},cycles:[{productId:'transport-product',cycleId:'transport-cycle'}]}}))};
  const ownerTariffService={execute:args=>operation('view',args,({selection})=>({ok:true,view:{schemaVersion:1,projectId:PROJECT,tenantId:'transport-tenant',uid:'transport-owner',grantRevision:0,...selection,configRevision:0,tariffRevision:0,serverTime:NOW,policy:{version:'transport-day',kind:'jakarta-fixed-local-time',hour:0,minute:0},workers:[{workerId:'transport-worker',label:'Synthetic transport worker',assignedQuantity:1,history:[{tariffVersion:'transport-original',effectiveAt:NOW,currency:'IDR',rate:100}]}]}}))};
  const ownerTariffWriter={
    execute:args=>operation('append',args,({command:c})=>({ok:true,replayed:false,receipt:{requestId:c.requestId,kind:c.kind,productId:c.productId,cycleId:c.cycleId,workerId:c.workerId,tariffVersion:c.tariffVersion,revision:c.expectedTariffRevision+1,acceptedAt:NOW}})),
    resolveTariffDraft:args=>operation('resolve',args,({command:c})=>({ok:true,outcome:'retired',replayed:false,receipt:{requestId:c.requestId,kind:'retireTariffDraft',productId:c.productId,cycleId:c.cycleId,workerId:c.workerId,tariffVersion:c.tariffVersion,retiredAt:NOW}}))
  };
  const sdk={
    getApps:()=>[],applicationDefault:()=>{counts.adc++;return {synthetic:true};},
    initializeApp:(options,name)=>{counts.initialize++;return {name,options};},
    getAuth:app=>({app,verifyIdToken(){throw Error('real_auth_forbidden');}}),
    getDatabase:app=>({app,ref(){throw Error('real_database_forbidden');}})
  };
  const options={configuration:configuration(),environment:()=>({GOOGLE_CLOUD_PROJECT:PROJECT,GCLOUD_PROJECT:PROJECT,FUNCTION_TARGET:Deployment.FUNCTION_NAME,K_SERVICE:'synthetic-transport'}),loadAdminSdk:()=>{counts.load++;return sdk;},createRuntime:()=>{
    counts.runtime++;
    const handler=Http.createProductionHttpHandler({enabled:true,allowedOrigins:[ORIGIN],deadlineMs,maxInFlight:1,service,sessionService,ownerTariffService,ownerTariffWriter,ownerBinding:{projectId:PROJECT,tenantId:'transport-tenant'}});
    return {handler:async(req,res)=>{
      counts.requests++;
      // Retained only in this test process. It is never returned to callers or
      // printed, and contains deliberately synthetic requests only.
      captures.push({url:req.url,rawBody:Buffer.isBuffer(req.rawBody)?Buffer.from(req.rawBody):undefined,parsedBody:req.body,rawHeaders:[...req.rawHeaders]});
      try{await handler(req,res);}finally{counts.settled++;}
    }};
  }};
  return {
    counts,captures,
    createExports:onRequest=>Deployment.createFunctionsExports({...options,onRequest:(functionOptions,handler)=>onRequest(functionOptions,async(req,res)=>{counts.entries++;await handler(req,res);})}),
    pauseNext(){if(nextPause)throw Error('already_paused');const pause={started:deferred(),release:deferred(),completed:deferred()};nextPause=pause;return {started:pause.started.promise,completed:pause.completed.promise,release:()=>pause.release.resolve()};}
  };
}
module.exports=Object.freeze({createFixture,configuration,tariffCommand,PROJECT,DATABASE,ORIGIN,NOW,TOKEN,PATHS});
