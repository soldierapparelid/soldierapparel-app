/* Owner tariff bridge. Fixed scope, grant leaves only; no legacy business IO. */
(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./production-view-client.js'),require('./production-owner-tariff-client.js'),require('./production-owner-tariff-store.js')):factory(root.SoldierProductionViewClient,root.SoldierProductionOwnerTariffClient,root.SoldierProductionOwnerTariffStore);if(typeof module==='object'&&module.exports)module.exports=api;else root.SoldierProductionOwnerTariffBridge=api;})(typeof globalThis!=='undefined'?globalThis:this,function(View,Client,Store){
  'use strict';
  const modules=['potong','jahit','qc','laporan','stok','gaji','hpp','pembelian','nota','retur'];
  const safe=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
  const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return d&&d.enumerable&&Object.hasOwn(d,'value');});
  const rejected=error=>Object.freeze({ok:false,error});
  const disabled=code=>Object.freeze({connect:async()=>rejected(code),view:async()=>rejected(code),prepare:async()=>rejected(code),send:async()=>rejected(code),pending:async()=>rejected(code),dispose(){}});
  function parse(raw){
    const result=JSON.parse(raw),stack=[];
    for(let i=0;i<raw.length;i++){
      const c=raw[i];if(c==='"'){let end=i+1;for(;end<raw.length;end++){if(raw[end]==='\\'){end++;continue;}if(raw[end]==='"')break;}const top=stack.at(-1);if(top&&top.type==='object'&&top.key){const key=JSON.parse(raw.slice(i,end+1));if(top.keys.has(key)||['__proto__','constructor','prototype'].includes(key))throw Error();top.keys.add(key);top.key=false;}i=end;}
      else if(c==='{'||c==='['){stack.push(c==='{'?{type:'object',key:true,keys:new Set()}:{type:'array'});if(stack.length>16)throw Error();}
      else if(c==='}'||c===']')stack.pop();else if(c===','&&stack.at(-1)?.type==='object')stack.at(-1).key=true;
    }return result;
  }
  function createBridge(options={}){
    if(options.enabled!==true)return disabled('service_disabled');
    const {projectId,databaseURL,tenantId,endpointURL,auth,database,sdk,indexedDB,fetch,isCurrent,onClear}=options;
    const timeout=options.requestTimeoutMs===undefined?15000:options.requestTimeoutMs;
    let sessionURL;
    try{
      const d=new URL(databaseURL),e=new URL(endpointURL);
      if(typeof projectId!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)||!safe(tenantId)||typeof databaseURL!=='string'||d.origin!==databaseURL||d.protocol!=='https:'||d.port||d.username||d.password||!/^([a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app)$/.test(d.hostname)||typeof endpointURL!=='string'||e.href!==endpointURL||e.protocol!=='https:'||e.port||e.username||e.password||e.search||e.hash||e.pathname!=='/v1/production/owner/tariffs/append'||!Number.isSafeInteger(timeout)||timeout<100||timeout>60000||typeof isCurrent!=='function'||typeof onClear!=='function'||typeof fetch!=='function')throw Error();
      sessionURL=e.origin+'/v1/production/session';
    }catch{return disabled('unavailable');}
    const initialUser=auth?.currentUser,uid=initialUser?.uid;
    let inactive=false,ready=false,session,scope,opening,authOff,client,store,gateReject,terminal='access_denied';const disposers=[];
    function bound(){return auth?.app?.options?.projectId===projectId&&database?.app?.options?.projectId===projectId&&database.app.options.databaseURL===databaseURL;}
    function current(){try{const user=auth.currentUser;return !inactive&&bound()&&isCurrent()===true&&safe(uid)&&user?.uid===uid&&user.emailVerified===true&&Array.isArray(user.providerData)&&user.providerData.some(p=>p?.providerId==='google.com');}catch{return false;}}
    function stop(code='access_denied'){
      if(inactive)return;terminal=code==='unavailable'?'unavailable':'access_denied';inactive=true;ready=false;
      if(gateReject){const reject=gateReject;gateReject=null;reject(Error());}
      try{client?.dispose();}catch{}try{store?.dispose();}catch{}try{authOff?.();}catch{}
      for(const off of disposers.splice(0))try{off();}catch{}
      try{onClear(terminal);}catch{}
    }
    function live(){return ready&&current();}
    async function textResponse(response){
      if(!response||response.redirected!==false||response.url!==sessionURL||!['basic','cors'].includes(response.type)||!Number.isInteger(response.status)||!response.headers||typeof response.headers.get!=='function'||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')||'')||!response.body||typeof response.body.getReader!=='function')throw Error();
      const length=response.headers.get('content-length');if(length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>65536))throw Error();
      const reader=response.body.getReader(),chunks=[];let size=0,reads=0;
      try{for(;;){if(++reads>65537)throw Error();const part=await reader.read();if(!current()||!part||typeof part.done!=='boolean')throw Error();if(part.done)break;if(!(part.value instanceof Uint8Array)||(size+=part.value.length)>65536)throw Error();chunks.push(part.value);}const bytes=new Uint8Array(size);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.length;}return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{try{await reader.cancel();}catch{}throw Error();}finally{try{reader.releaseLock();}catch{}}
    }
    async function token(){if(!current()||typeof auth.currentUser.getIdToken!=='function')throw Error();const t=await auth.currentUser.getIdToken(true);if(!current()||typeof t!=='string'||t.length>16384||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t))throw Error();return t;}
    async function watchGrant(){
      const p=session.profile,base='authorityTenants/'+tenantId+'/grants/'+uid;
      const expected=new Map([[base+'/profile/active',true],[base+'/profile/owner',true],[base+'/profile/workerId',p.workerId===undefined?null:p.workerId],...modules.map(k=>[base+'/profile/modules/'+k,p.modules?.[k]===undefined?null:p.modules[k]]),[base+'/revision',session.grantRevision]]),seen=new Set();
      let resolveGate;const gate=new Promise((resolve,reject)=>{resolveGate=resolve;gateReject=reject;}),timer=setTimeout(()=>stop('unavailable'),timeout);
      // Attach the rejection handler before synchronous subscription callbacks.
      const observed=gate.then(()=>true,()=>false);
      try{
        for(const [path,value] of expected){
          if(!current())break;
          const reference=sdk.ref(database,path);if(!reference||typeof reference.toString!=='function'||reference.toString()!==databaseURL+'/'+path)throw Error();
          const off=sdk.onValue(reference,snapshot=>{if(inactive)return;try{if(!current())throw Error();if(!snapshot||typeof snapshot.val!=='function'||snapshot.val()!==value){stop();return;}seen.add(path);if(seen.size===expected.size)resolveGate();}catch{stop();}},()=>stop());
          if(typeof off!=='function')throw Error();if(inactive){try{off();}catch{}}else disposers.push(off);
        }
        if(!await observed||!current())throw Error();
      }finally{clearTimeout(timer);gateReject=null;}
    }
    async function connect(){
      if(inactive)return rejected(terminal);if(!current()){stop();return rejected('access_denied');}if(opening)return opening;
      if(live())return Object.freeze({ok:true,scope,profile:session.profile,cycles:session.cycles});
      opening=(async()=>{
        try{
          if(!sdk||['ref','onValue','onAuthStateChanged'].some(k=>typeof sdk[k]!=='function')||!View||typeof View.validateSession!=='function'||!Client||typeof Client.createClient!=='function'||!Store||typeof Store.createStore!=='function')throw Error();
          const off=sdk.onAuthStateChanged(auth,()=>{if(!current())stop();},()=>stop());if(typeof off!=='function')throw Error();if(inactive){off();throw Error();}authOff=off;
          const idToken=await token(),abort=new AbortController(),timer=setTimeout(()=>abort.abort(),timeout);let response,raw;
          try{response=await fetch(sessionURL,{method:'GET',headers:{Authorization:'Bearer '+idToken},credentials:'omit',mode:'cors',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:abort.signal});if(!current())throw Error();raw=await textResponse(response);}finally{clearTimeout(timer);}
          const result=parse(raw);
          if(response.status!==200||!exact(result,['ok','session'])||result.ok!==true){if(exact(result,['ok','error'])&&result.error==='access_denied')stop();throw Error();}
          session=View.validateSession(result.session,{projectId,databaseURL,tenantId,uid});if(session.profile.owner!==true){stop();throw Error();}
          scope=Object.freeze({projectId,databaseURL,tenantId,uid,grantRevision:session.grantRevision});
          await watchGrant();if(!current())throw Error();
          store=Store.createStore({enabled:true,indexedDB,scope,endpointURL,isCurrent:()=>current()});
          client=Client.createClient({enabled:true,scope,endpointURL,isCurrent:()=>current(),getIdToken:token,fetch,journal:{read:store.read,write:store.write,lookup:store.lookup,acknowledge:store.acknowledge}});
          const pending=await client.pending();if(!pending||pending.ok!==true||!current())throw Error();ready=true;
          return Object.freeze({ok:true,scope,profile:session.profile,cycles:session.cycles});
        }catch{const code=inactive?terminal:current()?'unavailable':'access_denied';stop(code);return rejected(code);}
      })().finally(()=>{opening=null;});return opening;
    }
    function known(value){try{const p=Object.getOwnPropertyDescriptor(value,'productId'),c=Object.getOwnPropertyDescriptor(value,'cycleId');return p&&Object.hasOwn(p,'value')&&c&&Object.hasOwn(c,'value')&&session.cycles.some(x=>x.productId===p.value&&x.cycleId===c.value);}catch{return false;}}
    function unavailable(){if(!current()){stop();return rejected(terminal);}return rejected('not_ready');}
    async function forward(task){const result=await task;if(result?.error==='access_denied'||!current()){stop();return rejected('access_denied');}if(!live())return rejected(terminal);return result;}
    return Object.freeze({connect,async view(selection){if(!live())return unavailable();if(!known(selection))return rejected('invalid_request');return forward(client.view(selection));},async prepare(command){if(!live())return unavailable();if(!known(command))return rejected('invalid_request');return forward(client.prepare(command));},async send(requestId){if(!live())return unavailable();return forward(client.send(requestId));},async pending(){if(!live())return unavailable();return forward(client.pending());},dispose:()=>stop()});
  }
  return Object.freeze({createBridge});
});
