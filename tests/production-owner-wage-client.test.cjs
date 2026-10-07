'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Client=require('../production-owner-wage-client.js'),Authority=require('../server/production-authority.cjs');
const PROJECT='demo-owner-wage-proof',DBURL='https://'+PROJECT+'.firebaseio.com',TENANT='tenant-1',UID='fixture-owner',NOW='2026-10-06T03:00:00.000Z',DAY='2026-10-06';
const modules=['potong','jahit','qc','laporan','stok','gaji','hpp','pembelian','nota','retur'],copy=v=>JSON.parse(JSON.stringify(v));
const selection=(workerId='worker-1',productId='product-1',cycleId='cycle-1')=>({productId,cycleId,workerId});
function projection(productId='product-1',cycleId='cycle-1',withWork=true){
  let state=Authority.createAuthority({product:{id:productId,series:'Synthetic',namaBarang:'Example',size:'M',cutQuantity:10},cycleId,workers:[{id:'worker-1',nama:'Synthetic one'},{id:'worker-2',nama:'Synthetic two'}],assignments:[{id:'assignment-1',workerId:'worker-1',qty:10}],now:NOW});
  const actor={uid:UID,emailVerified:true,provider:'google.com',profile:{active:true,owner:true},now:NOW};
  const step=(kind,payload,extra={})=>{state=Authority.applyCommand(state,{...actor,...extra},{requestId:'fixture-'+(state.revision+1),productId,cycleId,expectedRevision:state.revision,kind,payload}).state;};
  if(withWork){
    step('sewing',{id:'sewing-1',assignmentId:'assignment-1',tanggal:DAY,good:5,reject:0});
    step('count',{id:'count-1',assignmentId:'assignment-1',tanggal:DAY,jumlah:5},{selectedTariffs:{'count-1':{source:'private-verified-tariff',verified:true,workerId:'worker-1',productId,cycleId,countId:'count-1',workDate:DAY,basisAt:NOW,effectiveAt:'2026-01-01T00:00:00.000Z',tariffVersion:'tariff-1',currency:'IDR',rate:100,selectedAt:NOW}}});
  }
  return Authority.project(state);
}
function fixture({profile={active:true,owner:true},auto=true}={}){
  const session={schemaVersion:1,projectId:PROJECT,databaseURL:DBURL,tenantId:TENANT,uid:UID,grantRevision:3,profile:copy(profile),cycles:[{productId:'product-1',cycleId:'cycle-1'},{productId:'product-2',cycleId:'cycle-2'}],workerLabels:[{productId:'product-1',cycleId:'cycle-1',workers:[{workerId:'worker-1',label:'Synthetic one'},{workerId:'worker-2',label:'Synthetic two'}]},{productId:'product-2',cycleId:'cycle-2',workers:[{workerId:'worker-1',label:'Synthetic renamed one'},{workerId:'worker-2',label:'Synthetic two'}]}]};
  const gp='authorityTenants/'+TENANT+'/grants/'+UID,pp=gp+'/profile',cp='authorityTenants/'+TENANT+'/products/product-1/cycles/cycle-1/wire/projection',cp2='authorityTenants/'+TENANT+'/products/product-2/cycles/cycle-2/wire/projection';
  const p=projection(),p2=projection('product-2','cycle-2',false);
  const values=new Map([[pp+'/active',profile.active],[pp+'/owner',profile.owner],[pp+'/workerId',profile.workerId??null],...modules.map(m=>[pp+'/modules/'+m,profile.modules?.[m]??null]),[gp+'/revision',session.grantRevision]]);
  for(const [path,pr]of [[cp,p],[cp2,p2]]){values.set(path+'/operations',copy(pr.operations));values.set(path+'/revision',pr.revision);for(const [id,wage]of Object.entries(pr.earningsByWorker))values.set(path+'/earningsByWorker/'+id,copy(wage));}
  const listeners=[],paths=[],views=[],catalogs=[],clears=[],control={current:true,visible:null,catalog:null,checks:0};
  const subscription={subscribe(path,value,error){const record={path,value,error,closed:0,active:true};paths.push(path);listeners.push(record);if(auto)value(values.get(path));return ()=>{record.active=false;record.closed++;};}};
  const options={enabled:true,projectId:PROJECT,databaseURL:DBURL,tenantId:TENANT,uid:UID,session,subscription,isCurrent(binding){control.checks++;assert.equal(binding.uid,UID);assert.equal(binding.profile.owner,true);assert.ok(Object.isFrozen(binding)&&Object.isFrozen(binding.profile));return control.current;},onCatalog(v){catalogs.push(v);control.catalog=v;},onView(v){views.push(v);control.visible=v;},onClear(code){clears.push(code);control.visible=null;if(!['loading','selection_changed','selection_cleared'].includes(code))control.catalog=null;}};
  const create=(changes={})=>Client.createOwnerWageClient({...options,...changes});
  const emit=(path,value)=>{for(const l of [...listeners].filter(l=>l.active&&l.path===path))l.value(value);};
  const grants=()=>{for(const [path,v]of values)if(path.startsWith(gp+'/'))emit(path,v);};
  const business=base=>{for(const [path,v]of values)if(path.startsWith(base+'/'))emit(path,v);};
  return {session,p,p2,gp,pp,cp,cp2,values,listeners,paths,views,catalogs,clears,control,options,create,emit,grants,business};
}
function allClosed(f){assert.ok(f.listeners.every(l=>!l.active&&l.closed===1));}
function opened(){const f=fixture(),client=f.create();assert.equal(client.start(),true);assert.equal(client.select(selection()),true);return {f,client};}

