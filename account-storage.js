/* Account-scoped storage boundary. Authenticate before creating a scope. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.SoldierAccountStorage=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  const PREFIX='soldier-account-storage:v1:',MAX_KEYS=100000;
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  function fail(code){throw new Error(code);}
  function plain(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));}
  function fields(value){
    if(!plain(value))fail('invalid_storage_options');
    const names=Reflect.ownKeys(value);
    for(const name of names){
      const descriptor=Object.getOwnPropertyDescriptor(value,name);
      if(typeof name!=='string'||['__proto__','constructor','prototype'].includes(name)||!descriptor||!descriptor.enumerable||!own(descriptor,'value'))fail('invalid_storage_options');
    }
    return names;
  }
  function keyName(value){return typeof value==='string'&&value.length>0&&value.length<=512&&!/[\u0000-\u001f\u007f]/.test(value)&&!['__proto__','constructor','prototype'].includes(value);}
  function strings(value){
    if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>500)fail('invalid_storage_options');
    const names=Reflect.ownKeys(value);
    if(names.length!==value.length+1||names.some(name=>typeof name!=='string'||name!=='length'&&!/^\d+$/.test(name)))fail('invalid_storage_options');
    const out=[];
    for(let i=0;i<value.length;i++){
      const descriptor=Object.getOwnPropertyDescriptor(value,String(i));
      if(!descriptor||!own(descriptor,'value')||!keyName(descriptor.value))fail('invalid_storage_options');
      out.push(descriptor.value);
    }
    return [...new Set(out)];
  }
  function binding(scope){
    try{
      const names=fields(scope),required=['projectId','databaseURL','uid','module','schemaVersion'];
      if(names.length!==required.length||required.some(name=>!names.includes(name)))fail('invalid_storage_scope');
      if(typeof scope.projectId!=='string'||!/^[a-z][a-z0-9-]{3,62}$/.test(scope.projectId)||typeof scope.uid!=='string'||!scope.uid||scope.uid.length>128||/[\u0000-\u001f\u007f]/.test(scope.uid)||typeof scope.module!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(scope.module)||!Number.isSafeInteger(scope.schemaVersion)||scope.schemaVersion<1)fail('invalid_storage_scope');
      if(typeof scope.databaseURL!=='string')fail('invalid_storage_scope');
      const url=new URL(scope.databaseURL);
      if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname)||!/(^|\.)(firebaseio\.com|firebasedatabase\.app)$/.test(url.hostname))fail('invalid_storage_scope');
      return encodeURIComponent(JSON.stringify([scope.projectId,url.origin,scope.uid,scope.module,scope.schemaVersion]));
    }catch{fail('invalid_storage_scope');}
  }
  function create(options){
    let names,scope,storage,isCurrent;
    try{
      names=fields(options);
      if(names.length!==3||!['scope','storage','isCurrent'].every(name=>names.includes(name)))fail('invalid_storage_options');
      scope=binding(options.scope);storage=options.storage;isCurrent=options.isCurrent;
      if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function'||typeof storage.removeItem!=='function'||typeof storage.key!=='function'||typeof isCurrent!=='function')fail('invalid_storage_options');
    }catch(error){fail(error&&error.message==='invalid_storage_scope'?'invalid_storage_scope':'invalid_storage_options');}
    const prefix=PREFIX+scope+':cache:',dbName=PREFIX+scope+':journals';
    let inactive=false;const durable=new Set();
    function invalidate(){
      inactive=true;
      // Existing committed/queued writes belong to the OLD immutable scope.
      // Drain them privately; do not expose or delete their recoverable data.
      return Promise.allSettled([...durable].map(handle=>handle.dispose()));
    }
    function guard(){
      let current=false;
      try{current=!inactive&&isCurrent()===true;}catch{}
      if(!current){void invalidate();fail('storage_inactive');}
    }
    function access(fn){guard();let value;try{value=fn();}catch{guard();fail('storage_unavailable');}guard();return value;}
    function logical(value){if(!keyName(value))fail('invalid_storage_key');return value;}
    function count(){const value=storage.length;if(!Number.isSafeInteger(value)||value<0||value>MAX_KEYS)fail('storage_unavailable');return value;}
    function scopedKeys(){
      const out=[];
      for(let i=0,total=count();i<total;i++){
        guard();const key=storage.key(i);
        if(typeof key==='string'&&key.startsWith(prefix)&&keyName(key.slice(prefix.length)))out.push(key.slice(prefix.length));
      }
      return [...new Set(out)].sort();
    }
    const adapter={
      getItem(key){guard();key=logical(key);return access(()=>{const value=storage.getItem(prefix+key);if(value!==null&&typeof value!=='string')fail('storage_unavailable');return value;});},
      setItem(key,value){guard();key=logical(key);if(typeof value!=='string')fail('invalid_storage_value');return access(()=>storage.setItem(prefix+key,value));},
      removeItem(key){guard();key=logical(key);return access(()=>storage.removeItem(prefix+key));},
      key(index){guard();if(!Number.isSafeInteger(index)||index<0)return null;return access(()=>scopedKeys()[index]||null);},
      get length(){return access(()=>scopedKeys().length);},
      invalidate,
      legacyStatus(options){
        guard();let keys,prefixes;
        try{
          const names=fields(options);
          if(names.some(name=>!['keys','prefixes'].includes(name)))fail('invalid_storage_options');
          keys=strings(options.keys===undefined?[]:options.keys);prefixes=strings(options.prefixes===undefined?[]:options.prefixes);
        }catch{fail('invalid_storage_options');}
        return access(()=>{
          let found=0;
          for(let i=0,total=count();i<total;i++){
            guard();const key=storage.key(i);
            // Other accounts' namespaced records are not legacy, and must not
            // appear in counts offered to an unrelated signed-in partner.
            if(typeof key==='string'&&!key.startsWith(PREFIX)&&(keys.includes(key)||prefixes.some(prefix=>key.startsWith(prefix))))found++;
          }
          return Object.freeze({present:found>0,count:found});
        });
      },
      async openJournals(options){
        guard();let keys,api,onChange,indexedDB;
        try{
          const names=fields(options);
          if(names.some(name=>!['keys','indexedDB','appSyncStorage','onChange'].includes(name)))fail('invalid_storage_options');
          keys=strings(options.keys);if(!keys.length)fail('invalid_storage_options');
          indexedDB=options.indexedDB;api=options.appSyncStorage||(root&&root.AppSyncStorage);onChange=options.onChange;
          if(!api||typeof api.open!=='function'||onChange!==undefined&&typeof onChange!=='function')fail('invalid_storage_options');
        }catch{fail('invalid_storage_options');}
        let raw;
        try{raw=await api.open({storage:adapter,indexedDB,keys,dbName,onChange:()=>{try{guard();if(onChange)onChange();}catch{}}});}
        catch{guard();fail('storage_unavailable');}
        let disposed=false,closing;
        const handle={dispose(){
          disposed=true;
          return closing||(closing=(async()=>{
            try{if(raw&&typeof raw.whenIdle==='function')await raw.whenIdle();}catch{}
            finally{try{if(raw&&typeof raw.close==='function')raw.close();}catch{}durable.delete(handle);}
          })());
        }};
        durable.add(handle);
        function live(){guard();if(disposed)fail('storage_inactive');}
        function invoke(fn){live();let result;try{result=fn();}catch{live();fail('storage_unavailable');}live();return result;}
        async function awaited(fn){live();try{await fn();}catch{live();fail('storage_unavailable');}live();}
        const wrapper={
          getItem(key){live();key=logical(key);return invoke(()=>{const value=raw.getItem(key);if(value!==null&&typeof value!=='string')fail('storage_unavailable');return value;});},
          setItem(key,value){live();key=logical(key);if(typeof value!=='string')fail('invalid_storage_value');return invoke(()=>raw.setItem(key,value));},
          removeItem(key){live();key=logical(key);return invoke(()=>raw.removeItem(key));},
          key(index){live();if(!Number.isSafeInteger(index)||index<0)return null;return invoke(()=>raw.key(index));},
          get length(){return invoke(()=>raw.length);},
          status(){return invoke(()=>{const state=raw.status();return Object.freeze({pending:state.pending===true,error:state.error?'storage_unavailable':''});});},
          async whenIdle(){await awaited(()=>raw.whenIdle());},
          async refresh(){await awaited(()=>raw.refresh());return wrapper;},
          close(){return handle.dispose();}
        };
        // No exportState passthrough: an owner recovery/export UI is a separate
        // reviewed integration, never an implicit legacy export for a partner.
        try{live();}catch(error){void handle.dispose();throw error;}
        return Object.freeze(wrapper);
      }
    };
    guard();return Object.freeze(adapter);
  }
  return Object.freeze({create});
});
