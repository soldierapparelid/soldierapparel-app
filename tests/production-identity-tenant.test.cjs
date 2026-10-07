'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Identity=require('../server/production-identity-tenant.cjs');
const binding={projectId:'demo-identity-tenant',tenantId:'synthetic-identity-tenant'};
const catalog=()=>({schemaVersion:1,revision:1,reviewed:true,workers:{'synthetic-sewing-worker':{division:'jahit',reviewed:true},'synthetic-cutting-worker':{division:'potong',reviewed:true}}});
const request=()=>({ownerUid:'synthetic-owner',bootstrapId:'synthetic-bootstrap',initializedAt:'2026-01-01T00:00:00.000Z',workerCatalog:catalog()});
const prepare=input=>Identity.createInitialIdentityTenantPreparer({enabled:true,scope:binding}).prepare(input===undefined?request():input);
function tenant(){const result=prepare();assert.equal(result.ok,true);return structuredClone(result.tenant);}
function denied(value,expected){assert.throws(()=>Identity.validateInitialIdentityTenant(value,binding),error=>error instanceof Identity.InitialIdentityTenantError&&(!expected||error.code===expected));}
function prune(value){if(value===null)return undefined;if(value&&typeof value==='object'){const output={};for(const [key,row]of Object.entries(value)){const child=prune(row);if(child!==undefined)output[key]=child;}return Object.keys(output).length?output:undefined;}return value;}

test('source OFF only selects own enabled data and ignores all config/request getters',()=>{
  let calls=0;const options={enabled:false},input={};for(const key of ['scope','clock','database'])Object.defineProperty(options,key,{get(){calls++;throw Error('synthetic-secret');}});for(const key of Object.keys(request()))Object.defineProperty(input,key,{get(){calls++;throw Error('synthetic-secret');}});
  assert.deepEqual(Identity.createInitialIdentityTenantPreparer(options).prepare(input),{ok:false,error:'service_disabled'});assert.deepEqual(Identity.createInitialIdentityTenantPreparer().prepare(input),{ok:false,error:'service_disabled'});
  const enabledGetter={};Object.defineProperty(enabledGetter,'enabled',{get(){calls++;return true;}});assert.deepEqual(Identity.createInitialIdentityTenantPreparer(enabledGetter).prepare(input),{ok:false,error:'service_disabled'});
  assert.deepEqual(Identity.createInitialIdentityTenantPreparer(Object.create({enabled:true})).prepare(input),{ok:false,error:'service_disabled'});assert.equal(calls,0);
});

test('preparer reconstructs exact v2 initial owner constants and honest false readiness',()=>{
  const input=request(),before=structuredClone(input),result=prepare(input),value=result.tenant;
  assert.equal(result.preparedOnly,true);for(const key of ['readyForProduction','authorizationGranted','authProven','grantWritten','migrated'])assert.equal(result[key],false);
  assert.equal(value.schemaVersion,2);assert.deepEqual(Object.keys(value).sort(),['grants','initialization','projectId','schemaVersion','tenantId','workerCatalog']);
  assert.deepEqual(value.grants,{'synthetic-owner':{revision:1,profile:{active:true,owner:true}}});assert.equal(value.initialization.ownerUid,input.ownerUid);assert.equal(value.initialization.ownerGrantRevision,1);assert.equal(value.initialization.kind,'reviewed-identity-only-v1');assert.equal(value.initialization.reviewed,true);assert.deepEqual(input,before);
  assert.equal(Object.hasOwn(value,'products'),false);assert.equal(Object.hasOwn(value,'enrollmentRegistry'),false);assert.equal(Object.hasOwn(value.grants['synthetic-owner'].profile,'workerId'),false);
});

