'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),Authority=require('../server/production-authority.cjs'),Admin=require('../server/production-tenant-admin.cjs');
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
const Ledger=require('../server/production-tariff-ledger.cjs'),OwnerLedger=require('../server/production-owner-ledger.cjs');
const command=values=>({kind:'appendTariffVersion',requestId:'rate-request-1',productId:'product-1',cycleId:'cycle-1',expectedConfigRevision:1,expectedTariffRevision:1,workerId:'worker-1',tariffVersion:'tariff-2',effectiveAt:LATER,currency:'IDR',rate:200,...values});
function install(f,c=command(),uid='owner-1'){
  const out=copy(f.store.tenant),cycle=out.products[c.productId].cycles[c.cycleId];cycle.tariffInputs.revision=c.expectedTariffRevision+1;
  cycle.tariffInputs.historyByWorker[c.workerId][c.tariffVersion]={effectiveAt:c.effectiveAt,currency:c.currency,rate:c.rate};
  out.tariffCommandLedger=Ledger.appendTariffLedger(out.tariffCommandLedger,{uid,command:c,acceptedAt:NOW},out.products);f.store.tenant=prune(out);
}
function frozenCycle(f){
  let state=Authority.decodeStorage(f.cycle().wire);const actor={uid:'owner-1',emailVerified:true,provider:'google.com',profile:{active:true,owner:true},now:NOW};
  state=Authority.applyCommand(state,actor,{requestId:'sew-frozen',productId:'product-1',cycleId:'cycle-1',expectedRevision:0,kind:'sewing',payload:{id:'sew-1',assignmentId:'assignment-1',tanggal:'2026-10-05',good:10,reject:0}}).state;
  const selection={source:'private-verified-tariff',verified:true,workerId:'worker-1',productId:'product-1',cycleId:'cycle-1',countId:'count-1',workDate:'2026-10-05',basisAt:NOW,effectiveAt:'2026-01-01T00:00:00.000Z',tariffVersion:'tariff-1',currency:'IDR',rate:100,selectedAt:NOW};
  state=Authority.applyCommand(state,{...actor,selectedTariffs:{'count-1':selection}},{requestId:'count-frozen',productId:'product-1',cycleId:'cycle-1',expectedRevision:1,kind:'count',payload:{id:'count-1',assignmentId:'assignment-1',tanggal:'2026-10-05',jumlah:10}}).state;
  f.cycle().wire=prune(Authority.encodeStorage(state));return state;
}

test('new tariff edit remains disabled by default without SDK, Auth or data operations',async()=>{
  const f=setup();delete f.options.enabled;assert.deepEqual(await f.create().execute(f.request(command())),{ok:false,error:'service_disabled'});assert.ok(Object.values(f.stats).every(n=>n===0));
});

test('forward tariff and retained receipt commit together without changing any frozen wage, original rate or sibling',async()=>{
  const f=setup(),state=frozenCycle(f),before=copy(f.store.tenant),result=await f.create().execute(f.request(command()));
  assert.deepEqual(result,{ok:true,receipt:{requestId:'rate-request-1',kind:'appendTariffVersion',productId:'product-1',cycleId:'cycle-1',workerId:'worker-1',tariffVersion:'tariff-2',revision:2,acceptedAt:NOW},replayed:false});
  assert.equal(f.stats.writes,1);assert.deepEqual(f.cycle().wire,before.products['product-1'].cycles['cycle-1'].wire);assert.deepEqual(Authority.decodeStorage(f.cycle().wire).frozenPayroll,state.frozenPayroll);
  assert.deepEqual(f.cycle().tariffInputs.historyByWorker['worker-1']['tariff-1'],before.products['product-1'].cycles['cycle-1'].tariffInputs.historyByWorker['worker-1']['tariff-1']);
  assert.deepEqual(f.store.tenant.products['product-2'],before.products['product-2']);assert.deepEqual(f.store.tenant.grants,before.grants);assert.deepEqual(f.cycle().config,before.products['product-1'].cycles['cycle-1'].config);
  assert.equal(Object.keys(f.store.tenant.tariffCommandLedger.entries).length,1);assert.equal(f.listeners.size,0);assert.equal(f.stats.on,f.stats.off);
  assert.equal(Object.hasOwn(result.receipt,'rate'),false);for(const value of ['owner-1','synthetic-token','commandJson','privateAuthority','profile'])assert.equal(JSON.stringify(result).includes(value),false);
  const receipt=Ledger.getTariffReceipt(f.store.tenant.tariffCommandLedger,'owner-1',command());assert.equal(Object.isFrozen(receipt),true);
});

