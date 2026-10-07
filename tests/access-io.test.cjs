'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Session=require('../access-session.js');
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
test('stale reads and subscriptions never deliver business data after session invalidation',async()=>{
  let active=true,callback,failed,stops=0;const waiting=deferred(),db={};
  const guard=Session.guardDatabase({db,isCurrent:()=>active,sdk:{ref:(d,p)=>({d,p}),get:()=>waiting.promise,onValue:(n,cb,err)=>{callback=cb;failed=err;return ()=>stops++;},remove:()=>{throw Error('raw method must not be exposed');}}});
  const node=guard.sdk.ref(db,'fixture'),received=[];guard.sdk.onValue(node,x=>received.push(x),e=>received.push(e));
  callback('synthetic-own-data');assert.deepEqual(received,['synthetic-own-data']);
  const reading=guard.sdk.get(node);active=false;callback('synthetic-other-data');failed('synthetic-private-error');waiting.resolve({val:()=>({private:true})});
  await assert.rejects(reading,/Sesi akses berubah/);assert.deepEqual(received,['synthetic-own-data']);
  guard.dispose();guard.dispose();assert.equal(stops,1);active=true;
  assert.throws(()=>guard.sdk.ref(db,'fixture'),/Sesi akses berubah/);assert.equal(guard.sdk.remove,undefined);
});
test('queued transaction aborts on revocation and cannot acknowledge into a new session',async()=>{
  let active=true,updater,options;const waiting=deferred(),db={};
  const guard=Session.guardDatabase({db,isCurrent:()=>active,sdk:{ref:(d,p)=>({d,p}),runTransaction:(n,update,opt)=>{updater=update;options=opt;return waiting.promise;}}});
  const sending=guard.sdk.runTransaction(guard.sdk.ref(db,'fixture'),value=>({...value,count:2}),{applyLocally:false});
  assert.deepEqual(updater({count:1}),{count:2});assert.deepEqual(options,{applyLocally:false});
  active=false;assert.equal(updater({count:1}),undefined);waiting.resolve({committed:false});await assert.rejects(sending,/Sesi akses berubah/);
  assert.equal(guard.isCurrent(),false);
});
test('guard verifies captured database and reference ownership, preserving transaction arguments',async()=>{
  const db={},other={},guard=Session.guardDatabase({db,isCurrent:()=>true,sdk:{ref:(d,p)=>({d,p}),get:async()=>({fixture:true}),runTransaction:async(n,update,opt)=>({committed:true,value:update({count:1}),options:opt})}});
  assert.throws(()=>guard.sdk.ref(other,'fixture'),/Tujuan koneksi/);
  await assert.rejects(guard.sdk.get({d:db,p:'forged'}),/Referensi koneksi/);
  const node=guard.sdk.ref(db,'fixture'),result=await guard.sdk.runTransaction(node,value=>({...value,count:2}),{applyLocally:false});
  assert.deepEqual(result,{committed:true,value:{count:2},options:{applyLocally:false}});
  const another=Session.guardDatabase({db,isCurrent:()=>true,sdk:{get:async()=>({})}});await assert.rejects(another.sdk.get(node),/Referensi koneksi/);
  const failing=Session.guardDatabase({db,isCurrent:()=>{throw Error('private callback text');},sdk:{}});assert.throws(()=>failing.sdk.ref(db,'fixture'),error=>!error.message.includes('private callback text'));
});
