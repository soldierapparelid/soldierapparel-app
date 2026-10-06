'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../production-form-ui.js'),'utf8');
const endpointURL='https://commands.example.invalid/v1/production/commands';
const DAY='2026-10-05',copy=v=>JSON.parse(JSON.stringify(v));
class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attributes=new Map();this.handlers=new Map();this.textContent='';this.value='';this.hidden=false;this.disabled=false;this.checked=false;}
  appendChild(node){this.children.push(node);node.parentNode=this;return node;}
  replaceChildren(...nodes){for(const node of this.children)node.parentNode=null;this.children=[];for(const node of nodes)this.appendChild(node);}
  setAttribute(k,v){this.attributes.set(k,String(v));}
  removeAttribute(k){this.attributes.delete(k);}
  getAttribute(k){return this.attributes.get(k)??null;}
  addEventListener(k,fn){this.handlers.set(k,fn);}
  remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(v=>v!==this);this.parentNode=null;}}
  set innerHTML(v){throw Error('Unsafe HTML insertion attempted');}
}
const all=node=>[node,...node.children.flatMap(all)];
function cycle(){return {productId:'product-1',cycleId:'cycle-1',revision:0,operations:{id:'product-1',series:'Synthetic',namaBarang:'<img src=x onerror=alert(1)>',size:'M',cutQuantity:20,poJumlah:20,poAktif:true,assignJahit:[{id:'assignment-1',tukangId:'worker-1',qty:10,sisa:10},{id:'assignment-2',tukangId:'worker-2',qty:10,sisa:10}],jahit:[{id:'sewing-1',assignmentId:'assignment-1',tukangId:'worker-1',tanggal:DAY,jumlah:10,lolos:10,rijek:0},{id:'sewing-other',assignmentId:'assignment-2',tukangId:'worker-2',tanggal:DAY,jumlah:1,lolos:1,rijek:0}],hitungFisik:[{id:'count-1',tukangId:'worker-1',tanggal:DAY,jumlah:4},{id:'count-2',tukangId:'worker-1',tanggal:DAY,jumlah:3},{id:'count-other',tukangId:'worker-2',tanggal:DAY,jumlah:2}],qc:[{id:'qc-1',tukangId:'worker-1',hfId:'count-prior',tanggal:DAY,ok:1,perbaikan:3,reject:0,offline:0}],repairs:[{id:'repair-original',qcId:'qc-1',tukangId:'worker-1',tanggal:DAY,jumlah:1}]},wage:null,workerLabels:[{workerId:'worker-1',label:'<svg onload=alert(1)>'},{workerId:'worker-2',label:'Synthetic other'}]};}
function fixture({module='jahit',pending=[],current=true,readyResult={ok:true},submitResult={ok:true},retryResult={ok:true},stateCycle=cycle(),real=false,endpoint=endpointURL}={}){
  const calls={controller:0,disposed:0,submit:[],retry:[],bridge:0,prepared:[],sent:[]},control={current,submitResult},host=new Element('main');
  const document={createElement:tag=>new Element(tag)},sandbox={URL,Intl,Date,Promise,TextEncoder,TextDecoder,console,crypto:{randomUUID:()=>{calls.ids=(calls.ids||0)+1;return 'synthetic-generated-id';}}};
  const context=vm.createContext(sandbox);
  let state={phase:'ready',error:null,module,profile:{active:true,owner:false,workerId:'worker-1',modules:{[module]:true}},selectedCycle:null,cycles:[stateCycle],pending,busy:false},onState,controller;
  if(!real)sandbox.SoldierProductionFormController={createProductionFormController(options){calls.controller++;onState=options.onState;controller={async connect(){onState(state);return readyResult;},selectCycle(productId,cycleId){state={...state,selectedCycle:{productId,cycleId}};onState(state);return {ok:true};},async submit(kind,payload){calls.submit.push({kind,payload:copy(payload)});return typeof control.submitResult==='function'?control.submitResult():control.submitResult;},async retry(id){calls.retry.push(id);state={...state,busy:true};onState(state);const result=retryResult;state={...state,busy:false};onState(state);return result;},async refreshPending(){return {ok:true};},dispose(){calls.disposed++;}};return controller;}};
  else for(const file of ['production-command-client.js','operations-codec.js','maklon-earnings.js','production-view-client.js','production-form-controller.js'])vm.runInContext(fs.readFileSync(require.resolve('../'+file),'utf8'),context,{filename:file});
  vm.runInContext(source,context,{filename:'production-form-ui.js'});
  let factory;
  if(!real)factory=()=>{calls.bridge++;return {};};
  else{
    const valid=cycle();delete valid.operations.jahit;delete valid.operations.hitungFisik;delete valid.operations.qc;delete valid.operations.repairs;valid.operations.assignJahit=[valid.operations.assignJahit[0]];valid.operations.cutQuantity=10;valid.operations.poJumlah=10;
    const view=vm.runInContext('('+JSON.stringify({cycles:[{productId:valid.productId,cycleId:valid.cycleId,revision:0,operations:valid.operations,wage:null}],complete:true,consistency:'independent-listeners'})+')',context),manifest=vm.runInContext('('+JSON.stringify({ok:true,cycles:[{productId:'product-1',cycleId:'cycle-1'}],profile:{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}},scope:{projectId:'demo-ui-proof',databaseURL:'https://demo-ui-proof.firebaseio.com',tenantId:'tenant-1',uid:'caller-1',grantRevision:0}})+')',context);
    const drafts=[];factory=callbacks=>{calls.bridge++;return {async connect(){callbacks.onView(view);return manifest;},async prepare(command){calls.prepared.push(copy(command));drafts.push(command);return {ok:true};},async pending(){return vm.runInContext('('+JSON.stringify({ok:true,commands:drafts})+')',context);},async send(id){calls.sent.push(id);drafts.length=0;return {ok:true,receipt:{requestId:id,revision:1,acceptedAt:DAY+'T00:00:00.000Z'},replayed:false};},dispose(){calls.disposed++;}};};
  }
  const mounted=sandbox.SoldierProductionFormUI.mount({document,host,module,createBridge:factory,isCurrent:()=>control.current,endpointURL:endpoint});
  const find=id=>all(host).find(node=>node.id===id),text=()=>all(host).map(node=>node.textContent).join(' '),set=(id,value)=>{const node=find(id);assert.ok(node,id);if(node.type==='checkbox')node.checked=value;else node.value=value;};
  async function drain(){for(let n=0;n<25;n++)await Promise.resolve();}
  async function click(id){const button=find(id);assert.ok(button,id);button.handlers.get('click')();await drain();}
  async function choose(){set('production-cycle',JSON.stringify(['product-1','cycle-1']));find('production-cycle').handlers.get('change')();await drain();}
  return {mounted,find,set,text,click,choose,drain,calls,control,host,state:()=>state,emit(next){state=next;onState(next);}};
}
async function chosen(options){const f=fixture(options);assert.equal((await f.mounted.ready).ok,true);await f.choose();return f;}
function sewing(f,good='4',reject='1'){f.set('sewing-assignment','assignment-1');f.set('sewing-date',DAY);f.set('sewing-good',good);f.set('sewing-reject',reject);}
function inspection(f,id='count-1',ok='4'){f.set('inspect-count',id);f.set('inspect-date',DAY);f.set('inspect-ok',ok);for(const key of ['perbaikan','reject','offline'])f.set('inspect-'+key,'0');}

