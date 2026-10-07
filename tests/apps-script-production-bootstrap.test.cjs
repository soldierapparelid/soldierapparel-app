'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Bootstrap=require('../apps-script-production-bootstrap.js');
const {fixture}=require('./helpers/apps-script-bootstrap-fixture.cjs');
const flush=async()=>{for(let i=0;i<35;i++)await Promise.resolve();};
test('source OFF inspects neither the private runner nor arguments, storage or SDK',async()=>{
  let hits=0;const configuration={enabled:false};Object.defineProperty(configuration,'projectId',{get(){hits++;throw Error();}});
  const dependencies={getConfiguration:()=>configuration};for(const k of ['getScriptRun','sdkLoader','indexedDB'])Object.defineProperty(dependencies,k,{get(){hits++;throw Error();}});
  const args=new Proxy({},{get(){hits++;throw Error();},ownKeys(){hits++;throw Error();}});
  assert.deepEqual(await Bootstrap.createBootstrap(dependencies).start(args),{ok:false,error:'service_disabled'});assert.equal(hits,0);
});
test('browser API exposes only a nonreplaceable source-OFF start and no configurable factory',async()=>{
  const root={};vm.runInNewContext(fs.readFileSync(require.resolve('../apps-script-production-bootstrap.js'),'utf8'),root);
  assert.deepEqual(Object.keys(root.SoldierAppsScriptProductionBootstrap),['start']);const d=Object.getOwnPropertyDescriptor(root,'SoldierAppsScriptProductionBootstrap');assert.equal(d.writable,false);assert.equal(d.configurable,false);assert.equal((await d.value.start({enabled:true})).error,'service_disabled');
});
test('foreign hosts, credentials, query selectors, extra roles and getter fields fail before Auth',async()=>{
  for(const change of [f=>f.config.deploymentURL+='?uid=someone',f=>f.config.databaseURL+='/',f=>f.config.authDomain='foreign.example',f=>f.config.accessToken='synthetic',f=>f.args.uid='foreign',f=>f.args.module='potong',f=>Object.defineProperty(f.args,'module',{enumerable:true,get(){throw Error('private');}})]){const f=fixture();change(f);assert.equal((await f.bootstrap.start(f.args)).error,'unavailable');assert.equal(f.stats.loads,0);assert.equal(f.native.native.stats.reads,0);}
});
test('real scoped pages connect through their RPC bridges for Jahit, QC and owner without browser database reads',async()=>{
  for(const division of ['jahit','qc','owner']){const f=fixture(division),r=await f.bootstrap.start(f.args);assert.equal(r.ok,true);assert.equal(f.native.native.stats.writes,0);assert.equal(f.native.calls[0].kind,'read');assert.equal(f.bridgeOptions.auth,f.auth);assert.equal(f.bridgeOptions.deploymentURL,f.config.deploymentURL);assert.equal(f.bridgeOptions.database,undefined);assert.equal(f.stats.popups,0);assert.equal(f.text().includes(division==='owner'?'Pengelolaan produksi owner':division==='qc'?'QC & inspeksi':'Pekerjaan jahit'),true);r.dispose();assert.equal(f.host.children.length,0);assert.equal(f.stats.offs,1);}
});
test('session persistence precedes Auth observation and popup starts only in the click task',async()=>{
  const f=fixture('qc',{loggedOut:true,pausePersistence:true}),pending=f.bootstrap.start(f.args);await flush();assert.equal(f.stats.watches,0);assert.equal(f.button('soldier-script-login').disabled,true);f.persistence.resolve();await flush();assert.equal(f.stats.watches,1);assert.equal(f.stats.popups,0);f.button('soldier-script-login').click();assert.equal(f.stats.popups,1);f.emit(f.user);assert.equal((await pending).ok,true);
});
test('failed popup remains retryable and never displays Google exception contents',async()=>{
  const f=fixture('qc',{loggedOut:true,popupFailure:true}),pending=f.bootstrap.start(f.args);await flush();f.button('soldier-script-login').click();await flush();assert.equal(f.button('soldier-script-login').disabled,false);assert.equal(f.text().includes('SYNTHETIC_SECRET'),false);f.emit(f.user);assert.equal((await pending).ok,true);
});
test('unverified and non-Google users never contact the business RPC until a valid account arrives',async()=>{
  for(const change of [u=>({...u,emailVerified:false}),u=>({...u,providerData:[{providerId:'password'}]}),u=>({...u,uid:'../bad'})]){const f=fixture();f.auth.currentUser=change(f.user);const p=f.bootstrap.start(f.args);await flush();assert.equal(f.native.calls.length,0);f.emit(f.user);assert.equal((await p).ok,true);}
});
test('owner page selection cannot grant owner access to a sewing partner',async()=>{
  const f=fixture('jahit');f.args.module='owner';const gateway=require('../server/apps-script/owner-lifecycle-rpc-gateway.cjs').createAppsScriptOwnerLifecycleRpcGateway({enabled:true,binding:f.native.native.f.binding,runtime:f.native.native.create()});
  function runner(fail,success){return {withFailureHandler:fn=>runner(fn,success),withSuccessHandler:fn=>runner(fail,fn),soldierOwnerLifecycleRpc:q=>queueMicrotask(()=>success(gateway.dispatchJson(q)))};}
  const selected=runner();f.dependencies.getScriptRun=()=>selected;assert.equal((await f.bootstrap.start(f.args)).ok,false);assert.equal(f.native.native.stats.writes,0);assert.equal(f.native.indexed.stats.opens,0);assert.equal(f.text().includes('Masuk kembali'),true);
});
test('module labels cannot replace the server division and a QC account receives no wage lane',async()=>{
  const f=fixture('qc');f.args.module='jahit';assert.equal((await f.bootstrap.start(f.args)).ok,true);assert.equal(f.text().includes('QC & inspeksi'),true);assert.equal(f.text().includes('Upah saya'),false);assert.equal((await f.controller.refreshFinance()).error,'access_denied');
});
test('logout during a token refresh clears the UI and prevents a late production command',async()=>{
  const f=fixture('qc'),p=await f.bootstrap.start(f.args);assert.equal(p.ok,true);assert.equal(f.controller.selectProduct('product-1').ok,true);let release,began;const waiting=new Promise(r=>{began=r;});f.native.controls.tokenGate=()=>{began();return new Promise(r=>{release=r;});};
  const sending=f.controller.submit('appendCount',{workerId:'worker-1',workDate:'2026-10-06',quantity:1});await waiting;f.button('soldier-script-logout').click();assert.equal(f.stats.offs,1);assert.equal(f.text().includes('Masuk kembali'),true);assert.equal(f.text().includes('Synthetic.Series'),false);release();assert.equal((await sending).ok,false);assert.equal(f.native.native.stats.writes,0);assert.equal(f.stats.signouts,1);assert.ok(f.events.indexOf('auth-off')<f.events.indexOf('signout'));
});
test('same-UID account object replacement closes the first account and cannot reopen it',async()=>{
  const f=fixture();assert.equal((await f.bootstrap.start(f.args)).ok,true);const calls=f.native.calls.length;f.emit({...f.user});assert.equal(f.text().includes('Masuk kembali'),true);assert.equal(f.bridgeOptions.isCurrent(),false);f.emit(f.user);await flush();assert.equal(f.native.calls.length,calls);assert.equal(f.stats.offs,1);
});
test('a terminal cached account can explicitly sign out and reload for a fresh Google login',async()=>{
  const f=fixture();assert.equal((await f.bootstrap.start(f.args)).ok,true);f.emit({...f.user});const button=f.button('soldier-script-choose-account');assert.ok(button);button.click();await flush();assert.equal(f.stats.signouts,1);assert.equal(f.stats.reloads,1);assert.equal(f.native.native.stats.writes,0);assert.equal(f.text().includes('Masuk kembali'),true);
});
test('runner and source changes invalidate current callbacks and stop subsequent writes',async()=>{
  for(const change of [f=>f.config.tenantId='foreign',f=>f.base.scriptRun.withSuccessHandler=()=>{},f=>f.dependencies.getController=()=>({})]){const f=fixture();assert.equal((await f.bootstrap.start(f.args)).ok,true);change(f);assert.equal(f.bridgeOptions.isCurrent(),false);assert.equal((await f.controller.refresh()).ok,false);assert.equal(f.native.native.stats.writes,0);f.emit(f.user);assert.equal(f.text().includes('Masuk kembali'),true);}
});
test('source changes while loading and a foreign existing app fail before opening business data',async()=>{
  const f=fixture('qc',{pauseLoader:true}),pending=f.bootstrap.start(f.args);f.config.apiKey='changed-public-key';f.loader.resolve(f.sdk);assert.equal((await pending).ok,false);assert.equal(f.stats.initializations,0);
  const bad=fixture();bad.apps.push({name:'soldier-apps-script-production-v1',options:{...bad.config,apiKey:'wrong'}});assert.equal((await bad.bootstrap.start(bad.args)).ok,false);assert.equal(bad.native.calls.length,0);
});
test('a source-OFF restart does not delete retained journals or revive disposed callbacks',async()=>{
  const f=fixture();assert.equal((await f.bootstrap.start(f.args)).ok,true);const original=f.native.indexed.databases.size;f.button('soldier-script-logout').click();f.config.enabled=false;assert.equal((await Bootstrap.createBootstrap(f.dependencies).start(f.args)).error,'service_disabled');assert.equal(f.native.indexed.databases.size,original);assert.equal(f.text().includes('Masuk kembali'),true);
});
test('owner form accepted with a lost reply recovers across bootstrap reload with one production write',async()=>{
  const f=fixture('owner'),first=await f.bootstrap.start(f.args);assert.equal(first.ok,true);
  const action=text=>{const n=f.all().find(n=>n.tagName==='button'&&n.textContent===text);assert.ok(n,text);return n.click();};
  action('Synthetic.Series · Item · M');action('Atur PO');
  for(const [name,value]of Object.entries({quantity:'12',workDate:'2026-10-06',note:'Synthetic recoverable form'})){const n=f.all().find(n=>n.name===name);assert.ok(n);n.value=value;n.handlers.input();}
  f.native.controls.drop=q=>q.kind==='execute';await f.all().find(n=>n.tagName==='form').handlers.submit({preventDefault(){}});assert.equal(f.native.native.stats.writes,1);assert.equal(f.text().includes('Catatan yang perlu diperiksa'),true);
  const retained=f.native.journalValues()[0];assert.equal(retained.includes('ownerSetPO'),true);assert.equal(retained.includes(f.native.native.readInput().idToken),false);first.dispose();f.native.controls.drop=null;
  assert.equal((await Bootstrap.createBootstrap(f.dependencies).start(f.args)).ok,true);assert.equal(f.text().includes('Catatan yang perlu diperiksa'),true);await action('Periksa kembali');assert.equal(f.native.native.stats.writes,1);assert.equal(f.native.native.stats.puts,1);assert.equal(f.text().includes('Catatan yang perlu diperiksa'),false);assert.equal(f.native.native.root.soldier.produksi.produksi[0].poJumlah,12);assert.equal(f.native.calls.at(-2).kind,'resolve');
});
