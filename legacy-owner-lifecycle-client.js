/* Pure owner DTOs. Only the verified initial owner receives maintenance fields. */
(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./legacy-lifecycle-client.js')):factory(root.SoldierLegacyLifecycleClient);if(typeof module==='object'&&module.exports)module.exports=api;else root.SoldierLegacyOwnerLifecycleClient=api;})(typeof globalThis!=='undefined'?globalThis:this,function(Scoped){
  'use strict';
  const RESERVED=new Set(['__proto__','constructor','prototype']),BASE=['kind','requestId','operationId','productId','expectedGrantRevision','expectedSourceVersion'];
  const EXTRA=Object.freeze({ownerArchiveCycle:['archiveId','label','startNewPO'],ownerRestoreCycle:['archiveId','safetyArchiveId','safetyLabel'],ownerRelabelArchive:['archiveId','label'],ownerSetPO:['active','quantity','workDate','note'],ownerAppendAssignment:['assignmentId','workerId','quantity','workDate','targetDate','note'],ownerEditAssignment:['assignmentId','workerId','quantity','workDate','targetDate','note'],ownerAppendJahit:['recordId','assignmentId','workerId','workDate','good','reject','amountMode','rate','total'],ownerEditJahit:['recordId','workerId','workDate','good','reject','amountMode','rate','total'],ownerAppendPaymentNote:['recordId','workDate'],ownerEditPaymentNote:['recordId','workDate'],ownerSetPaid:['recordId','family','paid','workDate','reviewed']});
  const fail=()=>{throw Error('invalid_legacy_owner_lifecycle_view');},safe=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!RESERVED.has(v),fresh=v=>safe(v)&&v.length<=96&&!/^\d+$/.test(v),hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),integer=v=>Number.isSafeInteger(v)&&v>=0&&!Object.is(v,-0);
  const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;},copy=v=>JSON.parse(JSON.stringify(v));
  function bytes(s){let n=0;for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c<128)n++;else if(c<2048)n+=2;else if(c>=0xd800&&c<=0xdbff&&s.charCodeAt(i+1)>=0xdc00&&s.charCodeAt(i+1)<=0xdfff){n+=4;i++;}else n+=3;}return n;}
  function inspect(v,depth=0,seen=new Set(),budget={n:0}){if(depth>16||++budget.n>100000)fail();if(v===null||typeof v==='boolean'||typeof v==='string'||typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=Number.MAX_SAFE_INTEGER&&!Object.is(v,-0))return;if(!v||typeof v!=='object'||seen.has(v)||!([Object.prototype,null].includes(Object.getPrototypeOf(v))||Array.isArray(v)&&Object.getPrototypeOf(v)===Array.prototype))fail();seen.add(v);const keys=Reflect.ownKeys(v);for(const k of keys){if(typeof k!=='string'||RESERVED.has(k))fail();if(Array.isArray(v)&&k==='length')continue;const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value')||Array.isArray(v)&&(!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=v.length))fail();inspect(d.value,depth+1,seen,budget);}if(Array.isArray(v)&&keys.length!==v.length+1)fail();seen.delete(v);}
  function bounded(v,max=1048576){inspect(v);if(bytes(JSON.stringify(v))>max)fail();}
  function exact(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Reflect.ownKeys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail();}
  function text(v,max=256,nonempty=false){if(typeof v!=='string'||v.length>max||/[\u0000-\u001f\u007f-\u009f]/.test(v)||nonempty&&!v.trim())fail();}
  function day(v){if(typeof v!=='string'||!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00.000Z'))||new Date(v+'T00:00:00.000Z').toISOString().slice(0,10)!==v)fail();}
  function money(v){if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>Number.MAX_SAFE_INTEGER||Object.is(v,-0))fail();}
  function normalizeOwnerLifecycleBinding(v){bounded(v,2048);exact(v,['projectId','databaseURL','tenantId','uid','workerId','division','grantRevision']);if(v.division!=='owner'||v.workerId!==null)fail();const checked=Scoped.normalizeLifecycleBinding({...v,division:'qc'});return freeze({...checked,division:'owner'});}
  function normalizeLegacyOwnerLifecycleView(v,expected){
    bounded(v);const binding=normalizeOwnerLifecycleBinding(expected);exact(v,['schemaVersion','binding','products','maintenance']);if(v.schemaVersion!==2||JSON.stringify(normalizeOwnerLifecycleBinding(v.binding))!==JSON.stringify(binding)||!Array.isArray(v.products)||v.products.length>2000)fail();const ids=new Set();
    for(const p of v.products){exact(p,['productId','series','namaBarang','size','sourceVersion','hasCurrent','archives']);if(!safe(p.productId)||ids.has(p.productId)||!hash(p.sourceVersion)||typeof p.hasCurrent!=='boolean'||!Array.isArray(p.archives)||p.archives.length>40000)fail();ids.add(p.productId);for(const k of ['series','namaBarang','size'])text(p[k]);const arcs=new Set();for(const a of p.archives){exact(a,['archiveId','label','workDate']);if(a.archiveId!==null&&(!safe(a.archiveId)||arcs.has(a.archiveId)))fail();if(a.archiveId!==null)arcs.add(a.archiveId);text(a.label);if(a.workDate!==null)day(a.workDate);}}
    exact(v.maintenance,['workers','products']);if(!Array.isArray(v.maintenance.workers)||v.maintenance.workers.length>128||!Array.isArray(v.maintenance.products)||v.maintenance.products.length!==v.products.length)fail();const people=new Map(),seen=new Set();
    for(const w of v.maintenance.workers){exact(w,['workerId','workerLabel']);if(!safe(w.workerId)||people.has(w.workerId))fail();text(w.workerLabel);people.set(w.workerId,w.workerLabel);}
    for(const m of v.maintenance.products){exact(m,['productId','needsReview','assignments','sewing','payments','payableRows']);if(!ids.has(m.productId)||seen.has(m.productId)||typeof m.needsReview!=='boolean')fail();seen.add(m.productId);
      for(const k of ['assignments','sewing','payments','payableRows'])if(!Array.isArray(m[k])||m[k].length>40000)fail();
      const unique=(rows,key,check)=>{const used=new Set();for(const r of rows){const id=key(r);if(!id||used.has(id))fail();used.add(id);check(r);}};
      const person=r=>{if(!people.has(r.workerId)||r.workerLabel!==people.get(r.workerId))fail();};
      unique(m.assignments,r=>r.assignmentId,r=>{exact(r,['assignmentId','workerId','workerLabel','quantity','sewn','workDate','targetDate','note']);if(!safe(r.assignmentId)||!integer(r.quantity)||r.quantity<1||!integer(r.sewn)||r.sewn>r.quantity)fail();person(r);if(r.workDate!==null)day(r.workDate);if(r.targetDate!==null)day(r.targetDate);text(r.note,512);});
      unique(m.sewing,r=>r.recordId,r=>{exact(r,['recordId','workerId','workerLabel','workDate','good','reject','paid','storedRate','storedTotal']);if(!safe(r.recordId)||!integer(r.good)||!integer(r.reject)||!integer(r.good+r.reject)||r.good+r.reject<1||typeof r.paid!=='boolean')fail();person(r);day(r.workDate);if(r.storedRate!==null)money(r.storedRate);if(r.storedTotal!==null)money(r.storedTotal);});
      unique(m.payments,r=>r.recordId,r=>{exact(r,['recordId','workDate']);if(!safe(r.recordId))fail();day(r.workDate);});
      unique(m.payableRows,r=>r.family+'|'+r.recordId,r=>{exact(r,['family','recordId','workerId','workerLabel','workDate','paid']);if(!['jahit','hitungFisik','qc'].includes(r.family)||!safe(r.recordId)||typeof r.paid!=='boolean')fail();person(r);day(r.workDate);});
    }
    return freeze(copy(v));
  }
  function normalizeLegacyOwnerLifecycleCommand(v,revision){
    bounded(v,32768);if(!Object.hasOwn(EXTRA,v.kind))fail();exact(v,BASE.concat(EXTRA[v.kind]));if(!fresh(v.requestId)||!fresh(v.operationId)||!safe(v.productId)||!integer(v.expectedGrantRevision)||v.expectedGrantRevision<1||revision!==undefined&&v.expectedGrantRevision!==revision||!hash(v.expectedSourceVersion))fail();
    if(Object.hasOwn(v,'archiveId')&&!safe(v.archiveId))fail();
    if(v.kind==='ownerArchiveCycle'){if(!fresh(v.archiveId)||typeof v.startNewPO!=='boolean')fail();text(v.label,256,true);}
    if(v.kind==='ownerRestoreCycle'){if(v.safetyArchiveId!==null&&!fresh(v.safetyArchiveId))fail();if(v.safetyLabel!==null)text(v.safetyLabel,256,true);}
    if(v.kind==='ownerRelabelArchive')text(v.label,256,true);
    if(v.kind==='ownerSetPO'){if(typeof v.active!=='boolean'||!integer(v.quantity))fail();if(v.workDate!==null)day(v.workDate);text(v.note,512);}
    if(['ownerAppendAssignment','ownerEditAssignment'].includes(v.kind)){if(!safe(v.assignmentId)||v.kind==='ownerAppendAssignment'&&!fresh(v.assignmentId)||!safe(v.workerId)||!integer(v.quantity)||v.quantity<1)fail();day(v.workDate);if(v.targetDate!==null){day(v.targetDate);if(v.targetDate<v.workDate)fail();}text(v.note,512);}
    if(['ownerAppendJahit','ownerEditJahit'].includes(v.kind)){if(!safe(v.recordId)||v.kind==='ownerAppendJahit'&&!fresh(v.recordId)||!safe(v.workerId)||!integer(v.good)||!integer(v.reject)||!integer(v.good+v.reject)||v.good+v.reject<1||!['stored','reviewed'].includes(v.amountMode)||v.kind==='ownerAppendJahit'&&v.amountMode!=='reviewed')fail();day(v.workDate);if(v.kind==='ownerAppendJahit'&&v.assignmentId!==null&&!safe(v.assignmentId))fail();if(v.amountMode==='stored'){if(v.rate!==null||v.total!==null)fail();}else{money(v.rate);money(v.total);}}
    if(['ownerAppendPaymentNote','ownerEditPaymentNote'].includes(v.kind)){if(!safe(v.recordId)||v.kind==='ownerAppendPaymentNote'&&!fresh(v.recordId))fail();day(v.workDate);}
    if(v.kind==='ownerSetPaid'){if(!safe(v.recordId)||!['jahit','hitungFisik','qc'].includes(v.family)||typeof v.paid!=='boolean'||v.reviewed!==true||v.paid&&v.workDate===null||!v.paid&&v.workDate!==null)fail();if(v.workDate!==null)day(v.workDate);}
    return freeze(copy(v));
  }
  function ownerCommandMatchesView(view,raw){const v=normalizeLegacyOwnerLifecycleView(view,view.binding),cmd=normalizeLegacyOwnerLifecycleCommand(raw,v.binding.grantRevision),p=v.products.find(p=>p.productId===cmd.productId);if(!p||p.sourceVersion!==cmd.expectedSourceVersion)return false;
    if(cmd.kind==='ownerArchiveCycle')return p.hasCurrent&&!p.archives.some(a=>a.archiveId===cmd.archiveId);
    if(cmd.kind==='ownerRelabelArchive')return p.archives.some(a=>a.archiveId===cmd.archiveId);
    if(cmd.kind==='ownerRestoreCycle')return p.archives.some(a=>a.archiveId===cmd.archiveId)&&(p.hasCurrent?cmd.safetyArchiveId!==null&&cmd.safetyLabel!==null&&cmd.safetyArchiveId!==cmd.archiveId&&!p.archives.some(a=>a.archiveId===cmd.safetyArchiveId):cmd.safetyArchiveId===null&&cmd.safetyLabel===null);
    const m=v.maintenance.products.find(m=>m.productId===cmd.productId),person=()=>v.maintenance.workers.some(w=>w.workerId===cmd.workerId);
    if(cmd.kind==='ownerAppendAssignment')return person()&&!m.assignments.some(a=>a.assignmentId===cmd.assignmentId);
    if(cmd.kind==='ownerEditAssignment'){const a=m.assignments.find(a=>a.assignmentId===cmd.assignmentId);return !!a&&person()&&cmd.quantity>=a.sewn&&(a.sewn===0||a.workerId===cmd.workerId);}
    if(cmd.kind==='ownerAppendJahit')return person()&&!m.sewing.some(r=>r.recordId===cmd.recordId)&&(cmd.assignmentId===null?m.assignments.filter(a=>a.workerId===cmd.workerId).length<=1:m.assignments.some(a=>a.assignmentId===cmd.assignmentId&&a.workerId===cmd.workerId));
    if(cmd.kind==='ownerEditJahit'){const r=m.sewing.find(r=>r.recordId===cmd.recordId);return !!r&&!r.paid&&person()&&(cmd.amountMode==='reviewed'||r.workerId===cmd.workerId&&r.good===cmd.good&&r.reject===cmd.reject);}
    if(cmd.kind==='ownerAppendPaymentNote')return !m.payments.some(r=>r.recordId===cmd.recordId);
    if(cmd.kind==='ownerEditPaymentNote')return m.payments.some(r=>r.recordId===cmd.recordId);
    if(cmd.kind==='ownerSetPaid')return m.payableRows.some(r=>r.family===cmd.family&&r.recordId===cmd.recordId);
    return true;
  }
  return Object.freeze({normalizeOwnerLifecycleBinding,normalizeLegacyOwnerLifecycleView,normalizeLegacyOwnerLifecycleCommand,ownerCommandMatchesView});
});
