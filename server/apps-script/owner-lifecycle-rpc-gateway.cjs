'use strict';
// SOURCE OFF. Dedicated owner route; the current runtime independently verifies
// retained initial-owner authority. A request cannot select an identity or role.
const Codec=require('../../legacy-owner-lifecycle-client.js');
const DEFAULT_CONFIGURATION=Object.freeze({enabled:false,binding:Object.freeze({projectId:'',databaseURL:'',tenantId:''})});
const METHODS=['readOwner','executeOwner','resolveOwner'],CODES=new Set(['service_disabled','invalid_request','access_denied','unavailable','not_ready','conflict','capacity_limit','result_unknown','rate_limited','busy']);
const BUSINESS_METHODS=['readBusiness','executeOwnerBusiness','resolveOwnerBusiness'];
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v)),fail=()=>{throw Error('owner_rpc_unavailable');};
const deny=error=>Object.freeze(error==='result_unknown'?{ok:false,error,retrySameCommand:true}:{ok:false,error});
function field(v,k){const d=v&&typeof v==='object'?Object.getOwnPropertyDescriptor(v,k):null;if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();return d.value;}
function exact(v,keys){if(!plain(v)||Reflect.ownKeys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail();for(const k of keys)field(v,k);}
function createAppsScriptOwnerLifecycleRpcGateway(options={}){
  let enabled=false;try{const d=plain(options)&&Object.getOwnPropertyDescriptor(options,'enabled');enabled=!!d&&Object.hasOwn(d,'value')&&d.value===true;}catch{}
  const disabled=error=>Object.freeze({dispatch:()=>deny(error),dispatchJson:()=>JSON.stringify(deny(error))});if(!enabled)return disabled('service_disabled');
  let binding,runtime,methods,keys,busy=false,drift=false;
  function check(){if(drift)fail();try{exact(runtime,keys);for(const k of keys)if(field(runtime,k)!==methods[k])fail();}catch{drift=true;fail();}}
  try{exact(options,['enabled','binding','runtime']);const b=field(options,'binding');exact(b,['projectId','databaseURL','tenantId']);binding=Object.freeze({...b});Codec.normalizeOwnerLifecycleBinding({...binding,uid:'binding-probe',workerId:null,division:'owner',grantRevision:1});runtime=field(options,'runtime');keys=Object.hasOwn(runtime,'read')?['read','readFinance','execute','resolve',...METHODS,...(Object.hasOwn(runtime,'readBusiness')?BUSINESS_METHODS:[])]:METHODS;exact(runtime,keys);methods={};for(const k of keys){methods[k]=field(runtime,k);if(typeof methods[k]!=='function')fail();}Object.freeze(methods);check();}catch{return disabled('unavailable');}
  function response(raw,kind,command){
    if(plain(raw)&&Object.hasOwn(raw,'error')){const code=field(raw,'error');if(!CODES.has(code)||code==='result_unknown'&&kind==='read')fail();exact(raw,code==='result_unknown'?['ok','error','retrySameCommand']:['ok','error']);if(raw.ok!==false||code==='result_unknown'&&raw.retrySameCommand!==true)fail();return deny(code);}
    if(kind!=='read'){exact(raw,['ok','replayed','operationId']);if(raw.ok!==true||typeof raw.replayed!=='boolean'||raw.operationId!==command.operationId)fail();return Object.freeze({...raw});}
    exact(raw,['ok','view']);if(raw.ok!==true)fail();const v=field(raw,'view'),b=field(v,'binding');for(const k of ['projectId','databaseURL','tenantId'])if(field(b,k)!==binding[k])fail();return Object.freeze({ok:true,view:Codec.normalizeLegacyOwnerLifecycleView(v,b)});
  }
  function dispatch(raw){if(busy)return deny('busy');busy=true;let request=null,kind=null,command=null,called=false;try{
    if(arguments.length!==1)return deny('invalid_request');
    try{kind=field(raw,'kind');if(!['read','execute','resolve'].includes(kind))fail();const writing=kind!=='read';exact(raw,writing?['kind','idToken','command']:['kind','idToken']);const token=field(raw,'idToken');if(typeof token!=='string'||!token||token.length>16384||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))fail();command=writing?Codec.normalizeLegacyOwnerLifecycleCommand(field(raw,'command')):null;request=writing?{idToken:token,command}:{idToken:token};}catch{return deny('invalid_request');}
    check();called=true;const name={read:'readOwner',execute:'executeOwner',resolve:'resolveOwner'}[kind],result=methods[name].call(runtime,request);check();return response(result,kind,command);
  }catch{return deny(called&&kind!=='read'?'result_unknown':'unavailable');}finally{if(request)request.idToken='';request=null;command=null;busy=false;}}
  return Object.freeze({dispatch,dispatchJson:function(raw){return JSON.stringify(arguments.length===1?dispatch(raw):deny('invalid_request'));}});
}
module.exports=Object.freeze({createAppsScriptOwnerLifecycleRpcGateway,DEFAULT_CONFIGURATION});
