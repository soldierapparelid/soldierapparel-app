'use strict';
// Offline fixed graph. No public RPC, native initialization or private binding.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const Pure=require('./build-pure-bundle.cjs'),Manifest=require('./compatibility-manifest.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.resolve(ROOT,'../apps-script-prepared');
const hash=v=>crypto.createHash('sha256').update(v,'utf8').digest('hex'),fail=code=>{throw Error(code);};
const additions=[
  ['production-archive.js','44e48dd0ebb1512ec2ea7536bfbcc7b48be885bc3be467095bfe6185d4958260',{}],
  ['production-qc-batch.js','0d28ca795dbaf96b42b93b900897f5a6e9019df5b6089113d93ae6e6b591e637',{}],
  ['server/production-legacy-lifecycle.cjs','9f628a5cb52719495c97c2e8222664ccbb95cca325c4e271152d45b6b6effdfd',{'node:crypto':'@crypto','./production-legacy-operations.cjs':'server/production-legacy-operations.cjs','./production-identity-state.cjs':'server/production-identity-state.cjs','./production-enrollment-identity.cjs':'server/production-enrollment-identity.cjs','../production-workflow.js':'production-workflow.js','../production-payroll.js':'production-payroll.js','../production-archive.js':'production-archive.js','../production-qc-batch.js':'production-qc-batch.js'}],
  ['legacy-view-client.js','dcce2c377a5f546ac1c3fbe1e1451698e517c4092f06598a11cb7dbf2f5c756d',{}],
  ['legacy-lifecycle-client.js','0d9c3995e32d8a3a01c8e32a5ad38b95619dfffa45ff1d02bec7fbe6b61116c7',{'./legacy-view-client.js':'legacy-view-client.js'}],
  ['server/apps-script/current-google-identity.cjs','7bfa505852724507186480890133e71894063c69cedc36837572811c46057d76',{}],
  ['server/apps-script/decoded-google-fetch.cjs','264c1063038105d92e502d3c8d75e936fe67abad363c25a539b656b31efe0edc',{}],
  ['server/apps-script/rest-root-adapter.cjs','522dbfc388e7bba274d374c4f7c5ceec5e94db11ca1e3ceec812d02ee8885d1d',{}],
  ["server/apps-script/protected-rest-wire.cjs","8e30ab2d683656ea31dd7d9bf7f89b92a888312cda9c4f658b3004968cb3fe2a",{}],
  ["server/apps-script/protected-storage-scope.cjs","a6dc95e153dd580b16e1bf52d4d7b6c34a29226b1da857680de8de573bab935a",{"node:crypto":"@crypto","../production-legacy-operations.cjs":"server/production-legacy-operations.cjs","../production-identity-state.cjs":"server/production-identity-state.cjs","../production-enrollment-identity.cjs":"server/production-enrollment-identity.cjs"}],
  ["server/apps-script/protected-working-adapter.cjs","98b6670feba43d347a53c6fa7558a4626b0e7e03ea8f8042996efb97ce38e0d2",{"./protected-rest-wire.cjs":"server/apps-script/protected-rest-wire.cjs","./protected-storage-scope.cjs":"server/apps-script/protected-storage-scope.cjs"}],
  ['server/apps-script/legacy-lifecycle-runtime.cjs','6672c9921e3b6e4a3c1552f00480c41594f52ed84eef2b8d910349ef5b74fbf2',{'./current-google-identity.cjs':'server/apps-script/current-google-identity.cjs','./decoded-google-fetch.cjs':'server/apps-script/decoded-google-fetch.cjs','./rest-root-adapter.cjs':'server/apps-script/rest-root-adapter.cjs','./protected-working-adapter.cjs':'server/apps-script/protected-working-adapter.cjs','../production-legacy-operations.cjs':'server/production-legacy-operations.cjs','../production-legacy-lifecycle.cjs':'server/production-legacy-lifecycle.cjs','../production-legacy-finance.cjs':'server/production-legacy-finance.cjs','../production-identity-state.cjs':'server/production-identity-state.cjs'}],
  ['server/apps-script/shared-request-admission.cjs','7c854344c46294f1f7f941ef8f916c66d2e462eb33b8fa3a4410591e17027343',{}],
  ["server/apps-script/recurring-request-admission.cjs","f788110e835576dc5405c798444162f7ec7f8e4ecda993a75f474814633287d1",{"./shared-request-admission.cjs":"server/apps-script/shared-request-admission.cjs"}],
  ["owner-access-management-codec.js","29eb5a15a1251ce35b01a7a5479281215ff208105948b188d0c86556d6dbfb7a",{}],
  ["server/apps-script/owner-access-management.cjs","1873b771e521c7c51adbe4ce9750976e951c3198416e4e783283fc2834810dfd",{"./current-google-identity.cjs":"server/apps-script/current-google-identity.cjs","./decoded-google-fetch.cjs":"server/apps-script/decoded-google-fetch.cjs","./rest-root-adapter.cjs":"server/apps-script/rest-root-adapter.cjs","./protected-working-adapter.cjs":"server/apps-script/protected-working-adapter.cjs","../production-legacy-operations.cjs":"server/production-legacy-operations.cjs","../production-identity-state.cjs":"server/production-identity-state.cjs","../../owner-access-management-codec.js":"owner-access-management-codec.js"}],
  ['server/apps-script/lifecycle-rpc-gateway.cjs','89eb963ebd474c02ec99565701964f7a560e6e778e2cc135f1bdb612f952eef9',{'../../legacy-lifecycle-client.js':'legacy-lifecycle-client.js'}],
  ['legacy-owner-lifecycle-client.js','ff94816566b72a7ea7d92998aa4e1c00acb760eaec74814a7a0de06b8b95ea43',{'./legacy-lifecycle-client.js':'legacy-lifecycle-client.js'}],
  ['owner-business-storage-codec.js','58b3ac5bb9465205d1a59b7557c1b61477fd0b3d99cbc63b47e6d0226aa57924',{}],
  ['server/apps-script/owner-lifecycle-rpc-gateway.cjs','7bd3450b54067c9e0aed3d693cd2df2f23e9daff4df814dc8749b1efe513443f',{'../../legacy-owner-lifecycle-client.js':'legacy-owner-lifecycle-client.js'}],
  ['server/apps-script/owner-business-rpc-gateway.cjs','179e3eb54e92317bef71db1971ccbbb2d1d715d3df03ef47825905b95a404c10',{'../../owner-business-storage-codec.js':'owner-business-storage-codec.js'}]
];
const rows=Object.freeze([...Manifest.modules,...additions.map(([file,sha256,dependencies],i)=>Object.freeze({file,sha256,dependencies:Object.freeze(dependencies),native:i>=5}))]);
const configuration=Object.freeze({enabled:false,binding:Object.freeze({projectId:'',databaseURL:'',tenantId:'',apiKey:''}),tariffPolicy:null,admissionPolicy:null});
function reviewedSource(file,raw){
  const row=rows.find(r=>r.file===file);if(!row||typeof raw!=='string')fail('lifecycle_module_rejected');const source=raw.replace(/\r\n/g,'\n');
  if(Buffer.byteLength(source,'utf8')>128*1024)fail('lifecycle_source_limit');if(hash(source)!==row.sha256)fail('lifecycle_source_drift');
  if(row.native){if(/\b(?:eval|Function|process|window|document|setTimeout|setInterval|TextEncoder|TextDecoder|URLSearchParams|ScriptApp|UrlFetchApp|LockService|PropertiesService|Logger)\b|\bconsole\./.test(source))fail('lifecycle_host_rejected');}
  else Pure.runtimeCompatibility(source);
  return source;
}
function createBundle(){
  const primitiveFile=path.resolve(ROOT,'server/apps-script/primitives.cjs');Pure.noLinks(primitiveFile);const primitive=fs.readFileSync(primitiveFile,'utf8').replace(/\r\n/g,'\n');
  if(hash(primitive)!=='5d61bb5239bb5f3eb8089d0b4313172e6009a13de2b9c98fdf484604c4ac3c1e')fail('lifecycle_primitive_drift');
  Pure.runtimeCompatibility(primitive);if(/\brequire\b/.test(primitive))fail('lifecycle_dependency_rejected');
  const names=new Map(rows.map((r,i)=>[r.file,'__module'+i])),pieces=[];
  for(let i=0;i<rows.length;i++){
    const row=rows[i],absolute=path.resolve(ROOT,row.file);if(!absolute.startsWith(ROOT+path.sep))fail('lifecycle_path_rejected');Pure.noLinks(absolute);if(!fs.lstatSync(absolute).isFile())fail('lifecycle_path_rejected');
    const source=reviewedSource(row.file,fs.readFileSync(absolute,'utf8'));Pure.noLinks(absolute);const seen=new Set(),expected=new Set(Object.keys(row.dependencies));
    const changed=source.replace(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g,(_all,_q,dependency)=>{if(!expected.has(dependency)||seen.has(dependency))fail('lifecycle_dependency_rejected');seen.add(dependency);const target=row.dependencies[dependency];if(target==='@crypto')return '__primitives.crypto';const index=rows.findIndex(r=>r.file===target);if(index<0||index>=i)fail('lifecycle_dependency_rejected');return names.get(target);});
    if(seen.size!==expected.size||/\brequire\s*\(/.test(changed))fail('lifecycle_dependency_rejected');
    pieces.push('const '+names.get(row.file)+'=(function(){\nconst module={exports:{}};const exports=module.exports;\nconst Buffer=__primitives.Buffer,URL=__primitives.URL,globalThis=Object.create(null);\n'+changed+'\nreturn module.exports;\n})();');
  }
  const source="'use strict';\n// GENERATED SOURCE-OFF LIFECYCLE. Trusted hosts supplied explicitly.\nvar SoldierAppsScriptLifecycleRuntime=(function(){\nconst configuration=Object.freeze({enabled:false,binding:Object.freeze({projectId:'',databaseURL:'',tenantId:'',apiKey:''}),tariffPolicy:null,admissionPolicy:null});\nconst disabled=()=>Object.freeze({ok:false,error:'service_disabled'}),disabledRuntime=Object.freeze({read:disabled,readFinance:disabled,execute:disabled,resolve:disabled});\nfunction createModules(utilities){\nconst __primitives=(function(){const module={exports:{}};const exports=module.exports;\n"+primitive+"\nreturn module.exports.createAppsScriptPrimitives(utilities);})();\n"+pieces.join('\n')+"\nreturn Object.freeze({runtime:"+names.get('server/apps-script/legacy-lifecycle-runtime.cjs')+",lifecycle:"+names.get('server/production-legacy-lifecycle.cjs')+",finance:"+names.get('server/production-legacy-finance.cjs')+",sharedAdmission:"+names.get('server/apps-script/shared-request-admission.cjs')+",rpc:"+names.get('server/apps-script/lifecycle-rpc-gateway.cjs')+",ownerRpc:"+names.get('server/apps-script/owner-lifecycle-rpc-gateway.cjs')+",ownerBusinessRpc:"+names.get('server/apps-script/owner-business-rpc-gateway.cjs')+",protectedScope:"+names.get('server/apps-script/protected-storage-scope.cjs')+",protectedTransport:"+names.get('server/apps-script/protected-working-adapter.cjs')+",recurringAdmission:"+names.get('server/apps-script/recurring-request-admission.cjs')+",ownerAccess:"+names.get('server/apps-script/owner-access-management.cjs')+",primitives:__primitives});\n}\nreturn Object.freeze({schemaVersion:1,configuration,disabledRuntime,createModules});\n})();\n";
  if(Buffer.byteLength(source,'utf8')>512*1024)fail('lifecycle_source_limit');if(/\brequire\s*\(|\b(?:doGet|doPost)\s*\(|\b(?:ScriptApp|UrlFetchApp|LockService|PropertiesService|Logger)\b|\bconsole\./.test(source))fail('lifecycle_host_rejected');
  new vm.Script(source,{filename:'lifecycle-runtime.gs'});
  return Object.freeze({source,metadata:Object.freeze({schemaVersion:1,bundleSha256:hash(source),primitiveSha256:hash(primitive),configuration,modules:rows.map(({file,sha256})=>({file,sha256}))})});
}
function buildPrepared(){
  const bundle=createBundle();Pure.noLinks(OUT,true);fs.mkdirSync(OUT,{recursive:true});Pure.noLinks(OUT);const directory=path.join(OUT,crypto.randomUUID());Pure.noLinks(directory,true);fs.mkdirSync(directory);Pure.noLinks(directory);
  const bundlePath=path.join(directory,'lifecycle-runtime.gs'),metadataPath=path.join(directory,'lifecycle-runtime-manifest.json');
  fs.writeFileSync(bundlePath,bundle.source,{encoding:'utf8',flag:'wx',mode:0o600});fs.writeFileSync(metadataPath,JSON.stringify(bundle.metadata,null,2)+'\n',{encoding:'utf8',flag:'wx',mode:0o600});return Object.freeze({bundlePath,metadataPath,bundleSha256:bundle.metadata.bundleSha256});
}
module.exports=Object.freeze({createBundle,buildPrepared,reviewedSource,rows,configuration});
if(require.main===module){if(process.argv.length!==2)fail('lifecycle_arguments_rejected');process.stdout.write(JSON.stringify(buildPrepared())+'\n');}
