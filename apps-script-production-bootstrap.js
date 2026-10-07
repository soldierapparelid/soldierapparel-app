/* SOURCE OFF. HtmlService login for the free, scoped production channels.
 * This page never opens the legacy scripts or reads RTDB from the browser. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else {
    // The offline page builder may replace only this reviewed public binding.
    const configuration=/* SOLDIER_REVIEWED_PUBLIC_CONFIGURATION */Object.freeze({enabled:false,projectId:'',databaseURL:'',tenantId:'',deploymentURL:'',apiKey:'',authDomain:''});
    Object.defineProperty(root,'SoldierAppsScriptProductionBootstrap',{value:api.createBootstrap({
      getConfiguration:()=>configuration,getScriptRun:()=>root.google?.script?.run,
      getPage:()=>root.SoldierLegacyLifecyclePage,getController:()=>root.SoldierLegacyLifecycleController,getBridge:()=>root.SoldierAppsScriptLifecycleBridge,
      getOwnerPage:()=>root.SoldierLegacyOwnerLifecyclePage,getOwnerBridge:()=>root.SoldierAppsScriptOwnerLifecycleBridge,
      getOwnerAccess:()=>root.SoldierOwnerAccessManagement,
      getRevisionSync:()=>root.SoldierProductionRevisionSync,
      sdkRevisionLoader:async()=>{
        const database=await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js');
        return {ref:database.ref,onValue:database.onValue,getDatabase:database.getDatabase};
      },
      newId:()=>root.crypto.randomUUID(),
      indexedDB:root.indexedDB,sdkLoader:async()=>{
        const [app,auth]=await Promise.all([import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js')]);
        return {SDK_VERSION:app.SDK_VERSION,initializeApp:app.initializeApp,getApps:app.getApps,getAuth:auth.getAuth,setPersistence:auth.setPersistence,browserSessionPersistence:auth.browserSessionPersistence,onAuthStateChanged:auth.onAuthStateChanged,signInWithPopup:auth.signInWithPopup,GoogleAuthProvider:auth.GoogleAuthProvider,signOut:auth.signOut};
      }
    }),enumerable:true,writable:false,configurable:false});
  }
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const DEFAULT_CONFIGURATION=Object.freeze({enabled:false,projectId:'',databaseURL:'',tenantId:'',deploymentURL:'',apiKey:'',authDomain:''});
  const KEYS=Object.keys(DEFAULT_CONFIGURATION),APP_NAME='soldier-apps-script-production-v1';
  const error=code=>Object.freeze({ok:false,error:code});
  const safe=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
  const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return d?.enumerable&&Object.hasOwn(d,'value');});
  function fixedConfiguration(v){
    if(!exact(v,KEYS)||v.enabled!==true||KEYS.slice(1).some(k=>typeof v[k]!=='string'))throw Error();
    if(!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(v.projectId)||!safe(v.tenantId)||v.authDomain!==v.projectId+'.firebaseapp.com'||!/^[A-Za-z0-9_-]{20,128}$/.test(v.apiKey)||!/^https:\/\/([a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app)$/.test(v.databaseURL)||!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/(?:exec|dev)$/.test(v.deploymentURL))throw Error();
    return Object.freeze({...v});
  }
  function createBootstrap(dependencies={}){
    let started,captured;
    function start(args){
      let configuration,fixed;
      try {
        if(typeof dependencies.getConfiguration!=='function')throw Error();
        configuration=dependencies.getConfiguration();const enabled=configuration&&typeof configuration==='object'?Object.getOwnPropertyDescriptor(configuration,'enabled'):null;
        if(!enabled||!Object.hasOwn(enabled,'value')||enabled.value!==true)return Promise.resolve(error('service_disabled'));
        fixed=fixedConfiguration(configuration);
        if(!exact(args,['module','document','host'])||!['owner','qc','jahit'].includes(args.module)||!args.document||typeof args.document.createElement!=='function'||!args.host||args.host.ownerDocument!==args.document||typeof args.host.replaceChildren!=='function'||typeof dependencies.sdkLoader!=='function'||typeof dependencies.getScriptRun!=='function')throw Error();
        if(started){if(!['module','document','host'].every(k=>args[k]===captured[k]))throw Error();return started;}
      }catch{return Promise.resolve(error('unavailable'));}
      captured=Object.freeze({...args});const {document,host,module}=captured;
      let terminal=false,boundUser=null,sdk,app,auth,authOff,page,bridge,runner,runnerFailure,runnerSuccess,pageAPI,controllerAPI,bridgeAPI,pageFactory,controllerFactory,bridgeFactory,login,status,loginHandler,logout,logoutHandler,resolveStart;
      let accessAPI,accessBridgeFactory,accessPageFactory,accessBridge,accessPage,accessButton,accessHandler,accessContainer,newIdFactory,accessOpening=false;
      let revisionSync=null,visibilityListener=null;
      const subscribers=new Set();started=new Promise(resolve=>{resolveStart=resolve;});
      function settle(r){if(resolveStart){const resolve=resolveStart;resolveStart=null;resolve(r);}}
      function source(){try{return dependencies.getConfiguration()===configuration&&exact(configuration,KEYS)&&KEYS.every(k=>Object.getOwnPropertyDescriptor(configuration,k).value===fixed[k]);}catch{return false;}}
      function appBound(){try{return app?.name===APP_NAME&&['projectId','databaseURL','apiKey','authDomain'].every(k=>app.options[k]===fixed[k])&&auth.app===app;}catch{return false;}}
      function google(user){return user&&safe(user.uid)&&user.emailVerified===true&&Array.isArray(user.providerData)&&user.providerData.some(p=>p?.providerId==='google.com')&&typeof user.getIdToken==='function';}
      function nativeBound(){try{return runner&&dependencies.getScriptRun()===runner&&runner.withFailureHandler===runnerFailure&&runner.withSuccessHandler===runnerSuccess;}catch{return false;}}
      function modulesBound(){try{return module==='owner'?dependencies.getOwnerPage()===pageAPI&&pageAPI.mountLegacyOwnerLifecyclePage===pageFactory&&dependencies.getOwnerBridge()===bridgeAPI&&bridgeAPI.createAppsScriptOwnerLifecycleBridge===bridgeFactory&&dependencies.getOwnerAccess()===accessAPI&&accessAPI.createAppsScriptOwnerAccessBridge===accessBridgeFactory&&accessAPI.mountOwnerAccessManagementPage===accessPageFactory&&dependencies.newId===newIdFactory:dependencies.getPage()===pageAPI&&pageAPI.createLegacyLifecyclePage===pageFactory&&dependencies.getController()===controllerAPI&&controllerAPI.createLegacyLifecycleController===controllerFactory&&dependencies.getBridge()===bridgeAPI&&bridgeAPI.createAppsScriptLifecycleBridge===bridgeFactory;}catch{return false;}}
      function current(){try{return !terminal&&source()&&appBound()&&nativeBound()&&modulesBound()&&boundUser!==null&&auth.currentUser===boundUser&&google(boundUser);}catch{return false;}}
      function line(text){const p=document.createElement('p');p.textContent=text;p.setAttribute('role','status');return p;}
      function stop(code='access_denied',show=true){
        if(terminal)return;terminal=true;
        try{revisionSync?.dispose();}catch{}revisionSync=null;try{if(visibilityListener)document.removeEventListener('visibilitychange',visibilityListener);}catch{}visibilityListener=null;
        try{accessPage?.dispose();}catch{}accessPage=null;try{accessBridge?.dispose();}catch{}accessBridge=null;
        try{page?.dispose();}catch{}page=null;try{bridge?.dispose();}catch{}bridge=null;
        try{authOff?.();}catch{}authOff=null;subscribers.clear();
        try{login?.removeEventListener('click',loginHandler);logout?.removeEventListener('click',logoutHandler);accessButton?.removeEventListener('click',accessHandler);host.replaceChildren();}catch{}
        if(show)try{
          const title=document.createElement('h1');title.textContent='Masuk kembali ke Soldier';
          const message=line(code==='unavailable'?'Sambungan belum tersedia. Muat ulang untuk mencoba lagi.':'Sesi atau izin akun sudah berakhir. Muat ulang lalu masuk dengan akun Google yang diizinkan.');message.id='soldier-script-terminal';
          const retained=line('Catatan yang menunggu tetap disimpan di perangkat ini.');
          // HtmlService cannot reconstruct its user iframe from location.reload.
          // Navigate the fixed web-app URL through an explicit user-click link.
          const reload=document.createElement('a');reload.id='soldier-script-reload';reload.textContent='Muat ulang';reload.href=fixed.deploymentURL+'?division='+module;reload.target='_top';reload.rel='noopener noreferrer';reload.hidden=false;
          host.replaceChildren(title,message,retained,reload);
          if(auth&&sdk&&typeof sdk.signOut==='function'){
            const ownedAuth=auth,choose=document.createElement('button');choose.type='button';choose.id='soldier-script-choose-account';choose.textContent='Keluar dan pilih akun';
            const finished=ok=>{reload.hidden=false;if(ok){message.textContent='Akun sudah keluar. Tekan Muat ulang, lalu masuk dengan akun Google yang diizinkan.';choose.textContent='Akun sudah keluar';}else{choose.disabled=false;message.textContent='Keluar belum berhasil. Tekan Keluar dan pilih akun untuk mencoba lagi.';}};
            choose.addEventListener('click',()=>{if(choose.disabled)return;choose.disabled=true;reload.hidden=true;try{Promise.resolve(sdk.signOut(ownedAuth)).then(()=>finished(true),()=>finished(false)).catch(()=>finished(false));}catch{finished(false);}});host.append(choose);
          }
        }catch{}
        settle(error(code));
      }
      function signOut(){if(terminal)return;const selectedAuth=auth;stop();try{Promise.resolve(sdk.signOut(selectedAuth)).catch(()=>{});}catch{}}
      function subscribeAuth(callback){if(!current()||typeof callback!=='function')throw Error();subscribers.add(callback);return ()=>subscribers.delete(callback);}
      function startRevisionSync(){
        if(module==='owner'||revisionSync||!current())return;
        // Injectable only for offline tests; the browser wrapper always supplies
        // both dependencies. This listener reads one version number, never data.
        if(typeof dependencies.getRevisionSync!=='function'&&typeof dependencies.sdkRevisionLoader!=='function')return;
        try{
          const api=dependencies.getRevisionSync(),factory=api?.createRevisionSync,loader=dependencies.sdkRevisionLoader;
          if(typeof factory!=='function'||typeof loader!=='function'||['canAutoRefresh','refresh','setRevisionStatus'].some(k=>typeof page[k]!=='function'))throw Error();
          const bound=()=>current()&&dependencies.getRevisionSync()===api&&api.createRevisionSync===factory&&dependencies.sdkRevisionLoader===loader;
          revisionSync=factory.call(api,{isCurrent:bound,canRefresh:()=>document.hidden!==true&&page.canAutoRefresh(),refresh:()=>page.refresh(),onStatus:state=>{if(current())page.setRevisionStatus(state);},subscribe:(onRevision,onError)=>{
            let cancelled=false,unsubscribe=null;
            (async()=>{try{
              const native=await loader();if(cancelled||!bound())return;
              const methods={ref:native?.ref,onValue:native?.onValue,getDatabase:native?.getDatabase};if(Object.values(methods).some(f=>typeof f!=='function'))throw Error();
              const database=methods.getDatabase.call(native,app);if(database?.app!==app||!appBound())throw Error();
              const reference=methods.ref.call(native,database,'soldierProtectedStorageV1/working/revision');if(reference?.database!==database)throw Error();
              const same=()=>!cancelled&&bound()&&database.app===app&&Object.keys(methods).every(k=>native[k]===methods[k]);
              unsubscribe=methods.onValue.call(native,reference,snapshot=>{if(!same())return;try{const value=snapshot.val();if(!Number.isSafeInteger(value)||value<0)throw Error();onRevision(value);}catch{onError('unavailable');}},error=>{if(!same())return;const code=error?.code==='PERMISSION_DENIED'||error?.code==='permission-denied'?'access_denied':'unavailable';onError(code);if(code==='access_denied')stop();});
              if(typeof unsubscribe!=='function')throw Error();if(cancelled||!bound()){unsubscribe();unsubscribe=null;}
            }catch{if(!cancelled&&current())onError('unavailable');}})();
            return()=>{if(cancelled)return;cancelled=true;try{unsubscribe?.();}catch{}unsubscribe=null;};
          }});
          if(!revisionSync||['ready','resume','dispose'].some(k=>typeof revisionSync[k]!=='function'))throw Error();
          if(typeof document.addEventListener==='function'&&typeof document.removeEventListener==='function'){visibilityListener=()=>{if(current())revisionSync?.resume();};document.addEventListener('visibilitychange',visibilityListener);}
        }catch{try{revisionSync?.dispose();}catch{}revisionSync=null;try{page.setRevisionStatus({pending:false,blocked:true,error:'unavailable',busy:false});}catch{}}
      }
      function createBridge(callbacks){
        if(!current()||bridge||!exact(callbacks,['onView','onFinance','onClear'])||Object.values(callbacks).some(v=>typeof v!=='function'))throw Error();
        bridge=bridgeFactory.call(bridgeAPI,{enabled:true,projectId:fixed.projectId,databaseURL:fixed.databaseURL,tenantId:fixed.tenantId,deploymentURL:fixed.deploymentURL,auth,indexedDB:dependencies.indexedDB,scriptRun:runner,subscribeAuth,isCurrent:current,
          onView:value=>{if(current())callbacks.onView(value);},onFinance:value=>{if(current())callbacks.onFinance(value);},onClear:code=>{try{callbacks.onClear(code);}finally{if(code!=='loading')stop(code==='unavailable'?'unavailable':'access_denied');}}
        });
        if(!current()){try{bridge.dispose();}catch{}throw Error();}return bridge;
      }
      async function openOwnerAccess(){
        if(module!=='owner'||terminal||accessOpening)return;if(!current()){stop();return;}
        accessOpening=true;accessButton.disabled=true;
        try{
          if(!accessBridge){
            accessBridge=accessBridgeFactory.call(accessAPI,{enabled:true,user:boundUser,getCurrentUser:()=>current()?auth.currentUser:null,subscribeAuth,googleScriptRun:runner,
              projectId:fixed.projectId,databaseURL:fixed.databaseURL,tenantId:fixed.tenantId,deploymentURL:fixed.deploymentURL,indexedDB:dependencies.indexedDB,newId:()=>{if(!current())throw Error();return newIdFactory();},
              onState:state=>{if(!current()){stop();return;}if(state?.error==='access_denied'){stop();return;}try{accessPage?.render(state);}catch{stop('unavailable');}}
            });
            if(!accessBridge||typeof accessBridge.connect!=='function'||typeof accessBridge.dispose!=='function'||!current())throw Error();
            accessPage=accessPageFactory.call(accessAPI,{enabled:true,document,container:accessContainer,controller:accessBridge});
            if(!accessPage||typeof accessPage.render!=='function'||typeof accessPage.dispose!=='function'||!current())throw Error();
          }
          const result=await accessBridge.connect();if(!current()){stop();return;}
          if(!result?.ok){if(result?.error==='access_denied'){stop();return;}accessPage.render({phase:'idle',error:'unavailable',busy:false,view:null,pending:[]});}
        }catch{if(!terminal)stop('unavailable');}
        finally{accessOpening=false;if(!terminal&&current())accessButton.disabled=false;}
      }
      async function mount(user){
        if(terminal||boundUser!==null)return;boundUser=user;
        try {
          if(module==='owner'){
            pageAPI=dependencies.getOwnerPage();bridgeAPI=dependencies.getOwnerBridge();pageFactory=pageAPI?.mountLegacyOwnerLifecyclePage;bridgeFactory=bridgeAPI?.createAppsScriptOwnerLifecycleBridge;
            accessAPI=dependencies.getOwnerAccess();accessBridgeFactory=accessAPI?.createAppsScriptOwnerAccessBridge;accessPageFactory=accessAPI?.mountOwnerAccessManagementPage;newIdFactory=dependencies.newId;
          }else{
            pageAPI=dependencies.getPage();controllerAPI=dependencies.getController();bridgeAPI=dependencies.getBridge();pageFactory=pageAPI?.createLegacyLifecyclePage;controllerFactory=controllerAPI?.createLegacyLifecycleController;bridgeFactory=bridgeAPI?.createAppsScriptLifecycleBridge;
          }
          if(typeof pageFactory!=='function'||typeof bridgeFactory!=='function'||module!=='owner'&&typeof controllerFactory!=='function'||module==='owner'&&(typeof accessBridgeFactory!=='function'||typeof accessPageFactory!=='function'||typeof newIdFactory!=='function')||!current())throw Error();
          login.removeEventListener('click',loginHandler);const form=document.createElement('section');form.id='soldier-script-bound-form';
          logout=document.createElement('button');logout.type='button';logout.id='soldier-script-logout';logout.textContent='Keluar';logoutHandler=signOut;logout.addEventListener('click',logoutHandler);host.replaceChildren(logout,form);
          const mounted=module==='owner'?pageFactory.call(pageAPI,{enabled:true,document,container:form,createBridge,isCurrent:current}):pageFactory.call(pageAPI,{enabled:true,rootElement:form,onSignOut:signOut,onAutoRefreshReady:()=>revisionSync?.resume(),createController:callbacks=>{
            if(!current()||!exact(callbacks,['onState'])||typeof callbacks.onState!=='function')throw Error();
            return controllerFactory.call(controllerAPI,{enabled:true,createBridge,isCurrent:current,onState:state=>{if(current())callbacks.onState(state);}});
          }});
          if(!mounted||typeof mounted.connect!=='function'||typeof mounted.dispose!=='function')throw Error();page=mounted;
          if(!current()){mounted.dispose();stop();return;}
          startRevisionSync();
          const ready=await mounted.connect();if(!current()){stop();return;}if(!ready?.ok){stop(ready?.error==='access_denied'?'access_denied':'unavailable');return;}
          if(revisionSync)revisionSync.ready();
          if(module==='owner'){
            accessContainer=document.createElement('section');accessContainer.id='soldier-script-owner-access';accessButton=document.createElement('button');accessButton.id='soldier-script-open-owner-access';accessButton.type='button';accessButton.textContent='Kelola akses mitra dan QC';accessHandler=()=>{void openOwnerAccess();};accessButton.addEventListener('click',accessHandler);host.append(accessButton,accessContainer);
          }
          settle(Object.freeze({ok:true,dispose:()=>stop('access_denied',false)}));
        }catch{stop('unavailable');}
      }
      try {
        const title=document.createElement('h1');title.textContent='Masuk ke Soldier';status=line('Memeriksa akun Google…');login=document.createElement('button');login.type='button';login.id='soldier-script-login';login.textContent='Masuk dengan Google';login.disabled=true;host.replaceChildren(title,status,login);
        runner=dependencies.getScriptRun();runnerFailure=runner?.withFailureHandler;runnerSuccess=runner?.withSuccessHandler;if(typeof runnerFailure!=='function'||typeof runnerSuccess!=='function'||!nativeBound())throw Error();
      }catch{stop('unavailable');return started;}
      (async()=>{try {
        sdk=await dependencies.sdkLoader();if(terminal||!source()||!nativeBound())throw Error();
        if(sdk?.SDK_VERSION!=='10.12.2'||['initializeApp','getApps','getAuth','setPersistence','onAuthStateChanged','signInWithPopup','GoogleAuthProvider','signOut'].some(k=>typeof sdk[k]!=='function')||!sdk.browserSessionPersistence)throw Error();
        const apps=sdk.getApps();if(!Array.isArray(apps))throw Error();const own=apps.filter(a=>a?.name===APP_NAME);if(own.length>1)throw Error();
        app=own[0]||sdk.initializeApp({projectId:fixed.projectId,databaseURL:fixed.databaseURL,apiKey:fixed.apiKey,authDomain:fixed.authDomain},APP_NAME);
        if(!source()||!nativeBound()||app?.name!==APP_NAME||!['projectId','databaseURL','apiKey','authDomain'].every(k=>app.options[k]===fixed[k]))throw Error();
        auth=sdk.getAuth(app);if(!appBound())throw Error();await sdk.setPersistence(auth,sdk.browserSessionPersistence);if(terminal||!source()||!appBound()||!nativeBound())throw Error();
        let signing=false;
        loginHandler=()=>{
          if(terminal||boundUser!==null||signing)return;if(!source()||!appBound()||!nativeBound()){stop();return;}signing=true;login.disabled=true;status.textContent='Membuka login Google…';
          try {
            // Popup starts in the click task, preserving browser user activation.
            const popup=sdk.signInWithPopup(auth,new sdk.GoogleAuthProvider());Promise.resolve(popup).catch(()=>{if(!terminal&&boundUser===null)status.textContent='Login belum selesai. Tekan Masuk dengan Google untuk mencoba lagi.';}).finally(()=>{signing=false;if(!terminal&&boundUser===null)login.disabled=false;});
          }catch{signing=false;if(!terminal){login.disabled=false;status.textContent='Login belum selesai. Tekan Masuk dengan Google untuk mencoba lagi.';}}
        };
        login.addEventListener('click',loginHandler);login.disabled=false;
        const off=sdk.onAuthStateChanged(auth,user=>{
          if(terminal)return;if(!source()||!appBound()||!nativeBound()){stop();return;}
          if(boundUser!==null){if(user!==boundUser||!current()){stop();return;}for(const cb of [...subscribers])try{cb(user);}catch{stop('unavailable');return;}return;}
          if(user===auth.currentUser&&google(user)){void mount(user);return;}status.textContent='Masuk dengan akun Google yang sudah mendapat izin.';
        },()=>stop('unavailable'));
        if(typeof off!=='function')throw Error();authOff=off;if(terminal){off();authOff=null;}
      }catch{stop('unavailable');}})();
      return started;
    }
    return Object.freeze({start});
  }
  return Object.freeze({DEFAULT_CONFIGURATION,createBootstrap});
});
