'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createIdentityMappingPreflight,limits}=require('../security/production-identity-mapping-preflight.cjs');
const PROJECT='demo-identity-review',URL='https://'+PROJECT+'.firebaseio.com',TENANT='synthetic-tenant',NOW='2026-10-06T02:00:00.000Z';
const OPTIONS={enabled:true,projectId:PROJECT,databaseURL:URL,tenantId:TENANT};
function fixture(){return {
  schemaVersion:1,scope:{projectId:PROJECT,databaseURL:URL,tenantId:TENANT},
  source:{snapshotSha256:'a'.repeat(64),exportedAt:'2026-10-05T00:00:00.000Z',sourceSchemaVersion:'legacy-production-v1'},review:{reviewedAt:NOW},
  legacyWorkers:[{workerId:'legacy-jahit-1',division:'jahit'}],canonicalWorkers:[{workerId:'canonical-jahit-1',division:'jahit'}],
  workerMappings:[{legacyWorkerId:'legacy-jahit-1',canonicalWorkerId:'canonical-jahit-1'}],
  authObservations:[{uid:'owner-observed-1',projectId:PROJECT,provider:'google.com',emailVerified:true,observedAt:'2026-10-05T01:00:00.000Z'},{uid:'partner-observed-1',projectId:PROJECT,provider:'google.com',emailVerified:true,observedAt:NOW}],
  proposedProfiles:[{uid:'owner-observed-1',reviewed:true,profile:{active:true,owner:true}},{uid:'partner-observed-1',reviewed:true,profile:{active:true,owner:false,workerId:'canonical-jahit-1',modules:{jahit:true}}}],pendingWorkers:[]
};}
function inspect(value=fixture(),options=OPTIONS){return createIdentityMappingPreflight(options).inspect(value);}
function blocked(value,code){const response=inspect(value);assert.equal(response.status,'blocked');if(code)assert.ok(response.issues[code],code);assert.equal(response.readyForProduction,false);assert.equal(response.liveAuthProven,false);assert.equal(response.authorizationGranted,false);return response;}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function assertPrivate(response,value){const serialized=JSON.stringify(response);for(const privateValue of [PROJECT,URL,TENANT,value.source.snapshotSha256,value.source.sourceSchemaVersion,value.source.exportedAt,value.review.reviewedAt,...value.legacyWorkers.map(r=>r.workerId),...value.canonicalWorkers.map(r=>r.workerId),...value.authObservations.map(r=>r.uid)])assert.equal(serialized.includes(privateValue),false,privateValue);}

