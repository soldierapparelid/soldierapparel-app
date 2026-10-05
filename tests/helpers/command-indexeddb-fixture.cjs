'use strict';
// Synthetic IDB scheduler: serial transactions, atomic abort/commit and events.
// Native browser IDB is verified separately; this is an injected fault fixture.
function fakeIndexedDB(){
  const databases=new Map(),stats={opens:0,gets:0,puts:0,closes:0};
  const control={openFail:false,putFail:false,blocked:false,beforeCommit:null};
  const api={open(name,version){
    stats.opens++;const request={};
    queueMicrotask(()=>{
      if(control.openFail){request.onerror?.();return;}
      const fresh=!databases.has(name),source=databases.get(name)||{stores:new Map(),queue:Promise.resolve()};databases.set(name,source);
      let closed=false;
      const db={objectStoreNames:{contains:key=>source.stores.has(key)},createObjectStore(key){if(source.stores.has(key))throw Error('exists');source.stores.set(key,new Map());},close(){closed=true;stats.closes++;},transaction(key,mode){
        if(closed||!source.stores.has(key))throw Error('unavailable');
        let aborted=false,finish;const tasks=[];
        const tx={abort(){aborted=true;},objectStore(){return {
          get(id){stats.gets++;const r={};tasks.push(map=>{r.result=map.get(id);r.onsuccess?.();});return r;},
          put(raw,id){stats.puts++;tasks.push(map=>{if(mode!=='readwrite'||control.putFail){aborted=true;tx.onerror?.();return;}map.set(id,raw);});}
        };}};
        const previous=source.queue;source.queue=new Promise(resolve=>{finish=resolve;});
        queueMicrotask(async()=>{
          await previous;const map=new Map(source.stores.get(key));
          try{while(tasks.length&&!aborted){tasks.shift()(map);await Promise.resolve();}if(control.beforeCommit)await control.beforeCommit();if(aborted){tx.onabort?.();return;}if(mode==='readwrite')source.stores.set(key,map);tx.oncomplete?.();}catch{tx.onerror?.();}finally{finish();}
        });return tx;
      }};
      request.result=db;request.transaction={abort(){closed=true;}};
      if(fresh)request.onupgradeneeded?.();
      if(control.blocked)request.onblocked?.();
      request.onsuccess?.();
    });return request;
  }};
  return {api,stats,control,databases};
}
module.exports={fakeIndexedDB};
