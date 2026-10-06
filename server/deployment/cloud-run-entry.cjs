'use strict';
// Source binding only. Import/OFF does not inspect process/environment, load a
// host or SDK, register signals, open a listener, or print diagnostic contents.
const Configuration=require('./configuration.cjs');
const SHUTDOWN_DEADLINE_MS=9000;
const OK=Object.freeze({ok:true}),DISABLED=Object.freeze({ok:false,error:'service_disabled'}),UNAVAILABLE=Object.freeze({ok:false,error:'unavailable'});
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
function own(value,key){const descriptor=Object.getOwnPropertyDescriptor(value,key);return descriptor&&descriptor.enumerable&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;}
function exact(value,keys){return plain(value)&&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>{const descriptor=Object.getOwnPropertyDescriptor(value,key);return descriptor&&descriptor.enumerable&&Object.hasOwn(descriptor,'value');});}
function method(value,key){
  let cursor=value;
  for(let depth=0;cursor!==null&&depth<12;depth++,cursor=Object.getPrototypeOf(cursor)){
    const descriptor=Object.getOwnPropertyDescriptor(cursor,key);
    if(descriptor)return Object.hasOwn(descriptor,'value')&&typeof descriptor.value==='function'?descriptor.value.bind(value):null;
  }
  return null;
}
function snapshot(value){
  if(!plain(value))return null;
  const keys=Reflect.ownKeys(value);if(keys.length>512)return null;
  const result=Object.create(null);
  for(const key of keys){
    if(typeof key!=='string'||key.length>256)return null;
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor||!descriptor.enumerable||!Object.hasOwn(descriptor,'value')||descriptor.value!==undefined&&(typeof descriptor.value!=='string'||descriptor.value.length>32768))return null;
    Object.defineProperty(result,key,{enumerable:true,value:descriptor.value});
  }
  return Object.freeze(result);
}
function inert(result){return Object.freeze({start:async()=>result,dispose:async()=>{}});}
function createEntrypoint(options={}){
  let values;
  try{
    const configuration=own(options,'configuration');
    if(!configuration||own(configuration,'enabled')!==true)return inert(DISABLED);
    if(!exact(options,['configuration','environment','loadHost','process']))return inert(UNAVAILABLE);
    values={configuration,environment:own(options,'environment'),loadHost:own(options,'loadHost'),process:own(options,'process')};
    if(typeof values.environment!=='function'||typeof values.loadHost!=='function')return inert(UNAVAILABLE);
  }catch{return inert(DISABLED);}
  let startPromise=null,stopPromise=null,resolveStop=null,disposed=false,signalExit=false,processAdapter=null;
  let serverMethods=null,hostWaitForIdle=null,listenPending=false,closeStarted=false,idleWaitStarted=false,stopped=false,deadline=null,signals=[];
  function removeSignals(){for(const signal of signals){try{processAdapter.removeListener(signal,onSignal);}catch{}}signals=[];}
  function finishStop(code){
    if(stopped)return;stopped=true;
    if(deadline!==null){try{processAdapter.clearTimeout(deadline);}catch{}deadline=null;}
    removeSignals();
    if(resolveStop){resolveStop();resolveStop=null;}
    if(processAdapter&&(signalExit||code!==0)){try{processAdapter.exit(code);}catch{}}
  }
  function closeServer(){
    if(stopped||closeStarted||listenPending)return;
    if(!serverMethods){finishStop(0);return;}
    closeStarted=true;
    try{
      // Stop accepting first, then close idle connections. In-flight work is
      // not cancelled or acknowledged here; the deadline may end the process.
      serverMethods.close(error=>{
        if(stopped||idleWaitStarted)return;if(error){finishStop(1);return;}
        // Node close only proves that sockets closed. A detached dispatched
        // operation can still hold the host slot after disconnect/deadline.
        // Check host idle after sockets close so no later socket admission can
        // invalidate an earlier idle observation.
        idleWaitStarted=true;
        try{const idle=hostWaitForIdle();if(!(idle instanceof Promise))throw Error('unavailable');Promise.prototype.then.call(idle,()=>finishStop(0),()=>finishStop(1));}catch{finishStop(1);}
      });
      if(!stopped)serverMethods.closeIdleConnections();
    }catch{finishStop(1);}
  }
  function stop(fromSignal=false){
    disposed=true;if(fromSignal)signalExit=true;
    if(stopPromise)return stopPromise;
    stopPromise=new Promise(resolve=>{resolveStop=resolve;});
    if(!processAdapter){finishStop(0);return stopPromise;}
    try{deadline=processAdapter.setTimeout(()=>finishStop(1),SHUTDOWN_DEADLINE_MS);}catch{finishStop(1);return stopPromise;}
    closeServer();return stopPromise;
  }
  function onSignal(){void stop(true);}
  async function begin(){
    try{
      const candidate=values.process;
      if(!exact(candidate,['version','on','removeListener','exit','setTimeout','clearTimeout']))return UNAVAILABLE;
      const adapter=Object.create(null);
      for(const key of Reflect.ownKeys(candidate))adapter[key]=own(candidate,key);
      if(typeof adapter.version!=='string'||!/^v22\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(adapter.version)||['on','removeListener','exit','setTimeout','clearTimeout'].some(key=>typeof adapter[key]!=='function'))return UNAVAILABLE;
      const Core=require('./deployment-runtime.cjs'),configuration=Core.validateConfiguration(values.configuration);
      if(!configuration||configuration.enabled!==true||typeof Core.validateEnvironment!=='function')return UNAVAILABLE;
      const readEnvironment=()=>{const current=snapshot(values.environment());if(!current)throw Error('unavailable');return current;};
      const environment=readEnvironment();
      if(!Core.validateEnvironment(environment,configuration,'cloud-run'))return UNAVAILABLE;
      const port=own(environment,'PORT');
      if(typeof port!=='string'||!/^([1-9][0-9]{0,4})$/.test(port)||Number(port)>65535)return UNAVAILABLE;
      const host=values.loadHost(),create=own(host,'createCloudRunServer');
      if(typeof create!=='function')return UNAVAILABLE;
      const result=create({configuration,environment:readEnvironment});
      if(!exact(result,['enabled','server','waitForIdle'])||own(result,'enabled')!==true||typeof own(result,'waitForIdle')!=='function')return UNAVAILABLE;
      const server=own(result,'server'),methods=Object.create(null);
      for(const key of ['once','removeListener','listen','close','closeIdleConnections']){methods[key]=method(server,key);if(!methods[key])return UNAVAILABLE;}
      processAdapter=Object.freeze(adapter);serverMethods=methods;hostWaitForIdle=own(result,'waitForIdle').bind(result);
      if(disposed){await stop();return UNAVAILABLE;}
      const opened=await new Promise(resolve=>{
        let settled=false;
        const cleanup=()=>{try{methods.removeListener('error',failed);}catch{}};
        const failed=()=>{if(settled)return;settled=true;listenPending=false;cleanup();resolve(false);};
        const listening=()=>{if(settled)return;settled=true;listenPending=false;cleanup();resolve(true);};
        listenPending=true;
        try{methods.once('error',failed);methods.listen(Number(port),'0.0.0.0',listening);}catch{failed();}
      });
      if(!opened){await stop();return UNAVAILABLE;}
      if(disposed){closeServer();return UNAVAILABLE;}
      for(const signal of ['SIGTERM','SIGINT']){signals.push(signal);processAdapter.on(signal,onSignal);}
      return OK;
    }catch{await stop();return UNAVAILABLE;}
  }
  function start(){if(disposed)return Promise.resolve(UNAVAILABLE);if(startPromise===null)startPromise=begin();return startPromise;}
  return Object.freeze({start,dispose:()=>stop(false)});
}
module.exports=Object.freeze({createEntrypoint,SHUTDOWN_DEADLINE_MS});
if(require.main===module){
  if(Configuration.enabled!==true)process.exitCode=1;
  else{
    const entry=createEntrypoint({configuration:Configuration,environment:()=>Object.assign(Object.create(null),process.env),loadHost:()=>require('./cloud-run-server.cjs'),process:{version:process.version,on:process.on.bind(process),removeListener:process.removeListener.bind(process),exit:process.exit.bind(process),setTimeout,clearTimeout}});
    void entry.start().then(result=>{if(result.ok!==true)process.exitCode=1;},()=>{process.exitCode=1;});
  }
}
