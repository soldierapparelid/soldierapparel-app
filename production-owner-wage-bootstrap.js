/* Owner wage bootstrap. Fixed source switch, no legacy/config discovery. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else Object.defineProperty(root,'SoldierProductionOwnerWageBootstrap',{value:api.createBootstrap({
    getPage:()=>root.SoldierProductionOwnerWagePage,getUI:()=>root.SoldierProductionOwnerWageUI,getBridge:()=>root.SoldierProductionOwnerWageBridge,
    fetch:(...args)=>root.fetch(...args),reload:()=>root.location.reload(),sdkLoader:async()=>{
      const [app,auth,database]=await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js')
      ]);
      return {SDK_VERSION:app.SDK_VERSION,initializeApp:app.initializeApp,getApps:app.getApps,getAuth:auth.getAuth,setPersistence:auth.setPersistence,browserSessionPersistence:auth.browserSessionPersistence,onAuthStateChanged:auth.onAuthStateChanged,signInWithPopup:auth.signInWithPopup,GoogleAuthProvider:auth.GoogleAuthProvider,signOut:auth.signOut,getDatabase:database.getDatabase,ref:database.ref,onValue:database.onValue};
    }
  }),enumerable:true,writable:false,configurable:false});
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const CONFIG=['enabled','projectId','databaseURL','tenantId','endpointURL','apiKey','authDomain'],APP_NAME='soldier-owner-wage-v1';
  const safe=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
  const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return d&&d.enumerable&&Object.hasOwn(d,'value');});
  const outcome=error=>Object.freeze({ok:false,error});
  function configuration(value){
    if(!exact(value,CONFIG)||value.enabled!==true||CONFIG.slice(1).some(k=>typeof value[k]!=='string'))throw Error();
    const db=new URL(value.databaseURL),endpoint=new URL(value.endpointURL);
    if(!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value.projectId)||!safe(value.tenantId)||value.authDomain!==value.projectId+'.firebaseapp.com'||!/^[A-Za-z0-9_-]{1,256}$/.test(value.apiKey)||db.origin!==value.databaseURL||db.protocol!=='https:'||db.port||db.username||db.password||!/^([a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app)$/.test(db.hostname)||endpoint.href!==value.endpointURL||endpoint.protocol!=='https:'||endpoint.port||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/v1/production/session')throw Error();
    return Object.freeze({...value});
  }
  // Injection exists only on this pure CommonJS factory, never the browser API.
  // SDK persistence stores Auth's own session; no token/config is stored here.
  // https://firebase.google.com/docs/auth/web/auth-state-persistence
  // https://firebase.google.com/docs/auth/web/google-signin
  function createBootstrap(dependencies={}){
    let started,captured;
    function start(args){
      let mode,fixed;
      try{
        if(!exact(args,['module','configuration','document','host','hold'])||args.module!=='owner-wage'||typeof args.hold!=='function'||!args.document||typeof args.document.createElement!=='function'||!args.host||args.host.ownerDocument!==args.document||typeof args.host.replaceChildren!=='function'||typeof dependencies.getPage!=='function'||typeof dependencies.sdkLoader!=='function')throw Error();
        mode=dependencies.getPage();if(!mode||mode.canonical!==true||mode.module!==args.module||mode.configuration!==args.configuration)throw Error();
        fixed=configuration(args.configuration);
        if(started){if(!['module','configuration','document','host','hold'].every(k=>args[k]===captured[k]))throw Error();return started;}
      }catch{return Promise.resolve(outcome('unavailable'));}
      captured=Object.freeze({...args});
      const {document,host,hold,module}=args;
      let terminal=false,boundUid=null,sdk,app,auth,database,authOff,ui,login,logout,status,loginHandler,logoutHandler,pageTarget,pageHideHandler,resolveStart;
      started=new Promise(resolve=>{resolveStart=resolve;});
      function settle(value){if(resolveStart){const resolve=resolveStart;resolveStart=null;resolve(value);}}
      function source(){try{const current=dependencies.getPage();return current===mode&&current.canonical===true&&current.module===module&&current.configuration===captured.configuration&&CONFIG.every(k=>Object.getOwnPropertyDescriptor(captured.configuration,k)?.value===fixed[k]);}catch{return false;}}
      function bound(){try{return app&&app.name===APP_NAME&&['projectId','databaseURL','apiKey','authDomain'].every(k=>app.options[k]===fixed[k])&&auth.app===app&&database.app===app;}catch{return false;}}
      function google(user){return user&&safe(user.uid)&&user.emailVerified===true&&Array.isArray(user.providerData)&&user.providerData.some(p=>p&&p.providerId==='google.com')&&typeof user.getIdToken==='function';}
      function current(){try{return !terminal&&source()&&bound()&&boundUid!==null&&google(auth.currentUser)&&auth.currentUser.uid===boundUid;}catch{return false;}}
      function clear(){try{if(ui)ui.dispose();}catch{}ui=null;try{if(authOff)authOff();}catch{}authOff=null;try{if(pageTarget&&pageHideHandler)pageTarget.removeEventListener('pagehide',pageHideHandler);}catch{}pageTarget=null;pageHideHandler=null;try{if(login&&loginHandler)login.removeEventListener('click',loginHandler);if(logout&&logoutHandler)logout.removeEventListener('click',logoutHandler);host.replaceChildren();}catch{}}
      function stop(error='unavailable',applyHold=true){
        if(terminal)return;terminal=true;clear();
        if(applyHold)try{
          const title=document.createElement('h1');title.textContent='Masuk kembali ke Soldier';
          const message=line('Sesi ini sudah ditutup. Muat ulang lalu masuk dengan akun Google yang mendapat izin divisi.');message.id='soldier-production-terminal';
          const reload=document.createElement('button');reload.type='button';reload.id='soldier-production-reload';reload.textContent='Muat ulang untuk masuk kembali';
          reload.addEventListener('click',()=>{try{if(typeof dependencies.reload==='function')dependencies.reload();}catch{}});host.replaceChildren(title,message,reload);
        }catch{}
        if(applyHold)try{hold();}catch{}
        settle(outcome(error));
      }
      const dispose=()=>stop('access_denied',false);
      function line(text){const p=document.createElement('p');p.textContent=text;p.setAttribute('role','status');return p;}
      function shell(){
        const title=document.createElement('h1');title.textContent='Masuk ke Soldier';
        status=line('Memeriksa akun Google…');login=document.createElement('button');login.type='button';login.textContent='Masuk dengan Google';login.id='soldier-production-login';login.disabled=true;
        host.replaceChildren(title,status,login);
      }
      async function mount(user){
        // Bind once before the UI can open views. Account replacement
        // during UI.readyPromise never starts another account in this page lifetime.
        if(terminal||boundUid!==null)return;boundUid=user.uid;
        try{
          if(!current())throw Error();const form=dependencies.getUI(),bridge=dependencies.getBridge();
          if(!form||typeof form.mount!=='function'||!bridge||typeof bridge.createBridge!=='function')throw Error();
          if(login&&loginHandler)login.removeEventListener('click',loginHandler);
          const formHost=document.createElement('section');formHost.id='soldier-production-bound-form';logout=document.createElement('button');logout.type='button';logout.textContent='Keluar';logout.id='soldier-production-logout';
          logoutHandler=()=>{if(terminal)return;const ownedAuth=auth;stop('access_denied');try{Promise.resolve(sdk.signOut(ownedAuth)).catch(()=>{});}catch{}};logout.addEventListener('click',logoutHandler);host.replaceChildren(logout,formHost);
          const createBridge=callbacks=>{
            if(!current()||!exact(callbacks,['onCatalog','onView','onClear'])||['onCatalog','onView','onClear'].some(k=>typeof callbacks[k]!=='function'))throw Error();
            return bridge.createBridge({enabled:true,projectId:fixed.projectId,databaseURL:fixed.databaseURL,tenantId:fixed.tenantId,endpointURL:fixed.endpointURL,auth,database,sdk:{ref:sdk.ref,onValue:sdk.onValue,onAuthStateChanged:sdk.onAuthStateChanged},fetch:dependencies.fetch,isCurrent:current,
              onCatalog:value=>{if(current())callbacks.onCatalog(value);else stop('access_denied');},
              onView:value=>{if(current())callbacks.onView(value);else stop('access_denied');},
              onClear:code=>{
                // Selection/loading clears preserve the read-only choices.
                // Every other clear closes this account-bound page lifetime.
                if(['loading','selection_changed','selection_cleared'].includes(code)&&current()){callbacks.onClear(code);return;}
                try{callbacks.onClear(code);}finally{stop(code==='unavailable'?'unavailable':'access_denied');}
              }});
          };
          const mounted=form.mount({document,host:formHost,createBridge,isCurrent:current});
          if(!mounted||typeof mounted.dispose!=='function'||!mounted.readyPromise||typeof mounted.readyPromise.then!=='function')throw Error();ui=mounted;
          const readiness=Promise.resolve(mounted.readyPromise);
          if(!current()){readiness.catch(()=>{});try{mounted.dispose();}catch{}ui=null;stop('access_denied');return;}
          const ready=await readiness;if(!current()){stop('access_denied');return;}if(!ready||ready.ok!==true)throw Error();
          settle(Object.freeze({ok:true,dispose}));
        }catch{stop(current()?'unavailable':'access_denied');}
      }
      try{
        shell();
        // Clear financial DOM before a document can enter the browser's
        // back/forward cache. Returning to it requires a new bound page.
        const target=document.defaultView;
        if(target&&typeof target.addEventListener==='function'&&typeof target.removeEventListener==='function'){pageTarget=target;pageHideHandler=()=>stop('access_denied');target.addEventListener('pagehide',pageHideHandler);}
      }catch{stop('unavailable');return started;}
      (async()=>{
        try{
          sdk=await dependencies.sdkLoader();if(terminal||!source())throw Error();
          if(!sdk||sdk.SDK_VERSION!=='10.12.2'||['initializeApp','getApps','getAuth','setPersistence','onAuthStateChanged','signInWithPopup','GoogleAuthProvider','signOut','getDatabase','ref','onValue'].some(k=>typeof sdk[k]!=='function')||!sdk.browserSessionPersistence)throw Error();
          const apps=sdk.getApps();if(!Array.isArray(apps))throw Error();const own=apps.filter(a=>a&&a.name===APP_NAME);if(own.length>1)throw Error();
          app=own[0]||sdk.initializeApp({projectId:fixed.projectId,databaseURL:fixed.databaseURL,apiKey:fixed.apiKey,authDomain:fixed.authDomain},APP_NAME);
          if(!source()||!app||app.name!==APP_NAME||!['projectId','databaseURL','apiKey','authDomain'].every(k=>app.options[k]===fixed[k]))throw Error();
          auth=sdk.getAuth(app);database=sdk.getDatabase(app);if(!bound())throw Error();
          await sdk.setPersistence(auth,sdk.browserSessionPersistence);if(terminal||!source()||!bound())throw Error();
          let signing=false;
          loginHandler=()=>{
            if(terminal||boundUid!==null||signing)return;if(!source()||!bound()){stop('access_denied');return;}
            signing=true;login.disabled=true;status.textContent='Membuka login Google…';
            try{
              // Call synchronously in the user's click task to retain activation.
              const result=sdk.signInWithPopup(auth,new sdk.GoogleAuthProvider());
              Promise.resolve(result).catch(()=>{if(!terminal&&boundUid===null){status.textContent='Login belum selesai. Tekan Masuk dengan Google untuk mencoba lagi.';}}).finally(()=>{signing=false;if(!terminal&&boundUid===null)login.disabled=false;});
            }catch{signing=false;if(!terminal){login.disabled=false;status.textContent='Login belum selesai. Tekan Masuk dengan Google untuk mencoba lagi.';}}
          };
          login.addEventListener('click',loginHandler);login.disabled=false;
          const off=sdk.onAuthStateChanged(auth,user=>{
            if(terminal)return;if(!source()||!bound()){stop('access_denied');return;}
            if(boundUid!==null){if(!google(user)||user.uid!==boundUid||!current())stop('access_denied');return;}
            if(google(user)){void mount(user);return;}status.textContent='Masuk memakai akun Google yang sudah mendapat izin divisi.';
          },()=>stop('unavailable'));
          if(typeof off!=='function')throw Error();authOff=off;if(terminal){try{off();}catch{}authOff=null;}
        }catch{stop('unavailable');}
      })();
      return started;
    }
    return Object.freeze({start});
  }
  return Object.freeze({createBootstrap});
});

