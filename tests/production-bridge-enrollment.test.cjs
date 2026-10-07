'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Bridge=require('../production-bridge.js'),Runtime=require('../server/production-runtime.cjs');
const {fixture,PROJECT,URL,ENDPOINT,NOW,tick}=require('./helpers/production-bridge-fixture.cjs');
const SESSION='https://server.example.invalid/v1/production/session',CLAIM='https://server.example.invalid/v1/production/enrollment/claim';
const ORIGIN='https://soldier.example.invalid',EMAIL='synthetic.browser.enrollment@gmail.com',SUBJECT='synthetic-google-subject';
function deferred(){let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve};}
function setup(role='jahit'){
  const f=fixture(role),calls=[],controls={},stats={confirm:0,auth:0,users:0};
  const grant=structuredClone(f.tenant.grants['caller-1']);delete f.tenant.grants['caller-1'];
  f.tenant.grants['owner-synthetic']={revision:1,profile:{active:true,owner:true}};
  f.tenant.enrollmentRegistry={schemaVersion:1,approvals:{'approval-synthetic':{email:EMAIL,profile:grant.profile,reviewed:true,approvedAt:'2026-10-01T00:00:00.000Z',expiresAt:'2026-11-01T00:00:00.000Z',revision:1,status:'pending'}}};
  const auth={app:f.auth.app,async verifyIdToken(token,revoked){stats.auth++;assert.equal(token,'header.payload.signature');assert.equal(revoked,true);const second=Date.parse(NOW)/1000;return {uid:'caller-1',sub:'caller-1',aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,email:EMAIL,email_verified:true,firebase:{sign_in_provider:'google.com',identities:{'google.com':[SUBJECT]}},auth_time:second,iat:second,exp:second+3600};},async getUser(uid){stats.users++;assert.equal(uid,'caller-1');return {uid,email:EMAIL,emailVerified:true,disabled:false,providerData:[{providerId:'google.com',uid:SUBJECT,email:EMAIL}]};}};
  const runtime=Runtime.createProductionRuntime({enabled:true,enrollmentEnabled:true,projectId:PROJECT,databaseURL:URL,tenantId:'tenant-1',database:f.database,auth,allowedOrigins:[ORIGIN],clock:()=>NOW,policy:{rateWindowMs:60000,rateLimit:100,deadlineMs:1000,maxInFlight:4}});
  async function fetch(url,init){
    calls.push({url,init});assert.equal(f.idb.stats.opens,0);assert.equal(f.stats.refs,0);
    assert.equal(init.credentials,'omit');assert.equal(init.mode,'cors');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.equal(init.referrerPolicy,'no-referrer');
    assert.equal(init.headers.Authorization,'Bearer header.payload.signature');
    if(init.method==='GET'){
      assert.equal(url,SESSION);assert.deepEqual(Object.keys(init.headers),['Authorization']);assert.equal(Object.hasOwn(init,'body'),false);
      if(calls.length===1&&controls.initial)return controls.initial(url);
      if(calls.length>1&&controls.afterClaim)return controls.afterClaim(url);
      if(controls.getGate)await controls.getGate;
      return f.options.fetch(url,init);
    }
    assert.equal(url,CLAIM);assert.equal(init.method,'POST');assert.deepEqual(init.headers,{Authorization:'Bearer header.payload.signature','Content-Type':'application/json'});assert.equal(init.body,'{}');
    if(controls.claimGate)await controls.claimGate;
    if(controls.claim)return controls.claim(url,init);
    const headers={origin:ORIGIN,authorization:init.headers.Authorization,'content-type':init.headers['Content-Type']},req={url:new globalThis.URL(url).pathname,method:'POST',headers,rawHeaders:Object.entries(headers).flat(),rawBody:Buffer.from(init.body)};
    const res={setHeader(){},end(raw){this.raw=raw;this.writableEnded=true;}};await runtime.handler(req,res);
    return f.response(url,res.statusCode,res.raw);
  }
  function create(extra={}){return Bridge.createProductionBridge({...f.options,enrollmentEnabled:true,confirmGoogleEnrollment:async()=>{stats.confirm++;assert.equal(f.idb.stats.opens,0);assert.equal(f.stats.refs,0);if(controls.confirmGate)await controls.confirmGate;return Object.hasOwn(controls,'confirmResult')?controls.confirmResult:Object.freeze({ok:true});},fetch,...extra});}
  return {...f,calls,controls,enrollmentStats:stats,create,grant,fetch};
}
function closed(f){assert.equal(f.idb.stats.opens,0);assert.equal(f.stats.refs,0);assert.equal(f.subscribers.size,0);assert.equal(f.views.length,0);assert.equal(f.authSubscribers.size,0);}

