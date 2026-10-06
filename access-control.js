(function(){
  'use strict';
  // Choose the source-controlled canonical path before legacy storage or hooks.
  const productionMode=window.SoldierProductionPageMode;
  if(productionMode&&productionMode.canonical===true){productionMode.start();return;}
  if(document.documentElement.hasAttribute('data-soldier-production-page')&&(!productionMode||productionMode.canonical!==false||typeof productionMode.activateLegacy!=='function')){
    document.documentElement.setAttribute('data-soldier-locked','');
    const showGateFailure=()=>{
      const panel=document.createElement('section');panel.id='soldier-access-panel';
      const message=document.createElement('p');message.className='access-card';message.textContent='Akses aman belum siap. Muat ulang setelah pengaturan diperiksa.';
      panel.appendChild(message);document.body.appendChild(panel);
    };
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',showGateFailure,{once:true});else showGateFailure();
    return;
  }
  document.documentElement.setAttribute('data-soldier-locked','');
  const Policy=window.SoldierAccessPolicy,Session=window.SoldierAccessSession;
  const stagingOrigins=Object.freeze(['https://soldier-access-uji.web.app','https://soldier-access-uji.firebaseapp.com']);
  const stagingHosts=Object.freeze(['soldier-access-uji.web.app','soldier-access-uji.firebaseapp.com']);
  const stagingRequired=stagingOrigins.includes(location.origin)||stagingHosts.includes(location.hostname);
  const stagingFailure='Koneksi situs uji tidak sesuai. Hubungi owner sebelum melanjutkan.';
  // BEGIN REVIEWED STAGING WEB CONFIG
  // Public Firebase browser configuration only, private to this script's
  // closure. Never take the staging target from a caller/global/storage/URL.
  const stagingBinding=Object.freeze({"apiKey":"AIzaSyBV24_czcTF-aCqf2C810sqKEbYc-SJz5w","databaseURL":"https://soldier-access-uji-default-rtdb.asia-southeast1.firebasedatabase.app","projectId":"soldier-access-uji","authDomain":"soldier-access-uji.firebaseapp.com"});
  // END REVIEWED STAGING WEB CONFIG
  const pageModules={'index.html':'menu','potong-command.html':'potong','jahit-command.html':'jahit','qc-command.html':'qc','laporan-produksi.html':'laporan','stok-bahan-command.html':'stok','gaji-harian-command.html':'gaji','hpp-command-v1.html':'hpp','pembelian-produk-v1.html':'pembelian','nota-penjualan.html':'nota','retur-command.html':'retur','maklon-upah.html':'earnings'};
  const moduleName=pageModules[location.pathname.split('/').pop()||'index.html'];
  const keys={potong:'potong_fb',jahit:'jahit_fb',qc:'qc_fb',laporan:'soldier_produksi_fb',stok:'stok_bahan_fb',gaji:'gaji_fb',hpp:'soldier_hpp_fb',pembelian:'soldier_pembelian_produk_fb'};
  let sdkPromise,context,pendingConnect,pendingKey,panel,status,identity,loginButton,checks=new Map();
  // Reuse public web configuration only. Never overwrite an existing module target.
  try{const cfg=findConfig();if(cfg&&keys[moduleName]&&!localStorage.getItem(keys[moduleName]))localStorage.setItem(keys[moduleName],JSON.stringify(moduleName==='hpp'?cfg:{apiKey:cfg.apiKey,dbUrl:cfg.databaseURL,projectId:cfg.projectId}));}catch{}
  const mounted=new Promise(resolve=>document.addEventListener('DOMContentLoaded',()=>{mount();resolve();},{once:true}));
  function message(text){if(status)status.textContent=text;}
  function lock(text){document.documentElement.setAttribute('data-soldier-locked','');if(panel)panel.hidden=false;if(context)context.sdk.goOffline(context.db);message(text);}
  function runCleanup(entry){
    if(!entry.active)return;entry.active=false;
    try{const result=entry.callback();if(result&&typeof result.then==='function')Promise.resolve(result).catch(()=>{});}catch{}
  }
  function registerCleanup(target,callback){
    if(typeof callback!=='function')throw new TypeError('Pembersihan sesi harus berupa fungsi.');
    const entry={callback,active:true};
    if(context!==target||!target.authorized||target.auth.currentUser?.uid!==target.uid)runCleanup(entry);
    else target.cleanups.push(entry);
    return ()=>{entry.active=false;target.cleanups=target.cleanups.filter(item=>item!==entry);};
  }
  function invalidate(target=context){
    if(!target)return;target.authorized=false;
    if(target.guard)target.guard.dispose();
    const entries=target.cleanups||[];target.cleanups=[];
    for(const entry of entries)runCleanup(entry);
    for(const off of target.metadataOff||[]){try{off();}catch{}}target.metadataOff=[];
    if(target===context)checks.clear();
  }
  function unlock(profile){
    document.documentElement.removeAttribute('data-soldier-locked');panel.hidden=true;
    document.querySelectorAll('[data-soldier-module]').forEach(node=>{node.hidden=!Policy.allowed(profile,node.dataset.soldierModule);});
  }
  async function sdk(){return sdkPromise||(sdkPromise=Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js')
  ]).then(parts=>Object.assign({},...parts)).catch(()=>{sdkPromise=null;throw new Error('Modul login belum termuat. Periksa koneksi internet.');}));}
  function fixedStagingConfiguration(){
    try{
      if(!stagingOrigins.includes(location.origin)||!stagingHosts.includes(location.hostname)||location.protocol!=='https:'||location.port!=='')throw Error();
      const fields=['apiKey','databaseURL','projectId','authDomain'];
      if(!stagingBinding||typeof stagingBinding!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(stagingBinding))||!Object.isFrozen(stagingBinding)||Reflect.ownKeys(stagingBinding).length!==fields.length)throw Error();
      for(const field of fields){const d=Object.getOwnPropertyDescriptor(stagingBinding,field);if(!d||!d.enumerable||!Object.hasOwn(d,'value')||typeof d.value!=='string')throw Error();}
      const normalized=Policy.config(stagingBinding);
      if(!/^[A-Za-z0-9_-]{1,256}$/.test(stagingBinding.apiKey)||fields.some(field=>normalized[field]!==stagingBinding[field]))throw Error();
      return stagingBinding;
    }catch{throw new Error(stagingFailure);}
  }
  function reviewedConfiguration(value){
    if(!stagingRequired)return Policy.config(value);
    try{
      const binding=fixedStagingConfiguration(),fields=['apiKey','databaseURL','dbUrl','projectId','authDomain'];
      if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error();
      const supplied=Reflect.ownKeys(value),copy=Object.create(null);
      if(!supplied.length||supplied.some(field=>typeof field!=='string'||!fields.includes(field)))throw Error();
      for(const field of supplied){const d=Object.getOwnPropertyDescriptor(value,field);if(!d||!d.enumerable||!Object.hasOwn(d,'value')||typeof d.value!=='string')throw Error();copy[field]=d.value;}
      if(!Object.hasOwn(copy,'apiKey')||Object.hasOwn(copy,'databaseURL')===Object.hasOwn(copy,'dbUrl')||Object.hasOwn(copy,'authDomain')&&copy.authDomain!==binding.authDomain)throw Error();
      const normalized=Policy.config(copy);
      if(['apiKey','databaseURL','projectId','authDomain'].some(field=>normalized[field]!==binding[field]))throw Error();
      return normalized;
    }catch{throw new Error(stagingFailure);}
  }
  function findConfig(){
    if(stagingRequired)return fixedStagingConfiguration();
    const ordered=[keys[moduleName],'soldier_access_fb','soldier_produksi_fb',...Object.values(keys)].filter(Boolean);
    for(const key of new Set(ordered)){try{const value=JSON.parse(localStorage.getItem(key)||'null');if(value&&value.apiKey&&(value.databaseURL||value.dbUrl))return Policy.config(value);}catch{}}
    return null;
  }
  function mount(){
    panel=document.createElement('section');panel.id='soldier-access-panel';panel.setAttribute('aria-label','Akses aplikasi Soldier');
    const card=document.createElement('div');card.className='access-card';panel.append(card);
    const title=document.createElement('h1');title.textContent='Masuk ke Soldier';card.append(title);
    status=document.createElement('p');status.setAttribute('role','status');status.textContent='Memeriksa akses akun…';card.append(status);
    identity=document.createElement('p');identity.className='access-account';card.append(identity);
    const info=document.createElement('p');info.textContent='Gunakan akun Google yang didaftarkan owner. Login dilakukan di Google.';card.append(info);
    const rememberLabel=document.createElement('label'),remember=document.createElement('input');remember.type='checkbox';remember.id='soldier-access-remember';rememberLabel.append(remember,document.createTextNode('Ingat akun di perangkat pribadi ini'));card.append(rememberLabel);
    loginButton=document.createElement('button');loginButton.textContent='Masuk dengan Google';loginButton.disabled=true;loginButton.onclick=async()=>{
      if(!context)return;loginButton.disabled=true;status.removeAttribute('data-login-error');message('Membuka login Google…');
      try{const api=await sdk();await api.setPersistence(context.auth,remember.checked?api.browserLocalPersistence:api.browserSessionPersistence);const provider=new api.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});await api.signInWithPopup(context.auth,provider);location.reload();}
      catch(error){const failure=Policy.loginFailure(error&&error.code);status.setAttribute('data-login-error',failure.code);message(failure.message);loginButton.disabled=false;}
    };card.append(loginButton);
    const change=document.createElement('button');change.textContent='Ganti akun';change.onclick=()=>signOut();card.append(change);
    const settings=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Koneksi aplikasi (diatur owner)';settings.append(summary);
    const form=document.createElement('form'),inputs={};
    for(const [key,label] of [['apiKey','Firebase web API key'],['databaseURL','Database URL'],['projectId','Project ID']]){const l=document.createElement('label');l.textContent=label;const input=document.createElement('input');input.type='text';input.autocomplete='off';input.required=key!=='projectId';inputs[key]=input;l.append(input);form.append(l);}
    const save=document.createElement('button');save.type='submit';save.textContent='Gunakan koneksi';form.append(save);
    form.onsubmit=event=>{event.preventDefault();try{if(context)throw new Error('Koneksi aktif tidak diganti otomatis. Periksa draf dan konfigurasi halaman bersama owner.');const cfg=Policy.config(Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.value])));localStorage.setItem('soldier_access_fb',JSON.stringify(cfg));location.reload();}catch(error){message(error.message);}};
    if(stagingRequired){settings.hidden=true;save.disabled=true;form.onsubmit=event=>{event.preventDefault();message('Koneksi situs uji sudah ditetapkan owner.');};}
    settings.append(form);card.append(settings);document.body.append(panel);
    const tools=document.createElement('div');tools.id='soldier-access-tools';const label=document.createElement('span');label.textContent='Akun Soldier';tools.append(label);const logout=document.createElement('button');logout.textContent='Keluar';logout.onclick=()=>signOut();tools.append(logout);document.body.append(tools);
  }
  async function signOut(){
    if(!context)return;
    if([...checks.values()].some(check=>{try{return check();}catch{return true;}})){context.pausedForDraft=true;lock('Masih ada draf belum terkirim. Selesaikan sinkronisasi atau ekspor bersama owner sebelum ganti akun.');const resume=document.createElement('button');resume.textContent='Kembali menyelesaikan draf';resume.onclick=()=>{if(context&&context.authorized&&context.auth.currentUser?.uid===context.uid&&Policy.allowed(context.profile,moduleName)){context.pausedForDraft=false;unlock(context.profile);context.sdk.goOnline(context.db);}resume.remove();};panel.firstChild.append(resume);return;}
    const auth=context.auth;invalidate();lock('Keluar dari akun…');const api=await sdk();await api.signOut(auth);location.reload();
  }
  async function connect(value,requestedModule,options={}){
    await mounted;
    if(!Policy||!Session||!moduleName)throw new Error('Pengaman akses belum siap.');
    let cfg;
    try{cfg=reviewedConfiguration(value);}catch(error){if(stagingRequired){invalidate();lock(stagingFailure);}throw error;}
    const key=JSON.stringify(cfg);
    if(pendingConnect){if(pendingKey!==key)throw new Error('Tujuan koneksi berbeda. Periksa konfigurasi dengan owner.');await pendingConnect;}
    if(context&&context.authorized){
      if(context.key!==key||!Policy.allowed(context.profile,requestedModule))throw new Error('Akses koneksi atau divisi tidak sesuai.');
      checkDraft(context.uid,cfg,requestedModule,options.pending||(()=>false));return context;
    }
    pendingKey=key;
    pendingConnect=(async()=>{
      const api=await sdk();if(stagingRequired)reviewedConfiguration(cfg);const existing=api.getApps().find(item=>item.name==='soldier-secure');if(existing&&JSON.stringify(reviewedConfiguration(existing.options))!==key)throw new Error('Koneksi aktif memakai tujuan lain. Muat ulang setelah memeriksa draf.');const app=existing||api.initializeApp(cfg,'soldier-secure');
      const db=api.getDatabase(app),auth=api.getAuth(app);api.goOffline(db);
      invalidate();context={sdk:api,app,db,auth,key,authorized:false,pausedForDraft:false,metadataOff:[],cleanups:[]};
      const sessionContext=context;
      context.registerCleanup=callback=>registerCleanup(sessionContext,callback);
      let initial=true;
      const user=await new Promise((resolve,reject)=>{
        let off=()=>{};off=api.onAuthStateChanged(auth,user=>{
          if(initial){initial=false;off();resolve(user);}
        },()=>reject(new Error('Sesi login belum tersedia.')));
      });
      loginButton.disabled=false;
      if(user){identity.textContent='Akun Google sudah masuk. Memeriksa izin yang ditetapkan owner.';}
      const bindingKey='soldier_access_binding:'+requestedModule+':'+cfg.databaseURL;
      let binding;try{binding=localStorage.getItem(bindingKey);}catch{throw new Error('Penyimpanan identitas perangkat tidak tersedia.');}
      let uidProfile=null,emailGrant=null,grantPath=null;
      const result=await Session.authorize({getUser:async()=>user,getProfile:async (uid,account)=>{
        api.goOnline(db);
        try{
          uidProfile=(await api.get(api.ref(db,'accessControl/users/'+uid))).val();
          if(uidProfile!==null)return uidProfile;
          grantPath='accessControl/emailGrants/'+Policy.emailKey(account.email);
          emailGrant=(await api.get(api.ref(db,grantPath))).val();
          return Policy.resolveProfile(uidProfile,emailGrant,account.email);
        }catch{throw new Error('Akun ini belum mendapat akses divisi. Minta owner memeriksa email yang didaftarkan.');}
      },allowed:Policy.allowed,moduleName:requestedModule,binding,draftAccess:Policy.draftAccess,pending:options.pending||(()=>false)});
      if(auth.currentUser?.uid!==result.uid)throw new Error('Akun berubah selama pemeriksaan akses. Muat ulang sebelum melanjutkan.');
      context.uid=result.uid;context.profile=result.profile;
      checkDraft(result.uid,cfg,requestedModule,options.pending||(()=>false));
      context.authorized=true;
      const activeContext=context;
      context.guard=Session.guardDatabase({sdk:api,db,isCurrent:()=>context===activeContext&&context.authorized===true&&auth.currentUser?.uid===result.uid&&!document.documentElement.hasAttribute('data-soldier-locked')&&Policy.allowed(context.profile,requestedModule)});
      context.sdk=context.guard.sdk;
      window.__firebase=context.sdk;
      const watch=off=>{if(typeof off!=='function')return;if(context===activeContext&&activeContext.authorized)activeContext.metadataOff.push(off);else off();};
      watch(api.onAuthStateChanged(auth,next=>{if(context!==activeContext||!activeContext.authorized)return;if(!next||next.uid!==activeContext.uid){invalidate(activeContext);lock('Akun berubah. Memuat ulang akses…');location.reload();}}));
      const refreshAccess=()=>{
        if(context!==activeContext||!activeContext.authorized)return;
        const previous=context.profile;
        context.profile=Policy.resolveProfile(uidProfile,emailGrant,user.email);
        if(previous&&(previous.workerId!==context.profile?.workerId||previous.owner!==context.profile?.owner)){
          invalidate();lock('Izin catatan mitra berubah. Memuat ulang akses…');location.reload();return;
        }
        if(!Policy.allowed(context.profile,requestedModule)){invalidate();lock('Akses akun dicabut atau divisi berubah. Hubungi owner.');}else if(context.authorized&&!context.pausedForDraft)unlock(context.profile);
      };
      const accessError=()=>{if(context!==activeContext||!activeContext.authorized)return;invalidate(activeContext);lock('Akses akun tidak dapat dikonfirmasi. Draf lokal tetap disimpan.');};
      watch(api.onValue(api.ref(db,'accessControl/users/'+result.uid),snap=>{if(context!==activeContext||!activeContext.authorized)return;uidProfile=snap.val();refreshAccess();},accessError));
      if(grantPath&&activeContext.authorized)watch(api.onValue(api.ref(db,grantPath),snap=>{if(context!==activeContext||!activeContext.authorized)return;emailGrant=snap.val();refreshAccess();},accessError));
      if(!context.authorized||auth.currentUser?.uid!==result.uid||!Policy.allowed(context.profile,requestedModule))throw new Error('Akses akun tidak dapat dikonfirmasi. Draf lokal tetap disimpan.');
      unlock(context.profile);return context;
    })().catch(error=>{invalidate();lock(error.message);throw error;}).finally(()=>{pendingConnect=null;});
    return pendingConnect;
  }
  function checkDraft(uid,cfg,name,pending){
    const key='soldier_access_binding:'+name+':'+cfg.databaseURL;
    if(!Policy.draftAccess(localStorage.getItem(key),uid,pending()))throw new Error('Draf lama perlu diperiksa owner; tidak dikirim memakai akun lain.');
    localStorage.setItem(key,uid);checks.set(name,pending);
  }
  let photoWrites=Promise.resolve();
  function publishPhotos(value){
    const current=context;
    if(!current||!current.authorized||!Policy.allowed(current.profile,'pembelian')||!window.SoldierAccessPhotos)return Promise.reject(new Error('Akses publikasi foto belum siap.'));
    const projection=window.SoldierAccessPhotos.project(value);
    const write=()=>{if(context!==current||!current.authorized||!Policy.allowed(current.profile,'pembelian'))throw new Error('Sesi publikasi foto berubah.');return current.sdk.set(current.sdk.ref(current.db,'soldier/productionPhotos'),projection);};
    const result=photoWrites.catch(()=>{}).then(write);photoWrites=result;return result;
  }
  window.SoldierAccess=Object.freeze({connect,findConfig,publishPhotos,compatDatabase:Session.compatDatabase,go(url){const name=pageModules[url];if(context&&context.authorized&&Policy.allowed(context.profile,name))location.href=url;else lock('Akun belum mendapat akses halaman ini.');}});
  mounted.then(()=>{const cfg=findConfig();if(!cfg){message('Konfigurasi koneksi belum ada di perangkat. Minta owner mengatur koneksi di bawah.');return;}if(['menu','nota','retur'].includes(moduleName))connect(cfg,moduleName).catch(()=>{});}).catch(()=>lock('Pengaman login belum siap.'));
})();
