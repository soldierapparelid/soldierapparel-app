/* Separate owner tariff journal. No operational/legacy adoption or tokens. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./production-owner-tariff-client.js'):root.SoldierProductionOwnerTariffClient);if(typeof module==='object'&&module.exports)module.exports=api;else root.SoldierProductionOwnerTariffStore=api;})(typeof globalThis!=='undefined'?globalThis:this,function(Codec){
  'use strict';
  const DB='soldier-owner-tariff-journal:v1',STORE='journals',MAX_BYTES=262144,MAX_ARCHIVE=256,MAX_ARCHIVE_BYTES=8388608;
  const safeId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
  const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return d&&d.enumerable&&Object.hasOwn(d,'value');});
  const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
  const bytes=v=>new TextEncoder().encode(v).length;
  function createStore(options={}){
    const enabled=options&&Object.getOwnPropertyDescriptor(options,'enabled');
    if(!enabled||!Object.hasOwn(enabled,'value')||enabled.value!==true)return Object.freeze({read:async()=>{throw Error('service_disabled');},write:async()=>{throw Error('service_disabled');},lookup:async()=>{throw Error('service_disabled');},acknowledge:async()=>{throw Error('service_disabled');},dispose(){}});
    const allowed=['enabled','indexedDB','scope','endpointURL','isCurrent','archiveLimit','archiveBytesLimit'],required=allowed.slice(0,5);
    if(!options||![Object.prototype,null].includes(Object.getPrototypeOf(options))||Reflect.ownKeys(options).some(k=>typeof k!=='string'||!allowed.includes(k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(options,k),'value'))||required.some(k=>!Object.hasOwn(options,k)))throw Error('invalid_storage');
    const {indexedDB,endpointURL,isCurrent}=options;
    let scope=options.scope;const retention=true,limit=options.archiveLimit===undefined?MAX_ARCHIVE:options.archiveLimit,byteLimit=options.archiveBytesLimit===undefined?MAX_ARCHIVE_BYTES:options.archiveBytesLimit;
    if(!exact(scope,['projectId','databaseURL','tenantId','uid','grantRevision'])||typeof scope.projectId!=='string'||!/^[a-z][a-z0-9-]{5,62}$/.test(scope.projectId)||!safeId(scope.tenantId)||!safeId(scope.uid)||!Number.isSafeInteger(scope.grantRevision)||scope.grantRevision<0||typeof isCurrent!=='function'||!indexedDB||typeof indexedDB.open!=='function'||!Number.isSafeInteger(limit)||limit<1||limit>MAX_ARCHIVE||!Number.isSafeInteger(byteLimit)||byteLimit<1||byteLimit>MAX_ARCHIVE_BYTES||retention&&(!Codec||typeof Codec.decodeJournal!=='function'||typeof Codec.decodeAccepted!=='function'||typeof Codec.acceptedStorageBound!=='function'))throw Error('invalid_storage');
    try{const u=new URL(scope.databaseURL),e=new URL(endpointURL);if(typeof scope.databaseURL!=='string'||u.origin!==scope.databaseURL||u.protocol!=='https:'||u.port||u.username||u.password||!/(^|\.)(firebaseio\.com|firebasedatabase\.app)$/.test(u.hostname)||typeof endpointURL!=='string'||e.protocol!=='https:'||e.port||e.username||e.password||e.search||e.hash||e.href!==endpointURL||e.pathname!=='/v1/production/owner/tariffs/append')throw Error('invalid_storage');}catch{throw Error('invalid_storage');}
    try{Codec.decodeJournal(null,scope,endpointURL);}catch{throw Error('invalid_storage');}
    scope=Object.freeze({...scope});
    const tuple=[scope.projectId,scope.databaseURL,scope.tenantId,scope.uid,scope.grantRevision,endpointURL],key=JSON.stringify(tuple),metaKey=JSON.stringify([...tuple,'accepted-meta']),archiveKey=id=>JSON.stringify([...tuple,'accepted',id]);
    let inactive=false,opening,db;const pending=new Set();
    function live(){let current=false;try{current=!inactive&&isCurrent()===true;}catch{}if(!current)throw Error('storage_inactive');}
    function dispose(){inactive=true;try{if(db)db.close();}catch{}/* Active IDB transactions finish; old scope data is retained. */}
    function value(raw){if(raw===null)return;if(typeof raw!=='string'||bytes(raw)>MAX_BYTES)throw Error('invalid_storage');}
    function journal(raw){value(raw);try{return Codec.decodeJournal(raw,scope,endpointURL);}catch{throw Error('invalid_storage');}}
    function accepted(raw,id){value(raw);try{return Codec.decodeAccepted(raw,scope,endpointURL,id);}catch{throw Error('invalid_storage');}}
    function meter(raw){if(raw===undefined)return {schemaVersion:1,count:0,bytes:0};if(!exact(raw,['schemaVersion','count','bytes'])||raw.schemaVersion!==1||!Number.isSafeInteger(raw.count)||raw.count<0||raw.count>limit||!Number.isSafeInteger(raw.bytes)||raw.bytes<0||raw.bytes>byteLimit||(raw.count===0)!==(raw.bytes===0))throw Error('invalid_storage');return raw;}
    function reserve(doc){let total=0;for(const e of doc.entries)total+=Codec.acceptedStorageBound(e.command,scope,endpointURL);return total;}
    async function open(){
      live();if(db)return db;
      if(!opening)opening=new Promise((resolve,reject)=>{
        let request,settled=false;
        const fail=()=>{settled=true;reject(Error('storage_unavailable'));};
        // This database is distinct from production-command-store; it never
        // enumerates or imports another account, grant or application journal.
        try{request=indexedDB.open(DB,1);}catch{reject(Error('storage_unavailable'));return;}
        request.onupgradeneeded=()=>{try{const d=request.result;if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE);}catch{try{request.transaction.abort();}catch{}}};
        request.onerror=fail;request.onblocked=fail;
        request.onsuccess=()=>{const d=request.result;try{if(settled)throw Error('storage_unavailable');live();if(!d.objectStoreNames.contains(STORE))throw Error('storage_unavailable');db=d;db.onversionchange=()=>dispose();settled=true;resolve(db);}catch{try{d.close();}catch{}reject(Error('storage_inactive'));}};
      });
      const d=await opening;live();return d;
    }
    async function transact(kind,next,previous,archiveRaw,requestId){
      live();const writing=kind==='write'||kind==='ack';if(writing){value(next);value(previous);if(next===null)throw Error('invalid_storage');}
      let nextDoc,priorDoc,archived;
      if(retention&&writing){nextDoc=journal(next);priorDoc=journal(previous);
        if(kind==='ack'){
          try{archived=Codec.decodeAccepted(archiveRaw,scope,endpointURL);archiveRaw=JSON.stringify(archived);}catch{throw Error('invalid_storage');}
          const own=priorDoc.entries.find(e=>e.command.requestId===archived.command.requestId);
          if(!own||canonical(own.command)!==canonical(archived.command)||own.receipt!==null&&canonical(own.receipt)!==canonical(archived.receipt)||canonical(nextDoc.entries)!==canonical(priorDoc.entries.filter(e=>e!==own)))throw Error('invalid_storage');
        }else{
          if(nextDoc.entries.length<priorDoc.entries.length||nextDoc.entries.length>priorDoc.entries.length+1)throw Error('invalid_storage');
          const seen=new Set();for(const e of priorDoc.entries){const n=nextDoc.entries.find(n=>n.command.requestId===e.command.requestId);if(!n||canonical(n)!==canonical(e))throw Error('invalid_storage');seen.add(e.command.requestId);}
          for(const e of nextDoc.entries)if(!seen.has(e.command.requestId)&&e.receipt!==null)throw Error('invalid_storage');
        }
      }
      if(kind==='lookup'&&(!retention||!safeId(requestId)))throw Error('invalid_storage');
      const d=await open();live();
      const task=new Promise((resolve,reject)=>{
        let tx,answer=false,failed=false;
        const fail=()=>{if(failed)return;failed=true;reject(Error('storage_unavailable'));};
        const abort=()=>{try{tx.abort();}catch{}fail();};
        try{
          tx=d.transaction(STORE,writing?'readwrite':'readonly');const store=tx.objectStore(STORE);
          tx.onerror=fail;tx.onabort=fail;
          tx.oncomplete=()=>{if(failed)return;try{live();resolve(answer);}catch{reject(Error('storage_inactive'));}};
          // Dependent requests are queued synchronously in request callbacks,
          // keeping one real IDB transaction alive for CAS/archive/meter.
          const request=store.get(kind==='lookup'?archiveKey(requestId):key);request.onerror=abort;
          request.onsuccess=()=>{try{
            live();const current=request.result===undefined?null:request.result;value(current);
            if(!retention){if(writing){if(current!==previous){answer=false;return;}store.put(next,key);answer=true;}else answer=current;return;}
            if(writing&&current!==previous){answer=false;return;}
            const currentDoc=kind==='lookup'?null:journal(current),metaRequest=store.get(metaKey);metaRequest.onerror=abort;
            metaRequest.onsuccess=()=>{try{
              live();const meta=meter(metaRequest.result);
              if(kind==='lookup'){
                if(current!==null){accepted(current,requestId);if(meta.count===0||meta.bytes<bytes(current))throw Error('invalid_storage');}answer=current;return;
              }
              const doc=writing?nextDoc:currentDoc,ids=new Set([...currentDoc.entries,...doc.entries].map(e=>e.command.requestId));if(archived)ids.add(archived.command.requestId);
              let remaining=ids.size,conflicted=false;const currentIds=new Set(currentDoc.entries.map(e=>e.command.requestId));
              const finish=()=>{
                live();if(conflicted){answer=false;return;}const newCount=meta.count+(archived?1:0),newBytes=meta.bytes+(archived?bytes(archiveRaw):0);
                if(newCount+doc.entries.length>limit||newBytes+reserve(doc)>byteLimit){if(!writing)throw Error('invalid_storage');answer='capacity_limit';return;}
                if(writing){if(archived){store.put(archiveRaw,archiveKey(archived.command.requestId));store.put({schemaVersion:1,count:newCount,bytes:newBytes},metaKey);}store.put(next,key);answer=true;}else answer=current;
              };
              if(!remaining){finish();return;}
              for(const id of ids){const lookup=store.get(archiveKey(id));lookup.onerror=abort;lookup.onsuccess=()=>{try{live();if(lookup.result!==undefined){accepted(lookup.result,id);if(currentIds.has(id)||archived&&archived.command.requestId===id)throw Error('invalid_storage');conflicted=true;}if(--remaining===0)finish();}catch{abort();}};}
            }catch{abort();}};
          }catch{abort();}};
        }catch{abort();}
      });
      pending.add(task);try{return await task;}finally{pending.delete(task);}
    }
    const api={read:()=>transact('read'),write:(next,previous)=>transact('write',next,previous),dispose};
    if(retention){api.lookup=requestId=>transact('lookup',undefined,undefined,undefined,requestId);api.acknowledge=(next,previous,raw)=>transact('ack',next,previous,raw);}
    return Object.freeze(api);
  }
  return Object.freeze({createStore});
});
