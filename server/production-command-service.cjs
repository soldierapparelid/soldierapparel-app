'use strict';
// Disabled, injected service boundary. No SDK initialization, credentials,
// HTTP endpoint, legacy writes or unfenced Admin transaction fallback exists.
const Authority=require('./production-authority.cjs');
const CONTRACT='soldier-atomic-trust-fence-v1',MAX_REQUEST_BYTES=32768;
const modules=new Set(['potong','jahit','qc','laporan','stok','gaji','hpp','pembelian','nota','retur']);
const safeId=v=>typeof v==='string'&&v.length>0&&v.length<=128&&!['__proto__','constructor','prototype'].includes(v)&&/^[A-Za-z0-9_-]+$/.test(v);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
class BoundaryError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new BoundaryError(code);};
function json(value,depth=0,seen=new Set(),budget={nodes:0}){
  if(++budget.nodes>500000||depth>64)fail('invalid_request');
  if(value===null||['string','boolean'].includes(typeof value))return;
  if(typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER)return;
  if(!value||typeof value!=='object'||seen.has(value)||(Array.isArray(value)?Object.getPrototypeOf(value)!==Array.prototype:![Object.prototype,null].includes(Object.getPrototypeOf(value))))fail('invalid_request');
  seen.add(value);const keys=Reflect.ownKeys(value);
  for(const key of keys){
    if(typeof key!=='string'||['__proto__','constructor','prototype'].includes(key))fail('invalid_request');
    if(Array.isArray(value)&&key==='length')continue;
    const d=Object.getOwnPropertyDescriptor(value,key);
    if(!d||!d.enumerable||!Object.hasOwn(d,'value')||Array.isArray(value)&&(!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=value.length))fail('invalid_request');
    json(d.value,depth+1,seen,budget);
  }
  if(Array.isArray(value)&&keys.length!==value.length+1)fail('invalid_request');seen.delete(value);
}
function exact(value,required,optional=[]){if(!object(value)||required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>!required.includes(k)&&!optional.includes(k)))fail('unavailable');}
const same=(a,b)=>canonical(a)===canonical(b);
function canonical(v){return Array.isArray(v)?'['+v.map(canonical).join(',')+']':object(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);}
function copy(v){return JSON.parse(JSON.stringify(v));}
function integer(v){if(!Number.isSafeInteger(v)||v<0)fail('unavailable');}
function scope(value,projectId,productId,cycleId){
  if(value.projectId!==projectId||productId!==undefined&&value.productId!==productId||cycleId!==undefined&&value.cycleId!==cycleId)fail('access_denied');
}
function identity(token,projectId,now){
  json(token);if(!object(token)||!safeId(token.uid)||token.sub!==token.uid||token.aud!==projectId||token.iss!=='https://securetoken.google.com/'+projectId||token.email_verified!==true||!object(token.firebase)||token.firebase.sign_in_provider!=='google.com'||!Number.isSafeInteger(token.exp)||token.exp*1000<=Date.parse(now))fail('access_denied');
  return token.uid;
}
function grant(value,projectId,uid){
  json(value);exact(value,['projectId','uid','revision','profile']);scope(value,projectId);if(value.uid!==uid)fail('access_denied');integer(value.revision);
  const p=value.profile;exact(p,['active','owner'],['workerId','modules']);
  if(p.active!==true||typeof p.owner!=='boolean'||p.workerId!==undefined&&!safeId(p.workerId))fail('access_denied');
  if(p.modules!==undefined&&(!object(p.modules)||Object.keys(p.modules).some(k=>!modules.has(k)||typeof p.modules[k]!=='boolean')))fail('access_denied');
  return copy(value);
}
function config(value){
  json(value);exact(value,['revision','active','reviewedEmptyCycle','tariffPolicy']);integer(value.revision);
  if(value.active!==true||value.reviewedEmptyCycle!==true||value.tariffPolicy!=='explicit-historical-jakarta-v1')fail('not_ready');return copy(value);
}
function cycle(value,projectId,command){
  json(value);exact(value,['projectId','productId','cycleId','config','wire']);scope(value,projectId,command.productId,command.cycleId);
  const currentConfig=config(value.config),state=Authority.decodeStorage(value.wire);
  if(state.productId!==command.productId||state.cycleId!==command.cycleId)fail('access_denied');return {config:currentConfig,state};
}
function tariff(value,projectId){json(value);exact(value,['projectId','revision','selection']);scope(value,projectId);integer(value.revision);return copy(value);}
function context(uid,profile,now,command,selected){
  const out={uid,emailVerified:true,provider:'google.com',profile,now};if(selected)out.selectedTariffs={[command.payload.id]:selected.selection};return out;
}
function code(error){
  if(error instanceof BoundaryError)return error.code;
  if(error instanceof Authority.AuthorityError){
    if(error.code==='access_denied')return 'access_denied';
    if(['invalid_command','unsupported_command'].includes(error.code))return 'invalid_request';
    if(['stale_revision','request_id_conflict'].includes(error.code))return 'conflict';
    if(['state_capacity','storage_capacity','money_overflow','quantity_overflow'].includes(error.code))return 'capacity_limit';
    return 'not_ready';
  }
  return 'unavailable';
}
const rejected=reason=>Object.freeze({ok:false,error:reason});
function createProductionCommandService(options={}){
  const {projectId,auth,repository,gateway,admit,clock}=options;
  const enabled=options.enabled===true,maxAttempts=options.maxAttempts===undefined?3:options.maxAttempts;
  const configured=typeof projectId==='string'&&/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)&&auth&&typeof auth.verifyIdToken==='function'&&repository&&['readGrant','readCycle','selectTariff'].every(k=>typeof repository[k]==='function')&&gateway&&gateway.contract===CONTRACT&&gateway.projectId===projectId&&typeof gateway.run==='function'&&typeof admit==='function'&&typeof clock==='function'&&Number.isSafeInteger(maxAttempts)&&maxAttempts>=1&&maxAttempts<=5;
  async function execute(request){
    if(!enabled)return rejected('service_disabled');if(!configured)return rejected('unavailable');
    try{
      json(request);if(!object(request)||Object.keys(request).length!==2||!Object.hasOwn(request,'idToken')||!Object.hasOwn(request,'command')||typeof request.idToken!=='string'||!request.idToken||request.idToken.length>16384||/[\r\n]/.test(request.idToken)||Buffer.byteLength(JSON.stringify(request.command),'utf8')>MAX_REQUEST_BYTES)fail('invalid_request');
      const command=copy(request.command);
      if(!object(command)||!safeId(command.productId)||!safeId(command.cycleId))fail('invalid_request');
      const now=clock();if(typeof now!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(now)||Number.isNaN(Date.parse(now))||new Date(now).toISOString()!==now)fail('unavailable');
      let pinned=null,admitted=false;
      for(let attempt=0;attempt<maxAttempts;attempt++){
        // checkRevoked=true is mandatory; token/profile claims never grant access.
        let verified;try{verified=await auth.verifyIdToken(request.idToken,true);}catch{fail('access_denied');}
        const uid=identity(verified,projectId,now);
        if(!admitted){if(await admit({projectId,uid})!==true)fail('rate_limited');admitted=true;}
        const observed=await Promise.all([repository.readGrant({projectId,uid}),repository.readCycle({projectId,productId:command.productId,cycleId:command.cycleId})]);
        const currentGrant=grant(observed[0],projectId,uid),currentCycle=cycle(observed[1],projectId,command);
        if(pinned&&(!same(currentGrant,pinned.grant)||uid!==pinned.uid))fail('access_denied');
        if(pinned&&!same(currentCycle.config,pinned.cycleConfig))fail('conflict');
        let selected=null,preflight;
        try{preflight=Authority.applyCommand(currentCycle.state,context(uid,currentGrant.profile,now,command),command);}
        catch(error){
          if(!(error instanceof Authority.AuthorityError)||error.code!=='frozen_tariff_required'||command.kind!=='count')throw error;
          const assignment=currentCycle.state.assignments[command.payload.assignmentId];
          selected=tariff(await repository.selectTariff({projectId,productId:command.productId,cycleId:command.cycleId,workerId:assignment.workerId,countId:command.payload.id,workDate:command.payload.tanggal,selectedAt:now}),projectId);
          preflight=Authority.applyCommand(currentCycle.state,context(uid,currentGrant.profile,now,command,selected),command);
        }
        // Once already accepted, its frozen receipt survives later catalog
        // changes. A fresh command must not reprice itself across retries.
        if(pinned&&selected&&!same(selected,pinned.tariff))fail('conflict');
        const trust={projectId,uid,grant:currentGrant,cycleConfig:currentCycle.config,tariff:selected};
        if(!pinned)pinned=copy(trust);
        let terminal=null,candidate=null,calls=0,refreshRequired=false;
        const transaction=await gateway.run({projectId,productId:command.productId,cycleId:command.cycleId,expectedTrust:copy(trust),update:(wire,live)=>{
          calls++;if(terminal)return undefined;
          // A synchronous SDK callback cannot recheck Auth revocation. Abort
          // every internal retry and restart outside it with fresh trusted
          // reads and verifyIdToken(..., true), instead of caching identity.
          if(calls>1){refreshRequired=true;candidate=null;return undefined;}
          try{
            json(live);exact(live,['projectId','uid','grant','cycleConfig','tariff']);scope(live,projectId);
            const liveGrant=grant(live.grant,projectId,uid),liveConfig=config(live.cycleConfig);
            if(live.uid!==uid||!same(liveGrant,currentGrant))fail('access_denied');
            if(!same(liveConfig,currentCycle.config))fail('conflict');
            if(selected){const liveTariff=tariff(live.tariff,projectId);if(!same(liveTariff,selected))fail('conflict');}
            else if(live.tariff!==null)fail('unavailable');
            const state=Authority.decodeStorage(wire);if(state.productId!==command.productId||state.cycleId!==command.cycleId)fail('access_denied');
            candidate=Authority.applyCommand(state,context(uid,liveGrant.profile,now,command,selected),command);
            return Authority.encodeStorage(candidate.state);
          }catch(error){terminal=code(error);return undefined;}
        }});
        // The gateway must return its actual committed snapshot, never a
        // speculative local update. No raw dependency errors escape this call.
        if(terminal)fail(terminal);json(transaction);exact(transaction,['committed','retryable'],['wire']);
        if(typeof transaction.committed!=='boolean'||typeof transaction.retryable!=='boolean')fail('unavailable');
        if(transaction.committed){
          if(transaction.retryable||!calls||!candidate||!Object.hasOwn(transaction,'wire'))fail('unavailable');
          const committed=Authority.decodeStorage(transaction.wire);
          const acknowledged=Authority.applyCommand(committed,context(uid,currentGrant.profile,now,command),command);
          if(!acknowledged.replayed||!same(acknowledged.receipt,candidate.receipt))fail('unavailable');
          const r=acknowledged.receipt;
          return Object.freeze({ok:true,receipt:Object.freeze({requestId:r.requestId,revision:r.revision,acceptedAt:r.acceptedAt}),replayed:candidate.replayed});
        }
        if(Object.hasOwn(transaction,'wire'))fail('unavailable');
        if(!refreshRequired&&!transaction.retryable)fail('unavailable');
      }
      return rejected('conflict');
    }catch(error){return rejected(code(error));}
  }
  return Object.freeze({execute});
}
module.exports=Object.freeze({createProductionCommandService,contract:CONTRACT});