test('source OFF opens no callbacks, identity checks or listeners, including executable supplied fields',()=>{
  const f=fixture(),client=f.create({enabled:false});assert.equal(client.start(),false);assert.equal(client.select(selection()),false);assert.equal(client.clearSelection(),false);client.dispose();assert.equal(f.paths.length,0);assert.equal(f.control.checks,0);assert.equal(f.clears.length,0);
  let touched=0;const options={};Object.defineProperty(options,'enabled',{get(){touched++;return true;}});assert.equal(Client.createOwnerWageClient(options).start(),false);assert.equal(touched,0);
});
test('owner requires an authenticated matching active session and complete worker catalog before reads',()=>{
  for(const mutate of [s=>s.profile.owner=false,s=>s.profile.active=false,s=>s.uid='foreign',s=>s.projectId='demo-foreign',s=>s.databaseURL='https://demo-foreign.firebaseio.com',s=>s.tenantId='foreign',s=>delete s.workerLabels,s=>s.workerLabels.pop(),s=>s.workerLabels[0].workers[0].rate=100]){
    const f=fixture();mutate(f.session);assert.equal(f.create().start(),false);assert.equal(f.paths.length,0);assert.equal(f.control.visible,null);assert.equal(f.clears.at(-1),'not_ready');
  }
});
test('partner, QC and token-like role fields cannot manufacture owner permission',()=>{
  for(const profile of [{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}},{active:true,owner:false,workerId:'worker-1',modules:{potong:true}},{active:true,owner:false,modules:{qc:true}},{active:true,owner:false,workerId:'worker-1',modules:{qc:true,jahit:true}}]){
    const f=fixture({profile});assert.equal(f.create().start(),false);assert.equal(f.paths.length,0);
  }
  const f=fixture();f.session.profile.tokenOwner=true;assert.equal(f.create().start(),false);assert.equal(f.paths.length,0);
});
test('catalog waits for all fourteen own grant leaves, reads no business data and is copied immutable',()=>{
  const f=fixture({auto:false}),client=f.create();assert.equal(client.start(),true);assert.equal(f.paths.length,14);assert.equal(client.select(selection()),false);assert.equal(f.catalogs.length,0);
  for(const [path,v]of f.values)if(path.startsWith(f.pp+'/'))f.emit(path,v);assert.equal(f.catalogs.length,0);f.emit(f.gp+'/revision',3);
  assert.equal(f.catalogs.length,1);assert.deepEqual(f.control.catalog,{cycles:f.session.workerLabels});assert.equal(f.paths.length,14);assert.ok(Object.isFrozen(f.control.catalog.cycles[0].workers[0]));
  f.session.workerLabels[0].workers[0].label='Mutated outside';assert.equal(f.control.catalog.cycles[0].workers[0].label,'Synthetic one');assert.equal(client.start(),false);client.dispose();allClosed(f);
});
test('optional canonical cycle labels provide copied presentation metadata without additional reads',()=>{
  const f=fixture();f.session.cycleLabels=f.session.cycles.map(c=>({...c,series:'Synthetic',namaBarang:'Example',size:'M'}));const client=f.create();assert.equal(client.start(),true);assert.equal(f.paths.length,14);assert.deepEqual(f.control.catalog.cycles[0].product,{series:'Synthetic',namaBarang:'Example',size:'M'});assert.ok(Object.isFrozen(f.control.catalog.cycles[0].product));
  f.session.cycleLabels[0].namaBarang='Outside mutation';assert.equal(f.control.catalog.cycles[0].product.namaBarang,'Example');assert.equal(client.select(selection()),true);assert.equal(f.control.visible.operations.namaBarang,'Example');
  const changed=copy(f.p.operations);changed.namaBarang='Different';f.emit(f.cp+'/operations',changed);assert.equal(f.clears.at(-1),'invalid_view');allClosed(f);
});
test('canonical empty and spaced product metadata stays exact without trimming or blocking valid wage records',()=>{
  const f=fixture(),metadata={series:' Synthetic ',namaBarang:'',size:'  '};f.session.cycleLabels=f.session.cycles.map(c=>({...c,...metadata}));
  for(const [path,original]of [...f.values]){
    if(path.endsWith('/operations'))f.values.set(path,{...copy(original),...metadata});
    if(path.includes('/earningsByWorker/')){const value=copy(original);for(const row of Object.values(value.entries||{}))Object.assign(row,metadata);f.values.set(path,value);}
  }
  const client=f.create();assert.equal(client.start(),true);assert.deepEqual(f.control.catalog.cycles[0].product,metadata);assert.equal(client.select(selection()),true);assert.equal(f.control.visible.summary.calculatedTotal,500);assert.equal(f.control.visible.operations.series,' Synthetic ');assert.equal(f.control.visible.earnings.entries[0].size,'  ');
});
test('one explicit selection reads exact operations, revision and one wage child; no ancestors or grants directory',()=>{
  const {f,client}=opened();assert.deepEqual(f.paths.slice(14),[f.cp+'/operations',f.cp+'/revision',f.cp+'/earningsByWorker/worker-1']);assert.equal(f.paths.length,17);
  const view=f.control.visible;assert.deepEqual(view.selection,selection());assert.equal(view.workerLabel,'Synthetic one');assert.equal(view.projectionRevision,2);assert.equal(view.availability,'available');assert.equal(view.summary.calculatedTotal,500);assert.equal(view.summary.provisionalTotal,500);assert.equal(view.summary.paymentEvidence,'not_in_this_data');assert.equal(view.consistency,'independent-listeners');assert.ok(Object.isFrozen(view)&&Object.isFrozen(view.earnings.entries[0]));
  assert.equal(Object.hasOwn(view.operations,'earningsByWorker'),false);assert.equal(f.paths.some(p=>p.endsWith('earningsByWorker')||p.endsWith('projection')||p.includes('privateAuthority')||p==='authorityTenants/'+TENANT),false);client.dispose();allClosed(f);
});
test('selection waits for operations, revision and wage independently and never presents a synchronized revision',()=>{
  const f=fixture({auto:false}),client=f.create();client.start();f.grants();assert.equal(client.select(selection()),true);assert.equal(f.views.length,0);
  f.emit(f.cp+'/earningsByWorker/worker-1',f.values.get(f.cp+'/earningsByWorker/worker-1'));f.emit(f.cp+'/revision',2);assert.equal(f.views.length,0);
  f.emit(f.cp+'/operations',f.values.get(f.cp+'/operations'));assert.equal(f.views.length,1);assert.equal(f.control.visible.consistency,'independent-listeners');
});
test('known unassigned worker can show a valid empty model without guessing assignment or substituting another wage',()=>{
  const f=fixture(),client=f.create();client.start();assert.equal(client.select(selection('worker-2')),true);assert.equal(f.control.visible.earnings.workerId,'worker-2');assert.equal(f.control.visible.availability,'available');assert.equal(f.control.visible.summary.calculatedTotal,0);assert.equal(f.control.visible.earnings.entries.length,0);assert.equal(f.paths.at(-1),f.cp+'/earningsByWorker/worker-2');
});
test('null wage is unavailable with null summary, can recover and does not display zero payment',()=>{
  const f=fixture();f.values.set(f.cp+'/earningsByWorker/worker-1',null);const client=f.create();client.start();client.select(selection());assert.equal(f.control.visible.availability,'unavailable');assert.equal(f.control.visible.earnings,null);assert.equal(f.control.visible.summary,null);assert.equal(f.control.visible.operations.id,'product-1');
  f.emit(f.cp+'/earningsByWorker/worker-1',copy(f.p.earningsByWorker['worker-1']));assert.equal(f.control.visible.availability,'available');assert.equal(f.control.visible.summary.calculatedTotal,500);f.emit(f.cp+'/earningsByWorker/worker-1',null);assert.equal(f.control.visible.summary,null);
});
test('forged cycle, worker, extra fields and getter selections clear previous data and unsubscribe before failing',()=>{
  let touched=0;const getter={productId:'product-1',cycleId:'cycle-1'};Object.defineProperty(getter,'workerId',{enumerable:true,get(){touched++;return 'worker-1';}});
  for(const value of [null,selection('missing'),selection('worker-1','product-1','cycle-2'),selection('worker-1','foreign','cycle-1'),selection('constructor'),{...selection(),tenantId:'foreign'},getter]){
    const {f,client}=opened(),reads=f.listeners.slice(14);assert.equal(client.select(value),false);assert.equal(f.control.visible,null);assert.equal(f.clears.at(-1),'selection_cleared');assert.ok(reads.every(l=>l.closed===1));assert.equal(f.listeners.filter(l=>l.active).length,14);assert.equal(client.select(selection()),true);
  }assert.equal(touched,0);
});
test('switching worker or cycle clears and closes earlier reads; all late value/error callbacks are ignored',()=>{
  const {f,client}=opened(),old=f.listeners.slice(14);assert.equal(client.select(selection('worker-2')),true);assert.ok(old.every(l=>l.closed===1));const before=f.views.length;
  for(const l of old){l.value({private:'late-invalid'});l.error(Error('synthetic confidential error'));}assert.equal(f.views.length,before);assert.equal(f.control.visible.earnings.workerId,'worker-2');assert.equal(f.clears.at(-1),'selection_changed');
  const prior=f.listeners.slice(17);assert.equal(client.select(selection('worker-1','product-2','cycle-2')),true);for(const l of prior){l.value(f.values.get(l.path));l.error();}assert.equal(f.control.visible.selection.productId,'product-2');assert.equal(f.control.visible.workerLabel,'Synthetic renamed one');assert.equal(f.control.visible.summary.calculatedTotal,0);
});
test('explicit clear leaves only grant listeners and old selection callbacks cannot restore money',()=>{
  const {f,client}=opened(),old=f.listeners.slice(14);assert.equal(client.clearSelection(),true);assert.equal(f.control.visible,null);assert.equal(f.clears.at(-1),'selection_cleared');assert.equal(f.listeners.filter(l=>l.active).length,14);const before=f.views.length;for(const l of old){l.value(f.values.get(l.path));l.error();}assert.equal(f.views.length,before);assert.equal(client.select(selection()),true);client.dispose();allClosed(f);
});
test('grant revision or profile changes terminally remove data and never reauthorize from browser values',()=>{
  for(const [suffix,value]of [['/revision',4],['/profile/active',false],['/profile/owner',false],['/profile/workerId','worker-1'],['/profile/modules/qc',true]]){
    const {f,client}=opened(),late=f.listeners.slice(14);f.emit(f.gp+suffix,value);assert.equal(f.clears.at(-1),'access_changed');assert.equal(f.control.visible,null);assert.equal(f.control.catalog,null);allClosed(f);assert.equal(client.select(selection()),false);for(const l of late)l.value(f.values.get(l.path));assert.equal(f.control.visible,null);
  }
});
test('stale initial grant values stop before catalog or business listeners, including null and coercion',()=>{
  for(const [suffix,value]of [['/revision',2],['/revision','3'],['/revision',null],['/profile/owner',1],['/profile/active',false],['/profile/modules/qc',false]]){
    const f=fixture();f.values.set(f.gp+suffix,value);assert.equal(f.create().start(),false);assert.equal(f.catalogs.length,0);assert.equal(f.paths.some(p=>p.includes('/products/')),false);allClosed(f);
  }
});
test('current identity requires literal true before start, selection and every active callback',()=>{
  for(const current of [false,1,'true']){const f=fixture();f.control.current=current;assert.equal(f.create().start(),false);assert.equal(f.paths.length,0);assert.equal(f.clears.at(-1),'account_changed');}
  for(const action of ['select','clear','callback']){const {f,client}=opened();f.control.current=false;if(action==='select')client.select(selection('worker-2'));else if(action==='clear')client.clearSelection();else f.emit(f.cp+'/revision',3);assert.equal(f.control.visible,null);assert.equal(f.clears.at(-1),'account_changed');allClosed(f);}
});
test('read denial never exposes exception text; terminal dispose is idempotent and ignores all later callbacks',()=>{
  const {f,client}=opened(),late=f.listeners.at(-1);late.error(Error('synthetic confidential exception'));assert.equal(f.clears.at(-1),'read_failed');assert.equal(JSON.stringify(f.clears).includes('confidential'),false);allClosed(f);late.value(f.values.get(late.path));assert.equal(f.control.visible,null);client.dispose();allClosed(f);
  const own=opened();own.client.dispose();own.client.dispose();assert.equal(own.f.clears.filter(c=>c==='disposed').length,1);allClosed(own.f);
});
test('wages reject foreign workers/products, fractional or modified amounts, private fields and unsupported sources',()=>{
  const mutations=[w=>w.workerId='worker-2',w=>Object.values(w.entries)[0].productId='product-2',w=>Object.values(w.entries)[0].tarif=100.5,w=>Object.values(w.entries)[0].total=1,w=>Object.values(w.entries)[0].pin='synthetic',w=>Object.values(w.entries)[0].sourceType='gudang',w=>Object.values(w.entries)[0].provisional='true'];
  for(const mutate of mutations){const {f}=opened(),w=copy(f.p.earningsByWorker['worker-1']);mutate(w);f.emit(f.cp+'/earningsByWorker/worker-1',w);assert.equal(f.clears.at(-1),'invalid_view');assert.equal(f.control.visible,null);allClosed(f);}
});
test('entry product metadata must match money-free operations without inferring worker identity from display names',()=>{
  for(const key of ['series','namaBarang','size']){const {f}=opened(),w=copy(f.p.earningsByWorker['worker-1']);Object.values(w.entries)[0][key]='Different';f.emit(f.cp+'/earningsByWorker/worker-1',w);assert.equal(f.clears.at(-1),'invalid_view');allClosed(f);}
  const {f}=opened(),w=copy(f.p.earningsByWorker['worker-1']);w.nama='Different presentation name';f.emit(f.cp+'/earningsByWorker/worker-1',w);assert.equal(f.control.visible.workerLabel,'Synthetic one');assert.equal(f.control.visible.earnings.workerId,'worker-1');
});
test('malformed/missing operations and decreasing or invalid revisions clear without fallback',()=>{
  for(const value of [null,{...projection().operations,tarif:100},{...projection().operations,id:'foreign'}]){const {f}=opened();f.emit(f.cp+'/operations',value);assert.equal(f.clears.at(-1),'invalid_view');allClosed(f);}
  for(const value of [1,-1,1.5,'3',null,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){const {f}=opened();f.emit(f.cp+'/revision',value);assert.equal(f.clears.at(-1),'invalid_view');allClosed(f);}
});
test('payload/session/subscription getters are never executed and oversized data is rejected',()=>{
  let touched=0;const f=fixture();Object.defineProperty(f.session.profile,'owner',{enumerable:true,get(){touched++;return true;}});assert.equal(f.create().start(),false);
  const sub={};Object.defineProperty(sub,'subscribe',{enumerable:true,get(){touched++;return ()=>()=>{};}});assert.equal(fixture().create({subscription:sub}).start(),false);
  const {f:active}=opened(),w=copy(active.p.earningsByWorker['worker-1']);Object.defineProperty(w,'workerId',{enumerable:true,get(){touched++;return 'worker-1';}});active.emit(active.cp+'/earningsByWorker/worker-1',w);assert.equal(active.clears.at(-1),'invalid_view');allClosed(active);assert.equal(touched,0);
  const {f:large}=opened(),op=copy(large.p.operations);op.series='x'.repeat(8*1024*1024+1);large.emit(large.cp+'/operations',op);assert.equal(large.clears.at(-1),'invalid_view');allClosed(large);
  const {f:unknown}=opened();unknown.emit(unknown.cp+'/earningsByWorker/worker-1',undefined);assert.equal(unknown.clears.at(-1),'invalid_view');allClosed(unknown);
});
test('callback failures and invalid subscribe handles stop and close all listeners',()=>{
  for(const callback of ['onCatalog','onView']){const f=fixture(),client=f.create({[callback]:()=>{throw Error('synthetic');}});const started=client.start();if(callback==='onView'){assert.equal(started,true);assert.equal(client.select(selection()),false);}else assert.equal(started,false);assert.equal(f.clears.at(-1),'callback_failed');allClosed(f);}
  const f=fixture();assert.equal(f.create({subscription:{subscribe:()=>null}}).start(),false);assert.equal(f.clears.at(-1),'read_failed');
});
test('a failing clear callback prevents new selection reads and closes the previous scope',()=>{
  const f=fixture();let rejectClear=false;const client=f.create({onClear(code){f.options.onClear(code);if(rejectClear&&code==='selection_changed')throw Error('synthetic');}});client.start();client.select(selection());const count=f.paths.length;rejectClear=true;assert.equal(client.select(selection('worker-2')),false);assert.equal(f.paths.length,count);assert.equal(f.clears.at(-1),'callback_failed');allClosed(f);
  const initial=fixture();assert.equal(initial.create({onClear(){throw Error('synthetic');}}).start(),false);assert.equal(initial.paths.length,0);
});
test('synchronous onView selection change closes the old in-progress handle rather than attaching it to the new scope',()=>{
  const f=fixture();let client,switched=false;client=f.create({onView(v){f.views.push(v);f.control.visible=v;if(!switched){switched=true;assert.equal(client.select(selection('worker-2')),true);}}});client.start();assert.equal(client.select(selection()),false);assert.equal(f.control.visible.selection.workerId,'worker-2');assert.ok(f.listeners.slice(14,17).every(l=>l.closed===1));assert.equal(f.listeners.filter(l=>l.active).length,17);client.dispose();allClosed(f);
});
test('browser UMD exports a source-OFF factory without opening SDK, network or storage',()=>{
  const context=vm.createContext({URL,TextEncoder});for(const file of ['operations-codec.js','maklon-earnings.js','production-view-client.js','production-owner-wage-client.js'])vm.runInContext(fs.readFileSync(require.resolve('../'+file),'utf8'),context);
  assert.equal(typeof context.SoldierProductionOwnerWageClient.createOwnerWageClient,'function');assert.equal(vm.runInContext('SoldierProductionOwnerWageClient.createOwnerWageClient().start()',context),false);
  const source=fs.readFileSync(require.resolve('../production-owner-wage-client.js'),'utf8');for(const forbidden of ['localStorage','sessionStorage','fetch(','XMLHttpRequest','getIdToken','sdk.ref','privateAuthority'])assert.equal(source.includes(forbidden),false);
});
