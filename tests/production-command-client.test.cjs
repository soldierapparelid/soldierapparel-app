'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const Client = require('../production-command-client.js'), {createClient} = Client;
const Store = require('../production-command-store.js'), {fakeIndexedDB} = require('./helpers/command-indexeddb-fixture.cjs');
const SCOPE = {projectId:'demo-browser-proof',databaseURL:'https://demo-browser-proof.firebaseio.com',tenantId:'tenant-1',uid:'caller-1',grantRevision:1};
const ENDPOINT = 'https://commands.example.invalid/v1/production/commands', NOW = '2026-10-05T03:00:00.000Z';
const copy = value => JSON.parse(JSON.stringify(value));
const command = (requestId='request-1') => ({requestId,productId:'product-1',cycleId:'cycle-1',expectedRevision:0,kind:'sewing',payload:{id:'sewing-1',assignmentId:'assignment-1',tanggal:'2026-10-05',good:4,reject:1}});
const success = (id='request-1',extra={}) => ({ok:true,receipt:{requestId:id,revision:1,acceptedAt:NOW},replayed:false,...extra});
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function response(body,options={}){
  const raw = options.raw ?? JSON.stringify(body), chunks = options.chunks ?? [new TextEncoder().encode(raw)];
  let position=0; const stats={read:0,cancel:0,release:0};
  const headers={'content-type':options.contentType ?? 'application/json; charset=utf-8'};
  if(options.length!==undefined)headers['content-length']=options.length;
  return {url:options.url??ENDPOINT,redirected:options.redirected??false,type:options.type??'cors',status:options.status??200,headers:{get:key=>headers[key]??null},stats,
    body:{getReader:()=>({read:async()=>{stats.read++;if(options.beforeChunk)await options.beforeChunk(position);return position<chunks.length?{done:false,value:chunks[position++]}:{done:true};},cancel:async()=>{stats.cancel++;},releaseLock:()=>{stats.release++;}})}};
}
function setup(overrides={}){
  let raw=null,session=copy(SCOPE),current=true;
  const calls={reads:0,writes:[],tokens:0,fetches:[]},control={readError:false,writeError:false,writeResult:true,beforeRead:null,beforeWrite:null,beforeToken:null,reply:null};
  const journal={read:async()=>{calls.reads++;if(control.beforeRead)await control.beforeRead();if(control.readError)throw Error('synthetic-secret-read');return raw;},write:async(next,previous)=>{calls.writes.push({next,previous});if(control.beforeWrite)await control.beforeWrite();if(control.writeError)throw Error('synthetic-secret-write');if(control.writeResult!==true)return control.writeResult;if(raw!==previous)return false;raw=next;return true;}};
  const opts={enabled:true,scope:copy(SCOPE),endpointURL:ENDPOINT,getSession:()=>session,isCurrent:()=>current,getIdToken:async()=>{calls.tokens++;if(control.beforeToken)await control.beforeToken();return 'header'+calls.tokens+'.payload.signature';},fetch:async(url,options)=>{calls.fetches.push({url,options});if(control.reply)return control.reply(url,options);return response(success(JSON.parse(options.body).command.requestId));},journal,...overrides};
  return {opts,client:createClient(opts),calls,control,journal,getRaw:()=>raw,setRaw:v=>{raw=v;},setSession:v=>{session=v;},setCurrent:v=>{current=v;}};
}
function retained(options={}){
  // Public production store with an injected atomic IDB event scheduler.
  // Real browser IDB verification remains a separate integration proof.
  const f=setup(),idb=fakeIndexedDB(),storeOptions={enabled:true,retention:true,indexedDB:idb.api,scope:copy(SCOPE),endpointURL:ENDPOINT,isCurrent:f.opts.isCurrent,...options};
  const store=Store.createCommandStore(storeOptions),journal={read:store.read,write:store.write,lookup:store.lookup,acknowledge:store.acknowledge};
  const make=(extra={})=>createClient({...f.opts,journal,...extra});
  const legacy=()=>Store.createCommandStore({...storeOptions,retention:false});
  const map=()=>[...idb.databases.values()][0].stores.get('journals');
  return {...f,idb,store,journal,make,legacy,map,client:make()};
}
const journalRaw=entries=>JSON.stringify({schemaVersion:1,scope:SCOPE,endpointURL:ENDPOINT,entries});
const acceptedRaw=(c,receipt=success(c.requestId).receipt)=>JSON.stringify({schemaVersion:1,scope:SCOPE,endpointURL:ENDPOINT,command:c,receipt});
test('UMD browser export is available and default-disabled client touches no collaborators',async()=>{
  const context={};vm.runInNewContext(fs.readFileSync(require.resolve('../production-command-client.js'),'utf8'),context);
  assert.equal(typeof context.SoldierProductionCommandClient.createClient,'function');
  const f=setup({enabled:false});assert.deepEqual(await f.client.prepare(command()),{ok:false,error:'service_disabled'});assert.equal((await f.client.send('request-1')).error,'service_disabled');assert.equal((await f.client.pending()).error,'service_disabled');assert.equal(f.calls.reads+f.calls.tokens+f.calls.fetches.length,0);assert.equal(f.calls.writes.length,0);
  assert.equal((await createClient().pending()).error,'service_disabled');
});
test('trusted fixed scope/endpoint and mandatory current predicate fail closed before storage',async()=>{
  for(const change of [o=>{delete o.isCurrent;},o=>{o.scope.grantRevision=-1;},o=>{o.scope.profile={owner:true};},o=>{o.scope.databaseURL+='/?token=synthetic';},o=>{o.endpointURL+='?token=synthetic';},o=>{o.endpointURL=o.endpointURL.replace('https:','http:');},o=>{o.endpointURL='https://user:pass@commands.example.invalid/v1/production/commands';},o=>{o.endpointURL+='/';},o=>{o.extra='synthetic';}]){
    const f=setup();change(f.opts);const client=createClient(f.opts);assert.equal((await client.prepare(command())).error,'unavailable');assert.equal(f.calls.reads+f.calls.tokens+f.calls.fetches.length,0);
  }
});
test('initial canonical grant revision zero is valid and remains part of immutable scope',async()=>{
  const scope={...SCOPE,grantRevision:0},f=setup({scope,getSession:()=>copy(scope)});assert.equal((await f.client.prepare(command())).ok,true);assert.equal(JSON.parse(f.getRaw()).scope.grantRevision,0);assert.equal((await f.client.send('request-1')).ok,true);
});
test('prepare snapshots exact command and durably CAS-persists before fetch; token is header only',async()=>{
  const f=setup(),c=command();assert.deepEqual(await f.client.prepare(c),{ok:true,requestId:'request-1',pending:true});c.payload.good=9;c.expectedRevision=10;c.requestId='mutated';
  assert.equal(f.calls.fetches.length,0);const before=JSON.parse(f.getRaw());assert.deepEqual(before.entries[0].command,command());assert.equal(before.entries[0].receipt,null);assert.deepEqual(before.scope,SCOPE);
  const sent=await f.client.send('request-1');assert.deepEqual(sent,success());assert.equal((await f.client.pending()).commands.length,0);
  const transport=f.calls.fetches[0];assert.equal(transport.url,ENDPOINT);assert.deepEqual(JSON.parse(transport.options.body),{command:command()});assert.equal(transport.options.headers.Authorization,'Bearer header1.payload.signature');
  assert.equal(transport.options.redirect,'error');assert.equal(transport.options.credentials,'omit');assert.equal(transport.options.referrerPolicy,'no-referrer');assert.equal(transport.options.cache,'no-store');assert.equal(transport.options.method,'POST');assert.equal(transport.options.mode,'cors');assert.equal(transport.options.headers['Content-Type'],'application/json');
  assert.equal(f.getRaw().includes('header1'),false);assert.equal(f.getRaw().includes('Bearer'),false);assert.deepEqual(Object.keys(JSON.parse(transport.options.body)),['command']);assert.equal(Object.isFrozen(sent.receipt),true);
});
test('all supported operational command shapes accepted; money/profile/worker and malformed quantities denied',async()=>{
  const valid=[command(),{...command('count-1'),kind:'count',payload:{id:'count-1',assignmentId:'assignment-1',tanggal:'2026-10-05',jumlah:5}},{...command('repair-1'),kind:'repair',payload:{id:'repair-1',qcId:'qc-1',tanggal:'2026-10-05',jumlah:1}},{...command('inspect-1'),kind:'inspect',payload:{batchId:'batch-1',entries:[{id:'qc-1',hfId:'count-1',tanggal:'2026-10-05',ok:3,perbaikan:1,reject:1,offline:0}]}},{...command('cancel-1'),kind:'cancel',payload:{targetType:'sewing',targetId:'sewing-1'}}];
  const f=setup();for(const c of valid)assert.equal((await f.client.prepare(c)).ok,true);
  const bad=[c=>{c.payload.tarif=100;},c=>{c.payload.total=500;},c=>{c.workerId='worker-1';},c=>{c.profile={owner:true};},c=>{c.expectedRevision++;c.expectedRevision=Number.MAX_SAFE_INTEGER+1;},c=>{c.payload.good=1.1;},c=>{c.payload.good=-1;},c=>{c.payload.good=0;c.payload.reject=0;},c=>{c.payload.good=Number.MAX_SAFE_INTEGER;c.payload.reject=1;},c=>{c.payload.tanggal='2026-02-30';},c=>{c.requestId='__proto__';},c=>{c.kind='pay';},c=>{c.payload.id='with/slash';}];
  for(const change of bad){const g=setup(),c=command();change(c);assert.equal((await g.client.prepare(c)).error,'invalid_request');assert.equal(g.calls.reads+g.calls.fetches.length,0);}
});
test('own-descriptor guards reject getters, prototypes, symbols and sparse/extra-property arrays without invoking getters',async()=>{
  let invoked=0;const values=[];
  const getter=command();Object.defineProperty(getter.payload,'good',{enumerable:true,get(){invoked++;return 4;}});values.push(getter);
  const inherited=command();Object.setPrototypeOf(inherited.payload,{extra:true});values.push(inherited);
  const symbol=command();symbol[Symbol('hidden')]='synthetic';values.push(symbol);
  const nonEnumerable=command();Object.defineProperty(nonEnumerable,'hidden',{value:1});values.push(nonEnumerable);
  for(const entries of [new Array(1),Object.assign([{id:'qc-1',hfId:'count-1',tanggal:'2026-10-05',ok:1,perbaikan:0,reject:0,offline:0}],{extra:'synthetic'})])values.push({...command(),kind:'inspect',payload:{batchId:'batch-1',entries}});
  for(const c of values){const f=setup();assert.equal((await f.client.prepare(c)).error,'invalid_request');assert.equal(f.calls.writes.length,0);}assert.equal(invoked,0);
});
test('raw request byte bound rejects a syntactically valid oversized inspect command before journal/fetch',async()=>{
  const f=setup(),c={...command(),kind:'inspect',payload:{batchId:'b'.repeat(128),entries:Array.from({length:100},(_,i)=>({id:'i'.repeat(125)+String(i).padStart(3,'0'),hfId:'h'.repeat(128),tanggal:'2026-10-05',ok:Number.MAX_SAFE_INTEGER,perbaikan:0,reject:0,offline:0}))}};
  assert.ok(Buffer.byteLength(JSON.stringify({command:c}))>32768);assert.equal((await f.client.prepare(c)).error,'invalid_request');assert.equal(f.calls.reads+f.calls.fetches.length,0);
});
test('network loss and uncertain server outcomes retain one immutable command; each manual attempt obtains fresh token',async()=>{
  const f=setup();await f.client.prepare(command());let attempts=0;
  f.control.reply=async()=>{attempts++;if(attempts===1)throw Error('synthetic-secret-network');if(attempts===2)return response({ok:false,error:'result_unknown',retrySameCommand:true},{status:503});return response(success('request-1',{replayed:true}));};
  for(let i=0;i<2;i++){assert.deepEqual(await f.client.send('request-1'),{ok:false,error:'result_unknown',retrySameCommand:true});assert.deepEqual((await f.client.pending()).commands,[command()]);assert.equal(f.calls.fetches.length,i+1);}
  assert.equal((await f.client.send('request-1')).replayed,true);assert.equal(f.calls.fetches.length,3);assert.equal(f.calls.tokens,3);assert.equal(new Set(f.calls.fetches.map(f=>f.options.body)).size,1);assert.deepEqual(f.calls.fetches.map(f=>f.options.headers.Authorization),['Bearer header1.payload.signature','Bearer header2.payload.signature','Bearer header3.payload.signature']);assert.equal(JSON.parse(f.getRaw()).entries.length,1);
});
test('every whitelisted HTTP failure holds pending; retryable flag and status are exact',async()=>{
  const errors={access_denied:403,invalid_request:400,conflict:409,not_ready:409,capacity_limit:409,rate_limited:429,service_disabled:503,unavailable:503,busy:503,result_unknown:503};
  for(const [error,status]of Object.entries(errors)){const f=setup();await f.client.prepare(command());const body={ok:false,error};if(['unavailable','busy','result_unknown'].includes(error))body.retrySameCommand=true;f.control.reply=async()=>response(body,{status});assert.deepEqual(await f.client.send('request-1'),body);assert.equal((await f.client.pending()).commands.length,1);assert.equal(f.calls.fetches.length,1);}
});
test('acknowledged request ID cannot change payload/revision and is not sent again',async()=>{
  const f=setup();await f.client.prepare(command());await f.client.send('request-1');assert.deepEqual(await f.client.prepare(command()),{ok:true,requestId:'request-1',pending:false});assert.equal((await f.client.send('request-1')).replayed,true);assert.equal(f.calls.fetches.length,1);
  for(const change of [c=>{c.payload.good=3;},c=>{c.expectedRevision=1;}]){const c=command();change(c);assert.equal((await f.client.prepare(c)).error,'conflict');}
  assert.equal(JSON.parse(f.getRaw()).entries[0].receipt.revision,1);
});
test('restart replays only injected matching journal; no legacy discovery or mutation',async()=>{
  const legacy=new Map([['old-global-draft','synthetic-unbound-record']]),legacyBefore=[...legacy];const f=setup();await f.client.prepare(command());const restarted=createClient({...f.opts,journal:f.journal});assert.deepEqual((await restarted.pending()).commands,[command()]);assert.equal((await restarted.send('request-1')).ok,true);assert.deepEqual([...legacy],legacyBefore);
  const fresh=setup();assert.deepEqual((await fresh.client.pending()).commands,[]);assert.equal(fresh.getRaw(),null);assert.equal((await fresh.client.send('request-1')).error,'invalid_request');
});
test('corruption, duplicate/escaped keys, foreign scope/endpoint and unknown credential fields are retained fail-closed',async()=>{
  const f=setup();await f.client.prepare(command());const normal=f.getRaw(),doc=JSON.parse(normal),bad=[];
  bad.push('{"secret":"synthetic-secret"}',normal.replace('"schemaVersion":1','"schemaVersion":1,"schemaVersion":1'),normal.replace('"schemaVersion":1','"schemaVersion":1,"schema\\u0056ersion":1'));
  for(const change of [v=>{v.scope.uid='caller-2';},v=>{v.scope.grantRevision=2;},v=>{v.scope.projectId='demo-other-project';},v=>{v.scope.databaseURL='https://demo-other-project.firebaseio.com';},v=>{v.scope.tenantId='tenant-2';},v=>{v.endpointURL='https://other.example.invalid/v1/production/commands';},v=>{v.entries[0].command.payload.password='synthetic-secret';},v=>{v.entries[0].receipt={requestId:'other-request',revision:1,acceptedAt:NOW};},v=>{v.entries.push(copy(v.entries[0]));}]){const v=copy(doc);change(v);bad.push(JSON.stringify(v));}
  for(const raw of bad){f.setRaw(raw);const before=f.calls.writes.length,fetches=f.calls.fetches.length;for(const operation of [()=>f.client.pending(),()=>f.client.prepare(command('request-2')),()=>f.client.send('request-1')])assert.deepEqual(await operation(),{ok:false,error:'unavailable',retrySameCommand:true});assert.equal(f.getRaw(),raw);assert.equal(f.calls.writes.length,before);assert.equal(f.calls.fetches.length,fetches);}
});
test('storage read/write faults and uncertain durability prevent send; errors never echo injected details',async()=>{
  for(const mode of ['readError','writeError']){const f=setup();f.control[mode]=true;const result=await f.client.prepare(command());assert.deepEqual(result,{ok:false,error:'unavailable',retrySameCommand:true});assert.equal(f.calls.fetches.length,0);assert.equal(f.getRaw(),null);assert.equal(JSON.stringify(result).includes('synthetic-secret'),false);}
  for(const value of [undefined,null,1,'true']){const f=setup();f.control.writeResult=value;assert.equal((await f.client.prepare(command())).error,'unavailable');assert.equal(f.calls.fetches.length,0);assert.equal(f.getRaw(),null);}
  const f=setup();await f.client.prepare(command());const before=f.getRaw();f.control.writeError=true;assert.equal((await f.client.send('request-1')).error,'unavailable');assert.equal(f.getRaw(),before);assert.equal((await f.client.pending()).commands.length,1);
});
test('same UID grant revision/account/project/db/tenant changes permanently revoke client and hold previous draft',async()=>{
  for(const change of [s=>{s.uid='caller-2';},s=>{s.grantRevision++;},s=>{s.projectId='demo-other-project';},s=>{s.databaseURL='https://demo-other-project.firebaseio.com';},s=>{s.tenantId='tenant-2';}]){const f=setup();await f.client.prepare(command());const before=f.getRaw(),changed=copy(SCOPE);change(changed);f.setSession(changed);assert.equal((await f.client.send('request-1')).error,'access_denied');assert.equal(f.calls.tokens+f.calls.fetches.length,0);assert.equal(f.getRaw(),before);f.setSession(copy(SCOPE));assert.equal((await f.client.pending()).error,'access_denied');}
  const f=setup();await f.client.prepare(command());f.setCurrent(false);assert.equal((await f.client.pending()).error,'access_denied');f.setCurrent(true);assert.equal((await f.client.send('request-1')).error,'access_denied');
});
test('scope invalidation during durable prepare or token refresh prevents fetch and retains scoped source',async()=>{
  const f=setup(),gate=deferred(),started=deferred();f.control.beforeWrite=async()=>{started.resolve();await gate.promise;};const preparing=f.client.prepare(command());await started.promise;f.setSession({...SCOPE,grantRevision:2});gate.resolve();assert.equal((await preparing).error,'access_denied');assert.equal(f.calls.fetches.length,0);assert.equal(JSON.parse(f.getRaw()).entries.length,1);
  const g=setup();await g.client.prepare(command());const before=g.getRaw(),tokenGate=deferred(),tokenStarted=deferred();g.control.beforeToken=async()=>{tokenStarted.resolve();await tokenGate.promise;};const sending=g.client.send('request-1');await tokenStarted.promise;g.setCurrent(false);tokenGate.resolve();assert.equal((await sending).error,'access_denied');assert.equal(g.calls.fetches.length,0);assert.equal(g.getRaw(),before);
});
test('disable while fetch pending suppresses receipt/journal acknowledgment and stops all later work',async()=>{
  const f=setup();await f.client.prepare(command());const before=f.getRaw(),gate=deferred(),started=deferred();f.control.reply=async()=>{started.resolve();await gate.promise;return response(success());};const sending=f.client.send('request-1');await started.promise;f.client.disable();gate.resolve();assert.equal((await sending).error,'service_disabled');assert.equal(f.getRaw(),before);assert.equal((await f.client.prepare(command('request-2'))).error,'service_disabled');assert.equal((await f.client.pending()).error,'service_disabled');assert.equal(f.calls.fetches.length,1);
});
test('invalid token is never sent or journaled; malformed/extra session descriptor denies before token',async()=>{
  for(const token of ['Bearer header.payload.signature','header.payload','x'.repeat(16385),'header.payload.signature\r\nInjected: yes']){const f=setup({getIdToken:async()=>token});await f.client.prepare(command());assert.equal((await f.client.send('request-1')).error,'access_denied');assert.equal(f.calls.fetches.length,0);assert.equal(f.getRaw().includes(token),false);}
  let invoked=0;const f=setup();await f.client.prepare(command());const session=copy(SCOPE);Object.defineProperty(session,'uid',{enumerable:true,get(){invoked++;return SCOPE.uid;}});f.setSession(session);assert.equal((await f.client.send('request-1')).error,'access_denied');assert.equal(invoked,0);assert.equal(f.calls.tokens,0);
});
test('untrusted redirects, response type/content-type/status/size and invalid UTF8 keep the immutable pending command',async()=>{
  const specs=[{redirected:true},{url:'https://other.example.invalid/v1/production/commands'},{type:'opaque'},{type:'opaqueredirect'},{contentType:'text/html'},{status:201},{length:'4097'},{length:'-1'},{raw:'x'.repeat(4097)},{chunks:[new Uint8Array([0xc3,0x28])]}];
  for(const spec of specs){const f=setup();await f.client.prepare(command());const before=f.getRaw(),r=response(success(),spec);f.control.reply=async()=>r;assert.deepEqual(await f.client.send('request-1'),{ok:false,error:'result_unknown',retrySameCommand:true});assert.equal(f.getRaw(),before);assert.deepEqual((await f.client.pending()).commands,[command()]);if(spec.raw)assert.equal(r.stats.cancel,1);}
});
test('declared encoded length may differ from decoded receipt stream while actual decoded overflow still holds',async()=>{
  // Simulates Fetch's header/decoded-stream contract; does not perform gzip.
  const raw=JSON.stringify(success()),encodedLength=String(Buffer.byteLength(raw)-12),f=setup();await f.client.prepare(command());f.control.reply=async()=>response(success(),{length:encodedLength});assert.deepEqual(await f.client.send('request-1'),success());assert.equal((await f.client.pending()).commands.length,0);
  const g=setup();await g.client.prepare(command());const before=g.getRaw(),oversized=raw+' '.repeat(4097-Buffer.byteLength(raw)),r=response(success(),{raw:oversized,length:encodedLength});assert.equal(Buffer.byteLength(oversized),4097);g.control.reply=async()=>r;assert.deepEqual(await g.client.send('request-1'),{ok:false,error:'result_unknown',retrySameCommand:true});assert.equal(r.stats.cancel,1);assert.equal(g.getRaw(),before);assert.deepEqual((await g.client.pending()).commands,[command()]);
});
test('response streaming is bounded even when transport produces only empty chunks',async()=>{
  const f=setup();await f.client.prepare(command());const before=f.getRaw(),r=response(success(),{chunks:Array.from({length:4098},()=>new Uint8Array(0))});f.control.reply=async()=>r;assert.equal((await f.client.send('request-1')).error,'result_unknown');assert.equal(r.stats.read,4097);assert.equal(r.stats.cancel,1);assert.equal(f.getRaw(),before);
});
test('receipt whitelist, matching ID, ISO instant and duplicate keys are required before acknowledgment',async()=>{
  const specs=[{body:success('other-request')},{body:success('request-1',{password:'synthetic-secret'})},{body:{...success(),receipt:{...success().receipt,workerId:'worker-1'}}},{body:{...success(),receipt:{...success().receipt,revision:0}}},{body:{...success(),receipt:{...success().receipt,acceptedAt:'2026-02-30T03:00:00.000Z'}}},{raw:'{"ok":false,"ok":true,"receipt":{"requestId":"request-1","revision":1,"acceptedAt":"'+NOW+'"},"replayed":false}'},{body:{ok:false,error:'unavailable'},status:503},{body:{ok:false,error:'rate_limited'},status:403},{body:{ok:false,error:'synthetic-secret'},status:503}];
  for(const spec of specs){const f=setup();await f.client.prepare(command());const before=f.getRaw();f.control.reply=async()=>response(spec.body??success(),spec);assert.deepEqual(await f.client.send('request-1'),{ok:false,error:'result_unknown',retrySameCommand:true});assert.equal(f.getRaw(),before);}
});
test('two browser instances CAS-merge distinct pending requests without losing either draft',async()=>{
  const f=setup(),second=createClient({...f.opts,journal:f.journal}),gate=deferred();let writes=0;f.control.beforeWrite=async()=>{writes++;if(writes<=2){if(writes===2)gate.resolve();await gate.promise;}};
  const results=await Promise.all([f.client.prepare(command('request-a')),second.prepare(command('request-b'))]);assert.ok(results.every(r=>r.ok));assert.deepEqual(JSON.parse(f.getRaw()).entries.map(e=>e.command.requestId).sort(),['request-a','request-b']);assert.equal(f.calls.fetches.length,0);assert.equal(f.calls.writes.length,3);
  f.control.beforeWrite=null;assert.equal((await f.client.send('request-a')).ok,true);assert.deepEqual((await second.pending()).commands.map(c=>c.requestId),['request-b']);
});
test('competing instances cannot replace same request ID with another payload',async()=>{
  const f=setup(),second=createClient({...f.opts,journal:f.journal}),gate=deferred();let writes=0;f.control.beforeWrite=async()=>{writes++;if(writes<=2){if(writes===2)gate.resolve();await gate.promise;}};
  const other=command();other.payload.good=3;const results=await Promise.all([f.client.prepare(command()),second.prepare(other)]);assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.filter(r=>r.error==='conflict').length,1);assert.equal(JSON.parse(f.getRaw()).entries.length,1);assert.equal(f.calls.fetches.length,0);
});
test('receipt acknowledgment racing another instance prepare preserves both receipt and new pending draft',async()=>{
  const f=setup();await f.client.prepare(command('request-a'));const second=createClient({...f.opts,journal:f.journal}),gate=deferred(),fetchStarted=deferred();f.control.reply=async()=>{fetchStarted.resolve();await gate.promise;return response(success('request-a'));};
  const sending=f.client.send('request-a');await fetchStarted.promise;assert.equal((await second.prepare(command('request-b'))).ok,true);gate.resolve();assert.equal((await sending).ok,true);const doc=JSON.parse(f.getRaw());assert.equal(doc.entries.length,2);assert.equal(doc.entries.find(e=>e.command.requestId==='request-a').receipt.requestId,'request-a');assert.equal(doc.entries.find(e=>e.command.requestId==='request-b').receipt,null);assert.deepEqual((await second.pending()).commands.map(c=>c.requestId),['request-b']);
});
test('CAS contention is bounded and ambiguous CAS that actually persisted is not treated as lost draft',async()=>{
  const f=setup();f.control.writeResult=false;assert.equal((await f.client.prepare(command())).error,'unavailable');assert.equal(f.calls.writes.length,3);assert.equal(f.calls.fetches.length,0);assert.equal(f.getRaw(),null);
  const g=setup();const uncertain={read:g.journal.read,write:async(next,previous)=>{assert.equal(await g.journal.write(next,previous),true);throw Error('synthetic-lost-commit-ack');}};const client=createClient({...g.opts,journal:uncertain});assert.equal((await client.prepare(command())).error,'unavailable');assert.deepEqual((await client.pending()).commands,[command()]);assert.equal(g.calls.fetches.length,0);
});
test('journal record capacity holds new command without dropping acknowledged history',async()=>{
  const f=setup();for(let i=0;i<64;i++)assert.equal((await f.client.prepare(command('request-'+i))).ok,true);const before=f.getRaw();assert.equal((await f.client.prepare(command('one-more'))).error,'capacity_limit');assert.equal(f.getRaw(),before);assert.equal((await f.client.pending()).commands.length,64);assert.equal(f.calls.fetches.length,0);
});
test('journal byte capacity holds additional valid commands before record limit and preserves exact source',async()=>{
  const f=setup();let held=false;
  for(let i=0;i<64;i++){
    const c={...command('request-'+i),kind:'inspect',payload:{batchId:'batch-'+i,entries:Array.from({length:80},(_,n)=>({id:'i'.repeat(90)+String(n),hfId:'h'.repeat(90)+String(n),tanggal:'2026-10-05',ok:1,perbaikan:0,reject:0,offline:0}))}};
    assert.ok(Buffer.byteLength(JSON.stringify({command:c}))<=32768);const before=f.getRaw(),result=await f.client.prepare(c);
    if(!result.ok){assert.equal(result.error,'capacity_limit');assert.equal(f.getRaw(),before);assert.ok(JSON.parse(before).entries.length<64);held=true;break;}
  }
  assert.equal(held,true);assert.equal(f.calls.fetches.length,0);
});
test('pure journal/archive decoders freeze exact scope, retain original receipt and bound future archive bytes without IO',()=>{
  const c=command(),raw=acceptedRaw(c),decoded=Client.decodeAccepted(raw,SCOPE,ENDPOINT,'request-1');assert.deepEqual(decoded.command,c);assert.deepEqual(decoded.receipt,success().receipt);assert.equal(Object.isFrozen(decoded.command.payload),true);assert.equal(Object.isFrozen(decoded.scope),true);assert.ok(Client.acceptedStorageBound(c,SCOPE,ENDPOINT)>=Buffer.byteLength(raw));
  const doc=Client.decodeJournal(journalRaw([{command:c,receipt:null}]),SCOPE,ENDPOINT);assert.equal(Object.isFrozen(doc.entries),true);assert.deepEqual(Client.decodeJournal(null,SCOPE,ENDPOINT).entries,[]);
  for(const value of [raw.replace('"schemaVersion":1','"schemaVersion":1,"schema\\u0056ersion":1'),acceptedRaw({...c,workerId:'synthetic-worker'}),raw.replace('"uid":"caller-1"','"uid":"caller-2"')])assert.throws(()=>Client.decodeAccepted(value,SCOPE,ENDPOINT,'request-1'),e=>e.message==='invalid_journal');
  assert.throws(()=>Client.decodeAccepted(raw,SCOPE,ENDPOINT,'different-request'),/invalid_journal/);let getters=0;const bad=command();Object.defineProperty(bad.payload,'good',{enumerable:true,get(){getters++;return 4;}});assert.throws(()=>Client.acceptedStorageBound(bad,SCOPE,ENDPOINT),/invalid_journal/);assert.equal(getters,0);
});
test('opt-in atomic acknowledgment archives the full original command and receipt before removing active pending',async()=>{
  const f=retained(),c=command();assert.equal((await f.client.prepare(c)).ok,true);const before=await f.store.read();assert.deepEqual(JSON.parse(before).entries,[{command:c,receipt:null}]);assert.equal(await f.store.lookup(c.requestId),null);
  const result=await f.client.send(c.requestId);assert.deepEqual(result,success());assert.deepEqual(JSON.parse(await f.store.read()).entries,[]);const archived=Client.decodeAccepted(await f.store.lookup(c.requestId),SCOPE,ENDPOINT,c.requestId);assert.deepEqual(archived.command,c);assert.deepEqual(archived.receipt,success().receipt);assert.equal((await f.client.pending()).commands.length,0);
  assert.equal((await f.make().send(c.requestId)).replayed,true);assert.equal(f.calls.fetches.length,1);assert.equal(f.calls.tokens,1);
});
test('ordinary retained usage passes64 accepted requests while old IDs retain stable receipt and changed reuse conflicts',async()=>{
  const f=retained();for(let i=0;i<80;i++){const c=command('daily-'+i);assert.equal((await f.client.prepare(c)).ok,true);assert.equal((await f.client.send(c.requestId)).ok,true);}
  assert.deepEqual((await f.client.pending()).commands,[]);assert.equal(JSON.parse(await f.store.read()).entries.length,0);assert.equal(f.calls.fetches.length,80);
  assert.deepEqual(await f.client.prepare(command('daily-0')),{ok:true,requestId:'daily-0',pending:false});assert.deepEqual((await f.client.send('daily-0')).receipt,success('daily-0').receipt);const changed=command('daily-0');changed.expectedRevision=1;assert.equal((await f.client.prepare(changed)).error,'conflict');assert.equal(f.calls.fetches.length,80);
});
test('all64 already-accepted canonical v1 entries compact in current scope before new prepare without HTTP or identity changes',async()=>{
  const f=retained(),entries=Array.from({length:64},(_,i)=>({command:command('old-'+i),receipt:success('old-'+i).receipt})),source=journalRaw(entries);await f.legacy().write(source,null);
  assert.deepEqual(await f.client.prepare(command('new-request')),{ok:true,requestId:'new-request',pending:true});assert.equal(f.calls.fetches.length+f.calls.tokens,0);assert.deepEqual(JSON.parse(await f.store.read()).entries,[{command:command('new-request'),receipt:null}]);
  for(const entry of entries){const archive=Client.decodeAccepted(await f.store.lookup(entry.command.requestId),SCOPE,ENDPOINT,entry.command.requestId);assert.deepEqual(archive.command,entry.command);assert.deepEqual(archive.receipt,entry.receipt);}
});
test('legacy canonical migration rollback preserves exact source and every unresolved sibling, then resumes locally',async()=>{
  const f=retained(),entries=Array.from({length:64},(_,i)=>({command:command('old-'+i),receipt:i===63?null:success('old-'+i).receipt})),source=journalRaw(entries);await f.legacy().write(source,null);f.idb.control.putFailAt=3;
  assert.equal((await f.client.prepare(command('new-request'))).error,'unavailable');f.idb.control.putFailAt=0;assert.equal(await f.store.read(),source);assert.equal(await f.store.lookup('old-0'),null);assert.equal(f.calls.fetches.length,0);
  assert.equal((await f.client.prepare(command('new-request'))).ok,true);assert.deepEqual((await f.client.pending()).commands,[command('old-63'),command('new-request')]);assert.equal(f.calls.fetches.length,0);
});
test('archive transaction failure retains identical pending command for exact manual replay',async()=>{
  const f=retained();await f.client.prepare(command());const before=await f.store.read();f.idb.control.putFailAt=3;assert.equal((await f.client.send('request-1')).error,'unavailable');f.idb.control.putFailAt=0;assert.equal(await f.store.read(),before);assert.equal(await f.store.lookup('request-1'),null);assert.deepEqual((await f.client.pending()).commands,[command()]);
  f.control.reply=async()=>response(success('request-1',{replayed:true}));assert.equal((await f.client.send('request-1')).replayed,true);assert.equal(f.calls.fetches.length,2);assert.equal(new Set(f.calls.fetches.map(x=>x.options.body)).size,1);assert.deepEqual(JSON.parse(await f.store.read()).entries,[]);
});
test('durable archive commit with lost local acknowledgment resolves original receipt without HTTP resend',async()=>{
  const f=retained();let lose=true;const journal={...f.journal,acknowledge:async(...args)=>{const result=await f.store.acknowledge(...args);if(result===true&&lose){lose=false;throw Error('synthetic-lost-local-ack');}return result;}};const client=f.make({journal});await client.prepare(command());assert.equal((await client.send('request-1')).error,'unavailable');assert.deepEqual(JSON.parse(await f.store.read()).entries,[]);assert.ok(await f.store.lookup('request-1'));
  assert.deepEqual(await client.send('request-1'),{...success(),replayed:true});assert.equal(f.calls.fetches.length,1);assert.equal(f.calls.tokens,1);assert.deepEqual(await client.prepare(command()),{ok:true,requestId:'request-1',pending:false});
});
test('retained acknowledgment racing another-tab draft keeps its sibling and archives only matching request',async()=>{
  const f=retained();await f.client.prepare(command('request-a'));const second=f.make(),gate=deferred(),started=deferred();f.control.reply=async()=>{started.resolve();await gate.promise;return response(success('request-a'));};const sending=f.client.send('request-a');await started.promise;assert.equal((await second.prepare(command('request-b'))).ok,true);gate.resolve();assert.equal((await sending).ok,true);
  assert.deepEqual((await second.pending()).commands,[command('request-b')]);assert.ok(await f.store.lookup('request-a'));assert.equal(await f.store.lookup('request-b'),null);
});
test('two concurrent matching acknowledgments converge to one immutable archive and preserve stable receipt',async()=>{
  const f=retained();await f.client.prepare(command());const second=f.make(),gate=deferred();let fetches=0;f.control.reply=async()=>{fetches++;if(fetches===2)gate.resolve();await gate.promise;return response(success());};const results=await Promise.all([f.client.send('request-1'),second.send('request-1')]);assert.ok(results.every(r=>r.ok));assert.deepEqual(results[0].receipt,results[1].receipt);assert.deepEqual((await second.pending()).commands,[]);assert.deepEqual(Client.decodeAccepted(await f.store.lookup('request-1'),SCOPE,ENDPOINT).receipt,success().receipt);assert.equal(f.calls.fetches.length,2);
});
test('atomic archive guard blocks same-ID resurrection after raw journal ABA across two instances',async()=>{
  const f=retained(),empty=journalRaw([]);assert.equal(await f.store.write(empty,null),true);const gate=deferred(),started=deferred();let blocked=false;
  const slow=f.make({journal:{...f.journal,write:async(next,previous)=>{if(!blocked){blocked=true;started.resolve();await gate.promise;}return f.store.write(next,previous);}}}),preparing=slow.prepare(command());await started.promise;
  const other=command();other.payload.good=3;assert.equal((await f.client.prepare(other)).ok,true);assert.equal((await f.client.send(other.requestId)).ok,true);assert.equal(await f.store.read(),empty);gate.resolve();assert.equal((await preparing).error,'conflict');assert.equal(await f.store.read(),empty);assert.deepEqual(Client.decodeAccepted(await f.store.lookup('request-1'),SCOPE,ENDPOINT).command,other);assert.equal(f.calls.fetches.length,1);
});
test('archive count/byte reservation stops new HTTP before capacity, while exact archived replay and conflicts resolve first',async()=>{
  for(const options of [{archiveLimit:1},{archiveBytesLimit:Client.acceptedStorageBound(command(),SCOPE,ENDPOINT)}]){
    const f=retained(options);await f.client.prepare(command());assert.equal((await f.client.send('request-1')).ok,true);const before=await f.store.read();assert.equal((await f.client.prepare(command('request-2'))).error,'capacity_limit');assert.equal(await f.store.read(),before);assert.equal(f.calls.fetches.length,1);
    assert.deepEqual(await f.client.prepare(command()),{ok:true,requestId:'request-1',pending:false});assert.deepEqual((await f.client.send('request-1')).receipt,success().receipt);const changed=command();changed.payload.good=3;assert.equal((await f.client.prepare(changed)).error,'conflict');assert.equal(f.calls.fetches.length,1);
  }
});
test('corrupt/foreign accepted envelopes are retained fail-closed without exposing their fields',async()=>{
  for(const change of [v=>{v.scope.uid='caller-2';},v=>{v.scope.grantRevision++;},v=>{v.receipt.requestId='other';},v=>{v.command.payload.password='synthetic-private-value';}]){
    const f=retained();await f.client.prepare(command());await f.client.send('request-1');const before=await f.store.read(),map=f.map(),key=[...map.keys()].find(k=>k.includes('"accepted",')),value=JSON.parse(map.get(key));change(value);const corrupt=JSON.stringify(value);map.set(key,corrupt);assert.deepEqual(await f.client.prepare(command()),{ok:false,error:'unavailable',retrySameCommand:true});assert.equal(map.get(key),corrupt);assert.equal(await f.store.read(),before);assert.equal(f.calls.fetches.length,1);
  }
});
test('fresh grant/account scope reads neither prior pending nor accepted records and never adopts them',async()=>{
  const f=retained();await f.client.prepare(command('accepted'));await f.client.send('accepted');await f.client.prepare(command('unresolved'));const original=await f.store.read(),originalArchive=await f.store.lookup('accepted');
  for(const scope of [{...SCOPE,grantRevision:2},{...SCOPE,uid:'caller-2'}]){
    const store=Store.createCommandStore({enabled:true,retention:true,indexedDB:f.idb.api,scope,endpointURL:ENDPOINT,isCurrent:()=>true}),client=f.make({scope,getSession:()=>scope,journal:{read:store.read,write:store.write,lookup:store.lookup,acknowledge:store.acknowledge}});assert.deepEqual((await client.pending()).commands,[]);assert.equal((await client.send('accepted')).error,'invalid_request');assert.equal(await store.read(),null);assert.equal(await store.lookup('accepted'),null);
  }
  assert.equal(await f.store.read(),original);assert.equal(await f.store.lookup('accepted'),originalArchive);assert.equal(f.calls.fetches.length,1);
});
test('invalidation during archive lookup cannot expose accepted receipt or send, and preserves original archive',async()=>{
  const f=retained();await f.client.prepare(command());await f.client.send('request-1');const original=await f.store.lookup('request-1'),gate=deferred(),started=deferred();const client=f.make({journal:{...f.journal,lookup:async id=>{const raw=await f.store.lookup(id);started.resolve();await gate.promise;return raw;}}});const replay=client.send('request-1');await started.promise;f.setCurrent(false);gate.resolve();assert.equal((await replay).error,'access_denied');assert.equal(f.calls.fetches.length,1);f.setCurrent(true);assert.equal(await f.store.lookup('request-1'),original);assert.equal((await client.send('request-1')).error,'access_denied');
});