test('validator returns a detached deep frozen copy without freezing or modifying caller data',()=>{
  const value=tenant(),before=structuredClone(value),copied=Identity.validateInitialIdentityTenant(value,binding);
  assert.deepEqual(copied,before);assert.notEqual(copied,value);assert.notEqual(copied.workerCatalog,value.workerCatalog);assert.equal(Object.isFrozen(value),false);assert.equal(Object.isFrozen(value.workerCatalog.workers),false);
  for(const item of [copied,copied.initialization,copied.workerCatalog,copied.workerCatalog.workers,copied.workerCatalog.workers['synthetic-sewing-worker'],copied.grants,copied.grants['synthetic-owner'].profile])assert.equal(Object.isFrozen(item),true);
  value.workerCatalog.workers['synthetic-sewing-worker'].division='potong';value.grants['synthetic-owner'].profile.owner=false;assert.equal(copied.workerCatalog.workers['synthetic-sewing-worker'].division,'jahit');assert.equal(copied.grants['synthetic-owner'].profile.owner,true);
});

test('v1, products, production ledgers, registry and foreign finance fields are forbidden',()=>{
  const old=tenant();old.schemaVersion=1;old.products={};denied(old);
  for(const key of ['products','ownerCommandLedger','tariffCommandLedger','enrollmentRegistry','money','credentials'])for(const content of [null,{},[],'synthetic-secret']){const value=tenant();value[key]=content;denied(value);}
  const missing=tenant();delete missing.workerCatalog;denied(missing);const noOrigin=tenant();delete noOrigin.initialization;denied(noOrigin);
});

test('owner UID/grant/revision/profile are exact, with no nonowner or caller role acceptance',()=>{
  for(const change of [value=>value.grants['synthetic-other']=value.grants['synthetic-owner'],value=>delete value.grants['synthetic-owner'],value=>value.initialization.ownerUid='synthetic-other',value=>value.initialization.ownerGrantRevision=2,value=>value.grants['synthetic-owner'].revision=0,value=>value.grants['synthetic-owner'].revision=2,value=>value.grants['synthetic-owner'].profile.active=false,value=>value.grants['synthetic-owner'].profile.owner=false,value=>value.grants['synthetic-owner'].profile.modules={qc:true},value=>value.grants['synthetic-owner'].profile.workerId='synthetic-sewing-worker']){const value=tenant();change(value);denied(value);}
  for(const key of ['profile','role','grants','registry','products'])assert.equal(prepare({...request(),[key]:{owner:true}}).ok,false);
});

test('initialization discrimination and canonical timestamps require exact reviewed declarations',()=>{
  for(const change of [initial=>initial.schemaVersion=2,initial=>initial.kind='production-prepared',initial=>initial.reviewed=false,initial=>initial.bootstrapId='../bad',initial=>initial.initializedAt='2026-01-01',initial=>initial.initializedAt='2026-02-30T00:00:00.000Z',initial=>initial.initializedAt='2026-01-01T00:00:00Z',initial=>initial.ownerRecord={emailVerified:true},initial=>delete initial.reviewed]){const value=tenant();change(value.initialization);denied(value);}
});

test('catalog identity is nonempty, reviewed and bounded without role/work/rate assertions',()=>{
  for(const change of [value=>value.schemaVersion=2,value=>value.revision=2,value=>value.reviewed=false,value=>value.workers={},value=>value.workers=[],value=>value.workers['synthetic-sewing-worker'].reviewed=false,value=>value.workers['synthetic-sewing-worker'].division='qc',value=>value.workers['synthetic-sewing-worker'].active=true,value=>value.workers['synthetic-sewing-worker'].tariff=3,value=>value.workers['synthetic-sewing-worker'].label='Synthetic',value=>value.workers['synthetic-sewing-worker'].legacyId='synthetic-other']){const input=request();change(input.workerCatalog);assert.equal(prepare(input).ok,false);}
});

test('all-numeric owner/worker storage keys are rejected rather than renamed or coerced',()=>{
  for(const ownerUid of ['0','1','12345','00012'])assert.deepEqual(prepare({...request(),ownerUid}),{ok:false,error:'unsupported_storage_key'});
  for(const workerId of ['0','1','12345','00012']){const input=request();input.workerCatalog.workers[workerId]={division:'jahit',reviewed:true};const before=structuredClone(input);assert.deepEqual(prepare(input),{ok:false,error:'unsupported_storage_key'});assert.deepEqual(input,before);}
  const input=request();input.ownerUid='owner_123';input.workerCatalog.workers={'worker_123':{division:'jahit',reviewed:true}};assert.equal(prepare(input).ok,true);
  const numeric=tenant();numeric.initialization.ownerUid='123';numeric.grants={'123':{revision:1,profile:{active:true,owner:true}}};denied(numeric,'unsupported_storage_key');
});