test('invalid endpoint opens no controller, bridge or business DOM',async()=>{
  for(const endpoint of ['http://commands.example.invalid/v1/production/commands',endpointURL+'?override=1','https://user@commands.example.invalid/v1/production/commands']){const f=fixture({endpoint});assert.equal((await f.mounted.ready).ok,false);assert.equal(f.calls.controller,0);assert.equal(f.calls.bridge,0);assert.equal(f.host.children.length,0);}
});
test('cycle and assignment selection are explicit; no first assignment is silently used',async()=>{
  const f=fixture();await f.mounted.ready;assert.equal(f.find('production-cycle').value,'');await f.click('sewing-submit');assert.equal(f.calls.submit.length,0);await f.choose();assert.equal(f.find('sewing-assignment').value,'');await f.click('sewing-submit');assert.equal(f.calls.submit.length,0);
});
test('sewing form shows only trusted own assignments and emits exact input without IDs or financial fields',async()=>{
  const f=await chosen();assert.equal(f.find('sewing-assignment').children.some(v=>v.value==='assignment-2'),false);sewing(f);await f.click('sewing-submit');assert.deepEqual(f.calls.submit,[{kind:'sewing',payload:{assignmentId:'assignment-1',tanggal:DAY,good:4,reject:1}}]);assert.equal(f.calls.ids,undefined);assert.equal(f.find('sewing-good').value,'');assert.doesNotMatch(f.text(),/sewing-other/);
});
test('blank, negative, decimal, exponent, unsafe and overflowing quantities cannot submit',async()=>{
  for(const [good,reject]of [['','0'],['-1','0'],['1.5','0'],['1e2','0'],['Infinity','0'],['9007199254740992','0'],['9007199254740991','1'],['0','0']]){const f=await chosen();sewing(f,good,reject);await f.click('sewing-submit');assert.equal(f.calls.submit.length,0);assert.match(f.text(),/Kolom kosong belum boleh dikirim/);}
});
test('invalid dates and forged assignment choices cannot submit',async()=>{
  for(const mutate of [f=>f.set('sewing-date','2026-02-30'),f=>f.set('sewing-assignment','assignment-2'),f=>f.set('sewing-assignment','__proto__')]){const f=await chosen();sewing(f);mutate(f);await f.click('sewing-submit');assert.equal(f.calls.submit.length,0);}
});
test('failed submission uses a fixed message without echoing unknown errors or private details',async()=>{
  const f=await chosen({submitResult:()=>{throw Error('synthetic-token-and-private-data');}});sewing(f);await f.click('sewing-submit');assert.doesNotMatch(f.text(),/synthetic-token/);assert.match(f.text(),/Belum dapat menyimpan/);assert.equal(f.find('sewing-good').value,'4');
});
test('unknown pending command blocks new work and retry uses the original request ID despite changed inputs',async()=>{
  const command={requestId:'request-original',productId:'product-1',cycleId:'cycle-1',kind:'sewing',payload:{id:'original-entity',good:2}};const f=await chosen({pending:[command]});sewing(f);await f.click('sewing-submit');assert.equal(f.calls.submit.length,0);
  const retry=all(f.host).find(v=>v.getAttribute('data-request-id')==='request-original');assert.ok(retry);retry.handlers.get('click')();await f.drain();assert.deepEqual(f.calls.retry,['request-original']);assert.match(f.text(),/draf request-original/);
});
test('rapid duplicate clicks do not make a second controller submission',async()=>{
  let resolve;const wait=new Promise(done=>{resolve=done;});const f=await chosen({submitResult:()=>wait});sewing(f);const handler=f.find('sewing-submit').handlers.get('click');handler();handler();assert.equal(f.calls.submit.length,1);resolve({ok:true});await f.drain();assert.equal(f.calls.submit.length,1);
});

