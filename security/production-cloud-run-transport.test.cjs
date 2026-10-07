'use strict';
// Native Node HTTP in an isolated child process plus the genuine application
// handler. ADC/Auth/DB/services are synthetic, and all sockets are loopback.
// This proves application-process behavior, not Google ingress/logging/IAM,
// billing/deployment, total Node memory, or a platform response-time bound.
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),net=require('node:net'),path=require('node:path'),zlib=require('node:zlib');
const {fork}=require('node:child_process');
const PROJECT='soldier-native-transport-proof',DATABASE='https://'+PROJECT+'-default-rtdb.firebaseio.com',ORIGIN='https://native.example.invalid',TOKEN='SYNTHETIC_TOKEN_CANARY.payload.signature';
const BODY='SYNTHETIC_BODY_CANARY',HEADER='SYNTHETIC_HEADER_CANARY',SDK_ERROR='SYNTHETIC_SDK_ERROR_CANARY',SERVICE_ERROR='SYNTHETIC_SERVICE_ERROR_CANARY';
const CANARIES=[BODY,HEADER,TOKEN,SDK_ERROR,SERVICE_ERROR,'SYNTHETIC_IDENTITY_CANARY','synthetic.native.canary@gmail.com','SYNTHETIC_RUNTIME_FLAG_CANARY'];
const PATHS={command:'/v1/production/commands',session:'/v1/production/session',view:'/v1/production/owner/tariffs/view',append:'/v1/production/owner/tariffs/append',resolve:'/v1/production/owner/tariffs/resolve'};
const ENROLLMENT_PATH='/v1/production/enrollment/claim',ENROLLMENT_BODY=Buffer.from('{}');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const commandBody=()=>Buffer.from(JSON.stringify({command:{requestId:'native-request',label:BODY}}));
const noCanary=value=>{for(const canary of CANARIES)assert.equal(String(value).includes(canary),false,'synthetic canary must not appear in an output');};
function errorResponse(response,status,error,retry=false,retryField='retrySameCommand'){assert.equal(response.status,status);assert.deepEqual(response.body,retry?{ok:false,error,[retryField]:true}:{ok:false,error});assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.headers['x-content-type-options'],'nosniff');noCanary(response.text);}
async function fixture(t,scenario='normal'){
  const environment={NODE_ENV:'production',TZ:'UTC'};if(process.platform==='win32'&&typeof process.env.SystemRoot==='string')environment.SystemRoot=process.env.SystemRoot;
  const child=fork(path.resolve(__dirname,'fixtures/cloud-run-transport.cjs'),[scenario],{silent:true,env:environment,execArgv:[]}),messages=[],waiters=[],responses=[];let stdout='',stderr='',sequence=0,port,closed=false;
  const ended=new Promise(resolve=>child.once('close',(code,signal)=>{closed=true;resolve({code,signal});}));
  child.stdout.on('data',chunk=>{stdout+=chunk.toString('utf8');});child.stderr.on('data',chunk=>{stderr+=chunk.toString('utf8');});
  child.on('message',message=>{messages.push(message);for(const waiter of [...waiters])if(waiter.predicate(message)){waiters.splice(waiters.indexOf(waiter),1);clearTimeout(waiter.timer);waiter.resolve(message);}});
  function wait(predicate,timeout=4000){const existing=messages.find(predicate);if(existing)return Promise.resolve(existing);return new Promise((resolve,reject)=>{const waiter={predicate,resolve,reject};waiter.timer=setTimeout(()=>{waiters.splice(waiters.indexOf(waiter),1);reject(Error('Synthetic fixture event timed out'));},timeout);waiters.push(waiter);});}
  async function control(type){const id=++sequence;child.send({id,type});return wait(message=>message?.type==='ack'&&message.id===id);}
  t.after(async()=>{
    if(!closed){try{await control('stop');}catch{}const result=await Promise.race([ended,pause(2000).then(()=>null)]);if(!result){child.kill();await ended;}}
    for(const waiter of waiters.splice(0)){clearTimeout(waiter.timer);waiter.reject(Error('Synthetic fixture closed'));}
    noCanary(stdout);noCanary(stderr);for(const response of responses)noCanary(response);assert.equal(stderr,'');assert.match(stdout,/^SYNTHETIC_NATIVE_PORT [0-9]+\r?\n$/);assert.equal(child.exitCode,0);
  });
  const ready=await Promise.race([wait(message=>message?.type==='ready'),ended.then(()=>{throw Error('Synthetic native child did not start');})]);port=ready.port;assert.ok(Number.isSafeInteger(port)&&port>0&&port<65536);assert.equal(ready.counts.load,0);
  function start({method='POST',url=PATHS.command,body=commandBody(),headers,duplicates=[],expectContinue=false,timeout=5000,chunked=false}={}){
    // Raw header arrays do not receive http.request's automatic Host header.
    // Include it explicitly so duplicate-header cases reach the intended gate.
    const base={host:'127.0.0.1:'+port,origin:ORIGIN,authorization:'Bearer '+TOKEN,...(body!==null?{'content-type':'application/json',...(chunked?{'transfer-encoding':'chunked'}:{'content-length':String(body.length)})}:{})};
    const values={...base,...headers};for(const name of Object.keys(values))if(values[name]===undefined)delete values[name];if(expectContinue)values.expect='100-continue';
    let request,continues=0;
    const promise=new Promise((resolve,reject)=>{
      request=http.request({hostname:'127.0.0.1',port,method,path:url,headers:duplicates.length?[...Object.entries(values).flat(),...duplicates]:values,agent:false},res=>{
        const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);res.on('end',()=>{const text=Buffer.concat(chunks).toString('utf8');responses.push(JSON.stringify({status:res.statusCode,headers:res.headers,text}));let value=null;try{value=text?JSON.parse(text):null;}catch{}resolve({status:res.statusCode,headers:res.headers,text,body:value,continues});});
      });
      request.on('error',reject);request.setTimeout(timeout,()=>request.destroy(Error('Synthetic request timed out')));request.on('continue',()=>{continues++;if(expectContinue)request.end(body===null?undefined:body);});
      if(expectContinue)request.flushHeaders();else if(chunked&&body!==null){for(let i=0;i<body.length;i+=4096)request.write(body.subarray(i,i+4096));request.end();}else request.end(body===null?undefined:body);
    });
    return {request,promise};
  }
  function rawStart(bytes,{timeout=5000}={}){
    let socket;const promise=new Promise((resolve,reject)=>{
      const chunks=[];let complete=false;const finish=()=>{if(complete)return;complete=true;const text=Buffer.concat(chunks).toString('utf8');responses.push(text);resolve(text);};socket=net.createConnection({host:'127.0.0.1',port},()=>socket.write(bytes));socket.on('data',chunk=>chunks.push(chunk));socket.on('error',reject);socket.on('end',finish);socket.on('close',finish);socket.setTimeout(timeout,()=>socket.destroy(Error('Synthetic raw socket timed out')));
    });return {socket,promise};
  }
  function parseRaw(raw){const index=raw.indexOf('\r\n\r\n');assert.ok(index>=0);const lines=raw.slice(0,index).split('\r\n'),headers={};for(const line of lines.slice(1)){const split=line.indexOf(':');headers[line.slice(0,split).toLowerCase()]=line.slice(split+1).trim();}const status=Number(lines[0].split(' ')[1]),text=raw.slice(index+4);return {status,headers,text,body:JSON.parse(text)};}
  return {port,child,messages,control,wait,start,request:options=>start(options).promise,rawStart,raw:async(bytes,options)=>parseRaw(await rawStart(bytes,options).promise),snapshot:async()=>(await control('snapshot')).counts,get logs(){return {stdout,stderr};}};
}
const rawHeaders=(extra='',length=0)=>'POST '+PATHS.command+' HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: '+ORIGIN+'\r\nAuthorization: Bearer '+TOKEN+'\r\nContent-Type: application/json\r\nContent-Length: '+length+'\r\n'+extra+'\r\n';
const tariffCommand=()=>({kind:'appendTariffVersion',requestId:'native-tariff-request',productId:'native-product',cycleId:'native-cycle',expectedConfigRevision:0,expectedTariffRevision:0,workerId:'native-worker',tariffVersion:'native-tariff-version',effectiveAt:'2026-01-01T01:00:00.000Z',currency:'IDR',rate:137});

