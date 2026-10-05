'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Rate=require('../server/production-rate-limiter.cjs'),Authority=require('../server/production-authority.cjs'),Service=require('../server/production-command-service.cjs');
const PROJECT='demo-rate-boundary',TENANT='synthetic-tenant',URL='https://demo-rate-boundary.firebaseio.com',UID='caller-1';
const copy=value=>structuredClone(value);
function fixture(overrides={},implementation=Rate){
  const buckets=new Map(),stats={allow:0,clock:0,refs:0,on:0,off:0,transactions:0,writes:0},hooks={},time={now:10000};
  const references=new Map();
  const snapshot=value=>({val:()=>copy(value)});
  const database={app:{options:{projectId:PROJECT,databaseURL:URL}},ref(key){
    stats.refs++;const uid=key.slice(key.lastIndexOf('/')+1);assert.equal(key,'serverRateLimits/'+TENANT+'/'+uid);
    if(!references.has(uid))references.set(uid,{toString:()=>URL+'/'+key,on(event,callback,cancel){stats.on++;assert.equal(event,'value');if(hooks.warmFail)cancel(Error('synthetic-private-token'));else if(!hooks.noWarm)callback(snapshot(buckets.get(uid)??null));},off(event){stats.off++;assert.equal(event,'value');},async transaction(update,complete,local){
      stats.transactions++;assert.equal(complete,undefined);assert.equal(local,false);
      if(hooks.beforeCallback)hooks.beforeCallback();
      const source=hooks.source!==undefined?hooks.source:copy(buckets.get(uid)??null),before=hooks.source!==undefined?null:copy(source);
      let candidate=update(source);if(before!==null)assert.deepEqual(source,before,'quota callback must not alter its SDK source');
      if(candidate!==undefined&&hooks.interleave){const run=hooks.interleave;hooks.interleave=null;run(uid,candidate);candidate=update(copy(buckets.get(uid)??null));}
      if(hooks.result)return hooks.result(candidate);
      if(candidate===undefined)return {committed:false,snapshot:snapshot(buckets.get(uid)??null)};
      buckets.set(uid,copy(candidate));stats.writes++;
      if(hooks.afterCommitThrow)throw Error('synthetic-private-token-counter');
      return {committed:true,snapshot:snapshot(buckets.get(uid))};
    }});
    return references.get(uid);
  }};
  const options={enabled:true,projectId:PROJECT,databaseURL:URL,tenantId:TENANT,database,windowMs:1000,limit:2,clock:()=>{stats.clock++;return time.now;},allow:async scope=>{stats.allow++;assert.deepEqual(scope,{projectId:PROJECT,uid:scope.uid});return hooks.allow===undefined?true:hooks.allow;},...overrides};
  const create=changes=>implementation.createProductionRateLimiter({...options,...changes});
  const admit=(limiter=create(),uid=UID)=>limiter.admit({projectId:PROJECT,uid});
  return {buckets,stats,hooks,time,references,database,options,create,admit};
}

test('limiter defaults off and touches no grant, clock, SDK reference or bucket',async()=>{
  const f=fixture();delete f.options.enabled;assert.equal(await f.admit(),false);assert.equal(f.buckets.size,0);assert.deepEqual(f.stats,{allow:0,clock:0,refs:0,on:0,off:0,transactions:0,writes:0});
});

test('explicit policy and valid trusted binding are mandatory without coercion or a policy fallback',async()=>{
  for(const change of [{windowMs:undefined},{limit:undefined},{clock:undefined},{allow:undefined},{windowMs:'1000'},{windowMs:0},{limit:0},{limit:1.5},{tenantId:'__proto__'},{projectId:'other'},{databaseURL:'http://demo-rate-boundary.firebaseio.com'},{databaseURL:URL+'/?token=synthetic-secret'}]){
    const f=fixture(change);assert.equal(await f.admit(),false);assert.equal(f.stats.refs,0);assert.equal(f.buckets.size,0);
  }
});

