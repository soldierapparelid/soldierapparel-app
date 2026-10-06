'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Mode=require('../production-page-mode.js');
const source=fs.readFileSync(require.resolve('../production-page-mode.js'),'utf8');
const access=fs.readFileSync(require.resolve('../access-control.js'),'utf8');
const fixed={enabled:true,projectId:'demo-page-gate',databaseURL:'https://demo-page-gate.firebaseio.com',tenantId:'tenant-1',endpointURL:'https://commands.example.invalid/v1/production/commands',apiKey:'synthetic-public-web-key',authDomain:'demo-page-gate.firebaseapp.com'};
const legacyText="const legacyLexical='classic';function legacyClick(){return legacyLexical;}globalThis.legacyRuns++;localStorage.getItem('synthetic-old-data');localStorage.setItem('synthetic-old-data','updated');window.addEventListener('legacy-event',()=>{});globalThis.legacyHydrates++;";
function deferred(){let resolve;return {promise:new Promise(done=>{resolve=done;}),resolve};}
class Node{
  constructor(tag,appendScript){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attrs=new Map();this.style={};this.hidden=false;this.textContent='';this.handlers=new Map();this.appendScript=appendScript;}
  get attributes(){return [...this.attrs].map(([name,value])=>({name,value}));}
  setAttribute(name,value){this.attrs.set(name,String(value));}
  getAttribute(name){return this.attrs.get(name)??null;}
  hasAttribute(name){return this.attrs.has(name);}
  removeAttribute(name){this.attrs.delete(name);}
  appendChild(node){this.children.push(node);node.parentNode=this;if(node.tagName==='SCRIPT'&&node.type==='text/javascript')this.appendScript(node);return node;}
  replaceChildren(...nodes){for(const node of this.children)node.parentNode=null;this.children=[];for(const node of nodes)this.appendChild(node);}
  addEventListener(name,fn){this.handlers.set(name,fn);}
}
function browser({configuration=fixed,bootstrap,pathname='/jahit-command.html',ready=false,throwInsertion=false}={}){
  const calls={storageRead:0,storageWrite:0,policy:0,legacyListeners:0,legacyHydrates:0,legacyRuns:0,scripts:0,bootstrap:0,reload:0};
  let context;
  const run=node=>{calls.scripts++;if(throwInsertion)throw Error('synthetic insertion failure');vm.runInContext(node.textContent,context,{filename:'activated-classic.js'});};
  const html=new Node('html',run),head=new Node('head',run),body=new Node('body',run),old=new Node('button',run),inert=new Node('script',run);
  html.setAttribute('data-soldier-production-page','');html.setAttribute('data-soldier-locked','');old.setAttribute('onclick','legacyClick()');old.setAttribute('onINPUT','oldInput()');old.id='old-control';body.appendChild(old);
  inert.id='soldier-legacy-production-script';inert.setAttribute('type','text/plain');inert.textContent=legacyText;body.appendChild(inert);
  const all=node=>[node,...node.children.flatMap(all)],events=new Map();
  const document={documentElement:html,head,body,readyState:ready?'interactive':'loading',createElement:tag=>new Node(tag,run),querySelectorAll:()=>[...all(head),...all(body)],getElementById:id=>[...all(head),...all(body)].find(node=>node.id===id)||null,addEventListener(name,fn,options){const list=events.get(name)||[];list.push({fn,once:options?.once});events.set(name,list);}};
  const sandbox={document,location:{pathname,search:'?canonical=true&projectId=untrusted',href:'https://page.example.invalid'+pathname+'?canonical=true',reload(){calls.reload++;}},URL,Promise,Map,Set,WeakSet,console,legacyRuns:0,legacyHydrates:0,localStorage:{getItem(){calls.storageRead++;return '{"enabled":true}';},setItem(){calls.storageWrite++;}},addEventListener(){calls.legacyListeners++;}};
  context=vm.createContext(sandbox);vm.runInContext('window=globalThis;',context);
  Object.defineProperty(sandbox,'SoldierAccessPolicy',{get(){calls.policy++;throw Error('Legacy policy must remain inert.');}});
  if(bootstrap)sandbox.SoldierProductionBootstrap={start:async options=>{calls.bootstrap++;return bootstrap(options);}};
  // A changed literal models reviewed source configuration, not a runtime flag.
  const configured=source.replace(/const DEFAULT_CONFIGURATION=Object\.freeze\(\{[^\n]+\}\);/,'const DEFAULT_CONFIGURATION=Object.freeze('+JSON.stringify(configuration)+');');
  vm.runInContext(configured,context,{filename:'production-page-mode.js'});
  const mode=sandbox.SoldierProductionPageMode;
  function domReady(){document.readyState='interactive';const list=events.get('DOMContentLoaded')||[];events.set('DOMContentLoaded',list.filter(x=>!x.once));for(const entry of list)entry.fn();}
  async function drain(){for(let i=0;i<12;i++)await Promise.resolve();}
  return {context,sandbox,document,old,inert,body,html,mode,calls,domReady,drain,runAccess:()=>vm.runInContext(access,context,{filename:'access-control.js'}),text:()=>all(body).map(node=>node.textContent).join(' ')};
}
function noLegacy(p){assert.equal(p.calls.storageRead,0);assert.equal(p.calls.storageWrite,0);assert.equal(p.calls.policy,0);assert.equal(p.calls.legacyListeners,0);assert.equal(p.calls.scripts,0);assert.equal(p.sandbox.legacyRuns,0);assert.equal(p.sandbox.legacyHydrates,0);assert.equal(p.sandbox.SoldierAccess,undefined);}

