'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),Store=require('../production-owner-tariff-store.js'),Client=require('../production-owner-tariff-client.js'),{fakeIndexedDB}=require('./helpers/command-indexeddb-fixture.cjs');
const scope=()=>({projectId:'demo-owner-tariff',databaseURL:'https://demo-owner-tariff.firebaseio.com',tenantId:'tenant-1',uid:'owner-1',grantRevision:2}),endpointURL='https://server.example.invalid/v1/production/owner/tariffs/append';
const command=id=>({kind:'appendTariffVersion',requestId:id,productId:'product-1',cycleId:'cycle-1',expectedConfigRevision:1,expectedTariffRevision:3,workerId:'worker-1',tariffVersion:'rate-'+id,effectiveAt:'2026-10-07T00:00:00.000Z',currency:'IDR',rate:1200});
const row=id=>({command:command(id),receipt:null}),receipt=id=>({requestId:id,kind:'appendTariffVersion',productId:'product-1',cycleId:'cycle-1',workerId:'worker-1',tariffVersion:'rate-'+id,revision:4,acceptedAt:'2026-10-06T00:00:00.000Z'});
const doc=entries=>JSON.stringify({schemaVersion:1,scope:scope(),endpointURL,entries}),accepted=id=>JSON.stringify({schemaVersion:1,scope:scope(),endpointURL,command:command(id),receipt:receipt(id)});
const create=(f,extra={})=>Store.createStore({enabled:true,indexedDB:f.api,scope:scope(),endpointURL,isCurrent:()=>true,...extra});
const map=f=>f.databases.get('soldier-owner-tariff-journal:v1').stores.get('journals');

test('owner journal defaults off, rejects dangerous scopes/getters and never opens operational DB',async()=>{
  const f=fakeIndexedDB();await assert.rejects(Store.createStore().read(),/service_disabled/);let touched=0;
  const bad=scope();Object.defineProperty(bad,'uid',{enumerable:true,get(){touched++;return 'owner-1';}});
  assert.throws(()=>create(f,{scope:bad}),/invalid_storage/);assert.equal(touched,0);
  for(const extra of [{scope:{...scope(),grantRevision:-1}},{endpointURL:endpointURL.replace('/owner/tariffs/append','/commands')},{scope:{...scope(),databaseURL:'http://localhost:9000'}}])assert.throws(()=>create(f,extra),/invalid_storage/);
  assert.equal(f.stats.opens,0);await create(f).read();assert.deepEqual([...f.databases.keys()],['soldier-owner-tariff-journal:v1']);
});

test('durable append CAS protects immutable money draft across two handles',async()=>{
  const f=fakeIndexedDB(),a=create(f),b=create(f),one=doc([row('one')]),two=doc([row('two')]);
  assert.deepEqual(await Promise.all([a.write(one,null),b.write(two,null)]),[true,false]);assert.equal(await b.read(),one);
  const altered=row('one');altered.command.rate=1300;
  for(const next of [doc([]),doc([altered]),doc([{...row('one'),receipt:receipt('one')}]),doc([row('one'),row('two'),row('three')])])await assert.rejects(a.write(next,one),/invalid_storage/);
  assert.equal(await a.read(),one);assert.equal(await b.write(doc([row('one'),row('two')]),one),true);
});

test('archive acknowledgment and active removal commit atomically or retain exact original pending draft',async()=>{
  const f=fakeIndexedDB(),a=create(f),old=doc([row('one')]);await a.write(old,null);f.control.putFailAt=3;
  await assert.rejects(a.acknowledge(doc([]),old,accepted('one')),/storage_unavailable/);f.control.putFailAt=0;assert.equal(await a.read(),old);assert.equal(await a.lookup('one'),null);assert.equal(map(f).size,1);
  assert.equal(await a.acknowledge(doc([]),old,accepted('one')),true);assert.equal(await a.lookup('one'),accepted('one'));assert.equal(await a.read(),doc([]));
});

