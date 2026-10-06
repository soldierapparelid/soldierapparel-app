'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),Page=require('../production-owner-tariff-page.js');
function fixture(configuration=Page.defaultConfiguration){
  const document={readyState:'complete',createElement(tag){return {ownerDocument:document,tagName:tag.toUpperCase(),textContent:'',setAttribute(){},addEventListener(k,fn){this[k]=fn;}};},getElementById(id){assert.equal(id,'soldier-owner-tariff-host');return host;}};
  const host={ownerDocument:document,children:[],replaceChildren(...children){this.children=children;}},stats={starts:0,disposes:0,reloads:0};let args;
  const page=Page.createPage({document,configuration,getBootstrap:()=>({start:async a=>{stats.starts++;args=a;return {ok:true,dispose(){stats.disposes++;}};}}),reload(){stats.reloads++;}});
  return {page,document,host,stats,get args(){return args;}};
}
test('owner page source remains disabled and has no SDK, business read, legacy or override activation',async()=>{
  assert.equal(Page.defaultConfiguration.enabled,false);assert.ok(Object.isFrozen(Page.defaultConfiguration));const f=fixture();assert.equal((await f.page.start()).error,'service_disabled');assert.equal(f.stats.starts,0);assert.equal(f.page.canonical,false);assert.match(f.host.children[0].textContent,/belum ada tarif yang diubah/);
  const html=fs.readFileSync(require.resolve('../owner-tarif.html'),'utf8');assert.equal(/on(?:click|load)=|localStorage|sessionStorage|initializeApp|legacy|firebaseConfig/i.test(html),false);for(const file of ['production-owner-tariff-page.js','production-owner-tariff-bootstrap.js','production-owner-tariff-bridge.js','production-owner-tariff-ui.js','production-owner-tariff-client.js','production-owner-tariff-store.js'])assert.ok(html.includes(file));
});
test('malformed configuration/getters are held without imports or legacy fallback',async()=>{
  let reads=0;const configuration={...Page.defaultConfiguration};Object.defineProperty(configuration,'enabled',{enumerable:true,get(){reads++;return true;}});const f=fixture(configuration);assert.equal((await f.page.start()).ok,false);assert.equal(f.page.canonical,true);assert.equal(f.stats.starts,0);assert.equal(reads,0);assert.match(f.host.children[0].textContent,/belum dapat dibuka/);f.host.children[1].click();assert.equal(f.stats.reloads,1);
});
test('reviewed enabled source is copied, single-flight and held on disposal',async()=>{
  const config={...Page.defaultConfiguration,enabled:true},f=fixture(config);const p=f.page.start();assert.equal(f.page.start(),p);config.enabled=false;assert.equal((await p).ok,true);assert.equal(f.args.module,'owner-tariff');assert.equal(f.args.configuration,f.page.configuration);assert.equal(f.args.configuration.enabled,true);assert.ok(Object.isFrozen(f.args.configuration));assert.equal(f.stats.starts,1);f.page.hold();assert.equal(f.stats.disposes,1);
});
