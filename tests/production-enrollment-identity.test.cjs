'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createProductionEnrollmentIdentityVerifier,isEnrollmentEmail}=require('../server/production-enrollment-identity.cjs');
const PROJECT='demo-enrollment-identity',NOW='2026-10-06T03:00:00.000Z',MS=Date.parse(NOW),SECOND=MS/1000,TOKEN='SYNTHETIC_PRIVATE_ID_TOKEN';
const EMAIL='synthetic.enrollment@gmail.com',UID='synthetic-firebase-uid',SUBJECT='synthetic-google-subject';
const copy=v=>structuredClone(v);
class UserInfo{constructor(){for(const [k,v]of Object.entries({providerId:'google.com',uid:SUBJECT,email:EMAIL}))Object.defineProperty(this,k,{value:v,enumerable:true});}toJSON(){throw Error('Never serialize SDK provider');}}
class UserRecord{constructor(){for(const [k,v]of Object.entries({uid:UID,email:EMAIL,emailVerified:true,disabled:false,providerData:[new UserInfo()],tenantId:null}))Object.defineProperty(this,k,{value:v,enumerable:true,configurable:true});}toJSON(){throw Error('Never serialize SDK record');}}
function fixture(){
  const app={get options(){return {projectId:PROJECT};}},stats={verify:0,getUser:0,clock:0},state={app,clock:NOW,token:{uid:UID,sub:UID,aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,email:EMAIL,email_verified:true,firebase:{sign_in_provider:'google.com',identities:{'google.com':[SUBJECT]}},auth_time:SECOND-120,iat:SECOND-60,exp:SECOND+3540},record:new UserRecord()},hooks={afterVerify:null,afterGetUser:null};
  class Auth{
    get app(){return state.app;}
    async verifyIdToken(value,checkRevoked){stats.verify++;assert.equal(this,auth);assert.equal(value,TOKEN);assert.equal(checkRevoked,true);if(hooks.afterVerify)await hooks.afterVerify();return state.token;}
    async getUser(uid){stats.getUser++;assert.equal(this,auth);assert.equal(uid,UID);if(hooks.afterGetUser)await hooks.afterGetUser();return state.record;}
  }
  const auth=new Auth(),options={enabled:true,projectId:PROJECT,auth,clock:()=>{stats.clock++;return state.clock;}};
  return {app,auth,state,stats,hooks,options,verify:(request={idToken:TOKEN})=>createProductionEnrollmentIdentityVerifier(options).verify(request)};
}
function recordField(f,key,value){Object.defineProperty(f.state.record,key,{value,enumerable:true,configurable:true});}
async function deny(f,error='access_denied'){const before=f.state.token,response=await f.verify();assert.deepEqual(response,{ok:false,error});assert.equal(f.state.token,before);assert.equal(JSON.stringify(response).includes(TOKEN),false);return response;}
function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}

