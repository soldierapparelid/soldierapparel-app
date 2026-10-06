'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Authority=require('../server/production-authority.cjs');
const Model=require('../maklon-earnings.js');
const NOW='2026-10-05T03:00:00.000Z',LATER='2026-10-06T03:00:00.000Z',DATE='2026-10-05',NEXT_DATE='2026-10-06';
const copy=value=>JSON.parse(JSON.stringify(value));
function bootstrap(options={}){
  return {product:{id:'product-1',series:'Synthetic',namaBarang:'Example',size:'M',cutQuantity:10},cycleId:'cycle-1',workers:[{id:'worker-1',nama:'Synthetic partner one'},{id:'worker-2',nama:'Synthetic partner two'}],assignments:[{id:'assignment-1',workerId:'worker-1',qty:10}],now:NOW,...options};
}
const initial=options=>Authority.createAuthority(bootstrap(options));
function context(role='qc',options={}){
  const profile=role==='owner'?{active:true,owner:true}:role==='sewing'?{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}}:{active:true,owner:false,modules:{qc:true}};
  return {uid:role+'-user',emailVerified:true,provider:'google.com',profile,now:NOW,...options};
}
function command(state,kind,payload,requestId='request-'+(state.revision+1)+'-'+kind){return {requestId,productId:state.productId,cycleId:state.cycleId,expectedRevision:state.revision,kind,payload};}
function tariff(state,countId,options={}){
  const now=options.selectedAt||NOW,workDate=options.workDate||DATE;
  return {source:'private-verified-tariff',verified:true,workerId:'worker-1',productId:state.productId,cycleId:state.cycleId,countId,workDate,basisAt:now,effectiveAt:'2026-01-01T00:00:00.000Z',tariffVersion:'tariff-v1',currency:'IDR',rate:100,selectedAt:now,...options};
}
function step(state,kind,payload,actor=context(),requestId){return Authority.applyCommand(state,actor,command(state,kind,payload,requestId)).state;}
function sew(state=initial(),options={}){return step(state,'sewing',{id:'sewing-1',assignmentId:'assignment-1',tanggal:DATE,good:10,reject:0,...options},context('sewing'));}
function count(state=sew(),options={},selectionOptions={}){
  const payload={id:'count-1',assignmentId:'assignment-1',tanggal:DATE,jumlah:10,...options};
  return step(state,'count',payload,context('qc',{now:selectionOptions.selectedAt||NOW,selectedTariffs:{[payload.id]:tariff(state,payload.id,{workDate:payload.tanggal,...selectionOptions})}}));
}
function inspect(state=count(),options={}){return step(state,'inspect',{batchId:'batch-1',entries:[{id:'qc-1',hfId:'count-1',tanggal:DATE,ok:5,perbaikan:3,reject:1,offline:1,...options}]});}
const earnings=(state,workerId='worker-1')=>Model.summarize(Model.normalize(Authority.project(state).earningsByWorker[workerId],workerId));
function rejectsCode(callback,code){assert.throws(callback,error=>error instanceof Authority.AuthorityError&&error.code===code&&error.message===code);}

test('bootstrap and transitions preserve inputs and freeze the complete co-located authority/projection',()=>{
  const spec=bootstrap(),specBefore=copy(spec),state=Authority.createAuthority(spec),stateBefore=copy(state),actor=context('sewing'),payload={id:'sewing-1',assignmentId:'assignment-1',tanggal:DATE,good:7,reject:3},request=command(state,'sewing',payload),requestBefore=copy(request);
  const result=Authority.applyCommand(state,actor,request);
  assert.deepEqual(spec,specBefore);assert.deepEqual(state,stateBefore);assert.deepEqual(request,requestBefore);assert.equal(result.state.revision,1);assert.equal(result.replayed,false);
  assert.equal(Object.isFrozen(result.state),true);assert.equal(Object.isFrozen(result.state.projection.operations.jahit[0]),true);
  assert.throws(()=>{result.state.snapshots.v0000000000.acceptedAt=LATER;},TypeError);
  assert.deepEqual(result.state.snapshots.v0000000000,state.snapshots.v0000000000);assert.equal(result.state.outbox.revision,1);assert.equal(result.state.outbox.snapshotHash,result.state.snapshots.v0000000001.hash);
});

