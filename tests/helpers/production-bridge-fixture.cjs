'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),Bridge=require('../../production-bridge.js'),Authority=require('../../server/production-authority.cjs'),Runtime=require('../../server/production-runtime.cjs'),{fakeIndexedDB}=require('./command-indexeddb-fixture.cjs');
const PROJECT='demo-bridge-proof',URL='https://'+PROJECT+'.firebaseio.com',ENDPOINT='https://server.example.invalid/v1/production/commands',ORIGIN='https://soldier.example.invalid',NOW='2026-10-05T03:00:00.000Z';
const copy=v=>v===undefined?null:JSON.parse(JSON.stringify(v)),tick=()=>new Promise(r=>setImmediate(r));
function fixture(role='jahit'){
  const state=Authority.createAuthority({product:{id:'product-1',series:'Synthetic',namaBarang:'Example',size:'M',cutQuantity:10},cycleId:'cycle-1',workers:[{id:'worker-1',nama:'Synthetic partner'}],assignments:[{id:'assignment-1',workerId:'worker-1',qty:10}],now:NOW});
  const profile=role==='jahit'?{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}}:{active:true,owner:false,modules:{qc:true}};
  const tenant={schemaVersion:1,projectId:PROJECT,tenantId:'tenant-1',grants:{'caller-1':{revision:0,profile}},products:{'product-1':{cycles:{'cycle-1':{config:{revision:0,active:true,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'},tariffInputs:{revision:0,policy:{version:'policy-1',kind:'jakarta-fixed-local-time',hour:8,minute:0},historyByWorker:{'worker-1':{'tariff-1':{effectiveAt:'2026-01-01T00:00:00.000Z',currency:'IDR',rate:100}}}},wire:Authority.encodeStorage(state)}}}}};
  const roots=new Map([['authorityTenants/tenant-1',tenant]]),subscribers=new Map(),authSubscribers=new Set(),stats={fetch:0,tokens:0,refs:0,posts:0},controls={loseResponse:false,sessionGate:null,sessionMutate:null,rawSession:null,tokenGate:null};
  const read=path=>{const parts=path.split('/'),root=roots.get(parts.splice(0,2).join('/'));let value=root;for(const p of parts)value=value&&value[p];return copy(value);};
  const notify=()=>{for(const [path,callbacks]of subscribers)for(const cb of callbacks)queueMicrotask(()=>cb({val:()=>read(path)}));};
  const snapshot=v=>({val:()=>copy(v)}),app={options:{projectId:PROJECT,databaseURL:URL}};
  const database={app,ref(path){return {toString:()=>URL+'/'+path,get:async()=>snapshot(roots.get(path)??null),on(event,callback){callback(snapshot(roots.get(path)??null));},off(){},async transaction(update){const next=update(copy(roots.get(path)??null));if(next===undefined)return {committed:false,snapshot:snapshot(roots.get(path)??null)};roots.set(path,copy(next));notify();return {committed:true,snapshot:snapshot(next)};}};}};
  const serverAuth={app,verifyIdToken:async(token,revoked)=>{assert.equal(revoked,true);assert.equal(token,'header.payload.signature');return {uid:'caller-1',sub:'caller-1',aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,email_verified:true,firebase:{sign_in_provider:'google.com'},exp:Date.parse(NOW)/1000+3600};}};
  const runtime=Runtime.createProductionRuntime({enabled:true,projectId:PROJECT,databaseURL:URL,tenantId:'tenant-1',database,auth:serverAuth,allowedOrigins:[ORIGIN],clock:()=>NOW,policy:{rateWindowMs:60000,rateLimit:100,deadlineMs:1000,maxInFlight:4}});
  const user={uid:'caller-1',emailVerified:true,providerData:[{providerId:'google.com'}],async getIdToken(force){assert.equal(force,true);stats.tokens++;if(controls.tokenGate)await controls.tokenGate();return 'header.payload.signature';}};
  const auth={app,currentUser:user};
  const sdk={ref(db,path){stats.refs++;assert.equal(db,database);return {path,toString:()=>db.app.options.databaseURL+'/'+path};},onValue(ref,callback){if(!subscribers.has(ref.path))subscribers.set(ref.path,new Set());const group=subscribers.get(ref.path);group.add(callback);queueMicrotask(()=>callback({val:()=>read(ref.path)}));return ()=>{group.delete(callback);if(!group.size)subscribers.delete(ref.path);};},onAuthStateChanged(a,callback){assert.equal(a,auth);authSubscribers.add(callback);queueMicrotask(()=>callback(auth.currentUser));return ()=>authSubscribers.delete(callback);}};
  const response=(url,status,raw)=>{const bytes=new TextEncoder().encode(raw);return {url,status,type:'cors',redirected:false,headers:new Headers({'Content-Type':'application/json; charset=utf-8','Content-Length':String(bytes.length)}),body:new ReadableStream({start(c){c.enqueue(bytes);c.close();}})};};
  const fetch=async(url,init)=>{
    stats.fetch++;if(init.method==='POST')stats.posts++;else if(controls.sessionGate)await controls.sessionGate();
    assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');const headers={origin:ORIGIN,authorization:init.headers.Authorization};if(init.headers['Content-Type'])headers['content-type']=init.headers['Content-Type'];const req={url:new globalThis.URL(url).pathname,method:init.method,headers,rawHeaders:Object.entries(headers).flat(),rawBody:init.body===undefined?Buffer.alloc(0):Buffer.from(init.body)};
    const res={setHeader(){},end(raw){this.raw=raw;this.writableEnded=true;}};await runtime.handler(req,res);stats.lastStatus=res.statusCode;stats.lastError=JSON.parse(res.raw).error||'none';
    if(init.method==='POST'&&controls.loseResponse){controls.loseResponse=false;throw Error('synthetic-lost-response');}
    if(init.method==='GET'&&controls.sessionMutate){const result=JSON.parse(res.raw);controls.sessionMutate(result);res.raw=JSON.stringify(result);}
    const raw=init.method==='GET'&&controls.rawSession!==null?(typeof controls.rawSession==='function'?controls.rawSession(res.raw):controls.rawSession):res.raw;
    return response(url,res.statusCode,raw);
  };
  const idb=fakeIndexedDB(),views=[],clears=[];
  const options={enabled:true,projectId:PROJECT,databaseURL:URL,tenantId:'tenant-1',endpointURL:ENDPOINT,auth,database,sdk,indexedDB:idb.api,fetch,isCurrent:()=>true,onView:v=>views.push(v),onClear:code=>clears.push(code)};
  const create=(extra={})=>Bridge.createProductionBridge({...options,...extra}),decoded=()=>Authority.decodeStorage(roots.get('authorityTenants/tenant-1').products['product-1'].cycles['cycle-1'].wire);
  const command=()=>({requestId:'request-1',productId:'product-1',cycleId:'cycle-1',expectedRevision:0,kind:'sewing',payload:{id:'sewing-1',assignmentId:'assignment-1',tanggal:'2026-10-05',good:10,reject:0}});
  function switchUser(){auth.currentUser={...user,uid:'caller-2'};for(const cb of authSubscribers)cb(auth.currentUser);}
  return {create,options,roots,tenant,stats,controls,idb,views,clears,subscribers,authSubscribers,auth,database,command,decoded,notify,switchUser,response};
}

module.exports={fixture,PROJECT,URL,ENDPOINT,NOW,tick};