test('source default is disabled and immutable; runtime flags and query cannot enable it',()=>{
  assert.equal(Mode.defaultConfiguration.enabled,false);assert.equal(Object.isFrozen(Mode.defaultConfiguration),true);
  assert.equal(Mode.defaultConfiguration.enrollmentEnabled,false);
  const p=browser({configuration:Mode.defaultConfiguration});p.sandbox.SoldierProductionConfiguration=fixed;
  assert.equal(p.mode.canonical,false);assert.equal(Object.isFrozen(p.mode),true);assert.equal(Object.isFrozen(p.mode.configuration),true);assert.equal(p.mode.configuration.enabled,false);
  assert.throws(()=>vm.runInContext("'use strict';SoldierProductionPageMode={canonical:true};",p.context),/read only|Cannot assign/);
  noLegacy(p);
});

test('enrollment flag is optional own source data, defaults false, and cannot be supplied by globals or URL',()=>{
  const p=browser({configuration:fixed});p.sandbox.enrollmentEnabled=true;p.sandbox.SoldierProductionConfiguration={...fixed,enrollmentEnabled:true};
  assert.equal(p.mode.configuration.enrollmentEnabled,false);assert.equal(p.mode.canonical,true);noLegacy(p);
  const reviewed=browser({configuration:{...fixed,enrollmentEnabled:true}});assert.equal(reviewed.mode.configuration.enrollmentEnabled,true);assert.equal(Object.isFrozen(reviewed.mode.configuration),true);noLegacy(reviewed);
});

test('malformed enrollment flag and enabled enrollment with disabled page lock before bootstrap or legacy',async()=>{
  for(const configuration of [{...fixed,enrollmentEnabled:'true'},{...Mode.defaultConfiguration,enrollmentEnabled:true},{...fixed,enrollmentEnabled:true,claimURL:'https://foreign.example.invalid/claim'}]){const p=browser({configuration,ready:true,bootstrap:()=>{throw Error('Must not initialize');}});assert.equal(p.mode.canonical,true);assert.equal((await p.mode.start()).ok,false);assert.equal(p.calls.bootstrap,0);assert.equal(p.mode.activateLegacy('soldier-legacy-production-script'),false);noLegacy(p);}
  let touched=0;const configured={...fixed};Object.defineProperty(configured,'enrollmentEnabled',{enumerable:true,get(){touched++;throw Error('Must not read');}});
  const mode=Mode.createPageMode({configuration:configured,pathname:'/jahit-command.html'});assert.equal(mode.canonical,true);assert.equal(mode.configuration,null);assert.equal(touched,0);
});

test('LEGACY activates a real classic script once and preserves onclick global lexical lookup',()=>{
  const p=browser({configuration:Mode.defaultConfiguration});assert.equal(p.mode.activateLegacy('other-source'),false);
  assert.equal(p.mode.activateLegacy('soldier-legacy-production-script'),true);assert.equal(p.mode.activateLegacy('soldier-legacy-production-script'),false);
  assert.equal(p.calls.scripts,1);assert.equal(p.sandbox.legacyRuns,1);assert.equal(p.sandbox.legacyHydrates,1);assert.equal(p.calls.storageRead,1);assert.equal(p.calls.storageWrite,1);assert.equal(p.calls.legacyListeners,1);
  assert.equal(vm.runInContext('legacyClick()',p.context),'classic');assert.equal(p.sandbox.legacyLexical,undefined);assert.equal(p.old.getAttribute('onclick'),'legacyClick()');
});