test('source opt-in enrolls through actual synthetic server service then validates a fresh session before drafts/views',async()=>{
  for(const role of ['jahit','qc']){const f=setup(role),before=structuredClone(f.tenant.products),b=f.create(),result=await b.connect();assert.equal(result.ok,true);assert.deepEqual(f.calls.map(x=>[x.url,x.init.method]),[[SESSION,'GET'],[CLAIM,'POST'],[SESSION,'GET']]);assert.equal(f.enrollmentStats.confirm,1);assert.equal(f.enrollmentStats.users,1);assert.equal(f.options.auth.currentUser.uid,'caller-1');assert.equal(f.tenant.grants['caller-1'],undefined);const canonical=f.roots.get('authorityTenants/tenant-1');assert.deepEqual(canonical.grants['caller-1'].profile,f.grant.profile);assert.equal(canonical.enrollmentRegistry.approvals['approval-synthetic'].status,'claimed');assert.deepEqual(canonical.products,before);assert.equal(f.views.at(-1).complete,true);assert.equal(f.stats.refs>0,true);assert.equal(f.idb.stats.opens>0,true);assert.deepEqual(result.profile,f.grant.profile);b.dispose();}
});

test('GET200 skips confirmation and claim for granted partner or owner; absent/false flag never claims',async()=>{
  for(const owner of [false,true]){const f=fixture();if(owner)f.tenant.grants['caller-1']={revision:1,profile:{active:true,owner:true}};let confirmed=0;const b=f.create({enrollmentEnabled:true,confirmGoogleEnrollment:async()=>{confirmed++;return {ok:true};}});assert.equal((await b.connect()).ok,true);assert.equal(f.stats.fetch,1);assert.equal(f.stats.posts,0);assert.equal(confirmed,0);b.dispose();}
  for(const flag of [undefined,false]){const f=setup(),options={...f.options,fetch:f.fetch,confirmGoogleEnrollment(){throw Error('Must remain inert');}};if(flag!==undefined)options.enrollmentEnabled=flag;const b=Bridge.createProductionBridge(options);assert.equal((await b.connect()).ok,false);assert.deepEqual(f.calls.map(x=>x.init.method),['GET']);closed(f);}
});

test('inherited flags and confirmation getters cannot enable enrollment; malformed own flags fail before token/network',async()=>{
  const f=setup(),options={...f.options,fetch:f.fetch};let touched=0;Object.setPrototypeOf(options,{enrollmentEnabled:true,get confirmGoogleEnrollment(){touched++;throw Error();}});assert.equal((await Bridge.createProductionBridge(options).connect()).ok,false);assert.equal(touched,0);assert.equal(f.calls.length,1);closed(f);
  for(const change of [o=>Object.defineProperty(o,'enrollmentEnabled',{enumerable:true,get(){touched++;return true;}}),o=>{o.enrollmentEnabled='true';},o=>{o.enrollmentEnabled=true;Object.defineProperty(o,'confirmGoogleEnrollment',{enumerable:true,get(){touched++;return ()=>({ok:true});}});}]){const g=setup(),o={...g.options,fetch:g.fetch};change(o);assert.equal((await Bridge.createProductionBridge(o).connect()).ok,false);assert.equal(g.calls.length,0);assert.equal(g.stats.tokens,0);assert.equal(g.options.auth.currentUser.uid,'caller-1');closed(g);}assert.equal(touched,0);
});

test('only exact429 rate_limited can offer confirmation, never malformed/foreign/wrong-status denial',async()=>{
  for(const [status,raw]of [[403,'{"ok":false,"error":"access_denied"}'],[503,'{"ok":false,"error":"rate_limited"}'],[200,'{"ok":false,"error":"rate_limited"}'],[429,'{"ok":false,"error":"busy"}'],[429,'{"ok":false,"error":"rate_limited","workerId":"worker-1"}'],[429,'{"ok":false,"ok":false,"error":"rate_limited"}'],[429,'{"ok":false,"error":"rate_limited","__proto__":{}}']]){const f=setup();f.controls.initial=url=>f.response(url,status,raw);assert.equal((await f.create().connect()).ok,false);assert.equal(f.enrollmentStats.confirm,0);assert.equal(f.calls.length,1);closed(f);}
});

test('single-flight confirmation keeps preparation blocked and dispose releases it without claim or hydration',async()=>{
  const f=setup(),gate=deferred();f.controls.confirmGate=gate.promise;const b=f.create(),one=b.connect(),two=b.connect();await tick();assert.equal(f.enrollmentStats.confirm,1);assert.equal((await b.prepare(f.command())).error,'not_ready');assert.equal((await b.send('request-1')).error,'not_ready');assert.equal((await b.pending()).error,'not_ready');assert.equal(f.calls.length,1);b.dispose();assert.equal((await one).error,'access_denied');assert.equal((await two).error,'access_denied');gate.resolve();await tick();assert.equal(f.calls.length,1);closed(f);
});

