'use strict';
// Genuine pinned Functions SDK + Functions Framework HTTP middleware on an
// ephemeral loopback server. Auth/Admin/runtime services are synthetic. This
// proves local middleware compatibility, not live Google login, platform ingress
// limits, IAM, billing, deployment, or an upstream memory/response-time bound.
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {createRequire}=require('node:module');
const deploymentRequire=createRequire(path.resolve(__dirname,'../server/deployment/package.json'));
const {onRequest}=deploymentRequire('firebase-functions/v2/https');
const Framework=require('@google-cloud/functions-framework');
const {getTestServer}=require('@google-cloud/functions-framework/testing');
const Fixture=require('./fixtures/functions-transport.cjs');
let sequence=0;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function serverFixture(t,options){
  const fixture=Fixture.createFixture(options),exports=fixture.createExports(onRequest),name='syntheticTransport'+(++sequence);
  Framework.http(name,exports.soldierProduction);
  const server=getTestServer(name);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(async()=>{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));});
  const address=server.address();assert.equal(address.address,'127.0.0.1');
  function start({method='POST',url=Fixture.PATHS.command,body=Buffer.from('{"command":{"requestId":"transport-request","label":"contoh jahit"}}'),headers,duplicateHeaders}={}){
    const base={origin:Fixture.ORIGIN,authorization:'Bearer '+Fixture.TOKEN,...(body!==null?{'content-type':'application/json','content-length':String(body.length)}:{})};
    const final=headers===undefined?base:{...base,...headers};for(const k of Object.keys(final))if(final[k]===undefined)delete final[k];
    const rawHeaders=duplicateHeaders?[...Object.entries(final).flat(),...duplicateHeaders]:final;
    let request;
    const promise=new Promise((resolve,reject)=>{
      request=http.request({hostname:'127.0.0.1',port:address.port,method,path:url,headers:rawHeaders,agent:false},res=>{
        const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);res.on('end',()=>{const text=Buffer.concat(chunks).toString('utf8');let value=null;try{value=text?JSON.parse(text):null;}catch{}resolve({status:res.statusCode,headers:res.headers,text,body:value});});
      });
      request.on('error',reject);request.setTimeout(3000,()=>request.destroy(Error('synthetic_request_timeout')));
      request.end(body===null?undefined:body);
    });
    return {request,promise};
  }
  return {...fixture,exported:exports.soldierProduction,request:options=>start(options).promise,start};
}
const errorResponse=(r,status,error)=>{assert.equal(r.status,status);assert.deepEqual(r.body,{ok:false,error});assert.equal(r.headers['cache-control'],'no-store');assert.equal(r.headers['x-content-type-options'],'nosniff');};

test('transport loads the actual deployment-pinned Firebase Functions7.3.0 and isolated Framework5.0.5, without configuring a real Admin app',async t=>{
  const sdkPath=path.resolve(path.dirname(deploymentRequire.resolve('firebase-functions/v2/https')),'../../../package.json');
  const frameworkPath=path.resolve(path.dirname(require.resolve('@google-cloud/functions-framework')),'../../package.json');
  assert.equal(JSON.parse(fs.readFileSync(sdkPath,'utf8')).version,'7.3.0');
  assert.equal(JSON.parse(fs.readFileSync(frameworkPath,'utf8')).version,'5.0.5');
  const lock=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../server/deployment/package-lock.json'),'utf8'));
  assert.equal(lock.packages['node_modules/firebase-functions'].version,'7.3.0');
  const f=await serverFixture(t);assert.equal(typeof f.exported,'function');assert.equal(f.exported.__endpoint.platform,'gcfv2');
  assert.deepEqual(f.exported.__endpoint.region,['asia-southeast1']);
  for(const [key,value]of Object.entries({availableMemoryMb:512,cpu:1,minInstances:0,maxInstances:1,concurrency:1,timeoutSeconds:60,serviceAccountEmail:Fixture.configuration().serviceAccount}))assert.equal(f.exported.__endpoint[key],value);
  assert.deepEqual(f.exported.__endpoint.httpsTrigger.invoker,['public']);
  assert.equal(f.counts.load,0);assert.equal(f.counts.adc,0);assert.equal(f.counts.initialize,0);
  t.diagnostic('Real Firebase Functions SDK and Functions Framework; synthetic Auth/Admin services; loopback HTTP only.');
});