test('request receipts make retries idempotent and reject changed payload under the same request ID',()=>{
  const before=initial(),request=command(before,'sewing',{id:'sewing-1',assignmentId:'assignment-1',tanggal:DATE,good:4,reject:0},'stable-request');
  const first=Authority.applyCommand(before,context('sewing'),request),replay=Authority.applyCommand(first.state,context('sewing',{now:LATER}),request);
  assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,first.receipt);assert.deepEqual(replay.state,first.state);
  const changed=copy(request);changed.payload.good=5;rejectsCode(()=>Authority.applyCommand(first.state,context('sewing'),changed),'request_id_conflict');
});

test('concurrent and out-of-order command revisions cannot overwrite an accepted transition',()=>{
  const before=initial(),first=command(before,'sewing',{id:'sewing-a',assignmentId:'assignment-1',tanggal:DATE,good:4,reject:0},'request-a'),second=command(before,'sewing',{id:'sewing-b',assignmentId:'assignment-1',tanggal:DATE,good:6,reject:0},'request-b');
  const committed=Authority.applyCommand(before,context('sewing'),first).state;
  const competing=Authority.applyCommand(before,context('sewing'),second).state;assert.equal(competing.revision,1);
  // A database transaction retry uses its actual current state, not the stale
  // source used to compute the competing result.
  rejectsCode(()=>Authority.applyCommand(committed,context('sewing'),second),'stale_revision');
  const refreshed={...second,expectedRevision:committed.revision},next=Authority.applyCommand(committed,context('sewing'),refreshed).state;
  assert.equal(next.revision,2);assert.equal(next.outbox.revision,2);assert.deepEqual(next.snapshots.v0000000001,committed.snapshots.v0000000001);
  rejectsCode(()=>Authority.applyCommand(next,context('sewing'),{...first,requestId:'late-request'}),'stale_revision');
});

test('a sewing partner is bound to their server assignment; QC and owner scopes remain distinct',()=>{
  const state=initial({product:{...bootstrap().product,cutQuantity:12},assignments:[{id:'assignment-1',workerId:'worker-1',qty:8},{id:'assignment-2',workerId:'worker-2',qty:4}]});
  const foreign=command(state,'sewing',{id:'foreign',assignmentId:'assignment-2',tanggal:DATE,good:4,reject:0});
  rejectsCode(()=>Authority.applyCommand(state,context('sewing'),foreign),'access_denied');rejectsCode(()=>Authority.applyCommand(state,context('qc'),foreign),'access_denied');
  const ownerResult=Authority.applyCommand(state,context('owner'),foreign).state;assert.equal(ownerResult.sewing.foreign.workerId,'worker-2');
  const countForeign=command(ownerResult,'count',{id:'count-2',assignmentId:'assignment-2',tanggal:DATE,jumlah:4});
  rejectsCode(()=>Authority.applyCommand(ownerResult,context('sewing'),countForeign),'access_denied');
  const qcResult=Authority.applyCommand(ownerResult,context('qc',{selectedTariffs:{'count-2':tariff(state,'count-2',{workerId:'worker-2'})}}),countForeign).state;
  assert.equal(earnings(qcResult,'worker-2').calculatedTotal,400);assert.equal(earnings(qcResult).calculatedTotal,0);
});

test('unverified, revoked, non-Google or unmapped identities cannot act or replay',()=>{
  const state=initial(),request=command(state,'sewing',{id:'sewing-1',assignmentId:'assignment-1',tanggal:DATE,good:1,reject:0});
  for(const change of [{emailVerified:false},{provider:'password'},{uid:'../unsafe'},{profile:{active:false,owner:true}},{profile:{active:true,modules:{jahit:true}}},{profile:{active:true,workerId:'worker-2',modules:{jahit:true}}}])rejectsCode(()=>Authority.applyCommand(state,context('sewing',change),request),'access_denied');
  const accepted=Authority.applyCommand(state,context('sewing'),request).state;
  rejectsCode(()=>Authority.applyCommand(accepted,context('sewing',{profile:{active:false,owner:true}}),request),'access_denied');
});

