'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Authority=require('../server/production-authority.cjs'),TariffLedger=require('../server/production-tariff-ledger.cjs');
const {createProductionTenantAdapter}=require('../server/production-tenant-adapter.cjs');
const {createProductionSessionService}=require('../server/production-session-service.cjs');
const PROJECT='demo-tariff-readers',TENANT='synthetic-tenant',URL='https://'+PROJECT+'.firebaseio.com',NOW='2026-10-06T01:00:00.000Z';
const copy=v=>structuredClone(v);
function prune(v){if(v===null)return undefined;if(v&&typeof v==='object'){const next={};for(const [key,value]of Object.entries(v)){const child=prune(value);if(child!==undefined)next[key]=child;}return Object.keys(next).length?next:undefined;}return v;}
function fixture(){
  const state=Authority.createAuthority({product:{id:'product-1',series:'Synthetic',namaBarang:'Synthetic garment',size:'M',cutQuantity:10},cycleId:'cycle-1',workers:[{id:'worker-1',nama:'Synthetic partner'}],assignments:[{id:'assignment-1',workerId:'worker-1',qty:10}],now:NOW});
  const cycle={config:{revision:1,active:true,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'},tariffInputs:{revision:2,policy:{version:'policy-1',kind:'jakarta-fixed-local-time',hour:8,minute:0},historyByWorker:{'worker-1':{'tariff-1':{effectiveAt:'2026-01-01T00:00:00.000Z',currency:'IDR',rate:137},'tariff-2':{effectiveAt:'2026-10-06T02:00:00.000Z',currency:'IDR',rate:200}}}},wire:Authority.encodeStorage(state)};
  const command={kind:'appendTariffVersion',requestId:'synthetic-change-1',productId:'product-1',cycleId:'cycle-1',expectedConfigRevision:1,expectedTariffRevision:1,workerId:'worker-1',tariffVersion:'tariff-2',effectiveAt:'2026-10-06T02:00:00.000Z',currency:'IDR',rate:200};
  const store={value:{schemaVersion:1,projectId:PROJECT,tenantId:TENANT,grants:{'caller-1':{revision:1,profile:{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}}},'owner-1':{revision:1,profile:{active:true,owner:true}}},products:{'product-1':{cycles:{'cycle-1':cycle}}}}};
  store.value.tariffCommandLedger=TariffLedger.appendTariffLedger(undefined,{uid:'owner-1',command,acceptedAt:NOW},store.value.products);store.value=prune(store.value);
  const ref={toString:()=>URL+'/authorityTenants/'+TENANT,async get(){return {val:()=>copy(store.value)};},on(){},off(){},async transaction(){throw Error('reader must not transact');}};
  const database={app:{options:{projectId:PROJECT,databaseURL:URL}},ref(path){assert.equal(path,'authorityTenants/'+TENANT);return ref;}};
  const auth={async verifyIdToken(token,revoked){assert.equal(token,'synthetic-token');assert.equal(revoked,true);return {uid:'caller-1',sub:'caller-1',aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,email_verified:true,firebase:{sign_in_provider:'google.com'},exp:Date.parse(NOW)/1000+3600};}};
  const options={enabled:true,projectId:PROJECT,tenantId:TENANT,databaseURL:URL,database};
  const session=()=>createProductionSessionService({...options,auth,admit:async()=>true,clock:()=>NOW}).execute({idToken:'synthetic-token'});
  const grant=()=>createProductionTenantAdapter(options).repository.readGrant({projectId:PROJECT,uid:'caller-1'});
  return {store,command,session,grant,cycle:()=>store.value.products['product-1'].cycles['cycle-1']};
}
test('new tariff audit survives RTDB pruning while partner session reveals no private rate, owner receipt or command',async()=>{
  const f=fixture(),before=copy(f.store.value);assert.equal((await f.grant()).revision,1);const response=await f.session();assert.equal(response.ok,true);assert.deepEqual(response.session.cycles,[{productId:'product-1',cycleId:'cycle-1'}]);
  for(const privateValue of ['tariffCommandLedger','synthetic-change-1','owner-1','commandJson','tariff-2','137','200'])assert.equal(JSON.stringify(response).includes(privateValue),false);assert.deepEqual(f.store.value,before);
});
test('canonical readers hold a forged tariff audit or altered historical version without repairing or dropping source',async()=>{
  for(const mutate of [f=>{Object.values(f.store.value.tariffCommandLedger.entries)[0].commandHash='0'.repeat(64);},f=>{Object.values(f.store.value.tariffCommandLedger.entries)[0].receipt.revision=99;},f=>{f.cycle().tariffInputs.historyByWorker['worker-1']['tariff-2'].rate=999;}]){
    const f=fixture();mutate(f);const before=copy(f.store.value);await assert.rejects(f.grant(),Authority.AuthorityError);assert.deepEqual(await f.session(),{ok:false,error:'not_ready'});assert.deepEqual(f.store.value,before);
  }
});
test('absent old tariff ledger remains compatible; present empty ledger and over-capacity audit fail explicitly',async()=>{
  const f=fixture();delete f.store.value.tariffCommandLedger;assert.equal((await f.grant()).revision,1);assert.equal((await f.session()).ok,true);
  f.store.value.tariffCommandLedger={schemaVersion:1,entries:{}};await assert.rejects(f.grant(),Authority.AuthorityError);assert.deepEqual(await f.session(),{ok:false,error:'not_ready'});
  f.store.value.tariffCommandLedger.entries=Object.fromEntries(Array.from({length:257},(_,i)=>['entry-'+i,{}]));await assert.rejects(f.grant(),e=>e instanceof Authority.AuthorityError&&e.code==='storage_capacity');assert.deepEqual(await f.session(),{ok:false,error:'capacity_limit'});
});
