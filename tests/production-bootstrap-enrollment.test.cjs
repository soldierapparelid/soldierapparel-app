'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Bootstrap=require('../production-bootstrap.js'),Bridge=require('../production-bridge.js'),Form=require('../production-form-ui.js');
const {fixture,PROJECT,URL,ENDPOINT,tick}=require('./helpers/production-bridge-fixture.cjs');
const SESSION='https://server.example.invalid/v1/production/session',CLAIM='https://server.example.invalid/v1/production/enrollment/claim';
function deferred(){let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve};}
class Element{
  constructor(tag,document){this.tagName=tag.toUpperCase();this.ownerDocument=document;this.children=[];this.parentNode=null;this.attributes=new Map();this.handlers=new Map();this.textContent='';this.value='';this.hidden=false;this.disabled=false;this.checked=false;}
  appendChild(node){this.children.push(node);node.parentNode=this;return node;}
  replaceChildren(...nodes){for(const n of this.children)n.parentNode=null;this.children=[];for(const n of nodes)this.appendChild(n);}
  setAttribute(k,v){this.attributes.set(k,String(v));}
  removeAttribute(k){this.attributes.delete(k);}
  getAttribute(k){return this.attributes.get(k)??null;}
  addEventListener(k,fn){this.handlers.set(k,fn);}
  removeEventListener(k,fn){if(this.handlers.get(k)===fn)this.handlers.delete(k);}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null;}
  click(){let node=this;for(;node;node=node.parentNode)if(node.disabled)return;this.handlers.get('click')?.();}
  set innerHTML(v){throw Error('No unsafe HTML');}
}
const all=node=>[node,...node.children.flatMap(all)];
async function drain(){for(let i=0;i<3;i++)await tick();}
function setup({enabled=true,enrollment=true,missing=true,mutable=false,nullUser=false}={}){
  const f=fixture(),original=f.auth.currentUser,grant=structuredClone(f.tenant.grants['caller-1']),calls=[],control={},counts={reauth:0,popup:0,hold:0,imports:0,bridge:0,mount:0};
  if(missing)delete f.tenant.grants['caller-1'];if(nullUser)f.auth.currentUser=null;
  const document={createElement:tag=>new Element(tag,document)},host=document.createElement('main'),apps=[];
  const value={enabled,projectId:PROJECT,databaseURL:URL,tenantId:'tenant-1',endpointURL:ENDPOINT,apiKey:'synthetic-public-web-key',authDomain:PROJECT+'.firebaseapp.com'};
  if(enrollment!=='absent')value.enrollmentEnabled=enrollment;
  const configuration=mutable?value:Object.freeze(value),mode={canonical:true,module:'jahit',configuration};
  const sdk={SDK_VERSION:'10.12.2',browserSessionPersistence:{type:'SESSION'},getApps:()=>apps,initializeApp(options,name){const app={name,options};apps.push(app);return app;},getAuth(app){f.auth.app=app;return f.auth;},getDatabase(app){f.database.app=app;return f.database;},setPersistence:async()=>{},onAuthStateChanged:f.options.sdk.onAuthStateChanged,ref:f.options.sdk.ref,onValue:f.options.sdk.onValue,GoogleAuthProvider:function(){this.providerId='google.com';},signInWithPopup(auth,provider){counts.popup++;assert.equal(auth,f.auth);assert.equal(provider.providerId,'google.com');f.auth.currentUser=original;for(const cb of f.authSubscribers)cb(original);return Promise.resolve({user:original});},reauthenticateWithPopup(user,provider){counts.reauth++;assert.equal(user,original);assert.equal(f.auth.currentUser,user);assert.equal(provider.providerId,'google.com');if(control.reauthThrow)throw Error('SYNTHETIC_PRIVATE_CANARY');return control.reauthPromise||Promise.resolve({user});},signOut:async()=>{f.auth.currentUser=null;}};
  async function fetch(url,init){
    calls.push({url,init});assert.equal(f.idb.stats.opens,0);assert.equal(f.stats.refs,0);
    if(init.method==='GET'){assert.equal(url,SESSION);if(calls.length>1&&control.finalResponse)return control.finalResponse(url);return f.options.fetch(url,init);}
    assert.equal(url,CLAIM);assert.equal(init.method,'POST');assert.equal(init.body,'{}');assert.deepEqual(init.headers,{Authorization:'Bearer header.payload.signature','Content-Type':'application/json'});
    if(control.claimResponse)return control.claimResponse(url);
    f.tenant.grants['caller-1']={...grant,revision:1};return f.response(url,200,'{"ok":true}');
  }
  const bootstrap=Bootstrap.createBootstrap({getPageMode:()=>mode,getUI:()=>({mount(options){counts.mount++;return Form.mount(options);}}),getBridge:()=>({createProductionBridge(options){counts.bridge++;return Bridge.createProductionBridge(options);}}),sdkLoader:async()=>{counts.imports++;return sdk;},indexedDB:f.idb.api,fetch,reload(){}});
  const args={module:'jahit',configuration,document,host,hold(){counts.hold++;}},start=()=>bootstrap.start(args),find=id=>all(host).find(n=>n.id===id),text=()=>all(host).map(n=>n.textContent).join(' ');
  function emit(user){f.auth.currentUser=user;for(const cb of f.authSubscribers)cb(user);}
  return {...f,control,counts,calls,original,configuration,mode,apps,sdk,args,bootstrap,start,find,text,host,emit};
}
function blocked(f,initialized=false){if(!initialized){assert.equal(f.idb.stats.opens,0);assert.equal(f.stats.refs,0);}assert.equal(f.subscribers.size,0);assert.equal(f.authSubscribers.size,0);assert.equal(f.find('soldier-production-bound-form'),undefined);assert.doesNotMatch(f.text(),/SYNTHETIC_PRIVATE|synthetic-public-web-key|header\.payload/);}

