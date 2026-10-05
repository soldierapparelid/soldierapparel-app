'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Policy=require('../access-policy.js'),Session=require('../access-session.js');

const config={apiKey:'public-synthetic-web-key',databaseURL:'https://synthetic-soldier-default-rtdb.asia-southeast1.firebasedatabase.app',projectId:'synthetic-soldier'};
const user={uid:'synthetic-user',email:'synthetic.partner@gmail.com',emailVerified:true};
const approved=(workerId='synthetic-worker')=>({active:true,owner:false,workerId,modules:{jahit:true}});
const snapshot=value=>({val:()=>value});
const deferred=()=>{let resolve;return {promise:new Promise(done=>{resolve=done;}),resolve};};

class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.attributes=new Map();this.dataset={};this.hidden=false;this.textContent='';this.value='';this.disabled=false;this.parentNode=null;this.listeners=new Map();}
  append(...items){for(const item of items){this.children.push(item);item.parentNode=this;}}
  get firstChild(){return this.children[0]||null;}
  setAttribute(name,value){this.attributes.set(name,String(value));}
  removeAttribute(name){this.attributes.delete(name);}
  hasAttribute(name){return this.attributes.has(name);}
  addEventListener(name,callback){this.listeners.set(name,callback);}
  remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(item=>item!==this);this.parentNode=null;}}
  set innerHTML(value){throw new Error('The login harness does not allow innerHTML.');}
}

function page(options={}){
  const events=[],authWatchers=[],valueWatchers=[],reads=[],calls={online:0,offline:0,signOut:0,reload:0,unlocks:0},apps=[],storage=new Map();
  const auth={currentUser:{...user}},db={online:false},documentEvents=new Map();
  let profile=Object.hasOwn(options,'profile')?options.profile:approved(),emailGrant=options.emailGrant??null;
  const html=new Element('html'),body=new Element('body'),head=new Element('head');
  const remove=html.removeAttribute.bind(html);
  html.removeAttribute=name=>{if(name==='data-soldier-locked')calls.unlocks++;remove(name);};
  const all=node=>[node,...node.children.flatMap(all)];
  const document={documentElement:html,body,head,createElement:tag=>new Element(tag),createTextNode:text=>Object.assign(new Element('#text'),{textContent:text}),querySelectorAll:()=>[],getElementById:id=>all(body).find(node=>node.id===id)||null,
    addEventListener(name,callback,eventOptions){const list=documentEvents.get(name)||[];list.push({callback,once:eventOptions?.once===true});documentEvents.set(name,list);}};
  const localStorage={getItem:key=>storage.get(String(key))??null,setItem:(key,value)=>storage.set(String(key),String(value)),removeItem:key=>storage.delete(String(key))};
  const sdk={
    getApps:()=>apps,
    initializeApp:(value,name)=>{const app={options:value,name};apps.push(app);return app;},
    getDatabase:()=>db,getAuth:()=>auth,
    goOnline(database){assert.equal(database,db);db.online=true;calls.online++;},
    goOffline(database){assert.equal(database,db);db.online=false;calls.offline++;},
    ref:(database,path)=>{assert.equal(database,db);return {database,path};},
    async get(node){reads.push(node.path);if(options.get)return options.get(node);return snapshot(node.path.startsWith('accessControl/users/')?profile:emailGrant);},
    onAuthStateChanged(account,callback,error){assert.equal(account,auth);const watcher={callback,error,active:true};authWatchers.push(watcher);events.push(()=>{if(watcher.active)callback(account.currentUser);});return ()=>{watcher.active=false;};},
    onValue(node,callback,error){const watcher={path:node.path,callback,error,active:true};valueWatchers.push(watcher);if(node.path.startsWith('accessControl/'))events.push(()=>{if(watcher.active)callback(snapshot(node.path.startsWith('accessControl/users/')?profile:emailGrant));});return ()=>{watcher.active=false;};},
    async signOut(account){calls.signOut++;if(options.signOut)await options.signOut();account.currentUser=null;for(const watcher of authWatchers)if(watcher.active)events.push(()=>{if(watcher.active)watcher.callback(null);});},
    async set(){},async runTransaction(node,update){const value=update({});return {committed:value!==undefined,snapshot:snapshot(value)};},
    async setPersistence(){},async signInWithPopup(){},GoogleAuthProvider:class{setCustomParameters(){}},browserLocalPersistence:'synthetic-local',browserSessionPersistence:'synthetic-session'
  };
  const location={pathname:'/jahit-command.html',reload(){calls.reload++;}};
  const window={SoldierAccessPolicy:Policy,SoldierAccessSession:Session};
  const sandbox={window,document,localStorage,location,URL,Promise,Map,Set,WeakSet,__fixtureSdk:sdk};
  // Only the three external SDK imports are substituted. Authorization,
  // lifecycle callbacks, storage binding and the business guard run unchanged.
  const source=fs.readFileSync(require.resolve('../access-control.js'),'utf8').replace(/import\('https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/firebase-(?:app|auth|database)\.js'\)/g,'Promise.resolve(globalThis.__fixtureSdk)');
  vm.runInNewContext(source,sandbox,{filename:'access-control.js'});
  function emitDocument(name){const list=documentEvents.get(name)||[];documentEvents.set(name,list.filter(item=>!item.once));for(const item of list)item.callback();}
  // Deterministic promise/event draining: no timer, SDK network or real clock.
  async function drain(){for(let turn=0;turn<80;turn++){while(events.length)events.shift()();await Promise.resolve();}}
  async function connect(pending=()=>false){const result=window.SoldierAccess.connect(config,'jahit',{pending});result.catch(()=>{});await drain();return result;}
  function button(label){const node=all(body).find(item=>item.tagName==='button'&&item.textContent===label);assert.ok(node,'Missing synthetic button: '+label);return node;}
  emitDocument('DOMContentLoaded');
  return {window,document,auth,db,calls,reads,authWatchers,valueWatchers,storage,connect,drain,button,setProfile:value=>{profile=value;},locked:()=>html.hasAttribute('data-soldier-locked')};
}

