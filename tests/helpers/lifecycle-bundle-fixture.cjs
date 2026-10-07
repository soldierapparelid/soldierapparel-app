'use strict';
// Generated V8 graph with synthetic hosts only. No native network or real data.
const vm=require('node:vm'),crypto=require('node:crypto');
const Builder=require('../../server/apps-script/build-lifecycle-runtime-bundle.cjs'),{fixture:production,POLICY}=require('../fixtures/legacy-lifecycle.cjs');
const F=require('../fixtures/identity-tenant.cjs');
const KEY='SYNTHETIC_PUBLIC_KEY_0000000000000',OAUTH='SYNTHETIC_MANAGED_OAUTH';
function createLifecycleBundleFixture(division='qc'){
  const f=production(),who=division==='owner'?F.identity({uid:'owner-1',email:'syntheticowner@gmail.com',googleSubject:'1000099999999'}):division==='qc'?f.qc:f.partner,sec=Date.parse(F.NOW)/1000,enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const payload={sub:who.uid,aud:F.PROJECT,iss:'https://securetoken.google.com/'+F.PROJECT,email:who.email,email_verified:true,firebase:{sign_in_provider:'google.com',identities:{'google.com':[who.googleSubject]}},auth_time:sec-1,iat:sec-1,exp:sec+3600};
  const token=enc({alg:'RS256',kid:'synthetic-key',typ:'JWT'})+'.'+enc(payload)+'.'+Buffer.alloc(256,19).toString('base64url');
  const account={localId:who.uid,email:who.email,emailVerified:true,disabled:false,validSince:String(sec-300),providerUserInfo:[{providerId:'google.com',rawId:who.googleSubject,email:who.email}]};
  const seed={root:f.root,token,account,binding:{...f.binding,apiKey:KEY},tariffPolicy:POLICY,clock:F.NOW,identity:{projectId:F.PROJECT,uid:who.uid,email:who.email,googleSubject:who.googleSubject},oauth:OAUTH};
  const context=vm.createContext({__seed:JSON.stringify(seed),__bytes:v=>Array.from(Buffer.from(v,'utf8'),n=>n>127?n-256:n),__digest:b=>Array.from(crypto.createHash('sha256').update(Buffer.from(b)).digest(),n=>n>127?n-256:n),__etag:v=>crypto.createHash('sha1').update(v).digest('base64')});
  vm.runInContext(Builder.createBundle().source,context);
  vm.runInContext(`
  var Fixture=(function(){
    const data=JSON.parse(__seed),stats={google:0,reads:0,puts:0,writes:0,oauth:0,propertyWrites:0},controls={loseAck:false,conflict:false,deny:false,gzip:true,enrollmentEnabled:false};let root=data.root,clock=data.clock,saved,held=false;
    const utilities={DigestAlgorithm:{SHA_256:'sha256'},newBlob(value,type){if(type!=='text/plain')throw Error('synthetic');return {getBytes(){return Array.from(__bytes(value));}};},computeDigest(kind,bytes){if(kind!=='sha256')throw Error('synthetic');return Array.from(__digest(bytes));}};
    const modules=SoldierAppsScriptLifecycleRuntime.createModules(utilities);
    const budget={projectId:data.binding.projectId,policyId:'synthetic-lifecycle-budget',reviewed:true,startsAt:clock,expiresAt:'2026-10-07T03:00:00.000Z',requestLimit:60,lookupLimit:840,downloadLimitBytes:180*8*1024*1024,burstWindowMs:60000,burstLimit:30};saved=modules.sharedAdmission.createAdmissionSeed(budget);
    const properties={getProperty(k){if(k!==modules.sharedAdmission.PROPERTY_KEY||!held)throw Error('synthetic');return saved;},setProperty(k,v){if(k!==modules.sharedAdmission.PROPERTY_KEY||!held)throw Error('synthetic');saved=v;stats.propertyWrites++;return properties;}},lock={tryLock(){if(held)return false;held=true;return true;},hasLock(){return held;},releaseLock(){held=false;}};
    const tag=()=>__etag(JSON.stringify(root)),response=(code,body,headers)=>({getResponseCode(){return code;},getAllHeaders(){return headers;},getContent(){return Array.from(__bytes(body));}});
    const host={fetch(url,p){if(held)throw Error('synthetic lock leak');if(url==='https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+data.binding.apiKey){stats.google++;if(p.method!=='post'||JSON.parse(p.payload).idToken!==data.token)throw Error('synthetic');return response(200,JSON.stringify({users:[{...data.account,disabled:controls.deny}]}),controls.gzip?{'Content-Type':'application/json','Content-Encoding':'gzip'}:{'Content-Type':'application/json'});}
      if(url!==data.binding.databaseURL+'/.json'||p.headers.Authorization!=='Bearer '+data.oauth)throw Error('synthetic');if(p.method==='get'){stats.reads++;return response(200,JSON.stringify(root),{'Content-Type':'application/json; charset=utf-8',ETag:tag()});}
      if(p.method!=='put')throw Error('synthetic');stats.puts++;if(controls.conflict||p.headers['If-Match']!==tag())return response(412,'{}',{'Content-Type':'application/json'});root=JSON.parse(p.payload);stats.writes++;if(controls.loseAck)throw Error('SYNTHETIC_PRIVATE_ACK');return response(200,JSON.stringify(root),{'Content-Type':'application/json',ETag:tag()});
    }},script={getOAuthToken(){stats.oauth++;return data.oauth;}};
    function create(){const gate=modules.sharedAdmission.createAppsScriptSharedRequestAdmission({enabled:true,binding:{projectId:data.binding.projectId,policyId:budget.policyId},policy:budget,scriptLock:lock,scriptProperties:properties,clock:()=>clock});return modules.runtime.createAppsScriptLegacyLifecycleRuntime({enabled:true,enrollmentEnabled:controls.enrollmentEnabled,binding:data.binding,urlFetchApp:host,scriptApp:script,clock:()=>clock,requestAdmission:gate.admit,identityAdmission:v=>Object.keys(data.identity).every(k=>v[k]===data.identity[k]),tariffPolicy:data.tariffPolicy});}
    function gateway(){return modules.rpc.createAppsScriptLifecycleRpcGateway({enabled:true,binding:{projectId:data.binding.projectId,databaseURL:data.binding.databaseURL,tenantId:data.binding.tenantId},runtime:create()});}
    function ownerGateway(){return modules.ownerRpc.createAppsScriptOwnerLifecycleRpcGateway({enabled:true,binding:{projectId:data.binding.projectId,databaseURL:data.binding.databaseURL,tenantId:data.binding.tenantId},runtime:create()});}
    return {create,gateway,ownerGateway,stats,controls,modules,readInput:()=>({idToken:data.token}),input:command=>({idToken:data.token,command}),root:()=>root,setRoot:v=>{root=v;},state:()=>JSON.parse(saved),setClock:v=>{clock=v;}};
  })();`,context);
  function realm(value){context.__input=JSON.stringify(value);try{return vm.runInContext('JSON.parse(__input)',context);}finally{delete context.__input;}}
  let sequence=0;
  function command(kind,operationId,extra={}){const api=context.Fixture.create(),r=(division==='owner'?api.readOwner:api.read)(context.Fixture.readInput());if(!r.ok)throw Error('synthetic_fixture');return realm({kind,requestId:'bundle-request-'+(++sequence),operationId,productId:'product-1',expectedGrantRevision:1,expectedSourceVersion:r.view.products[0].sourceVersion,...extra});}
  return {context,fixture:context.Fixture,realm,command,seed,create:()=>context.Fixture.create(),normal:v=>JSON.parse(JSON.stringify(v))};
}
module.exports=Object.freeze({createLifecycleBundleFixture,KEY,OAUTH});
