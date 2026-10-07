'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Codec=require('../legacy-owner-lifecycle-client.js'),Core=require('../server/production-legacy-lifecycle.cjs');
const {createOwnerLifecycleBrowserFixture:fixture}=require('./helpers/owner-lifecycle-browser-fixture.cjs');
const copy=v=>JSON.parse(JSON.stringify(v)),state=f=>f.states.at(-1),p=f=>f.native.root.soldier.produksi.produksi[0];
async function connect(f){const c=f.create();assert.equal((await c.connect()).ok,true);assert.equal(c.selectProduct('product-1').ok,true);return c;}
const edit=(more={})=>({recordId:'sewn-1',workerId:'worker-1',workDate:'2026-10-05',good:8,reject:0,amountMode:'stored',rate:null,total:null,...more});
const assignment=(more={})=>({assignmentId:'assignment-1',workerId:'worker-1',quantity:8,workDate:'2026-10-06',targetDate:null,note:'Reviewed assignment',...more});
test('owner maintenance DTOs agree with server schemas and reject arbitrary patches and credential fields',()=>{
  const base={requestId:'owner-request',operationId:'owner-operation',productId:'product-1',expectedGrantRevision:1,expectedSourceVersion:'a'.repeat(64)},forms={ownerEditAssignment:assignment(),ownerEditJahit:edit(),ownerAppendPaymentNote:{recordId:'new-payment',workDate:'2026-10-06'},ownerEditPaymentNote:{recordId:'old-payment',workDate:'2026-10-05'},ownerSetPaid:{recordId:'sewn-1',family:'jahit',paid:true,workDate:'2026-10-06',reviewed:true}};
  for(const [kind,data]of Object.entries(forms)){const cmd={kind,...base,...data};assert.deepEqual(Codec.normalizeLegacyOwnerLifecycleCommand(cmd),Core.normalizeLegacyOwnerLifecycleCommand(cmd));for(const field of ['uid','googleSubject','root','password','accessToken','changes','patch'])assert.throws(()=>Codec.normalizeLegacyOwnerLifecycleCommand({...cmd,[field]:'injected'}));}
  for(const change of [{amountMode:'stored',rate:2.5,total:20},{amountMode:'reviewed',rate:'2.5',total:20},{amountMode:'reviewed',rate:-1,total:20}])assert.throws(()=>Codec.normalizeLegacyOwnerLifecycleCommand({kind:'ownerEditJahit',...base,...edit(change)}));
});
test('maintenance projection is owner-only and excludes private metadata, account identifiers and raw row fields',async()=>{
  const f=fixture(),c=await connect(f),v=state(f).view;assert.equal(v.schemaVersion,2);assert.equal(v.maintenance.products[0].sewing[0].storedTotal,20);assert.equal(v.maintenance.products[0].sewing[0].storedRate,2.5);
  for(const marker of ['SYNTHETIC_PIN','SYNTHETIC_ROW_PRIVATE','SYNTHETIC_IMAGE','SYNTHETIC_CASH_PRIVATE','privateCost','googleSubject','email','kasbonJahit'])assert.equal(JSON.stringify(v).includes(marker),false);
  for(const role of ['jahit','qc']){const n=fixture(role);assert.equal((await n.create().connect()).error,'access_denied');assert.equal(n.native.stats.puts,0);}
  for(const change of [v=>v.maintenance.products[0].sewing[0].password='secret',v=>v.maintenance.products[0].sewing[0].workerLabel='different',v=>v.maintenance.products.push(copy(v.maintenance.products[0]))]){const bad=copy(v);change(bad);assert.throws(()=>Codec.normalizeLegacyOwnerLifecycleView(bad,v.binding));}c.dispose();
});
test('assignment edit keeps stored rates and wages while enforcing work already submitted',async()=>{
  const f=fixture(),money=copy(p(f).jahit),c=await connect(f);assert.equal((await c.submit('ownerEditAssignment',assignment())).ok,true);assert.deepEqual(p(f).jahit,money);assert.equal(p(f).assignJahit[0].ket,'Reviewed assignment');
  assert.equal((await c.submit('ownerEditAssignment',assignment({quantity:7}))).error,'conflict');assert.equal((await c.submit('ownerEditAssignment',assignment({workerId:'worker-2'}))).error,'conflict');assert.equal(f.native.stats.writes,1);c.dispose();
});
test('assignment addition uses a generated stable ID and cannot exceed available cutting capacity',async()=>{
  const f=fixture();p(f).potong[0].jumlah=12;const before=copy(p(f).potong),c=await connect(f),form={workerId:'worker-1',quantity:2,workDate:'2026-10-06',targetDate:'2026-10-10',note:''};assert.equal((await c.submit('ownerAppendAssignment',form)).ok,true);assert.deepEqual(p(f).potong,before);assert.equal(p(f).assignJahit.length,3);assert.match(p(f).assignJahit[2].id,/^assignment-/);assert.equal(p(f).assignJahit[2].sisa,2);assert.equal((await c.submit('ownerAppendAssignment',form)).error,'conflict');assert.equal(f.native.stats.writes,1);c.dispose();
});
test('a second assignment cannot make unlinked historical sewing ambiguous',async()=>{
  const f=fixture();delete p(f).jahit[0].assignmentId;p(f).potong[0].jumlah=12;const before=copy(p(f)),c=await connect(f);assert.equal((await c.submit('ownerAppendAssignment',{workerId:'worker-1',quantity:2,workDate:'2026-10-06',targetDate:null,note:''})).error,'conflict');assert.deepEqual(p(f),before);assert.equal(f.native.stats.puts,0);c.dispose();
});
test('date-only sewing correction retains anomalous historical financial values exactly',async()=>{
  const f=fixture();p(f).jahit[0].total=999.75;p(f).jahit[0].tarif='2.50';const before=copy(p(f).jahit[0]),c=await connect(f);assert.equal((await c.submit('ownerEditJahit',edit())).ok,true);const after=p(f).jahit[0];assert.equal(after.total,before.total);assert.equal(after.tarif,before.tarif);assert.equal(after.private,before.private);assert.equal(after.tanggal,'2026-10-05');c.dispose();
});
test('quantity or worker correction requires explicitly reviewed amounts; original values remain recoverable',async()=>{
  const f=fixture(),before=copy(p(f).jahit[0]),c=await connect(f);assert.equal((await c.submit('ownerEditJahit',edit({good:7}))).error,'conflict');assert.equal(f.native.stats.puts,0);assert.equal((await c.submit('ownerEditJahit',edit({good:7,amountMode:'reviewed',rate:2.5,total:19.25}))).ok,true);const after=p(f).jahit[0];assert.equal(after.total,19.25);assert.equal(after.tarif,2.5);assert.equal(after.amountCorrections[0].before.total,before.total);assert.equal(after.amountCorrections[0].before.jumlah,before.jumlah);assert.equal(after.private,before.private);assert.equal(p(f).assignJahit[0].sisa,1);c.dispose();
});
test('sewing correction cannot reduce the quantity underneath an accepted physical count',async()=>{
  const f=fixture(),count=f.native.f.cmd('appendCount','count-owner-test',{workerId:'worker-1',quantity:8,workDate:'2026-10-06'}),r=f.native.f.api.execute({root:f.native.root,identity:f.native.f.qc,command:count});assert.equal(r.ok,true);f.native.root=copy(r.next);const before=copy(p(f)),c=await connect(f);assert.equal((await c.submit('ownerEditJahit',edit({good:7,amountMode:'reviewed',rate:2.5,total:17.5}))).error,'conflict');assert.deepEqual(p(f),before);assert.equal(f.native.stats.puts,0);c.dispose();
});
test('adding sewing selects an exact assignment and never copies another partner rate',async()=>{
  const f=fixture();p(f).jahit[0].jumlah=7;p(f).jahit[0].lolos=7;p(f).jahit[0].total=17.5;p(f).assignJahit[0].sisa=1;const c=await connect(f);assert.equal((await c.submit('ownerAppendJahit',{assignmentId:'assignment-1',workerId:'worker-1',workDate:'2026-10-06',good:1,reject:0,amountMode:'reviewed',rate:2.5,total:2.5})).ok,true);const added=p(f).jahit.at(-1);assert.equal(added.assignmentId,'assignment-1');assert.equal(added.tukangId,'worker-1');assert.equal(added.tarif,2.5);assert.equal(added.total,2.5);assert.equal(p(f).assignJahit[0].sisa,0);assert.equal(p(f).jahit[1].tarif,99);c.dispose();
});
test('a paid marker blocks sewing correction and clearing it retains the earlier payment evidence',async()=>{
  const f=fixture(),c=await connect(f),paid={recordId:'sewn-1',family:'jahit',paid:true,workDate:'2026-10-06',reviewed:true};assert.equal((await c.submit('ownerSetPaid',paid)).ok,true);const date=p(f).jahit[0].dibayarAt;assert.equal((await c.submit('ownerEditJahit',edit())).error,'conflict');assert.equal((await c.submit('ownerSetPaid',{...paid,paid:false,workDate:null})).ok,true);const row=p(f).jahit[0];assert.equal(row.dibayar,false);assert.equal(Object.hasOwn(row,'dibayarAt'),false);assert.equal(row.paymentCorrections[1].before.dibayar,true);assert.equal(row.paymentCorrections[1].before.dibayarAt,date);assert.equal((await c.submit('ownerEditJahit',edit())).ok,true);assert.equal(f.native.stats.writes,3);c.dispose();
});
test('payment date note preserves nominal fields and never marks sewing records paid',async()=>{
  const f=fixture();p(f).bayarJahit=[{id:'old-note',tanggal:'2026-10-06',nominal:999.75,private:'SYNTHETIC_PAYMENT_PRIVATE'}];const sewn=copy(p(f).jahit),c=await connect(f);assert.equal((await c.submit('ownerEditPaymentNote',{recordId:'old-note',workDate:'2026-10-05'})).ok,true);assert.equal(p(f).bayarJahit[0].nominal,999.75);assert.equal(p(f).bayarJahit[0].private,'SYNTHETIC_PAYMENT_PRIVATE');assert.deepEqual(p(f).jahit,sewn);assert.equal((await c.submit('ownerAppendPaymentNote',{workDate:'2026-10-06'})).ok,true);assert.equal(p(f).bayarJahit.length,2);assert.deepEqual(p(f).jahit,sewn);c.dispose();
});
test('lost payment acknowledgement survives reload and resolves without a second financial record',async()=>{
  const f=fixture(),a=await connect(f);f.controls.drop=q=>q.kind==='execute';assert.equal((await a.submit('ownerAppendPaymentNote',{workDate:'2026-10-06'})).error,'result_unknown');const pending=copy(state(f).pending[0]);a.dispose();f.controls.drop=null;const b=await connect(f);assert.deepEqual(state(f).pending,[pending]);assert.equal((await b.retry(pending.requestId)).replayed,true);assert.equal(p(f).bayarJahit.length,1);assert.equal(f.native.stats.puts,1);assert.equal(state(f).pending.length,0);b.dispose();
});
test('stale maintenance command cannot overwrite concurrent money or payment changes',async()=>{
  const f=fixture(),c=await connect(f);f.native.hooks.beforePut=()=>{p(f).jahit[0].total=987.75;};assert.equal((await c.submit('ownerEditAssignment',assignment())).error,'conflict');assert.equal(p(f).jahit[0].total,987.75);assert.equal(f.native.stats.writes,0);assert.equal(JSON.parse(f.journalValues()[0]).entries[0].phase,'rejected');c.dispose();
});
test('payment correction history capacity cannot delete or reset earlier evidence',async()=>{
  const f=fixture();p(f).jahit[0].paymentCorrections=Array.from({length:256},()=>({before:{dibayar:false}}));const before=copy(p(f)),c=await connect(f);assert.equal((await c.submit('ownerSetPaid',{recordId:'sewn-1',family:'jahit',paid:true,workDate:'2026-10-06',reviewed:true})).error,'capacity_limit');assert.deepEqual(p(f),before);assert.equal(f.native.stats.puts,0);c.dispose();
});
test('malformed historical row is retained for review and not silently converted into another worker record',async()=>{
  const f=fixture();p(f).jahit.push({id:'legacy-review-row',tanggal:'invalid',total:999.75});const before=copy(p(f).jahit),c=await connect(f);assert.equal(state(f).view.maintenance.products[0].needsReview,true);assert.equal(state(f).view.maintenance.products[0].sewing.some(r=>r.recordId==='legacy-review-row'),false);assert.deepEqual(p(f).jahit,before);c.dispose();
});
