(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SoldierAccessSession=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // Testable ordering boundary: no business listener can be started before this resolves.
  async function authorize(options){
    const user=await options.getUser();
    if(!user||!user.uid||user.emailVerified!==true)throw new Error('Masuk dengan akun Google yang terverifikasi.');
    const profile=await options.getProfile(user.uid,user);
    if(!options.allowed(profile,options.moduleName))throw new Error('Akun ini belum mendapat akses divisi. Minta owner mendaftarkan akun.');
    if(!options.draftAccess(options.binding,user.uid,options.pending()))throw new Error('Ada draf perangkat milik akun lama atau sebelum login. Draf tetap disimpan; periksa bersama owner sebelum mengirim.');
    return Object.freeze({uid:user.uid,profile});
  }
  // Cancel future business I/O and discard stale callbacks when the captured
  // session is no longer current. Server Rules remain the authorization boundary.
  function guardDatabase(options){
    const raw=options.sdk,db=options.db,refs=new WeakSet(),listeners=new Set();
    let disposed=false;
    const current=()=>{try{return !disposed&&options.isCurrent()===true;}catch{return false;}};
    const assert=()=>{if(!current())throw new Error('Sesi akses berubah. Draf tetap disimpan.');};
    const node=value=>{assert();if(!value||!refs.has(value))throw new Error('Referensi koneksi tidak sesuai sesi.');return value;};
    const dispose=()=>{if(disposed)return;disposed=true;for(const off of listeners){try{off();}catch{}}listeners.clear();};
    const sdk={
      ref(database,path){assert();if(database!==db)throw new Error('Tujuan koneksi tidak sesuai sesi.');const result=raw.ref(db,path);refs.add(result);return result;},
      async get(reference){node(reference);const result=await raw.get(reference);assert();return result;},
      onValue(reference,callback,error,...args){
        node(reference);let stopped=false,stop;
        const guarded=value=>{if(current()&&!stopped)callback(value);};
        const failed=problem=>{if(current()&&!stopped&&typeof error==='function')error(problem);};
        const off=raw.onValue(reference,guarded,failed,...args);
        stop=()=>{if(stopped)return;stopped=true;listeners.delete(stop);if(typeof off==='function')off();};
        listeners.add(stop);if(!current())stop();return stop;
      },
      async runTransaction(reference,update,...args){
        node(reference);const result=await raw.runTransaction(reference,value=>{if(!current())return undefined;const next=update(value);return current()?next:undefined;},...args);assert();return result;
      },
      async set(reference,value){node(reference);const result=await raw.set(reference,value);assert();return result;},
      goOnline(database){assert();if(database!==db)throw new Error('Tujuan koneksi tidak sesuai sesi.');return raw.goOnline(db);},
      goOffline(database){if(database!==db)throw new Error('Tujuan koneksi tidak sesuai sesi.');return raw.goOffline(db);}
    };
    return Object.freeze({sdk:Object.freeze(sdk),dispose,isCurrent:current});
  }
  function compatDatabase(db,sdk){
    function ref(path){
      const node=sdk.ref(db,path),listeners=new Map();
      const valueOnly=event=>{if(event!=='value')throw new Error('Jenis pembacaan tidak didukung.');};
      return {
        once(event){valueOnly(event);return sdk.get(node);},
        on(event,callback,error){valueOnly(event);if(listeners.has(callback))listeners.get(callback)();listeners.set(callback,sdk.onValue(node,callback,error));return callback;},
        off(event,callback){valueOnly(event);if(callback){const off=listeners.get(callback);if(off)off();listeners.delete(callback);}else{for(const off of listeners.values())off();listeners.clear();}},
        async transaction(update,complete,applyLocally=true){try{const result=await sdk.runTransaction(node,update,{applyLocally});if(complete)complete(null,result.committed,result.snapshot);return result;}catch(error){if(complete)complete(error,false,null);throw error;}}
      };
    }
    return {ref};
  }
  return Object.freeze({authorize,guardDatabase,compatDatabase});
});