test('native child starts without SDK/ADC/runtime and accepted bytes reach the real application core without a parsed-body middleware',async t=>{
  const f=await fixture(t),response=await f.request();assert.equal(response.status,200);assert.deepEqual(response.body,{ok:true,receipt:{requestId:'native-request',revision:1,acceptedAt:'2026-01-01T00:00:00.000Z'},replayed:false});const counts=await f.snapshot();assert.equal(counts.load,1);assert.equal(counts.adc,1);assert.equal(counts.initialize,1);assert.equal(counts.runtime,1);assert.equal(counts.operations,1);assert.equal(counts.bodyWasUndefined,true);assert.equal(counts.maxRawBodyBytes,commandBody().length);noCanary(response.text);
});
test('malformed JSON, fatal UTF8, duplicate/escaped keys and prototype keys expose only fixed errors without any request canary in child logs',async t=>{
  const f=await fixture(t),bad=[Buffer.from('{"command":{"requestId":"native-request","label":"'+BODY+'",}}'),Buffer.from('{"command":"'+BODY+'"}'),Buffer.from('{"command":{"requestId":"native-request","label":"'+BODY+'","label":"again"}}'),Buffer.from('{"command":{"requestId":"native-request","request\\u0049d":"other","label":"'+BODY+'"}}'),Buffer.from('{"command":{"requestId":"native-request","__proto__":{"label":"'+BODY+'"}}}'),Buffer.from('{"command":{"requestId":"native-request","constructor":{"label":"'+BODY+'"}}}'),Buffer.concat([Buffer.from('{"command":{"requestId":"native-request","label":"'+BODY),Buffer.from([0xff]),Buffer.from('"}}')])];
  for(const body of bad)errorResponse(await f.request({body,headers:{'x-synthetic-private':HEADER}}),400,'invalid_request');const counts=await f.snapshot();assert.equal(counts.operations,0);assert.equal(counts.requests,bad.length);assert.equal(counts.load,1);assert.equal(counts.bodyWasUndefined,true);t.diagnostic('Small malformed bodies may reach synthetic SDK assembly before strict application decoding; no service operation or raw error logging occurs.');
});
test('compression, unapproved media type, origin and route/header gates reject before SDK assembly',async t=>{
  const f=await fixture(t);for(const encoding of ['gzip','deflate','br','identity'])errorResponse(await f.request({body:zlib.gzipSync(commandBody()),headers:{'content-encoding':encoding,'x-synthetic-private':HEADER}}),400,'invalid_request');
  errorResponse(await f.request({headers:{'content-type':'text/plain','x-synthetic-private':HEADER}}),400,'invalid_request');errorResponse(await f.request({headers:{origin:'https://foreign.example.invalid'}}),403,'access_denied');errorResponse(await f.request({url:PATHS.command+'?private='+BODY}),400,'invalid_request');errorResponse(await f.request({url:PATHS.command+'/'}),400,'invalid_request');const counts=await f.snapshot();assert.equal(counts.load,0);assert.equal(counts.adc,0);assert.equal(counts.runtime,0);
});
test('declared and streamed oversized bodies reject before SDK or JSON parsing; the exact32KiB boundary is retained once',async t=>{
  const f=await fixture(t),large=Buffer.alloc(32769,0x61);errorResponse(await f.request({body:large,headers:{'x-synthetic-private':HEADER}}),400,'invalid_request');errorResponse(await f.request({body:large,chunked:true,headers:{'x-synthetic-private':HEADER}}),400,'invalid_request');assert.equal((await f.snapshot()).load,0);
  const prefix='{"command":{"requestId":"native-boundary","label":"'+BODY+'","padding":"',suffix='"}}',boundary=Buffer.from(prefix+'a'.repeat(32768-Buffer.byteLength(prefix+suffix))+suffix);assert.equal(boundary.length,32768);assert.equal((await f.request({body:boundary})).status,200);const counts=await f.snapshot();assert.equal(counts.maxRawBodyBytes,32768);assert.equal(counts.operations,1);t.diagnostic('Only application-retained body bytes are bounded here; native socket buffers and Google ingress memory are outside this proof.');
});
test('duplicated security/framing headers and malformed HTTP clientError packets never emit rawPacket, token or header canaries',async t=>{
  const f=await fixture(t);for(const [name,value]of [['Authorization','Bearer '+TOKEN],['Origin',ORIGIN],['Content-Type','application/json'],['Content-Length',String(commandBody().length)]]){const response=await f.request({duplicates:[name,value]});t.diagnostic('Duplicate '+name+': HTTP'+response.status+', response bytes '+Buffer.byteLength(response.text)+', clientError events '+(await f.snapshot()).clientErrors);errorResponse(response,400,'invalid_request');}
  errorResponse(await f.raw(Buffer.from(rawHeaders('Transfer-Encoding: chunked\r\nX-Synthetic: '+HEADER+'\r\n',commandBody().length)+'0\r\n\r\n')),400,'invalid_request');
  errorResponse(await f.raw(Buffer.from('POST '+PATHS.command+' HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Bad\u0000: '+HEADER+'\r\nAuthorization: Bearer '+TOKEN+'\r\n\r\n')),400,'invalid_request');
  errorResponse(await f.raw(Buffer.from('POST '+PATHS.command+' HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Synthetic: '+HEADER+'a'.repeat(33000)+'\r\n\r\n')),431,'invalid_request');const counts=await f.snapshot();assert.equal(counts.load,0);assert.ok(counts.clientErrors>=3);
});
test('header-pair overflow cannot hide admission-critical duplicates through native header truncation',async t=>{
  const f=await fixture(t),extra=Array.from({length:140},(_,i)=>'X-Synthetic-'+i+': '+HEADER+'\r\n').join('');const response=await f.raw(Buffer.from(rawHeaders(extra,commandBody().length)+commandBody()));assert.ok([400,431].includes(response.status));assert.deepEqual(response.body,{ok:false,error:'invalid_request'});assert.equal((await f.snapshot()).load,0);noCanary(response.text);
});
test('Expect admission happens before100continue; unsupported expectations, upgrades and CONNECT use fixed socket errors',async t=>{
  const f=await fixture(t),denied=await f.request({expectContinue:true,headers:{origin:'https://foreign.example.invalid'}});errorResponse(denied,403,'access_denied');assert.equal(denied.continues,0);
  const oversized=await f.request({expectContinue:true,body:Buffer.alloc(32769,0x61)});errorResponse(oversized,400,'invalid_request');assert.equal(oversized.continues,0);
  errorResponse(await f.raw(Buffer.from(rawHeaders('Expect: '+HEADER+'\r\n',commandBody().length))),417,'invalid_request');errorResponse(await f.raw(Buffer.from('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nX-Synthetic: '+HEADER+'\r\n\r\n')),400,'invalid_request');errorResponse(await f.raw(Buffer.from('CONNECT '+HEADER+'.invalid:443 HTTP/1.1\r\nHost: '+HEADER+'.invalid\r\n\r\n')),400,'invalid_request');assert.equal((await f.snapshot()).load,0);
  const accepted=await f.request({expectContinue:true});assert.equal(accepted.status,200);assert.equal(accepted.continues,1);assert.equal((await f.snapshot()).operations,1);
});
test('all five native routes and approved exact preflights preserve the application response contracts',async t=>{
  const f=await fixture(t);for(const url of Object.values(PATHS)){const method=url===PATHS.session?'GET':'POST',response=await f.request({method:'OPTIONS',url,body:null,headers:{authorization:undefined,'access-control-request-method':method,'access-control-request-headers':method==='GET'?'authorization':'authorization, content-type'}});assert.equal(response.status,204);assert.equal(response.headers['access-control-allow-origin'],ORIGIN);}assert.equal((await f.snapshot()).load,0);
  const session=await f.request({method:'GET',url:PATHS.session,body:null});assert.equal(session.status,200);assert.equal(session.body.session.projectId,PROJECT);assert.equal(session.body.session.databaseURL,DATABASE);
  const selected=await f.request({url:PATHS.view,body:Buffer.from(JSON.stringify({selection:{productId:'native-product',cycleId:'native-cycle'}}))});assert.equal(selected.status,200);assert.equal(selected.body.view.workers[0].workerId,'native-worker');
  const body=Buffer.from(JSON.stringify({command:tariffCommand()}));assert.equal((await f.request({url:PATHS.append,body})).body.receipt.kind,'appendTariffVersion');assert.equal((await f.request({url:PATHS.resolve,body})).body.outcome,'retired');assert.equal((await f.request()).status,200);const counts=await f.snapshot();for(const kind of ['session','view','append','resolve','operations'])assert.equal(counts[kind],1);
});
test('SDK and service exceptions containing harmless canaries are reduced to generic responses and never reach child stderr/stdout',async t=>{
  const sdk=await fixture(t,'sdk-error');errorResponse(await sdk.request(),503,'unavailable',true);const noInit=await sdk.snapshot();assert.equal(noInit.load,1);assert.equal(noInit.adc,0);assert.equal(noInit.runtime,0);
  const service=await fixture(t,'service-error');errorResponse(await service.request(),503,'result_unknown',true);const counts=await service.snapshot();assert.equal(counts.operations,1);assert.equal(counts.settled,1);
});
test('one-slot admission covers partial body buffering and releases a pre-dispatch disconnect without creating a runtime',async t=>{
  const f=await fixture(t),seen=f.wait(message=>message?.type==='request_seen'&&message.counts.nativeRequests===1),raw=f.rawStart(Buffer.from(rawHeaders('X-Synthetic: '+HEADER+'\r\n',commandBody().length)+'{"command":'));
  const closed=raw.promise.catch(()=>null);await seen;errorResponse(await f.request(),503,'busy',true);assert.equal((await f.snapshot()).load,0);raw.socket.destroy();await closed;await pause(30);assert.equal((await f.request()).status,200);assert.equal((await f.snapshot()).operations,1);
});
test('post-dispatch client disconnect keeps the slot until the actual handler settles, preventing overlapping writes',async t=>{
  const f=await fixture(t);assert.equal((await f.control('pause')).ok,true);const first=f.start(),failure=first.promise.catch(()=>null);await f.wait(message=>message?.type==='operation_started');first.request.destroy();await failure;errorResponse(await f.request(),503,'busy',true);const held=await f.snapshot();assert.equal(held.operations,1);assert.equal(held.settled,0);await f.control('release');await f.wait(message=>message?.type==='runtime_settled'&&message.counts.settled===1);await pause(20);assert.equal((await f.request()).status,200);assert.equal((await f.snapshot()).operations,2);
});
test('the fixed10second incomplete-body timeout emits a generic408 before SDK assembly and releases the sole slot',{timeout:18000},async t=>{
  const f=await fixture(t),started=Date.now(),raw=f.raw(Buffer.from(rawHeaders('X-Synthetic: '+HEADER+'\r\n',commandBody().length)+'{"command":'),{timeout:15000});errorResponse(await raw,408,'invalid_request');assert.ok(Date.now()-started>=9000);assert.equal((await f.snapshot()).load,0);assert.equal((await f.request()).status,200);
});
test('the fixed30second native response deadline is generic and retains write capacity until the pending runtime settles',{timeout:40000},async t=>{
  const f=await fixture(t);assert.equal((await f.control('pause')).ok,true);const first=f.start({timeout:35000}),started=Date.now();await f.wait(message=>message?.type==='operation_started');errorResponse(await first.promise,503,'result_unknown',true);assert.ok(Date.now()-started>=29000);errorResponse(await f.request(),503,'busy',true);const counts=await f.snapshot();assert.equal(counts.operations,1);assert.equal(counts.settled,0);await f.control('release');await f.wait(message=>message?.type==='runtime_settled'&&message.counts.settled===1);await pause(20);assert.equal((await f.request()).status,200);t.diagnostic('Native response deadline does not cancel or prove completion of a database operation; capacity remains held through settlement.');
});