test('the exact gaxios6.7.1 parent resolves reviewed uuid11.1.1 through its CommonJS exports without making a request',()=>{
  const entry=deploymentRequire.resolve('gaxios'),parentRequire=createRequire(entry);
  const manifest=JSON.parse(fs.readFileSync(path.resolve(path.dirname(entry),'../../package.json'),'utf8'));
  assert.equal(manifest.name,'gaxios');assert.equal(manifest.version,'6.7.1');
  const uuidManifest=parentRequire('uuid/package.json');assert.equal(uuidManifest.version,'11.1.1');
  assert.equal(uuidManifest.exports['.'].node.require,'./dist/cjs/index.js');
  assert.match(parentRequire.resolve('uuid'),/[\\/]uuid[\\/]dist[\\/]cjs[\\/]index\.js$/);
  assert.equal(typeof parentRequire('uuid').v4,'function');
  const {Gaxios}=deploymentRequire('gaxios');assert.equal(typeof Gaxios,'function');
  // Construction does not execute request() or discover credentials. The
  // transport fixture continues to supply synthetic services for all HTTP.
  assert.equal(typeof new Gaxios().request,'function');
});

test('the reviewed parent-resolved uuid retains gaxios no-buffer v4 string behavior across100calls',()=>{
  const parentRequire=createRequire(deploymentRequire.resolve('gaxios')),{v4}=parentRequire('uuid'),seen=new Set();
  for(let i=0;i<100;i++){
    const value=v4();assert.equal(typeof value,'string');
    assert.match(value,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(seen.has(value),false);seen.add(value);
  }
  assert.equal(seen.size,100);
});

test('Framework preserves the original UTF8 rawBody Buffer and full route while the core returns its bounded receipt',async t=>{
  const f=await serverFixture(t),raw=Buffer.from('{"command":{"requestId":"transport-utf8","label":"jahit contoh ✓"}}');
  const r=await f.request({body:raw});assert.equal(r.status,200);
  assert.deepEqual(r.body,{ok:true,receipt:{requestId:'transport-utf8',revision:1,acceptedAt:Fixture.NOW},replayed:false});
  assert.equal(r.headers['access-control-allow-origin'],Fixture.ORIGIN);assert.equal(r.headers['cache-control'],'no-store');
  assert.equal(r.headers['access-control-allow-credentials'],undefined);
  assert.deepEqual(f.captures[0].rawBody,raw);assert.equal(f.captures[0].url,Fixture.PATHS.command);
  assert.equal(f.captures[0].parsedBody.command.label,'jahit contoh ✓');assert.equal(f.counts.operations,1);
});

test('duplicate and escaped JSON aliases remain rejected after Framework JSON.parse has retained a last value',async t=>{
  const f=await serverFixture(t);
  for(const text of ['{"command":{"requestId":"first","requestId":"second"}}','{"command":{"requestId":"first","request\\u0049d":"second"}}','{"command":{"requestId":"transport-duplicate","nested":{"x":1,"x":2}}}','{"command":{"requestId":"transport-reserved","__proto__":{"synthetic":true}}}']){
    const r=await f.request({body:Buffer.from(text)});errorResponse(r,400,'invalid_request');
  }
  assert.equal(f.counts.operations,0);assert.equal(f.captures.length,4);
  assert.equal(f.captures[0].parsedBody.command.requestId,'second');
});

test('invalid UTF8 is rejected from original bytes even when Framework parsing creates a replacement character',async t=>{
  const f=await serverFixture(t),raw=Buffer.concat([Buffer.from('{"command":{"requestId":"transport-'),Buffer.from([0xff]),Buffer.from('"}}')]);
  errorResponse(await f.request({body:raw}),400,'invalid_request');assert.equal(f.counts.operations,0);
  assert.deepEqual(f.captures[0].rawBody,raw);assert.match(f.captures[0].parsedBody.command.requestId,/\uFFFD/);
});

test('malformed JSON is rejected by upstream Framework parsing before the safe application error boundary',async t=>{
  const f=await serverFixture(t);
  // Contains no value or identifier that an upstream parser could quote. The
  // upstream Express response format is intentionally not called a safe JSON
  // application error; production parser logging still requires host review.
  const r=await f.request({body:Buffer.from('{"command":')});assert.equal(r.status,400);
  assert.equal(f.counts.load,0);assert.equal(f.counts.requests,0);assert.equal(f.counts.operations,0);
  t.diagnostic('Malformed JSON can fail in Framework middleware before application error/redaction headers are applied.');
});

test('allowed preflight uses exact origin and methods without reaching the injected ADC or runtime',async t=>{
  const f=await serverFixture(t);
  for(const [url,method,allowed]of [[Fixture.PATHS.command,'POST','Authorization, Content-Type'],[Fixture.PATHS.session,'GET','Authorization'],[Fixture.PATHS.resolve,'POST','Authorization, Content-Type']]){
    const r=await f.request({method:'OPTIONS',url,body:null,headers:{authorization:undefined,'access-control-request-method':method,'access-control-request-headers':method==='GET'?'authorization':'authorization, content-type'}});
    assert.equal(r.status,204);assert.equal(r.body,null);assert.equal(r.headers['access-control-allow-origin'],Fixture.ORIGIN);assert.equal(r.headers['access-control-allow-methods'],method);assert.equal(r.headers['access-control-allow-headers'],allowed);
  }
  assert.equal(f.counts.load,0);assert.equal(f.counts.runtime,0);
  errorResponse(await f.request({method:'OPTIONS',body:null,headers:{authorization:undefined,'access-control-request-method':'DELETE','access-control-request-headers':'authorization, content-type'}}),400,'invalid_request');
  assert.equal(f.counts.load,0);
});

test('unapproved or absent origin, malformed bearer and duplicated security headers fail before Admin initialization',async t=>{
  const f=await serverFixture(t);
  for(const headers of [{origin:'https://foreign.example.invalid'},{origin:undefined}]){
    const r=await f.request({headers});errorResponse(r,403,'access_denied');assert.equal(r.headers['access-control-allow-origin'],undefined);
  }
  for(const headers of [{authorization:undefined},{authorization:'Bearer invalid'}, {'content-type':'text/plain'}])errorResponse(await f.request({headers}),400,'invalid_request');
  for(const [name,value,status,error]of [['Authorization','Bearer '+Fixture.TOKEN,400,'invalid_request'],['Origin',Fixture.ORIGIN,403,'access_denied']]){
    const entries=f.counts.entries,r=await f.request({duplicateHeaders:[name,value]});
    if(f.counts.entries===entries+1)errorResponse(r,status,error);
    else {assert.equal(r.status,400);assert.equal(f.counts.entries,entries);t.diagnostic('Duplicate '+name+' rejected upstream with HTTP400 before the application adapter.');}
    assert.equal(f.counts.load,0);assert.equal(f.counts.requests,0);
  }
  const entries=f.counts.entries,contentType=await f.request({duplicateHeaders:['Content-Type','application/json']});
  assert.equal(contentType.status,400);
  if(f.counts.entries===entries+1)errorResponse(contentType,400,'invalid_request');
  else {assert.equal(f.counts.entries,entries);t.diagnostic('Duplicate Content-Type rejected upstream with HTTP400 before the application adapter; response format is an upstream contract.');}
  assert.equal(f.counts.load,0);assert.equal(f.counts.requests,0);
});

test('Framework forwarding does not make queries, trailing routes, bootstrap routes or foreign prefixes usable',async t=>{
  const f=await serverFixture(t);
  for(const url of [Fixture.PATHS.command+'?tenantId=foreign',Fixture.PATHS.command+'/',Fixture.PATHS.view+'?debug=true','/v1/production/bootstrap','/v1/production/owner/grants','/soldierProduction'+Fixture.PATHS.command])errorResponse(await f.request({url}),400,'invalid_request');
  assert.equal(f.counts.load,0);assert.equal(f.counts.requests,0);
});

test('session GET and owner POST routes remain distinct through genuine SDK and Framework middleware',async t=>{
  const f=await serverFixture(t);
  const session=await f.request({method:'GET',url:Fixture.PATHS.session,body:null});assert.equal(session.status,200);assert.equal(session.body.session.uid,'transport-owner');
  const view=await f.request({url:Fixture.PATHS.view,body:Buffer.from(JSON.stringify({selection:{productId:'transport-product',cycleId:'transport-cycle'}}))});assert.equal(view.status,200);assert.equal(view.body.view.workers[0].workerId,'transport-worker');
  const body=Buffer.from(JSON.stringify({command:Fixture.tariffCommand()}));
  const append=await f.request({url:Fixture.PATHS.append,body});assert.equal(append.status,200);assert.equal(append.body.receipt.kind,'appendTariffVersion');
  const resolved=await f.request({url:Fixture.PATHS.resolve,body});assert.equal(resolved.status,200);assert.equal(resolved.body.outcome,'retired');assert.equal(resolved.body.receipt.kind,'retireTariffDraft');
  errorResponse(await f.request({method:'GET',url:Fixture.PATHS.view,body:null}),405,'invalid_request');
  errorResponse(await f.request({method:'POST',url:Fixture.PATHS.session}),405,'invalid_request');
  errorResponse(await f.request({method:'GET',url:Fixture.PATHS.session}),400,'invalid_request');
  assert.equal(f.counts.session,1);assert.equal(f.counts.view,1);assert.equal(f.counts.append,1);assert.equal(f.counts.resolve,1);
});

test('the application rejects a32769byte body after Framework buffering and never initializes Admin for it',async t=>{
  const f=await serverFixture(t);
  // Generate by byte target rather than assuming the surrounding JSON width.
  const overhead=Buffer.byteLength('{"command":{"requestId":"transport-large","padding":""}}');
  const body=Buffer.from('{"command":{"requestId":"transport-large","padding":"'+'a'.repeat(32769-overhead)+'"}}');assert.equal(body.length,32769);
  errorResponse(await f.request({body}),400,'invalid_request');assert.equal(f.counts.load,0);assert.equal(f.counts.requests,0);
  const boundary=Buffer.from('{"command":{"requestId":"transport-large","padding":"'+'a'.repeat(32768-overhead)+'"}}');assert.equal(boundary.length,32768);
  assert.equal((await f.request({body:boundary})).status,200);assert.equal(f.counts.operations,1);
  t.diagnostic('Application32KiB validation happens after the Framework body parser has buffered the request.');
});

test('compressed JSON remains forbidden even though Framework has already decompressed its rawBody',async t=>{
  const f=await serverFixture(t),body=zlib.gzipSync(Buffer.from('{"command":{"requestId":"transport-compressed"}}'));
  errorResponse(await f.request({body,headers:{'content-encoding':'gzip'}}),400,'invalid_request');assert.equal(f.counts.load,0);assert.equal(f.counts.operations,0);
});

test('real HTTP response does not finish before the injected operation settles',async t=>{
  const f=await serverFixture(t),blocked=f.pauseNext();let complete=false;
  const running=f.request().then(r=>{complete=true;return r;});await blocked.started;await pause(20);assert.equal(complete,false);assert.equal(f.counts.settled,0);
  blocked.release();assert.equal((await running).status,200);await blocked.completed;assert.equal(f.counts.settled,1);
});

test('deadline classification keeps the shared HTTP slot until settlement and returns the exact-command retry instruction',async t=>{
  const f=await serverFixture(t,{deadlineMs:10}),blocked=f.pauseNext();let complete=false;
  const first=f.request().then(r=>{complete=true;return r;});await blocked.started;await pause(25);assert.equal(complete,false);
  const busy=await f.request({url:Fixture.PATHS.resolve,body:Buffer.from(JSON.stringify({command:Fixture.tariffCommand()}))});assert.equal(busy.status,503);assert.deepEqual(busy.body,{ok:false,error:'busy',retrySameCommand:true});assert.equal(f.counts.resolve,0);
  blocked.release();const r=await first;assert.equal(r.status,503);assert.deepEqual(r.body,{ok:false,error:'result_unknown',retrySameCommand:true});
  assert.equal((await f.request()).status,200);assert.equal(f.counts.operations,2);
});

test('disconnecting a real loopback client does not free an unsettled command slot or start another write',async t=>{
  const f=await serverFixture(t),blocked=f.pauseNext(),first=f.start();
  const failure=first.promise.catch(e=>e);await blocked.started;first.request.destroy();assert.ok((await failure) instanceof Error);
  const busy=await f.request();assert.equal(busy.status,503);assert.deepEqual(busy.body,{ok:false,error:'busy',retrySameCommand:true});assert.equal(f.counts.operations,1);
  blocked.release();await blocked.completed;
  // Core/adapter finally runs on the next promise turn, without relying on a
  // disconnected response to keep the in-flight fence alive.
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.counts.settled,2);
  assert.equal((await f.request()).status,200);assert.equal(f.counts.operations,2);
});