test('client money, PINs, payroll snapshots, profile claims and free worker identity are rejected without echo',()=>{
  const state=initial(),payload={id:'sewing-1',assignmentId:'assignment-1',tanggal:DATE,good:1,reject:0};
  for(const injected of [{tarif:999},{total:999},{pin:'synthetic-private-value'},{payroll:{workerId:'worker-2',rate:999}},{workerId:'worker-2'},{dibayar:true}]){
    const request=command(state,'sewing',{...payload,...injected});rejectsCode(()=>Authority.applyCommand(state,context('owner'),request),'invalid_command');
  }
  const request={...command(state,'sewing',payload),profile:{owner:true}};rejectsCode(()=>Authority.applyCommand(state,context('sewing'),request),'invalid_command');
  let getterCalls=0;const withGetter={...payload};Object.defineProperty(withGetter,'tarif',{enumerable:true,get(){getterCalls++;return 999;}});
  rejectsCode(()=>Authority.applyCommand(state,context('sewing'),command(state,'sewing',withGetter)),'invalid_command');assert.equal(getterCalls,0);
  const hidden={...payload};Object.defineProperty(hidden,'good',{enumerable:false,get(){getterCalls++;return 1;}});
  rejectsCode(()=>Authority.applyCommand(state,context('sewing'),command(state,'sewing',hidden)),'invalid_command');assert.equal(getterCalls,0);
});

test('quantity and explicit relationship limits reject malformed or excessive production commands',()=>{
  const state=initial(),payload={id:'sewing-1',assignmentId:'assignment-1',tanggal:DATE,good:1,reject:0};
  for(const change of [{good:'1'},{good:0.5},{reject:-1},{tanggal:'2026-02-30'},{id:'__proto__'}])rejectsCode(()=>Authority.applyCommand(state,context('sewing'),command(state,'sewing',{...payload,...change})),'invalid_command');
  rejectsCode(()=>Authority.applyCommand(state,context('sewing'),command(state,'sewing',{...payload,good:11})),'capacity_exceeded');
  rejectsCode(()=>Authority.applyCommand(state,context('sewing'),command(state,'sewing',{...payload,assignmentId:'missing'})),'invalid_relationship');
  rejectsCode(()=>Authority.applyCommand(state,context('sewing'),command(state,'sewing',{...payload,tanggal:NEXT_DATE})),'invalid_transition');
  const sewn=sew();rejectsCode(()=>step(sewn,'count',{id:'too-many',assignmentId:'assignment-1',tanggal:DATE,jumlah:11},context('qc',{selectedTariffs:{'too-many':tariff(sewn,'too-many')}})),'capacity_exceeded');
});

test('physical count requires an explicitly bound private historical tariff and publishes provisional earnings',()=>{
  const state=sew(),payload={id:'count-1',assignmentId:'assignment-1',tanggal:DATE,jumlah:10},request=command(state,'count',payload);
  rejectsCode(()=>Authority.applyCommand(state,context('qc'),request),'frozen_tariff_required');
  for(const change of [{workerId:'worker-2'},{productId:'other-product'},{cycleId:'other-cycle'},{countId:'other-count'},{workDate:NEXT_DATE},{rate:0},{rate:0.5},{verified:false},{currency:'USD'},{source:'browser'},{basisAt:LATER},{effectiveAt:LATER}]){
    rejectsCode(()=>Authority.applyCommand(state,context('qc',{selectedTariffs:{'count-1':tariff(state,'count-1',change)}}),request),'invalid_tariff_snapshot');
  }
  const selection=tariff(state,'count-1'),selectedContext=context('qc',{selectedTariffs:{'count-1':selection}}),accepted=Authority.applyCommand(state,selectedContext,request).state;
  selection.rate=999;assert.equal(accepted.frozenPayroll['count-1'].rate,100);
  const calculated=earnings(accepted);assert.equal(calculated.quantity,10);assert.equal(calculated.calculatedTotal,1000);assert.equal(calculated.provisionalTotal,1000);assert.equal(calculated.paymentEvidence,'not_in_this_data');
});

