'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const CuttingPlan=require('../cutting-plan.js'),ProductionMaterials=require('../production-materials.js');
const source=fs.readFileSync(path.join(__dirname,'../cutting-plan-worker.js'),'utf8');
const FLEX='synthetic-flex-roll',FIXED='synthetic-fixed-roll',PLAN='synthetic-plan',PRODUCT='synthetic-size-m',ORDINARY='Synthetic ordinary',GREEN='Synthetic green';

// Execute the complete, unmodified worker and the real material engine. The DOM,
// sync status, and confirm dialog are local doubles; no storage/network is used.
function harness({unit='kg',fixedAvailable=10}={}){
  const root={produksi:[{id:PRODUCT,series:'Synthetic series',namaBarang:'Synthetic garment',size:'M',poAktif:true,potong:[],arsip:[]},{id:'synthetic-size-l',series:'Synthetic series',namaBarang:'Synthetic garment',size:'L',poAktif:true,potong:[],arsip:[]}],cuttingPlans:{}};
  const stock={settings:{resetDate:'2026-01-01'},pembelian:[
    {id:FLEX,jenisBahan:ORDINARY,kg:20,unit,rolInfoId:'synthetic-flex-detail',rolNum:'F-1',tanggal:'2026-01-01'},
    {id:FIXED,jenisBahan:GREEN,kg:10,unit:'kg',rolInfoId:'synthetic-fixed-detail',rolNum:'G-1',tanggal:'2026-01-01'}
  ],rolInfo:{
    [ORDINARY.toLowerCase()]:{unit,rols:[{id:'synthetic-flex-detail',val:20}]},
    [GREEN.toLowerCase()]:{unit:'kg',rols:[{id:'synthetic-fixed-detail',val:10}]}
  },adjustment:[]};
  const plan=CuttingPlan.makePlan({id:PLAN,productIds:root.produksi.map(p=>p.id),rolls:[{purchaseId:FLEX,kg:2,quantityPolicy:'actual-stock-v1'},{purchaseId:FIXED,kg:3}],createdAt:'2026-01-02T08:00:00.000Z'},root,stock);
  const issued=CuttingPlan.issue(root,stock,plan);
  if(fixedAvailable!==10)stock.rolInfo[GREEN.toLowerCase()].rols[0].val=fixedAvailable;
  const nodes=new Map(),outputs=[],builds=[],confirmations=[],events=[];
  const node=id=>{
    if(id==='tab-setup')return null;
    if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',textContent:'',disabled:false,hidden:false,open:false,dataset:{},listeners:{},addEventListener(event,handler){this.listeners[event]=handler;},focus(){},scrollIntoView(){}});
    return nodes.get(id);
  };
  const document={getElementById:node,querySelectorAll:selector=>selector==='.cutting-result-qty'?outputs:[]};
  const engine={...CuttingPlan,buildCuts(...args){const result=CuttingPlan.buildCuts(...args);builds.push({args,result});return result;}};
  const context={document,CuttingPlan:engine,ProductionMaterials,CUTTING_ROOT:issued,STOK_MIRROR:stock,DB_PRODUKSI:issued.produksi,
    META:{tukang:[{id:'synthetic-worker',nama:'Synthetic worker'}]},FB:{connected:true},firebaseSyncReady:true,potongReadErrors:{},
    potongJournal:{status:()=>({baseKnown:true,durable:true,pending:false})},
    esc:value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
    today:()=> '2026-01-03',getProductImage:()=>'',OFFLINE_ORDER_IMAGES:{},getTarif:()=>5,uid:()=> 'synthetic-batch',
    confirm:value=>{confirmations.push(value);return false;},updateSyncTag:()=>events.push('sync-tag'),addEventListener(){}};
  context.window=context;vm.createContext(context);vm.runInContext(source,context,{filename:'cutting-plan-worker.js'});
  node('cuttingPlanSelect').value=CuttingPlan.uncutPOs(issued)[0].id;
  context.renderCuttingWorker();
  outputs.push({dataset:{productId:PRODUCT},value:'4'},{dataset:{productId:'synthetic-size-l'},value:'0'});
  return {context,stock,root:issued,node,builds,confirmations,events,
    select:(id,checked=true)=>context.changeAssignedCuttingRoll(id,checked),
    enter:(id,value)=>context.updateAssignedCuttingRoll(id,value),
    render:()=>context.renderCuttingWorker(),save:()=>context.saveAssignedCuttingPlan()};
}
function quantityInput(run,id){
  const input=run.node('cuttingPlanSummary').innerHTML.match(new RegExp('<input[^>]*data-cutting-use-qty="'+id+'"[^>]*>'));
  assert.ok(input,'The selected roll has an actual quantity input');
  return Object.fromEntries(Array.from(input[0].matchAll(/([\w-]+)="([^"]*)"/g),match=>[match[1],match[2]]));
}
function selection(run){return JSON.parse(JSON.stringify(run.builds.at(-1).args[3].materialSelection));}

test('initial rendering selects no rolls and a checked flexible roll requires an empty actual quantity',async()=>{
  const run=harness();
  assert.equal(run.node('cuttingPlanSummary').innerHTML.includes('data-cutting-use-qty='),false);
  assert.equal(run.node('cuttingWorkerSave').disabled,true);
  run.select(FLEX);
  const input=quantityInput(run,FLEX);assert.equal(input.value,'');assert.equal(input.max,'20');
  assert.equal(run.node('cuttingWorkerSave').disabled,true);assert.match(run.node('cuttingWorkerMessage').textContent,/lebih dari nol/);
  await run.save();assert.equal(run.builds.length,0);assert.equal(run.confirmations.length,0);
});

test('manual flexible quantity above the old snapshot enables saving and sends exactly the actual selection',async()=>{
  const run=harness();run.select(FLEX);run.enter(FLEX,'8.25');
  assert.equal(run.node('cuttingWorkerSave').disabled,false);assert.equal(run.node('cuttingWorkerMessage').textContent,'');
  assert.match(run.node('cuttingSelectedMaterialTotal').textContent,/8,25 kg/);
  await run.save();
  assert.deepEqual(selection(run),[{purchaseId:FLEX,kg:8.25}]);
  assert.equal(run.builds[0].result[0].entry.rols[0].kg,8.25);assert.equal(run.builds[0].result[0].entry.kiloan,8.25);
  assert.match(run.confirmations[0],/8,25 kg/);assert.equal(run.root.produksi[0].potong.length,0);
});

test('blank, zero, negative, nonfinite, and over-stock actual quantities cannot reach confirmation',async()=>{
  for(const value of ['', '0', '-1', 'Infinity', 'not-a-number', '20.000001']){
    const run=harness();run.select(FLEX);run.enter(FLEX,value);
    assert.equal(run.node('cuttingWorkerSave').disabled,true,value);assert.notEqual(run.node('cuttingWorkerMessage').textContent,'',value);
    await run.save();assert.equal(run.builds.length,0,value);assert.equal(run.confirmations.length,0,value);
  }
});

test('fixed green keeps its prefilled quota and cannot use more than the remaining fixed allowance',async()=>{
  const run=harness();run.select(FIXED);
  const input=quantityInput(run,FIXED);assert.equal(input.value,'3');assert.equal(input.max,'3');assert.equal(run.node('cuttingWorkerSave').disabled,false);
  await run.save();assert.deepEqual(selection(run),[{purchaseId:FIXED,kg:3}]);
  run.enter(FIXED,'3.1');assert.equal(run.node('cuttingWorkerSave').disabled,true);assert.match(run.node('cuttingWorkerMessage').textContent,/melebihi sisa/);
  await run.save();assert.equal(run.builds.length,1);assert.equal(run.confirmations.length,1);
});

test('fixed prefill follows reduced real availability and never exceeds its existing quota',()=>{
  const run=harness({fixedAvailable:1.5});run.select(FIXED);
  assert.equal(quantityInput(run,FIXED).value,'1.5');assert.equal(quantityInput(run,FIXED).max,'1.5');
  assert.equal(run.node('cuttingWorkerSave').disabled,false);
});

test('a blank flexible selection blocks saving even when another selected fixed roll is valid',async()=>{
  const run=harness();run.select(FIXED);run.select(FLEX);
  assert.equal(run.node('cuttingWorkerSave').disabled,true);assert.equal(quantityInput(run,FLEX).value,'');assert.equal(quantityInput(run,FIXED).value,'3');
  await run.save();assert.equal(run.builds.length,0);
  run.enter(FLEX,'8');await run.save();
  assert.deepEqual(selection(run),[{purchaseId:FIXED,kg:3},{purchaseId:FLEX,kg:8}]);
});

test('unchecking and rechecking flexible material preserves a manually entered quantity without substituting stock',()=>{
  const run=harness();run.select(FLEX);run.enter(FLEX,'7.5');run.select(FLEX,false);
  assert.equal(run.node('cuttingWorkerSave').disabled,true);
  run.select(FLEX);assert.equal(quantityInput(run,FLEX).value,'7.5');assert.equal(run.node('cuttingWorkerSave').disabled,false);
});

test('new stock data preserves typed actual quantity, requires review, and rejects the newly excessive amount',async()=>{
  const run=harness();run.select(FLEX);run.enter(FLEX,'8');
  run.stock.pembelian.find(p=>p.id===FLEX).kg=5;run.stock.rolInfo[ORDINARY.toLowerCase()].rols[0].val=5;
  run.render();assert.equal(run.node('cuttingWorkerSave').disabled,true);assert.match(run.node('cuttingWorkerMessage').textContent,/berubah/);
  run.context.reviewCuttingWorkerData();
  const input=quantityInput(run,FLEX);assert.equal(input.value,'8');assert.equal(input.max,'5');
  assert.equal(run.node('cuttingWorkerSave').disabled,true);assert.match(run.node('cuttingWorkerMessage').textContent,/melebihi sisa/);
  await run.save();assert.equal(run.builds.length,0);
  run.enter(FLEX,'4');await run.save();assert.deepEqual(selection(run),[{purchaseId:FLEX,kg:4}]);
});

test('the delegated input event uses the same actual-quantity validation and totals',()=>{
  const run=harness();run.select(FLEX);
  const target={dataset:{cuttingUseQty:FLEX},value:'6.25',closest:selector=>selector==='[data-cutting-use-qty]'?target:null};
  run.node('cuttingPlanSummary').listeners.input({target});
  assert.equal(run.node('cuttingWorkerSave').disabled,false);assert.match(run.node('cuttingSelectedMaterialTotal').textContent,/6,25 kg/);
});

test('native yard amounts retain their unit in the quantity control, confirmation, and recorded result',async()=>{
  const run=harness({unit:'yard'});run.select(FLEX);run.enter(FLEX,'8');
  assert.match(run.node('cuttingPlanSummary').innerHTML,/Dipakai untuk hasil ini \(yd\)/);
  await run.save();assert.match(run.confirmations[0],/8 yd/);
  assert.equal(run.builds[0].result[0].entry.rols[0].unit,'yard');assert.equal(run.builds[0].result[0].entry.kiloan,0);
});
