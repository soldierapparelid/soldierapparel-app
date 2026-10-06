'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const UI=require('../production-owner-tariff-ui.js');
const copy=v=>JSON.parse(JSON.stringify(v));
class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attributes=new Map();this.handlers=new Map();this.textContent='';this.value='';this.disabled=false;this.checked=false;}
  appendChild(node){this.children.push(node);node.parentNode=this;return node;}
  replaceChildren(...nodes){for(const node of this.children)node.parentNode=null;this.children=[];for(const node of nodes)this.appendChild(node);}
  setAttribute(k,v){this.attributes.set(k,String(v));}removeAttribute(k){this.attributes.delete(k);}getAttribute(k){return this.attributes.get(k)??null;}
  addEventListener(k,fn){this.handlers.set(k,fn);}remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null;}}
  set innerHTML(_){throw Error('Unsafe insertion');}
}
const all=node=>[node,...node.children.flatMap(all)];
const scope=()=>({projectId:'demo-owner-tariff',databaseURL:'https://demo-owner-tariff.firebaseio.com',tenantId:'tenant-1',uid:'owner-1',grantRevision:2});
const view=()=>({schemaVersion:1,projectId:scope().projectId,tenantId:scope().tenantId,uid:scope().uid,grantRevision:2,productId:'product-1',cycleId:'cycle-1',configRevision:1,tariffRevision:3,serverTime:'2026-10-06T00:00:00.000Z',policy:{version:'rate-policy-1',kind:'jakarta-fixed-local-time',hour:8,minute:30},workers:[{workerId:'worker-1',label:'<img src=x onerror=alert(1)>',assignedQuantity:20,history:[{tariffVersion:'original',effectiveAt:'2026-10-01T00:00:00.000Z',currency:'IDR',rate:1000}]}]});
const original=()=>({kind:'appendTariffVersion',requestId:'original-request',tariffVersion:'original-version',productId:'product-1',cycleId:'cycle-1',expectedConfigRevision:1,expectedTariffRevision:3,workerId:'worker-1',effectiveAt:'2026-10-07T00:00:00.000Z',currency:'IDR',rate:1200});
function fixture({owner=true,initialPending=[],current=true,sendResult={ok:true},resolveResult,prepareResult={ok:true},viewResult,cyclesResult,pendingResult}={}){
  const calls={connect:0,view:[],prepare:[],send:[],resolve:[],dispose:0,ids:0},control={current,sendResult,resolveResult,prepareResult,viewResult,pendingResult},host=new Element('main'),pending=copy(initialPending);let callbacks;
  const document={createElement:tag=>new Element(tag),defaultView:{crypto:{getRandomValues(values){calls.ids++;values.fill(calls.ids);return values;}}}};
  const bridge={async connect(){calls.connect++;return {ok:true,scope:scope(),profile:{owner},cycles:cyclesResult||[{productId:'product-1',cycleId:'cycle-1'}]};},async view(selection){calls.view.push(copy(selection));return typeof control.viewResult==='function'?control.viewResult():control.viewResult||{ok:true,view:view()};},async pending(){return control.pendingResult||{ok:true,commands:copy(pending)};},async prepare(command){calls.prepare.push(copy(command));const result=typeof control.prepareResult==='function'?await control.prepareResult():control.prepareResult;if(result.ok===true&&!pending.some(c=>c.requestId===command.requestId))pending.push(copy(command));return result;},async send(id){calls.send.push(id);const result=typeof control.sendResult==='function'?await control.sendResult():control.sendResult;if(result.ok===true){const at=pending.findIndex(c=>c.requestId===id);if(at!==-1)pending.splice(at,1);}return result;},async resolve(id){calls.resolve.push(id);const command=pending.find(c=>c.requestId===id);const result=typeof control.resolveResult==='function'?await control.resolveResult(command):control.resolveResult||{ok:true,outcome:'retired',receipt:{requestId:id,kind:'retireTariffDraft',productId:command.productId,cycleId:command.cycleId,workerId:command.workerId,tariffVersion:command.tariffVersion,retiredAt:'2026-10-08T00:00:00.000Z'},replayed:false};if(result.ok===true&&require('../production-owner-tariff-client.js').validateResolution(result,command)){const at=pending.findIndex(c=>c.requestId===id);if(at!==-1)pending.splice(at,1);}return result;},dispose(){calls.dispose++;}};
  const mounted=UI.mount({document,host,createBridge(value){callbacks=value;return bridge;},isCurrent:()=>control.current});
  const find=id=>all(host).find(n=>n.id===id),text=()=>all(host).map(n=>n.textContent).join(' '),set=(id,value)=>{const node=find(id);assert.ok(node,id);if(node.type==='checkbox')node.checked=value;else node.value=value;};
  async function drain(){for(let i=0;i<60;i++)await Promise.resolve();}
  async function click(id){assert.ok(find(id),id);find(id).handlers.get('click')();await drain();}
  async function chooseCycle(){set('owner-tariff-cycle',JSON.stringify(['product-1','cycle-1']));find('owner-tariff-cycle').handlers.get('change')();await drain();}
  async function chooseWorker(){set('owner-tariff-worker','worker-1');find('owner-tariff-worker').handlers.get('change')();await drain();}
  return {mounted,calls,control,host,find,text,set,click,chooseCycle,chooseWorker,drain,clear:()=>callbacks.onClear(),pending:()=>pending};
}
async function chosen(options){const f=fixture(options);assert.equal((await f.mounted.ready).ok,true);await f.chooseCycle();await f.chooseWorker();return f;}
function fill(f,value='1200',when='2026-10-07T07:00'){f.set('owner-tariff-rate',value);f.set('owner-tariff-effective',when);f.set('owner-tariff-confirm',true);}

