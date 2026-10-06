'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Client=require('../production-owner-tariff-client.js');
const endpointURL='https://server.example.invalid/v1/production/owner/tariffs/append',viewURL='https://server.example.invalid/v1/production/owner/tariffs/view';
const scope=()=>({projectId:'demo-owner-tariff',databaseURL:'https://demo-owner-tariff.firebaseio.com',tenantId:'tenant-1',uid:'owner-1',grantRevision:2});
const command=(id='request-1')=>({kind:'appendTariffVersion',requestId:id,productId:'product-1',cycleId:'cycle-1',expectedConfigRevision:1,expectedTariffRevision:3,workerId:'worker-1',tariffVersion:'rate-'+id,effectiveAt:'2026-10-07T00:00:00.000Z',currency:'IDR',rate:1200});
const receipt=c=>({requestId:c.requestId,kind:c.kind,productId:c.productId,cycleId:c.cycleId,workerId:c.workerId,tariffVersion:c.tariffVersion,revision:4,acceptedAt:'2026-10-06T00:00:00.000Z'});
const view=()=>({schemaVersion:1,projectId:scope().projectId,tenantId:scope().tenantId,uid:scope().uid,grantRevision:2,productId:'product-1',cycleId:'cycle-1',configRevision:1,tariffRevision:3,serverTime:'2026-10-06T00:00:00.000Z',policy:{version:'rate-policy-1',kind:'jakarta-fixed-local-time',hour:0,minute:0},workers:[{workerId:'worker-1',label:'Contoh mitra',assignedQuantity:20,history:[{tariffVersion:'original',effectiveAt:'2026-10-01T00:00:00.000Z',currency:'IDR',rate:1000}]}]});
function memory(){let raw=null;const accepted=new Map(),calls=[];return{calls,journal:{read:async()=>raw,write:async(next,old)=>{calls.push('durable');if(raw!==old)return false;raw=next;return true;},lookup:async id=>accepted.get(id)||null,acknowledge:async(next,old,entry)=>{calls.push('archive');if(raw!==old)return false;const value=JSON.parse(entry);if(accepted.has(value.command.requestId))return false;accepted.set(value.command.requestId,entry);raw=next;return true;}},raw:()=>raw,accepted};}
function response(url,value,status=200,extra={}){const data=typeof value==='string'?value:JSON.stringify(value);let done=false;return{url,status,redirected:false,type:'cors',headers:{get:name=>name==='content-type'?'application/json':null},body:{getReader:()=>({read:async()=>done?{done:true}:(done=true,{done:false,value:new TextEncoder().encode(data)}),cancel:async()=>{},releaseLock(){}})},...extra};}
function create(memory,fetch,extra={}){return Client.createClient({enabled:true,scope:scope(),endpointURL,isCurrent:()=>true,getIdToken:async()=>'fixture.header.signature',fetch,journal:memory.journal,...extra});}

test('owner tariff source defaults off and rejects getters without invoking them',async()=>{
  let touched=0;const enabled={get enabled(){touched++;return true;}};
  assert.deepEqual(await Client.createClient(enabled).pending(),{ok:false,error:'service_disabled'});assert.equal(touched,0);
  const m=memory(),c=command();Object.defineProperty(c,'rate',{enumerable:true,get(){touched++;return 1200;}});
  assert.equal((await create(m,async()=>{throw Error();}).prepare(c)).error,'invalid_request');assert.equal(touched,0);assert.equal(m.raw(),null);
});

test('view uses fixed distinct owner URL and fresh transient tokens without writing the journal',async()=>{
  const m=memory(),tokens=[],requests=[];let token=0;
  const c=create(m,async(url,options)=>{requests.push({url,options});tokens.push(options.headers.Authorization);return response(url,{ok:true,view:view()});},{getIdToken:async()=>`fixture.token${++token}.signature`});
  for(let i=0;i<2;i++)assert.deepEqual(await c.view({productId:'product-1',cycleId:'cycle-1'}),{ok:true,view:view()});
  assert.deepEqual(tokens,['Bearer fixture.token1.signature','Bearer fixture.token2.signature']);assert.equal(m.raw(),null);
  for(const r of requests){assert.equal(r.url,viewURL);assert.deepEqual(JSON.parse(r.options.body),{selection:{productId:'product-1',cycleId:'cycle-1'}});assert.equal(r.options.redirect,'error');assert.equal(r.options.credentials,'omit');assert.equal(r.options.cache,'no-store');assert.equal(r.options.referrerPolicy,'no-referrer');}
});

test('command is durable before delivery; lost acknowledgment reload retries exact body and archives accepted ID',async()=>{
  const m=memory(),bodies=[];let lose=true;
  const send=async(url,options)=>{assert.equal(JSON.parse(m.raw()).entries.length,1);bodies.push(options.body);if(lose)throw Error('private transport details');return response(url,{ok:true,receipt:receipt(command()),replayed:true});};
  const first=create(m,send);assert.deepEqual(await first.prepare(command()),{ok:true,requestId:'request-1',pending:true});
  assert.deepEqual(await first.send('request-1'),{ok:false,error:'result_unknown',retrySameCommand:true});first.dispose();lose=false;
  const reloaded=create(m,send);assert.deepEqual((await reloaded.pending()).commands,[command()]);assert.equal((await reloaded.send('request-1')).ok,true);
  assert.equal(bodies[0],bodies[1]);assert.equal((await reloaded.pending()).commands.length,0);assert.deepEqual(await reloaded.prepare(command()),{ok:true,requestId:'request-1',pending:false});
  assert.equal((await reloaded.send('request-1')).replayed,true);assert.equal(bodies.length,2);assert.ok(![m.raw(),...m.accepted.values()].join('').includes('fixture.header.signature'));
  assert.equal((await reloaded.prepare({...command(),rate:1300})).error,'conflict');
});

