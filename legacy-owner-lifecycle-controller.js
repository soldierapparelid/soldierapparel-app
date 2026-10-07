/* SOURCE OFF: owner archive/PO forms with exact retained recovery. */
(function(root,factory){
  const api=typeof module==='object'&&module.exports?factory(require('./legacy-owner-lifecycle-client.js')):factory(root.SoldierLegacyOwnerLifecycleClient);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.SoldierLegacyOwnerLifecycleController=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Codec){
  'use strict';
  const FRESH=new Set(['ownerArchiveCycle','ownerRestoreCycle','ownerRelabelArchive','ownerSetPO']);
  const FIELDS=Object.freeze({ownerArchiveCycle:['label','startNewPO'],ownerRestoreCycle:['archiveId','safetyLabel'],ownerRelabelArchive:['archiveId','label'],ownerSetPO:['active','quantity','workDate','note']});
  const CODES=new Set(['service_disabled','access_denied','unavailable','not_ready','invalid_request','busy','conflict','capacity_limit','rate_limited','result_unknown','pending_review']);
  const error=code=>Object.freeze({ok:false,error:CODES.has(code)?code:'unavailable'});
  const copy=v=>JSON.parse(JSON.stringify(v));
  const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
  const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
  function createLegacyOwnerLifecycleController(options={}){
    let enabled=false;try{const d=Object.getOwnPropertyDescriptor(options,'enabled');enabled=!!d&&d.enumerable&&Object.hasOwn(d,'value')&&d.value===true;}catch{}
    if(!enabled)return Object.freeze({connect:async()=>error('service_disabled'),selectProduct:()=>error('service_disabled'),refresh:async()=>error('service_disabled'),refreshFinance:async()=>error('service_disabled'),submit:async()=>error('service_disabled'),retry:async()=>error('service_disabled'),dispose(){}});
    let phase='idle',code=null,binding=null,view=null,finance=null,productId=null,pending=[],busy=false,stopped=false,bridge=null,opening=null,epoch=0;
    const held=new Map();
    function current(){try{return !stopped&&options.isCurrent()===true;}catch{return false;}}
    function snapshot(){return freeze(copy({phase,error:code,binding,view,finance,productId,pending,busy}));}
    function stop(reason='access_denied'){
      if(stopped)return;stopped=true;epoch++;phase='blocked';code=CODES.has(reason)?reason:'unavailable';binding=null;view=null;finance=null;productId=null;pending=[];busy=false;held.clear();
      try{bridge?.dispose();}catch{}try{options.onState(snapshot());}catch{}
    }
    function check(){if(current())return true;stop();return false;}
    function emit(){if(stopped)return;try{options.onState(snapshot());}catch{stop('unavailable');}}
    function receive(raw){
      if(!current()||!binding)return;
      view=Codec.normalizeLegacyOwnerLifecycleView(raw,binding);finance=null;
      if(productId&&!view.products.some(p=>p.productId===productId))productId=null;
      if(phase==='ready')emit();
    }
    async function loadPending(definiteFailureId){
      const result=await bridge.pending();if(!check())return error('access_denied');
      if(!result?.ok||!Array.isArray(result.commands)||result.commands.length>512)return error(result?.error);
      const entries=new Map();for(const raw of result.commands){const cmd=Codec.normalizeLegacyOwnerLifecycleCommand(raw,binding.grantRevision);if(entries.has(cmd.requestId))throw Error();entries.set(cmd.requestId,cmd);}
      if(definiteFailureId&&held.has(definiteFailureId)&&(!entries.has(definiteFailureId)||canonical(entries.get(definiteFailureId))!==canonical(held.get(definiteFailureId))))held.delete(definiteFailureId);
      for(const [id,cmd]of held){if(entries.has(id)&&canonical(entries.get(id))!==canonical(cmd))throw Error();entries.set(id,cmd);}
      pending=freeze([...entries.values()]);return Object.freeze({ok:true});
    }
    function validProfile(profile,scope,b){
      if(!profile||typeof profile!=='object'||Array.isArray(profile)||profile.active!==true||profile.owner!==true)return false;
      const expected={active:true,owner:true,modules:{}};
      const expectedScope=Object.fromEntries(['projectId','databaseURL','tenantId','uid','grantRevision'].map(k=>[k,b[k]]));
      return canonical(profile)===canonical(expected)&&canonical(scope)===canonical(expectedScope);
    }
    async function connect(){
      if(!check())return error('access_denied');if(opening)return opening;if(phase==='ready')return Object.freeze({ok:true});
      if(!Codec||[options.createBridge,options.onState,options.isCurrent].some(v=>typeof v!=='function')){stop('unavailable');return error('unavailable');}
      phase='loading';emit();if(!check())return error('access_denied');const captured=epoch;
      opening=(async()=>{try{
        bridge=options.createBridge({onView:raw=>{if(binding&&current())try{receive(raw);}catch{stop('unavailable');}},onFinance:raw=>{if(binding&&current())try{throw Error('Unexpected owner finance reply');}catch{stop('unavailable');}},onClear:reason=>{if(reason!=='loading')stop(reason);}});
        const result=await bridge.connect();if(!check()||captured!==epoch)return error(code||'access_denied');if(!result?.ok){stop(result?.error);return error(result?.error);}
        const keys=['ok','profile','scope','binding','view'];if(Reflect.ownKeys(result).length!==keys.length||keys.some(k=>{const d=Object.getOwnPropertyDescriptor(result,k);return !d?.enumerable||!Object.hasOwn(d,'value');}))throw Error();
        const b=Codec.normalizeOwnerLifecycleBinding(result.binding),next=Codec.normalizeLegacyOwnerLifecycleView(result.view,b);if(!validProfile(result.profile,result.scope,b))throw Error();
        binding=b;view=next;const loaded=await loadPending();if(!check()||captured!==epoch)return error('access_denied');if(!loaded.ok){stop(loaded.error);return loaded;}
        phase='ready';code=null;emit();return current()?Object.freeze({ok:true}):error('access_denied');
      }catch{stop('unavailable');return error('unavailable');}})().finally(()=>{opening=null;});return opening;
    }
    function selectProduct(id){
      if(!check())return error('access_denied');if(phase!=='ready')return error('not_ready');if(busy)return error('busy');
      if(typeof id!=='string'||!view.products.some(p=>p.productId===id))return error('invalid_request');productId=id;code=null;emit();return current()?Object.freeze({ok:true}):error('access_denied');
    }
    async function refresh(financial=false){
      if(!check())return error('access_denied');if(phase!=='ready')return error('not_ready');if(busy)return error('busy');if(financial)return error('access_denied');
      busy=true;code=null;emit();const captured=epoch;
      try{
        const result=await (financial?bridge.readOwnFinance():bridge.readOwnerOperations());if(!check()||captured!==epoch)return error('access_denied');if(!result?.ok){code=result?.error;return error(code);}
        if(financial)finance=Codec.normalizeLegacyLifecycleFinanceView(result.view,binding);else receive(result.view);
        const loaded=await loadPending();if(!loaded.ok)code=loaded.error;return loaded;
      }catch{code='unavailable';return error(code);}finally{if(current()){busy=false;emit();}}
    }
    function form(kind,raw,p){
      if(!Object.hasOwn(FIELDS,kind)||!raw||typeof raw!=='object'||Array.isArray(raw)||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))throw Error();
      const keys=FIELDS[kind];if(Reflect.ownKeys(raw).length!==keys.length)throw Error();const data={};
      for(const k of keys){const d=Object.getOwnPropertyDescriptor(raw,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))throw Error();data[k]=d.value;}
      if(kind==='ownerArchiveCycle')data.archiveId='archive-validation';if(kind==='ownerRestoreCycle'){data.safetyArchiveId=p.hasCurrent?'safety-validation':null;if(!p.hasCurrent&&data.safetyLabel!==null)throw Error();}
      const provisional={kind,requestId:'request-validation',operationId:FRESH.has(kind)?'operation-validation':data.operationId,productId:p.productId,expectedGrantRevision:binding.grantRevision,expectedSourceVersion:p.sourceVersion,...data};
      const checked=Codec.normalizeLegacyOwnerLifecycleCommand(provisional,binding.grantRevision);
      if(!Codec.ownerCommandMatchesView(view,checked))return error('conflict');
      const id=(options.newId||(()=>globalThis.crypto.randomUUID()))();if(!check())return error('access_denied');if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(id)||/^\d+$/.test(id))throw Error();
      const generated={...checked,requestId:'request-'+id,operationId:'operation-'+id};if(kind==='ownerArchiveCycle')generated.archiveId='archive-'+id;if(kind==='ownerRestoreCycle'&&p.hasCurrent)generated.safetyArchiveId='safety-'+id;
      if(!Codec.ownerCommandMatchesView(view,generated))return error('conflict');return {ok:true,command:Codec.normalizeLegacyOwnerLifecycleCommand(generated,binding.grantRevision)};
    }
    async function execute(command){
      held.set(command.requestId,command);pending=freeze([...new Map([...pending.map(c=>[c.requestId,c]),[command.requestId,command]]).values()]);finance=null;emit();const captured=epoch;
      let result,definiteFailureId;
      try{
        const prepared=await bridge.prepare(command);if(!check()||captured!==epoch)return error('access_denied');
        if(!prepared?.ok&&['conflict','capacity_limit','invalid_request'].includes(prepared?.error))definiteFailureId=command.requestId;
        result=prepared?.ok?await bridge.send(command.requestId):error(prepared?.error);if(!check()||captured!==epoch)return error('access_denied');
        if(prepared?.ok&&!result?.ok&&['conflict','invalid_request'].includes(result?.error))definiteFailureId=command.requestId;
        if(result?.ok){held.delete(command.requestId);const fresh=await bridge.readOwnerOperations();if(!check()||captured!==epoch)return error('access_denied');if(fresh?.ok)receive(fresh.view);else code=fresh?.error||'unavailable';}
        const loaded=await loadPending(definiteFailureId);if(!loaded.ok&&!result?.ok)result=loaded;if(!result?.ok)code=result?.error||'unavailable';return result?.ok?result:error(code);
      }catch{code='unavailable';return error(code);}
    }
    async function submit(kind,raw){
      if(!check())return error('access_denied');if(phase!=='ready'||!productId)return error('not_ready');if(busy)return error('busy');busy=true;code=null;emit();const captured=epoch;
      try{
        const loaded=await loadPending();if(!check()||captured!==epoch)return error('access_denied');if(!loaded.ok)return error(loaded.error);
        if(pending.some(cmd=>cmd.productId===productId)){code='pending_review';return error(code);}
        const p=view.products.find(p=>p.productId===productId);if(!p)return error('not_ready');let normalized;
        try{normalized=form(kind,raw,p);}catch{code='invalid_request';return error(code);}
        if(!normalized.ok){code=normalized.error;return normalized;}return await execute(normalized.command);
      }catch{code='unavailable';return error(code);}finally{if(current()){busy=false;emit();}}
    }
    async function retry(requestId){
      if(!check())return error('access_denied');if(phase!=='ready')return error('not_ready');if(busy)return error('busy');busy=true;code=null;emit();
      try{const loaded=await loadPending();if(!loaded.ok)return error(loaded.error);const command=pending.find(cmd=>cmd.requestId===requestId);if(!command)return error('invalid_request');return await execute(command);}
      catch{code='unavailable';return error(code);}finally{if(current()){busy=false;emit();}}
    }
    return Object.freeze({connect,selectProduct,refresh:()=>refresh(false),refreshFinance:()=>refresh(true),submit,retry,dispose:()=>stop('access_denied')});
  }
  return Object.freeze({createLegacyOwnerLifecycleController});
});
