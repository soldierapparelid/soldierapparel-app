'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),Store=require('../production-command-store.js'),{fakeIndexedDB}=require('./helpers/command-indexeddb-fixture.cjs');
const scope=()=>({projectId:'demo-store-proof',databaseURL:'https://demo-store-proof.firebaseio.com',tenantId:'tenant-1',uid:'caller-1',grantRevision:0}),endpointURL='https://server.example.invalid/v1/production/commands';
function create(f,extra={}){return Store.createCommandStore({enabled:true,indexedDB:f.api,scope:scope(),endpointURL,isCurrent:()=>true,...extra});}
test('disabled and invalid scope never open storage',async()=>{const f=fakeIndexedDB();await assert.rejects(Store.createCommandStore().read(),/service_disabled/);for(const change of [{uid:'other/uid'},{grantRevision:-1},{databaseURL:'http://invalid'}])assert.throws(()=>create(f,{scope:{...scope(),...change}}),/invalid_storage/);assert.equal(f.stats.opens,0);});
test('native-shaped transaction completes durable raw CAS before returning; known conflict retains exact prior bytes',async()=>{const f=fakeIndexedDB(),a=create(f),b=create(f);assert.equal(await a.read(),null);assert.equal(await a.write('{"a":1}',null),true);assert.equal(await b.read(),'{"a":1}');assert.equal(await b.write('{"a":2}',null),false);assert.equal(await a.read(),'{"a":1}');assert.equal(await b.write('{"a":2}','{"a":1}'),true);assert.equal(await a.read(),'{"a":2}');});
test('two handles cannot both replace the same prior raw snapshot',async()=>{const f=fakeIndexedDB(),a=create(f),b=create(f);const results=await Promise.all([a.write('first',null),b.write('second',null)]);assert.deepEqual(results,[true,false]);assert.equal(await b.read(),'first');});
test('account, tenant, revision and endpoint bind independent keys without enumeration or adoption',async()=>{const f=fakeIndexedDB(),a=create(f);await a.write('old-scope',null);for(const extra of [{scope:{...scope(),uid:'caller-2'}},{scope:{...scope(),tenantId:'tenant-2'}},{scope:{...scope(),grantRevision:1}},{endpointURL:'https://other.example.invalid/v1/production/commands'}])assert.equal(await create(f,extra).read(),null);assert.equal(await a.read(),'old-scope');});
test('aborted writes and malformed stored values hold without replacing source',async()=>{const f=fakeIndexedDB(),a=create(f);await a.write('old',null);f.control.putFail=true;await assert.rejects(a.write('new','old'),/storage_unavailable/);f.control.putFail=false;assert.equal(await a.read(),'old');await assert.rejects(a.write('x'.repeat(262145),'old'),/invalid_storage/);assert.equal(await a.read(),'old');});
test('invalidation before open and after a commit cannot expose another account; old bytes remain',async()=>{const f=fakeIndexedDB();let current=true;const a=create(f,{isCurrent:()=>current});await a.write('old',null);let release,started;const ready=new Promise(r=>{started=r;});f.control.beforeCommit=()=>{started();return new Promise(r=>{release=r;});};const writing=a.write('late','old');await ready;current=false;release();await assert.rejects(writing,/storage_inactive/);f.control.beforeCommit=null;assert.equal(await create(f).read(),'late');const b=create(f,{isCurrent:()=>false});await assert.rejects(b.read(),/storage_inactive/);assert.equal(f.stats.opens,2);});
test('blocked late-open handle is closed and never adopted; errors expose no native exception detail',async()=>{const f=fakeIndexedDB();f.control.blocked=true;const a=create(f);await assert.rejects(a.read(),/storage_unavailable/);assert.equal(f.stats.closes,1);const b=fakeIndexedDB();b.control.openFail=true;await assert.rejects(create(b).read(),e=>e.message==='storage_unavailable');});
test('dispose and browser version change close handles, preserve source and prohibit future reads/writes',async()=>{const f=fakeIndexedDB(),a=create(f);await a.write('retain',null);a.dispose();await assert.rejects(a.read(),/storage_inactive/);await assert.rejects(a.write('new','retain'),/storage_inactive/);assert.equal(await create(f).read(),'retain');});

