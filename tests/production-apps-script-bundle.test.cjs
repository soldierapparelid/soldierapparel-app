'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),Crypto=require('node:crypto');
const Builder=require('../server/apps-script/build-pure-bundle.cjs');
const Manifest=require('../server/apps-script/compatibility-manifest.cjs');
const Primitives=require('../server/apps-script/primitives.cjs');
const Core=require('../server/production-legacy-operations.cjs'),Finance=require('../server/production-legacy-finance.cjs'),State=require('../server/production-identity-state.cjs');
const F=require('./fixtures/identity-tenant.cjs');
const POLICY={version:'legacy-jahit-current-v1',reviewed:true,timeZone:'Asia/Jakarta',quantityBasis:'good-plus-reject'};
const normal=v=>JSON.parse(JSON.stringify(v));
const options=()=>({enabled:true,binding:{projectId:F.PROJECT,databaseURL:F.URL,tenantId:F.TENANT},clock:()=>F.NOW,tariffPolicy:POLICY});
function fakeUtilities(){
  return {DigestAlgorithm:{SHA_256:'sha256'},newBlob(value,type){assert.equal(type,'text/plain');return {getBytes(){return Array.from(Buffer.from(value,'utf8'),v=>v>127?v-256:v);}};},computeDigest(algorithm,bytes){assert.equal(algorithm,'sha256');return Array.from(Crypto.createHash('sha256').update(Buffer.from(bytes)).digest(),v=>v>127?v-256:v);}};
}
function load(){
  const nativeCalls={blobs:0,bytes:0,digests:0};
  const context=vm.createContext({__blobCall:()=>{nativeCalls.blobs++;},__utf8:value=>{nativeCalls.bytes++;return Array.from(Buffer.from(value,'utf8'),v=>v>127?v-256:v);},__digest:bytes=>{nativeCalls.digests++;return Array.from(Crypto.createHash('sha256').update(Buffer.from(bytes)).digest(),v=>v>127?v-256:v);}});
  vm.runInContext("const Utilities=Object.freeze({DigestAlgorithm:Object.freeze({SHA_256:'sha256'}),newBlob(value,type){if(type!=='text/plain')throw Error('fake');__blobCall();return {getBytes(){return Array.from(__utf8(value));}};},computeDigest(algorithm,bytes){if(algorithm!=='sha256')throw Error('fake');return Array.from(__digest(bytes));}});",context);
  vm.runInContext(Builder.createBundle().source,context);
  const realm=value=>{context.__input=JSON.stringify(value);try{return vm.runInContext('JSON.parse(__input)',context);}finally{delete context.__input;}};
  const modules=vm.runInContext('SoldierAppsScriptFeasibility.createPureModules(Utilities)',context);
  const inOptions=()=>{const value=realm({enabled:true,binding:options().binding,tariffPolicy:POLICY});Object.defineProperty(value,'clock',{value:()=>F.NOW,enumerable:true});return value;};
  return {context,modules,realm,nativeCalls,operations:modules.operations.createProductionLegacyOperations(inOptions()),finance:modules.finance.createProductionLegacyFinance(inOptions()),inOptions};
}
function fixture(){
  const payroll={workerId:'worker-1',workerName:'Synthetic partner',rate:7,rateMissing:false,capturedAt:F.BEFORE};
  const own={id:'old-report',assignmentId:'assignment-1',tukangId:'worker-1',tanggal:'2026-10-05',jumlah:2,lolos:1,rijek:1,tarif:2,total:87.125,dibayar:true,private:{retained:true}};
  const p={id:'product-1',poAktif:true,poJumlah:12,poTanggal:'2026-10-06',series:'Synthetic.Series',namaBarang:'Item雪',size:'M',privateCost:123.125,potong:{'0':{id:'cut-1',jumlah:12},'2':null},assignJahit:{own:{id:'assignment-1',tukangId:'worker-1',qty:10,sisa:8},foreign:{id:'assignment-2',tukangId:'worker-2',qty:2}},jahit:{own,foreign:{id:'foreign-report',assignmentId:'assignment-2',tukangId:'worker-2',jumlah:1,lolos:1,rijek:0,tarif:99,total:99}},arsip:[{id:'archive-1',jahit:[{id:'archive-report',tukangId:'worker-1',tanggal:'2026-10-01',tarif:3,total:91.375,dibayar:true}],privatePayment:{keep:true}}],hitungFisik:[{id:'count-1',tukangId:'worker-1',jumlah:3,tanggal:'2026-10-05',workflowVersion:2,countStage:'verified',qcId:'quality-1',payroll:{...payroll}}],qc:[{id:'quality-1',hfId:'count-1',tukangId:'worker-1',tanggal:'2026-10-05',ok:2,perbaikan:1,reject:0,offline:0,workflowVersion:2,payroll:{...payroll}}],gudang:[{id:'warehouse-1',qcId:'quality-1',hfId:'count-1',tukangId:'worker-1',tanggal:'2026-10-05',jumlah:2,status:'ok',workflowVersion:2,payrollStage:'initial',payroll:{...payroll}}]};
  const root={authorityTenants:{[F.TENANT]:F.copy(F.claimed())},soldier:{produksi:{produksi:{'0':p,'2':{id:'foreign-product',poAktif:true,series:'Foreign',namaBarang:'Foreign',size:'L',assignJahit:[{id:'foreign-assignment',tukangId:'worker-2',qty:2}],jahit:[]}},unrelated:{dense:[null,{text:'😀\ud800'}],map:{'0':null,keep:true}}},produksi_meta:{tukangJahit:{own:{id:'worker-1',nama:'Synthetic partner 😀',tarif:{'Synthetic_Series|Item雪':7},tarifHistory:{'Synthetic_Series|Item雪':[{effectiveAt:'1970-01-01T00:00:00.000Z',rate:999}]}},foreign:{id:'worker-2',nama:'Foreign partner',tarif:{'Synthetic_Series|Item雪':99}}},kasbonJahit:[{id:'advance-1',tukangId:'worker-1',tanggal:'2026-10-01',jumlah:20.125,sisa:13.125,status:'aktif',cicilan:[{id:'installment-1',tanggal:'2026-10-05',jumlah:7,ket:'Synthetic note'}]},{id:'foreign-advance',tukangId:'worker-2',jumlah:999}]}},otherRoot:{keep:'Synthetic unknown',empty:[],optional:null}};
  return {root,p,identity:F.identity()};
}
function command(core,f){return {kind:'appendJahit',requestId:'request-1',operationId:'operation-1',productId:'product-1',assignmentId:'assignment-1',expectedGrantRevision:1,expectedSourceVersion:core.read({root:f.root,identity:f.identity}).view.products[0].sourceVersion,workDate:null,good:2,reject:1};}
test('bundle is deterministic, syntax-checked, strictly source-OFF and empty-bound',()=>{
  const first=Builder.createBundle(),second=Builder.createBundle();assert.equal(first.source,second.source);assert.deepEqual(first.metadata,second.metadata);assert.equal(first.metadata.modules.length,9);assert.equal(first.metadata.bundleSha256,Crypto.createHash('sha256').update(first.source).digest('hex'));assert.deepEqual(first.metadata.configuration,{legacyOperationsEnabled:false,legacyFinanceEnabled:false,binding:{projectId:'',databaseURL:'',tenantId:''},tariffPolicy:null});
  const context=vm.createContext({});vm.runInContext(first.source,context);assert.deepEqual(normal(context.SoldierAppsScriptFeasibility.configuration),Manifest.configuration);assert.equal(Object.isFrozen(context.SoldierAppsScriptFeasibility.configuration.binding),true);
});
test('repeat builds never clobber a prior prepared artifact or its edited manifest',()=>{
  const a=Builder.buildPrepared(),saved=fs.readFileSync(a.bundlePath,'utf8');fs.writeFileSync(a.metadataPath,'Synthetic manually retained manifest\n','utf8');const b=Builder.buildPrepared();
  assert.notEqual(path.dirname(a.bundlePath),path.dirname(b.bundlePath));assert.equal(path.dirname(path.dirname(a.bundlePath)),path.resolve(__dirname,'../../apps-script-prepared'));
  for(const result of [a,b])assert.match(path.basename(path.dirname(result.bundlePath)),/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(fs.readFileSync(a.bundlePath,'utf8'),saved);assert.equal(fs.readFileSync(a.metadataPath,'utf8'),'Synthetic manually retained manifest\n');assert.equal(fs.readFileSync(b.bundlePath,'utf8'),saved);
});
test('real source and output junction ancestors are rejected in an isolated public graph',()=>{
  const parent=path.resolve(__dirname,'../..'),fixture=fs.mkdtempSync(path.join(parent,'apps-script-links-')),repo=path.join(fixture,'repo'),builder=path.join(repo,'server/apps-script/build-pure-bundle.cjs');
  fs.mkdirSync(path.dirname(builder),{recursive:true});
  for(const file of [...Manifest.modules.map(row=>row.file),'server/apps-script/build-pure-bundle.cjs','server/apps-script/compatibility-manifest.cjs','server/apps-script/primitives.cjs']){const target=path.join(repo,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(__dirname,'..',file),target);}
  const copied=require(builder),sourceTarget=path.join(repo,'source-server'),server=path.join(repo,'server');fs.renameSync(server,sourceTarget);fs.symlinkSync(sourceTarget,server,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>copied.createBundle(),/bundle_symlink_rejected/);fs.unlinkSync(server);fs.renameSync(sourceTarget,server);
  const outputTarget=path.join(fixture,'retained-output'),output=path.join(fixture,'apps-script-prepared');fs.mkdirSync(outputTarget);fs.writeFileSync(path.join(outputTarget,'retained.txt'),'Synthetic retained output','utf8');fs.symlinkSync(outputTarget,output,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>copied.buildPrepared(),/bundle_symlink_rejected/);assert.deepEqual(fs.readdirSync(outputTarget),['retained.txt']);assert.equal(fs.readFileSync(path.join(outputTarget,'retained.txt'),'utf8'),'Synthetic retained output');fs.unlinkSync(output);
});
test('source graph admits no unexpected modules or changed reviewed source',()=>{
  assert.throws(()=>Builder.reviewedSource('server/production-runtime.cjs',''),/bundle_module_rejected/);
  const row=Manifest.modules[0],source=fs.readFileSync(path.join(__dirname,'..',row.file),'utf8');assert.equal(Builder.reviewedSource(row.file,source).includes('isEnrollmentEmail'),true);assert.throws(()=>Builder.reviewedSource(row.file,source+'\n// public source changed\n'),/bundle_source_drift/);assert.throws(()=>Builder.reviewedSource(row.file,source+'\nrequire(selector);\n'),/bundle_source_drift/);
});
test('compatibility audit rejects unsupported APIs rather than adding a bypass',()=>{
  for(const source of ['fetch(url)','process.env','new Function(source)','eval(source)','setTimeout(fn,1)','Buffer.from(data)','new URLSearchParams()','crypto.SubtleCrypto','new TextEncoder()','import thing from "x"','class X { #field=1; }','class X { static field=1; }'])assert.throws(()=>Builder.runtimeCompatibility(source),/bundle_unsupported_runtime/);
  assert.throws(()=>Builder.runtimeCompatibility('x'.repeat(512*1024+1)),/bundle_source_limit/);
});
test('generated artifact has static dependencies and no live entry point or credential code',()=>{
  const source=Builder.createBundle().source;for(const forbidden of [/\brequire\s*\(/,/\beval\s*\(/,/\bFunction\s*\(/,/\bdoGet\s*\(/,/\bdoPost\s*\(/,/\bScriptApp\b/,/\bUrlFetchApp\b/,/soldier-produksi/,/soldierapparelid/,/apps-script-oauth2/])assert.equal(forbidden.test(source),false,String(forbidden));
  const {context,modules}=load();assert.deepEqual(Object.keys(modules).sort(),['finance','operations','primitives']);for(const name of ['ProductionWorkflow','ProductionPayroll','require','Buffer','URL','createProductionSessionIdentityVerifier','createProductionEnrollmentIdentityVerifier'])assert.equal(Object.hasOwn(context,name),false,name);
});
test('default OFF methods never inspect request or Utilities and perform no initialization',()=>{
  let hits=0;const context=vm.createContext({});Object.defineProperty(context,'Utilities',{get(){hits++;throw Error('SYNTHETIC_PRIVATE');}});vm.runInContext(Builder.createBundle().source,context);const request=new Proxy({}, {get(){hits++;throw Error('SYNTHETIC_PRIVATE');},ownKeys(){hits++;throw Error('SYNTHETIC_PRIVATE');}});const api=context.SoldierAppsScriptFeasibility;
  for(const fn of [...Object.values(api.disabledOperations),api.disabledFinance.read])assert.deepEqual(normal(fn(request)),{ok:false,error:'service_disabled'});assert.equal(hits,0);
});
test('UTF-8 counts and Utilities-backed hashes match Node for Unicode and lone surrogates',()=>{
  const {modules}=load(),p=modules.primitives;
  for(const value of ['', 'ASCII', 'café', '漢字', '😀', 'e\u0301', '\ud800', '\udc00', '\ud800x\udc00', '\ud800\ud800\udc00', '\ud83d\ude00']){assert.equal(p.Buffer.byteLength(value,'utf8'),Buffer.byteLength(value,'utf8'));assert.equal(p.crypto.createHash('sha256').update(value).digest('hex'),Crypto.createHash('sha256').update(value).digest('hex'));}
});
test('separate hash updates cannot turn two lone surrogates into a different Unicode scalar',()=>{
  const {modules}=load(),chunks=['A\ud800','\udc00雪','😀'];let expected=Crypto.createHash('sha256'),actual=modules.primitives.crypto.createHash('sha256');for(const value of chunks){expected.update(value);actual.update(value);}assert.equal(actual.digest('hex'),expected.digest('hex'));assert.throws(()=>actual.update('x'),/apps_script_compatibility/);assert.throws(()=>actual.digest('hex'),/apps_script_compatibility/);
});
test('primitives accept only the exact UTF-8/SHA-256 subset and never coerce caller objects',()=>{
  const p=Primitives.createAppsScriptPrimitives(fakeUtilities());let hits=0;const value={toString(){hits++;throw Error('SYNTHETIC_PRIVATE');}};
  for(const fn of [()=>p.Buffer.byteLength(value,'utf8'),()=>p.Buffer.byteLength('x','utf16le'),()=>p.crypto.createHash('sha1'),()=>p.crypto.createHash('sha256').update(value),()=>p.crypto.createHash('sha256').update('x','hex'),()=>p.crypto.createHash('sha256').digest('base64'),()=>new p.URL(value)])assert.throws(fn,/apps_script_compatibility/);assert.equal(hits,0);
});
test('bounded byte counter preserves oversized-root rejection without making oversized Blobs',()=>{
  let blobs=0;const u=fakeUtilities(),original=u.newBlob;u.newBlob=function(...args){blobs++;return original.apply(this,args);};const p=Primitives.createAppsScriptPrimitives(u),value='雪'.repeat(Math.floor(Primitives.MAX_BYTES/3)+1);assert.equal(p.Buffer.byteLength(value,'utf8'),Buffer.byteLength(value,'utf8'));assert.equal(blobs,0);assert.throws(()=>p.crypto.createHash('sha256').update(value),/apps_script_compatibility/);assert.equal(blobs,0);
});
test('byte lengths and a thousand-record serialization use zero native Blob, byte or digest calls',()=>{
  const b=load(),before={...b.nativeCalls},p=b.modules.primitives;
  for(const value of ['', 'ASCII', 'café雪😀\ud800', '\udc00', '\ud800\ud800\udc00'])for(const encoding of [undefined,'utf8','utf-8'])assert.equal(p.Buffer.byteLength(value,encoding),Buffer.byteLength(value,encoding));
  const root={records:Array.from({length:1000},(_,index)=>({id:'record-'+index,quantity:index%10,label:'café雪😀',optional:null}))},serialized=b.modules.operations.serializeLegacyRoot(b.realm(root));
  assert.equal(serialized,Core.serializeLegacyRoot(root));assert.deepEqual(b.nativeCalls,before);
  assert.equal(p.crypto.createHash('sha256').update(serialized).digest('hex'),Crypto.createHash('sha256').update(serialized).digest('hex'));
  assert.deepEqual(b.nativeCalls,{blobs:before.blobs+1,bytes:before.bytes+1,digests:before.digests+1});
});
test('Utilities accessors, method drift and malformed digest results fail closed',()=>{
  let hits=0;const accessor={DigestAlgorithm:{SHA_256:'sha256'},computeDigest(){}};Object.defineProperty(accessor,'newBlob',{get(){hits++;throw Error('SYNTHETIC_PRIVATE');}});assert.throws(()=>Primitives.createAppsScriptPrimitives(accessor),/apps_script_compatibility/);assert.equal(hits,0);
  const u=fakeUtilities(),p=Primitives.createAppsScriptPrimitives(u);u.computeDigest=()=>[];assert.throws(()=>p.crypto.createHash('sha256').update('x'),/apps_script_compatibility/);
  for(const digest of [[],Array(32),Array(32).fill(256),'not bytes']){const bad=fakeUtilities();bad.computeDigest=()=>digest;assert.throws(()=>Primitives.createAppsScriptPrimitives(bad).crypto.createHash('sha256').update('x').digest('hex'),/apps_script_compatibility/);}
});
test('Utilities byte arrays cannot hide getters, holes or extra properties',()=>{
  for(const make of [()=>Array(1),()=>{const a=[120];a.extra=true;return a;},()=>{const a=[];Object.defineProperty(a,'0',{enumerable:true,get(){throw Error('SYNTHETIC_PRIVATE');}});return a;}]){const u=fakeUtilities();u.newBlob=()=>({getBytes:make});assert.throws(()=>Primitives.createAppsScriptPrimitives(u).crypto.createHash('sha256').update('x'),/apps_script_compatibility/);}
});
test('native Utilities exceptions cannot expose underlying private error text',()=>{
  for(const method of ['newBlob','getBytes','computeDigest']){const u=fakeUtilities(),explode=()=>{throw Error('SYNTHETIC_PRIVATE');};if(method==='getBytes')u.newBlob=()=>({getBytes:explode});else u[method]=explode;const p=Primitives.createAppsScriptPrimitives(u);assert.throws(()=>p.crypto.createHash('sha256').update('x').digest('hex'),error=>error.message==='apps_script_compatibility');}
});
test('origin adapter admits only bounded canonical Firebase HTTPS origins',()=>{
  const p=Primitives.createAppsScriptPrimitives(fakeUtilities());for(const value of [F.URL,'https://demo-origin-default-rtdb.asia-southeast1.firebasedatabase.app']){const actual=new p.URL(value),expected=new URL(value);for(const field of ['protocol','origin','hostname','port','username','password','search','hash'])assert.equal(actual[field],expected[field]);assert.equal(Object.isFrozen(actual),true);}
  for(const value of [F.URL+'/',F.URL+'?access_token=x',F.URL+'#x',F.URL.replace('https:','http:'),F.URL.replace('demo-','DEMO-'),'https://u:p@demo-test.firebaseio.com','https://demo-test.firebaseio.com:443','https://example.com',' '+F.URL,'https://'+'a'.repeat(256)+'.firebaseio.com'])assert.throws(()=>new p.URL(value),/apps_script_compatibility/);
});
test('strict root serialization/copy preserves Unicode, nulls, map shapes and unknown source data',()=>{
  const b=load(),f=fixture(),expected=Core.serializeLegacyRoot(f.root);assert.equal(b.modules.operations.serializeLegacyRoot(b.realm(f.root)),expected);assert.deepEqual(normal(b.modules.operations.copyLegacyRoot(b.realm(f.root))),f.root);assert.equal(expected.includes('87.125'),true);
});
test('operational own view and source digests match the existing pure core exactly',()=>{
  const b=load(),f=fixture(),before=F.copy(f.root),expected=Core.createProductionLegacyOperations(options()).read({root:f.root,identity:f.identity}),actual=b.operations.read(b.realm({root:f.root,identity:f.identity}));assert.equal(expected.ok,true);assert.deepEqual(normal(actual),expected);assert.deepEqual(f.root,before);assert.equal(JSON.stringify(actual).includes('tarif'),false);assert.equal(JSON.stringify(actual).includes('foreign-report'),false);
});
test('append candidate, private receipt, historic amounts and archives match without a write',()=>{
  const b=load(),f=fixture(),core=Core.createProductionLegacyOperations(options()),cmd=command(core,f),before=F.copy(f.root);const expected=core.append({root:f.root,identity:f.identity,command:cmd}),actual=b.operations.append(b.realm({root:f.root,identity:f.identity,command:cmd}));assert.equal(expected.ok,true);assert.deepEqual(normal(actual),expected);assert.equal(actual.next.soldier.produksi.produksi['0'].jahit.own.total,87.125);assert.deepEqual(normal(actual.next.soldier.produksi.produksi['0'].arsip),before.soldier.produksi.produksi['0'].arsip);assert.deepEqual(f.root,before);assert.deepEqual(normal(actual.next.otherRoot),before.otherRoot);
});
test('same-command replay and read-only receipt resolution preserve hash and identity provenance parity',()=>{
  const b=load(),f=fixture(),core=Core.createProductionLegacyOperations(options()),cmd=command(core,f),first=core.append({root:f.root,identity:f.identity,command:cmd});for(const method of ['append','resolve']){const input={root:first.next,identity:f.identity,command:cmd};assert.deepEqual(normal(b.operations[method](b.realm(input))),core[method](input));}
  assert.deepEqual(normal(b.operations.resolve(b.realm({root:f.root,identity:f.identity,command:cmd}))),{ok:false,error:'result_unknown'});
});
test('finance stored observations and QC wages retain their separate own-only parity',()=>{
  const b=load(),f=fixture(),core=Finance.createProductionLegacyFinance(options()),expected=core.read({root:f.root,identity:f.identity}),actual=b.finance.read(b.realm({root:f.root,identity:f.identity}));assert.equal(expected.ok,true);assert.deepEqual(normal(actual),expected);assert.equal(actual.view.storedJahit.records.find(v=>v.sourceRecordId==='old-report').stored.total,87.125);assert.equal(actual.view.slip.entries[0].total,14);assert.equal(actual.view.combinedPayout,null);for(const text of ['foreign-report','foreign-advance','privateCost','googleSubject',F.EMAIL])assert.equal(JSON.stringify(actual).includes(text),false,text);
});
test('changes to current tariffs cannot reprice either historical finance lane',()=>{
  const b=load(),f=fixture(),before=b.finance.read(b.realm({root:f.root,identity:f.identity}));f.root.soldier.produksi_meta.tukangJahit.own.tarif['Synthetic_Series|Item雪']=123.25;f.root.soldier.produksi_meta.tukangJahit.own.tarifHistory['Synthetic_Series|Item雪'].push({effectiveAt:F.BEFORE,rate:999.25});const after=b.finance.read(b.realm({root:f.root,identity:f.identity}));assert.deepEqual(normal(after.view.storedJahit),normal(before.view.storedJahit));assert.deepEqual(normal(after.view.slip),normal(before.view.slip));assert.deepEqual(normal(after),Finance.createProductionLegacyFinance(options()).read({root:f.root,identity:f.identity}));
});
test('product and explicit row tombstones keep operational and financial omission parity',()=>{
  for(const marker of [{produksi_deleted_ids:'["product-1"]'},{produksi_deletions:'{"product-1|jahit|id:old-report":1}'},{produksi_deletions:{'product-1|qc|id:quality-1':1}}]){const b=load(),f=fixture();Object.assign(f.root.soldier,marker);const input={root:f.root,identity:f.identity};assert.deepEqual(normal(b.operations.read(b.realm(input))),Core.createProductionLegacyOperations(options()).read(input));assert.deepEqual(normal(b.finance.read(b.realm(input))),Finance.createProductionLegacyFinance(options()).read(input));assert.equal(f.p.jahit.own.total,87.125);}
});
test('malformed/duplicate marker controls fail identically before a partial view escapes',()=>{
  for(const marker of ['{"x":1,"\\u0078":2}','{"x":{"nested":1}}','not-json']){const b=load(),f=fixture();f.root.soldier.produksi_deletions=marker;const input={root:f.root,identity:f.identity};assert.deepEqual(normal(b.operations.read(b.realm(input))),Core.createProductionLegacyOperations(options()).read(input));assert.deepEqual(normal(b.finance.read(b.realm(input))),Finance.createProductionLegacyFinance(options()).read(input));}
});
test('revoked or replaced retained identity cannot obtain operational or finance data',()=>{
  for(const kind of ['subject','revoked']){const b=load(),f=fixture();if(kind==='subject')f.identity.googleSubject='different-subject';else f.root.authorityTenants[F.TENANT]=normal(State.revokeIdentityEnrollment(f.root.authorityTenants[F.TENANT],F.revokeCommand(),F.NOW).next);const input={root:f.root,identity:f.identity};for(const [actual,original]of [[b.operations,Core.createProductionLegacyOperations(options())],[b.finance,Finance.createProductionLegacyFinance(options())]])assert.deepEqual(normal(actual.read(b.realm(input))),original.read(input));}
});
test('descriptor getter and sparse root rejection remain strict inside the generated realm',()=>{
  const b=load();const getter=vm.runInContext("(()=>{const root={};Object.defineProperty(root,'soldier',{enumerable:true,get(){throw Error('SYNTHETIC_PRIVATE');}});return root;})()",b.context);const sparse=vm.runInContext('({unknown:Array(2)})',b.context);
  for(const root of [getter,sparse])assert.throws(()=>b.modules.operations.serializeLegacyRoot(root),/not_ready/);
});
test('over-budget source gets the same capacity error without an oversized Utilities allocation',()=>{
  const b=load(),root={text:'x'.repeat(Core.MAX_ROOT_BYTES+1)};assert.throws(()=>Core.serializeLegacyRoot(root),/capacity_limit/);assert.throws(()=>b.modules.operations.serializeLegacyRoot(b.realm(root)),/capacity_limit/);
});
