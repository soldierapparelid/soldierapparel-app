'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Bootstrap=require('../production-owner-wage-bootstrap.js');
const CONFIG={enabled:true,projectId:'demo-bootstrap-proof',databaseURL:'https://demo-bootstrap-proof.firebaseio.com',tenantId:'tenant-1',endpointURL:'https://server.example.invalid/v1/production/session',apiKey:'synthetic-public-web-key',authDomain:'demo-bootstrap-proof.firebaseapp.com'};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(options={}){
  const nodes=[];const document={createElement(tag){const listeners=new Map(),node={tagName:tag.toUpperCase(),ownerDocument:document,children:[],textContent:'',disabled:false,attrs:{},setAttribute(k,v){this.attrs[k]=v;},replaceChildren(...children){this.children=children;},addEventListener(k,f){listeners.set(k,f);},removeEventListener(k,f){if(listeners.get(k)===f)listeners.delete(k);},click(){if(!this.disabled)listeners.get('click')?.();}};nodes.push(node);return node;}};
  const pageHandlers=new Map();document.defaultView={addEventListener(k,f){pageHandlers.set(k,f);},removeEventListener(k,f){if(pageHandlers.get(k)===f)pageHandlers.delete(k);}};
  const host=document.createElement('main'),configuration=options.mutableConfig?{...CONFIG}:Object.freeze({...CONFIG}),mode={canonical:true,module:'owner-wage',configuration};
  const stats={loads:0,inits:0,auth:0,db:0,persistence:0,watches:0,offs:0,popups:0,signouts:0,mounts:0,disposes:0,holds:0,bridges:0,reloads:0},events=[],listeners=[],apps=[];
  const persistence=deferred(),ready=deferred(),signout=deferred(),loader=deferred();let mountedOptions,bridgeOptions;
  const auth={currentUser:options.user||null},database={};
  const sdk={SDK_VERSION:'10.12.2',browserSessionPersistence:{type:'SESSION'},getApps:()=>apps,initializeApp(config,name){stats.inits++;const app={name,options:{...config}};apps.push(app);return app;},getAuth(app){stats.auth++;auth.app=app;return auth;},getDatabase(app){stats.db++;database.app=app;return database;},setPersistence(a,p){stats.persistence++;assert.equal(a,auth);assert.equal(p,sdk.browserSessionPersistence);events.push('persistence');return options.pausePersistence?persistence.promise:Promise.resolve();},onAuthStateChanged(a,value,error){assert.equal(a,auth);stats.watches++;const item={value,error,active:true};listeners.push(item);const emit=()=>{if(item.active)value(auth.currentUser);};if(options.syncAuth)emit();else queueMicrotask(emit);return ()=>{if(item.active){stats.offs++;events.push('auth-off');item.active=false;}};},GoogleAuthProvider:function(){this.providerId='google.com';},signInWithPopup(a,p){assert.equal(a,auth);assert.equal(p.providerId,'google.com');stats.popups++;events.push('popup');return options.popupFailure?Promise.reject(Error('synthetic-token-email-private')):Promise.resolve({user:auth.currentUser});},signOut(a){assert.equal(a,auth);stats.signouts++;events.push('signout');return options.pauseSignout?signout.promise:Promise.resolve();},ref(){throw Error('Bootstrap cannot itself read business data');},onValue(){throw Error('Bootstrap cannot itself subscribe business data');}};
  const ui={mount(args){stats.mounts++;events.push('mount');mountedOptions=args;assert.equal(args.document,document);assert.equal(Object.hasOwn(args,'module'),false);args.createBridge({onCatalog(){events.push('catalog');},onView(){events.push('view');},onClear(){events.push('view-clear');}});if(options.syncClear)bridgeOptions.onClear('read_failed');const result={dispose(){stats.disposes++;events.push('ui-dispose');},readyPromise:options.rejectReady?Promise.reject(Error('synthetic-private-ready-error')):options.pauseReady?ready.promise:Promise.resolve(options.uiFailure?{ok:false,error:'unavailable'}:{ok:true})};return result;}};
  const bridge={createBridge(args){stats.bridges++;bridgeOptions=args;return Object.freeze({connect:async()=>({ok:true}),dispose(){}});}};
  const dependencies={getPage:()=>mode,getUI:()=>ui,getBridge:()=>bridge,sdkLoader:()=>{stats.loads++;return options.pauseLoader?loader.promise:Promise.resolve(sdk);},fetch:()=>{throw Error('Bootstrap cannot itself fetch');},reload(){stats.reloads++;}};
  const args={module:'owner-wage',configuration,document,host,hold(){stats.holds++;events.push('hold');}},bootstrap=Bootstrap.createBootstrap(dependencies);
  function emit(user){auth.currentUser=user;for(const item of listeners)if(item.active)item.value(user);}
  function error(){for(const item of listeners)if(item.active)item.error(Error('synthetic-token-private'));}
  return {bootstrap,args,host,nodes,document,configuration,mode,stats,events,apps,sdk,auth,database,ui,bridge,dependencies,persistence,ready,signout,loader,emit,error,pageHandlers,get mounted(){return mountedOptions;},get bridgeOptions(){return bridgeOptions;}};
}
const user=(uid='caller-1')=>({uid,emailVerified:true,providerData:[{providerId:'google.com'}],getIdToken:async()=> 'header.payload.signature'});
const button=(f,id)=>f.nodes.find(node=>node.id===id);
function terminal(f){assert.deepEqual(f.host.children.map(n=>n.tagName),['H1','P','BUTTON']);assert.equal(f.host.children[1].id,'soldier-production-terminal');assert.equal(f.host.children[2].id,'soldier-production-reload');assert.equal(f.host.children.some(n=>n.id==='soldier-production-bound-form'),false);const prior=f.stats.reloads;f.host.children[2].click();assert.equal(f.stats.reloads,prior+1);}

