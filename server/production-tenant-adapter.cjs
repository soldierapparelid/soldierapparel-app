'use strict';
// Admin-compatible Reference adapter only. No SDK init, credentials, endpoint,
// bootstrap, administrator writer or migration. Both adapter and service stay
// disabled unless an explicitly reviewed server integration enables them.
const Authority=require('./production-authority.cjs');
const Ledger=require('./production-owner-ledger.cjs');
const {contract}=require('./production-command-service.cjs');
const MAX_BYTES=8*1024*1024,MAX_NODES=500000;
const EMULATOR_PORT=9000,WARM_MS=5000;
const forbidden=new Set(['__proto__','constructor','prototype']);
const moduleNames=new Set(['potong','jahit','qc','laporan','stok','gaji','hpp','pembelian','nota','retur']);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const safe=v=>typeof v==='string'&&v.length>0&&v.length<=128&&!forbidden.has(v)&&/^[A-Za-z0-9_-]+$/.test(v);
const fail=code=>{throw new Authority.AuthorityError(code);};
function json(v,depth=0,seen=new Set(),budget={nodes:0}){
  if(++budget.nodes>MAX_NODES||depth>64)fail('storage_capacity');
  if(v===null||typeof v==='string'||typeof v==='boolean')return;
  if(typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=Number.MAX_SAFE_INTEGER)return;
  if(!v||typeof v!=='object'||seen.has(v)||(Array.isArray(v)?Object.getPrototypeOf(v)!==Array.prototype:![Object.prototype,null].includes(Object.getPrototypeOf(v))))fail('invalid_storage');
  seen.add(v);const keys=Reflect.ownKeys(v);
  for(const k of keys){
    if(typeof k!=='string'||forbidden.has(k))fail('invalid_storage');if(Array.isArray(v)&&k==='length')continue;
    const d=Object.getOwnPropertyDescriptor(v,k);
    if(!d||!d.enumerable||!Object.hasOwn(d,'value')||Array.isArray(v)&&(!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=v.length))fail('invalid_storage');
    json(d.value,depth+1,seen,budget);
  }
  if(Array.isArray(v)&&keys.length!==v.length+1)fail('invalid_storage');seen.delete(v);
}
function exact(v,required,optional=[]){if(!object(v)||required.some(k=>!Object.hasOwn(v,k))||Object.keys(v).some(k=>!required.includes(k)&&!optional.includes(k)))fail('invalid_storage');}
function integer(v,min=0,max=Number.MAX_SAFE_INTEGER){if(!Number.isSafeInteger(v)||v<min||v>max)fail('invalid_storage');}
function id(v){if(!safe(v))fail('access_denied');return v;}
function instant(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v).toISOString()!==v)fail('invalid_storage');return v;}
function date(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)fail('invalid_storage');return v;}
const copy=v=>JSON.parse(JSON.stringify(v));
function size(v,max){if(Buffer.byteLength(JSON.stringify(v),'utf8')>max)fail('storage_capacity');}
function map(v){if(!object(v))fail('invalid_storage');for(const key of Object.keys(v))id(key);}
function profile(p){
  exact(p,['active','owner'],['workerId','modules']);if(typeof p.active!=='boolean'||typeof p.owner!=='boolean')fail('invalid_storage');
  if(p.workerId!==undefined)id(p.workerId);
  if(p.modules!==undefined){if(!object(p.modules)||Object.keys(p.modules).some(k=>!moduleNames.has(k)||typeof p.modules[k]!=='boolean'))fail('invalid_storage');}
}
function config(c){exact(c,['revision','active','reviewedEmptyCycle','tariffPolicy']);integer(c.revision);if(typeof c.active!=='boolean'||typeof c.reviewedEmptyCycle!=='boolean'||c.tariffPolicy!=='explicit-historical-jakarta-v1')fail('invalid_storage');}
function inputs(v){
  exact(v,['revision','policy','historyByWorker']);integer(v.revision);
  exact(v.policy,['version','kind','hour','minute']);id(v.policy.version);if(v.policy.kind!=='jakarta-fixed-local-time')fail('invalid_storage');integer(v.policy.hour,0,23);integer(v.policy.minute,0,59);
  map(v.historyByWorker);
  for(const history of Object.values(v.historyByWorker)){
    map(history);const instants=new Set();
    for(const rate of Object.values(history)){
      exact(rate,['effectiveAt','currency','rate']);instant(rate.effectiveAt);integer(rate.rate,1);if(rate.currency!=='IDR'||instants.has(rate.effectiveAt))fail('invalid_storage');instants.add(rate.effectiveAt);
    }
  }
}
function tenant(v,binding,max){
  json(v);size(v,max);exact(v,['schemaVersion','projectId','tenantId','grants','products'],['ownerCommandLedger']);
  if(v.schemaVersion!==1)fail('invalid_storage');if(v.projectId!==binding.projectId||v.tenantId!==binding.tenantId)fail('access_denied');
  map(v.grants);map(v.products);
  for(const g of Object.values(v.grants)){exact(g,['revision','profile']);integer(g.revision);profile(g.profile);}
  for(const [productId,p]of Object.entries(v.products)){
    exact(p,['cycles']);map(p.cycles);
    for(const [cycleId,c]of Object.entries(p.cycles)){
      exact(c,['config','tariffInputs','wire']);config(c.config);inputs(c.tariffInputs);
      const state=Authority.decodeStorage(c.wire);if(state.productId!==productId||state.cycleId!==cycleId)fail('access_denied');
    }
  }
  try{Ledger.validateOwnerLedger(v.ownerCommandLedger,v.products);}catch(error){fail(error&&['storage_capacity','capacity_limit'].includes(error.code)?'storage_capacity':'invalid_storage');}
  return v;
}
function cycle(v,productId,cycleId){id(productId);id(cycleId);if(!Object.hasOwn(v.products,productId)||!Object.hasOwn(v.products[productId].cycles,cycleId))fail('access_denied');return v.products[productId].cycles[cycleId];}
function currentGrant(v,uid,projectId){id(uid);if(!Object.hasOwn(v.grants,uid))fail('access_denied');return {projectId,uid,...copy(v.grants[uid])};}
function query(v,required,projectId){json(v);exact(v,required);if(v.projectId!==projectId)fail('access_denied');}
// Explicit private policy, never an implicit midnight/current-rate fallback.
// An owner-reviewed seed must select this policy before the adapter is enabled.
function select(c,q){
  inputs(c.tariffInputs);date(q.workDate);instant(q.selectedAt);id(q.workerId);id(q.countId);
  const state=Authority.decodeStorage(c.wire);
  if(state.productId!==q.productId||state.cycleId!==q.cycleId||!Object.hasOwn(state.workers,q.workerId)||!Object.values(state.assignments).some(a=>a.workerId===q.workerId))fail('access_denied');
  const p=c.tariffInputs.policy,basisAt=new Date(Date.parse(q.workDate+'T00:00:00.000Z')+(p.hour*60+p.minute-420)*60000).toISOString();
  if(basisAt>q.selectedAt)fail('invalid_storage');
  const history=c.tariffInputs.historyByWorker[q.workerId];if(!history)fail('invalid_storage');
  const eligible=Object.entries(history).filter(([,r])=>r.effectiveAt<=basisAt).sort((a,b)=>a[1].effectiveAt<b[1].effectiveAt?-1:a[1].effectiveAt>b[1].effectiveAt?1:0);
  if(!eligible.length)fail('invalid_storage');const [tariffVersion,r]=eligible[eligible.length-1];
  return {projectId:q.projectId,revision:c.tariffInputs.revision,selection:{source:'private-verified-tariff',verified:true,workerId:q.workerId,productId:q.productId,cycleId:q.cycleId,countId:q.countId,workDate:q.workDate,basisAt,effectiveAt:r.effectiveAt,tariffVersion,currency:r.currency,rate:r.rate,selectedAt:q.selectedAt}};
}
function databaseURL(value){
  if(typeof value!=='string')fail('access_denied');let u;try{u=new URL(value);}catch{fail('access_denied');}
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||u.pathname!=='/'||!/^([a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app)$/.test(u.hostname))fail('access_denied');
  return u.origin;
}
function createProductionTenantAdapter(options={}){
  const {database,projectId,tenantId}=options,enabled=options.enabled===true;
  let reference=null,binding=null,max=MAX_BYTES,emulator=null;
  function checkBinding(){
    try{
      if(!enabled)fail('unsupported_command');
      if(emulator?process.env.FIREBASE_DATABASE_EMULATOR_HOST!==emulator.host+':'+EMULATOR_PORT:process.env.FIREBASE_DATABASE_EMULATOR_HOST!==undefined)fail('access_denied');
      if(!database||typeof database.ref!=='function'||!database.app||!database.app.options||database.app.options.projectId!==projectId||databaseURL(database.app.options.databaseURL)!==binding.databaseURL)fail('access_denied');
      if(reference&&reference.toString()!==binding.referenceURL+'/authorityTenants/'+tenantId)fail('access_denied');
    }catch(error){if(error instanceof Authority.AuthorityError)throw error;fail('invalid_storage');}
  }
  if(enabled){
    if(typeof projectId!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId))fail('access_denied');id(tenantId);
    max=options.maxTenantBytes===undefined?MAX_BYTES:options.maxTenantBytes;integer(max,1,MAX_BYTES);
    const url=databaseURL(options.databaseURL);
    if(options.testOnlyEmulator!==undefined){
      json(options.testOnlyEmulator);exact(options.testOnlyEmulator,['host','port']);
      const e=options.testOnlyEmulator;
      if(!projectId.startsWith('demo-')||!['127.0.0.1','localhost'].includes(e.host)||e.port!==EMULATOR_PORT||url!=='https://'+projectId+'.firebaseio.com')fail('access_denied');
      emulator=copy(e);
    }
    binding={projectId,tenantId,databaseURL:url,referenceURL:emulator?'http://'+emulator.host+':'+EMULATOR_PORT:url};checkBinding();
    try{reference=database.ref('authorityTenants/'+tenantId);}catch{fail('invalid_storage');}
    if(!reference||['get','transaction','toString','on','off'].some(k=>typeof reference[k]!=='function'))fail('access_denied');checkBinding();
  }
  async function read(){
    checkBinding();let result;try{result=await reference.get();}catch{fail('invalid_storage');}
    if(!result||typeof result.val!=='function')fail('invalid_storage');checkBinding();let value;try{value=result.val();}catch{fail('invalid_storage');}return tenant(value,binding,max);
  }
  const repository=Object.freeze({
    async readGrant(q){checkBinding();query(q,['projectId','uid'],projectId);id(q.uid);return currentGrant(await read(),q.uid,projectId);},
    async readCycle(q){checkBinding();query(q,['projectId','productId','cycleId'],projectId);id(q.productId);id(q.cycleId);const c=cycle(await read(),q.productId,q.cycleId);return {projectId,productId:q.productId,cycleId:q.cycleId,config:copy(c.config),wire:copy(c.wire)};},
    async selectTariff(q){checkBinding();query(q,['projectId','productId','cycleId','workerId','countId','workDate','selectedAt'],projectId);id(q.productId);id(q.cycleId);id(q.workerId);id(q.countId);date(q.workDate);instant(q.selectedAt);return select(cycle(await read(),q.productId,q.cycleId),q);}
  });
  const gateway=Object.freeze({projectId,contract,async run(args){
    checkBinding();exact(args,['projectId','productId','cycleId','expectedTrust','update']);if(args.projectId!==projectId||typeof args.update!=='function')fail('access_denied');id(args.productId);id(args.cycleId);
    json(args.expectedTrust);exact(args.expectedTrust,['projectId','uid','grant','cycleConfig','tariff']);if(args.expectedTrust.projectId!==projectId)fail('access_denied');const uid=id(args.expectedTrust.uid);
    let cold=false,terminal=null,called=0,result,listener,timer,transactionStarted=false;
    // SDK get() uses a temporary cache registration. Hold a bounded value
    // subscription through the transaction so a cold SDK cache can be primed;
    // its snapshot NEVER becomes the trust input used at commit.
    const ready=new Promise((resolve,reject)=>{
      const abort=()=>{clearTimeout(timer);reject(new Authority.AuthorityError('invalid_storage'));};
      listener=()=>{clearTimeout(timer);resolve();};timer=setTimeout(abort,WARM_MS);
      try{reference.on('value',listener,abort);}catch{abort();}
    });
    try{await ready;checkBinding();transactionStarted=true;result=await reference.transaction(value=>{
      if(value===null){cold=true;return undefined;}
      try{
        checkBinding();const current=tenant(value,binding,max),c=cycle(current,args.productId,args.cycleId),g=currentGrant(current,uid,projectId);
        let selected=null;
        if(args.expectedTrust.tariff!==null){
          exact(args.expectedTrust.tariff,['projectId','revision','selection']);const expected=args.expectedTrust.tariff.selection;
          exact(expected,['source','verified','workerId','productId','cycleId','countId','workDate','basisAt','effectiveAt','tariffVersion','currency','rate','selectedAt']);
          if(args.expectedTrust.tariff.projectId!==projectId||expected.productId!==args.productId||expected.cycleId!==args.cycleId)fail('access_denied');
          // Only validated request scope is reused; rate/version/basis are
          // recomputed from CANONICAL callback inputs, never copied as truth.
          selected=select(c,{projectId,productId:args.productId,cycleId:args.cycleId,workerId:expected.workerId,countId:expected.countId,workDate:expected.workDate,selectedAt:expected.selectedAt});
        }
        const live={projectId,uid,grant:g,cycleConfig:copy(c.config),tariff:selected};called++;
        const nextWire=args.update(copy(c.wire),live);if(nextWire===undefined)return undefined;
        json(nextWire);const state=Authority.decodeStorage(nextWire);if(state.productId!==args.productId||state.cycleId!==args.cycleId)fail('access_denied');
        const next=copy(current);next.products[args.productId].cycles[args.cycleId].wire=copy(nextWire);tenant(next,binding,max);return next;
      }catch(error){terminal=error instanceof Authority.AuthorityError?error.code:'invalid_storage';return undefined;}
    },undefined,false);}catch{fail(transactionStarted?'transaction_unknown':'invalid_storage');}finally{clearTimeout(timer);try{reference.off('value',listener);}catch{}}
    if(terminal)fail(terminal);checkBinding();
    if(!result||typeof result.committed!=='boolean')fail('transaction_unknown');
    if(!result.committed)return {committed:false,retryable:cold||called>1};
    // A commit may already exist even if its acknowledgment cannot be decoded.
    // Never turn a lost/corrupt acknowledgment into a definite "not saved".
    try{
      if(cold||!called||!result.snapshot||typeof result.snapshot.val!=='function')fail('transaction_unknown');
      const value=result.snapshot.val(),committed=tenant(value,binding,max),c=cycle(committed,args.productId,args.cycleId);
      return {committed:true,retryable:false,wire:copy(c.wire)};
    }catch{fail('transaction_unknown');}
  }});
  return Object.freeze({repository,gateway});
}
module.exports=Object.freeze({createProductionTenantAdapter});
