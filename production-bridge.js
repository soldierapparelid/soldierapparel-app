/* Disabled canonical browser bridge. No SDK init, credentials or legacy IO. */
(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./production-command-client.js'),require('./production-command-store.js'),require('./production-view-client.js'),require('./legacy-stored-history.js')):factory(root.SoldierProductionCommandClient,root.SoldierProductionCommandStore,root.SoldierProductionViewClient,root.SoldierLegacyStoredHistory);if(typeof module==='object'&&module.exports)module.exports=api;else root.SoldierProductionBridge=api;})(typeof globalThis!=='undefined'?globalThis:this,function(Command,Store,View,History){
  'use strict';
  const safeId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
  const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return d&&d.enumerable&&Object.hasOwn(d,'value');});
  const error=code=>Object.freeze({ok:false,error:code});
  function createProductionBridge(options={}){
    if(options.enabled!==true)return Object.freeze({connect:async()=>error('service_disabled'),prepare:async()=>error('service_disabled'),send:async()=>error('service_disabled'),pending:async()=>error('service_disabled'),readOwnHistory:async()=>error('service_disabled'),dispose(){}});
    let enrollmentEnabled=false,confirmGoogleEnrollment;
    try{
      const flag=Object.getOwnPropertyDescriptor(options,'enrollmentEnabled');
      if(flag&&(!flag.enumerable||!Object.hasOwn(flag,'value')||typeof flag.value!=='boolean'))throw Error();
      enrollmentEnabled=!!flag&&flag.value===true;
      if(enrollmentEnabled){const confirm=Object.getOwnPropertyDescriptor(options,'confirmGoogleEnrollment');if(!confirm||!confirm.enumerable||!Object.hasOwn(confirm,'value')||typeof confirm.value!=='function')throw Error();confirmGoogleEnrollment=confirm.value;}
    }catch{return Object.freeze({connect:async()=>error('unavailable'),prepare:async()=>error('unavailable'),send:async()=>error('unavailable'),pending:async()=>error('unavailable'),dispose(){}});}
    const {projectId,databaseURL,tenantId,endpointURL,auth,database,sdk,indexedDB,fetch,isCurrent,onView,onClear}=options;
    const timeout=options.requestTimeoutMs===undefined?15000:options.requestTimeoutMs;
    let sessionURL,claimURL;
    try{const d=new URL(databaseURL),e=new URL(endpointURL);if(typeof projectId!=='string'||!/^[a-z][a-z0-9-]{3,62}$/.test(projectId)||!safeId(tenantId)||typeof databaseURL!=='string'||d.origin!==databaseURL||d.protocol!=='https:'||d.port||d.username||d.password||!/(^|\.)(firebaseio\.com|firebasedatabase\.app)$/.test(d.hostname)||typeof endpointURL!=='string'||e.href!==endpointURL||e.protocol!=='https:'||e.port||e.username||e.password||e.search||e.hash||e.pathname!=='/v1/production/commands'||!Number.isSafeInteger(timeout)||timeout<100||timeout>60000)throw Error();sessionURL=e.origin+'/v1/production/session';}catch{return Object.freeze({connect:async()=>error('unavailable'),prepare:async()=>error('unavailable'),send:async()=>error('unavailable'),pending:async()=>error('unavailable'),dispose(){}});}
    claimURL=new URL(endpointURL).origin+'/v1/production/enrollment/claim';
    let inactive=false,active=false,ready=false,opening,historyOpening,session,scope,client,view,store,authOff,viewReadyResolve,viewReadyReject,confirmationCancel,requestController,terminalCode='access_denied';
    const initialUser=auth&&auth.currentUser,uid=initialUser&&initialUser.uid;
    function current(){try{return !inactive&&bound()&&isCurrent()===true&&(!enrollmentEnabled||auth.currentUser===initialUser)&&auth.currentUser?.uid===uid&&auth.currentUser.emailVerified===true&&Array.isArray(auth.currentUser.providerData)&&auth.currentUser.providerData.some(p=>p.providerId==='google.com');}catch{return false;}}
    function live(){return active&&current();}
    function stop(code='access_denied'){
      if(inactive)return;terminalCode=['access_denied','account_changed','access_changed','disposed'].includes(code)?'access_denied':'unavailable';inactive=true;active=false;ready=false;
      if(viewReadyReject){const reject=viewReadyReject;viewReadyReject=undefined;reject(Error());}
      try{if(requestController)requestController.abort();}catch{}
      if(confirmationCancel){const cancel=confirmationCancel;confirmationCancel=undefined;cancel(error('access_denied'));}
      try{if(client)client.disable();}catch{}try{if(view)view.dispose();}catch{}try{if(store)store.dispose();}catch{}try{if(authOff)authOff();}catch{}
      try{if(onClear)onClear(code);}catch{}
    }
    function bound(){return auth?.app?.options?.projectId===projectId&&database?.app?.options?.projectId===projectId&&database.app.options.databaseURL===databaseURL;}
    async function textResponse(response,url,maxBytes){
      if(!response||response.redirected!==false||response.url!==url||!['basic','cors'].includes(response.type)||!Number.isInteger(response.status)||!response.headers||typeof response.headers.get!=='function'||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')||'')||!response.body||typeof response.body.getReader!=='function')throw Error();
      const length=response.headers.get('content-length');if(length!==null&&(typeof length!=='string'||!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>maxBytes))throw Error();
      const reader=response.body.getReader(),chunks=[];let bytes=0,reads=0;
      // Fetch exposes decoded bytes; Content-Length may describe gzip/br bytes.
      // Bound both independently rather than comparing their lengths.
      try{for(;;){if(++reads>maxBytes+1)throw Error();const part=await reader.read();if(!current()||!part||typeof part.done!=='boolean')throw Error();if(part.done)break;if(!(part.value instanceof Uint8Array)||(bytes+=part.value.length)>maxBytes)throw Error();chunks.push(part.value);}const all=new Uint8Array(bytes);let offset=0;for(const part of chunks){all.set(part,offset);offset+=part.length;}return new TextDecoder('utf-8',{fatal:true}).decode(all);}catch{try{await reader.cancel();}catch{}throw Error();}finally{try{reader.releaseLock();}catch{}}
    }
    function parse(raw){
      const value=JSON.parse(raw),stack=[];
      for(let i=0;i<raw.length;i++){const c=raw[i];if(c==='"'){let end=i+1;for(;end<raw.length;end++){if(raw[end]==='\\'){end++;continue;}if(raw[end]==='"')break;}const top=stack[stack.length-1];if(top&&top.type==='object'&&top.key){const name=JSON.parse(raw.slice(i,end+1));if(top.keys.has(name)||['__proto__','constructor','prototype'].includes(name))throw Error();top.keys.add(name);top.key=false;}i=end;}else if(c==='{'||c==='['){stack.push(c==='{'?{type:'object',key:true,keys:new Set()}:{type:'array'});if(stack.length>16)throw Error();}else if(c==='}'||c===']')stack.pop();else if(c===','&&stack[stack.length-1]?.type==='object')stack[stack.length-1].key=true;}
      return value;
    }
    async function request(url,method,maxBytes=method==='POST'?1024:65536){
      if(!current())throw Error();const token=await initialUser.getIdToken(true);if(!current())throw Error();
      if(typeof token!=='string'||token.length>16384||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))throw Error();
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);requestController=controller;
      try{
        const response=await fetch(url,{method,headers:{Authorization:'Bearer '+token,...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:'{}'}:{}),credentials:'omit',mode:'cors',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
        if(!current()||controller.signal.aborted)throw Error();const text=await textResponse(response,url,maxBytes);if(!current()||controller.signal.aborted)throw Error();
        return {status:response.status,result:parse(text)};
      }finally{clearTimeout(timer);if(requestController===controller)requestController=undefined;}
    }
    async function connect(){
      if(inactive)return error(terminalCode);if(!current()){stop('access_denied');return error('access_denied');}
      if(opening)return opening;
      if(ready&&live())return Object.freeze({ok:true,cycles:session.cycles,profile:session.profile,scope,...(Object.hasOwn(session,'workerLabels')?{workerLabels:session.workerLabels}:{})});
      opening=(async()=>{
        if(!safeId(uid)||!bound()||!current()||!sdk||typeof sdk.ref!=='function'||typeof sdk.onValue!=='function'||typeof sdk.onAuthStateChanged!=='function'||typeof fetch!=='function'||typeof onView!=='function'||typeof onClear!=='function'||!Command||!Store||!View||typeof auth.currentUser.getIdToken!=='function'){stop('access_denied');return error('access_denied');}
        try{
          const off=sdk.onAuthStateChanged(auth,()=>{if(!current())stop('access_denied');},()=>stop('access_denied'));authOff=off;if(inactive){try{off();}catch{}return error('access_denied');}
          let received=await request(sessionURL,'GET');
          if(enrollmentEnabled&&received.status===429&&exact(received.result,['ok','error'])&&received.result.ok===false&&received.result.error==='rate_limited'){
            // This denial also covers throttled grants. It never identifies an
            // unregistered account or authorizes a client-selected worker.
            const cancelled=new Promise(resolve=>{confirmationCancel=resolve;});
            let confirmation;try{confirmation=await Promise.race([Promise.resolve(confirmGoogleEnrollment()),cancelled]);}finally{confirmationCancel=undefined;}
            if(!current()||!exact(confirmation,['ok'])||confirmation.ok!==true){stop(current()?'unavailable':'access_denied');return error(terminalCode);}
            const claim=await request(claimURL,'POST');
            const accepted=claim.status===200&&exact(claim.result,['ok'])&&claim.result.ok===true;
            if(!accepted){const denied=claim.status===403&&exact(claim.result,['ok','error'])&&claim.result.ok===false&&claim.result.error==='access_denied';stop(denied?'access_denied':'unavailable');return error(terminalCode);}
            // A claim acknowledgement is never a business session. Re-read the
            // canonical grant with a fresh token before opening drafts/views.
            received=await request(sessionURL,'GET');
          }
          const {result,status}=received;
          if(!exact(result,['ok','session'])||result.ok!==true||status!==200){const denied=exact(result,['ok','error'])&&result.ok===false&&result.error==='access_denied';stop(denied?'access_denied':'unavailable');return error(denied?'access_denied':'unavailable');}
          const s=View.validateSession(result.session,{projectId,databaseURL,tenantId,uid});
          scope=Object.freeze({projectId,databaseURL,tenantId,uid,grantRevision:s.grantRevision});
          // The view validator copies/freezes the trusted session before any
          // listener can be opened. Browser fields never manufacture a grant.
          view=View.createViewClient({enabled:true,projectId,databaseURL,tenantId,uid,session:s,isCurrent:()=>live(),subscription:{subscribe(path,value,failed){if(!live())throw Error();const ref=sdk.ref(database,path);if(!ref||typeof ref.toString!=='function'||ref.toString()!==databaseURL+'/'+path)throw Error();return sdk.onValue(ref,snapshot=>value(snapshot.val()),failed);}},onView:value=>{if(live()){onView(value);if(value.complete===true&&viewReadyResolve)viewReadyResolve();}},onClear:code=>{if(code==='loading'){try{onClear(code);}catch{stop('callback_failed');}}else stop(code);}});
          session=JSON.parse(JSON.stringify(s));const freeze=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};freeze(session);
          active=true;
          store=Store.createCommandStore({enabled:true,indexedDB,scope,endpointURL,retention:true,isCurrent:()=>live()});
          client=Command.createClient({enabled:true,scope,endpointURL,isCurrent:()=>live(),getSession:()=>live()?scope:null,getIdToken:async()=>{if(!live())throw Error();const t=await initialUser.getIdToken(true);if(!live())throw Error();return t;},fetch,journal:{read:store.read,write:store.write,lookup:store.lookup,acknowledge:store.acknowledge}});
          const pending=await client.pending();if(!pending.ok||!live())throw Error();
          const viewsReady=new Promise((resolve,reject)=>{viewReadyResolve=resolve;viewReadyReject=reject;}),viewTimer=setTimeout(()=>stop('unavailable'),timeout);
          try{if(!view.start())stop('unavailable');await viewsReady;if(!live())return error(terminalCode);ready=true;}finally{clearTimeout(viewTimer);viewReadyResolve=undefined;viewReadyReject=undefined;}
          return Object.freeze({ok:true,cycles:session.cycles,profile:session.profile,scope,...(Object.hasOwn(session,'workerLabels')?{workerLabels:session.workerLabels}:{})});
        }catch{const code=inactive?terminalCode:current()?'unavailable':'access_denied';stop(code);return error(code);}
      })().finally(()=>{opening=null;});return opening;
    }
    function known(command){try{const p=Object.getOwnPropertyDescriptor(command,'productId'),c=Object.getOwnPropertyDescriptor(command,'cycleId');return p&&Object.hasOwn(p,'value')&&c&&Object.hasOwn(c,'value')&&session.cycles.some(x=>x.productId===p.value&&x.cycleId===c.value);}catch{return false;}}
    async function readOwnHistory(...selectors){
      if(selectors.length)return error('invalid_request');if(!live()||!ready)return error(inactive?'access_denied':'not_ready');
      const p=session.profile,keys=p.modules&&Object.keys(p.modules).filter(k=>p.modules[k]===true);
      if(p.owner!==false||p.active!==true||!safeId(p.workerId)||!keys||keys.length!==1||!['jahit','potong'].includes(keys[0])||!History)return error('access_denied');
      if(historyOpening)return error('busy');historyOpening=true;
      try{
        const received=await request(new URL(endpointURL).origin+'/v1/production/history/own','GET',History.LIMITS.viewBytes+128);if(!live()||!ready)return error('access_denied');
        const r=received.result;
        if(received.status===200&&exact(r,['ok','view'])&&r.ok===true){const binding={projectId,databaseURL,tenantId,uid,workerId:p.workerId,division:keys[0],grantRevision:scope.grantRevision},normalized=History.normalizeLegacyStoredHistory(r.view,binding);if(!live()||!ready)return error('access_denied');return Object.freeze({ok:true,view:normalized});}
        if(exact(r,['ok','error'])&&r.ok===false){if(received.status===403&&r.error==='access_denied'){stop('access_denied');return error('access_denied');}if(received.status===429&&r.error==='rate_limited')return error('rate_limited');if(received.status===409&&['not_ready','capacity_limit'].includes(r.error))return error(r.error);if(received.status===400&&r.error==='invalid_request')return error('not_ready');if(received.status===503&&['service_disabled','unavailable'].includes(r.error))return error('unavailable');}
        stop('unavailable');return error('unavailable');
      }catch{if(!live())return error('access_denied');stop('unavailable');return error('unavailable');}finally{historyOpening=false;}
    }
    return Object.freeze({connect,readOwnHistory,async prepare(command){if(!live()){if(opening&&current())return error('not_ready');stop();return error('access_denied');}if(!ready)return error('not_ready');if(!known(command))return error('invalid_request');return client.prepare(command);},async send(requestId){if(!live()){if(opening&&current())return error('not_ready');stop();return error('access_denied');}if(!ready)return error('not_ready');return client.send(requestId);},async pending(){if(!live()){if(opening&&current())return error('not_ready');stop();return error('access_denied');}if(!ready)return error('not_ready');return client.pending();},dispose:()=>stop('access_denied')});
  }
  return Object.freeze({createProductionBridge});
});