test('owner UI requires verified owner and explicit product/worker selection',async()=>{
  const rejected=fixture({owner:false});assert.equal((await rejected.mounted.ready).ok,false);assert.equal(rejected.host.children.length,0);assert.equal(rejected.calls.dispose,1);
  const f=fixture();await f.mounted.ready;assert.equal(f.find('owner-tariff-cycle').value,'');await f.click('owner-tariff-submit');assert.equal(f.calls.prepare.length,0);await f.chooseCycle();assert.equal(f.find('owner-tariff-worker').value,'');assert.equal(f.calls.view.length,1);assert.equal(f.calls.ids,0);
});

test('history preserves original tariff and uses text nodes for untrusted labels and Jakarta policy time',async()=>{
  const f=await chosen();assert.match(f.text(),/Rp 1\.000 \/ pcs/);assert.match(f.text(),/versi original/);assert.match(f.text(),/08:30 WIB/);assert.match(f.text(),/<img src=x onerror=alert\(1\)>/);assert.equal(all(f.host).some(n=>n.tagName==='IMG'),false);assert.equal(f.find('owner-tariff-effective').value,'2026-10-06T07:10');
});

test('Jakarta local date-time converts exactly to UTC and rejects rollovers/blank/timezones',()=>{
  assert.equal(UI.jakartaInstant('2026-10-07T07:00'),'2026-10-07T00:00:00.000Z');assert.equal(UI.jakartaInstant('2026-10-07T00:00'),'2026-10-06T17:00:00.000Z');
  for(const value of ['','2026-02-30T08:00','2026-10-07T24:00','2026-10-07T08:00Z','0000-01-01T08:00'])assert.throws(()=>UI.jakartaInstant(value));
});

test('new tariff creates one cryptographic identity and exact immutable command using reviewed revisions',async()=>{
  const f=await chosen();fill(f);await f.click('owner-tariff-submit');assert.equal(f.calls.ids,1);assert.equal(f.calls.prepare.length,1);assert.equal(f.calls.send.length,1);
  assert.deepEqual(f.calls.prepare[0],{kind:'appendTariffVersion',requestId:'tariff-'+ '01'.repeat(16),tariffVersion:'version-'+ '01'.repeat(16),productId:'product-1',cycleId:'cycle-1',expectedConfigRevision:1,expectedTariffRevision:3,workerId:'worker-1',effectiveAt:'2026-10-07T00:00:00.000Z',currency:'IDR',rate:1200});assert.match(f.text(),/Catatan upah lama tetap utuh/);assert.equal(f.pending().length,0);assert.match(f.text(),/Rp 1\.000/);
});

test('positive whole rupiah, safe assigned total, reviewed confirmation and future time are mandatory',async()=>{
  for(const [value,when] of [['','2026-10-07T07:00'],['0','2026-10-07T07:00'],['-1','2026-10-07T07:00'],['1.25','2026-10-07T07:00'],['1e3','2026-10-07T07:00'],['9007199254740991','2026-10-07T07:00'],['1200','2026-10-06T07:04'],['1200','2026-02-30T07:00']]){const f=await chosen();fill(f,value,when);await f.click('owner-tariff-submit');assert.equal(f.calls.prepare.length,0);assert.equal(f.calls.ids,0);}
  const f=await chosen();fill(f);f.set('owner-tariff-confirm',false);await f.click('owner-tariff-submit');assert.equal(f.calls.prepare.length,0);
});