test('fresh verified Google identity supports real-shaped SDK classes and returns only an immutable internal projection',async()=>{
  const f=fixture(),response=await f.verify();assert.deepEqual(response,{ok:true,identity:{projectId:PROJECT,uid:UID,email:EMAIL,googleSubject:SUBJECT,authTimeMs:MS-120000,issuedAtMs:MS-60000,expiresAtMs:MS+3540000,verifiedAt:NOW}});
  assert.equal(Object.isFrozen(response),true);assert.equal(Object.isFrozen(response.identity),true);assert.deepEqual(f.stats,{verify:1,getUser:1,clock:3});
  assert.equal(JSON.stringify(response).includes(TOKEN),false);for(const key of ['providerData','passwordHash','firebase','customClaims','emailVerified','disabled'])assert.equal(Object.hasOwn(response.identity,key),false);
});
test('OFF never reads request/options getters, SDK handles, clock or other dependencies',async()=>{
  let reads=0;const request={get idToken(){reads++;throw Error();}},options={get enabled(){reads++;return true;},get auth(){reads++;throw Error();}};
  for(const factory of [createProductionEnrollmentIdentityVerifier(),createProductionEnrollmentIdentityVerifier(options),createProductionEnrollmentIdentityVerifier({enabled:false,get projectId(){reads++;throw Error();}}),createProductionEnrollmentIdentityVerifier({enabled:1,get clock(){reads++;throw Error();}})])assert.deepEqual(await factory.verify(request),{ok:false,error:'service_disabled'});
  assert.equal(reads,0);const source=fs.readFileSync(require.resolve('../server/production-enrollment-identity.cjs'),'utf8');assert.doesNotMatch(source,/\brequire\s*\(|\bimport\s*\(|\bfetch\s*\(|process\.(?:env|argv)|console\.|\.toJSON\s*\(/);
});
test('only exact already-lowercase Gmail spelling is supported, without coercion or alias normalization',()=>{
  for(const v of [EMAIL,'synthetic+tag@gmail.com','syn.thetic@gmail.com'])assert.equal(isEnrollmentEmail(v),true);
  for(const v of [null,{},new String(EMAIL),'Synthetic@gmail.com','synthetic@GMAIL.COM',' '+EMAIL,EMAIL+' ',EMAIL+'\n','synthetic@example.invalid','synthetic@gmail.com.evil',EMAIL.replace('.','\u0000'),'a'.repeat(245)+'@gmail.com'])assert.equal(isEnrollmentEmail(v),false);
});
test('options/accessor/missing/wrong-project configuration is rejected before all SDK methods or clock',async()=>{
  for(const mutate of [o=>{o.projectId='wrong';},o=>{o.projectId='demo-other-project';},o=>{delete o.clock;},o=>{o.other=true;},o=>{Object.defineProperty(o,'auth',{get(){throw Error('Private auth accessor');},enumerable:true});}]){const f=fixture();mutate(f.options);await deny(f,'unavailable');assert.deepEqual(f.stats,{verify:0,getUser:0,clock:0});}
});
test('method accessors are refused while normal inherited SDK methods and app/options getters are supported',async()=>{
  for(const key of ['verifyIdToken','getUser']){const f=fixture();let reads=0;Object.defineProperty(f.auth,key,{enumerable:true,get(){reads++;throw Error('Private method accessor');}});await deny(f,'unavailable');assert.equal(reads,0);assert.equal(f.stats.clock,0);}
  const f=fixture();assert.equal((await f.verify()).ok,true);
});
test('factory snapshots project/auth/clock without following later caller option replacement',async()=>{
  const f=fixture(),verifier=createProductionEnrollmentIdentityVerifier(f.options);f.options.projectId='demo-other-project';f.options.auth=null;f.options.clock=()=>{throw Error();};assert.equal((await verifier.verify({idToken:TOKEN})).ok,true);
});
test('request shape, descriptors and token bounds reject all extra identity/role/worker fields before SDK',async()=>{
  for(const request of [null,{},[],{idToken:TOKEN,uid:UID},{idToken:TOKEN,email:EMAIL},{idToken:TOKEN,workerId:'synthetic-worker'},{idToken:TOKEN,profile:{owner:true}},{idToken:''},{idToken:1},{idToken:'x'.repeat(16385)},{idToken:TOKEN+'\r\n'},{get idToken(){throw Error('Private token accessor');}}]){const f=fixture();assert.deepEqual(await f.verify(request),{ok:false,error:'invalid_request'});assert.deepEqual(f.stats,{verify:0,getUser:0,clock:0});}
});
test('unsafe request prototypes, hidden fields and symbols cannot become SDK input',async()=>{
  for(const request of [Object.assign(Object.create({inherited:true}),{idToken:TOKEN}),Object.defineProperty({idToken:TOKEN},'hidden',{value:true}),Object.assign({idToken:TOKEN},{[Symbol('private')]:true})]){const f=fixture();assert.deepEqual(await f.verify(request),{ok:false,error:'invalid_request'});assert.equal(f.stats.verify,0);}
});
test('wrong project/issuer/UID/sub, unverified email or non-Google token fails before getUser',async()=>{
  for(const patch of [{aud:'demo-other-project'},{iss:'https://example.invalid'},{sub:'another-uid'},{uid:'../unsafe',sub:'../unsafe'},{uid:'constructor',sub:'constructor'},{uid:'u'.repeat(129),sub:'u'.repeat(129)},{email_verified:false},{email_verified:'true'},{email:'Synthetic@gmail.com'},{email:' '+EMAIL},{email:'synthetic@example.invalid'},{firebase:{sign_in_provider:'password',identities:{'google.com':[SUBJECT]}}}]){const f=fixture();Object.assign(f.state.token,patch);await deny(f);assert.equal(f.stats.getUser,0);}
});
test('Google identity must be an exact single safe subject, never inferred from other provider/email/display claims',async()=>{
  for(const subjects of [[],[SUBJECT,'another-subject'],[null],['subject@provider.invalid'],['../unsafe'],['prototype'],SUBJECT,{0:SUBJECT,length:1},Array(1),Object.assign([SUBJECT],{extra:true})]){const f=fixture();f.state.token.firebase.identities['google.com']=subjects;await deny(f);assert.equal(f.stats.getUser,0);}
  for(const mutate of [f=>{delete f.state.token.firebase.identities['google.com'];},f=>{f.state.token.firebase.identities={email:[EMAIL]};},f=>{f.state.token.firebase.tenant='unsupported-auth-tenant';}]){const f=fixture();mutate(f);await deny(f);assert.equal(f.stats.getUser,0);}
});
test('token/claim subject accessors and nonregular token prototypes are refused without execution',async()=>{
  for(const at of ['token','firebase','identities','subject']){const f=fixture();let calls=0;const v=at==='token'?f.state.token:at==='firebase'?f.state.token.firebase:at==='identities'?f.state.token.firebase.identities:f.state.token.firebase.identities['google.com'],key=at==='token'?'uid':at==='firebase'?'sign_in_provider':at==='identities'?'google.com':'0';Object.defineProperty(v,key,{enumerable:true,get(){calls++;throw Error('Private claim accessor');}});await deny(f);assert.equal(calls,0);assert.equal(f.stats.getUser,0);}
  const f=fixture();Object.setPrototypeOf(f.state.token,{private:true});await deny(f);assert.equal(f.stats.getUser,0);
});
test('token time values are safe integer seconds with explicit chronology and no future/expired values',async()=>{
  for(const patch of [{auth_time:0},{auth_time:'1'},{iat:NaN},{iat:Infinity},{iat:SECOND-0.5},{exp:Number.MAX_SAFE_INTEGER},{auth_time:SECOND-60,iat:SECOND-120},{iat:SECOND+1},{auth_time:SECOND+1,iat:SECOND+1},{exp:SECOND},{exp:SECOND-60},{iat:SECOND,exp:SECOND}]){const f=fixture();Object.assign(f.state.token,patch);await deny(f);assert.equal(f.stats.getUser,0);}
});
test('a freshly refreshed ID token cannot compensate for an old Google sign-in session',async()=>{
  const f=fixture();f.state.token.auth_time=SECOND-301;f.state.token.iat=SECOND;await deny(f);assert.equal(f.stats.getUser,0);
});
test('fixed five-minute inclusive boundary permits exact edge and rejects one extra millisecond',async()=>{
  let f=fixture();f.state.token.auth_time=SECOND-300;f.state.token.iat=SECOND-300;assert.equal((await f.verify()).ok,true);
  f=fixture();f.state.token.auth_time=SECOND-300;f.state.token.iat=SECOND-300;f.state.clock='2026-10-06T03:00:00.001Z';await deny(f);
});
test('freshness is rechecked after token verification await and stale tokens do not read the user',async()=>{
  const f=fixture();f.hooks.afterVerify=()=>{f.state.clock='2026-10-06T03:04:00.000Z';};await deny(f);assert.equal(f.stats.getUser,0);
});
test('freshness and expiry are rechecked after getUser await, without accepting a stale final identity',async()=>{
  for(const [advance,exp]of [['2026-10-06T03:04:00.000Z',SECOND+3540],['2026-10-06T03:00:01.000Z',SECOND+1]]){const f=fixture();f.state.token.exp=exp;f.hooks.afterGetUser=()=>{f.state.clock=advance;};await deny(f);assert.equal(f.stats.getUser,1);}
});
test('getUser must return the same current enabled verified primary UID/email',async()=>{
  for(const [key,value]of [['uid','another-uid'],['disabled',true],['disabled',undefined],['emailVerified',false],['emailVerified','true'],['email','other@gmail.com'],['email',EMAIL.toUpperCase()],['tenantId','unsupported-auth-tenant']]){const f=fixture();recordField(f,key,value);await deny(f);assert.equal(f.stats.getUser,1);}
  const f=fixture();f.state.record=null;await deny(f);
});
test('linked Google provider subject and email must match exact token and current record identities',async()=>{
  for(const provider of [{providerId:'password',uid:SUBJECT,email:EMAIL},{providerId:'google.com',uid:'other-subject',email:EMAIL},{providerId:'google.com',uid:SUBJECT,email:'other@gmail.com'},{providerId:'google.com',uid:SUBJECT},{providerId:'google.com',email:EMAIL}]){const f=fixture();recordField(f,'providerData',[provider]);await deny(f);}
});
test('missing/duplicate/oversized/sparse/extra provider collections are refused rather than choosing a first identity',async()=>{
  for(const providers of [[],[new UserInfo(),new UserInfo()],Array(1),Array.from({length:17},()=>({providerId:'password'})),Object.assign([new UserInfo()],{extra:true}),{},null]){const f=fixture();recordField(f,'providerData',providers);await deny(f);}
});
test('a different linked provider cannot supply a fallback Google subject or email',async()=>{
  const f=fixture();recordField(f,'providerData',[{providerId:'password',uid:'private-password-provider',email:'other@gmail.com'},new UserInfo()]);assert.equal((await f.verify()).ok,true);
});
test('selected UserRecord/provider accessors are refused without running them',async()=>{
  for(const at of ['record','provider','array']){const f=fixture();let reads=0;if(at==='record')Object.defineProperty(f.state.record,'email',{enumerable:true,get(){reads++;throw Error();}});else if(at==='provider')recordField(f,'providerData',[{providerId:'google.com',uid:SUBJECT,get email(){reads++;throw Error();}}]);else{const providers=[];Object.defineProperty(providers,'0',{enumerable:true,get(){reads++;throw Error();}});recordField(f,'providerData',providers);}await deny(f);assert.equal(reads,0);}
});
test('unrelated private UserRecord data and toJSON hooks remain unobserved and absent from identity',async()=>{
  const f=fixture();let reads=0;for(const key of ['passwordHash','passwordSalt','customClaims','metadata','displayName'])Object.defineProperty(f.state.record,key,{enumerable:true,get(){reads++;throw Error('Private record accessor');}});const response=await f.verify();assert.equal(response.ok,true);assert.equal(reads,0);for(const key of ['passwordHash','passwordSalt','customClaims','metadata','displayName'])assert.equal(Object.hasOwn(response.identity,key),false);
});
test('inherited token/record fields cannot stand in for required own identity fields',async()=>{
  let f=fixture();delete f.state.token.email;Object.setPrototypeOf(f.state.token,{email:EMAIL});await deny(f);assert.equal(f.stats.getUser,0);
  f=fixture();delete f.state.record.email;Object.setPrototypeOf(f.state.record,{email:EMAIL});await deny(f);
});
test('SDK verification/revocation/disabled/not-found errors remain generic and never expose raw exception data',async()=>{
  for(const phase of ['afterVerify','afterGetUser']){const f=fixture();f.hooks[phase]=()=>{throw Error('SYNTHETIC_PRIVATE_RAW_ERROR_CANARY '+EMAIL+' '+TOKEN);};const response=await deny(f);assert.equal(JSON.stringify(response).includes('CANARY'),false);assert.equal(JSON.stringify(response).includes(EMAIL),false);}
});
test('binding/project changes during verification or user lookup fail closed before a successful identity',async()=>{
  for(const phase of ['afterVerify','afterGetUser'])for(const change of ['project','app','method']){const f=fixture();f.hooks[phase]=()=>{if(change==='project')f.state.app={options:{projectId:'demo-other-project'}};else if(change==='app')f.state.app={options:{projectId:PROJECT}};else f.auth.getUser=async()=>f.state.record;};await deny(f,'unavailable');if(phase==='afterVerify')assert.equal(f.stats.getUser,0);}
});
test('binding changes triggered by clock evaluation also fail before SDK or returned identity',async()=>{
  const f=fixture();f.options.clock=()=>{f.state.app={options:{projectId:'demo-other-project'}};return NOW;};await deny(f,'unavailable');assert.equal(f.stats.verify,0);
});
test('changing project metadata on the same captured SDK app is refused after either Auth await',async()=>{
  for(const phase of ['afterVerify','afterGetUser']){const f=fixture();f.hooks[phase]=()=>{Object.defineProperty(f.app,'options',{get:()=>({projectId:'demo-other-project'}),configurable:true});};await deny(f,'unavailable');}
});
test('malformed, throwing and backwards clocks never yield a live identity',async()=>{
  for(const value of ['2026-02-30T00:00:00.000Z','2026-10-06T03:00:00Z',null,0,'1960-01-01T00:00:00.000Z']){const f=fixture();f.state.clock=value;await deny(f,'unavailable');assert.equal(f.stats.verify,0);}
  let f=fixture();f.options.clock=()=>{throw Error('SYNTHETIC_PRIVATE_CLOCK');};await deny(f,'unavailable');
  f=fixture();f.hooks.afterGetUser=()=>{f.state.clock='2026-10-06T02:59:59.999Z';};await deny(f,'unavailable');
});
test('frozen request/token/SDK selected fields are never mutated or serialized during success or rejection',async()=>{
  const f=fixture(),request=freeze({idToken:TOKEN}),token=freeze(f.state.token),before=JSON.stringify(token);Object.freeze(f.state.record.providerData);Object.freeze(f.state.record);assert.equal((await f.verify(request)).ok,true);assert.equal(JSON.stringify(f.state.token),before);assert.equal(request.idToken,TOKEN);
  const g=fixture();g.state.token.email='Other@gmail.com';freeze(g.state.token);const snapshot=JSON.stringify(g.state.token);await deny(g);assert.equal(JSON.stringify(g.state.token),snapshot);
});
test('inherited Object/Array serialization hooks are never called by token, record or result handling',async()=>{
  const originals=[Object.getOwnPropertyDescriptor(Object.prototype,'toJSON'),Object.getOwnPropertyDescriptor(Array.prototype,'toJSON')];let reads=0,response;
  try{for(const p of [Object.prototype,Array.prototype])Object.defineProperty(p,'toJSON',{configurable:true,get(){reads++;throw Error('Private inherited serialization');}});response=await fixture().verify();}
  finally{[Object.prototype,Array.prototype].forEach((p,i)=>{if(originals[i])Object.defineProperty(p,'toJSON',originals[i]);else delete p.toJSON;});}
  assert.equal(reads,0);assert.equal(response.ok,true);
});
