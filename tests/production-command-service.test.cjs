'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Authority=require('../server/production-authority.cjs'),Service=require('../server/production-command-service.cjs');
const NOW='2026-10-05T03:00:00.000Z',DAY='2026-10-05',PROJECT='demo-command-service';
const copy=v=>JSON.parse(JSON.stringify(v));
function prune(v){if(v===null)return undefined;if(v&&typeof v==='object'){const out={};for(const [key,value]of Object.entries(v)){const child=prune(value);if(child!==undefined)out[key]=child;}return Object.keys(out).length?out:undefined;}return v;}
function setup(options={}){
  const initial=Authority.createAuthority({product:{id:'product-1',series:'Synthetic',namaBarang:'Example',size:'M',cutQuantity:10},cycleId:'cycle-1',workers:[{id:'worker-1',nama:'Synthetic first partner'},{id:'worker-2',nama:'Synthetic second partner'}],assignments:[{id:'assignment-1',workerId:'worker-1',qty:10}],now:NOW});
  const store={wire:prune(Authority.encodeStorage(initial)),profile:{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}},grantRevision:1,config:{revision:1,active:true,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'},rate:100,tariffRevision:1,revoked:false};
  const counts={auth:0,grant:0,cycle:0,tariff:0,gateway:0,writes:0,admit:0},checks=[];
  const token={uid:'caller-1',sub:'caller-1',aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,email_verified:true,firebase:{sign_in_provider:'google.com'},exp:Date.parse(NOW)/1000+3600};
  const auth={async verifyIdToken(value,checkRevoked){counts.auth++;checks.push(checkRevoked);if(store.revoked)throw Error('synthetic-token-secret');return copy(token);}};
  const readGrant=()=>({projectId:PROJECT,uid:'caller-1',revision:store.grantRevision,profile:copy(store.profile)});
  const selection=query=>({projectId:PROJECT,revision:store.tariffRevision,selection:{source:'private-verified-tariff',verified:true,workerId:query.workerId,productId:query.productId,cycleId:query.cycleId,countId:query.countId,workDate:query.workDate,basisAt:query.workDate+'T03:00:00.000Z',effectiveAt:'2026-01-01T00:00:00.000Z',tariffVersion:'tariff-v'+store.tariffRevision,currency:'IDR',rate:store.rate,selectedAt:query.selectedAt}});
  let lastQuery=null;
  const repository={
    async readGrant(query){counts.grant++;assert.deepEqual(query,{projectId:PROJECT,uid:'caller-1'});return readGrant();},
    async readCycle(query){counts.cycle++;assert.deepEqual(query,{projectId:PROJECT,productId:'product-1',cycleId:'cycle-1'});return {projectId:PROJECT,productId:'product-1',cycleId:'cycle-1',config:copy(store.config),wire:copy(store.wire)};},
    async selectTariff(query){counts.tariff++;lastQuery=copy(query);return selection(query);}
  };
  const live=expected=>({projectId:PROJECT,uid:'caller-1',grant:readGrant(),cycleConfig:copy(store.config),tariff:expected.tariff?selection(lastQuery):null});
  const commit=encoded=>{store.wire=prune(copy(encoded));counts.writes++;return {committed:true,retryable:false,wire:copy(store.wire)};};
  const gateway={projectId:PROJECT,contract:Service.contract,async run({update,expectedTrust}){counts.gateway++;const result=update(copy(store.wire),live(expectedTrust));return result===undefined?{committed:false,retryable:false}:commit(result);}};
  const configuration={enabled:true,projectId:PROJECT,auth,repository,gateway,clock:()=>NOW,admit:async()=>{counts.admit++;return true;},...options};
  const request=(kind='sewing',payload={id:'sewing-1',assignmentId:'assignment-1',tanggal:DAY,good:10,reject:0},requestId='request-1',revision=Authority.decodeStorage(store.wire).revision)=>({idToken:'synthetic-token',command:{requestId,productId:'product-1',cycleId:'cycle-1',expectedRevision:revision,kind,payload}});
  return {store,counts,checks,token,auth,repository,gateway,configuration,request,live,commit,selection,service:()=>Service.createProductionCommandService(configuration)};
}
async function sewnFixture(){const f=setup();assert.equal((await f.service().execute(f.request())).ok,true);f.store.profile={active:true,owner:false,modules:{qc:true}};f.store.grantRevision++;return f;}
const countRequest=f=>f.request('count',{id:'count-1',assignmentId:'assignment-1',tanggal:DAY,jumlah:10},'count-request');

test('default disabled and missing or wrong-project fenced gateway make no dependency calls or writes',async()=>{
  const f=setup();delete f.configuration.enabled;assert.deepEqual(await f.service().execute(f.request()),{ok:false,error:'service_disabled'});assert.deepEqual(f.counts,{auth:0,grant:0,cycle:0,tariff:0,gateway:0,writes:0,admit:0});
  for(const gateway of [undefined,{projectId:PROJECT,run:()=>{throw Error('must not run');}},{...f.gateway,projectId:'demo-other-project'}]){f.configuration.enabled=true;f.configuration.gateway=gateway;assert.deepEqual(await f.service().execute(f.request()),{ok:false,error:'unavailable'});}
  assert.equal(f.counts.auth,0);assert.equal(f.counts.writes,0);
});

test('verified own sewing commits the RTDB wire shape and returns a limited immutable receipt only',async()=>{
  const f=setup(),request=f.request(),before=copy(request),response=await f.service().execute(request);
  assert.equal(response.ok,true);assert.equal(response.replayed,false);assert.deepEqual(Object.keys(response).sort(),['ok','receipt','replayed']);assert.deepEqual(Object.keys(response.receipt).sort(),['acceptedAt','requestId','revision']);assert.equal(response.receipt.revision,1);assert.equal(Object.isFrozen(response.receipt),true);
  assert.deepEqual(request,before);assert.equal(f.counts.writes,1);assert.deepEqual(f.checks,[true]);assert.equal(Authority.decodeStorage(f.store.wire).sewing['sewing-1'].workerId,'worker-1');
  for(const value of ['privateAuthority','projection','profile','worker-1','caller-1','Synthetic','synthetic-token','payloadHash','tarif','payroll'])assert.equal(JSON.stringify(response).includes(value),false);
});

test('wrong-project, unverified, non-Google, unsafe or expired identities never enter the gateway',async()=>{
  for(const change of [{aud:'demo-other-project'},{iss:'https://example.invalid'},{email_verified:false},{firebase:{sign_in_provider:'password'}},{uid:'../unsafe',sub:'../unsafe'},{sub:'different-subject'},{exp:Date.parse(NOW)/1000}]){
    const f=setup();Object.assign(f.token,change);assert.equal((await f.service().execute(f.request())).error,'access_denied');assert.equal(f.counts.gateway,0);assert.equal(f.counts.writes,0);
  }
  const f=setup();f.store.revoked=true;const response=await f.service().execute(f.request());assert.equal(response.error,'access_denied');assert.equal(JSON.stringify(response).includes('synthetic-token-secret'),false);
});

test('client profile, worker identity, money, PINs and paid flags are rejected without echo or tariff reads',async()=>{
  for(const injected of [{workerId:'worker-2'},{tarif:999},{total:999},{pin:'synthetic-private-pin'},{payroll:{rate:999}},{dibayar:true},{profile:{owner:true}}]){
    const f=setup(),request=f.request();Object.assign(request.command.payload,injected);const response=await f.service().execute(request);assert.equal(response.error,'invalid_request');assert.equal(f.counts.gateway,0);assert.equal(f.counts.tariff,0);assert.equal(JSON.stringify(response).includes('synthetic-private-pin'),false);
  }
  const f=setup(),request=f.request();request.profile={owner:true};assert.equal((await f.service().execute(request)).error,'invalid_request');assert.equal(f.counts.auth,0);
});

test('revoked or rebound server grants and incorrect project scopes fail before writes',async()=>{
  for(const mutate of [f=>{f.store.profile.active=false;},f=>{f.store.profile.workerId='worker-2';},f=>{f.repository.readGrant=async()=>({projectId:'demo-other-project',uid:'caller-1',revision:1,profile:copy(f.store.profile)});},f=>{f.repository.readCycle=async()=>({projectId:PROJECT,productId:'other-product',cycleId:'cycle-1',config:copy(f.store.config),wire:copy(f.store.wire)});}]){
    const f=setup();mutate(f);assert.equal((await f.service().execute(f.request())).error,'access_denied');assert.equal(f.counts.writes,0);
  }
});

test('count tariff lookup is private, fully bound and frozen; the response carries no money',async()=>{
  const f=await sewnFixture(),request=countRequest(f),response=await f.service().execute(request),state=Authority.decodeStorage(f.store.wire);
  assert.equal(response.ok,true);assert.equal(f.counts.tariff,1);assert.equal(state.frozenPayroll['count-1'].workerId,'worker-1');assert.equal(state.frozenPayroll['count-1'].rate,100);
  assert.equal(state.frozenPayroll['count-1'].selectedAt,NOW);assert.equal(state.frozenPayroll['count-1'].countId,'count-1');assert.equal(state.frozenPayroll['count-1'].productId,'product-1');
  for(const value of ['rate','total','worker-1','tariff','1000','payroll'])assert.equal(JSON.stringify(response).includes(value),false);
  const broken=await sewnFixture();broken.repository.selectTariff=async query=>({...broken.selection(query),selection:{...broken.selection(query).selection,workerId:'worker-2'}});assert.equal((await broken.service().execute(countRequest(broken))).error,'not_ready');assert.equal(broken.counts.writes,1);
});

test('unreviewed cycles, throttled requests and unsupported legacy commands fail closed',async()=>{
  const f=setup();f.store.config.reviewedEmptyCycle=false;assert.equal((await f.service().execute(f.request())).error,'not_ready');assert.equal(f.counts.writes,0);
  const limited=setup({admit:async()=>false});assert.equal((await limited.service().execute(limited.request())).error,'rate_limited');assert.equal(limited.counts.grant,0);assert.equal(limited.counts.gateway,0);
  for(const kind of ['import','edit','pay','assign','warehouse']){const f=setup();assert.equal((await f.service().execute(f.request(kind,{}))).error,'invalid_request');assert.equal(f.counts.writes,0);}
});

test('live trust changes are checked inside the atomic callback and never commit speculative values',async()=>{
  for(const mutate of [f=>{f.store.profile.active=false;},f=>{f.store.profile.workerId='worker-2';},f=>{f.store.grantRevision++;}]){
    const f=setup();f.gateway.run=async({update,expectedTrust})=>{f.counts.gateway++;mutate(f);assert.equal(update(copy(f.store.wire),f.live(expectedTrust)),undefined);return {committed:false,retryable:false};};
    const before=copy(f.store.wire);assert.equal((await f.service().execute(f.request())).error,'access_denied');assert.equal(f.counts.writes,0);assert.deepEqual(f.store.wire,before);
  }
  const f=setup();f.gateway.run=async({update,expectedTrust})=>{f.store.config.revision++;assert.equal(update(copy(f.store.wire),f.live(expectedTrust)),undefined);return {committed:false,retryable:false};};
  const before=copy(f.store.wire);assert.equal((await f.service().execute(f.request())).error,'conflict');assert.equal(f.counts.writes,0);assert.deepEqual(f.store.wire,before);
  const counted=await sewnFixture();counted.gateway.run=async({update,expectedTrust})=>{counted.store.rate=200;counted.store.tariffRevision++;assert.equal(update(copy(counted.store.wire),counted.live(expectedTrust)),undefined);return {committed:false,retryable:false};};
  const prior=copy(counted.store.wire);assert.equal((await counted.service().execute(countRequest(counted))).error,'conflict');assert.equal(counted.counts.writes,1);assert.deepEqual(counted.store.wire,prior);
});

test('an internal transaction retry aborts and rechecks Auth; revocation or rebinding prevents commit',async()=>{
  for(const mutate of [f=>{f.store.revoked=true;},f=>{f.store.profile.active=false;},f=>{f.store.profile.workerId='worker-2';f.store.grantRevision++;}]){
    const f=setup();f.gateway.run=async({update,expectedTrust})=>{f.counts.gateway++;assert.ok(update(copy(f.store.wire),f.live(expectedTrust)));mutate(f);assert.equal(update(copy(f.store.wire),f.live(expectedTrust)),undefined);return {committed:false,retryable:false};};
    assert.equal((await f.service().execute(f.request())).error,'access_denied');assert.equal(f.counts.auth,2);assert.deepEqual(f.checks,[true,true]);assert.equal(f.counts.writes,0);
  }
});

test('changed historical tariff revisions across retries cannot silently reprice a fresh count',async()=>{
  const f=await sewnFixture();f.gateway.run=async({update,expectedTrust})=>{f.counts.gateway++;assert.ok(update(copy(f.store.wire),f.live(expectedTrust)));f.store.rate=200;f.store.tariffRevision++;assert.equal(update(copy(f.store.wire),f.live(expectedTrust)),undefined);return {committed:false,retryable:false};};
  const before=copy(f.store.wire),response=await f.service().execute(countRequest(f));assert.equal(response.error,'conflict');assert.equal(f.counts.writes,1);assert.equal(f.counts.tariff,2);assert.deepEqual(f.store.wire,before);
});

test('accepted receipt replay uses fresh grants but survives changed tariffs without a lookup or duplicate pay',async()=>{
  const f=await sewnFixture(),request=countRequest(f),first=await f.service().execute(request),before=copy(f.store.wire),lookups=f.counts.tariff;
  f.store.rate=999;f.store.tariffRevision++;const replay=await f.service().execute(request);
  assert.equal(replay.ok,true);assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,first.receipt);assert.equal(f.counts.tariff,lookups);assert.deepEqual(f.store.wire,before);assert.equal(Authority.decodeStorage(f.store.wire).frozenPayroll['count-1'].rate,100);
  f.store.profile.active=false;assert.equal((await f.service().execute(request)).error,'access_denied');assert.deepEqual(f.store.wire,before);
});

