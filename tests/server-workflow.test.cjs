'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Authority=require('../server/production-authority.cjs'),Workflow=require('../production-workflow.js'),Codec=require('../operations-codec.js');
const now='2026-10-05T03:00:00.000Z',date='2026-10-05';
const workers=[{id:'synthetic-worker',nama:'Synthetic partner'}];
function projected(quantity){
  let state=Authority.createAuthority({product:{id:'synthetic-product',series:'Synthetic',namaBarang:'Example',size:'M',cutQuantity:10},cycleId:'synthetic-cycle',workers,assignments:[{id:'synthetic-assignment',workerId:workers[0].id,qty:quantity}],now});
  const command=(kind,payload)=>({productId:state.productId,cycleId:state.cycleId,expectedRevision:state.revision,requestId:'synthetic-request-'+state.revision,kind,payload});
  const context={uid:'synthetic-user',emailVerified:true,provider:'google.com',profile:{active:true,owner:true},now};
  state=Authority.applyCommand(state,context,command('sewing',{id:'synthetic-sewing',assignmentId:'synthetic-assignment',tanggal:date,good:quantity,reject:0})).state;
  const tariff={source:'private-verified-tariff',verified:true,workerId:workers[0].id,productId:state.productId,cycleId:state.cycleId,countId:'synthetic-count',workDate:date,basisAt:now,effectiveAt:'2026-01-01T00:00:00.000Z',tariffVersion:'synthetic-v1',currency:'IDR',rate:100,selectedAt:now};
  state=Authority.applyCommand(state,{...context,selectedTariffs:{'synthetic-count':tariff}},command('count',{id:'synthetic-count',assignmentId:'synthetic-assignment',tanggal:date,jumlah:quantity})).state;
  return {state,operations:Authority.project(state).operations};
}
test('server projection retains real cutting capacity through codec and workflow when assignments cover only part',()=>{
  const {state,operations}=projected(5),map=Codec.encode([operations]),product=Codec.decode(map)[0],status=Workflow.inspect(product,workers);
  assert.equal(product.cutQuantity,10);assert.equal(product.potong,undefined,'No fake cutting receipt');
  assert.equal(status.target,10);assert.equal(status.remainingPO,5);assert.equal(status.readyForQC,false);assert.equal(status.targetSource,'cutQuantity');
  const command={productId:state.productId,cycleId:state.cycleId,requestId:'synthetic-qc-request',expectedRevision:state.revision,kind:'inspect',payload:{batchId:'synthetic-batch',entries:[{id:'synthetic-qc',hfId:'synthetic-count',tanggal:date,ok:5,perbaikan:0,reject:0,offline:0}]}};
  assert.throws(()=>Authority.applyCommand(state,{uid:'synthetic-owner',emailVerified:true,provider:'google.com',profile:{active:true,owner:true},now},command),error=>error.code==='workflow_not_ready');
});
test('full reviewed server capacity agrees with workflow readiness and survives operational encode/decode',()=>{
  const {operations}=projected(10),product=Codec.decode(Codec.encode([operations]))[0],status=Workflow.inspect(product,workers);
  assert.equal(status.target,10);assert.equal(status.readyForQC,true);assert.equal(status.needsReview,false);
});
test('actual cutting receipts that conflict with projected capacity require review without changing either source',()=>{
  const {operations}=projected(10),product={...operations,potong:[{id:'synthetic-cut',jumlah:7}]},before=JSON.stringify(product),status=Workflow.inspect(product,workers);
  assert.equal(status.readyForQC,false);assert.equal(status.needsReview,true);assert.ok(status.reasons.includes('cut-quantity-mismatch'));assert.equal(JSON.stringify(product),before);
});
test('invalid explicit capacity does not fall back to assignment readiness or run a getter',()=>{
  const {operations}=projected(10);
  for(const cutQuantity of [0,-1,1.5,'10',null]){const status=Workflow.inspect({...operations,cutQuantity},workers);assert.equal(status.readyForQC,false);assert.ok(status.reasons.includes('invalid-cut-quantity'));}
  let calls=0;const product={...operations};Object.defineProperty(product,'cutQuantity',{enumerable:true,get(){calls++;return 10;}});
  assert.equal(Workflow.inspect(product,workers).readyForQC,false);assert.equal(calls,0);
});
test('legacy products without the new capacity keep their previous cutting and assignment behavior',()=>{
  const {operations}=projected(10),legacy={...operations};delete legacy.cutQuantity;
  assert.equal(Workflow.inspect(legacy,workers).readyForQC,true);assert.equal(Workflow.inspect(legacy,workers).targetSource,'assignJahit');
  legacy.potong=[{id:'synthetic-cut',jumlah:12}];assert.equal(Workflow.inspect(legacy,workers).readyForQC,false);assert.equal(Workflow.inspect(legacy,workers).target,12);
});
