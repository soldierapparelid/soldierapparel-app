'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),Authority=require('../server/production-authority.cjs'),Admin=require('../server/production-tenant-admin.cjs');
const Ledger=require('../server/production-owner-ledger.cjs');
const PROJECT='demo-tenant-admin',TENANT='synthetic-tenant',URL='https://demo-tenant-admin.firebaseio.com',NOW='2026-10-05T03:00:00.000Z',LATER='2026-10-05T04:00:00.000Z';
const copy=v=>structuredClone(v);
function prune(v){if(v===null)return undefined;if(v&&typeof v==='object'){const next={};for(const [key,value]of Object.entries(v)){const item=prune(value);if(item!==undefined)next[key]=item;}return Object.keys(next).length?next:undefined;}return v;}
function authority(id='product-1'){return Authority.createAuthority({product:{id,series:'Synthetic',namaBarang:'Example',size:'M',cutQuantity:10},cycleId:'cycle-1',workers:[{id:'worker-1',nama:'Synthetic first partner'},{id:'worker-2',nama:'Synthetic second partner'}],assignments:[{id:'assignment-1',workerId:'worker-1',qty:10}],now:NOW});}
function product(id){return {cycles:{'cycle-1':{config:{revision:1,active:true,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'},tariffInputs:{revision:1,policy:{version:'policy-1',kind:'jakarta-fixed-local-time',hour:8,minute:0},historyByWorker:{'worker-1':{'tariff-1':{effectiveAt:'2026-01-01T00:00:00.000Z',currency:'IDR',rate:100}}}},wire:prune(Authority.encodeStorage(authority(id)))}}};}
function setup(overrides={}){
  const store={tenant:{schemaVersion:1,projectId:PROJECT,tenantId:TENANT,grants:{'owner-1':{revision:1,profile:{active:true,owner:true}},'worker-user':{revision:2,profile:{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}}}},products:{'product-1':product('product-1'),'product-2':product('product-2')}}};
  const stats={refs:0,reads:0,auth:0,admit:0,on:0,off:0,transactions:0,callbacks:0,writes:0},hooks={before:null,after:null,cold:false,result:null},listeners=new Set();
  const snapshot=value=>({val:()=>copy(value)});
  const reference={toString:()=>URL+'/authorityTenants/'+TENANT,
    async get(){stats.reads++;return snapshot(store.tenant);},
    on(event,callback){assert.equal(event,'value');stats.on++;listeners.add(callback);callback(snapshot(store.tenant));},
    off(event,callback){assert.equal(event,'value');assert.ok(listeners.has(callback));listeners.delete(callback);stats.off++;},
    async transaction(update,complete,local){
      assert.equal(complete,undefined);assert.equal(local,false);stats.transactions++;
      if(hooks.before){const change=hooks.before;hooks.before=null;change();}
      let source=hooks.cold?null:copy(store.tenant);hooks.cold=false;const before=copy(source);stats.callbacks++;let candidate=update(source);assert.deepEqual(source,before,'SDK callback input must remain immutable');
      if(candidate!==undefined&&hooks.after){const change=hooks.after;hooks.after=null;change();source=copy(store.tenant);const fresh=copy(source);stats.callbacks++;candidate=update(source);assert.deepEqual(source,fresh);}
      if(hooks.result)return hooks.result(candidate);
      if(candidate===undefined)return {committed:false,snapshot:snapshot(store.tenant)};
      store.tenant=prune(copy(candidate));stats.writes++;return {committed:true,snapshot:snapshot(store.tenant)};
    }};
  const database={app:{options:{projectId:PROJECT,databaseURL:URL}},ref(path){stats.refs++;assert.equal(path,'authorityTenants/'+TENANT);return reference;}};
  const decoded={uid:'owner-1',sub:'owner-1',aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,email_verified:true,firebase:{sign_in_provider:'google.com'},exp:Date.parse(NOW)/1000+3600};
  const auth={async verifyIdToken(token,checkRevoked){assert.equal(token,'synthetic-token');assert.equal(checkRevoked,true);stats.auth++;return copy(decoded);}};
  const options={enabled:true,projectId:PROJECT,tenantId:TENANT,databaseURL:URL,database,auth,clock:()=>NOW,admit:async()=>{stats.admit++;return true;},...overrides};
  const create=()=>Admin.createProductionTenantAdmin(options);
  const request=command=>({idToken:'synthetic-token',command});
  const command=()=>({kind:'setGrant',uid:'worker-user',expectedRevision:2,profile:{active:false,owner:false,workerId:'worker-1',modules:{jahit:true}}});
  return {store,stats,hooks,listeners,reference,database,decoded,options,create,request,command,cycle:()=>store.tenant.products['product-1'].cycles['cycle-1']};
}

function createCommand(values={}){return {kind:'createCycle',requestId:'create-1',product:{id:'product-new',series:'Synthetic',namaBarang:'New synthetic item',size:'M',cutQuantity:10},cycleId:'cycle-new',workers:[{id:'worker-new',nama:'Synthetic partner label'}],assignments:[{id:'assignment-new',workerId:'worker-new',qty:10}],tariffPolicy:{version:'policy-initial',kind:'jakarta-fixed-local-time',hour:8,minute:0},initialTariffs:[{workerId:'worker-new',tariffVersion:'initial-1',effectiveAt:'2026-01-01T00:00:00.000Z',currency:'IDR',rate:100}],...values};}
function newCycle(f,command=createCommand()){return f.store.tenant.products[command.product.id].cycles[command.cycleId];}
function installConcurrent(f,command=createCommand(),uid='owner-1'){
  const seed=Ledger.createCycleSeed(command,NOW),next=copy(f.store.tenant);if(!next.products[command.product.id])next.products[command.product.id]={cycles:{}};
  next.products[command.product.id].cycles[command.cycleId]=seed;
  next.ownerCommandLedger=Ledger.appendOwnerLedger(next.ownerCommandLedger,{uid,command,acceptedAt:NOW,initialSnapshotHash:Authority.decodeStorage(seed.wire).snapshots.v0000000000.hash},next.products);
  f.store.tenant=prune(next);
}

test('createCycle is disabled by default and creates no SDK/Auth/listener activity',async()=>{
  const f=setup({enabled:false});assert.deepEqual(await f.create().execute(f.request(createCommand())),{ok:false,error:'service_disabled'});assert.ok(Object.values(f.stats).every(n=>n===0));
});

test('explicit complete seed, private durable receipt and audit commit together while all siblings remain unchanged',async()=>{
  const f=setup(),command=createCommand(),before=copy(f.store.tenant),result=await f.create().execute(f.request(command));
  assert.deepEqual(result,{ok:true,receipt:{requestId:'create-1',kind:'createCycle',productId:'product-new',cycleId:'cycle-new',revision:0,acceptedAt:NOW},replayed:false});
  assert.deepEqual(f.store.tenant.grants,before.grants);assert.deepEqual(f.store.tenant.products['product-1'],before.products['product-1']);assert.deepEqual(f.store.tenant.products['product-2'],before.products['product-2']);
  const cycle=newCycle(f),state=Authority.decodeStorage(cycle.wire);
  assert.deepEqual(cycle.config,{revision:1,active:false,reviewedEmptyCycle:false,tariffPolicy:'explicit-historical-jakarta-v1'});assert.equal(state.revision,0);
  for(const field of ['sewing','counts','inspections','repairs','frozenPayroll','receipts'])assert.deepEqual(state[field],{});
  assert.equal(state.snapshots.v0000000000.parentHash,null);assert.equal(Object.keys(f.store.tenant.ownerCommandLedger.entries).length,1);
  const entry=Object.values(f.store.tenant.ownerCommandLedger.entries)[0];assert.equal(entry.uid,'owner-1');assert.equal(entry.commandJson.includes('synthetic-token'),false);assert.equal(entry.initialSnapshotHash,state.snapshots.v0000000000.hash);
  assert.equal(f.stats.writes,1);assert.equal(f.stats.on,f.stats.off);assert.equal(f.listeners.size,0);
  for(const value of ['owner-1','worker-new','assignment-new','rate','tariff','privateAuthority','commandJson','synthetic-token'])assert.equal(JSON.stringify(result).includes(value),false);
});

test('a new cycle under an existing product retains old cycle wire, tariff and history exactly',async()=>{
  const f=setup(),before=copy(f.store.tenant),command=createCommand({product:{id:'product-1',series:'Synthetic revised description',namaBarang:'New synthetic item',size:'L',cutQuantity:10}});
  assert.equal((await f.create().execute(f.request(command))).ok,true);assert.deepEqual(f.store.tenant.products['product-1'].cycles['cycle-1'],before.products['product-1'].cycles['cycle-1']);assert.equal(Object.keys(f.store.tenant.products['product-1'].cycles).length,2);
});

test('replay freshly verifies Auth and canonical owner but never writes, even after writer restart and cycle progression',async()=>{
  const f=setup(),command=createCommand(),first=await f.create().execute(f.request(command));assert.equal(first.ok,true);
  const cycle=newCycle(f),state=Authority.decodeStorage(cycle.wire),context={uid:'owner-1',emailVerified:true,provider:'google.com',profile:{active:true,owner:true},now:NOW};
  const changed=Authority.applyCommand(state,context,{requestId:'sew-new',productId:'product-new',cycleId:'cycle-new',expectedRevision:0,kind:'sewing',payload:{id:'sewing-new',assignmentId:'assignment-new',tanggal:'2026-10-05',good:10,reject:0}});
  cycle.wire=prune(Authority.encodeStorage(changed.state));const before=copy(f.store.tenant),transactions=f.stats.transactions,auth=f.stats.auth;
  const replay=await f.create().execute(f.request(copy(command)));assert.deepEqual(replay,{...first,replayed:true});assert.deepEqual(f.store.tenant,before);assert.equal(f.stats.transactions,transactions);assert.equal(f.stats.auth,auth+1);assert.equal(Object.keys(Ledger.validateOwnerLedger(f.store.tenant.ownerCommandLedger,f.store.tenant.products).entries).length,1);
});

test('lost or corrupt committed acknowledgments retain one seed and receipt for an exact safe replay',async()=>{
  for(const corrupt of [false,true]){
    const f=setup(),command=createCommand();f.hooks.result=candidate=>{assert.ok(candidate);f.store.tenant=prune(copy(candidate));f.stats.writes++;if(!corrupt)throw Error('synthetic private lost acknowledgment');return {committed:true,snapshot:{val:()=>null}};};
    const unknown=await f.create().execute(f.request(command));assert.deepEqual(unknown,{ok:false,error:'unavailable'});assert.equal(f.stats.writes,1);f.hooks.result=null;
    const before=copy(f.store.tenant),retry=await f.create().execute(f.request(command));assert.equal(retry.ok,true);assert.equal(retry.replayed,true);assert.deepEqual(f.store.tenant,before);assert.equal(f.stats.writes,1);
  }
});

test('request reuse with altered payload or occupied target under another request never replaces a cycle',async()=>{
  const f=setup(),command=createCommand();assert.equal((await f.create().execute(f.request(command))).ok,true);const before=copy(f.store.tenant);
  for(const mutate of [c=>c.product.namaBarang='Different',c=>c.initialTariffs[0].rate=200,c=>c.requestId='new-request',c=>c.cycleId='another-cycle']){
    const changed=copy(command);mutate(changed);assert.deepEqual(await f.create().execute(f.request(changed)),{ok:false,error:'conflict'});assert.deepEqual(f.store.tenant,before);
  }
  const existing=createCommand({product:{id:'product-1',series:'Synthetic',namaBarang:'Example',size:'M',cutQuantity:10},cycleId:'cycle-1'});assert.equal((await f.create().execute(f.request(existing))).error,'conflict');assert.deepEqual(f.store.tenant,before);
});

test('every request including receipt replay requires an active owner grant and verified Google identity',async()=>{
  for(const mutate of [f=>f.store.tenant.grants['owner-1'].profile.active=false,f=>f.store.tenant.grants['owner-1'].profile.owner=false,f=>delete f.store.tenant.grants['owner-1'],f=>f.decoded.email_verified=false,f=>f.decoded.firebase.sign_in_provider='password',f=>f.decoded.exp=0]){
    const f=setup(),command=createCommand();assert.equal((await f.create().execute(f.request(command))).ok,true);mutate(f);const before=copy(f.store.tenant),writes=f.stats.writes;assert.equal((await f.create().execute(f.request(command))).error,'access_denied');assert.deepEqual(f.store.tenant,before);assert.equal(f.stats.writes,writes);
  }
});

test('owner revocation, target creation and malformed ledger interleaves abort without clobbering the other writer',async()=>{
  for(const mutate of [f=>f.store.tenant.grants['owner-1'].profile.active=false,f=>{const c=createCommand({requestId:'other-request'});installConcurrent(f,c);},f=>f.store.tenant.ownerCommandLedger={schemaVersion:1,entries:{invalid:{}}}]){
    const f=setup();let other;f.hooks.before=()=>{mutate(f);other=copy(f.store.tenant);};const result=await f.create().execute(f.request(createCommand()));assert.equal(result.ok,false);assert.deepEqual(f.store.tenant,other);assert.equal(f.stats.writes,0);assert.equal(f.stats.on,f.stats.off);
  }
});

test('a concurrent identical seed is reread after fresh Auth and returned as receipt replay without a no-op transaction write',async()=>{
  const f=setup(),command=createCommand();f.hooks.before=()=>installConcurrent(f,command);const result=await f.create().execute(f.request(command));assert.equal(result.ok,true);assert.equal(result.replayed,true);assert.equal(f.stats.auth,2);assert.equal(f.stats.writes,0);assert.equal(f.stats.transactions,1);assert.equal(Object.keys(f.store.tenant.ownerCommandLedger.entries).length,1);assert.equal(f.stats.on,f.stats.off);
});

test('internal callback retry reauthenticates and preserves unrelated branch updates',async()=>{
  const f=setup(),command=createCommand();f.hooks.after=()=>{f.store.tenant.grants['worker-user'].revision++;};const result=await f.create().execute(f.request(command));assert.equal(result.ok,true);assert.equal(f.stats.auth,2);assert.equal(f.store.tenant.grants['worker-user'].revision,3);assert.equal(f.stats.writes,1);assert.equal(f.stats.on,f.stats.off);
});

test('initial inputs reject partial allocation, unknown/duplicate workers, blank labels, unsafe quantities and missing tariffs before listeners',async()=>{
  const mutations=[c=>c.assignments[0].qty=9,c=>c.assignments[0].qty=11,c=>c.assignments[0].qty=0,c=>c.assignments[0].workerId='unknown',c=>c.workers.push(copy(c.workers[0])),c=>c.workers[0].nama='',c=>c.workers[0].nama='\u0080bad',c=>c.workers[0].id='../unsafe',c=>c.product.cutQuantity=Number.MAX_SAFE_INTEGER+1,c=>c.assignments.push(copy(c.assignments[0])),c=>c.initialTariffs=[],c=>c.initialTariffs.push(copy(c.initialTariffs[0])),c=>c.initialTariffs[0].workerId='unknown',c=>c.initialTariffs[0].rate=0,c=>c.initialTariffs[0].rate=0.5,c=>c.initialTariffs[0].currency='USD',c=>c.initialTariffs[0].effectiveAt=LATER,c=>c.tariffPolicy.hour=24,c=>c.tariffPolicy.minute=60,c=>c.tariffPolicy.version='',c=>c.requestId='__proto__',c=>c.config={active:true},c=>c.product.password='synthetic forbidden',c=>c.uid='owner-1',c=>c.wire='synthetic legacy import',c=>c.workers=[]];
  for(const mutate of mutations){const f=setup(),command=createCommand();mutate(command);const before=copy(f.store.tenant);assert.equal((await f.create().execute(f.request(command))).error,'invalid_request');assert.deepEqual(f.store.tenant,before);assert.equal(f.stats.on,0);assert.equal(f.stats.writes,0);}
});

test('descriptor traps and oversized owner requests are rejected without invoking getters or writing',async()=>{
  const f=setup(),command=createCommand();let getter=0;Object.defineProperty(command.product,'password',{enumerable:true,get(){getter++;return 'synthetic';}});assert.equal((await f.create().execute(f.request(command))).error,'invalid_request');assert.equal(getter,0);assert.equal(f.stats.writes,0);
  const many=createCommand();many.workers=Array.from({length:128},(_,i)=>({id:'worker-'+i,nama:'x'.repeat(256)}));assert.equal((await f.create().execute(f.request(many))).error,'invalid_request');assert.equal(f.stats.writes,0);
});

test('ledger corruption is held and original immutable audit is retained through existing admin operations',async()=>{
  const f=setup(),command=createCommand();assert.equal((await f.create().execute(f.request(command))).ok,true);const ledger=copy(f.store.tenant.ownerCommandLedger);
  assert.equal((await f.create().execute(f.request(f.command()))).ok,true);assert.deepEqual(f.store.tenant.ownerCommandLedger,ledger);
  const append={kind:'appendTariff',productId:'product-new',cycleId:'cycle-new',expectedConfigRevision:1,expectedTariffRevision:1,workerId:'worker-new',tariffVersion:'later-rate',effectiveAt:LATER,currency:'IDR',rate:200};assert.equal((await f.create().execute(f.request(append))).ok,true);assert.deepEqual(f.store.tenant.ownerCommandLedger,ledger);
  assert.equal((await f.create().execute(f.request({kind:'setConfig',productId:'product-new',cycleId:'cycle-new',expectedRevision:1,config:{active:true,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'}}))).ok,true);assert.deepEqual(f.store.tenant.ownerCommandLedger,ledger);
  assert.equal((await f.create().execute(f.request(command))).replayed,true);
  for(const mutate of [v=>v.schemaVersion=2,v=>Object.values(v.entries)[0].receipt.revision=1,v=>Object.values(v.entries)[0].commandHash='f'.repeat(64),v=>Object.values(v.entries)[0].commandJson='{}',v=>Object.values(v.entries)[0].initialSnapshotHash='f'.repeat(64),v=>Object.values(v.entries)[0].acceptedAt=LATER,v=>{const entry=Object.values(v.entries)[0];v.entries={bad:entry};},v=>Object.values(v.entries)[0].extra=true]){
    const invalid=copy(ledger);mutate(invalid);assert.throws(()=>Ledger.validateOwnerLedger(invalid,f.store.tenant.products),Ledger.OwnerLedgerError);
  }
});

test('capacity failure before mutation preserves existing tenant and ledger, with absent legacy ledger still accepted',async()=>{
  const f=setup(),before=copy(f.store.tenant);assert.equal(Ledger.validateOwnerLedger(undefined,before.products),null);assert.throws(()=>Ledger.validateOwnerLedger({schemaVersion:1,entries:{}},before.products),Ledger.OwnerLedgerError);
  f.options.maxTenantBytes=Buffer.byteLength(JSON.stringify(f.store.tenant),'utf8')+1;assert.equal((await f.create().execute(f.request(createCommand()))).error,'capacity_limit');assert.deepEqual(f.store.tenant,before);assert.equal(f.stats.on,0);assert.equal(f.stats.writes,0);
});

test('valid retained ledgers stop at the entry bound without purging any prior record',()=>{
  const products={'product-new':{cycles:{}}},entries={};
  for(let i=0;i<256;i++){
    const command=createCommand({requestId:'request-'+i,cycleId:'cycle-'+i}),seed=Ledger.createCycleSeed(command,NOW);products['product-new'].cycles[command.cycleId]=prune(seed);
    const singleton=Ledger.appendOwnerLedger(undefined,{uid:'owner-1',command,acceptedAt:NOW,initialSnapshotHash:Authority.decodeStorage(seed.wire).snapshots.v0000000000.hash},products);Object.assign(entries,singleton.entries);
  }
  const ledger={schemaVersion:1,entries};assert.equal(Object.keys(Ledger.validateOwnerLedger(ledger,products).entries).length,256);const before=copy(ledger);
  const command=createCommand({requestId:'request-extra',cycleId:'cycle-extra'}),seed=Ledger.createCycleSeed(command,NOW);products['product-new'].cycles[command.cycleId]=prune(seed);
  assert.throws(()=>Ledger.appendOwnerLedger(ledger,{uid:'owner-1',command,acceptedAt:NOW,initialSnapshotHash:Authority.decodeStorage(seed.wire).snapshots.v0000000000.hash},products),error=>error instanceof Ledger.OwnerLedgerError&&error.code==='capacity_limit');assert.deepEqual(ledger,before);
  assert.throws(()=>Ledger.validateOwnerLedger({schemaVersion:1,entries,padding:'x'.repeat(1024*1024)},products),error=>error instanceof Ledger.OwnerLedgerError&&error.code==='capacity_limit');
});

test('duplicate audit targets, noncanonical command JSON and unsafe maximum initial wages fail closed',()=>{
  const f=setup(),command=createCommand();installConcurrent(f,command);const original=f.store.tenant.ownerCommandLedger,entry=Object.values(original.entries)[0];
  const duplicateCommand=createCommand({requestId:'different-request'}),seed=newCycle(f),duplicate=Ledger.appendOwnerLedger(undefined,{uid:'owner-1',command:duplicateCommand,acceptedAt:NOW,initialSnapshotHash:Authority.decodeStorage(seed.wire).snapshots.v0000000000.hash},f.store.tenant.products);
  const duplicated={schemaVersion:1,entries:{...copy(original.entries),...duplicate.entries}};assert.throws(()=>Ledger.validateOwnerLedger(duplicated,f.store.tenant.products),Ledger.OwnerLedgerError);
  for(const commandJson of [' '+entry.commandJson,entry.commandJson.replace('"kind":"createCycle"','"kind":"invalid","kind":"createCycle"')]){const ledger=copy(original);Object.values(ledger.entries)[0].commandJson=commandJson;assert.throws(()=>Ledger.validateOwnerLedger(ledger,f.store.tenant.products),Ledger.OwnerLedgerError);}
  const unsafe=createCommand();unsafe.product.cutQuantity=Number.MAX_SAFE_INTEGER;unsafe.assignments[0].qty=Number.MAX_SAFE_INTEGER;assert.throws(()=>Ledger.validateCreateCycleCommand(unsafe),error=>error instanceof Ledger.OwnerLedgerError&&error.code==='invalid_request');
});