test('pending-draft pause survives access updates and resumes the guarded connection explicitly',async()=>{
  const p=page();let pending=false;const context=await p.connect(()=>pending);assert.equal(p.locked(),false);assert.equal(p.db.online,true);
  pending=true;await p.button('Keluar').onclick();await p.drain();assert.equal(p.locked(),true);assert.equal(p.db.online,false);
  assert.throws(()=>context.sdk.ref(context.db,'synthetic-business'),/Sesi akses berubah/);
  const profileWatcher=p.valueWatchers.find(item=>item.path==='accessControl/users/'+user.uid);
  profileWatcher.callback(snapshot(approved()));await p.drain();
  assert.equal(p.locked(),true,'An unchanged approved profile must not dismiss the draft pause');assert.equal(p.db.online,false);
  const before=p.calls.online;await p.button('Kembali menyelesaikan draf').onclick();await p.drain();
  assert.equal(p.locked(),false);assert.equal(p.db.online,true);assert.equal(p.calls.online,before+1);assert.ok(context.sdk.ref(context.db,'synthetic-business'));assert.equal(p.calls.signOut,0);
});

test('queued auth, profile and email-grant callbacks from a failed context cannot change or reload its replacement',async()=>{
  const grant={email:user.email,...approved()},p=page({profile:null,emailGrant:grant}),oldContext=await p.connect();
  const oldProfile=p.valueWatchers.find(item=>item.path==='accessControl/users/'+user.uid);
  const oldGrant=p.valueWatchers.find(item=>item.path==='accessControl/emailGrants/'+Policy.emailKey(user.email));
  const oldAuth=p.authWatchers.find(item=>item.active);
  oldGrant.error({code:'synthetic-permission-error'});await p.drain();assert.equal(p.locked(),true);assert.equal(oldContext.authorized,false);
  p.setProfile(approved('synthetic-replacement-worker'));const context=await p.connect();assert.notEqual(context,oldContext);assert.equal(p.locked(),false);
  assert.equal(oldProfile.active,false,'Metadata watcher must be detached at invalidation');assert.equal(oldGrant.active,false,'Email-grant watcher must be detached at invalidation');assert.equal(oldAuth.active,false,'Auth watcher must be detached at invalidation');
  const before=p.calls.reload;
  // Unsubscription cannot retract callbacks that were already queued; exercise
  // those original closures directly after the new context becomes active.
  oldProfile.callback(snapshot(null));oldGrant.callback(snapshot(grant));
  oldProfile.error({code:'synthetic-stale-error'});oldGrant.error({code:'synthetic-stale-grant-error'});oldAuth.callback({uid:'synthetic-other-user'});await p.drain();
  assert.equal(context.authorized,true);assert.equal(context.profile.workerId,'synthetic-replacement-worker');assert.equal(p.locked(),false);assert.equal(p.calls.reload,before);
  assert.ok(context.sdk.ref(context.db,'synthetic-business'));assert.throws(()=>oldContext.sdk.ref(oldContext.db,'synthetic-business'),/Sesi akses berubah/);
});

test('an account change during the awaited profile read cannot unlock the old account',async()=>{
  const waiting=deferred();const p=page({get:()=>waiting.promise});
  const result=p.window.SoldierAccess.connect(config,'jahit',{pending:()=>false});result.catch(()=>{});await p.drain();assert.equal(p.reads.length,1);assert.equal(p.locked(),true);
  p.auth.currentUser={...user,uid:'synthetic-other-user'};waiting.resolve(snapshot(approved()));await p.drain();
  await assert.rejects(result);assert.equal(p.locked(),true);assert.equal(p.calls.unlocks,0,'No transient unlock may display the previous account');
  assert.ok(p.reads.every(path=>path.startsWith('accessControl/')),'No business read is permitted while the account changes');
});

test('logout disposes business and access callbacks before waiting for the sign-out result',async()=>{
  const waiting=deferred(),p=page({signOut:()=>waiting.promise}),context=await p.connect();
  let deliveries=0;const node=context.sdk.ref(context.db,'synthetic-business');context.sdk.onValue(node,()=>deliveries++);
  const business=p.valueWatchers.find(item=>item.path==='synthetic-business');business.callback(snapshot({synthetic:true}));assert.equal(deliveries,1);
  const oldProfile=p.valueWatchers.find(item=>item.path==='accessControl/users/'+user.uid),oldAuth=p.authWatchers.find(item=>item.active);
  const leaving=p.button('Keluar').onclick();leaving.catch(()=>{});await p.drain();assert.equal(p.calls.signOut,1);assert.equal(context.authorized,false);assert.equal(p.locked(),true);
  assert.equal(oldProfile.active,false);assert.equal(oldAuth.active,false);assert.equal(business.active,false);
  oldProfile.callback(snapshot(approved()));oldAuth.callback({...user});business.callback(snapshot({synthetic:true}));await p.drain();
  assert.equal(p.locked(),true);assert.equal(deliveries,1);assert.throws(()=>context.sdk.ref(context.db,'synthetic-business'),/Sesi akses berubah/);
  waiting.resolve();await p.drain();await leaving;assert.equal(p.calls.reload,1);
});