test('browser global exposes only fixed start without invoking imports or collaborators',async()=>{
  const root={};vm.runInNewContext(fs.readFileSync(require.resolve('../production-owner-wage-bootstrap.js'),'utf8'),root);assert.deepEqual(Object.keys(root.SoldierProductionOwnerWageBootstrap),['start']);const d=Object.getOwnPropertyDescriptor(root,'SoldierProductionOwnerWageBootstrap');assert.equal(d.writable,false);assert.equal(d.configurable,false);assert.equal((await root.SoldierProductionOwnerWageBootstrap.start({sdkLoader:()=>{throw Error();}})).ok,false);
});
test('wrong/disabled/noncanonical config, aliases, extra runtime overrides and getters never initialize SDK',async()=>{
  for(const change of [f=>{f.mode.canonical=false;},f=>{f.args.configuration={...f.configuration};},f=>{f.mode.configuration=f.args.configuration={...CONFIG,enabled:false};},f=>{f.args.sdkLoader=()=>f.sdk;},f=>{f.mode.configuration=f.args.configuration={...CONFIG,endpointURL:CONFIG.endpointURL+'?override=1'};},f=>{f.args.module='potong';}]){const f=fixture();change(f);assert.equal((await f.bootstrap.start(f.args)).ok,false);assert.equal(f.stats.loads,0);assert.equal(f.stats.holds,0);assert.equal(f.host.children.length,0);}
  const f=fixture();let touched=0;Object.defineProperty(f.args,'configuration',{enumerable:true,get(){touched++;return f.configuration;}});assert.equal((await f.bootstrap.start(f.args)).ok,false);assert.equal(touched,0);assert.equal(f.stats.loads,0);
});
test('initial null Auth keeps visible login pending without hold or popup; login popup requires the click task',async()=>{
  const f=fixture();let completed=false;const start=f.bootstrap.start(f.args).then(r=>{completed=true;return r;});await flush();assert.equal(completed,false);assert.equal(f.stats.holds,0);assert.equal(f.stats.mounts,0);assert.equal(f.stats.popups,0);assert.equal(button(f,'soldier-production-login').disabled,false);assert.equal(f.stats.persistence,1);assert.equal(f.stats.watches,1);
  assert.deepEqual(f.apps[0].options,{projectId:CONFIG.projectId,databaseURL:CONFIG.databaseURL,apiKey:CONFIG.apiKey,authDomain:CONFIG.authDomain});assert.equal(f.apps[0].name,'soldier-owner-wage-v1');
  button(f,'soldier-production-login').click();assert.equal(f.stats.popups,1);f.emit(user());assert.equal((await start).ok,true);assert.equal(f.stats.holds,0);
});
test('session persistence finishes before watch/login and successful start waits for UI ready with exact fixed bridge scope',async()=>{
  const f=fixture({pausePersistence:true,pauseReady:true,user:user()});let completed=false;const start=f.bootstrap.start(f.args).then(r=>{completed=true;return r;});await flush();assert.equal(f.stats.watches,0);assert.equal(button(f,'soldier-production-login').disabled,true);f.persistence.resolve();await flush();assert.equal(f.stats.mounts,1);assert.equal(completed,false);assert.equal(f.mounted.isCurrent(),true);assert.equal(f.bridgeOptions.auth,f.auth);assert.equal(f.bridgeOptions.database,f.database);assert.equal(f.bridgeOptions.endpointURL,CONFIG.endpointURL);assert.equal(f.bridgeOptions.tenantId,CONFIG.tenantId);assert.deepEqual(Object.keys(f.bridgeOptions.sdk).sort(),['onAuthStateChanged','onValue','ref']);f.ready.resolve({ok:true});const result=await start;assert.equal(result.ok,true);assert.equal(typeof result.dispose,'function');result.dispose();assert.equal(f.stats.holds,0);assert.equal(f.host.children.length,0);
});
test('unverified/non-Google initial accounts stay at login and never bind a form',async()=>{
  for(const value of [{...user(),emailVerified:false},{...user(),providerData:[{providerId:'password'}]},{...user(),uid:'../unsafe'}]){const f=fixture({user:value});const pending=f.bootstrap.start(f.args);await flush();assert.equal(f.stats.mounts,0);assert.equal(f.stats.holds,0);f.emit(user());assert.equal((await pending).ok,true);}
});
test('popup errors expose fixed text only and remain retryable at login without terminal hold',async()=>{
  const f=fixture({popupFailure:true}),pending=f.bootstrap.start(f.args);await flush();button(f,'soldier-production-login').click();await flush();assert.equal(f.stats.holds,0);assert.equal(button(f,'soldier-production-login').disabled,false);assert.equal(f.nodes.some(n=>n.textContent.includes('synthetic-token-email-private')),false);button(f,'soldier-production-login').click();assert.equal(f.stats.popups,2);f.emit(user());assert.equal((await pending).ok,true);
});
test('account/logout/provider changes during ready dispose before hold; late ready cannot restore the previous business UI',async()=>{
  for(const replacement of [null,user('caller-2'),{...user(),emailVerified:false},{...user(),providerData:[{providerId:'password'}]}]){const f=fixture({user:user(),pauseReady:true}),pending=f.bootstrap.start(f.args);await flush();assert.equal(f.stats.mounts,1);f.emit(replacement);assert.deepEqual(await pending,{ok:false,error:'access_denied'});assert.equal(f.stats.disposes,1);assert.equal(f.stats.holds,1);assert.ok(f.events.indexOf('ui-dispose')<f.events.indexOf('hold'));terminal(f);assert.equal(f.bridgeOptions.isCurrent(),false);f.ready.resolve({ok:true});await flush();terminal(f);assert.equal(f.stats.mounts,1);}
});
test('user logout clears and unsubscribes before signOut awaits; repeat/late Auth cannot reopen',async()=>{
  const f=fixture({user:user(),pauseSignout:true}),result=await f.bootstrap.start(f.args);assert.equal(result.ok,true);const logout=button(f,'soldier-production-logout');logout.click();assert.equal(f.stats.disposes,1);assert.equal(f.stats.offs,1);assert.equal(f.stats.holds,1);terminal(f);assert.ok(f.events.indexOf('ui-dispose')<f.events.indexOf('signout'));assert.ok(f.events.indexOf('auth-off')<f.events.indexOf('signout'));f.emit(user('caller-2'));logout.click();f.signout.resolve();await flush();assert.equal(f.stats.signouts,1);assert.equal(f.stats.mounts,1);
});
test('source binding changes during SDK loading/persistence or after Auth bind hold before business work',async()=>{
  const loading=fixture({pauseLoader:true}),pending=loading.bootstrap.start(loading.args);loading.mode.configuration={...loading.configuration};loading.loader.resolve(loading.sdk);assert.equal((await pending).ok,false);assert.equal(loading.stats.inits,0);assert.equal(loading.stats.mounts,0);
  const persistence=fixture({pausePersistence:true}),waiting=persistence.bootstrap.start(persistence.args);await flush();persistence.apps[0].options.databaseURL='https://foreign.firebaseio.com';persistence.persistence.resolve();assert.equal((await waiting).ok,false);assert.equal(persistence.stats.watches,0);
  const f=fixture({user:user()}),result=await f.bootstrap.start(f.args);assert.equal(result.ok,true);f.apps[0].options.apiKey='changed-public-config';f.emit(user());assert.equal(f.stats.holds,1);terminal(f);assert.equal(f.bridgeOptions.isCurrent(),false);
});
test('dedicated app reuse checks config before Auth and never adopts an unrelated/default app',async()=>{
  const f=fixture({user:user()});f.apps.push({name:'[DEFAULT]',options:{projectId:'unrelated'}});assert.equal((await f.bootstrap.start(f.args)).ok,true);assert.equal(f.stats.inits,1);
  const bad=fixture();bad.apps.push({name:'soldier-owner-wage-v1',options:{...CONFIG,apiKey:'different'}});assert.equal((await bad.bootstrap.start(bad.args)).ok,false);assert.equal(bad.stats.auth,0);assert.equal(bad.stats.db,0);assert.equal(bad.stats.inits,0);
});
test('single-flight starts and argument snapshot cannot be redirected by later caller aliases',async()=>{
  const f=fixture({pauseLoader:true}),first=f.bootstrap.start(f.args);assert.equal(f.bootstrap.start(f.args),first);const wrong={...f.args,module:'qc'};assert.equal((await f.bootstrap.start(wrong)).ok,false);f.args.module='qc';f.loader.resolve(f.sdk);await flush();f.emit(user());assert.equal((await first).ok,true);assert.equal(Object.hasOwn(f.mounted,'module'),false);assert.equal(f.stats.loads,1);assert.equal(f.stats.mounts,1);
});
test('synchronous initial UI clear consumes readiness and disposes its returned handle even before assignment',async()=>{
  for(const rejectReady of [false,true]){const f=fixture({user:user(),syncAuth:true,syncClear:true,rejectReady});assert.equal((await f.bootstrap.start(f.args)).ok,false);await flush();assert.equal(f.stats.disposes,1);assert.equal(f.stats.offs,1);assert.equal(f.stats.holds,1);terminal(f);}
});
test('post-ready revocation clears business fields and leaves a fixed usable reload message',async()=>{
  const f=fixture({user:user()});assert.equal((await f.bootstrap.start(f.args)).ok,true);f.bridgeOptions.onClear('access_denied');assert.equal(f.stats.disposes,1);assert.equal(f.stats.offs,1);assert.equal(f.stats.holds,1);terminal(f);f.emit(user('caller-2'));assert.equal(f.stats.mounts,1);terminal(f);
});
test('loading and exact selection clear codes preserve the account-bound form; arbitrary other codes close it',async()=>{
  const f=fixture({user:user()});assert.equal((await f.bootstrap.start(f.args)).ok,true);
  for(const code of ['loading','selection_changed','selection_cleared']){f.bridgeOptions.onClear(code);assert.equal(f.stats.disposes,0);assert.equal(f.stats.holds,0);assert.equal(f.bridgeOptions.isCurrent(),true);assert.ok(f.host.children.some(n=>n.id==='soldier-production-bound-form'));}
  f.bridgeOptions.onCatalog({cycles:[]});f.bridgeOptions.onView({synthetic:true});assert.equal(f.events.filter(v=>v==='catalog').length,1);assert.equal(f.events.filter(v=>v==='view').length,1);
  f.bridgeOptions.onClear('selection-changed');assert.equal(f.stats.disposes,1);assert.equal(f.stats.holds,1);terminal(f);
  const before=f.events.length;f.bridgeOptions.onCatalog({cycles:[]});f.bridgeOptions.onView({synthetic:true});assert.equal(f.events.length,before);assert.equal(f.bridgeOptions.isCurrent(),false);
});
test('wage bootstrap receives only fixed read-only bridge capabilities with no storage collaborators',async()=>{
  const f=fixture({user:user()});assert.equal((await f.bootstrap.start(f.args)).ok,true);
  assert.deepEqual(Object.keys(f.bridgeOptions).sort(),['auth','database','databaseURL','enabled','endpointURL','fetch','isCurrent','onCatalog','onClear','onView','projectId','sdk','tenantId'].sort());
  assert.equal(f.bridgeOptions.endpointURL.endsWith('/v1/production/session'),true);
  const source=fs.readFileSync(require.resolve('../production-owner-wage-bootstrap.js'),'utf8');assert.doesNotMatch(source,/indexedDB|localStorage|sessionStorage|createStore|bridge\.(?:prepare|send|pending|resolve)\(/);assert.equal((source.match(/https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\//g)||[]).length,3);
});
test('pagehide clears financial UI and subscriptions before back-cache, and late Auth/readiness cannot restore it',async()=>{
  const f=fixture({user:user()});assert.equal((await f.bootstrap.start(f.args)).ok,true);const hide=f.pageHandlers.get('pagehide');assert.equal(typeof hide,'function');hide();assert.equal(f.stats.disposes,1);assert.equal(f.stats.offs,1);assert.equal(f.stats.holds,1);assert.equal(f.pageHandlers.has('pagehide'),false);terminal(f);f.emit(user());f.bridgeOptions.onView({synthetic:true});assert.equal(f.stats.mounts,1);terminal(f);
  const pending=fixture({user:user(),pauseReady:true}),start=pending.bootstrap.start(pending.args);await flush();pending.pageHandlers.get('pagehide')();assert.equal((await start).ok,false);pending.ready.resolve({ok:true});await flush();assert.equal(pending.stats.mounts,1);assert.equal(pending.stats.disposes,1);terminal(pending);
});
test('failed UI ready, SDK load/persistence and Auth callbacks are fixed errors with cleanup',async()=>{
  const ui=fixture({user:user(),uiFailure:true});assert.deepEqual(await ui.bootstrap.start(ui.args),{ok:false,error:'unavailable'});assert.equal(ui.stats.disposes,1);assert.equal(ui.stats.holds,1);
  const sdk=fixture();sdk.sdk.SDK_VERSION='other-version';assert.deepEqual(await sdk.bootstrap.start(sdk.args),{ok:false,error:'unavailable'});assert.equal(sdk.stats.inits,0);
  const persistence=fixture();persistence.sdk.setPersistence=async()=>{throw Error('synthetic-private-error');};assert.deepEqual(await persistence.bootstrap.start(persistence.args),{ok:false,error:'unavailable'});assert.equal(persistence.stats.watches,0);assert.equal(persistence.nodes.some(n=>n.textContent.includes('synthetic-private-error')),false);
  const auth=fixture(),pending=auth.bootstrap.start(auth.args);await flush();auth.error();assert.deepEqual(await pending,{ok:false,error:'unavailable'});assert.equal(auth.stats.offs,1);
});

