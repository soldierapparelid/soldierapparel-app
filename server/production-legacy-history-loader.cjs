'use strict';
// Source OFF, server-only. No SDK initialization, credentials, writer, logger,
// selectors, alias mapping, route registration or mutable legacy-root fallback.
const Codec=require('./production-legacy-history-archive-codec.cjs');
const KEYS=Object.freeze(['projectId','databaseURL','tenantId','snapshotVersion']);
const EMULATOR_PROJECT='demo-soldier-security',EMULATOR_HOST='127.0.0.1:9000';
const EMULATOR_URL='https://'+EMULATOR_PROJECT+'.firebaseio.com';
const EMULATOR_CREDENTIAL_ENV=Object.freeze(['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN_FILE','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT']);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const own=(v,k)=>Object.getOwnPropertyDescriptor(v,k);
class LegacyHistoryLoaderError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new LegacyHistoryLoaderError(code);};
function field(v,k){
  if(!object(v))fail('unavailable');const d=own(v,k);
  if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail('unavailable');return d.value;
}
function exact(v,required,optional=[]){
  if(!plain(v))fail('unavailable');const keys=Reflect.ownKeys(v);
  if(keys.some(k=>typeof k!=='string'||!required.includes(k)&&!optional.includes(k))||required.some(k=>!keys.includes(k)))fail('unavailable');
  for(const k of keys)field(v,k);
}
function method(v,k){
  if(!object(v))fail('unavailable');let pointer=v;
  for(let depth=0;pointer&&depth<8;depth++,pointer=Object.getPrototypeOf(pointer)){
    const d=own(pointer,k);if(d){if(!Object.hasOwn(d,'value')||typeof d.value!=='function')fail('unavailable');return d.value;}
  }
  fail('unavailable');
}
function unavailable(code='unavailable'){
  return Object.freeze({read:async()=>{fail(code);}});
}
function createProductionLegacyHistoryLoader(options){
  let enabled;try{enabled=plain(options)&&own(options,'enabled');}catch{}
  if(!enabled||!Object.hasOwn(enabled,'value')||enabled.value!==true)return unavailable('service_disabled');
  let fixed,proof,proofDigest,database,app,refMethod,reference,getReference,referenceString,referenceURL,testOnlyEmulator=false;
  function environment(){
    if(testOnlyEmulator){
      // An explicit source-only demo test hook, never a production redirect.
      if(fixed.projectId!==EMULATOR_PROJECT||fixed.databaseURL!==EMULATOR_URL||process.env.FIREBASE_DATABASE_EMULATOR_HOST!==EMULATOR_HOST||process.env.FIREBASE_AUTH_EMULATOR_HOST!==undefined||EMULATOR_CREDENTIAL_ENV.some(k=>process.env[k]!==undefined))fail('unavailable');
    }else if(process.env.FIREBASE_DATABASE_EMULATOR_HOST!==undefined||process.env.FIREBASE_AUTH_EMULATOR_HOST!==undefined)fail('unavailable');
  }
  function checkBinding(){
    environment();
    if(!Object.isFrozen(proof)||!Object.isFrozen(field(proof,'scope'))||field(proof,'digest')!==proofDigest||KEYS.some(k=>field(proof.scope,k)!==fixed[k]))fail('unavailable');
    // SDK app/options are documented SDK getters. Configuration/proof fields
    // use own data descriptors; no private credential object is serialized.
    if(database.app!==app||field(app.options,'projectId')!==fixed.projectId||field(app.options,'databaseURL')!==fixed.databaseURL||method(database,'ref')!==refMethod)fail('unavailable');
    if(testOnlyEmulator){const credential=field(app.options,'credential');exact(credential,['getAccessToken']);if(typeof field(credential,'getAccessToken')!=='function')fail('unavailable');}
    if(reference){
      if(method(reference,'get')!==getReference||method(reference,'toString')!==referenceString||referenceString.call(reference)!==referenceURL)fail('unavailable');
      if(method(reference,'get')!==getReference||method(reference,'toString')!==referenceString||database.app!==app||field(app.options,'projectId')!==fixed.projectId||field(app.options,'databaseURL')!==fixed.databaseURL||method(database,'ref')!==refMethod)fail('unavailable');
    }
    environment();
  }
  try{
    exact(options,['enabled','scope','database','publicationProof'],['testOnlyEmulator']);
    if(own(options,'testOnlyEmulator')){const flag=field(options,'testOnlyEmulator');if(typeof flag!=='boolean')fail('unavailable');testOnlyEmulator=flag;}
    const scope=field(options,'scope');exact(scope,KEYS);fixed=Object.freeze(Object.fromEntries(KEYS.map(k=>[k,field(scope,k)])));
    // Proof is independently captured trusted publication review, not a proof
    // obtained from the blob. Codec pins exact scope/codec/canonical digest.
    proof=Codec.validatePublicationProof(field(options,'publicationProof'),fixed);
    proofDigest=field(proof,'digest');
    environment();
    database=field(options,'database');refMethod=method(database,'ref');app=database.app;checkBinding();
    const fixedPath='legacyStoredHistoryArchives/'+fixed.tenantId+'/'+fixed.snapshotVersion;
    referenceURL=(testOnlyEmulator?'http://'+EMULATOR_HOST:fixed.databaseURL)+'/'+fixedPath;
    reference=refMethod.call(database,fixedPath);getReference=method(reference,'get');referenceString=method(reference,'toString');checkBinding();
    fixed=Object.freeze({...fixed,path:fixedPath});
  }catch{return unavailable();}
  async function read(...args){
    if(args.length!==0)fail('invalid_request');
    try{
      checkBinding();
      const snapshot=await getReference.call(reference);checkBinding();
      const snapshotVal=method(snapshot,'val'),snapshotRef=()=>{
        // DataSnapshot.ref is a documented trusted SDK getter. Its URL must
        // point to this exact immutable version, never another/root source.
        const ref=snapshot.ref,refString=method(ref,'toString');
        if(refString.call(ref)!==referenceURL)fail('unavailable');checkBinding();
        if(method(snapshot,'val')!==snapshotVal)fail('unavailable');
      };
      snapshotRef();checkBinding();const archive=snapshotVal.call(snapshot);
      checkBinding();snapshotRef();checkBinding();
      const logical=Codec.decodeArchive(archive,proof);
      // val()/SDK callbacks may mutate app/ref/method binding. Recheck after
      // each boundary and immediately before returning the frozen source.
      checkBinding();snapshotRef();checkBinding();return logical;
    }catch{
      // No raw SDK/codec error, payload, digest, private scope or token escapes.
      fail('unavailable');
    }
  }
  return Object.freeze({projectId:fixed.projectId,databaseURL:fixed.databaseURL,tenantId:fixed.tenantId,snapshotVersion:fixed.snapshotVersion,path:fixed.path,read});
}
module.exports=Object.freeze({createProductionLegacyHistoryLoader,LegacyHistoryLoaderError});