test('explicit enrollment flag false refuses native claim/preflight before runtime assembly and before100continue body transmission',async t=>{
  const f=await fixture(t,'enrollment-off');
  const preflight=await f.request({method:'OPTIONS',url:ENROLLMENT_PATH,body:null,headers:{authorization:undefined,'access-control-request-method':'POST','access-control-request-headers':'authorization, content-type'}});
  errorResponse(preflight,400,'invalid_request');
  const expected=await f.request({url:ENROLLMENT_PATH,body:Buffer.from('{"private":"'+BODY+'"}'),expectContinue:true,headers:{'x-synthetic-private':HEADER}});
  errorResponse(expected,400,'invalid_request');assert.equal(expected.continues,0);
  errorResponse(await f.request({url:ENROLLMENT_PATH,body:ENROLLMENT_BODY}),400,'invalid_request');
  const counts=await f.snapshot();for(const key of ['load','adc','initialize','runtime','requests','enrollment','operations','maxRawBodyBytes'])assert.equal(counts[key],0);assert.equal(counts.expects,1);
});

test('explicit enrollment opt-in forwards the fixed native route and only the minimal success with no body selectors',async t=>{
  const f=await fixture(t,'enrollment');
  const preflight=await f.request({method:'OPTIONS',url:ENROLLMENT_PATH,body:null,headers:{authorization:undefined,'access-control-request-method':'POST','access-control-request-headers':'authorization, content-type'}});
  assert.equal(preflight.status,204);assert.equal(preflight.headers['access-control-allow-origin'],ORIGIN);assert.equal((await f.snapshot()).load,0);
  const accepted=await f.request({url:ENROLLMENT_PATH,body:ENROLLMENT_BODY,expectContinue:true});assert.equal(accepted.status,200);assert.equal(accepted.continues,1);assert.deepEqual(accepted.body,{ok:true});assert.equal(accepted.headers['cache-control'],'no-store');assert.equal(accepted.headers['access-control-allow-origin'],ORIGIN);noCanary(accepted.text);
  for(const body of ['{"email":"synthetic.native.canary@gmail.com"}','{"uid":"native-owner"}','{"profile":{"owner":true}}','{"workerId":"native-worker"}','{"command":{}}'])errorResponse(await f.request({url:ENROLLMENT_PATH,body:Buffer.from(body)}),400,'invalid_request');
  const counts=await f.snapshot();assert.equal(counts.runtime,1);assert.equal(counts.enrollment,1);assert.equal(counts.operations,0);assert.equal(counts.bodyWasUndefined,true);
  t.diagnostic('The enrollment service is synthetic; native route/flag/empty-body/redaction are proved, not fresh Google identity or canonical grant CAS.');
});

