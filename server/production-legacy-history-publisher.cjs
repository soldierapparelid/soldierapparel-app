'use strict';
// Source-OFF operator candidate only. No route, runtime, Auth, grant/legacy
// writer, secret, SDK initialization or automatic publication is registered.
const Codec=require('./production-legacy-history-archive-codec.cjs');
const Data=require('./production-enrollment-registry.cjs');
const CREDENTIAL_ENV=Object.freeze(['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN_FILE','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT']);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const result=error=>Object.freeze(error==='result_unknown'?{ok:false,error,retrySameSnapshot:true}:{ok:false,error});
function field(v,k){const d=v&&typeof v==='object'?Object.getOwnPropertyDescriptor(v,k):null;if(!d||!d.enumerable||!Object.hasOwn(d,'value'))throw Error('unavailable');return d.value;}
function exact(v,required,optional=[]){if(!plain(v)||Reflect.ownKeys(v).some(k=>typeof k!=='string'||!required.includes(k)&&!optional.includes(k))||required.some(k=>!Object.hasOwn(v,k)))throw Error('unavailable');for(const k of Reflect.ownKeys(v))field(v,k);}
function method(v,k){let p=v;for(let i=0;p&&typeof p==='object'&&i<8;i++,p=Object.getPrototypeOf(p)){const d=Object.getOwnPropertyDescriptor(p,k);if(d){if(!Object.hasOwn(d,'value')||typeof d.value!=='function')throw Error('unavailable');return d.value;}}throw Error('unavailable');}
function createProductionLegacyHistoryPublisher(options){
  let enabled;try{const d=plain(options)&&Object.getOwnPropertyDescriptor(options,'enabled');enabled=d&&Object.hasOwn(d,'value')&&d.value===true;}catch{}
  if(!enabled)return Object.freeze({publish:async()=>result('service_disabled'),resolve:async()=>result('service_disabled')});
  let proof,scope,database,app,reference,get,transaction,string,refMethod,credentialMethod,emulator=false,expectedURL;
  function environment(){
    if(process.env.FIREBASE_AUTH_EMULATOR_HOST!==undefined)throw Error('unavailable');
    if(emulator){
      if(scope.projectId!=='demo-soldier-security'||scope.databaseURL!=='https://demo-soldier-security.firebaseio.com'||process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000'||CREDENTIAL_ENV.some(k=>process.env[k]!==undefined))throw Error('unavailable');
    }else if(process.env.FIREBASE_DATABASE_EMULATOR_HOST!==undefined)throw Error('unavailable');
  }
  function appBinding(){
    if(database.app!==app||field(app.options,'projectId')!==scope.projectId||field(app.options,'databaseURL')!==scope.databaseURL||method(database,'ref')!==refMethod)throw Error('unavailable');
    // FirebaseApp.options returns a new deep copy. Pin the app and fixture
    // function, not the copied credential object's identity.
    if(emulator){const current=field(app.options,'credential');exact(current,['getAccessToken']);if(field(current,'getAccessToken')!==credentialMethod)throw Error('unavailable');}
  }
  function check(){
    environment();appBinding();
    if(reference){
      if(method(reference,'get')!==get||method(reference,'transaction')!==transaction||method(reference,'toString')!==string||string.call(reference)!==expectedURL)throw Error('unavailable');
      // The SDK URL callback itself is another drift boundary.
      appBinding();if(method(reference,'get')!==get||method(reference,'transaction')!==transaction||method(reference,'toString')!==string)throw Error('unavailable');
    }
    environment();
  }
  function guard(operation){
    try{check();}catch{if(operation)operation.observedDrift=true;throw Error('unavailable');}
  }
  try{
    exact(options,['enabled','scope','publicationProof','database'],['testOnlyEmulator']);
    if(Object.hasOwn(options,'testOnlyEmulator')){if(typeof options.testOnlyEmulator!=='boolean')throw Error('unavailable');emulator=options.testOnlyEmulator;}
    proof=Codec.validatePublicationProof(options.publicationProof,options.scope);scope=proof.scope;environment();database=options.database;app=database.app;refMethod=method(database,'ref');
    if(emulator){const credential=field(app.options,'credential');exact(credential,['getAccessToken']);credentialMethod=field(credential,'getAccessToken');if(typeof credentialMethod!=='function')throw Error('unavailable');}
    const path='legacyStoredHistoryArchives/'+scope.tenantId+'/'+scope.snapshotVersion;expectedURL=(emulator?'http://127.0.0.1:9000':scope.databaseURL)+'/'+path;check();
    reference=refMethod.call(database,path);get=method(reference,'get');transaction=method(reference,'transaction');string=method(reference,'toString');check();
  }catch{return Object.freeze({publish:async()=>result('unavailable'),resolve:async()=>result('unavailable')});}
  function candidate(request){exact(request,['archive']);Codec.decodeArchive(request.archive,proof);return Data.copyEnrollmentData(request.archive);}
  function same(value,desired){try{Codec.decodeArchive(value,proof);return Codec.canonicalJSON(value)===Codec.canonicalJSON(desired);}catch{return false;}}
  function evidence(replayed){return Object.freeze({ok:true,published:true,replayed,immutableStoreProven:false,authorizationGranted:false,legacyAdopted:false,readyForProduction:false,publicationEvidence:proof});}
  function snapshotValue(snapshot,operation){
    guard(operation);const val=method(snapshot,'val');
    // ref is trusted SDK metadata and is a prototype getter on DataSnapshot.
    function snapshotBinding(){
      const pointer=snapshot.ref,pointerString=method(pointer,'toString');
      guard(operation);if(pointerString.call(pointer)!==expectedURL){operation.observedDrift=true;throw Error('unavailable');}
      guard(operation);if(method(pointer,'toString')!==pointerString||method(snapshot,'val')!==val){operation.observedDrift=true;throw Error('unavailable');}
    }
    snapshotBinding();guard(operation);const value=val.call(snapshot);
    guard(operation);snapshotBinding();guard(operation);return value;
  }
  async function recover(desired,operation){
    if(operation.observedDrift)return result('result_unknown');
    guard(operation);let snapshot;try{snapshot=await get.call(reference);}catch{return result('result_unknown');}
    guard(operation);let value;try{value=snapshotValue(snapshot,operation);}catch{return result('result_unknown');}
    guard(operation);if(value===null)return result('result_unknown');if(same(value,desired)){guard(operation);return evidence(true);}return result('conflict');
  }
  async function publish(request){
    let desired;try{desired=candidate(request);}catch{return result('invalid_request');}
    try{check();}catch{return result('unavailable');}
    const operation={observedDrift:false};let dispatched=false;
    try{
      dispatched=true;const response=await transaction.call(reference,current=>{
        // Same immutable candidate on every SDK callback. Existing data is
        // never rewritten, even an exact replay; acknowledgment uses readback.
        if(operation.observedDrift)return undefined;
        try{guard(operation);if(current===null)return Data.copyEnrollmentData(desired);return undefined;}catch{return undefined;}
      },undefined,false);
      if(operation.observedDrift)return result('result_unknown');
      guard(operation);let committed,snapshot;
      try{committed=field(response,'committed');if(committed===true)snapshot=field(response,'snapshot');}catch{}
      if(committed===true){
        try{if(same(snapshotValue(snapshot,operation),desired)){guard(operation);return evidence(false);}}catch{}
      }
      return await recover(desired,operation);
    }catch{if(dispatched){try{return await recover(desired,operation);}catch{}return result('result_unknown');}return result('unavailable');}
  }
  async function resolve(request){
    let desired;try{desired=candidate(request);}catch{return result('invalid_request');}
    try{check();}catch{return result('unavailable');}
    try{return await recover(desired,{observedDrift:false});}catch{return result('result_unknown');}
  }
  return Object.freeze({publish,resolve});
}
module.exports=Object.freeze({createProductionLegacyHistoryPublisher});
