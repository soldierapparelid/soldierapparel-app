'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Plans=require('../cutting-plan.js'),Reconcile=require('../cutting-plan-reconcile.js');
const clone=x=>structuredClone(x),POLICY='actual-stock-v1',PLAN='synthetic-plan';
const M='synthetic-m',L='synthetic-l',XL='synthetic-xl';
const FLEX='synthetic-flex',FIXED='synthetic-fixed';

function fixture(flexible=true){
  let root={produksi:[M,L,XL].map((id,index)=>({id,size:['M','L','XL'][index],series:'Synthetic',namaBarang:'Synthetic garment',poAktif:true,potong:[],arsip:[],ownerMetadata:{keep:true}})),cuttingPlans:{},unrelated:{keep:true}};
  const stock={settings:{resetDate:'2026-01-01'},pembelian:[
    {id:FLEX,jenisBahan:'Synthetic ordinary',kg:20,unit:'kg',rolInfoId:'synthetic-flex-detail',rolNum:'F',tanggal:'2026-01-01'},
    {id:FIXED,jenisBahan:'Synthetic green',kg:10,unit:'kg',rolInfoId:'synthetic-fixed-detail',rolNum:'G',tanggal:'2026-01-01'}
  ],rolInfo:{
    'synthetic ordinary':{unit:'kg',rols:[{id:'synthetic-flex-detail',val:20}]},
    'synthetic green':{unit:'kg',rols:[{id:'synthetic-fixed-detail',val:10}]}
  },adjustment:[]};
  const rolls=flexible?[{purchaseId:FLEX,kg:2,quantityPolicy:POLICY},{purchaseId:FIXED,kg:3}]:[{purchaseId:FIXED,kg:3}];
  const plan=Plans.makePlan({id:PLAN,productIds:[M,L,XL],rolls,note:'Synthetic test only',createdAt:'2026-01-02T08:00:00.000Z'},root,stock);
  root=Plans.issue(root,stock,plan);return {root,stock};
}
function save(root,stock,quantities,selection,batch='synthetic-batch'){
  const meta={id:batch,tanggal:'2026-01-03',tukangId:'synthetic-worker',tukangNama:'Synthetic worker',tarif:5};
  if(selection!==undefined)meta.materialSelection=selection;
  const cuts=Plans.buildCuts(root,PLAN,quantities,meta),next=clone(root.produksi);
  cuts.forEach(c=>next.find(p=>p.id===c.productId).potong.push(c.entry));
  return Plans.applyCuts(root,next,stock);
}
function mixed(){
  let {root,stock}=fixture();
  root=save(root,stock,{[M]:10},[{purchaseId:FLEX,kg:5},{purchaseId:FIXED,kg:1}],'synthetic-first');
  root=save(root,stock,{[L]:6},[{purchaseId:FLEX,kg:3},{purchaseId:FIXED,kg:1}],'synthetic-second');
  return {root,stock};
}
function without(root,ids){const next=clone(root.produksi);next.filter(p=>ids.includes(p.id)).forEach(p=>{p.potong=[];});return next;}
function rejectsUnchanged(root,next){const before=clone({root,next});assert.throws(()=>Reconcile.reconcile(root,next));assert.deepEqual({root,next},before);}

test('partial deletion restores only removed actual fabric and preserves remaining above-snapshot receipt and financial fields',()=>{
  const {root,stock}=mixed(),next=without(root,[M]),before=clone({root,next,stock}),kept=clone(root.produksi.find(p=>p.id===L));
  const out=Reconcile.reconcile(root,next),plan=out.cuttingPlans[PLAN];
  assert.equal(plan.status,'in_progress');assert.deepEqual(plan.completedProductIds,[L]);
  assert.equal(plan.consumedRolls.find(r=>r.purchaseId===FLEX).kg,3);
  assert.equal(plan.consumedRolls.find(r=>r.purchaseId===FLEX).quantityPolicy,POLICY);
  assert.equal(plan.consumedRolls.find(r=>r.purchaseId===FIXED).kg,1);
  assert.equal(plan.usedBatchId,'synthetic-second');
  assert.deepEqual(out.produksi.find(p=>p.id===L),kept);
  const available=Plans.availability(out,stock);
  assert.equal(available.materials['synthetic ordinary'].stock,17);
  assert.equal(available.materials['synthetic ordinary'].reserved,0);
  assert.equal(available.materials['synthetic green'].stock,9);
  assert.equal(available.materials['synthetic green'].reserved,2);
  assert.doesNotThrow(()=>Plans.materialChoices(out,stock,PLAN));
  assert.deepEqual({root,next,stock},before);assert.deepEqual(out.unrelated,root.unrelated);
});

