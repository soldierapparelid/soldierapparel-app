'use strict';
// Offline fixed graph. No public RPC, native initialization or private binding.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const Pure=require('./build-pure-bundle.cjs'),Manifest=require('./compatibility-manifest.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.resolve(ROOT,'../apps-script-prepared');
const hash=v=>crypto.createHash('sha256').update(v,'utf8').digest('hex'),fail=code=>{throw Error(code);};
const additions=[
  ['production-archive.js','44e48dd0ebb1512ec2ea7536bfbcc7b48be885bc3be467095bfe6185d4958260',{}],
  ['production-qc-batch.js','0d28ca795dbaf96b42b93b900897f5a6e9019df5b6089113d93ae6e6b591e637',{}],
  ['server/production-legacy-lifecycle.cjs','6b5b7514ec3cd5c2d721282fc1dae2d5f8404d8e7293c080f34ed58481e298bc',{'node:crypto':'@crypto','./production-legacy-operations.cjs':'server/production-legacy-operations.cjs','./production-identity-state.cjs':'server/production-identity-state.cjs','./production-enrollment-identity.cjs':'server/production-enrollment-identity.cjs','../production-workflow.js':'production-workflow.js','../production-payroll.js':'production-payroll.js','../production-archive.js':'production-archive.js','../production-qc-batch.js':'production-qc-batch.js'}],
  ['legacy-view-client.js','dcce2c377a5f546ac1c3fbe1e1451698e517c4092f06598a11cb7dbf2f5c756d',{}],
  ['legacy-lifecycle-client.js','ac9d08c7bc09b560247b7586fa13eed1e458a11da7d34615575c61071b1ec1d6',{'./legacy-view-client.js':'legacy-view-client.js'}],
  ['server/apps-script/current-google-identity.cjs','7bfa505852724507186480890133e71894063c69cedc36837572811c46057d76',{}],
  ['server/apps-script/decoded-google-fetch.cjs','264c1063038105d92e502d3c8d75e936fe67abad363c25a539b656b31efe0edc',{}],
  ['server/apps-script/rest-root-adapter.cjs','522dbfc388e7bba274d374c4f7c5ceec5e94db11ca1e3ceec812d02ee8885d1d',{}],
  ['server/apps-script/legacy-lifecycle-runtime.cjs','fa891065b4c723def83c6f12c4de2413d8e83416e87b8a3de0b93c248efb71f2',{'./current-google-identity.cjs':'server/apps-script/current-google-identity.cjs','./decoded-google-fetch.cjs':'server/apps-script/decoded-google-fetch.cjs','./rest-root-adapter.cjs':'server/apps-script/rest-root-adapter.cjs','../production-legacy-operations.cjs':'server/production-legacy-operations.cjs','../production-legacy-lifecycle.cjs':'server/production-legacy-lifecycle.cjs','../production-legacy-finance.cjs':'server/production-legacy-finance.cjs'}],
  ['server/apps-script/shared-request-admission.cjs','7c854344c46294f1f7f941ef8f916c66d2e462eb33b8fa3a4410591e17027343',{}],
  ['server/apps-script/lifecycle-rpc-gateway.cjs','2a393b6686e8864f6afa7687dd4271c23df1db12f26088a49db562b821bbf302',{'../../legacy-lifecycle-client.js':'legacy-lifecycle-client.js'}]
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
  if(hash(primitive)!=='493212ab90dd915e6d01f8adbfcdb10b35a9d29b2a7236fa80957b05953bf349')fail('lifecycle_primitive_drift');
  Pure.runtimeCompatibility(primitive);if(/\brequire\b/.test(primitive))fail('lifecycle_dependency_rejected');
  const names=new Map(rows.map((r,i)=>[r.file,'__module'+i])),pieces=[];
  for(let i=0;i<rows.length;i++){
    const row=rows[i],absolute=path.resolve(ROOT,row.file);if(!absolute.startsWith(ROOT+path.sep))fail('lifecycle_path_rejected');Pure.noLinks(absolute);if(!fs.lstatSync(absolute).isFile())fail('lifecycle_path_rejected');
    const source=reviewedSource(row.file,fs.readFileSync(absolute,'utf8'));Pure.noLinks(absolute);const seen=new Set(),expected=new Set(Object.keys(row.dependencies));
    const changed=source.replace(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g,(_all,_q,dependency)=>{if(!expected.has(dependency)||seen.has(dependency))fail('lifecycle_dependency_rejected');seen.add(dependency);const target=row.dependencies[dependency];if(target==='@crypto')return '__primitives.crypto';const index=rows.findIndex(r=>r.file===target);if(index<0||index>=i)fail('lifecycle_dependency_rejected');return names.get(target);});
    if(seen.size!==expected.size||/\brequire\s*\(/.test(changed))fail('lifecycle_dependency_rejected');
    pieces.push('const '+names.get(row.file)+'=(function(){\nconst module={exports:{}};const exports=module.exports;\nconst Buffer=__primitives.Buffer,URL=__primitives.URL,globalThis=Object.create(null);\n'+changed+'\nreturn module.exports;\n})();');
  }
  const source="'use strict';\n// GENERATED SOURCE-OFF LIFECYCLE. Trusted hosts supplied explicitly.\nvar SoldierAppsScriptLifecycleRuntime=(function(){\nconst configuration=Object.freeze({enabled:false,binding:Object.freeze({projectId:'',databaseURL:'',tenantId:'',apiKey:''}),tariffPolicy:null,admissionPolicy:null});\nconst disabled=()=>Object.freeze({ok:false,error:'service_disabled'}),disabledRuntime=Object.freeze({read:disabled,readFinance:disabled,execute:disabled,resolve:disabled});\nfunction createModules(utilities){\nconst __primitives=(function(){const module={exports:{}};const exports=module.exports;\n"+primitive+"\nreturn module.exports.createAppsScriptPrimitives(utilities);})();\n"+pieces.join('\n')+"\nreturn Object.freeze({runtime:"+names.get('server/apps-script/legacy-lifecycle-runtime.cjs')+",lifecycle:"+names.get('server/production-legacy-lifecycle.cjs')+",finance:"+names.get('server/production-legacy-finance.cjs')+",sharedAdmission:"+names.get('server/apps-script/shared-request-admission.cjs')+",rpc:"+names.get('server/apps-script/lifecycle-rpc-gateway.cjs')+",primitives:__primitives});\n}\nreturn Object.freeze({schemaVersion:1,configuration,disabledRuntime,createModules});\n})();\n";
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