test('own accessors/symbols/nonenumerable fields fail without getter invocation',()=>{
  let calls=0;for(const mutate of [value=>Object.defineProperty(value,'schemaVersion',{enumerable:true,get(){calls++;return 2;}}),value=>Object.defineProperty(value.initialization,'ownerUid',{enumerable:true,get(){calls++;return 'synthetic-owner';}}),value=>Object.defineProperty(value.workerCatalog.workers,'synthetic-sewing-worker',{enumerable:true,get(){calls++;return {division:'jahit',reviewed:true};}}),value=>Object.defineProperty(value.grants['synthetic-owner'].profile,'owner',{enumerable:true,get(){calls++;return true;}}),value=>Object.defineProperty(value,'hidden',{value:true}),value=>value[Symbol('synthetic')]=true]){const value=tenant();mutate(value);denied(value);}
  const input=request();Object.defineProperty(input,'workerCatalog',{enumerable:true,get(){calls++;throw Error('synthetic-secret');}});assert.equal(prepare(input).ok,false);assert.equal(calls,0);
  const options={enabled:true};Object.defineProperty(options,'scope',{enumerable:true,get(){calls++;return binding;}});assert.deepEqual(Identity.createInitialIdentityTenantPreparer(options).prepare(request()),{ok:false,error:'invalid_configuration'});assert.equal(calls,0);
});

test('prototype, unsafe keys, functions, sparse arrays and cycles cannot cross the JSON boundary',()=>{
  for(const mutate of [value=>Object.setPrototypeOf(value,{synthetic:true}),value=>value.workerCatalog.workers=Object.create({}),value=>value.initialization.bootstrapId=()=>{},value=>value.extra=[,1],value=>value.extra=value,value=>value.workerCatalog.workers['../bad']={division:'jahit',reviewed:true},value=>Object.defineProperty(value.workerCatalog.workers,'__proto__',{value:{division:'jahit',reviewed:true},enumerable:true})]){const value=tenant();mutate(value);denied(value);}
  const value=tenant();value.workerCatalog.workers=Object.assign(Object.create(null),value.workerCatalog.workers);assert.equal(Identity.validateInitialIdentityTenant(value,binding).schemaVersion,2);
});

test('scope and identifier objects never invoke caller coercion hooks',()=>{
  let calls=0;const hostile={toString(){calls++;return 'synthetic-owner';},[Symbol.toPrimitive](){calls++;return 'synthetic-owner';}};
  for(const key of ['ownerUid','bootstrapId','initializedAt'])assert.equal(prepare({...request(),[key]:hostile}).ok,false);
  for(const key of ['projectId','tenantId'])assert.throws(()=>Identity.validateInitialIdentityTenant(tenant(),{...binding,[key]:hostile}));
  for(const key of ['projectId','tenantId']){const value=tenant();value[key]='synthetic-other';denied(value,'scope_mismatch');}assert.equal(calls,0);
});

test('inherited serialization hooks do not run in copy/preparation/validation/freeze',()=>{
  const input=request(),value=tenant(),previousObject=Object.getOwnPropertyDescriptor(Object.prototype,'toJSON'),previousArray=Object.getOwnPropertyDescriptor(Array.prototype,'toJSON');let calls=0,result,validated;
  try{Object.defineProperty(Object.prototype,'toJSON',{configurable:true,get(){calls++;throw Error('synthetic-secret');}});Object.defineProperty(Array.prototype,'toJSON',{configurable:true,value(){calls++;return [];}});result=prepare(input);validated=Identity.validateInitialIdentityTenant(value,binding);}finally{if(previousObject)Object.defineProperty(Object.prototype,'toJSON',previousObject);else delete Object.prototype.toJSON;if(previousArray)Object.defineProperty(Array.prototype,'toJSON',previousArray);else delete Array.prototype.toJSON;}
  assert.equal(calls,0);assert.equal(result.ok,true);assert.equal(validated.schemaVersion,2);
});