test('lost CAS acknowledgment preserves sibling pending drafts and prohibits accepted request ID resurrection',async()=>{
  const f=fakeIndexedDB(),a=create(f),b=create(f),empty=doc([]),one=doc([row('one')]),both=doc([row('one'),row('two')]);await a.write(one,null);await b.write(both,one);
  assert.equal(await a.acknowledge(empty,one,accepted('one')),false);assert.equal(await a.lookup('one'),null);
  await assert.rejects(a.acknowledge(empty,both,accepted('one')),/invalid_storage/);assert.equal(await a.acknowledge(doc([row('two')]),both,accepted('one')),true);
  assert.equal(await b.write(doc([row('two'),row('one')]),doc([row('two')])),false);assert.equal(await b.read(),doc([row('two')]));assert.equal(await b.lookup('one'),accepted('one'));
});

test('archive count and worst receipt bytes reserved before delivery allow replay at capacity',async()=>{
  const f=fakeIndexedDB(),a=create(f,{archiveLimit:1}),one=doc([row('one')]);assert.equal(await a.write(one,null),true);assert.equal(await a.write(doc([row('one'),row('two')]),one),'capacity_limit');
  assert.equal(await a.acknowledge(doc([]),one,accepted('one')),true);assert.equal(await a.write(doc([row('two')]),doc([])),'capacity_limit');assert.equal(await a.lookup('one'),accepted('one'));
  const g=fakeIndexedDB(),bound=Client.acceptedStorageBound(command('one'),scope(),endpointURL),b=create(g,{archiveBytesLimit:bound});assert.equal(await b.write(one,null),true);assert.equal(await b.acknowledge(doc([]),one,accepted('one')),true);assert.equal(await b.write(doc([row('two')]),doc([])),'capacity_limit');
});

test('grant, account, tenant, server and project scopes never adopt another owner draft or receipt',async()=>{
  const f=fakeIndexedDB(),a=create(f),old=doc([row('one')]);await a.write(old,null);await a.acknowledge(doc([]),old,accepted('one'));
  for(const extra of [{scope:{...scope(),uid:'owner-2'}},{scope:{...scope(),grantRevision:3}},{scope:{...scope(),tenantId:'tenant-2'}},{scope:{...scope(),projectId:'demo-other-project'}},{endpointURL:'https://other.example.invalid/v1/production/owner/tariffs/append'}]){const b=create(f,extra);assert.equal(await b.read(),null);assert.equal(await b.lookup('one'),null);}
  assert.equal(await a.lookup('one'),accepted('one'));
});

test('malformed local accepted receipt/meter and duplicate JSON keys hold source without clearing data',async()=>{
  const f=fakeIndexedDB(),a=create(f),old=doc([row('one')]);await a.write(old,null);const bad=JSON.parse(accepted('one'));bad.receipt.workerId='worker-2';await assert.rejects(a.acknowledge(doc([]),old,JSON.stringify(bad)),/invalid_storage/);
  await assert.rejects(a.write(old.replace('"rate":1200','"rate":1200,"\\u0072ate":1300'),old),/invalid_storage/);assert.equal(await a.read(),old);
  await a.acknowledge(doc([]),old,accepted('one'));const data=map(f),key=[...data.keys()].find(k=>k.includes('accepted-meta'));data.set(key,{schemaVersion:1,count:1,bytes:0});await assert.rejects(a.read(),/storage_unavailable/);assert.equal([...data.values()].filter(v=>v===accepted('one')).length,1);
});

test('revocation during durable commit blocks return to stale owner; source survives for same trusted scope',async()=>{
  const f=fakeIndexedDB();let current=true,release,started;const ready=new Promise(r=>{started=r;}),a=create(f,{isCurrent:()=>current}),old=doc([row('one')]);
  f.control.beforeCommit=()=>{started();return new Promise(r=>{release=r;});};const pending=a.write(old,null);await ready;current=false;release();await assert.rejects(pending,/storage_inactive/);f.control.beforeCommit=null;
  assert.equal(await create(f).read(),old);a.dispose();await assert.rejects(a.read(),/storage_inactive/);
});

test('native-shaped blocked/error opens close late handles and hide original exception detail',async()=>{
  const f=fakeIndexedDB();f.control.blocked=true;await assert.rejects(create(f).read(),e=>e.message==='storage_unavailable');assert.equal(f.stats.closes,1);
  const g=fakeIndexedDB();g.control.openFail=true;await assert.rejects(create(g).read(),e=>e.message==='storage_unavailable');
});