test('a partially failed classic insertion is never attempted twice',()=>{
  const p=browser({configuration:Mode.defaultConfiguration,throwInsertion:true});assert.equal(p.mode.activateLegacy('soldier-legacy-production-script'),false);assert.equal(p.mode.activateLegacy('soldier-legacy-production-script'),false);assert.equal(p.calls.scripts,1);assert.equal(p.html.hasAttribute('data-soldier-locked'),true);
});

test('canonical access branches before legacy policy, storage and DOM mounting',async()=>{
  const done=deferred();const p=browser({bootstrap:()=>done.promise});p.runAccess();assert.equal(p.calls.bootstrap,0);noLegacy(p);
  p.domReady();await p.drain();assert.equal(p.calls.bootstrap,1);assert.equal(p.html.hasAttribute('data-soldier-locked'),true);assert.equal(p.old.hidden,true);assert.equal(p.old.hasAttribute('inert'),true);assert.equal(p.old.getAttribute('onclick'),null);assert.equal(p.old.getAttribute('onINPUT'),null);
  assert.equal(p.mode.activateLegacy('soldier-legacy-production-script'),false);done.resolve({ok:true,dispose(){}});await p.drain();assert.equal(p.html.hasAttribute('data-soldier-locked'),false);assert.equal(p.old.hidden,true);noLegacy(p);
});

test('missing bootstrap holds the page and never hydrates or falls back to LEGACY',async()=>{
  const p=browser();p.runAccess();p.domReady();const result=await p.mode.start();assert.equal(result.ok,false);assert.equal(result.error,'unavailable');assert.equal(p.html.hasAttribute('data-soldier-locked'),true);assert.match(p.text(),/Akses aman belum siap/);assert.equal(p.mode.activateLegacy('soldier-legacy-production-script'),false);noLegacy(p);
});

test('unsupported controls added during bootstrap are stripped before canonical unlock',async()=>{
  const done=deferred(),p=browser({ready:true,bootstrap:()=>done.promise});p.runAccess();await p.drain();
  const late=p.document.createElement('button');late.setAttribute('onclick','oldUpload()');p.body.appendChild(late);
  done.resolve({ok:true,dispose(){}});assert.equal((await p.mode.start()).ok,true);assert.equal(late.hidden,true);assert.equal(late.getAttribute('onclick'),null);assert.equal(late.hasAttribute('inert'),true);noLegacy(p);
});

test('generic startup failure clears partial views and offers only fixed reload recovery',async()=>{
  const p=browser({ready:true,bootstrap:options=>{const partial=options.document.createElement('p');partial.textContent='synthetic private partial view';options.host.appendChild(partial);return {ok:false};}});p.runAccess();assert.equal((await p.mode.start()).ok,false);assert.doesNotMatch(p.text(),/synthetic private/);
  const reload=p.document.getElementById('soldier-production-reload');assert.ok(reload);reload.handlers.get('click')();assert.equal(p.calls.reload,1);assert.equal(p.mode.activateLegacy('soldier-legacy-production-script'),false);noLegacy(p);
});

test('bootstrap rejection exposes a fixed message and no rejected credential or business details',async()=>{
  const p=browser({ready:true,bootstrap:()=>{throw Error('synthetic-secret-and-private-data');}});p.runAccess();const result=await p.mode.start();assert.equal(result.ok,false);assert.doesNotMatch(p.text(),/synthetic-secret/);assert.equal(p.old.hidden,true);assert.equal(p.html.hasAttribute('data-soldier-locked'),true);noLegacy(p);
});

test('invalid source config and secret-bearing extra fields are locked without bootstrap',async()=>{
  for(const configuration of [{...fixed,tenantId:'__proto__'},{...fixed,endpointURL:fixed.endpointURL+'?override=1'},{...fixed,authDomain:'other.firebaseapp.com'},{...fixed,databaseURL:'http://demo-page-gate.firebaseio.com'},{...fixed,workerId:'forged-worker'},{...fixed,enabled:'false'}]){
    const p=browser({configuration,ready:true,bootstrap:()=>{throw Error('Must not run');}});p.runAccess();assert.equal(p.mode.canonical,true);assert.equal((await p.mode.start()).ok,false);assert.equal(p.calls.bootstrap,0);assert.equal(p.mode.activateLegacy('soldier-legacy-production-script'),false);noLegacy(p);
  }
});

test('configuration getters are rejected without invoking them',()=>{
  let read=0;const input={...fixed};Object.defineProperty(input,'enabled',{enumerable:true,get(){read++;return false;}});
  const p=browser();const mode=Mode.createPageMode({document:p.document,pathname:'/jahit-command.html',configuration:input});assert.equal(mode.canonical,true);assert.equal(mode.configuration,null);assert.equal(read,0);
});

