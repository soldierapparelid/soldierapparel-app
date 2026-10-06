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
function fixture({owner=true,initialPending=[],current=true,sendResult={ok:true},prepareResult={ok:true},viewResult,cyclesResult,pendingResult}={}){
  const calls={connect:0,view:[],prepare:[],send:[],dispose:0,ids:0},control={current,sendResult,prepareResult,viewResult,pendingResult},host=new Element('main'),pending=copy(initialPending);let callbacks;
  const document={createElement:tag=>new Element(tag),defaultView:{crypto:{getRandomValues(values){calls.ids++;values.fill(calls.ids);return values;}}}};
  const bridge={async connect(){calls.connect++;return {ok:true,scope:scope(),profile:{owner},cycles:cyclesResult||[{productId:'product-1',cycleId:'cycle-1'}]};},async view(selection){calls.view.push(copy(selection));return typeof control.viewResult==='function'?control.viewResult():control.viewResult||{ok:true,view:view()};},async pending(){return control.pendingResult||{ok:true,commands:copy(pending)};},async prepare(command){calls.prepare.push(copy(command));const result=typeof control.prepareResult==='function'?await control.prepareResult():control.prepareResult;if(result.ok===true&&!pending.some(c=>c.requestId===command.requestId))pending.push(copy(command));return result;},async send(id){calls.send.push(id);const result=typeof control.sendResult==='function'?await control.sendResult():control.sendResult;if(result.ok===true){const at=pending.findIndex(c=>c.requestId===id);if(at!==-1)pending.splice(at,1);}return result;},dispose(){calls.dispose++;}};
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
  const retry=all(f.host).find(n=>n.getAttribute('data-request-id')===original.requestId);assert.ok(retry);retry.handlers.get('click')();await f.drain();assert.deepEqual(f.calls.prepare,[original,original]);assert.deepEqual(f.calls.send,[original.requestId,original.requestId]);assert.equal(f.calls.ids,1);
});

test('unknown durable preparation is held in memory until identical prepare is proved, never sends early',async()=>{
  const f=await chosen({prepareResult:{ok:false,error:'unavailable',retrySameCommand:true}});fill(f);await f.click('owner-tariff-submit');const original=f.calls.prepare[0];assert.equal(f.calls.send.length,0);assert.ok(all(f.host).some(n=>n.getAttribute('data-request-id')===original.requestId));
  f.control.prepareResult={ok:true};const retry=all(f.host).find(n=>n.getAttribute('data-request-id')===original.requestId);retry.handlers.get('click')();await f.drain();assert.deepEqual(f.calls.prepare,[original,original]);assert.deepEqual(f.calls.send,[original.requestId]);assert.equal(f.calls.ids,1);
});

test('reload pending command blocks new tariff and retry never regenerates its identity',async()=>{
  const f=await chosen({initialPending:[original()]});fill(f,'1400');await f.click('owner-tariff-submit');assert.equal(f.calls.ids,0);assert.equal(f.calls.prepare.length,0);
  all(f.host).find(n=>n.getAttribute('data-request-id')==='original-request').handlers.get('click')();await f.drain();assert.deepEqual(f.calls.prepare,[original()]);assert.deepEqual(f.calls.send,['original-request']);assert.equal(f.calls.ids,0);
});

test('known conflict keeps original draft and never silently rebases current revision',async()=>{
  const f=await chosen({sendResult:{ok:false,error:'conflict'}});fill(f);await f.click('owner-tariff-submit');const old=f.calls.prepare[0];assert.match(f.text(),/Draf ditahan untuk diperiksa/);f.control.viewResult={ok:true,view:{...view(),tariffRevision:4}};await f.click('owner-tariff-refresh');
  all(f.host).find(n=>n.getAttribute('data-request-id')===old.requestId).handlers.get('click')();await f.drain();assert.deepEqual(f.calls.prepare,[old,old]);assert.equal(f.calls.ids,1);
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