test('unknown acknowledgment holds exact command and retries original ID/version/body despite changed form fields',async()=>{
  const f=await chosen({sendResult:{ok:false,error:'result_unknown',retrySameCommand:true}});fill(f);await f.click('owner-tariff-submit');const original=f.calls.prepare[0];assert.match(f.text(),/Hasil simpan belum pasti/);fill(f,'1400','2026-10-08T07:00');await f.click('owner-tariff-submit');assert.equal(f.calls.ids,1);
  const retry=all(f.host).find(n=>n.getAttribute('data-request-id')===original.requestId);assert.ok(retry);retry.handlers.get('click')();await f.drain();assert.deepEqual(f.calls.prepare,[original]);assert.deepEqual(f.calls.send,[original.requestId,original.requestId]);assert.equal(f.calls.ids,1);
});

test('unknown durable preparation is held in memory until identical prepare is proved, never sends early',async()=>{
  const f=await chosen({prepareResult:{ok:false,error:'unavailable',retrySameCommand:true}});fill(f);await f.click('owner-tariff-submit');const original=f.calls.prepare[0];assert.equal(f.calls.send.length,0);assert.ok(all(f.host).some(n=>n.getAttribute('data-request-id')===original.requestId));
  f.control.prepareResult={ok:true};const retry=all(f.host).find(n=>n.getAttribute('data-request-id')===original.requestId);retry.handlers.get('click')();await f.drain();assert.deepEqual(f.calls.prepare,[original,original]);assert.deepEqual(f.calls.send,[original.requestId]);assert.equal(f.calls.ids,1);
});

test('reload pending command blocks new tariff and retry never regenerates its identity',async()=>{
  const f=await chosen({initialPending:[original()]});fill(f,'1400');await f.click('owner-tariff-submit');assert.equal(f.calls.ids,0);assert.equal(f.calls.prepare.length,0);
  all(f.host).find(n=>n.getAttribute('data-request-id')==='original-request').handlers.get('click')();await f.drain();assert.deepEqual(f.calls.prepare,[]);assert.deepEqual(f.calls.send,['original-request']);assert.equal(f.calls.ids,0);
});

test('known conflict keeps original draft and never silently rebases current revision',async()=>{
  const f=await chosen({sendResult:{ok:false,error:'conflict'}});fill(f);await f.click('owner-tariff-submit');const old=f.calls.prepare[0];assert.match(f.text(),/Draf ditahan untuk diperiksa/);f.control.viewResult={ok:true,view:{...view(),tariffRevision:4}};await f.click('owner-tariff-refresh');
  all(f.host).find(n=>n.getAttribute('data-request-id')===old.requestId).handlers.get('click')();await f.drain();assert.deepEqual(f.calls.prepare,[old]);assert.equal(f.calls.ids,1);
});

test('rapid duplicate save/retry clicks cannot create additional commands',async()=>{
  let resolve;const waiting=new Promise(r=>{resolve=r;}),f=await chosen({sendResult:()=>waiting});fill(f);const action=f.find('owner-tariff-submit').handlers.get('click');action();action();await f.drain();assert.equal(f.calls.prepare.length,1);assert.equal(f.calls.ids,1);resolve({ok:false,error:'result_unknown',retrySameCommand:true});await f.drain();assert.equal(f.calls.send.length,1);
});

test('canonical revoke clears all amounts, history and drafts immediately and ignores late network completion',async()=>{
  let resolve;const waiting=new Promise(r=>{resolve=r;}),f=await chosen({sendResult:()=>waiting});fill(f);f.find('owner-tariff-submit').handlers.get('click')();await f.drain();f.clear();assert.equal(f.host.children.length,0);assert.equal(f.calls.dispose,1);resolve({ok:true});await f.drain();assert.equal(f.host.children.length,0);
});

test('account invalidation during view removes financial DOM and owner access error is terminal',async()=>{
  let resolve;const f=fixture({viewResult:()=>new Promise(r=>{resolve=r;})});await f.mounted.ready;f.set('owner-tariff-cycle',JSON.stringify(['product-1','cycle-1']));f.find('owner-tariff-cycle').handlers.get('change')();await f.drain();f.control.current=false;resolve({ok:true,view:view()});await f.drain();assert.equal(f.host.children.length,0);
  const denied=await chosen({sendResult:{ok:false,error:'access_denied'}});fill(denied);await denied.click('owner-tariff-submit');assert.equal(denied.host.children.length,0);
});

