/* Source-controlled switch. These public fields do not grant business access. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else Object.defineProperty(root,'SoldierProductionPageMode',{value:api.createPageMode({document:root.document,pathname:root.location.pathname,configuration:api.defaultConfiguration,getBootstrap:()=>root.SoldierProductionBootstrap,reload:()=>root.location.reload()}),enumerable:true,writable:false,configurable:false});
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // Enable only by a reviewed source change with a verified fixed deployment.
  const DEFAULT_CONFIGURATION=Object.freeze({enabled:false,projectId:'',databaseURL:'',tenantId:'',endpointURL:'',apiKey:'',authDomain:''});
  const FIELDS=['enabled','projectId','databaseURL','tenantId','endpointURL','apiKey','authDomain'];
  const LEGACY_ID='soldier-legacy-production-script';
  const FAILURE='Akses aman belum siap. Data lama tidak dibuka. Muat ulang setelah pengaturan diperiksa.';
  function configuration(value){
    try{
      if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Reflect.ownKeys(value).length!==FIELDS.length)return null;
      const copy={};
      for(const field of FIELDS){const descriptor=Object.getOwnPropertyDescriptor(value,field);if(!descriptor||!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))return null;copy[field]=descriptor.value;}
      if(typeof copy.enabled!=='boolean'||FIELDS.slice(1).some(field=>typeof copy[field]!=='string'))return null;
      if(copy.enabled){
        const db=new URL(copy.databaseURL),endpoint=new URL(copy.endpointURL);
        if(!/^[a-z][a-z0-9-]{3,62}$/.test(copy.projectId)||!/^[A-Za-z0-9_-]{1,128}$/.test(copy.tenantId)||['__proto__','constructor','prototype'].includes(copy.tenantId)||copy.authDomain!==copy.projectId+'.firebaseapp.com'||!/^[A-Za-z0-9_-]{1,256}$/.test(copy.apiKey)||db.origin!==copy.databaseURL||db.protocol!=='https:'||db.port||db.username||db.password||!/(^|\.)(firebaseio\.com|firebasedatabase\.app)$/.test(db.hostname)||endpoint.href!==copy.endpointURL||endpoint.protocol!=='https:'||endpoint.port||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/v1/production/commands')return null;
      }
      return Object.freeze(copy);
    }catch{return null;}
  }
  function createPageMode(options={}){
    const document=options.document;
    const name=typeof options.pathname==='string'?options.pathname.split('/').pop():'';
    const moduleName=name==='jahit-command.html'?'jahit':name==='qc-command.html'?'qc':null;
    const fixed=configuration(options.configuration===undefined?DEFAULT_CONFIGURATION:options.configuration);
    // A malformed source switch is a locked canonical failure, never LEGACY.
    const canonical=moduleName!==null&&(!fixed||fixed.enabled===true);
    let activated=false,started,epoch=0,dispose,host,panel;
    function lock(){document.documentElement.setAttribute('data-soldier-locked','');}
    function stripLegacy(){
      for(const node of document.querySelectorAll('*'))for(const attribute of Array.from(node.attributes||[]))if(/^on/i.test(attribute.name))node.removeAttribute(attribute.name);
      for(const node of Array.from(document.body.children))if(node!==panel){node.hidden=true;node.setAttribute('inert','');if(node.style)node.style.display='none';}
    }
    function shell(){
      if(panel)return;
      stripLegacy();
      panel=document.createElement('section');panel.id='soldier-access-panel';
      host=document.createElement('main');host.id='soldier-production-form-host';host.className='access-card';
      panel.appendChild(host);document.body.appendChild(panel);
    }
    function showFailure(){
      if(!host)return;
      const line=document.createElement('p');line.textContent=FAILURE;line.setAttribute('role','alert');
      const reload=document.createElement('button');reload.id='soldier-production-reload';reload.type='button';reload.textContent='Muat ulang untuk masuk kembali';
      reload.addEventListener('click',()=>{try{if(typeof options.reload==='function')options.reload();}catch{}});host.replaceChildren(line,reload);
    }
    function stop(result){
      if(result&&typeof result.dispose==='function')try{const done=result.dispose();if(done&&typeof done.then==='function')Promise.resolve(done).catch(()=>{});}catch{}
    }
    function hold(){
      if(!canonical)return false;
      epoch++;lock();
      if(document.body){shell();stripLegacy();}
      if(dispose){const old=dispose;dispose=null;stop({dispose:old});}
      return true;
    }
    function ready(){
      if(document.readyState!=='loading')return Promise.resolve();
      return new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
    }
    function start(){
      if(!canonical)return Promise.resolve(Object.freeze({ok:false,error:'legacy_mode'}));
      if(started)return started;
      lock();const captured=epoch;
      started=(async()=>{
        let result;
        try{
          await ready();shell();
          if(captured!==epoch||!fixed||!moduleName)throw Error();
          const bootstrap=options.getBootstrap&&options.getBootstrap();
          if(!bootstrap||typeof bootstrap.start!=='function')throw Error();
          result=await bootstrap.start(Object.freeze({module:moduleName,configuration:fixed,document,host,hold}));
          if(captured!==epoch||!result||result.ok!==true||typeof result.dispose!=='function')throw Error();
          dispose=result.dispose;stripLegacy();document.documentElement.removeAttribute('data-soldier-locked');
          return Object.freeze({ok:true});
        }catch{
          stop(result);hold();showFailure();return Object.freeze({ok:false,error:'unavailable'});
        }
      })();
      return started;
    }
    function activateLegacy(id){
      if(canonical||!moduleName||!fixed||fixed.enabled!==false||id!==LEGACY_ID||activated)return false;
      const source=document.getElementById(LEGACY_ID);
      if(!source||source.tagName.toLowerCase()!=='script'||source.getAttribute('type')!=='text/plain')return false;
      activated=true;
      // A classic script retains global lexical bindings used by inline onclick.
      // Latch before insertion; partial execution must never be attempted twice.
      const script=document.createElement('script');script.type='text/javascript';script.textContent=source.textContent;
      const nonce=source.getAttribute('nonce');if(nonce)script.setAttribute('nonce',nonce);
      try{source.parentNode.appendChild(script);return true;}catch{lock();return false;}
    }
    return Object.freeze({canonical,module:moduleName,configuration:fixed,start,hold,activateLegacy});
  }
  return Object.freeze({createPageMode,defaultConfiguration:DEFAULT_CONFIGURATION});
});