test('manual retry remains enabled after an unknown result with the same pending request',async()=>{
  const command={requestId:'request-original',productId:'product-1',cycleId:'cycle-1',kind:'sewing',payload:{id:'original-entity',good:2}},f=await chosen({pending:[command],retryResult:{ok:false,error:'result_unknown'}});
  const findRetry=()=>all(f.host).find(v=>v.getAttribute('data-request-id')==='request-original');findRetry().handlers.get('click')();await f.drain();assert.equal(findRetry().disabled,false);findRetry().handlers.get('click')();await f.drain();assert.deepEqual(f.calls.retry,['request-original','request-original']);assert.equal(f.calls.submit.length,0);
});

test('terminal canonical revoke removes numeric form values and every business view immediately',async()=>{
  const f=await chosen();sewing(f,'7','2');assert.ok(f.find('sewing-good'));f.emit({phase:'blocked',error:'access_denied',module:'jahit',profile:null,selectedCycle:null,cycles:[],pending:[],busy:false});assert.equal(f.host.children.length,0);assert.equal(f.calls.disposed,1);assert.equal(f.find('sewing-good'),undefined);
});
test('account invalidation during a pending result removes business DOM and ignores late state/result',async()=>{
  let resolve;const wait=new Promise(done=>{resolve=done;});const f=await chosen({submitResult:()=>wait});sewing(f);f.find('sewing-submit').handlers.get('click')();f.control.current=false;resolve({ok:true});await f.drain();assert.equal(f.host.children.length,0);assert.equal(f.calls.disposed,1);f.emit(f.state());assert.equal(f.host.children.length,0);
});
test('QC never consumes a wage model and treats labels/product markup as text',async()=>{
  const c=cycle();let reads=0;Object.defineProperty(c,'wage',{get(){reads++;throw Error('Forbidden QC wage read');}});const f=await chosen({module:'qc',stateCycle:c});assert.equal(reads,0);assert.equal(f.find('production-own-wage').hidden,true);assert.equal(f.find('sewing-submit'),undefined);assert.match(f.text(),/<img src=x onerror=alert\(1\)>/);assert.match(f.text(),/<svg onload=alert\(1\)>/);assert.equal(all(f.host).some(v=>v.tagName==='IMG'||v.tagName==='SVG'),false);
});
test('QC count requires an explicit existing assignment and positive integer',async()=>{
  const f=await chosen({module:'qc'});f.set('count-date',DAY);f.set('count-quantity','3');await f.click('count-submit');assert.equal(f.calls.submit.length,0);f.set('count-assignment','assignment-2');await f.click('count-submit');assert.deepEqual(f.calls.submit[0],{kind:'count',payload:{assignmentId:'assignment-2',tanggal:DAY,jumlah:3}});
});
test('single QC inspection uses original count ID and matching category total only',async()=>{
  const f=await chosen({module:'qc'});inspection(f,'count-1','3');await f.click('inspect-submit');assert.equal(f.calls.submit.length,0);f.set('inspect-perbaikan','1');await f.click('inspect-submit');assert.deepEqual(f.calls.submit[0],{kind:'inspect',payload:{entries:[{hfId:'count-1',tanggal:DAY,ok:3,perbaikan:1,reject:0,offline:0}]}});
});
test('QC batch preserves separate original IDs and uses one partner per batch',async()=>{
  const f=await chosen({module:'qc'});inspection(f,'count-1','4');await f.click('inspect-add');assert.equal(f.find('inspect-count').value,'');inspection(f,'count-2','3');await f.click('inspect-submit');assert.deepEqual(f.calls.submit[0].payload.entries.map(v=>v.hfId),['count-1','count-2']);assert.equal(f.calls.submit.length,1);
  const mixed=await chosen({module:'qc'});inspection(mixed,'count-1','4');await mixed.click('inspect-add');inspection(mixed,'count-other','2');await mixed.click('inspect-submit');assert.equal(mixed.calls.submit.length,0);
});
test('QC queue is held if the count is removed or receives QC before submission',async()=>{
  const f=await chosen({module:'qc'});inspection(f);await f.click('inspect-add');const changed=copy(f.state());changed.cycles[0].operations.hitungFisik=changed.cycles[0].operations.hitungFisik.filter(v=>v.id!=='count-1');f.emit(changed);await f.click('inspect-submit');assert.equal(f.calls.submit.length,0);assert.match(f.text(),/count-1/);
});
test('repair references original QC and checks remaining quantity and chronology',async()=>{
  const f=await chosen({module:'qc'});f.set('repair-qc','qc-1');f.set('repair-date',DAY);f.set('repair-quantity','4');await f.click('repair-submit');assert.equal(f.calls.submit.length,0);f.set('repair-quantity','2');f.set('repair-date','2026-10-04');await f.click('repair-submit');assert.equal(f.calls.submit.length,0);f.set('repair-date',DAY);await f.click('repair-submit');assert.deepEqual(f.calls.submit[0],{kind:'repair',payload:{qcId:'qc-1',tanggal:DAY,jumlah:2}});
});
test('cancel requires explicit GUI confirmation and retains original repair identity',async()=>{
  const f=await chosen({module:'qc'});f.set('cancel-target',JSON.stringify(['repair','repair-original']));await f.click('cancel-submit');assert.equal(f.calls.submit.length,0);f.set('cancel-confirm',true);await f.click('cancel-submit');assert.deepEqual(f.calls.submit[0],{kind:'cancel',payload:{targetType:'repair',targetId:'repair-original',confirmed:true}});
});

