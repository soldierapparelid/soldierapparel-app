'use strict';
// Internal, SOURCE-OFF fixed working transport. No browser/RPC entry point.
const Rest=require('./protected-rest-wire.cjs');
const Scope=require('./protected-storage-scope.cjs');
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const error=code=>Object.freeze(code==='result_unknown'?{ok:false,error:code,retrySameCommand:true}:{ok:false,error:code});
function exact(v,keys){if(!plain(v)||Reflect.ownKeys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))throw Error('invalid_request');for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))throw Error('invalid_request');}}
function createAppsScriptProtectedWorkingAdapter(options={}){
  let enabled=false;try{const d=plain(options)&&Object.getOwnPropertyDescriptor(options,'enabled');enabled=!!d&&Object.hasOwn(d,'value')&&d.value===true;}catch{}
  const disabled=code=>Object.freeze({read:()=>error(code),compareAndSwap:()=>error(code)});
  if(!enabled)return disabled('service_disabled');
  let scope,transport,retained=null;
  try{
    exact(options,['enabled','binding','migration','urlFetchApp','scriptApp','verifyCurrentIdentity','clock']);
    scope=Scope.createProtectedStorageScope({enabled:true,binding:options.binding,migration:options.migration});
    // Validate the source-controlled scope before any host or credential call.
    if(scope.readWorking({working:{}}).error!=='not_ready')throw Error('unavailable');
    transport=Rest.createAppsScriptProtectedRestWire({enabled:true,binding:options.binding,urlFetchApp:options.urlFetchApp,scriptApp:options.scriptApp,verifyCurrentIdentity:options.verifyCurrentIdentity,clock:options.clock});
  }catch{return disabled('unavailable');}
  function read(){
    retained=null;if(arguments.length!==0)return error('invalid_request');
    const observed=transport.read();if(observed.ok!==true)return observed;
    const checked=scope.readWorking({working:observed.root});if(checked.ok!==true)return checked;
    retained=Object.freeze({etag:observed.etag,working:observed.root,revision:checked.revision});
    return Object.freeze({ok:true,etag:observed.etag,root:checked.root});
  }
  function compareAndSwap(input){
    try{if(arguments.length!==1)throw Error('invalid_request');exact(input,['expectedETag','next']);}catch{return error('invalid_request');}
    if(!retained)return error('not_ready');
    if(input.expectedETag!==retained.etag)return error('conflict');
    const proposed=scope.prepareWorkingWrite({working:retained.working,nextRoot:input.next,expectedRevision:retained.revision});if(proposed.ok!==true)return proposed;
    const acknowledged=transport.compareAndSwap({expectedETag:input.expectedETag,next:proposed.nextWorking});
    // No reuse of an uncertain/stale envelope. Receipt recovery requires a new
    // working read and the coordinator's existing retained command resolver.
    retained=null;if(acknowledged.ok!==true)return acknowledged;
    retained=Object.freeze({etag:acknowledged.etag,working:proposed.nextWorking,revision:proposed.nextWorking.revision});
    return acknowledged;
  }
  return Object.freeze({read,compareAndSwap});
}
module.exports=Object.freeze({createAppsScriptProtectedWorkingAdapter,MAX_WORKING_BYTES:Scope.MAX_WORKING_BYTES});
