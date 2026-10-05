'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Client=require('../production-view-client.js'),Authority=require('../server/production-authority.cjs');
const PROJECT='demo-view-proof',URL='https://'+PROJECT+'.firebaseio.com',TENANT='tenant-1',UID='caller-1',NOW='2026-10-05T03:00:00.000Z',DAY='2026-10-05';
const mods=['potong','jahit','qc','laporan','stok','gaji','hpp','pembelian','nota','retur'],copy=v=>JSON.parse(JSON.stringify(v));
function projection(){
  let state=Authority.createAuthority({product:{id:'product-1',series:'Synthetic',namaBarang:'Example',size:'M',cutQuantity:10},cycleId:'cycle-1',workers:[{id:'worker-1',nama:'Synthetic one'},{id:'worker-2',nama:'Synthetic two'}],assignments:[{id:'assignment-1',workerId:'worker-1',qty:10}],now:NOW});
  const context={uid:'fixture-owner',emailVerified:true,provider:'google.com',profile:{active:true,owner:true},now:NOW};
  function step(kind,payload,extra={}){state=Authority.applyCommand(state,{...context,...extra},{requestId:'fixture-'+(state.revision+1),productId:'product-1',cycleId:'cycle-1',expectedRevision:state.revision,kind,payload}).state;}
  step('sewing',{id:'sewing-1',assignmentId:'assignment-1',tanggal:DAY,good:10,reject:0});
  step('count',{id:'count-1',assignmentId:'assignment-1',tanggal:DAY,jumlah:10},{selectedTariffs:{'count-1':{source:'private-verified-tariff',verified:true,workerId:'worker-1',productId:'product-1',cycleId:'cycle-1',countId:'count-1',workDate:DAY,basisAt:NOW,effectiveAt:'2026-01-01T00:00:00.000Z',tariffVersion:'tariff-1',currency:'IDR',rate:100,selectedAt:NOW}}});
  step('inspect',{batchId:'batch-1',entries:[{id:'qc-1',hfId:'count-1',tanggal:DAY,ok:5,perbaikan:3,reject:1,offline:1}]});
  step('repair',{id:'repair-1',qcId:'qc-1',tanggal:DAY,jumlah:1});
  return Authority.project(state);
}
function fixture(profile={active:true,owner:false,workerId:'worker-1',modules:{jahit:true}},auto=true){
  const session={schemaVersion:1,projectId:PROJECT,databaseURL:URL,tenantId:TENANT,uid:UID,grantRevision:1,profile:copy(profile),cycles:[{productId:'product-1',cycleId:'cycle-1'}]};
  const p=projection(),base='authorityTenants/'+TENANT,gp=base+'/grants/'+UID,pp=gp+'/profile',cp=base+'/products/product-1/cycles/cycle-1/wire/projection';
  const values=new Map([[pp+'/active',profile.active],[pp+'/owner',profile.owner],[pp+'/workerId',profile.workerId===undefined?null:profile.workerId],...mods.map(m=>[pp+'/modules/'+m,profile.modules?.[m]===undefined?null:profile.modules[m]]),[gp+'/revision',session.grantRevision],[cp+'/operations',copy(p.operations)],[cp+'/revision',p.revision],[cp+'/earningsByWorker/worker-1',copy(p.earningsByWorker['worker-1'])]]);
  const calls=[],clears=[],views=[],listeners=[],control={current:true,visible:null};
  const subscription={subscribe(path,value,error){const record={path,value,error,active:true,closed:0};calls.push(path);listeners.push(record);if(auto)value(values.get(path));return ()=>{record.active=false;record.closed++;};}};
  const options={enabled:true,projectId:PROJECT,databaseURL:URL,tenantId:TENANT,uid:UID,session,subscription,isCurrent(binding){assert.equal(binding.uid,UID);assert.equal(Object.isFrozen(binding.profile),true);return control.current;},onView(v){views.push(v);control.visible=v;},onClear(code){clears.push(code);control.visible=null;}};
  const create=changes=>Client.createViewClient({...options,...changes});
  const emit=(path,value)=>{for(const l of listeners.filter(l=>l.active&&l.path===path))l.value(value);};
  const readyProfile=()=>{for(const [path,value]of values)if(path.startsWith(pp+'/'))emit(path,value);};
  return {profile,session,p,gp,pp,cp,values,calls,clears,views,listeners,control,options,create,emit,readyProfile};
}
function allClosed(f){assert.ok(f.listeners.every(l=>!l.active&&l.closed===1));}
test('default disabled view opens no listeners, identity checks, visible callbacks or storage',()=>{
  const f=fixture(),client=f.create({enabled:false});assert.equal(client.start(),false);client.dispose();assert.equal(f.calls.length,0);assert.equal(f.views.length,0);assert.equal(f.clears.length,0);
});
test('pure session validation precedes stores/listeners and rejects inactive, mismatched or executable input',()=>{
  const f=fixture(),scope={projectId:PROJECT,databaseURL:URL,tenantId:TENANT,uid:UID},before=copy(f.session),validated=Client.validateSession(f.session,scope);
  assert.deepEqual(validated,before);assert.notEqual(validated,f.session);assert.ok(Object.isFrozen(validated)&&Object.isFrozen(validated.profile.modules)&&Object.isFrozen(validated.cycles[0]));assert.deepEqual(f.session,before);
  for(const mutate of [s=>s.schemaVersion=2,s=>s.profile.active=false,s=>s.uid='other-user']){const s=copy(f.session);mutate(s);assert.throws(()=>Client.validateSession(s,scope),e=>e.message==='invalid_view');}
  let calls=0;const s=copy(f.session);Object.defineProperty(s,'uid',{enumerable:true,get(){calls++;return UID;}});assert.throws(()=>Client.validateSession(s,scope),e=>e.message==='invalid_view');
  const getterScope={...scope};Object.defineProperty(getterScope,'uid',{enumerable:true,get(){calls++;return UID;}});assert.throws(()=>Client.validateSession(f.session,getterScope),e=>e.message==='invalid_view');
  assert.equal(calls,0);assert.equal(f.calls.length,0);assert.equal(f.views.length,0);assert.equal(f.clears.length,0);
});
test('browser UMD uses established browser modules without SDK, network or storage initialization',()=>{
  const context=vm.createContext({URL,TextEncoder});for(const file of ['operations-codec.js','maklon-earnings.js','production-view-client.js'])vm.runInContext(fs.readFileSync(require.resolve('../'+file),'utf8'),context);
  assert.equal(typeof context.SoldierProductionViewClient.createViewClient,'function');assert.equal(vm.runInContext('SoldierProductionViewClient.createViewClient().start()',context),false);
  const source=fs.readFileSync(require.resolve('../production-view-client.js'),'utf8');for(const name of ['localStorage','sessionStorage','fetch(','XMLHttpRequest','idToken'])assert.equal(source.includes(name),false);
});
test('assigned partner reads exact paths and emits immutable separate operational and own-wage views',()=>{
  const f=fixture(),source=copy([...f.values]),client=f.create();assert.equal(client.start(),true);
  assert.equal(f.calls.length,17);assert.equal(f.calls.filter(p=>p.includes('/earningsByWorker/')).length,1);assert.equal(f.calls.includes(f.cp),false);assert.equal(f.calls.includes(f.gp+'/revision'),true);assert.equal(f.calls.includes(f.gp),false);assert.equal(f.calls.some(p=>p.endsWith('/privateAuthority')),false);
  const v=f.control.visible;assert.equal(v.complete,true);assert.equal(v.consistency,'independent-listeners');assert.equal(v.cycles[0].revision,4);assert.equal(v.cycles[0].wage.workerId,'worker-1');assert.equal(v.cycles[0].wage.entries.length,2);
  assert.ok(Object.isFrozen(v.cycles[0].operations.qc));assert.ok(Object.isFrozen(v.cycles[0].wage.entries));assert.deepEqual([...f.values],source);
  assert.equal(Object.hasOwn(v.cycles[0].operations,'earningsByWorker'),false);client.dispose();allClosed(f);assert.equal(f.control.visible,null);
});
test('QC and owner default open operations only, including owner with an optional partner binding',()=>{
  for(const profile of [{active:true,owner:false,workerId:'worker-1',modules:{qc:true}},{active:true,owner:true,workerId:'worker-1',modules:{jahit:true}}]){
    const f=fixture(profile),client=f.create();assert.equal(client.start(),true);assert.equal(f.calls.length,16);assert.equal(f.calls.some(p=>p.includes('/earningsByWorker/')),false);assert.equal(f.control.visible.cycles[0].wage,null);client.dispose();allClosed(f);
  }
});
test('mixed global operations and maklon roles retain unrelated cycles without reading another worker wage',()=>{
  for(const [global,partner]of [['qc','jahit'],['laporan','jahit'],['stok','potong']]){
    const f=fixture({active:true,owner:false,workerId:'worker-1',modules:{[global]:true,[partner]:true}});
    const other=Authority.project(Authority.createAuthority({product:{id:'product-2',series:'Synthetic',namaBarang:'Example',size:'L',cutQuantity:10},cycleId:'cycle-1',workers:[{id:'worker-2',nama:'Synthetic other'}],assignments:[{id:'assignment-2',workerId:'worker-2',qty:10}],now:NOW})),path='authorityTenants/'+TENANT+'/products/product-2/cycles/cycle-1/wire/projection';
    f.session.cycles.push({productId:'product-2',cycleId:'cycle-1'});f.values.set(path+'/operations',copy(other.operations));f.values.set(path+'/revision',0);
    const c=f.create();assert.equal(c.start(),true);assert.equal(f.control.visible.complete,true);assert.equal(f.control.visible.cycles.length,2);assert.equal(f.control.visible.cycles[0].wage.workerId,'worker-1');assert.equal(f.control.visible.cycles[1].wage,null);
    assert.equal(f.calls.filter(p=>p.includes('/earningsByWorker/')).length,1);assert.equal(f.calls.some(p=>p.endsWith('/worker-2')),false);c.dispose();allClosed(f);
  }
});
test('cycle reads wait for all fixed profile leaves and matching grant revision, with missing modules null',()=>{
  const f=fixture(undefined,false),client=f.create();assert.equal(client.start(),true);assert.equal(f.calls.length,14);assert.equal(f.views.length,0);
  f.emit(f.pp+'/active',true);f.emit(f.pp+'/owner',false);assert.equal(f.calls.length,14);f.readyProfile();assert.equal(f.calls.length,14);assert.equal(f.views.length,0);
  f.emit(f.gp+'/revision',1);assert.equal(f.calls.length,16);
  f.emit(f.cp+'/operations',f.values.get(f.cp+'/operations'));assert.equal(f.calls.length,17);f.emit(f.cp+'/revision',4);assert.equal(f.control.visible.complete,false);
  f.emit(f.cp+'/earningsByWorker/worker-1',f.values.get(f.cp+'/earningsByWorker/worker-1'));assert.equal(f.control.visible.complete,true);client.dispose();allClosed(f);
});

