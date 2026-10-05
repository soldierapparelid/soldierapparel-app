(function(){
  'use strict';
  document.documentElement.setAttribute('data-soldier-locked','');
  const Policy=window.SoldierAccessPolicy,Session=window.SoldierAccessSession;
  const pageModules={'index.html':'menu','potong-command.html':'potong','jahit-command.html':'jahit','qc-command.html':'qc','laporan-produksi.html':'laporan','stok-bahan-command.html':'stok','gaji-harian-command.html':'gaji','hpp-command-v1.html':'hpp','pembelian-produk-v1.html':'pembelian','nota-penjualan.html':'nota','retur-command.html':'retur'};
  const moduleName=pageModules[location.pathname.split('/').pop()||'index.html'];
  const keys={potong:'potong_fb',jahit:'jahit_fb',qc:'qc_fb',laporan:'soldier_produksi_fb',stok:'stok_bahan_fb',gaji:'gaji_fb',hpp:'soldier_hpp_fb',pembelian:'soldier_pembelian_produk_fb'};
  let sdkPromise,context,pendingConnect,pendingKey,panel,status,identity,loginButton,checks=new Map();
  // Reuse public web configuration only. Never overwrite an existing module target.
  try{const cfg=findConfig();if(cfg&&keys[moduleName]&&!localStorage.getItem(keys[moduleName]))localStorage.setItem(keys[moduleName],JSON.stringify(moduleName==='hpp'?cfg:{apiKey:cfg.apiKey,dbUrl:cfg.databaseURL,projectId:cfg.projectId}));}catch{}
  const mounted=new Promise(resolve=>document.addEventListener('DOMContentLoaded',()=>{mount();resolve();},{once:true}));
  function message(text){if(status)status.textContent=text;}
  function lock(text){document.documentElement.setAttribute('data-soldier-locked','');if(panel)panel.hidden=false;if(context)context.sdk.goOffline(context.db);message(text);}
  function unlock(profile){
    document.documentElement.removeAttribute('data-soldier-locked');panel.hidden=true;
    document.querySelectorAll('[data-soldier-module]').forEach(node=>{node.hidden=!Policy.allowed(profile,node.dataset.soldierModule);});
  }
  async function sdk(){return sdkPromise||(sdkPromise=Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js')
  ]).then(parts=>Object.assign({},...parts)).catch(()=>{sdkPromise=null;throw new Error('Modul login belum termuat. Periksa koneksi internet.');}));}
  function findConfig(){
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
      try{await context.sdk.setPersistence(context.auth,remember.checked?context.sdk.browserLocalPersistence:context.sdk.browserSessionPersistence);const provider=new context.sdk.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});await context.sdk.signInWithPopup(context.auth,provider);location.reload();}
      catch(error){const failure=Policy.loginFailure(error&&error.code);status.setAttribute('data-login-error',failure.code);message(failure.message);loginButton.disabled=false;}
    };card.append(loginButton);
    const change=document.createElement('button');change.textContent='Ganti akun';change.onclick=()=>signOut();card.append(change);
    const settings=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Koneksi aplikasi (diatur owner)';settings.append(summary);
    const form=document.createElement('form'),inputs={};
    for(const [key,label] of [['apiKey','Firebase web API key'],['databaseURL','Database URL'],['projectId','Project ID']]){const l=document.createElement('label');l.textContent=label;const input=document.createElement('input');input.type='text';input.autocomplete='off';input.required=key!=='projectId';inputs[key]=input;l.append(input);form.append(l);}
    const save=document.createElement('button');save.type='submit';save.textContent='Gunakan koneksi';form.append(save);
    form.onsubmit=event=>{event.preventDefault();try{if(context)throw new Error('Koneksi aktif tidak diganti otomatis. Periksa draf dan konfigurasi halaman bersama owner.');const cfg=Policy.config(Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.value])));localStorage.setItem('soldier_access_fb',JSON.stringify(cfg));location.reload();}catch(error){message(error.message);}};
    settings.append(form);card.append(settings);document.body.append(panel);
    const tools=document.createElement('div');tools.id='soldier-access-tools';const label=document.createElement('span');label.textContent='Akun Soldier';tools.append(label);const logout=document.createElement('button');logout.textContent='Keluar';logout.onclick=()=>signOut();tools.append(logout);document.body.append(tools);
  }
  async function signOut(){
    if(!context)return;
    if([...checks.values()].some(check=>{try{return check();}catch{return true;}})){lock('Masih ada draf belum terkirim. Selesaikan sinkronisasi atau ekspor bersama owner sebelum ganti akun.');const resume=document.createElement('button');resume.textContent='Kembali menyelesaikan draf';resume.onclick=()=>{if(context&&context.authorized){context.sdk.goOnline(context.db);unlock(context.profile);}resume.remove();};panel.firstChild.append(resume);return;}
    lock('Keluar dari akun…');await context.sdk.signOut(context.auth);location.reload();
  }
  async function connect(value,requestedModule,options={}){
    await mounted;
    if(!Policy||!Session||!moduleName)throw new Error('Pengaman akses belum siap.');
    const cfg=Policy.config(value),key=JSON.stringify(cfg);
    if(pendingConnect){if(pendingKey!==key)throw new Error('Tujuan koneksi berbeda. Periksa konfigurasi dengan owner.');await pendingConnect;}
    if(context&&context.authorized){
      if(context.key!==key||!Policy.allowed(context.profile,requestedModule))throw new Error('Akses koneksi atau divisi tidak sesuai.');
      checkDraft(context.uid,cfg,requestedModule,options.pending||(()=>false));return context;
    }
    pendingKey=key;
    pendingConnect=(async()=>{
      const api=await sdk();const existing=api.getApps().find(item=>item.name==='soldier-secure');if(existing&&JSON.stringify(Policy.config(existing.options))!==key)throw new Error('Koneksi aktif memakai tujuan lain. Muat ulang setelah memeriksa draf.');const app=existing||api.initializeApp(cfg,'soldier-secure');
      const db=api.getDatabase(app),auth=api.getAuth(app);api.goOffline(db);
      context={sdk:api,app,db,auth,key,authorized:false};
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
      context.uid=result.uid;context.profile=result.profile;context.authorized=true;
      checkDraft(result.uid,cfg,requestedModule,options.pending||(()=>false));
      api.onAuthStateChanged(auth,next=>{if(!next||next.uid!==context.uid){lock('Akun berubah. Memuat ulang akses…');location.reload();}});
      const refreshAccess=()=>{
        context.profile=Policy.resolveProfile(uidProfile,emailGrant,user.email);
        if(!Policy.allowed(context.profile,requestedModule)){context.authorized=false;lock('Akses akun dicabut atau divisi berubah. Hubungi owner.');}else if(context.authorized)unlock(context.profile);
      };
      const accessError=()=>{context.authorized=false;lock('Akses akun tidak dapat dikonfirmasi. Draf lokal tetap disimpan.');};
      api.onValue(api.ref(db,'accessControl/users/'+result.uid),snap=>{uidProfile=snap.val();refreshAccess();},accessError);
      if(grantPath)api.onValue(api.ref(db,grantPath),snap=>{emailGrant=snap.val();refreshAccess();},accessError);
      unlock(result.profile);return context;
    })().catch(error=>{lock(error.message);throw error;}).finally(()=>{pendingConnect=null;});
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
