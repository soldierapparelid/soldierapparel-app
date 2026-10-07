'use strict';
// Focused synthetic evaluation of the actual generated expressions, not an RTDB
// emulator. Native compilation, number semantics and SDK ACK remain CI gates.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const Scope=require('../server/apps-script/protected-storage-scope.cjs');
const Rules=require('../security/build-protected-photo-rules.cjs');
const PROJECT='demo-soldier-photo-expressions',OWNER='synthetic-photo-owner';
const binding={projectId:PROJECT,databaseURL:'https://'+PROJECT+'.firebaseio.com',tenantId:'synthetic-photo-expressions'};
const clone=v=>JSON.parse(JSON.stringify(v));
const generated=Rules.buildProtectedOwnerPhotoRules({enabled:true,ownerUid:OWNER,projectId:PROJECT}).rules;
const photoRules=generated[Scope.KEY].photos;
const owner=()=>({uid:OWNER,token:{aud:PROJECT,email_verified:true,firebase:{sign_in_provider:'google.com'}}});
function fixture(){
  const root={soldier:{produksi:{produksi:[{id:'synthetic-product',jahit:[]}],images:{unknown:{nullable:null,list:[]}}},productionPhotos:null}};
  const result=Scope.prepareOwnerSdkPhotoMigration({root,binding,migrationId:'synthetic-expression-migration',expectedRootETag:'"synthetic-original"'});
  assert.equal(result.ok,true);return clone(result.nextRoot);
}
function mutation(photos,id){
  const decoded=Scope.inspectOwnerSdkPhotoEnvelope({photos});assert.equal(decoded.ok,true);
  const command={requestId:id,expectedRevision:photos.revision,expectedDataDigest:photos.dataDigest,...decoded.data};
  const result=Scope.prepareOwnerSdkPhotoMutation({photos,command});assert.equal(result.ok,true);return clone(result.nextPhotos);
}
// val() on child maps is a sentinel in Rules, not a JSON object. Track such
// calls explicitly: neither Boolean branch may inspect a structured receipt.
function snapshots(tree,diagnostics){
  function at(path){let value=tree;for(const key of path){if(value===null||typeof value!=='object'||!Object.hasOwn(value,key))return null;value=value[key];}return value??null;}
  function snapshot(path=[]){return{
    child(key){return snapshot(path.concat(key.split('/')));},parent(){return snapshot(path.slice(0,-1));},
    val(){const value=at(path);if(value!==null&&typeof value==='object'){diagnostics.nonprimitiveValReads++;return Symbol('synthetic-child-map-sentinel');}return value;},
    exists(){return at(path)!==null;},isBoolean(){return typeof at(path)==='boolean';},isString(){return typeof at(path)==='string';},isNumber(){return typeof at(path)==='number';},
    hasChildren(keys){const value=at(path);return value!==null&&typeof value==='object'&&keys.every(key=>Object.hasOwn(value,key)&&value[key]!==null);}
  };}return snapshot();
}
function evaluator(oldRoot,newRoot,auth){
  const diagnostics={nonprimitiveValReads:0},old=snapshots(oldRoot,diagnostics),next=snapshots(newRoot,diagnostics);
  // Model only the relevant documented RTDB regex distinction: unsupported
  // hex/Unicode escapes quote the following character, not a JS code point.
  // This remains a focused fixture, not a full native regex implementation.
  const rulesMatches=(value,source,flags)=>new RegExp(source.replace(/\\x([0-9a-f]{2})/gi,'x$1').replace(/\\u([0-9a-f]{4})/gi,'u$1'),flags).test(value);
  const context=vm.createContext({root:old,auth,data:old,newData:next,__rulesMatches:rulesMatches});
  vm.runInContext(`String.prototype.matches=function(pattern){return __rulesMatches(String(this),pattern.source,pattern.flags);};String.prototype.contains=function(part){return String(this).includes(part);};String.prototype.replace=function(part,replacement){if(typeof part!=='string')throw Error('literal Rules replace only');return String(this).split(part).join(replacement);};`,context);
  function evaluate(expression,path){if(typeof expression==='boolean')return expression;context.data=old.child(path);context.newData=next.child(path);return vm.runInContext('('+expression+')',context,{timeout:1000})===true;}
  function validate(rule,value,path){
    if(value===null||value===undefined)return true;
    if(Object.hasOwn(rule,'.validate')&&!evaluate(rule['.validate'],path))return false;
    if(typeof value!=='object')return true;
    return Object.keys(value).every(key=>{const child=rule[key]??rule.$other;return !child||validate(child,value[key],path+'/'+key);});
  }
  return{diagnostics,evaluate,validate};
}
function allowed(oldRoot,photos,auth=owner()){
  const next=clone(oldRoot);next[Scope.KEY].photos=photos;const runner=evaluator(oldRoot,next,auth),path=Scope.KEY+'/photos';
  const result=runner.evaluate(photoRules['.write'],path)&&runner.validate(photoRules,photos,path);
  return{result,diagnostics:runner.diagnostics};
}
test('generated typed sentinel guards admit first CAS and exact no-ops without reading map val',()=>{
  const root=fixture(),initial=root[Scope.KEY].photos;
  assert.deepEqual(allowed(root,initial),{result:true,diagnostics:{nonprimitiveValReads:0}});
  const first=mutation(initial,'synthetic-first');assert.deepEqual(allowed(root,first),{result:true,diagnostics:{nonprimitiveValReads:0}});
  root[Scope.KEY].photos=first;
  assert.deepEqual(allowed(root,first),{result:true,diagnostics:{nonprimitiveValReads:0}});
  assert.deepEqual(allowed(root,mutation(first,'synthetic-next')),{result:true,diagnostics:{nonprimitiveValReads:0}});
});
test('actual generated ledger comparison matches every finite canonical numeric receipt revision',()=>{
  const root=fixture();
  for(let n=2;n<=Scope.MAX_PHOTO_RECEIPTS+1;n++){
    const next=mutation(root[Scope.KEY].photos,'synthetic-revision-'+n),result=allowed(root,next);
    assert.equal(result.result,true,'canonical receipt revision '+n);assert.equal(result.diagnostics.nonprimitiveValReads,0);
    const tail=JSON.parse(next.receipts.split('|').at(-2));assert.equal(tail.revision,n);assert.equal(typeof tail.revision,'number');
    root[Scope.KEY].photos=next;
  }
  assert.equal(Scope.prepareOwnerSdkPhotoMutation({photos:root[Scope.KEY].photos,command:{requestId:'synthetic-overflow',expectedRevision:129,expectedDataDigest:root[Scope.KEY].photos.dataDigest,...Scope.inspectOwnerSdkPhotoEnvelope({photos:root[Scope.KEY].photos}).data}}).error,'capacity_limit');
  assert.equal(allowed(root,root[Scope.KEY].photos).result,true,'retained no-op still allowed at full capacity');
});
test('generated owner guard still rejects foreign UID, project, provider, unverified and missing Auth',()=>{
  const root=fixture(),next=mutation(root[Scope.KEY].photos,'synthetic-auth');
  const claims=[null,{...owner(),uid:'synthetic-foreign'},(()=>{const a=owner();a.token.aud='demo-synthetic-other';return a;})(),(()=>{const a=owner();a.token.email_verified=false;return a;})(),(()=>{const a=owner();a.token.firebase.sign_in_provider='password';return a;})()];
  for(const auth of claims)assert.equal(allowed(root,next,auth).result,false);
  assert.equal(generated['.write'],false);assert.equal(generated[Scope.KEY].working['.write'],false);assert.equal(generated[Scope.KEY].working['.read'],false);assert.equal(generated[Scope.KEY].manifest['.write'],false);
});
test('generated no-op rejects edits to receipt text, tail, provenance or data while preserving immutable fields',()=>{
  const root=fixture();root[Scope.KEY].photos=mutation(root[Scope.KEY].photos,'synthetic-retained');
  for(const mutate of [p=>p.receipts='',p=>p.lastReceipt=false,p=>p.lastReceipt.payloadDigest='a'.repeat(64),p=>p.migrationId='synthetic-other',p=>p.binding.tenantId='synthetic-other',p=>p.sourceRootDigest='b'.repeat(64),p=>p.data+=' ',p=>p.receiptCount=0,p=>p.extra='synthetic']){
    const bad=clone(root[Scope.KEY].photos);mutate(bad);assert.equal(allowed(root,bad).result,false);
  }
  assert.equal(allowed(root,null).result,false,'never allow deleting photos root');
});
test('generated append rejects float-text serialization, unlinked tail, duplicate ID and non-ASCII data',()=>{
  const root=fixture(),first=mutation(root[Scope.KEY].photos,'synthetic-append');
  for(const mutate of [p=>p.receipts=p.receipts.replace('"revision":2}','"revision":2.0}'),p=>p.lastReceipt.revision++,p=>p.lastReceipt.requestId='synthetic-unlinked',p=>p.lastReceipt.dataDigest='c'.repeat(64),p=>p.data+='\u2603',p=>p.receipts+='|']){
    const bad=clone(first);mutate(bad);assert.equal(allowed(root,bad).result,false);
  }
  root[Scope.KEY].photos=first;const second=mutation(first,'synthetic-new');
  second.lastReceipt.requestId=first.lastReceipt.requestId;
  second.receipts=first.receipts+JSON.stringify({dataDigest:second.lastReceipt.dataDigest,payloadDigest:second.lastReceipt.payloadDigest,requestId:second.lastReceipt.requestId,revision:second.lastReceipt.revision})+'|';
  assert.equal(allowed(root,second).result,false,'cannot reuse retained request ID');
});
test('documented RTDB subset accepts exactly printable ASCII and rejects JS-only hex interpretation',()=>{
  const root=fixture(),path=Scope.KEY+'/photos/data',printable=Array.from({length:95},(_,i)=>String.fromCharCode(32+i)).join('');
  const next=clone(root);next[Scope.KEY].photos.data=printable;
  const runner=evaluator(root,next,owner());
  assert.equal(runner.evaluate(photoRules.data['.validate'],path),true);
  assert.equal(runner.evaluate('newData.isString() && newData.val().matches(/^[\\x20-\\x7e]*$/)',path),false,'unsupported escapes must not inherit Node regex semantics');
  for(const value of ['\x00','\x1f','\n','\x7f','\u2603',0,false,{},[]]){
    const bad=clone(root);bad[Scope.KEY].photos.data=value;
    assert.equal(evaluator(root,bad,owner()).evaluate(photoRules.data['.validate'],path),false);
  }
});