test('confirmation failure/malformed success stops before POST and never exposes returned private fields',async()=>{
  for(const result of [{ok:false,error:'access_denied'},{ok:true,uid:'SYNTHETIC_PRIVATE_CANARY'},{get ok(){throw Error('SYNTHETIC_PRIVATE_CANARY');}},null]){const f=setup();f.controls.confirmResult=result;const b=f.create(),response=await b.connect();assert.equal(response.ok,false);assert.doesNotMatch(JSON.stringify(response),/SYNTHETIC_PRIVATE/);assert.equal(f.calls.length,1);closed(f);}
});

test('same-UID replacement, logout, scope or source drift during confirmation forbids the POST',async()=>{
  for(const mutate of [f=>{f.auth.currentUser={...f.auth.currentUser};},f=>{f.auth.currentUser=null;},f=>{f.database.app={options:{projectId:PROJECT,databaseURL:'https://foreign.firebaseio.com'}};},f=>{f.allowed=false;}]){const f=setup(),gate=deferred();f.allowed=true;f.controls.confirmGate=gate.promise;const b=f.create({isCurrent:()=>f.allowed}),pending=b.connect();await tick();mutate(f);gate.resolve();assert.equal((await pending).error,'access_denied');assert.equal(f.calls.length,1);closed(f);}
});

test('claim only exact200 empty acknowledgement advances; uncertain/denied/malformed results have no retry or recovery GET',async()=>{
  for(const [status,raw]of [[503,'{"ok":false,"error":"result_unknown","retrySameIdentity":true}'],[503,'{"ok":false,"error":"unavailable","retrySameIdentity":true}'],[429,'{"ok":false,"error":"rate_limited"}'],[403,'{"ok":false,"error":"access_denied"}'],[201,'{"ok":true}'],[200,'{"ok":true,"uid":"SYNTHETIC_PRIVATE_CANARY"}'],[200,'{"ok":true,"\\u006fk":true}'],[200,'{"ok":true,"constructor":{}}'],[200,'{']]){const f=setup();f.controls.claim=url=>f.response(url,status,raw);const result=await f.create().connect();assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC_PRIVATE/);assert.deepEqual(f.calls.map(x=>x.init.method),['GET','POST']);closed(f);}
});

test('claim redirect/wrong URL/decoded oversize/invalid UTF8 cannot advance to session or storage',async()=>{
  for(const mutate of [r=>{r.redirected=true;},r=>{r.url=SESSION;},r=>{r.headers.set('Content-Length','1025');},r=>{r.body=new ReadableStream({start(c){c.enqueue(new Uint8Array([0xc3,0x28]));c.close();}});},r=>{r.body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(' '.repeat(1025)));c.close();}});}]){const f=setup();f.controls.claim=url=>{const r=f.response(url,200,'{"ok":true}');mutate(r);return r;};assert.equal((await f.create().connect()).ok,false);assert.equal(f.calls.length,2);closed(f);}
});

test('postclaim denial/malformed/wrong UID or scope never opens journal and second429 never repeats enrollment',async()=>{
  for(const after of [f=>url=>f.response(url,429,'{"ok":false,"error":"rate_limited"}'),f=>url=>f.response(url,403,'{"ok":false,"error":"access_denied"}'),f=>async(url)=>{const response=await f.options.fetch(url,{method:'GET',headers:{Authorization:'Bearer header.payload.signature'},credentials:'omit',redirect:'error'}),raw=await new Response(response.body).text(),v=JSON.parse(raw);v.session.uid='caller-2';return f.response(url,200,JSON.stringify(v));},f=>url=>f.response(url,200,'{"ok":true,"session":{}}')]){const f=setup();f.controls.afterClaim=after(f);assert.equal((await f.create().connect()).ok,false);assert.equal(f.enrollmentStats.confirm,1);assert.deepEqual(f.calls.map(x=>x.init.method),['GET','POST','GET']);closed(f);}
});

test('account replacement while POST awaits aborts request and late success cannot fetch a business session',async()=>{
  const f=setup(),gate=deferred();f.controls.claimGate=gate.promise;f.controls.claim=url=>f.response(url,200,'{"ok":true}');const b=f.create(),pending=b.connect();await tick();assert.equal(f.calls.length,2);f.auth.currentUser={...f.auth.currentUser};for(const listener of f.authSubscribers)listener(f.auth.currentUser);assert.equal(f.calls[1].init.signal.aborted,true);gate.resolve();assert.equal((await pending).error,'access_denied');assert.equal(f.calls.length,2);closed(f);
});

test('server revoked approval and existing inactive UID remain denied with zero business hydration',async()=>{
  for(const revoke of [f=>{f.tenant.enrollmentRegistry.approvals['approval-synthetic'].status='revoked';},f=>{f.tenant.grants['caller-1']={revision:2,profile:{...f.grant.profile,active:false}};}]){const f=setup();revoke(f);const before=structuredClone(f.tenant),result=await f.create().connect();assert.equal(result.ok,false);assert.deepEqual(f.roots.get('authorityTenants/tenant-1'),before);assert.deepEqual(f.calls.map(x=>x.init.method),['GET','POST']);closed(f);}
});
