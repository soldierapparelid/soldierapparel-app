(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SoldierAccessPolicy=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const modules=Object.freeze(['potong','jahit','qc','laporan','stok','gaji','hpp','pembelian','nota','retur']);
  function allowed(profile,moduleName){
    return !!(profile&&profile.active===true&&(profile.owner===true||(moduleName==='menu'?modules.some(name=>profile.modules&&profile.modules[name]===true):modules.includes(moduleName)&&profile.modules&&profile.modules[moduleName]===true)));
  }
  function config(value){
    if(!value||typeof value.apiKey!=='string'||!value.apiKey.trim())throw new Error('Konfigurasi koneksi belum lengkap.');
    const url=new URL(value.databaseURL||value.dbUrl||'');
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!/(^|\.)(firebaseio\.com|firebasedatabase\.app)$/.test(url.hostname)||!['','/'].includes(url.pathname))throw new Error('Alamat database harus berasal dari Firebase resmi.');
    const derived=url.hostname.split('.')[0].match(/^(.+)-default-rtdb$/);
    const projectId=(typeof value.projectId==='string'?value.projectId.trim():'')||(derived?derived[1]:'');
    if(!/^[a-z][a-z0-9-]{3,62}$/.test(projectId))throw new Error('Project ID diperlukan untuk login. Minta owner melengkapi koneksi.');
    return Object.freeze({apiKey:value.apiKey.trim(),databaseURL:url.origin,projectId,authDomain:projectId+'.firebaseapp.com'});
  }
  function draftAccess(binding,uid,pending){return !pending||binding===uid;}
  function loginFailure(code){
    const messages={
      'auth/popup-blocked':'Browser menahan jendela login Google. Izinkan pop-up untuk situs ini, lalu coba lagi di Chrome atau Edge.',
      'auth/popup-closed-by-user':'Jendela Google ditutup sebelum login selesai. Klik Masuk dengan Google dan selesaikan pemilihan akun.',
      'auth/cancelled-popup-request':'Masih ada jendela login Google yang belum selesai. Selesaikan atau tutup jendela itu sebelum mencoba lagi.',
      'auth/network-request-failed':'Koneksi ke Google belum berhasil. Periksa internet lalu coba lagi.',
      'auth/unauthorized-domain':'Alamat situs ini belum diizinkan untuk login. Hubungi owner agar koneksi Google diperiksa.',
      'auth/operation-not-allowed':'Login Google belum aktif pada koneksi aplikasi ini. Hubungi owner.',
      'auth/operation-not-supported-in-this-environment':'Browser ini belum mendukung login Google aplikasi. Buka tautan yang sama di Chrome atau Edge.',
      'auth/web-storage-unsupported':'Penyimpanan sesi browser tidak tersedia. Gunakan Chrome atau Edge dengan penyimpanan situs diizinkan.',
      'auth/invalid-api-key':'Konfigurasi koneksi aplikasi perlu diperiksa oleh owner.',
      'auth/app-not-authorized':'Koneksi aplikasi belum diizinkan oleh Google. Hubungi owner.',
      'auth/invalid-auth-event':'Hasil login Google belum dapat dikonfirmasi. Coba pada Chrome atau Edge dan hubungi owner jika tetap gagal.',
      'auth/auth-domain-config-required':'Konfigurasi alamat login perlu dilengkapi oleh owner.',
      'auth/internal-error':'Google belum menyelesaikan login. Coba di Chrome atau Edge dan hubungi owner jika tetap gagal.',
      'auth/timeout':'Login Google melewati batas waktu. Periksa internet dan coba kembali.'
    };
    const known=typeof code==='string'&&Object.prototype.hasOwnProperty.call(messages,code);
    return Object.freeze({code:known?code:'unknown',message:known?messages[code]:'Login belum selesai. Coba di Chrome atau Edge; hubungi owner jika tetap gagal.'});
  }
  return Object.freeze({modules,allowed,config,draftAccess,loginFailure});
});
