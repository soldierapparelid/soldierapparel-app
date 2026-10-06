'use strict';
// Execute the real legacy access guard with a synthetic replacement for its
// reviewed public staging literal and its three SDK imports. No live project,
// Google request, credential, roster or business operation is involved.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const STAGE={apiKey:'SYNTHETIC_STAGE_WEB_CONFIG',databaseURL:'https://fixture-stage-default-rtdb.asia-southeast1.firebasedatabase.app',projectId:'fixture-stage',authDomain:'fixture-stage.firebaseapp.com'};
const OTHER={apiKey:'FOREIGN_SYNTHETIC_CONFIG',databaseURL:'https://fixture-other-default-rtdb.firebaseio.com',projectId:'fixture-other',authDomain:'fixture-other.firebaseapp.com'};
const ORIGINS=['https://soldier-access-uji.web.app','https://soldier-access-uji.firebaseapp.com'];
const FAILURE='Koneksi situs uji tidak sesuai. Hubungi owner sebelum melanjutkan.';
const SOURCE=fs.readFileSync(require.resolve('../access-control.js'),'utf8');
const BOUNDARY=/\/\/ BEGIN REVIEWED STAGING WEB CONFIG[\s\S]*?\/\/ END REVIEWED STAGING WEB CONFIG/g;
const IMPORTS=/import\('https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/firebase-(?:app|auth|database)\.js'\)/g;
const countMatches=(source,pattern)=>[...source.matchAll(pattern)].length;
class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.attributes=new Map();this.dataset={};this.hidden=false;this.textContent='';this.value='';this.disabled=false;this.parentNode=null;}
  append(...items){for(const item of items){this.children.push(item);item.parentNode=this;}}
  appendChild(item){this.append(item);return item;}
  get firstChild(){return this.children[0]||null;}
  setAttribute(name,value){this.attributes.set(name,String(value));}
  removeAttribute(name){this.attributes.delete(name);}
  hasAttribute(name){return this.attributes.has(name);}
  remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(item=>item!==this);this.parentNode=null;}}
  set innerHTML(value){throw Error('Synthetic staging harness disallows innerHTML');}
}
function page(options={}){
  assert.equal(countMatches(SOURCE,BOUNDARY),1,'reviewed-literal replacement boundary');assert.equal(countMatches(SOURCE,IMPORTS),3,'three synthetic SDK import replacements');
  const origin=options.origin||ORIGINS[0],url=new URL(origin+'/jahit-command.html'+(options.suffix||''));
  const location={origin:url.origin,hostname:url.hostname,protocol:url.protocol,port:url.port,pathname:url.pathname,href:url.href,reload(){calls.reload++;}};
  const calls={sdk:0,initialize:0,database:0,auth:0,businessWrites:0,configWrites:0,storageReads:0,reload:0,getters:0,canonical:0},events=[],authWatchers=[],reads=[];
  const stored=options.storage||{jahit_fb:JSON.stringify(OTHER),soldier_access_fb:JSON.stringify(OTHER),soldier_produksi_fb:JSON.stringify(OTHER),'synthetic-pending-draft':'SYNTHETIC_DRAFT_CANARY'};
  const storage=new Map(Object.entries(stored)),before=new Map(storage),apps=[];
  const html=new Element('html'),body=new Element('body'),head=new Element('head'),documentEvents=new Map();
  const all=node=>[node,...node.children.flatMap(all)];
  const document={documentElement:html,body,head,createElement:tag=>new Element(tag),createTextNode:text=>Object.assign(new Element('#text'),{textContent:text}),querySelectorAll:()=>[],readyState:'loading',
    addEventListener(name,callback,settings){const list=documentEvents.get(name)||[];list.push({callback,once:settings?.once===true});documentEvents.set(name,list);}};
  const localStorage={getItem(key){calls.storageReads++;return storage.get(String(key))??null;},setItem(key,value){if(String(key).endsWith('_fb'))calls.configWrites++;storage.set(String(key),String(value));},removeItem(){throw Error('Stored state must never be erased');},clear(){throw Error('Stored state must never be cleared');}};
  const account={uid:'synthetic-stage-user',email:'synthetic.stage@gmail.com',emailVerified:true},profile={active:true,owner:false,workerId:'synthetic-stage-worker',modules:{jahit:true}},auth={currentUser:account},db={};
  const snapshot=value=>({val:()=>value});
  const sdk={getApps:()=>apps,initializeApp(config,name){calls.initialize++;const app={name,options:config};apps.push(app);return app;},getDatabase(){calls.database++;return db;},getAuth(){calls.auth++;return auth;},goOffline(){},goOnline(){},ref:(database,path)=>({database,path}),get:async node=>{reads.push(node.path);return snapshot(profile);},
    onAuthStateChanged(value,callback){const watcher={callback,active:true};authWatchers.push(watcher);events.push(()=>{if(watcher.active)callback(value.currentUser);});return ()=>{watcher.active=false;};},
    onValue(node,callback){const watcher={active:true};if(node.path.startsWith('accessControl/'))events.push(()=>{if(watcher.active)callback(snapshot(profile));});return ()=>{watcher.active=false;};},
    set(){calls.businessWrites++;throw Error('Business writes forbidden');},runTransaction(){calls.businessWrites++;throw Error('Business writes forbidden');},setPersistence:async()=>{},signInWithPopup:async()=>{},signOut:async()=>{},GoogleAuthProvider:class{setCustomParameters(){}},browserSessionPersistence:'synthetic-session',browserLocalPersistence:'synthetic-local'};
  const sandbox={document,localStorage,location,URL,Promise,Map,Set,WeakSet,__loadSyntheticSdk(){calls.sdk++;options.onSdk?.(location);return sdk;},__getterCalled(){calls.getters++;}};sandbox.window=sandbox;
  if(options.fakeGlobalGetter)Object.defineProperty(sandbox,'SoldierStagingBinding',{get(){calls.getters++;throw Error('Untrusted global must not be read');}});
  if(options.fakeGlobalValue)sandbox.SoldierStagingBinding=Object.freeze({...OTHER});
  if(options.canonical)sandbox.SoldierProductionPageMode={canonical:true,start(){calls.canonical++;}};
  const context=vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require.resolve('../access-policy.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(require.resolve('../access-session.js'),'utf8'),context);
  const binding=options.bindingExpression||JSON.stringify(STAGE),source=SOURCE.replace(BOUNDARY,'// BEGIN REVIEWED STAGING WEB CONFIG\nconst stagingBinding=Object.freeze('+binding+');\n// END REVIEWED STAGING WEB CONFIG').replace(IMPORTS,'Promise.resolve(globalThis.__loadSyntheticSdk())');
  vm.runInContext(source,context,{filename:'synthetic-access-control.js'});
  const value=config=>{sandbox.__callerJSON=JSON.stringify(config);return vm.runInContext('JSON.parse(globalThis.__callerJSON)',context);};
  const expression=code=>vm.runInContext(code,context);
  const listeners=documentEvents.get('DOMContentLoaded')||[];documentEvents.delete('DOMContentLoaded');for(const listener of listeners)listener.callback();
  async function drain(){for(let turn=0;turn<80;turn++){while(events.length)events.shift()();await Promise.resolve();}}
  async function connect(config){const result=sandbox.SoldierAccess.connect(config,'jahit',{pending:()=>false});result.catch(()=>{});await drain();return result;}
  const node=tag=>all(body).find(item=>item.tagName===tag);
  function assertUntouched(){for(const [key,entry]of before)assert.equal(storage.get(key),entry,'existing synthetic settings/draft preserved');assert.equal(calls.configWrites,0);assert.equal(calls.businessWrites,0);}
  return {window:sandbox,location,document,calls,storage,before,apps,reads,value,expression,connect,drain,node,assertUntouched,locked:()=>html.hasAttribute('data-soldier-locked')};
}
function noSdk(p){assert.equal(p.calls.sdk,0);assert.equal(p.calls.initialize,0);assert.equal(p.calls.auth,0);assert.equal(p.calls.database,0);assert.equal(p.reads.length,0);p.assertUntouched();}

test('reviewed staging source wins over stale module/global storage without changing those settings or drafts',()=>{
  const p=page(),binding=p.window.SoldierAccess.findConfig();assert.deepEqual(JSON.parse(JSON.stringify(binding)),STAGE);assert.equal(Object.isFrozen(binding),true);assert.equal(Reflect.ownKeys(binding).length,4);assert.equal(p.locked(),true);noSdk(p);
});
test('an absent module setting receives public configuration once; a later mismatch cannot overwrite it or a draft',async()=>{
  const p=page({storage:{'synthetic-pending-draft':'SYNTHETIC_DRAFT_CANARY'}}),initialized=new Map(p.storage);
  assert.deepEqual(JSON.parse(p.storage.get('jahit_fb')),{apiKey:STAGE.apiKey,dbUrl:STAGE.databaseURL,projectId:STAGE.projectId});
  assert.equal(p.calls.configWrites,1,'initial prefill writes public local configuration only');
  await assert.rejects(p.connect(p.value(OTHER)),error=>error.message===FAILURE);
  assert.deepEqual(p.storage,initialized);assert.equal(p.calls.configWrites,1);assert.equal(p.calls.sdk,0);assert.equal(p.calls.businessWrites,0);
});
test('both exact HTTPS staging origins accept only the synthetic reviewed target and read access metadata',async()=>{
  for(const origin of ORIGINS){const p=page({origin}),connected=await p.connect(p.value(STAGE));assert.equal(connected.authorized,true);assert.equal(p.locked(),false);assert.equal(p.calls.sdk,3);assert.equal(p.calls.initialize,1);assert.deepEqual(JSON.parse(JSON.stringify(p.apps[0].options)),STAGE);assert.ok(p.reads.length>0&&p.reads.every(path=>path.startsWith('accessControl/')));p.assertUntouched();}
});
test('foreign key, database, project, auth domain and ambiguous aliases fail before every SDK import',async()=>{
  const changes=[{apiKey:OTHER.apiKey},{databaseURL:OTHER.databaseURL},{projectId:OTHER.projectId},{authDomain:OTHER.authDomain},{dbUrl:STAGE.databaseURL}];
  for(const change of changes){const p=page();await assert.rejects(p.connect(p.value({...STAGE,...change})),error=>error.message===FAILURE);assert.equal(p.locked(),true);noSdk(p);}
});
test('staging rejects inherited/getter/nonenumerable/symbol/extra config fields without evaluating getters',async()=>{
  const cases=['Object.create('+JSON.stringify(STAGE)+')','Object.defineProperty('+JSON.stringify(STAGE)+',"apiKey",{get(){globalThis.__getterCalled();return "PRIVATE_SYNTHETIC_INPUT";},enumerable:true})','Object.defineProperty('+JSON.stringify(STAGE)+',"apiKey",{value:"SYNTHETIC_STAGE_WEB_CONFIG",enumerable:false})','Object.assign('+JSON.stringify(STAGE)+',{[Symbol("extra")]:"PRIVATE_SYNTHETIC_INPUT"})','Object.assign('+JSON.stringify(STAGE)+',{extra:"PRIVATE_SYNTHETIC_INPUT"})','null','[]','42'];
  for(const expression of cases){const p=page();await assert.rejects(p.connect(p.expression(expression)),error=>error.message===FAILURE);assert.equal(p.calls.getters,0);assert.equal(p.locked(),true);noSdk(p);}
});
test('caller-defined staging globals, including a throwing getter, are never consulted',()=>{
  for(const options of [{fakeGlobalGetter:true},{fakeGlobalValue:true}]){const p=page(options);assert.deepEqual(JSON.parse(JSON.stringify(p.window.SoldierAccess.findConfig())),STAGE);assert.equal(p.calls.getters,0);noSdk(p);}
});
test('URL query and fragment values cannot replace the reviewed connection',()=>{
  const p=page({suffix:'?projectId=fixture-other&apiKey=PRIVATE_SYNTHETIC_INPUT#databaseURL=fixture-other'});assert.deepEqual(JSON.parse(JSON.stringify(p.window.SoldierAccess.findConfig())),STAGE);noSdk(p);
});
test('known staging hostnames on HTTP or a nondefault port fail closed before storage fallback or SDK',async()=>{
  for(const origin of ['http://soldier-access-uji.web.app','https://soldier-access-uji.web.app:8443','http://soldier-access-uji.firebaseapp.com','https://soldier-access-uji.firebaseapp.com:8443']){const p=page({origin});assert.throws(()=>p.window.SoldierAccess.findConfig(),error=>error.message===FAILURE);await assert.rejects(p.connect(p.value(STAGE)),error=>error.message===FAILURE);assert.equal(p.locked(),true);noSdk(p);}
});
test('missing, malformed or accessor-based reviewed source fails closed rather than falling back to storage',async()=>{
  const bindings=['null',JSON.stringify({...STAGE,extra:'PRIVATE_SYNTHETIC_INPUT'}),JSON.stringify({...STAGE,databaseURL:'http://fixture-stage.firebaseio.com'}),JSON.stringify({...STAGE,authDomain:OTHER.authDomain}),'Object.defineProperty('+JSON.stringify(STAGE)+',"apiKey",{get(){globalThis.__getterCalled();return "PRIVATE_SYNTHETIC_INPUT";},enumerable:true})'];
  for(const bindingExpression of bindings){const p=page({bindingExpression});assert.throws(()=>p.window.SoldierAccess.findConfig(),error=>error.message===FAILURE);await assert.rejects(p.connect(p.value(STAGE)),error=>error.message===FAILURE);assert.equal(p.calls.getters,0);assert.equal(p.locked(),true);noSdk(p);}
});
test('invalid source cannot even prefill an absent module connection setting',async()=>{
  const p=page({bindingExpression:'null',storage:{'synthetic-pending-draft':'SYNTHETIC_DRAFT_CANARY'}});
  await assert.rejects(p.connect(p.value(STAGE)),error=>error.message===FAILURE);assert.equal(p.storage.has('jahit_fb'),false);noSdk(p);
});
test('staging exposes no editable target and even direct form submission preserves stored settings',()=>{
  const p=page(),details=p.node('details'),form=p.node('form');assert.ok(details&&form);assert.equal(details.hidden,true);let prevented=false;form.onsubmit({preventDefault(){prevented=true;}});assert.equal(prevented,true);noSdk(p);
});
test('normal nonstaging legacy configuration order and connection editing remain unchanged',async()=>{
  const p=page({origin:'https://legacy.example.invalid',fakeGlobalGetter:true});assert.deepEqual(JSON.parse(JSON.stringify(p.window.SoldierAccess.findConfig())),OTHER);assert.equal(p.node('details').hidden,false);assert.equal((await p.connect(p.value(OTHER))).authorized,true);assert.equal(p.calls.sdk,3);assert.equal(p.calls.getters,0);p.assertUntouched();
});
test('origin drift during awaited SDK import prevents app assembly and all metadata/business access',async()=>{
  const p=page({onSdk:location=>{location.origin='https://foreign.example.invalid';}});await assert.rejects(p.connect(p.value(STAGE)),error=>error.message===FAILURE);assert.equal(p.calls.sdk,3);assert.equal(p.calls.initialize,0);assert.equal(p.calls.auth,0);assert.equal(p.reads.length,0);assert.equal(p.locked(),true);p.assertUntouched();
});
test('a mismatched caller invalidates an already authorized staging context without importing again or changing drafts',async()=>{
  const p=page(),connected=await p.connect(p.value(STAGE)),initialized=new Map(p.storage);
  assert.equal(connected.authorized,true);await assert.rejects(p.connect(p.value(OTHER)),error=>error.message===FAILURE);
  assert.equal(connected.authorized,false);assert.equal(p.locked(),true);assert.equal(p.calls.sdk,3);assert.deepEqual(p.storage,initialized);p.assertUntouched();
});
test('canonical routing returns before the legacy staging binding, storage, imports or UI are evaluated',()=>{
  const p=page({canonical:true,bindingExpression:'null',fakeGlobalGetter:true});assert.equal(p.calls.canonical,1);assert.equal(p.calls.sdk,0);assert.equal(p.calls.storageReads,0);assert.equal(p.calls.getters,0);assert.equal(p.window.SoldierAccess,undefined);assert.equal(p.document.body.children.length,0);p.assertUntouched();
});
