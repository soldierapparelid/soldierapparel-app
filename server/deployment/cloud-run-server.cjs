'use strict';
// Custom HTTP boundary only. Import/OFF never opens a socket, imports an SDK,
// reads environment or credentials, or logs requests and parser exceptions.
const BODY_TIMEOUT_MS=10000,RESPONSE_TIMEOUT_MS=30000;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const off=()=>Object.freeze({enabled:false,server:null});
function createCloudRunServer(options={}){
  let configuration;
  try{const d=Object.getOwnPropertyDescriptor(options,'configuration'),enabled=d&&Object.hasOwn(d,'value')&&Object.getOwnPropertyDescriptor(d.value,'enabled');if(!enabled||!Object.hasOwn(enabled,'value')||enabled.value!==true)return off();configuration=d.value;}catch{return off();}
  let values;
  try{
    const keys=['configuration','environment','loadAdminSdk','createRuntime'];if(!plain(options)||Reflect.ownKeys(options).some(k=>typeof k!=='string'||!keys.includes(k)))return off();values={};
    for(const key of Reflect.ownKeys(options)){const d=Object.getOwnPropertyDescriptor(options,key);if(!d.enumerable||!Object.hasOwn(d,'value'))return off();values[key]=d.value;}
  }catch{return off();}
  let deployment,http,limits;
  try{
    const Core=require('./deployment-runtime.cjs');deployment=Core.createDeployment({...values,configuration,host:'cloud-run'});limits=Core.LIMITS;
    if(!deployment||deployment.enabled!==true||typeof deployment.handler!=='function'||typeof deployment.gate!=='function'||limits?.maxBodyBytes!==32768||limits.maxHeaderBytes!==32768||limits.maxHeaderPairs!==128)return off();
    http=require('node:http');
  }catch{return off();}
  let inFlight=0;const idleWaiters=new Set();
  function waitForIdle(){if(inFlight===0)return Promise.resolve();return new Promise(resolve=>idleWaiters.add(resolve));}
  function idle(){if(inFlight!==0)return;for(const resolve of idleWaiters)resolve();idleWaiters.clear();}
  function reply(req,res,status,error,origin,retry=false){
    if(res.destroyed||res.writableEnded)return;try{
      req?.pause();res.statusCode=status;res.setHeader('Connection','close');res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Origin');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Type','application/json; charset=utf-8');if(origin)res.setHeader('Access-Control-Allow-Origin',origin);
      const body={ok:false,error};if(retry)body[req?.url==='/v1/production/enrollment/claim'?'retrySameIdentity':'retrySameCommand']=true;res.end(JSON.stringify(body));
    }catch{try{req?.socket?.destroy();}catch{}}
  }
  function handle(req,res,continueExpected=false){
    // Never log Error.rawPacket, request headers/body, URLs or socket objects.
    req.on('error',()=>{});res.on('error',()=>{});
    let gated;try{gated=deployment.gate(req);}catch{reply(req,res,503,'unavailable');return;}
    if(!gated||gated.status){reply(req,res,gated?.status||503,gated?.error||'unavailable',gated?.origin);return;}
    res.setHeader('Connection','close');
    if(!Array.isArray(req.rawHeaders)||req.rawHeaders.length>limits.maxHeaderPairs*2){reply(req,res,431,'invalid_request',gated.origin);return;}
    const noBody=gated.session===true||gated.preflight===true;
    if(noBody&&(req.headers['transfer-encoding']!==undefined||req.headers['content-length']!==undefined&&req.headers['content-length']!=='0')){reply(req,res,400,'invalid_request',gated.origin);return;}
    if(inFlight>=1){reply(req,res,503,'busy',gated.origin,!noBody&&gated.read!==true);return;}
    inFlight++;
    let finished=false,dispatched=false,closed=false,bytes=0,chunks=[],bodyTimer,responseTimer;
    const release=()=>{if(finished)return;finished=true;clearTimeout(bodyTimer);clearTimeout(responseTimer);chunks=[];if(Object.hasOwn(req,'rawBody'))delete req.rawBody;inFlight--;idle();};
    const reject=(status,error)=>{if(finished||dispatched)return;closed=true;reply(req,res,status,error,gated.origin);release();};
    const disconnected=()=>{closed=true;chunks=[];clearTimeout(bodyTimer);if(!dispatched)release();};
    req.once('aborted',disconnected);req.once('error',disconnected);res.once('close',()=>{if(!res.writableFinished)disconnected();});
    bodyTimer=setTimeout(()=>reject(408,'invalid_request'),BODY_TIMEOUT_MS);
    responseTimer=setTimeout(()=>{
      if(finished)return;if(!dispatched){reject(408,'invalid_request');return;}
      closed=true;reply(req,res,503,gated.read===true?'unavailable':'result_unknown',gated.origin,gated.read!==true);
      // A response deadline is not database cancellation. Keep the sole slot
      // until the runtime settles; a write requires exact durable replay.
    },RESPONSE_TIMEOUT_MS);
    req.on('data',chunk=>{
      if(finished||closed)return;if(!Buffer.isBuffer(chunk)||noBody&&(chunk.length!==0)||(bytes+=chunk.length)>limits.maxBodyBytes){reject(400,'invalid_request');return;}chunks.push(chunk);
    });
    req.once('end',()=>{
      clearTimeout(bodyTimer);if(finished||closed||req.aborted||!req.complete||res.destroyed||res.writableEnded){release();return;}
      // Chunked trailers can be sent without a Trailer declaration. Reject
      // every actual trailer before assembling bytes or initializing the SDK.
      if(!Array.isArray(req.rawTrailers)||req.rawTrailers.length!==0||!plain(req.trailers)||Reflect.ownKeys(req.trailers).length!==0){reject(400,'invalid_request');return;}
      const length=req.headers['content-length'];if(!noBody&&bytes===0||length!==undefined&&Number(length)!==bytes){reject(400,'invalid_request');return;}
      req.rawBody=Buffer.concat(chunks,bytes);chunks=[];dispatched=true;
      Promise.resolve().then(()=>{
        if(closed||req.aborted||res.destroyed||res.writableEnded)return;return deployment.handler(req,res);
      }).catch(()=>reply(req,res,503,gated.read===true?'unavailable':'result_unknown',gated.origin,gated.read!==true)).finally(release);
    });
    // Admission, framing, header checks and the one-slot limit precede 100.
    if(continueExpected){try{res.writeContinue();}catch{disconnected();}}
  }
  const server=http.createServer({maxHeaderSize:limits.maxHeaderBytes,insecureHTTPParser:false,joinDuplicateHeaders:false,headersTimeout:BODY_TIMEOUT_MS,requestTimeout:BODY_TIMEOUT_MS,keepAliveTimeout:5000,connectionsCheckingInterval:1000},handle);
  // Saturate at one pair beyond the accepted limit so count truncation cannot
  // turn excess headers into an apparently admitted request.
  server.maxHeadersCount=limits.maxHeaderPairs+1;
  server.maxConnections=8;
  server.on('checkContinue',(req,res)=>handle(req,res,true));
  server.on('checkExpectation',(req,res)=>reply(req,res,417,'invalid_request'));
  const socketReply=(socket,status)=>{
    if(!socket||socket.destroyed||!socket.writable||socket.writableEnded)return;socket.on('error',()=>{});const error='invalid_request',body=JSON.stringify({ok:false,error});
    try{socket.end('HTTP/1.1 '+status+' '+(status===431?'Request Header Fields Too Large':status===408?'Request Timeout':'Bad Request')+'\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: '+Buffer.byteLength(body)+'\r\n\r\n'+body);}catch{try{socket.destroy();}catch{}}
  };
  server.on('clientError',(error,socket)=>socketReply(socket,error?.code==='HPE_HEADER_OVERFLOW'?431:error?.code==='ERR_HTTP_REQUEST_TIMEOUT'?408:400));
  server.on('upgrade',(_req,socket)=>socketReply(socket,400));server.on('connect',(_req,socket)=>socketReply(socket,400));
  server.on('error',()=>{});
  return Object.freeze({enabled:true,server,waitForIdle});
}
module.exports=Object.freeze({createCloudRunServer,BODY_TIMEOUT_MS,RESPONSE_TIMEOUT_MS});