test('QC zero is authoritative and warehouse reject mirrors cannot resurrect provisional earnings',()=>{
  const counted=count(),before=earnings(counted);assert.equal(before.calculatedTotal,1000);
  const state=inspect(counted,{ok:0,perbaikan:0,reject:10,offline:0});assert.equal(earnings(state).calculatedTotal,0);assert.equal(earnings(state).quantity,0);
  const projection=Authority.project(state);assert.equal(projection.operations.qc[0].ok,0);assert.deepEqual(projection.operations.gudang.map(row=>[row.status,row.jumlah]),[['reject',10]]);assert.equal(projection.operations.bigSaller,undefined);
  assert.deepEqual(state.frozenPayroll,counted.frozenPayroll);assert.deepEqual(state.snapshots.v0000000002,counted.snapshots.v0000000002);
});

test('QC requires the complete upstream/count workflow and exact count/category totals',()=>{
  const partlySewn=sew(initial(),{good:5}),partlyCounted=count(partlySewn,{jumlah:5});
  rejectsCode(()=>inspect(partlyCounted,{ok:5,perbaikan:0,reject:0,offline:0}),'workflow_not_ready');
  const counted=count();rejectsCode(()=>inspect(counted,{ok:6}),'invalid_transition');
  rejectsCode(()=>step(counted,'inspect',{batchId:'batch-1',entries:[{id:'qc-1',hfId:'missing',tanggal:DATE,ok:10,perbaikan:0,reject:0,offline:0}]}),'invalid_relationship');
  const inspected=inspect(counted);rejectsCode(()=>step(inspected,'inspect',{batchId:'batch-2',entries:[{id:'qc-other',hfId:'count-1',tanggal:DATE,ok:10,perbaikan:0,reject:0,offline:0}]}),'invalid_transition');
});

test('sewing rejects reduce physical count target; cached assignment remainders never determine capacity',()=>{
  const sewn=sew(initial(),{good:7,reject:3}),counted=count(sewn,{jumlah:7}),state=inspect(counted,{ok:7,perbaikan:0,reject:0,offline:0});
  assert.equal(earnings(state).calculatedTotal,700);assert.equal(state.projection.operations.assignJahit[0].sisa,0);assert.equal(state.projection.operations.jahit[0].quantityBasis,'good-plus-reject');
});

test('repair completion dates and original frozen rates survive later tariff changes without duplicate warehouse pay',()=>{
  const before=inspect(),frozenBefore=copy(before.frozenPayroll),originalQc=copy(before.inspections['qc-1']);
  const actor=context('qc',{now:LATER,selectedTariffs:{'count-1':tariff(before,'count-1',{rate:999,selectedAt:LATER,workDate:NEXT_DATE})}});
  const state=step(before,'repair',{id:'repair-1',qcId:'qc-1',tanggal:NEXT_DATE,jumlah:2},actor),calculated=earnings(state),entries=Object.values(state.projection.earningsByWorker['worker-1'].entries);
  assert.equal(calculated.quantity,7);assert.equal(calculated.calculatedTotal,700);assert.equal(calculated.provisionalTotal,0);assert.deepEqual(state.frozenPayroll,frozenBefore);assert.deepEqual(state.inspections['qc-1'],originalQc);
  assert.equal(entries.find(row=>row.sourceType==='hitungFisik').tanggal,DATE);assert.equal(entries.find(row=>row.sourceType==='qcRepair').tanggal,NEXT_DATE);assert.ok(entries.every(row=>row.tarif===100));
  assert.equal(state.projection.operations.qc[0].ok,7);assert.equal(state.projection.operations.qc[0].perbaikan,1);
  assert.deepEqual(state.projection.operations.repairs,[{id:'repair-1',qcId:'qc-1',tukangId:'worker-1',tanggal:NEXT_DATE,jumlah:2,inputAt:LATER}]);
  assert.equal(Object.isFrozen(state.projection.operations.repairs[0]),true);
  assert.ok(state.projection.operations.gudang.filter(row=>row.payrollStage==='repair').every(row=>row.id!=='repair-1'));
  assert.equal(state.projection.operations.gudang.filter(row=>row.status==='ok').reduce((total,row)=>total+row.jumlah,0),7);assert.equal(state.projection.operations.bigSaller.reduce((total,row)=>total+row.jumlah,0),7);
  assert.equal(earnings(state).calculatedTotal,700,'Warehouse/sellable mirrors are not independent earnings');
});

