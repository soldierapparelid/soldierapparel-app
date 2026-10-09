'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const CuttingPlan=require('../cutting-plan.js');
const clone=value=>structuredClone(value);
const POLICY='actual-stock-v1',ORDINARY='Synthetic Malvinas ordinary',GREEN='Synthetic green';
const M='synthetic-size-m',L='synthetic-size-l',XL='synthetic-size-xl',OTHER='synthetic-other-size';
const ORDINARY_ROLL='synthetic-ordinary-roll',GREEN_ROLL='synthetic-green-roll',PLAN='synthetic-mixed-plan';
const CREATED='2026-01-02T08:00:00.000Z';

function fixture(){
  const product=(id,size,item='Synthetic garment')=>({id,series:'Synthetic series',namaBarang:item,size,poAktif:true,potong:[],arsip:[],unrelatedMetadata:{preserve:true}});
  const root={produksi:[product(M,'M'),product(L,'L'),product(XL,'XL'),product(OTHER,'M','Synthetic other garment')],cuttingPlans:{},unrelatedRoot:{preserve:true}};
  const stock={settings:{resetDate:'2026-01-01'},pembelian:[
    {id:ORDINARY_ROLL,jenisBahan:ORDINARY,kg:20,unit:'kg',rolInfoId:'synthetic-ordinary-detail',rolNum:'O-1',tanggal:'2026-01-01'},
    {id:GREEN_ROLL,jenisBahan:GREEN,kg:10,unit:'kg',rolInfoId:'synthetic-green-detail',rolNum:'G-1',tanggal:'2026-01-01'}
  ],rolInfo:{
    [ORDINARY.toLowerCase()]:{unit:'kg',rols:[{id:'synthetic-ordinary-detail',val:20}]},
    [GREEN.toLowerCase()]:{unit:'kg',rols:[{id:'synthetic-green-detail',val:10}]}
  },adjustment:[]};
  return {root,stock};
}
function create(root,stock,{id=PLAN,productIds=[M,L,XL],rolls=[{purchaseId:ORDINARY_ROLL,kg:2,quantityPolicy:POLICY},{purchaseId:GREEN_ROLL,kg:3}]}={}){
  return CuttingPlan.makePlan({id,productIds,rolls,note:'Synthetic allowance',createdAt:CREATED},root,stock);
}
function issued(options){const {root,stock}=fixture(),plan=create(root,stock,options);return {root:CuttingPlan.issue(root,stock,plan),stock,plan};}
function build(root,selection,{quantities={[M]:10},id='synthetic-batch-one',planId=PLAN}={}){
  const meta={id,tanggal:'2026-01-03',tukangId:'synthetic-worker',tukangNama:'Synthetic worker',tarif:5};
  if(selection!==undefined)meta.materialSelection=selection;
  return CuttingPlan.buildCuts(root,planId,quantities,meta);
}
function nextProducts(root,cuts){const next=clone(root.produksi);for(const cut of cuts)next.find(product=>product.id===cut.productId).potong.push(clone(cut.entry));return next;}
function commit(root,stock,selection,options){return CuttingPlan.applyCuts(root,nextProducts(root,build(root,selection,options)),stock);}
const selected=(ordinary,green)=>[...(ordinary==null?[]:[{purchaseId:ORDINARY_ROLL,kg:ordinary}]),...(green==null?[]:[{purchaseId:GREEN_ROLL,kg:green}])];
const roll=(choices,purchaseId)=>choices.rolls.find(value=>value.purchaseId===purchaseId);
function rejectsWithoutMutation(root,stock,operation){const before=clone({root,stock});assert.throws(operation);assert.deepEqual({root,stock},before);}

test('makePlan and issue preserve explicit per-roll policy while fixed green remains fixed',()=>{
  const {root,stock}=fixture(),before=clone({root,stock}),plan=create(root,stock);
  assert.equal(plan.rolls[0].quantityPolicy,POLICY);assert.equal(plan.rolls[0].kg,2);
  assert.equal(Object.hasOwn(plan.rolls[1],'quantityPolicy'),false);assert.equal(plan.rolls[1].kg,3);
  const out=CuttingPlan.issue(root,stock,plan);
  assert.deepEqual(out.cuttingPlans[PLAN],plan);assert.deepEqual({root,stock},before);
  const choices=CuttingPlan.materialChoices(out,stock,PLAN);
  assert.equal(roll(choices,ORDINARY_ROLL).assigned,2);assert.equal(roll(choices,ORDINARY_ROLL).remaining,20);assert.equal(roll(choices,ORDINARY_ROLL).available,20);
  assert.equal(roll(choices,GREEN_ROLL).remaining,3);assert.equal(roll(choices,GREEN_ROLL).available,3);
});