test('QC, repairs and cancellation preserve private frozen pay through the service envelope',async()=>{
  const f=await sewnFixture();assert.equal((await f.service().execute(countRequest(f))).ok,true);
  const frozen=copy(Authority.decodeStorage(f.store.wire).frozenPayroll);f.store.rate=999;f.store.tariffRevision++;
  assert.equal((await f.service().execute(f.request('inspect',{batchId:'batch-1',entries:[{id:'qc-1',hfId:'count-1',tanggal:DAY,ok:6,perbaikan:3,reject:1,offline:0}]},'qc-request'))).ok,true);
  assert.equal((await f.service().execute(f.request('repair',{id:'repair-1',qcId:'qc-1',tanggal:DAY,jumlah:2},'repair-request'))).ok,true);
  const total=state=>Object.values(state.projection.earningsByWorker['worker-1'].entries).reduce((sum,row)=>sum+row.total,0);
  assert.equal(total(Authority.decodeStorage(f.store.wire)),800);
  const response=await f.service().execute(f.request('cancel',{targetType:'repair',targetId:'repair-1'},'cancel-request'));
  assert.equal(response.ok,true);const state=Authority.decodeStorage(f.store.wire);assert.equal(total(state),600);assert.deepEqual(state.frozenPayroll,frozen);assert.equal(f.counts.tariff,1);
  assert.deepEqual(Object.keys(response.receipt).sort(),['acceptedAt','requestId','revision']);assert.equal(JSON.stringify(response).includes('worker-1'),false);
});