test('scope cannot provide another project, tenant, malformed UID or executable getter',async()=>{
  const f=fixture(),limiter=f.create();let called=0;const getter={projectId:PROJECT};Object.defineProperty(getter,'uid',{enumerable:true,get(){called++;throw Error('synthetic-secret');}});
  for(const scope of [{projectId:'demo-other-project',uid:UID},{projectId:PROJECT,uid:'../other'},{projectId:PROJECT,uid:'constructor'},{projectId:PROJECT,uid:UID,tenantId:'other'},[PROJECT,UID],getter])assert.equal(await limiter.admit(scope),false);
  assert.equal(called,0);assert.equal(f.stats.allow,0);assert.equal(f.stats.refs,0);
});

test('canonical admission must return literal true before any unknown or inactive UID can create a bucket',async()=>{
  for(const allowed of [false,1,'true',null]){const f=fixture();f.hooks.allow=allowed;assert.equal(await f.admit(),false);assert.equal(f.stats.refs,0);assert.equal(f.buckets.size,0);}
  const f=fixture({allow:async()=>{throw Error('synthetic-private-grant');}});assert.equal(await f.admit(),false);assert.equal(f.stats.refs,0);
});

test('fixed server window admits exactly the explicit limit, with an exact committed flat bucket',async()=>{
  const f=fixture(),limiter=f.create();assert.equal(await f.admit(limiter),true);assert.equal(await f.admit(limiter),true);assert.equal(await f.admit(limiter),false);
  assert.deepEqual(f.buckets.get(UID),{schemaVersion:1,projectId:PROJECT,databaseURL:URL,tenantId:TENANT,uid:UID,windowMs:1000,limit:2,windowStartMs:10000,lastSeenMs:10000,count:2});
  assert.equal(f.stats.allow,3);assert.equal(f.stats.writes,2);assert.equal(f.stats.on,f.stats.off);
});

test('a later fixed window refills once; same-window requests do not reset or share another UID quota',async()=>{
  const f=fixture(),limiter=f.create();assert.equal(await f.admit(limiter),true);f.time.now=10999;assert.equal(await f.admit(limiter),true);assert.equal(await f.admit(limiter),false);assert.equal(await f.admit(limiter,'caller-2'),true);
  f.time.now=11000;assert.equal(await f.admit(limiter),true);assert.equal(f.buckets.get(UID).windowStartMs,11000);assert.equal(f.buckets.get(UID).count,1);assert.equal(f.buckets.get('caller-2').count,1);
});

test('persisted lastSeen blocks same-window and prior-window clock rollback in a fresh server instance',async()=>{
  const f=fixture();f.time.now=10500;assert.equal(await f.admit(),true);const before=copy(f.buckets.get(UID));
  for(const now of [10499,9999]){f.time.now=now;assert.equal(await f.admit(f.create()),false);assert.deepEqual(f.buckets.get(UID),before);}
  f.time.now=10501;assert.equal(await f.admit(f.create()),true);assert.equal(f.buckets.get(UID).count,2);
});

test('process clock rollback and nonfinite/fractional clock readings cannot admit or mutate a bucket',async()=>{
  const f=fixture(),limiter=f.create();assert.equal(await f.admit(limiter),true);const before=copy(f.buckets.get(UID));
  for(const now of [9999,NaN,Infinity,10000.5,'10000',-1]){f.time.now=now;assert.equal(await f.admit(limiter),false);assert.deepEqual(f.buckets.get(UID),before);}
});

test('malformed counters, partial/foreign binding, unknown credential fields and getters fail closed',async()=>{
  const f=fixture();assert.equal(await f.admit(),true);const good=copy(f.buckets.get(UID));let getterCalls=0;
  const mutations=[v=>delete v.count,v=>v.count=0,v=>v.count=3,v=>v.count='1',v=>v.count=Number.MAX_SAFE_INTEGER+1,v=>v.count=NaN,v=>v.lastSeenMs=9999,v=>v.lastSeenMs=11000,v=>v.windowStartMs=10001,v=>v.projectId='demo-other-project',v=>v.uid='caller-2',v=>v.databaseURL='https://other.firebaseio.com',v=>v.token='synthetic-private-token',v=>Object.defineProperty(v,'count',{enumerable:true,get(){getterCalls++;throw Error('synthetic-private-counter');}})];
  for(const mutate of mutations){const value=copy(good);mutate(value);f.hooks.source=value;const writes=f.stats.writes;assert.equal(await f.admit(f.create()),false);assert.equal(f.stats.writes,writes);assert.deepEqual(f.buckets.get(UID),good);}
  assert.equal(getterCalls,0);assert.equal(f.stats.on,f.stats.off);
});

