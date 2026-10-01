/* Explicit, durable ID repair commands. This path never stages the stock journal. */
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.StockRollRepairTransaction=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  // Firebase omits empty containers and may read numeric-key objects as arrays.
  function canonical(value){
    if(value==null)return 'null';
    if(typeof value==='object'){
      const entries=Object.keys(value).sort().map(key=>[key,canonical(value[key])]).filter(entry=>entry[1]!=='null');
      return entries.length?'{'+entries.map(entry=>JSON.stringify(entry[0])+':'+entry[1]).join(',')+'}':'null';
    }
    return JSON.stringify(value);
  }
  const equal=(a,b)=>canonical(a)===canonical(b);
  const errorText=error=>String(error&&error.message||error||'Perbaikan belum dapat disimpan.');
  function fail(code,message){const error=new Error(message);error.code=code;error.notCommitted=true;return error;}
  function create(options){
    options=options||{};
    const storage=options.storage,key=options.key||'stok_roll_repair_v1';
    const clone=options.clone||copy,same=options.equal||equal;
    const engine=options.engine||root.StockRollRepair;
    const transactionRun=options.transactionRun||(root.CuttingTransaction&&root.CuttingTransaction.run);
    const now=options.now||(()=>new Date().toISOString());
    const makeId=options.makeId||(()=> 'rr_'+(root.crypto&&typeof root.crypto.randomUUID==='function'?root.crypto.randomUUID():Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)+'_'+Math.random().toString(36).slice(2)));
    let record=null,seenRaw=null,busy=false,lastError='',fatal='',durable=true;
    const receiptFor=entry=>({id:entry.id,jenis:entry.jenis,createdAt:entry.createdAt,changes:clone(entry.changes)});
    function validRecord(entry){
      if(!object(entry)||entry.version!==1||!['pending','confirmed','failed'].includes(entry.phase)||
        typeof entry.id!=='string'||!/^rr_[A-Za-z0-9_-]+$/.test(entry.id)||
        typeof entry.target!=='string'||!entry.target||typeof entry.jenis!=='string'||!entry.jenis||
        typeof entry.createdAt!=='string'||!entry.createdAt||!own(entry,'beforeStock')||!own(entry,'afterStock')||
        !own(entry,'mappings')||!Array.isArray(entry.changes)||!entry.changes.length||same(entry.beforeStock,entry.afterStock)){
        throw fail('INVALID_RECORD','Catatan perbaikan tidak valid. Ekspor cadangan sebelum melanjutkan.');
      }
      return entry;
    }
    try{
      if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function'||typeof storage.whenIdle!=='function')throw fail('STORAGE','Penyimpanan cadangan tahan muat ulang belum siap.');
      if(!engine||typeof engine.prepare!=='function'||typeof transactionRun!=='function')throw fail('NOT_READY','Pengaman perbaikan belum termuat. Muat ulang tanpa menghapus data.');
      seenRaw=storage.getItem(key);
      if(seenRaw!==null&&seenRaw!==undefined)record=validRecord(JSON.parse(seenRaw));
      else seenRaw=null;
    }catch(error){fatal=lastError=errorText(error);durable=false;}
    function diskStatus(){try{return typeof storage.status==='function'?storage.status():{};}catch(error){return {error:errorText(error)};}}
    function status(){
      const disk=diskStatus();
      return {ready:!fatal&&durable&&!disk.error&&!disk.pending,error:disk.error||lastError||fatal||'',busy,
        phase:record?record.phase:'idle',pending:!!record&&record.phase==='pending',target:record?record.target:'',id:record?record.id:''};
    }
    function check(io,entry){
      if(!io||typeof io.target!=='string'||!io.target||entry&&io.target!==entry.target)throw fail('TARGET_CHANGED','Tujuan database berubah. Perbaikan hanya dapat diperiksa di tujuan asalnya.');
      if(typeof io.check==='function'&&io.check()===false)throw fail('NOT_READY','Data atau koneksi berubah. Periksa kembali sebelum menyimpan.');
    }
    function assertOwner(){
      const latest=storage.getItem(key);
      if((latest===undefined?null:latest)!==seenRaw)throw fail('FOREIGN_RECORD','Catatan perbaikan berubah di tab lain. Muat ulang dan periksa catatan yang tersimpan.');
    }
    async function storageReady(){
      if(fatal)throw fail('NOT_READY',fatal);
      try{await storage.whenIdle();}catch(error){durable=false;throw fail('STORAGE','Cadangan belum tersimpan aman: '+errorText(error));}
      const disk=diskStatus();
      if(disk.error||disk.pending||!durable)throw fail('STORAGE',disk.error||'Cadangan belum tersimpan aman.');
      assertOwner();
    }
    async function persist(next,archive){
      assertOwner();
      const raw=JSON.stringify(next);
      if(archive){
        // Each command keeps its original backup even after a later repair.
        const archiveKey=key+':recovery:'+next.id;
        const previous=storage.getItem(archiveKey);
        if(previous!==null&&previous!==undefined&&previous!==raw)throw fail('ID_COLLISION','Identitas perbaikan sudah dipakai. Tidak ada data pusat yang diubah.');
        storage.setItem(archiveKey,raw);
      }
      storage.setItem(key,raw);seenRaw=raw;
      await storage.whenIdle();
      const disk=diskStatus();
      if(disk.error||disk.pending)throw fail('STORAGE',disk.error||'Cadangan belum selesai disimpan.');
      assertOwner();
    }
    function preparedFor(current,entry){
      if(!object(current))throw fail('MISSING_ROOT','Data pusat belum lengkap. Perbaikan dihentikan.');
      if(!current.produksi||typeof current.produksi!=='object')throw fail('MISSING_PRODUCTION','Data produksi pusat belum lengkap. Perbaikan dihentikan.');
      if(!same(current.stokBahan,entry.beforeStock))throw fail('STOCK_CHANGED','Stok pusat berubah sejak ditinjau. Buka ulang tinjauan perbaikan.');
      // soldier.produksi is the production root containing its own produksi
      // collection and cuttingPlans; the stock transaction runs at soldier.
      const prepared=engine.prepare(clone(current.produksi),clone(current.stokBahan),entry.jenis,clone(entry.mappings));
      if(!prepared||!Array.isArray(prepared.changes)||!prepared.changes.length||same(prepared.stock,entry.beforeStock))throw fail('NO_CHANGES','Tidak ada perubahan ID roll yang perlu disimpan.');
      if(own(entry,'afterStock')&&(!same(prepared.stock,entry.afterStock)||!same(prepared.changes,entry.changes)))throw fail('REPAIR_CHANGED','Hasil perbaikan berubah sejak ditinjau. Buka ulang tinjauan.');
      return prepared;
    }
    function receiptState(current,entry){
      if(!object(current))throw fail('MISSING_ROOT','Data pusat belum lengkap. Perbaikan dihentikan.');
      const receipts=current.stockRollRepairs;
      if(receipts!==undefined&&receipts!==null&&!object(receipts))throw fail('INVALID_RECEIPT','Catatan audit pusat tidak valid. Perbaikan dihentikan.');
      if(!receipts||!own(receipts,entry.id))return false;
      const saved=receipts[entry.id],expected=receiptFor(entry);
      // Extra fields, including null fields, cannot impersonate this command.
      if(!object(saved)||Object.keys(saved).sort().join('|')!=='changes|createdAt|id|jenis'||!same(saved,expected))throw fail('RECEIPT_MISMATCH','Catatan audit berbeda dari perbaikan ini. Cadangan tetap disimpan.');
      return true;
    }
    function resultFailure(error){
      lastError=errorText(error);
      return {ok:false,confirmed:false,pending:!!record&&record.phase==='pending',code:error.code||'SAVE_FAILED',error:lastError,
        notCommitted:error.notCommitted===true&&!(record&&record.phase==='pending'&&record.uncertain)};
    }
    async function execute(io,entry){
      let started=false,acknowledgedCommit=false;
      const previouslyUncertain=!!entry.uncertain;
      try{
        await storageReady();check(io,entry);
        if(typeof io.onValue!=='function'||typeof io.runTransaction!=='function')throw fail('NOT_READY','Pengaman koneksi belum siap.');
        // A tab can close after the server commit but before its acknowledgment.
        // The durable record must already forbid assuming a definite failure.
        entry={...entry,uncertain:true};
        await persist(entry,false);record=clone(entry);check(io,entry);
        const result=await transactionRun({ref:io.ref,onValue:io.onValue,timeoutMs:io.timeoutMs,
          check:()=>{check(io,entry);assertOwner();},
          validate:current=>{if(!receiptState(current,entry))preparedFor(current,entry);},
          update:current=>{
            if(receiptState(current,entry))return current;
            const prepared=preparedFor(current,entry);
            return {...current,stokBahan:prepared.stock,stockRollRepairs:{...(current.stockRollRepairs||{}),[entry.id]:receiptFor(entry)}};
          },
          receipt:(value,expected)=>{try{return receiptState(value,entry)&&same(value,expected);}catch(_){return false;}},
          // Mark only the actual write attempt, not the initial coherent read.
          runTransaction:async(ref,update,settings)=>{
            started=true;const response=await io.runTransaction(ref,update,settings);
            if(response&&response.committed===true)acknowledgedCommit=true;
            return response;
          }
        });
        const value=clone(result.snapshot.val());
        // The helper already checked connection and the exact acknowledged root.
        const confirmed={...entry,phase:'confirmed',confirmedAt:now(),error:''};
        try{await persist(confirmed,false);record=confirmed;lastError='';}
        catch(error){
          durable=false;record=clone(entry);lastError='Perbaikan sudah terkonfirmasi di pusat, tetapi konfirmasi lokal belum tersimpan: '+errorText(error);
          return {ok:true,confirmed:true,pending:true,id:entry.id,value,stock:clone(value.stokBahan),changes:clone(entry.changes),warning:lastError};
        }
        return {ok:true,confirmed:true,pending:false,id:entry.id,value,stock:clone(value.stokBahan),changes:clone(entry.changes)};
      }catch(error){
        // Once an earlier attempt may have committed, a failed read on retry
        // cannot prove that the original command failed. Keep it retryable.
        const definitive=error.notCommitted===true&&!previouslyUncertain&&!acknowledgedCommit;
        const next={...entry,phase:definitive?'failed':'pending',uncertain:!definitive&&(previouslyUncertain||started),error:errorText(error)};
        record=next;
        try{await persist(next,false);}catch(storageError){durable=false;const message=errorText(error)+' Cadangan lokal: '+errorText(storageError);const result=resultFailure(error);lastError=message;return {...result,error:message};}
        return resultFailure(error);
      }
    }
    async function save(io){
      if(busy)return resultFailure(fail('BUSY','Perbaikan sebelumnya masih diproses.'));
      if(record&&record.phase==='pending')return resultFailure(fail('PENDING','Periksa catatan perbaikan yang masih menunggu sebelum membuat perbaikan baru.'));
      busy=true;lastError='';
      try{
        await storageReady();check(io,null);
        if(typeof io.jenis!=='string'||!io.jenis)throw fail('INVALID_KIND','Pilih jenis bahan yang akan diperbaiki.');
        const entry={version:1,id:makeId(),phase:'pending',target:io.target,jenis:io.jenis,createdAt:now(),beforeStock:clone(io.stockSnapshot),mappings:clone(io.mappings),uncertain:false,error:''};
        const prepared=preparedFor(clone(io.rootSnapshot),entry);
        entry.afterStock=clone(prepared.stock);entry.changes=clone(prepared.changes);validRecord(entry);
        check(io,entry);record=entry;
        try{await persist(entry,true);}catch(error){durable=false;throw fail('STORAGE','Cadangan belum tersimpan aman: '+errorText(error));}
        check(io,entry);
        return await execute(io,clone(entry));
      }catch(error){return resultFailure(error);}
      finally{busy=false;}
    }
    async function retry(io){
      if(busy)return resultFailure(fail('BUSY','Perbaikan sebelumnya masih diproses.'));
      if(!record||record.phase!=='pending')return resultFailure(fail('NO_PENDING','Tidak ada perbaikan yang menunggu pemeriksaan.'));
      busy=true;lastError='';
      try{check(io,record);return await execute(io,clone(record));}
      catch(error){return resultFailure(error);}
      finally{busy=false;}
    }
    return {status,pending:()=>record&&record.phase==='pending'?clone(record):null,backup:()=>clone(record),save,retry};
  }
  return {create,equal,clone:copy};
});
