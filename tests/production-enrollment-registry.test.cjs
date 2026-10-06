'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Authority=require('../server/production-authority.cjs');
const Registry=require('../server/production-enrollment-registry.cjs');
const Adapter=require('../server/production-tenant-adapter.cjs');
const Session=require('../server/production-session-service.cjs');
const Admin=require('../server/production-tenant-admin.cjs');
const Ledger=require('../server/production-owner-ledger.cjs');
const Tariff=require('../server/production-tariff-ledger.cjs');
const PROJECT='demo-enrollment-registry',TENANT='synthetic-tenant',URL='https://'+PROJECT+'.firebaseio.com';
const NOW='2026-10-06T03:00:00.000Z',BEFORE='2026-10-06T02:00:00.000Z',AFTER='2026-10-06T04:00:00.000Z';
const EMAIL='syntheticpartner@gmail.com',QC_EMAIL='syntheticquality@gmail.com';
const copy=value=>JSON.parse(JSON.stringify(value));
function prune(value){if(value===null)return undefined;if(value&&typeof value==='object'){const out={};for(const [key,item]of Object.entries(value)){const next=prune(item);if(next!==undefined)out[key]=next;}return Object.keys(out).length?out:undefined;}return value;}
function initial(productId){return Authority.createAuthority({product:{id:productId,series:'Synthetic',namaBarang:'Synthetic item',size:'M',cutQuantity:10},cycleId:'cycle-1',workers:[{id:'worker-1',nama:'Synthetic one'},{id:'worker-2',nama:'Synthetic two'}],assignments:[{id:'assignment-1',workerId:'worker-1',qty:10}],now:NOW});}
function cycle(productId){return {config:{revision:1,active:true,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'},tariffInputs:{revision:1,policy:{version:'policy-1',kind:'jakarta-fixed-local-time',hour:8,minute:0},historyByWorker:{'worker-1':{'tariff-1':{effectiveAt:BEFORE,currency:'IDR',rate:100}}}},wire:prune(Authority.encodeStorage(initial(productId)))};}
function approval(profile={active:true,owner:false,workerId:'worker-1',modules:{jahit:true}},email=EMAIL){return {email,profile,reviewed:true,approvedAt:BEFORE,expiresAt:AFTER,revision:1,status:'pending'};}
function tenant(){return {schemaVersion:1,projectId:PROJECT,tenantId:TENANT,grants:{'owner-1':{revision:4,profile:{active:true,owner:true}},'unrelated-1':{revision:3,profile:{active:false,owner:false,modules:{laporan:true}}}},products:{'product-1':{cycles:{'cycle-1':cycle('product-1')}},'product-2':{cycles:{'cycle-1':cycle('product-2')}}},enrollmentRegistry:{schemaVersion:1,approvals:{'approval-1':approval(),'approval-q':approval({active:true,owner:false,modules:{qc:true}},QC_EMAIL)}}};}
function identity(now=NOW,changes={}){return {projectId:PROJECT,uid:'partner-uid',email:EMAIL,googleSubject:'google-subject-1',authTimeMs:Date.parse(now)-1000,issuedAtMs:Date.parse(now)-1000,expiresAtMs:Date.parse(now)+3600000,verifiedAt:now,...changes};}
const validate=value=>Registry.validateEnrollmentRegistry(value.enrollmentRegistry,value.grants,value.products);
const claim=(value,who=identity(),now=NOW)=>Registry.claimEnrollment(value,who,now);
const denies=(callback,code)=>assert.throws(callback,error=>error instanceof Registry.EnrollmentRegistryError&&error.message===error.code&&(!code||error.code===code));
function withLedgers(value){
  const state=Authority.decodeStorage(value.products['product-1'].cycles['cycle-1'].wire);
  const command={kind:'createCycle',requestId:'create-1',product:copy(state.product),cycleId:state.cycleId,workers:Object.values(state.workers),assignments:Object.values(state.assignments),tariffPolicy:copy(value.products['product-1'].cycles['cycle-1'].tariffInputs.policy),initialTariffs:[{workerId:'worker-1',tariffVersion:'tariff-1',effectiveAt:BEFORE,currency:'IDR',rate:100}]};
  value.ownerCommandLedger=Ledger.appendOwnerLedger(undefined,{uid:'owner-1',command,acceptedAt:NOW,initialSnapshotHash:state.snapshots.v0000000000.hash},value.products);
  const tariffCommand={kind:'appendTariffVersion',requestId:'tariff-retire-1',productId:'product-1',cycleId:'cycle-1',expectedConfigRevision:1,expectedTariffRevision:1,workerId:'worker-1',tariffVersion:'future-tariff',effectiveAt:AFTER,currency:'IDR',rate:200};
  value.tariffCommandLedger=Tariff.appendTariffRetirement(undefined,{uid:'owner-1',command:tariffCommand,retiredAt:NOW},value.products);return value;
}
function fixture(value=tenant()){
  const store={value:copy(value)},stats={refs:0,reads:0,writes:0,transactions:0,auth:0};
  const snapshot=()=>({val:()=>Registry.copyEnrollmentData(store.value)});
  const reference={toString:()=>URL+'/authorityTenants/'+TENANT,on(event,callback){assert.equal(event,'value');callback(snapshot());},off(){},async get(){stats.reads++;return snapshot();},async transaction(update,_complete,applyLocally){stats.transactions++;assert.equal(applyLocally,false);const next=update(Registry.copyEnrollmentData(store.value));if(next===undefined)return {committed:false,snapshot:snapshot()};store.value=prune(Registry.copyEnrollmentData(next));stats.writes++;return {committed:true,snapshot:snapshot()};}};
  const database={app:{options:{projectId:PROJECT,databaseURL:URL}},ref(refPath){stats.refs++;assert.equal(refPath,'authorityTenants/'+TENANT);return reference;}};
  const auth={async verifyIdToken(_token,revoked){stats.auth++;assert.equal(revoked,true);return {uid:'owner-1',sub:'owner-1',aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,email_verified:true,firebase:{sign_in_provider:'google.com'},exp:Date.parse(NOW)/1000+3600};}};
  const options={enabled:true,projectId:PROJECT,databaseURL:URL,tenantId:TENANT,database,auth,admit:async()=>true,clock:()=>NOW};return {store,stats,options};
}

test('optional registry absence remains valid without introducing a new owner requirement',()=>{
  const value=tenant();delete value.enrollmentRegistry;delete value.grants['owner-1'];
  assert.equal(Registry.validateEnrollmentRegistry(undefined,undefined,undefined),undefined);
  assert.equal(Adapter.validateCanonicalTenant(value,{projectId:PROJECT,tenantId:TENANT}),value);
  assert.deepEqual(Object.keys(Registry).sort(),['ADMISSION_LIMIT','ADMISSION_WINDOW_MS','EnrollmentRegistryError','MAX_BYTES','MAX_ROWS','claimEnrollment','inspectEnrollmentRegistry','lookupEnrollmentApproval','lookupEnrollmentClaim','serializeEnrollmentData','copyEnrollmentData','validateEnrollmentRegistry'].sort());
});

test('lookup returns a frozen private exact result, never matches aliases or creates an unknown approval',()=>{
  const value=tenant(),before=copy(value),found=Registry.lookupEnrollmentApproval(value.enrollmentRegistry,EMAIL);
  assert.deepEqual(Object.keys(found),['approvalId','row']);assert.equal(found.approvalId,'approval-1');assert.ok(Object.isFrozen(found)&&Object.isFrozen(found.row.profile.modules));
  assert.equal(Registry.lookupEnrollmentApproval(value.enrollmentRegistry,'synthetic.partner@gmail.com'),null);
  assert.equal(Registry.lookupEnrollmentApproval(value.enrollmentRegistry,'unknownsynthetic@gmail.com'),null);
  denies(()=>Registry.lookupEnrollmentApproval(value.enrollmentRegistry,EMAIL.toUpperCase()),'access_denied');assert.deepEqual(value,before);
});

test('initial sewing claim changes only selected approval and new UID grant, preserving products and both ledgers',()=>{
  const value=withLedgers(tenant()),before=copy(value);Adapter.validateCanonicalTenant(value,{projectId:PROJECT,tenantId:TENANT});const result=claim(value);
  assert.deepEqual(value,before);assert.equal(result.replayed,false);assert.equal(result.grantRevision,1);assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.next.products));
  const expected=copy(before);expected.grants['partner-uid']={revision:1,profile:copy(before.enrollmentRegistry.approvals['approval-1'].profile)};
  expected.enrollmentRegistry.approvals['approval-1']={...expected.enrollmentRegistry.approvals['approval-1'],revision:2,status:'claimed',claim:{uid:'partner-uid',googleSubject:'google-subject-1',claimedAt:NOW,grantRevision:1},admission:{windowStartedAt:Date.parse(NOW),count:1}};
  assert.deepEqual(result.next,expected);Adapter.validateCanonicalTenant(result.next,{projectId:PROJECT,tenantId:TENANT});
});

test('QC receives only the reviewed QC profile without a worker wage binding',()=>{
  const value=tenant(),result=claim(value,identity(NOW,{uid:'qc-uid',email:QC_EMAIL,googleSubject:'google-qc-1'}));
  assert.deepEqual(result.next.grants['qc-uid'],{revision:1,profile:{active:true,owner:false,modules:{qc:true}}});assert.equal(Object.hasOwn(result.next.grants['qc-uid'].profile,'workerId'),false);assert.deepEqual(result.next.products,value.products);
});

test('claim requires an existing active owner, initial valid time window, and assigned active reviewed sewing cycle',()=>{
  for(const mutate of [v=>{delete v.grants['owner-1'];},v=>{v.grants['owner-1'].profile.active=false;},v=>{v.enrollmentRegistry.approvals['approval-1'].approvedAt=AFTER;v.enrollmentRegistry.approvals['approval-1'].expiresAt='2026-10-06T05:00:00.000Z';},v=>{v.enrollmentRegistry.approvals['approval-1'].expiresAt=NOW;},v=>{for(const p of Object.values(v.products))p.cycles['cycle-1'].config.active=false;},v=>{for(const p of Object.values(v.products))p.cycles['cycle-1'].config.reviewedEmptyCycle=false;},v=>{v.enrollmentRegistry.approvals['approval-1'].profile.workerId='worker-2';}]){
    const value=tenant();mutate(value);const before=copy(value);denies(()=>claim(value));assert.deepEqual(value,before);
  }
  const missing=tenant();missing.enrollmentRegistry.approvals['approval-1'].profile.workerId='absent-worker';denies(()=>validate(missing),'not_ready');
});

test('current UID grants and any retained worker binding cannot be overwritten or reassigned',()=>{
  for(const profile of [{active:true,owner:true},{active:false,owner:false,modules:{qc:true}},{active:true,owner:false,modules:{laporan:true}}]){
    const value=tenant();value.grants['partner-uid']={revision:7,profile};const before=copy(value);denies(()=>claim(value),'access_denied');assert.deepEqual(value,before);
  }
  const value=tenant();value.grants['earlier-uid']={revision:8,profile:{active:false,owner:false,workerId:'worker-1',modules:{jahit:true}}};denies(()=>validate(value),'not_ready');
});

test('lost acknowledgment replay keeps original immutable claim and grant, consuming only row quota/revision',()=>{
  const first=claim(tenant()).next,before=copy(first),replayed=claim(first);
  assert.equal(replayed.replayed,true);assert.equal(replayed.grantRevision,1);assert.deepEqual(first,before);
  const expected=copy(first);expected.enrollmentRegistry.approvals['approval-1'].admission.count=2;expected.enrollmentRegistry.approvals['approval-1'].revision=3;
  assert.deepEqual(replayed.next,expected);assert.deepEqual(replayed.next.enrollmentRegistry.approvals['approval-1'].claim,first.enrollmentRegistry.approvals['approval-1'].claim);
});

test('retained UID and Google subject select the original claim before any changed-email approval',()=>{
  const value=claim(tenant()).next,changed=identity(NOW,{email:QC_EMAIL}),result=claim(value,changed);
  assert.equal(result.replayed,true);assert.equal(result.approvalId,'approval-1');assert.deepEqual(result.next.grants,value.grants);assert.deepEqual(result.next.enrollmentRegistry.approvals['approval-q'],value.enrollmentRegistry.approvals['approval-q']);
  const found=Registry.lookupEnrollmentClaim(value.enrollmentRegistry,changed);assert.equal(found.approvalId,'approval-1');assert.ok(Object.isFrozen(found.row));
  for(const changes of [{uid:'different-uid'},{googleSubject:'different-subject'}])denies(()=>Registry.lookupEnrollmentClaim(value.enrollmentRegistry,identity(NOW,changes)),'access_denied');
  assert.equal(Registry.lookupEnrollmentClaim(value.enrollmentRegistry,identity(NOW,{uid:'new-uid',googleSubject:'new-subject'})),null);
});

test('claimed replay remains available after preapproval expires and owner closes cycles',()=>{
  const value=copy(claim(tenant()).next),later='2026-10-07T03:00:00.000Z';for(const product of Object.values(value.products))product.cycles['cycle-1'].config.active=false;
  assert.equal(validate(value),value.enrollmentRegistry);const result=claim(value,identity(later),later);assert.equal(result.replayed,true);assert.equal(result.next.enrollmentRegistry.approvals['approval-1'].admission.count,1);assert.deepEqual(result.next.grants,value.grants);
});

test('inactive grants, changed scope, different UID/subject, and revoked approvals deny replay without quota writes',()=>{
  for(const mutate of [v=>{v.grants['partner-uid'].profile.active=false;},v=>{v.grants['partner-uid'].profile.owner=true;},v=>{v.grants['partner-uid'].profile.modules={jahit:true,qc:true};},v=>{v.enrollmentRegistry.approvals['approval-1'].status='revoked';v.grants['partner-uid'].profile.active=false;}]){
    const value=copy(claim(tenant()).next);mutate(value);assert.equal(validate(value),value.enrollmentRegistry);const before=copy(value);denies(()=>claim(value),'access_denied');assert.deepEqual(value,before);
  }
  for(const changes of [{uid:'different-uid'},{googleSubject:'different-google-subject'}]){const value=claim(tenant()).next,before=copy(value);denies(()=>claim(value,identity(NOW,changes)),'access_denied');assert.deepEqual(value,before);}
});

test('claimed and revoked tombstones require retained grant existence, initial revision and exact worker binding',()=>{
  for(const mutate of [v=>{delete v.grants['partner-uid'];},v=>{v.grants['partner-uid'].revision=0;},v=>{v.grants['partner-uid'].profile.workerId='worker-2';},v=>{v.enrollmentRegistry.approvals['approval-1'].claim.grantRevision=2;},v=>{delete v.enrollmentRegistry.approvals['approval-1'].claim;}]){
    const value=copy(claim(tenant()).next);mutate(value);denies(()=>validate(value),'not_ready');
  }
  const qc=copy(claim(tenant(),identity(NOW,{uid:'qc-uid',email:QC_EMAIL,googleSubject:'google-qc-1'})).next);qc.grants['qc-uid'].profile.workerId='worker-1';denies(()=>validate(qc),'not_ready');
  const badQcRevision=copy(claim(tenant(),identity(NOW,{uid:'qc-uid',email:QC_EMAIL,googleSubject:'google-qc-1'})).next);badQcRevision.grants['qc-uid'].revision=0;denies(()=>validate(badQcRevision),'not_ready');
});

test('retained Google subject and UID cannot claim a second review approval, even after revocation',()=>{
  const value=copy(claim(tenant()).next);value.enrollmentRegistry.approvals['approval-1'].status='revoked';value.grants['partner-uid'].profile.active=false;
  const before=copy(value);for(const changes of [{uid:'other-uid',email:QC_EMAIL},{uid:'partner-uid',email:QC_EMAIL,googleSubject:'other-subject'}])denies(()=>claim(value,identity(NOW,changes)),'access_denied');assert.deepEqual(value,before);
});

test('quota admits exactly eight eligible claims/replays per fixed minute and rolls over without grant rewrite',()=>{
  let value=tenant();for(let i=1;i<=8;i++){value=claim(value).next;assert.equal(value.enrollmentRegistry.approvals['approval-1'].admission.count,i);assert.equal(value.enrollmentRegistry.approvals['approval-1'].revision,i+1);}
  const before=copy(value);denies(()=>claim(value),'rate_limited');assert.deepEqual(value,before);
  const nextMinute='2026-10-06T03:01:00.000Z',next=claim(value,identity(nextMinute),nextMinute);assert.equal(next.replayed,true);assert.equal(next.next.enrollmentRegistry.approvals['approval-1'].admission.count,1);assert.deepEqual(next.next.grants,value.grants);
  assert.equal(Registry.ADMISSION_LIMIT,8);assert.equal(Registry.ADMISSION_WINDOW_MS,60000);
});

test('unknown, inactive and expired pending identities neither create quota buckets nor consume approval quota',()=>{
  const value=tenant(),before=copy(value);for(let i=0;i<10;i++)denies(()=>claim(value,identity(NOW,{email:'unknown'+i+'@gmail.com',uid:'unknown-uid-'+i})),'access_denied');assert.deepEqual(value,before);
  const expired=tenant();expired.enrollmentRegistry.approvals['approval-1'].expiresAt=NOW;expired.enrollmentRegistry.approvals['approval-1'].admission={windowStartedAt:Date.parse(NOW),count:8};const expiredBefore=copy(expired);denies(()=>claim(expired),'access_denied');assert.deepEqual(expired,expiredBefore);
});

test('future quota window, older retained claim time and exhausted revisions deny without mutation',()=>{
  const future=tenant();future.enrollmentRegistry.approvals['approval-1'].admission={windowStartedAt:Date.parse(NOW)+60000,count:1};const before=copy(future);denies(()=>claim(future),'access_denied');assert.deepEqual(future,before);
  const claimed=claim(tenant()).next,earlier='2026-10-06T02:59:59.000Z';denies(()=>claim(claimed,identity(earlier),earlier),'access_denied');
  const exhausted=tenant();exhausted.enrollmentRegistry.approvals['approval-1'].revision=Number.MAX_SAFE_INTEGER;denies(()=>claim(exhausted),'capacity_limit');assert.equal(exhausted.enrollmentRegistry.approvals['approval-1'].revision,Number.MAX_SAFE_INTEGER);
});

test('registry rejects malformed schema, elevated/mixed scopes, redundant indices, timestamps and quota policy fields',()=>{
  const changes=[v=>{v.enrollmentRegistry.schemaVersion=2;},v=>{v.enrollmentRegistry.byEmail={};},v=>{v.enrollmentRegistry.approvals={};},v=>{v.enrollmentRegistry.approvals['approval-1'].reviewed=false;},v=>{v.enrollmentRegistry.approvals['approval-1'].email=EMAIL.toUpperCase();},v=>{v.enrollmentRegistry.approvals['approval-1'].profile.active=false;},v=>{v.enrollmentRegistry.approvals['approval-1'].profile.owner=true;},v=>{v.enrollmentRegistry.approvals['approval-1'].profile.modules={jahit:true,qc:true};},v=>{v.enrollmentRegistry.approvals['approval-1'].profile.modules={potong:true};},v=>{delete v.enrollmentRegistry.approvals['approval-1'].profile.workerId;},v=>{v.enrollmentRegistry.approvals['approval-q'].profile.workerId='worker-2';},v=>{v.enrollmentRegistry.approvals['approval-1'].approvedAt='2026-02-30T00:00:00.000Z';},v=>{v.enrollmentRegistry.approvals['approval-1'].expiresAt=BEFORE;},v=>{v.enrollmentRegistry.approvals['approval-1'].revision=0;},v=>{v.enrollmentRegistry.approvals['approval-1'].claim={uid:'x',googleSubject:'y',claimedAt:NOW,grantRevision:1};},v=>{v.enrollmentRegistry.approvals['approval-1'].status='active';}];
  for(const mutate of changes){const value=tenant();mutate(value);denies(()=>validate(value),'not_ready');}
  for(const admission of [{windowStartedAt:Date.parse(NOW)+1,count:1},{windowStartedAt:Date.parse(NOW),count:0},{windowStartedAt:Date.parse(NOW),count:9},{windowStartedAt:Date.parse(NOW),count:1,limit:99},{windowStartedAt:-60000,count:1},{windowStartedAt:Date.parse(BEFORE)-60000,count:1}]){const value=tenant();value.enrollmentRegistry.approvals['approval-1'].admission=admission;denies(()=>validate(value),'not_ready');}
});

test('duplicate exact emails/workers and retained UID/subjects are rejected rather than resolved by elimination',()=>{
  const duplicateEmail=tenant();duplicateEmail.enrollmentRegistry.approvals['approval-q'].email=EMAIL;denies(()=>validate(duplicateEmail),'not_ready');
  const duplicateWorker=tenant();duplicateWorker.enrollmentRegistry.approvals['approval-extra']=approval(copy(duplicateWorker.enrollmentRegistry.approvals['approval-1'].profile),'syntheticextra@gmail.com');denies(()=>validate(duplicateWorker),'not_ready');
  const value=copy(claim(tenant()).next);value.enrollmentRegistry.approvals['approval-q'].status='claimed';value.enrollmentRegistry.approvals['approval-q'].revision=2;value.enrollmentRegistry.approvals['approval-q'].claim=copy(value.enrollmentRegistry.approvals['approval-1'].claim);denies(()=>validate(value),'not_ready');
  value.enrollmentRegistry.approvals['approval-q'].claim.uid='qc-uid';value.grants['qc-uid']={revision:1,profile:{active:true,owner:false,modules:{qc:true}}};denies(()=>validate(value),'not_ready');
});

test('capacity is bounded by both row count and serialized bytes without truncation',()=>{
  const value=tenant();value.enrollmentRegistry.approvals={};for(let i=0;i<129;i++)value.enrollmentRegistry.approvals['approval-'+i]=approval({active:true,owner:false,modules:{qc:true}},'synthetic'+i+'@gmail.com');denies(()=>validate(value),'capacity_limit');
  const large=tenant();large.enrollmentRegistry.approvals={};for(let i=0;i<128;i++){
    const suffix=String(i).padStart(4,'0'),key='a'.repeat(124)+suffix,uid='u'.repeat(124)+suffix,subject='s'.repeat(124)+suffix;
    large.enrollmentRegistry.approvals[key]={...approval({active:true,owner:false,modules:{qc:true}},'synthetic'+i+'@gmail.com'),status:'claimed',revision:2,claim:{uid,googleSubject:subject,claimedAt:NOW,grantRevision:1}};large.grants[uid]={revision:1,profile:{active:true,owner:false,modules:{qc:true}}};
  }
  assert.ok(Buffer.byteLength(JSON.stringify(large.enrollmentRegistry))>65536);denies(()=>validate(large),'capacity_limit');assert.equal(Registry.MAX_ROWS,128);assert.equal(Registry.MAX_BYTES,65536);
});

test('unsafe getter, symbol, cycle, prototype and unknown row data fail without executing accessors',()=>{
  let getterReads=0;const getter=tenant();Object.defineProperty(getter.enrollmentRegistry.approvals['approval-1'],'email',{enumerable:true,get(){getterReads++;throw Error('must not execute');}});denies(()=>validate(getter),'not_ready');assert.equal(getterReads,0);
  const symbol=tenant();symbol.enrollmentRegistry[Symbol('synthetic')]=true;denies(()=>validate(symbol),'not_ready');
  const circular=tenant();circular.enrollmentRegistry.loop=circular.enrollmentRegistry;denies(()=>validate(circular),'not_ready');
  const proto=tenant();proto.enrollmentRegistry.approvals=JSON.parse('{"__proto__":{}}');denies(()=>validate(proto),'not_ready');
  const inherited=tenant();Object.setPrototypeOf(inherited.enrollmentRegistry.approvals['approval-1'],{inherited:true});denies(()=>validate(inherited),'not_ready');
  const proxy=new Proxy({}, {ownKeys(){throw Error('synthetic trap detail');}});denies(()=>Registry.validateEnrollmentRegistry(proxy,{},{}),'not_ready');
});

test('identity scope, fields, fresh times and verified observation are exact before any mutation',()=>{
  const value=tenant(),before=copy(value);for(const changes of [{projectId:'demo-other'},{uid:'../unsafe'},{googleSubject:'constructor'},{email:EMAIL.toUpperCase()},{role:'owner'},{verifiedAt:AFTER},{authTimeMs:Date.parse(NOW)-300001},{issuedAtMs:Date.parse(NOW)+1},{expiresAtMs:Date.parse(NOW)}])denies(()=>claim(value,identity(NOW,changes)));
  assert.deepEqual(value,before);denies(()=>claim(value,identity(),'2026-10-06'),'not_ready');
});

test('whole-tenant adapter validation preserves historical optional fields and rejects registry defects',()=>{
  const value=withLedgers(tenant());assert.equal(Adapter.validateCanonicalTenant(value,{projectId:PROJECT,tenantId:TENANT}),value);
  const malformed=copy(value);malformed.enrollmentRegistry.approvals['approval-1'].profile.owner=true;assert.throws(()=>Adapter.validateCanonicalTenant(malformed,{projectId:PROJECT,tenantId:TENANT}),Authority.AuthorityError);
  const badLedger=copy(value);badLedger.ownerCommandLedger.entries[Object.keys(badLedger.ownerCommandLedger.entries)[0]].receipt.revision=99;assert.throws(()=>Adapter.validateCanonicalTenant(badLedger,{projectId:PROJECT,tenantId:TENANT}),Authority.AuthorityError);
  for(const binding of [{projectId:PROJECT,tenantId:'../unsafe'},{projectId:'demo-other',tenantId:TENANT},{projectId:PROJECT,tenantId:TENANT,owner:true}])assert.throws(()=>Adapter.validateCanonicalTenant(value,binding),Authority.AuthorityError);
  const proxy=new Proxy({}, {ownKeys(){throw Error('synthetic binding trap');}});assert.throws(()=>Adapter.validateCanonicalTenant(value,proxy),error=>error instanceof Authority.AuthorityError&&error.message===error.code);
});

test('inherited toJSON getter/function never runs for registry, whole-tenant copies, or owned tenant readers/writers',async()=>{
  const value=withLedgers(tenant()),f=fixture(value),who=identity(),sample={list:[1,{example:'synthetic'}]},session=Session.createProductionSessionService(f.options),admin=Admin.createProductionTenantAdmin(f.options),adapter=Adapter.createProductionTenantAdapter(f.options);
  const oldObject=Object.getOwnPropertyDescriptor(Object.prototype,'toJSON'),oldArray=Object.getOwnPropertyDescriptor(Array.prototype,'toJSON');let getterCalls=0,functionCalls=0;
  try{
    const descriptor={configurable:true,get(){getterCalls++;return function(){functionCalls++;return {altered:true};};}};
    Object.defineProperty(Object.prototype,'toJSON',descriptor);Object.defineProperty(Array.prototype,'toJSON',descriptor);
    assert.deepEqual(Registry.copyEnrollmentData(sample),sample);assert.equal(Registry.serializeEnrollmentData(sample),'{"list":[1,{"example":"synthetic"}]}');
    assert.equal(validate(value),value.enrollmentRegistry);assert.equal(claim(value,who).next.grants['partner-uid'].profile.workerId,'worker-1');assert.equal(Adapter.validateCanonicalTenant(value,{projectId:PROJECT,tenantId:TENANT}),value);
    assert.equal((await session.execute({idToken:'synthetic-token'})).ok,true);assert.equal((await adapter.repository.readGrant({projectId:PROJECT,uid:'owner-1'})).uid,'owner-1');
    const close={kind:'setConfig',productId:'product-1',cycleId:'cycle-1',expectedRevision:1,config:{active:false,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'}};
    assert.equal((await admin.execute({idToken:'synthetic-token',command:close})).ok,true);assert.equal(getterCalls,0);assert.equal(functionCalls,0);
  }finally{
    if(oldObject)Object.defineProperty(Object.prototype,'toJSON',oldObject);else delete Object.prototype.toJSON;
    if(oldArray)Object.defineProperty(Array.prototype,'toJSON',oldArray);else delete Array.prototype.toJSON;
  }
});

test('an inherited approved module cannot substitute for a different own canonical module during replay',()=>{
  const value=copy(claim(tenant()).next);value.grants['partner-uid'].profile.modules={qc:true};const old=Object.getOwnPropertyDescriptor(Object.prototype,'jahit');
  try{Object.defineProperty(Object.prototype,'jahit',{configurable:true,value:true});assert.equal(validate(value),value.enrollmentRegistry);denies(()=>claim(value),'access_denied');}
  finally{if(old)Object.defineProperty(Object.prototype,'jahit',old);else delete Object.prototype.jahit;}
});

test('optional inherited fields cannot supply registry, claim, quota or worker binding and their getters remain unread',()=>{
  const value=tenant(),who=identity(NOW,{uid:'qc-uid',email:QC_EMAIL,googleSubject:'google-qc-1'}),absent=tenant(),qcOnly=tenant();delete absent.enrollmentRegistry;qcOnly.products={};qcOnly.enrollmentRegistry.approvals={'approval-q':qcOnly.enrollmentRegistry.approvals['approval-q']};
  const keys=['claim','admission','enrollmentRegistry'],saved=keys.map(key=>[key,Object.getOwnPropertyDescriptor(Object.prototype,key)]);let reads=0;
  try{
    for(const key of keys)Object.defineProperty(Object.prototype,key,{configurable:true,get(){reads++;throw Error('inherited optional getter must not run');}});
    assert.equal(validate(value),value.enrollmentRegistry);const result=claim(value,who);assert.equal(Object.hasOwn(result.next.grants['qc-uid'].profile,'workerId'),false);assert.equal(result.next.enrollmentRegistry.approvals['approval-q'].admission.count,1);
    denies(()=>claim(absent,who),'access_denied');assert.equal(Adapter.validateCanonicalTenant(absent,{projectId:PROJECT,tenantId:TENANT}),absent);assert.equal(reads,0);
  }finally{for(const [key,descriptor]of saved){if(descriptor)Object.defineProperty(Object.prototype,key,descriptor);else delete Object.prototype[key];}}
  // Isolate absent wage binding from Authority.firebaseShape's preexisting
  // fresh-object writes for an actual assignment.workerId. That codec does not
  // promise support for an inherited getter-only workerId property.
  const workerDescriptor=Object.getOwnPropertyDescriptor(Object.prototype,'workerId');
  try{Object.defineProperty(Object.prototype,'workerId',{configurable:true,get(){reads++;throw Error('inherited wage binding getter must not run');}});assert.equal(validate(qcOnly),qcOnly.enrollmentRegistry);const result=claim(qcOnly,who);assert.equal(Object.hasOwn(result.next.grants['qc-uid'].profile,'workerId'),false);assert.equal(reads,0);}
  finally{if(workerDescriptor)Object.defineProperty(Object.prototype,'workerId',workerDescriptor);else delete Object.prototype.workerId;}
});

test('session and command adapter validate private registry but never return it to the caller',async()=>{
  const f=fixture(withLedgers(tenant())),before=copy(f.store.value),service=Session.createProductionSessionService(f.options),response=await service.execute({idToken:'synthetic-token'});
  assert.equal(response.ok,true);for(const field of ['enrollmentRegistry','approvals',EMAIL,QC_EMAIL,'googleSubject'])assert.equal(JSON.stringify(response).includes(field),false);assert.deepEqual(f.store.value,before);
  const adapter=Adapter.createProductionTenantAdapter(f.options);const grant=await adapter.repository.readGrant({projectId:PROJECT,uid:'owner-1'});assert.deepEqual(grant,{projectId:PROJECT,uid:'owner-1',...before.grants['owner-1']});
  f.store.value.enrollmentRegistry.approvals['approval-1'].reviewed=false;assert.deepEqual(await service.execute({idToken:'synthetic-token'}),{ok:false,error:'not_ready'});await assert.rejects(adapter.repository.readGrant({projectId:PROJECT,uid:'owner-1'}),Authority.AuthorityError);
});

test('owner admin preserves private registry while closing cycles and denies worker rebinding',async()=>{
  const f=fixture(withLedgers(copy(claim(tenant()).next))),service=Admin.createProductionTenantAdmin(f.options),registryBefore=copy(f.store.value.enrollmentRegistry);
  const close={kind:'setConfig',productId:'product-1',cycleId:'cycle-1',expectedRevision:1,config:{active:false,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'}};
  assert.equal((await service.execute({idToken:'synthetic-token',command:close})).ok,true);assert.deepEqual(f.store.value.enrollmentRegistry,registryBefore);assert.equal(f.stats.writes,1);
  const before=copy(f.store.value),rebind={kind:'setGrant',uid:'partner-uid',expectedRevision:1,profile:{active:true,owner:false,workerId:'worker-2',modules:{jahit:true}}};
  assert.deepEqual(await service.execute({idToken:'synthetic-token',command:rebind}),{ok:false,error:'not_ready'});assert.deepEqual(f.store.value,before);assert.equal(f.stats.writes,1);
  const revoke={kind:'setGrant',uid:'partner-uid',expectedRevision:1,profile:{active:false,owner:false,workerId:'worker-1',modules:{jahit:true}}};assert.equal((await service.execute({idToken:'synthetic-token',command:revoke})).ok,true);assert.deepEqual(f.store.value.enrollmentRegistry,registryBefore);denies(()=>claim(f.store.value),'access_denied');
});