test('dense array and cycle validators reject getters without invoking them',async()=>{
  let reads=0;const cycles=[];Object.defineProperty(cycles,'0',{enumerable:true,get(){reads++;return {productId:'product-1',cycleId:'cycle-1'};}});const f=fixture({cyclesResult:cycles});assert.equal((await f.mounted.ready).ok,false);assert.equal(reads,0);assert.equal(f.host.children.length,0);
  const commands=[];Object.defineProperty(commands,'0',{enumerable:true,get(){reads++;return original();}});const bad=fixture({pendingResult:{ok:true,commands}});assert.equal((await bad.mounted.ready).ok,false);assert.equal(reads,0);
});

test('unreadable journal disables new tariff and fixed errors expose no raw exception details',async()=>{
  const f=fixture({pendingResult:{ok:false,error:'unavailable'}});assert.equal((await f.mounted.ready).ok,false);await f.chooseCycle();await f.chooseWorker();fill(f);await f.click('owner-tariff-submit');assert.equal(f.calls.ids,0);assert.equal(f.calls.prepare.length,0);
  const bad=await chosen({prepareResult:()=>{throw Error('private-token-example');}});fill(bad);await bad.click('owner-tariff-submit');assert.doesNotMatch(bad.text(),/private-token-example/);assert.match(bad.text(),/Draf yang sudah dibuat tetap dipertahankan/);
});