test('flexible rolls do not reserve the snapshot quantity; fixed rolls reserve their quota',()=>{
  const {root,stock}=issued(),availability=CuttingPlan.availability(root,stock);
  const ordinary=roll(availability,ORDINARY_ROLL),green=roll(availability,GREEN_ROLL);
  assert.equal(ordinary.reserved,0);assert.equal(ordinary.available,20);
  assert.equal(availability.materials[ORDINARY.toLowerCase()].reserved,0);
  assert.equal(green.reserved,3);assert.equal(green.available,7);
  assert.equal(availability.materials[GREEN.toLowerCase()].reserved,3);
});

test('other PO fixed reservations reduce flexible capacity and remain protected during apply',()=>{
  let {root,stock}=issued();
  const other=create(root,stock,{id:'synthetic-other-plan',productIds:[OTHER],rolls:[{purchaseId:ORDINARY_ROLL,kg:6}]});
  root=CuttingPlan.issue(root,stock,other);
  assert.equal(roll(CuttingPlan.materialChoices(root,stock,PLAN),ORDINARY_ROLL).available,14);
  const tooMuch=nextProducts(root,build(root,selected(15)));
  rejectsWithoutMutation(root,stock,()=>CuttingPlan.applyCuts(root,tooMuch,stock));
  const out=commit(root,stock,selected(14));
  assert.deepEqual(out.cuttingPlans['synthetic-other-plan'],other);
  assert.equal(roll(CuttingPlan.availability(out,stock),ORDINARY_ROLL).reserved,6);
  assert.equal(roll(CuttingPlan.materialChoices(out,stock,PLAN),ORDINARY_ROLL).available,0);
});

test('actual use may exceed the snapshot and is recorded once with consistent ledger totals',()=>{
  const {root,stock}=issued(),before=clone({root,stock}),cuts=build(root,selected(8,1)),out=CuttingPlan.applyCuts(root,nextProducts(root,cuts),stock),plan=out.cuttingPlans[PLAN];
  assert.equal(cuts[0].entry.kiloan,9);assert.equal(cuts[0].entry.rols[0].kg,8);assert.equal(cuts[0].entry.rols[0].kiloan,8);assert.equal(cuts[0].entry.rols[0].quantityPolicy,POLICY);
  assert.equal(plan.status,'in_progress');assert.equal(plan.materialMode,'per-result-v1');
  assert.equal(plan.rolls[0].kg,2);assert.equal(plan.consumedRolls.find(r=>r.purchaseId===ORDINARY_ROLL).kg,8);assert.equal(plan.consumedRolls.find(r=>r.purchaseId===GREEN_ROLL).kg,1);
  const choices=CuttingPlan.materialChoices(out,stock,PLAN);
  assert.equal(roll(choices,ORDINARY_ROLL).used,8);assert.equal(roll(choices,ORDINARY_ROLL).remaining,12);assert.equal(roll(choices,ORDINARY_ROLL).available,12);
  assert.equal(roll(choices,GREEN_ROLL).remaining,2);assert.equal(roll(CuttingPlan.availability(out,stock),GREEN_ROLL).reserved,2);
  assert.equal(CuttingPlan.availability(out,stock).materials[ORDINARY.toLowerCase()].stock,12);
  assert.deepEqual({root,stock},before);
});

test('later sizes accept additional actual material and retain cumulative totals above snapshot',()=>{
  let {root,stock}=issued();root=commit(root,stock,selected(8,1));
  const out=commit(root,stock,selected(4,1),{quantities:{[L]:6},id:'synthetic-batch-two'}),plan=out.cuttingPlans[PLAN];
  assert.equal(plan.consumedRolls.find(r=>r.purchaseId===ORDINARY_ROLL).kg,12);assert.equal(plan.consumedRolls.find(r=>r.purchaseId===GREEN_ROLL).kg,2);
  assert.equal(roll(CuttingPlan.materialChoices(out,stock,PLAN),ORDINARY_ROLL).available,8);
  assert.equal(roll(CuttingPlan.materialChoices(out,stock,PLAN),GREEN_ROLL).remaining,1);
  assert.equal(out.produksi.find(product=>product.id===M).potong[0].rols[0].kg,8);
  assert.equal(out.produksi.find(product=>product.id===L).potong[0].rols[0].kg,4);
});