test('native enrollment SDK/private-service failures and unexpected identity results expose only fixed identity retry responses',async t=>{
  const sdk=await fixture(t,'enrollment-sdk-error');errorResponse(await sdk.request({url:ENROLLMENT_PATH,body:ENROLLMENT_BODY}),503,'unavailable',true,'retrySameIdentity');const noInit=await sdk.snapshot();assert.equal(noInit.load,1);assert.equal(noInit.adc,0);assert.equal(noInit.runtime,0);
  for(const scenario of ['enrollment-service-error','enrollment-private-result']){const f=await fixture(t,scenario);errorResponse(await f.request({url:ENROLLMENT_PATH,body:ENROLLMENT_BODY}),503,'result_unknown',true,'retrySameIdentity');const counts=await f.snapshot();assert.equal(counts.enrollment,1);assert.equal(counts.operations,0);assert.equal(counts.settled,1);}
});

test('disconnected native enrollment retains the shared claim/command/session slot until its runtime settles',async t=>{
  const f=await fixture(t,'enrollment');assert.equal((await f.control('pause')).ok,true);
  const first=f.start({url:ENROLLMENT_PATH,body:ENROLLMENT_BODY}),failure=first.promise.catch(()=>null);await f.wait(message=>message?.type==='operation_started'&&message.counts.enrollment===1);first.request.destroy();await failure;
  errorResponse(await f.request({url:ENROLLMENT_PATH,body:ENROLLMENT_BODY}),503,'busy',true,'retrySameIdentity');errorResponse(await f.request(),503,'busy',true);errorResponse(await f.request({method:'GET',url:PATHS.session,body:null}),503,'busy');
  const held=await f.snapshot();assert.equal(held.enrollment,1);assert.equal(held.operations,0);assert.equal(held.session,0);assert.equal(held.settled,0);
  await f.control('release');await f.wait(message=>message?.type==='runtime_settled'&&message.counts.settled===1);await pause(20);const accepted=await f.request({url:ENROLLMENT_PATH,body:ENROLLMENT_BODY});assert.equal(accepted.status,200);assert.deepEqual(accepted.body,{ok:true});assert.equal((await f.snapshot()).enrollment,2);
});

