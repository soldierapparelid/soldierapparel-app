'use strict';
// Separate canonical-tenant read candidate, synthetic loopback tests only.
// No existing Rules/harness/production deployment is changed by this file.
// Browser contract: fixed own profile leaves and own grant revision, cycle operations
// and revision, own earningsByWorker/{workerId}; no ancestor discovery.
// Operations intentionally share quantities across approved operational
// modules. Wages are current derived entries with frozen rates, not payment
// history/settlement. Trusted server manifests/writers and legacy cutover are
// still required; Rules cannot sanitize a privileged Admin's invalid output.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
if(process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')throw Error('Canonical Rules proof requires the isolated demo loopback emulator.');
if(process.env.GOOGLE_APPLICATION_CREDENTIALS||process.env.FIREBASE_TOKEN)throw Error('Canonical Rules proof forbids real credential configuration.');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {ref,get,set,update,runTransaction,onValue}=require('firebase/database');
const Authority=require('../server/production-authority.cjs');
const PROJECT='demo-soldier-security',TENANT='tenant-1',NOW='2026-10-05T03:00:00.000Z',DAY='2026-10-05';
const T='authorityTenants/'+TENANT,C=T+'/products/product-1/cycles/cycle-1',P=C+'/wire/projection',O=P+'/operations',W=P+'/earningsByWorker';
const copy=v=>JSON.parse(JSON.stringify(v));let env;
const claims={email_verified:true,firebase:{sign_in_provider:'google.com'}};
const db=(uid,override={})=>env.authenticatedContext(uid,{...claims,...override}).database();
const clientRef=(client,path)=>path===''?ref(client):ref(client,path);
const grant=(profile)=>({revision:1,profile:{active:true,owner:false,...profile}});
function wire(){
  let state=Authority.createAuthority({product:{id:'product-1',series:'Synthetic',namaBarang:'Example',size:'M',cutQuantity:10},cycleId:'cycle-1',workers:[{id:'worker-1',nama:'Synthetic one'},{id:'worker-2',nama:'Synthetic two'}],assignments:[{id:'assignment-1',workerId:'worker-1',qty:5},{id:'assignment-2',workerId:'worker-2',qty:5}],now:NOW});
  const actor={uid:'fixture-owner',emailVerified:true,provider:'google.com',profile:{active:true,owner:true},now:NOW};
  function step(kind,payload,extra={}){state=Authority.applyCommand(state,{...actor,...extra},{requestId:'fixture-'+(state.revision+1),productId:'product-1',cycleId:'cycle-1',expectedRevision:state.revision,kind,payload}).state;}
  for(const n of [1,2])step('sewing',{id:'sewing-'+n,assignmentId:'assignment-'+n,tanggal:DAY,good:5,reject:0});
  for(const n of [1,2]){const id='count-'+n;step('count',{id,assignmentId:'assignment-'+n,tanggal:DAY,jumlah:5},{selectedTariffs:{[id]:{source:'private-verified-tariff',verified:true,workerId:'worker-'+n,productId:'product-1',cycleId:'cycle-1',countId:id,workDate:DAY,basisAt:NOW,effectiveAt:'2026-01-01T00:00:00.000Z',tariffVersion:'tariff-'+n,currency:'IDR',rate:n*100,selectedAt:NOW}}});}
  return Authority.encodeStorage(state);
}
function fixture(){
  const stored=wire(),profileModules=['potong','jahit','qc','laporan','stok','gaji','hpp','pembelian','nota','retur'];
  const grants={owner:grant({owner:true}),jahit:grant({workerId:'worker-1',modules:{jahit:true}}),potong:grant({workerId:'worker-2',modules:{potong:true}}),qc:grant({modules:{qc:true}}),qcBound:grant({workerId:'worker-1',modules:{qc:true}}),unbound:grant({modules:{jahit:true}}),revoked:grant({active:false,workerId:'worker-1',modules:{jahit:true}}),'live-jahit':grant({workerId:'worker-1',modules:{jahit:true}}),rebound:grant({workerId:'worker-1',modules:{jahit:true}}),constructor:grant({owner:true})};
  grants['revision-user']=grant({modules:{qc:true}});
  for(const m of profileModules)if(!grants[m])grants[m]=grant({modules:{[m]:true}});
  const cycle={config:{revision:1,active:true,reviewedEmptyCycle:true,tariffPolicy:'explicit-historical-jakarta-v1'},tariffInputs:{revision:1,policy:{version:'policy-1',kind:'jakarta-fixed-local-time',hour:8,minute:0},historyByWorker:{'worker-1':{'tariff-1':{effectiveAt:'2026-01-01T00:00:00.000Z',currency:'IDR',rate:100}},'worker-2':{'tariff-2':{effectiveAt:'2026-01-01T00:00:00.000Z',currency:'IDR',rate:200}}}},wire:stored};
  const tenant={schemaVersion:1,projectId:PROJECT,tenantId:TENANT,grants,products:{'product-1':{cycles:{'cycle-1':cycle}}}};
  const other=copy(tenant);other.tenantId='other-tenant';other.grants={'other-user':grant({owner:true})};
  return {authorityTenants:{[TENANT]:tenant,'other-tenant':other},accessControl:{users:{unregistered:{active:true,owner:true}},emailGrants:{'synthetic,remote@gmail,com':{active:true,workerId:'worker-1',modules:{jahit:true}}}},soldier:{produksi:{synthetic:true}},integrationSecrets:{synthetic:true},credentials:{synthetic:true},rateLimits:{synthetic:true},serverRateLimits:{[TENANT]:{owner:{window:1,count:1},jahit:{window:1,count:1}}}};
}
before(async()=>{env=await initializeTestEnvironment({projectId:PROJECT,database:{host:'127.0.0.1',port:9000,rules:fs.readFileSync(__dirname+'/authority-tenant.rules.json','utf8')}});await env.withSecurityRulesDisabled(async c=>set(ref(c.database()),fixture()));});
after(async()=>{if(env)await env.cleanup();});
async function mutate(fn){await env.withSecurityRulesDisabled(async c=>{
  const tenantRef=ref(c.database(),T);let unsubscribe,timer;
  // Hold the Web SDK's tenant cache registration through CAS. The listener
  // snapshot is ignored; only the current transaction callback is mutated.
  const ready=new Promise((resolve,reject)=>{
    const failed=()=>{clearTimeout(timer);reject(Error('fixture tenant preparation failed'));};
    timer=setTimeout(failed,5000);
    try{unsubscribe=onValue(tenantRef,()=>{clearTimeout(timer);resolve();},failed);}catch{failed();}
  });
  try{await ready;const result=await runTransaction(tenantRef,current=>{assert.ok(current!==null,'fixture tenant must already exist');const next=copy(current);fn(next);return next;},{applyLocally:false});assert.equal(result.committed,true);}
  finally{clearTimeout(timer);if(typeof unsubscribe==='function')unsubscribe();}
});}

test('verified canonical operational modules read only the money-free projection and matching revision',async()=>{
  for(const uid of ['owner','jahit','potong','qc','qcBound','laporan','stok']){
    const client=db(uid),snap=await assertSucceeds(get(ref(client,O))),revision=await assertSucceeds(get(ref(client,P+'/revision')));
    assert.equal(snap.val().id,'product-1');assert.equal(revision.val(),4);assert.equal(snap.val().hitungFisik.length,2);
    for(const field of ['tarif','total','pin','privateAuthority','frozenPayroll'])assert.equal(JSON.stringify(snap.val()).includes('"'+field+'"'),false);
  }
  for(const uid of ['unbound','gaji','hpp','pembelian','nota','retur'])for(const path of [O,P+'/revision'])await assertFails(get(ref(db(uid),path)));
});

test('partners read their own frozen-rate entries while cross-worker and wage-parent reads fail',async()=>{
  for(const [uid,own,other]of [['jahit','worker-1','worker-2'],['potong','worker-2','worker-1']]){
    const client=db(uid),snap=await assertSucceeds(get(ref(client,W+'/'+own)));assert.equal(snap.val().workerId,own);assert.equal(Object.keys(snap.val().entries).length,1);
    const [entry]=Object.values(snap.val().entries);assert.equal(entry.provisional,true);assert.equal(entry.tarif,own==='worker-1'?100:200);assert.equal(entry.total,entry.jumlah*entry.tarif);
    await assertFails(get(ref(client,W)));await assertFails(get(ref(client,W+'/'+other)));await assertFails(get(ref(client,W+'/'+other+'/entries')));
  }
});

test('QC and other module grants never gain money through an optional worker binding or token claims',async()=>{
  for(const uid of ['qc','qcBound','laporan','stok','gaji','hpp','pembelian','nota','retur','unbound'])for(const worker of ['worker-1','worker-2'])await assertFails(get(ref(db(uid,{workerId:worker,owner:true}),W+'/'+worker)));
});

test('owner has exact worker wage access but no ancestor, grant-directory or private authority access',async()=>{
  const client=db('owner');for(const worker of ['worker-1','worker-2'])await assertSucceeds(get(ref(client,W+'/'+worker)));
  for(const path of ['', 'authorityTenants',T,T+'/grants',T+'/grants/jahit',T+'/grants/owner/profile',T+'/products',T+'/products/product-1',T+'/products/product-1/cycles',C,C+'/wire',P,W])await assertFails(get(clientRef(client,path)));
});

test('every account is denied server authority, tariffs, policies, receipts, credentials and legacy paths',async()=>{
  for(const uid of ['owner','jahit','qc'])for(const path of [C+'/config',C+'/tariffInputs',C+'/tariffInputs/policy',C+'/tariffInputs/historyByWorker/worker-1',C+'/wire/privateAuthority',C+'/wire/receipts',C+'/wire/snapshots',C+'/wire/frozenPayroll',C+'/wire/outbox',P+'/receipts',P+'/policies',P+'/rateLimits',P+'/unknown',T+'/rateLimits','rateLimits','serverRateLimits','serverRateLimits/'+TENANT,'serverRateLimits/'+TENANT+'/owner','serverRateLimits/'+TENANT+'/jahit','integrationSecrets','credentials','soldier/produksi','accessControl/users/unregistered'])await assertFails(get(ref(db(uid),path)));
});

test('only fixed own profile leaves are readable and future fields or module names stay private',async()=>{
  const client=db('jahit'),profile=T+'/grants/jahit/profile';
  for(const [field,value]of [['active',true],['owner',false],['workerId','worker-1'],['modules/jahit',true]])assert.equal((await assertSucceeds(get(ref(client,profile+'/'+field)))).val(),value);
  assert.equal((await assertSucceeds(get(ref(client,profile+'/modules/qc')))).val(),null);assert.equal((await assertSucceeds(get(ref(db('qc'),T+'/grants/qc/profile/workerId')))).val(),null);
  await mutate(root=>{root.grants.jahit.profile.privateFinance={synthetic:true};root.grants.jahit.profile.modules.unknownModule=true;});
  for(const path of [profile,profile+'/modules',profile+'/privateFinance',profile+'/modules/unknownModule',T+'/grants/qc/profile/active',T+'/grants/qc/revision'])await assertFails(get(ref(client,path)));
});

test('only own verified-Google safe integer grant revision is readable without widening parents or writes',async()=>{
  const uid='revision-user',client=db(uid),path=T+'/grants/'+uid+'/revision';
  // Boundary/malformed seeds test Rules, not ancestor numeric CAS hashes.
  // Exact privileged child writes preserve siblings and verify SDK value/type.
  const seed=async(field,value)=>env.withSecurityRulesDisabled(async c=>{const child=ref(c.database(),T+'/grants/'+uid+'/'+field);await set(child,value);assert.deepEqual((await get(child)).val(),value);});
  try{
    for(const value of [0,7,Number.MAX_SAFE_INTEGER]){await seed('revision',value);assert.equal((await assertSucceeds(get(ref(client,path)))).val(),value);}
    for(const foreign of [db('owner'),db('jahit'),db('unregistered',{owner:true}),env.unauthenticatedContext().database(),db(uid,{email_verified:false}),db(uid,{firebase:{sign_in_provider:'password'}}),db(uid,{firebase:{sign_in_provider:'anonymous'}})])await assertFails(get(ref(foreign,path)));
    for(const denied of ['',T,T+'/grants',T+'/grants/'+uid,T+'/grants/'+uid+'/profile','authorityTenants/other-tenant/grants/'+uid+'/revision',T+'/grants/missing/revision'])await assertFails(get(clientRef(client,denied)));
    await assertFails(get(ref(db('unregistered'),T+'/grants/unregistered/revision')));await assertFails(set(ref(client,path),0));await assertFails(set(ref(client,T+'/grants/'+uid),grant({owner:true})));
    for(const value of [-1,1.5,Number.MAX_SAFE_INTEGER+1,'1',true,{synthetic:true},null]){await seed('revision',value);await assertFails(get(ref(client,path)));}
    await seed('revision',1);await seed('profile',null);await assertFails(get(ref(client,path)));
    await seed('profile',{active:false,owner:false});assert.equal((await assertSucceeds(get(ref(client,path)))).val(),1);
  }finally{await env.withSecurityRulesDisabled(async c=>set(ref(c.database(),T+'/grants/'+uid),grant({modules:{qc:true}})));}
});

test('anonymous, missing grants, unverified and non-Google sessions cannot read the tenant',async()=>{
  const clients=[env.unauthenticatedContext().database(),db('unregistered',{email:'synthetic.remote@gmail.com',owner:true}),db('revoked'),db('owner',{email_verified:false}),db('owner',{firebase:{sign_in_provider:'password'}}),db('jahit',{firebase:{sign_in_provider:'anonymous'}})];
  for(const client of clients)for(const path of [O,P+'/revision',W+'/worker-1'])await assertFails(get(ref(client,path)));
  for(const client of [env.unauthenticatedContext().database(),db('unregistered'),db('owner',{email_verified:false}),db('owner',{firebase:{sign_in_provider:'password'}})])await assertFails(get(ref(client,T+'/grants/owner/profile/active')));
});

test('canonical revocation immediately stops new reads while own minimal status remains readable',async()=>{
  const client=db('live-jahit');await assertSucceeds(get(ref(client,O)));await assertSucceeds(get(ref(client,W+'/worker-1')));
  await mutate(root=>{root.grants['live-jahit'].profile.active=false;root.grants['live-jahit'].revision++;});
  for(const path of [O,P+'/revision',W+'/worker-1'])await assertFails(get(ref(client,path)));
  assert.equal((await assertSucceeds(get(ref(client,T+'/grants/live-jahit/profile/active')))).val(),false);
});

test('rebinding uses canonical current worker and never cached or self-declared worker identity',async()=>{
  const client=db('rebound',{workerId:'worker-1'});await assertSucceeds(get(ref(client,W+'/worker-1')));await assertFails(get(ref(client,W+'/worker-2')));
  await mutate(root=>{root.grants.rebound.profile.workerId='worker-2';root.grants.rebound.revision++;});
  await assertFails(get(ref(client,W+'/worker-1')));await assertSucceeds(get(ref(client,W+'/worker-2')));
  assert.equal((await assertSucceeds(get(ref(client,T+'/grants/rebound/profile/workerId')))).val(),'worker-2');
});

test('unsafe keys, another tenant, malformed scope and mismatched wire revision fail closed',async()=>{
  const client=db('owner');for(const uid of ['constructor','unsafe name'])await assertFails(get(ref(db(uid),O)));
  await mutate(root=>{const p=copy(root.products['product-1']);root.products['product alias']=p;root.products.alias=p;const mismatch=copy(p);mismatch.cycles['cycle-1'].wire.productId='mismatch';mismatch.cycles['cycle-1'].wire.projection.operations.id='mismatch';mismatch.cycles['cycle-1'].wire.projection.revision=0;root.products.mismatch=mismatch;const cycle=copy(p.cycles['cycle-1']);root.products['product-1'].cycles['cycle alias']=cycle;});
  for(const path of ['authorityTenants/other-tenant/products/product-1/cycles/cycle-1/wire/projection/operations',T+'/products/product alias/cycles/cycle-1/wire/projection/operations',T+'/products/alias/cycles/cycle-1/wire/projection/operations',T+'/products/mismatch/cycles/cycle-1/wire/projection/operations',T+'/products/product-1/cycles/cycle alias/wire/projection/operations',W+'/constructor',W+'/worker alias'])await assertFails(get(ref(client,path)));
});

test('all browser writes and transactions fail even for owner and at permitted read children',async()=>{
  for(const uid of ['owner','jahit','qc']){
    const client=db(uid);for(const path of ['',T,T+'/grants/'+uid+'/revision',T+'/grants/'+uid+'/profile/active',T+'/grants/'+uid+'/profile/owner',T+'/grants/'+uid+'/profile/workerId',C+'/config/revision',C+'/tariffInputs/revision',C+'/wire/privateAuthority',O+'/cutQuantity',P+'/revision',W+'/worker-1/entries/forged','serverRateLimits/'+TENANT+'/'+uid,'soldier/produksi'])await assertFails(set(clientRef(client,path),true));
    await assertFails(update(ref(client),{[O+'/cutQuantity']:1,[T+'/grants/'+uid+'/profile/owner']:true}));
  }
  await assertFails(runTransaction(ref(db('jahit'),W+'/worker-1'),value=>value,{applyLocally:false}));
});

test('original active repair identifiers are operational only and never expose private repair history or wages',async()=>{
  let state=Authority.decodeStorage(wire());
  const actor={uid:'fixture-owner',emailVerified:true,provider:'google.com',profile:{active:true,owner:true},now:NOW};
  const step=(kind,payload)=>{state=Authority.applyCommand(state,actor,{requestId:'fixture-'+(state.revision+1),productId:'product-1',cycleId:'cycle-1',expectedRevision:state.revision,kind,payload}).state;};
  step('inspect',{batchId:'fixture-batch',entries:[{id:'inspection-1',hfId:'count-1',tanggal:DAY,ok:3,perbaikan:2,reject:0,offline:0}]});
  step('repair',{id:'repair-1',qcId:'inspection-1',tanggal:DAY,jumlah:1});
  try{
    await mutate(root=>{root.products['product-1'].cycles['cycle-1'].wire=Authority.encodeStorage(state);});
    for(const uid of ['qc','jahit']){
      const client=db(uid),rows=(await assertSucceeds(get(ref(client,O+'/repairs')))).val();
      assert.deepEqual(rows,[{id:'repair-1',qcId:'inspection-1',tukangId:'worker-1',tanggal:DAY,jumlah:1,inputAt:NOW}]);
      for(const field of ['tarif','total','payroll','actorUid','privateAuthority'])assert.equal(JSON.stringify(rows).includes('"'+field+'"'),false);
      await assertFails(get(ref(client,C+'/wire/privateAuthority')));await assertFails(get(ref(client,C+'/wire/repairs')));
      await assertFails(get(ref(client,P)));await assertFails(get(ref(client,W+'/worker-2')));await assertFails(set(ref(client,O+'/repairs/0/id'),'forged'));
    }
    await assertFails(get(ref(env.unauthenticatedContext().database(),O+'/repairs')));
  }finally{await mutate(root=>{root.products['product-1'].cycles['cycle-1'].wire=wire();});}
});