const Client=require('../production-command-client.js');
const command=id=>({requestId:id,productId:'product-1',cycleId:'cycle-1',expectedRevision:0,kind:'sewing',payload:{id:'entry-'+id,assignmentId:'assignment-1',tanggal:'2026-10-05',good:1,reject:0}});
const row=id=>({command:command(id),receipt:null});
const doc=entries=>JSON.stringify({schemaVersion:1,scope:scope(),endpointURL,entries});
const receipt=id=>({requestId:id,revision:1,acceptedAt:'2026-10-05T00:00:00.000Z'});
const archived=id=>JSON.stringify({schemaVersion:1,scope:scope(),endpointURL,command:command(id),receipt:receipt(id)});
const retained=(f,extra={})=>create(f,{retention:true,...extra});
const storedMap=f=>f.databases.get('soldier-command-journal:v1').stores.get('journals');

test('accepted archive frees active slots beyond64 while immutable original commands/receipts remain retrievable',async()=>{
  const f=fakeIndexedDB(),a=retained(f);let previous=null;
  for(let i=0;i<70;i++){const id='accepted-'+i,next=doc([row(id)]);assert.equal(await a.write(next,previous),true);assert.equal(await a.acknowledge(doc([]),next,archived(id)),true);previous=doc([]);}
  assert.equal(await a.read(),doc([]));for(const id of ['accepted-0','accepted-69'])assert.equal(await a.lookup(id),archived(id));
  const meta=[...storedMap(f).values()].find(v=>v&&typeof v==='object'&&v.schemaVersion===1);assert.equal(meta.count,70);
});

test('retention writes only append one pending row or noop; edits, removal, forged receipt and extra appends are held',async()=>{
  const f=fakeIndexedDB(),a=retained(f),old=doc([row('one')]);await a.write(old,null);
  const altered=row('one');altered.command.payload.good=2;
  for(const next of [doc([]),doc([altered]),doc([{...row('one'),receipt:receipt('one')}]),doc([row('one'),row('two'),row('three')])])await assert.rejects(a.write(next,old),/invalid_storage/);
  assert.equal(await a.write(old,old),true);assert.equal(await a.read(),old);assert.equal(await a.lookup('one'),null);
});

test('acknowledgment removes only its matching row after CAS and preserves a concurrent draft byte for byte',async()=>{
  const f=fakeIndexedDB(),a=retained(f),b=retained(f),one=doc([row('one')]),both=doc([row('one'),row('two')]);await a.write(one,null);await b.write(both,one);
  assert.equal(await a.acknowledge(doc([]),one,archived('one')),false);assert.equal(await a.lookup('one'),null);
  await assert.rejects(a.acknowledge(doc([]),both,archived('one')),/invalid_storage/);
  assert.equal(await a.acknowledge(doc([row('two')]),both,archived('one')),true);assert.equal(await b.read(),doc([row('two')]));
});

test('abort on final active put rolls archive, meter and active removal back together, leaving identical pending replay',async()=>{
  const f=fakeIndexedDB(),a=retained(f),old=doc([row('one')]);await a.write(old,null);f.control.putFailAt=3;
  await assert.rejects(a.acknowledge(doc([]),old,archived('one')),/storage_unavailable/);f.control.putFailAt=0;
  assert.equal(await a.read(),old);assert.equal(await a.lookup('one'),null);assert.equal(storedMap(f).size,1);
  assert.equal(await a.acknowledge(doc([]),old,archived('one')),true);assert.equal(await a.lookup('one'),archived('one'));
});

test('raw ABA cannot resurrect an archived ID; an unrelated fresh pending row still succeeds using fresh meter',async()=>{
  const f=fakeIndexedDB(),a=retained(f),b=retained(f),empty=doc([]),one=doc([row('one')]);await a.write(empty,null);
  await b.write(one,empty);await b.acknowledge(empty,one,archived('one'));assert.equal(await a.read(),empty);
  assert.equal(await a.write(one,empty),false);assert.equal(await a.lookup('one'),archived('one'));assert.equal(await a.read(),empty);
  assert.equal(await a.write(doc([row('two')]),empty),true);
});

