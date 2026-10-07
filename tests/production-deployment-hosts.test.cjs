'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Core=require('../server/deployment/deployment-runtime.cjs'),Functions=require('../server/deployment/functions-adapter.cjs');
const PROJECT='soldier-host-proof',DB='https://'+PROJECT+'.firebaseio.com',ORIGIN='https://soldier.example.invalid';
const configuration=()=>({enabled:true,projectId:PROJECT,databaseURL:DB,tenantId:'tenant-proof',allowedOrigins:[ORIGIN],serviceAccount:'soldier-production-runtime@'+PROJECT+'.iam.gserviceaccount.com'});
const environment=()=>({GOOGLE_CLOUD_PROJECT:PROJECT,K_SERVICE:'soldier-production',K_CONFIGURATION:'soldier-production',K_REVISION:'soldier-production-00001-proof',PORT:'8080'});
function request(){const rawBody=Buffer.from('{"command":{"requestId":"synthetic-request"}}'),headers={origin:ORIGIN,authorization:'Bearer header.payload.signature','content-type':'application/json','content-length':String(rawBody.length)};return {method:'POST',url:'/v1/production/commands',headers,rawHeaders:Object.entries(headers).flat(),rawBody};}
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},end(raw){this.raw=raw;this.body=JSON.parse(raw);this.writableEnded=true;}};}
function fixture(changes={}){
  const env=environment(),counts={load:0,adc:0,init:0,runtime:0,requests:0},app={name:'soldier-production-runtime-v1',options:{projectId:PROJECT,databaseURL:DB}},sdk={getApps:()=>[],applicationDefault(){counts.adc++;return {synthetic:true};},initializeApp(){counts.init++;return app;},getAuth:()=>({app}),getDatabase:()=>({app})};
  const core=Core.createDeployment({configuration:configuration(),host:'cloud-run',environment:()=>env,loadAdminSdk:()=>{counts.load++;return sdk;},createRuntime:()=>{counts.runtime++;return {handler:async(req,res)=>{counts.requests++;res.statusCode=200;res.end('{"ok":true}');}};},...changes});
  const run=async(req=request(),res=response())=>{await core.handler(req,res);return res;};return {core,env,counts,sdk,run};
}
test('Cloud Run binding is exact and separate from Functions; hostile environment descriptors stay unread',()=>{
  assert.equal(Core.validateEnvironment(environment(),configuration(),'cloud-run'),true);
  assert.equal(Core.validateEnvironment(environment(),configuration(),'functions'),false);
  for(const patch of [{K_SERVICE:'other'},{K_CONFIGURATION:'other'},{K_REVISION:'other-00001'},{K_REVISION:'soldier-production-'},{K_REVISION:'soldier-production-X'},{PORT:'0'},{PORT:'08080'},{PORT:'65536'},{PORT:8080},{GOOGLE_CLOUD_PROJECT:'foreign'},{GCLOUD_PROJECT:'foreign'},{GOOGLE_APPLICATION_CREDENTIALS:'synthetic-file'},{CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE:''},{FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099'},{FUNCTION_TARGET:'soldierProduction'},{FUNCTION_SIGNATURE_TYPE:'http'}])assert.equal(Core.validateEnvironment({...environment(),...patch},configuration(),'cloud-run'),false);
  let touched=0;const env=environment();Object.defineProperty(env,'GOOGLE_CLOUD_PROJECT',{enumerable:true,get(){touched++;return PROJECT;}});assert.equal(Core.validateEnvironment(env,configuration(),'cloud-run'),false);assert.equal(touched,0);
  assert.equal(Core.validateEnvironment(environment(),configuration(),'unknown'),false);
});
test('pre-body gate binds host and validates headers without consuming a body or importing Admin',()=>{
  const f=fixture(),req=request();delete req.rawBody;Object.defineProperty(req,'body',{get(){throw Error('parsed-body-forbidden');}});assert.deepEqual(f.core.gate(req),{origin:ORIGIN,session:false,read:false});assert.deepEqual(f.counts,{load:0,adc:0,init:0,runtime:0,requests:0});
  f.env.K_REVISION='wrong';assert.deepEqual(f.core.gate(req),{status:503,error:'unavailable'});assert.equal(f.counts.load,0);
});
test('header gate rejects oversized claimed length, ambiguous framing, trailers and duplicate control headers before buffering',()=>{
  for(const mutate of [r=>r.headers['content-length']='32769',r=>r.headers['content-length']='0001',r=>r.headers['transfer-encoding']='chunked',r=>r.headers.trailer='x-synthetic',r=>r.headers.expect='unknown',r=>r.headers['content-encoding']='gzip',r=>r.headers.upgrade='websocket']){const f=fixture(),req=request();delete req.rawBody;mutate(req);req.rawHeaders=Object.entries(req.headers).flat();assert.equal(f.core.gate(req).status,400);assert.equal(f.counts.load,0);}
  const f=fixture(),req=request();delete req.rawBody;delete req.headers['content-length'];req.headers['transfer-encoding']='chunked';req.rawHeaders=Object.entries(req.headers).flat();assert.equal(f.core.gate(req).status,undefined);req.rawHeaders.push('transfer-encoding','chunked');assert.equal(f.core.gate(req).status,400);
});
test('body validation remains before SDK and follows the admitted framing without JSON.parse in assembly',async()=>{
  for(const mutate of [r=>delete r.rawBody,r=>r.rawBody=Buffer.alloc(0),r=>r.rawBody=Buffer.alloc(32769),r=>r.rawBody=Buffer.from('x')]){const f=fixture(),req=request();mutate(req);const res=await f.run(req);assert.equal(res.statusCode,400);assert.equal(f.counts.load,0);}
  const f=fixture(),req=request();delete req.headers['content-length'];req.headers['transfer-encoding']='chunked';req.rawHeaders=Object.entries(req.headers).flat();assert.equal((await f.run(req)).statusCode,200);assert.equal(f.counts.adc,1);assert.equal(f.counts.requests,1);
});
test('disconnects before initialization or during its cold microtask never start business work',async()=>{
  for(const state of ['aborted','destroyed','writableEnded']){const f=fixture(),req=request(),res=response();if(state==='aborted')req.aborted=true;else res[state]=true;await f.run(req,res);assert.equal(f.counts.load,0);assert.equal(f.counts.requests,0);}
  const f=fixture(),req=request(),res=response(),task=f.run(req,res);res.destroyed=true;await task;assert.equal(f.counts.requests,0);
});
test('warm host drift cannot rebind credentials or forward further commands',async()=>{
  const f=fixture();assert.equal((await f.run()).statusCode,200);f.env.K_CONFIGURATION='foreign';const res=await f.run();assert.equal(res.statusCode,503);assert.equal(f.counts.requests,1);assert.equal(f.counts.adc,1);assert.equal(JSON.stringify(res.body).includes('header.payload.signature'),false);
});
test('Functions wrapper stays fixed even with a requested Cloud Run host, and OFF ignores executable option getters',async()=>{
  const f=fixture(),deployment=Functions.createProductionDeployment({configuration:configuration(),host:'cloud-run',environment:()=>f.env,loadAdminSdk:()=>{throw Error('must-not-import');}}),res=response();await deployment.handler(request(),res);assert.equal(res.statusCode,503);
  let touched=0;const options={configuration:{...configuration(),enabled:false}};for(const key of ['environment','loadAdminSdk','createRuntime','host'])Object.defineProperty(options,key,{enumerable:true,get(){touched++;throw Error('getter');}});const off=Functions.createProductionDeployment(options);assert.equal(off.enabled,false);assert.equal(touched,0);
});
test('Functions discovery rejects executable configuration and registration getters without invoking them',()=>{
  let touched=0;
  const getter=()=>{touched++;throw Error('synthetic-private-detail');};
  assert.throws(()=>Functions.createFunctionsExports(Object.defineProperty({},'configuration',{enumerable:true,get:getter})),/invalid_deployment_configuration/);
  const disabled={configuration:{...configuration(),enabled:false}};
  for(const key of ['onRequest','environment','loadAdminSdk','createRuntime'])Object.defineProperty(disabled,key,{enumerable:true,get:getter});
  assert.deepEqual(Functions.createFunctionsExports(disabled),{});
  const enabled={configuration:configuration()};Object.defineProperty(enabled,'onRequest',{enumerable:true,get:getter});
  assert.throws(()=>Functions.createFunctionsExports(enabled),/invalid_deployment_configuration/);
  const badEnvironment={configuration:configuration(),onRequest:()=>{throw Error('must-not-register');}};Object.defineProperty(badEnvironment,'environment',{enumerable:true,get:getter});
  assert.throws(()=>Functions.createFunctionsExports(badEnvironment),/invalid_deployment_configuration/);
  assert.equal(touched,0);
});
