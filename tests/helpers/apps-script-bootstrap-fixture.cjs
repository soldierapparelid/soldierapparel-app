'use strict';
const Bootstrap=require('../../apps-script-production-bootstrap.js'),Page=require('../../legacy-lifecycle-page.js'),Controller=require('../../legacy-lifecycle-controller.js'),Bridge=require('../../apps-script-lifecycle-bridge.js'),OwnerPage=require('../../legacy-owner-lifecycle-page.js'),OwnerBridge=require('../../apps-script-owner-lifecycle-bridge.js');
const {createLifecycleBrowserFixture}=require('./lifecycle-browser-fixture.cjs'),{createOwnerLifecycleBrowserFixture}=require('./owner-lifecycle-browser-fixture.cjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(division='qc',options={}){
  const native=division==='owner'?createOwnerLifecycleBrowserFixture():createLifecycleBrowserFixture(division),base=native.options||native.bridgeOptions,nodes=[],apps=[],listeners=[],events=[],stats={loads:0,initializations:0,popups:0,signouts:0,watches:0,offs:0,reloads:0};
  class Node {
    constructor(tag){this.tagName=tag;this.ownerDocument=document;this.children=[];this.handlers={};this.attrs={};this._value='';this.textContent='';this.disabled=false;}
    append(...v){this.children.push(...v);}replaceChildren(...v){this.children=v;}
    setAttribute(k,v){this.attrs[k]=v;}addEventListener(k,f){this.handlers[k]=f;}removeEventListener(k,f){if(this.handlers[k]===f)delete this.handlers[k];}
    get value(){return this._value||(this.tagName==='select'?this.children[0]?.value||'':'');}set value(v){this._value=v;}
    click(){if(!this.disabled)return this.handlers.click?.();}
    querySelectorAll(tag){return this.children.flatMap(n=>[...(n.tagName===tag?[n]:[]),...n.querySelectorAll(tag)]);}
  }
  const document={createElement(tag){const n=new Node(tag);nodes.push(n);return n;}},host=document.createElement('main'),auth=native.auth,user=native.user,ready=deferred(),persistence=deferred(),loader=deferred();
  if(options.loggedOut)auth.currentUser=null;
  const config={enabled:true,...native.native.f.binding,deploymentURL:base.deploymentURL,apiKey:'synthetic-public-api-key-0000',authDomain:native.native.f.binding.projectId+'.firebaseapp.com'};
  const sdk={SDK_VERSION:'10.12.2',browserSessionPersistence:{type:'SESSION'},getApps:()=>apps,initializeApp(c,name){stats.initializations++;const app={name,options:{...c}};apps.push(app);return app;},getAuth(app){auth.app=app;return auth;},async setPersistence(a,p){if(a!==auth||p!==sdk.browserSessionPersistence)throw Error();events.push('persistence');if(options.pausePersistence)await persistence.promise;},onAuthStateChanged(a,value,error){stats.watches++;const item={value,error,active:true};listeners.push(item);queueMicrotask(()=>{if(item.active)value(auth.currentUser);});return ()=>{if(item.active){item.active=false;stats.offs++;events.push('auth-off');}};},GoogleAuthProvider:function(){this.providerId='google.com';},signInWithPopup(a,p){if(a!==auth||p.providerId!=='google.com')throw Error();stats.popups++;events.push('popup');return options.popupFailure?Promise.reject(Error('SYNTHETIC_SECRET_POPUP')):Promise.resolve();},async signOut(a){if(a!==auth)throw Error();stats.signouts++;events.push('signout');}};
  let controller,bridge,bridgeOptions;
  const controllerAPI={createLegacyLifecycleController(o){controller=Controller.createLegacyLifecycleController(o);return controller;}},ownerPageAPI={mountLegacyOwnerLifecyclePage:OwnerPage.mountLegacyOwnerLifecyclePage};
  const bridgeAPI={createAppsScriptLifecycleBridge(o){bridgeOptions=o;bridge=Bridge.createAppsScriptLifecycleBridge(o);return bridge;}},ownerBridgeAPI={createAppsScriptOwnerLifecycleBridge(o){bridgeOptions=o;bridge=OwnerBridge.createAppsScriptOwnerLifecycleBridge(o);return bridge;}};
  const dependencies={getConfiguration:()=>config,getScriptRun:()=>base.scriptRun,getPage:()=>Page,getController:()=>controllerAPI,getBridge:()=>bridgeAPI,getOwnerPage:()=>ownerPageAPI,getOwnerBridge:()=>ownerBridgeAPI,indexedDB:base.indexedDB,reload(){stats.reloads++;},sdkLoader(){stats.loads++;return options.pauseLoader?loader.promise:Promise.resolve(sdk);}};
  const args={module:division,document,host},bootstrap=Bootstrap.createBootstrap(dependencies);
  const all=()=>{const visit=n=>[n,...n.children.flatMap(visit)];return visit(host);};
  function emit(value){auth.currentUser=value;for(const l of listeners)if(l.active)l.value(value);}
  return {native,base,document,host,nodes,all,auth,user,config,sdk,stats,events,apps,dependencies,args,bootstrap,loader,persistence,ready,emit,get controller(){return controller;},get bridge(){return bridge;},get bridgeOptions(){return bridgeOptions;},button:id=>nodes.find(n=>n.id===id),text:()=>all().map(n=>n.textContent).join(' ')};
}
module.exports={fixture,deferred};
