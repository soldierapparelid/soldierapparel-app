'use strict';
const Gateway=require('../../server/apps-script/owner-lifecycle-rpc-gateway.cjs'),Bridge=require('../../apps-script-owner-lifecycle-bridge.js'),Controller=require('../../legacy-owner-lifecycle-controller.js');
const {createLifecycleRuntimeFixture}=require('./lifecycle-runtime-fixture.cjs'),{fakeIndexedDB}=require('./command-indexeddb-fixture.cjs');
const copy=v=>JSON.parse(JSON.stringify(v)),DB='soldier-apps-script-owner-lifecycle-journal:v1';
function createOwnerLifecycleBrowserFixture(division='owner',indexed=fakeIndexedDB()){
  const native=createLifecycleRuntimeFixture(division),gateway=Gateway.createAppsScriptOwnerLifecycleRpcGateway({enabled:true,binding:native.f.binding,runtime:native.create()}),calls=[],states=[],listeners=new Set(),controls={drop:null,reply:null};let active=true,ids=0,tokens=0;
  const user={uid:native.who.uid,emailVerified:true,providerData:[{providerId:'google.com'}],async getIdToken(){tokens++;if(controls.tokenGate)await controls.tokenGate();return native.readInput().idToken;}},auth={currentUser:user,app:{options:{projectId:native.f.binding.projectId,databaseURL:native.f.binding.databaseURL}}};
  function runner(failure,success){return {withFailureHandler(fn){return runner(fn,success);},withSuccessHandler(fn){return runner(failure,fn);},soldierOwnerLifecycleRpc(q){const request=copy(q);calls.push(request);queueMicrotask(()=>{try{let r=gateway.dispatchJson(request);if(controls.drop?.(request,r)){failure(Error('SYNTHETIC_OWNER_ACK_LOSS'));return;}if(controls.reply)r=controls.reply(r,request);success(r);}catch{failure(Error('SYNTHETIC_OWNER_ERROR'));}});}};}
  const options={enabled:true,...native.f.binding,deploymentURL:'https://script.google.com/macros/s/SYNTHETIC_OWNER_LIFECYCLE_0000000000/dev',auth,indexedDB:indexed.api,scriptRun:runner(),subscribeAuth:cb=>{listeners.add(cb);return ()=>listeners.delete(cb);},isCurrent:()=>active};
  const createBridge=cb=>Bridge.createAppsScriptOwnerLifecycleBridge({...options,...cb}),create=changes=>Controller.createLegacyOwnerLifecycleController({enabled:true,isCurrent:()=>active,createBridge,onState:s=>states.push(s),newId:()=>('synthetic-owner-'+(++ids)),...changes});
  return {native,indexed,gateway,calls,states,controls,auth,user,options,createBridge,create,get tokens(){return tokens;},journalValues:()=>[...(indexed.databases.get(DB)?.stores.get('journals')?.values()||[])],signout(){active=false;auth.currentUser=null;for(const cb of [...listeners])cb(null);}};
}
module.exports=Object.freeze({createOwnerLifecycleBrowserFixture,DB});
