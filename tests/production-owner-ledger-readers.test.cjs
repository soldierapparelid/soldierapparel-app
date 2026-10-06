'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Authority=require('../server/production-authority.cjs'),Ledger=require('../server/production-owner-ledger.cjs');
const {createProductionTenantAdapter}=require('../server/production-tenant-adapter.cjs');
const {createProductionSessionService}=require('../server/production-session-service.cjs');
const PROJECT='demo-lifecycle-readers',TENANT='synthetic-tenant',URL='https://'+PROJECT+'.firebaseio.com',NOW='2026-10-06T01:00:00.000Z';
const copy=v=>structuredClone(v);
function prune(v){if(v===null)return undefined;if(v&&typeof v==='object'){const next={};for(const [key,value]of Object.entries(v)){const child=prune(value);if(child!==undefined)next[key]=child;}return Object.keys(next).length?next:undefined;}return v;}
function fixture(){
  const command={kind:'createCycle',requestId:'synthetic-create-1',product:{id:'product-1',series:'Synthetic',namaBarang:'Synthetic garment',size:'M',cutQuantity:10},cycleId:'cycle-1',workers:[{id:'worker-1',nama:'Synthetic partner'}],assignments:[{id:'assignment-1',workerId:'worker-1',qty:10}],tariffPolicy:{version:'policy-1',kind:'jakarta-fixed-local-time',hour:8,minute:0},initialTariffs:[{workerId:'worker-1',tariffVersion:'tariff-1',effectiveAt:'2026-01-01T00:00:00.000Z',currency:'IDR',rate:137}]};
  const seed=Ledger.createCycleSeed(command,NOW),state=Authority.decodeStorage(seed.wire);
  const store={value:{schemaVersion:1,projectId:PROJECT,tenantId:TENANT,grants:{'caller-1':{revision:1,profile:{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}}},'owner-1':{revision:1,profile:{active:true,owner:true}}},products:{'product-1':{cycles:{'cycle-1':seed}}}}};
  // Use the original Authority snapshot hash, never an invented history proof.
  store.value.ownerCommandLedger=Ledger.appendOwnerLedger(undefined,{uid:'owner-1',command,acceptedAt:NOW,initialSnapshotHash:state.snapshots.v0000000000.hash},store.value.products);
  store.value=prune(store.value);
  const ref={toString:()=>URL+'/authorityTenants/'+TENANT,async get(){return {val:()=>copy(store.value)};},on(){},off(){},async transaction(){throw Error('reader must not transact');}};
  const database={app:{options:{projectId:PROJECT,databaseURL:URL}},ref(path){assert.equal(path,'authorityTenants/'+TENANT);return ref;}};
  const auth={async verifyIdToken(token,revoked){assert.equal(token,'synthetic-token');assert.equal(revoked,true);return {uid:'caller-1',sub:'caller-1',aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,email_verified:true,firebase:{sign_in_provider:'google.com'},exp:Date.parse(NOW)/1000+3600};}};
  const options={enabled:true,projectId:PROJECT,tenantId:TENANT,databaseURL:URL,database};
  const session=()=>createProductionSessionService({...options,auth,admit:async()=>true,clock:()=>NOW}).execute({idToken:'synthetic-token'});
  const grant=()=>createProductionTenantAdapter(options).repository.readGrant({projectId:PROJECT,uid:'caller-1'});
  return {store,command,session,grant,cycle:()=>store.value.products['product-1'].cycles['cycle-1']};
}
test('new private lifecycle ledger roundtrips and preserves read-only partner sessions without receipt or private tariff disclosure',async()=>{
  const f=fixture(),before=copy(f.store.value);assert.equal((await f.grant()).revision,1);
  const hidden=await f.session();assert.equal(hidden.ok,true);assert.deepEqual(hidden.session.cycles,[]);assert.deepEqual(f.store.value,before);
  f.cycle().config={revision:1,active:true,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'};
  const response=await f.session();assert.equal(response.ok,true);assert.deepEqual(response.session.cycles,[{productId:'product-1',cycleId:'cycle-1'}]);
  for(const privateValue of ['ownerCommandLedger','synthetic-create-1','owner-1','commandJson','initialTariffs','tariffInputs','137'])assert.equal(JSON.stringify(response).includes(privateValue),false);
});
test('both canonical readers reject a tampered creation proof even when outside partner response scope',async()=>{
  for(const mutate of [f=>{Object.values(f.store.value.ownerCommandLedger.entries)[0].commandHash='0'.repeat(64);},f=>{Object.values(f.store.value.ownerCommandLedger.entries)[0].initialSnapshotHash='0'.repeat(64);},f=>{f.cycle().tariffInputs.historyByWorker['worker-1']['tariff-1'].rate=999;}]){
    const f=fixture();mutate(f);const before=copy(f.store.value);await assert.rejects(f.grant(),Authority.AuthorityError);assert.deepEqual(await f.session(),{ok:false,error:'not_ready'});assert.deepEqual(f.store.value,before);
  }
});
test('existing tenant snapshots without an owner ledger remain compatible, while present empty ledgers fail closed',async()=>{
  const f=fixture();delete f.store.value.ownerCommandLedger;assert.equal((await f.grant()).revision,1);assert.equal((await f.session()).ok,true);
  f.store.value.ownerCommandLedger={schemaVersion:1,entries:{}};await assert.rejects(f.grant(),Authority.AuthorityError);assert.deepEqual(await f.session(),{ok:false,error:'not_ready'});
});
