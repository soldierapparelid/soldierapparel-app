'use strict';
const readReviewedLegacyHtml=require('./helpers/legacy-html-source.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const directory=path.resolve(__dirname,'..');
const html=division=>readReviewedLegacyHtml(division+'-command.html');
const cfg={apiKey:'synthetic-public-config',projectId:'synthetic-project',databaseURL:'https://synthetic-project-default-rtdb.asia-southeast1.firebasedatabase.app'};
class Storage{
  constructor(entries=[]){this.values=new Map(entries);this.reads=[];}
  get length(){return this.values.size;}
  key(index){return [...this.values.keys()][index]??null;}
  getItem(key){this.reads.push(key);return this.values.get(key)??null;}
  setItem(key,value){this.values.set(key,String(value));}
  removeItem(key){this.values.delete(key);}
}
function deferred(){let resolve;return {promise:new Promise(yes=>resolve=yes),resolve:value=>resolve(value)};}
function fakeSync(){
  const databases=new Map(),calls=[];
  return {databases,calls,api:{async open(options){
    calls.push(options);const values=databases.get(options.dbName)||new Map();databases.set(options.dbName,values);
    for(const key of options.keys){const value=options.storage.getItem(key);if(value!==null&&!values.has(key))values.set(key,value);}
    return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),key:index=>[...values.keys()][index]??null,get length(){return values.size;},status:()=>({pending:false,error:''}),whenIdle:async()=>{},refresh:async()=>{},close(){}};
  }}};
}
function between(source,start,end){const from=source.indexOf(start);assert.ok(from>=0,start);const to=source.indexOf(end,from);assert.ok(to>from,end);return source.slice(from,to);}
function bootCode(source,division){const name=division==='jahit'?'bootJahit':'bootQC';const match=source.match(new RegExp('window\\.appReady=\\(async function '+name+'\\(\\)\\{[\\s\\S]*?\\}\\)\\(\\);'));assert.ok(match,name);return match[0];}
function harness(division,{storage=new Storage(),sync=fakeSync(),user='synthetic-user-1',owner=false,workerId='synthetic-worker-1',gate,imageGate,obsolete=false,cleanupApi=true}={}){
  const source=html(division),events=[],nodes=new Map(),cleanups=[];
  const element=id=>{if(!nodes.has(id))nodes.set(id,{id,tagName:'DIV',value:'',disabled:false,textContent:'',innerHTML:'',checked:false,style:{},classList:{add(){},remove(){}},addEventListener(){},replaceChildren(){this.textContent='';this.innerHTML='';events.push('clear:'+id);}});return nodes.get(id);};
  const business=element('business-root');business.textContent='synthetic-visible-business';const panel=element('soldier-access-panel');panel.textContent='Google login';
  const wrap={prepend(node){nodes.set(node.id,node);events.push('notice');}};
  const document={body:{children:[business,panel]},querySelectorAll:()=>[],querySelector:selector=>selector==='.wrap'?wrap:element(selector),getElementById:id=>nodes.get(id)||null,createElement:()=>({id:'',className:'',textContent:''}),addEventListener(){}};
  const access={uid:user,authorized:!obsolete,profile:owner?{active:true,owner:true}:{active:true,owner:false,modules:{[division]:true},workerId},auth:{currentUser:{uid:user}},app:{options:cfg},db:{}};
  if(cleanupApi)access.registerCleanup=fn=>{cleanups.push(fn);events.push('cleanup-registered');return ()=>{};};
  const context={URL,console,document,localStorage:storage,indexedDB:{},FB:{apiKey:cfg.apiKey,dbUrl:cfg.databaseURL,projectId:cfg.projectId,connected:false},AppSyncStorage:sync.api,
    SoldierAccess:{async connect(config,module,options){events.push('authorize:'+module+':'+String(options.pending()));if(gate)await gate.promise;return access;}},
    DB_PRODUKSI:[],DB_IMAGES:{},OFFLINE_ORDER_IMAGES:{},META:{tukang:[],tarif:{},tarifJahit:{},jenisBahan:[],tukangJahit:[],kasbonJahit:[]},MODE:null,CURRENT_TUKANG:null,HIDE_HARGA:true,ADMIN_GROUP_BY:'barang',
    jahitProductionJournal:null,jahitMetaJournal:null,jahitJournalStorage:null,jahitConnectionError:'',jahitConnectionGeneration:0,jahitUnsubscribers:[],jahitMetaTimer:null,jahitReconnectTimer:null,clearPendingTimerJahit:null,autoPollTimer:null,firebaseMetaSyncReady:false,
    qcJournal:null,qcJournalStorage:null,qcSyncError:'',qcConnectionGeneration:0,qcUnsubscribers:[],qcRetryTimer:null,qcDeletionStorageError:'',qcPendingDeletionLog:{target:'',entries:{}},_QC_PENDING_DEL_KEY:'qc_pending_deletions_v1',PAYROLL_WORKERS:[],PEMERIKSA_NAMA:'',qcSyncBase:[],qcPendingTarget:'',
    firebaseSyncReady:false,pendingLocalChange:false,syncTimer:null,_toastTimer:null,QC_OWNED_FIELDS:['qc'],JAHIT_FIELDS:['jahit'],JAHIT_META_FIELDS:['tukangJahit'],
    addEventListener(){},setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},uid:()=>Math.random().toString(36).slice(2),today:()=> '2026-01-01',
    fbLoad(){events.push('public-config');},metaLoad(){events.push('hydrate-meta');context.META=JSON.parse(context.jahitStorage().getItem('jahit_meta')||'{}');},
    produksiLoad(){events.push('hydrate-production');context.DB_PRODUKSI=JSON.parse(context.jahitStorage().getItem('jahit_produksi')||'[]');},
    produksiLoadLocal(){events.push('hydrate-production');const value=JSON.parse(context.qcStorage().getItem('soldier_produksi_v1')||'{}');context.DB_PRODUKSI=value.produksi||[];},
    jahitProductionView:value=>value||[],jahitMetaView:value=>value||{tukangJahit:[],kasbonJahit:[]},jahitRows:value=>Array.isArray(value)?value:[],jahitClone:value=>JSON.parse(JSON.stringify(value)),
    updateJahitPending(){context.pendingLocalChange=context.jahitProductionJournal?.status().pending||false;},mergeJahitMeta:(base,local)=>({ok:true,value:local}),
    qcClone:value=>JSON.parse(JSON.stringify(value)),readQcJournalStatus(){const state=context.qcJournal?.status();if(state){context.pendingLocalChange=state.pending;context.qcPendingTarget=state.target;}return state;},
    renderAll(){events.push('render');},updateSyncTag(){events.push('sync-status');},showModeSelector(){events.push('mode-selector');},hideModeSelector(){events.push('mode-hidden');},fillChooseTukang(){events.push('worker-picker');},
    loadImagesFromDB(){events.push('hydrate-images');return imageGate?imageGate.promise:Promise.resolve();},cleanupPostArsip(){},pemeriksaLoad(){events.push('hydrate-inspector');context.PEMERIKSA_NAMA=context.qcStorage().getItem('qc_pemeriksa')||'';},hideSplash(){},autoConnectWithRetry(){events.push('start-listeners');}
  };
  context.$=selector=>element(selector);context.window=context;
  vm.createContext(context);
  for(const file of ['access-policy.js','account-storage.js','app-sync-journal.js','production-journal.js','production-sync.js'])vm.runInContext(fs.readFileSync(path.join(directory,file),'utf8'),context,{filename:file});
  const helpers=division==='jahit'?between(source,'// Auth must settle','// ============ HELPERS'):between(source,'// Scope is created','const $ =');
  vm.runInContext(helpers,context,{filename:division+'-scope-helpers'});
  if(division==='jahit'){
    vm.runInContext(between(source,'function loadModeState(){','function saveModeState(){'),context);
    vm.runInContext(between(source,'function initJahitJournals(){','function updateJahitPending(){'),context);
  }else vm.runInContext(between(source,'function restoreQcPending(){','const QC_OWNED_FIELDS'),context);
  const initializer=division==='jahit'?'initializeJahitAccount':'initializeQcAccount';
  vm.runInContext(between(source,'async function '+initializer+'(){','window.appReady='),context);
  vm.runInContext(bootCode(source,division),context,{filename:division+'-actual-boot'});
  return {context,access,events,storage,sync,cleanups,nodes,ready:context.appReady};
}
for(const division of ['jahit','qc']){
  test(division+' actual boot waits for verified access before hydration, journals, images and rendering',async()=>{
    const gate=deferred(),storage=new Storage([[division==='jahit'?'jahit_meta':'qc_payroll_workers','synthetic-secret-legacy'],[division==='jahit'?'jahit_produksi':'soldier_produksi_v1','synthetic-secret-old-account']]);
    const before=[...storage.values],run=harness(division,{storage,gate});
    assert.deepEqual(run.events,['public-config','authorize:'+division+':false']);assert.equal(run.sync.calls.length,0);
    gate.resolve();assert.equal(await run.ready,true);assert.equal(run.sync.calls.length,1);
    assert.ok(run.events.indexOf('cleanup-registered')<run.events.indexOf('hydrate-production'));assert.ok(run.events.indexOf('hydrate-production')<run.events.indexOf('render'));
    assert.equal(storage.reads.some(key=>['jahit_meta','jahit_produksi','qc_payroll_workers','soldier_produksi_v1'].includes(key)),false);
    assert.deepEqual([...storage.values],before);assert.equal(JSON.stringify(run.context.DB_PRODUKSI).includes('synthetic-secret'),false);
    const notice=run.nodes.get(division+'-legacy-notice');assert.ok(notice);assert.equal(notice.textContent.includes('synthetic-secret'),false);
  });
  test(division+' rejected or obsolete sessions never open or adopt business storage',async()=>{
    for(const options of [{obsolete:true},{cleanupApi:false}]){
      const run=harness(division,options);assert.equal(await run.ready,false);assert.equal(run.sync.calls.length,0);assert.equal(run.events.includes('hydrate-production'),false);assert.equal(run.events.includes('render'),false);
    }
  });
  test(division+' boot failure never exposes arbitrary credential-bearing error text',async()=>{
    const gate=deferred(),run=harness(division,{gate}),rejected='synthetic-secret-do-not-display';
    run.context.SoldierAccess.connect=async()=>{throw new Error(rejected);};
    gate.resolve();assert.equal(await run.ready,false);
    assert.equal(run.context.appBootError.includes(rejected),false);assert.equal(run.events.includes('render'),false);
  });
  test(division+' owner also preserves unbound legacy records without automatic upload',async()=>{
    const legacyKey=division==='jahit'?'jahit_produksi':'soldier_produksi_v1';
    const storage=new Storage([[legacyKey,JSON.stringify({id:'synthetic-owner-legacy-record',nominal:12345})]]),before=[...storage.values];
    const run=harness(division,{storage,owner:true});assert.equal(await run.ready,true);
    assert.deepEqual([...storage.values],before);assert.equal(storage.reads.includes(legacyKey),false);
    assert.equal(JSON.stringify(run.context.DB_PRODUKSI),'[]');
    for(const records of run.sync.databases.values())for(const value of records.values())assert.equal(value.includes('synthetic-owner-legacy-record'),false);
    assert.ok(run.nodes.get(division+'-legacy-notice'));
  });
  test(division+' logout clears private views and stops access while preserving scoped pending draft',async()=>{
    const run=harness(division);assert.equal(await run.ready,true);
    const journal=division==='jahit'?run.context.jahitProductionJournal:run.context.qcJournal;
    journal.acceptRemote([],cfg.databaseURL);journal.stage([{id:'synthetic-record-1',jahit:[]}],cfg.databaseURL);await journal.ready();assert.equal(journal.status().pending,true);
    const before=JSON.stringify([...run.sync.databases.values()].map(value=>[...value]));run.access.authorized=false;await run.cleanups[0]();
    assert.equal(run.nodes.get('business-root').textContent,'');assert.equal(run.nodes.get('soldier-access-panel').textContent,'Google login');
    assert.equal(JSON.stringify(run.context.DB_PRODUKSI),'[]');assert.throws(()=>division==='jahit'?run.context.jahitStorage():run.context.qcStorage(),/Sesi akun berubah/);
    assert.equal(JSON.stringify([...run.sync.databases.values()].map(value=>[...value])),before);
  });
  test(division+' another UID cannot load the prior scoped pending journal',async()=>{
    const storage=new Storage(),sync=fakeSync(),first=harness(division,{storage,sync});assert.equal(await first.ready,true);
    const journal=division==='jahit'?first.context.jahitProductionJournal:first.context.qcJournal;
    journal.acceptRemote([],cfg.databaseURL);journal.stage([{id:'synthetic-private-record'}],cfg.databaseURL);await journal.ready();
    const second=harness(division,{storage,sync,user:'synthetic-user-2'});assert.equal(await second.ready,true);assert.equal(sync.databases.size,2);
    assert.equal(JSON.stringify(second.context.DB_PRODUKSI),'[]');const other=division==='jahit'?second.context.jahitProductionJournal:second.context.qcJournal;assert.equal(other.status().pending,false);
  });
  test(division+' same UID with another worker or owner role cannot hydrate prior cache/draft',async()=>{
    for(const [previous,next]of [[{workerId:'synthetic-worker-1'},{workerId:'synthetic-worker-2'}],[{owner:true},{owner:false}],[{owner:false},{owner:true}]]){
      const storage=new Storage(),sync=fakeSync(),first=harness(division,{storage,sync,...previous});assert.equal(await first.ready,true);
      const cache=division==='jahit'?first.context.jahitStorage():first.context.qcStorage(),journal=division==='jahit'?first.context.jahitProductionJournal:first.context.qcJournal;
      cache.setItem(division==='jahit'?'jahit_produksi':'soldier_produksi_v1',JSON.stringify(division==='jahit'?[{id:'synthetic-prior-private-cache'}]:{produksi:[{id:'synthetic-prior-private-cache'}]}));
      journal.acceptRemote([],cfg.databaseURL);journal.stage([{id:'synthetic-prior-private-draft'}],cfg.databaseURL);await journal.ready();
      const before=JSON.stringify([... [...sync.databases.values()][0]]),second=harness(division,{storage,sync,...next});assert.equal(await second.ready,true);
      assert.equal(sync.databases.size,2);assert.equal(JSON.stringify(second.context.DB_PRODUKSI),'[]');
      const other=division==='jahit'?second.context.jahitProductionJournal:second.context.qcJournal;assert.equal(other.status().pending,false);
      assert.equal(JSON.stringify([... [...sync.databases.values()][0]]),before);
      assert.ok(before.includes('synthetic-prior-private-draft'));
    }
  });
  test(division+' rejected connection target leaves active target, readiness and scoped draft unchanged',async()=>{
    const run=harness(division);assert.equal(await run.ready,true);const context=run.context,source=html(division);
    context.alert=()=>run.events.push('alert');context.fbSave=()=>run.events.push('save-config');context.connectFirebase=async()=>run.events.push('reconnect');
    context.FB.connected=true;context.firebaseSyncReady=true;context.firebaseMetaSyncReady=true;
    const journal=division==='jahit'?context.jahitProductionJournal:context.qcJournal;journal.acceptRemote([],cfg.databaseURL);journal.stage([{id:'synthetic-own-pending'}],cfg.databaseURL);await journal.ready();
    const oldTarget={...context.FB},draft=JSON.stringify(journal.current());
    if(division==='jahit')vm.runInContext(between(source,"$('#fbConnect').onclick=async()=>{",'window.disconnectFb='),context);
    else vm.runInContext(between(source,'$("#fbConnect").onclick = async () => {','async function autoConnectWithRetry(){'),context);
    context.$('#fbApiKey').value=cfg.apiKey;context.$('#fbDbUrl').value='https://synthetic-other.firebaseio.com';context.$('#fbProjectId').value='synthetic-other';
    await context.$('#fbConnect').onclick();assert.deepEqual(context.FB,oldTarget);assert.equal(context.firebaseSyncReady,true);assert.equal(JSON.stringify(journal.current()),draft);
    assert.equal(run.events.includes('save-config'),false);assert.equal(run.events.includes('reconnect'),false);
    if(division==='jahit'){
      vm.runInContext(between(source,'window.tukangConnectFirebase = function(){','function updateTukangConnectCard(){'),context);
      context.$('#tukangFbApiKey').value=cfg.apiKey;context.$('#tukangFbDbUrl').value='https://synthetic-other.firebaseio.com';context.$('#tukangFbProjectId').value='synthetic-other';
      context.tukangConnectFirebase();assert.deepEqual(context.FB,oldTarget);assert.equal(run.events.includes('save-config'),false);assert.equal(run.events.includes('reconnect'),false);
    }
    context.FB.dbUrl='https://synthetic-other.firebaseio.com';assert.throws(()=>division==='jahit'?context.requireJahitSession():context.requireQcSession(),/Sesi akun berubah/);
  });
}
test('jahit partner mode ignores even its own cached admin/other-worker selection',async()=>{
  const run=harness('jahit');assert.equal(await run.ready,true);
  run.context.jahitStorage().setItem('jahit_mode','admin');run.context.jahitStorage().setItem('jahit_current_tukang','synthetic-other-worker');
  run.context.loadModeState();assert.equal(run.context.MODE,'tukang');assert.equal(run.context.CURRENT_TUKANG,'synthetic-worker-1');
});
test('sewing identity must be mapped by the trusted owner, never selected locally',async()=>{
  const run=harness('jahit',{workerId:undefined});delete run.access.profile.workerId;
  assert.equal(await run.ready,false);assert.equal(run.sync.calls.length,0);assert.equal(run.events.includes('hydrate-production'),false);
});
test('QC removes cross-module financial fallback and scopes its image database',()=>{
  const source=html('qc');assert.equal(source.includes("getItem('jahit_meta')"),false);assert.equal(source.includes("indexedDB.open('soldier_qc_images'"),false);
  assert.ok(source.includes("JSON.stringify([scope.projectId,scope.databaseURL,scope.uid,'qc',scope.schemaVersion,scope.authorizationBinding.owner,scope.authorizationBinding.workerId])"));
});
test('QC completes image hydration before enabling listeners or rendering cached business views',async()=>{
  const imageGate=deferred(),run=harness('qc',{imageGate});
  run.context.connectFirebase=async()=>run.events.push('start-listeners');vm.runInContext(between(html('qc'),'async function autoConnectWithRetry(){','function scheduleQcReconnect(){'),run.context);
  await new Promise(resolve=>setImmediate(resolve));await run.context.autoConnectWithRetry();
  assert.equal(run.events.includes('hydrate-images'),true);assert.equal(run.events.includes('start-listeners'),false);assert.equal(run.events.includes('render'),false);
  imageGate.resolve();assert.equal(await run.ready,true);assert.ok(run.events.indexOf('hydrate-images')<run.events.indexOf('start-listeners'));
});
test('QC a late older image-save opening cannot overwrite the latest captured payload',async()=>{
  const run=harness('qc');assert.equal(await run.ready,true);const requests=[],writes=[];
  run.context.indexedDB={open(){const request={};requests.push(request);return request;}};
  vm.runInContext(between(html('qc'),'function openImgDB(){','let OFFLINE_ORDER_IMAGES'),run.context);
  run.context.DB_IMAGES={item:'synthetic-old-image'};run.context.saveImagesToDB();run.context.DB_IMAGES={item:'synthetic-new-image'};run.context.saveImagesToDB();
  const tx={objectStore:()=>({put(value){writes.push(value);}})},db={transaction:()=>tx,close(){}};
  requests[1].onsuccess({target:{result:db}});await new Promise(resolve=>setImmediate(resolve));requests[0].onsuccess({target:{result:db}});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(writes.length,1);assert.equal(writes[0].item,'synthetic-new-image');tx.oncomplete();
});
test('QC async image save captures payload before opening and binds image DB to role/worker',async()=>{
  const run=harness('qc');assert.equal(await run.ready,true);const requests=[],writes=[];
  run.context.indexedDB={open(name){const request={name};requests.push(request);return request;}};
  vm.runInContext(between(html('qc'),'function openImgDB(){','let OFFLINE_ORDER_IMAGES'),run.context);
  run.context.DB_IMAGES={item:'synthetic-original-image'};run.context.saveImagesToDB();run.context.DB_IMAGES.item='synthetic-newer-image';
  const tx={objectStore:()=>({put(value,key){writes.push({value,key});}})},db={transaction:()=>tx,close(){}};
  requests[0].onsuccess({target:{result:db}});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(writes.length,1);assert.equal(writes[0].value.item,'synthetic-original-image');assert.equal(writes[0].key,'all');
  assert.ok(decodeURIComponent(requests[0].name).includes('synthetic-worker-1'));
  tx.oncomplete();
  const owner=harness('qc',{owner:true});assert.equal(await owner.ready,true);const ownerNames=[];
  let ownerRequest;owner.context.indexedDB={open(name){ownerNames.push(name);ownerRequest={};return ownerRequest;}};vm.runInContext(between(html('qc'),'function openImgDB(){','let OFFLINE_ORDER_IMAGES'),owner.context);
  const opening=owner.context.openImgDB();assert.notEqual(ownerNames[0],requests[0].name);ownerRequest.onsuccess({target:{result:db}});(await opening).close();
});
test('only public connection keys remain outside scoped business storage in both modules',()=>{
  for(const division of ['jahit','qc'])for(const match of html(division).matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(\s*(['"])([^'"]+)\1/g))assert.ok(['jahit_fb','qc_fb','soldier_produksi_fb'].includes(match[2]),division+' still uses global business key');
});