test('missing committed receipts, corrupt projection or oversized storage never get a false success response',async()=>{
  const f=setup(),original=copy(f.store.wire);f.gateway.run=async({update,expectedTrust})=>{assert.ok(update(copy(f.store.wire),f.live(expectedTrust)));return {committed:true,retryable:false,wire:original};};assert.equal((await f.service().execute(f.request())).error,'unavailable');assert.equal(f.counts.writes,0);
  const bad=setup();bad.store.wire.projection.operations.pin='synthetic-private-pin';assert.equal((await bad.service().execute(bad.request('sewing',{},'request-1',0))).error,'not_ready');assert.equal(bad.counts.writes,0);
  const big=setup();big.store.wire.privateAuthority='x'.repeat(8*1024*1024+1);const response=await big.service().execute(big.request('sewing',{},'request-1',0));assert.equal(response.error,'capacity_limit');assert.equal(big.counts.writes,0);
});

test('getter/prototype input, body ceilings and dependency exceptions never expose source or token',async()=>{
  const f=setup(),request=f.request();let calls=0;Object.defineProperty(request.command.payload,'tarif',{enumerable:true,get(){calls++;throw Error('synthetic-getter-secret');}});
  const response=await f.service().execute(request);assert.equal(response.error,'invalid_request');assert.equal(calls,0);assert.equal(f.counts.auth,0);assert.equal(JSON.stringify(response).includes('synthetic-getter-secret'),false);
  const inherited=setup(),arrayBody=inherited.request();const entries=[];Object.setPrototypeOf(entries,{get toJSON(){calls++;throw Error('synthetic-prototype-secret');}});arrayBody.command.payload.entries=entries;
  assert.equal((await inherited.service().execute(arrayBody)).error,'invalid_request');assert.equal(calls,0);assert.equal(inherited.counts.auth,0);
  const large=setup(),body=large.request();body.command.payload.note='x'.repeat(32769);assert.equal((await large.service().execute(body)).error,'invalid_request');assert.equal(large.counts.auth,0);
  const failure=setup();failure.repository.readCycle=async()=>{throw Error('synthetic-state-pin-money-token');};assert.deepEqual(await failure.service().execute(failure.request()),{ok:false,error:'unavailable'});assert.equal(failure.counts.writes,0);
});

test('bounded empty abort retries and ordinary competing revisions cannot overwrite accepted work',async()=>{
  const f=setup({maxAttempts:2});f.gateway.run=async()=>{f.counts.gateway++;return {committed:false,retryable:true};};assert.equal((await f.service().execute(f.request())).error,'conflict');assert.equal(f.counts.auth,2);assert.equal(f.counts.writes,0);
  const other=setup(),stale=other.request();assert.equal((await other.service().execute(other.request())).ok,true);stale.command.requestId='other-request';assert.equal((await other.service().execute(stale)).error,'conflict');assert.equal(other.counts.writes,1);
});
