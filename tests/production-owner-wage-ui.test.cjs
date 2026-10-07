'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),UI=require('../production-owner-wage-ui.js'),Earnings=require('../maklon-earnings.js');
const clone=v=>JSON.parse(JSON.stringify(v));
const all=node=>[node,...node.children.flatMap(all)];
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
class Element{
  constructor(tag,document){this.ownerDocument=document;this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attributes=new Map();this.handlers=new Map();this.textContent='';this.value='';this.disabled=false;this.hidden=false;}
  appendChild(node){this.children.push(node);node.parentNode=this;return node;}
  replaceChildren(...nodes){for(const node of this.children)node.parentNode=null;this.children=[];for(const node of nodes)this.appendChild(node);}
  setAttribute(k,v){this.attributes.set(k,String(v));}removeAttribute(k){this.attributes.delete(k);}getAttribute(k){return this.attributes.get(k)??null;}
  addEventListener(k,f){this.handlers.set(k,f);}removeEventListener(k,f){if(this.handlers.get(k)===f)this.handlers.delete(k);}
  set innerHTML(_){throw Error('Unsafe insertion');}
}
const scope=()=>({projectId:'demo-owner-wage',databaseURL:'https://demo-owner-wage.firebaseio.com',tenantId:'tenant-1',uid:'owner-1',grantRevision:2});
const product=()=>({series:'Synthetic Series',namaBarang:'Synthetic Garment',size:'M'});
const catalog=()=>({cycles:[{productId:'product-1',cycleId:'cycle-1',product:product(),workers:[{workerId:'worker-1',label:'Synthetic A'},{workerId:'worker-2',label:'Synthetic B'}]},{productId:'product-2',cycleId:'cycle-2',workers:[{workerId:'worker-3',label:'Synthetic C'}]}]});
const selection=(workerId='worker-1')=>({productId:'product-1',cycleId:'cycle-1',workerId});
function view(workerId='worker-1',options={}){
  const operations={id:'product-1',...product(),cutQuantity:20,poJumlah:20,poAktif:true},entries={};
  if(!options.empty){for(const [index,provisional]of [true,false].entries()){const sourceId=String(index+1).repeat(64);entries[sourceId]={sourceId,productId:'product-1',...product(),tanggal:'2026-10-0'+(index+1),jumlah:index===0?3:2,tarif:137,total:137*(index===0?3:2),sourceType:index===0?'hitungFisik':'qcRepair',provisional};}}
  const earnings=options.absent?null:Earnings.normalize({workerId,nama:'Synthetic label in projection',entries},workerId);
  return {selection:selection(workerId),workerLabel:workerId==='worker-1'?'Synthetic A':'Synthetic B',operations,projectionRevision:1,earnings,summary:earnings?Earnings.summarize(earnings):null,availability:earnings?'available':'unavailable',consistency:'independent-listeners'};
}
function fixture(options={}){
  const document={createElement:tag=>new Element(tag,document)},host=document.createElement('main'),control={current:true,connectResult:null,selectResult:{ok:true},clearResult:{ok:true},...options},calls={connect:0,selected:[],clears:0,disposed:0,amountsBeforeSelect:[],amountsBeforeClear:[]},waiting=deferred();let callbacks;
  const text=()=>all(host).map(n=>n.textContent).join(' '),find=id=>all(host).find(n=>n.id===id);
  const bridge={async connect(){calls.connect++;if(control.catalogDuringConnect)callbacks.onCatalog(control.catalogDuringConnect);if(control.pauseConnect)return waiting.promise;return control.connectResult||{ok:true,scope:scope(),profile:{active:true,owner:true},catalog:control.catalog||catalog()};},select(chosen){calls.amountsBeforeSelect.push(text().includes('Rp '));calls.selected.push(clone(chosen));callbacks.onClear('selection_changed');if(control.immediateView)callbacks.onView(control.immediateView);return control.selectResult;},clearSelection(){calls.clears++;calls.amountsBeforeClear.push(text().includes('Rp '));callbacks.onClear('selection_cleared');return control.clearResult;},dispose(){calls.disposed++;callbacks.onClear('disposed');}};
  const mounted=UI.mount({document,host,createBridge(value){assert.deepEqual(Object.keys(value).sort(),['onCatalog','onClear','onView']);callbacks=value;if(control.clearInFactory)callbacks.onClear('access_denied');return bridge;},isCurrent:()=>control.current});
  function change(id,value){const element=find(id);assert.ok(element,id);element.value=value;element.handlers.get('change')?.();}
  return {document,host,control,calls,mounted,waiting,text,find,change,get callbacks(){return callbacks;},chooseCycle(value=JSON.stringify(['product-1','cycle-1'])){change('owner-wage-cycle',value);},chooseWorker(value='worker-1'){change('owner-wage-worker',value);},emit(value=view()){callbacks.onView(value);},clear(code){callbacks.onClear(code);}};
}
async function chosen(options){const f=fixture(options);assert.equal((await f.mounted.readyPromise).ok,true);f.chooseCycle();f.chooseWorker();return f;}

