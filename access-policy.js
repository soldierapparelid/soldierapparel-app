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
  return Object.freeze({modules,allowed,config,draftAccess});
});
