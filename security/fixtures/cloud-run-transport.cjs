'use strict';
// Child-process synthetic transport fixture. It never imports a Google SDK or
// looks up credentials. No request, token, error, body or header is logged.
const Http=require('../../server/production-http-handler.cjs');
const Native=require('../../server/deployment/cloud-run-server.cjs');
const PROJECT='soldier-native-transport-proof',DATABASE='https://'+PROJECT+'-default-rtdb.firebaseio.com',TENANT='native-transport-tenant',ORIGIN='https://native.example.invalid';
const NOW='2026-01-01T00:00:00.000Z',TOKEN='SYNTHETIC_TOKEN_CANARY.payload.signature';
const SDK_ERROR='SYNTHETIC_SDK_ERROR_CANARY',SERVICE_ERROR='SYNTHETIC_SERVICE_ERROR_CANARY';
const scenario=process.argv[2];
if(!['normal','sdk-error','service-error','enrollment-off','enrollment','enrollment-sdk-error','enrollment-service-error','enrollment-private-result'].includes(scenario)||typeof process.send!=='function'){process.exitCode=1;}else{
  const enrollmentConfigured=scenario.startsWith('enrollment'),enrollmentEnabled=enrollmentConfigured&&scenario!=='enrollment-off';
  const counts={nativeRequests:0,clientErrors:0,expects:0,load:0,adc:0,initialize:0,runtime:0,requests:0,operations:0,enrollment:0,session:0,view:0,append:0,resolve:0,settled:0,maxRawBodyBytes:0,bodyWasUndefined:true};
  let pauseNext=null,activePause=null,server,stopping=false;
  const send=value=>{try{if(process.connected)process.send(value);}catch{}};
  const snapshot=()=>({...counts});
  function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
  async function operation(kind,args,build){
    counts[kind]++;const paused=pauseNext;pauseNext=null;
    if(paused){activePause=paused;send({type:'operation_started',counts:snapshot()});await paused.promise;activePause=null;}
    if(scenario==='service-error'||scenario==='enrollment-service-error')throw Error(SERVICE_ERROR);
    return build(args);
  }
  const service={execute:args=>operation('operations',args,({idToken,command})=>idToken===TOKEN&&typeof command.requestId==='string'?{ok:true,receipt:{requestId:command.requestId,revision:1,acceptedAt:NOW},replayed:false}:{ok:false,error:'access_denied'})};
  // This service is synthetic: no Google verification or grant transaction is
  // proved by its success. Only the actual native/core transport is exercised.
  const enrollmentService={execute:args=>operation('enrollment',args,q=>scenario==='enrollment-private-result'?{ok:true,identity:{email:'synthetic.native.canary@gmail.com',googleSubject:'SYNTHETIC_IDENTITY_CANARY'}}:Object.keys(q).length===1&&q.idToken===TOKEN?{ok:true}:{ok:false,error:'access_denied'})};
  const sessionService={execute:args=>operation('session',args,()=>({ok:true,session:{schemaVersion:1,projectId:PROJECT,databaseURL:DATABASE,tenantId:TENANT,uid:'native-owner',grantRevision:0,profile:{active:true,owner:true},cycles:[{productId:'native-product',cycleId:'native-cycle'}]}}))};
  const ownerTariffService={execute:args=>operation('view',args,({selection})=>({ok:true,view:{schemaVersion:1,projectId:PROJECT,tenantId:TENANT,uid:'native-owner',grantRevision:0,...selection,configRevision:0,tariffRevision:0,serverTime:NOW,policy:{version:'native-policy',kind:'jakarta-fixed-local-time',hour:0,minute:0},workers:[{workerId:'native-worker',label:'Synthetic native worker',assignedQuantity:1,history:[{tariffVersion:'native-original',effectiveAt:NOW,currency:'IDR',rate:137}]}]}}))};
  const ownerTariffWriter={
    execute:args=>operation('append',args,({command:c})=>({ok:true,replayed:false,receipt:{requestId:c.requestId,kind:c.kind,productId:c.productId,cycleId:c.cycleId,workerId:c.workerId,tariffVersion:c.tariffVersion,revision:c.expectedTariffRevision+1,acceptedAt:NOW}})),
    resolveTariffDraft:args=>operation('resolve',args,({command:c})=>({ok:true,outcome:'retired',replayed:false,receipt:{requestId:c.requestId,kind:'retireTariffDraft',productId:c.productId,cycleId:c.cycleId,workerId:c.workerId,tariffVersion:c.tariffVersion,retiredAt:NOW}}))
  };
  const fakeSdk={getApps:()=>[],applicationDefault(){counts.adc++;return {synthetic:true};},initializeApp(options,name){counts.initialize++;return {name,options};},getAuth:app=>({app,verifyIdToken(){throw Error('Real Auth forbidden in synthetic fixture');}}),getDatabase:app=>({app,ref(){throw Error('Real database forbidden in synthetic fixture');}})};
  try{
    const host=Native.createCloudRunServer({
      configuration:{enabled:true,projectId:PROJECT,databaseURL:DATABASE,tenantId:TENANT,allowedOrigins:[ORIGIN],serviceAccount:'soldier-production-runtime@'+PROJECT+'.iam.gserviceaccount.com',...(enrollmentConfigured?{enrollmentEnabled}: {})},
      environment:()=>({GOOGLE_CLOUD_PROJECT:PROJECT,K_SERVICE:'soldier-production',K_CONFIGURATION:'soldier-production',K_REVISION:'soldier-production-00001-synthetic',PORT:'8080'}),
      loadAdminSdk(){counts.load++;if(scenario==='sdk-error'||scenario==='enrollment-sdk-error')throw Error(SDK_ERROR);return fakeSdk;},
      createRuntime(options){
        if(options.enrollmentEnabled!==enrollmentEnabled)throw Error('SYNTHETIC_RUNTIME_FLAG_CANARY');
        counts.runtime++;const handler=Http.createProductionHttpHandler({enabled:true,allowedOrigins:[ORIGIN],deadlineMs:25000,maxInFlight:1,service,sessionService,ownerTariffService,ownerTariffWriter,...(options.enrollmentEnabled?{enrollmentService}:{}),ownerBinding:{projectId:PROJECT,tenantId:TENANT}});
        return {handler:async(req,res)=>{
          counts.requests++;counts.maxRawBodyBytes=Math.max(counts.maxRawBodyBytes,Buffer.isBuffer(req.rawBody)?req.rawBody.length:0);counts.bodyWasUndefined=counts.bodyWasUndefined&&req.body===undefined;
          try{await handler(req,res);}finally{counts.settled++;send({type:'runtime_settled',counts:snapshot()});}
        }};
      }
    });
    if(!host.enabled||!host.server)throw Error();server=host.server;
    server.on('request',()=>{counts.nativeRequests++;send({type:'request_seen',counts:snapshot()});});
    server.on('checkContinue',()=>{counts.expects++;send({type:'expect_seen',counts:snapshot()});});
    server.on('clientError',()=>{counts.clientErrors++;});
    server.listen(0,'127.0.0.1',()=>{
      const address=server.address();if(!address||address.address!=='127.0.0.1'){server.closeAllConnections();server.close(()=>process.exit(1));return;}
      // Port and counters are the only values emitted by this fixture.
      process.stdout.write('SYNTHETIC_NATIVE_PORT '+address.port+'\n');send({type:'ready',port:address.port,counts:snapshot()});
    });
  }catch{process.stdout.write('SYNTHETIC_FIXTURE_START_FAILED\n');process.exitCode=1;}
  process.on('message',message=>{
    if(!message||typeof message!=='object'||!Number.isSafeInteger(message.id)||!['snapshot','pause','release','stop'].includes(message.type))return;
    if(message.type==='snapshot'){send({type:'ack',id:message.id,counts:snapshot()});return;}
    if(message.type==='pause'){if(pauseNext||activePause){send({type:'ack',id:message.id,ok:false});return;}pauseNext=deferred();send({type:'ack',id:message.id,ok:true});return;}
    if(message.type==='release'){const pause=activePause||pauseNext;pauseNext=null;if(pause)pause.resolve();send({type:'ack',id:message.id,ok:true});return;}
    if(message.type==='stop'&&!stopping){stopping=true;activePause?.resolve();pauseNext?.resolve();pauseNext=null;send({type:'ack',id:message.id,ok:true});if(server){server.closeAllConnections();server.close(()=>process.exit(0));}else process.exit(1);}
  });
}