test('revision-only grant change clears unchanged-profile views and stale initial revision opens no cycles',()=>{
  const f=fixture(),client=f.create();assert.equal(client.start(),true);const profile=copy(f.profile),calls=f.calls.length,late=f.listeners.find(l=>l.path===f.cp+'/operations');
  f.emit(f.gp+'/revision',2);assert.deepEqual(f.profile,profile);assert.equal(f.clears.at(-1),'access_changed');assert.equal(f.control.visible,null);assert.equal(f.calls.length,calls);allClosed(f);
  const views=f.views.length;late.value(f.values.get(late.path));assert.equal(f.views.length,views);assert.equal(client.start(),false);
  for(const [revision,code]of [[0,'access_changed'],[2,'access_changed'],[null,'access_changed'],['1','access_changed'],[1.5,'access_changed'],[-1,'access_changed'],[Number.MAX_SAFE_INTEGER+1,'invalid_view']]){
    const stale=fixture();stale.values.set(stale.gp+'/revision',revision);assert.equal(stale.create().start(),false);assert.equal(stale.clears.at(-1),code);assert.equal(stale.calls.length,14);assert.equal(stale.calls.some(p=>p.includes('/products/')),false);assert.equal(stale.views.length,0);allClosed(stale);
  }
  for(const revision of [0,Number.MAX_SAFE_INTEGER]){const valid=fixture();valid.session.grantRevision=revision;valid.values.set(valid.gp+'/revision',revision);const c=valid.create();assert.equal(c.start(),true);assert.equal(valid.control.visible.complete,true);c.dispose();allClosed(valid);}
});
test('revocation, binding, ownership or module changes dispose every view instead of reauthorizing locally',()=>{
  for(const [field,value]of [['active',false],['owner',true],['workerId','worker-2'],['workerId',null],['modules/jahit',false],['modules/qc',true]]){
    const f=fixture(),client=f.create();client.start();f.emit(f.pp+'/'+field,value);assert.equal(f.clears.at(-1),'access_changed');assert.equal(f.control.visible,null);allClosed(f);assert.equal(client.start(),false);
  }
});
test('permission errors clear all visible projections and late callbacks cannot restore another account data',()=>{
  const f=fixture(),client=f.create();client.start();const late=f.listeners.find(l=>l.path===f.cp+'/operations');late.error(Error('synthetic-private-message'));
  assert.equal(f.clears.at(-1),'read_failed');allClosed(f);const before=f.views.length;late.value(f.values.get(late.path));assert.equal(f.views.length,before);assert.equal(f.control.visible,null);assert.equal(JSON.stringify(f.clears).includes('synthetic-private-message'),false);
});
test('account binding requires literal true before any reads and at every callback; dispose is idempotent',()=>{
  for(const current of [false,1,'true']){const f=fixture();f.control.current=current;assert.equal(f.create().start(),false);assert.equal(f.calls.length,0);assert.equal(f.clears.at(-1),'account_changed');}
  const f=fixture(),client=f.create();client.start();f.control.current=false;f.emit(f.cp+'/revision',5);assert.equal(f.clears.at(-1),'account_changed');allClosed(f);client.dispose();allClosed(f);
  const other=fixture(),c=other.create();c.start();c.dispose();c.dispose();allClosed(other);assert.equal(other.clears.filter(x=>x==='disposed').length,1);
});
test('unknown monetary columns, malformed IDs, relationships, getters and missing operations never render',()=>{
  const mutations=[v=>v.tarif=1,v=>v.jahit[0].upah=1,v=>v.id='other-product',v=>v.hitungFisik[0].qcId='missing-qc',v=>v.jahit[0].lolos=9,v=>v.assignJahit[0].tukangId='different-worker',v=>v.cutQuantity='10',v=>v.jahit.push(copy(v.jahit[0])),v=>v.jahit[0].tanggal='',v=>v.jahit[0].inputAt='not-a-timestamp'];
  for(const mutate of mutations){const f=fixture(),client=f.create();client.start();const value=copy(f.values.get(f.cp+'/operations'));mutate(value);f.emit(f.cp+'/operations',value);assert.equal(f.clears.at(-1),'invalid_view');allClosed(f);assert.equal(f.control.visible,null);}
  const f=fixture(),c=f.create();c.start();let calls=0;const value=copy(f.values.get(f.cp+'/operations'));Object.defineProperty(value,'tarif',{enumerable:true,get(){calls++;return 1;}});f.emit(f.cp+'/operations',value);assert.equal(calls,0);allClosed(f);
  const empty=fixture(),e=empty.create();e.start();empty.emit(empty.cp+'/operations',null);assert.equal(empty.clears.at(-1),'invalid_view');allClosed(empty);
});
test('wage node must be own worker and product, exact whole frozen amounts and known entry schema',()=>{
  const mutations=[v=>v.workerId='worker-2',v=>Object.values(v.entries)[0].productId='different-product',v=>Object.values(v.entries)[0].tarif=100.5,v=>Object.values(v.entries)[0].total=1,v=>Object.values(v.entries)[0].pin='synthetic-private-pin',v=>Object.values(v.entries)[0].sourceType='gudang',v=>Object.values(v.entries)[0].series='different-series'];
  for(const mutate of mutations){const f=fixture(),c=f.create();c.start();const value=copy(f.values.get(f.cp+'/earningsByWorker/worker-1'));mutate(value);f.emit(f.cp+'/earningsByWorker/worker-1',value);assert.equal(f.clears.at(-1),'invalid_view');assert.equal(f.control.visible,null);allClosed(f);}
  const f=fixture(),c=f.create();c.start();f.emit(f.cp+'/earningsByWorker/worker-1',null);assert.equal(f.clears.at(-1),'invalid_view');allClosed(f);
});
test('Firebase numeric-array maps preserve record IDs and actual QC/repair relationships',()=>{
  const f=fixture(),o=copy(f.values.get(f.cp+'/operations'));for(const k of ['assignJahit','jahit','hitungFisik','qc','gudang','bigSaller'])o[k]=Object.fromEntries(o[k].map((r,i)=>[String(i),r]));f.values.set(f.cp+'/operations',o);
  const c=f.create();assert.equal(c.start(),true);assert.equal(f.control.visible.complete,true);assert.equal(f.control.visible.cycles[0].operations.jahit[0].id,'sewing-1');assert.equal(f.control.visible.cycles[0].operations.qc[0].hfId,'count-1');assert.equal(f.control.visible.cycles[0].wage.entries.length,2);
  f.emit(f.cp+'/revision',3);assert.equal(f.clears.at(-1),'invalid_view');allClosed(f);
});
test('strict manifest binding rejects unknown fields, duplicate cycles, prototypes and executable getters before listeners',()=>{
  const mutations=[s=>s.uid='other-user',s=>s.projectId='demo-other',s=>s.databaseURL=URL+'/?token=synthetic',s=>s.tenantId='other-tenant',s=>s.profile.email='synthetic@example.invalid',s=>s.profile.modules.unknown=true,s=>s.cycles.push(copy(s.cycles[0])),s=>s.cycles[0].productId='../unsafe',s=>s.grantRevision='1'];
  for(const mutate of mutations){const f=fixture(),s=copy(f.session);mutate(s);assert.equal(f.create({session:s}).start(),false);assert.equal(f.calls.length,0);assert.equal(f.clears.at(-1),'not_ready');}
  const f=fixture();let calls=0;const s=copy(f.session);Object.defineProperty(s,'uid',{enumerable:true,get(){calls++;return UID;}});assert.equal(f.create({session:s}).start(),false);assert.equal(calls,0);assert.equal(f.calls.length,0);
  const proto=fixture();assert.equal(proto.create({session:Object.assign(Object.create({owner:true}),proto.session)}).start(),false);assert.equal(proto.calls.length,0);
});
test('synchronous initial listener failure closes prior registrations and callback errors clear views',()=>{
  const f=fixture();f.options.subscription.subscribe=(path,value,error)=>{const rec={path,active:true,closed:0};f.listeners.push(rec);f.calls.push(path);if(f.calls.length===2)error(Error('synthetic-private-error'));return ()=>{rec.active=false;rec.closed++;};};
  assert.equal(f.create().start(),false);allClosed(f);assert.equal(f.clears.at(-1),'read_failed');
  const other=fixture();other.options.onView=()=>{throw Error('synthetic-private-render');};assert.equal(other.create().start(),false);allClosed(other);assert.equal(other.clears.at(-1),'callback_failed');assert.equal(JSON.stringify(other.clears).includes('synthetic-private-render'),false);
});
