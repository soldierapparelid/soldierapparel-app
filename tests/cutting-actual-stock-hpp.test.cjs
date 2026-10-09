'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const CuttingPlan=require('../cutting-plan.js'),HppModelCost=require('../hpp-model-cost.js');
const clone=value=>structuredClone(value),POLICY='actual-stock-v1';
const PLAN='synthetic-plan',ORDINARY='Synthetic ordinary',GREEN='Synthetic green',FLEX='synthetic-ordinary-roll',FIXED='synthetic-green-roll';

function fixture({flexible=true,unit='kg',continuation=false}={}){
  let root={produksi:['M','L'].map(size=>({id:'synthetic-size-'+size.toLowerCase(),series:'Synthetic series',namaBarang:'Synthetic garment',size,poAktif:true,potong:[],arsip:[]})),cuttingPlans:{}};
  const stock={settings:{resetDate:'2026-01-01'},pembelian:[
    {id:FLEX,jenisBahan:ORDINARY,kg:20,hargaPerKg:100,total:2000,unit,rolInfoId:'synthetic-ordinary-detail',rolNum:'O-1',tanggal:'2026-01-01'},
    {id:FIXED,jenisBahan:GREEN,kg:10,hargaPerKg:50,total:500,unit:'kg',rolInfoId:'synthetic-green-detail',rolNum:'G-1',tanggal:'2026-01-01'}
  ],rolInfo:{[ORDINARY.toLowerCase()]:{unit,rols:[{id:'synthetic-ordinary-detail',val:20}]},[GREEN.toLowerCase()]:{unit:'kg',rols:[{id:'synthetic-green-detail',val:10}]}},adjustment:[]};
  const plan=CuttingPlan.makePlan({id:PLAN,productIds:root.produksi.map(p=>p.id),rolls:[{purchaseId:FLEX,kg:2,...(flexible?{quantityPolicy:POLICY}:{})},{purchaseId:FIXED,kg:3}],createdAt:'2026-01-02T08:00:00.000Z'},root,stock);
  root=CuttingPlan.issue(root,stock,plan);
  function record(id,quantities,materialSelection){
    const cuts=CuttingPlan.buildCuts(root,PLAN,quantities,{id,tanggal:'2026-01-03',tukangId:'synthetic-worker',tarif:5,materialSelection}),next=clone(root.produksi);
    cuts.forEach(({productId,entry})=>next.find(p=>p.id===productId).potong.push(entry));root=CuttingPlan.applyCuts(root,next,stock);
  }
  if(continuation){
    record('synthetic-first-batch',{'synthetic-size-m':4},[{purchaseId:FLEX,kg:flexible?8:2},{purchaseId:FIXED,kg:3}]);
    record('synthetic-second-batch',{'synthetic-size-l':6},[]);
  }else record('synthetic-batch',{'synthetic-size-m':4,'synthetic-size-l':6},[{purchaseId:FLEX,kg:flexible?8:2},{purchaseId:FIXED,kg:3}]);
  return {root,stock};
}
function cost(root,stock){const model=HppModelCost.groupProducts(root)[0];return {fabric:HppModelCost.fabric(model,stock),reference:HppModelCost.reference(model,stock)};}
function assertIncomplete(root,stock){const result=cost(root,stock);assert.equal(result.fabric.complete,false);assert.equal(result.reference.complete,false);assert.ok(result.fabric.warnings.length);}
function setRecordedAmount(root,purchaseId,quantity){
  const plan=root.cuttingPlans[PLAN],consumed=plan.consumedRolls.find(r=>r.purchaseId===purchaseId),name=consumed.jenis;
  consumed.kg=quantity;
  root.produksi.forEach(product=>product.potong.forEach(entry=>{
    const row=entry.rols.find(r=>r.purchaseId===purchaseId);if(!row)return;
    const value=quantity*entry.jumlah/10;row.kg=value;row.kiloan=value;
    entry.bahanList.find(b=>b.jenis===name).kg=value;
    entry.kiloan=entry.rols.filter(r=>(r.unit||'kg')==='kg').reduce((sum,r)=>sum+r.kg,0);
  }));
}

