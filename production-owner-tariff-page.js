/* Owner page source switch. Enable only after the private server cutover. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{const page=api.createPage({document:root.document,configuration:api.defaultConfiguration,getBootstrap:()=>root.SoldierProductionOwnerTariffBootstrap,reload:()=>root.location.reload()});Object.defineProperty(root,'SoldierProductionOwnerTariffPage',{value:page,enumerable:true,writable:false,configurable:false});void page.start();}})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const FIELDS=['enabled','projectId','databaseURL','tenantId','endpointURL','apiKey','authDomain'];
  const defaultConfiguration=Object.freeze({enabled:false,projectId:'',databaseURL:'',tenantId:'',endpointURL:'',apiKey:'',authDomain:''});
  function configuration(value){
    if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Reflect.ownKeys(value).length!==FIELDS.length)return null;
    const copy={};for(const key of FIELDS){const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!d.enumerable||!Object.hasOwn(d,'value'))return null;copy[key]=d.value;}
    if(typeof copy.enabled!=='boolean'||FIELDS.slice(1).some(k=>typeof copy[k]!=='string'))return null;
    return Object.freeze(copy);
  }
  function createPage(options={}){
    const document=options.document,fixed=configuration(options.configuration===undefined?defaultConfiguration:options.configuration);let host,started,stopped=false,dispose;
    function message(text){const p=document.createElement('p');p.textContent=text;p.setAttribute('role','status');return p;}
    function hold(){stopped=true;try{dispose?.();}catch{}dispose=null;return true;}
    function start(){
      if(started)return started;
      started=(async()=>{
        try{
          if(document.readyState==='loading')await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
          host=document.getElementById('soldier-owner-tariff-host');if(!host||host.ownerDocument!==document||typeof host.replaceChildren!=='function')throw Error();
          if(fixed&&fixed.enabled===false){host.replaceChildren(message('Menu tarif owner sedang disiapkan. Gunakan aplikasi utama seperti biasa; belum ada tarif yang diubah dari halaman ini.'));return Object.freeze({ok:false,error:'service_disabled'});}
          if(!fixed||stopped)throw Error();
          const bootstrap=options.getBootstrap?.();if(!bootstrap||typeof bootstrap.start!=='function')throw Error();
          const result=await bootstrap.start({module:'owner-tariff',configuration:fixed,document,host,hold});
          if(stopped||result?.ok!==true||typeof result.dispose!=='function'){try{result?.dispose?.();}catch{}throw Error();}
          dispose=result.dispose;return Object.freeze({ok:true});
        }catch{
          hold();if(host){const reload=document.createElement('button');reload.type='button';reload.textContent='Muat ulang untuk masuk kembali';reload.addEventListener('click',()=>{try{options.reload?.();}catch{}});host.replaceChildren(message('Menu owner belum dapat dibuka. Muat ulang setelah akses dan layanan diperiksa.'),reload);}
          return Object.freeze({ok:false,error:'unavailable'});
        }
      })();return started;
    }
    return Object.freeze({canonical:!fixed||fixed.enabled===true,module:'owner-tariff',configuration:fixed,start,hold});
  }
  return Object.freeze({createPage,defaultConfiguration});
});