test('successful explicit matching returns exact sanitized immutable review results with no authority claims',()=>{
  const value=fixture(),response=inspect(value);
  assert.deepEqual(response,{status:'reviewed_mapping',readyForProduction:false,liveAuthProven:false,authorizationGranted:false,counts:{legacyWorkers:1,canonicalWorkers:1,workerMappings:1,authObservations:2,proposedProfiles:2,activeOwners:1,activePartners:1,pendingCuttingWorkers:0},issues:{}});
  assertPrivate(response,value);assert.equal(Object.isFrozen(response),true);assert.equal(Object.isFrozen(response.counts),true);assert.equal(Object.isFrozen(response.issues),true);
});
test('default OFF never reads input or option getters, allocates no binding and makes no imports',()=>{
  let reads=0;const value={get scope(){reads++;throw Error('synthetic-private-value');}},options={get projectId(){reads++;throw Error();},get enabled(){reads++;return true;}};
  for(const factory of [createIdentityMappingPreflight(),createIdentityMappingPreflight({enabled:false,get projectId(){reads++;throw Error();}}),createIdentityMappingPreflight(options)])assert.deepEqual(factory.inspect(value),{status:'disabled',readyForProduction:false,liveAuthProven:false,authorizationGranted:false,counts:{legacyWorkers:0,canonicalWorkers:0,workerMappings:0,authObservations:0,proposedProfiles:0,activeOwners:0,activePartners:0,pendingCuttingWorkers:0},issues:{}});
  assert.equal(reads,0);const source=fs.readFileSync(require.resolve('../security/production-identity-mapping-preflight.cjs'),'utf8');assert.doesNotMatch(source,/\brequire\s*\(|\bimport\s*\(|\bfetch\s*\(|process\.(?:env|argv)|console\./);
});
test('enabled factory validates own-data fixed configuration without invoking getters',()=>{
  let reads=0;const options={...OPTIONS};Object.defineProperty(options,'projectId',{enumerable:true,get(){reads++;throw Error();}});
  assert.deepEqual(inspect(fixture(),options).issues,{invalid_configuration:1});assert.equal(reads,0);
  for(const patch of [{enabled:'true'},{enabled:1}])assert.equal(inspect(fixture(),{...OPTIONS,...patch}).status,'disabled');
  for(const patch of [{projectId:'bad'},{tenantId:'unsafe/path'},{databaseURL:URL+'/'},{databaseURL:'http://localhost:9000'},{databaseURL:'https://user:pass@'+PROJECT+'.firebaseio.com'},{databaseURL:URL+'?auth=synthetic'},{databaseURL:URL+'#synthetic'},{databaseURL:URL+':443'},{other:true}])assert.deepEqual(inspect(fixture(),{...OPTIONS,...patch}).issues,{invalid_configuration:1});
});
test('factory binding is copied once and cannot be changed by mutation of caller options',()=>{
  const options={...OPTIONS},factory=createIdentityMappingPreflight(options);options.projectId='demo-another-project';options.tenantId='another';options.databaseURL='https://another.firebaseio.com';assert.equal(factory.inspect(fixture()).status,'reviewed_mapping');
});
test('all fixed scope fields must match without URL normalization or cross-project fallback',()=>{
  for(const [key,value]of [['projectId','demo-other-project'],['tenantId','other-tenant'],['databaseURL',URL+'/'],['databaseURL','https://other.firebaseio.com']]){const f=fixture();f.scope[key]=value;blocked(f,'scope_mismatch');}
});
test('source evidence requires explicit lowercase hash, canonical calendar timestamp and source schema tag',()=>{
  for(const patch of [{snapshotSha256:'A'.repeat(64)},{snapshotSha256:'a'.repeat(63)},{exportedAt:'2026-02-30T00:00:00.000Z'},{exportedAt:'2026-10-05T00:00:00Z'},{sourceSchemaVersion:''},{sourceSchemaVersion:1},{sourceSchemaVersion:'legacy/schema'}]){const f=fixture();Object.assign(f.source,patch);blocked(f,'invalid_source_evidence');}
});
test('declared source and observation chronology is monotonic but does not claim freshness',()=>{
  let f=fixture();f.source.exportedAt='2026-10-07T00:00:00.000Z';blocked(f,'source_after_review');
  f=fixture();f.authObservations[0].observedAt='2026-10-07T00:00:00.000Z';blocked(f,'observation_after_review');
  f=fixture();f.review.reviewedAt='2026-10-06T02:00:00Z';blocked(f,'invalid_review_timestamp');
  f=fixture();f.source.exportedAt='2000-01-01T00:00:00.000Z';f.authObservations.forEach(r=>{r.observedAt='2000-01-01T00:00:00.000Z';});assert.equal(inspect(f).status,'reviewed_mapping');assert.equal(inspect(f).liveAuthProven,false);
});
test('stable IDs are required; labels, names, indexes, email and absent IDs never become identities',()=>{
  for(const row of [{division:'jahit'},{workerId:1,division:'jahit'},{workerId:'worker.name',division:'jahit'},{workerId:'worker@example.invalid',division:'jahit'},{workerId:'__proto__',division:'jahit'},{workerId:'a'.repeat(129),division:'jahit'},{workerId:'legacy-jahit-1',division:'jahit',nama:'Synthetic private name'}]){const f=fixture();f.legacyWorkers=[row];blocked(f,'invalid_worker_catalog');}
  const f=fixture();f.workerMappings=[{legacyWorkerId:'Synthetic display name',canonicalWorkerId:'canonical-jahit-1'}];blocked(f,'invalid_worker_mapping');
});
test('explicit unique catalogs reject duplicate or conflicting identity rows',()=>{
  let f=fixture();f.legacyWorkers.push({...f.legacyWorkers[0]});blocked(f,'duplicate_legacy_worker');
  f=fixture();f.canonicalWorkers.push({...f.canonicalWorkers[0],division:'potong'});blocked(f,'duplicate_canonical_worker');
});
test('one-to-one mappings reject exact duplicates and ambiguous source or destination identities',()=>{
  for(const mapping of [{legacyWorkerId:'legacy-jahit-1',canonicalWorkerId:'canonical-jahit-1'},{legacyWorkerId:'legacy-jahit-1',canonicalWorkerId:'canonical-jahit-2'},{legacyWorkerId:'legacy-jahit-2',canonicalWorkerId:'canonical-jahit-1'}]){const f=fixture();f.workerMappings.push(mapping);blocked(f,'ambiguous_worker_mapping');}
});
test('mapping requires both catalog members and matching explicit division',()=>{
  let f=fixture();f.workerMappings[0].legacyWorkerId='missing-source';blocked(f,'unknown_legacy_worker');
  f=fixture();f.workerMappings[0].canonicalWorkerId='missing-target';blocked(f,'unknown_canonical_worker');
  f=fixture();f.canonicalWorkers[0].division='potong';blocked(f,'division_mismatch');
});
test('unmapped workers and unbound canonical identities remain blocked',()=>{
  let f=fixture();f.workerMappings=[];blocked(f,'missing_worker_mapping');
  f=fixture();f.canonicalWorkers.push({workerId:'canonical-jahit-2',division:'jahit'});blocked(f,'unmapped_canonical_worker');
  f=fixture();f.proposedProfiles.pop();f.authObservations.pop();blocked(f,'unbound_canonical_worker');
});
test('pending cutting needs an explicit stable source ID and remains ungranted without target or UID invention',()=>{
  const f=fixture();f.legacyWorkers.push({workerId:'legacy-potong-1',division:'potong'});f.pendingWorkers.push({legacyWorkerId:'legacy-potong-1',division:'potong'});
  const before=structuredClone(f),response=inspect(f);assert.equal(response.status,'pending');assert.equal(response.counts.pendingCuttingWorkers,1);assert.deepEqual(response.issues,{pending_cutting_identity:1});assert.equal(response.authorizationGranted,false);assertPrivate(response,f);assert.deepEqual(f,before);
});
test('pending declaration cannot hide a sewing worker, missing ID, duplicate or canonical mapping',()=>{
  for(const pending of [{legacyWorkerId:'legacy-jahit-1',division:'potong'},{legacyWorkerId:'missing-cutting',division:'potong'},{legacyWorkerId:'legacy-jahit-1',division:'jahit'},{division:'potong'}]){const f=fixture();f.pendingWorkers.push(pending);blocked(f,'invalid_pending_worker');}
  let f=fixture();f.legacyWorkers.push({workerId:'legacy-potong-1',division:'potong'});f.pendingWorkers=[{legacyWorkerId:'legacy-potong-1',division:'potong'},{legacyWorkerId:'legacy-potong-1',division:'potong'}];blocked(f,'duplicate_pending_worker');
  f=fixture();f.legacyWorkers[0].division='potong';f.canonicalWorkers[0].division='potong';f.proposedProfiles[1].profile.modules={potong:true};f.pendingWorkers=[{legacyWorkerId:'legacy-jahit-1',division:'potong'}];blocked(f,'pending_worker_mapping_conflict');
});
test('only exact Google verified observation metadata in the fixed project is accepted',()=>{
  for(const patch of [{provider:'password'},{emailVerified:false},{emailVerified:'true'},{uid:''},{uid:'worker@example.invalid'},{observedAt:'2026-02-30T00:00:00.000Z'},{idToken:'synthetic-token-private'},{email:'synthetic@example.invalid'}]){const f=fixture();Object.assign(f.authObservations[0],patch);blocked(f,'invalid_auth_observation');}
  const f=fixture();f.authObservations[0].projectId='demo-other-project';blocked(f,'observation_scope_mismatch');
});
test('duplicate UID observations and duplicate proposed profiles never resolve by array order',()=>{
  let f=fixture();f.authObservations.push({...f.authObservations[0]});blocked(f,'duplicate_observed_uid');
  f=fixture();f.proposedProfiles.push(structuredClone(f.proposedProfiles[0]));blocked(f,'duplicate_profile_uid');
});
test('each proposed UID needs explicit observation and each observation needs an explicit reviewed profile',()=>{
  let f=fixture();f.authObservations.pop();blocked(f,'missing_auth_observation');
  f=fixture();f.proposedProfiles.pop();blocked(f,'unbound_auth_observation');
  f=fixture();f.proposedProfiles[0].reviewed=false;blocked(f,'invalid_proposed_profile');
});
test('an explicitly reviewed active owner observation is mandatory, including incomplete zero-observation review',()=>{
  for(const mutate of [f=>{f.proposedProfiles[0].profile.active=false;},f=>{f.proposedProfiles[0].profile.owner=false;},f=>{f.authObservations=[];f.proposedProfiles=[];}]){const f=fixture();mutate(f);blocked(f,'missing_owner');}
});
test('wrong-project or post-review owner observations never count as a reviewed owner',()=>{
  for(const patch of [{projectId:'demo-other-project'},{observedAt:'2026-10-07T00:00:00.000Z'}]){const f=fixture();Object.assign(f.authObservations[0],patch);const response=blocked(f,'missing_owner');assert.equal(response.counts.activeOwners,0);}
});
test('partner bindings use canonical worker IDs and division rather than submitted worker labels',()=>{
  let f=fixture();delete f.proposedProfiles[1].profile.workerId;blocked(f,'missing_partner_binding');
  f=fixture();f.proposedProfiles[1].profile.workerId='legacy-jahit-1';blocked(f,'profile_worker_missing');
  f=fixture();f.proposedProfiles[1].profile.modules={jahit:true,potong:true};blocked(f,'division_mismatch');
});
test('two accounts cannot ambiguously propose the same worker identity',()=>{
  const f=fixture();f.authObservations.push({...f.authObservations[1],uid:'another-observed-uid'});f.proposedProfiles.push({...structuredClone(f.proposedProfiles[1]),uid:'another-observed-uid'});blocked(f,'ambiguous_profile_binding');
});
test('profile vocabulary is exact and preserves canonical empty-module omission semantics',()=>{
  for(const patch of [{active:1},{owner:'false'},{modules:{}},{modules:{unsupported:true}},{modules:{jahit:'true'}},{password:'synthetic-private-password'},{email:'synthetic@example.invalid'},{uid:'body-role-uid'},{tariff:123},{workerId:'bad/path'}]){const f=fixture();Object.assign(f.proposedProfiles[1].profile,patch);blocked(f,'invalid_proposed_profile');}
});
test('QC can have no worker binding while an explicitly mapped cutting partner follows the same review contract',()=>{
  const f=fixture();f.legacyWorkers[0].division='potong';f.canonicalWorkers[0].division='potong';f.proposedProfiles[1].profile.modules={potong:true};f.authObservations.push({...f.authObservations[1],uid:'qc-observed-uid'});f.proposedProfiles.push({uid:'qc-observed-uid',reviewed:true,profile:{active:true,owner:false,modules:{qc:true}}});assert.equal(inspect(f).status,'reviewed_mapping');
});
test('frozen input and null-prototype objects remain unchanged after both success and failure',()=>{
  const f=freeze(fixture()),before=JSON.stringify(f);assert.equal(inspect(f).status,'reviewed_mapping');assert.equal(JSON.stringify(f),before);
  const n=fixture();n.scope=Object.assign(Object.create(null),n.scope);n.proposedProfiles[0].profile=Object.assign(Object.create(null),n.proposedProfiles[0].profile);assert.equal(inspect(n).status,'reviewed_mapping');
  const invalid=fixture();invalid.source.snapshotSha256='invalid';freeze(invalid);const prior=JSON.stringify(invalid);blocked(invalid,'invalid_source_evidence');assert.equal(JSON.stringify(invalid),prior);
});
test('all getter locations and inherited fields are rejected without executing the accessor',()=>{
  let reads=0;
  for(const target of ['root','source','catalog','profile']){const f=fixture(),object=target==='root'?f:target==='source'?f.source:target==='catalog'?f.legacyWorkers[0]:f.proposedProfiles[0].profile;Object.defineProperty(object,'privateGetter',{enumerable:true,get(){reads++;throw Error('synthetic-private-getter');}});blocked(f,'invalid_manifest');}
  const f=fixture();f.legacyWorkers[0]=Object.create({workerId:'legacy-jahit-1',division:'jahit'});blocked(f,'invalid_manifest');assert.equal(reads,0);
});
test('inherited Object and Array toJSON getters/functions never run during enabled review or sizing',()=>{
  for(const prototype of [Object.prototype,Array.prototype])for(const kind of ['getter','function']){
    const original=Object.getOwnPropertyDescriptor(prototype,'toJSON');let calls=0,response;
    const hook=()=>{calls++;throw Error('synthetic-private-toJSON-canary');};
    Object.defineProperty(prototype,'toJSON',{configurable:true,...(kind==='getter'?{get:hook}:{value:hook,writable:true})});
    try{response=inspect(fixture());}
    finally{if(original)Object.defineProperty(prototype,'toJSON',original);else delete prototype.toJSON;}
    assert.equal(calls,0,kind);assert.equal(response.status,'reviewed_mapping');assert.equal(JSON.stringify(response).includes('synthetic-private-toJSON-canary'),false);
  }
});
test('shared object aliases are refused just like cycles instead of silently copying a non-JSON graph',()=>{
  const f=fixture();f.proposedProfiles[0].profile.modules=f.proposedProfiles[1].profile.modules;blocked(f,'invalid_manifest');
});
test('absent optional modules and permissions never read inherited getters',()=>{
  const f=fixture();f.authObservations.push({...f.authObservations[1],uid:'observer-only-uid'});f.proposedProfiles.push({uid:'observer-only-uid',reviewed:true,profile:{active:true,owner:false}});
  const keys=['modules','potong'],originals=keys.map(k=>Object.getOwnPropertyDescriptor(Object.prototype,k));let reads=0,response;
  try{for(const key of keys)Object.defineProperty(Object.prototype,key,{configurable:true,get(){reads++;throw Error('synthetic-private-inherited-permission');}});response=inspect(f);}
  finally{keys.forEach((key,i)=>{if(originals[i])Object.defineProperty(Object.prototype,key,originals[i]);else delete Object.prototype[key];});}
  assert.equal(reads,0);assert.equal(response.status,'reviewed_mapping');assert.equal(response.counts.activePartners,1);
});
test('descriptor sizing counts exact UTF8 bytes, quotes and escaping at the 64KiB boundary',()=>{
  let f=fixture();f.source.sourceSchemaVersion='';const base=Buffer.byteLength(JSON.stringify(f),'utf8'),padding=limits.maxBytes-base;
  f.source.sourceSchemaVersion='a'.repeat(padding);assert.equal(Buffer.byteLength(JSON.stringify(f),'utf8'),limits.maxBytes);blocked(f,'invalid_source_evidence');
  f.source.sourceSchemaVersion+='a';assert.equal(Buffer.byteLength(JSON.stringify(f),'utf8'),limits.maxBytes+1);blocked(f,'invalid_manifest');
  for(const [value,code]of [['é'.repeat(30000),'invalid_source_evidence'],['é'.repeat(33000),'invalid_manifest'],['\u0000'.repeat(10000),'invalid_source_evidence'],['\u0000'.repeat(11000),'invalid_manifest']]){f=fixture();f.source.sourceSchemaVersion=value;blocked(f,code);}
});
test('cycles, hostile prototypes, symbols, hidden fields and sparse arrays fail before interpretation',()=>{
  for(const mutate of [f=>{f.review.loop=f;},f=>{f.scope=Object.assign(Object.create({scopeSecret:'synthetic'}),f.scope);},f=>{f.source[Symbol('private')]='synthetic';},f=>{Object.defineProperty(f.source,'hidden',{value:'synthetic'});},f=>{delete f.legacyWorkers[0];},f=>{f.authObservations.extra='synthetic';},f=>{Object.defineProperty(f.source,'__proto__',{value:{},enumerable:true});},f=>{f.source.toJSON=()=>({});}]){const f=fixture();mutate(f);blocked(f,'invalid_manifest');}
});
test('raw root/history/money inputs, unknown fields and JSON strings are refused without private echoes',()=>{
  const canary='synthetic-private-secret-do-not-echo';
  for(const f of [null,{},[],JSON.stringify(fixture()),{soldier:{secret:canary}}, {...fixture(),privateFinance:{password:canary,amount:987654321}},{...fixture(),production:[{id:canary,tariff:987654321}]}]){const response=blocked(f,'invalid_manifest');assert.equal(JSON.stringify(response).includes(canary),false);assert.equal(JSON.stringify(response).includes('987654321'),false);}
});
test('empty catalogs and malformed/non-array collections fail with bounded generic issues',()=>{
  let f=fixture();f.legacyWorkers=[];blocked(f,'missing_legacy_catalog');
  for(const key of ['legacyWorkers','canonicalWorkers','workerMappings','authObservations','proposedProfiles','pendingWorkers']){f=fixture();f[key]={private:'synthetic'};blocked(f,'invalid_collection');}
});
test('row, byte, depth and node limits reject oversized input with no detail leakage',()=>{
  let f=fixture();f.legacyWorkers=Array.from({length:limits.maxRows+1},(_,i)=>({workerId:'synthetic-'+i,division:'jahit'}));blocked(f,'invalid_collection');
  f=fixture();f.source.snapshotSha256='synthetic-private-'+ 'x'.repeat(limits.maxBytes+1);const response=blocked(f);assert.equal(JSON.stringify(response).includes('synthetic-private-'),false);
  f=fixture();let deep=f.review;for(let i=0;i<limits.maxDepth+2;i++){deep.next={};deep=deep.next;}blocked(f,'invalid_manifest');
  f=fixture();f.review.nodes=Array.from({length:limits.maxNodes+1},()=>null);blocked(f,'invalid_manifest');
});