test('actual bootstrap, form/controller and bridge require clicked bound Google reauth before claim, fresh session and journal/listeners',async()=>{
  const f=setup({nullUser:true}),pending=f.start();await drain();assert.equal(f.counts.popup,0);f.find('soldier-production-login').click();assert.equal(f.counts.popup,1);await drain();
  assert.deepEqual(f.calls.map(c=>[c.url,c.init.method]),[[SESSION,'GET']]);assert.equal(f.counts.reauth,0);assert.equal(f.idb.stats.opens,0);assert.equal(f.stats.refs,0);assert.equal(f.find('production-cycle').disabled,true);assert.match(f.text(),/Konfirmasi akun Google yang sama/);assert.doesNotMatch(f.text(),/belum terdaftar|unregistered/);
  const confirmation=f.find('soldier-production-enrollment-confirm');confirmation.click();assert.equal(f.counts.reauth,1);confirmation.click();assert.equal(f.counts.reauth,1);
  const result=await pending;assert.equal(result.ok,true);assert.deepEqual(f.calls.map(c=>[c.url,c.init.method]),[[SESSION,'GET'],[CLAIM,'POST'],[SESSION,'GET']]);assert.equal(f.stats.tokens,3);assert.ok(f.idb.stats.opens>0);assert.ok(f.stats.refs>0);assert.equal(f.find('production-cycle').disabled,false);assert.equal(f.find('production-cycle').value,'');assert.equal(f.find('soldier-production-enrollment-confirm'),undefined);assert.equal(f.find('soldier-production-enrollment').hidden,true);assert.equal(f.counts.bridge,1);assert.equal(f.counts.hold,0);result.dispose();blocked(f,true);
});

