/* Read-only owner wages bridge. Fixed binding; no writer, cache or legacy IO. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./production-view-client.js'),require('./production-owner-wage-client.js'));
  else root.SoldierProductionOwnerWageBridge=factory(root.SoldierProductionViewClient,root.SoldierProductionOwnerWageClient);
})(typeof globalThis!=='undefined'?globalThis:this,function(View,Client){
  'use strict';
  const modules=['potong','jahit','qc','laporan','stok','gaji','hpp','pembelian','nota','retur'];
  const transient=new Set(['loading','selection_changed','selection_cleared']);
  const clientCodes=new Set([...transient,'not_ready','account_changed','access_changed','read_failed','invalid_view','callback_failed','disposed']);
  const required=['enabled','projectId','databaseURL','tenantId','endpointURL','auth','database','sdk','fetch','isCurrent','onCatalog','onView','onClear'];
  const safe=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
  const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
  function exact(value,keys){return plain(value)&&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>{const d=Object.getOwnPropertyDescriptor(value,key);return d&&d.enumerable&&Object.hasOwn(d,'value');});}
  const rejected=error=>Object.freeze({ok:false,error}),accepted=()=>Object.freeze({ok:true});
  const disabled=error=>Object.freeze({connect:async()=>rejected(error),select:()=>rejected(error),clearSelection:()=>rejected(error),dispose(){}});
  function parse(raw){
    const stack=[];
    for(let i=0;i<raw.length;i++){
      const c=raw[i];
      if(c==='"'){
        let end=i+1;for(;end<raw.length;end++){if(raw[end]==='\\'){end++;continue;}if(raw[end]==='"')break;}if(end>=raw.length)throw Error();
        const top=stack.at(-1);if(top?.object&&top.key){const key=JSON.parse(raw.slice(i,end+1));if(top.keys.has(key)||['__proto__','constructor','prototype'].includes(key))throw Error();top.keys.add(key);top.key=false;}i=end;
      }else if(c==='{'||c==='['){stack.push(c==='{'?{object:true,key:true,keys:new Set()}:{object:false});if(stack.length>16)throw Error();}
      else if(c==='}'||c===']')stack.pop();else if(c===','&&stack.at(-1)?.object)stack.at(-1).key=true;
    }
    return JSON.parse(raw);
  }
  function createBridge(options={}){
    // OFF inspects only the own data descriptor, never any option getter.
    let enabled;try{enabled=options&&Object.getOwnPropertyDescriptor(options,'enabled');}catch{}
    if(!enabled||!Object.hasOwn(enabled,'value')||enabled.value!==true)return disabled('service_disabled');
    let values;
    try{
      if(!plain(options)||Reflect.ownKeys(options).some(k=>typeof k!=='string'||![...required,'requestTimeoutMs'].includes(k)))throw Error();values={};
      for(const key of required){const d=Object.getOwnPropertyDescriptor(options,key);if(!d||!d.enumerable||!Object.hasOwn(d,'value'))throw Error();values[key]=d.value;}
      const d=Object.getOwnPropertyDescriptor(options,'requestTimeoutMs');if(d&&(!d.enumerable||!Object.hasOwn(d,'value')))throw Error();values.timeout=d?d.value:15000;
    }catch{return disabled('unavailable');}
    const {projectId,databaseURL,tenantId,endpointURL,auth,database,sdk,fetch,isCurrent,onCatalog,onView,onClear,timeout}=values;
    try{
      const d=new URL(databaseURL),e=new URL(endpointURL);
      if(typeof projectId!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)||!safe(tenantId)||typeof databaseURL!=='string'||d.origin!==databaseURL||d.protocol!=='https:'||d.port||d.username||d.password||!/^([a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app)$/.test(d.hostname)||typeof endpointURL!=='string'||e.href!==endpointURL||e.protocol!=='https:'||e.port||e.username||e.password||e.search||e.hash||e.pathname!=='/v1/production/session'||!Number.isSafeInteger(timeout)||timeout<100||timeout>60000||[fetch,isCurrent,onCatalog,onView,onClear].some(fn=>typeof fn!=='function')||!plain(sdk)||['ref','onValue','onAuthStateChanged'].some(k=>typeof Object.getOwnPropertyDescriptor(sdk,k)?.value!=='function')||typeof View?.validateSession!=='function'||typeof Client?.createOwnerWageClient!=='function')throw Error();
    }catch{return disabled('unavailable');}
    let initialUser,initialApp,uid;try{initialUser=auth.currentUser;initialApp=auth.app;uid=initialUser.uid;}catch{return disabled('access_denied');}
    const grant='authorityTenants/'+tenantId+'/grants/'+uid;
    const grantPaths=new Set([grant+'/revision',...['active','owner','workerId'].map(k=>grant+'/profile/'+k),...modules.map(k=>grant+'/profile/modules/'+k)]);
    let inactive=false,ready=false,terminal='access_denied',opening,authOff,client,scope,session,catalog,selection=null,selectionEpoch=0,changing=false,abort,reader,rejectOpening,resolveCatalog,rejectCatalog;
    const subscriptions=new Set();
    function bound(){return auth.app===initialApp&&database.app===initialApp&&initialApp?.options?.projectId===projectId&&initialApp.options.databaseURL===databaseURL;}
    function current(){
      if(inactive)return false;
      try{const user=auth.currentUser;return bound()&&isCurrent()===true&&safe(uid)&&user===initialUser&&user.uid===uid&&user.emailVerified===true&&Array.isArray(user.providerData)&&user.providerData.some(p=>p?.providerId==='google.com');}catch{return false;}
    }
    function stop(code='access_denied'){
      if(inactive)return;inactive=true;ready=false;terminal=['access_denied','account_changed','access_changed','disposed'].includes(code)?'access_denied':'unavailable';selection=null;selectionEpoch++;scope=null;session=null;catalog=null;
      try{abort?.abort();}catch{}if(reader)try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}
      rejectOpening?.(Error());rejectCatalog?.(Error());rejectOpening=null;rejectCatalog=null;resolveCatalog=null;
      // Clear financial UI synchronously before disposal can yield/throw.
      try{onClear(code);}catch{}
      try{client?.dispose();}catch{}try{authOff?.();}catch{}authOff=null;
      for(const off of [...subscriptions])try{off();}catch{}subscriptions.clear();
    }
    function live(){return ready&&current();}
    function clearFromClient(code){
      if(inactive)return;if(!clientCodes.has(code)){stop('unavailable');return;}if(!current()){stop('account_changed');return;}
      if(!transient.has(code)){stop(code);return;}
      if(code==='selection_cleared')selection=null;
      try{onClear(code);}catch{stop('callback_failed');}
    }
    function allowedPath(path){
      if(typeof path!=='string')return false;if(grantPaths.has(path))return true;if(!selection)return false;
      const base='authorityTenants/'+tenantId+'/products/'+selection.productId+'/cycles/'+selection.cycleId+'/wire/projection/';
      return path===base+'operations'||path===base+'revision'||path===base+'earningsByWorker/'+selection.workerId;
    }
    function subscribe(path,receive,failed){
      if(!current()||!allowedPath(path)||typeof receive!=='function'||typeof failed!=='function')throw Error();
      const grantRead=grantPaths.has(path),epoch=selectionEpoch,reference=sdk.ref(database,path);
      if(!reference||typeof reference.toString!=='function'||reference.toString()!==databaseURL+'/'+path)throw Error();
      let removed=false,handle;
      const off=()=>{if(removed)return;removed=true;subscriptions.delete(off);try{handle?.();}catch{}};
      handle=sdk.onValue(reference,snapshot=>{
        if(removed||inactive||!grantRead&&epoch!==selectionEpoch)return;
        if(!current()){stop('account_changed');return;}
        try{if(!allowedPath(path)||!snapshot||typeof snapshot.val!=='function')throw Error();receive(snapshot.val());}catch{try{failed();}catch{stop('read_failed');}}
      },()=>{if(removed||inactive||!grantRead&&epoch!==selectionEpoch)return;try{failed();}catch{stop('read_failed');}});
      if(typeof handle!=='function'){removed=true;throw Error();}if(inactive){off();throw Error();}subscriptions.add(off);return off;
    }
    async function textResponse(response){
      if(!response||response.redirected!==false||response.url!==endpointURL||!['basic','cors'].includes(response.type)||!Number.isInteger(response.status)||!response.headers||typeof response.headers.get!=='function'||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')||'')||!response.body||typeof response.body.getReader!=='function')throw Error();
      const length=response.headers.get('content-length');if(length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>65536))throw Error();
      reader=response.body.getReader();const activeReader=reader,chunks=[];let bytes=0,reads=0;
      try{
        for(;;){if(++reads>65537||!current())throw Error();const part=await activeReader.read();if(!current()||!part||typeof part.done!=='boolean')throw Error();if(part.done)break;if(!(part.value instanceof Uint8Array)||(bytes+=part.value.length)>65536)throw Error();chunks.push(part.value);}
        const raw=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);
      }catch{try{Promise.resolve(activeReader.cancel()).catch(()=>{});}catch{}throw Error();}finally{if(reader===activeReader)reader=null;try{activeReader.releaseLock();}catch{}}
    }
    async function initialize(){
      if(!current())throw Error();
      const off=sdk.onAuthStateChanged(auth,user=>{if(user!==initialUser||!current())stop('account_changed');},()=>stop('access_denied'));
      if(typeof off!=='function')throw Error();if(inactive){try{off();}catch{}throw Error();}authOff=off;
      const idToken=await initialUser.getIdToken(true);if(!current()||typeof idToken!=='string'||idToken.length>16384||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(idToken))throw Error();
      const response=await fetch(endpointURL,{method:'GET',headers:{Authorization:'Bearer '+idToken},credentials:'omit',mode:'cors',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:abort.signal});if(!current())throw Error();
      const result=parse(await textResponse(response));if(!current())throw Error();
      if(response.status!==200||!exact(result,['ok','session'])||result.ok!==true){if(response.status===403&&exact(result,['ok','error'])&&result.ok===false&&result.error==='access_denied')stop('access_denied');throw Error();}
      session=View.validateSession(result.session,{projectId,databaseURL,tenantId,uid});if(session.profile.owner!==true){stop('access_denied');throw Error();}
      scope=Object.freeze({projectId,databaseURL,tenantId,uid,grantRevision:session.grantRevision});
      const gate=new Promise((resolve,reject)=>{resolveCatalog=resolve;rejectCatalog=reject;}),observed=gate.then(value=>value,()=>null);
      client=Client.createOwnerWageClient({enabled:true,projectId,databaseURL,tenantId,uid,session,subscription:{subscribe},isCurrent:()=>current(),onCatalog:value=>{
        if(inactive)return;if(!current()){stop('account_changed');return;}catalog=value;ready=true;
        try{onCatalog(value);}catch{stop('callback_failed');return;}resolveCatalog?.(value);
      },onView:value=>{if(inactive)return;if(!live()){stop('account_changed');return;}try{onView(value);}catch{stop('callback_failed');}},onClear:clearFromClient});
      if(!['start','select','clearSelection','dispose'].every(k=>typeof client?.[k]==='function')||client.start()!==true)throw Error();
      if(!await observed||!live())throw Error();return Object.freeze({ok:true,scope,profile:session.profile,catalog});
    }
    async function connect(){
      if(inactive)return rejected(terminal);if(!current()){stop('access_denied');return rejected(terminal);}if(opening)return opening;if(live())return Object.freeze({ok:true,scope,profile:session.profile,catalog});
      opening=(async()=>{
        let timer;try{
          abort=new AbortController();const deadline=new Promise((_,reject)=>{rejectOpening=reject;timer=setTimeout(()=>stop('unavailable'),timeout);});
          return await Promise.race([initialize(),deadline]);
        }catch{const code=inactive?terminal:current()?'unavailable':'access_denied';stop(code);return rejected(terminal);}finally{clearTimeout(timer);rejectOpening=null;rejectCatalog=null;resolveCatalog=null;abort=null;}
      })().finally(()=>{opening=null;});return opening;
    }
    function unavailable(){if(!current()){stop('access_denied');return rejected(terminal);}return rejected('not_ready');}
    function select(value){
      if(changing)return rejected('not_ready');if(!live())return unavailable();changing=true;
      try{
        selectionEpoch++;selection=null;
        if(!exact(value,['productId','cycleId','workerId'])||!['productId','cycleId','workerId'].every(k=>safe(value[k]))){try{client.clearSelection();}catch{stop('unavailable');}return inactive?rejected(terminal):rejected('invalid_request');}
        selection=Object.freeze({productId:value.productId,cycleId:value.cycleId,workerId:value.workerId});
        let result;try{result=client.select(selection);}catch{stop('unavailable');return rejected(terminal);}if(inactive)return rejected(terminal);if(!current()){stop('access_denied');return rejected(terminal);}if(result!==true){selection=null;return rejected('invalid_request');}return accepted();
      }finally{changing=false;}
    }
    function clearSelection(){
      if(changing)return rejected('not_ready');if(!live())return unavailable();changing=true;try{selectionEpoch++;selection=null;try{if(client.clearSelection()!==true)return inactive?rejected(terminal):rejected('not_ready');}catch{stop('unavailable');return rejected(terminal);}return inactive?rejected(terminal):accepted();}finally{changing=false;}
    }
    return Object.freeze({connect,select,clearSelection,dispose:()=>stop('disposed')});
  }
  return Object.freeze({createBridge});
});
