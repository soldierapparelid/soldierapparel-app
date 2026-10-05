(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SoldierAccessSession=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // Testable ordering boundary: no business listener can be started before this resolves.
  async function authorize(options){
    const user=await options.getUser();
    if(!user||!user.uid||user.emailVerified!==true)throw new Error('Masuk dengan akun Google yang terverifikasi.');
    const profile=await options.getProfile(user.uid);
    if(!options.allowed(profile,options.moduleName))throw new Error('Akun ini belum mendapat akses divisi. Minta owner mendaftarkan akun.');
    if(!options.draftAccess(options.binding,user.uid,options.pending()))throw new Error('Ada draf perangkat milik akun lama atau sebelum login. Draf tetap disimpan; periksa bersama owner sebelum mengirim.');
    return Object.freeze({uid:user.uid,profile});
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
  return Object.freeze({authorize,compatDatabase});
});