test('owner and explicit cycle/worker are mandatory; no wage selection or amount appears on connect',async()=>{
  const f=fixture();assert.equal((await f.mounted.readyPromise).ok,true);assert.equal(f.find('owner-wage-cycle').value,'');assert.equal(f.find('owner-wage-worker').value,'');assert.equal(f.find('owner-wage-worker').disabled,true);assert.equal(f.calls.selected.length,0);f.emit();assert.doesNotMatch(f.text(),/Rp /);f.chooseCycle();assert.equal(f.calls.selected.length,0);assert.equal(f.find('owner-wage-worker').value,'');f.chooseWorker();assert.deepEqual(f.calls.selected,[selection()]);
  const denied=fixture({connectResult:{ok:true,scope:scope(),profile:{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}},catalog:catalog()}});assert.equal((await denied.mounted.readyPromise).ok,false);assert.equal(denied.host.children.length,0);assert.equal(denied.calls.disposed,1);
});
test('recorded gross totals, dates and frozen per-entry rates render with separate provisional/QC subtotals',async()=>{
  const f=await chosen();f.emit();assert.match(f.text(),/Synthetic A · Synthetic Series · Synthetic Garment · M/);assert.match(f.text(),/Total upah tercatat Rp 685 5 pcs/);assert.match(f.text(),/Masih sementara Rp 411 3 pcs/);assert.match(f.text(),/Hasil QC Rp 274 2 pcs/);assert.equal(f.find('owner-wage-rows').children.length,2);assert.equal(f.find('owner-wage-detail').hidden,false);assert.match(f.text(),/Rp 137 \/ pcs/);assert.match(f.text(),/Sementara — menunggu QC/);assert.match(f.text(),/Hasil QC — tarif saat dicatat/);assert.match(f.text(),/1 Okt 2026|1 Oktober 2026/);assert.match(f.text(),/Status pembayaran dan potongan tidak dihitung/);assert.doesNotMatch(f.text(),/sudah dibayar|upah bersih|kasbon|transfer|API|listener/i);
});
test('null wage remains unavailable with blank amount cells; a verified available empty model displays zero',async()=>{
  const f=await chosen();f.emit();f.emit(view('worker-1',{absent:true}));assert.doesNotMatch(f.text(),/Rp /);assert.equal(f.find('owner-wage-totals').children.length,0);assert.equal(f.find('owner-wage-rows').children.length,0);assert.equal(f.find('owner-wage-detail').hidden,true);assert.match(f.text(),/belum tersedia/);f.emit(view('worker-1',{empty:true}));assert.match(f.text(),/Total upah tercatat Rp 0 0 pcs/);assert.equal(f.find('owner-wage-detail').hidden,false);assert.match(f.text(),/belum ada pekerjaan/);
});
test('both selection changes clear all amounts before bridge unsubscription or new selection; old worker callback is ignored',async()=>{
  const f=await chosen();f.emit();assert.match(f.text(),/Rp 685/);f.chooseWorker('worker-2');assert.doesNotMatch(f.text(),/Rp /);assert.equal(f.find('owner-wage-context').textContent,'');assert.equal(f.calls.amountsBeforeSelect.every(v=>v===false),true);assert.equal(f.calls.amountsBeforeClear.every(v=>v===false),true);f.emit(view('worker-1'));assert.doesNotMatch(f.text(),/Rp /);f.emit(view('worker-2'));assert.match(f.text(),/Synthetic B/);f.chooseCycle(JSON.stringify(['product-2','cycle-2']));assert.doesNotMatch(f.text(),/Rp /);assert.equal(f.find('owner-wage-worker').value,'');f.emit(view('worker-2'));assert.doesNotMatch(f.text(),/Rp /);assert.equal(f.calls.selected.length,2);
});
test('blank or tampered cycle/worker choices can never open arbitrary paths and always clear previous amounts',async()=>{
  const f=await chosen();f.emit();f.chooseWorker('../foreign');assert.doesNotMatch(f.text(),/Rp /);assert.equal(f.find('owner-wage-worker').value,'');assert.equal(f.calls.selected.length,1);f.chooseCycle('["../foreign","cycle-1"]');assert.equal(f.find('owner-wage-cycle').value,'');assert.equal(f.find('owner-wage-worker').disabled,true);assert.equal(f.calls.selected.length,1);f.chooseCycle();f.chooseWorker();f.emit();f.chooseWorker('');assert.doesNotMatch(f.text(),/Rp /);assert.equal(f.calls.selected.length,2);
});
test('loading and exact transient clear codes preserve selectors and hide monetary/context views',async()=>{
  const f=await chosen();for(const code of ['loading','selection_changed','selection_cleared']){f.emit();assert.match(f.text(),/Rp 685/);f.clear(code);assert.equal(f.calls.disposed,0);assert.ok(f.find('owner-wage-cycle'));assert.equal(f.find('owner-wage-worker').value,'worker-1');assert.doesNotMatch(f.text(),/Rp /);assert.equal(f.find('owner-wage-context').textContent,'');}
});
test('revocation, read failures and unknown clear codes wipe all business DOM and ignore every late callback',async()=>{
  for(const code of ['access_denied','account_changed','access_changed','read_failed','invalid_view','disposed','selection-changed',undefined]){const f=await chosen();f.emit();f.clear(code);assert.equal(f.host.children.length,0);assert.equal(f.calls.disposed,1);f.emit();f.callbacks.onCatalog(catalog());f.clear('loading');assert.equal(f.host.children.length,0);assert.equal(f.calls.disposed,1);}
});
test('account invalidation before a callback or pending connect removes UI and never reopens it',async()=>{
  const f=await chosen();f.emit();f.control.current=false;f.emit();assert.equal(f.host.children.length,0);assert.equal(f.calls.disposed,1);
  const opening=fixture({pauseConnect:true});opening.mounted.dispose();opening.waiting.resolve({ok:true,scope:scope(),profile:{active:true,owner:true},catalog:catalog()});assert.equal((await opening.mounted.readyPromise).ok,false);assert.equal(opening.host.children.length,0);assert.equal(opening.calls.disposed,1);
});
test('synchronous initial terminal clear disposes the returned bridge even before assignment',async()=>{
  const f=fixture({clearInFactory:true});assert.equal((await f.mounted.readyPromise).ok,false);assert.equal(f.calls.connect,0);assert.equal(f.calls.disposed,1);assert.equal(f.host.children.length,0);
});
test('labels and product metadata render as text; known money-free metadata gives friendly choices before selection',async()=>{
  const cat=catalog();cat.cycles[0].workers[0].label='<img src=x onerror=alert(1)>';cat.cycles[0].product={series:'  Synthetic Series  ',namaBarang:'',size:' M '};const f=await chosen({catalog:cat});assert.match(f.find('owner-wage-cycle').children[1].textContent,/Synthetic Series · M · siklus cycle-1/);assert.doesNotMatch(f.text(),/Rp /);const v=view();v.workerLabel=cat.cycles[0].workers[0].label;v.operations={...v.operations,...cat.cycles[0].product};v.earnings={...v.earnings,entries:v.earnings.entries.map(e=>({...e,...cat.cycles[0].product}))};v.summary=Earnings.summarize(v.earnings);f.emit(v);assert.match(f.text(),/<img src=x onerror=alert\(1\)>/);assert.equal(all(f.host).some(n=>n.tagName==='IMG'),false);assert.match(f.text(),/Synthetic Series · M/);
  const old=catalog();delete old.cycles[0].product;const fallback=fixture({catalog:old});await fallback.mounted.readyPromise;assert.match(fallback.find('owner-wage-cycle').children[1].textContent,/Produk product-1/);
  const empty=catalog();empty.cycles[0].product={series:' ',namaBarang:'',size:''};const blank=fixture({catalog:empty});assert.equal((await blank.mounted.readyPromise).ok,true);assert.match(blank.find('owner-wage-cycle').children[1].textContent,/Produk product-1/);
});
test('changed catalog metadata or inconsistent authenticated callback catalogs fail closed',async()=>{
  const f=await chosen();f.emit();const changed=catalog();changed.cycles[0].workers[0].label='different';f.callbacks.onCatalog(changed);assert.equal(f.host.children.length,0);
  const bad=fixture({catalogDuringConnect:changed});assert.equal((await bad.mounted.readyPromise).ok,false);assert.equal(bad.host.children.length,0);
  const same=fixture({catalogDuringConnect:catalog()});assert.equal((await same.mounted.readyPromise).ok,true);
});
test('malformed or mismatched wage summaries, metadata, identities and projection state cannot display stale amounts',async()=>{
  const changes=[v=>{v.summary={...v.summary,calculatedTotal:999};},v=>{v.workerLabel='other';},v=>{v.operations={...v.operations,namaBarang:'foreign'};},v=>{v.projectionRevision=-1;},v=>{v.consistency='atomic';},v=>{v.availability='unavailable';},v=>{v.earnings={...v.earnings,workerId:'worker-2'};},v=>{v.earnings={...v.earnings,entries:v.earnings.entries.map(e=>({...e,tarif:1.5,total:1.5*e.jumlah}))};v.summary=Earnings.summarize(v.earnings);},v=>{v.extra='unexpected';}];
  for(const change of changes){const f=await chosen();f.emit();const v=clone(view());change(v);f.emit(v);assert.equal(f.host.children.length,0);assert.equal(f.calls.disposed,1);f.emit();assert.equal(f.host.children.length,0);}
});
test('missing or malformed catalog/scope/connect responses dispose without invoking payload getters',async()=>{
  const changes=[r=>{delete r.catalog;},r=>{r.catalog.cycles[0].workers[1].workerId='worker-1';},r=>{r.catalog.cycles.push(clone(r.catalog.cycles[0]));},r=>{r.scope.databaseURL='https://foreign.invalid';},r=>{r.scope.uid='../unsafe';},r=>{r.scope.grantRevision=-1;},r=>{r.profile.active=false;},r=>{r.catalog.cycles[0].product.money=100;}];
  for(const change of changes){const r={ok:true,scope:scope(),profile:{active:true,owner:true},catalog:catalog()};change(r);const f=fixture({connectResult:r});assert.equal((await f.mounted.readyPromise).ok,false);assert.equal(f.host.children.length,0);assert.equal(f.calls.selected.length,0);}
  let reads=0;const cat=catalog();Object.defineProperty(cat.cycles[0].workers[0],'label',{enumerable:true,get(){reads++;throw Error('synthetic-private');}});const getters=fixture({catalog:cat});assert.equal((await getters.mounted.readyPromise).ok,false);assert.equal(reads,0);
  const sparse=fixture({catalog:{cycles:new Array(1)}});assert.equal((await sparse.mounted.readyPromise).ok,false);
  for(const value of ['synthetic\u0001','synthetic\u007f','synthetic\u0085']){const cat=catalog();cat.cycles[0].product.series=value;const controls=fixture({catalog:cat});assert.equal((await controls.mounted.readyPromise).ok,false);assert.equal(controls.host.children.length,0);assert.equal(controls.calls.selected.length,0);}
});
test('view getter rejection executes no getters and exposes no raw exception details',async()=>{
  const f=await chosen();f.emit();let reads=0;const value=view();Object.defineProperty(value,'earnings',{enumerable:true,get(){reads++;throw Error('synthetic-private-token');}});f.emit(value);assert.equal(reads,0);assert.equal(f.host.children.length,0);assert.doesNotMatch(f.text(),/synthetic-private-token/);
});
test('failed selection retains no old amount; failed unsubscription and malformed results close the form',async()=>{
  const invalid=await chosen();invalid.emit();invalid.control.selectResult={ok:false,error:'invalid_request'};invalid.chooseWorker('worker-2');assert.doesNotMatch(invalid.text(),/Rp /);assert.match(invalid.text(),/Pilihan mitra belum dapat dibuka/);assert.equal(invalid.calls.disposed,0);
  for(const result of [{ok:false,error:'access_denied'},null,{ok:true,extra:true}]){const f=await chosen();f.emit();f.control.selectResult=result;f.chooseWorker('worker-2');assert.equal(f.host.children.length,0);}
  const close=await chosen();close.emit();close.control.clearResult={ok:false,error:'unavailable'};close.chooseCycle();assert.equal(close.host.children.length,0);
});
test('empty canonical catalogs or worker lists are usable empty states with no default wage reads',async()=>{
  const f=fixture({catalog:{cycles:[]}});assert.equal((await f.mounted.readyPromise).ok,true);assert.equal(f.find('owner-wage-cycle').disabled,true);assert.match(f.text(),/Belum ada produksi/);assert.equal(f.calls.selected.length,0);
  const empty=catalog();empty.cycles[0].workers=[];const workers=fixture({catalog:empty});await workers.mounted.readyPromise;workers.chooseCycle();assert.equal(workers.find('owner-wage-worker').disabled,true);assert.match(workers.text(),/belum memiliki mitra/);assert.equal(workers.calls.selected.length,0);
});
test('UI source contains no writable command, credential, direct API, persistence or unsafe HTML capabilities',()=>{
  const source=fs.readFileSync(require.resolve('../production-owner-wage-ui.js'),'utf8');assert.doesNotMatch(source,/\.innerHTML\s*=|insertAdjacentHTML|localStorage|sessionStorage|indexedDB|fetch\s*\(|getIdToken|signInWithPopup|createStore|\.prepare\(|\.send\(|\.pending\(|\.transaction\(|\.set\(/);assert.match(source,/textContent/);
});