test('owner editor source never writes credentials, invokes payment or inserts raw HTML',()=>{
  const source=fs.readFileSync(require.resolve('../production-owner-tariff-ui.js'),'utf8');assert.doesNotMatch(source,/\.innerHTML\s*=|localStorage|sessionStorage|fetch\s*\(|signInWithPopup|setGrant|bayarJahit/);assert.match(source,/getRandomValues/);assert.match(source,/textContent/);
});

function closeControls(f,id='original-request'){return {approval:all(f.host).find(n=>n.getAttribute('data-resolve-confirm')===id),close:all(f.host).find(n=>n.getAttribute('data-resolve-request-id')===id)};}
async function closeDraft(f,id='original-request'){const {approval,close}=closeControls(f,id);assert.ok(approval);assert.ok(close);approval.checked=true;approval.handlers.get('change')();close.handlers.get('click')();await f.drain();}

test('draft closure requires the explicit explanation, checked control and owner click',async()=>{
  const f=await chosen({initialPending:[original()]});const {approval,close}=closeControls(f);assert.match(f.text(),/Jika sudah tersimpan, riwayat tetap ada\. Jika belum, server menutup draf agar tidak dikirim lagi\./);assert.equal(close.textContent,'Periksa dan akhiri draf');assert.equal(close.disabled,true);close.handlers.get('click')();await f.drain();assert.deepEqual(f.calls.resolve,[]);assert.equal(f.calls.prepare.length,0);
  approval.checked=true;approval.handlers.get('change')();assert.equal(close.disabled,false);assert.deepEqual(f.calls.resolve,[]);close.handlers.get('click')();await f.drain();assert.deepEqual(f.calls.resolve,['original-request']);assert.deepEqual(f.calls.prepare,[]);assert.equal(f.calls.send.length,0);assert.equal(f.calls.ids,0);
});

test('retired draft closes without adding a tariff, preserves history and refreshes revisions before new editing',async()=>{
  const f=await chosen({initialPending:[original()]});const calls=f.calls.view.length;await closeDraft(f);assert.match(f.text(),/Draf ditutup server\. Draf ini tidak menambahkan tarif/);assert.match(f.text(),/Rp 1\.000/);assert.equal(f.pending().length,0);assert.equal(f.calls.view.length,calls+1);assert.equal(f.find('owner-tariff-rate').value,'');assert.equal(f.find('owner-tariff-confirm').checked,false);assert.equal(f.find('owner-tariff-rate').parentNode.parentNode.disabled,false);assert.equal(f.calls.ids,0);assert.equal(f.calls.send.length,0);
  fill(f,'1400');await f.click('owner-tariff-submit');assert.equal(f.calls.ids,1);assert.equal(f.calls.prepare.at(-1).rate,1400);assert.notEqual(f.calls.prepare.at(-1).requestId,'original-request');
});

test('resolution of an already accepted draft reports the retained history without claiming cancellation',async()=>{
  const c=original(),f=await chosen({initialPending:[c],resolveResult:{ok:true,outcome:'accepted',receipt:{requestId:c.requestId,kind:c.kind,productId:c.productId,cycleId:c.cycleId,workerId:c.workerId,tariffVersion:c.tariffVersion,revision:4,acceptedAt:'2026-10-06T00:00:00.000Z'},replayed:true}});await closeDraft(f);assert.match(f.text(),/Tarif ini sudah tersimpan\. Riwayatnya tetap ada/);assert.doesNotMatch(f.text(),/Draf ditutup server|dibatalkan|dihapus/);assert.equal(f.pending().length,0);assert.equal(f.calls.send.length,0);
});

test('unknown resolution retains the same draft, prevents new tariff and requires another explicit checked click',async()=>{
  const f=await chosen({initialPending:[original()],resolveResult:{ok:false,error:'result_unknown',retrySameCommand:true}});await closeDraft(f);assert.match(f.text(),/Hasil simpan belum pasti/);assert.deepEqual(f.pending(),[original()]);assert.equal(closeControls(f).approval.checked,false);fill(f,'1400');await f.click('owner-tariff-submit');assert.equal(f.calls.ids,0);assert.equal(f.calls.prepare.length,0);assert.equal(f.calls.view.length,1);await closeDraft(f);assert.deepEqual(f.calls.prepare,[]);assert.deepEqual(f.calls.resolve,['original-request','original-request']);assert.equal(f.calls.send.length,0);
});

test('memory held draft must be durably prepared identically before closure and never resolves on uncertain storage',async()=>{
  const f=await chosen({prepareResult:{ok:false,error:'unavailable'}});fill(f);await f.click('owner-tariff-submit');const c=f.calls.prepare[0];await closeDraft(f,c.requestId);assert.deepEqual(f.calls.prepare,[c,c]);assert.deepEqual(f.calls.resolve,[]);assert.equal(f.calls.ids,1);f.control.prepareResult={ok:true};await closeDraft(f,c.requestId);assert.deepEqual(f.calls.prepare,[c,c,c]);assert.deepEqual(f.calls.resolve,[c.requestId]);assert.equal(f.calls.send.length,0);assert.equal(f.calls.ids,1);
});

test('malformed resolution stays pending and never announces a tariff was saved or closed',async()=>{
  const bad=[{ok:true},{ok:true,outcome:'retired',receipt:{requestId:'wrong'},replayed:false},{ok:true,outcome:'accepted',receipt:{},replayed:'yes'}];for(const result of bad){const f=await chosen({initialPending:[original()],resolveResult:result});await closeDraft(f);assert.match(f.text(),/Hasil simpan belum pasti/);assert.deepEqual(f.pending(),[original()]);assert.doesNotMatch(f.text(),/Draf ditutup server|Tarif ini sudah tersimpan/);assert.equal(f.calls.ids,0);}
});

test('revocation during resolution clears all financial DOM and disregards a late closure receipt',async()=>{
  let finish;const waiting=new Promise(r=>{finish=r;}),f=await chosen({initialPending:[original()],resolveResult:()=>waiting});const {approval,close}=closeControls(f);approval.checked=true;approval.handlers.get('change')();close.handlers.get('click')();await f.drain();assert.deepEqual(f.calls.resolve,['original-request']);f.clear();assert.equal(f.host.children.length,0);const c=original();finish({ok:true,outcome:'retired',receipt:{requestId:c.requestId,kind:'retireTariffDraft',productId:c.productId,cycleId:c.cycleId,workerId:c.workerId,tariffVersion:c.tariffVersion,retiredAt:'2026-10-09T00:00:00.000Z'},replayed:false});await f.drain();assert.equal(f.host.children.length,0);assert.equal(f.calls.dispose,1);
});

test('verified pending draft from an inactive cycle can retry or resolve without preparing it against the current manifest',async()=>{
  const f=fixture({cyclesResult:[],initialPending:[original()],prepareResult:{ok:false,error:'conflict'},sendResult:{ok:false,error:'not_ready'}});assert.equal((await f.mounted.ready).ok,true);assert.equal(f.calls.view.length,0);all(f.host).find(n=>n.getAttribute('data-request-id')==='original-request').handlers.get('click')();await f.drain();assert.deepEqual(f.calls.send,['original-request']);assert.deepEqual(f.calls.prepare,[]);assert.deepEqual(f.pending(),[original()]);await closeDraft(f);assert.deepEqual(f.calls.resolve,['original-request']);assert.deepEqual(f.calls.prepare,[]);assert.equal(f.pending().length,0);assert.equal(f.calls.ids,0);assert.equal(f.calls.view.length,0);assert.match(f.text(),/Draf ditutup server/);
});
