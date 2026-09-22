/* Keep the transaction path cached until its acknowledged receipt is checked.
 * A one-off get() does not retain a complete ancestor cache in the RTDB SDK.
 * Never fill a transaction callback from an earlier read or return a null no-op.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CuttingTransaction=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  async function run(options){
    if(!options||typeof options.onValue!=='function'||typeof options.runTransaction!=='function'||typeof options.update!=='function'||typeof options.validate!=='function'||typeof options.receipt!=='function'){
      const error=new Error('Pengaman penyimpanan belum siap. Muat ulang aplikasi tanpa menghapus data.');error.notCommitted=true;throw error;
    }
    let unsubscribe=null,timer=null,watchError=null,started=false,settled=false;
    const check=()=>{if(watchError)throw watchError;if(options.check)options.check();};
    const clearTimer=()=>{if(timer!==null){clearTimeout(timer);timer=null;}};
    try{
      check();
      await new Promise((resolve,reject)=>{
        const fail=error=>{watchError=error instanceof Error?error:new Error(String(error&&error.message||error||'Tidak dapat membaca data pusat.'));if(!settled){settled=true;clearTimer();reject(watchError);}};
        timer=setTimeout(()=>fail(new Error('Data pusat belum selesai dimuat. Pilihan tetap tersimpan; periksa koneksi lalu coba lagi.')),options.timeoutMs==null?15000:options.timeoutMs);
        try{
          // Deliberately not onlyOnce: detaching here would discard the cache
          // before runTransaction executes its first synchronous callback.
          unsubscribe=options.onValue(options.ref,snapshot=>{
            if(settled)return;
            try{check();options.validate(snapshot.val());settled=true;clearTimer();resolve();}catch(error){fail(error);}
          },fail);
          if(typeof unsubscribe!=='function')fail(new Error('Pemantau data pusat belum siap. Penyimpanan belum dimulai.'));
        }catch(error){fail(error);}
      });
      check();
      let validationError=null,expected,proposed=false;
      started=true;
      const result=await options.runTransaction(options.ref,current=>{
        validationError=null;expected=undefined;proposed=false;
        try{
          check();options.validate(current);
          const next=options.update(current);
          if(next===undefined)return;
          expected=next;proposed=true;return next;
        }catch(error){validationError=error;return;}
      },{applyLocally:false});
      if(result&&result.committed===false){
        const error=validationError||new Error('Data pusat berubah. Pilihan tetap tersimpan; periksa lalu coba lagi.');error.notCommitted=true;throw error;
      }
      // committed alone is not enough: an empty/no-op or unexpected receipt
      // must never clear a draft or claim that the requested change was saved.
      if(!result||result.committed!==true||!proposed||!result.snapshot||typeof result.snapshot.val!=='function'||options.receipt(result.snapshot.val(),expected)!==true)throw new Error('Hasil penyimpanan belum dapat dipastikan. Pilihan tetap tersimpan; coba lagi untuk memeriksa catatan yang sama.');
      check();
      return result;
    }catch(error){
      if(!started)error.notCommitted=true;
      throw error;
    }finally{
      clearTimer();
      if(typeof unsubscribe==='function'){try{unsubscribe();}catch(_){}}
    }
  }
  return {run};
});