test('changed limit or window policy is held even after the old window expires',async()=>{
  const f=fixture();assert.equal(await f.admit(),true);const before=copy(f.buckets.get(UID));f.time.now=20000;
  for(const policy of [{limit:3},{windowMs:2000}]){assert.equal(await f.admit(f.create(policy)),false);assert.deepEqual(f.buckets.get(UID),before);}
});

test('project/database/pointer rebinding is checked before and after async grant admission and SDK callback',async()=>{
  const f=fixture();f.database.app.options.projectId='demo-other-project';assert.equal(await f.admit(),false);assert.equal(f.stats.allow,0);
  const changed=fixture();changed.options.allow=async()=>{changed.database.app.options.databaseURL='https://other.firebaseio.com';return true;};assert.equal(await changed.admit(),false);assert.equal(changed.stats.refs,0);
  const callback=fixture();callback.hooks.beforeCallback=()=>callback.database.app.options.projectId='demo-other-project';assert.equal(await callback.admit(),false);assert.equal(callback.stats.writes,0);assert.equal(callback.stats.on,callback.stats.off);
  const pointer=fixture();const original=pointer.database.ref;pointer.database.ref=key=>{const ref=original(key);ref.toString=()=>URL+'/serverRateLimits/another-tenant/'+UID;return ref;};assert.equal(await pointer.admit(),false);assert.equal(pointer.stats.on,0);
});

test('SDK callback retries calculate admission from canonical counter and discard speculative increments',async()=>{
  const f=fixture();f.hooks.interleave=(uid,candidate)=>f.buckets.set(uid,copy(candidate));assert.equal(await f.admit(),true);assert.equal(f.buckets.get(UID).count,2);assert.equal(f.stats.writes,1);
  const full=fixture({limit:1});full.hooks.interleave=(uid,candidate)=>full.buckets.set(uid,copy(candidate));assert.equal(await full.admit(),false);assert.equal(full.buckets.get(UID).count,1);assert.equal(full.stats.writes,0);
});

test('only the actual committed matching snapshot grants a permit, never a speculative callback',async()=>{
  for(const result of [candidate=>({committed:false,snapshot:{val:()=>candidate}}),candidate=>({committed:true,snapshot:{val:()=>({...candidate,count:2})}}),candidate=>({committed:true,snapshot:{val:()=>({...candidate,token:'synthetic-private-token'})}}),()=>({committed:true,snapshot:{val(){throw Error('synthetic-private-snapshot');}}}),()=>{throw Error('synthetic-private-SDK');}]){
    const f=fixture();f.hooks.result=result;assert.equal(await f.admit(),false);assert.equal(f.stats.writes,0);assert.equal(f.stats.on,f.stats.off);
  }
});

test('an uncertain commit is never refunded and a retry cannot exceed the shared quota',async()=>{
  const f=fixture({limit:1});f.hooks.afterCommitThrow=true;assert.equal(await f.admit(),false);assert.equal(f.buckets.get(UID).count,1);f.hooks.afterCommitThrow=false;assert.equal(await f.admit(f.create()),false);assert.equal(f.buckets.get(UID).count,1);assert.equal(f.stats.on,f.stats.off);
});

test('warm-up failure and bounded timeout stop before transaction and always unsubscribe',async()=>{
  const failed=fixture();failed.hooks.warmFail=true;assert.equal(await failed.admit(),false);assert.equal(failed.stats.transactions,0);assert.equal(failed.stats.on,failed.stats.off);
  const module={exports:{}},sandbox={module,exports:module.exports,require,Buffer,URL:globalThis.URL,process,Object,Array,Reflect,clearTimeout(){},setTimeout(callback,ms){assert.equal(ms,5000);queueMicrotask(callback);return 1;}};
  const context=vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,'../server/production-rate-limiter.cjs'),'utf8'),context);
  // Use the fixture realm's Object/Array validators and prove subscription
  // really started, so a prototype rejection cannot masquerade as a timeout.
  const timeout=fixture({allow:async()=>true},module.exports);timeout.hooks.noWarm=true;
  assert.equal(await timeout.admit(),false);assert.equal(timeout.stats.on,1,JSON.stringify(timeout.stats));assert.equal(timeout.stats.off,1);assert.equal(timeout.stats.transactions,0);
});

