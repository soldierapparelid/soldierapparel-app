'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Builder=require('../server/apps-script/build-production-page.cjs');
const CONFIG=Object.freeze({enabled:true,projectId:'demo-page-proof',databaseURL:'https://demo-page-proof.firebaseio.com',tenantId:'tenant-1',deploymentURL:'https://script.google.com/macros/s/SYNTHETIC_PAGE_PACKAGE_0000000000/dev',apiKey:'synthetic-public-api-key-0000',authDomain:'demo-page-proof.firebaseapp.com'});
const scripts=html=>[...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map(m=>m[1]);
test('all three packaged pages default OFF and execute without inspecting Auth, RPC or database',async()=>{
  for(const module of ['owner','qc','jahit']){
    const built=Builder.createPage({module});assert.equal(built.metadata.sourceOff,true);assert.equal(built.metadata.module,module);assert.equal(built.metadata.modules.length,16);assert.match(built.metadata.pageSha256,/^[a-f0-9]{64}$/);
    let hits=0;const host={children:[],replaceChildren(...n){this.children=n;}},document={getElementById(id){assert.equal(id,'soldier-script-host');return host;},createElement(){return {textContent:''};}},root={document};
    Object.defineProperty(root,'google',{get(){hits++;throw Error();}});const context=vm.createContext(root);for(const s of scripts(built.html))vm.runInContext(s,context);for(let i=0;i<6;i++)await Promise.resolve();assert.equal(hits,0);assert.equal(host.children[0].textContent,'Halaman ini sedang disiapkan dan belum diaktifkan.');
    assert.equal(Object.keys(root.SoldierAppsScriptProductionBootstrap).join(','),'start');assert.equal(built.html.includes('soldier-legacy-production-script'),false);assert.equal(built.html.includes('firebase-database.js'),false);
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
