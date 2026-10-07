'use strict';
// Real pinned Admin SDK / loopback emulator admission proof. No cloud,
// ADC/key file, business backup, fake Reference or mocked transaction result.
const {test}=require('node:test'),assert=require('node:assert/strict');
const PROJECT='demo-soldier-security',HOST='127.0.0.1',PORT=9000,URL='https://'+PROJECT+'.firebaseio.com',NOW=Date.parse('2026-10-05T03:00:00.000Z');
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST,HOST+':'+PORT,'requires the isolated loopback emulator');
assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS&&!process.env.FIREBASE_TOKEN,'forbids real credential configuration');
assert.ok(Number(process.versions.node.split('.')[0])>=22,'requires Node 22 or newer');
const {initializeApp,deleteApp,SDK_VERSION}=require('firebase-admin/app'),{getDatabase}=require('firebase-admin/database');
assert.equal(SDK_VERSION,'14.5.0');
const Rate=require('../server/production-rate-limiter.cjs');
let sequence=0;
async function fixture(t,{limit=5,windowMs=10000}={}){
  const n=++sequence,tenantId='rate-sdk-proof-'+n,time={now:NOW};let a,b,da,db,rate,authority;
  const credential={getAccessToken:async()=>({access_token:'owner',expires_in:3600})};
  a=initializeApp({projectId:PROJECT,databaseURL:URL,credential},'rate-sdk-a-'+n);
  t.after(async()=>{
    try{await Promise.all([rate,authority].filter(Boolean).map(ref=>ref.remove()));}
    finally{await Promise.all([a,b].filter(Boolean).map(app=>Promise.resolve().then(()=>deleteApp(app))));}
  });
  b=initializeApp({projectId:PROJECT,databaseURL:URL,credential},'rate-sdk-b-'+n);da=getDatabase(a);db=getDatabase(b);
  rate=db.ref('serverRateLimits/'+tenantId);authority=db.ref('authorityTenants/'+tenantId);
  assert.equal(da.ref('serverRateLimits/'+tenantId+'/caller-1').toString(),'http://'+HOST+':'+PORT+'/serverRateLimits/'+tenantId+'/caller-1');
  await authority.set({schemaVersion:1,projectId:PROJECT,tenantId,grants:{'caller-1':{revision:1,profile:{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}}},'caller-2':{revision:1,profile:{active:true,owner:false,modules:{qc:true}}}}});
  function options(database=da,changes={}){
    return {enabled:true,projectId:PROJECT,databaseURL:URL,tenantId,database,windowMs,limit,clock:()=>time.now,allow:async({projectId,uid})=>{
      if(projectId!==PROJECT)return false;
      const grant=(await database.ref('authorityTenants/'+tenantId+'/grants/'+uid).get()).val();
      return grant!==null&&typeof grant==='object'&&Number.isSafeInteger(grant.revision)&&grant.revision>=0&&grant.profile?.active===true&&typeof grant.profile.owner==='boolean';
    },testOnlyEmulator:{host:HOST,port:PORT},...changes};
  }
  const create=(database=da,changes={})=>Rate.createProductionRateLimiter(options(database,changes));
  const admit=(limiter=create(),uid='caller-1')=>limiter.admit({projectId:PROJECT,uid});
  const bucket=async uid=>(await rate.child(uid||'caller-1').get()).val();
  return {da,db,rate,authority,tenantId,time,options,create,admit,bucket};
}

test('default-off limiter with real SDK cannot create an admission bucket',{timeout:30000},async t=>{
  const f=await fixture(t),options=f.options();delete options.enabled;
  assert.equal(await f.admit(Rate.createProductionRateLimiter(options)),false);assert.equal(await f.bucket(),null);
});

test('ungranted and inactive canonical accounts cannot grow the quota namespace',{timeout:30000},async t=>{
  const f=await fixture(t);assert.equal(await f.admit(f.create(),'unknown-caller'),false);assert.equal(await f.bucket('unknown-caller'),null);
  await f.authority.child('grants/caller-1/profile/active').set(false);
  assert.equal(await f.admit(),false);assert.equal(await f.bucket(),null);
  await f.authority.child('grants/caller-1/profile/active').set(true);
  assert.equal(await f.admit(),true);const before=await f.bucket();
  await f.authority.child('grants/caller-1/profile/active').set(false);
  assert.equal(await f.admit(f.create(f.db)),false);assert.deepEqual(await f.bucket(),before);
});

test('two independent Admin apps atomically admit exactly one shared fixed-window quota',{timeout:30000},async t=>{
  const f=await fixture(t,{limit:5}),one=f.create(f.da),two=f.create(f.db),before=(await f.authority.get()).val();
  const answers=await Promise.all(Array.from({length:18},(_,i)=>f.admit(i%2?one:two)));
  assert.equal(answers.filter(value=>value===true).length,5);assert.equal(answers.filter(value=>value===false).length,13);
  assert.deepEqual(await f.bucket(),{schemaVersion:1,projectId:PROJECT,databaseURL:URL,tenantId:f.tenantId,uid:'caller-1',windowMs:10000,limit:5,windowStartMs:Math.floor(NOW/10000)*10000,lastSeenMs:NOW,count:5});
  assert.deepEqual((await f.authority.get()).val(),before,'limiter must never mutate canonical grants or business authority');
  assert.equal(await f.admit(two,'caller-2'),true);assert.equal((await f.bucket('caller-2')).count,1);assert.equal((await f.bucket()).count,5);
});

test('a restarted independent app rejects persisted same-window clock rollback and refills only the next window',{timeout:30000},async t=>{
  const f=await fixture(t,{limit:2}),one=f.create(f.da);f.time.now=NOW+500;
  assert.equal(await f.admit(one),true);const before=await f.bucket();f.time.now=NOW+499;
  assert.equal(await f.admit(f.create(f.db)),false);assert.deepEqual(await f.bucket(),before);
  f.time.now=NOW+501;assert.equal(await f.admit(f.create(f.db)),true);assert.equal(await f.admit(f.create(f.da)),false);
  f.time.now=NOW+10000;assert.equal(await f.admit(f.create(f.db)),true);assert.equal((await f.bucket()).count,1);
});

test('stored policy drift and malformed SDK counters are held without a reset or repair',{timeout:30000},async t=>{
  const f=await fixture(t);assert.equal(await f.admit(),true);const original=await f.bucket();f.time.now=NOW+20000;
  for(const policy of [{limit:6},{windowMs:20000}]){assert.equal(await f.admit(f.create(f.db,policy)),false);assert.deepEqual(await f.bucket(),original);}
  for(const mutation of [value=>value.count='1',value=>value.count=6,value=>delete value.lastSeenMs,value=>value.uid='caller-2',value=>value.extra='synthetic-private-marker']){
    const malformed=structuredClone(original);mutation(malformed);await f.rate.child('caller-1').set(malformed);const stored=await f.bucket();
    assert.equal(await f.admit(f.create(f.da)),false);assert.deepEqual(await f.bucket(),stored);
  }
});

test('an explicit incorrect project/database/tenant policy cannot redirect the real SDK admission write',{timeout:30000},async t=>{
  const f=await fixture(t);
  for(const binding of [{projectId:'demo-other-project'},{databaseURL:'https://demo-other-project.firebaseio.com'},{testOnlyEmulator:{host:'127.0.0.1',port:19000}},{tenantId:'../other'}])assert.equal(await f.admit(f.create(f.db,binding)),false);
  assert.equal(await f.bucket(),null);
});