test('later size continuation without additional material preserves consumption and stock',()=>{
  let {root,stock}=issued();root=commit(root,stock,selected(8,1));
  const before=clone(root.cuttingPlans[PLAN].consumedRolls),out=commit(root,stock,[],{quantities:{[L]:4},id:'synthetic-continuation'});
  const entry=out.produksi.find(product=>product.id===L).potong[0];
  assert.equal(entry.kiloan,0);assert.deepEqual(entry.rols,[]);assert.deepEqual(entry.bahanList,[]);
  assert.deepEqual(out.cuttingPlans[PLAN].consumedRolls,before);
  assert.equal(CuttingPlan.availability(out,stock).materials[ORDINARY.toLowerCase()].stock,12);
  assert.equal(CuttingPlan.materialChoices(out,stock,PLAN).canContinueWithoutMaterial,true);
});

test('flexible cumulative consumption is bounded by latest stock while fixed cumulative use is bounded by quota',()=>{
  let {root,stock}=issued();root=commit(root,stock,selected(8,1));
  const excessiveActual=nextProducts(root,build(root,selected(13),{quantities:{[L]:5},id:'synthetic-excess'}));
  rejectsWithoutMutation(root,stock,()=>CuttingPlan.applyCuts(root,excessiveActual,stock));
  rejectsWithoutMutation(root,stock,()=>build(root,selected(null,2.1),{quantities:{[L]:5},id:'synthetic-fixed-excess'}));
  const out=commit(root,stock,selected(12,2),{quantities:{[L]:5},id:'synthetic-exact-remainder'});
  assert.equal(roll(CuttingPlan.materialChoices(out,stock,PLAN),ORDINARY_ROLL).available,0);
  assert.equal(roll(CuttingPlan.materialChoices(out,stock,PLAN),GREEN_ROLL).remaining,0);
});

test('apply rejects two flexible selections that jointly consume material reserved for another PO',()=>{
  const {root:initial,stock}=fixture();
  stock.pembelian=stock.pembelian.filter(p=>p.id!==ORDINARY_ROLL);
  stock.pembelian.push(...[['synthetic-reserved-old',8,'2026-01-01'],['synthetic-flex-a',10,'2026-01-02'],['synthetic-flex-b',10,'2026-01-03']].map(([id,kg,tanggal])=>({id,kg,tanggal,jenisBahan:ORDINARY,unit:'kg',rolInfoId:id+'-detail',rolNum:id})));
  stock.rolInfo[ORDINARY.toLowerCase()].rols=stock.pembelian.filter(p=>p.jenisBahan===ORDINARY).map(p=>({id:p.rolInfoId,val:p.kg}));
  let root=CuttingPlan.issue(initial,stock,create(initial,stock,{id:'synthetic-reserved-plan',productIds:[OTHER],rolls:[{purchaseId:'synthetic-reserved-old',kg:6}]}));
  root=CuttingPlan.issue(root,stock,create(root,stock,{rolls:[{purchaseId:'synthetic-flex-a',kg:1,quantityPolicy:POLICY},{purchaseId:'synthetic-flex-b',kg:1,quantityPolicy:POLICY}]}));
  // A newer stock debit exhausts the older reserved roll. Its PO reservation
  // still protects six units of material even though two newer rolls remain.
  stock.adjustment.push({id:'synthetic-debit',jenisBahan:ORDINARY,kg:-8});
  const choices=CuttingPlan.materialChoices(root,stock,PLAN);
  assert.equal(roll(choices,'synthetic-flex-a').available,10);assert.equal(roll(choices,'synthetic-flex-b').available,10);
  assert.equal(CuttingPlan.availability(root,stock).materials[ORDINARY.toLowerCase()].available,14);
  const next=nextProducts(root,build(root,[{purchaseId:'synthetic-flex-a',kg:8},{purchaseId:'synthetic-flex-b',kg:8}]));
  rejectsWithoutMutation(root,stock,()=>CuttingPlan.applyCuts(root,next,stock));
});

test('re-running the same candidate against changed transaction stock rejects stale actual quantities',()=>{
  const {root,stock}=issued(),next=nextProducts(root,build(root,selected(12)));
  assert.doesNotThrow(()=>CuttingPlan.applyCuts(root,next,stock));
  const latest=clone(stock);latest.pembelian.find(p=>p.id===ORDINARY_ROLL).kg=9;latest.rolInfo[ORDINARY.toLowerCase()].rols[0].val=9;
  assert.equal(roll(CuttingPlan.materialChoices(root,latest,PLAN),ORDINARY_ROLL).available,9);
  rejectsWithoutMutation(root,latest,()=>CuttingPlan.applyCuts(root,next,latest));
});

