'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Model=require('../maklon-earnings.js'),Policy=require('../access-policy.js');
class Element{
  constructor(){this.hidden=false;this.textContent='';this.value='';this.children=[];this.listeners={};}
  append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}
  addEventListener(name,callback){this.listeners[name]=callback;}
  set innerHTML(value){throw Error('unsafe_html');}
}
function data(workerId='worker-1',name='Synthetic <img> partner'){
  const sourceId='a'.repeat(64);return {workerId,nama:name,entries:{[sourceId]:{sourceId,productId:'product-1',series:'Example',namaBarang:'<script>label</script>',size:'M',tanggal:'2026-01-01',jumlah:3,tarif:123,total:369,sourceType:'hitungFisik',provisional:false}}};
}
async function page(profile={active:true,workerId:'worker-1',modules:{jahit:true}},getDirectory){
  const elements=new Map(),callbacks=[],events={},observers=[];let locked=false;
  for(const id of ['earnings-status','earnings-content','earnings-rows','worker-name','work-count','earnings-total','date-from','date-to','owner-selection','worker-choice'])elements.set(id,new Element());
  elements.get('earnings-content').hidden=true;elements.get('owner-selection').hidden=true;
  const context={uid:'user-1',authorized:true,profile,auth:{currentUser:{uid:'user-1'}},db:{},sdk:{ref:(db,path)=>path,get:async()=>({val:()=>({'worker-1':{id:'worker-1',nama:'Partner one'},'worker-2':{id:'worker-2',nama:'Partner two'}})}),onValue:(path,success,error)=>{const call={path,success,error,stopped:false};callbacks.push(call);return ()=>{call.stopped=true;};}}};
  // SDK val() is synchronous. Resolve a directory promise before exposing its snapshot.
  if(getDirectory)context.sdk.get=async()=>{const value=await getDirectory();return {val:()=>value};};
  const document={documentElement:{hasAttribute:()=>locked},getElementById:id=>elements.get(id),createElement:()=>new Element(),addEventListener:(name,callback)=>{events[name]=callback;}};
  // The real page/model share a browser realm. Copy only UI date filters from
  // the VM realm into the Node model realm; model validation itself is unchanged.
  const browserModel={...Model,summarize:(model,range)=>Model.summarize(model,JSON.parse(JSON.stringify(range)))};
  const window={SoldierMaklonEarnings:browserModel,SoldierAccessPolicy:Policy,SoldierAccess:{findConfig:()=>({}),connect:async()=>context},addEventListener:(name,callback)=>{events[name]=callback;}};
  const sandbox={window,document,Intl,MutationObserver:class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../maklon-earnings-view.js'),'utf8'),sandbox);
  const ready=events.DOMContentLoaded();
  return {elements,callbacks,events,context,ready,lock(){locked=true;for(const observer of observers)observer.callback();}};
}
test('the view reads only the bound partner path, renders literal labels, and clears money on lock without storage writes',async()=>{
  const p=await page();await p.ready;assert.equal(p.callbacks[0].path,'maklonEarnings/worker-1');
  p.callbacks[0].success({val:()=>data()});assert.equal(p.elements.get('work-count').textContent,'3 pcs');assert.equal(p.elements.get('worker-name').textContent,'Synthetic <img> partner');
  assert.equal(p.elements.get('earnings-rows').children[0].children[1].textContent,'Example · <script>label</script> · M');
  p.lock();assert.equal(p.elements.get('earnings-content').hidden,true);assert.equal(p.elements.get('earnings-total').textContent,'');assert.equal(p.callbacks[0].stopped,true);
  p.callbacks[0].success({val:()=>data()});assert.equal(p.elements.get('earnings-total').textContent,'');
});
test('owner switching ignores old queued callbacks instead of erasing or replacing the newly selected partner',async()=>{
  const p=await page({active:true,owner:true});await p.ready;
  const select=p.elements.get('worker-choice');select.value='worker-1';select.listeners.change();const first=p.callbacks[0];
  select.value='worker-2';select.listeners.change();const second=p.callbacks[1];second.success({val:()=>data('worker-2','Partner two')});
  first.success({val:()=>data('worker-1','Partner one')});assert.equal(p.elements.get('worker-name').textContent,'Partner two');assert.equal(p.elements.get('earnings-content').hidden,false);
});
test('absent or malformed earnings do not show zero paid or expose rejected financial/credential values',async()=>{
  const p=await page();await p.ready;const call=p.callbacks[0];
  call.success({val:()=>null});assert.equal(p.elements.get('earnings-content').hidden,true);assert.equal(p.elements.get('earnings-total').textContent,'');
  const poisoned=data();poisoned.secret='synthetic-private-value';call.success({val:()=>poisoned});
  assert.equal(p.elements.get('earnings-content').hidden,true);assert.equal(p.elements.get('earnings-status').textContent.includes('synthetic-private-value'),false);
});
test('a changed account cannot receive an awaited owner directory or old partner snapshot',async()=>{
  let resolve;const deferred=new Promise(done=>{resolve=done;});const p=await page({active:true,owner:true},()=>deferred);
  p.context.auth.currentUser={uid:'user-other'};resolve({'worker-1':{id:'worker-1',nama:'Private partner'}});await p.ready;
  assert.equal(p.elements.get('owner-selection').hidden,true);assert.equal(p.elements.get('worker-choice').children.length,0);
  const partner=await page();await partner.ready;partner.context.profile={active:true,workerId:'worker-2',modules:{jahit:true}};
  partner.callbacks[0].success({val:()=>data()});assert.equal(partner.elements.get('earnings-content').hidden,true);
});
