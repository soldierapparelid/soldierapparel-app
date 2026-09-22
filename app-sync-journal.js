/* Fail-closed whole-document CAS with a durable local draft. No automatic force push. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.AppSyncJournal=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  // RTDB omits null/empty containers and may return numeric-key maps as arrays.
  // Canonicalize only for comparison: keep original records/indices untouched.
  function canonical(value){
    if(value==null)return 'null';
    if(typeof value==='object'){
      const entries=Object.keys(value).sort().map(key=>[key,canonical(value[key])]).filter(entry=>entry[1]!=='null');
      return entries.length?'{'+entries.map(entry=>JSON.stringify(entry[0])+':'+entry[1]).join(',')+'}':'null';
    }
    return JSON.stringify(value);
  }
  const equal=(a,b)=>canonical(a)===canonical(b);
  const token=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+'-'+Math.random().toString(36).slice(2);
  function create(options){
    const storage=options.storage,key=options.key;
    if(!storage||!key)throw new Error('Penyimpanan jurnal belum tersedia.');
    let owner=options.ownerId;
    if(!owner){
      try{owner=options.sessionStorage&&options.sessionStorage.getItem(key+':owner');}catch(e){}
      if(!owner){owner=token();try{if(options.sessionStorage)options.sessionStorage.setItem(key+':owner',owner);}catch(e){}}
    }
    const empty=()=>({version:1,owner,token:'',target:'',baseKnown:false,base:null,pending:false,draft:null,revision:0,conflict:false,error:''});
    // A separate slot for each page instance keeps both drafts recoverable even
    // when two tabs interleave their first read/set of the shared pointer.
    const pendingSlot=key+':pending:'+owner+':'+token();
    let state=empty(),seenToken='',durable=true,detached=false,backupFailed=false,inflight=null,activeFlush=null;
    function read(){
      const raw=storage.getItem(key);if(!raw)return null;
      const value=JSON.parse(raw);
      if(!value||value.version!==1||typeof value.token!=='string')throw new Error('Format jurnal tidak dikenal. Ekspor cadangan sebelum melanjutkan.');
      return value;
    }
    try{const loaded=read();if(loaded){state=loaded;seenToken=loaded.token;}}
    catch(e){durable=false;state.error='Jurnal lokal gagal dibaca: '+e.message;}
    const isRecoveryKey=entryKey=>entryKey&&(entryKey.startsWith(key+':recovery:')||entryKey.startsWith(key+':pending:'));
    function hasRecoveryEntries(){
      // Status needs only existence; opening every full backup can freeze the UI.
      for(let i=0;i<storage.length;i++)if(isRecoveryKey(storage.key(i)))return true;
      return false;
    }
    function recoveryEntries(){
      const entries=[];
      for(let i=0;i<storage.length;i++){
        const entryKey=storage.key(i);
        if(isRecoveryKey(entryKey)){
          try{entries.push({key:entryKey,value:JSON.parse(storage.getItem(entryKey))});}catch(e){entries.push({key:entryKey,error:'Cadangan tidak dapat dibaca'});}
        }
      }
      return entries;
    }
    function backup(value,reason){
      storage.setItem(key+':recovery:'+token(),JSON.stringify({version:1,owner,reason,createdAt:new Date().toISOString(),value:clone(value)}));
    }
    function persist(next){
      try{
        if(next.pending)storage.setItem(pendingSlot,JSON.stringify({version:1,owner,reason:'Draf tab tersimpan sebelum memperbarui penunjuk bersama',createdAt:new Date().toISOString(),value:clone(next)}));
        const latest=read();
        const foreign=latest&&latest.pending&&(latest.owner!==owner||latest.token!==seenToken);
        if(foreign){
          backup(next,'Draf tab ini berbeda dari draf tab lain; tidak ditimpa');
          state=next;state.conflict=true;state.error='Ada draf belum terkirim dari tab lain. Ekspor cadangan dan selesaikan di tab asal.';
          detached=true;durable=true;return false;
        }
        next={...next,owner,token:token()};
        storage.setItem(key,JSON.stringify(next));
        if(!next.pending){try{storage.removeItem(pendingSlot);}catch(e){}}
        state=next;seenToken=next.token;durable=true;detached=false;return true;
      }catch(e){
        state=next;state.error='Draf belum tersimpan aman: '+e.message+'. Jangan tutup atau muat ulang; ekspor cadangan.';
        durable=false;return false;
      }
    }
    function status(){
      let recoveryAvailable=false,foreignPending=false;
      try{recoveryAvailable=hasRecoveryEntries();const latest=read();foreignPending=foreignPending||!!(latest&&latest.pending&&(latest.owner!==owner||latest.token!==seenToken));}catch(e){}
      const disk=typeof storage.status==='function'?storage.status():{};
      return {pending:!!state.pending,baseKnown:!!state.baseKnown,revision:state.revision||0,conflict:!!state.conflict,error:disk.error||state.error||'',durable:durable&&!disk.pending&&!disk.error,saving:!!disk.pending,foreignPending,detached,recoveryAvailable,target:state.target||''};
    }
    // A queued IndexedDB write is not a durable acknowledgement. No network
    // transaction may begin until every local draft/backup write has committed.
    async function ready(){
      try{if(typeof storage.whenIdle==='function')await storage.whenIdle();}
      catch(e){durable=false;state.error='Draf belum tersimpan aman: '+e.message+'. Jangan tutup atau muat ulang; ekspor cadangan.';throw e;}
      if(!status().durable||backupFailed)throw new Error(status().error||'Cadangan belum tersimpan aman.');
    }
    // Lightweight read paths never enumerate or serialize historical backups.
    const metadata=()=>({owner,token:state.token,target:state.target||'',revision:state.revision||0,pending:!!state.pending,baseKnown:!!state.baseKnown});
    const snapshot=()=>clone(state);
    const current=()=>clone(state.pending?state.draft:state.base);
    function resolve(base,local,remote){
      if(typeof options.merge==='function')return options.merge(clone(base),clone(local),clone(remote));
      return equal(remote,base)||equal(remote,local)?{ok:true,value:clone(local),conflicts:[]}:{ok:false,conflicts:['data pusat berubah']};
    }
    function observedRemote(remote,target){
      if(!activeFlush||activeFlush.target!==target||activeFlush.observed)return;
      // A value listener can confirm our transaction before its promise resolves.
      // Once its changes are observed, later accepted snapshots/edits must not be
      // rolled back by that transaction's older acknowledgment.
      const captured=activeFlush.captured;
      const merged=resolve(captured.base,captured.draft,remote);
      if(merged&&merged.ok&&equal(merged.value,remote))activeFlush.observed=true;
    }
    function seedLegacy(value,hasData){
      if(state.baseKnown||state.pending||!hasData)return true;
      try{
        if(!recoveryEntries().some(entry=>entry.value&&entry.value.reason==='Cache lama tanpa dasar server'))backup(value,'Cache lama tanpa dasar server');
        return true;
      }catch(e){backupFailed=true;durable=false;state.error='Cadangan cache lama gagal disimpan. Jangan muat ulang; ekspor cadangan: '+e.message;state.legacyMemory=clone(value);return false;}
    }
    function acceptRemote(remote,target){
      remote=clone(remote===undefined?null:remote);target=String(target||'');
      if(backupFailed||!durable)return {apply:false,error:state.error};
      if(status().foreignPending)return {apply:false,error:'Draf tab lain masih menunggu. Ekspor cadangan dan selesaikan di tab asal.'};
      if(state.pending){
        const merged=state.baseKnown&&state.target===target?resolve(state.base,state.draft,remote):{ok:false};
        if(!merged.ok){
          persist({...state,conflict:true,error:'Data pusat berubah atau dasar draf belum terkonfirmasi. Draf lokal tetap disimpan; ekspor dan periksa sebelum lanjut.'});
          return {apply:false,pending:true,error:state.error};
        }
        const changed=!equal(state.draft,merged.value)||!equal(state.base,remote);
        const fulfilled=equal(merged.value,remote);
        const next={...state,base:remote,draft:fulfilled?null:clone(merged.value),pending:!fulfilled,revision:state.revision+(changed?1:0),conflict:false,error:''};
        if(!persist(next))return {apply:false,error:state.error};
        observedRemote(remote,target);
        return {apply:true,value:current(),pending:!!state.pending};
      }
      const next={...state,target,baseKnown:true,base:remote,draft:null,pending:false,conflict:false,error:''};
      if(!persist(next))return {apply:false,error:state.error};
      observedRemote(remote,target);
      return {apply:true,value:clone(remote)};
    }
    function stage(value,target){
      target=String(target||state.target||'');
      const mismatch=(state.pending||state.baseKnown)&&state.target&&state.target!==target;
      const next={...state,target:mismatch?state.target:target,pending:true,draft:clone(value),revision:(state.revision||0)+1,conflict:!!mismatch,error:mismatch?'Tujuan database berbeda dari draf. Ekspor cadangan; jangan kirim ke database lain.':''};
      if(mismatch){try{backup(next,'Perubahan dengan tujuan database berbeda');}catch(e){durable=false;}state=next;detached=true;return false;}
      return persist(next);
    }
    async function flush(io){
      if(inflight)return inflight;
      await ready();
      if(typeof storage.refresh==='function')await storage.refresh();
      // A receive/edit can enqueue a newer revision while refresh is reading.
      // Check in this same turn before capture; only a committed draft may send.
      while(status().saving)await ready();
      if(!status().durable)throw new Error(status().error||'Draf belum tersimpan aman.');
      if(inflight)return inflight;
      if(!state.pending)return {value:clone(state.base),pending:false};
      if(!durable||backupFailed)throw new Error(state.error||'Draf belum tersimpan aman.');
      if(status().foreignPending)throw new Error('Ada draf tab lain. Tidak boleh menimpa draf tersebut.');
      if(detached)throw new Error('Draf pemulihan perlu diperiksa dahulu. Ekspor cadangan atau pilih data pusat.');
      const target=String(io.target||'');
      if(!state.baseKnown||!target||target!==state.target)throw new Error('Dasar/tujuan server belum terkonfirmasi; draf tidak dikirim.');
      const captured=clone(state);
      const sending={captured,target,observed:false};activeFlush=sending;
      inflight=(async()=>{
        try{
          // Warm the SDK cache, and reject conflicts before starting a transaction.
          const serverNow=await io.get();
          const initial=resolve(captured.base,captured.draft,serverNow);
          if(!initial||!initial.ok)throw new Error('Konflik: '+((initial&&initial.conflicts)||['data pusat berubah']).join(', ')+'. Draf lokal tetap tersimpan; tidak ditimpa.');
          const result=await io.transaction(server=>{
            const merged=resolve(captured.base,captured.draft,server);
            return merged&&merged.ok?clone(merged.value):undefined;
          });
          if(!result||!result.committed)throw new Error('Konflik transaksi: data pusat berubah. Draf tetap tersimpan.');
          const confirmed=clone(result.value===undefined?null:result.value);
          if(sending.observed){
            await ready();
            return {value:current(),confirmed:clone(confirmed),pending:!!state.pending};
          }
          const next={...state,baseKnown:true,base:confirmed,conflict:false,error:''};
          if(state.revision===captured.revision){next.pending=false;next.draft=null;}
          else if(state.pending&&typeof options.merge==='function'){
            const newer=resolve(captured.draft,state.draft,confirmed);
            if(newer&&newer.ok)next.draft=clone(newer.value);
            else {next.base=clone(captured.draft);next.conflict=true;next.error='Konflik pada perubahan baru setelah pengiriman. Draf terbaru tetap disimpan.';}
          }
          if(!persist(next))throw new Error(state.error||'Konfirmasi belum dapat disimpan.');
          await ready();
          return {value:current(),confirmed:clone(confirmed),pending:!!state.pending};
        }catch(e){
          if(durable&&!detached)persist({...state,conflict:/konflik/i.test(e.message),error:e.message});
          else state.error=e.message;
          throw e;
        }finally{inflight=null;if(activeFlush===sending)activeFlush=null;}
      })();
      return inflight;
    }
    function useRemote(remote,target){
      if(status().foreignPending){state.error='Selesaikan draf tab asal dahulu. Draf tab lain tidak dihapus.';return false;}
      try{
        if(state.pending)backup(state,'Draf disisihkan setelah pengguna memilih data pusat');
        if(state.legacyMemory)backup(state.legacyMemory,'Cache lama dipulihkan sebelum pengguna memilih data pusat');
      }
      catch(e){durable=false;state.error='Cadangan draf gagal: '+e.message;return false;}
      backupFailed=false;
      return persist({...empty(),target:String(target||''),baseKnown:true,base:clone(remote===undefined?null:remote),revision:(state.revision||0)+1});
    }
    // Explicit review only. Back up the ORIGINAL state durably before rebasing;
    // never publish here. The normal transaction still rechecks newer cloud data.
    async function reconcilePending(remote,target,expectedToken,resolver,recoveryContext){
      await ready();
      if(typeof storage.refresh==='function')await storage.refresh();
      const check=()=>{
        const info=status();
        if(inflight||activeFlush||!info.durable||info.foreignPending||detached||!state.pending||!state.baseKnown||state.token!==expectedToken||state.target!==String(target||''))throw new Error('Draf berubah atau masih digunakan tab lain. Tinjau ulang; tidak ada draf yang dibuang.');
      };
      check();
      const original=clone(state),merged=resolver(clone(state.base),clone(state.draft),clone(remote));
      if(!merged||!merged.ok)throw new Error('Masih ada perbedaan yang belum dipilih. Draf tetap disimpan.');
      if(recoveryContext!==undefined)original.recoveryContext=clone(recoveryContext);
      backup(original,'Draf lengkap sebelum peninjauan per barang; versi lokal tidak dihapus');
      await ready();check();
      const fulfilled=equal(merged.value,remote);
      if(!persist({...state,base:clone(remote),draft:fulfilled?null:clone(merged.value),pending:!fulfilled,revision:(state.revision||0)+1,conflict:false,error:''}))throw new Error(state.error||'Hasil tinjauan belum tersimpan aman.');
      await ready();
      return {value:current(),pending:!!state.pending};
    }
    // Caller must obtain explicit confirmation. Never reclaim another tab's
    // draft automatically, and keep recovery copies before changing ownership.
    function resumeSavedDraft(){
      try{
        const saved=read();
        if(!saved||!saved.pending){state.error='Tidak ada draf bersama yang menunggu.';return false;}
        backup(saved,'Draf sebelum pengguna memindahkan kepemilikan ke tab ini');
        if(state.pending&&!equal(state.draft,saved.draft))backup(state,'Draf tab sebelum melanjutkan draf bersama');
        const claimed={...saved,owner,token:token(),conflict:false,error:''};
        storage.setItem(pendingSlot,JSON.stringify({version:1,owner,reason:'Draf dilanjutkan dengan persetujuan pengguna',createdAt:new Date().toISOString(),value:clone(claimed)}));
        const latest=read();
        if(!latest||latest.token!==saved.token){state.error='Draf berubah saat akan dilanjutkan. Periksa kembali.';return false;}
        storage.setItem(key,JSON.stringify(claimed));
        state=claimed;seenToken=claimed.token;durable=true;detached=false;backupFailed=false;return true;
      }catch(e){state.error='Draf tidak dapat dilanjutkan: '+e.message;durable=false;return false;}
    }
    function exportState(){
      let persisted=null,recovery=[];
      try{persisted=read();recovery=recoveryEntries();}catch(e){}
      const storageState=typeof storage.exportState==='function'?storage.exportState():undefined;
      return JSON.stringify({version:1,key,owner,exportedAt:new Date().toISOString(),state:clone(state),persisted,recovery,storageState},null,2);
    }
    return {status,metadata,snapshot,ready,seedLegacy,acceptRemote,stage,flush,useRemote,reconcilePending,resumeSavedDraft,exportState,current,draft:()=>state.pending?clone(state.draft):undefined};
  }
  return {create,equal,clone};
});