test('changing the cancellation target requires a new confirmation for that record',async()=>{
  const f=await chosen({module:'qc'});f.set('cancel-target',JSON.stringify(['repair','repair-original']));f.set('cancel-confirm',true);f.set('cancel-target',JSON.stringify(['inspect','qc-1']));f.find('cancel-target').handlers.get('change')();assert.equal(f.find('cancel-confirm').checked,false);await f.click('cancel-submit');assert.equal(f.calls.submit.length,0);f.set('cancel-confirm',true);await f.click('cancel-submit');assert.deepEqual(f.calls.submit[0].payload,{targetType:'inspect',targetId:'qc-1',confirmed:true});
});
test('gross wage uses frozen stored rates/totals with provisional label; missing wage is unavailable',async()=>{
  const absent=await chosen();assert.match(absent.text(),/Upah belum tersedia/);assert.doesNotMatch(absent.text(),/Upah kotor tercatat: Rp 0/);
  const c=cycle();c.wage={availability:'available',workerId:'worker-1',entries:[{tanggal:DAY,jumlah:3,tarif:100,total:300,provisional:true}]};const f=await chosen({stateCycle:c});assert.match(f.text(),/Upah kotor tercatat: Rp 300/);assert.match(f.text(),/3 pcs × Rp 100/);assert.match(f.text(),/menunggu QC/);assert.match(f.text(),/belum menunjukkan pembayaran atau potongan/);
});

