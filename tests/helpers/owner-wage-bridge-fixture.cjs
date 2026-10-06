'use strict';
// Synthetic read-only bridge fault fixture. No real Google or database network.
const assert=require('node:assert/strict'),Authority=require('../../server/production-authority.cjs'),Bridge=require('../../production-owner-wage-bridge.js');
const PROJECT='demo-owner-wage-bridge',URL='https://'+PROJECT+'.firebaseio.com',ENDPOINT='https://api.example.invalid/v1/production/session',NOW='2026-10-06T03:00:00.000Z';
const copy=value=>value===undefined?null:JSON.parse(JSON.stringify(value)),tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(role='owner'){
  const workers=[{id:'worker-1',nama:'Synthetic one'},{id:'worker-2',nama:'Synthetic two'}];
  let state=Authority.createAuthority({product:{id:'product-1',series:'Synthetic',namaBarang:'Example',size:'M',cutQuantity:20},cycleId:'cycle-1',workers,assignments:[{id:'assignment-1',workerId:'worker-1',qty:10},{id:'assignment-2',workerId:'worker-2',qty:10}],now:NOW});
  const context={uid:'caller-1',emailVerified:true,provider:'google.com',profile:{active:true,owner:true},now:NOW};
  state=Authority.applyCommand(state,context,{kind:'sewing',requestId:'synthetic-sew',productId:'product-1',cycleId:'cycle-1',expectedRevision:state.revision,payload:{id:'sewing-1',assignmentId:'assignment-1',tanggal:'2026-10-06',good:10,reject:0}}).state;
  const tariff={source:'private-verified-tariff',verified:true,workerId:'worker-1',productId:'product-1',cycleId:'cycle-1',countId:'count-1',workDate:'2026-10-06',basisAt:NOW,effectiveAt:'2026-01-01T00:00:00.000Z',tariffVersion:'synthetic-tariff-1',currency:'IDR',rate:100,selectedAt:NOW};
  state=Authority.applyCommand(state,{...context,selectedTariffs:{'count-1':tariff}},{kind:'count',requestId:'synthetic-count',productId:'product-1',cycleId:'cycle-1',expectedRevision:state.revision,payload:{id:'count-1',assignmentId:'assignment-1',tanggal:'2026-10-06',jumlah:10}}).state;
  const profile=role==='owner'?{active:true,owner:true}:role==='qc'?{active:true,owner:false,modules:{qc:true}}:{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}};
  const session={schemaVersion:1,projectId:PROJECT,databaseURL:URL,tenantId:'tenant-1',uid:'caller-1',grantRevision:1,profile,cycles:[{productId:'product-1',cycleId:'cycle-1'}],workerLabels:[{productId:'product-1',cycleId:'cycle-1',workers:workers.map(w=>({workerId:w.id,label:w.nama}))}]};
  if(role==='jahit')session.workerLabels[0].workers=session.workerLabels[0].workers.slice(0,1);
  const grant={revision:1,profile},projection=copy(Authority.project(state)),subscribers=new Map(),authSubscribers=new Set(),clears=[],catalogs=[],views=[];
  const stats={fetch:0,tokens:0,refs:0,unsubscribes:0,writes:0,refPaths:[],fetchOptions:[],readerCancels:0};
  const controls={tokenGate:null,fetchGate:null,token:'header.payload.signature',sessionMutate:null,rawSession:null,responseMutate:null,responseFactory:null,syncWatch:false,holdPaths:new Set(),watchNever:false,watchFail:false,watchMismatch:false,badRefURL:false,refThrow:false,onValueThrow:false,authFailure:false};
  const app={options:{projectId:PROJECT,databaseURL:URL}},database={app};
  const user={uid:'caller-1',emailVerified:true,providerData:[{providerId:'google.com'}],async getIdToken(force){assert.equal(force,true);stats.tokens++;if(controls.tokenGate)await controls.tokenGate();return controls.token;}};
  const auth={app,currentUser:user};
  function read(path){
    const base='authorityTenants/tenant-1/grants/caller-1/';if(path.startsWith(base)){let value=grant;for(const key of path.slice(base.length).split('/'))value=value?.[key];return copy(value);}
    const canonical='authorityTenants/tenant-1/products/product-1/cycles/cycle-1/wire/projection/';if(path.startsWith(canonical)){let value=projection;for(const key of path.slice(canonical.length).split('/'))value=value?.[key];return copy(value);}
    throw Error('unexpected_synthetic_read');
  }
  const sdk={
    ref(db,path){assert.equal(db,database);stats.refs++;stats.refPaths.push(path);if(controls.refThrow)throw Error('synthetic-private-reference-error');return {path,toString:()=>controls.badRefURL?'https://foreign.example.invalid/'+path:URL+'/'+path};},
    onValue(ref,next,failed){
      if(controls.onValueThrow)throw Error('synthetic-private-subscription-error');const group=subscribers.get(ref.path)||new Set(),entry={next,failed};subscribers.set(ref.path,group);group.add(entry);
      const emit=()=>{if(controls.watchFail)failed(Error('synthetic-private-read-error'));else next({val:()=>controls.watchMismatch?'synthetic-mismatch':read(ref.path)});};
      if(!controls.watchNever&&!controls.holdPaths.has(ref.path)){if(controls.syncWatch)emit();else queueMicrotask(emit);}
      let closed=false;return ()=>{if(closed)return;closed=true;stats.unsubscribes++;group.delete(entry);if(!group.size)subscribers.delete(ref.path);};
    },
    onAuthStateChanged(a,next,failed){assert.equal(a,auth);authSubscribers.add(next);if(controls.authFailure)failed(Error('synthetic-private-auth-error'));else queueMicrotask(()=>next(auth.currentUser));return ()=>authSubscribers.delete(next);},
    set(){stats.writes++;throw Error('browser_write_forbidden');},update(){stats.writes++;throw Error('browser_write_forbidden');}
  };
  function response(status=200,raw=JSON.stringify({ok:true,session}),bytes){
    bytes=bytes||new TextEncoder().encode(raw);return {url:ENDPOINT,status,type:'cors',redirected:false,headers:new Headers({'Content-Type':'application/json; charset=utf-8','Content-Length':String(bytes.length)}),body:new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();},cancel(){stats.readerCancels++;}})};
  }
  async function fetch(url,init){
    assert.equal(url,ENDPOINT);stats.fetch++;stats.fetchOptions.push(init);assert.equal(init.method,'GET');assert.equal(init.credentials,'omit');assert.equal(init.mode,'cors');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.equal(init.referrerPolicy,'no-referrer');assert.equal(init.body,undefined);
    if(controls.fetchGate)await controls.fetchGate(init);
    if(controls.responseFactory)return controls.responseFactory();const data={ok:true,session:copy(session)};if(controls.sessionMutate)controls.sessionMutate(data);let raw=JSON.stringify(data);if(controls.rawSession)raw=controls.rawSession(raw);let result=response(200,raw);if(controls.responseMutate)result=controls.responseMutate(result)||result;return result;
  }
  const options={enabled:true,projectId:PROJECT,databaseURL:URL,tenantId:'tenant-1',endpointURL:ENDPOINT,auth,database,sdk,fetch,isCurrent:()=>true,onCatalog:value=>catalogs.push(value),onView:value=>views.push(value),onClear:code=>clears.push(code)},create=extra=>Bridge.createBridge({...options,...extra});
  function emit(path){for(const {next} of [...(subscribers.get(path)||[])])next({val:()=>read(path)});}
  function notify(){for(const path of [...subscribers.keys()])emit(path);}
  function switchUser(newUser={...user,uid:'caller-2'}){auth.currentUser=newUser;for(const next of [...authSubscribers])next(newUser);}
  return {create,options,auth,database,sdk,user,session,grant,projection,stats,controls,clears,catalogs,views,subscribers,authSubscribers,read,emit,notify,switchUser,response};
}
module.exports={fixture,tick,PROJECT,URL,ENDPOINT,NOW};