test('source absent/false flag keeps old GET failure closed; disabled or malformed config never loads SDK',async()=>{
  for(const flag of ['absent',false]){const f=setup({enrollment:flag}),result=await f.start();assert.equal(result.ok,false);assert.equal(f.counts.reauth,0);assert.equal(f.calls.length,1);assert.equal(f.find('soldier-production-enrollment-confirm'),undefined);blocked(f);}
  for(const change of [f=>{f.configuration.enabled=false;},f=>{f.configuration.enrollmentEnabled='true';},f=>{Object.defineProperty(f.configuration,'enrollmentEnabled',{enumerable:true,get(){throw Error('Do not invoke');}});},f=>{f.args.confirmGoogleEnrollment=()=>({ok:true});}]){const f=setup({mutable:true});change(f);assert.equal((await f.start()).ok,false);assert.equal(f.counts.imports,0);assert.equal(f.counts.mount,0);assert.equal(f.calls.length,0);blocked(f);}
});

test('granted session skips new confirmation even with opt-in, preserving the initial GET200 path',async()=>{
  const f=setup({missing:false}),result=await f.start();assert.equal(result.ok,true);assert.equal(f.counts.reauth,0);assert.equal(f.calls.length,1);assert.equal(f.find('soldier-production-enrollment-confirm'),undefined);result.dispose();blocked(f,true);
});

test('cancelled popup, private exception and returned User getter are generic closed failures without POST',async()=>{
  for(const change of [f=>{f.control.reauthPromise=Promise.reject(Error('SYNTHETIC_PRIVATE_CANARY'));f.control.reauthPromise.catch(()=>{});},f=>{f.control.reauthThrow=true;},f=>{f.control.reauthPromise=Promise.resolve({get user(){throw Error('SYNTHETIC_PRIVATE_CANARY');}});}]){const f=setup(),pending=f.start();await drain();change(f);f.find('soldier-production-enrollment-confirm').click();assert.equal((await pending).ok,false);assert.equal(f.calls.length,1);blocked(f);}
});

test('same-UID different User result or replacement, source/config/app drift during reauth never sends claim',async()=>{
  const changes=[{mutate:f=>f.emit({...f.original})},{mutate:f=>{f.configuration.enrollmentEnabled=false;}},{mutate:f=>{f.mode.configuration={...f.configuration};}},{mutate:f=>{f.apps[0].options.databaseURL='https://foreign.firebaseio.com';}},{mutate:()=>{},differentResult:true}];
  for(const change of changes){const f=setup({mutable:true}),gate=deferred(),pending=f.start();await drain();f.control.reauthPromise=gate.promise;f.find('soldier-production-enrollment-confirm').click();change.mutate(f);gate.resolve({user:change.differentResult?{...f.original}:f.original});assert.equal((await pending).ok,false);assert.equal(f.calls.length,1);blocked(f);}
});

test('logout while confirmation or popup awaits disposes the attempt and late resolution cannot restore business UI',async()=>{
  for(const clicked of [false,true]){const f=setup(),gate=deferred(),pending=f.start();await drain();f.control.reauthPromise=gate.promise;if(clicked)f.find('soldier-production-enrollment-confirm').click();f.find('soldier-production-logout').click();assert.equal((await pending).ok,false);gate.resolve({user:f.original});await drain();assert.equal(f.calls.length,1);assert.equal(f.counts.reauth,clicked?1:0);blocked(f);}
});

test('uncertain claim or revoked postclaim session remains closed with no registration retry or storage',async()=>{
  for(const change of [f=>{f.control.claimResponse=url=>f.response(url,503,'{"ok":false,"error":"result_unknown","retrySameIdentity":true}');},f=>{f.control.finalResponse=url=>f.response(url,403,'{"ok":false,"error":"access_denied"}');}]){const f=setup(),pending=f.start();await drain();change(f);f.find('soldier-production-enrollment-confirm').click();assert.equal((await pending).ok,false);assert.equal(f.calls.filter(c=>c.init.method==='POST').length,1);assert.equal(f.calls.length,f.control.claimResponse?2:3);blocked(f);}
});
