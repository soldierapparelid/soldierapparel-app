'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{spawnSync}=require('node:child_process'),path=require('node:path');
const Entry=require('../server/deployment/cloud-run-entry.cjs');
const PROJECT='soldier-entry-test',configuration=Object.freeze({enabled:true,projectId:PROJECT,databaseURL:'https://'+PROJECT+'.firebaseio.com',tenantId:'tenant-1',allowedOrigins:Object.freeze(['https://'+PROJECT+'.web.app']),serviceAccount:'soldier-production-runtime@'+PROJECT+'.iam.gserviceaccount.com'});
const environment=Object.freeze({GOOGLE_CLOUD_PROJECT:PROJECT,K_SERVICE:'soldier-production',K_CONFIGURATION:'soldier-production',K_REVISION:'soldier-production-00001-synthetic',PORT:'8080'});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
  const signals=new EventEmitter(),server=new EventEmitter(),timers=new Map(),stats={environments:0,hosts:0,creates:0,listens:[],closes:0,idles:0,idleWaits:0,exits:[],timerMs:[],cleared:[]},controls={holdListen:false,holdClose:true,holdRuntimeIdle:false,listenError:false,listenThrow:false,closeError:false,closeThrow:false,idleThrow:false,idleReject:false,idleNonPromise:false};let nextTimer=0,opened=null,closed=null,releaseIdle=null;
  const processAdapter={version:'v22.22.0',on:signals.on.bind(signals),removeListener:signals.removeListener.bind(signals),exit:code=>stats.exits.push(code),setTimeout(callback,ms){const id=++nextTimer;stats.timerMs.push(ms);timers.set(id,callback);return id;},clearTimeout(id){stats.cleared.push(id);timers.delete(id);}};
  server.listen=(port,host,callback)=>{stats.listens.push({port,host});if(controls.listenThrow)throw Error('synthetic-private-listen');opened=callback;if(controls.listenError)server.emit('error',Error('synthetic-private-listen'));else if(!controls.holdListen)callback();};
  server.close=callback=>{stats.closes++;if(controls.closeThrow)throw Error('synthetic-private-close');closed=callback;if(!controls.holdClose)callback(controls.closeError?Error('synthetic-private-close'):undefined);};
  server.closeIdleConnections=()=>{stats.idles++;};
  let hostOptions;
  const options={configuration,environment:()=>{stats.environments++;return {...environment};},loadHost:()=>{stats.hosts++;return {createCloudRunServer(value){stats.creates++;hostOptions=value;return {enabled:true,server,waitForIdle(){stats.idleWaits++;if(controls.idleThrow)throw Error('synthetic-private-idle');if(controls.idleNonPromise)return undefined;if(controls.idleReject)return Promise.reject(Error('synthetic-private-idle'));return controls.holdRuntimeIdle?new Promise(resolve=>{releaseIdle=resolve;}):Promise.resolve();}};}};},process:processAdapter};
  return {options,stats,controls,timers,signals,server,processAdapter,hostOptions:()=>hostOptions,create:extra=>Entry.createEntrypoint({...options,...extra}),finishListen:()=>opened(),finishClose:()=>closed(controls.closeError?Error('synthetic-private-close'):undefined),finishRuntimeIdle:()=>releaseIdle(),deadline:()=>{for(const callback of [...timers.values()])callback();}};
}
test('source-OFF require and CLI do not load host/runtime/http/SDK or produce private diagnostics',()=>{
  const file=path.resolve(__dirname,'../server/deployment/cloud-run-entry.cjs'),code="const Module=require('node:module'),original=Module._load;Module._load=function(id,...args){if(/cloud-run-server|deployment-runtime|firebase-admin|^(node:)?http$/.test(id))throw Error('synthetic-private-forbidden-import');return original.call(this,id,...args);};const entry=require("+JSON.stringify(file)+");entry.createEntrypoint({configuration:{enabled:false},get environment(){throw Error('synthetic-private-env');},get process(){throw Error('synthetic-private-process');}}).start().then(r=>{if(r.error!=='service_disabled')process.exitCode=2;});";
  const required=spawnSync(process.execPath,['-e',code],{encoding:'utf8',timeout:10000});assert.equal(required.status,0);assert.equal(required.stdout,'');assert.equal(required.stderr,'');
  const cli=spawnSync(process.execPath,[file],{encoding:'utf8',timeout:10000,env:{PORT:'8080',ENABLED:'true',SOLDIER_PRODUCTION_ENABLED:'true',GOOGLE_APPLICATION_CREDENTIALS:'synthetic-private-file'}});assert.equal(cli.status,1);assert.equal(cli.stdout,'');assert.equal(cli.stderr,'');
});
test('OFF factory and disposal ignore executable dependency getters and environment activation',async()=>{
  let reads=0;const options={configuration:{enabled:false},get environment(){reads++;throw Error();},get loadHost(){reads++;throw Error();},get process(){reads++;throw Error();}};
  const entry=Entry.createEntrypoint(options);assert.deepEqual(await entry.start(),{ok:false,error:'service_disabled'});await entry.dispose();assert.equal(reads,0);assert.equal(Entry.SHUTDOWN_DEADLINE_MS,9000);
});
test('factory is inert until start, and early dispose does not read dependencies',async()=>{
  const f=fixture(),entry=f.create();assert.equal(f.stats.environments,0);assert.equal(f.stats.hosts,0);assert.equal(f.signals.eventNames().length,0);await entry.dispose();assert.deepEqual(await entry.start(),{ok:false,error:'unavailable'});assert.equal(f.stats.environments,0);assert.equal(f.stats.hosts,0);assert.deepEqual(f.stats.timerMs,[]);
});
test('valid Node 22 fixed binding listens once on canonical PORT and all interfaces',async()=>{
  const f=fixture(),entry=f.create(),first=entry.start();assert.equal(entry.start(),first);assert.deepEqual(await first,{ok:true});assert.deepEqual(f.stats.listens,[{port:8080,host:'0.0.0.0'}]);assert.equal(f.stats.creates,1);assert.equal(f.signals.listenerCount('SIGTERM'),1);assert.equal(f.signals.listenerCount('SIGINT'),1);assert.equal(f.timers.size,0);assert.deepEqual(await entry.start(),{ok:true});
  const captured=f.hostOptions();assert.equal(captured.configuration.projectId,PROJECT);assert.ok(Object.isFrozen(captured.configuration));assert.equal(Object.getPrototypeOf(captured.environment()),null);f.controls.holdClose=false;await entry.dispose();assert.deepEqual(f.stats.exits,[]);
});
test('only exact Node 22 stable versions are accepted before environment or host access',async()=>{
  for(const version of ['v20.19.0','v24.1.0','22.1.0','v22.01.0','v22.1.0-nightly','v22.1','v022.1.0']){const f=fixture();f.processAdapter.version=version;assert.deepEqual(await f.create().start(),{ok:false,error:'unavailable'});assert.equal(f.stats.environments,0);assert.equal(f.stats.hosts,0);assert.deepEqual(f.stats.listens,[]);}
});
test('invalid fixed config cannot be repaired by environment or a host factory',async()=>{
  for(const invalid of [{...configuration,serviceAccount:'foreign@'+PROJECT+'.iam.gserviceaccount.com'},{...configuration,allowedOrigins:['http://localhost']},{...configuration,tenantId:'__proto__'},{...configuration,projectId:'demo-entry-test'},{...configuration,unknown:'synthetic'}]){const f=fixture();assert.deepEqual(await f.create({configuration:invalid}).start(),{ok:false,error:'unavailable'});assert.equal(f.stats.environments,0);assert.equal(f.stats.hosts,0);}
});
test('canonical Cloud Run environment validation rejects project, host, port, emulator and ADC overrides before loading host',async()=>{
  for(const extra of [{PORT:'08080'},{PORT:'0'},{PORT:'65536'},{PORT:'8080 '},{PORT:8080},{GOOGLE_CLOUD_PROJECT:'foreign-project'},{GCLOUD_PROJECT:'foreign-project'},{K_SERVICE:'foreign-service'},{K_CONFIGURATION:'foreign-service'},{K_REVISION:'foreign-service-00001-x'},{FUNCTION_TARGET:'soldierProduction'},{FUNCTION_SIGNATURE_TYPE:'http'},{GOOGLE_APPLICATION_CREDENTIALS:'synthetic-private-file'},{CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE:'synthetic-private-file'},{FIREBASE_AUTH_EMULATOR_HOST:'localhost:9099'}]){const f=fixture();assert.deepEqual(await f.create({environment:()=>({...environment,...extra})}).start(),{ok:false,error:'unavailable'});assert.equal(f.stats.hosts,0);assert.deepEqual(f.stats.listens,[]);assert.deepEqual(f.stats.exits,[]);}
});
test('options, process and environment accessors are not invoked',async()=>{
  let reads=0;const f=fixture(),options={...f.options};Object.defineProperty(options,'environment',{enumerable:true,get(){reads++;throw Error();}});assert.deepEqual(await Entry.createEntrypoint(options).start(),{ok:false,error:'unavailable'});
  const processAdapter={...f.processAdapter};Object.defineProperty(processAdapter,'version',{enumerable:true,get(){reads++;throw Error();}});assert.deepEqual(await f.create({process:processAdapter}).start(),{ok:false,error:'unavailable'});
  const env={...environment};Object.defineProperty(env,'PORT',{enumerable:true,get(){reads++;throw Error();}});assert.deepEqual(await f.create({environment:()=>env}).start(),{ok:false,error:'unavailable'});assert.equal(reads,0);assert.equal(f.stats.hosts,0);
});
test('environment snapshots reject symbols, inherited shapes and non-enumerable fields',async()=>{
  const environments=[Object.create({...environment}),{...environment,[Symbol('synthetic')]:true},Object.defineProperty({...environment},'hidden',{value:'synthetic',enumerable:false}),Object.assign([],{PORT:'8080'})];
  for(const env of environments){const f=fixture();assert.deepEqual(await f.create({environment:()=>env}).start(),{ok:false,error:'unavailable'});assert.equal(f.stats.hosts,0);}
});
test('warm host environment adapter takes a fresh strict snapshot rather than accepting a mutated startup object',async()=>{
  const f=fixture(),env={...environment},entry=f.create({environment:()=>env});assert.deepEqual(await entry.start(),{ok:true});const first=f.hostOptions().environment();env.GOOGLE_CLOUD_PROJECT='foreign-project';const second=f.hostOptions().environment();assert.equal(first.GOOGLE_CLOUD_PROJECT,PROJECT);assert.equal(second.GOOGLE_CLOUD_PROJECT,'foreign-project');assert.ok(Object.isFrozen(first));assert.ok(Object.isFrozen(second));Object.defineProperty(env,'private',{enumerable:true,get(){throw Error('synthetic-private-getter');}});assert.throws(()=>f.hostOptions().environment(),/^Error: unavailable$/);f.controls.holdClose=false;await entry.dispose();
});
test('host loading, host creation and malformed host results expose only generic failure',async()=>{
  for(const loadHost of [()=>{throw Error('synthetic-private-host');},()=>({createCloudRunServer(){throw Error('synthetic-private-create');}}),()=>({createCloudRunServer:()=>({enabled:false,server:null})}),()=>({createCloudRunServer:()=>({enabled:true,server:{}})}),()=>({createCloudRunServer:()=>({enabled:true,server:{},waitForIdle:()=>Promise.resolve()})})]){const f=fixture();assert.deepEqual(await f.create({loadHost}).start(),{ok:false,error:'unavailable'});assert.deepEqual(f.stats.listens,[]);assert.deepEqual(f.stats.exits,[]);}
  let reads=0;const f=fixture();assert.deepEqual(await f.create({loadHost:()=>({get createCloudRunServer(){reads++;throw Error();}})}).start(),{ok:false,error:'unavailable'});assert.equal(reads,0);
});
test('startup listen exception or error is contained and signal handlers are not retained',async()=>{
  for(const key of ['listenThrow','listenError']){const f=fixture();f.controls[key]=true;f.controls.holdClose=false;assert.deepEqual(await f.create().start(),{ok:false,error:'unavailable'});assert.equal(f.stats.closes,1);assert.equal(f.signals.eventNames().length,0);assert.equal(f.timers.size,0);}
});
test('SIGTERM stops accepting and closes idle sockets while allowing in-flight work to drain',async()=>{
  const f=fixture(),entry=f.create();await entry.start();let settled=false;const pendingOperation=new Promise(resolve=>{f.completeOperation=()=>{settled=true;resolve();};});f.signals.emit('SIGTERM');assert.equal(f.stats.closes,1);assert.equal(f.stats.idles,1);assert.deepEqual(f.stats.timerMs,[9000]);assert.deepEqual(f.stats.exits,[]);assert.equal(settled,false);assert.deepEqual(await entry.start(),{ok:false,error:'unavailable'});f.completeOperation();await pendingOperation;f.finishClose();await tick();assert.deepEqual(f.stats.exits,[0]);assert.equal(f.timers.size,0);assert.equal(f.signals.eventNames().length,0);
});
test('repeated signals and disposal share one drain and one completion exit',async()=>{
  const f=fixture(),entry=f.create();await entry.start();f.signals.emit('SIGINT');f.signals.emit('SIGTERM');f.signals.emit('SIGINT');const first=entry.dispose();assert.equal(entry.dispose(),first);assert.equal(f.stats.closes,1);assert.equal(f.stats.idles,1);assert.deepEqual(f.stats.timerMs,[9000]);f.finishClose();await first;assert.deepEqual(f.stats.exits,[0]);f.deadline();assert.deepEqual(f.stats.exits,[0]);
});
test('explicit dispose drains and removes handlers without exiting a healthy process',async()=>{
  const f=fixture(),entry=f.create();await entry.start();const disposed=entry.dispose();assert.equal(f.stats.closes,1);assert.equal(f.stats.idles,1);assert.deepEqual(f.stats.exits,[]);f.finishClose();await disposed;assert.equal(f.timers.size,0);assert.equal(f.signals.eventNames().length,0);assert.deepEqual(f.stats.exits,[]);
});
test('the nine-second deadline exits once without cancelling, acknowledging or destroying in-flight operations',async()=>{
  const f=fixture(),entry=f.create();await entry.start();let completeOperation,operationSettled=false;const pendingOperation=new Promise(resolve=>{completeOperation=resolve;}).then(()=>{operationSettled=true;});f.server.closeAllConnections=()=>{throw Error('synthetic-no-forced-connection-close');};f.signals.emit('SIGTERM');f.deadline();await entry.dispose();assert.deepEqual(f.stats.exits,[1]);assert.equal(operationSettled,false);assert.equal(f.stats.closes,1);assert.equal(f.stats.idles,1);f.finishClose();f.deadline();assert.deepEqual(f.stats.exits,[1]);completeOperation();await pendingOperation;assert.equal(operationSettled,true);
});
test('dispose during pending listen closes the eventual listener before start can succeed',async()=>{
  const f=fixture();f.controls.holdListen=true;const entry=f.create(),started=entry.start(),disposed=entry.dispose();assert.equal(f.stats.closes,0);assert.deepEqual(f.stats.timerMs,[9000]);f.finishListen();await tick();assert.equal(f.stats.closes,1);assert.equal(f.stats.idles,1);assert.deepEqual(await started,{ok:false,error:'unavailable'});f.finishClose();await disposed;assert.deepEqual(f.stats.exits,[]);assert.equal(f.signals.eventNames().length,0);
});
test('pending listen cannot outlast the shutdown deadline and a late callback cannot report success',async()=>{
  const f=fixture();f.controls.holdListen=true;const entry=f.create(),started=entry.start(),disposed=entry.dispose();f.deadline();await disposed;assert.deepEqual(f.stats.exits,[1]);f.finishListen();assert.deepEqual(await started,{ok:false,error:'unavailable'});assert.equal(f.signals.eventNames().length,0);assert.equal(f.stats.closes,0);
});
test('close exceptions and close callback errors exit generically without exposing exception text',async()=>{
  for(const key of ['closeThrow','closeError']){const f=fixture(),entry=f.create();await entry.start();f.controls[key]=true;f.controls.holdClose=false;await entry.dispose();assert.deepEqual(f.stats.exits,[1]);assert.equal(f.timers.size,0);assert.equal(f.signals.eventNames().length,0);}
});
test('partial signal registration failure removes owned listeners and closes the listener',async()=>{
  const f=fixture();f.processAdapter.on=(signal,callback)=>{f.signals.on(signal,callback);if(signal==='SIGINT')throw Error('synthetic-private-signal');};f.controls.holdClose=false;assert.deepEqual(await f.create().start(),{ok:false,error:'unavailable'});assert.equal(f.signals.eventNames().length,0);assert.equal(f.stats.closes,1);assert.deepEqual(f.stats.exits,[]);
});
test('closed sockets do not finish SIGTERM while a detached runtime operation still holds its host slot',async()=>{
  const f=fixture(),entry=f.create();f.controls.holdRuntimeIdle=true;await entry.start();f.signals.emit('SIGTERM');assert.equal(f.stats.idleWaits,0);f.finishClose();assert.equal(f.stats.idleWaits,1);let drained=false;const stopped=entry.dispose().then(()=>{drained=true;});await tick();assert.equal(drained,false);assert.deepEqual(f.stats.exits,[]);assert.equal(f.timers.size,1);f.finishRuntimeIdle();await stopped;assert.equal(drained,true);assert.deepEqual(f.stats.exits,[0]);assert.equal(f.timers.size,0);
});
test('a detached runtime after socket close is still capped by the same nine-second deadline',async()=>{
  const f=fixture(),entry=f.create();f.controls.holdRuntimeIdle=true;await entry.start();f.signals.emit('SIGTERM');f.finishClose();assert.equal(f.stats.idleWaits,1);f.deadline();await entry.dispose();assert.deepEqual(f.stats.exits,[1]);assert.deepEqual(f.stats.timerMs,[9000]);f.finishRuntimeIdle();await tick();assert.deepEqual(f.stats.exits,[1]);assert.equal(f.signals.eventNames().length,0);
});
test('host idle failures or missing promise cannot falsely report a graceful drain',async()=>{
  for(const key of ['idleThrow','idleReject','idleNonPromise']){const f=fixture(),entry=f.create();await entry.start();f.controls[key]=true;f.controls.holdClose=false;await entry.dispose();assert.deepEqual(f.stats.exits,[1]);assert.equal(f.stats.idleWaits,1);assert.equal(f.timers.size,0);}
});
test('the enabled idle hook must be an own data function, without evaluating a getter',async()=>{
  const f=fixture();let reads=0;const loadHost=()=>({createCloudRunServer:()=>({enabled:true,server:f.server,get waitForIdle(){reads++;throw Error('synthetic-private-idle-getter');}})});assert.deepEqual(await f.create({loadHost}).start(),{ok:false,error:'unavailable'});assert.equal(reads,0);assert.deepEqual(f.stats.listens,[]);
});
