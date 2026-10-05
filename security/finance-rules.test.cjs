'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {ref,get,set}=require('firebase/database');
const {prepareCandidate}=require('./finance-rehearsal.cjs');
if(process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')throw Error('Only the isolated loopback demo emulator is allowed.');
const projectId='demo-soldier-security';let env;
const claims={email_verified:true,firebase:{sign_in_provider:'google.com'}};
const db=(uid,override={})=>env.authenticatedContext(uid,{...claims,...override}).database();
const seed=()=>prepareCandidate({workers:[{id:'worker-1',nama:'Synthetic worker',pin:'synthetic-pin',tarif:{}}],advances:[],production:[{id:'product-1',series:'Example',namaBarang:'Example',size:'M',poAktif:true,poJumlah:8,assignJahit:[{id:'assignment-1',tukangId:'worker-1',qty:8,sisa:8,tanggal:'2026-01-01'}],arsip:[]}]}).candidate;
before(async()=>{
  assert.deepEqual(JSON.parse(fs.readFileSync(__dirname+'/finance-v2.rules.json','utf8')),require('./build-finance-rules.cjs'),'Generated Rules must match the reviewed schema.');
  env=await initializeTestEnvironment({projectId,database:{host:'127.0.0.1',port:9000,rules:fs.readFileSync(__dirname+'/finance-v2.rules.json','utf8')}});
  const data=seed();
  data.accessControl={users:{owner:{active:true,owner:true},jahit:{active:true,workerId:'worker-1',modules:{jahit:true}},qc:{active:true,modules:{qc:true}},potong:{active:true,workerId:'worker-2',modules:{potong:true}},laporan:{active:true,modules:{laporan:true}},financeModule:{active:true,modules:{gaji:true}},revoked:{active:false,owner:true}}};
  const source='synthetic-source';
  data.maklonEarnings={'worker-1':{workerId:'worker-1',nama:'Synthetic worker',entries:{[source]:{sourceId:source,productId:'product-1',series:'Example',namaBarang:'Example',size:'M',tanggal:'2026-01-01',jumlah:8,tarif:123,total:984,sourceType:'hitungFisik',provisional:true}}},'worker-2':{workerId:'worker-2',nama:'Synthetic second worker'}};
  for(const name of ['produksi','produksi_meta','stokBahan','pembelianProduk','gajiHarian','hpp'])data.soldier[name]={fixture:'synthetic legacy finance'};
  data.integrationSecrets={fixture:'synthetic-only'};
  await env.withSecurityRulesDisabled(async context=>set(ref(context.database()),data));
});
after(async()=>{if(env)await env.cleanup();});
test('approved operations accounts read the directory and projection but cannot reach money through legacy paths or parents',async()=>{
  for(const uid of ['jahit','qc','potong','laporan']){
    const client=db(uid);
    for(const path of ['soldier/workerDirectory','soldier/operationsV2'])await assertSucceeds(get(ref(client,path)));
    for(const path of ['privateFinance','privateFinance/legacySource/workers','privateFinance/payrollSnapshots','soldier/produksi','soldier/produksi_meta','soldier/stokBahan','soldier/pembelianProduk','soldier/gajiHarian','soldier/hpp','soldier','integrationSecrets',''])await assertFails(get(ref(client,path)));
  }
});
test('private finance is owner only, including denial for a financial module or a non-Google session',async()=>{
  await assertSucceeds(get(ref(db('owner'),'privateFinance')));
  for(const client of [db('financeModule'),db('unregistered'),db('revoked'),db('owner',{email_verified:false}),db('owner',{firebase:{sign_in_provider:'password'}}),env.unauthenticatedContext().database()]){
    await assertFails(get(ref(client,'privateFinance')));await assertFails(set(ref(client,'privateFinance/fixture'),true));
  }
  for(const path of ['privateFinance','soldier/operationsV2','soldier/workerDirectory'])await assertFails(set(ref(db('jahit'),path+'/fixture'),true));
});
test('even the owner cannot insert money, PINs, unknown columns, wrong IDs or fractional counts into the projection',async()=>{
  const client=db('owner'),product=structuredClone(seed().soldier.operationsV2.products['product-1']);
  await assertSucceeds(set(ref(client,'soldier/operationsV2'),seed().soldier.operationsV2));
  for(const field of ['tarif','payroll','pin','harga','unexpected'])await assertFails(set(ref(client,'soldier/operationsV2/products/product-1/'+field),123));
  for(const field of ['tarif','pin','email','kasbon'])await assertFails(set(ref(client,'soldier/workerDirectory/worker-1/'+field),'synthetic'));
  await assertFails(set(ref(client,'soldier/workerDirectory/worker-1/id'),'worker-other'));
  await assertFails(set(ref(client,'soldier/operationsV2/products/product-1/id'),'wrong-product'));
  for(const value of [-1,1.5,9007199254740992,'8'])await assertFails(set(ref(client,'soldier/operationsV2/products/product-1/poJumlah'),value));
  const bad=structuredClone(product);bad.assignJahit[0].tarif=123;
  await assertFails(set(ref(client,'soldier/operationsV2/products/product-1'),bad));
  await assertFails(set(ref(client,'soldier/operationsV2/schemaVersion'),1));
});
test('Google email enrollment can read operations without granting private finance or self-assigned writes',async()=>{
  const email='synthetic.remote@gmail.com',key=email.replace(/\./g,',');
  await env.withSecurityRulesDisabled(async context=>set(ref(context.database(),'accessControl/emailGrants/'+key),{email,active:true,workerId:'worker-1',modules:{qc:true}}));
  const client=db('remote',{email});
  await assertSucceeds(get(ref(client,'soldier/operationsV2')));
  await assertSucceeds(get(ref(client,'maklonEarnings/worker-1')));await assertFails(get(ref(client,'maklonEarnings/worker-2')));
  await assertFails(get(ref(client,'privateFinance')));await assertFails(get(ref(client,'soldier/produksi')));
  await assertFails(set(ref(client,'soldier/operationsV2/products/product-1/poJumlah'),99));
  await assertFails(set(ref(client,'accessControl/emailGrants/'+key+'/owner'),true));
  await assertFails(set(ref(client,'accessControl/emailGrants/'+key+'/workerId'),'worker-2'));
  await env.withSecurityRulesDisabled(async context=>set(ref(context.database(),'accessControl/users/remote'),{active:false,modules:{qc:true}}));
  await assertFails(get(ref(client,'soldier/operationsV2')));
  await assertFails(get(ref(client,'maklonEarnings/worker-1')));
});
test('maklon partners see their own rates and earnings but cannot list or edit another partner or alter the money calculation',async()=>{
  const client=db('jahit');
  const own=await assertSucceeds(get(ref(client,'maklonEarnings/worker-1')));assert.equal(own.val().entries['synthetic-source'].tarif,123);
  await assertFails(get(ref(client,'maklonEarnings')));await assertFails(get(ref(client,'maklonEarnings/worker-2')));
  await assertFails(get(ref(db('qc'),'maklonEarnings/worker-1')));
  await assertSucceeds(get(ref(db('potong'),'maklonEarnings/worker-2')));await assertFails(get(ref(db('potong'),'maklonEarnings/worker-1')));
  for(const field of ['tarif','total','jumlah'])await assertFails(set(ref(client,'maklonEarnings/worker-1/entries/synthetic-source/'+field),1));
  await assertFails(set(ref(client,'accessControl/users/jahit/workerId'),'worker-2'));
  const owner=db('owner');await assertSucceeds(get(ref(owner,'maklonEarnings')));
  await assertFails(set(ref(owner,'maklonEarnings/worker-1/entries/synthetic-source/pin'),'synthetic'));
  await assertFails(set(ref(owner,'maklonEarnings/worker-1/entries/synthetic-source/sourceId'),'wrong-source'));
});
test('anonymous and wrong module accounts cannot read operations; owner revocation also stops private finance',async()=>{
  for(const client of [env.unauthenticatedContext().database(),db('financeModule'),db('unregistered'),db('jahit',{firebase:{sign_in_provider:'password'}})])await assertFails(get(ref(client,'soldier/operationsV2')));
  const owner=db('owner');await assertSucceeds(get(ref(owner,'privateFinance')));
  await env.withSecurityRulesDisabled(async context=>set(ref(context.database(),'accessControl/users/owner/active'),false));
  await assertFails(get(ref(owner,'privateFinance')));
});