test('one transaction cannot overdraw a shared roll through two unreserved plans for different POs',()=>{
  let {root,stock}=issued({rolls:[{purchaseId:ORDINARY_ROLL,kg:2,quantityPolicy:POLICY}]});
  root=CuttingPlan.issue(root,stock,create(root,stock,{id:'synthetic-second-flex-plan',productIds:[OTHER],rolls:[{purchaseId:ORDINARY_ROLL,kg:2,quantityPolicy:POLICY}]}));
  const first=build(root,selected(12)),second=build(root,selected(12),{quantities:{[OTHER]:3},planId:'synthetic-second-flex-plan',id:'synthetic-second-po-batch'});
  assert.doesNotThrow(()=>CuttingPlan.applyCuts(root,nextProducts(root,first),stock));
  assert.doesNotThrow(()=>CuttingPlan.applyCuts(root,nextProducts(root,second),stock));
  rejectsWithoutMutation(root,stock,()=>CuttingPlan.applyCuts(root,nextProducts(root,[...first,...second]),stock));
});

test('one transaction preserves aggregate material reservations across flexible plans on different rolls',()=>{
  const {root:initial,stock}=fixture(),thirdProduct='synthetic-reserved-po-size';
  initial.produksi.push({...clone(initial.produksi.find(p=>p.id===OTHER)),id:thirdProduct,namaBarang:'Synthetic reserved garment'});
  stock.pembelian=stock.pembelian.filter(p=>p.id!==ORDINARY_ROLL);
  stock.pembelian.push(...[['synthetic-reserved-old',8,'2026-01-01'],['synthetic-flex-a',10,'2026-01-02'],['synthetic-flex-b',10,'2026-01-03']].map(([id,kg,tanggal])=>({id,kg,tanggal,jenisBahan:ORDINARY,unit:'kg',rolInfoId:id+'-detail',rolNum:id})));
  stock.rolInfo[ORDINARY.toLowerCase()].rols=stock.pembelian.filter(p=>p.jenisBahan===ORDINARY).map(p=>({id:p.rolInfoId,val:p.kg}));
  let root=CuttingPlan.issue(initial,stock,create(initial,stock,{id:'synthetic-reserved-plan',productIds:[thirdProduct],rolls:[{purchaseId:'synthetic-reserved-old',kg:6}]}));
  root=CuttingPlan.issue(root,stock,create(root,stock,{rolls:[{purchaseId:'synthetic-flex-a',kg:1,quantityPolicy:POLICY}]}));
  root=CuttingPlan.issue(root,stock,create(root,stock,{id:'synthetic-second-flex-plan',productIds:[OTHER],rolls:[{purchaseId:'synthetic-flex-b',kg:1,quantityPolicy:POLICY}]}));
  stock.adjustment.push({id:'synthetic-debit',jenisBahan:ORDINARY,kg:-8});
  assert.equal(CuttingPlan.availability(root,stock).materials[ORDINARY.toLowerCase()].available,14);
  const first=build(root,[{purchaseId:'synthetic-flex-a',kg:8}]),second=build(root,[{purchaseId:'synthetic-flex-b',kg:8}],{quantities:{[OTHER]:3},planId:'synthetic-second-flex-plan',id:'synthetic-second-po-batch'});
  assert.doesNotThrow(()=>CuttingPlan.applyCuts(root,nextProducts(root,first),stock));
  assert.doesNotThrow(()=>CuttingPlan.applyCuts(root,nextProducts(root,second),stock));
  rejectsWithoutMutation(root,stock,()=>CuttingPlan.applyCuts(root,nextProducts(root,[...first,...second]),stock));
});

test('flexible allowances require an explicit material selection and never auto-consume snapshot amounts',()=>{
  const {root,stock}=issued();
  rejectsWithoutMutation(root,stock,()=>build(root,undefined));
  rejectsWithoutMutation(root,stock,()=>build(root,[]));
  rejectsWithoutMutation(root,stock,()=>build(root,'synthetic-invalid-selection'));
});

test('unknown quantity policies are rejected when creating or issuing allowances',()=>{
  const {root,stock}=fixture();
  for(const quantityPolicy of ['actual-stock-v2','fixed',true,{}]){
    rejectsWithoutMutation(root,stock,()=>create(root,stock,{rolls:[{purchaseId:ORDINARY_ROLL,kg:2,quantityPolicy}]}));
    const plan=create(root,stock);plan.rolls[0].quantityPolicy=quantityPolicy;
    rejectsWithoutMutation(root,stock,()=>CuttingPlan.issue(root,stock,plan));
  }
});