test('combined QC keeps each count, frozen rate and repair source distinct in one atomic revision',()=>{
  let state=sew();state=count(state,{id:'count-a',jumlah:4},{rate:100});state=count(state,{id:'count-b',jumlah:6},{rate:200,tariffVersion:'tariff-v2'});const before=state;
  state=step(state,'inspect',{batchId:'combined',entries:[{id:'qc-a',hfId:'count-a',tanggal:DATE,ok:2,perbaikan:1,reject:1,offline:0},{id:'qc-b',hfId:'count-b',tanggal:DATE,ok:4,perbaikan:2,reject:0,offline:0}]});
  assert.equal(state.revision,before.revision+1);assert.equal(state.projection.operations.qc.length,2);assert.equal(earnings(state).calculatedTotal,1000);
  state=step(state,'repair',{id:'repair-a',qcId:'qc-a',tanggal:NEXT_DATE,jumlah:1},context('qc',{now:LATER}));state=step(state,'repair',{id:'repair-b',qcId:'qc-b',tanggal:NEXT_DATE,jumlah:2},context('qc',{now:LATER}));
  assert.equal(earnings(state).calculatedTotal,1500);assert.deepEqual(state.frozenPayroll,before.frozenPayroll);assert.equal(new Set(Object.keys(state.projection.earningsByWorker['worker-1'].entries)).size,4);
});

test('a combined batch cannot mix partner identities or apply a partial invalid update',()=>{
  const spec=bootstrap({product:{...bootstrap().product,cutQuantity:12},assignments:[{id:'assignment-1',workerId:'worker-1',qty:8},{id:'assignment-2',workerId:'worker-2',qty:4}]});let state=Authority.createAuthority(spec);
  state=sew(state,{good:8});state=step(state,'sewing',{id:'sewing-2',assignmentId:'assignment-2',tanggal:DATE,good:4,reject:0},context('owner'));state=count(state,{id:'count-a',jumlah:8});state=count(state,{id:'count-b',assignmentId:'assignment-2',jumlah:4},{workerId:'worker-2'});
  const before=copy(state),request=command(state,'inspect',{batchId:'mixed-batch',entries:[{id:'qc-a',hfId:'count-a',tanggal:DATE,ok:8,perbaikan:0,reject:0,offline:0},{id:'qc-b',hfId:'count-b',tanggal:DATE,ok:4,perbaikan:0,reject:0,offline:0}]});
  rejectsCode(()=>Authority.applyCommand(state,context('qc'),request),'invalid_relationship');assert.deepEqual(state,before);
});

test('repair rejects missing/cancelled masters, over-completion, invalid dates and forged money',()=>{
  const state=inspect(),payload={id:'repair-1',qcId:'qc-1',tanggal:NEXT_DATE,jumlah:1},actor=context('qc',{now:LATER});
  rejectsCode(()=>step(state,'repair',{...payload,jumlah:4},actor),'invalid_transition');rejectsCode(()=>step(state,'repair',{...payload,tanggal:'2026-10-04'},actor),'invalid_transition');rejectsCode(()=>step(state,'repair',{...payload,qcId:'missing'},actor),'invalid_relationship');rejectsCode(()=>step(state,'repair',{...payload,total:999},actor),'invalid_command');
  const cancelled=step(state,'cancel',{targetType:'inspect',targetId:'qc-1'},actor);rejectsCode(()=>step(cancelled,'repair',payload,actor),'invalid_transition');
});

test('cancelling QC or its count cancels linked repairs and removes all live mirrors without losing history',()=>{
  for(const targetType of ['inspect','count']){
    let state=inspect();state=step(state,'repair',{id:'repair-1',qcId:'qc-1',tanggal:NEXT_DATE,jumlah:2},context('qc',{now:LATER}));const before=state;
    state=step(state,'cancel',{targetType,targetId:targetType==='inspect'?'qc-1':'count-1'},context('qc',{now:LATER}));
    assert.equal(state.counts['count-1'].cancelled,true);assert.equal(state.inspections['qc-1'].cancelled,true);assert.equal(state.repairs['repair-1'].cancelled,true);assert.equal(earnings(state).calculatedTotal,0);
    for(const field of ['hitungFisik','qc','repairs','gudang','bigSaller'])assert.equal(state.projection.operations[field],undefined);
    assert.deepEqual(state.frozenPayroll,before.frozenPayroll);assert.deepEqual(state.snapshots[snapshotKey(before.revision)],before.snapshots[snapshotKey(before.revision)]);
    rejectsCode(()=>count(state,{id:'count-1'},{selectedAt:LATER,basisAt:NOW}),'reused_record_id');
  }
});
const snapshotKey=revision=>'v'+String(revision).padStart(10,'0');

