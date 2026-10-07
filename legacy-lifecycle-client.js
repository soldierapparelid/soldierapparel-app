/* Pure scoped lifecycle DTOs. No network, storage, account lookup or tokens. */
(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./legacy-view-client.js')):factory(root.SoldierLegacyViewClient);if(typeof module==='object'&&module.exports)module.exports=api;else root.SoldierLegacyLifecycleClient=api;})(typeof globalThis!=='undefined'?globalThis:this,function(Jahit){
  'use strict';
  const RESERVED=new Set(['__proto__','constructor','prototype']);
  const BASE=['kind','requestId','operationId','productId','expectedGrantRevision','expectedSourceVersion'];
  const EXTRA=Object.freeze({appendJahit:['assignmentId','workDate','good','reject'],editJahit:['workDate','good','reject'],deleteJahit:[],appendCount:['workerId','workDate','quantity'],editCount:['workDate','quantity'],deleteCount:[],inspectCount:['countId','workDate','totals','note'],inspectCounts:['countIds','workDate','totals','note'],editQC:['workDate','totals','note'],editQCGroup:['qcIds','totals','note'],repairQC:['workDate','quantity']});
  const JAHIT=new Set(['appendJahit','editJahit','deleteJahit']);
  const fail=()=>{throw Error('invalid_legacy_lifecycle_view');};
  const integer=v=>Number.isSafeInteger(v)&&v>=0&&!Object.is(v,-0);
  const safe=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!RESERVED.has(v);
  const fresh=v=>safe(v)&&v.length<=96&&!/^\d+$/.test(v);
  const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
  const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
  const copy=v=>JSON.parse(JSON.stringify(v));
  function bytes(v){let n=0;for(let i=0;i<v.length;i++){const c=v.charCodeAt(i);if(c<128)n++;else if(c<2048)n+=2;else if(c>=0xd800&&c<=0xdbff&&v.charCodeAt(i+1)>=0xdc00&&v.charCodeAt(i+1)<=0xdfff){n+=4;i++;}else n+=3;}return n;}
  function inspect(v,depth=0,seen=new Set(),budget={n:0}){
    if(depth>16||++budget.n>100000)fail();
    if(v===null||typeof v==='boolean'||typeof v==='string'||typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=Number.MAX_SAFE_INTEGER&&!Object.is(v,-0))return;
    if(!v||typeof v!=='object'||seen.has(v)||!([Object.prototype,null].includes(Object.getPrototypeOf(v))||Array.isArray(v)&&Object.getPrototypeOf(v)===Array.prototype))fail();
    seen.add(v);const keys=Reflect.ownKeys(v);
    for(const key of keys){if(typeof key!=='string'||RESERVED.has(key))fail();if(Array.isArray(v)&&key==='length')continue;const d=Object.getOwnPropertyDescriptor(v,key);if(!d||!d.enumerable||!Object.hasOwn(d,'value')||Array.isArray(v)&&(!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=v.length))fail();inspect(d.value,depth+1,seen,budget);}
    if(Array.isArray(v)&&keys.length!==v.length+1)fail();seen.delete(v);
  }
  function bounded(v,max=1048576){inspect(v);if(bytes(JSON.stringify(v))>max)fail();}
  function exact(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Reflect.ownKeys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail();}
  function text(v,max=256){if(typeof v!=='string'||v.length>max||/[\u0000-\u001f\u007f-\u009f]/.test(v))fail();}
  function day(v){if(typeof v!=='string'||!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00.000Z'))||new Date(v+'T00:00:00.000Z').toISOString().slice(0,10)!==v)fail();}
  function ids(values,max=40000){if(!Array.isArray(values)||values.length>max)fail();}
  function totals(v){exact(v,['ok','perbaikan','reject','offline']);if(!Object.values(v).every(integer)||!integer(Object.values(v).reduce((a,b)=>a+b,0))||Object.values(v).reduce((a,b)=>a+b,0)<1)fail();}
  function normalizeLifecycleBinding(v){
    bounded(v,2048);exact(v,['projectId','databaseURL','tenantId','uid','workerId','division','grantRevision']);
    if(!['jahit','qc'].includes(v.division)||v.division==='qc'&&v.workerId!==null)fail();
    const p=Jahit.normalizeLegacyOperationsView({schemaVersion:1,binding:{...v,division:'jahit',workerId:v.division==='qc'?'binding-probe':v.workerId},workerLabel:'Binding validation',products:[]},{...v,division:'jahit',workerId:v.division==='qc'?'binding-probe':v.workerId}).binding;
    return freeze({...p,workerId:v.workerId,division:v.division});
  }
  function normalizeLegacyLifecycleView(v,expected){
    bounded(v);const b=normalizeLifecycleBinding(expected);
    if(b.division==='jahit')return Jahit.normalizeLegacyOperationsView(v,b);
    exact(v,['schemaVersion','binding','products']);if(v.schemaVersion!==1||JSON.stringify(normalizeLifecycleBinding(v.binding))!==JSON.stringify(b))fail();ids(v.products,2000);
    const products=new Set();
    for(const p of v.products){
      exact(p,['productId','series','namaBarang','size','poActive','poQuantity','readyForQC','needsReview','target','remainingPO','groups','counts','inspections','sourceVersion']);
      if(!safe(p.productId)||products.has(p.productId)||!hash(p.sourceVersion)||!['poActive','readyForQC','needsReview'].every(k=>typeof p[k]==='boolean')||p.poQuantity!==null&&!integer(p.poQuantity)||!integer(p.target)||!integer(p.remainingPO))fail();products.add(p.productId);
      for(const k of ['series','namaBarang','size'])text(p[k]);ids(p.groups,128);ids(p.counts);ids(p.inspections);
      const workers=new Set(),counts=new Set(),inspections=new Set();
      for(const g of p.groups){exact(g,['workerId','name','sewn','counted','pendingCount']);if(!safe(g.workerId)||workers.has(g.workerId)||!['sewn','counted','pendingCount'].every(k=>integer(g[k])))fail();text(g.name);workers.add(g.workerId);}
      for(const h of p.counts){exact(h,['countId','workerId','workerName','workDate','quantity','qcId','cancelled','staged']);if(!safe(h.countId)||counts.has(h.countId)||!safe(h.workerId)||!integer(h.quantity)||h.quantity<1||h.qcId!==null&&!safe(h.qcId)||typeof h.cancelled!=='boolean'||typeof h.staged!=='boolean')fail();day(h.workDate);text(h.workerName);counts.add(h.countId);}
      for(const q of p.inspections){exact(q,['operationId','countId','batchId','workerId','workDate','totals','note','staged']);if(!safe(q.operationId)||inspections.has(q.operationId)||!safe(q.workerId)||q.countId!==null&&!safe(q.countId)||q.batchId!==null&&!safe(q.batchId)||typeof q.staged!=='boolean')fail();day(q.workDate);totals(q.totals);text(q.note,512);inspections.add(q.operationId);}
    }
    return freeze(copy(v));
  }
  function normalizeLegacyLifecycleCommand(v,expectedRevision){
    bounded(v,32768);if(!Object.hasOwn(EXTRA,v.kind))fail();exact(v,BASE.concat(EXTRA[v.kind]));
    if(!fresh(v.requestId)||!safe(v.operationId)||!safe(v.productId)||!integer(v.expectedGrantRevision)||v.expectedGrantRevision<1||expectedRevision!==undefined&&v.expectedGrantRevision!==expectedRevision||!hash(v.expectedSourceVersion))fail();
    if(['appendJahit','appendCount','inspectCount','inspectCounts'].includes(v.kind)&&!fresh(v.operationId))fail();
    if(Object.hasOwn(v,'workDate')&&(v.kind!=='appendJahit'||v.workDate!==null))day(v.workDate);
    for(const k of ['assignmentId','workerId','countId'])if(Object.hasOwn(v,k)&&!safe(v[k]))fail();
    if(Object.hasOwn(v,'quantity')&&(!integer(v.quantity)||v.quantity<1))fail();
    if(Object.hasOwn(v,'good')&&(!integer(v.good)||!integer(v.reject)||!integer(v.good+v.reject)||v.good+v.reject<1))fail();
    if(Object.hasOwn(v,'note'))text(v.note,512);if(Object.hasOwn(v,'totals'))totals(v.totals);
    for(const k of ['countIds','qcIds'])if(Object.hasOwn(v,k)){ids(v[k],128);if(!v[k].length||!v[k].every(safe)||new Set(v[k]).size!==v[k].length)fail();}
    return freeze(copy(v));
  }
  function normalizeLegacyLifecycleFinanceView(v,expected){const b=normalizeLifecycleBinding(expected);if(b.division!=='jahit')fail();return Jahit.normalizeLegacyFinanceView(v,b);}
  function commandMatchesView(view,raw){
    // Convenience check only. The server independently authenticates, checks
    // grants, payment/dependencies and source version before any write.
    const v=normalizeLegacyLifecycleView(view,view.binding),cmd=normalizeLegacyLifecycleCommand(raw,v.binding.grantRevision),p=v.products.find(p=>p.productId===cmd.productId);
    if(!p||p.sourceVersion!==cmd.expectedSourceVersion||JAHIT.has(cmd.kind)!==(v.binding.division==='jahit'))return false;
    if(v.binding.division==='jahit'){
      if(cmd.kind==='appendJahit'){const a=p.assignments.find(a=>a.assignmentId===cmd.assignmentId);return !!a&&cmd.good+cmd.reject<=a.remaining;}
      return p.reports.some(r=>r.operationId===cmd.operationId);
    }
    if(p.needsReview)return false;
    if(cmd.kind==='appendCount'){const g=p.groups.find(g=>g.workerId===cmd.workerId);return !!g&&cmd.quantity<=Math.min(g.pendingCount,p.remainingPO);}
    if(['editCount','deleteCount'].includes(cmd.kind))return p.counts.some(h=>h.countId===cmd.operationId&&!h.cancelled);
    if(['inspectCount','inspectCounts'].includes(cmd.kind)){
      const selected=(cmd.countIds||[cmd.countId]).map(id=>p.counts.find(h=>h.countId===id));
      return p.readyForQC&&selected.every(h=>h&&!h.cancelled&&h.qcId===null)&&new Set(selected.map(h=>h.workerId)).size===1;
    }
    if(cmd.kind==='editQCGroup')return cmd.qcIds.every(id=>p.inspections.some(q=>q.operationId===id));
    return p.inspections.some(q=>q.operationId===cmd.operationId);
  }
  return Object.freeze({normalizeLifecycleBinding,normalizeLegacyLifecycleView,normalizeLegacyLifecycleCommand,normalizeLegacyLifecycleFinanceView,commandMatchesView});
});