test('wrong roll identity, duplicate selections, and invalid quantities are rejected',()=>{
  const {root,stock}=issued();
  for(const selection of [[{purchaseId:'synthetic-unassigned-roll',kg:1}],[{purchaseId:ORDINARY_ROLL,kg:1},{purchaseId:ORDINARY_ROLL,kg:1}],...[-1,0,Infinity,NaN,'',true].map(kg=>[{purchaseId:ORDINARY_ROLL,kg}])]){
    rejectsWithoutMutation(root,stock,()=>build(root,selection));
  }
});

test('latest roll identity or unit changes block applying an already prepared cut',()=>{
  const {root,stock}=issued(),next=nextProducts(root,build(root,selected(8)));
  for(const mutate of [latest=>latest.pembelian.find(p=>p.id===ORDINARY_ROLL).id='synthetic-replacement-roll',latest=>latest.rolInfo[ORDINARY.toLowerCase()].unit='yard']){
    const latest=clone(stock);mutate(latest);
    assert.equal(roll(CuttingPlan.materialChoices(root,latest,PLAN),ORDINARY_ROLL).available,0);
    rejectsWithoutMutation(root,latest,()=>CuttingPlan.applyCuts(root,next,latest));
  }
});

test('tampered selected-entry unit, policy, or cumulative consumption cannot validate as recorded material',()=>{
  let {root,stock}=issued();root=commit(root,stock,selected(8,1));
  for(const mutate of [
    changed=>changed.cuttingPlans[PLAN].consumedRolls.find(r=>r.purchaseId===ORDINARY_ROLL).kg=7,
    changed=>changed.produksi.find(p=>p.id===M).potong[0].rols[0].unit='yard',
    changed=>delete changed.produksi.find(p=>p.id===M).potong[0].rols[0].quantityPolicy,
    changed=>changed.cuttingPlans[PLAN].consumedRolls.find(r=>r.purchaseId===ORDINARY_ROLL).quantityPolicy='actual-stock-v2'
  ]){
    const changed=clone(root);mutate(changed);
    rejectsWithoutMutation(changed,stock,()=>CuttingPlan.materialChoices(changed,stock,PLAN));
    rejectsWithoutMutation(changed,stock,()=>build(changed,[],{quantities:{[L]:2},id:'synthetic-invalid-continuation'}));
  }
});

test('legacy fixed allowances retain their original cap and whole-allowance continuation behavior',()=>{
  const {root,stock}=issued({rolls:[{purchaseId:ORDINARY_ROLL,kg:2},{purchaseId:GREEN_ROLL,kg:3}]});
  assert.equal(roll(CuttingPlan.materialChoices(root,stock,PLAN),ORDINARY_ROLL).available,2);
  rejectsWithoutMutation(root,stock,()=>build(root,selected(2.1)));
  const first=commit(root,stock,undefined),choices=CuttingPlan.materialChoices(first,stock,PLAN);
  assert.equal(first.produksi.find(p=>p.id===M).potong[0].kiloan,5);assert.equal(choices.mode,'legacy');assert.equal(choices.canContinueWithoutMaterial,true);
  const continued=commit(first,stock,undefined,{quantities:{[L]:4},id:'synthetic-legacy-continuation'});
  assert.equal(continued.produksi.find(p=>p.id===L).potong[0].kiloan,0);
  assert.equal(CuttingPlan.availability(continued,stock).materials[ORDINARY.toLowerCase()].stock,18);
});

test('batch allocation conserves actual quantities across multiple sizes without multiplying stock use',()=>{
  const {root,stock}=issued(),cuts=build(root,selected(7.5,1.5),{quantities:{[M]:2,[L]:1}}),out=CuttingPlan.applyCuts(root,nextProducts(root,cuts),stock);
  assert.equal(cuts.reduce((sum,cut)=>sum+cut.entry.kiloan,0),9);
  assert.equal(cuts.reduce((sum,cut)=>sum+cut.entry.rols.find(r=>r.purchaseId===ORDINARY_ROLL).kg,0),7.5);
  assert.equal(out.cuttingPlans[PLAN].consumedRolls.find(r=>r.purchaseId===ORDINARY_ROLL).kg,7.5);
  assert.equal(roll(CuttingPlan.materialChoices(out,stock,PLAN),ORDINARY_ROLL).available,12.5);
});
