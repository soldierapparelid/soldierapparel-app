/* Canonical production form orchestration. No legacy IO or browser payroll. */
(function(root,factory){
  const api=typeof module==='object'&&module.exports?factory(require('./production-command-client.js'),require('./production-view-client.js'),require('./operations-codec.js'),require('./maklon-earnings.js')):factory(root.SoldierProductionCommandClient,root.SoldierProductionViewClient,root.SoldierOperationsCodec,root.SoldierMaklonEarnings);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.SoldierProductionFormController=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Command,View,Codec,Earnings){
  'use strict';
  const safe=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
  const copy=v=>JSON.parse(JSON.stringify(v));
  const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
  const outcome=error=>Object.freeze({ok:false,error});
  const codes=new Set(['invalid_request','access_denied','conflict','capacity_limit','unavailable','result_unknown','busy','not_ready','service_disabled','pending_review']);
  const code=r=>codes.has(r?.error)?r.error:'unavailable';
  function fail(){throw Error('invalid_form');}
  function inspect(v,depth=0,seen=new Set(),budget={n:0}){
    if(depth>32||++budget.n>250000)fail();
    if(v===null||typeof v==='boolean'||typeof v==='string'||typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=Number.MAX_SAFE_INTEGER)return;
    if(!v||typeof v!=='object'||seen.has(v)||!([Object.prototype,null].includes(Object.getPrototypeOf(v))||Array.isArray(v)&&Object.getPrototypeOf(v)===Array.prototype))fail();
    seen.add(v);const keys=Reflect.ownKeys(v);
    for(const k of keys){if(typeof k!=='string'||['__proto__','constructor','prototype'].includes(k))fail();if(Array.isArray(v)&&k==='length')continue;const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!d.enumerable||!Object.hasOwn(d,'value')||Array.isArray(v)&&(!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=v.length))fail();inspect(d.value,depth+1,seen,budget);}
    if(Array.isArray(v)&&keys.length!==v.length+1)fail();seen.delete(v);
  }
  function exact(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Reflect.ownKeys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail();}
  function bounded(v){inspect(v);if(new TextEncoder().encode(JSON.stringify(v)).length>8*1024*1024)fail();}
  function createProductionFormController(options={}){
    const moduleName=options.module;
    let phase='idle',error=null,profile=null,scope=null,manifest=[],labels=[],cycles=[],selected=null,pending=[],busy=false,stopped=false,bridge,opening,latestView,epoch=0;
    const disabled=options.enabled!==true;
    const held=new Map();
    const allowedKind=(kind,targetType)=>profile&&(profile.owner||profile.modules?.[kind==='sewing'||kind==='cancel'&&targetType==='sewing'?'jahit':'qc']===true);
    function current(){try{return !stopped&&options.isCurrent()===true;}catch{return false;}}
    function emit(){try{options.onState(freeze(copy({phase,error,module:moduleName,profile,selectedCycle:selected,cycles,pending,busy})));}catch{stop('unavailable');}}
    function stop(reason='access_denied'){
      if(stopped)return;stopped=true;epoch++;phase='blocked';error=codes.has(reason)?reason:'access_denied';profile=null;scope=null;manifest=[];labels=[];cycles=[];selected=null;pending=[];latestView=null;busy=false;
      held.clear();try{bridge?.dispose();}catch{}try{options.onState(freeze({phase,error,module:moduleName,profile:null,selectedCycle:null,cycles:[],pending:[],busy:false}));}catch{}
    }
    function check(){if(!current()){stop();return false;}return true;}
    function validatedCommand(command){return Command.decodeJournal(JSON.stringify({schemaVersion:1,scope,endpointURL:options.endpointURL,entries:[{command,receipt:null}]}),scope,options.endpointURL).entries[0].command;}
    function acceptView(value){
      bounded(value);exact(value,['cycles','complete','consistency']);if(!Array.isArray(value.cycles)||value.cycles.length>256||typeof value.complete!=='boolean'||value.consistency!=='independent-listeners')fail();
      const seen=new Set();for(const c of value.cycles){exact(c,['productId','cycleId','revision','operations','wage']);if(!safe(c.productId)||!safe(c.cycleId)||!Number.isSafeInteger(c.revision)||c.revision<0||seen.has(c.productId+'/'+c.cycleId))fail();seen.add(c.productId+'/'+c.cycleId);Codec.decode({[c.productId]:c.operations});}
      latestView=freeze(copy(value));if(scope)applyView();
    }
    function applyView(){
      if(!latestView)return;
      const list=[];for(const c of latestView.cycles){if(!manifest.some(x=>x.productId===c.productId&&x.cycleId===c.cycleId)||c.operations.id!==c.productId)fail();
        let operations=copy(c.operations),wage=null;
        // An account with several modules still gets an own-work Jahit form.
        if(moduleName==='jahit'&&!profile.owner){
          const worker=profile.workerId;if(!safe(worker))fail();
          for(const field of ['assignJahit','jahit','hitungFisik','qc','repairs','gudang'])if(operations[field]){operations[field]=operations[field].filter(r=>r.tukangId===worker);if(!operations[field].length)delete operations[field];}
          const warehouse=new Set((operations.gudang||[]).map(r=>r.id));if(operations.bigSaller){operations.bigSaller=operations.bigSaller.filter(r=>warehouse.has(r.gudangId));if(!operations.bigSaller.length)delete operations.bigSaller;}
          if(!(operations.assignJahit||[]).length)continue;
          if(c.wage!==null){if(c.wage.workerId!==worker||c.wage.entries.some(r=>r.productId!==c.productId))fail();Earnings.summarize(c.wage);wage=copy(c.wage);}
        }
        const catalog=labels.find(l=>l.productId===c.productId&&l.cycleId===c.cycleId)?.workers||[];
        list.push({productId:c.productId,cycleId:c.cycleId,revision:c.revision,operations,wage,workerLabels:moduleName==='jahit'&&!profile.owner?catalog.filter(w=>w.workerId===profile.workerId):catalog});
      }
      cycles=freeze(list);if(selected&&!cycles.some(c=>c.productId===selected.productId&&c.cycleId===selected.cycleId))selected=null;
      if(phase==='ready')emit();
    }
    async function loadPending(){
      const r=await bridge.pending();if(!check())return outcome('access_denied');if(!r?.ok||!Array.isArray(r.commands))return outcome(code(r));
      const doc=Command.decodeJournal(JSON.stringify({schemaVersion:1,scope,endpointURL:options.endpointURL,entries:r.commands.map(command=>({command,receipt:null}))}),scope,options.endpointURL);
      if(doc.entries.some(e=>!manifest.some(c=>c.productId===e.command.productId&&c.cycleId===e.command.cycleId)))fail();
      const merged=new Map(doc.entries.map(e=>[e.command.requestId,e.command]));
      for(const [id,command]of held){if(merged.has(id)&&JSON.stringify(merged.get(id))!==JSON.stringify(command))fail();merged.set(id,command);}
      pending=freeze([...merged.values()]);return Object.freeze({ok:true});
    }
    async function connect(){
      if(disabled)return outcome('service_disabled');if(stopped||!check())return outcome('access_denied');if(opening)return opening;if(phase==='ready')return Object.freeze({ok:true});
      if(!['jahit','qc'].includes(moduleName)||typeof options.createBridge!=='function'||typeof options.onState!=='function'||typeof options.isCurrent!=='function'||!Command||!View||!Codec||!Earnings){stop('unavailable');return outcome('unavailable');}
      phase='loading';error=null;emit();const captured=epoch;
      opening=(async()=>{try{
        bridge=options.createBridge({onView:v=>{if(!current())return;try{acceptView(v);}catch{stop('unavailable');}},onClear:reason=>{if(reason==='loading')return;stop(['access_changed','account_changed','access_denied','disposed'].includes(reason)?'access_denied':'unavailable');}});
        const r=await bridge.connect();if(!check()||captured!==epoch)return outcome('access_denied');if(!r?.ok){stop(code(r));return outcome(code(r));}
        bounded(r);exact(r,Object.hasOwn(r,'workerLabels')?['ok','cycles','profile','scope','workerLabels']:['ok','cycles','profile','scope']);
        const s=r.scope;exact(s,['projectId','databaseURL','tenantId','uid','grantRevision']);Command.decodeJournal(null,s,options.endpointURL);
        const session=View.validateSession({schemaVersion:1,...s,profile:r.profile,cycles:r.cycles,...(Object.hasOwn(r,'workerLabels')?{workerLabels:r.workerLabels}:{})},{projectId:s.projectId,databaseURL:s.databaseURL,tenantId:s.tenantId,uid:s.uid});
        if(!session.profile.owner&&session.profile.modules?.[moduleName]!==true)fail();scope=freeze(copy(s));profile=session.profile;manifest=session.cycles;labels=session.workerLabels||[];
        if(!latestView?.complete||latestView.cycles.length!==manifest.length)fail();applyView();const p=await loadPending();if(!p.ok){stop(p.error);return p;}if(!check()||captured!==epoch)return outcome('access_denied');phase='ready';emit();return Object.freeze({ok:true});
      }catch{stop('unavailable');return outcome('unavailable');}})().finally(()=>{opening=null;});return opening;
    }
    function selectCycle(productId,cycleId){if(!check()||phase!=='ready')return outcome('not_ready');if(busy)return outcome('busy');if(!cycles.some(c=>c.productId===productId&&c.cycleId===cycleId))return outcome('invalid_request');selected=freeze({productId,cycleId});error=null;emit();return Object.freeze({ok:true});}
    function inputPayload(kind,input,base){
      inspect(input);const entity='entity-'+base;
      if(kind==='sewing'){exact(input,['assignmentId','tanggal','good','reject']);return {id:entity,...copy(input)};}
      if(kind==='count'){exact(input,['assignmentId','tanggal','jumlah']);return {id:entity,...copy(input)};}
      if(kind==='repair'){exact(input,['qcId','tanggal','jumlah']);return {id:entity,...copy(input)};}
      if(kind==='inspect'){exact(input,['entries']);if(!Array.isArray(input.entries)||!input.entries.length||input.entries.length>100)fail();return {batchId:'batch-'+base,entries:input.entries.map((e,i)=>{exact(e,['hfId','tanggal','ok','perbaikan','reject','offline']);return {id:'inspection-'+base+'-'+i,...copy(e)};})};}
      if(kind==='cancel'){exact(input,['targetType','targetId','confirmed']);if(input.confirmed!==true)fail();return {targetType:input.targetType,targetId:input.targetId};}fail();
    }
    function targetCheck(kind,payload,c){
      const o=c.operations,by=(field,id)=>(o[field]||[]).find(r=>r.id===id);
      if(!allowedKind(kind,payload.targetType))fail();
      if(kind==='sewing'||kind==='count'){const a=by('assignJahit',payload.assignmentId);if(!a||kind==='sewing'&&!profile.owner&&a.tukangId!==profile.workerId)fail();}
      else if(kind==='inspect'){let worker;const ids=new Set();for(const e of payload.entries){const h=by('hitungFisik',e.hfId);if(!h||h.qcId!==undefined||ids.has(e.hfId)||worker!==undefined&&h.tukangId!==worker||e.ok+e.perbaikan+e.reject+e.offline!==h.jumlah||e.tanggal<h.tanggal)fail();worker=h.tukangId;ids.add(e.hfId);}}
      else if(kind==='repair'){const q=by('qc',payload.qcId);if(!q||payload.jumlah>q.perbaikan||payload.tanggal<q.tanggal)fail();}
      else if(kind==='cancel'){const field={sewing:'jahit',count:'hitungFisik',inspect:'qc',repair:'repairs'}[payload.targetType];const target=field&&by(field,payload.targetId);if(!target||payload.targetType==='sewing'&&!profile.owner&&target.tukangId!==profile.workerId)fail();}
    }
    async function submit(kind,input){
      if(disabled)return outcome('service_disabled');if(!check())return outcome('access_denied');if(phase!=='ready'||!selected)return outcome('not_ready');if(busy)return outcome('busy');
      const c=cycles.find(c=>c.productId===selected.productId&&c.cycleId===selected.cycleId);
      if(pending.some(p=>p.productId===c.productId&&p.cycleId===c.cycleId))return outcome('pending_review');
      let command;try{
        inspect(input);const capturedInput=freeze(copy(input));
        if(moduleName==='jahit'&&kind!=='sewing'&&!(kind==='cancel'&&capturedInput.targetType==='sewing')||moduleName==='qc'&&(kind==='sewing'||kind==='cancel'&&capturedInput.targetType==='sewing'))fail();
        const payload=inputPayload(kind,capturedInput,'probe'),preview=validatedCommand({requestId:'request-probe',productId:c.productId,cycleId:c.cycleId,expectedRevision:c.revision,kind,payload});targetCheck(kind,preview.payload,c);
        const base=(options.newId||(()=>globalThis.crypto.randomUUID()))();if(typeof base!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(base))fail();
        command=validatedCommand({requestId:'request-'+base,productId:c.productId,cycleId:c.cycleId,expectedRevision:c.revision,kind,payload:inputPayload(kind,capturedInput,base)});
      }catch{return outcome('invalid_request');}
      held.set(command.requestId,command);pending=freeze([...pending,command]);busy=true;error=null;emit();let result;
      try{const prepared=await bridge.prepare(command);if(!check())return outcome('access_denied');if(!prepared?.ok){result=outcome(code(prepared));}else{const loaded=await loadPending();if(!loaded.ok)result=loaded;else result=await bridge.send(command.requestId);}if(!check())return outcome('access_denied');if(result?.ok)held.delete(command.requestId);const refreshed=await loadPending();if(!refreshed.ok)result=refreshed;}
      catch{result=outcome('unavailable');}finally{if(current()){busy=false;error=result?.ok?null:code(result);emit();}}
      return result?.ok?result:outcome(code(result));
    }
    async function retry(requestId){
      if(!check())return outcome('access_denied');if(phase!=='ready')return outcome('not_ready');if(busy)return outcome('busy');const command=pending.find(p=>p.requestId===requestId);if(!command||!allowedKind(command.kind,command.payload.targetType))return outcome('invalid_request');
      busy=true;error=null;emit();let result;try{const prepared=await bridge.prepare(command);if(!check())return outcome('access_denied');result=prepared?.ok?await bridge.send(requestId):outcome(code(prepared));if(!check())return outcome('access_denied');if(result?.ok)held.delete(requestId);const refreshed=await loadPending();if(!refreshed.ok)result=refreshed;}catch{result=outcome('unavailable');}finally{if(current()){busy=false;error=result?.ok?null:code(result);emit();}}return result?.ok?result:outcome(code(result));
    }
    async function refreshPending(){if(!check())return outcome('access_denied');if(phase!=='ready')return outcome('not_ready');if(busy)return outcome('busy');try{const r=await loadPending();if(current())emit();return r;}catch{stop('unavailable');return outcome('unavailable');}}
    return Object.freeze({connect,selectCycle,submit,retry,refreshPending,dispose:()=>stop('access_denied')});
  }
  return Object.freeze({createProductionFormController});
});