test('foreign worker wage and owner wage are held without showing rates or amounts',async()=>{
  const c=cycle();c.wage={availability:'available',workerId:'worker-2',entries:[{tanggal:DAY,jumlah:3,tarif:321,total:963,provisional:false}]};const foreign=await chosen({stateCycle:c});assert.match(foreign.text(),/Upah belum tersedia/);assert.doesNotMatch(foreign.text(),/Rp 963|Rp 321/);
  const ownerCycle=cycle();ownerCycle.wage={...c.wage,workerId:'worker-1'};const owner=await chosen({stateCycle:ownerCycle});owner.emit({...owner.state(),profile:{active:true,owner:true}});assert.match(owner.text(),/Upah belum tersedia/);assert.doesNotMatch(owner.text(),/Rp 963|Rp 321/);
});
test('dispose erases only its business view, retains replacement login and cannot render again',async()=>{
  const f=await chosen(),login=new Element('button');login.textContent='Login replacement';f.host.appendChild(login);f.mounted.dispose();f.mounted.dispose();assert.deepEqual(f.host.children,[login]);assert.equal(f.calls.disposed,1);f.emit(f.state());assert.deepEqual(f.host.children,[login]);
});
test('real controller connects, generates IDs once and prepares exact sewing before send',async()=>{
  const f=await chosen({real:true});sewing(f,'4','0');await f.click('sewing-submit');assert.equal(f.calls.ids,1);assert.equal(f.calls.prepared.length,1);const cmd=f.calls.prepared[0];assert.deepEqual(cmd,{requestId:'request-synthetic-generated-id',productId:'product-1',cycleId:'cycle-1',expectedRevision:0,kind:'sewing',payload:{id:'entity-synthetic-generated-id',assignmentId:'assignment-1',tanggal:DAY,good:4,reject:0}});assert.deepEqual(f.calls.sent,[cmd.requestId]);assert.match(f.text(),/Tersimpan melalui layanan pusat/);
});
