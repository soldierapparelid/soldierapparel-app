'use strict';
// Isolated synthetic host for the generated V8 bundle. No network or real data.
const vm=require('node:vm'),crypto=require('node:crypto');
const Builder=require('../../server/apps-script/build-runtime-bundle.cjs'),Core=require('../../server/production-legacy-operations.cjs'),F=require('../fixtures/identity-tenant.cjs');
const KEY='SYNTHETIC_PUBLIC_KEY_0000000000000',OAUTH='SYNTHETIC_MANAGED_OAUTH',POLICY={version:'legacy-jahit-current-v1',reviewed:true,timeZone:'Asia/Jakarta',quantityBasis:'good-plus-reject'};
function createRuntimeFixture(){
  const root={authorityTenants:{[F.TENANT]:F.copy(F.claimed())},soldier:{produksi:{produksi:[{id:'product-1',series:'Synthetic',namaBarang:'Item雪',size:'M',poAktif:true,poJumlah:20,poTanggal:'2026-10-01',assignJahit:[{id:'assignment-1',tukangId:'worker-1',qty:20,sisa:16}],jahit:[{id:'old-operation',tanggal:'2026-10-01',jumlah:4,lolos:3,rijek:1,tukangId:'worker-1',assignmentId:'assignment-1',tarif:10,total:999.75,dibayar:true}],arsip:[]}]},produksi_meta:{tukangJahit:[{id:'worker-1',nama:'Synthetic Partner',tarif:{'Synthetic|Item雪':12.5}},{id:'worker-2',nama:'Other Partner',tarif:{'Synthetic|Item雪':20}}]},ownerOnly:{private:'SYNTHETIC_PRIVATE_ROOT_CANARY'}},unrelatedRoot:{preserved:true}};
  const sec=Date.parse(F.NOW)/1000,payload={sub:'partner-1',aud:F.PROJECT,iss:'https://securetoken.google.com/'+F.PROJECT,email:F.EMAIL,email_verified:true,firebase:{sign_in_provider:'google.com',identities:{'google.com':['1000123456789']}},auth_time:sec-1,iat:sec-1,exp:sec+3600};
  const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url'),token=enc({alg:'RS256',kid:'synthetic-key',typ:'JWT'})+'.'+enc(payload)+'.'+Buffer.alloc(256,19).toString('base64url');
  const account={localId:'partner-1',email:F.EMAIL,emailVerified:true,disabled:false,validSince:String(sec-300),providerUserInfo:[{providerId:'google.com',rawId:'1000123456789',email:F.EMAIL}]};
  const binding={projectId:F.PROJECT,databaseURL:F.URL,tenantId:F.TENANT,apiKey:KEY};
  const core=Core.createProductionLegacyOperations({enabled:true,binding:{projectId:F.PROJECT,databaseURL:F.URL,tenantId:F.TENANT},clock:()=>F.NOW,tariffPolicy:POLICY});
  const initial=core.read({root,identity:F.identity()});if(!initial.ok)throw Error('synthetic_fixture');
  const command={kind:'appendJahit',requestId:'request-1',operationId:'operation-1',productId:'product-1',assignmentId:'assignment-1',expectedGrantRevision:1,expectedSourceVersion:initial.view.products[0].sourceVersion,workDate:null,good:2,reject:0};
  const seed={root,token,account,binding,tariffPolicy:POLICY,clock:F.NOW,identity:{projectId:F.PROJECT,uid:'partner-1',email:F.EMAIL,googleSubject:'1000123456789'},oauth:OAUTH};
  const context=vm.createContext({__seed:JSON.stringify(seed),__bytes:v=>Array.from(Buffer.from(v,'utf8'),n=>n>127?n-256:n),__digest:b=>Array.from(crypto.createHash('sha256').update(Buffer.from(b)).digest(),n=>n>127?n-256:n),__etag:v=>crypto.createHash('sha1').update(v).digest('base64')});
  vm.runInContext(Builder.createBundle().source,context);
  vm.runInContext(`
  var Fixture=(function(){
    const data=JSON.parse(__seed),stats={google:0,reads:0,puts:0,writes:0,oauth:0,propertyWrites:0},controls={loseAck:false,conflict:false,deny:false};let root=data.root,clock=data.clock,saved,held=false;
    const utilities={DigestAlgorithm:{SHA_256:'sha256'},newBlob(value,type){if(type!=='text/plain')throw Error('synthetic');return {getBytes(){return Array.from(__bytes(value));}};},computeDigest(kind,bytes){if(kind!=='sha256')throw Error('synthetic');return Array.from(__digest(bytes));}};
    const modules=SoldierAppsScriptRuntime.createModules(utilities);
    const budget={projectId:data.binding.projectId,policyId:'synthetic-v8-budget',reviewed:true,startsAt:clock,expiresAt:'2026-10-07T03:00:00.000Z',requestLimit:30,lookupLimit:420,downloadLimitBytes:90*8*1024*1024,burstWindowMs:60000,burstLimit:30};saved=modules.sharedAdmission.createAdmissionSeed(budget);
    const properties={getProperty(k){if(k!==modules.sharedAdmission.PROPERTY_KEY||!held)throw Error('synthetic');return saved;},setProperty(k,v){if(k!==modules.sharedAdmission.PROPERTY_KEY||!held)throw Error('synthetic');saved=v;stats.propertyWrites++;return properties;}},lock={tryLock(){if(held)return false;held=true;return true;},hasLock(){return held;},releaseLock(){held=false;}};
    const tag=()=>__etag(JSON.stringify(root));
    const response=(status,body,headers)=>({getResponseCode(){return status;},getAllHeaders(){return headers;},getContent(){return Array.from(__bytes(body));}});
    const host={fetch(url,p){if(held)throw Error('synthetic lock leak');
      if(url==='https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+data.binding.apiKey){stats.google++;if(p.method!=='post'||JSON.parse(p.payload).idToken!==data.token)throw Error('synthetic');return response(200,JSON.stringify({users:[{...data.account,disabled:controls.deny}]}),{'Content-Type':'application/json'});}
      if(url!==data.binding.databaseURL+'/.json'||p.headers.Authorization!=='Bearer '+data.oauth)throw Error('synthetic');
      if(p.method==='get'){stats.reads++;return response(200,JSON.stringify(root),{'Content-Type':'application/json; charset=utf-8',ETag:tag()});}
      if(p.method!=='put')throw Error('synthetic');stats.puts++;if(controls.conflict||p.headers['If-Match']!==tag())return response(412,'{"error":"synthetic"}',{'Content-Type':'application/json'});
      root=JSON.parse(p.payload);stats.writes++;if(controls.loseAck)throw Error('SYNTHETIC_PRIVATE_ACK');return response(200,JSON.stringify(root),{'Content-Type':'application/json',ETag:tag()});
    }},script={getOAuthToken(){stats.oauth++;return data.oauth;}};
    function create(){const gate=modules.sharedAdmission.createAppsScriptSharedRequestAdmission({enabled:true,binding:{projectId:data.binding.projectId,policyId:budget.policyId},policy:budget,scriptLock:lock,scriptProperties:properties,clock:()=>clock});return modules.runtime.createAppsScriptLegacyRuntime({enabled:true,binding:data.binding,urlFetchApp:host,scriptApp:script,clock:()=>clock,requestAdmission:gate.admit,identityAdmission:v=>Object.keys(data.identity).every(k=>v[k]===data.identity[k]),tariffPolicy:data.tariffPolicy});}
    return {create,stats,controls,readInput:()=>({idToken:data.token}),input:command=>({idToken:data.token,command}),root:()=>root,setRoot:v=>{root=v;},state:()=>JSON.parse(saved),setClock:v=>{clock=v;},modules};
  })();`,context);
  function realm(value){context.__input=JSON.stringify(value);try{return vm.runInContext('JSON.parse(__input)',context);}finally{delete context.__input;}}
  return {context,fixture:context.Fixture,realm,command,seed,create:()=>context.Fixture.create(),normal:v=>JSON.parse(JSON.stringify(v))};
}
module.exports=Object.freeze({createRuntimeFixture,KEY,OAUTH,POLICY});