test('cancelling one repair adjusts current approved quantities while its historical source remains',()=>{
  let state=inspect();state=step(state,'repair',{id:'repair-1',qcId:'qc-1',tanggal:NEXT_DATE,jumlah:2},context('qc',{now:LATER}));const before=state;
  state=step(state,'cancel',{targetType:'repair',targetId:'repair-1'},context('qc',{now:LATER}));
  assert.equal(earnings(state).calculatedTotal,500);assert.equal(state.projection.operations.qc[0].ok,5);assert.equal(state.projection.operations.qc[0].perbaikan,3);assert.equal(state.repairs['repair-1'].cancelled,true);assert.deepEqual(state.frozenPayroll,before.frozenPayroll);
  assert.equal(state.projection.operations.repairs,undefined);assert.equal(state.snapshots[snapshotKey(before.revision)].projection.operations.repairs[0].id,'repair-1');
});

test('identical repair movements retain distinct original IDs and cancelling one preserves its private snapshot',()=>{
  let state=inspect();for(const id of ['repair-a','repair-b'])state=step(state,'repair',{id,qcId:'qc-1',tanggal:NEXT_DATE,jumlah:1},context('qc',{now:LATER}));
  const before=state,projection=Authority.project(state),ids=projection.operations.repairs.map(row=>row.id);
  assert.deepEqual(ids,['repair-a','repair-b']);assert.equal(new Set(projection.operations.gudang.filter(row=>row.payrollStage==='repair').map(row=>row.id)).size,2);
  for(const row of projection.operations.repairs)assert.deepEqual(Object.keys(row).sort(),['id','inputAt','jumlah','qcId','tanggal','tukangId']);
  state=step(state,'cancel',{targetType:'repair',targetId:'repair-a'},context('qc',{now:LATER}));
  assert.deepEqual(state.projection.operations.repairs.map(row=>row.id),['repair-b']);assert.equal(state.repairs['repair-a'].cancelled,true);
  assert.deepEqual(state.snapshots[snapshotKey(before.revision)],before.snapshots[snapshotKey(before.revision)]);assert.deepEqual(state.frozenPayroll,before.frozenPayroll);
  assert.equal(Authority.decodeStorage(Authority.encodeStorage(state)).projection.operations.repairs[0].id,'repair-b');
});

test('sewing cancellation cannot invalidate an already counted quantity or cross partner ownership',()=>{
  const sewn=sew(),cancelled=step(sewn,'cancel',{targetType:'sewing',targetId:'sewing-1'},context('sewing'));assert.equal(cancelled.sewing['sewing-1'].cancelled,true);assert.equal(cancelled.projection.operations.jahit,undefined);assert.equal(cancelled.projection.operations.assignJahit[0].sisa,10);
  const counted=count(sewn);rejectsCode(()=>step(counted,'cancel',{targetType:'sewing',targetId:'sewing-1'},context('sewing')),'dependent_records_exist');
  rejectsCode(()=>step(sewn,'cancel',{targetType:'sewing',targetId:'sewing-1'},context('sewing',{profile:{active:true,workerId:'worker-2',modules:{jahit:true}}})),'access_denied');
});

test('private frozen rates, projections and immutable snapshot chains cannot be replaced by tampered state',()=>{
  const state=inspect();
  for(const mutate of [bad=>{bad.frozenPayroll['count-1'].rate=999;},bad=>{bad.projection.operations.pin='synthetic-private-value';},bad=>{bad.snapshots.v0000000001.projection.operations.jahit[0].jumlah=999;},bad=>{bad.outbox.revision=0;}]){
    const bad=copy(state);mutate(bad);rejectsCode(()=>Authority.project(bad),'invalid_state');
  }
});

test('unsupported legacy import, assignment edits, direct warehouse earnings and payments fail closed',()=>{
  const state=initial();for(const kind of ['warehouse','edit','assign','import','pay'])rejectsCode(()=>Authority.applyCommand(state,context('owner'),command(state,kind,{})),'unsupported_command');
  const spec=bootstrap();spec.product.tarif=999;rejectsCode(()=>Authority.createAuthority(spec),'invalid_bootstrap');
  const legacy=copy(state);legacy.schemaVersion=2;rejectsCode(()=>Authority.project(legacy),'invalid_state');
});

