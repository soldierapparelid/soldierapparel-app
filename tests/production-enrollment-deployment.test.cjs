'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Deployment=require('../server/deployment/deployment-runtime.cjs');
const Runtime=require('../server/production-runtime.cjs');
const PROJECT='soldier-enrollment-proof',URL='https://'+PROJECT+'.firebaseio.com',ORIGIN='https://soldier.example.invalid';
const PATH='/v1/production/enrollment/claim',TOKEN='synthetic.enrollment.token',NOW='2026-02-02T03:00:00.000Z';
const EMAIL='synthetic.enrollment.2001@gmail.com',SUBJECT='google-synthetic-2001',UID='caller-synthetic-2001';
const config=()=>({enabled:true,projectId:PROJECT,databaseURL:URL,tenantId:'tenant-synthetic',allowedOrigins:[ORIGIN],serviceAccount:'soldier-production-runtime@'+PROJECT+'.iam.gserviceaccount.com'});
const environment=()=>({GOOGLE_CLOUD_PROJECT:PROJECT,GCLOUD_PROJECT:PROJECT,FUNCTION_TARGET:'soldierProduction',K_SERVICE:'soldierproduction'});
function request(body='{}'){const raw=Buffer.from(body),headers={origin:ORIGIN,authorization:'Bearer '+TOKEN,'content-type':'application/json','content-length':String(raw.length)};return {method:'POST',url:PATH,headers,rawHeaders:Object.entries(headers).flat(),rawBody:raw};}
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},end(v){this.body=JSON.parse(v);this.writableEnded=true;}};}
async function run(instance,req=request()){const res=response();await instance.handler(req,res);return res;}
function assembly(configuration=config()){
  const env=environment(),counts={load:0,adc:0,init:0,runtime:0,forward:0},calls={};
  const sdk={getApps:()=>[],applicationDefault:()=>{counts.adc++;return {};},initializeApp:(options,name)=>{counts.init++;return {name,options};},getAuth:app=>({app}),getDatabase:app=>({app})};
  const deployment=Deployment.createDeployment({host:'functions',configuration,environment:()=>env,loadAdminSdk:()=>{counts.load++;return sdk;},createRuntime:opts=>{counts.runtime++;calls.options=opts;return {handler:async(req,res)=>{counts.forward++;res.statusCode=200;res.end('{"ok":true}');}};}});
  return {deployment,counts,calls,env};
}
test('source remains OFF and enrollment cannot be enabled with an absent, false, or inherited flag',async()=>{
  const source=require('../server/deployment/configuration.cjs');assert.equal(source.enabled,false);assert.equal(source.enrollmentEnabled,false);
  for(const c of [config(),{...config(),enrollmentEnabled:false},Object.assign(Object.create({enrollmentEnabled:true}),config())]){
    const f=assembly(c),r=await run(f.deployment);assert.ok([400,503].includes(r.statusCode));assert.deepEqual(f.counts,{load:0,adc:0,init:0,runtime:0,forward:0});
  }
});
test('malformed or accessor enrollment flags never execute accessors or initialize SDK',async()=>{
  let touched=0;const accessor=config();Object.defineProperty(accessor,'enrollmentEnabled',{enumerable:true,get(){touched++;return true;}});
  const hidden=config();Object.defineProperty(hidden,'enrollmentEnabled',{value:true});
  for(const c of [accessor,hidden,{...config(),enrollmentEnabled:'true'},{...config(),enrollmentEnabled:1}]){
    const f=assembly(c);assert.equal((await run(f.deployment)).statusCode,503);assert.equal(f.counts.load,0);
  }
  assert.equal(touched,0);
});
test('disabled claim header gate rejects before body access and environment activation is ignored',async()=>{
  const f=assembly();f.env.ENROLLMENT_ENABLED='true';f.env.SOLDIER_ENROLLMENT_ENABLED='true';let touched=0;
  const req=request();Object.defineProperty(req,'rawBody',{get(){touched++;throw Error('SYNTHETIC_BODY_CANARY');}});
  assert.equal(f.deployment.gate(req).status,400);assert.equal((await run(f.deployment,req)).statusCode,400);assert.equal(touched,0);assert.equal(f.counts.load,0);
});
test('explicit source opt-in is snapshotted and forwarded with the fixed server scope',async()=>{
  const c={...config(),enrollmentEnabled:true},f=assembly(c);c.enrollmentEnabled=false;c.tenantId='other-tenant';
  assert.equal((await run(f.deployment)).statusCode,200);assert.equal(f.calls.options.enrollmentEnabled,true);assert.equal(f.calls.options.tenantId,'tenant-synthetic');assert.equal(f.calls.options.projectId,PROJECT);assert.equal(f.counts.init,1);
  const off={...config(),enrollmentEnabled:false},b=assembly(off);off.enrollmentEnabled=true;assert.equal((await run(b.deployment)).statusCode,400);assert.equal(b.counts.load,0);
});
test('opted-in preflight is POST-only and handled before ADC while disabled preflight stays denied',async()=>{
  for(const enabled of [false,true]){const f=assembly({...config(),enrollmentEnabled:enabled}),req=request();req.method='OPTIONS';req.headers={origin:ORIGIN,'access-control-request-method':'POST','access-control-request-headers':'authorization, content-type'};req.rawHeaders=Object.entries(req.headers).flat();delete req.rawBody;
    const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(v){this.raw=v;this.writableEnded=true;}};await f.deployment.handler(req,res);assert.equal(res.statusCode,enabled?204:400);assert.equal(f.counts.load,0);if(enabled)assert.equal(res.headers['Access-Control-Allow-Methods'],'POST');
    req.headers['access-control-request-method']='GET';req.rawHeaders=Object.entries(req.headers).flat();assert.equal((await run(f.deployment,req)).statusCode,400);assert.equal(f.counts.load,0);
  }
});
test('host binding failures return only a generic retry of the same identity',async()=>{
  const f=assembly({...config(),enrollmentEnabled:true});f.env.GOOGLE_APPLICATION_CREDENTIALS='SYNTHETIC_CREDENTIAL_CANARY';
  const r=await run(f.deployment);assert.equal(r.statusCode,503);assert.deepEqual(r.body,{ok:false,error:'unavailable',retrySameIdentity:true});assert.equal(f.counts.load,0);
});
function runtimeFixture(enrollmentEnabled){
  const copy=v=>JSON.parse(JSON.stringify(v)),app={options:{projectId:PROJECT,databaseURL:URL}},stats={auth:0,users:0,writes:0,paths:[]};
  let state={schemaVersion:1,projectId:PROJECT,tenantId:'tenant-synthetic',grants:{'owner-synthetic':{revision:1,profile:{active:true,owner:true}}},products:{},enrollmentRegistry:{schemaVersion:1,approvals:{'approval-synthetic':{email:EMAIL,profile:{active:true,owner:false,modules:{qc:true}},reviewed:true,approvedAt:'2026-02-01T00:00:00.000Z',expiresAt:'2026-03-01T00:00:00.000Z',revision:1,status:'pending'}}}};
  const snapshot=v=>({val:()=>copy(v)}),database={app,ref(path){stats.paths.push(path);assert.equal(path,'authorityTenants/tenant-synthetic');return {toString:()=>URL+'/'+path,get:async()=>snapshot(state),on(event,fn){assert.equal(event,'value');queueMicrotask(()=>fn(snapshot(state)));},off(){},async transaction(update){const next=update(copy(state));if(next===undefined)return {committed:false};state=copy(next);stats.writes++;return {committed:true,snapshot:snapshot(state)};}};}};
  const auth={app,async verifyIdToken(token,revoked){stats.auth++;assert.equal(token,TOKEN);assert.equal(revoked,true);const seconds=Date.parse(NOW)/1000;return {uid:UID,sub:UID,aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,email:EMAIL,email_verified:true,auth_time:seconds,iat:seconds,exp:seconds+3600,firebase:{sign_in_provider:'google.com',identities:{'google.com':[SUBJECT]}}};},async getUser(uid){stats.users++;assert.equal(uid,UID);return {uid,email:EMAIL,emailVerified:true,disabled:false,providerData:[{providerId:'google.com',uid:SUBJECT,email:EMAIL}]};}};
  const options={enabled:true,projectId:PROJECT,databaseURL:URL,tenantId:'tenant-synthetic',database,auth,allowedOrigins:[ORIGIN],clock:()=>NOW,policy:{rateWindowMs:60000,rateLimit:30,deadlineMs:1000,maxInFlight:1}};
  if(enrollmentEnabled!==undefined)options.enrollmentEnabled=enrollmentEnabled;
  return {options,stats,get state(){return state;}};
}
test('real runtime assembly keeps claim unregistered by default and rejects an accessor opt-in without Auth',async()=>{
  for(const enabled of [undefined,false]){const f=runtimeFixture(enabled);assert.equal((await run(Runtime.createProductionRuntime(f.options))).statusCode,400);assert.equal(f.stats.auth,0);assert.equal(f.stats.writes,0);}
  const f=runtimeFixture(),options=f.options;let touched=0;Object.defineProperty(options,'enrollmentEnabled',{enumerable:true,get(){touched++;return true;}});assert.equal((await run(Runtime.createProductionRuntime(options))).statusCode,503);assert.equal(touched,0);assert.equal(f.stats.auth,0);assert.equal(f.stats.writes,0);
});
test('explicitly enabled real runtime binds fresh Google identity once and exposes only ok',async()=>{
  const f=runtimeFixture(true),runtime=Runtime.createProductionRuntime(f.options),original=JSON.stringify(f.state.products);
  const r=await run(runtime);assert.equal(r.statusCode,200);assert.deepEqual(r.body,{ok:true});assert.equal(f.stats.writes,1);assert.equal(f.stats.auth,1);assert.equal(f.stats.users,1);assert.deepEqual(f.state.grants[UID],{revision:1,profile:{active:true,owner:false,modules:{qc:true}}});assert.equal(f.state.enrollmentRegistry.approvals['approval-synthetic'].claim.uid,UID);assert.equal(JSON.stringify(f.state.products),original);
  const replay=await run(runtime);assert.deepEqual(replay.body,{ok:true});assert.equal(f.state.grants[UID].revision,1);assert.equal(f.state.enrollmentRegistry.approvals['approval-synthetic'].admission.count,2);
});
test('enabled real runtime refuses caller selectors before Auth and leaves the registry unchanged',async()=>{
  for(const body of ['{"email":"other@example.invalid"}','{"workerId":"other-worker"}','{"role":"owner"}','{"uid":"other-user"}','{"tenantId":"other-tenant"}']){const f=runtimeFixture(true),before=JSON.stringify(f.state),r=await run(Runtime.createProductionRuntime(f.options),request(body));assert.equal(r.statusCode,400);assert.equal(f.stats.auth,0);assert.equal(f.stats.writes,0);assert.equal(JSON.stringify(f.state),before);}
});
