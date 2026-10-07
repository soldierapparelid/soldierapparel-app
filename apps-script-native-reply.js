/* Pure bounded data copy for native HtmlService replies from another JS realm.
 * No stringify/toJSON/getter invocation on the received object. DTO checks follow. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SoldierAppsScriptNativeReply=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const RESERVED=new Set(['__proto__','constructor','prototype']),MAX_BYTES=1048704,MAX_NODES=100000;
  const fail=()=>{throw Error('invalid_native_script_reply');};
  function nativePrototype(prototype,name){
    if(!prototype||typeof prototype!=='object')return false;
    const ctor=Object.getOwnPropertyDescriptor(prototype,'constructor');
    if(!ctor||!Object.hasOwn(ctor,'value')||typeof ctor.value!=='function')return false;
    const declared=Object.getOwnPropertyDescriptor(ctor.value,'prototype');
    return !!declared&&Object.hasOwn(declared,'value')&&declared.value===prototype&&Function.prototype.toString.call(ctor.value)==='function '+name+'() { [native code] }';
  }
  function plainPrototype(prototype){return prototype===null||Object.getPrototypeOf(prototype)===null&&nativePrototype(prototype,'Object');}
  function utf8Length(s){let n=0;for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c<128)n++;else if(c<2048)n+=2;else if(c>=0xd800&&c<=0xdbff&&s.charCodeAt(i+1)>=0xdc00&&s.charCodeAt(i+1)<=0xdfff){n+=4;i++;}else n+=3;}return n;}
  function decodeDataString(raw){
    if(utf8Length(raw)>MAX_BYTES)fail();const stack=[];
    for(let i=0;i<raw.length;i++){
      const c=raw[i];
      if(c==='"'){let end=i+1;for(;end<raw.length;end++){if(raw[end]==='\\'){end++;continue;}if(raw[end]==='"')break;}if(end>=raw.length)fail();const top=stack.at(-1);if(top?.object&&top.key){const key=JSON.parse(raw.slice(i,end+1));if(RESERVED.has(key)||top.keys.has(key))fail();top.keys.add(key);top.key=false;}i=end;}
      else if(c==='{'||c==='['){stack.push(c==='{'?{object:true,key:true,keys:new Set()}:{object:false});if(stack.length>16)fail();}
      else if(c==='}'||c===']')stack.pop();
      else if(c===','&&stack.at(-1)?.object)stack.at(-1).key=true;
    }
    return JSON.parse(raw);
  }
  function normalizeAppsScriptDataReply(raw){
    // Serialized gateway replies preserve null fields through native RPC.
    // Bound and inspect the JSON before parsing; DTO validation still follows.
    if(typeof raw==='string')raw=decodeDataString(raw);
    const seen=new Set();let nodes=0,encodedBytes=0;
    function size(n){encodedBytes+=n;if(encodedBytes>MAX_BYTES)fail();}
    function copy(value,depth){
      if(++nodes>MAX_NODES||depth>16)fail();
      if(value===null||typeof value==='boolean'){size(value===null?4:value?4:5);return value;}
      if(typeof value==='string'){size(utf8Length(JSON.stringify(value)));return value;}
      if(typeof value==='number'){if(!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER||Object.is(value,-0))fail();size(JSON.stringify(value).length);return value;}
      if(!value||typeof value!=='object'||seen.has(value))fail();const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
      if(array?!nativePrototype(prototype,'Array')||!plainPrototype(Object.getPrototypeOf(prototype)):!plainPrototype(prototype))fail();
      const keys=Reflect.ownKeys(value);let fields=keys;
      if(array){const length=Object.getOwnPropertyDescriptor(value,'length');if(!length||!Object.hasOwn(length,'value')||!Number.isSafeInteger(length.value)||length.value<0||length.value>MAX_NODES||keys.length!==length.value+1)fail();fields=Array.from({length:length.value},(_,i)=>String(i));if(keys.some(k=>k!=='length'&&(typeof k!=='string'||!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=length.value)))fail();}
      const output=array?[]:Object.create(null);seen.add(value);
      size(2+Math.max(0,fields.length-1));
      for(const key of fields){if(typeof key!=='string'||RESERVED.has(key))fail();const d=Object.getOwnPropertyDescriptor(value,key);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();if(!array)size(utf8Length(JSON.stringify(key))+1);output[key]=copy(d.value,depth+1);}
      seen.delete(value);return output;
    }
    return copy(raw,0);
  }
  return Object.freeze({normalizeAppsScriptDataReply});
});
