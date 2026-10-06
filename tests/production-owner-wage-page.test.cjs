'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Page=require('../production-owner-wage-page.js');
function fixture(configuration=Page.defaultConfiguration){
  const document={readyState:'complete',createElement(tag){return {ownerDocument:document,tagName:tag.toUpperCase(),textContent:'',setAttribute(){},addEventListener(k,fn){this[k]=fn;}};},getElementById(id){assert.equal(id,'soldier-owner-wage-host');return host;}};
  const host={ownerDocument:document,children:[],replaceChildren(...children){this.children=children;}},stats={starts:0,disposes:0,reloads:0};let args;
  const page=Page.createPage({document,configuration,getBootstrap:()=>({start:async a=>{stats.starts++;args=a;return {ok:true,dispose(){stats.disposes++;}};}}),reload(){stats.reloads++;}});
  return {page,document,host,stats,get args(){return args;}};
}
test('owner page source remains disabled and has no SDK, business read, legacy or override activation',async()=>{
  assert.equal(Page.defaultConfiguration.enabled,false);assert.ok(Object.isFrozen(Page.defaultConfiguration));const f=fixture();assert.equal((await f.page.start()).error,'service_disabled');assert.equal(f.stats.starts,0);assert.equal(f.page.canonical,false);assert.match(f.host.children[0].textContent,/belum terhubung ke catatan usaha/);
  const html=fs.readFileSync(require.resolve('../owner-upah.html'),'utf8');assert.equal(/on(?:click|load)=|localStorage|sessionStorage|initializeApp|legacy|firebaseConfig/i.test(html),false);for(const file of ['production-owner-wage-page.js','production-owner-wage-bootstrap.js','production-owner-wage-bridge.js','production-owner-wage-ui.js','production-owner-wage-client.js'])assert.ok(html.includes(file));
});
test('malformed configuration/getters are held without imports or legacy fallback',async()=>{
  let reads=0;const configuration={...Page.defaultConfiguration};Object.defineProperty(configuration,'enabled',{enumerable:true,get(){reads++;return true;}});const f=fixture(configuration);assert.equal((await f.page.start()).ok,false);assert.equal(f.page.canonical,true);assert.equal(f.stats.starts,0);assert.equal(reads,0);assert.match(f.host.children[0].textContent,/belum dapat dibuka/);f.host.children[1].click();assert.equal(f.stats.reloads,1);
});
test('reviewed enabled source is copied, single-flight and held on disposal',async()=>{
  const config={...Page.defaultConfiguration,enabled:true},f=fixture(config);const p=f.page.start();assert.equal(f.page.start(),p);config.enabled=false;assert.equal((await p).ok,true);assert.equal(f.args.module,'owner-wage');assert.equal(f.args.configuration,f.page.configuration);assert.equal(f.args.configuration.enabled,true);assert.ok(Object.isFrozen(f.args.configuration));assert.equal(f.stats.starts,1);f.page.hold();assert.equal(f.stats.disposes,1);
});
test('page assets have required dependency order and no inline startup, remote SDK, writable controls or stored configuration',()=>{
  const html=fs.readFileSync(require.resolve('../owner-upah.html'),'utf8'),files=[...html.matchAll(/<script defer src="([^?]+)\?/g)].map(m=>m[1]);
  assert.deepEqual(files,['operations-codec.js','maklon-earnings.js','production-view-client.js','production-owner-wage-client.js','production-owner-wage-bridge.js','production-owner-wage-ui.js','production-owner-wage-bootstrap.js','production-owner-wage-page.js']);
  assert.doesNotMatch(html,/<script(?! defer)|https:\/\/www\.gstatic|<input|<form|store\.js|commands|journal|indexedDB|firebaseConfig|(?:onload|onclick)=/i);
  assert.deepEqual(Page.defaultConfiguration,{enabled:false,projectId:'',databaseURL:'',tenantId:'',endpointURL:'',apiKey:'',authDomain:''});
  const css=fs.readFileSync(require.resolve('../production-owner-wage-ui.css'),'utf8');assert.match(css,/color-scheme:dark/);assert.match(css,/\[hidden\]/);assert.match(css,/focus-visible/);
});
test('actual browser bootstrap/page globals boot OFF without touching SDK imports, network or storage surfaces',async()=>{
  const f=fixture();let touches=0;const root={document:f.document,location:{reload(){touches++;}}};
  for(const key of ['fetch','indexedDB','localStorage','sessionStorage'])Object.defineProperty(root,key,{get(){touches++;throw Error('OFF page must not open this capability');}});
  const context=vm.createContext(root);for(const file of ['production-owner-wage-bootstrap.js','production-owner-wage-page.js'])vm.runInContext(fs.readFileSync(require.resolve('../'+file),'utf8'),context,{filename:file});
  const result=await root.SoldierProductionOwnerWagePage.start();assert.equal(result.error,'service_disabled');assert.equal(touches,0);assert.equal(root.SoldierProductionOwnerWagePage.canonical,false);assert.equal(root.SoldierProductionOwnerWagePage.configuration.enabled,false);assert.match(f.host.children[0].textContent,/belum terhubung ke catatan usaha/);
});

