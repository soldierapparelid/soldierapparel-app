/* Read-only owner wage selection. Fixed canonical scope and exact leaf reads. */
(function(root,factory){
  const api=typeof module==='object'&&module.exports?factory(require('./production-view-client.js'),require('./maklon-earnings.js')):factory(root.SoldierProductionViewClient,root.SoldierMaklonEarnings);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.SoldierProductionOwnerWageClient=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(View,Earnings){
  'use strict';
  const modules=['potong','jahit','qc','laporan','stok','gaji','hpp','pembelian','nota','retur'];
  const fields=['enabled','projectId','databaseURL','tenantId','uid','session','subscription','isCurrent','onCatalog','onView','onClear'];
  const safe=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
  function data(v,keys){
    if(!object(v)||Reflect.ownKeys(v).length!==keys.length)throw Error();
    const out={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!d.enumerable||!Object.hasOwn(d,'value'))throw Error();out[k]=d.value;}return out;
  }
  function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
  const offAPI=()=>Object.freeze({start:()=>false,select:()=>false,clearSelection:()=>false,dispose(){}});
  function createOwnerWageClient(options={}){
    // A disabled source opens nothing, including supplied executable fields.
    let enabled;try{enabled=Object.getOwnPropertyDescriptor(options,'enabled');}catch{return offAPI();}
    if(!enabled||!Object.hasOwn(enabled,'value')||enabled.value!==true)return offAPI();
    let session,binding,subscribe,isCurrent,onCatalog,onView,onClear,catalog,valid=true;
    try{
      const clear=Object.getOwnPropertyDescriptor(options,'onClear');if(clear&&Object.hasOwn(clear,'value')&&typeof clear.value==='function')onClear=clear.value;
      const o=data(options,fields),sub=data(o.subscription,['subscribe']);
      if(!View||['validateSession','validateOperations','validateWage'].some(k=>typeof View[k]!=='function')||!Earnings||typeof Earnings.summarize!=='function'||typeof sub.subscribe!=='function'||['isCurrent','onCatalog','onView','onClear'].some(k=>typeof o[k]!=='function'))throw Error();
      session=View.validateSession(o.session,{projectId:o.projectId,databaseURL:o.databaseURL,tenantId:o.tenantId,uid:o.uid});
      if(session.profile.owner!==true||!Object.hasOwn(session,'workerLabels'))throw Error();
      binding=freeze({projectId:session.projectId,databaseURL:session.databaseURL,tenantId:session.tenantId,uid:session.uid,grantRevision:session.grantRevision,profile:session.profile});
      subscribe=(...args)=>sub.subscribe.apply(o.subscription,args);isCurrent=o.isCurrent;onCatalog=o.onCatalog;onView=o.onView;onClear=o.onClear;
      catalog=freeze({cycles:session.cycles.map(c=>{
        const label=session.cycleLabels?.find(l=>l.productId===c.productId&&l.cycleId===c.cycleId);
        return {productId:c.productId,cycleId:c.cycleId,workers:session.workerLabels.find(l=>l.productId===c.productId&&l.cycleId===c.cycleId).workers.map(w=>({workerId:w.workerId,label:w.label})),...(label?{product:{series:label.series,namaBarang:label.namaBarang,size:label.size}}:{})};
      })});
    }catch{valid=false;}
    let started=false,stopped=false,gateReady=false,epoch=0,selection=null,slot=null,changing=false;
    const grants=new Set(),seen=new Set();let selectedReads=new Set();
    function clear(code){try{if(typeof onClear==='function')onClear(code);return true;}catch{return false;}}
    function close(group){for(const off of [...group]){group.delete(off);try{off();}catch{}}}
    function bound(){try{return isCurrent(binding)===true;}catch{return false;}}
    function stop(code){
      if(stopped)return;stopped=true;gateReady=false;epoch++;selection=null;slot=null;catalog=null;seen.clear();
      close(selectedReads);close(grants);clear(code);
    }
    function live(){if(stopped)return false;if(!bound()){stop('account_changed');return false;}return true;}
    function listen(path,receive,group,capturedEpoch=null,capturedSlot=null){
      const active=()=>!stopped&&(capturedEpoch===null||epoch===capturedEpoch&&slot===capturedSlot);
      if(!active()||!live())return;
      let off;try{
        off=subscribe(path,value=>{
          if(!active()||!live())return;
          try{receive(value);}catch{if(active())stop('invalid_view');}
        },()=>{if(active()&&live())stop('read_failed');});
        if(typeof off!=='function'){if(active())stop('read_failed');return;}
      }catch{if(active())stop('read_failed');return;}
      if(!active()){try{off();}catch{}}else group.add(off);
    }
    function emit(capturedEpoch,capturedSlot){
      if(stopped||epoch!==capturedEpoch||slot!==capturedSlot||!live())return;
      const s=capturedSlot;if(!s.seenOperations||!s.seenRevision||!s.seenWage)return;
      if(s.earnings&&s.earnings.entries.some(r=>['series','namaBarang','size'].some(k=>r[k]!==s.operations[k])))throw Error();
      const value=freeze({selection,workerLabel:s.workerLabel,operations:s.operations,projectionRevision:s.revision,earnings:s.earnings,summary:s.earnings?Earnings.summarize(s.earnings):null,consistency:'independent-listeners',availability:s.earnings?'available':'unavailable'});
      try{onView(value);}catch{if(epoch===capturedEpoch&&slot===capturedSlot)stop('callback_failed');}
    }
    function start(){
      if(started||stopped)return false;started=true;if(!valid){stop('not_ready');return false;}if(!live())return false;if(!clear('loading')){stop('callback_failed');return false;}
      if(stopped||!live())return false;
      const base='authorityTenants/'+binding.tenantId+'/grants/'+binding.uid,p=session.profile;
      const expected=new Map([[base+'/profile/active',true],[base+'/profile/owner',true],[base+'/profile/workerId',p.workerId===undefined?null:p.workerId],...modules.map(m=>[base+'/profile/modules/'+m,p.modules?.[m]===undefined?null:p.modules[m]]),[base+'/revision',session.grantRevision]]);
      for(const [path,value]of expected){
        listen(path,v=>{
          if(v!==value){stop('access_changed');return;}seen.add(path);
          if(!gateReady&&seen.size===expected.size){gateReady=true;try{onCatalog(catalog);}catch{stop('callback_failed');}}
        },grants);
        if(stopped)break;
      }
      return !stopped;
    }
    function dropSelection(code){
      epoch++;selection=null;slot=null;const old=selectedReads;selectedReads=new Set();const cleared=clear(code);close(old);if(!cleared)stop('callback_failed');
    }
    function select(request){
      if(!started||stopped||changing||!live()||!gateReady)return false;
      let chosen,worker,product;try{
        const v=data(request,['productId','cycleId','workerId']);if(!Object.values(v).every(safe))throw Error();
        chosen=catalog.cycles.find(c=>c.productId===v.productId&&c.cycleId===v.cycleId);worker=chosen?.workers.find(w=>w.workerId===v.workerId);if(!worker)throw Error();product=chosen.product;
        chosen=freeze({productId:v.productId,cycleId:v.cycleId,workerId:v.workerId});
      }catch{changing=true;try{dropSelection('selection_cleared');}finally{changing=false;}return false;}
      changing=true;try{dropSelection('selection_changed');}finally{changing=false;}
      if(stopped||!live())return false;
      selection=chosen;slot={workerLabel:worker.label,operations:null,revision:null,earnings:null,seenOperations:false,seenRevision:false,seenWage:false};
      const capturedEpoch=epoch,s=slot,group=selectedReads,path='authorityTenants/'+binding.tenantId+'/products/'+chosen.productId+'/cycles/'+chosen.cycleId+'/wire/projection';
      listen(path+'/operations',v=>{s.operations=View.validateOperations(v,chosen.productId);if(product&&['series','namaBarang','size'].some(k=>s.operations[k]!==product[k]))throw Error();s.seenOperations=true;emit(capturedEpoch,s);},group,capturedEpoch,s);
      listen(path+'/revision',v=>{if(!Number.isSafeInteger(v)||v<0||s.seenRevision&&v<s.revision)throw Error();s.revision=v;s.seenRevision=true;emit(capturedEpoch,s);},group,capturedEpoch,s);
      listen(path+'/earningsByWorker/'+chosen.workerId,v=>{s.earnings=v===null?null:View.validateWage(v,chosen.workerId,chosen.productId);s.seenWage=true;emit(capturedEpoch,s);},group,capturedEpoch,s);
      return !stopped&&epoch===capturedEpoch&&slot===s;
    }
    function clearSelection(){if(!started||stopped||changing||!live())return false;changing=true;try{dropSelection('selection_cleared');}finally{changing=false;}return !stopped;}
    return Object.freeze({start,select,clearSelection,dispose:()=>stop('disposed')});
  }
  return Object.freeze({createOwnerWageClient});
});
