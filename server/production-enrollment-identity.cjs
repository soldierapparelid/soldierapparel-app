'use strict';
// Optional server-only first-login identity verification. No SDK initialization,
// roster, grant write, database, token persistence, logger or CLI belongs here.
const WINDOW_MS=300000,MAX_TOKEN=16384,MAX_PROVIDERS=16;
const forbidden=new Set(['__proto__','constructor','prototype']);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const plain=v=>object(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const safeId=v=>typeof v==='string'&&v.length>0&&v.length<=128&&!forbidden.has(v)&&/^[A-Za-z0-9_-]+$/.test(v);
const project=v=>typeof v==='string'&&/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(v);
const instant=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString()===v;
const isEnrollmentEmail=v=>typeof v==='string'&&v.length<=254&&/^[a-z0-9._%+-]+@gmail\.com$/.test(v);
const rejected=error=>Object.freeze({ok:false,error});
const disabled=rejected('service_disabled'),unavailable=rejected('unavailable');
class IdentityError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new IdentityError(code);};
function data(v,key,code){
  if(!object(v))fail(code);
  const d=Object.getOwnPropertyDescriptor(v,key);
  if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail(code);return d.value;
}
function regularFields(v,code){
  if(!plain(v))fail(code);
  for(const key of Reflect.ownKeys(v)){
    if(typeof key!=='string'||forbidden.has(key))fail(code);data(v,key,code);
  }
}
function exact(v,keys,code){
  regularFields(v,code);if(Reflect.ownKeys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail(code);
}
function sdkMethod(v,key){
  if(!object(v))fail('unavailable');let current=v;
  // Admin Auth methods are normal prototype methods. Only the trusted SDK app
  // handle below may use getters; a method accessor is never invoked.
  for(let depth=0;current&&depth<8;depth++,current=Object.getPrototypeOf(current)){
    const d=Object.getOwnPropertyDescriptor(current,key);
    if(d){if(!Object.hasOwn(d,'value')||typeof d.value!=='function')fail('unavailable');return d.value;}
  }
  fail('unavailable');
}
function seconds(v){if(!Number.isSafeInteger(v)||v<=0||v>Math.floor(Number.MAX_SAFE_INTEGER/1000))fail('access_denied');return v*1000;}
function timely(identity,now){
  if(identity.authTimeMs>identity.issuedAtMs||identity.issuedAtMs>=identity.expiresAtMs||identity.authTimeMs>now||identity.issuedAtMs>now||now>=identity.expiresAtMs||now-identity.authTimeMs>WINDOW_MS||now-identity.issuedAtMs>WINDOW_MS)fail('access_denied');
}
function selectedToken(value,projectId,now){
  regularFields(value,'access_denied');
  const uid=data(value,'uid','access_denied'),sub=data(value,'sub','access_denied'),aud=data(value,'aud','access_denied'),iss=data(value,'iss','access_denied'),email=data(value,'email','access_denied');
  if(!safeId(uid)||sub!==uid||aud!==projectId||iss!=='https://securetoken.google.com/'+projectId||!isEnrollmentEmail(email)||data(value,'email_verified','access_denied')!==true)fail('access_denied');
  const firebase=data(value,'firebase','access_denied');regularFields(firebase,'access_denied');
  if(data(firebase,'sign_in_provider','access_denied')!=='google.com'||Object.hasOwn(firebase,'tenant')&&data(firebase,'tenant','access_denied')!==undefined)fail('access_denied');
  const identities=data(firebase,'identities','access_denied');regularFields(identities,'access_denied');
  const subjects=data(identities,'google.com','access_denied');
  if(!Array.isArray(subjects)||Object.getPrototypeOf(subjects)!==Array.prototype||subjects.length!==1||Reflect.ownKeys(subjects).length!==2)fail('access_denied');
  const d=Object.getOwnPropertyDescriptor(subjects,'0');
  if(!d||!d.enumerable||!Object.hasOwn(d,'value')||!safeId(d.value))fail('access_denied');
  const identity={projectId,uid,email,googleSubject:d.value,authTimeMs:seconds(data(value,'auth_time','access_denied')),issuedAtMs:seconds(data(value,'iat','access_denied')),expiresAtMs:seconds(data(value,'exp','access_denied'))};
  timely(identity,now);return identity;
}
function currentRecord(value,identity){
  // UserRecord/UserInfo are real Admin classes, not plain JSON. Select only
  // required own data fields, never traverse or serialize unrelated fields.
  if(data(value,'uid','access_denied')!==identity.uid||data(value,'disabled','access_denied')!==false||data(value,'emailVerified','access_denied')!==true||data(value,'email','access_denied')!==identity.email)fail('access_denied');
  if(Object.hasOwn(value,'tenantId')){const tenant=data(value,'tenantId','access_denied');if(tenant!==undefined&&tenant!==null)fail('access_denied');}
  const providers=data(value,'providerData','access_denied');
  if(!Array.isArray(providers)||Object.getPrototypeOf(providers)!==Array.prototype||!providers.length||providers.length>MAX_PROVIDERS||Reflect.ownKeys(providers).length!==providers.length+1)fail('access_denied');
  let google=null;
  for(let i=0;i<providers.length;i++){
    const d=Object.getOwnPropertyDescriptor(providers,String(i));if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail('access_denied');
    const provider=d.value,providerId=data(provider,'providerId','access_denied');
    if(typeof providerId!=='string'||!providerId||providerId.length>128||/[\u0000-\u0020\u007f-\uffff]/.test(providerId))fail('access_denied');
    if(providerId==='google.com'){if(google)fail('access_denied');google=provider;}
  }
  if(!google||data(google,'uid','access_denied')!==identity.googleSubject||data(google,'email','access_denied')!==identity.email)fail('access_denied');
}
function createProductionEnrollmentIdentityVerifier(options){
  let enabled;try{enabled=plain(options)&&Object.getOwnPropertyDescriptor(options,'enabled');}catch{}
  if(!enabled||!Object.hasOwn(enabled,'value')||enabled.value!==true)return Object.freeze({verify:async()=>disabled});
  let projectId,auth,clock,app,verifyIdToken,getUser;
  function checkBinding(){
    try{
      // app/options are trusted Admin SDK handles and may have SDK getters.
      const current=auth.app,settings=current?.options;
      if(!object(current)||app&&current!==app||!object(settings)||data(settings,'projectId','unavailable')!==projectId||sdkMethod(auth,'verifyIdToken')!==verifyIdToken||sdkMethod(auth,'getUser')!==getUser)fail('unavailable');
      return current;
    }catch{fail('unavailable');}
  }
  try{
    exact(options,['enabled','projectId','auth','clock'],'unavailable');projectId=data(options,'projectId','unavailable');auth=data(options,'auth','unavailable');clock=data(options,'clock','unavailable');
    if(!project(projectId)||typeof clock!=='function')fail('unavailable');verifyIdToken=sdkMethod(auth,'verifyIdToken');getUser=sdkMethod(auth,'getUser');app=checkBinding();
  }catch{return Object.freeze({verify:async()=>unavailable});}
  async function verify(request){
    try{
      exact(request,['idToken'],'invalid_request');const idToken=data(request,'idToken','invalid_request');
      if(typeof idToken!=='string'||!idToken||idToken.length>MAX_TOKEN||/[\r\n]/.test(idToken))fail('invalid_request');
      let previous=null;
      function now(){
        const value=clock();if(!instant(value))fail('unavailable');const ms=Date.parse(value);if(ms<0||previous!==null&&ms<previous)fail('unavailable');previous=ms;return {value,ms};
      }
      checkBinding();now();checkBinding();let token;
      try{token=await verifyIdToken.call(auth,idToken,true);}catch{fail('access_denied');}
      checkBinding();const tokenNow=now();checkBinding();const identity=selectedToken(token,projectId,tokenNow.ms);let record;
      try{record=await getUser.call(auth,identity.uid);}catch{fail('access_denied');}
      checkBinding();const finalNow=now();checkBinding();timely(identity,finalNow.ms);currentRecord(record,identity);
      return Object.freeze({ok:true,identity:Object.freeze({...identity,verifiedAt:finalNow.value})});
    }catch(error){return rejected(error instanceof IdentityError?error.code:'unavailable');}
  }
  return Object.freeze({verify});
}
module.exports=Object.freeze({createProductionEnrollmentIdentityVerifier,isEnrollmentEmail});
