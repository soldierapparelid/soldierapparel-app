'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const Accounts=require('../account-storage.js');
const scope={projectId:'synthetic-project',databaseURL:'https://synthetic-project-default-rtdb.asia-southeast1.firebasedatabase.app',uid:'synthetic-user-1',module:'jahit',schemaVersion:2};
class Storage{
  constructor(entries=[]){this.values=new Map(entries);this.reads=[];}
  get length(){return this.values.size;}
  key(index){return [...this.values.keys()][index]||null;}
  getItem(key){this.reads.push(key);return this.values.get(key)??null;}
  setItem(key,value){this.values.set(key,value);}
  removeItem(key){this.values.delete(key);}
}
const create=(storage,change={},isCurrent=()=>true)=>Accounts.create({scope:{...scope,...change},storage,isCurrent});
const rejects=(fn,code)=>assert.throws(fn,error=>error.message===code&&!error.message.includes('synthetic-secret'));
function deferred(){let resolve;return {promise:new Promise(yes=>resolve=yes),resolve:value=>resolve(value)};}
function fakeSync(){
  const databases=new Map(),calls=[];let onRead,onWrite,opening;
  const api={async open(options){
    calls.push(options);if(opening)await opening.promise;
    const values=databases.get(options.dbName)||new Map();databases.set(options.dbName,values);
    // Model the existing journal migrator: it can see only logical roots in
    // its passed Storage adapter, never global unbound legacy entries.
    for(const key of options.keys){const value=options.storage.getItem(key);if(value!==null&&!values.has(key))values.set(key,value);}
    let closed=false;
    return {getItem(key){if(onRead)onRead();return values.get(key)??null;},setItem(key,value){if(onWrite)onWrite();values.set(key,value);},removeItem:key=>values.delete(key),key:index=>[...values.keys()][index]||null,get length(){return values.size;},status:()=>({pending:false,error:''}),whenIdle:async()=>{},refresh:async()=>{},close(){closed=true;},get closed(){return closed;}};
  }};
  return {api,calls,databases,setRead:fn=>onRead=fn,setWrite:fn=>onWrite=fn,setOpening:value=>opening=value};
}
test('each UID, project, database, module and schema uses a separate cache',()=>{
  const storage=new Storage(),first=create(storage);first.setItem('business','synthetic-own-record');
  for(const change of [{uid:'synthetic-user-2'},{projectId:'another-project'},{databaseURL:'https://another-instance.firebaseio.com'},{module:'qc'},{schemaVersion:3}]){
    const second=create(storage,change);assert.equal(second.getItem('business'),null);assert.equal(second.length,0);second.setItem('business','synthetic-other-record');assert.equal(first.getItem('business'),'synthetic-own-record');
  }
  assert.equal(create(storage,{databaseURL:scope.databaseURL+'/'}).getItem('business'),'synthetic-own-record');
});
test('enumeration and removal touch only the active namespace, with no broad clear',()=>{
  const storage=new Storage([['legacy-key','synthetic-legacy-record'],['unrelated-key','synthetic-unrelated-record']]),first=create(storage),other=create(storage,{uid:'synthetic-user-2'});
  first.setItem('b','one');first.setItem('a','two');other.setItem('foreign','three');
  assert.equal(first.length,2);assert.deepEqual([first.key(0),first.key(1),first.key(2)],['a','b',null]);
  first.removeItem('b');assert.equal(first.length,1);assert.equal(other.getItem('foreign'),'three');assert.equal(storage.getItem('legacy-key'),'synthetic-legacy-record');assert.equal(first.clear,undefined);
});
test('legacy detection reports counts only and never reads, adopts, mutates or exports legacy values',()=>{
  const storage=new Storage([['jahit_meta','synthetic-secret-legacy'],['journal:pending:old','synthetic-secret-pending'],['unrelated','other']]),before=[...storage.values];
  const account=create(storage);create(storage,{uid:'synthetic-user-2'}).setItem('jahit_meta','other-account');const afterOther=[...storage.values];
  const result=account.legacyStatus({keys:['jahit_meta'],prefixes:['journal:']});assert.deepEqual(result,{present:true,count:2});
  assert.equal(account.getItem('jahit_meta'),null);assert.equal(storage.reads.includes('jahit_meta'),false);assert.equal(storage.reads.includes('journal:pending:old'),false);
  assert.deepEqual([...storage.values],afterOther);assert.deepEqual([...storage.values].slice(0,3),before);
  assert.equal(JSON.stringify(result).includes('jahit'),false);assert.equal(JSON.stringify(result).includes('synthetic-secret'),false);assert.equal(account.exportState,undefined);
});
test('invalidation and a false, thrown or asynchronous session guard immediately stop operations',async()=>{
  const storage=new Storage();let current=true;const account=create(storage,{},()=>current);account.setItem('cache','own');current=false;
  for(const action of [()=>account.getItem('cache'),()=>account.setItem('cache','changed'),()=>account.removeItem('cache'),()=>account.key(0),()=>account.length,()=>account.legacyStatus({keys:['legacy']})])rejects(action,'storage_inactive');
  current=true;rejects(()=>account.getItem('cache'),'storage_inactive');assert.equal(create(storage).getItem('cache'),'own');
  const explicit=create(storage);await explicit.invalidate();rejects(()=>explicit.getItem('cache'),'storage_inactive');
  for(const check of [()=>false,()=>{throw Error('synthetic-secret');},()=>Promise.resolve(true)])rejects(()=>create(storage,{},check),'storage_inactive');
});
test('guard checked after reads prevents a value escaping when session changes during storage access',()=>{
  const storage=new Storage();let current=true;const account=create(storage,{},()=>current);account.setItem('cache','synthetic-secret-own');
  const original=storage.getItem.bind(storage);storage.getItem=key=>{const value=original(key);current=false;return value;};
  rejects(()=>account.getItem('cache'),'storage_inactive');
});
test('invalid scopes and unsafe options fail without running getters or echoing credentials',()=>{
  const storage=new Storage();
  for(const change of [{uid:''},{uid:'line\nsynthetic-secret'},{schemaVersion:0},{schemaVersion:'2'},{projectId:'BadProject'},{module:'../jahit'},{databaseURL:'https://user:synthetic-secret@synthetic.firebaseio.com'},{databaseURL:'https://firebaseio.com.attacker.invalid'},{databaseURL:'https://synthetic.firebaseio.com/data'}])rejects(()=>create(storage,change),'invalid_storage_scope');
  let calls=0;const unsafe={...scope};Object.defineProperty(unsafe,'uid',{get(){calls++;throw Error('synthetic-secret');},enumerable:true});rejects(()=>Accounts.create({scope:unsafe,storage,isCurrent:()=>true}),'invalid_storage_scope');assert.equal(calls,0);
  rejects(()=>Accounts.create({scope,storage,isCurrent:()=>true,unexpected:'synthetic-secret'}),'invalid_storage_options');
});
test('storage faults and malformed values are masked without changing preserved records',()=>{
  const storage=new Storage([['legacy','synthetic-secret-legacy']]),account=create(storage),before=[...storage.values];
  storage.getItem=()=>{throw Error('synthetic-secret');};rejects(()=>account.getItem('cache'),'storage_unavailable');
  storage.setItem=()=>{throw Error('synthetic-secret');};rejects(()=>account.setItem('cache','value'),'storage_unavailable');
  Object.defineProperty(storage,'length',{get(){throw Error('synthetic-secret');}});rejects(()=>account.length,'storage_unavailable');
  assert.deepEqual([...storage.values],before);
  const malformed=new Storage();malformed.getItem=()=>({password:'synthetic-secret'});rejects(()=>create(malformed).getItem('cache'),'storage_unavailable');
});
test('durable journals use the same scope binding and never see global legacy journals',async()=>{
  const storage=new Storage([['journal','synthetic-secret-legacy-journal']]),sync=fakeSync(),first=create(storage);first.setItem('journal','scoped-current-draft');
  const journal=await first.openJournals({keys:['journal'],indexedDB:{synthetic:true},appSyncStorage:sync.api});
  assert.equal(journal.getItem('journal'),'scoped-current-draft');assert.equal(journal.exportState,undefined);assert.equal(sync.calls[0].storage,first);assert.deepEqual(sync.calls[0].keys,['journal']);
  for(const change of [{uid:'synthetic-user-2'},{projectId:'another-project'},{databaseURL:'https://other.firebaseio.com'},{module:'qc'},{schemaVersion:3}]){
    const other=await create(storage,change).openJournals({keys:['journal'],indexedDB:{},appSyncStorage:sync.api});assert.equal(other.getItem('journal'),null);
  }
  assert.equal(sync.databases.size,6);assert.equal(storage.values.get('journal'),'synthetic-secret-legacy-journal');assert.equal(storage.reads.includes('journal'),false);
});
test('invalidation during asynchronous journal opening refuses the adapter and later callbacks',async()=>{
  const storage=new Storage(),sync=fakeSync(),gate=deferred();sync.setOpening(gate);let changes=0;
  const account=create(storage),opening=account.openJournals({keys:['journal'],appSyncStorage:sync.api,indexedDB:{},onChange:()=>changes++});
  await account.invalidate();gate.resolve();await assert.rejects(opening,error=>error.message==='storage_inactive');sync.calls[0].onChange();assert.equal(changes,0);
});
test('durable adapter blocks future reads, writes and refresh after revocation; old scope remains recoverable',async()=>{
  const storage=new Storage(),sync=fakeSync();let current=true;const account=create(storage,{},()=>current),journal=await account.openJournals({keys:['journal'],appSyncStorage:sync.api,indexedDB:{}});
  journal.setItem('journal','pending-old-scope');sync.setRead(()=>current=false);rejects(()=>journal.getItem('journal'),'storage_inactive');sync.setRead(undefined);
  rejects(()=>journal.setItem('journal','unexpected'),'storage_inactive');await assert.rejects(journal.refresh(),error=>error.message==='storage_inactive');
  current=true;const restored=await create(storage).openJournals({keys:['journal'],appSyncStorage:sync.api,indexedDB:{}});assert.equal(restored.getItem('journal'),'pending-old-scope');
});
test('a journal refresh started before invalidation cannot return its raw adapter afterwards',async()=>{
  const storage=new Storage(),sync=fakeSync(),gate=deferred(),original=sync.api.open;let entered=false;
  sync.api.open=async options=>{const raw=await original(options);raw.refresh=async()=>{entered=true;await gate.promise;return raw;};return raw;};
  const account=create(storage),journal=await account.openJournals({keys:['journal'],appSyncStorage:sync.api,indexedDB:{}});
  const refreshing=journal.refresh();assert.equal(entered,true);await account.invalidate();gate.resolve();
  await assert.rejects(refreshing,error=>error.message==='storage_inactive');rejects(()=>journal.getItem('journal'),'storage_inactive');
});
test('journal opening and status faults never return credential-bearing underlying errors',async()=>{
  const storage=new Storage(),account=create(storage);
  await assert.rejects(account.openJournals({keys:['journal'],appSyncStorage:{open:async()=>{throw Error('synthetic-secret');}},indexedDB:{}}),error=>error.message==='storage_unavailable');
  const sync=fakeSync(),original=sync.api.open;
  sync.api.open=async options=>{const raw=await original(options);raw.status=()=>({pending:false,error:'synthetic-secret'});return raw;};
  const journal=await account.openJournals({keys:['journal'],appSyncStorage:sync.api,indexedDB:{}});
  assert.deepEqual(journal.status(),{pending:false,error:'storage_unavailable'});await account.invalidate();
});
test('browser UMD exposes only the prepared scope factory',()=>{
  const context={URL};vm.runInNewContext(fs.readFileSync(require.resolve('../account-storage.js'),'utf8'),context);
  assert.deepEqual(Object.keys(context.SoldierAccountStorage),['create']);assert.equal(Object.isFrozen(context.SoldierAccountStorage),true);
});
