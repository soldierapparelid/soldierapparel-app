'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Bootstrap=require('../apps-script-production-bootstrap.js');
const {fixture}=require('./helpers/apps-script-bootstrap-fixture.cjs');
const flush=async()=>{for(let i=0;i<35;i++)await Promise.resolve();};
test('source OFF inspects neither the private runner nor arguments, storage or SDK',async()=>{
  let hits=0;const configuration={enabled:false};Object.defineProperty(configuration,'projectId',{get(){hits++;throw Error();}});
  const dependencies={getConfiguration:()=>configuration};for(const k of ['getScriptRun','sdkLoader','sdkRevisionLoader','getRevisionSync','indexedDB'])Object.defineProperty(dependencies,k,{get(){hits++;throw Error();}});
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
test('terminal recovery navigates the fixed web app in the top frame through a user-click link',async()=>{
  for(const module of ['qc','jahit','owner']){const f=fixture(module);assert.equal((await f.bootstrap.start(f.args)).ok,true);f.emit({...f.user});const link=f.button('soldier-script-reload');assert.equal(link.tagName,'a');assert.equal(link.href,f.config.deploymentURL+'?division='+module);assert.equal(link.target,'_top');assert.equal(link.rel,'noopener noreferrer');assert.equal(f.stats.reloads,0);assert.equal(f.text().includes('Synthetic.Series'),false);}
});
test('account change waits for signout and requires a new user click rather than reloading the HtmlService iframe',async()=>{
  const f=fixture('qc',{pauseSignout:true});assert.equal((await f.bootstrap.start(f.args)).ok,true);f.emit({...f.user});const button=f.button('soldier-script-choose-account'),link=f.button('soldier-script-reload');button.click();assert.equal(link.hidden,true);assert.equal(button.disabled,true);assert.equal(f.stats.signouts,1);f.signout.resolve();await flush();assert.equal(link.hidden,false);assert.equal(f.stats.reloads,0);assert.equal(f.native.native.stats.writes,0);assert.equal(f.text().includes('Akun sudah keluar'),true);assert.equal(f.text().includes('Synthetic.Series'),false);
});
test('failed signout remains retryable without exposing the Google error or reviving scoped data',async()=>{
  const f=fixture('qc',{signoutFailure:true});assert.equal((await f.bootstrap.start(f.args)).ok,true);f.emit({...f.user});const button=f.button('soldier-script-choose-account');button.click();await flush();assert.equal(button.disabled,false);assert.equal(f.button('soldier-script-reload').hidden,false);assert.equal(f.stats.reloads,0);assert.equal(f.text().includes('SYNTHETIC_SECRET'),false);assert.equal(f.text().includes('Synthetic.Series'),false);assert.equal(f.bridgeOptions.isCurrent(),false);button.click();await flush();assert.equal(f.stats.signouts,2);
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
test('owner access is lazy and nonowner pages never inspect its factory or open its journal',async()=>{
  for(const division of ['qc','jahit']){const f=fixture(division);let hits=0;f.dependencies.getOwnerAccess=()=>{hits++;throw Error();};assert.equal((await f.bootstrap.start(f.args)).ok,true);assert.equal(hits,0);assert.equal(f.button('soldier-script-open-owner-access'),undefined);assert.equal(f.native.indexed.databases.has('soldier-owner-access-journal:v1'),false);}
  const f=fixture('owner',{accessRPC:true});assert.equal((await f.bootstrap.start(f.args)).ok,true);assert.ok(f.button('soldier-script-open-owner-access'));assert.equal(f.accessCalls.length,0);assert.equal(f.accessBridge,undefined);assert.equal(f.native.indexed.databases.has('soldier-owner-access-journal:v1'),false);
});
test('owner can open verified access controls with the captured Auth account and perform confirmed revocation',async()=>{
  const f=fixture('owner',{accessRPC:true});assert.equal((await f.bootstrap.start(f.args)).ok,true);f.button('soldier-script-open-owner-access').click();for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.accessBridgeOptions.user,f.user);assert.equal(f.accessBridgeOptions.getCurrentUser(),f.user);assert.equal(f.accessBridgeOptions.googleScriptRun,f.base.scriptRun);assert.equal(f.text().includes('Akses mitra dan QC'),true);assert.equal(f.text().includes('Synthetic partner'),true);assert.equal(f.native.indexed.databases.has('soldier-owner-access-journal:v1'),true);
  f.all().find(n=>n.tagName==='button'&&n.textContent==='Cabut akses').click();assert.equal(f.native.native.stats.puts,0);await f.all().find(n=>n.tagName==='button'&&n.textContent==='Ya, cabut akses').click();for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.native.native.stats.puts,1);assert.equal(f.text().includes('Akses dicabut'),true);assert.equal(f.text().includes('Pengelolaan produksi owner'),true);assert.equal(f.native.native.root.soldier.produksi.produksi[0].jahit[0].total,20);
});
test('unavailable access backend remains isolated from already verified owner production controls',async()=>{
  const f=fixture('owner');assert.equal((await f.bootstrap.start(f.args)).ok,true);f.button('soldier-script-open-owner-access').click();for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(f.text().includes('Pengelolaan produksi owner'),true);assert.equal(f.text().includes('Koneksi belum tersedia'),true);assert.equal(f.text().includes('Masuk kembali'),false);assert.equal(f.native.native.stats.puts,0);assert.equal(f.bridgeOptions.isCurrent(),true);assert.equal(f.native.indexed.databases.has('soldier-owner-access-journal:v1'),false);
});
test('missing or replaced owner access factory fails closed before creating any owner journal',async()=>{
  const f=fixture('owner');f.dependencies.getOwnerAccess=()=>undefined;assert.equal((await f.bootstrap.start(f.args)).error,'unavailable');assert.equal(f.native.indexed.databases.has('soldier-owner-access-journal:v1'),false);
  for(const change of [f=>f.dependencies.getOwnerAccess=()=>({...f.accessAPI}),f=>f.accessAPI.mountOwnerAccessManagementPage=()=>{},f=>f.dependencies.newId=()=>('changed-id')]){const g=fixture('owner',{accessRPC:true});assert.equal((await g.bootstrap.start(g.args)).ok,true);change(g);g.button('soldier-script-open-owner-access').click();assert.equal(g.text().includes('Masuk kembali'),true);assert.equal(g.text().includes('Synthetic.Series'),false);assert.equal(g.accessCalls.length,0);assert.equal(g.native.native.stats.puts,0);}
});
test('access denial clears both owner production and access data without exposing server contents',async()=>{
  const f=fixture('owner',{accessRPC:true});assert.equal((await f.bootstrap.start(f.args)).ok,true);f.accessControls.reply=()=>JSON.stringify({ok:false,error:'access_denied'});f.button('soldier-script-open-owner-access').click();for(let i=0;i<15;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(f.text().includes('Masuk kembali'),true);assert.equal(f.text().includes('Synthetic.Series'),false);assert.equal(f.text().includes('Synthetic partner'),false);assert.equal(f.bridgeOptions.isCurrent(),false);assert.equal(f.native.native.stats.puts,0);
});
test('account change with access controls open disposes both channels and keeps journals on disk',async()=>{
  const f=fixture('owner',{accessRPC:true});assert.equal((await f.bootstrap.start(f.args)).ok,true);f.button('soldier-script-open-owner-access').click();for(let i=0;i<15;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(f.text().includes('Synthetic partner'),true);const databases=f.native.indexed.databases.size,calls=f.accessCalls.length;f.emit({...f.user});assert.equal(f.text().includes('Masuk kembali'),true);assert.equal(f.text().includes('Synthetic partner'),false);assert.equal(f.native.indexed.databases.size,databases);assert.equal((await f.accessBridge.refresh()).error,'access_denied');assert.equal(f.accessCalls.length,calls);
});

function revisionFixture(division='qc',{pauseSDK=false,foreignApp=false,requireScopedReady=false}={}){
  const f=fixture(division),Page=require('../legacy-lifecycle-page.js'),events=[],values=[],errors=[],listeners={};let page,options,release,off,disposed=false;
  const stats={subscriptions:0,offs:0,ready:0,resumes:0},gate=new Promise(resolve=>{release=resolve;});
  const pageAPI={createLegacyLifecyclePage(args){page=Page.createLegacyLifecyclePage(args);return page;}};
  const native={getDatabase(app){return {app:foreignApp?{}:app};},ref(database,path){assert.equal(path,'soldierProtectedStorageV1/working/revision');return {key:'revision'};},onValue(reference,value,error){assert.equal(reference.key,'revision');assert.equal(Object.hasOwn(reference,'database'),false);stats.subscriptions++;events.push(['subscribe',f.native.calls.length]);listeners.value=value;listeners.error=error;if(requireScopedReady&&!page.canAutoRefresh())error({code:'PERMISSION_DENIED'});else value({val:()=>0});return ()=>{stats.offs++;};}};
  const syncAPI={createRevisionSync(args){options=args;off=args.subscribe(value=>values.push(value),code=>errors.push(code));return {ready(){stats.ready++;events.push(['ready',f.native.calls.length]);},resume(){stats.resumes++;},dispose(){if(disposed)return;disposed=true;off();}};}};
  f.dependencies.getPage=()=>pageAPI;f.dependencies.getRevisionSync=()=>syncAPI;f.dependencies.sdkRevisionLoader=()=>pauseSDK?gate:Promise.resolve(native);
  return {f,stats,events,values,errors,listeners,release:()=>release(native),get page(){return page;},get options(){return options;}};
}
test('partner and QC subscribe to only the revision leaf after the scoped RPC and mark the page ready',async()=>{
  for(const division of ['jahit','qc']){const h=revisionFixture(division),r=await h.f.bootstrap.start(h.f.args);assert.equal(r.ok,true);assert.deepEqual(h.events,[['ready',1],['subscribe',1]]);assert.deepEqual(h.values,[0]);assert.equal(h.options.canRefresh(),true);
    const reads=h.f.native.calls.length;h.listeners.value({val:()=>1});assert.equal(h.f.native.calls.length,reads);assert.equal((await h.options.refresh()).ok,true);assert.equal(h.f.native.calls.at(-1).kind,'read');assert.equal(h.f.native.calls.length,reads+1);assert.equal(h.f.native.native.stats.writes,0);
    if(division==='jahit'){assert.equal((await h.f.controller.refreshFinance()).ok,true);const calls=h.f.native.calls.length;assert.equal((await h.options.refresh()).ok,true);assert.deepEqual(h.f.native.calls.slice(calls).map(x=>x.kind),['read','readFinance']);assert.equal(h.f.text().includes('Tekan tombol di atas'),false);}
    r.dispose();h.listeners.value({val:()=>2});assert.deepEqual(h.values,[0,1]);assert.equal(h.stats.offs,1);assert.equal(h.options.isCurrent(),false);assert.equal(h.page.canAutoRefresh(),false);
  }
});
test('a first-login reader grant can be established by scoped connect before native permission is checked',async()=>{
  for(const division of ['jahit','qc']){const h=revisionFixture(division,{requireScopedReady:true}),r=await h.f.bootstrap.start(h.f.args);assert.equal(r.ok,true);assert.deepEqual(h.errors,[]);assert.deepEqual(h.values,[0]);assert.equal(h.stats.subscriptions,1);assert.equal(h.f.text().includes('Masuk kembali'),false);assert.equal(h.options.isCurrent(),true);r.dispose();}
});
test('pending revision SDK load is cancelled by logout and foreign database apps fail without attaching',async()=>{
  const h=revisionFixture('qc',{pauseSDK:true}),r=await h.f.bootstrap.start(h.f.args);assert.equal(r.ok,true);r.dispose();h.release();await flush();assert.equal(h.stats.subscriptions,0);assert.equal(h.stats.offs,0);
  const bad=revisionFixture('qc',{foreignApp:true}),started=await bad.f.bootstrap.start(bad.f.args);assert.equal(started.ok,true);assert.equal(bad.stats.subscriptions,0);assert.deepEqual(bad.errors,['unavailable']);assert.equal(bad.f.native.native.stats.writes,0);started.dispose();
});
test('revision denial clears data, generic failure preserves it, and account replacement detaches the listener',async()=>{
  for(const revoke of [true,false]){const h=revisionFixture(),r=await h.f.bootstrap.start(h.f.args);assert.equal(r.ok,true);h.listeners.value({val:()=>({SYNTHETIC_PRIVATE:'never shown'})});h.listeners.error({code:'unavailable',message:'SYNTHETIC_PRIVATE'});assert.deepEqual(h.errors,['unavailable','unavailable']);assert.equal(h.f.text().includes('Synthetic.Series'),true);
    if(revoke)h.listeners.error({code:'PERMISSION_DENIED',message:'SYNTHETIC_PRIVATE'});else h.f.emit({...h.f.user});assert.equal(h.stats.offs,1);assert.equal(h.f.text().includes('Synthetic.Series'),false);const errors=h.errors.slice();h.listeners.error({code:'PERMISSION_DENIED'});assert.deepEqual(h.errors,errors);assert.equal(h.f.text().includes('SYNTHETIC_PRIVATE'),false);assert.equal(h.page.canAutoRefresh(),false);
  }
});
test('dirty sewing and QC forms block revision refresh until a separate discard confirmation',async()=>{
  for(const division of ['jahit','qc']){const h=revisionFixture(division),f=h.f,r=await f.bootstrap.start(f.args);assert.equal(r.ok,true);assert.equal(f.controller.selectProduct('product-1').ok,true);
    const name=division==='jahit'?'good':'quantity',input=()=>f.all().find(n=>n.name===name);input().value='7';input().handlers.input();assert.equal(h.page.canAutoRefresh(),false);const before=f.native.calls.length;assert.deepEqual(await h.options.refresh(),{ok:false,error:'busy'});assert.equal(f.native.calls.length,before);
    h.page.setRevisionStatus({pending:true,blocked:true,error:null,busy:false});assert.equal(f.text().includes('Selesaikan isian'),true);const action=text=>f.all().find(n=>n.tagName==='button'&&n.textContent===text).click();action('Batalkan isian dan muat data baru');assert.equal(input().value,'7');assert.equal(h.page.canAutoRefresh(),false);
    await f.controller.refresh();assert.equal(input().value,'7');assert.equal(h.page.canAutoRefresh(),false);const resumes=h.stats.resumes;action('Ya, batalkan isian yang belum disimpan');assert.equal(h.page.canAutoRefresh(),true);assert.equal(input().value,'1');assert.ok(h.stats.resumes>resumes);assert.equal(f.native.native.stats.writes,0);r.dispose();
  }
});
test('QC inspection totals and notes count as unsaved input, while a confirmed saved report resumes refresh',async()=>{
  const qc=revisionFixture(),q=qc.f,qr=await q.bootstrap.start(q.args);assert.equal(qr.ok,true);q.controller.selectProduct('product-1');q.all().find(n=>n.tagName==='button'&&n.textContent==='Periksa barang').click();const amount=q.all().find(n=>n.name==='totals.ok');amount.value='3';amount.handlers.input();const note=q.all().find(n=>n.name==='note');note.value='Synthetic unsaved note';note.handlers.input();assert.equal(qc.page.canAutoRefresh(),false);await q.controller.refresh();assert.equal(q.all().find(n=>n.name==='totals.ok').value,'3');assert.equal(q.all().find(n=>n.name==='note').value,'Synthetic unsaved note');qr.dispose();
  const h=revisionFixture('jahit'),f=h.f,r=await f.bootstrap.start(f.args);assert.equal(r.ok,true);f.controller.selectProduct('product-1');f.all().find(n=>n.tagName==='button'&&n.textContent==='Ubah laporan').click();for(const [name,value]of Object.entries({workDate:'2026-10-06',good:'7',reject:'0'})){const input=f.all().find(n=>n.name===name);input.value=value;input.handlers.input();}assert.equal(h.page.canAutoRefresh(),false);const resumes=h.stats.resumes;await f.all().find(n=>n.tagName==='form').handlers.submit({preventDefault(){}});assert.equal(f.native.native.stats.writes,1);assert.equal(h.page.canAutoRefresh(),true);assert.ok(h.stats.resumes>resumes);r.dispose();
});