test('count and worst accepted-byte quota are reserved before delivery while archive replay remains possible at capacity',async()=>{
  const f=fakeIndexedDB(),a=retained(f,{archiveLimit:1}),one=doc([row('one')]);assert.equal(await a.write(one,null),true);
  assert.equal(await a.write(doc([row('one'),row('two')]),one),'capacity_limit');assert.equal(await a.acknowledge(doc([]),one,archived('one')),true);
  assert.equal(await a.write(doc([row('two')]),doc([])),'capacity_limit');assert.equal(await a.lookup('one'),archived('one'));
  const g=fakeIndexedDB(),bound=Client.acceptedStorageBound(command('one'),scope(),endpointURL),c=retained(g,{archiveBytesLimit:bound});
  assert.equal(await c.write(one,null),true);assert.equal(await c.acknowledge(doc([]),one,archived('one')),true);assert.equal(await c.lookup('one'),archived('one'));
  assert.equal(await c.write(doc([row('two')]),doc([])),'capacity_limit');
});

test('already-accepted v1 rows can compact in scope without an HTTP resend or altering pending siblings',async()=>{
  const f=fakeIndexedDB(),legacy=create(f),entries=Array.from({length:64},(_,i)=>({...row('old-'+i),receipt:i===63?null:receipt('old-'+i)})),old=doc(entries);await legacy.write(old,null);
  const a=retained(f),next=doc(entries.slice(1));assert.equal(await a.acknowledge(next,old,archived('old-0')),true);
  assert.equal(await a.read(),next);assert.equal(await a.lookup('old-0'),archived('old-0'));assert.deepEqual(JSON.parse(next).entries.at(-1),row('old-63'));
});

test('archive is bound to account, tenant, grant revision and endpoint without reading or adopting another scope',async()=>{
  const f=fakeIndexedDB(),a=retained(f),one=doc([row('one')]);await a.write(one,null);await a.acknowledge(doc([]),one,archived('one'));
  for(const extra of [{scope:{...scope(),uid:'caller-2'}},{scope:{...scope(),tenantId:'tenant-2'}},{scope:{...scope(),grantRevision:1}},{endpointURL:'https://other.example.invalid/v1/production/commands'}]){const b=retained(f,extra);assert.equal(await b.lookup('one'),null);assert.equal(await b.read(),null);}
  assert.equal(await a.lookup('one'),archived('one'));
});

test('malformed accepted envelope or meter holds exact source without automatic reset or overwrite',async()=>{
  const f=fakeIndexedDB(),a=retained(f),one=doc([row('one')]);await a.write(one,null);const bad=JSON.parse(archived('one'));bad.receipt.requestId='other';await assert.rejects(a.acknowledge(doc([]),one,JSON.stringify(bad)),/invalid_storage/);assert.equal(await a.read(),one);
  await a.acknowledge(doc([]),one,archived('one'));const map=storedMap(f),metaKey=[...map.keys()].find(k=>k.includes('accepted-meta'));map.set(metaKey,{schemaVersion:1,count:1,bytes:0});
  await assert.rejects(a.lookup('one'),/storage_unavailable/);await assert.rejects(a.read(),/storage_unavailable/);assert.equal([...map.values()].filter(v=>typeof v==='string'&&v===archived('one')).length,1);
});

test('version2 upgrade closes older handles, preserves scoped rows and prohibits a v1 writer from resurrecting accepted IDs',async()=>{
  const f=fakeIndexedDB(),legacy=create(f),old=doc([row('one')]);await legacy.write(old,null);const a=retained(f);assert.equal(await a.read(),old);
  await assert.rejects(legacy.write(doc([row('one'),row('two')]),old),/storage_inactive/);assert.equal(await a.acknowledge(doc([]),old,archived('one')),true);
  await assert.rejects(create(f).read(),/storage_unavailable/);assert.equal(await a.lookup('one'),archived('one'));assert.equal(await a.read(),doc([]));
});