test('fixed30second native enrollment deadline requires the same identity and holds the shared slot until settlement',{timeout:40000},async t=>{
  const f=await fixture(t,'enrollment');assert.equal((await f.control('pause')).ok,true);const first=f.start({url:ENROLLMENT_PATH,body:ENROLLMENT_BODY,timeout:35000}),started=Date.now();
  await f.wait(message=>message?.type==='operation_started'&&message.counts.enrollment===1);errorResponse(await first.promise,503,'result_unknown',true,'retrySameIdentity');assert.ok(Date.now()-started>=29000);
  errorResponse(await f.request({url:ENROLLMENT_PATH,body:ENROLLMENT_BODY}),503,'busy',true,'retrySameIdentity');errorResponse(await f.request(),503,'busy',true);const held=await f.snapshot();assert.equal(held.enrollment,1);assert.equal(held.operations,0);assert.equal(held.settled,0);
  await f.control('release');await f.wait(message=>message?.type==='runtime_settled'&&message.counts.settled===1);await pause(20);assert.deepEqual((await f.request({url:ENROLLMENT_PATH,body:ENROLLMENT_BODY})).body,{ok:true});assert.equal((await f.snapshot()).enrollment,2);
  t.diagnostic('Timeout does not cancel a claim or prove a grant exists. This transport requires a fresh verified retry of the same identity; service/Auth/CAS tests establish that separate contract.');
});
