/* Durable IndexedDB-backed Storage mirror for sync journals, not business caches. */
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.AppSyncStorage=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  const DEFAULT_DB='soldier-app-sync-journals-v1',STORE='records';
  const unique=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+'-'+Math.random().toString(36).slice(2);
  const message=error=>error&&error.message?error.message:String(error||'Penyimpanan jurnal gagal.');
  function transaction(db,mode){
    try{return db.transaction(STORE,mode,{durability:'strict'});}
    catch(error){if(error&&error.name==='TypeError')return db.transaction(STORE,mode);throw error;}
  }
  function openDatabase(indexedDB,name){
    return new Promise((resolve,reject)=>{
      if(!indexedDB||typeof indexedDB.open!=='function'){reject(new Error('IndexedDB tidak tersedia. Jangan reset cache; ekspor cadangan.'));return;}
      let settled=false,request;
      const fail=error=>{if(!settled){settled=true;reject(error instanceof Error?error:new Error(message(error)));}};
      try{request=indexedDB.open(name,1);}catch(error){fail(error);return;}
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE);};
      request.onerror=()=>fail(request.error||new Error('IndexedDB tidak dapat dibuka.'));
      request.onblocked=()=>fail(new Error('Penyimpanan jurnal sedang dipakai versi lain. Ekspor cadangan dan tutup tab lama setelah aman.'));
      request.onsuccess=()=>{if(settled){request.result.close();return;}settled=true;resolve(request.result);};
    });
  }
  function readRecords(db,selected){
    return new Promise((resolve,reject)=>{
      let tx,problem=null;const values=new Map();
      try{
        tx=transaction(db,'readonly');const request=tx.objectStore(STORE).openCursor();
        request.onerror=()=>{problem=request.error||new Error('Jurnal tidak dapat dibaca.');};
        request.onsuccess=()=>{
          const cursor=request.result;if(!cursor)return;
          if(typeof cursor.key==='string'&&selected(cursor.key)){
            if(typeof cursor.value!=='string'){problem=new Error('Format penyimpanan jurnal tidak dikenal. Jangan reset cache.');tx.abort();return;}
            values.set(cursor.key,cursor.value);
          }
          cursor.continue();
        };
        tx.oncomplete=()=>resolve(values);
        tx.onabort=tx.onerror=()=>reject(problem||tx.error||new Error('Pembacaan jurnal gagal.'));
      }catch(error){reject(error);}
    });
  }
  async function open(options){
    options=options||{};
    const roots=[...new Set((options.keys||[]).map(String))];
    if(!roots.length||roots.some(key=>!key))throw new Error('Daftar jurnal harus berupa kunci yang tepat.');
    const selected=key=>roots.some(base=>key===base||key.startsWith(base+':recovery:')||key.startsWith(base+':pending:'));
    const baseFor=key=>roots.find(base=>key===base||key.startsWith(base+':recovery:')||key.startsWith(base+':pending:'));
    const local=options.storage;
    if(!local||typeof local.getItem!=='function')throw new Error('Cache lama tidak dapat diperiksa; migrasi dihentikan.');
    const db=await openDatabase(options.indexedDB,options.dbName||DEFAULT_DB);
    let mirror=new Map(),persisted=new Map(),pending=0,mutationGeneration=0,fault=null,closed=false,queue=Promise.resolve(),refreshing=null;
    const notify=()=>{
      try{if(typeof options.onChange==='function')options.onChange();}catch(error){}
      try{if(root&&typeof root.dispatchEvent==='function'&&typeof root.Event==='function')root.dispatchEvent(new root.Event('app-sync-storage-change'));}catch(error){}
    };
    const fail=error=>{if(!fault)fault=new Error(message(error));return fault;};
    const assertUsable=()=>{if(closed)throw new Error('Penyimpanan jurnal sudah ditutup.');if(fault)throw fault;};
    const localRecords=()=>{
      const values=new Map();
      for(let i=0;i<local.length;i++){
        const key=local.key(i);if(typeof key==='string'&&selected(key)){const raw=local.getItem(key);if(raw!==null)values.set(key,raw);}
      }
      return values;
    };
    // Keep every localStorage source. A get/compare/remove sequence cannot be
    // atomic across old-client tabs. A durable receipt lets us ignore an exact
    // unchanged source on later opens, without treating it as a fresh writer.
    // A changed legacy source is archived and blocked, never silently adopted.
    async function migrateLegacy(){
      const source=localRecords();if(!source.size)return;
      const copies=[],conflicts=[],receipts=[];
      await new Promise((resolve,reject)=>{
        let tx,problem=null;
        try{
          tx=transaction(db,'readwrite');const store=tx.objectStore(STORE);
          for(const [key,raw] of source){
            const receiptKey=baseFor(key)+':recovery:storage-receipt:'+encodeURIComponent(key);
            const request=store.get(key),receiptRequest=store.get(receiptKey);
            let gotValue=false,gotReceipt=false;
            const copy=()=>{
              if(!gotValue||!gotReceipt)return;
              const previous=request.result===undefined?null:request.result,receiptRaw=receiptRequest.result;
              if(previous!==null&&typeof previous!=='string'){problem=new Error('Format jurnal tujuan tidak dikenal.');tx.abort();return;}
              let receipt=null;
              if(receiptRaw!==undefined){
                try{
                  receipt=JSON.parse(receiptRaw);
                  if(receipt.version!==1||receipt.reason!=='Tanda migrasi jurnal localStorage'||!receipt.value||receipt.value.sourceKey!==key||typeof receipt.value.raw!=='string')throw new Error('invalid receipt');
                }catch(error){problem=new Error('Tanda migrasi jurnal tidak valid. Kedua penyimpanan tetap dipertahankan.');tx.abort();return;}
              }
              if(receipt&&receipt.value.raw===raw){receipts.push({key:receiptKey,raw:receiptRaw});return;}
              const conflict=!!receipt||previous!==null&&previous!==raw;
              const backupKey=baseFor(key)+':recovery:storage-migration-'+unique();
              const backupRaw=JSON.stringify({version:1,reason:'Migrasi jurnal localStorage',createdAt:new Date().toISOString(),value:{sourceKey:key,raw,persistedRaw:previous,conflict,previouslyCopiedRaw:receipt?receipt.value.raw:null}});
              store.put(backupRaw,backupKey);
              if(!conflict){
                store.put(raw,key);
                const nextReceipt=JSON.stringify({version:1,reason:'Tanda migrasi jurnal localStorage',createdAt:new Date().toISOString(),value:{sourceKey:key,raw}});
                store.put(nextReceipt,receiptKey);receipts.push({key:receiptKey,raw:nextReceipt});
              }else conflicts.push(key);
              copies.push({key,raw,backupKey,backupRaw,conflict});
            };
            request.onsuccess=()=>{gotValue=true;copy();};
            receiptRequest.onsuccess=()=>{gotReceipt=true;copy();};
            request.onerror=()=>{problem=request.error||new Error('Cache lama belum dapat dicadangkan.');};
            receiptRequest.onerror=()=>{problem=receiptRequest.error||new Error('Tanda migrasi belum dapat diperiksa.');};
          }
          tx.oncomplete=resolve;
          tx.onabort=tx.onerror=()=>reject(problem||tx.error||new Error('Migrasi jurnal belum tersimpan aman.'));
        }catch(error){reject(error);}
      });
      const verified=await readRecords(db,selected);
      for(const copy of copies){
        if(verified.get(copy.backupKey)!==copy.backupRaw)throw new Error('Salinan jurnal belum lolos verifikasi. Cache lama tetap dipertahankan.');
      }
      for(const receipt of receipts){if(verified.get(receipt.key)!==receipt.raw)throw new Error('Tanda migrasi jurnal belum lolos verifikasi. Cache lama tetap dipertahankan.');}
      if(conflicts.length)throw new Error('Ada jurnal lama berbeda dari cadangan IndexedDB ('+conflicts.join(', ')+'). Kedua salinan disimpan; ekspor cadangan sebelum melanjutkan.');
      for(const [key,raw] of source){
        if(local.getItem(key)!==raw)throw new Error('Jurnal lama berubah saat migrasi. Salinan baru tidak dihapus; ekspor dan periksa tab lain.');
      }
    }
    // One readwrite transaction serializes CAS across tabs. In-page queue order
    // commits a per-page pending slot before the corresponding shared pointer.
    function writeCas(key,expected,value){
      return new Promise((resolve,reject)=>{
        let tx,problem=null;
        try{
          tx=transaction(db,'readwrite');const store=tx.objectStore(STORE),request=store.get(key);
          request.onsuccess=()=>{
            const current=request.result===undefined?null:request.result;
            if(current!==expected){problem=new Error('Jurnal berubah di tab lain ('+key+'). Draf tab ini tetap tersedia untuk diekspor; jangan menimpa.');tx.abort();return;}
            if(value===null)store.delete(key);else store.put(value,key);
          };
          request.onerror=()=>{problem=request.error||new Error('Jurnal belum dapat diperiksa.');};
          tx.oncomplete=()=>{if(value===null)persisted.delete(key);else persisted.set(key,value);resolve();};
          tx.onabort=tx.onerror=()=>reject(problem||tx.error||new Error('Jurnal belum tersimpan aman di IndexedDB.'));
        }catch(error){reject(error);}
      });
    }
    function change(key,value){
      assertUsable();key=String(key);
      if(!selected(key))throw new Error('Kunci bukan jurnal terpilih; cache bisnis tidak boleh diubah oleh penyimpanan jurnal.');
      const previous=mirror.has(key)?mirror.get(key):null;
      if(previous===value)return;
      if(value===null)mirror.delete(key);else mirror.set(key,value);
      pending++;mutationGeneration++;
      queue=queue.then(async()=>{assertUsable();await writeCas(key,previous,value);}).catch(error=>{fail(error);}).finally(()=>{pending--;if(!pending)notify();});
    }
    async function whenIdle(){
      // A listener may append a write while an earlier transaction completes.
      let observed;do{observed=queue;await observed;}while(observed!==queue);
      assertUsable();
    }
    function refresh(){
      if(refreshing)return refreshing;
      refreshing=(async()=>{
        // A Firebase receive or operator edit may arrive while IDB is reading.
        // Never reject that harmless overlap, and never replace its newer mirror
        // with our older read snapshot. Drain/re-read until a quiet generation.
        for(;;){
          await whenIdle();
          const generation=mutationGeneration;
          await migrateLegacy();
          const latest=await readRecords(db,selected);
          assertUsable();if(generation!==mutationGeneration)continue;
          mirror=new Map(latest);persisted=new Map(latest);break;
        }
        return adapter;
      })().catch(error=>{fail(error);throw fault;}).finally(()=>{refreshing=null;notify();});
      return refreshing;
    }
    function exportState(){
      let legacyLocal=[],localError='';try{legacyLocal=[...localRecords()];}catch(error){localError=message(error);}
      return JSON.stringify({version:1,database:options.dbName||DEFAULT_DB,keys:roots,status:adapter.status(),mirror:[...mirror],persisted:[...persisted],legacyLocal,localError},null,2);
    }
    const adapter={
      getItem:key=>mirror.has(String(key))?mirror.get(String(key)):null,
      setItem:(key,value)=>change(key,String(value)),removeItem:key=>change(key,null),
      key:index=>{index=Number(index);return Number.isInteger(index)&&index>=0?[...mirror.keys()].sort()[index]||null:null;},
      get length(){return mirror.size;},
      status:()=>({pending:pending>0||!!refreshing,error:fault?fault.message:''}),whenIdle,refresh,exportState,
      close:()=>{if(pending||refreshing)throw new Error('Tunggu jurnal tersimpan sebelum menutup penyimpanan.');closed=true;db.close();}
    };
    db.onversionchange=()=>{fail(new Error('Versi penyimpanan berubah di tab lain. Ekspor draf sebelum memuat ulang.'));closed=true;db.close();notify();};
    try{
      // Capture previously durable records even if copying a legacy key fails.
      persisted=await readRecords(db,selected);mirror=new Map(persisted);
      await migrateLegacy();
      persisted=await readRecords(db,selected);mirror=new Map(persisted);
    }catch(error){
      fail(error);
      try{persisted=await readRecords(db,selected);mirror=new Map(persisted);}catch(readError){}
      notify();
    }
    return adapter;
  }
  return {open};
});
