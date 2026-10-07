'use strict';
// Internal source-OFF reservation policy, not a service quota or bill cap.
// One fixed ScriptProperties ledger and ScriptLock. No native global calls,
// caller reset, refund, automatic seed, network, identity or business data.
const Shared=require('./shared-request-admission.cjs');
const ROOT_BYTES=Shared.ROOT_BYTES,MAX_STATE_CHARS=Shared.MAX_STATE_CHARS,DAY_MS=86400000;
const SUPPORTED_ROOT_BYTES=Object.freeze([2*1024*1024,ROOT_BYTES]);
const PROPERTY_KEY='soldier.legacy.recurringRequestBudget.v1';
const DEFAULT_CONFIGURATION=Object.freeze({enabled:false,binding:Object.freeze({projectId:'',policyId:''}),policy:null,maxRootBytes:ROOT_BYTES});
const POLICY_KEYS=['projectId','policyId','reviewed','startsAt','expiresAt','dayRequestLimit','dayLookupLimit','dayDownloadLimitBytes','monthRequestLimit','monthLookupLimit','monthDownloadLimitBytes','burstWindowMs','burstLimit'];
const STATE_KEYS=['schemaVersion','policy','maxRootBytes','sequence','requests','lookups','downloadBytes','lastAt','day','month','burst'],LANE_KEYS=['key','requests','lookups','downloadBytes'];
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const fail=()=>{throw Error('admission_unavailable');};
function field(v,k){const d=v&&typeof v==='object'?Object.getOwnPropertyDescriptor(v,k):null;if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();return d.value;}
function exact(v,keys,optional=[]){if(!plain(v)||keys.some(k=>!Object.hasOwn(v,k))||Reflect.ownKeys(v).some(k=>typeof k!=='string'||!keys.includes(k)&&!optional.includes(k)))fail();for(const k of Reflect.ownKeys(v))field(v,k);}
function method(v,k){for(let p=v,n=0;p&&typeof p==='object'&&n<8;p=Object.getPrototypeOf(p),n++){const d=Object.getOwnPropertyDescriptor(p,k);if(d){if(!Object.hasOwn(d,'value')||typeof d.value!=='function')fail();return d.value;}}fail();}
function instant(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v||Date.parse(v)<0)fail();return Date.parse(v);}
function integer(v,min,max){if(!Number.isSafeInteger(v)||Object.is(v,-0)||v<min||v>max)fail();return v;}
const encode=v=>JSON.stringify(v),dayKey=n=>new Date(n).toISOString().slice(0,10),monthKey=n=>new Date(n).toISOString().slice(0,7);
function rootCap(v){if(!SUPPORTED_ROOT_BYTES.includes(v))fail();return v;}
function limits(p,which){return {requests:p[which+'RequestLimit'],lookups:p[which+'LookupLimit'],downloadBytes:p[which+'DownloadLimitBytes']};}
function compatiblePolicy(p,which){
  const start=instant(p.startsAt),d=new Date(start),first=which==='day'?Date.parse(dayKey(start)+'T00:00:00.000Z'):Date.parse(monthKey(start)+'-01T00:00:00.000Z');
  const end=which==='day'?first+DAY_MS:Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1),cap=limits(p,which);
  return {projectId:p.projectId,policyId:p.policyId,reviewed:p.reviewed,startsAt:p.startsAt,expiresAt:new Date(Math.min(end,instant(p.expiresAt))).toISOString(),requestLimit:cap.requests,lookupLimit:cap.lookups,downloadLimitBytes:Math.max(cap.downloadBytes,2*ROOT_BYTES),burstWindowMs:p.burstWindowMs,burstLimit:p.burstLimit};
}
function policyCopy(value,maxRootBytes){
  exact(value,POLICY_KEYS);const p={};for(const k of POLICY_KEYS)p[k]=field(value,k);
  const start=instant(p.startsAt),end=instant(p.expiresAt);if(end<=start||end-start>366*DAY_MS)fail();
  // Reuse the finite gate's reviewed binding, limit and burst validation. Its
  // legacy 8 MiB minimum is lifted ONLY in the temporary validation object;
  // actual counters always retain the original reviewed limit and hard cap.
  for(const which of ['day','month'])integer(p[which+'DownloadLimitBytes'],2*maxRootBytes,1024*1024*1024*1024);
  // The period is explicit UTC policy, not Google's quota-reset schedule.
  Shared.createAdmissionSeed(compatiblePolicy(p,'day'));Shared.createAdmissionSeed(compatiblePolicy(p,'month'));return Object.freeze(p);
}
function totalLimits(p){const start=instant(p.startsAt),last=instant(p.expiresAt)-1,a=new Date(start),b=new Date(last),days=Math.floor(last/DAY_MS)-Math.floor(start/DAY_MS)+1,months=(b.getUTCFullYear()-a.getUTCFullYear())*12+b.getUTCMonth()-a.getUTCMonth()+1,d=limits(p,'day'),m=limits(p,'month');const out={};for(const k of ['requests','lookups','downloadBytes'])out[k]=Math.min(d[k]*days,m[k]*months);return out;}
function costs(v,cap,maxRootBytes){
  const requests=integer(field(v,'requests'),0,cap.requests),lookups=integer(field(v,'lookups'),0,cap.lookups),downloadBytes=integer(field(v,'downloadBytes'),0,cap.downloadBytes),writes=(lookups-10*requests)/4;
  if(!Number.isInteger(writes)||writes<0||writes>requests||downloadBytes!==maxRootBytes*(2*requests+writes))fail();return {requests,lookups,downloadBytes};
}
function contains(parent,child,maxRootBytes){const delta={};for(const k of ['requests','lookups','downloadBytes'])delta[k]=parent[k]-child[k];costs(delta,parent,maxRootBytes);}
function seed(value,configuredCap=ROOT_BYTES){const maxRootBytes=rootCap(configuredCap),policy=policyCopy(value,maxRootBytes),lastAt=instant(policy.startsAt),zero=key=>({key,requests:0,lookups:0,downloadBytes:0});return encode({schemaVersion:1,policy,maxRootBytes,sequence:0,requests:0,lookups:0,downloadBytes:0,lastAt,day:zero(dayKey(lastAt)),month:zero(monthKey(lastAt)),burst:[]});}
function stateCopy(raw,policy,maxRootBytes){
  if(typeof raw!=='string'||raw.length>MAX_STATE_CHARS)fail();let v;try{v=JSON.parse(raw);}catch{fail();}exact(v,STATE_KEYS);
  const p=policyCopy(field(v,'policy'),maxRootBytes);if(encode(p)!==encode(policy)||field(v,'schemaVersion')!==1||field(v,'maxRootBytes')!==maxRootBytes)fail();
  const total=costs(v,totalLimits(p),maxRootBytes),sequence=integer(field(v,'sequence'),0,totalLimits(p).requests),lastAt=integer(field(v,'lastAt'),instant(p.startsAt),instant(p.expiresAt)-1);if(sequence!==total.requests)fail();
  function lane(which,key){const src=field(v,which);exact(src,LANE_KEYS);if(field(src,'key')!==key)fail();return {key,...costs(src,limits(p,which),maxRootBytes)};}
  const day=lane('day',dayKey(lastAt)),month=lane('month',monthKey(lastAt));contains(total,month,maxRootBytes);contains(month,day,maxRootBytes);
  const src=field(v,'burst');if(!Array.isArray(src)||Object.getPrototypeOf(src)!==Array.prototype||src.length>policy.burstLimit||src.length>total.requests||Reflect.ownKeys(src).length!==src.length+1)fail();const burst=[];
  for(let i=0;i<src.length;i++){const t=integer(field(src,String(i)),instant(p.startsAt),lastAt);if(i&&t<burst[i-1]||lastAt-t>=p.burstWindowMs)fail();burst.push(t);}
  if(total.requests===0?(lastAt!==instant(p.startsAt)||day.requests!==0||month.requests!==0||burst.length!==0):(day.requests===0||month.requests===0||burst.length===0||burst[burst.length-1]!==lastAt))fail();
  const out={schemaVersion:1,policy:p,maxRootBytes,sequence,...total,lastAt,day,month,burst};
  // Sole-writer canonical form also rejects duplicate keys/-0/escaped aliases,
  // whitespace, field order drift and unknown state without any repair/reset.
  if(encode(out)!==raw)fail();return out;
}
function createAppsScriptRecurringRequestAdmission(options={}){
  let enabled=false;try{const d=plain(options)&&Object.getOwnPropertyDescriptor(options,'enabled');enabled=!!d&&Object.hasOwn(d,'value')&&d.value===true;}catch{}
  if(!enabled)return Object.freeze({admit:()=>false});
  let binding,policy,maxRootBytes,lock,properties,tryLock,hasLock,releaseLock,getProperty,setProperty,clock,drift=false,busy=false,highWater=-1;
  function check(){if(drift)fail();try{if(method(lock,'tryLock')!==tryLock||method(lock,'hasLock')!==hasLock||method(lock,'releaseLock')!==releaseLock||method(properties,'getProperty')!==getProperty||method(properties,'setProperty')!==setProperty)fail();}catch{drift=true;fail();}}
  function held(){check();if(hasLock.call(lock)!==true)fail();check();}
  function now(){check();const n=instant(clock());check();if(n<highWater)fail();highWater=n;return n;}
  function within(n,requestedAt){if(n<requestedAt||n-requestedAt>5000||n<instant(policy.startsAt)||n>=instant(policy.expiresAt))fail();}
  try{
    exact(options,['enabled','binding','policy','scriptLock','scriptProperties','clock'],['maxRootBytes']);maxRootBytes=rootCap(Object.hasOwn(options,'maxRootBytes')?field(options,'maxRootBytes'):ROOT_BYTES);const b=field(options,'binding');exact(b,['projectId','policyId']);binding=Object.freeze({projectId:field(b,'projectId'),policyId:field(b,'policyId')});policy=policyCopy(field(options,'policy'),maxRootBytes);if(policy.projectId!==binding.projectId||policy.policyId!==binding.policyId)fail();
    lock=field(options,'scriptLock');properties=field(options,'scriptProperties');clock=field(options,'clock');if(typeof clock!=='function')fail();tryLock=method(lock,'tryLock');hasLock=method(lock,'hasLock');releaseLock=method(lock,'releaseLock');getProperty=method(properties,'getProperty');setProperty=method(properties,'setProperty');check();
  }catch{return Object.freeze({admit:()=>false});}
  function admit(request){
    if(busy)return false;busy=true;let admitted=false,acquisitionAttempted=false;
    try{
      if(arguments.length!==1)fail();exact(request,['projectId','kind','now','maxDatabaseDownloadBytes','maxGoogleLookupCount']);const kind=field(request,'kind');if(field(request,'projectId')!==binding.projectId||!['read','readFinance','execute','resolve'].includes(kind))fail();const write=kind==='execute',charge={requests:1,lookups:write?14:10,downloadBytes:(write?3:2)*maxRootBytes};
      if(field(request,'maxDatabaseDownloadBytes')!==charge.downloadBytes||field(request,'maxGoogleLookupCount')!==charge.lookups)fail();const requestedAt=instant(field(request,'now'));within(now(),requestedAt);
      check();if(hasLock.call(lock)!==false)fail();check();acquisitionAttempted=true;if(tryLock.call(lock,250)!==true)fail();held();
      const raw=getProperty.call(properties,PROPERTY_KEY);held();const state=stateCopy(raw,policy,maxRootBytes),n=now();within(n,requestedAt);if(n<state.lastAt)fail();const burst=state.burst.filter(t=>n-t<policy.burstWindowMs);if(burst.length>=policy.burstLimit)fail();
      function reserve(lane,key,cap){if(key!==null&&lane&&key<lane.key)fail();const previous=key===null?lane:lane&&key===lane.key?lane:{requests:0,lookups:0,downloadBytes:0},next={};if(key!==null)next.key=key;for(const k of ['requests','lookups','downloadBytes'])next[k]=integer(previous[k]+charge[k],0,cap[k]);return next;}
      const total=reserve(state,null,totalLimits(policy)),day=reserve(state.day,dayKey(n),limits(policy,'day')),month=reserve(state.month,monthKey(n),limits(policy,'month'));
      const next=encode({...state,sequence:state.sequence+1,...total,lastAt:n,day,month,burst:[...burst,n]});if(next.length>MAX_STATE_CHARS)fail();held();
      // Day/month rollover is part of the SAME new reservation. No reset is
      // persisted on a denial; lifetime costs never decrease. Failed later
      // calls and uncertain property ACKs remain consumed, without refunds.
      setProperty.call(properties,PROPERTY_KEY,next);held();if(getProperty.call(properties,PROPERTY_KEY)!==next)fail();held();
      const finished=now();if(finished<n||finished>=instant(policy.expiresAt)||dayKey(finished)!==day.key||monthKey(finished)!==month.key)fail();admitted=true;
    }catch{admitted=false;}
    finally{
      if(acquisitionAttempted){try{check();const owned=hasLock.call(lock);check();if(owned!==true&&owned!==false)fail();if(owned){releaseLock.call(lock);check();if(hasLock.call(lock)!==false)fail();}}catch{admitted=false;}}
      busy=false;
    }
    return admitted;
  }
  return Object.freeze({admit});
}
module.exports=Object.freeze({createAppsScriptRecurringRequestAdmission,createRecurringAdmissionSeed:seed,DEFAULT_CONFIGURATION,PROPERTY_KEY,ROOT_BYTES,SUPPORTED_ROOT_BYTES,MAX_STATE_CHARS});
