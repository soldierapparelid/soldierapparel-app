'use strict';
// Disabled transport boundary. No listener, SDK init, credential or deployment.
const {TextDecoder}=require('node:util');
const TariffLedger=require('./production-tariff-ledger.cjs');
const MAX_BODY=32768,MAX_TOKEN=16384;
const allowedErrors=new Map([['access_denied',403],['invalid_request',400],['conflict',409],['draft_retired',409],['not_ready',409],['capacity_limit',409],['rate_limited',429],['service_disabled',503],['unavailable',503]]);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
function fields(v,keys){if(!object(v)||Reflect.ownKeys(v).length!==keys.length)return false;return keys.every(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return d&&d.enumerable&&Object.hasOwn(d,'value');});}
function origin(value){if(typeof value!=='string')return false;try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.origin===value;}catch{return false;}}
function decode(raw,field='command'){
  const text=new TextDecoder('utf-8',{fatal:true}).decode(raw),parsed=JSON.parse(text),stack=[];
  // JSON.parse accepts duplicate keys. Reject them, including escaped aliases,
  // before the last value could silently replace the submitted command.
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){
      let end=i+1;for(;end<text.length;end++){if(text[end]==='\\'){end++;continue;}if(text[end]==='"')break;}
      const top=stack[stack.length-1];
      if(top&&top.type==='object'&&top.key){const name=JSON.parse(text.slice(i,end+1));if(top.keys.has(name)||['__proto__','constructor','prototype'].includes(name))throw Error('invalid_request');top.keys.add(name);top.key=false;}
      i=end;
    }else if(c==='{'||c==='['){stack.push(c==='{'?{type:'object',key:true,keys:new Set()}:{type:'array'});if(stack.length>64)throw Error('invalid_request');}
    else if(c==='}'||c===']')stack.pop();
    else if(c===','&&stack[stack.length-1]?.type==='object')stack[stack.length-1].key=true;
  }
  if(field===null){if(!fields(parsed,[]))throw Error('invalid_request');return parsed;}
  if(!fields(parsed,[field])||!object(parsed[field]))throw Error('invalid_request');return parsed[field];
}
const safeId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
const safeInteger=(v,min=0)=>Number.isSafeInteger(v)&&v>=min;
const instant=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString()===v;
const dense=(a,max)=>Array.isArray(a)&&Object.getPrototypeOf(a)===Array.prototype&&a.length<=max&&Reflect.ownKeys(a).length===a.length+1&&Reflect.ownKeys(a).every(k=>k==='length'||typeof k==='string'&&/^(0|[1-9][0-9]*)$/.test(k)&&Number(k)<a.length&&Object.getOwnPropertyDescriptor(a,k)?.enumerable&&Object.hasOwn(Object.getOwnPropertyDescriptor(a,k),'value'));
function validOwnerTariffResult(result,selection,binding){
  if(!fields(result,['ok','view'])||result.ok!==true||!fields(result.view,['schemaVersion','projectId','tenantId','uid','grantRevision','productId','cycleId','configRevision','tariffRevision','serverTime','policy','workers']))return false;
  const v=result.view,p=v.policy;
  if(v.schemaVersion!==1||v.projectId!==binding.projectId||v.tenantId!==binding.tenantId||!safeId(v.uid)||!safeInteger(v.grantRevision)||v.productId!==selection.productId||v.cycleId!==selection.cycleId||!safeInteger(v.configRevision)||!safeInteger(v.tariffRevision)||!instant(v.serverTime)||!fields(p,['version','kind','hour','minute'])||!safeId(p.version)||p.kind!=='jakarta-fixed-local-time'||!safeInteger(p.hour)||p.hour>23||!safeInteger(p.minute)||p.minute>59||!dense(v.workers,128)||!v.workers.length)return false;
  let priorWorker='',count=0,totalQuantity=0;
  for(const w of v.workers){
    if(!fields(w,['workerId','label','assignedQuantity','history'])||!safeId(w.workerId)||w.workerId<=priorWorker||typeof w.label!=='string'||!w.label||w.label.trim()!==w.label||w.label.length>256||/[\u0000-\u001f\u007f-\u009f]/.test(w.label)||!safeInteger(w.assignedQuantity,1)||!dense(w.history,512)||!w.history.length)return false;
    priorWorker=w.workerId;totalQuantity+=w.assignedQuantity;if(!Number.isSafeInteger(totalQuantity))return false;
    const versions=new Set();let priorTime='';
    for(const h of w.history){
      if(++count>512||!fields(h,['tariffVersion','effectiveAt','currency','rate'])||!safeId(h.tariffVersion)||versions.has(h.tariffVersion)||!instant(h.effectiveAt)||h.effectiveAt<=priorTime||h.currency!=='IDR'||!safeInteger(h.rate,1)||!Number.isSafeInteger(w.assignedQuantity*h.rate))return false;
      versions.add(h.tariffVersion);priorTime=h.effectiveAt;
    }
  }
  return Buffer.byteLength(JSON.stringify(result),'utf8')<=65536;
}
function validOwnerAppendResult(result,command){
  if(!fields(result,['ok','receipt','replayed'])||result.ok!==true||typeof result.replayed!=='boolean'||!fields(result.receipt,['requestId','kind','productId','cycleId','workerId','tariffVersion','revision','acceptedAt']))return false;
  const r=result.receipt;
  return ['requestId','kind','productId','cycleId','workerId','tariffVersion'].every(k=>r[k]===command[k])&&safeInteger(r.revision,1)&&r.revision===command.expectedTariffRevision+1&&instant(r.acceptedAt)&&r.acceptedAt<=command.effectiveAt;
}
function validOwnerResolveResult(result,command){
  if(!fields(result,['ok','outcome','receipt','replayed'])||result.ok!==true||typeof result.replayed!=='boolean')return false;
  if(result.outcome==='accepted')return result.replayed===true&&validOwnerAppendResult({ok:true,receipt:result.receipt,replayed:true},command);
  if(result.outcome!=='retired'||!fields(result.receipt,['requestId','kind','productId','cycleId','workerId','tariffVersion','retiredAt']))return false;
  const r=result.receipt;
  return r.kind==='retireTariffDraft'&&['requestId','productId','cycleId','workerId','tariffVersion'].every(k=>r[k]===command[k])&&instant(r.retiredAt);
}
function validResult(result,command){
  if(!fields(result,['ok','receipt','replayed'])||result.ok!==true||typeof result.replayed!=='boolean'||!fields(result.receipt,['requestId','revision','acceptedAt']))return false;
  const r=result.receipt;return r.requestId===command.requestId&&typeof r.requestId==='string'&&Number.isSafeInteger(r.revision)&&r.revision>=1&&typeof r.acceptedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.acceptedAt)&&!Number.isNaN(Date.parse(r.acceptedAt))&&new Date(r.acceptedAt).toISOString()===r.acceptedAt;
}
function validRevocationCommand(command){
  const keys=['requestId','approvalId','expectedApprovalRevision'];
  return [keys,[...keys,'expectedGrantRevision']].some(k=>fields(command,k))&&safeId(command.requestId)&&safeId(command.approvalId)&&safeInteger(command.expectedApprovalRevision,1)&&(!Object.hasOwn(command,'expectedGrantRevision')||safeInteger(command.expectedGrantRevision,1));
}
function validRevocationResult(result,command,resolving){
  const keys=['ok','replayed','approvalRevision'],hasGrant=Object.hasOwn(command,'expectedGrantRevision');
  return fields(result,hasGrant?[...keys,'grantRevision']:keys)&&result.ok===true&&typeof result.replayed==='boolean'&&(!resolving||result.replayed===true)&&safeInteger(result.approvalRevision,1)&&result.approvalRevision===command.expectedApprovalRevision+1&&(!hasGrant||safeInteger(result.grantRevision,1)&&result.grantRevision===command.expectedGrantRevision+1);
}
function validSessionResult(result){
  const safeId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
  const names=v=>object(v)&&Reflect.ownKeys(v).every(k=>typeof k==='string'&&Object.getOwnPropertyDescriptor(v,k)?.enumerable&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'))?Object.keys(v):null;
  const base=['schemaVersion','projectId','databaseURL','tenantId','uid','grantRevision','profile','cycles'];
  if(!fields(result,['ok','session'])||result.ok!==true||![base,[...base,'workerLabels'],[...base,'cycleLabels'],[...base,'workerLabels','cycleLabels']].some(keys=>fields(result.session,keys)))return false;
  const s=result.session,p=s.profile,keys=names(p),modules=['potong','jahit','qc','laporan','stok','gaji','hpp','pembelian','nota','retur'];
  if(s.schemaVersion!==1||typeof s.projectId!=='string'||!/^[a-z][a-z0-9-]{3,62}$/.test(s.projectId)||!safeId(s.tenantId)||!safeId(s.uid)||!Number.isSafeInteger(s.grantRevision)||s.grantRevision<0||!keys||!keys.includes('active')||!keys.includes('owner')||keys.some(k=>!['active','owner','workerId','modules'].includes(k))||p.active!==true||typeof p.owner!=='boolean')return false;
  if(keys.includes('workerId')&&!safeId(p.workerId))return false;
  if(keys.includes('modules')){const keys=names(p.modules);if(!keys||keys.some(k=>!modules.includes(k)||typeof p.modules[k]!=='boolean'))return false;}
  try{const u=new URL(s.databaseURL);if(typeof s.databaseURL!=='string'||u.protocol!=='https:'||u.origin!==s.databaseURL||u.port||u.username||u.password||!/(^|\.)(firebaseio\.com|firebasedatabase\.app)$/.test(u.hostname))return false;}catch{return false;}
  if(!Array.isArray(s.cycles)||Object.getPrototypeOf(s.cycles)!==Array.prototype||s.cycles.length>256||Reflect.ownKeys(s.cycles).length!==s.cycles.length+1)return false;
  const seen=new Set();
  for(let i=0;i<s.cycles.length;i++){const d=Object.getOwnPropertyDescriptor(s.cycles,String(i));if(!d||!Object.hasOwn(d,'value')||!fields(d.value,['productId','cycleId']))return false;const c=d.value;if(!safeId(c.productId)||!safeId(c.cycleId))return false;const pair=c.productId+'/'+c.cycleId;if(seen.has(pair))return false;seen.add(pair);}
  if(Object.hasOwn(s,'workerLabels')){
    const dense=(a,max)=>Array.isArray(a)&&Object.getPrototypeOf(a)===Array.prototype&&a.length<=max&&Reflect.ownKeys(a).length===a.length+1&&Reflect.ownKeys(a).every(k=>k==='length'||typeof k==='string'&&/^(0|[1-9][0-9]*)$/.test(k)&&Number(k)<a.length&&Object.getOwnPropertyDescriptor(a,k)?.enumerable&&Object.hasOwn(Object.getOwnPropertyDescriptor(a,k),'value'));
    if(!dense(s.workerLabels,256)||s.workerLabels.length!==s.cycles.length)return false;
    const pairs=new Set(),global=p.owner||['qc','laporan','stok'].some(k=>p.modules?.[k]===true);let count=0;
    for(const entry of s.workerLabels){
      if(!fields(entry,['productId','cycleId','workers'])||!safeId(entry.productId)||!safeId(entry.cycleId))return false;
      const pair=entry.productId+'/'+entry.cycleId;if(!seen.has(pair)||pairs.has(pair)||!dense(entry.workers,128)||!global&&entry.workers.length!==1)return false;pairs.add(pair);
      const ids=new Set();for(const worker of entry.workers){if(!fields(worker,['workerId','label'])||!safeId(worker.workerId)||ids.has(worker.workerId)||!global&&worker.workerId!==p.workerId||typeof worker.label!=='string'||worker.label.length>256||!worker.label||worker.label.trim()!==worker.label||/[\u0000-\u001f\u007f-\u009f]/.test(worker.label))return false;ids.add(worker.workerId);if(++count>1024)return false;}
    }
  }
  if(Object.hasOwn(s,'cycleLabels')){
    if(p.owner!==true||!dense(s.cycleLabels,256)||s.cycleLabels.length!==s.cycles.length)return false;
    const pairs=new Set();
    for(const entry of s.cycleLabels){
      if(!fields(entry,['productId','cycleId','series','namaBarang','size'])||!safeId(entry.productId)||!safeId(entry.cycleId))return false;
      const pair=entry.productId+'/'+entry.cycleId;if(!seen.has(pair)||pairs.has(pair))return false;pairs.add(pair);
      for(const field of ['series','namaBarang','size'])if(typeof entry[field]!=='string'||entry[field].length>256||/[\u0000-\u001f\u007f-\u009f]/.test(entry[field]))return false;
    }
  }
  return Buffer.byteLength(JSON.stringify(result),'utf8')<=65536;
}
function createProductionHttpHandler(options={}){
  const enabled=options.enabled===true,service=options.service,origins=options.allowedOrigins,path=options.path===undefined?'/v1/production/commands':options.path;
  const sessionService=options.sessionService,sessionPath='/v1/production/session';
  const ownerTariffService=options.ownerTariffService,ownerTariffWriter=options.ownerTariffWriter,ownerBinding=options.ownerBinding;
  const ownerViewPath='/v1/production/owner/tariffs/view',ownerAppendPath='/v1/production/owner/tariffs/append',ownerResolvePath='/v1/production/owner/tariffs/resolve';
  const enrollmentPath='/v1/production/enrollment/claim';
  const enrollmentDescriptor=Object.getOwnPropertyDescriptor(options,'enrollmentService');
  const enrollmentService=enrollmentDescriptor&&Object.hasOwn(enrollmentDescriptor,'value')?enrollmentDescriptor.value:undefined;
  const enrollmentEnabled=enrollmentDescriptor!==undefined;
  const enrollmentExecute=enrollmentService&&Object.getOwnPropertyDescriptor(enrollmentService,'execute');
  const enrollmentConfigured=!enrollmentEnabled||enrollmentDescriptor&&Object.hasOwn(enrollmentDescriptor,'value')&&enrollmentExecute&&Object.hasOwn(enrollmentExecute,'value')&&typeof enrollmentExecute.value==='function'&&path!==enrollmentPath;
  const revocationPath='/v1/production/owner/access/revoke',revocationResolvePath='/v1/production/owner/access/resolve';
  const revocationDescriptor=Object.getOwnPropertyDescriptor(options,'identityRevocationService');
  const revocationService=revocationDescriptor&&Object.hasOwn(revocationDescriptor,'value')?revocationDescriptor.value:undefined;
  const revocationEnabled=revocationDescriptor!==undefined;
  const revocationExecute=revocationService&&Object.getOwnPropertyDescriptor(revocationService,'execute'),revocationResolve=revocationService&&Object.getOwnPropertyDescriptor(revocationService,'resolve');
  const revocationConfigured=!revocationEnabled||revocationDescriptor&&Object.hasOwn(revocationDescriptor,'value')&&[revocationExecute,revocationResolve].every(d=>d&&Object.hasOwn(d,'value')&&typeof d.value==='function')&&![revocationPath,revocationResolvePath].includes(path);
  const ownerEnabled=ownerTariffService!==undefined||ownerTariffWriter!==undefined;
  const ownerConfigured=!ownerEnabled||ownerTariffService&&typeof ownerTariffService.execute==='function'&&ownerTariffWriter&&typeof ownerTariffWriter.execute==='function'&&(ownerTariffWriter.resolveTariffDraft===undefined||typeof ownerTariffWriter.resolveTariffDraft==='function')&&fields(ownerBinding,['projectId','tenantId'])&&typeof ownerBinding.projectId==='string'&&/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(ownerBinding.projectId)&&safeId(ownerBinding.tenantId)&&![ownerViewPath,ownerAppendPath,ownerResolvePath].includes(path);
  const deadline=options.deadlineMs,maxInFlight=options.maxInFlight;
  const configured=revocationConfigured&&enrollmentConfigured&&ownerConfigured&&service&&typeof service.execute==='function'&&(sessionService===undefined||sessionService&&typeof sessionService.execute==='function'&&path!==sessionPath)&&Array.isArray(origins)&&origins.length>0&&origins.length<=8&&origins.every(origin)&&new Set(origins).size===origins.length&&typeof path==='string'&&/^\/[A-Za-z0-9/_-]+$/.test(path)&&Number.isSafeInteger(deadline)&&deadline>=1&&deadline<=60000&&Number.isSafeInteger(maxInFlight)&&maxInFlight>=1&&maxInFlight<=32;
  let inFlight=0;
  return async function handle(req,res){
    let sent=false,timer,expired=false;const isSession=!!sessionService&&req.url===sessionPath,isOwnerView=!!ownerTariffService&&req.url===ownerViewPath,isOwnerAppend=!!ownerTariffWriter&&req.url===ownerAppendPath,isOwnerResolve=typeof ownerTariffWriter?.resolveTariffDraft==='function'&&req.url===ownerResolvePath,isRead=isSession||isOwnerView,isEnrollment=enrollmentEnabled&&req.url===enrollmentPath;
    const isRevocation=revocationEnabled&&req.url===revocationPath,isRevocationResolve=revocationEnabled&&req.url===revocationResolvePath,isAccess=isRevocation||isRevocationResolve;
    function send(status,body,requestOrigin){
      if(sent)return;sent=true;if(res.destroyed||res.writableEnded)return;
      res.statusCode=status;res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Origin');res.setHeader('X-Content-Type-Options','nosniff');
      if(requestOrigin){res.setHeader('Access-Control-Allow-Origin',requestOrigin);}
      if(body===null){res.end();return;}res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(body));
    }
    const retryFlag=()=>isEnrollment?{retrySameIdentity:true}:{retrySameCommand:true};
    const uncertain=()=>isRead?{ok:false,error:'unavailable'}:{ok:false,error:'result_unknown',...retryFlag()};
    if(!enabled){send(503,{ok:false,error:'service_disabled'});return;}
    if(!configured){send(503,isRead?{ok:false,error:'unavailable'}:{ok:false,error:'unavailable',...retryFlag()});return;}
    let requestOrigin,command,idToken;
    try{
      const h=req.headers;if(!h||typeof h!=='object'||!Array.isArray(req.rawHeaders)||req.rawHeaders.length%2)throw Error('invalid_request');
      const sensitive=new Set(['authorization','origin','content-type','content-length','content-encoding','access-control-request-method','access-control-request-headers']),seen=new Set();
      for(let i=0;i<req.rawHeaders.length;i+=2){const name=req.rawHeaders[i];if(typeof name!=='string'||typeof req.rawHeaders[i+1]!=='string')throw Error('invalid_request');const key=name.toLowerCase();if(sensitive.has(key)){if(seen.has(key))throw Error('invalid_request');seen.add(key);}}
      requestOrigin=h.origin;if(typeof requestOrigin!=='string'||!origins.includes(requestOrigin)){send(403,{ok:false,error:'access_denied'});return;}
      if(req.url!==path&&!isSession&&!isOwnerView&&!isOwnerAppend&&!isOwnerResolve&&!isEnrollment&&!isAccess){send(400,{ok:false,error:'invalid_request'},requestOrigin);return;}
      if(req.method==='OPTIONS'){
        const method=isSession?'GET':'POST',allowed=isSession?['authorization']:['authorization','content-type'];
        if(h['access-control-request-method']!==method||typeof h['access-control-request-headers']!=='string'||h['access-control-request-headers'].split(',').some(v=>!allowed.includes(v.trim().toLowerCase()))){send(400,{ok:false,error:'invalid_request'},requestOrigin);return;}
        res.setHeader('Access-Control-Allow-Methods',method);res.setHeader('Access-Control-Allow-Headers',isSession?'Authorization':'Authorization, Content-Type');send(204,null,requestOrigin);return;
      }
      if(req.method!==(isSession?'GET':'POST')){send(405,{ok:false,error:'invalid_request'},requestOrigin);return;}
      if(typeof h.authorization!=='string'||h.authorization.length>MAX_TOKEN+7||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(h.authorization))throw Error('invalid_request');
      idToken=h.authorization.slice(7);
      if(isSession){
        if(h['content-type']!==undefined||h['content-encoding']!==undefined||h['content-length']!==undefined&&h['content-length']!=='0'||req.rawBody!==undefined&&(!Buffer.isBuffer(req.rawBody)||req.rawBody.length!==0))throw Error('invalid_request');
      }else{
        if(typeof h['content-type']!=='string'||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(h['content-type'])||h['content-encoding']!==undefined)throw Error('invalid_request');
        const raw=req.rawBody;if(!Buffer.isBuffer(raw)||raw.length===0||raw.length>MAX_BODY)throw Error('invalid_request');
        if(h['content-length']!==undefined&&(typeof h['content-length']!=='string'||! /^(0|[1-9][0-9]*)$/.test(h['content-length'])||Number(h['content-length'])!==raw.length))throw Error('invalid_request');
        command=decode(raw,isEnrollment?null:isOwnerView?'selection':'command');
        if(isOwnerView&&(!fields(command,['productId','cycleId'])||!safeId(command.productId)||!safeId(command.cycleId)))throw Error('invalid_request');
        if(isOwnerAppend||isOwnerResolve)TariffLedger.validateTariffCommand(command);
        if(isAccess&&!validRevocationCommand(command))throw Error('invalid_request');
      }
    }catch{send(400,{ok:false,error:'invalid_request'},requestOrigin&&origins.includes(requestOrigin)?requestOrigin:undefined);return;}
    if(inFlight>=maxInFlight){send(503,isRead?{ok:false,error:'busy'}:{ok:false,error:'busy',...retryFlag()},requestOrigin);return;}
    inFlight++;
    // Never end a Functions response while depending on a background write.
    // This deadline classifies a late result, not cancellation or a guaranteed
    // response-time bound. The deployment host must enforce its own timeout.
    // Keep capacity until settlement, also after client disconnect/deadline.
    timer=setTimeout(()=>{expired=true;},deadline);
    try{
      const result=await (isAccess?(isRevocationResolve?revocationResolve:revocationExecute).value.call(revocationService,{idToken,command}):isEnrollment?enrollmentExecute.value.call(enrollmentService,{idToken}):isSession?sessionService.execute({idToken}):isOwnerView?ownerTariffService.execute({idToken,selection:command}):isOwnerResolve?ownerTariffWriter.resolveTariffDraft({idToken,command}):(isOwnerAppend?ownerTariffWriter:service).execute({idToken,command}));
      if(expired){send(503,uncertain(),requestOrigin);}
      else if(isEnrollment&&fields(result,['ok'])&&result.ok===true){send(200,{ok:true},requestOrigin);}
      else if(isAccess&&validRevocationResult(result,command,isRevocationResolve)){const body={ok:true,replayed:result.replayed,approvalRevision:result.approvalRevision};if(Object.hasOwn(command,'expectedGrantRevision'))body.grantRevision=result.grantRevision;send(200,body,requestOrigin);}
      else if(isSession&&validSessionResult(result)){send(200,result,requestOrigin);}
      else if(isOwnerView&&validOwnerTariffResult(result,command,ownerBinding)){send(200,result,requestOrigin);}
      else if(isOwnerAppend&&validOwnerAppendResult(result,command)){const r=result.receipt;send(200,{ok:true,receipt:{requestId:r.requestId,kind:r.kind,productId:r.productId,cycleId:r.cycleId,workerId:r.workerId,tariffVersion:r.tariffVersion,revision:r.revision,acceptedAt:r.acceptedAt},replayed:result.replayed},requestOrigin);}
      else if(isOwnerResolve&&validOwnerResolveResult(result,command)){const r=result.receipt,receipt={requestId:r.requestId,kind:r.kind,productId:r.productId,cycleId:r.cycleId,workerId:r.workerId,tariffVersion:r.tariffVersion};if(result.outcome==='accepted'){receipt.revision=r.revision;receipt.acceptedAt=r.acceptedAt;}else receipt.retiredAt=r.retiredAt;send(200,{ok:true,outcome:result.outcome,receipt,replayed:result.replayed},requestOrigin);}
      else if(!isRead&&!isOwnerAppend&&!isOwnerResolve&&!isEnrollment&&!isAccess&&validResult(result,command)){send(200,{ok:true,receipt:{requestId:result.receipt.requestId,revision:result.receipt.revision,acceptedAt:result.receipt.acceptedAt},replayed:result.replayed},requestOrigin);}
      else if(isAccess&&[ ['ok','error'],['ok','error','retrySameCommand'] ].some(k=>fields(result,k))&&result.ok===false&&result.error==='result_unknown'&&(!Object.hasOwn(result,'retrySameCommand')||result.retrySameCommand===true)){send(503,uncertain(),requestOrigin);}
      else if(isEnrollment&&fields(result,['ok','error'])&&result.ok===false&&result.error==='result_unknown'){send(503,uncertain(),requestOrigin);}
      else if(fields(result,['ok','error'])&&result.ok===false&&allowedErrors.has(result.error)){
        const status=allowedErrors.get(result.error),body={ok:false,error:result.error};if(!isRead&&result.error==='unavailable')Object.assign(body,retryFlag());send(status,body,requestOrigin);
      }else send(503,uncertain(),requestOrigin);
    }catch{send(503,uncertain(),requestOrigin);}finally{clearTimeout(timer);inFlight--;}
  };
}
module.exports=Object.freeze({createProductionHttpHandler});