test('deleting all actual-stock results reopens the original allowance without reserving flexible stock or creating receipts',()=>{
  const {root,stock}=mixed(),next=without(root,[M,L]),before=clone({root,next,stock});
  const out=Reconcile.reconcile(root,next),plan=out.cuttingPlans[PLAN],available=Plans.availability(out,stock);
  assert.equal(plan.status,'ready');assert.deepEqual(plan.completedProductIds,[]);
  for(const field of ['materialMode','consumedRolls','usedBatchId','usedAt','lastCutAt'])assert.equal(Object.hasOwn(plan,field),false);
  assert.deepEqual(plan.rolls,root.cuttingPlans[PLAN].rolls);assert.deepEqual(out.produksi,next);
  assert.equal(available.materials['synthetic ordinary'].stock,20);assert.equal(available.materials['synthetic ordinary'].reserved,0);
  assert.equal(available.materials['synthetic green'].stock,10);assert.equal(available.materials['synthetic green'].reserved,3);
  assert.doesNotThrow(()=>save(out,stock,{[M]:4},[{purchaseId:FLEX,kg:4}],'synthetic-replacement'));
  assert.deepEqual({root,next,stock},before);
});

test('fixed-roll cumulative ceiling remains enforced even when all receipt totals balance',()=>{
  const {root,stock}=fixture(false),saved=save(root,stock,{[M]:5},[{purchaseId:FIXED,kg:2}]);
  saved.cuttingPlans[PLAN].rolls[0].kg=1;
  rejectsUnchanged(saved,without(saved,[M]));
});

for(const location of ['plan','receipt','consumed'])test('unknown policy in '+location+' is rejected without partial reconciliation',()=>{
  const {root}=mixed();
  const roll=location==='plan'?root.cuttingPlans[PLAN].rolls[0]:location==='consumed'?root.cuttingPlans[PLAN].consumedRolls[0]:root.produksi.find(p=>p.id===M).potong[0].rols[0];
  roll.quantityPolicy='unrecognized-policy';rejectsUnchanged(root,without(root,[M]));
});

for(const location of ['receipt','consumed'])test('missing actual-stock policy in '+location+' does not silently reclassify historical material',()=>{
  const {root}=mixed();
  const roll=location==='consumed'?root.cuttingPlans[PLAN].consumedRolls[0]:root.produksi.find(p=>p.id===M).potong[0].rols[0];
  delete roll.quantityPolicy;rejectsUnchanged(root,without(root,[M]));
});

test('actual-stock receipts cannot be reconciled as legacy all-at-once material',()=>{
  const {root}=mixed();delete root.cuttingPlans[PLAN].materialMode;rejectsUnchanged(root,without(root,[M]));
});

test('unchanged fixed legacy transfer conserves all cloth on remaining same-date result',()=>{
  let {root,stock}=fixture(false);root=save(root,stock,{[M]:5,[L]:5},undefined,'synthetic-legacy');
  const next=without(root,[M]),before=clone({root,next}),out=Reconcile.reconcile(root,next),entry=out.produksi.find(p=>p.id===L).potong[0];
  assert.equal(entry.kiloan,3);assert.equal(entry.materialAllocation,'owner-plan-material-transferred');
  assert.equal(entry.materialTransferSources.length,1);assert.equal(entry.jumlah,5);assert.equal(entry.tarif,5);assert.equal(entry.total,25);
  assert.equal(out.cuttingPlans[PLAN].status,'in_progress');assert.equal(Plans.availability(out,stock).materials['synthetic green'].stock,7);
  assert.deepEqual({root,next},before);
});

test('remaining actual receipt cannot be modified while a different result is deleted',()=>{
  const {root}=mixed(),next=without(root,[M]);next.find(p=>p.id===L).potong[0].tanggal='2026-01-04';
  rejectsUnchanged(root,next);
});
