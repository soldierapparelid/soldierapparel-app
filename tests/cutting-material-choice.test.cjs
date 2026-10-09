'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../cutting-plan-worker.js'),'utf8');
const from=source.indexOf('  function uncutPOs(source){'),to=source.indexOf('  function captureDraft(){',from);
assert.ok(from>=0&&to>from,'Read the actual worker helpers and getContext from source');
const workerFunctions=source.slice(from,to);
const clone=value=>structuredClone(value);
const rows=value=>Array.isArray(value)?value:Object.values(value||{});
const available=(remaining=4,stock=remaining,unit='kg')=>({mode:'partial',canContinueWithoutMaterial:false,rolls:[{purchaseId:'synthetic-roll',remaining,available:stock,unit}]});
const unavailable=()=>available(4,0);

// Only synthetic backend responses are supplied; the worker's choice and context
// functions run directly from source, including readyPlans and groupSignature.
function harness(materials,{rootMismatch=false}={}){
  const group={id:'synthetic-po',products:[{id:'synthetic-size-m',series:'Synthetic series',namaBarang:'Synthetic item',size:'M',cycle:1},{id:'synthetic-size-l',series:'Synthetic series',namaBarang:'Synthetic item',size:'L',cycle:1}]};
  const rootGroup=clone(group);if(rootMismatch)rootGroup.products[0].size='XL';
  const plans=Object.keys(materials).map(id=>({id,status:'ready',poId:group.id,productIds:group.products.map(p=>p.id),rolls:[{purchaseId:'synthetic-roll-'+id,kg:4,unit:'kg'}]}));
  const root={groups:[rootGroup],plans},stock={materials},reads=[];
  const CuttingPlan={
    uncutPOs:data=>data.groups,
    plans:data=>data.plans,
    cycle:product=>product.cycle,
    matchesPlan:(candidate,plan)=>candidate.id===plan.poId,
    remainingPlanProducts:(data,plan)=>data.groups.flatMap(candidate=>candidate.products).filter(product=>plan.productIds.includes(product.id)),
    materialChoices:(data,mirror,id)=>{reads.push(id);const material=mirror.materials[id];if(material instanceof Error)throw material;return material;}
  };
  const context={window:{CuttingPlan},CuttingPlan,CUTTING_ROOT:root,STOK_MIRROR:stock,rows};
  vm.createContext(context);vm.runInContext(workerFunctions,context,{filename:'cutting-plan-worker.js'});
  return {group,root,stock,plans,reads,get:(preferred,allowAuto)=>context.getContext(group,preferred,allowAuto),getEmpty:()=>context.getContext(undefined,'')};
}

test('two ready allowances for the same PO select the only allowance with usable stock',()=>{
  const run=harness({'synthetic-old':unavailable(),'synthetic-current':available()}),context=run.get('');
  assert.equal(context.plan.id,'synthetic-current');
  assert.equal(context.material,run.stock.materials['synthetic-current']);
  assert.equal(context.materialError,'');
  assert.deepEqual(Array.from(context.choices,plan=>plan.id),['synthetic-old','synthetic-current']);
  assert.deepEqual(Array.from(context.choiceStates,state=>[state.plan.id,state.usable]),[['synthetic-old',false],['synthetic-current',true]]);
});

test('an explicitly selected allowance is preserved when its stock is unavailable or its data fails',()=>{
  for(const old of [unavailable(),new Error('Synthetic invalid purchase link')]){
    const run=harness({'synthetic-old':old,'synthetic-current':available()}),context=run.get('synthetic-old');
    assert.equal(context.plan.id,'synthetic-old');
    assert.equal(context.choiceStates.find(state=>state.plan.id==='synthetic-old').usable,false);
    if(old instanceof Error){assert.equal(context.material,null);assert.equal(context.materialError,old.message);}
    else {assert.equal(context.material,old);assert.equal(context.materialError,'');}
  }
});

test('multiple usable allowances require a choice, and an existing valid choice is retained',()=>{
  const run=harness({'synthetic-first':available(),'synthetic-second':available(3)});
  assert.equal(run.get('').plan==null,true);
  assert.equal(run.get('synthetic-second').plan.id,'synthetic-second');
  assert.equal(run.get('synthetic-first').plan.id,'synthetic-first');
});

test('a removed prior choice is not replaced automatically by another usable allowance',()=>{
  const run=harness({'synthetic-current':available()}),context=run.get('synthetic-removed');
  assert.equal(context.plan==null,true);assert.equal(context.material,null);
  assert.equal(context.choiceStates[0].usable,true);
});