test('unsafe integer multiplication rejects the whole command rather than publishing imprecise upah',()=>{
  const sewn=sew();rejectsCode(()=>count(sewn,{}, {rate:Number.MAX_SAFE_INTEGER}),'money_overflow');assert.equal(sewn.revision,1);assert.equal(Object.keys(sewn.counts).length,0);
});

test('aggregate upah overflow is rejected even when each individual entry is a safe integer',()=>{
  let state=sew();const large=Math.floor(Number.MAX_SAFE_INTEGER/2)+1;
  state=count(state,{id:'count-a',jumlah:1},{rate:large});const before=state;
  rejectsCode(()=>count(state,{id:'count-b',jumlah:1},{rate:large}),'money_overflow');assert.deepEqual(state,before);assert.equal(Object.keys(state.counts).length,1);
});

test('sewing cancellation cannot replace counted old work with a later dated sewing source',()=>{
  let state=step(initial(),'sewing',{id:'old-sewing',assignmentId:'assignment-1',tanggal:DATE,good:5,reject:0},context('sewing'));
  state=step(state,'sewing',{id:'later-sewing',assignmentId:'assignment-1',tanggal:NEXT_DATE,good:5,reject:0},context('sewing',{now:LATER}));
  state=count(state,{jumlah:5},{selectedAt:LATER,basisAt:NOW});
  rejectsCode(()=>step(state,'cancel',{targetType:'sewing',targetId:'old-sewing'},context('sewing',{now:LATER})),'dependent_records_exist');
});

test('fresh transitions reject backward server time while an accepted retry retains its original receipt',()=>{
  const before=initial(),request=command(before,'sewing',{id:'sewing-a',assignmentId:'assignment-1',tanggal:DATE,good:5,reject:0},'time-request');
  const state=Authority.applyCommand(before,context('sewing',{now:LATER}),request).state;
  rejectsCode(()=>step(state,'sewing',{id:'sewing-b',assignmentId:'assignment-1',tanggal:DATE,good:5,reject:0},context('sewing')),'invalid_server_time');
  const retry=Authority.applyCommand(state,context('sewing'),request);assert.equal(retry.replayed,true);assert.equal(retry.receipt.acceptedAt,LATER);
});

test('a valid earlier count can follow a later count while every dated capacity prefix remains enforced',()=>{
  let state=step(initial(),'sewing',{id:'early-sewing',assignmentId:'assignment-1',tanggal:DATE,good:5,reject:0},context('sewing'));
  state=step(state,'sewing',{id:'late-sewing',assignmentId:'assignment-1',tanggal:NEXT_DATE,good:5,reject:0},context('sewing',{now:LATER}));
  state=count(state,{id:'late-count',tanggal:NEXT_DATE,jumlah:5},{selectedAt:LATER,basisAt:LATER});const before=copy(state);
  rejectsCode(()=>count(state,{id:'excess-early-count',tanggal:DATE,jumlah:6},{selectedAt:LATER,basisAt:NOW}),'capacity_exceeded');assert.deepEqual(state,before);
  state=count(state,{id:'early-count',tanggal:DATE,jumlah:5},{selectedAt:LATER,basisAt:NOW});
  assert.equal(earnings(state).calculatedTotal,1000);assert.equal(state.counts['early-count'].tanggal,DATE);assert.equal(state.frozenPayroll['early-count'].basisAt,NOW);assert.equal(state.frozenPayroll['early-count'].selectedAt,LATER);
  assert.doesNotThrow(()=>Authority.validateState(state));
  rejectsCode(()=>step(state,'cancel',{targetType:'sewing',targetId:'early-sewing'},context('sewing',{now:LATER})),'dependent_records_exist');
});

test('public upstream quantity preserves a reviewed cutting witness without fabricating cutting receipts',()=>{
  const state=initial({assignments:[{id:'assignment-1',workerId:'worker-1',qty:5}]}),projection=Authority.project(state);
  assert.equal(projection.operations.cutQuantity,10);assert.equal(projection.operations.potong,undefined);assert.equal(projection.operations.assignJahit[0].qty,5);
  const counted=count(sew(state,{good:5}),{jumlah:5});
  rejectsCode(()=>inspect(counted,{ok:5,perbaikan:0,reject:0,offline:0}),'workflow_not_ready');
});

