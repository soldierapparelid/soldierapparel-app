/* Read-only canonical browser views. No tokens, storage, writes or legacy reads. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./operations-codec.js'),require('./maklon-earnings.js'));
  else root.SoldierProductionViewClient=factory(root.SoldierOperationsCodec,root.SoldierMaklonEarnings);
})(typeof globalThis!=='undefined'?globalThis:this,function(Codec,Earnings){
  'use strict';
  const reserved=new Set(['__proto__','constructor','prototype']),modules=['potong','jahit','qc','laporan','stok','gaji','hpp','pembelian','nota','retur'];
  const MAX_CYCLES=256,MAX_BYTES=8*1024*1024;
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
  const safe=v=>typeof v==='string'&&v.length>0&&v.length<=128&&!reserved.has(v)&&/^[A-Za-z0-9_-]+$/.test(v);
  const integer=v=>Number.isSafeInteger(v)&&v>=0;
  const copy=v=>JSON.parse(JSON.stringify(v));
  function fail(){throw Error('invalid_view');}
  function json(v,depth=0,seen=new Set(),budget={nodes:0}){
    if(depth>32||++budget.nodes>250000)fail();
    if(v===null||typeof v==='boolean'||typeof v==='string')return;
    if(typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=Number.MAX_SAFE_INTEGER)return;
    if(!v||typeof v!=='object'||seen.has(v)||(!Array.isArray(v)&&!object(v))||(Array.isArray(v)&&Object.getPrototypeOf(v)!==Array.prototype))fail();
    seen.add(v);const keys=Reflect.ownKeys(v);
    for(const key of keys){
      if(typeof key!=='string'||reserved.has(key))fail();if(Array.isArray(v)&&key==='length')continue;
      const d=Object.getOwnPropertyDescriptor(v,key);
      if(!d||!d.enumerable||!Object.hasOwn(d,'value')||(Array.isArray(v)&&(!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=v.length)))fail();
      json(d.value,depth+1,seen,budget);
    }
    if(Array.isArray(v)&&keys.length!==v.length+1)fail();seen.delete(v);
  }
  function inspect(v){json(v);if(new TextEncoder().encode(JSON.stringify(v)).byteLength>MAX_BYTES)fail();}
  function exact(v,required,optional=[]){if(!object(v)||required.some(k=>!Object.hasOwn(v,k))||Object.keys(v).some(k=>!required.includes(k)&&!optional.includes(k)))fail();}
  function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
  function url(v){
    if(typeof v!=='string')fail();let u;try{u=new URL(v);}catch{fail();}
    if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||u.pathname!=='/'||u.origin!==v||!/^([a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app)$/.test(u.hostname))fail();return v;
  }
  function profile(p){
    exact(p,['active','owner'],['workerId','modules']);if(p.active!==true||typeof p.owner!=='boolean')fail();
    if(Object.hasOwn(p,'workerId')&&!safe(p.workerId))fail();
    if(p.modules!==undefined&&(!object(p.modules)||Object.keys(p.modules).some(k=>!modules.includes(k)||typeof p.modules[k]!=='boolean')))fail();
    if(!p.owner&&(p.modules?.jahit===true||p.modules?.potong===true)&&!safe(p.workerId))fail();
  }
  function session(v,o){
    inspect(v);exact(v,['schemaVersion','projectId','databaseURL','tenantId','uid','grantRevision','profile','cycles'],['workerLabels','cycleLabels']);
    if(new TextEncoder().encode(JSON.stringify(v)).byteLength>65536)fail();
    if(v.schemaVersion!==1||v.projectId!==o.projectId||v.databaseURL!==o.databaseURL||v.tenantId!==o.tenantId||v.uid!==o.uid||!integer(v.grantRevision))fail();profile(v.profile);
    if(!Array.isArray(v.cycles)||v.cycles.length>MAX_CYCLES)fail();const keys=new Set();
    for(const c of v.cycles){exact(c,['productId','cycleId']);if(!safe(c.productId)||!safe(c.cycleId)||keys.has(c.productId+'/'+c.cycleId))fail();keys.add(c.productId+'/'+c.cycleId);}
    if(v.cycles.length&&!v.profile.owner&&!['potong','jahit','qc','laporan','stok'].some(m=>v.profile.modules?.[m]===true))fail();
    if(Object.hasOwn(v,'workerLabels')){
      if(!Array.isArray(v.workerLabels)||v.workerLabels.length!==v.cycles.length)fail();
      const pairs=new Set(),global=v.profile.owner||['qc','laporan','stok'].some(m=>v.profile.modules?.[m]===true);let count=0;
      for(const entry of v.workerLabels){
        exact(entry,['productId','cycleId','workers']);if(!safe(entry.productId)||!safe(entry.cycleId))fail();
        const pair=entry.productId+'/'+entry.cycleId;if(!keys.has(pair)||pairs.has(pair)||!Array.isArray(entry.workers)||entry.workers.length>128||!global&&entry.workers.length!==1)fail();pairs.add(pair);
        const ids=new Set();for(const worker of entry.workers){exact(worker,['workerId','label']);if(!safe(worker.workerId)||ids.has(worker.workerId)||!global&&worker.workerId!==v.profile.workerId||typeof worker.label!=='string'||!worker.label||worker.label.length>256||worker.label.trim()!==worker.label||/[\u0000-\u001f\u007f-\u009f]/.test(worker.label))fail();ids.add(worker.workerId);if(++count>1024)fail();}
      }
    }
    if(Object.hasOwn(v,'cycleLabels')){
      if(v.profile.owner!==true||!Array.isArray(v.cycleLabels)||v.cycleLabels.length!==v.cycles.length)fail();
      const pairs=new Set();
      for(const entry of v.cycleLabels){
        exact(entry,['productId','cycleId','series','namaBarang','size']);
        const pair=entry.productId+'/'+entry.cycleId;
        if(!safe(entry.productId)||!safe(entry.cycleId)||!keys.has(pair)||pairs.has(pair))fail();pairs.add(pair);
        for(const field of ['series','namaBarang','size'])if(typeof entry[field]!=='string'||entry[field].length>256||/[\u0000-\u001f\u007f-\u009f]/.test(entry[field]))fail();
      }
    }
    return freeze(copy(v));
  }
  // Validate the authenticated response before opening any per-UID draft store.
  // Scope is fixed trusted configuration/current identity, never URL or storage.
  function validateSession(value,scope){
    try{
      inspect(scope);exact(scope,['projectId','databaseURL','tenantId','uid']);
      if(typeof scope.projectId!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(scope.projectId)||!safe(scope.tenantId)||!safe(scope.uid))fail();url(scope.databaseURL);
      return session(value,scope);
    }catch{fail();}
  }
  function collection(v){
    if(Array.isArray(v)){if(v.some(row=>row===null))fail();return v;}
    if(!object(v))fail();const keys=Object.keys(v).sort((a,b)=>Number(a)-Number(b));
    if(keys.some((k,i)=>k!==String(i)))fail();return keys.map(k=>v[k]);
  }
  const rowShapes={
    assignJahit:[['id','tukangId','qty','sisa'],[]],
    jahit:[['id','assignmentId','tukangId','tanggal','jumlah','rijek','lolos','quantityBasis','inputAt'],[]],
    hitungFisik:[['id','tukangId','tanggal','jumlah','workflowVersion','countStage','inputAt'],['qcId']],
    qc:[['id','hfId','qcBatchId','tukangId','tanggal','ok','perbaikan','reject','offline','workflowVersion','autoFromCount','inputAt'],[]],
    repairs:[['id','qcId','tukangId','tanggal','jumlah','inputAt'],[]],
    gudang:[['id','qcId','hfId','tukangId','tanggal','jumlah','status','payrollStage','workflowVersion'],[]],
    bigSaller:[['id','gudangId','qcId','hfId','tanggal','jumlah'],[]]
  };
  function operations(value,productId){
    inspect(value);exact(value,['id','series','namaBarang','size','cutQuantity','poJumlah','poAktif'],Object.keys(rowShapes));
    if(value.id!==productId||!integer(value.cutQuantity)||value.cutQuantity<1||value.poJumlah!==value.cutQuantity||value.poAktif!==true)fail();
    const out=copy(value);
    for(const [field,shape]of Object.entries(rowShapes))if(Object.hasOwn(out,field)){
      out[field]=collection(out[field]);if(!out[field].length)fail();
      for(const row of out[field]){
        exact(row,...shape);
        if(Object.hasOwn(row,'tanggal')&&(typeof row.tanggal!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row.tanggal)))fail();
        if(Object.hasOwn(row,'inputAt')&&(typeof row.inputAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.inputAt)||Number.isNaN(Date.parse(row.inputAt))||new Date(row.inputAt).toISOString()!==row.inputAt))fail();
      }
    }
    const decoded=Codec.decode({[productId]:out})[0],by=field=>new Map((decoded[field]||[]).map(r=>[r.id,r]));
    const a=by('assignJahit'),h=by('hitungFisik'),q=by('qc'),g=by('gudang'),workers=new Set([...a.values()].map(r=>r.tukangId));
    for(const r of a.values())if(!r.qty||r.sisa>r.qty)fail();
    for(const r of decoded.jahit||[])if(!a.has(r.assignmentId)||a.get(r.assignmentId).tukangId!==r.tukangId||!r.jumlah||!Number.isSafeInteger(r.lolos+r.rijek)||r.jumlah!==r.lolos+r.rijek)fail();
    for(const r of h.values())if(!workers.has(r.tukangId)||!r.jumlah||r.qcId!==undefined&&(!q.has(r.qcId)||q.get(r.qcId).hfId!==r.id))fail();
    for(const r of q.values())if(!h.has(r.hfId)||h.get(r.hfId).tukangId!==r.tukangId||h.get(r.hfId).qcId!==r.id||r.autoFromCount!==false)fail();
    for(const r of g.values())if(!q.has(r.qcId)||q.get(r.qcId).hfId!==r.hfId||q.get(r.qcId).tukangId!==r.tukangId||!r.jumlah||!['ok','kotor','reject','offline'].includes(r.status))fail();
    const repairsByQc=new Map(),repairMovements=new Map(),warehouseRepairs=new Map();
    const movementKey=r=>JSON.stringify([r.qcId,r.tukangId,r.tanggal,r.jumlah]);
    for(const r of decoded.repairs||[]){
      const inspection=q.get(r.qcId);if(!inspection||inspection.tukangId!==r.tukangId||!r.jumlah||r.tanggal<inspection.tanggal)fail();
      const total=(repairsByQc.get(r.qcId)||0)+r.jumlah;if(!Number.isSafeInteger(total)||total>inspection.ok)fail();repairsByQc.set(r.qcId,total);
      const key=movementKey(r);repairMovements.set(key,(repairMovements.get(key)||0)+1);
    }
    for(const r of g.values())if(r.payrollStage==='repair'){
      if(r.status!=='ok')fail();const key=movementKey(r);warehouseRepairs.set(key,(warehouseRepairs.get(key)||0)+1);
    }
    if(repairMovements.size!==warehouseRepairs.size||[...repairMovements].some(([key,count])=>warehouseRepairs.get(key)!==count))fail();
    for(const r of decoded.bigSaller||[])if(!g.has(r.gudangId)||g.get(r.gudangId).status!=='ok'||g.get(r.gudangId).qcId!==r.qcId||g.get(r.gudangId).hfId!==r.hfId||g.get(r.gudangId).jumlah!==r.jumlah||g.get(r.gudangId).tanggal!==r.tanggal)fail();
    return freeze(decoded);
  }
  function wage(value,workerId,productId){
    inspect(value);if(value===null)fail();const model=Earnings.normalize(value,workerId);
    for(const r of model.entries)if(r.productId!==productId||!Number.isSafeInteger(r.tarif)||!Number.isSafeInteger(r.total)||!['hitungFisik','qcRepair'].includes(r.sourceType))fail();
    Earnings.summarize(model);return model;
  }
  function createViewClient(options={}){
    if(options.enabled!==true)return Object.freeze({start:()=>false,dispose(){}});
    let current,clear,subscribe,onView,binding,valid=true;
    try{
      const clearDescriptor=Object.getOwnPropertyDescriptor(options,'onClear');if(clearDescriptor&&Object.hasOwn(clearDescriptor,'value')&&typeof clearDescriptor.value==='function')clear=clearDescriptor.value;
      if(!Codec||typeof Codec.decode!=='function'||!Earnings||typeof Earnings.normalize!=='function'||typeof Earnings.summarize!=='function')fail();
      if(typeof options.projectId!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(options.projectId)||!safe(options.tenantId)||!safe(options.uid))fail();url(options.databaseURL);
      if(typeof options.isCurrent!=='function'||typeof options.onView!=='function'||typeof options.onClear!=='function'||!object(options.subscription))fail();
      const d=Object.getOwnPropertyDescriptor(options.subscription,'subscribe');if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function')fail();
      current=options.isCurrent;clear=options.onClear;subscribe=(...args)=>d.value.apply(options.subscription,args);onView=options.onView;
      const parsed=validateSession(options.session,{projectId:options.projectId,databaseURL:options.databaseURL,tenantId:options.tenantId,uid:options.uid});binding=freeze({projectId:parsed.projectId,databaseURL:parsed.databaseURL,tenantId:parsed.tenantId,uid:parsed.uid,profile:parsed.profile});options={session:parsed};
    }catch{valid=false;}
    let started=false,stopped=false,opening=false,profileReady=false;const disposers=[],seen=new Set(),slots=new Map();
    const notifyClear=code=>{try{if(typeof clear==='function')clear(code);}catch{}};
    function stop(code){if(stopped)return;stopped=true;for(const off of disposers.splice(0)){try{off();}catch{}}slots.clear();seen.clear();notifyClear(code);}
    function bound(){try{return current(binding)===true;}catch{return false;}}
    function emit(){
      if(stopped)return;if(!bound()){stop('account_changed');return;}
      const cycles=[];
      for(const s of slots.values()){
        if(!s.seenOperations||!s.seenRevision||s.needsWage&&!s.seenWage)continue;
        if(s.wage)for(const r of s.wage.entries)if(['series','namaBarang','size'].some(k=>r[k]!==s.operations[k])){stop('invalid_view');return;}
        cycles.push({productId:s.productId,cycleId:s.cycleId,revision:s.revision,operations:s.operations,wage:s.wage});
      }
      try{onView(freeze({cycles,complete:cycles.length===slots.size,consistency:'independent-listeners'}));}catch{stop('callback_failed');}
    }
    function listen(path,receive){
      if(stopped)return;if(!bound()){stop('account_changed');return;}
      let off;
      try{
        off=subscribe(path,value=>{if(stopped)return;if(!bound()){stop('account_changed');return;}try{receive(value);}catch{stop('invalid_view');}},()=>stop('read_failed'));
        if(typeof off!=='function'){stop('read_failed');return;}
      }catch{stop('read_failed');return;}
      if(stopped){try{off();}catch{}}else disposers.push(off);
    }
    function openCycles(){
      if(stopped||opening||!profileReady)return;opening=true;const p=options.session.profile;
      const mayWage=!p.owner&&safe(p.workerId)&&(p.modules?.jahit===true||p.modules?.potong===true),globalOperations=p.owner||['qc','laporan','stok'].some(m=>p.modules?.[m]===true);
      for(const c of options.session.cycles)slots.set(c.productId+'/'+c.cycleId,{...c,revision:null,operations:null,wage:null,needsWage:false,wageEligibility:null,seenOperations:false,seenRevision:false,seenWage:false});
      for(const s of slots.values()){
        const path='authorityTenants/'+binding.tenantId+'/products/'+s.productId+'/cycles/'+s.cycleId+'/wire/projection';
        listen(path+'/operations',v=>{
          s.operations=operations(v,s.productId);const ownAssignment=(s.operations.assignJahit||[]).some(a=>a.tukangId===p.workerId),eligible=mayWage&&ownAssignment;
          if(mayWage&&!globalOperations&&!ownAssignment||s.wageEligibility!==null&&s.wageEligibility!==eligible)fail();
          s.seenOperations=true;
          if(s.wageEligibility===null){s.wageEligibility=eligible;s.needsWage=eligible;if(eligible)listen(path+'/earningsByWorker/'+p.workerId,w=>{s.wage=wage(w,p.workerId,s.productId);s.seenWage=true;emit();});}
          emit();
        });
        listen(path+'/revision',v=>{inspect(v);if(!integer(v)||s.seenRevision&&v<s.revision)fail();s.revision=v;s.seenRevision=true;emit();});
        if(stopped)break;
      }
      if(!slots.size)emit();
    }
    function start(){
      if(started||stopped)return false;started=true;if(!valid){stop('not_ready');return false;}
      if(!bound()){stop('account_changed');return false;}notifyClear('loading');
      const p=options.session.profile,grantPath='authorityTenants/'+binding.tenantId+'/grants/'+binding.uid,profilePath=grantPath+'/profile';
      const expected=new Map([[profilePath+'/active',p.active],[profilePath+'/owner',p.owner],[profilePath+'/workerId',p.workerId===undefined?null:p.workerId],...modules.map(m=>[profilePath+'/modules/'+m,p.modules?.[m]===undefined?null:p.modules[m]]),[grantPath+'/revision',options.session.grantRevision]]);
      for(const [path,value]of expected){
        listen(path,v=>{inspect(v);if(v!==value){stop('access_changed');return;}seen.add(path);if(seen.size===expected.size){profileReady=true;openCycles();}});
        if(stopped)break;
      }
      return !stopped;
    }
    return Object.freeze({start,dispose:()=>stop('disposed')});
  }
  return Object.freeze({createViewClient,validateSession,validateOperations:operations,validateWage:wage});
});