test('hold during async bootstrap prevents stale success from unlocking or retaining listeners',async()=>{
  const done=deferred();let disposed=0;const p=browser({ready:true,bootstrap:()=>done.promise});p.runAccess();await p.drain();assert.equal(p.mode.hold(),true);done.resolve({ok:true,dispose(){disposed++;}});const result=await p.mode.start();assert.equal(result.ok,false);assert.equal(disposed,1);assert.equal(p.html.hasAttribute('data-soldier-locked'),true);noLegacy(p);
});

test('post-unlock hold disposes once, preserves the canonical login control and never restores old controls',async()=>{
  let disposed=0;const p=browser({ready:true,bootstrap:options=>{const login=options.document.createElement('button');login.textContent='Masuk dengan Google';login.addEventListener('click',()=>{});options.host.appendChild(login);return {ok:true,dispose(){disposed++;}};}});
  p.runAccess();assert.equal((await p.mode.start()).ok,true);p.mode.hold();p.mode.hold();assert.equal(disposed,1);assert.equal(p.html.hasAttribute('data-soldier-locked'),true);assert.equal(p.old.hidden,true);assert.match(p.text(),/Masuk dengan Google/);noLegacy(p);
});

test('bootstrap must provide verified success and a disposal handle before unlock',async()=>{
  for(const result of [{ok:true},{ok:false,dispose(){}},undefined]){
    const p=browser({ready:true,bootstrap:()=>result});p.runAccess();assert.equal((await p.mode.start()).ok,false);assert.equal(p.html.hasAttribute('data-soldier-locked'),true);noLegacy(p);
  }
});

test('failed gate asset cannot let access-control discover old config or mount legacy login',()=>{
  const p=browser();const bare={window:{},document:p.document,localStorage:p.sandbox.localStorage,location:p.sandbox.location};vm.runInNewContext(access,bare);p.domReady();assert.equal(bare.window.SoldierAccess,undefined);assert.equal(p.calls.storageRead,0);assert.equal(p.calls.storageWrite,0);assert.equal(p.html.hasAttribute('data-soldier-locked'),true);assert.match(p.text(),/Akses aman belum siap/);
});

test('both actual HTML pages gate before access and place the entire classic payload in one inert source',()=>{
  const expected=['production-command-client.js','production-command-store.js','operations-codec.js','maklon-earnings.js','production-view-client.js','production-bridge.js','production-form-controller.js','production-form-ui.js','production-bootstrap.js'];
  for(const division of ['jahit','qc']){
    const html=fs.readFileSync(path.join(__dirname,'..',division+'-command.html'),'utf8');
    assert.match(html,/<html[^>]*data-soldier-production-page/);assert.ok(html.indexOf('production-page-mode.js')<html.indexOf('access-control.js'));
    const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];const inert=scripts.filter(match=>match[1].includes('type="text/plain"'));assert.equal(inert.length,1);assert.match(inert[0][1],/id="soldier-legacy-production-script"/);
    assert.match(inert[0][2],new RegExp('window\\.appReady=\\(async function boot'+(division==='jahit'?'Jahit':'QC')));assert.match(inert[0][2],/initialize(?:Jahit|Qc)Account/);assert.match(inert[0][2],/localStorage/);assert.match(inert[0][2],/\.onclick\s*=/);assert.match(inert[0][2],/addEventListener/);
    const activeInline=scripts.filter(match=>!match[1].includes('src=')&&!match[1].includes('text/plain'));assert.equal(activeInline.length,1);assert.equal(activeInline[0][2],"window.SoldierProductionPageMode&&window.SoldierProductionPageMode.activateLegacy('soldier-legacy-production-script');");
    let previous=-1;for(const name of expected){const at=html.indexOf('src="'+name);assert.ok(at>previous,name);previous=at;}assert.ok(previous<html.indexOf('<script type="text/plain"'));
  }
});

test('real page inert payload stays unexecuted even when canonical bootstrap fails',async()=>{
  for(const division of ['jahit','qc']){
    const html=fs.readFileSync(path.join(__dirname,'..',division+'-command.html'),'utf8'),inert=html.match(/<script type="text\/plain" id="soldier-legacy-production-script">([\s\S]*?)<\/script>/);
    const p=browser({pathname:'/'+division+'-command.html',ready:true,bootstrap:()=>{throw Error('synthetic denied');}});p.inert.textContent=inert[1];p.runAccess();assert.equal((await p.mode.start()).ok,false);assert.equal(p.mode.activateLegacy('soldier-legacy-production-script'),false);noLegacy(p);
  }
});
