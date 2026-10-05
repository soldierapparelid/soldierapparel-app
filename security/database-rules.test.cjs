const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {ref,get,set,runTransaction}=require('firebase/database');
const host=process.env.FIREBASE_DATABASE_EMULATOR_HOST;
if(!/^127\.0\.0\.1:9000$/.test(host||''))throw new Error('Tests require the isolated loopback emulator.');
const projectId='demo-soldier-security';let env;
const modules=['potong','jahit','qc','laporan','stok','gaji','hpp','pembelian','nota','retur'];
const db=uid=>env.authenticatedContext(uid,{email_verified:true}).database();
before(async()=>{
  env=await initializeTestEnvironment({projectId,database:{host:'127.0.0.1',port:9000,rules:fs.readFileSync(__dirname+'/database.rules.json','utf8')}});
  const users={owner:{active:true,owner:true},revoked:{active:false,modules:{jahit:true}}};
  for(const name of modules)users[name]={active:true,modules:{[name]:true}};
  await env.withSecurityRulesDisabled(async context=>set(ref(context.database()),{
    accessControl:{users},
    soldier:{produksi:{produksi:[{id:'fixture',series:'fixture',namaBarang:'fixture',jahit:[]}]},produksi_meta:{tukangJahit:[{id:'fixture',nama:'fixture'}]},produksi_deletions:{fixture:true},produksi_deleted_ids:{fixture:true},stokBahan:{fixture:true},pembelianProduk:{fixture:true},gajiHarian:{fixture:true},hpp:{fixture:true},productionPhotos:{pesananOffline:[{items:[{id:'fixture',gambar:'https://example.invalid/fixture.png'}]}]}},
    integrationSecrets:{fixture:'synthetic-only'}
  }));
});
after(async()=>{if(env)await env.cleanup();});
test('anonymous, missing approval, unverified and revoked identities cannot read or write business data',async()=>{
  const clients=[env.unauthenticatedContext().database(),db('unregistered'),db('revoked'),env.authenticatedContext('jahit',{email_verified:false}).database()];
  for(const client of clients)for(const path of ['produksi','stokBahan','gajiHarian','hpp','pembelianProduk','productionPhotos']){
    await assertFails(get(ref(client,'soldier/'+path)));await assertFails(set(ref(client,'soldier/'+path+'/fixture'),true));
  }
});
test('all configured division listeners can read their dependencies',async()=>{
  const paths={potong:['produksi','produksi_meta','produksi_deletions','produksi_deleted_ids','stokBahan','productionPhotos'],jahit:['produksi','produksi_meta','produksi_deletions','produksi_deleted_ids','productionPhotos'],qc:['produksi','produksi_meta/tukangJahit','produksi_deletions','produksi_deleted_ids','productionPhotos'],laporan:['produksi','produksi_meta/tukangJahit','produksi_deletions','produksi_deleted_ids','productionPhotos'],stok:['stokBahan','produksi'],gaji:['gajiHarian'],hpp:['produksi','produksi_meta','stokBahan','hpp'],pembelian:['pembelianProduk','stokBahan','produksi','productionPhotos']};
  for(const [moduleName,dependencies]of Object.entries(paths))for(const path of dependencies)await assertSucceeds(get(ref(db(moduleName),'soldier/'+path)));
});
test('an approved worker can perform an atomic production transaction',async()=>{
  const result=await assertSucceeds(runTransaction(ref(db('jahit'),'soldier/produksi/produksi'),value=>value,{applyLocally:false}));assert.equal(result.committed,true);
});
test('QC and reports can read worker metadata without gaining its parent or sibling branches',async()=>{
  for(const uid of ['qc','laporan']){
    const client=db(uid);
    await assertSucceeds(get(ref(client,'soldier/produksi_meta/tukangJahit')));
    await assertFails(get(ref(client,'soldier/produksi_meta')));
    await assertFails(get(ref(client,'soldier/produksi_meta/tarif')));
    await assertFails(set(ref(client,'soldier/produksi_meta/tukangJahit/fixture'),{nama:'fixture'}));
  }
});
test('production users cannot reach separate finance branches, sibling profiles or secrets',async()=>{
  const client=db('jahit');for(const path of ['soldier/gajiHarian','soldier/hpp','soldier/pembelianProduk','accessControl/users/owner','integrationSecrets','soldier'])await assertFails(get(ref(client,path)));
  await assertFails(get(ref(client)));
  await assertSucceeds(get(ref(client,'accessControl/users/jahit')));
  for(const uid of ['jahit','owner'])await assertFails(set(ref(db(uid),'accessControl/users/'+uid+'/owner'),true));
  await assertFails(set(ref(client,'soldier/stokBahan/fixture'),false));
  await assertSucceeds(get(ref(db('gaji'),'soldier/gajiHarian')));
});
test('photo projection validates permitted fields and rejects purchase or financial fields',async()=>{
  const path='soldier/productionPhotos/pesananOffline/0/items/0',client=db('pembelian');
  await assertSucceeds(set(ref(client,path),{id:'fixture',gambar:'data:image/png;base64,ZmFrZQ=='}));
  await assertFails(set(ref(client,path),{id:'fixture',gambar:'https://example.invalid/photo.png',harga:123}));
  await assertFails(set(ref(client,path),{id:'fixture',gambar:'javascript:alert(1)'}));
  await assertFails(set(ref(client,'soldier/productionPhotos'),'unexpected scalar'));
  await assertFails(set(ref(client,'soldier/productionPhotos/pesananOffline/0'),'unexpected scalar'));
  await assertFails(set(ref(client,'soldier/productionPhotos/pesananOffline/0/items'),'unexpected scalar'));
  await assertFails(set(ref(db('jahit'),path),{id:'fixture',gambar:'https://example.invalid/photo.png'}));
});
test('server authorization responds to access revocation',async()=>{
  const client=db('jahit');await assertSucceeds(get(ref(client,'soldier/produksi')));
  await env.withSecurityRulesDisabled(async context=>set(ref(context.database(),'accessControl/users/jahit/active'),false));
  await assertFails(get(ref(client,'soldier/produksi')));await assertFails(set(ref(client,'soldier/produksi/fixture'),true));
});
test('private pre-registered Google employee email grants authorize before a UID is enrolled',async()=>{
  const email='synthetic.sewing@gmail.com',key=email.replace(/\./g,',');
  await env.withSecurityRulesDisabled(async context=>set(ref(context.database(),'accessControl/emailGrants/'+key),{email,active:true,modules:{jahit:true}}));
  const client=env.authenticatedContext('first-google-sign-in',{email,email_verified:true,firebase:{sign_in_provider:'google.com'}}).database();
  await assertSucceeds(get(ref(client,'accessControl/emailGrants/'+key)));
  await assertSucceeds(get(ref(client,'soldier/produksi')));
  await assertSucceeds(runTransaction(ref(client,'soldier/produksi/produksi'),value=>value,{applyLocally:false}));
  for(const path of ['accessControl/emailGrants','accessControl/users/owner','soldier/gajiHarian','soldier/hpp','soldier/pembelianProduk'])await assertFails(get(ref(client,path)));
  await assertFails(set(ref(client,'accessControl/emailGrants/'+key+'/owner'),true));
  const password=env.authenticatedContext('password-session',{email,email_verified:true,firebase:{sign_in_provider:'password'}}).database();
  const unverified=env.authenticatedContext('unverified-google',{email,email_verified:false,firebase:{sign_in_provider:'google.com'}}).database();
  const differentEmail=env.authenticatedContext('another-email',{email:'another@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}}).database();
  for(const denied of [password,unverified,differentEmail]){
    await assertFails(get(ref(denied,'accessControl/emailGrants/'+key)));await assertFails(get(ref(denied,'soldier/produksi')));
  }
  await env.withSecurityRulesDisabled(async context=>set(ref(context.database(),'accessControl/users/first-google-sign-in'),{active:false,modules:{jahit:true}}));
  await assertFails(get(ref(client,'soldier/produksi')));
});
test('an email grant cannot promote to owner and its revocation is enforced by the server',async()=>{
  const email='synthetic.quality@gmail.com',key=email.replace(/\./g,','),path='accessControl/emailGrants/'+key;
  const client=env.authenticatedContext('quality-first-login',{email,email_verified:true,firebase:{sign_in_provider:'google.com'}}).database();
  await env.withSecurityRulesDisabled(async context=>set(ref(context.database(),path),{email,active:true,modules:{qc:true}}));
  await assertSucceeds(get(ref(client,'soldier/produksi_meta/tukangJahit')));
  await assertFails(get(ref(client,'soldier/produksi_meta')));
  await assertSucceeds(get(ref(client,'soldier/produksi')));
  await env.withSecurityRulesDisabled(async context=>set(ref(context.database(),path+'/owner'),true));
  await assertFails(get(ref(client,'soldier/produksi')));await assertFails(get(ref(client,'soldier/gajiHarian')));
  await env.withSecurityRulesDisabled(async context=>set(ref(context.database(),path),{email,active:false,modules:{qc:true}}));
  await assertFails(get(ref(client,'soldier/produksi')));
});
