'use strict';
// Offline feasibility primitives only. No network, OAuth, SDK or logging.
// The trusted Utilities object is supplied explicitly by the offline harness.
const MAX_BYTES=8*1024*1024,MAX_ORIGIN_CHARS=256;
const fail=()=>{throw new Error('apps_script_compatibility');};
function invoke(fn,receiver,args){try{return fn.apply(receiver,args);}catch(_){fail();}}
function field(value,key){
  if(!value||typeof value!=='object')fail();
  const d=Object.getOwnPropertyDescriptor(value,key);
  if(!d||!Object.hasOwn(d,'value'))fail();return d.value;
}
function method(value,key){
  if(!value||typeof value!=='object')fail();let current=value;
  for(let depth=0;current&&depth<8;depth++,current=Object.getPrototypeOf(current)){
    const d=Object.getOwnPropertyDescriptor(current,key);
    if(d){if(!Object.hasOwn(d,'value')||typeof d.value!=='function')fail();return d.value;}
  }fail();
}
function wellFormed(value){
  // Java's handling of lone UTF-16 surrogates must not change Node UTF-8 hashes.
  // Convert only unpaired surrogates to U+FFFD before handing text to Utilities.
  let out='';
  for(let i=0;i<value.length;i++){
    const code=value.charCodeAt(i);
    if(code>=0xd800&&code<=0xdbff){const next=value.charCodeAt(i+1);
      if(next>=0xdc00&&next<=0xdfff){out+=value[i]+value[++i];}else out+='\ufffd';
    }else if(code>=0xdc00&&code<=0xdfff)out+='\ufffd';else out+=value[i];
  }return out;
}
function utf8Length(value){
  // Exact size without native calls or byte allocation, including oversized roots.
  let size=0;
  for(let i=0;i<value.length;i++){
    const code=value.charCodeAt(i);
    if(code<0x80)size++;else if(code<0x800)size+=2;
    else if(code>=0xd800&&code<=0xdbff&&value.charCodeAt(i+1)>=0xdc00&&value.charCodeAt(i+1)<=0xdfff){size+=4;i++;}
    else size+=3;
  }return size;
}
function denseBytes(value,limit,expected){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)fail();
  const length=field(value,'length');
  if(!Number.isSafeInteger(length)||length<0||length>limit||expected!==undefined&&length!==expected)fail();
  const keys=Reflect.ownKeys(value);
  if(keys.length!==length+1||keys.some(k=>typeof k!=='string'||k!=='length'&&(!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=length)))fail();
  const out=[];
  for(let i=0;i<length;i++){
    const d=Object.getOwnPropertyDescriptor(value,String(i));
    if(!d||!d.enumerable||!Object.hasOwn(d,'value')||!Number.isInteger(d.value)||d.value< -128||d.value>255)fail();
    out.push(d.value>127?d.value-256:d.value);
  }return out;
}
function createAppsScriptPrimitives(utilities){
  const blobMethod=method(utilities,'newBlob'),digestMethod=method(utilities,'computeDigest');
  const algorithms=field(utilities,'DigestAlgorithm'),sha256=field(algorithms,'SHA_256');
  if(sha256===undefined||sha256===null)fail();
  function unchanged(){
    if(method(utilities,'newBlob')!==blobMethod||method(utilities,'computeDigest')!==digestMethod||field(utilities,'DigestAlgorithm')!==algorithms||field(algorithms,'SHA_256')!==sha256)fail();
  }
  function bytes(value){
    if(typeof value!=='string')fail();const size=utf8Length(value);if(size>MAX_BYTES)fail();
    unchanged();const blob=invoke(blobMethod,utilities,[wellFormed(value),'text/plain']);
    const getBytes=method(blob,'getBytes');const result=denseBytes(invoke(getBytes,blob,[]),MAX_BYTES,size);unchanged();return result;
  }
  const Buffer=Object.freeze({byteLength(value,encoding){
    if(typeof value!=='string'||encoding!==undefined&&encoding!=='utf8'&&encoding!=='utf-8')fail();
    // Serialization counts many small fragments. Their exact UTF-8 size does
    // not need a native Blob; hashing alone uses validated Utilities bytes.
    // Preserve the exact over-budget count for the core's capacity_limit check.
    return utf8Length(value);
  }});
  const crypto=Object.freeze({createHash(algorithm){
    if(algorithm!=='sha256')fail();let chunks=[],size=0,finalized=false;
    const hash=Object.freeze({update(value,encoding){
      if(finalized||encoding!==undefined&&encoding!=='utf8'&&encoding!=='utf-8')fail();
      const chunk=bytes(value);if(size+chunk.length>MAX_BYTES)fail();size+=chunk.length;chunks.push(chunk);return hash;
    },digest(encoding){
      if(finalized||encoding!=='hex')fail();finalized=true;unchanged();
      const all=[];for(const chunk of chunks)for(const byte of chunk)all.push(byte);chunks=[];
      const result=denseBytes(invoke(digestMethod,utilities,[sha256,all]),32,32);unchanged();
      return result.map(byte=>(byte<0?byte+256:byte).toString(16).padStart(2,'0')).join('');
    }});return hash;
  }});
  class FirebaseOriginURL{
    constructor(value){
      // Deliberately a narrow origin adapter, never a general URL parser.
      if(typeof value!=='string'||value.length>MAX_ORIGIN_CHARS||!/^https:\/\/([a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app)$/.test(value))fail();
      Object.assign(this,{protocol:'https:',origin:value,hostname:value.slice(8),port:'',username:'',password:'',search:'',hash:''});Object.freeze(this);
    }
  }
  return Object.freeze({Buffer,crypto,URL:FirebaseOriginURL,MAX_BYTES,MAX_ORIGIN_CHARS});
}
module.exports=Object.freeze({createAppsScriptPrimitives,MAX_BYTES,MAX_ORIGIN_CHARS});