test('completed actual use above the snapshot remains valid for fabric HPP and its reference',()=>{
  const {root,stock}=fixture(),before=clone({root,stock}),result=cost(root,stock);
  assert.equal(root.cuttingPlans[PLAN].rolls[0].kg,2);assert.equal(root.cuttingPlans[PLAN].consumedRolls[0].kg,8);
  for(const calculated of [result.fabric,result.reference]){
    assert.equal(calculated.complete,true,calculated.warnings.join(' '));assert.deepEqual(calculated.warnings,[]);
    assert.equal(calculated.totalCost,950);assert.equal(calculated.totalPcs,10);assert.equal(calculated.perPcs,95);assert.equal(calculated.totalKg,11);
  }
  assert.deepEqual({root,stock},before);
});

test('actual-stock continuation contributes pcs without charging the recorded material again',()=>{
  const {root,stock}=fixture({continuation:true}),result=cost(root,stock);
  assert.equal(result.fabric.complete,true,result.fabric.warnings.join(' '));assert.equal(result.reference.complete,true);
  assert.equal(result.fabric.totalCost,950);assert.equal(result.fabric.totalPcs,10);assert.equal(result.fabric.perPcs,95);
});

test('legacy fixed selected allocations retain their snapshot cap and original costing',()=>{
  const {root,stock}=fixture({flexible:false}),result=cost(root,stock);
  assert.equal(result.fabric.complete,true,result.fabric.warnings.join(' '));assert.equal(result.fabric.totalCost,350);assert.equal(result.fabric.perPcs,35);
  setRecordedAmount(root,FLEX,3);assertIncomplete(root,stock);
});

test('fixed green overconsumption stays incomplete even alongside a valid flexible roll',()=>{
  const {root,stock}=fixture();setRecordedAmount(root,FIXED,4);assertIncomplete(root,stock);
});

test('policy must match between assigned rolls, each result, and consumed totals',()=>{
  for(const mutate of [
    root=>delete root.cuttingPlans[PLAN].rolls[0].quantityPolicy,
    root=>delete root.cuttingPlans[PLAN].consumedRolls[0].quantityPolicy,
    root=>delete root.produksi[0].potong[0].rols[0].quantityPolicy,
    root=>root.cuttingPlans[PLAN].rolls[1].quantityPolicy=POLICY,
    root=>root.cuttingPlans[PLAN].consumedRolls[1].quantityPolicy=POLICY,
    root=>root.produksi[0].potong[0].rols[1].quantityPolicy=POLICY
  ]){
    const {root,stock}=fixture();setRecordedAmount(root,FLEX,1);
    assert.equal(cost(root,stock).fabric.complete,true);
    mutate(root);assertIncomplete(root,stock);
  }
});

test('unknown supplied quantity policies never enable the flexible cap exception',()=>{
  for(const value of ['actual-stock-v2','fixed','',null,true,{}]){
    const {root,stock}=fixture();
    root.cuttingPlans[PLAN].rolls[0].quantityPolicy=value;root.cuttingPlans[PLAN].consumedRolls[0].quantityPolicy=value;
    root.produksi.forEach(product=>product.potong.forEach(entry=>entry.rols[0].quantityPolicy=value));
    assertIncomplete(root,stock);
  }
});

test('unknown policies are rejected even when recorded usage stays below the snapshot',()=>{
  const {root,stock}=fixture({flexible:false});
  root.cuttingPlans[PLAN].rolls[0].quantityPolicy='unknown-policy';root.cuttingPlans[PLAN].consumedRolls[0].quantityPolicy='unknown-policy';
  root.produksi.forEach(product=>product.potong.forEach(entry=>entry.rols[0].quantityPolicy='unknown-policy'));
  assertIncomplete(root,stock);
});

test('flexible policy does not excuse mismatched cumulative amount, purchase identity, or unit',()=>{
  for(const mutate of [
    root=>root.cuttingPlans[PLAN].consumedRolls[0].kg=7,
    root=>root.cuttingPlans[PLAN].consumedRolls[0].purchaseId='synthetic-wrong-roll',
    root=>root.produksi[0].potong[0].rols[0].unit='yard'
  ]){const {root,stock}=fixture();mutate(root);assertIncomplete(root,stock);}
});

test('valid flexible native-unit costs retain yard quantities without adding them to kilograms',()=>{
  const {root,stock}=fixture({unit:'yard'}),result=cost(root,stock);
  assert.equal(result.fabric.complete,true,result.fabric.warnings.join(' '));assert.equal(result.fabric.totalCost,950);assert.equal(result.fabric.totalKg,3);
  const ordinary=result.fabric.details.find(detail=>detail.jenis===ORDINARY);assert.equal(ordinary.unit,'yard');assert.equal(ordinary.qty,8);
});
