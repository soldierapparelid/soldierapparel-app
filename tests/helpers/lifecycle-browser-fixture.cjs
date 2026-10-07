'use strict';
const Gateway=require('../../server/apps-script/lifecycle-rpc-gateway.cjs');
const Bridge=require('../../apps-script-lifecycle-bridge.js');
const Controller=require('../../legacy-lifecycle-controller.js');
const {createLifecycleRuntimeFixture}=require('./lifecycle-runtime-fixture.cjs');
const {fakeIndexedDB}=require('./command-indexeddb-fixture.cjs');
const copy=v=>JSON.parse(JSON.stringify(v));
function createLifecycleBrowserFixture(division='qc',indexed=fakeIndexedDB()){
  const native=createLifecycleRuntimeFixture(division),gateway=Gateway.createAppsScriptLifecycleRpcGateway({enabled:true,binding:native.f.binding,runtime:native.create()});
  const listeners=new Set(),states=[],calls=[],controls={failure:null,tokenGate:null,reply:null};let active=true,tokens=0,sequence=0;
  const user={uid:native.who.uid,emailVerified:true,providerData:[{providerId:'google.com'}],async getIdToken(force){if(force!==true)throw Error();tokens++;if(controls.tokenGate)await controls.tokenGate();return native.readInput().idToken;}};
  const auth={currentUser:user,app:{options:{projectId:native.f.binding.projectId,databaseURL:native.f.binding.databaseURL}}};
  function runner(failure,success){return {withFailureHandler(fn){return runner(fn,success);},withSuccessHandler(fn){return runner(failure,fn);},soldierLifecycleRpc(raw){const request=copy(raw);calls.push(request);queueMicrotask(()=>{try{let result=copy(gateway.dispatch(request));if(controls.failure?.(request,result)){failure(Error('SYNTHETIC_PRIVATE_ERROR'));return;}if(controls.reply)result=controls.reply(result,request);success(result);}catch{failure(Error('SYNTHETIC_PRIVATE_ERROR'));}});}};}
  const bridgeOptions={enabled:true,...native.f.binding,deploymentURL:'https://script.google.com/macros/s/SYNTHETIC_LIFECYCLE_CONTROLLER_0000000/dev',auth,indexedDB:indexed.api,scriptRun:runner(),subscribeAuth:cb=>{listeners.add(cb);return ()=>listeners.delete(cb);},isCurrent:()=>active};
  const create=changes=>Controller.createLegacyLifecycleController({enabled:true,isCurrent:()=>active,onState:s=>states.push(s),newId:()=>('synthetic-controller-'+(++sequence)),createBridge:callbacks=>Bridge.createAppsScriptLifecycleBridge({...bridgeOptions,...callbacks}),...changes});
  return {native,indexed,gateway,states,calls,controls,auth,user,create,bridgeOptions,get tokens(){return tokens;},get ids(){return sequence;},signout(){active=false;auth.currentUser=null;for(const cb of [...listeners])cb(null);}};
}
module.exports=Object.freeze({createLifecycleBrowserFixture});
