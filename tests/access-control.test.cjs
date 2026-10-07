const readReviewedLegacyHtml=require('./helpers/legacy-html-source.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Policy=require('../access-policy.js'),Session=require('../access-session.js');
const Photos=require('../access-photos.js');
const rules=JSON.parse(fs.readFileSync(require.resolve('../security/database.rules.json'),'utf8')).rules;
const verified={uid:'fixture-worker',emailVerified:true};
const worker={active:true,owner:false,modules:{jahit:true}};
test('earnings access requires an administrator-bound maklon identity, preserving verified email and UID precedence',()=>{
  const email='synthetic.sewing@gmail.com',grant={email,active:true,workerId:'worker-1',modules:{jahit:true}};
  const profile=Policy.resolveProfile(null,grant,email);
  assert.equal(profile.workerId,'worker-1');assert.equal(Policy.allowed(profile,'earnings'),true);
  assert.equal(Policy.allowed(worker,'earnings'),false);assert.equal(Policy.allowed({active:true,owner:true},'earnings'),true);
  for(const workerId of ['__proto__','../other',42,''])assert.equal(Policy.allowed(Policy.resolveProfile(null,{...grant,workerId},email),'earnings'),false);
  const uid={active:true,workerId:'worker-2',modules:{jahit:true}};assert.equal(Policy.resolveProfile(uid,grant,email).workerId,'worker-2');
  assert.equal(Policy.allowed({active:true,workerId:'worker-1',modules:{qc:true}},'earnings'),false);
});
test('verified approved worker can reach their division, without financial module access',()=>{
  assert.equal(Policy.allowed(worker,'jahit'),true);assert.equal(Policy.allowed(worker,'gaji'),false);assert.equal(Policy.allowed(worker,'hpp'),false);assert.equal(Policy.allowed(worker,'menu'),true);
  assert.equal(Policy.allowed({...worker,active:false},'jahit'),false);assert.equal(Policy.allowed({active:true,owner:true},'gaji'),true);assert.equal(Policy.allowed({active:1,owner:true},'jahit'),false);
});
test('authorization blocks unverified, unregistered, revoked users and cross-account drafts',async()=>{
  const options={getUser:async()=>verified,getProfile:async()=>worker,allowed:Policy.allowed,draftAccess:Policy.draftAccess,moduleName:'jahit',binding:verified.uid,pending:()=>true};
  assert.equal((await Session.authorize(options)).uid,verified.uid);
  for(const change of [{getUser:async()=>null},{getUser:async()=>({...verified,emailVerified:false})},{getProfile:async()=>null},{getProfile:async()=>({...worker,active:false})},{moduleName:'gaji'},{binding:'another-account'},{binding:null}])await assert.rejects(Session.authorize({...options,...change}));
  await assert.rejects(Session.authorize({...options,getProfile:async()=>{throw new Error('offline');}}));
  await assert.rejects(Session.authorize({...options,pending:()=>{throw new Error('storage failed');}}));
});
test('only official HTTPS Firebase configuration; derives default project and Google auth domain',()=>{
  const cfg=Policy.config({apiKey:'public-web-key-fixture',dbUrl:'https://fixture-soldier-default-rtdb.asia-southeast1.firebasedatabase.app/'});
  assert.equal(cfg.projectId,'fixture-soldier');assert.equal(cfg.authDomain,'fixture-soldier.firebaseapp.com');
  for(const url of ['http://fixture.firebaseio.com','https://firebaseio.com.attacker.invalid','https://user:pass@fixture.firebaseio.com','https://fixture.firebaseio.com/?token=fixture','https://fixture.firebaseio.com/data','https://fixture.firebaseio.com/#secret'])assert.throws(()=>Policy.config({apiKey:'fixture',dbUrl:url,projectId:'fixture'}));
});
test('login failures give useful recovery steps without echoing unknown credential-bearing errors',()=>{
  assert.match(Policy.loginFailure('auth/popup-blocked').message,/pop-up/);
  assert.match(Policy.loginFailure('auth/operation-not-supported-in-this-environment').message,/Chrome atau Edge/);
  assert.equal(Policy.loginFailure('auth/popup-closed-by-user').code,'auth/popup-closed-by-user');
  const privateText='fixture-password-and-financial-record';
  for(const code of [privateText,'auth/'+privateText,null,{},'__proto__']){
    const failure=Policy.loginFailure(code);
    assert.equal(failure.code,'unknown');assert.equal(JSON.stringify(failure).includes(privateText),false);
  }
});
test('pre-registered email grants do not need first-login enrollment and never confer owner access',()=>{
  const email='synthetic.sewing@gmail.com',grant={email,active:true,modules:{jahit:true}};
  assert.equal(Policy.emailKey(email),'synthetic,sewing@gmail,com');
  const profile=Policy.resolveProfile(null,grant,email);
  assert.equal(Policy.allowed(profile,'jahit'),true);assert.equal(Policy.allowed(profile,'gaji'),false);assert.equal(profile.owner,false);
  assert.equal(Policy.resolveProfile(null,grant,'someoneelse@gmail.com'),null);
  for(const change of [{active:false},{owner:true},{modules:{gaji:true}},{modules:{jahit:true,gaji:true}}])assert.equal(Policy.resolveProfile(null,{...grant,...change},email),null);
  const revoked={active:false,modules:{jahit:true}};
  assert.equal(Policy.resolveProfile(revoked,grant,email),revoked);assert.equal(Policy.allowed(Policy.resolveProfile(revoked,grant,email),'jahit'),false);
  for(const invalid of [null,'fixture@example.invalid','a/b@gmail.com','a#b@gmail.com','a[b@gmail.com'])assert.throws(()=>Policy.emailKey(invalid));
});
test('legacy purchase adapter preserves value subscription and atomic transaction semantics',async()=>{
  let off=0,txOptions;const snapshot={val:()=>({fixture:true})};const db={};
  const sdk={ref:(db,path)=>({db,path}),get:async()=>snapshot,onValue:(node,callback)=>{callback(snapshot);return ()=>off++;},runTransaction:async(node,update,options)=>{assert.deepEqual(update({fixture:false}),{fixture:true});txOptions=options;return {committed:true,snapshot};}};
  const ref=Session.compatDatabase(db,sdk).ref('fixture');let received;const cb=snap=>received=snap.val();ref.on('value',cb);assert.deepEqual(received,{fixture:true});ref.off('value',cb);assert.equal(off,1);assert.equal(await ref.once('value'),snapshot);const result=await ref.transaction(()=>({fixture:true}),undefined,false);assert.equal(result.committed,true);assert.deepEqual(txOptions,{applyLocally:false});assert.throws(()=>ref.on('child_added',cb));
});
// This evaluator checks the committed permission expressions and cascading grants.
// It is NOT a substitute for compiling/testing rules in the Firebase emulator.
function permitted(auth,profiles,path,mode){
  const root={child(p){const value=p.split('/').reduce((v,k)=>v&&v[k],{accessControl:{users:profiles}});return {child(q){return root.child(p+'/'+q);},val(){return value??null;}};}};
  let rule=rules;const paths=path.split('/').filter(Boolean);const scopes={auth,root};
  for(let i=0;i<=paths.length;i++){
    const expr=rule['.'+mode];if(expr===true)return true;if(typeof expr==='string'&&vm.runInNewContext(expr,scopes))return true;
    if(i===paths.length)break;const part=paths[i];if(rule[part])rule=rule[part];else if(rule.$uid){rule=rule.$uid;scopes.$uid=part;}else return false;
  }
  return false;
}
test('server expressions deny anonymous, unregistered and revoked accounts at every business path',()=>{
  for(const path of Object.keys(rules.soldier)){for(const mode of ['read','write']){
    for(const auth of [null,{uid:'unregistered',token:{email_verified:true}},{uid:verified.uid,token:{email_verified:false}}])assert.equal(permitted(auth,{[verified.uid]:worker},'soldier/'+path,mode),false);
    assert.equal(permitted({uid:verified.uid,token:{email_verified:true}},{[verified.uid]:{...worker,active:false}},'soldier/'+path,mode),false);
  }}
});
test('division rules preserve shared production while restricting separate finance and access control',()=>{
  const auth={uid:verified.uid,token:{email_verified:true}},profiles={[verified.uid]:worker};
  assert.equal(permitted(auth,profiles,'soldier/produksi','read'),true);assert.equal(permitted(auth,profiles,'soldier/produksi/produksi','write'),true);
  for(const node of ['gajiHarian','hpp','pembelianProduk','stokBahan'])assert.equal(permitted(auth,profiles,'soldier/'+node,'write'),false);
  assert.equal(permitted(auth,profiles,'soldier/gajiHarian','read'),false);assert.equal(permitted(auth,profiles,'accessControl/users/'+verified.uid,'read'),true);assert.equal(permitted(auth,profiles,'accessControl/users/other','read'),false);
  assert.equal(permitted(auth,profiles,'accessControl/users/'+verified.uid,'write'),false);assert.equal(permitted(auth,{[verified.uid]:{active:true,owner:true}},'accessControl/users/'+verified.uid,'write'),false);
  assert.equal(permitted(auth,profiles,'soldier','read'),false);assert.equal(permitted(auth,profiles,'','read'),false);assert.equal(permitted(auth,profiles,'integrationSecrets','read'),false);
});
test('every page locks before startup; all eight Firebase modules authorize before listeners',()=>{
  const root=require('node:path').resolve(__dirname,'..');
  for(const file of ['index.html','potong-command.html','jahit-command.html','qc-command.html','laporan-produksi.html','stok-bahan-command.html','gaji-harian-command.html','hpp-command-v1.html','pembelian-produk-v1.html','nota-penjualan.html','retur-command.html']){
    const html=readReviewedLegacyHtml(file);assert.ok(html.includes('data-soldier-locked'),file);assert.ok(html.indexOf('access-control.js')<html.indexOf('</head>'),file);
    if(!['index.html','nota-penjualan.html','retur-command.html'].includes(file))assert.ok(html.includes('await SoldierAccess.connect('),file);
    assert.ok(!/firebasejs\/(8\.10\.1|10\.7\.1)\//.test(html),file);
  }
});
test('QC and reports receive only their required metadata child, without an inherited parent grant',()=>{
  const auth={uid:'fixture',token:{email_verified:true}};
  for(const name of ['qc','laporan']){
    const profiles={fixture:{active:true,modules:{[name]:true}}};
    assert.equal(permitted(auth,profiles,'soldier/produksi_meta/tukangJahit','read'),true);
    assert.equal(permitted(auth,profiles,'soldier/produksi_meta','read'),false);
    assert.equal(permitted(auth,profiles,'soldier/produksi_meta/tarif','read'),false);
    assert.equal(permitted(auth,profiles,'soldier/produksi_meta/tukangJahit','write'),false);
  }
});
test('photo projection excludes financial/customer fields, deleted orders and executable sources',()=>{
  const value={pesananOffline:[{id:'order',total:999,customer:'fixture-private',items:[{id:'photo',gambar:'data:image/png;base64,ZmFrZQ==',harga:99,customer:'fixture-private'},{id:'unsafe',gambar:'javascript:alert(1)'}]},{_deleted:true,items:[{id:'deleted',gambar:'https://example.invalid/photo.png'}]}]};
  assert.deepEqual(Photos.project(value),{pesananOffline:[{items:[{id:'photo',gambar:'data:image/png;base64,ZmFrZQ=='}]}]});
  assert.equal(Photos.project({}),null);
});
test('every literal Firebase listener has a server grant for its division',()=>{
  const root=require('node:path').resolve(__dirname,'..'),files={potong:'potong-command.html',jahit:'jahit-command.html',qc:'qc-command.html',laporan:'laporan-produksi.html',stok:'stok-bahan-command.html',gaji:'gaji-harian-command.html',hpp:'hpp-command-v1.html',pembelian:'pembelian-produk-v1.html'};
  for(const [name,file]of Object.entries(files)){
    const html=readReviewedLegacyHtml(file);
    for(const match of html.matchAll(/listen\((?:ref\(db,\s*)?['"](soldier\/[^'"]+)['"]/g))assert.equal(permitted({uid:'fixture',token:{email_verified:true}},{fixture:{active:true,modules:{[name]:true}}},match[1],'read'),true,name+': '+match[1]);
  }
});
