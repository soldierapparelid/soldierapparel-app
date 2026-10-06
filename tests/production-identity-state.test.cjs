'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const State=require('../server/production-identity-state.cjs');
const Initial=require('../server/production-identity-tenant.cjs');
const Registry=require('../server/production-enrollment-registry.cjs');
const Adapter=require('../server/production-tenant-adapter.cjs');
const F=require('./fixtures/identity-tenant.cjs');
const validate=v=>State.validateIdentityTenant(v,{projectId:F.PROJECT,tenantId:F.TENANT});
const denies=(fn,code)=>assert.throws(fn,e=>e instanceof State.IdentityStateError&&e.message===e.code&&(!code||e.code===code));

test('identity v2 works with the original owner-only candidate and detached immutable output',()=>{
  const value=F.tenant();delete value.enrollmentRegistry;const before=F.copy(value),result=validate(value);
  assert.deepEqual(result,before);assert.notEqual(result,value);assert.ok(Object.isFrozen(result.workerCatalog.workers));
  Initial.validateInitialIdentityTenant(result,{projectId:F.PROJECT,tenantId:F.TENANT});assert.deepEqual(value,before);
});
test('registry structural inspection adds no grant, membership or v1 normalization',()=>{
  const value=F.tenant(),entries=Registry.inspectEnrollmentRegistry(value.enrollmentRegistry);
  assert.equal(entries.length,2);assert.ok(Object.isFrozen(entries[0][1].profile));assert.equal(Registry.inspectEnrollmentRegistry(undefined),null);
  assert.throws(()=>Adapter.validateCanonicalTenant(value,{projectId:F.PROJECT,tenantId:F.TENANT}));
  assert.throws(()=>Initial.validateInitialIdentityTenant(value,{projectId:F.PROJECT,tenantId:F.TENANT}));
});
test('sewing claim uses the catalog without fabricating a product, cycle, tariff or money',()=>{
  const value=F.tenant(),before=F.copy(value),result=State.claimIdentityEnrollment(value,F.identity(),F.NOW);
  assert.equal(result.replayed,false);assert.equal(result.approvalId,'approval-1');assert.equal(result.grantRevision,1);
  assert.deepEqual(result.next.grants['partner-1'],{revision:1,profile:before.enrollmentRegistry.approvals['approval-1'].profile});
  assert.deepEqual(result.next.initialization,before.initialization);assert.deepEqual(result.next.workerCatalog,before.workerCatalog);
  assert.deepEqual(result.next.enrollmentRegistry.approvals['approval-q'],before.enrollmentRegistry.approvals['approval-q']);
  assert.deepEqual(Object.keys(result.next).sort(),Object.keys(value).sort());assert.deepEqual(value,before);validate(result.next);
});
test('QC receives only QC and has no wage worker binding',()=>{
  const result=State.claimIdentityEnrollment(F.tenant(),F.identity({uid:'quality-1',email:F.QC_EMAIL,googleSubject:'2000123456789'}),F.NOW);
  assert.deepEqual(result.next.grants['quality-1'],{revision:1,profile:{active:true,owner:false,modules:{qc:true}}});validate(result.next);
});
test('retained exact UID and Google subject win over changed email after a claim',()=>{
  const value=F.claimed(),result=State.claimIdentityEnrollment(value,F.identity({email:'newsynthetic@gmail.com'}),F.NOW);
  assert.equal(result.replayed,true);assert.deepEqual(result.next.grants,value.grants);assert.equal(result.next.enrollmentRegistry.approvals['approval-1'].revision,3);
  for(const changes of [{uid:'other-uid'},{googleSubject:'other-subject'},{uid:'quality-1',email:F.QC_EMAIL}])denies(()=>State.claimIdentityEnrollment(value,F.identity(changes),F.NOW),'access_denied');
});
test('first enrollment requires exact email, reviewed catalog and sole immutable owner',()=>{
  denies(()=>State.claimIdentityEnrollment(F.tenant(),F.identity({email:'unknownsynthetic@gmail.com'}),F.NOW),'access_denied');
  const changes=[v=>{delete v.grants['owner-1'];},v=>{v.grants['owner-1'].revision=2;},v=>{v.grants['owner-1'].profile.active=false;},v=>{v.grants['owner-1'].profile.modules={jahit:true};},v=>{v.initialization.ownerUid='other-owner';},v=>{v.workerCatalog.revision=2;},v=>{delete v.workerCatalog.workers['worker-1'];},v=>{v.workerCatalog.workers['worker-1'].division='potong';},v=>{v.enrollmentRegistry.approvals['approval-1'].profile.modules={potong:true};}];
  for(const change of changes){const v=F.tenant();change(v);denies(()=>validate(v));}
});
test('initial time window and five-minute identity freshness remain independent',()=>{
  for(const changes of [{authTimeMs:Date.parse(F.NOW)-300001},{issuedAtMs:Date.parse(F.NOW)+1},{expiresAtMs:Date.parse(F.NOW)},{verifiedAt:F.AFTER},{verifiedAt:F.BEFORE},{projectId:'demo-wrong-identity'}])denies(()=>State.claimIdentityEnrollment(F.tenant(),F.identity(changes),F.NOW),'access_denied');
  for(const now of [F.INITIAL,F.AFTER]){const ms=Date.parse(now);denies(()=>State.claimIdentityEnrollment(F.tenant(),F.identity({authTimeMs:ms-1000,issuedAtMs:ms-1000,expiresAtMs:ms+3600000,verifiedAt:now}),now),'access_denied');}
});
test('durable admission permits eight attempts per minute and never advances a grant on replay',()=>{
  let value=F.tenant();for(let i=0;i<8;i++)value=State.claimIdentityEnrollment(value,F.identity(),F.NOW).next;
  assert.equal(value.grants['partner-1'].revision,1);assert.equal(value.enrollmentRegistry.approvals['approval-1'].admission.count,8);
  denies(()=>State.claimIdentityEnrollment(value,F.identity(),F.NOW),'rate_limited');
  const now='2026-10-06T03:01:00.000Z',ms=Date.parse(now);value=State.claimIdentityEnrollment(value,F.identity({authTimeMs:ms-1000,issuedAtMs:ms-1000,verifiedAt:now}),now).next;
  assert.equal(value.enrollmentRegistry.approvals['approval-1'].admission.count,1);assert.equal(value.grants['partner-1'].revision,1);
});
test('identity-only state rejects production, tariffs, ledgers, aliases and money fields',()=>{
  for(const [key,field]of Object.entries({products:{},ownerCommandLedger:{},tariffCommandLedger:{},rates:{},money:1,byEmail:{},identityCommandLedger:{}})){const v=F.tenant();v[key]=field;denies(()=>validate(v));}
  const v=F.tenant();v.schemaVersion=1;denies(()=>validate(v));denies(()=>State.validateIdentityTenant(F.tenant(),{projectId:'demo-wrong-identity',tenantId:F.TENANT}));
});
test('orphan, forged active, mixed, duplicate UID, subject, email and worker grants fail closed',()=>{
  const changes=[v=>{v.grants.orphan={revision:1,profile:{active:true,owner:false,modules:{qc:true}}};},v=>{v.grants['partner-1'].revision=2;},v=>{v.grants['partner-1'].profile.active=false;},v=>{v.grants['partner-1'].profile.owner=true;},v=>{v.grants['partner-1'].profile.modules.qc=true;},v=>{v.grants['partner-1'].profile.workerId='worker-2';},v=>{v.enrollmentRegistry.approvals['approval-q']=F.copy(v.enrollmentRegistry.approvals['approval-1']);},v=>{v.enrollmentRegistry.approvals['approval-q'].email=F.EMAIL;},v=>{v.enrollmentRegistry.approvals['approval-q'].profile=F.copy(v.enrollmentRegistry.approvals['approval-1'].profile);}];
  for(const change of changes){const v=F.copy(F.claimed());change(v);denies(()=>validate(v));}
});
test('numeric storage map keys are rejected while numeric Google subjects remain valid',()=>{
  for(const change of [v=>{v.grants['0']=v.grants['owner-1'];delete v.grants['owner-1'];v.initialization.ownerUid='0';},v=>{v.workerCatalog.workers['0']=v.workerCatalog.workers['worker-1'];delete v.workerCatalog.workers['worker-1'];},v=>{v.enrollmentRegistry.approvals['0']=v.enrollmentRegistry.approvals['approval-1'];delete v.enrollmentRegistry.approvals['approval-1'];}]){const v=F.tenant();change(v);denies(()=>validate(v));}
  denies(()=>State.claimIdentityEnrollment(F.tenant(),F.identity({uid:'0'}),F.NOW));assert.equal(F.claimed().enrollmentRegistry.approvals['approval-1'].claim.googleSubject,'1000123456789');
});
test('claimed revocation retains identity and approval, disables grant and advances revision once',()=>{
  const value=F.claimed(),before=F.copy(value),result=State.revokeIdentityEnrollment(value,F.revokeCommand(),F.NOW);
  assert.equal(result.replayed,false);assert.equal(result.approvalRevision,3);assert.equal(result.grantRevision,2);
  assert.deepEqual(result.next.enrollmentRegistry.approvals['approval-1'].claim,before.enrollmentRegistry.approvals['approval-1'].claim);
  assert.equal(result.next.grants['partner-1'].profile.active,false);assert.deepEqual(value,before);
  assert.deepEqual(result.next.initialization,before.initialization);assert.deepEqual(result.next.workerCatalog,before.workerCatalog);validate(result.next);
  denies(()=>State.claimIdentityEnrollment(result.next,F.identity(),F.NOW),'access_denied');
});
test('lost acknowledgment resolves only through the same retained command and expected revisions',()=>{
  const first=State.revokeIdentityEnrollment(F.claimed(),F.revokeCommand(),F.NOW),before=F.copy(first.next);
  const replay=State.revokeIdentityEnrollment(first.next,F.revokeCommand(),F.NOW);assert.equal(replay.replayed,true);assert.deepEqual(replay.next,before);
  for(const changes of [{requestId:'other-revoke'},{expectedApprovalRevision:3},{expectedGrantRevision:2}])denies(()=>State.revokeIdentityEnrollment(first.next,F.revokeCommand(changes),F.NOW),'conflict');
});
test('pending approval revocation grants no access and requires no grant revision',()=>{
  const command={requestId:'pending-revoke',approvalId:'approval-1',expectedApprovalRevision:1},value=F.tenant(),result=State.revokeIdentityEnrollment(value,command,F.NOW);
  assert.deepEqual(result.next.grants,value.grants);assert.equal(Object.hasOwn(result,'grantRevision'),false);assert.equal(Object.hasOwn(result.next.enrollmentRegistry.approvals['approval-1'],'claim'),false);
  assert.equal(State.revokeIdentityEnrollment(result.next,command,F.NOW).replayed,true);denies(()=>State.claimIdentityEnrollment(result.next,F.identity(),F.NOW),'access_denied');
});
test('revocation never trusts caller roles, selectors, unexpected revisions or request-ID reuse',()=>{
  const value=F.claimed();for(const changes of [{owner:true},{profile:{owner:true}},{uid:'partner-1'},{expectedApprovalRevision:1},{expectedGrantRevision:2},{approvalId:'unknown'}])denies(()=>State.revokeIdentityEnrollment(value,F.revokeCommand(changes),F.NOW));
  const missing=F.revokeCommand();delete missing.expectedGrantRevision;denies(()=>State.revokeIdentityEnrollment(value,missing,F.NOW),'invalid_request');
  const revoked=State.revokeIdentityEnrollment(value,F.revokeCommand(),F.NOW).next;
  denies(()=>State.revokeIdentityEnrollment(revoked,{requestId:'revoke-1',approvalId:'approval-q',expectedApprovalRevision:1},F.NOW),'conflict');
});
test('revocation receipts cannot resurrect, delete identities or change reserved workers',()=>{
  const revoked=State.revokeIdentityEnrollment(F.claimed(),F.revokeCommand(),F.NOW).next;
  const changes=[v=>{delete v.enrollmentRegistry.approvals['approval-1'].revocation;},v=>{v.enrollmentRegistry.approvals['approval-1'].status='claimed';},v=>{v.grants['partner-1'].profile.active=true;},v=>{v.grants['partner-1'].revision=1;},v=>{delete v.enrollmentRegistry.approvals['approval-1'].claim;},v=>{delete v.grants['partner-1'];},v=>{v.enrollmentRegistry.approvals['approval-1'].revocation.approvalRevision=9;},v=>{v.enrollmentRegistry.approvals['approval-1'].revocation.grantRevision=2;},v=>{v.enrollmentRegistry.approvals['approval-1'].revocation.privateText='forbidden';}];
  for(const change of changes){const v=F.copy(revoked);change(v);denies(()=>validate(v));}
});
test('structural reads and transitions never invoke account getters or JSON hooks',()=>{
  let calls=0;const value=F.tenant();Object.defineProperty(value,'projectId',{enumerable:true,get(){calls++;throw Error('private');}});
  for(const fn of [()=>validate(value),()=>State.lookupIdentityEnrollment(value,F.identity()),()=>State.claimIdentityEnrollment(value,F.identity(),F.NOW),()=>State.revokeIdentityEnrollment(value,F.revokeCommand(),F.NOW)])denies(fn);
  assert.equal(calls,0);const hook=F.tenant();hook.toJSON=()=>{calls++;throw Error('private');};denies(()=>validate(hook));assert.equal(calls,0);
});
test('non-enumerable, reserved, symbolic, prototype, sparse, cyclic and nonfinite inputs are denied',()=>{
  for(const change of [v=>Object.defineProperty(v,'hidden',{value:1}),v=>{v[Symbol('hidden')]=1;},v=>Object.setPrototypeOf(v,{secret:true}),v=>{v.extra=v;},v=>{v.extra=[,1];},v=>{v.extra=NaN;},v=>{v.extra=-0;},v=>Object.defineProperty(v,'__proto__',{value:1,enumerable:true})]){const v=F.tenant();change(v);denies(()=>validate(v));}
});
test('capacity bounds reject hostile oversized and deep input before any transition',()=>{
  const v=F.tenant();v.extra='x'.repeat(State.MAX_BYTES);denies(()=>validate(v),'capacity_limit');
  const deep=F.tenant();deep.extra={};let p=deep.extra;for(let i=0;i<20;i++){p.next={};p=p.next;}denies(()=>validate(deep),'capacity_limit');
});
test('hostile proxy errors cannot leak through accepted error codes or messages',()=>{
  const fake=Object.create(State.IdentityStateError.prototype);Object.defineProperty(fake,'code',{get(){throw Error('private');}});
  const value=new Proxy(F.tenant(),{ownKeys(){throw fake;}});denies(()=>validate(value),'not_ready');
});
test('unknown worker, UID and approval lookups cannot invoke an inherited map property',()=>{
  const value=F.claimed(),unknown=F.copy(value);unknown.enrollmentRegistry.approvals['approval-1'].profile.workerId='inherited-map-key';unknown.grants['partner-1'].profile.workerId='inherited-map-key';
  const previous=Object.getOwnPropertyDescriptor(Object.prototype,'inherited-map-key');let calls=0;
  try{Object.defineProperty(Object.prototype,'inherited-map-key',{configurable:true,get(){calls++;throw Error('private');}});
    denies(()=>validate(unknown));denies(()=>State.readIdentityGrant(value,{uid:'inherited-map-key',googleSubject:'synthetic-subject'}),'access_denied');
    denies(()=>State.revokeIdentityEnrollment(value,F.revokeCommand({approvalId:'inherited-map-key'}),F.NOW),'access_denied');
  }finally{if(previous)Object.defineProperty(Object.prototype,'inherited-map-key',previous);else delete Object.prototype['inherited-map-key'];}
  assert.equal(calls,0);
});