test('response receipt must match whole command and revision before active entry is acknowledged',async()=>{
  for(const change of [{workerId:'worker-2'},{productId:'product-2'},{tariffVersion:'other'},{revision:5},{acceptedAt:'2026-10-08T00:00:00.000Z'}]){
    const m=memory(),c=create(m,async url=>response(url,{ok:true,receipt:{...receipt(command()),...change},replayed:false}));await c.prepare(command());
    assert.equal((await c.send('request-1')).error,'result_unknown');assert.deepEqual((await c.pending()).commands,[command()]);assert.equal(m.accepted.size,0);
  }
});

test('HTTP redirects, UTF8/size/duplicate key/status/header failures leave exact pending replay',async()=>{
  const good={ok:true,receipt:receipt(command()),replayed:false};
  const cases=[url=>response(url,good,200,{redirected:true}),url=>response('https://other.example.invalid/',good),url=>response(url,good,201),url=>response(url,JSON.stringify(good).replace('"ok":true','"ok":true,"\\u006fk":true')),url=>response(url,' '.repeat(4097)),url=>response(url,good,200,{headers:{get:()=> 'text/html'}}),url=>response(url,good,200,{body:{getReader:()=>({read:async()=>({done:false,value:Uint8Array.from([0xc0,0xaf])}),cancel:async()=>{},releaseLock(){}})}})];
  for(const make of cases){const m=memory(),c=create(m,async url=>make(url));await c.prepare(command());const before=m.raw();assert.equal((await c.send('request-1')).error,'result_unknown');assert.equal(m.raw(),before);}
});

test('owner view rejects wrong scope, excess fields, duplicate versions, bad totals and oversized responses',async()=>{
  const changes=[v=>{v.uid='another-owner';},v=>{v.grantRevision=3;},v=>{v.privateLedger={};},v=>{v.workers[0].history.push({...v.workers[0].history[0]});},v=>{v.workers[0].history[0].rate=Number.MAX_SAFE_INTEGER;},v=>{v.policy.minute=60;},v=>{v.workers[0].label='x'.repeat(257);}];
  for(const change of changes){const v=view();change(v);const c=create(memory(),async url=>response(url,{ok:true,view:v}));assert.equal((await c.view({productId:'product-1',cycleId:'cycle-1'})).error,'unavailable');}
  const c=create(memory(),async url=>response(url,' '.repeat(65537)));assert.equal((await c.view({productId:'product-1',cycleId:'cycle-1'})).error,'unavailable');
});

test('account/grant invalidation during fetch clears response authority and permanently blocks scope',async()=>{
  let current=true,resolve;const m=memory(),c=create(m,url=>new Promise(r=>{resolve=()=>r(response(url,{ok:true,view:view()}));}),{isCurrent:()=>current});
  const waiting=c.view({productId:'product-1',cycleId:'cycle-1'});await new Promise(r=>setImmediate(r));current=false;resolve();assert.equal((await waiting).error,'access_denied');current=true;assert.equal((await c.pending()).error,'access_denied');
});

test('known server conflicts remain pending; no HTTP automatic retry or revision rebase',async()=>{
  let calls=0;const m=memory(),c=create(m,async url=>{calls++;return response(url,{ok:false,error:'conflict'},409);});await c.prepare(command());const before=m.raw();assert.deepEqual(await c.send('request-1'),{ok:false,error:'conflict'});assert.equal(calls,1);assert.equal(m.raw(),before);
  assert.equal((await c.prepare({...command(),expectedTariffRevision:4})).error,'conflict');assert.equal(calls,1);
});

test('malformed local journal and endpoint never silently reset or send',async()=>{
  let calls=0;const m=memory();await m.journal.write('{"private":"preserve"}',null);const c=create(m,async()=>{calls++;});assert.equal((await c.pending()).error,'unavailable');assert.equal((await c.prepare(command())).error,'unavailable');assert.equal(m.raw(),'{"private":"preserve"}');assert.equal(calls,0);
  for(const endpoint of [endpointURL+'?token=bad',endpointURL.replace('/owner/tariffs/append','/commands'),endpointURL.replace('https:','http:')])assert.equal((await create(memory(),async()=>{calls++;},{endpointURL:endpoint}).prepare(command())).error,'unavailable');assert.equal(calls,0);
});

test('tariff commands exclude legacy operations, fractional money, dangerous IDs and extra credentials',async()=>{
  for(const change of [{kind:'setGrant'},{rate:1.25},{rate:0},{workerId:'worker/path'},{tariffVersion:'__proto__'},{password:'never-save'}]){const m=memory(),c=create(m,async()=>{throw Error();});assert.equal((await c.prepare({...command(),...change})).error,'invalid_request');assert.equal(m.raw(),null);}
});

test('fixed network deadline aborts hanging fetch and streamed read; write draft remains retryable',async()=>{
  for(const stream of [false,true]){
    const m=memory();let signal;
    const c=create(m,async(url,options)=>{signal=options.signal;if(!stream)return new Promise(()=>{});return response(url,{},200,{body:{getReader:()=>({read:()=>new Promise(()=>{}),cancel:async()=>{},releaseLock(){}})}});},{requestTimeoutMs:5});
    await c.prepare(command());const before=m.raw();assert.deepEqual(await c.send('request-1'),{ok:false,error:'result_unknown',retrySameCommand:true});assert.equal(signal.aborted,true);assert.equal(m.raw(),before);assert.deepEqual((await c.pending()).commands,[command()]);
  }
  const c=create(memory(),()=>new Promise(()=>{}),{requestTimeoutMs:5});assert.deepEqual(await c.view({productId:'product-1',cycleId:'cycle-1'}),{ok:false,error:'unavailable'});
});