test('drafts that prohibit automatic selection remain unselected while explicit choices still work',()=>{
  const run=harness({'synthetic-old':unavailable(),'synthetic-current':available()});
  assert.equal(run.get('',false).plan==null,true);
  assert.equal(run.get('synthetic-current',false).plan.id,'synthetic-current');
  assert.equal(run.get('synthetic-old',false).plan.id,'synthetic-old');
});

test('zero usable allowances do not auto-select an unavailable sole allowance or any of several',()=>{
  for(const materials of [{'synthetic-only':unavailable()},{'synthetic-first':unavailable(),'synthetic-second':available(0,5)}]){
    const context=harness(materials).get('');
    assert.equal(context.plan==null,true);assert.equal(context.material,null);
    assert.equal(context.choiceStates.some(state=>state.usable),false);
  }
  assert.equal(harness({'synthetic-only':available()}).get('').plan.id,'synthetic-only');
});

test('legacy and recorded-material continuation remain selectable without new stock',()=>{
  for(const material of [{mode:'legacy',rolls:[]},{mode:'partial',canContinueWithoutMaterial:true,recorded:true,rolls:[]}]){
    const run=harness({'synthetic-old':unavailable(),'synthetic-continuation':material}),context=run.get('');
    assert.equal(context.plan.id,'synthetic-continuation');assert.equal(context.material,material);
    assert.equal(context.choiceStates[1].usable,true);
  }
});

test('usability accepts one partially available roll and mixed units without combining quantities',()=>{
  const material={mode:'partial',rolls:[
    {purchaseId:'synthetic-kg-unavailable',remaining:12,available:0,unit:'kg'},
    {purchaseId:'synthetic-yard-usable',remaining:'9',available:'0.5',unit:'yard'},
    {purchaseId:'synthetic-meter-used',remaining:0,available:30,unit:'meter'}
  ]};
  const context=harness({'synthetic-old':unavailable(),'synthetic-partial':material}).get('');
  assert.equal(context.plan.id,'synthetic-partial');assert.equal(context.material,material);
  assert.equal(context.material.rolls[1].available,'0.5');
});

test('remaining allowance and available stock must both be positive on the same roll',()=>{
  const cases=[{rolls:[{remaining:5,available:0},{remaining:0,available:5}]},available(-1,5),available(5,-1),available(5,'invalid'),available('invalid',5),available(Infinity,5),available(5,Infinity),{rolls:[]}];
  for(const material of cases){
    const context=harness({'synthetic-invalid':material}).get('');
    assert.equal(context.plan==null,true);assert.equal(context.choiceStates[0].usable,false);
  }
});

test('one allowance data error does not hide a usable allowance, and all errors remain unselected',()=>{
  const failure=new Error('Synthetic invalid purchase link'),run=harness({'synthetic-broken':failure,'synthetic-valid':available()}),context=run.get('');
  assert.equal(context.plan.id,'synthetic-valid');assert.equal(context.materialError,'');
  assert.equal(context.choiceStates[0].material,null);assert.equal(context.choiceStates[0].materialError,failure.message);assert.equal(context.choiceStates[0].usable,false);
  const onlyBroken=harness({'synthetic-broken':failure}).get('');assert.equal(onlyBroken.plan==null,true);assert.equal(onlyBroken.choiceStates[0].materialError,failure.message);
});

test('context inspection preserves all allowance, PO, and stock data',()=>{
  const run=harness({'synthetic-old':unavailable(),'synthetic-current':available()}),before=clone({group:run.group,root:run.root,stock:run.stock});
  run.get('');run.get('synthetic-old');run.get('synthetic-current');
  assert.deepEqual({group:run.group,root:run.root,stock:run.stock},before);
});

test('root mismatch and material signature still detect data changes for draft review',()=>{
  const run=harness({'synthetic-only':available()}),first=run.get('');
  assert.equal(first.rootMismatch,false);assert.equal(first.signature,run.get('').signature);
  run.stock.materials['synthetic-only'].rolls[0].available=2;
  assert.notEqual(first.signature,run.get('').signature);
  assert.equal(harness({'synthetic-only':available()},{rootMismatch:true}).get('').rootMismatch,true);
  const empty=run.getEmpty();assert.equal(empty.signature,'');assert.equal(empty.rootMismatch,false);assert.equal(empty.choices.length,0);assert.equal(empty.plan==null,true);
});
