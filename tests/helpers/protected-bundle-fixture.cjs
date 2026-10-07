'use strict';
// Synthetic generated-graph integration only. No native network or real data.
const vm = require('node:vm'), Crypto = require('node:crypto');
const Builder = require('../../server/apps-script/build-lifecycle-runtime-bundle.cjs');
const { fixture: production, POLICY } = require('../fixtures/legacy-lifecycle.cjs');
const F = require('../fixtures/identity-tenant.cjs');
const KEY = 'SYNTHETIC_PUBLIC_KEY_0000000000000', OAUTH = 'SYNTHETIC_MANAGED_OAUTH';
const encode = v => Buffer.from(JSON.stringify(v)).toString('base64url');
function createProtectedSeed(options = {}) {
  const p = production(), sec = Date.parse(F.NOW) / 1000, identities = { owner: F.identity({ uid: 'owner-1', email: 'syntheticowner@gmail.com', googleSubject: '1000099999999' }), qc: p.qc, jahit: p.partner };
  const credentials = {};
  for (const [division, identity] of Object.entries(identities)) {
    const payload = { sub: identity.uid, aud: F.PROJECT, iss: 'https://securetoken.google.com/' + F.PROJECT, email: identity.email, email_verified: true, firebase: { sign_in_provider: 'google.com', identities: { 'google.com': [identity.googleSubject] } }, auth_time: sec - 1, iat: sec - 1, exp: sec + 3600 };
    credentials[division] = { identity, token: encode({ alg: 'RS256', kid: 'synthetic-key', typ: 'JWT' }) + '.' + encode(payload) + '.' + Buffer.alloc(256, 19).toString('base64url'), account: { localId: identity.uid, email: identity.email, emailVerified: true, disabled: false, validSince: String(sec - 300), providerUserInfo: [{ providerId: 'google.com', rawId: identity.googleSubject, email: identity.email }] } };
  }
  p.root.nullableUnknown = null; p.root.emptyUnknown = {}; p.root.arrayUnknown = [null, {}, []];
  const bytes = 2 * 1024 * 1024;
  const policy = { projectId: F.PROJECT, policyId: 'synthetic-protected-recurring', reviewed: true, startsAt: F.NOW, expiresAt: '2026-11-01T00:00:00.000Z', dayRequestLimit: 128, dayLookupLimit: 1792, dayDownloadLimitBytes: 384 * bytes, monthRequestLimit: 2048, monthLookupLimit: 28672, monthDownloadLimitBytes: 7 * 1024 * 1024 * 1024, burstWindowMs: 60000, burstLimit: 32, ...options.policy };
  return { root: p.root, credentials, binding: { ...p.binding, apiKey: KEY }, tariffPolicy: POLICY, clock: F.NOW, oauth: OAUTH, profileLabels: { 'approval-1': 'Synthetic partner', 'approval-q': 'Synthetic quality' }, policy };
}
// Reusable body for a later isolated Google V8/Utilities proof. Every host is
// supplied explicitly. bytes/etag must remain synthetic local functions; this
// body exposes no doGet/doPost, native global, production URL or real identity.
const fixtureFactorySource = String.raw`
function createProtectedSyntheticFixture(utilities, sourceSeed, bytes, etag) {
  const data = JSON.parse(sourceSeed), modules = SoldierAppsScriptLifecycleRuntime.createModules(utilities);
  const stats = {google:0,reads:0,puts:0,writes:0,oauth:0,propertyWrites:0}, controls = {loseAck:false,conflict:false,denyUid:null,gzip:true,enrollmentEnabled:true,denyProperties:false,loseReservationAck:false,denyLock:false};
  let clock = data.clock, held = false;
  const fixed = {projectId:data.binding.projectId,databaseURL:data.binding.databaseURL,tenantId:data.binding.tenantId};
  const plan = modules.protectedScope.prepareProtectedMigration({root:data.root,binding:fixed,migrationId:'synthetic-protected-migration',expectedRootETag:'"synthetic-original"'});
  if(plan.ok!==true)throw Error('synthetic migration rejected');
  let protectedRoot = JSON.parse(JSON.stringify(plan.nextRoot));
  let saved = modules.recurringAdmission.createRecurringAdmissionSeed(data.policy,modules.protectedScope.MAX_WORKING_BYTES);
  const network = [];
  const properties = {getProperty(key){if(key!==modules.recurringAdmission.PROPERTY_KEY||!held)throw Error('synthetic property scope');return saved;},setProperty(key,value){if(key!==modules.recurringAdmission.PROPERTY_KEY||!held)throw Error('synthetic property scope');if(controls.denyProperties)return properties;saved=value;stats.propertyWrites++;if(controls.loseReservationAck)throw Error('synthetic reservation acknowledgement');return properties;}};
  const lock = {tryLock(){if(held||controls.denyLock)return false;held=true;return true;},hasLock(){return held;},releaseLock(){held=false;}};
  const scope = modules.protectedScope.createProtectedStorageScope({enabled:true,binding:fixed,migration:plan.migration});
  const branch = () => protectedRoot[modules.protectedScope.KEY];
  const tag = () => etag(JSON.stringify(branch().working));
  const response = (status,body,headers) => ({getResponseCode(){return status;},getAllHeaders(){return headers;},getContent(){return Array.from(bytes(body));}});
  // Only metadata and scalar data strings exist on the database wire. Null
  // pruning here models one RTDB normalization hazard without being claimed
  // as a genuine SDK/emulator or HTTP proof.
  function prune(value){if(value===null)return undefined;if(!value||typeof value!=='object')return value;const out={};for(const [key,v]of Object.entries(value)){const n=prune(v);if(n!==undefined)out[key]=n;}return Object.keys(out).length?out:undefined;}
  const host = {fetch(url,p){
    if(held)throw Error('synthetic lock leaked across network');
    if(url==='https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+data.binding.apiKey){
      stats.google++;if(p.method!=='post')throw Error('synthetic Google method');const token=JSON.parse(p.payload).idToken,selected=Object.values(data.credentials).find(v=>v.token===token);if(!selected)throw Error('synthetic token selector');
      return response(200,JSON.stringify({users:[{...selected.account,disabled:controls.denyUid===selected.identity.uid}]}),controls.gzip?{'Content-Type':'application/json','Content-Encoding':'gzip'}:{'Content-Type':'application/json'});
    }
    if(url!==data.binding.databaseURL+modules.protectedScope.PATHS.working+'.json'||p.headers.Authorization!=='Bearer '+data.oauth)throw Error('synthetic fixed working scope');
    network.push({url,method:p.method,payloadBytes:p.payload?bytes(p.payload).length:0,containsPhoto:typeof p.payload==='string'&&p.payload.includes('SYNTHETIC_IMAGE')});
    if(p.method==='get'){stats.reads++;return response(200,JSON.stringify(branch().working),{'Content-Type':'application/json; charset=utf-8',ETag:tag()});}
    if(p.method!=='put')throw Error('synthetic database method');stats.puts++;
    if(controls.conflict||p.headers['If-Match']!==tag())return response(412,'{}',{'Content-Type':'application/json'});
    branch().working=prune(JSON.parse(p.payload));stats.writes++;
    if(controls.loseAck)throw Error('synthetic conditional acknowledgement');
    return response(200,JSON.stringify(branch().working),{'Content-Type':'application/json',ETag:tag()});
  }};
  const script = {getOAuthToken(){stats.oauth++;return data.oauth;}};
  function gate(){return modules.recurringAdmission.createAppsScriptRecurringRequestAdmission({enabled:true,binding:{projectId:data.binding.projectId,policyId:data.policy.policyId},policy:data.policy,maxRootBytes:modules.protectedScope.MAX_WORKING_BYTES,scriptLock:lock,scriptProperties:properties,clock:()=>clock});}
  function identityAdmission(division,value){const who=data.credentials[division].identity;return ['projectId','uid','email','googleSubject'].every(key=>value[key]===who[key]);}
  function runtimeOptions(division){return {enabled:true,binding:data.binding,urlFetchApp:host,scriptApp:script,clock:()=>clock,requestAdmission:gate().admit,identityAdmission:value=>identityAdmission(division,value),storageMigration:plan.migration};}
  function create(division='qc'){return modules.runtime.createAppsScriptLegacyLifecycleRuntime({...runtimeOptions(division),enrollmentEnabled:controls.enrollmentEnabled,tariffPolicy:data.tariffPolicy});}
  function gateway(division='qc'){return modules.rpc.createAppsScriptLifecycleRpcGateway({enabled:true,binding:fixed,runtime:create(division)});}
  function ownerGateway(){return modules.ownerRpc.createAppsScriptOwnerLifecycleRpcGateway({enabled:true,binding:fixed,runtime:create('owner')});}
  function ownerAccess(division='owner'){return modules.ownerAccess.createAppsScriptOwnerAccessManagementRuntime({...runtimeOptions(division),profileLabels:data.profileLabels});}
  function ownerAccessGateway(division='owner'){return modules.ownerAccess.createAppsScriptOwnerAccessManagementRpcGateway({enabled:true,binding:fixed,runtime:ownerAccess(division)});}
  function readInput(division='qc'){return {idToken:data.credentials[division].token};}
  function input(command,division='qc'){return {...readInput(division),command};}
  function root(){const r=scope.readWorking({working:branch().working});if(!r.ok)throw Error('synthetic working decode');return r.root;}
  function replaceRoot(next){const r=scope.prepareWorkingWrite({working:branch().working,nextRoot:next,expectedRevision:branch().working.revision});if(!r.ok)throw Error('synthetic working update');branch().working=JSON.parse(JSON.stringify(r.nextWorking));}
  function replacePhotos(images){const r=scope.prepareOwnerPhotoWrite({working:branch().working,photos:branch().photos,identity:data.credentials.owner.identity,now:clock,expectedWorkingRevision:branch().working.revision,expectedPhotoRevision:branch().photos.revision,images});if(!r.ok)throw Error('synthetic photo update');branch().photos=JSON.parse(JSON.stringify(r.nextPhotos));}
  return {create,gateway,ownerGateway,ownerAccess,ownerAccessGateway,gate,stats,controls,modules,network,readInput,input,root,replaceRoot,replacePhotos,protectedRoot:()=>protectedRoot,sourceRoot:()=>data.root,state:()=>JSON.parse(saved),stateText:()=>saved,setClock:value=>{clock=value;},clock:()=>clock,policy:()=>data.policy,lockHeld:()=>held};
}
`;
function createProtectedBundleFixture(options = {}) {
  const seed = createProtectedSeed(options), bundle = Builder.createBundle();
  const context = vm.createContext({ __seed: JSON.stringify(seed), __bytes: v => Array.from(Buffer.from(v, 'utf8'), n => n > 127 ? n - 256 : n), __digest: b => Array.from(Crypto.createHash('sha256').update(Buffer.from(b)).digest(), n => n > 127 ? n - 256 : n), __etag: v => Crypto.createHash('sha1').update(v).digest('base64') });
  vm.runInContext(bundle.source, context);
  vm.runInContext(fixtureFactorySource + `
  var ProtectedFixture=createProtectedSyntheticFixture({DigestAlgorithm:{SHA_256:'sha256'},newBlob(value,type){if(type!=='text/plain')throw Error('synthetic blob');return {getBytes(){return Array.from(__bytes(value));}};},computeDigest(kind,bytes){if(kind!=='sha256')throw Error('synthetic digest');return Array.from(__digest(bytes));}},__seed,__bytes,__etag);`, context);
  function realm(value) { context.__input = JSON.stringify(value); try { return vm.runInContext('JSON.parse(__input)', context); } finally { delete context.__input; } }
  let sequence = 0;
  const f = context.ProtectedFixture;
  function command(kind, operationId, extra = {}, division = 'qc') { const api = f.create(division), r = (division === 'owner' ? api.readOwner : api.read)(f.readInput(division)); if (!r.ok) throw Error('synthetic command source'); return realm({ kind, requestId: 'protected-request-' + (++sequence), operationId, productId: 'product-1', expectedGrantRevision: 1, expectedSourceVersion: r.view.products[0].sourceVersion, ...extra }); }
  function revokeCommand(extra = {}) { return realm({ kind: 'revokeAccess', requestId: 'protected-revoke-1', profileId: 'approval-1', expectedOwnerGrantRevision: 1, expectedApprovalRevision: 2, expectedGrantRevision: 1, ...extra }); }
  return { context, fixture: f, realm, command, revokeCommand, seed, bundle, create: division => f.create(division), normal: v => JSON.parse(JSON.stringify(v)) };
}
module.exports = Object.freeze({ createProtectedBundleFixture, createProtectedSeed, fixtureFactorySource, KEY, OAUTH });
