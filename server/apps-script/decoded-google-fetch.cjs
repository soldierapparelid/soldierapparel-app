'use strict';
// SOURCE OFF. Normalize only bounded JSON that a trusted UrlFetch host already
// decoded, while its response still advertises gzip. Never decompress wire data.
const LIMIT=65536,DEFAULT_CONFIGURATION=Object.freeze({enabled:false,binding:Object.freeze({projectId:'',apiKey:''})});
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const fail=()=>{throw Error('google_response_unavailable');};
function field(v,k){const d=v&&typeof v==='object'?Object.getOwnPropertyDescriptor(v,k):null;if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail();return d.value;}
function exact(v,keys){if(!plain(v)||Reflect.ownKeys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail();for(const k of keys)field(v,k);}
function method(v,k){for(let p=v,n=0;p&&typeof p==='object'&&n<8;p=Object.getPrototypeOf(p),n++){const d=Object.getOwnPropertyDescriptor(p,k);if(d){if(!Object.hasOwn(d,'value')||typeof d.value!=='function')fail();return d.value;}}fail();}
function bytes(raw){if(!Array.isArray(raw)||Object.getPrototypeOf(raw)!==Array.prototype||raw.length>LIMIT||Reflect.ownKeys(raw).length!==raw.length+1)fail();const out=[];for(let i=0;i<raw.length;i++){const n=field(raw,String(i));if(!Number.isInteger(n)||n< -128||n>255)fail();out.push(n);}return out;}
function jsonUtf8(raw){const chars=[];for(let i=0;i<raw.length;){const a=(raw[i++]+256)%256;let cp=a,extra=0,min=0;if(a<128){}else if(a>=0xc2&&a<=0xdf){cp=a&31;extra=1;min=128;}else if(a>=0xe0&&a<=0xef){cp=a&15;extra=2;min=2048;}else if(a>=0xf0&&a<=0xf4){cp=a&7;extra=3;min=65536;}else fail();for(let j=0;j<extra;j++){if(i>=raw.length)fail();const b=(raw[i++]+256)%256;if((b&192)!==128)fail();cp=cp*64+(b&63);}if(cp<min||cp>0x10ffff||cp>=0xd800&&cp<=0xdfff)fail();chars.push(String.fromCodePoint(cp));}const text=chars.join('');if(!/^[\x20\r\n\t]*\{/.test(text))fail();let parsed;try{parsed=JSON.parse(text);}catch{fail();}if(!plain(parsed))fail();}
function headers(raw){if(!plain(raw)||Reflect.ownKeys(raw).length>128)fail();const selected=Object.create(null),seen=new Set();for(const k of Reflect.ownKeys(raw)){if(typeof k!=='string')fail();const value=field(raw,k),lower=k.toLowerCase();if(['content-type','content-length','content-encoding','location'].includes(lower)){if(seen.has(lower)||typeof value!=='string'||value.length>1024||/[\r\n\x00]/.test(value))fail();seen.add(lower);selected[lower]=value;}}if(Object.hasOwn(selected,'location')||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(selected['content-type']||''))fail();if(Object.hasOwn(selected,'content-length')&&(!/^(0|[1-9][0-9]*)$/.test(selected['content-length'])||Number(selected['content-length'])>LIMIT))fail();if(Object.hasOwn(selected,'content-encoding')&&!['identity','gzip'].includes(selected['content-encoding']))fail();return selected;}
function createAppsScriptDecodedGoogleFetch(options={}){
  let enabled=false;try{const d=plain(options)&&Object.getOwnPropertyDescriptor(options,'enabled');enabled=!!d&&Object.hasOwn(d,'value')&&d.value===true;}catch{}
  const disabled=()=>Object.freeze({fetch(){fail();}});if(!enabled)return disabled();
  let host,fetch,target,drift=false,busy=false;
  function check(){if(drift)fail();try{if(method(host,'fetch')!==fetch)fail();}catch{drift=true;fail();}}
  try{exact(options,['enabled','binding','urlFetchApp']);const b=field(options,'binding');exact(b,['projectId','apiKey']);if(typeof b.projectId!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(b.projectId)||typeof b.apiKey!=='string'||!/^[A-Za-z0-9_-]{20,128}$/.test(b.apiKey))fail();target='https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+b.apiKey;host=field(options,'urlFetchApp');fetch=method(host,'fetch');check();}catch{return disabled();}
  function dispatch(url,request){
    if(busy)fail();busy=true;let response=null,rawBytes=null,rawHeaders=null;
    try{if(arguments.length!==2||url!==target)fail();exact(request,['method','contentType','headers','payload','followRedirects','muteHttpExceptions','validateHttpsCertificates','timeoutSeconds']);exact(request.headers,['Accept','Accept-Encoding']);if(request.method!=='post'||request.contentType!=='application/json; charset=utf-8'||request.headers.Accept!=='application/json'||request.headers['Accept-Encoding']!=='identity'||typeof request.payload!=='string'||request.payload.length>16420||!/^\{"idToken":"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"\}$/.test(request.payload)||request.followRedirects!==false||request.muteHttpExceptions!==true||request.validateHttpsCertificates!==true||request.timeoutSeconds!==20)fail();
      check();response=fetch.call(host,url,request);check();const getCode=method(response,'getResponseCode'),getHeaders=method(response,'getAllHeaders'),getContent=method(response,'getContent');
      const responseCheck=()=>{check();if(method(response,'getResponseCode')!==getCode||method(response,'getAllHeaders')!==getHeaders||method(response,'getContent')!==getContent)fail();};
      const code=getCode.call(response);responseCheck();if(!Number.isInteger(code)||code<100||code>599)fail();if(code!==200)return Object.freeze({getResponseCode:()=>code,getAllHeaders:()=>Object.freeze({}),getContent:()=>Object.freeze([])});
      rawHeaders=getHeaders.call(response);responseCheck();const selected=headers(rawHeaders);rawBytes=getContent.call(response);responseCheck();const content=bytes(rawBytes);jsonUtf8(content);
      // No gzip codec: compressed magic, malformed UTF-8 or invalid JSON fail.
      // The strict account verifier still rejects duplicate JSON keys, wrong
      // claims, accounts/provider links, revocation and altered signatures.
      if(selected['content-encoding']==='gzip'){selected['content-encoding']='identity';selected['content-length']=String(content.length);}
      const controls=Object.freeze({...selected}),boundedContent=Object.freeze(content);responseCheck();return Object.freeze({getResponseCode:()=>code,getAllHeaders:()=>controls,getContent:()=>boundedContent});
    }catch{fail();}finally{response=null;rawBytes=null;rawHeaders=null;busy=false;}
  }
  return Object.freeze({fetch:dispatch});
}
module.exports=Object.freeze({createAppsScriptDecodedGoogleFetch,DEFAULT_CONFIGURATION,LIMIT});
