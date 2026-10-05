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
function createProductionHttpHandler(options={}){
  const enabled=options.enabled===true,service=options.service,origins=options.allowedOrigins,path=options.path===undefined?'/v1/production/commands':options.path;
  const deadline=options.deadlineMs,maxInFlight=options.maxInFlight;
  const configured=service&&typeof service.execute==='function'&&Array.isArray(origins)&&origins.length>0&&origins.length<=8&&origins.every(origin)&&new Set(origins).size===origins.length&&typeof path==='string'&&/^\/[A-Za-z0-9/_-]+$/.test(path)&&Number.isSafeInteger(deadline)&&deadline>=1&&deadline<=60000&&Number.isSafeInteger(maxInFlight)&&maxInFlight>=1&&maxInFlight<=32;
  let inFlight=0;
  return async function handle(req,res){
    let sent=false,timer,expired=false;
    function send(status,body,requestOrigin){
      if(sent)return;sent=true;if(res.destroyed||res.writableEnded)return;
      res.statusCode=status;res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Origin');res.setHeader('X-Content-Type-Options','nosniff');
      if(requestOrigin){res.setHeader('Access-Control-Allow-Origin',requestOrigin);}
      if(body===null){res.end();return;}res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(body));
    }
    const uncertain=()=>({ok:false,error:'result_unknown',retrySameCommand:true});
    if(!enabled){send(503,{ok:false,error:'service_disabled'});return;}
    if(!configured){send(503,{ok:false,error:'unavailable',retrySameCommand:true});return;}
    let requestOrigin,command,idToken;
    try{
      const h=req.headers;if(!h||typeof h!=='object'||!Array.isArray(req.rawHeaders)||req.rawHeaders.length%2)throw Error('invalid_request');
      const sensitive=new Set(['authorization','origin','content-type','content-length','content-encoding']),seen=new Set();
      for(let i=0;i<req.rawHeaders.length;i+=2){const name=req.rawHeaders[i];if(typeof name!=='string'||typeof req.rawHeaders[i+1]!=='string')throw Error('invalid_request');const key=name.toLowerCase();if(sensitive.has(key)){if(seen.has(key))throw Error('invalid_request');seen.add(key);}}
      requestOrigin=h.origin;if(typeof requestOrigin!=='string'||!origins.includes(requestOrigin)){send(403,{ok:false,error:'access_denied'});return;}
      if(req.url!==path){send(400,{ok:false,error:'invalid_request'},requestOrigin);return;}
      if(req.method==='OPTIONS'){
        if(h['access-control-request-method']!=='POST'||typeof h['access-control-request-headers']!=='string'||h['access-control-request-headers'].split(',').some(v=>!['authorization','content-type'].includes(v.trim().toLowerCase()))){send(400,{ok:false,error:'invalid_request'},requestOrigin);return;}
        res.setHeader('Access-Control-Allow-Methods','POST');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');send(204,null,requestOrigin);return;
      }
      if(req.method!=='POST'){send(405,{ok:false,error:'invalid_request'},requestOrigin);return;}
      if(typeof h.authorization!=='string'||h.authorization.length>MAX_TOKEN+7||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(h.authorization))throw Error('invalid_request');
      idToken=h.authorization.slice(7);
      if(typeof h['content-type']!=='string'||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(h['content-type'])||h['content-encoding']!==undefined)throw Error('invalid_request');
      const raw=req.rawBody;if(!Buffer.isBuffer(raw)||raw.length===0||raw.length>MAX_BODY)throw Error('invalid_request');
      if(h['content-length']!==undefined&&(typeof h['content-length']!=='string'||! /^(0|[1-9][0-9]*)$/.test(h['content-length'])||Number(h['content-length'])!==raw.length))throw Error('invalid_request');
      command=decode(raw);
    }catch{send(400,{ok:false,error:'invalid_request'},requestOrigin&&origins.includes(requestOrigin)?requestOrigin:undefined);return;}
    if(inFlight>=maxInFlight){send(503,{ok:false,error:'busy',retrySameCommand:true},requestOrigin);return;}
    inFlight++;
    // Never end a Functions response while depending on a background write.
    // This deadline classifies a late result, not cancellation or a guaranteed
    // response-time bound. The deployment host must enforce its own timeout.
    // Keep capacity until settlement, also after client disconnect/deadline.
    timer=setTimeout(()=>{expired=true;},deadline);
    try{
      const result=await service.execute({idToken,command});
      if(expired){send(503,uncertain(),requestOrigin);}
      else if(validResult(result,command)){send(200,{ok:true,receipt:{requestId:result.receipt.requestId,revision:result.receipt.revision,acceptedAt:result.receipt.acceptedAt},replayed:result.replayed},requestOrigin);}
      else if(fields(result,['ok','error'])&&result.ok===false&&allowedErrors.has(result.error)){
        const status=allowedErrors.get(result.error),body={ok:false,error:result.error};if(result.error==='unavailable')body.retrySameCommand=true;send(status,body,requestOrigin);
      }else send(503,uncertain(),requestOrigin);
    }catch{send(503,uncertain(),requestOrigin);}finally{clearTimeout(timer);inFlight--;}
  };
}
module.exports=Object.freeze({createProductionHttpHandler});