test('fixed worker/UTF8 JSON/depth/node budgets reject oversized inputs without partial candidate',()=>{
  const input=request();input.workerCatalog.workers={};for(let index=0;index<Identity.MAX_WORKERS;index++)input.workerCatalog.workers['synthetic-worker-'+index]={division:'jahit',reviewed:true};assert.equal(prepare(input).ok,true);
  input.workerCatalog.workers['synthetic-overflow']={division:'jahit',reviewed:true};assert.deepEqual(prepare(input),{ok:false,error:'capacity_limit'});
  for(const huge of ['x'.repeat(Identity.MAX_BYTES),'\u{1f600}'.repeat(Identity.MAX_BYTES/4)]){const value=tenant();value.foreign=huge;denied(value,'capacity_limit');}
  const deep=tenant();let branch=deep;for(let index=0;index<Identity.MAX_DEPTH+1;index++){branch.foreign={};branch=branch.foreign;}denied(deep,'capacity_limit');
  const many=tenant();many.foreign=Array.from({length:Identity.MAX_NODES},()=>null);denied(many,'capacity_limit');
});

test('modeled RTDB pruning preserves identity-only candidate without product placeholders',()=>{
  const value=tenant(),stored=prune(value);assert.deepEqual(stored,value);assert.deepEqual(Identity.validateInitialIdentityTenant(stored,binding),value);
  const old={schemaVersion:1,projectId:binding.projectId,tenantId:binding.tenantId,grants:value.grants,products:{}};const prunedOld=prune(old);assert.equal(Object.hasOwn(prunedOld,'products'),false);denied(prunedOld);assert.equal(Object.hasOwn(stored,'products'),false);
});

test('preparer copies fixed scope and caller values without new Auth, clock or migration facts',()=>{
  const options={enabled:true,scope:structuredClone(binding)},preparer=Identity.createInitialIdentityTenantPreparer(options),input=request();options.scope.projectId='demo-other';const answer=preparer.prepare(input);assert.equal(answer.tenant.projectId,binding.projectId);input.workerCatalog.workers['synthetic-sewing-worker'].reviewed=false;input.ownerUid='synthetic-other';assert.equal(answer.tenant.initialization.ownerUid,'synthetic-owner');assert.equal(answer.tenant.workerCatalog.workers['synthetic-sewing-worker'].reviewed,true);assert.equal(answer.authProven,false);
  const noTenant=preparer.prepare({...request(),idToken:'synthetic-forbidden'});assert.equal(noTenant.ok,false);assert.equal(Object.hasOwn(noTenant,'tenant'),false);assert.deepEqual(Object.keys(noTenant).sort(),['error','ok']);
});

test('reflection exceptions cannot relay private codes/messages or invoke error accessors',()=>{
  let calls=0;
  for(const variant of ['private_code','getter']){
    const error=new Identity.InitialIdentityTenantError('synthetic-secret-token');
    if(variant==='getter')for(const key of ['code','message'])Object.defineProperty(error,key,{get(){calls++;throw Error('synthetic-secret');}});
    const proxy=new Proxy(request(),{ownKeys(){throw error;}}),answer=prepare(proxy);
    assert.deepEqual(answer,{ok:false,error:'invalid_identity_tenant'});assert.equal(Object.hasOwn(answer,'tenant'),false);
    const candidate=new Proxy(tenant(),{ownKeys(){throw error;}});
    assert.throws(()=>Identity.validateInitialIdentityTenant(candidate,binding),received=>received!==error&&received instanceof Identity.InitialIdentityTenantError&&received.code==='invalid_identity_tenant'&&received.message==='invalid_identity_tenant');
  }
  assert.equal(calls,0);
});
