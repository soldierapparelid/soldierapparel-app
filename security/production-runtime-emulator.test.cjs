'use strict';
// Actual Admin/RTDB assembly proof; Google token verifier remains synthetic.
const {test}=require('node:test'),assert=require('node:assert/strict');
const PROJECT='demo-soldier-security',HOST='127.0.0.1',PORT=9000,URL='https://'+PROJECT+'.firebaseio.com',NOW='2026-10-05T03:00:00.000Z',ORIGIN='https://soldier.example.invalid';
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST,HOST+':'+PORT);
assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS&&!process.env.FIREBASE_TOKEN);assert.ok(Number(process.versions.node.split('.')[0])>=22);
const {initializeApp,deleteApp,SDK_VERSION}=require('firebase-admin/app'),{getDatabase}=require('firebase-admin/database');assert.equal(SDK_VERSION,'14.5.0');
const Authority=require('../server/production-authority.cjs'),Runtime=require('../server/production-runtime.cjs');let sequence=0;
function seed(tenantId){const state=Authority.createAuthority({product:{id:'product-1',series:'Synthetic',namaBarang:'Example',size:'M',cutQuantity:10},cycleId:'cycle-1',workers:[{id:'worker-1',nama:'Synthetic partner'}],assignments:[{id:'assignment-1',workerId:'worker-1',qty:10}],now:NOW});return {schemaVersion:1,projectId:PROJECT,tenantId,grants:{'caller-1':{revision:1,profile:{active:true,owner:false,workerId:'worker-1',modules:{jahit:true}}}},products:{'product-1':{cycles:{'cycle-1':{config:{revision:1,active:true,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'},tariffInputs:{revision:1,policy:{version:'policy-1',kind:'jakarta-fixed-local-time',hour:8,minute:0},historyByWorker:{'worker-1':{'tariff-1':{effectiveAt:'2026-01-01T00:00:00.000Z',currency:'IDR',rate:100}}}},wire:Authority.encodeStorage(state)}}}}};}
async function fixture(t,{limit=30,loseAck=false}={}){
  const n=++sequence,tenantId='runtime-proof-'+n,credential={getAccessToken:async()=>({access_token:'owner',expires_in:3600})};
  const a=initializeApp({projectId:PROJECT,databaseURL:URL,credential},'runtime-a-'+n);let b,da,db,tenantRef,quotaRef;
  t.after(async()=>{try{if(tenantRef)await tenantRef.remove();if(quotaRef)await quotaRef.remove();}finally{await Promise.all([a,b].filter(Boolean).map(app=>Promise.resolve().then(()=>deleteApp(app))));}});
  b=initializeApp({projectId:PROJECT,databaseURL:URL,credential},'runtime-b-'+n);da=getDatabase(a);db=getDatabase(b);tenantRef=db.ref('authorityTenants/'+tenantId);quotaRef=db.ref('serverRateLimits/'+tenantId);await tenantRef.set(seed(tenantId));
  const actor={active:true},flags={loseAck},counts={auth:0};
  const auth=app=>({app,verifyIdToken:async(token,revoked)=>{assert.equal(token,'header.payload.signature');assert.equal(revoked,true);counts.auth++;return {uid:'caller-1',sub:'caller-1',aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,email_verified:true,firebase:{sign_in_provider:'google.com'},exp:Date.parse(NOW)/1000+3600};}});
  const wrapped={app:da.app,ref(path){const real=da.ref(path);return {get:()=>real.get(),toString:()=>real.toString(),on:(...args)=>real.on(...args),off:(...args)=>real.off(...args),transaction:async(...args)=>{const result=await real.transaction(...args);if(path.startsWith('authorityTenants/')&&result.committed&&flags.loseAck){flags.loseAck=false;throw Error('synthetic-lost-ack-private-source');}return result;}};}};
  const configuration={enabled:true,projectId:PROJECT,databaseURL:URL,tenantId,allowedOrigins:[ORIGIN],clock:()=>NOW,policy:{rateWindowMs:60000,rateLimit:limit,deadlineMs:10000,maxInFlight:4},testOnlyEmulator:{host:HOST,port:PORT}};
  const runtimeA=Runtime.createProductionRuntime({...configuration,database:wrapped,auth:auth(a)}),runtimeB=Runtime.createProductionRuntime({...configuration,database:db,auth:auth(b)});
  const command=()=>({requestId:'request-1',productId:'product-1',cycleId:'cycle-1',expectedRevision:0,kind:'sewing',payload:{id:'sewing-1',assignmentId:'assignment-1',tanggal:'2026-10-05',good:10,reject:0}});
  async function run(runtime,c=command()){
    const raw=Buffer.from(JSON.stringify({command:c})),headers={origin:ORIGIN,authorization:'Bearer header.payload.signature','content-type':'application/json','content-length':String(raw.length)},req={method:'POST',url:'/v1/production/commands',headers,rawHeaders:Object.entries(headers).flat(),rawBody:raw};
    const response={headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=JSON.parse(body);this.writableEnded=true;}};await runtime.handler(req,response);return response;
  }
  const state=async()=>Authority.decodeStorage((await tenantRef.get()).val().products['product-1'].cycles['cycle-1'].wire);
  return {runtimeA,runtimeB,run,state,tenantRef,quotaRef,command,counts,actor};
}
test('actual assembled SDK handler authenticates, writes a private quota and commits exactly one operation',{timeout:30000},async t=>{
  const f=await fixture(t),first=await f.run(f.runtimeA),retry=await f.run(f.runtimeB);assert.equal(first.statusCode,200);assert.equal(retry.statusCode,200);assert.equal(retry.body.replayed,true);assert.deepEqual(retry.body.receipt,first.body.receipt);assert.equal((await f.state()).revision,1);assert.equal(Object.keys((await f.state()).sewing).length,1);assert.equal((await f.quotaRef.child('caller-1').get()).val().count,2);assert.equal(first.headers['Cache-Control'],'no-store');for(const field of ['worker-1','tarif','privateAuthority','header.payload.signature'])assert.equal(JSON.stringify(first.body).includes(field),false);
});
test('lost actual SDK commit acknowledgment returns uncertainty then exact replay on another runtime',{timeout:30000},async t=>{
  const f=await fixture(t,{loseAck:true}),command=f.command(),lost=await f.run(f.runtimeA,command);assert.equal(lost.statusCode,503);assert.equal(lost.body.retrySameCommand,true);assert.equal(JSON.stringify(lost.body).includes('synthetic-lost-ack-private-source'),false);assert.equal((await f.state()).revision,1);const replay=await f.run(f.runtimeB,command);assert.equal(replay.statusCode,200);assert.equal(replay.body.replayed,true);assert.equal((await f.state()).revision,1);command.payload.good=5;assert.equal((await f.run(f.runtimeB,command)).statusCode,409);assert.equal((await f.state()).revision,1);
});
test('independent assembled runtimes enforce one quota and current inactive grants create no new bucket',{timeout:30000},async t=>{
  const f=await fixture(t,{limit:1}),responses=await Promise.all([f.run(f.runtimeA),f.run(f.runtimeB)]);assert.deepEqual(responses.map(r=>r.statusCode).sort(),[200,429]);assert.equal((await f.state()).revision,1);assert.equal((await f.quotaRef.child('caller-1').get()).val().count,1);
  const g=await fixture(t);await g.tenantRef.child('grants/caller-1/profile/active').set(false);assert.equal((await g.run(g.runtimeA)).statusCode,429);assert.equal((await g.quotaRef.get()).val(),null);assert.equal((await g.state()).revision,0);
});