test('writer restart and exact replay are read-only after config changes, later rates, work progress and effective date passage',async()=>{
  let now=NOW;const f=setup({clock:()=>now}),c=command(),first=await f.create().execute(f.request(c));assert.equal(first.ok,true);
  const second=command({requestId:'rate-request-2',expectedTariffRevision:2,tariffVersion:'tariff-3',effectiveAt:'2026-10-05T05:00:00.000Z',rate:300});assert.equal((await f.create().execute(f.request(second))).ok,true);
  const configuration={kind:'setConfig',productId:'product-1',cycleId:'cycle-1',expectedRevision:1,config:{active:false,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'}};assert.equal((await f.create().execute(f.request(configuration))).ok,true);
  frozenCycle(f);now='2026-10-06T03:00:00.000Z';f.decoded.exp=Date.parse(now)/1000+3600;const before=copy(f.store.tenant),transactions=f.stats.transactions,auth=f.stats.auth;
  assert.deepEqual(await f.create().execute(f.request(copy(c))),{...first,replayed:true});assert.deepEqual(f.store.tenant,before);assert.equal(f.stats.transactions,transactions);assert.equal(f.stats.auth,auth+1);assert.equal(Ledger.validateTariffLedger(f.store.tenant.tariffCommandLedger,f.store.tenant.products).schemaVersion,1);
});

test('lost and corrupt acknowledgments preserve one immutable tariff version and receipt for exact safe replay',async()=>{
  for(const corrupt of [false,true]){
    const f=setup(),c=command();f.hooks.result=candidate=>{f.store.tenant=prune(copy(candidate));f.stats.writes++;if(!corrupt)throw Error('synthetic-private-lost-ack');return {committed:true,snapshot:{val:()=>null}};};
    assert.deepEqual(await f.create().execute(f.request(c)),{ok:false,error:'unavailable'});assert.equal(f.stats.writes,1);f.hooks.result=null;const before=copy(f.store.tenant);
    const replay=await f.create().execute(f.request(c));assert.equal(replay.ok,true);assert.equal(replay.replayed,true);assert.deepEqual(f.store.tenant,before);assert.equal(f.stats.writes,1);assert.equal(Object.keys(f.store.tenant.tariffCommandLedger.entries).length,1);
  }
});

test('altered command under a retained request ID and occupied version under a different request never replace history',async()=>{
  const f=setup(),c=command();assert.equal((await f.create().execute(f.request(c))).ok,true);const before=copy(f.store.tenant);
  for(const mutate of [c=>c.rate=201,c=>c.effectiveAt='2026-10-05T04:30:00.000Z',c=>c.expectedTariffRevision=2,c=>c.requestId='other-request',c=>c.workerId='worker-2',c=>c.tariffVersion='another-version',c=>c.cycleId='other-cycle']){
    const changed=copy(c);mutate(changed);assert.equal((await f.create().execute(f.request(changed))).error,'conflict');assert.deepEqual(f.store.tenant,before);
  }
});

test('each fresh edit and every replay require freshly verified Google identity and a current active owner grant',async()=>{
  for(const phase of ['fresh','replay'])for(const mutate of [f=>f.store.tenant.grants['owner-1'].profile.active=false,f=>f.store.tenant.grants['owner-1'].profile.owner=false,f=>delete f.store.tenant.grants['owner-1'],f=>f.decoded.email_verified=false,f=>f.decoded.firebase.sign_in_provider='password',f=>f.decoded.exp=0,f=>{f.options.auth.verifyIdToken=async()=>{throw Error('private-revoked');};}]){
    const f=setup();if(phase==='replay')assert.equal((await f.create().execute(f.request(command()))).ok,true);mutate(f);const before=copy(f.store.tenant),writes=f.stats.writes;
    const result=await f.create().execute(f.request(command()));assert.deepEqual(result,{ok:false,error:'access_denied'});assert.deepEqual(f.store.tenant,before);assert.equal(f.stats.writes,writes);
  }
});

test('concurrent identical append is replayed after fresh owner/Auth read without a no-op write',async()=>{
  const f=setup(),c=command();f.hooks.before=()=>install(f,c);const result=await f.create().execute(f.request(c));assert.equal(result.ok,true);assert.equal(result.replayed,true);assert.equal(f.stats.auth,2);assert.equal(f.stats.transactions,1);assert.equal(f.stats.writes,0);assert.equal(Object.keys(f.store.tenant.tariffCommandLedger.entries).length,1);assert.equal(f.listeners.size,0);
});

test('owner revocation, different tariff winner and malformed ledger in the transaction preserve the winning state',async()=>{
  for(const mutate of [f=>f.store.tenant.grants['owner-1'].profile.active=false,f=>install(f,command({requestId:'other-winner',rate:250})),f=>f.store.tenant.tariffCommandLedger={schemaVersion:1,entries:{invalid:{}}}]){
    const f=setup();let winner;f.hooks.before=()=>{mutate(f);winner=copy(f.store.tenant);};assert.equal((await f.create().execute(f.request(command()))).ok,false);assert.deepEqual(f.store.tenant,winner);assert.equal(f.stats.writes,0);assert.equal(f.stats.on,f.stats.off);
  }
});

test('internal SDK retry freshly verifies identity and preserves unrelated grants and concurrent production wire',async()=>{
  const f=setup();f.hooks.after=()=>{f.store.tenant.grants['worker-user'].revision++;frozenCycle(f);};const result=await f.create().execute(f.request(command()));assert.equal(result.ok,true);assert.equal(f.stats.auth,2);assert.equal(f.stats.transactions,2);assert.equal(f.stats.writes,1);assert.equal(f.store.tenant.grants['worker-user'].revision,3);assert.equal(Authority.decodeStorage(f.cycle().wire).revision,2);assert.equal(Authority.decodeStorage(f.cycle().wire).frozenPayroll['count-1'].rate,100);
  const revoked=setup();revoked.hooks.after=()=>revoked.store.tenant.grants['owner-1'].profile.active=false;assert.equal((await revoked.create().execute(revoked.request(command()))).error,'access_denied');assert.equal(revoked.stats.auth,2);assert.equal(revoked.stats.writes,0);
});

test('fresh callback time, strictly increasing schedule, assigned worker and exact revisions govern a new version',async()=>{
  for(const mutate of [c=>c.tariffVersion='tariff-1',c=>c.effectiveAt='2026-01-01T00:00:00.000Z',c=>c.expectedConfigRevision=0,c=>c.expectedTariffRevision=0,c=>c.workerId='worker-2',c=>c.workerId='missing-worker']){
    const f=setup(),c=command();mutate(c);const before=copy(f.store.tenant);assert.equal((await f.create().execute(f.request(c))).ok,false);assert.deepEqual(f.store.tenant,before);assert.equal(f.stats.writes,0);
  }
  for(const phase of ['before','after']){
    let now=NOW;const f=setup({clock:()=>now});f.decoded.exp=Date.parse(NOW)/1000+7200;f.hooks[phase]=()=>{now='2026-10-05T04:01:00.000Z';};const before=copy(f.store.tenant);
    assert.equal((await f.create().execute(f.request(command()))).error,'conflict');assert.deepEqual(f.store.tenant,before);assert.equal(f.stats.writes,0);if(phase==='after')assert.equal(f.stats.auth,2);
  }
  const f=setup(),c=command({effectiveAt:NOW});assert.equal((await f.create().execute(f.request(c))).ok,true);
});

test('new version rejects unsafe money overflow while legacy append result and no-ledger semantics stay unchanged',async()=>{
  const f=setup(),before=copy(f.store.tenant);assert.equal((await f.create().execute(f.request(command({rate:Number.MAX_SAFE_INTEGER})))).error,'not_ready');assert.deepEqual(f.store.tenant,before);assert.equal(f.stats.on,0);
  const legacy=setup(),c=command();delete c.requestId;c.kind='appendTariff';assert.deepEqual(await legacy.create().execute(legacy.request(c)),{ok:true,kind:'appendTariff',revision:2});assert.equal(Object.hasOwn(legacy.store.tenant,'tariffCommandLedger'),false);assert.equal((await legacy.create().execute(legacy.request(c))).error,'conflict');
});

test('tariff receipts and initial owner audit remain immutable through later cycle/config/grant/legacy tariff operations',async()=>{
  const f=setup(),initial={kind:'createCycle',requestId:'create-request',product:{id:'created-product',series:'Synthetic',namaBarang:'Example',size:'M',cutQuantity:10},cycleId:'created-cycle',workers:[{id:'worker-1',nama:'Synthetic partner'}],assignments:[{id:'initial-assignment',workerId:'worker-1',qty:10}],tariffPolicy:{version:'initial-policy',kind:'jakarta-fixed-local-time',hour:8,minute:0},initialTariffs:[{workerId:'worker-1',tariffVersion:'original-rate',effectiveAt:'2026-01-01T00:00:00.000Z',currency:'IDR',rate:100}]};
  assert.equal((await f.create().execute(f.request(initial))).ok,true);const owner=copy(f.store.tenant.ownerCommandLedger),c=command({productId:'created-product',cycleId:'created-cycle'});assert.equal((await f.create().execute(f.request(c))).ok,true);assert.deepEqual(f.store.tenant.ownerCommandLedger,owner);const tariff=copy(f.store.tenant.tariffCommandLedger);
  assert.equal((await f.create().execute(f.request(f.command()))).ok,true);const legacy=command({kind:'appendTariff',productId:'created-product',cycleId:'created-cycle',expectedTariffRevision:2,tariffVersion:'later-rate',effectiveAt:'2026-10-05T05:00:00.000Z'});delete legacy.requestId;assert.equal((await f.create().execute(f.request(legacy))).ok,true);
  assert.deepEqual(f.store.tenant.tariffCommandLedger,tariff);assert.deepEqual(f.store.tenant.ownerCommandLedger,owner);assert.equal(OwnerLedger.validateOwnerLedger(owner,f.store.tenant.products).schemaVersion,1);
});

test('descriptor traps, unknown body claims and malformed tariff input fail without invoking getters or returning values',async()=>{
  const mutations=[c=>c.requestId='',c=>c.requestId='__proto__',c=>c.rate=0,c=>c.rate=1.5,c=>c.rate='200',c=>c.currency='USD',c=>c.effectiveAt='2026-02-30T00:00:00.000Z',c=>c.expectedTariffRevision=Number.MAX_SAFE_INTEGER,c=>c.profile={owner:true},c=>c.total=999,c=>c.pin='synthetic-private-pin',c=>c.password='synthetic-private-password'];
  for(const mutate of mutations){const f=setup(),c=command();mutate(c);const before=copy(f.store.tenant);const result=await f.create().execute(f.request(c));assert.equal(result.error,'invalid_request');assert.deepEqual(f.store.tenant,before);assert.equal(f.stats.auth,0);assert.equal(JSON.stringify(result).includes('synthetic-private'),false);}
  const f=setup(),c=command();let calls=0;Object.defineProperty(c,'rate',{enumerable:true,get(){calls++;return 200;}});assert.equal((await f.create().execute(f.request(c))).error,'invalid_request');assert.equal(calls,0);
  assert.throws(()=>Ledger.validateTariffCommand(Object.assign(Object.create({owner:true}),command())),Ledger.TariffLedgerError);
});

test('ledger corruption, duplicate audit target, changed original version and noncanonical JSON are held',async()=>{
  const f=setup();install(f);const ledger=copy(f.store.tenant.tariffCommandLedger),entry=Object.values(ledger.entries)[0];
  for(const mutate of [l=>l.schemaVersion=2,l=>Object.values(l.entries)[0].receipt.revision=3,l=>Object.values(l.entries)[0].commandHash='f'.repeat(64),l=>Object.values(l.entries)[0].commandJson='{}',l=>Object.values(l.entries)[0].commandJson=' '+entry.commandJson,l=>Object.values(l.entries)[0].acceptedAt='2026-10-05T04:01:00.000Z',l=>{l.entries={bad:entry};},l=>Object.values(l.entries)[0].extra=true]){
    const invalid=copy(ledger);mutate(invalid);assert.throws(()=>Ledger.validateTariffLedger(invalid,f.store.tenant.products),Ledger.TariffLedgerError);
  }
  const sameTarget=Ledger.appendTariffLedger(undefined,{uid:'other-owner',command:command({requestId:'other-request'}),acceptedAt:NOW},f.store.tenant.products);assert.throws(()=>Ledger.validateTariffLedger({schemaVersion:1,entries:{...ledger.entries,...sameTarget.entries}},f.store.tenant.products),Ledger.TariffLedgerError);
  for(const mutate of [f=>f.cycle().tariffInputs.historyByWorker['worker-1']['tariff-2'].rate=250,f=>delete f.cycle().tariffInputs.historyByWorker['worker-1']['tariff-2'],f=>f.cycle().tariffInputs.revision=1,f=>f.cycle().config.revision=0]){
    const broken=setup();install(broken);mutate(broken);const before=copy(broken.store.tenant);assert.equal((await broken.create().execute(broken.request(command()))).error,'not_ready');assert.deepEqual(broken.store.tenant,before);assert.equal(broken.stats.writes,0);
  }
});

test('distinct audit targets cannot share an impossible accepted revision within one cycle',()=>{
  const f=setup();install(f);const second=command({requestId:'revision-collision',tariffVersion:'different-version',effectiveAt:'2026-10-05T05:00:00.000Z'});f.cycle().tariffInputs.historyByWorker['worker-1'][second.tariffVersion]={effectiveAt:second.effectiveAt,currency:'IDR',rate:200};
  const other=Ledger.appendTariffLedger(undefined,{uid:'other-owner',command:second,acceptedAt:NOW},f.store.tenant.products),ledger={schemaVersion:1,entries:{...f.store.tenant.tariffCommandLedger.entries,...other.entries}};
  assert.throws(()=>Ledger.validateTariffLedger(ledger,f.store.tenant.products),error=>error instanceof Ledger.TariffLedgerError&&error.code==='not_ready');
});

test('optional legacy absence, entry and byte caps never purge retained records or write a partial new rate',async()=>{
  const f=setup();assert.equal(Ledger.validateTariffLedger(undefined,f.store.tenant.products),null);assert.throws(()=>Ledger.validateTariffLedger({schemaVersion:1,entries:{}},f.store.tenant.products),Ledger.TariffLedgerError);
  const entries={},history=f.cycle().tariffInputs.historyByWorker['worker-1'];for(let i=0;i<256;i++){
    const c=command({requestId:'request-'+i,tariffVersion:'version-'+i,expectedTariffRevision:i+1,effectiveAt:new Date(Date.parse(LATER)+i*60000).toISOString()});history[c.tariffVersion]={effectiveAt:c.effectiveAt,currency:'IDR',rate:200};f.cycle().tariffInputs.revision=i+2;
    Object.assign(entries,Ledger.appendTariffLedger(undefined,{uid:'owner-1',command:c,acceptedAt:NOW},f.store.tenant.products).entries);
  }
  const ledger={schemaVersion:1,entries};assert.equal(Object.keys(Ledger.validateTariffLedger(ledger,f.store.tenant.products).entries).length,256);f.store.tenant.tariffCommandLedger=ledger;
  const before=copy(f.store.tenant),extra=command({requestId:'overflow-request',tariffVersion:'overflow-version',expectedTariffRevision:257,effectiveAt:'2026-10-06T04:00:00.000Z'});assert.equal((await f.create().execute(f.request(extra))).error,'capacity_limit');assert.deepEqual(f.store.tenant,before);assert.equal(f.stats.writes,0);assert.equal(f.stats.on,0);
  assert.throws(()=>Ledger.validateTariffLedger({schemaVersion:1,entries,padding:'x'.repeat(1024*1024)},f.store.tenant.products),error=>error instanceof Ledger.TariffLedgerError&&error.code==='capacity_limit');
  const small=setup();small.options.maxTenantBytes=Buffer.byteLength(JSON.stringify(small.store.tenant),'utf8')+1;const original=copy(small.store.tenant);assert.equal((await small.create().execute(small.request(command()))).error,'capacity_limit');assert.deepEqual(small.store.tenant,original);assert.equal(small.stats.on,0);
});

test('speculative SDK snapshots cannot report tariff acceptance and cold callbacks safely reverify',async()=>{
  const f=setup(),before=copy(f.store.tenant);f.hooks.result=()=>({committed:true,snapshot:{val:()=>copy(before)}});assert.equal((await f.create().execute(f.request(command()))).error,'unavailable');assert.deepEqual(f.store.tenant,before);assert.equal(f.stats.writes,0);
  const cold=setup();cold.hooks.cold=true;assert.equal((await cold.create().execute(cold.request(command()))).ok,true);assert.equal(cold.stats.auth,2);assert.equal(cold.stats.writes,1);assert.equal(cold.listeners.size,0);
});