test('a service outer retry uses one permit and a later receipt replay consumes another',async()=>{
  const f=fixture(),limiter=f.create(),now='2026-10-05T03:00:00.000Z';
  let wire=Authority.encodeStorage(Authority.createAuthority({product:{id:'product-1',series:'Synthetic',namaBarang:'Example',size:'M',cutQuantity:2},cycleId:'cycle-1',workers:[{id:'worker-1',nama:'Synthetic partner'}],assignments:[{id:'assignment-1',workerId:'worker-1',qty:2}],now})),gatewayCalls=0,authCalls=0;
  const grant={projectId:PROJECT,uid:UID,revision:1,profile:{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}}},config={revision:1,active:true,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'};
  const service=Service.createProductionCommandService({enabled:true,projectId:PROJECT,clock:()=>now,admit:limiter.admit,auth:{async verifyIdToken(_token,check){authCalls++;assert.equal(check,true);return {uid:UID,sub:UID,aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,email_verified:true,firebase:{sign_in_provider:'google.com'},exp:Date.parse(now)/1000+3600};}},repository:{readGrant:async()=>copy(grant),readCycle:async()=>({projectId:PROJECT,productId:'product-1',cycleId:'cycle-1',config:copy(config),wire:copy(wire)}),selectTariff:async()=>{throw Error('sewing requires no tariff');}},gateway:{projectId:PROJECT,contract:Service.contract,async run({update,expectedTrust}){gatewayCalls++;const first=update(copy(wire),copy(expectedTrust));if(gatewayCalls===1){assert.ok(first);assert.equal(update(copy(wire),copy(expectedTrust)),undefined);return {committed:false,retryable:true};}wire=copy(first);return {committed:true,retryable:false,wire:copy(wire)};}}});
  const request={idToken:'synthetic-token',command:{requestId:'request-1',productId:'product-1',cycleId:'cycle-1',expectedRevision:0,kind:'sewing',payload:{id:'sewing-1',assignmentId:'assignment-1',tanggal:'2026-10-05',good:2,reject:0}}};
  const first=await service.execute(request);assert.equal(first.ok,true);assert.equal(authCalls,2);assert.equal(f.buckets.get(UID).count,1);
  const replay=await service.execute(request);assert.equal(replay.ok,true);assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,first.receipt);assert.equal(f.buckets.get(UID).count,2);assert.equal(Authority.decodeStorage(wire).revision,1);
  assert.equal((await service.execute(request)).error,'rate_limited');assert.equal(Authority.decodeStorage(wire).revision,1);
});

test('emulator use requires explicit demo/loopback binding and production mode rejects an emulator environment',async()=>{
  const previous=process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  try{
    process.env.FIREBASE_DATABASE_EMULATOR_HOST='127.0.0.1:9000';const production=fixture();assert.equal(await production.admit(),false);assert.equal(production.stats.allow,0);
    for(const emulator of [{host:'example.com',port:9000},{host:'127.0.0.1',port:19000},{host:'127.0.0.1',port:'9000'}]){const f=fixture({testOnlyEmulator:emulator});assert.equal(await f.admit(),false);assert.equal(f.stats.refs,0);}
    const allowed=fixture({testOnlyEmulator:{host:'127.0.0.1',port:9000}}),base=allowed.database.ref;allowed.database.ref=key=>{const ref=base(key);ref.toString=()=> 'http://127.0.0.1:9000/'+key;return ref;};assert.equal(await allowed.admit(),true);
    process.env.FIREBASE_DATABASE_EMULATOR_HOST='localhost:9000';assert.equal(await allowed.admit(),false);
  }finally{if(previous===undefined)delete process.env.FIREBASE_DATABASE_EMULATOR_HOST;else process.env.FIREBASE_DATABASE_EMULATOR_HOST=previous;}
});
