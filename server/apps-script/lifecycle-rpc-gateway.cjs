'use strict';
// SOURCE-OFF lifecycle HtmlService boundary; separate from pinned append lane.
// Runtime supplies authentication;
// the client request cannot select identity, worker, role, host or grant.
const Codec=require('../../legacy-lifecycle-client.js');
const DEFAULT_CONFIGURATION=Object.freeze({enabled:false,binding:Object.freeze({projectId:'',databaseURL:'',tenantId:''})});
const KINDS=['read','readFinance','execute','resolve'],CODES=new Set(['service_disabled','invalid_request','access_denied','unavailable','not_ready','conflict','capacity_limit','result_unknown','rate_limited','busy']);
const OWNER_METHODS=['readOwner','executeOwner','resolveOwner'];
const BUSINESS_METHODS=['readBusiness','executeOwnerBusiness','resolveOwnerBusiness'];
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const deny=error=>Object.freeze(error==='result_unknown'?{ok:false,error,retrySameCommand:true}:{ok:false,error});
const fail=()=>{throw Error('rpc_unavailable');};
function field(v,k){const d=v&&typeof v==='object'?Object.getOwnPropertyDescriptor(v,k):null;if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();return d.value;}
function exact(v,keys){if(!plain(v)||Reflect.ownKeys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail();for(const k of keys)field(v,k);}
function createAppsScriptLifecycleRpcGateway(options={}){
  let enabled=false;try{const d=plain(options)&&Object.getOwnPropertyDescriptor(options,'enabled');enabled=!!d&&Object.hasOwn(d,'value')&&d.value===true;}catch{}
  if(!enabled)return Object.freeze({dispatch:()=>deny('service_disabled'),dispatchJson:()=>JSON.stringify(deny('service_disabled'))});
  let binding,runtime,methods,runtimeKeys,drift=false,busy=false;
  function check(){if(drift)fail();try{for(const kind of runtimeKeys)if(field(runtime,kind)!==methods[kind])fail();}catch{drift=true;fail();}}
  try{
    exact(options,['enabled','binding','runtime']);const b=field(options,'binding');exact(b,['projectId','databaseURL','tenantId']);binding=Object.freeze({...b});
    Codec.normalizeLifecycleBinding({...binding,uid:'binding-probe',workerId:null,division:'qc',grantRevision:1});
    runtime=field(options,'runtime');runtimeKeys=Object.hasOwn(runtime,'readOwner')?KINDS.concat(OWNER_METHODS,Object.hasOwn(runtime,'readBusiness')?BUSINESS_METHODS:[]):KINDS;exact(runtime,runtimeKeys);methods={};for(const kind of runtimeKeys){methods[kind]=field(runtime,kind);if(typeof methods[kind]!=='function')fail();}Object.freeze(methods);check();
  }catch{return Object.freeze({dispatch:()=>deny('unavailable'),dispatchJson:()=>JSON.stringify(deny('unavailable'))});}
  function response(raw,kind,command){
    if(plain(raw)&&Object.hasOwn(raw,'error')){const code=field(raw,'error');if(!CODES.has(code)||code==='result_unknown'&&(kind==='read'||kind==='readFinance'))fail();exact(raw,code==='result_unknown'?['ok','error','retrySameCommand']:['ok','error']);if(raw.ok!==false||code==='result_unknown'&&raw.retrySameCommand!==true)fail();return deny(code);}
    if(kind==='execute'||kind==='resolve'){exact(raw,['ok','replayed','operationId']);if(raw.ok!==true||typeof raw.replayed!=='boolean'||raw.operationId!==command.operationId)fail();return Object.freeze({ok:true,replayed:raw.replayed,operationId:raw.operationId});}
    exact(raw,['ok','view']);if(raw.ok!==true)fail();const view=field(raw,'view'),b=field(view,'binding');
    for(const k of ['projectId','databaseURL','tenantId'])if(field(b,k)!==binding[k])fail();
    // Only the trusted runtime can supply this authenticated scoped binding.
    // Schema validation here does not authenticate a caller-provided profile.
    const normalized=kind==='read'?Codec.normalizeLegacyLifecycleView(view,b):Codec.normalizeLegacyLifecycleFinanceView(view,b);
    return Object.freeze({ok:true,view:normalized});
  }
  function dispatch(raw){
    if(busy)return deny('busy');busy=true;let request=null,command=null,kind=null,called=false;
    try{
      if(arguments.length!==1)return deny('invalid_request');
      try{
        kind=field(raw,'kind');if(!KINDS.includes(kind))fail();const writing=kind==='execute'||kind==='resolve';exact(raw,writing?['kind','idToken','command']:['kind','idToken']);const token=field(raw,'idToken');
        if(typeof token!=='string'||!token||token.length>16384||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))fail();
        command=writing?Codec.normalizeLegacyLifecycleCommand(field(raw,'command')):null;request=writing?{idToken:token,command}:{idToken:token};
      }catch{return deny('invalid_request');}
      check();called=true;const result=methods[kind].call(runtime,request);check();return response(result,kind,command);
    }catch{return deny(called&&(kind==='execute'||kind==='resolve')?'result_unknown':'unavailable');}
    finally{if(request)request.idToken='';request=null;command=null;busy=false;}
  }
  // HtmlService may omit nested null fields from object replies. Serialize only
  // this gateway's validated data result, never an unvalidated received object.
  function dispatchJson(raw){return JSON.stringify(arguments.length===1?dispatch(raw):deny('invalid_request'));}
  return Object.freeze({dispatch,dispatchJson});
}
module.exports=Object.freeze({createAppsScriptLifecycleRpcGateway,DEFAULT_CONFIGURATION});
