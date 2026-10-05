'use strict';
// Disabled-by-default distributed admission only. No SDK initialization,
// credentials, deployment, authority writes, automatic policy change or logs.
const MAX_BUCKET_BYTES=2048,WARM_MS=5000,EMULATOR_PORT=9000;
const forbidden=new Set(['__proto__','constructor','prototype']);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const safeId=value=>typeof value==='string'&&value.length>0&&value.length<=128&&!forbidden.has(value)&&/^[A-Za-z0-9_-]+$/.test(value);
const integer=(value,min=0)=>Number.isSafeInteger(value)&&value>=min;
function fields(value,names){
  if(!object(value)||Reflect.ownKeys(value).length!==names.length)return false;
  return names.every(name=>{const d=Object.getOwnPropertyDescriptor(value,name);return d&&d.enumerable&&Object.hasOwn(d,'value');});
}
function url(value){
  if(typeof value!=='string')return null;
  try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&u.pathname==='/'&&/^([a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app)$/.test(u.hostname)?u.origin:null;}catch{return null;}
}
const bucketFields=['schemaVersion','projectId','databaseURL','tenantId','uid','windowMs','limit','windowStartMs','lastSeenMs','count'];
function validBucket(value,binding,uid){
  if(!fields(value,bucketFields))return false;
  if(value.schemaVersion!==1||value.projectId!==binding.projectId||value.databaseURL!==binding.databaseURL||value.tenantId!==binding.tenantId||value.uid!==uid||value.windowMs!==binding.windowMs||value.limit!==binding.limit)return false;
  if(!integer(value.windowStartMs)||value.windowStartMs%binding.windowMs!==0||!integer(value.lastSeenMs)||value.lastSeenMs<value.windowStartMs||value.lastSeenMs-value.windowStartMs>=binding.windowMs||!integer(value.count,1)||value.count>binding.limit)return false;
  // Every field is now a bounded primitive; no SDK getter/toJSON is invoked.
  const bytes=Buffer.byteLength(JSON.stringify(bucketFields.map(key=>value[key])),'utf8');
  return bytes<=MAX_BUCKET_BYTES;
}
const identical=(a,b)=>bucketFields.every(key=>a[key]===b[key]);
function createProductionRateLimiter(options={}){
  const enabled=options.enabled===true,{projectId,tenantId,database,windowMs,limit,clock,allow}=options;
  const databaseURL=url(options.databaseURL),testOnlyEmulator=options.testOnlyEmulator;
  let emulator=null,configured=false,highWaterMs=-1;
  if(enabled&&typeof projectId==='string'&&/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)&&safeId(tenantId)&&databaseURL&&integer(windowMs,1)&&integer(limit,1)&&typeof clock==='function'&&typeof allow==='function'){
    configured=true;
    if(testOnlyEmulator!==undefined){
      if(!fields(testOnlyEmulator,['host','port'])||!projectId.startsWith('demo-')||!['127.0.0.1','localhost'].includes(testOnlyEmulator.host)||testOnlyEmulator.port!==EMULATOR_PORT||databaseURL!=='https://'+projectId+'.firebaseio.com')configured=false;
      else emulator=Object.freeze({host:testOnlyEmulator.host,port:testOnlyEmulator.port});
    }
  }
  const binding=Object.freeze({projectId,databaseURL,tenantId,windowMs,limit});
  function current(reference,uid){
    if(!enabled||!configured)return false;
    if(emulator?process.env.FIREBASE_DATABASE_EMULATOR_HOST!==emulator.host+':'+EMULATOR_PORT:process.env.FIREBASE_DATABASE_EMULATOR_HOST!==undefined)return false;
    if(!database||typeof database.ref!=='function'||!database.app||!database.app.options||database.app.options.projectId!==projectId||url(database.app.options.databaseURL)!==databaseURL)return false;
    return !reference||reference.toString()===(emulator?'http://'+emulator.host+':'+EMULATOR_PORT:databaseURL)+'/serverRateLimits/'+tenantId+'/'+uid;
  }
  async function admit(scope){
    let reference,listener,timer;
    try{
      if(!enabled||!configured||!fields(scope,['projectId','uid'])||scope.projectId!==projectId||!safeId(scope.uid)||!current())return false;
      const uid=scope.uid,trustedScope=Object.freeze({projectId,uid});
      // Caller supplies a canonical grant predicate, not a token/body claim.
      // Unknown/inactive accounts cannot even create a quota Reference/bucket.
      if(await allow(trustedScope)!==true||!current())return false;
      reference=database.ref('serverRateLimits/'+tenantId+'/'+uid);
      if(!reference||['on','off','transaction','toString'].some(key=>typeof reference[key]!=='function')||!current(reference,uid))return false;
      const ready=new Promise((resolve,reject)=>{
        const failed=()=>{clearTimeout(timer);reject(Error('admission_unavailable'));};
        listener=()=>{clearTimeout(timer);resolve();};timer=setTimeout(failed,WARM_MS);
        try{reference.on('value',listener,failed);}catch{failed();}
      });
      await ready;if(!current(reference,uid))return false;
      const now=clock();if(!integer(now)||now<highWaterMs)return false;
      highWaterMs=now;const windowStartMs=Math.floor(now/windowMs)*windowMs;
      let candidate=null,invalid=false;
      const result=await reference.transaction(value=>{
        candidate=null;
        try{
          if(invalid||!current(reference,uid))return undefined;
          if(value!==null&&!validBucket(value,binding,uid)){invalid=true;return undefined;}
          if(value!==null&&(now<value.lastSeenMs||windowStartMs<value.windowStartMs))return undefined;
          const count=value===null||windowStartMs>value.windowStartMs?1:value.count<limit?value.count+1:null;
          if(count===null||!integer(count,1)||count>limit)return undefined;
          candidate={schemaVersion:1,projectId,databaseURL,tenantId,uid,windowMs,limit,windowStartMs,lastSeenMs:now,count};
          if(!validBucket(candidate,binding,uid)){invalid=true;candidate=null;return undefined;}
          return {...candidate};
        }catch{invalid=true;candidate=null;return undefined;}
      },undefined,false);
      if(invalid||!current(reference,uid)||!candidate||!result||result.committed!==true||!result.snapshot||typeof result.snapshot.val!=='function')return false;
      const committed=result.snapshot.val();
      return validBucket(committed,binding,uid)&&identical(committed,candidate);
    }catch{return false;}
    finally{clearTimeout(timer);if(reference&&listener){try{reference.off('value',listener);}catch{}}}
  }
  return Object.freeze({admit});
}
module.exports=Object.freeze({createProductionRateLimiter});
