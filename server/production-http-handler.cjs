'use strict';
// Disabled transport boundary. No listener, SDK init, credential or deployment.
const {TextDecoder}=require('node:util');
const MAX_BODY=32768,MAX_TOKEN=16384;
const allowedErrors=new Map([['access_denied',403],['invalid_request',400],['conflict',409],['not_ready',409],['capacity_limit',409],['rate_limited',429],['service_disabled',503],['unavailable',503]]);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
function fields(v,keys){if(!object(v)||Reflect.ownKeys(v).length!==keys.length)return false;return keys.every(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return d&&d.enumerable&&Object.hasOwn(d,'value');});}
function origin(value){if(typeof value!=='string')return false;try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.origin===value;}catch{return false;}}
function decode(raw){
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
  if(!fields(parsed,['command'])||!object(parsed.command))throw Error('invalid_request');return parsed.command;
}
function validResult(result,command){
  if(!fields(result,['ok','receipt','replayed'])||result.ok!==true||typeof result.replayed!=='boolean'||!fields(result.receipt,['requestId','revision','acceptedAt']))return false;
  const r=result.receipt;return r.requestId===command.requestId&&typeof r.requestId==='string'&&Number.isSafeInteger(r.revision)&&r.revision>=1&&typeof r.acceptedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.acceptedAt)&&!Number.isNaN(Date.parse(r.acceptedAt))&&new Date(r.acceptedAt).toISOString()===r.acceptedAt;
}
function validSessionResult(result){
  const safeId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
  const names=v=>object(v)&&Reflect.ownKeys(v).every(k=>typeof k==='string'&&Object.getOwnPropertyDescriptor(v,k)?.enumerable&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'))?Object.keys(v):null;
  const base=['schemaVersion','projectId','databaseURL','tenantId','uid','grantRevision','profile','cycles'];
  if(!fields(result,['ok','session'])||result.ok!==true||!(fields(result.session,base)||fields(result.session,[...base,'workerLabels'])))return false;
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
  return Buffer.byteLength(JSON.stringify(result),'utf8')<=65536;
}
function createProductionHttpHandler(options={}){
  const enabled=options.enabled===true,service=options.service,origins=options.allowedOrigins,path=options.path===undefined?'/v1/production/commands':options.path;
  const sessionService=options.sessionService,sessionPath='/v1/production/session';
  const deadline=options.deadlineMs,maxInFlight=options.maxInFlight;
  const configured=service&&typeof service.execute==='function'&&(sessionService===undefined||sessionService&&typeof sessionService.execute==='function'&&path!==sessionPath)&&Array.isArray(origins)&&origins.length>0&&origins.length<=8&&origins.every(origin)&&new Set(origins).size===origins.length&&typeof path==='string'&&/^\/[A-Za-z0-9/_-]+$/.test(path)&&Number.isSafeInteger(deadline)&&deadline>=1&&deadline<=60000&&Number.isSafeInteger(maxInFlight)&&maxInFlight>=1&&maxInFlight<=32;
  let inFlight=0;
  return async function handle(req,res){
    let sent=false,timer,expired=false;const isSession=!!sessionService&&req.url===sessionPath;
    function send(status,body,requestOrigin){
      if(sent)return;sent=true;if(res.destroyed||res.writableEnded)return;
      res.statusCode=status;res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Origin');res.setHeader('X-Content-Type-Options','nosniff');
      if(requestOrigin){res.setHeader('Access-Control-Allow-Origin',requestOrigin);}
      if(body===null){res.end();return;}res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(body));
    }
    const uncertain=()=>isSession?{ok:false,error:'unavailable'}:{ok:false,error:'result_unknown',retrySameCommand:true};
    if(!enabled){send(503,{ok:false,error:'service_disabled'});return;}
    if(!configured){send(503,isSession?{ok:false,error:'unavailable'}:{ok:false,error:'unavailable',retrySameCommand:true});return;}
    let requestOrigin,command,idToken;
    try{
      const h=req.headers;if(!h||typeof h!=='object'||!Array.isArray(req.rawHeaders)||req.rawHeaders.length%2)throw Error('invalid_request');
      const sensitive=new Set(['authorization','origin','content-type','content-length','content-encoding']),seen=new Set();
      for(let i=0;i<req.rawHeaders.length;i+=2){const name=req.rawHeaders[i];if(typeof name!=='string'||typeof req.rawHeaders[i+1]!=='string')throw Error('invalid_request');const key=name.toLowerCase();if(sensitive.has(key)){if(seen.has(key))throw Error('invalid_request');seen.add(key);}}
      requestOrigin=h.origin;if(typeof requestOrigin!=='string'||!origins.includes(requestOrigin)){send(403,{ok:false,error:'access_denied'});return;}
      if(req.url!==path&&!isSession){send(400,{ok:false,error:'invalid_request'},requestOrigin);return;}
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
        command=decode(raw);
      }
    }catch{send(400,{ok:false,error:'invalid_request'},requestOrigin&&origins.includes(requestOrigin)?requestOrigin:undefined);return;}
    if(inFlight>=maxInFlight){send(503,isSession?{ok:false,error:'busy'}:{ok:false,error:'busy',retrySameCommand:true},requestOrigin);return;}
    inFlight++;
    // Never end a Functions response while depending on a background write.
    // This deadline classifies a late result, not cancellation or a guaranteed
    // response-time bound. The deployment host must enforce its own timeout.
    // Keep capacity until settlement, also after client disconnect/deadline.
    timer=setTimeout(()=>{expired=true;},deadline);
    try{
      const result=await (isSession?sessionService.execute({idToken}):service.execute({idToken,command}));
      if(expired){send(503,uncertain(),requestOrigin);}
      else if(isSession&&validSessionResult(result)){send(200,result,requestOrigin);}
      else if(!isSession&&validResult(result,command)){send(200,{ok:true,receipt:{requestId:result.receipt.requestId,revision:result.receipt.revision,acceptedAt:result.receipt.acceptedAt},replayed:result.replayed},requestOrigin);}
      else if(fields(result,['ok','error'])&&result.ok===false&&allowedErrors.has(result.error)){
        const status=allowedErrors.get(result.error),body={ok:false,error:result.error};if(!isSession&&result.error==='unavailable')body.retrySameCommand=true;send(status,body,requestOrigin);
      }else send(503,uncertain(),requestOrigin);
    }catch{send(503,uncertain(),requestOrigin);}finally{clearTimeout(timer);inFlight--;}
  };
}
module.exports=Object.freeze({createProductionHttpHandler});
