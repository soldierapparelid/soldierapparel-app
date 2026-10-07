/* SOURCE OFF. Google Auth gates the reviewed legacy owner UI. Database access
 * is exclusively the owner business RPC facade; original scripts never run
 * before a verified owner read. A separate frame is destroyed on Auth change. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else {
    Object.defineProperty(root,'SoldierOwnerLegacyBootstrapAPI',{value:api});
    const configuration=/* SOLDIER_OWNER_REVIEWED_CONFIGURATION */Object.freeze({enabled:false,photosEnabled:false,projectId:'',databaseURL:'',tenantId:'',deploymentURL:'',apiKey:'',authDomain:''});
    const childHTML=/* SOLDIER_OWNER_REVIEWED_CHILD */'';
    Object.defineProperty(root,'SoldierAppsScriptOwnerLegacyBootstrap',{value:api.createBootstrap({
      getConfiguration:()=>configuration,getChildHTML:()=>childHTML,getScriptRun:()=>root.google?.script?.run,
      sdkLoader:async()=>{
        const [app,auth]=await Promise.all([import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js')]);
        return {SDK_VERSION:app.SDK_VERSION,initializeApp:app.initializeApp,getApps:app.getApps,getAuth:auth.getAuth,setPersistence:auth.setPersistence,browserSessionPersistence:auth.browserSessionPersistence,onAuthStateChanged:auth.onAuthStateChanged,signInWithPopup:auth.signInWithPopup,GoogleAuthProvider:auth.GoogleAuthProvider,signOut:auth.signOut};
      },
      photoSDKLoader:async()=>{
        const database=await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js');
        return Object.freeze({ref:database.ref,get:database.get,onValue:database.onValue,runTransaction:database.runTransaction,getDatabase:database.getDatabase});
      }
    })});
  }
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const DEFAULT_CONFIGURATION=Object.freeze({enabled:false,photosEnabled:false,projectId:'',databaseURL:'',tenantId:'',deploymentURL:'',apiKey:'',authDomain:''});
  const MODULES=Object.freeze(['potong','stok','gaji','hpp','pembelian','laporan','nota','retur','jahit']);
  const PHOTO_MODULES=Object.freeze(['potong','stok','hpp','pembelian','laporan','jahit']);
  const KEYS=Object.keys(DEFAULT_CONFIGURATION),APP_NAME='soldier-owner-legacy-auth-v1';
  const reject=error=>Object.freeze({ok:false,error});
  const safe=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
  const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return d?.enumerable&&Object.hasOwn(d,'value');});
  function configuration(raw){
    if(!exact(raw,KEYS)||raw.enabled!==true||typeof raw.photosEnabled!=='boolean'||KEYS.slice(2).some(k=>typeof raw[k]!=='string'))throw Error('unavailable');
    if(!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(raw.projectId)||!safe(raw.tenantId)||raw.authDomain!==raw.projectId+'.firebaseapp.com'||!/^[A-Za-z0-9_-]{20,128}$/.test(raw.apiKey)||!/^https:\/\/([a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app)$/.test(raw.databaseURL)||!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/(?:exec|dev)$/.test(raw.deploymentURL))throw Error('unavailable');
    return Object.freeze({...raw});
  }
  function google(user){return !!(user&&safe(user.uid)&&user.emailVerified===true&&Array.isArray(user.providerData)&&user.providerData.some(p=>p?.providerId==='google.com')&&typeof user.getIdToken==='function');}
  function createBootstrap(dependencies={}){
    let started,captured;
    function start(args){
      let source,fixed,child,runner,runSuccess,runFailure;
      try{
        if(typeof dependencies.getConfiguration!=='function')throw Error();source=dependencies.getConfiguration();
        const enabled=source&&Object.getOwnPropertyDescriptor(source,'enabled');if(!enabled||!Object.hasOwn(enabled,'value')||enabled.value!==true)return Promise.resolve(reject('service_disabled'));
        fixed=configuration(source);if(!exact(args,['document','host'])||!args.document||typeof args.document.createElement!=='function'||args.host?.ownerDocument!==args.document||typeof args.host.replaceChildren!=='function')throw Error();
        if(started){if(args.document!==captured.document||args.host!==captured.host)throw Error();return started;}
        if(typeof dependencies.getChildHTML!=='function'||typeof dependencies.getScriptRun!=='function'||typeof dependencies.sdkLoader!=='function')throw Error();
        child=dependencies.getChildHTML();if(typeof child!=='string'||child.length>3*1024*1024||!child.startsWith('<!doctype html>'))throw Error();
        runner=dependencies.getScriptRun();runSuccess=runner?.withSuccessHandler;runFailure=runner?.withFailureHandler;if(typeof runSuccess!=='function'||typeof runFailure!=='function')throw Error();
      }catch{return Promise.resolve(reject('unavailable'));}
      captured=Object.freeze({...args});const {document,host}=captured;
      let terminal=false,boundUser=null,sdk,app,auth,authOff,frame,capability,login,status,logout,loginHandler,logoutHandler,settleStart,photoSDKPromise;
      const listeners=new Set();started=new Promise(resolve=>{settleStart=resolve;});
      const settle=value=>{if(settleStart){const done=settleStart;settleStart=null;done(value);}};
      function sources(){try{return dependencies.getConfiguration()===source&&exact(source,KEYS)&&KEYS.every(k=>Object.getOwnPropertyDescriptor(source,k).value===fixed[k])&&dependencies.getChildHTML()===child&&dependencies.getScriptRun()===runner&&runner.withSuccessHandler===runSuccess&&runner.withFailureHandler===runFailure;}catch{return false;}}
      function appBound(){try{return app?.name===APP_NAME&&auth?.app===app&&['projectId','databaseURL','apiKey','authDomain'].every(k=>app.options[k]===fixed[k]);}catch{return false;}}
      function current(){return !terminal&&sources()&&appBound()&&boundUser!==null&&auth.currentUser===boundUser&&google(boundUser);}
      function stop(code='access_denied'){
        if(terminal)return;terminal=true;
        for(const callback of [...listeners])try{callback(null);}catch{}listeners.clear();
        try{frame?.remove();}catch{}frame=null;capability=null;try{authOff?.();}catch{}authOff=null;
        try{login?.removeEventListener('click',loginHandler);logout?.removeEventListener('click',logoutHandler);}catch{}
        const text=document.createElement('p');text.textContent=code==='unavailable'?'Sambungan owner belum siap. Draf perangkat tetap disimpan.':'Sesi atau izin owner berakhir. Masuk kembali; draf perangkat tetap disimpan.';
        const reload=document.createElement('a');reload.textContent='Muat ulang';reload.href=fixed.deploymentURL+'?division=owner';reload.target='_top';reload.rel='noopener noreferrer';host.replaceChildren(text,reload);settle(reject(code));
      }
      function mount(user){
        if(terminal||boundUser!==null)return;boundUser=user;if(!current()){stop();return;}
        logout=document.createElement('button');logout.textContent='Keluar';logout.type='button';logoutHandler=()=>{const selected=auth;stop();try{Promise.resolve(sdk.signOut(selected)).catch(()=>{});}catch{}};logout.addEventListener('click',logoutHandler);
        frame=document.createElement('iframe');frame.title='Aplikasi owner Soldier';frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-modals allow-downloads allow-popups allow-top-navigation-by-user-activation');frame.style.cssText='width:100%;height:90vh;height:calc(100dvh - 112px);min-height:360px;border:0;background:#101a1f';
        status.textContent='Memeriksa akses owner dan data pusat…';host.replaceChildren(logout,status,frame);
        capability=Object.freeze({configurationJSON:JSON.stringify(fixed),user:boundUser,auth,getCurrentUser:()=>current()?boundUser:null,
          subscribeAuth:callback=>{if(!current()||typeof callback!=='function')throw Error('access_denied');listeners.add(callback);return ()=>listeners.delete(callback);},
          googleScriptRun:runner,isCurrent:current,
          subscribeRevision:(onRevision,onError)=>{
            if(!current()||typeof onRevision!=='function'||typeof onError!=='function')throw Error('unavailable');
            let closed=false,off=null;
            if(!photoSDKPromise)photoSDKPromise=Promise.resolve().then(()=>dependencies.photoSDKLoader());
            photoSDKPromise.then(native=>{
              if(closed||!current())return;
              const database=native.getDatabase(app);if(database?.app!==app)throw Error('unavailable');
              // This leaf contains only a sequence number. No record or grant
              // is read by the browser; Rules check the same-CAS reader header.
              off=native.onValue(native.ref(database,'soldierProtectedStorageV1/working/revision'),snapshot=>{
                if(!closed&&current())onRevision(snapshot.val());
              },e=>{if(!closed&&current())onError(/permission.denied/i.test(String(e?.code||''))?'access_denied':'unavailable');});
              if(closed)off();
            }).catch(()=>{if(!closed&&current())onError('unavailable');});
            return()=>{closed=true;try{off?.();}catch{}off=null;};
          },
          loadPhotoSDK:async childWindow=>{
            if(!fixed.photosEnabled||!current()||!frame||childWindow!==frame.contentWindow||typeof dependencies.photoSDKLoader!=='function')throw Error('photos_unavailable');
            if(!photoSDKPromise)photoSDKPromise=Promise.resolve().then(()=>dependencies.photoSDKLoader());
            const native=await photoSDKPromise;
            if(!current()||!frame||childWindow!==frame.contentWindow||!native||['ref','get','onValue','runTransaction','getDatabase'].some(k=>typeof native[k]!=='function'))throw Error('photos_unavailable');
            const database=native.getDatabase(app);if(!current()||database?.app!==app)throw Error('photos_unavailable');
            const refs=new WeakSet(),assert=reference=>{if(!current()||!frame||childWindow!==frame.contentWindow||database.app!==app||reference!==undefined&&!refs.has(reference))throw Error('photos_unavailable');};
            // Native SDK values are in this parent realm. Fixed envelopes cross
            // the iframe boundary as JSON scalars, then each realm decodes its
            // own plain objects; this preserves the strict client DTO checks.
            const scalar=value=>{const text=JSON.stringify(value);if(typeof text!=='string'||text.length>6*1024*1024||/[^\x20-\x7e]/.test(text))throw Error('photos_unavailable');return text;};
            const snapshot=raw=>{const text=scalar(raw.val());return Object.freeze({val:()=>text});};
            const gateway=Object.freeze({
              getDatabase:which=>{assert();if(which!==app)throw Error('photos_unavailable');return database;},
              ref:(which,path)=>{assert();if(which!==database||path!=='soldierProtectedStorageV1/photos')throw Error('photos_unavailable');const reference=native.ref(database,path);refs.add(reference);return reference;},
              get:async reference=>{assert(reference);const raw=await native.get(reference);assert(reference);return snapshot(raw);},
              onValue:(reference,callback,failed)=>{assert(reference);return native.onValue(reference,raw=>{try{assert(reference);callback(snapshot(raw));}catch(e){if(typeof failed==='function')failed(e);}},failed);},
              runTransaction:async(reference,updater,settings)=>{assert(reference);const d=settings&&Object.getOwnPropertyDescriptor(settings,'applyLocally');if(typeof updater!=='function'||Reflect.ownKeys(settings||{}).length!==1||!d?.enumerable||!Object.hasOwn(d,'value')||d.value!==false)throw Error('photos_unavailable');const result=await native.runTransaction(reference,raw=>{assert(reference);const proposed=updater(scalar(raw));return proposed===undefined?undefined:JSON.parse(scalar(JSON.parse(proposed)));},{applyLocally:false});assert(reference);return Object.freeze({committed:result.committed,snapshot:snapshot(result.snapshot)});}
            });
            return Object.freeze({app,auth,db:database,sdk:gateway});
          },
          onReady:()=>{if(!current()){stop();return;}status.textContent='Owner terhubung';settle(Object.freeze({ok:true,dispose:()=>stop()}));},onClear:()=>stop()
        });
        const target=document.defaultView;if(!target||Object.hasOwn(target,'SoldierOwnerLegacyHost')){stop('unavailable');return;}
        Object.defineProperty(target,'SoldierOwnerLegacyHost',{value:Object.freeze({take:childWindow=>{if(!current()||!frame||childWindow!==frame.contentWindow)return null;return capability;}}),writable:false,configurable:false});
        // Only Auth-valid owners can obtain this capability. Original scripts
        // remain inert inside the child until its server owner read succeeds.
        frame.srcdoc=child;
      }
      try{
        const title=document.createElement('h1');title.textContent='Masuk ke Soldier';status=document.createElement('p');status.textContent='Memeriksa login Google…';login=document.createElement('button');login.type='button';login.textContent='Masuk dengan Google';login.disabled=true;host.replaceChildren(title,status,login);
      }catch{stop('unavailable');return started;}
      (async()=>{try{
        sdk=await dependencies.sdkLoader();if(terminal||!sources()||sdk?.SDK_VERSION!=='10.12.2'||['initializeApp','getApps','getAuth','setPersistence','onAuthStateChanged','signInWithPopup','GoogleAuthProvider','signOut'].some(k=>typeof sdk[k]!=='function')||!sdk.browserSessionPersistence)throw Error();
        const apps=sdk.getApps();if(!Array.isArray(apps))throw Error();const owned=apps.filter(a=>a?.name===APP_NAME);if(owned.length>1)throw Error();app=owned[0]||sdk.initializeApp({projectId:fixed.projectId,databaseURL:fixed.databaseURL,apiKey:fixed.apiKey,authDomain:fixed.authDomain},APP_NAME);auth=sdk.getAuth(app);if(!appBound())throw Error();await sdk.setPersistence(auth,sdk.browserSessionPersistence);if(terminal||!sources()||!appBound())throw Error();
        let signing=false;loginHandler=()=>{if(terminal||boundUser!==null||signing)return;if(!sources()||!appBound()){stop();return;}signing=true;login.disabled=true;try{Promise.resolve(sdk.signInWithPopup(auth,new sdk.GoogleAuthProvider())).catch(()=>{if(!terminal)status.textContent='Login belum selesai. Coba kembali.';}).finally(()=>{signing=false;if(!terminal&&boundUser===null)login.disabled=false;});}catch{signing=false;login.disabled=false;}};login.addEventListener('click',loginHandler);login.disabled=false;
        const off=sdk.onAuthStateChanged(auth,user=>{if(terminal)return;if(!sources()||!appBound()){stop();return;}if(boundUser!==null){if(user!==boundUser||!current()){stop();return;}for(const callback of [...listeners])try{callback(user);}catch{stop('unavailable');}return;}if(user===auth.currentUser&&google(user))mount(user);else status.textContent='Gunakan akun Google owner yang diizinkan.';},()=>stop('unavailable'));
        if(typeof off!=='function')throw Error();authOff=off;if(terminal)off();
      }catch{stop('unavailable');}})();return started;
    }
    return Object.freeze({start});
  }
  // The business and owner photo channels never receive one another's native
  // references. Whole production-parent edits are classified before either
  // write; a compound edit is held rather than partly committed.
  function createRoutedOwnerFacade({business,bridge,photos,codec,isCurrent}){
    if(business?.ready!==true||!codec||typeof codec.copy!=='function'||typeof codec.same!=='function'||typeof isCurrent!=='function')throw Error('owner_legacy_unavailable');
    const PHOTO_PATHS=['soldier/produksi/images','soldier/productionPhotos'],refs=new WeakMap(),stops=new Set();let inactive=false,online=true;
    const methods=Object.fromEntries(['getSnapshot','refresh','retry','subscribe','dispose','publishPhotos'].map(k=>[k,photos?.[k]]));
    const clone=value=>codec.copy(value,8*1024*1024),bad=(code,message)=>{const e=Error(message||'Pilihan penyimpanan tidak didukung. Draf tetap disimpan.');e.code=code;return e;};
    function current(){try{return !inactive&&isCurrent()===true&&business.ready===true&&bridge.getSnapshot().phase==='ready'&&(!photos||Object.keys(methods).every(k=>photos[k]===methods[k]));}catch{return false;}}
    function assert(){if(!current())throw bad('access_denied','Sesi owner berubah. Draf tetap disimpan.');if(!online)throw bad('unavailable');}
    function photoState(){assert();const s=photos?.getSnapshot();if(!photos||photos.ready!==true||s?.phase!=='ready'||!s.images||typeof s.images.present!=='boolean'||!Number.isSafeInteger(s.revision)||typeof s.dataDigest!=='string')throw bad('unavailable','Foto pusat belum tersedia; draf tetap disimpan.');return s;}
    function parentSnapshot(raw){const state=photoState(),out=clone(raw);if(!out||typeof out!=='object'||Array.isArray(out))throw bad('invalid_request');if(state.images.present)out.images=clone(state.images.value);else delete out.images;return Object.freeze({key:'produksi',val:()=>clone(out),exists:()=>true});}
    function reference(database,path){assert();if(database!==business.db)throw bad('invalid_request');const photo=typeof path==='string'&&PHOTO_PATHS.some(p=>path===p||path.startsWith(p+'/'));const owner=photo?photos?.sdk:business.sdk;if(!owner||typeof owner.ref!=='function')throw bad('unavailable','Foto belum tersedia melalui layanan terlindungi. Data foto lama tetap disimpan.');if(photo)photoState();const inner=owner.ref(database,path),r=Object.freeze({});refs.set(r,{path,owner,inner});return r;}
    function node(r){assert();if(!r||!refs.has(r))throw bad('invalid_request');return refs.get(r);}
    async function get(r){const n=node(r),snap=await n.owner.get(n.inner);assert();return n.path==='soldier/produksi'&&photos?parentSnapshot(snap.val()):snap;}
    function onValue(r,callback,failed,options){const n=node(r);if(typeof callback!=='function'||failed!==undefined&&typeof failed!=='function'||options!==undefined)throw bad('invalid_request');let stopped=false,businessValue,off,photoOff;const emit=()=>{if(stopped||!current()||!online||businessValue===undefined)return;try{callback(parentSnapshot(businessValue));}catch(e){if(failed)failed(e);}};if(n.path==='soldier/produksi'&&photos){off=business.sdk.onValue(n.inner,s=>{businessValue=s.val();emit();},failed);photoOff=photos.subscribe(emit);}else off=n.owner.onValue(n.inner,s=>{if(!stopped&&current()&&online)callback(s);},failed);const stop=()=>{if(stopped)return;stopped=true;stops.delete(stop);try{off?.();}catch{}try{photoOff?.();}catch{}};stops.add(stop);return stop;}
    async function parentTransaction(n,updater,settings){
      assert();if(typeof updater!=='function'||!settings||typeof settings!=='object'||Array.isArray(settings)||![Object.prototype,null].includes(Object.getPrototypeOf(settings))||Reflect.ownKeys(settings).some(k=>k!=='applyLocally'||!Object.getOwnPropertyDescriptor(settings,k)?.enumerable||!Object.hasOwn(Object.getOwnPropertyDescriptor(settings,k),'value')||typeof Object.getOwnPropertyDescriptor(settings,k).value!=='boolean'))throw bad('invalid_request');const state=photoState(),bs=bridge.getSnapshot();
      if(bs.pending?.length||state.pending?.length)throw bad('pending_review','Konfirmasi perintah tersimpan sebelum menyimpan perubahan baru.');
      const before=clone(bs.view.business.soldier.produksi),sourceVersion=bs.view.sourceVersion,combined=parentSnapshot(before).val();let next=updater(clone(combined));
      if(next&&typeof next.then==='function')throw bad('invalid_request');assert();if(next===undefined)return Object.freeze({committed:false,snapshot:parentSnapshot(before)});
      next=clone(next);if(!next||typeof next!=='object'||Array.isArray(next))throw bad('invalid_request');
      const present=Object.hasOwn(next,'images'),value=present?next.images:null,photoBefore={present:state.images.present,...(state.images.present?{value:state.images.value}:{})},photoAfter={present,...(present?{value}:{})};
      // Legacy parent merges create an empty placeholder when no photo slot
      // existed. It carries no photo request and cannot erase an existing slot.
      const placeholder=!state.images.present&&present&&(value===null||value&&typeof value==='object'&&Reflect.ownKeys(value).length===0);
      const photoChanged=!placeholder&&!codec.same(photoBefore,photoAfter);delete next.images;const businessChanged=!codec.same(before,next);
      if(photoChanged&&businessChanged)throw bad('invalid_request','Perubahan barang dan foto sekaligus perlu dipisahkan. Draf tetap disimpan; simpan data barang dan foto satu per satu.');
      const fresh=photoState();if(fresh.revision!==state.revision||fresh.dataDigest!==state.dataDigest||bridge.getSnapshot().view.sourceVersion!==sourceVersion)throw bad('conflict','Data pusat berubah. Draf tetap disimpan; muat ulang untuk mencocokkan.');
      if(photoChanged){const imageRef=photos.sdk.ref(business.db,'soldier/produksi/images');const result=await photos.sdk.runTransaction(imageRef,currentValue=>{if(!codec.same(currentValue,state.images.present?state.images.value:null))throw bad('conflict');return present?value:null;},settings);assert();return Object.freeze({committed:result.committed,snapshot:parentSnapshot(before)});}
      const result=await business.sdk.runTransaction(n.inner,currentValue=>{if(!codec.same(currentValue,before)||bridge.getSnapshot().view.sourceVersion!==sourceVersion)throw bad('conflict');return next;},settings);assert();return Object.freeze({committed:result.committed,snapshot:parentSnapshot(result.snapshot.val())});
    }
    function runTransaction(r,updater,settings={applyLocally:false}){const n=node(r);if(n.path==='soldier/produksi'&&photos)return parentTransaction(n,updater,settings);return n.owner.runTransaction(n.inner,updater,settings);}
    const set=(r,value)=>{const n=node(r);return n.path==='soldier/produksi'&&photos?runTransaction(r,()=>value).then(v=>{if(!v.committed)throw bad('conflict');}):n.owner.set(n.inner,value);};
    const remove=r=>{const n=node(r);return n.path==='soldier/produksi'&&photos?set(r,null):n.owner.remove(n.inner);};
    function update(r,patch){const n=node(r);if(n.path==='soldier/produksi'&&photos)throw bad('invalid_request','Gunakan perubahan induk yang diperiksa; draf tetap disimpan.');return n.owner.update(n.inner,patch);}
    const sdk=Object.freeze({...business.sdk,ref:reference,get,onValue,runTransaction,set,update,remove,goOffline(db){if(db!==business.db)throw bad('invalid_request');online=false;business.sdk.goOffline(db);},goOnline(db){if(db!==business.db)throw bad('invalid_request');if(!current())throw bad('access_denied');business.sdk.goOnline(db);online=true;}});
    function compatDatabase(){assert();return Object.freeze({ref(path){const r=reference(business.db,path),list=new Map(),only=event=>{if(event!=='value')throw bad('invalid_request');};return Object.freeze({once(event){only(event);return get(r);},on(event,callback,failed){only(event);list.get(callback)?.();list.set(callback,onValue(r,callback,failed));return callback;},off(event,callback){only(event);if(callback){list.get(callback)?.();list.delete(callback);}else{for(const stop of list.values())stop();list.clear();}},async transaction(fn,complete,applyLocally=true){try{const result=await runTransaction(r,fn,{applyLocally});complete?.(null,result.committed,result.snapshot);return result;}catch(e){complete?.(e,false,null);throw e;}},set:value=>set(r,value),update:value=>update(r,value),remove:()=>remove(r),push(){throw bad('invalid_request');}});}});}
    return Object.freeze({ready:true,app:business.app,db:business.db,sdk,compatDatabase,refresh:business.refresh,dispose(){if(inactive)return;inactive=true;for(const stop of [...stops])stop();try{photos?.dispose();}catch{}business.dispose();}});
  }
  function createLegacyAccess({configuration:raw,capability,bridge,facade,photos}){
    const fixed=configuration(raw),cleanups=new Set();let disposed=false;
    const profile=Object.freeze({active:true,owner:true,workerId:null,modules:Object.freeze(Object.fromEntries(MODULES.map(k=>[k,true])))});
    function current(){try{return !disposed&&capability.isCurrent()&&capability.getCurrentUser()===capability.user&&google(capability.user)&&bridge.getSnapshot()?.view?.binding?.uid===capability.user.uid&&bridge.getSnapshot().view.binding.division==='owner'&&facade.ready===true;}catch{return false;}}
    function config(value){if(!current()||!value||value.apiKey!==fixed.apiKey||value.projectId!==fixed.projectId||(value.databaseURL||value.dbUrl)!==fixed.databaseURL)throw Error('Koneksi tetap mengikuti akun owner.');return Object.freeze({projectId:fixed.projectId,databaseURL:fixed.databaseURL,apiKey:fixed.apiKey,authDomain:fixed.authDomain});}
    const access=Object.freeze({connect:async(value,moduleName)=>{config(value);if(!MODULES.includes(moduleName))throw Error('Modul belum tersedia.');return Object.freeze({app:facade.app,db:facade.db,sdk:facade.sdk,auth:capability.auth,uid:capability.user.uid,profile,authorized:true,registerCleanup:callback=>{if(!current()||typeof callback!=='function')throw Error('Sesi berakhir.');cleanups.add(callback);return ()=>cleanups.delete(callback);}});},
      compatDatabase:(db,sdk)=>{if(!current()||db!==facade.db||sdk!==facade.sdk)throw Error('Sesi berakhir.');return facade.compatDatabase();},
      publishPhotos:async value=>{if(!current()||!photos||photos.ready!==true||typeof photos.publishPhotos!=='function')throw Error('Foto belum tersedia melalui layanan terlindungi. Data foto lama tetap disimpan.');await photos.publishPhotos(value);if(!current())throw Error('Sesi owner berubah.');}
    });
    return Object.freeze({access,policy:Object.freeze({config,allowed:(p,moduleName)=>current()&&p===profile&&(MODULES.includes(moduleName)||moduleName==='menu'),modules:MODULES}),current,dispose:()=>{if(disposed)return;disposed=true;for(const callback of cleanups)try{callback();}catch{}cleanups.clear();}});
  }
  async function startChild(args){
    let bridge,facade,business,photos,access,authOff,stateOff,photoOff,recovery,message,retry,latestState,latestPhotos,disposed=false,revisionSync,syncState,refreshButton,syncMessage,dirty=false,writeBase=null,inputHandler,visibilityHandler;
    const fail=()=>{throw Error('owner_legacy_unavailable');};
    let document,host,program,capability,fixed,root;
    function current(){try{return !disposed&&capability.isCurrent()&&capability.getCurrentUser()===capability.user&&google(capability.user);}catch{return false;}}
    function clear(){if(disposed)return;disposed=true;try{revisionSync?.dispose();}catch{}try{document?.removeEventListener?.('input',inputHandler,true);document?.removeEventListener?.('visibilitychange',visibilityHandler);}catch{}try{authOff?.();}catch{}try{stateOff?.();}catch{}try{photoOff?.();}catch{}try{access?.dispose();}catch{}try{facade?.dispose();}catch{}try{photos?.dispose();}catch{}try{business?.dispose();}catch{}try{bridge?.dispose();}catch{}try{document.body.replaceChildren();const p=document.createElement('p');p.textContent='Sesi owner berakhir. Draf perangkat tetap disimpan.';document.body.append(p);}catch{}try{capability.onClear();}catch{}}
    function canRefresh(){return current()&&!dirty&&document.visibilityState!=='hidden'&&!latestState?.busy&&!latestPhotos?.busy&&!latestState?.pending?.length&&!latestPhotos?.pending?.length;}
    function renderSync(){
      if(!syncMessage||disposed)return;
      syncMessage.textContent=syncState?.busy?'Memperbarui data pusat…':syncState?.error?'Pembaruan otomatis terputus. Tekan Perbarui data untuk mencoba.':syncState?.pending&&dirty?'Ada data baru. Selesaikan isian Anda, lalu tekan Perbarui data.':syncState?.pending?'Ada pembaruan dari data pusat…':'Data tersambung ke pusat.';
      refreshButton.disabled=!!latestState?.busy||!!latestPhotos?.busy||!!syncState?.busy||!!latestState?.pending?.length||!!latestPhotos?.pending?.length;
    }
    function renderRecovery(state){
      if(state?.busy&&writeBase===null)writeBase=state.view?.sourceVersion;
      if(!state?.busy&&writeBase!==null){if(!state?.error&&state?.view?.sourceVersion!==writeBase)dirty=false;writeBase=null;}
      latestState=state;if(!recovery||disposed)return;
      const pending=Array.isArray(state?.pending)&&state.pending.length>0||Array.isArray(latestPhotos?.pending)&&latestPhotos.pending.length>0;
      const errors={rate_limited:'Batas layanan sementara tercapai. Coba lagi nanti.',capacity_limit:'Data melampaui batas layanan. Draf tetap disimpan.',result_unknown:'Hasil simpan belum terkonfirmasi.',conflict:'Data pusat berubah; draf tetap disimpan.',pending_review:'Periksa perintah tersimpan sebelum menyimpan perubahan baru.',unavailable:'Sambungan pusat belum tersedia.'};
      const problem=state?.error||latestPhotos?.error;message.textContent=pending?'Ada perintah simpan yang perlu dikonfirmasi. Draf tetap disimpan.':problem?errors[problem]||'Penyimpanan perlu diperiksa; draf tetap disimpan.':fixed&&['nota','retur'].includes(program?.module)?'Catatan halaman ini tersimpan pada perangkat ini; gunakan unduh cadangan.':photos?.ready===true?'Penyimpanan owner dan foto pusat terhubung. Perubahan barang dan foto disimpan satu per satu.':PHOTO_MODULES.includes(program?.module)?'Penyimpanan owner terlindungi. Foto pusat belum diaktifkan.':'Penyimpanan owner terlindungi.';
      retry.hidden=!pending;retry.disabled=!!state?.busy||!!latestPhotos?.busy;
      renderSync();revisionSync?.resume();
    }
    try{
      if(!exact(args,['document','host','program','capability']))fail();({document,host,program,capability}=args);root=document.defaultView;
      if(!root||host?.ownerDocument!==document||!exact(program,['module','head','body','scripts'])||!MODULES.includes(program.module)||typeof program.head!=='string'||typeof program.body!=='string'||!Array.isArray(program.scripts)||program.scripts.some(s=>typeof s!=='string')||!capability)fail();
      fixed=configuration(JSON.parse(capability.configurationJSON));if(!current())fail();
      const api=root.SoldierOwnerBusinessStorage,codec=root.SoldierOwnerBusinessCodec;
      if(typeof api?.createAppsScriptOwnerBusinessBridge!=='function'||typeof api?.createLegacyOwnerStorageFacade!=='function'||typeof codec?.normalizeOwnerBusinessView!=='function')fail();
      bridge=api.createAppsScriptOwnerBusinessBridge({enabled:true,user:capability.user,getCurrentUser:()=>current()?capability.user:null,subscribeAuth:capability.subscribeAuth,googleScriptRun:capability.googleScriptRun,deploymentURL:fixed.deploymentURL,projectId:fixed.projectId,databaseURL:fixed.databaseURL,tenantId:fixed.tenantId,indexedDB:root.indexedDB,newId:()=>root.crypto.randomUUID(),onState:state=>{if(!current()||state?.error==='access_denied')clear();else renderRecovery(state);}});
      if(!['nota','retur'].includes(program.module)&&typeof capability.subscribeRevision==='function'&&root.SoldierProductionRevisionSync){
        revisionSync=root.SoldierProductionRevisionSync.createRevisionSync({subscribe:capability.subscribeRevision,refresh:()=>bridge.refresh(),isCurrent:current,canRefresh,onStatus:state=>{syncState=state;if(state.error==='access_denied')clear();else renderSync();}});
      }
      const ready=await bridge.connect();if(!current()||ready?.ok!==true)fail();
      const snapshot=bridge.getSnapshot(),view=codec.normalizeOwnerBusinessView(snapshot.view);
      if(snapshot.phase!=='ready'||view.binding.uid!==capability.user.uid||view.binding.division!=='owner'||view.binding.workerId!==null||['projectId','databaseURL','tenantId'].some(k=>view.binding[k]!==fixed[k]))fail();
      business=api.createLegacyOwnerStorageFacade({enabled:true,bridge,configuration:{projectId:fixed.projectId,databaseURL:fixed.databaseURL,apiKey:fixed.apiKey,authDomain:fixed.authDomain}});if(business?.ready!==true)fail();
      if(fixed.photosEnabled&&PHOTO_MODULES.includes(program.module)){
        if(typeof capability.loadPhotoSDK!=='function'||typeof root.SoldierOwnerProductionPhotos?.createOwnerProductionPhotosClient!=='function')fail();
        const native=await capability.loadPhotoSDK(root);if(!current())fail();
        const decode=raw=>{if(typeof raw!=='string'||raw.length>6*1024*1024||/[^\x20-\x7e]/.test(raw))fail();return JSON.parse(raw);},snap=raw=>Object.freeze({val:()=>decode(raw.val())});
        const nativeSDK=Object.freeze({ref:(database,path)=>native.sdk.ref(database,path),getDatabase:app=>native.sdk.getDatabase(app),get:async reference=>snap(await native.sdk.get(reference)),onValue:(reference,callback,failed)=>native.sdk.onValue(reference,raw=>callback(snap(raw)),failed),runTransaction:async(reference,updater,settings)=>{const result=await native.sdk.runTransaction(reference,text=>{const proposed=updater(decode(text));return proposed===undefined?undefined:JSON.stringify(proposed);},settings);return Object.freeze({committed:result.committed,snapshot:snap(result.snapshot)});}});
        photos=root.SoldierOwnerProductionPhotos.createOwnerProductionPhotosClient({enabled:true,binding:view.binding,app:native.app,db:native.db,auth:native.auth,user:capability.user,sdk:nativeSDK,legacyDatabase:business.db,getCurrentUser:()=>current()?capability.user:null,subscribeAuth:capability.subscribeAuth,indexedDB:root.indexedDB,crypto:root.crypto,newId:()=>root.crypto.randomUUID(),onState:state=>{latestPhotos=state;if(!current()||state?.error==='access_denied')clear();else if(latestState)renderRecovery(latestState);}});
        const connected=await photos.connect();if(!current()||connected?.ok!==true||photos.ready!==true)fail();
      }
      facade=createRoutedOwnerFacade({business,bridge,photos,codec,isCurrent:current});access=createLegacyAccess({configuration:fixed,capability,bridge,facade,photos});
      Object.defineProperty(root,'__firebase',{value:facade.sdk,writable:false,configurable:false});Object.defineProperty(root,'SoldierAccess',{value:access.access});Object.defineProperty(root,'SoldierAccessPolicy',{value:access.policy});Object.defineProperty(root,'SoldierOwnerLegacyConfiguration',{value:fixed});Object.defineProperty(root,'SoldierOwnerLegacyInitialBusiness',{value:view.business});
      authOff=capability.subscribeAuth(()=>{if(!current())clear();});if(!current())fail();
      // Original markup has no scripts, network loaders or connection selectors.
      // Recreate only reviewed classic scripts; no eval/new Function is used.
      const parser=new root.DOMParser(),head=parser.parseFromString('<!doctype html><html><head>'+program.head+'</head><body></body></html>','text/html');
      for(const node of [...head.head.children])document.head.appendChild(document.importNode(node,true));
      recovery=document.createElement('section');recovery.id='soldier-owner-recovery';recovery.setAttribute('aria-live','polite');recovery.style.cssText='padding:12px;background:#142c25;color:#dce8e2;border:1px solid #3c6858';message=document.createElement('p');retry=document.createElement('button');retry.type='button';retry.textContent='Konfirmasi perintah tersimpan';retry.addEventListener('click',async()=>{const pending=latestState?.pending?.[0]||latestPhotos?.pending?.[0],target=latestState?.pending?.length?bridge:photos;if(!current()||!pending||retry.disabled)return;retry.disabled=true;try{await target.retry(pending.requestId);}catch{}finally{if(current())renderRecovery(bridge.getSnapshot());else clear();}});recovery.append(message,retry);document.body.append(recovery);stateOff=bridge.subscribe(renderRecovery);if(photos)photoOff=photos.subscribe(state=>{latestPhotos=state;renderRecovery(bridge.getSnapshot());});renderRecovery(bridge.getSnapshot());
      host.innerHTML=program.body;document.documentElement.removeAttribute('data-soldier-locked');
      for(const source of program.scripts){if(!current())fail();const script=document.createElement('script');script.textContent=source;document.body.appendChild(script);}
      for(const input of document.querySelectorAll('input[id*="ApiKey"],input[id*="DbUrl"],input[id*="ProjectId"],#st-apikey,#st-dburl,#st-projectid')){input.readOnly=true;input.disabled=true;}
      document.dispatchEvent(new root.Event('DOMContentLoaded'));
      if(root.appReady&&typeof root.appReady.then==='function'){const booted=await root.appReady;if(booted===false||root.appBootError)fail();}
      if(revisionSync){
        syncMessage=document.createElement('p');syncMessage.setAttribute('role','status');refreshButton=document.createElement('button');refreshButton.type='button';refreshButton.textContent='Perbarui data';refreshButton.style.cssText='min-height:44px;font-size:16px';
        refreshButton.addEventListener('click',async()=>{if(!current()||refreshButton.disabled)return;if(dirty&&typeof root.confirm==='function'&&!root.confirm('Muat data terbaru? Isian yang belum disimpan tetap perlu Anda periksa sebelum menyimpan.'))return;refreshButton.disabled=true;try{const result=await revisionSync.refreshNow();if(result?.ok)dirty=false;}finally{renderSync();revisionSync.resume();}});
        recovery.append(syncMessage,refreshButton);
        inputHandler=e=>{if(e.target&&/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName||'')){dirty=true;renderSync();}};visibilityHandler=()=>revisionSync.resume();document.addEventListener?.('input',inputHandler,true);document.addEventListener?.('visibilitychange',visibilityHandler);
        renderSync();revisionSync.ready();
      }
      if(!current())fail();capability.onReady();
      return Object.freeze({ok:true,dispose:clear});
    }catch{clear();return reject('unavailable');}
  }
  return Object.freeze({DEFAULT_CONFIGURATION,MODULES,PHOTO_MODULES,configuration,google,createBootstrap,createRoutedOwnerFacade,createLegacyAccess,startChild});
});
