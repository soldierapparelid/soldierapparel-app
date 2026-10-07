'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Builder=require('../server/apps-script/build-production-page.cjs');
const CONFIG=Object.freeze({enabled:true,projectId:'demo-page-proof',databaseURL:'https://demo-page-proof.firebaseio.com',tenantId:'tenant-1',deploymentURL:'https://script.google.com/macros/s/SYNTHETIC_PAGE_PACKAGE_0000000000/dev',apiKey:'synthetic-public-api-key-0000',authDomain:'demo-page-proof.firebaseapp.com'});
const scripts=html=>[...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map(m=>m[1]);
test('all three packaged pages default OFF and execute without inspecting Auth, RPC or database',async()=>{
  for(const module of ['owner','qc','jahit']){
    const built=Builder.createPage({module});assert.equal(built.metadata.sourceOff,true);assert.equal(built.metadata.module,module);assert.equal(built.metadata.modules.length,17);assert.match(built.metadata.pageSha256,/^[a-f0-9]{64}$/);
    let hits=0;const host={children:[],replaceChildren(...n){this.children=n;}},document={getElementById(id){assert.equal(id,'soldier-script-host');return host;},createElement(){return {textContent:''};}},root={document};
    Object.defineProperty(root,'google',{get(){hits++;throw Error();}});const context=vm.createContext(root);for(const s of scripts(built.html))vm.runInContext(s,context);for(let i=0;i<6;i++)await Promise.resolve();assert.equal(hits,0);assert.equal(host.children[0].textContent,'Halaman ini sedang disiapkan dan belum diaktifkan.');
    assert.equal(Object.keys(root.SoldierAppsScriptProductionBootstrap).join(','),'start');assert.equal(built.html.includes('soldier-legacy-production-script'),false);assert.equal(built.html.includes('soldierProtectedStorageV1/working/revision'),true);
  }
});
test('enabled offline assembly embeds only the fixed public binding and retains dependency order',()=>{
  for(const module of ['owner','qc','jahit']){const built=Builder.createPage({module,configuration:CONFIG});assert.equal(built.metadata.sourceOff,false);assert.equal(built.html.includes('Object.freeze('+JSON.stringify(CONFIG)+')'),true);for(const s of scripts(built.html))new vm.Script(s);assert.ok(built.html.indexOf('root.SoldierProductionCommandClient = api')<built.html.indexOf('root.SoldierProductionCommandStore=api'));assert.ok(built.html.indexOf('root.SoldierLegacyLifecycleClient=api')<built.html.indexOf('root.SoldierAppsScriptLifecycleBridge=api'));assert.ok(built.html.indexOf('root.SoldierOwnerAccessCodec = api')<built.html.indexOf('root.SoldierOwnerAccessManagement = api'));assert.ok(built.html.indexOf('root.SoldierOwnerAccessManagement = api')<built.html.indexOf("Object.defineProperty(root,'SoldierAppsScriptProductionBootstrap'"));assert.equal(built.html.includes('SOLDIER_REVIEWED_PUBLIC_CONFIGURATION'),false);}
});
test('worker lists, passwords, tokens, service selectors and HTML template injection are not configuration fields',()=>{
  for(const change of [{password:'synthetic'},{ownerEmail:'synthetic@example.invalid'},{workerId:'foreign'},{idToken:'header.payload.signature'},{deploymentURL:CONFIG.deploymentURL+'?division=owner'},{tenantId:'</script>'},{apiKey:'"</script><script>alert(1)'},{authDomain:'foreign.invalid'},{enabled:false}])assert.throws(()=>Builder.createPage({module:'owner',configuration:{...CONFIG,...change}}));
  for(const module of ['potong','admin','<script>','owner?uid=foreign'])assert.throws(()=>Builder.createPage({module}));assert.throws(()=>Builder.createPage({module:'owner',configuration:CONFIG,role:'owner'}));
});
test('configuration getters are rejected without evaluation and output is deterministic',()=>{
  let hits=0;const options={module:'owner'};Object.defineProperty(options,'configuration',{enumerable:true,get(){hits++;throw Error();}});assert.throws(()=>Builder.createPage(options));assert.equal(hits,0);assert.deepEqual(Builder.createPage({module:'qc'}),Builder.createPage({module:'qc'}));assert.equal(Builder.createPage({module:'qc'}).metadata.pageSha256===Builder.createPage({module:'owner'}).metadata.pageSha256,false);
});
test('unknown or drifted source cannot be substituted for reviewed browser code',()=>{
  for(const row of Builder.rows){const raw=fs.readFileSync(require('node:path').join(__dirname,'..',row.file),'utf8');assert.equal(typeof Builder.reviewedSource(row.file,raw),'string');assert.throws(()=>Builder.reviewedSource(row.file,raw+'\n// changed'));}assert.throws(()=>Builder.reviewedSource('../private.json','{}'));
});
function navigationDocument(html){
  const elements=new Map();
  for(const tag of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)){
    const handlers=new Map(),attributes=new Map([...tag[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
    const element={hidden:/\shidden(?:\s|>)/.test(tag[0]),tabIndex:Number(attributes.get('tabindex')||0),focused:false,children:[],
      addEventListener(name,callback){handlers.set(name,callback);},setAttribute(name,value){attributes.set(name,value);},getAttribute(name){return attributes.get(name);},
      focus(){this.focused=true;},replaceChildren(...children){this.children=children;},dispatch(name,event={}){return handlers.get(name)?.(event);}};
    elements.set(tag[1],element);
  }
  const document={getElementById(id){assert.ok(elements.has(id),'known element '+id);return elements.get(id);},createElement(){return {textContent:''};}};
  for(const el of elements.values())el.ownerDocument=document;
  return document;
}
test('owner menu opens immediately without Auth, RPC, stored draft reads or business data',()=>{
  const built=Builder.createPage({module:'owner',configuration:CONFIG}),document=navigationDocument(built.html),root={document};let hits=0;
  root.indexedDB={open(){hits++;throw Error('must stay unopened');}};
  for(const name of ['google','localStorage','sessionStorage','fetch'])Object.defineProperty(root,name,{get(){hits++;throw Error('must stay unopened');}});
  const context=vm.createContext(root);for(const source of scripts(built.html))vm.runInContext(source,context);
  assert.equal(hits,0);assert.equal(document.getElementById('soldier-owner-menu').hidden,false);assert.equal(document.getElementById('soldier-owner-workbench').hidden,true);
  document.getElementById('soldier-owner-tab-1').dispatch('click');assert.equal(document.getElementById('soldier-owner-panel-1').hidden,false);assert.equal(document.getElementById('soldier-owner-panel-0').hidden,true);assert.equal(hits,0);
  assert.match(built.html,/Command Center · Owner/);assert.match(built.html,/Pilih menu kerja seperti biasa/);assert.match(built.html,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);assert.match(built.html,/@media\(max-width:600px\)/);
});
test('owner menu links retain all existing operational modules and escape the HtmlService frame',()=>{
  const html=Builder.createPage({module:'owner',configuration:CONFIG}).html;
  const links=[...html.matchAll(/<a class="soldier-owner-card" href="([^"]+)" target="([^"]+)">/g)];assert.equal(links.length,10);
  const modules=[];
  for(const [,href,target] of links){const url=new URL(href.replace(/&amp;/g,'&'));assert.equal(target,'_top');assert.equal(url.origin+url.pathname,CONFIG.deploymentURL);const division=url.searchParams.get('division');if(division==='qc'){assert.deepEqual([...url.searchParams.keys()],['division']);modules.push('qc');}else{assert.equal(division,'owner');assert.deepEqual([...url.searchParams.keys()],['division','ownerModule']);modules.push(url.searchParams.get('ownerModule'));}}
  assert.deepEqual(modules,['potong','jahit','qc','laporan','stok','gaji','hpp','pembelian','nota','retur']);
  assert.equal(html.includes('ownerModule=qc'),false);assert.equal(html.includes('?division=jahit'),false);
});
test('advanced owner workbench starts only on explicit click, once, inside its own persistent container',async()=>{
  const html=Builder.createPage({module:'owner',configuration:CONFIG}).html,document=navigationDocument(html),calls=[];
  const root={document,SoldierAppsScriptProductionBootstrap:{start(args){calls.push(args);return Promise.resolve({ok:true});}}};
  vm.runInNewContext(scripts(html).at(-1),root);assert.equal(calls.length,0);
  const open=document.getElementById('soldier-owner-settings'),back=document.getElementById('soldier-owner-back'),menu=document.getElementById('soldier-owner-menu'),workbench=document.getElementById('soldier-owner-workbench'),host=document.getElementById('soldier-script-host');
  open.dispatch('click');assert.equal(calls.length,1);assert.equal(calls[0].module,'owner');assert.equal(calls[0].document,document);assert.equal(calls[0].host,host);assert.equal(menu.hidden,true);assert.equal(workbench.hidden,false);assert.equal(open.getAttribute('aria-expanded'),'true');assert.equal(back.focused,true);
  const pendingDraft={textContent:'synthetic pending operation'};host.replaceChildren(pendingDraft);
  back.dispatch('click');assert.equal(workbench.hidden,true);assert.equal(menu.hidden,false);assert.equal(open.getAttribute('aria-expanded'),'false');assert.equal(open.focused,true);
  open.dispatch('click');assert.equal(calls.length,1);assert.equal(host.children[0],pendingDraft);assert.equal(workbench.hidden,false);await Promise.resolve();
});
test('owner menu category tabs support keyboard navigation without triggering authentication',()=>{
  const html=Builder.createPage({module:'owner',configuration:CONFIG}).html,document=navigationDocument(html);let calls=0,prevented=0;
  vm.runInNewContext(scripts(html).at(-1),{document,SoldierAppsScriptProductionBootstrap:{start(){calls++;throw Error();}}});
  const first=document.getElementById('soldier-owner-tab-0'),second=document.getElementById('soldier-owner-tab-1');
  first.dispatch('keydown',{key:'ArrowRight',preventDefault(){prevented++;}});assert.equal(second.getAttribute('aria-selected'),'true');assert.equal(second.tabIndex,0);assert.equal(first.tabIndex,-1);assert.equal(second.focused,true);
  second.dispatch('keydown',{key:'Home',preventDefault(){prevented++;}});assert.equal(first.getAttribute('aria-selected'),'true');assert.equal(document.getElementById('soldier-owner-panel-0').hidden,false);assert.equal(document.getElementById('soldier-owner-panel-1').hidden,true);
  first.dispatch('keydown',{key:'Tab',preventDefault(){throw Error('native tab stays native');}});assert.equal(prevented,2);assert.equal(calls,0);
});
test('QC and jahit keep their existing authenticated startup and disabled owner does not expose navigation',async()=>{
  for(const module of ['qc','jahit']){const html=Builder.createPage({module,configuration:CONFIG}).html,document=navigationDocument(html),calls=[];assert.equal(html.includes('id="soldier-owner-menu"'),false);vm.runInNewContext(scripts(html).at(-1),{document,SoldierAppsScriptProductionBootstrap:{start(args){calls.push(args);return Promise.resolve({ok:true});}}});assert.equal(calls.length,1);assert.equal(calls[0].module,module);await Promise.resolve();}
  const html=Builder.createPage({module:'owner'}).html;assert.equal(html.includes('id="soldier-owner-menu"'),false);assert.equal(html.includes('ownerModule='),false);
});
