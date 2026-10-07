'use strict';
// OFF, internal synchronous candidate only. No native initialization, live
// route, OAuth, account mutation, logging, token cache or bundle activation.
const MAX_TOKEN_BYTES=16384,MAX_RESPONSE_BYTES=65536,MAX_JSON_NODES=4096,MAX_JSON_DEPTH=16,MAX_PROVIDERS=16,WINDOW_MS=300000;
const LOOKUP_ENDPOINT='https://identitytoolkit.googleapis.com/v1/accounts:lookup';
const DEFAULT_CONFIGURATION=Object.freeze({enabled:false,binding:Object.freeze({projectId:'',apiKey:''})});
const RESERVED=new Set(['__proto__','constructor','prototype']);
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const safeId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!RESERVED.has(v);
const email=v=>typeof v==='string'&&v.length<=254&&/^[a-z0-9._%+-]+@gmail\.com$/.test(v);
class CurrentIdentityError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new CurrentIdentityError(code);};
const rejected=error=>Object.freeze({ok:false,error});
function field(v,k,code='access_denied'){if(!v||typeof v!=='object')fail(code);const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!d.enumerable||!own(d,'value'))fail(code);return d.value;}
function regular(v,code='access_denied'){if(!plain(v))fail(code);for(const k of Reflect.ownKeys(v)){if(typeof k!=='string'||RESERVED.has(k))fail(code);field(v,k,code);}}
function exact(v,keys,code){regular(v,code);if(Reflect.ownKeys(v).length!==keys.length||keys.some(k=>!own(v,k)))fail(code);}
function method(v,k){for(let p=v,n=0;p&&typeof p==='object'&&n<8;p=Object.getPrototypeOf(p),n++){const d=Object.getOwnPropertyDescriptor(p,k);if(d){if(!own(d,'value')||typeof d.value!=='function')fail('unavailable');return d.value;}}fail('unavailable');}
function dense(v,max,code='access_denied'){
  if(!Array.isArray(v)||Object.getPrototypeOf(v)!==Array.prototype)fail(code);const d=Object.getOwnPropertyDescriptor(v,'length');
  if(!d||!own(d,'value')||!Number.isSafeInteger(d.value)||d.value<0||d.value>max)fail(code);const keys=Reflect.ownKeys(v);
  if(keys.length!==d.value+1||keys.some(k=>typeof k!=='string'||k!=='length'&&(!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=d.value)))fail(code);
  for(let i=0;i<d.value;i++)field(v,String(i),code);return d.value;
}
function decodeUtf8(bytes,limit,code){
  const length=dense(bytes,limit,code),values=[];
  for(let i=0;i<length;i++){const v=field(bytes,String(i),code);if(!Number.isInteger(v)||v< -128||v>255)fail(code);values.push((v+256)%256);}
  const chars=[];
  for(let i=0;i<length;){const a=values[i++];let cp=a,extra=0,min=0;
    if(a<128){}else if(a>=0xc2&&a<=0xdf){cp=a&31;extra=1;min=128;}else if(a>=0xe0&&a<=0xef){cp=a&15;extra=2;min=2048;}else if(a>=0xf0&&a<=0xf4){cp=a&7;extra=3;min=65536;}else fail(code);
    for(let j=0;j<extra;j++){const b=values[i++];if(b===undefined||(b&192)!==128)fail(code);cp=cp*64+(b&63);}
    if(cp<min||cp>0x10ffff||cp>=0xd800&&cp<=0xdfff)fail(code);chars.push(String.fromCodePoint(cp));
  }
  return chars.join('');
}
function base64url(segment,limit){
  if(typeof segment!=='string'||!segment||segment.length%4===1||!/^[A-Za-z0-9_-]+$/.test(segment))fail('access_denied');
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',bytes=[];let acc=0,bits=0;
  for(const c of segment){acc=acc*64+alphabet.indexOf(c);bits+=6;if(bits>=8){bits-=8;bytes.push(Math.floor(acc/2**bits));acc%=2**bits;if(bytes.length>limit)fail('access_denied');}}
  if(acc!==0)fail('access_denied');return bytes;
}
function parseJSON(text,code){
  let i=0,nodes=0;const whitespace=()=>{while(/[\x20\t\r\n]/.test(text[i]||'!'))i++;};
  function string(){const start=i++;for(;i<text.length;i++){const c=text[i];if(c==='"'){i++;let value;try{value=JSON.parse(text.slice(start,i));}catch{fail(code);}return value;}if(c==='\\')i++;else if(c.charCodeAt(0)<32)fail(code);}fail(code);}
  function value(depth){whitespace();if(++nodes>MAX_JSON_NODES||depth>MAX_JSON_DEPTH)fail(code);const c=text[i];
    if(c==='"')return string();
    if(c==='{'){i++;whitespace();const keys=new Set(),out=Object.create(null);if(text[i]==='}'){i++;return out;}for(;;){whitespace();if(text[i]!=='"')fail(code);const key=string();if(keys.has(key)||RESERVED.has(key))fail(code);keys.add(key);whitespace();if(text[i++]!==':')fail(code);out[key]=value(depth+1);whitespace();if(text[i]==='}'){i++;return out;}if(text[i++]!==',')fail(code);}}
    if(c==='['){i++;whitespace();const out=[];if(text[i]===']'){i++;return out;}for(;;){out.push(value(depth+1));whitespace();if(text[i]===']'){i++;return out;}if(text[i++]!==',')fail(code);}}
    for(const [literal,result]of [['true',true],['false',false],['null',null]])if(text.slice(i,i+literal.length)===literal){i+=literal.length;return result;}
    const found=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(i));if(!found)fail(code);i+=found[0].length;const n=Number(found[0]);if(!Number.isFinite(n)||Math.abs(n)>Number.MAX_SAFE_INTEGER||Object.is(n,-0))fail(code);return n;
  }
  const parsed=value(0);whitespace();if(i!==text.length||!plain(parsed))fail(code);return parsed;
}
function seconds(v){if(!Number.isSafeInteger(v)||v<=0||v>Math.floor(Number.MAX_SAFE_INTEGER/1000))fail('access_denied');return v*1000;}
function timely(identity,now,fresh){if(identity.authTimeMs>identity.issuedAtMs||identity.issuedAtMs>=identity.expiresAtMs||identity.authTimeMs>now||identity.issuedAtMs>now||now>=identity.expiresAtMs||fresh&&(now-identity.authTimeMs>WINDOW_MS||now-identity.issuedAtMs>WINDOW_MS))fail('access_denied');}
function claims(token,projectId,now,fresh){
  const pieces=token.split('.');if(pieces.length!==3)fail('access_denied');
  const header=parseJSON(decodeUtf8(base64url(pieces[0],1024),1024,'access_denied'),'access_denied');regular(header);
  if(Object.keys(header).some(k=>!['alg','kid','typ'].includes(k))||field(header,'alg')!=='RS256'||!safeId(field(header,'kid'))||own(header,'typ')&&field(header,'typ')!=='JWT')fail('access_denied');
  const signature=base64url(pieces[2],1024);if(signature.length<64)fail('access_denied');
  const value=parseJSON(decodeUtf8(base64url(pieces[1],MAX_TOKEN_BYTES),MAX_TOKEN_BYTES,'access_denied'),'access_denied');regular(value);
  const uid=field(value,'sub'),address=field(value,'email');
  if(!safeId(uid)||field(value,'aud')!==projectId||field(value,'iss')!=='https://securetoken.google.com/'+projectId||!email(address)||field(value,'email_verified')!==true||own(value,'uid')&&field(value,'uid')!==uid||own(value,'user_id')&&field(value,'user_id')!==uid)fail('access_denied');
  const firebase=field(value,'firebase');regular(firebase);if(field(firebase,'sign_in_provider')!=='google.com'||own(firebase,'tenant'))fail('access_denied');
  const identities=field(firebase,'identities');regular(identities);const subjects=field(identities,'google.com');if(dense(subjects,1)!==1||!safeId(field(subjects,'0')))fail('access_denied');
  const identity=Object.freeze({projectId,uid,email:address,googleSubject:field(subjects,'0'),authTimeMs:seconds(field(value,'auth_time')),issuedAtMs:seconds(field(value,'iat')),expiresAtMs:seconds(field(value,'exp'))});timely(identity,now,fresh);return identity;
}
function currentAccount(response,identity,now){
  regular(response);if(own(response,'error')||own(response,'errorMessage'))fail('access_denied');const users=field(response,'users');if(dense(users,1)!==1)fail('access_denied');const user=field(users,'0');regular(user);
  if(field(user,'localId')!==identity.uid||field(user,'email')!==identity.email||field(user,'emailVerified')!==true)fail('access_denied');
  // Match documented Admin defaults only on Google's bounded successful JSON.
  if(own(user,'disabled')&&field(user,'disabled')!==false||own(user,'tenantId')&&field(user,'tenantId')!==null)fail('access_denied');
  const providers=field(user,'providerUserInfo'),count=dense(providers,MAX_PROVIDERS);if(!count)fail('access_denied');let google=null;
  for(let i=0;i<count;i++){const provider=field(providers,String(i));regular(provider);const id=field(provider,'providerId');if(typeof id!=='string'||!id||id.length>128||/[\u0000-\u0020\u007f-\uffff]/.test(id))fail('access_denied');if(id==='google.com'){if(google)fail('access_denied');google=provider;}}
  if(!google||field(google,'rawId')!==identity.googleSubject||field(google,'email')!==identity.email)fail('access_denied');
  let validSinceMs=null;if(own(user,'validSince')){const fence=field(user,'validSince');if(typeof fence!=='string'||!/^(0|[1-9][0-9]{0,12})$/.test(fence))fail('access_denied');const seconds=Number(fence);if(!Number.isSafeInteger(seconds)||seconds>Math.floor(Number.MAX_SAFE_INTEGER/1000))fail('access_denied');validSinceMs=seconds*1000;if(validSinceMs>now||identity.authTimeMs<validSinceMs)fail('access_denied');}
  return Object.freeze({validSinceMs});
}
function responseHeaders(headers){
  regular(headers,'unavailable');if(Reflect.ownKeys(headers).length>128)fail('unavailable');const controls=Object.create(null);
  for(const key of Object.keys(headers)){const lower=key.toLowerCase();if(['content-type','content-encoding','content-length','location'].includes(lower)){if(own(controls,lower))fail('unavailable');const v=field(headers,key,'unavailable');if(typeof v!=='string'||v.length>1024||/[\r\n\x00]/.test(v))fail('unavailable');controls[lower]=v;}}
  if(own(controls,'location')||controls['content-encoding']&&controls['content-encoding']!=='identity'||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(controls['content-type']||''))fail('unavailable');
  if(own(controls,'content-length')&&(!/^(0|[1-9][0-9]*)$/.test(controls['content-length'])||Number(controls['content-length'])>MAX_RESPONSE_BYTES))fail('unavailable');
}
function createVerifier(options,fresh){
  let enabled=false;try{const d=options&&typeof options==='object'&&Object.getOwnPropertyDescriptor(options,'enabled');enabled=!!d&&own(d,'value')&&d.value===true;}catch{}
  if(!enabled)return Object.freeze({verify:()=>rejected('service_disabled')});
  let binding,host,fetch,clock,target,highWater=-1,drift=false,busy=false;
  function check(){if(drift)fail('unavailable');try{if(method(host,'fetch')!==fetch)fail('unavailable');}catch{drift=true;fail('unavailable');}}
  function now(){check();let instant;try{instant=clock();}catch{fail('unavailable');}check();if(typeof instant!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(instant)||!Number.isFinite(Date.parse(instant))||new Date(instant).toISOString()!==instant||Date.parse(instant)<0||Date.parse(instant)<highWater)fail('unavailable');highWater=Date.parse(instant);return {ms:highWater,instant};}
  try{
    exact(options,['enabled','binding','urlFetchApp','clock'],'unavailable');const selected=field(options,'binding','unavailable');exact(selected,['projectId','apiKey'],'unavailable');
    const projectId=field(selected,'projectId','unavailable'),apiKey=field(selected,'apiKey','unavailable');
    if(typeof projectId!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)||typeof apiKey!=='string'||!/^[A-Za-z0-9_-]{20,128}$/.test(apiKey))fail('unavailable');binding=Object.freeze({projectId,apiKey});
    host=field(options,'urlFetchApp','unavailable');fetch=method(host,'fetch');clock=field(options,'clock','unavailable');if(typeof clock!=='function')fail('unavailable');target=LOOKUP_ENDPOINT+'?key='+binding.apiKey;check();
  }catch{return Object.freeze({verify:()=>rejected('unavailable')});}
  function lookup(token,identity){
    let request=null,response=null,bytes=null,text='',parsed=null;
    try{
      check();timely(identity,now().ms,fresh);request={method:'post',contentType:'application/json; charset=utf-8',headers:{Accept:'application/json','Accept-Encoding':'identity'},payload:'{"idToken":'+JSON.stringify(token)+'}',followRedirects:false,muteHttpExceptions:true,validateHttpsCertificates:true,timeoutSeconds:20};
      try{response=fetch.call(host,target,request);}catch{fail('unavailable');}check();timely(identity,now().ms,fresh);
      const getCode=method(response,'getResponseCode'),getHeaders=method(response,'getAllHeaders'),getContent=method(response,'getContent');
      const responseCheck=()=>{check();if(method(response,'getResponseCode')!==getCode||method(response,'getAllHeaders')!==getHeaders||method(response,'getContent')!==getContent)fail('unavailable');};
      const status=getCode.call(response);responseCheck();if(!Number.isInteger(status)||status<100||status>599)fail('unavailable');if(status!==200)fail([400,401].includes(status)?'access_denied':'unavailable');
      const headers=getHeaders.call(response);responseCheck();responseHeaders(headers);bytes=getContent.call(response);responseCheck();text=decodeUtf8(bytes,MAX_RESPONSE_BYTES,'unavailable');parsed=parseJSON(text,'access_denied');
      const observed=now();responseCheck();timely(identity,observed.ms,fresh);return currentAccount(parsed,identity,observed.ms);
    }finally{if(request)request.payload='';request=null;response=null;bytes=null;text='';parsed=null;}
  }
  function verify(request){
    if(busy)return rejected('unavailable');busy=true;let token='',identity=null;
    try{
      if(arguments.length!==1)fail('invalid_request');exact(request,['idToken'],'invalid_request');token=field(request,'idToken','invalid_request');if(typeof token!=='string'||!token||token.length>MAX_TOKEN_BYTES||/[\r\n]/.test(token))fail('invalid_request');
      check();identity=claims(token,binding.projectId,now().ms,fresh);
      // Claims remain a candidate until Google's two fresh responses authenticate
      // the same original token. Decoding is never an authentication fallback.
      const initial=lookup(token,identity),final=lookup(token,identity);
      if(initial.validSinceMs!==null&&(final.validSinceMs===null||final.validSinceMs<initial.validSinceMs))fail('access_denied');
      const verified=now();timely(identity,verified.ms,fresh);check();return Object.freeze({ok:true,identity:Object.freeze({...identity,verifiedAt:verified.instant})});
    }catch(error){let code='unavailable';try{if(error instanceof CurrentIdentityError){const d=Object.getOwnPropertyDescriptor(error,'code');if(d&&own(d,'value')&&['invalid_request','access_denied','unavailable'].includes(d.value))code=d.value;}}catch{}return rejected(code);}
    finally{token='';identity=null;busy=false;}
  }
  return Object.freeze({verify});
}
const createAppsScriptEnrollmentGoogleIdentityVerifier=options=>createVerifier(options,true);
const createAppsScriptSessionGoogleIdentityVerifier=options=>createVerifier(options,false);
module.exports=Object.freeze({createAppsScriptEnrollmentGoogleIdentityVerifier,createAppsScriptSessionGoogleIdentityVerifier,DEFAULT_CONFIGURATION,MAX_TOKEN_BYTES,MAX_RESPONSE_BYTES});