// Synthetic RTDB roundtrip: null/empty maps disappear, dense arrays may become
// numeric-key maps. The privateAuthority string is preserved byte-for-byte.
function firebasePrune(value,arrayMaps=false){
  if(value===null)return undefined;
  if(value&&typeof value==='object'){
    const out={};for(const [key,child]of Object.entries(value)){const next=firebasePrune(child,arrayMaps);if(next!==undefined)out[key]=next;}
    if(!Object.keys(out).length)return undefined;
    return Array.isArray(value)&&!arrayMaps?Object.keys(out).map(key=>out[key]):out;
  }
  return value;
}

test('encoded co-located storage survives Firebase null/empty pruning and numeric array maps',()=>{
  const pristine=initial();rejectsCode(()=>Authority.validateState(firebasePrune(pristine)),'invalid_state');
  const phases=[pristine,sew(),count(),inspect()];
  phases.push(step(phases[3],'repair',{id:'repair-1',qcId:'qc-1',tanggal:NEXT_DATE,jumlah:2},context('qc',{now:LATER})));
  for(const state of phases)for(const arrayMaps of [false,true]){
    const encoded=Authority.encodeStorage(state),wire=firebasePrune(encoded,arrayMaps),restored=Authority.decodeStorage(wire);
    assert.equal(Object.isFrozen(encoded),true);assert.equal(typeof encoded.privateAuthority,'string');assert.equal(wire.privateAuthority,encoded.privateAuthority);
    assert.deepEqual(restored,state);assert.equal(restored.snapshots.v0000000000.parentHash,null);assert.equal(Object.isFrozen(restored),true);
    assert.deepEqual(Authority.project(restored),Authority.project(state));
  }
  const restored=Authority.decodeStorage(firebasePrune(Authority.encodeStorage(pristine),true));
  for(const field of ['sewing','counts','inspections','repairs','frozenPayroll','receipts'])assert.deepEqual(restored[field],{});
  const next=sew(restored);assert.equal(next.revision,1);assert.equal(next.projection.operations.jahit[0].jumlah,10);
});

test('wire decode rejects public projection, envelope and private-state tampering without echoing data',()=>{
  const encoded=Authority.encodeStorage(inspect());
  const mutators=[
    bad=>{bad.productId='different-product';},bad=>{bad.cycleId='different-cycle';},bad=>{bad.revision--;},bad=>{bad.storageFormat='different-format';},
    bad=>{bad.projection.operations.cutQuantity=999;},bad=>{bad.projection.operations.pin='synthetic-private-value';},
    bad=>{bad.projection.earningsByWorker['worker-1'].entries[Object.keys(bad.projection.earningsByWorker['worker-1'].entries)[0]].tarif=999;},
    bad=>{delete bad.projection.earningsByWorker['worker-1'];},
    bad=>{const privateState=JSON.parse(bad.privateAuthority);privateState.frozenPayroll['count-1'].rate=999;bad.privateAuthority=JSON.stringify(privateState);},
    bad=>{const privateState=JSON.parse(bad.privateAuthority);delete privateState.snapshots.v0000000000.parentHash;bad.privateAuthority=JSON.stringify(privateState);},
    bad=>{bad.privateAuthority='not-json-synthetic-private-value';}
  ];
  for(const mutate of mutators){const bad=copy(encoded);mutate(bad);rejectsCode(()=>Authority.decodeStorage(firebasePrune(bad,true)),'invalid_storage');}
  let getterCalls=0;const withGetter=copy(encoded);Object.defineProperty(withGetter,'privateAuthority',{enumerable:true,get(){getterCalls++;return encoded.privateAuthority;}});
  rejectsCode(()=>Authority.decodeStorage(withGetter),'invalid_storage');assert.equal(getterCalls,0);
});

test('storage wire is bounded before parsing an oversized private JSON value',()=>{
  const encoded=copy(Authority.encodeStorage(initial()));encoded.privateAuthority='x'.repeat(8*1024*1024+1);
  rejectsCode(()=>Authority.decodeStorage(encoded),'storage_capacity');
});
