'use strict';
// Internal source-OFF admission. One fixed ScriptProperties key, ScriptLock,
// finite reviewed budget. No automatic initialization/refill, network or RPC.
const PROPERTY_KEY='soldier.legacy.requestBudget.v1',ROOT_BYTES=8*1024*1024,MAX_STATE_CHARS=4096;
const DEFAULT_CONFIGURATION=Object.freeze({enabled:false,binding:Object.freeze({projectId:'',policyId:''}),policy:null});
const POLICY_KEYS=['projectId','policyId','reviewed','startsAt','expiresAt','requestLimit','lookupLimit','downloadLimitBytes','burstWindowMs','burstLimit'];
const STATE_KEYS=['schemaVersion','policy','sequence','requests','lookups','downloadBytes','lastAt','burst'];
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const fail=()=>{throw new Error('admission_unavailable');};
function field(v,k){const d=v&&typeof v==='object'?Object.getOwnPropertyDescriptor(v,k):null;if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();return d.value;}
function exact(v,keys){if(!plain(v)||Reflect.ownKeys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail();for(const k of keys)field(v,k);}
function method(v,k){for(let p=v,n=0;p&&typeof p==='object'&&n<8;p=Object.getPrototypeOf(p),n++){const d=Object.getOwnPropertyDescriptor(p,k);if(d){if(!Object.hasOwn(d,'value')||typeof d.value!=='function')fail();return d.value;}}fail();}
function instant(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v||Date.parse(v)<0)fail();return Date.parse(v);}
function integer(v,min,max){if(!Number.isSafeInteger(v)||Object.is(v,-0)||v<min||v>max)fail();return v;}
function policyCopy(value){
  exact(value,POLICY_KEYS);const p={};for(const k of POLICY_KEYS)p[k]=field(value,k);
  if(typeof p.projectId!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(p.projectId)||typeof p.policyId!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(p.policyId)||p.reviewed!==true)fail();
  const start=instant(p.startsAt),end=instant(p.expiresAt);if(end<=start||end-start>31*86400000)fail();
  // Format ceilings only; they do not describe current service allowances.
  integer(p.requestLimit,1,10000);integer(p.lookupLimit,10,140000);integer(p.downloadLimitBytes,2*ROOT_BYTES,1024*1024*1024*1024);
  integer(p.burstWindowMs,1000,3600000);integer(p.burstLimit,1,32);return Object.freeze(p);
}
function encode(state){return JSON.stringify(state);}
function seed(policy){const p=policyCopy(policy);return encode({schemaVersion:1,policy:p,sequence:0,requests:0,lookups:0,downloadBytes:0,lastAt:instant(p.startsAt),burst:[]});}
function stateCopy(raw,policy){
  if(typeof raw!=='string'||raw.length>MAX_STATE_CHARS)fail();let v;try{v=JSON.parse(raw);}catch{fail();}exact(v,STATE_KEYS);
  const p=policyCopy(field(v,'policy'));if(encode(p)!==encode(policy)||field(v,'schemaVersion')!==1)fail();
  const sequence=integer(field(v,'sequence'),0,policy.requestLimit),requests=integer(field(v,'requests'),0,policy.requestLimit),lookups=integer(field(v,'lookups'),0,policy.lookupLimit),downloadBytes=integer(field(v,'downloadBytes'),0,policy.downloadLimitBytes),lastAt=integer(field(v,'lastAt'),instant(policy.startsAt),instant(policy.expiresAt)-1);
  if(sequence!==requests)fail();const writes=(lookups-10*requests)/4;
  if(!Number.isInteger(writes)||writes<0||writes>requests||downloadBytes!==ROOT_BYTES*(2*requests+writes))fail();
  const source=field(v,'burst');if(!Array.isArray(source)||Object.getPrototypeOf(source)!==Array.prototype||source.length>policy.burstLimit||source.length>requests||Reflect.ownKeys(source).length!==source.length+1)fail();
  const burst=[];for(let i=0;i<source.length;i++){const n=integer(field(source,String(i)),instant(policy.startsAt),lastAt);if(i&&n<burst[i-1])fail();burst.push(n);}
  if(requests===0?(lastAt!==instant(policy.startsAt)||burst.length!==0):(burst.length===0||burst[burst.length-1]!==lastAt))fail();
  const out={schemaVersion:1,policy:p,sequence,requests,lookups,downloadBytes,lastAt,burst};
  // The sole writer uses this exact representation. Duplicate keys, altered
  // order/spacing and extra state are never repaired or treated as a reset.
  if(encode(out)!==raw)fail();return out;
}
function createAppsScriptSharedRequestAdmission(options={}){
  let enabled=false;try{const d=plain(options)&&Object.getOwnPropertyDescriptor(options,'enabled');enabled=!!d&&Object.hasOwn(d,'value')&&d.value===true;}catch{}
  if(!enabled)return Object.freeze({admit:()=>false});
  let binding,policy,lock,properties,tryLock,hasLock,releaseLock,getProperty,setProperty,clock,drift=false,busy=false;
  function check(){if(drift)fail();try{if(method(lock,'tryLock')!==tryLock||method(lock,'hasLock')!==hasLock||method(lock,'releaseLock')!==releaseLock||method(properties,'getProperty')!==getProperty||method(properties,'setProperty')!==setProperty)fail();}catch{drift=true;fail();}}
  function held(){check();if(hasLock.call(lock)!==true)fail();check();}
  function now(){check();const n=instant(clock());check();return n;}
  try{
    exact(options,['enabled','binding','policy','scriptLock','scriptProperties','clock']);const b=field(options,'binding');exact(b,['projectId','policyId']);binding=Object.freeze({projectId:field(b,'projectId'),policyId:field(b,'policyId')});
    policy=policyCopy(field(options,'policy'));if(policy.projectId!==binding.projectId||policy.policyId!==binding.policyId)fail();
    lock=field(options,'scriptLock');properties=field(options,'scriptProperties');clock=field(options,'clock');if(typeof clock!=='function')fail();
    tryLock=method(lock,'tryLock');hasLock=method(lock,'hasLock');releaseLock=method(lock,'releaseLock');getProperty=method(properties,'getProperty');setProperty=method(properties,'setProperty');check();
  }catch{return Object.freeze({admit:()=>false});}
  function admit(request){
    if(busy)return false;busy=true;let admitted=false,acquisitionAttempted=false;
    try{
      if(arguments.length!==1)fail();exact(request,['projectId','kind','now','maxDatabaseDownloadBytes','maxGoogleLookupCount']);
      if(field(request,'projectId')!==binding.projectId||!['read','readFinance','execute','resolve'].includes(field(request,'kind')))fail();
      const write=request.kind==='execute',bytes=(write?3:2)*ROOT_BYTES,lookups=write?14:10;
      if(field(request,'maxDatabaseDownloadBytes')!==bytes||field(request,'maxGoogleLookupCount')!==lookups)fail();
      const requestedAt=instant(field(request,'now'));let n=now();if(requestedAt>n||n-requestedAt>5000||n<instant(policy.startsAt)||n>=instant(policy.expiresAt))fail();
      check();if(hasLock.call(lock)!==false)fail();check();acquisitionAttempted=true;if(tryLock.call(lock,250)!==true)fail();held();
      n=now();if(n<requestedAt||n-requestedAt>5000||n>=instant(policy.expiresAt))fail();
      const raw=getProperty.call(properties,PROPERTY_KEY);held();const state=stateCopy(raw,policy);
      if(n<state.lastAt)fail();const burst=state.burst.filter(t=>n-t<policy.burstWindowMs);
      if(state.requests+1>policy.requestLimit||state.lookups+lookups>policy.lookupLimit||state.downloadBytes+bytes>policy.downloadLimitBytes||burst.length>=policy.burstLimit)fail();
      const next=encode({...state,sequence:state.sequence+1,requests:state.requests+1,lookups:state.lookups+lookups,downloadBytes:state.downloadBytes+bytes,lastAt:n,burst:[...burst,n]});
      if(next.length>MAX_STATE_CHARS)fail();held();
      // Reserve before authorization/network. Failed later requests are never
      // refunded. Lost ACK, a dropped write or readback mismatch cannot admit.
      setProperty.call(properties,PROPERTY_KEY,next);held();
      if(getProperty.call(properties,PROPERTY_KEY)!==next)fail();held();
      const finished=now();if(finished<n||finished>=instant(policy.expiresAt))fail();admitted=true;
    }catch{admitted=false;}
    finally{
      if(acquisitionAttempted){try{check();const owned=hasLock.call(lock);check();if(owned!==true&&owned!==false)fail();if(owned){releaseLock.call(lock);check();if(hasLock.call(lock)!==false)fail();}}catch{admitted=false;}}
      busy=false;
    }
    return admitted;
  }
  return Object.freeze({admit});
}
module.exports=Object.freeze({createAppsScriptSharedRequestAdmission,createAdmissionSeed:seed,DEFAULT_CONFIGURATION,PROPERTY_KEY,ROOT_BYTES,MAX_STATE_CHARS});
