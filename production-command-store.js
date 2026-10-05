/* Canonical command journal only. No legacy adoption, enumeration or tokens. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SoldierProductionCommandStore=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const DB='soldier-command-journal:v1',STORE='journals',MAX_BYTES=262144;
  function createCommandStore(options={}){
    if(options.enabled!==true)return Object.freeze({read:async()=>{throw Error('service_disabled');},write:async()=>{throw Error('service_disabled');},dispose(){}});
    const {indexedDB,scope,endpointURL,isCurrent}=options;
    const safeId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
    const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return d&&d.enumerable&&Object.hasOwn(d,'value');});
    if(!exact(scope,['projectId','databaseURL','tenantId','uid','grantRevision'])||typeof scope.projectId!=='string'||!/^[a-z][a-z0-9-]{3,62}$/.test(scope.projectId)||!safeId(scope.tenantId)||!safeId(scope.uid)||!Number.isSafeInteger(scope.grantRevision)||scope.grantRevision<0||typeof isCurrent!=='function'||!indexedDB||typeof indexedDB.open!=='function')throw Error('invalid_storage');
    try{const u=new URL(scope.databaseURL),e=new URL(endpointURL);if(typeof scope.databaseURL!=='string'||u.origin!==scope.databaseURL||u.protocol!=='https:'||u.port||u.username||u.password||!/(^|\.)(firebaseio\.com|firebasedatabase\.app)$/.test(u.hostname)||typeof endpointURL!=='string'||e.protocol!=='https:'||e.port||e.username||e.password||e.search||e.hash||e.href!==endpointURL||e.pathname!=='/v1/production/commands')throw Error('invalid_storage');}catch{throw Error('invalid_storage');}
    const key=JSON.stringify([scope.projectId,scope.databaseURL,scope.tenantId,scope.uid,scope.grantRevision,endpointURL]);
    let inactive=false,opening,db;const pending=new Set();
    function live(){let current=false;try{current=!inactive&&isCurrent()===true;}catch{}if(!current)throw Error('storage_inactive');}
    function dispose(){inactive=true;try{if(db)db.close();}catch{}/* Active IDB transactions finish; old scope data is retained. */}
    function value(raw){if(raw===null)return;if(typeof raw!=='string'||new TextEncoder().encode(raw).length>MAX_BYTES)throw Error('invalid_storage');}
    async function open(){
      live();if(db)return db;
      if(!opening)opening=new Promise((resolve,reject)=>{
        let request,settled=false;
        const fail=()=>{settled=true;reject(Error('storage_unavailable'));};
        try{request=indexedDB.open(DB,1);}catch{reject(Error('storage_unavailable'));return;}
        request.onupgradeneeded=()=>{try{const d=request.result;if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE);}catch{try{request.transaction.abort();}catch{}}};
        request.onerror=fail;
        request.onblocked=fail;
        request.onsuccess=()=>{const d=request.result;try{if(settled)throw Error('storage_unavailable');live();if(!d.objectStoreNames.contains(STORE))throw Error('storage_unavailable');db=d;db.onversionchange=()=>dispose();settled=true;resolve(db);}catch{try{d.close();}catch{}reject(Error('storage_inactive'));}};
      });
      const d=await opening;live();return d;
    }
    async function transact(next,previous,write){
      live();if(write){value(next);value(previous);if(next===null)throw Error('invalid_storage');}
      const d=await open();live();
      const task=new Promise((resolve,reject)=>{
        let tx,answer=false,failed=false;
        const fail=()=>{if(failed)return;failed=true;reject(Error('storage_unavailable'));};
        try{
          tx=d.transaction(STORE,write?'readwrite':'readonly');const store=tx.objectStore(STORE),request=store.get(key);
          tx.onerror=fail;tx.onabort=fail;
          tx.oncomplete=()=>{if(failed)return;try{live();resolve(answer);}catch{reject(Error('storage_inactive'));}};
          request.onerror=fail;
          request.onsuccess=()=>{try{live();const current=request.result===undefined?null:request.result;value(current);if(write){if(current!==previous){answer=false;return;}store.put(next,key);answer=true;}else answer=current;}catch{try{tx.abort();}catch{}fail();}};
        }catch{fail();}
      });
      pending.add(task);try{return await task;}finally{pending.delete(task);}
    }
    return Object.freeze({read:()=>transact(undefined,undefined,false),write:(next,previous)=>transact(next,previous,true),dispose});
  }
  return Object.freeze({createCommandStore});
});
