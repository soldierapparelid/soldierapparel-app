'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Core=require('../server/production-legacy-operations.cjs');
const State=require('../server/production-identity-state.cjs');
const Merge=require('../production-sync.js');
const F=require('./fixtures/identity-tenant.cjs');
const POLICY={version:'legacy-jahit-current-v1',reviewed:true,timeZone:'Asia/Jakarta',quantityBasis:'good-plus-reject'};
function fixture(){
  const root={authorityTenants:{[F.TENANT]:F.copy(F.claimed())},soldier:{produksi:{images:{private:'SYNTHETIC_IMAGE'},unrelated:{retain:true},produksi:[
    {id:'product-1',poAktif:true,poJumlah:12,poTanggal:'2026-10-06',series:'Synthetic.Series',namaBarang:'Item',size:'M',privateCost:29,unknown:{retain:'SYNTHETIC_PRODUCT_PRIVATE'},arsip:[{id:'archive-1',jahit:[{id:'archived-row',tukangId:'worker-1',tarif:3,total:91,dibayar:true}],privatePayment:{preserve:true}}],potong:[{id:'cut-1',jumlah:12}],assignJahit:[{id:'assignment-1',tukangId:'worker-1',qty:10,sisa:10,unknown:true},{id:'assignment-2',tukangId:'worker-2',qty:2}],jahit:[{id:'old-1',assignmentId:'assignment-1',tukangId:'worker-1',jumlah:2,lolos:1,rijek:1,tanggal:'2026-10-05',tarif:2,total:87.5,dibayar:true,unknownMoney:{unchanged:13}},{id:'foreign-report',assignmentId:'assignment-2',tukangId:'worker-2',jumlah:1,lolos:1,rijek:0,tanggal:'2026-10-05',tarif:99,total:99}]},
    {id:'product-foreign',poAktif:true,series:'Hidden',namaBarang:'Hidden',size:'L',assignJahit:[{id:'foreign-assignment',tukangId:'worker-2',qty:4}],jahit:[],arsip:false}
  ]},produksi_meta:{tukangJahit:[{id:'worker-1',nama:'Synthetic partner',pin:'SYNTHETIC_OWN_PIN',tarif:{'Synthetic_Series|Item':7},tarifHistory:{'Synthetic_Series|Item':[{effectiveAt:'1970-01-01T00:00:00.000Z',rate:1}]}},{id:'worker-2',nama:'SYNTHETIC_OTHER_NAME',pin:'SYNTHETIC_OTHER_PIN',tarif:{'Synthetic_Series|Item':99}}],kasbonJahit:[{id:'advance-private',tukangId:'worker-2',nominal:999,private:'SYNTHETIC_ADVANCE'}]},gajiHarian:{private:'SYNTHETIC_DAILY'}},otherRoot:{private:'SYNTHETIC_OTHER_ROOT'}};
  const identity=F.identity(),binding={projectId:F.PROJECT,databaseURL:F.URL,tenantId:F.TENANT},control={time:F.NOW};
  const core=Core.createProductionLegacyOperations({enabled:true,binding,tariffPolicy:POLICY,clock:()=>control.time});
  const read=()=>core.read({root,identity});
  const cmd=()=>({kind:'appendJahit',requestId:'request-1',operationId:'operation-1',productId:'product-1',assignmentId:'assignment-1',expectedGrantRevision:1,expectedSourceVersion:read().view.products[0].sourceVersion,workDate:null,good:2,reject:1});
  return {root,identity,binding,control,core,read,cmd,p:()=>root.soldier.produksi.produksi[0],append:command=>core.append({root,identity,command})};
}
const api=(f,method,root,command)=>f.core[method]({root,identity:f.identity,command});
test('OFF factory and methods inspect neither other option getters nor request getters',()=>{
  let invoked=0;const options={enabled:false};Object.defineProperty(options,'binding',{enumerable:true,get(){invoked++;throw Error('private');}});
  const request=new Proxy({}, {ownKeys(){invoked++;throw Error('private');},get(){invoked++;throw Error('private');}});
  const core=Core.createProductionLegacyOperations(options);for(const k of ['read','append','resolve','capture'])assert.deepEqual(core[k](request),{ok:false,error:'service_disabled'});assert.equal(invoked,0);
});
test('policy is explicit reviewed and fixed; missing/unreviewed/time-zone overrides cannot enable',()=>{
  const f=fixture();for(const policy of [undefined,{...POLICY,reviewed:false},{...POLICY,timeZone:'UTC'},{...POLICY,version:'automatic-history'},{...POLICY,extra:true}]){
    const c=Core.createProductionLegacyOperations({enabled:true,binding:f.binding,clock:()=>F.NOW,tariffPolicy:policy});assert.deepEqual(c.read({root:f.root,identity:f.identity}),{ok:false,error:'unavailable'});
  }
});
test('own operational manifest is quantity-only, bound to current v2 identity, and preserves input',()=>{
  const f=fixture(),before=F.copy(f.root),r=f.read();assert.equal(r.ok,true);assert.equal(r.view.products.length,1);
  assert.deepEqual(r.view.products[0].assignments,[{assignmentId:'assignment-1',assigned:10,reportedGood:1,reportedReject:1,remaining:8}]);
  assert.deepEqual(r.view.binding,{...f.binding,uid:'partner-1',workerId:'worker-1',division:'jahit',grantRevision:1});
  const encoded=JSON.stringify(r);for(const marker of ['worker-2','foreign-report','foreign-assignment','product-foreign','SYNTHETIC_OTHER','tarif','total','payroll','kasbon','privateCost','unknownMoney',F.EMAIL,'enrollmentRegistry','googleSubject'])assert.equal(encoded.includes(marker),false,marker);
  assert.deepEqual(f.root,before);assert.equal(Object.isFrozen(r.view.products[0]),true);
});
test('source version ignores every private money and foreign-report change',()=>{
  const f=fixture(),before=f.read().view.products[0].sourceVersion;f.p().privateCost=733;f.p().jahit[1].total=699;f.p().jahit[0].total=922;f.root.soldier.produksi_meta.kasbonJahit[0].nominal=882;f.root.soldier.produksi_meta.tukangJahit[0].tarif['Synthetic_Series|Item']=12;f.p().arsip[0].jahit[0].total=192;
  assert.equal(f.read().view.products[0].sourceVersion,before);
});
test('private capture retains complete immutable initialization/catalog/grant without source publication',()=>{
  const f=fixture(),r=f.core.capture({root:f.root,identity:f.identity});assert.equal(r.ok,true);assert.equal(Object.hasOwn(r.context,'initialization'),true);assert.equal(Object.isFrozen(r.context.grant.profile),true);assert.equal(Object.hasOwn(r.context,'soldier'),false);assert.equal(Object.hasOwn(r.context,'enrollmentRegistry'),false);
});
test('append freezes exact current legacy rate, never historical date tariff, and updates only new row/cache/receipt',()=>{
  const f=fixture(),before=F.copy(f.root),cmd={...f.cmd(),workDate:'2026-10-01'},r=f.append(cmd);assert.equal(r.ok,true);assert.deepEqual(r.receipt,{ok:true,replayed:false,operationId:'operation-1'});
  const p=r.next.soldier.produksi.produksi[0],row=p.jahit.at(-1);assert.equal(row.tarif,7);assert.equal(row.total,14);assert.equal(row.tanggal,'2026-10-01');assert.equal(row.inputAt,F.NOW);assert.equal(row.quantityBasis,'good-plus-reject');assert.equal(row.jumlah,3);assert.equal(row.dibayar,false);assert.equal(row.tukangId,'worker-1');assert.equal(p.assignJahit[0].sisa,5);
  assert.deepEqual(p.jahit.slice(0,-1),before.soldier.produksi.produksi[0].jahit);assert.deepEqual(p.arsip,before.soldier.produksi.produksi[0].arsip);assert.deepEqual(p.privateCost,before.soldier.produksi.produksi[0].privateCost);assert.deepEqual(p.assignJahit[1],before.soldier.produksi.produksi[0].assignJahit[1]);
  assert.deepEqual(r.next.authorityTenants,before.authorityTenants);assert.deepEqual(r.next.soldier.produksi_meta,before.soldier.produksi_meta);assert.deepEqual(r.next.soldier.gajiHarian,before.soldier.gajiHarian);assert.deepEqual(r.next.otherRoot,before.otherRoot);assert.deepEqual(f.root,before);
  const ledger=r.next.legacyOperationReceipts[F.TENANT];assert.equal(ledger.commands['request-1'].operationId,'operation-1');assert.equal(Object.hasOwn(r.next.authorityTenants[F.TENANT],'products'),false);
});
test('default work date uses fixed Jakarta calendar independently of process timezone',()=>{
  const f=fixture(),cmd=f.cmd();f.control.time='2026-10-06T18:10:00.000Z';f.identity=F.identity({verifiedAt:f.control.time,issuedAtMs:Date.parse(f.control.time)-1000,authTimeMs:Date.parse(f.control.time)-1000,expiresAtMs:Date.parse(f.control.time)+3600000});
  const c=f.core.read({root:f.root,identity:f.identity}).view.products[0];const r=f.core.append({root:f.root,identity:f.identity,command:{...cmd,expectedSourceVersion:c.sourceVersion}});assert.equal(r.ok,true);assert.equal(r.next.soldier.produksi.produksi[0].jahit.at(-1).tanggal,'2026-10-07');
});
test('current raw-key fallback exactly follows old append when sanitized key is zero',()=>{
  const f=fixture(),w=f.root.soldier.produksi_meta.tukangJahit[0];w.tarif={'Synthetic_Series|Item':0,'Synthetic.Series|Item':9};const r=f.append(f.cmd());assert.equal(r.ok,true);assert.equal(r.next.soldier.produksi.produksi[0].jahit.at(-1).tarif,9);
});
test('fractional stored current rate is frozen without rounding; all-reject new row has zero total',()=>{
  const f=fixture();f.root.soldier.produksi_meta.tukangJahit[0].tarif['Synthetic_Series|Item']=7.25;let r=f.append(f.cmd());assert.equal(r.ok,true);assert.equal(r.next.soldier.produksi.produksi[0].jahit.at(-1).total,14.5);
  r=f.append({...f.cmd(),good:0,reject:1});assert.equal(r.ok,true);assert.equal(r.next.soldier.produksi.produksi[0].jahit.at(-1).total,0);
});
test('immutable request replay and resolve produce exactly one existing operation, no new facts',()=>{
  const f=fixture(),cmd=f.cmd(),first=f.append(cmd);assert.equal(first.ok,true);const repeated=api(f,'append',first.next,cmd),resolved=api(f,'resolve',first.next,cmd);assert.equal(repeated.ok,true);assert.equal(repeated.receipt.replayed,true);assert.deepEqual(repeated.next,first.next);assert.deepEqual(resolved,{ok:true,receipt:{ok:true,replayed:true,operationId:'operation-1'}});assert.equal(Object.hasOwn(resolved,'next'),false);
});
test('resolve missing receipt stays unknown and does not append',()=>{
  const f=fixture(),before=F.copy(f.root);assert.deepEqual(api(f,'resolve',f.root,f.cmd()),{ok:false,error:'result_unknown'});assert.deepEqual(f.root,before);
});
test('replay refuses modified payload even when reused request and operation IDs match',()=>{
  const f=fixture(),cmd=f.cmd(),first=f.append(cmd);for(const change of [{good:1},{workDate:'2026-10-05'},{operationId:'operation-other'},{expectedSourceVersion:'a'.repeat(64)}])assert.deepEqual(api(f,'append',first.next,{...cmd,...change}),{ok:false,error:'conflict'});
});
test('new operation identity collision in live, archive or durable ledger is never replayed',()=>{
  const f=fixture();for(const operationId of ['old-1','archived-row','foreign-report'])assert.deepEqual(f.append({...f.cmd(),operationId}),{ok:false,error:'conflict'});
  const cmd=f.cmd(),first=f.append(cmd);assert.deepEqual(api(f,'append',first.next,{...cmd,requestId:'new-request'}),{ok:false,error:'conflict'});
});
test('source revision and fresh remaining are rechecked against competing source changes',()=>{
  const f=fixture(),cmd=f.cmd();f.p().jahit[0].jumlah=3;f.p().jahit[0].lolos=2;assert.deepEqual(f.append(cmd),{ok:false,error:'conflict'});
  const q=fixture();assert.deepEqual(q.append({...q.cmd(),good:9,reject:0}),{ok:false,error:'conflict'});
});
test('PO close, new archive and reassignment invalidate original pending/replayed operation',()=>{
  for(const kind of ['close','archive','reassign','assignment-quantity']){
    const f=fixture(),cmd=f.cmd(),first=f.append(cmd),root=F.copy(first.next),p=root.soldier.produksi.produksi[0];
    if(kind==='close')p.poAktif=false;if(kind==='archive')p.arsip.push({id:'new-archive',privateTotal:82});if(kind==='reassign')p.assignJahit[0].tukangId='worker-2';if(kind==='assignment-quantity')p.assignJahit[0].qty=11;
    const r=api(f,'resolve',root,cmd);assert.equal(r.ok,false);assert.ok(['conflict','access_denied','not_ready'].includes(r.error));
  }
});
test('owner modification/deletion of the new row is not silently recreated by replay',()=>{
  for(const kind of ['change','delete']){const f=fixture(),cmd=f.cmd(),first=f.append(cmd),root=F.copy(first.next),p=root.soldier.produksi.produksi[0];if(kind==='change')p.jahit.at(-1).total=121;else p.jahit.pop();const r=api(f,'append',root,cmd);assert.equal(r.ok,false);assert.equal(root.soldier.produksi.produksi[0].jahit.length,kind==='delete'?2:3);}
});
test('unrelated legitimate root changes survive receipt confirmation and append',()=>{
  const f=fixture(),cmd=f.cmd(),first=f.append(cmd),root=F.copy(first.next);root.otherRoot.newField={preserve:'not selected'};root.soldier.gajiHarian.other=53;const r=api(f,'resolve',root,cmd);assert.equal(r.ok,true);
  const nextCmd={...cmd,requestId:'request-2',operationId:'operation-2',expectedSourceVersion:f.core.read({root,identity:f.identity}).view.products[0].sourceVersion};const next=api(f,'append',root,nextCmd);assert.equal(next.ok,true);assert.deepEqual(next.next.otherRoot,root.otherRoot);assert.deepEqual(next.next.soldier.gajiHarian,root.soldier.gajiHarian);
});
test('retained revocation is effective before read, append, resolve and private capture',()=>{
  const f=fixture(),cmd=f.cmd(),first=f.append(cmd),root=F.copy(first.next);root.authorityTenants[F.TENANT]=F.copy(State.revokeIdentityEnrollment(root.authorityTenants[F.TENANT],F.revokeCommand(),F.NOW).next);
  for(const method of ['read','capture'])assert.deepEqual(f.core[method]({root,identity:f.identity}),{ok:false,error:'access_denied'});for(const method of ['append','resolve'])assert.deepEqual(api(f,method,root,cmd),{ok:false,error:'access_denied'});
});
test('wrong project, replaced Google subject, expired identity, owner and QC are not partner authority',()=>{
  const f=fixture();for(const change of [{projectId:'demo-other'},{googleSubject:'2000999999'},{expiresAtMs:Date.parse(F.NOW)},{verifiedAt:F.AFTER},{uid:'owner-1'}])assert.equal(f.core.read({root:f.root,identity:F.identity(change)}).ok,false);
  const root=F.copy(f.root);const qc=F.identity({uid:'quality-1',email:F.QC_EMAIL,googleSubject:'2000123456789'});root.authorityTenants[F.TENANT]=F.copy(State.claimIdentityEnrollment(root.authorityTenants[F.TENANT],qc,F.NOW).next);assert.deepEqual(f.core.read({root,identity:qc}),{ok:false,error:'access_denied'});
});
test('orphan/manually altered v2 grant is rejected, never normalized into trusted state',()=>{
  const f=fixture();f.root.authorityTenants[F.TENANT].grants['partner-1'].profile.workerId='worker-2';const r=f.read();assert.equal(r.ok,false);assert.ok(['not_ready','access_denied'].includes(r.error));
});
test('caller may not select worker, tariff, money, role, device or arbitrary mutable payload',()=>{
  const f=fixture(),cmd=f.cmd();for(const change of [{workerId:'worker-2'},{rate:12},{total:12},{role:'owner'},{deviceInfo:'private'},{next:{}}])assert.deepEqual(f.append({...cmd,...change}),{ok:false,error:'invalid_request'});
});
test('invalid PCS/date/token-like IDs and stale grant revision fail without changing root',()=>{
  const f=fixture(),before=F.copy(f.root),cmd=f.cmd();for(const change of [{good:-1},{reject:0.1},{good:0,reject:0},{good:Number.MAX_SAFE_INTEGER,reject:1},{workDate:'2026-02-30'},{workDate:'2026-10-07'},{operationId:'../private'},{expectedGrantRevision:2}])assert.equal(f.append({...cmd,...change}).ok,false);assert.deepEqual(f.root,before);
});
test('missing/non-positive/coercion rates fail instead of using old history or request amounts',()=>{
  for(const value of [undefined,0,-1,'',{},'NaN',Infinity]){const f=fixture(),cmd=f.cmd();f.root.soldier.produksi_meta.tukangJahit[0].tarif=value===undefined?{}:{'Synthetic_Series|Item':value};const r=f.append(cmd);assert.equal(r.ok,false);}
});
test('map-shaped source preserves every original collection key/row and appends one new explicit ID key',()=>{
  const f=fixture(),p=f.p(),old=p.jahit;p.jahit={originalA:old[0],originalB:old[1]};const before=F.copy(p.jahit),r=f.append(f.cmd());assert.equal(r.ok,true);const rows=r.next.soldier.produksi.produksi[0].jahit;assert.deepEqual(rows.originalA,before.originalA);assert.deepEqual(rows.originalB,before.originalB);assert.equal(rows['operation-1'].id,'operation-1');assert.equal(Object.keys(rows).length,3);
});
test('ID-less old row is retained verbatim and never receives a fabricated identity',()=>{
  const f=fixture();delete f.p().jahit[0].id;const before=F.copy(f.p().jahit[0]),v=f.read();assert.equal(v.ok,true);assert.equal(v.view.products[0].hasUnlistedLegacy,true);assert.equal(v.view.products[0].reports.length,0);const r=f.append(f.cmd());assert.equal(r.ok,true);assert.deepEqual(r.next.soldier.produksi.produksi[0].jahit[0],before);assert.equal(Object.hasOwn(r.next.soldier.produksi.produksi[0].jahit[0],'id'),false);
});
test('name-only sewing, duplicate product/assignment/report IDs and archived reused assignment fail closed',()=>{
  for(const kind of ['name','product','assignment','report','archive']){const f=fixture();if(kind==='name'){delete f.p().jahit[0].tukangId;f.p().jahit[0].tukangNama='Synthetic partner';}if(kind==='product')f.root.soldier.produksi.produksi.push(F.copy(f.p()));if(kind==='assignment')f.p().assignJahit.push(F.copy(f.p().assignJahit[0]));if(kind==='report')f.p().jahit.push(F.copy(f.p().jahit[0]));if(kind==='archive')f.p().arsip[0].assignJahit=[F.copy(f.p().assignJahit[0])];assert.equal(f.read().ok,false);}
});
test('root descriptor codec invokes no getters/toJSON and rejects unsupported priority/sparse/cycle data',()=>{
  let hits=0;const value={};Object.defineProperty(value,'private',{enumerable:true,get(){hits++;return 'private';}});assert.throws(()=>Core.copyLegacyRoot(value));assert.equal(hits,0);
  const hooked={x:1};Object.setPrototypeOf(hooked,{toJSON(){hits++;return {};}});assert.throws(()=>Core.copyLegacyRoot(hooked));assert.equal(hits,0);
  for(const v of [{'.priority':1},{'.value':{}},{sparse:[,1]},{negative:-0},{value:NaN}])assert.throws(()=>Core.copyLegacyRoot(v));const cycle={};cycle.self=cycle;assert.throws(()=>Core.copyLegacyRoot(cycle));
});
test('new receipt/operation keys reject numeric-only IDs before SDK array normalization can strand replay',()=>{
  const f=fixture(),cmd=f.cmd();for(const change of [{requestId:'1'},{operationId:'1'}])assert.deepEqual(f.append({...cmd,...change}),{ok:false,error:'invalid_request'});
});
test('receipt binds immutable initialization/catalog provenance and rejects future timestamps',()=>{
  const f=fixture(),cmd=f.cmd(),first=f.append(cmd);let root=F.copy(first.next);root.authorityTenants[F.TENANT].initialization.bootstrapId='another-reviewed-bootstrap';assert.deepEqual(api(f,'resolve',root,cmd),{ok:false,error:'conflict'});
  root=F.copy(first.next);root.legacyOperationReceipts[F.TENANT].commands[cmd.requestId].createdAt=F.AFTER;assert.deepEqual(api(f,'resolve',root,cmd),{ok:false,error:'not_ready'});
});
test('root size cap is measured before returning candidates; no partial projection or append',()=>{
  const f=fixture();f.root.large='a'.repeat(Core.MAX_ROOT_BYTES);assert.deepEqual(f.read(),{ok:false,error:'capacity_limit'});assert.throws(()=>Core.serializeLegacyRoot(f.root),e=>e.code==='capacity_limit');
});
test('explicit product tombstones exclude still-present products and fence a pending append',()=>{
  for(const marker of ['["product-1"]',['product-1'],{0:'product-1'}]){const f=fixture(),cmd=f.cmd();f.root.soldier.produksi_deleted_ids=marker;assert.deepEqual(f.read().view.products,[]);assert.deepEqual(f.append(cmd),{ok:false,error:'conflict'});assert.equal(f.root.soldier.produksi.produksi.length,2);}
});
test('explicit removed-operation ID tombstones prohibit identity reuse across products',()=>{
  const f=fixture(),cmd=f.cmd();f.root.soldier.produksi_deletions=JSON.stringify({'removed-product|jahit|id:operation-1':123});assert.deepEqual(f.append(cmd),{ok:false,error:'conflict'});
});
test('explicit row tombstone controls own visible progress but keeps original money and raw marker string',()=>{
  const f=fixture(),before=F.copy(f.p().jahit[0]),raw=JSON.stringify({'product-1|jahit|id:old-1':123});f.root.soldier.produksi_deletions=raw;const view=f.read().view.products[0];assert.equal(view.assignments[0].remaining,10);assert.deepEqual(view.reports,[]);
  const r=f.append(f.cmd());assert.equal(r.ok,true);assert.equal(r.next.soldier.produksi_deletions,raw);assert.deepEqual(r.next.soldier.produksi.produksi[0].jahit[0],before);assert.equal(r.next.soldier.produksi.produksi[0].assignJahit[0].sisa,7);
});
test('owner product/created-row deletion after commit fences both replay and receipt resolve',()=>{
  for(const kind of ['product','row']){const f=fixture(),cmd=f.cmd(),first=f.append(cmd),root=F.copy(first.next);if(kind==='product')root.soldier.produksi_deleted_ids='["product-1"]';else root.soldier.produksi_deletions={'product-1|jahit|id:operation-1':123};for(const method of ['append','resolve'])assert.deepEqual(api(f,method,root,cmd),{ok:false,error:'conflict'});assert.equal(root.soldier.produksi.produksi[0].jahit.length,3);}
});
test('fingerprint/name/link tombstones never create operation identities or hide identified rows',()=>{
  const f=fixture(),cmd=f.cmd();f.root.soldier.produksi_deletions={'product-1|jahit|tanggal:2026-10-05|jumlah:2':123,'product-1|jahit|link:["old-1","operation-1"]':123,'product-1|jahit|Synthetic partner':123};assert.equal(f.read().view.products[0].assignments[0].remaining,8);assert.equal(f.append(cmd).ok,true);
});
test('duplicate-key and escaped-alias marker JSON fails before last-key deletion reinterpretation',()=>{
  for(const marker of ['{"product-1|jahit|id:operation-1":123,"product-1|jahit|id:operation-1":456}','{"product-1|jahit|id:operation-1":123,"product-1|jahit|id:oper\\u0061tion-1":456}']){const f=fixture();f.root.soldier.produksi_deletions=marker;assert.deepEqual(f.read(),{ok:false,error:'not_ready'});assert.equal(f.root.soldier.produksi_deletions,marker);}
  const f=fixture();f.root.soldier.produksi_deleted_ids='{"0":"product-1","\\u0030":"different-product"}';assert.deepEqual(f.read(),{ok:false,error:'not_ready'});
});
test('unsupported marker formats/values and bounds fail closed with preserved raw source',()=>{
  for(const [key,value]of [['produksi_deleted_ids','not-json'],['produksi_deleted_ids',true],['produksi_deleted_ids',{0:{id:'product-1'}}],['produksi_deletions',[]],['produksi_deletions',{'product-1|jahit|id:operation-1':'123'}]]){const f=fixture();f.root.soldier[key]=value;const before=F.copy(f.root);assert.equal(f.read().ok,false);assert.deepEqual(f.root,before);}
  const f=fixture();f.root.soldier.produksi_deleted_ids=JSON.stringify(['a'.repeat(256*1024)]);assert.deepEqual(f.read(),{ok:false,error:'capacity_limit'});
});
test('wrong or malformed private durable ledger fails instead of resetting or clearing commands',()=>{
  const f=fixture(),cmd=f.cmd();f.root.legacyOperationReceipts={[F.TENANT]:{schemaVersion:1,projectId:'demo-other',tenantId:F.TENANT,policyVersion:POLICY.version,commands:{}}};assert.deepEqual(f.append(cmd),{ok:false,error:'not_ready'});assert.equal(f.root.legacyOperationReceipts[F.TENANT].projectId,'demo-other');
});
test('server append remains intact through actual owner three-way merge; ID-less conflict never overwrites',()=>{
  const f=fixture(),base=F.copy(f.root.soldier.produksi.produksi),local=F.copy(base),cmd=f.cmd(),server=f.append(cmd).next.soldier.produksi.produksi;local[0].jahit.push({id:'owner-new',tukangId:'worker-1',assignmentId:'assignment-1',jumlah:1});const r=Merge.merge(base,local,server,{fields:['jahit','assignJahit']});assert.equal(r.ok,true);assert.equal(r.value[0].jahit.some(x=>x.id==='operation-1'),true);assert.equal(r.value[0].jahit.some(x=>x.id==='owner-new'),true);
  delete base[0].jahit[0].id;delete local[0].jahit[0].id;const raw=F.copy(server);delete raw[0].jahit[0].id;const closed=Merge.merge(base,local,raw,{fields:['jahit']});assert.equal(closed.ok,false);assert.equal(closed.value[0].jahit.some(x=>x.id==='operation-1'),true);
});
test('clock rollback and snapshot getter failures never expose source errors',()=>{
  const f=fixture();assert.equal(f.read().ok,true);f.control.time=F.BEFORE;assert.deepEqual(f.read(),{ok:false,error:'unavailable'});const root={};Object.defineProperty(root,'soldier',{enumerable:true,get(){throw Error('SYNTHETIC_PRIVATE');}});const r=f.core.read({root,identity:f.identity});assert.equal(JSON.stringify(r).includes('SYNTHETIC_PRIVATE'),false);
});
