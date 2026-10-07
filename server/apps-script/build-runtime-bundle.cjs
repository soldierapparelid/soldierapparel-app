'use strict';
// Offline build tool only. Never emits a public RPC or a native initialization.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const Pure=require('./build-pure-bundle.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.resolve(ROOT,'../apps-script-prepared');
const hash=v=>crypto.createHash('sha256').update(v,'utf8').digest('hex'),fail=code=>{throw Error(code);};
const rows=Object.freeze([
  Object.freeze({file:'server/apps-script/current-google-identity.cjs',sha256:'7bfa505852724507186480890133e71894063c69cedc36837572811c46057d76',dependencies:Object.freeze({})}),
  Object.freeze({file:'server/apps-script/rest-root-adapter.cjs',sha256:'522dbfc388e7bba274d374c4f7c5ceec5e94db11ca1e3ceec812d02ee8885d1d',dependencies:Object.freeze({})}),
  Object.freeze({file:'server/apps-script/legacy-runtime.cjs',sha256:'77ee5204a43a1f2c070ec4640d5542a88cc8248c412b2429e4dd60096c05c81e',dependencies:Object.freeze({'./current-google-identity.cjs':'__native0','./rest-root-adapter.cjs':'__native1','../production-legacy-operations.cjs':'__pure.operations','../production-legacy-finance.cjs':'__pure.finance'})}),
  Object.freeze({file:'server/apps-script/shared-request-admission.cjs',sha256:'7c854344c46294f1f7f941ef8f916c66d2e462eb33b8fa3a4410591e17027343',dependencies:Object.freeze({})}),
  Object.freeze({file:'legacy-view-client.js',sha256:'dcce2c377a5f546ac1c3fbe1e1451698e517c4092f06598a11cb7dbf2f5c756d',dependencies:Object.freeze({})}),
  Object.freeze({file:'server/apps-script/rpc-gateway.cjs',sha256:'0920ee1ca356c180b9685d5253e96a8b0b2d1c081d47bb945e78d51fe59d3739',dependencies:Object.freeze({'../../legacy-view-client.js':'__native4'})})
]);
const configuration=Object.freeze({enabled:false,binding:Object.freeze({projectId:'',databaseURL:'',tenantId:'',apiKey:''}),tariffPolicy:null,admissionPolicy:null});
function reviewedSource(file,raw){
  const row=rows.find(v=>v.file===file);if(!row||typeof raw!=='string')fail('runtime_module_rejected');const source=raw.replace(/\r\n/g,'\n');
  if(Buffer.byteLength(source,'utf8')>128*1024)fail('runtime_source_limit');if(hash(source)!==row.sha256)fail('runtime_source_drift');
  // Unlike the pure build, these exact reviewed modules include native-fetch
  // callbacks. Never relax the pure build's no-network audit to include them.
  if(/\b(?:eval|Function|process|window|document|setTimeout|setInterval|TextEncoder|TextDecoder|URLSearchParams|ScriptApp|UrlFetchApp|LockService|PropertiesService|Logger)\b|\bconsole\./.test(source))fail('runtime_host_rejected');
  return source;
}
function createBundle(){
  const pure=Pure.createBundle(),pieces=[];
  for(let i=0;i<rows.length;i++){
    const row=rows[i],absolute=path.resolve(ROOT,row.file);if(!absolute.startsWith(ROOT+path.sep))fail('runtime_path_rejected');Pure.noLinks(absolute);
    if(!fs.lstatSync(absolute).isFile())fail('runtime_path_rejected');const source=reviewedSource(row.file,fs.readFileSync(absolute,'utf8'));Pure.noLinks(absolute);
    const seen=new Set(),expected=new Set(Object.keys(row.dependencies));
    const changed=source.replace(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g,(_all,_quote,dependency)=>{if(!expected.has(dependency)||seen.has(dependency))fail('runtime_dependency_rejected');seen.add(dependency);return row.dependencies[dependency];});
    if(seen.size!==expected.size||/\brequire\s*\(/.test(changed))fail('runtime_dependency_rejected');
    pieces.push('const __native'+i+'=(function(){\nconst module={exports:{}};const exports=module.exports;\nconst Buffer=__pure.primitives.Buffer,URL=__pure.primitives.URL,globalThis=Object.create(null);\n'+changed+'\nreturn module.exports;\n})();');
  }
  const source=pure.source+"\n// GENERATED SOURCE-OFF INTERNAL RUNTIME. Explicit trusted host dependencies only.\nvar SoldierAppsScriptRuntime=(function(){\nconst configuration="+'Object.freeze({enabled:false,binding:Object.freeze({projectId:\'\',databaseURL:\'\',tenantId:\'\',apiKey:\'\'}),tariffPolicy:null,admissionPolicy:null});'+"\nconst disabled=()=>Object.freeze({ok:false,error:'service_disabled'});\nconst disabledRuntime=Object.freeze({read:disabled,readFinance:disabled,execute:disabled,resolve:disabled});\nfunction createModules(utilities){\nconst __pure=SoldierAppsScriptFeasibility.createPureModules(utilities);\n"+pieces.join('\n')+"\nreturn Object.freeze({runtime:__native2,sharedAdmission:__native3,rpc:__native5});\n}\nreturn Object.freeze({schemaVersion:1,configuration,disabledRuntime,createModules});\n})();\n";
  if(Buffer.byteLength(source,'utf8')>512*1024)fail('runtime_source_limit');
  if(/\brequire\s*\(|\b(?:doGet|doPost)\s*\(|\b(?:ScriptApp|UrlFetchApp|LockService|PropertiesService|Logger)\b|\bconsole\./.test(source))fail('runtime_host_rejected');
  new vm.Script(source,{filename:'legacy-runtime.gs'});
  const metadata=Object.freeze({schemaVersion:1,bundleSha256:hash(source),pureBundleSha256:pure.metadata.bundleSha256,configuration,pureModules:pure.metadata.modules,modules:rows.map(v=>({file:v.file,sha256:v.sha256}))});
  return Object.freeze({source,metadata});
}
function buildPrepared(){
  const bundle=createBundle();Pure.noLinks(OUT,true);fs.mkdirSync(OUT,{recursive:true});Pure.noLinks(OUT);
  const directory=path.join(OUT,crypto.randomUUID());Pure.noLinks(directory,true);fs.mkdirSync(directory);Pure.noLinks(directory);
  const bundlePath=path.join(directory,'legacy-runtime.gs'),metadataPath=path.join(directory,'runtime-manifest.json');
  fs.writeFileSync(bundlePath,bundle.source,{encoding:'utf8',flag:'wx',mode:0o600});fs.writeFileSync(metadataPath,JSON.stringify(bundle.metadata,null,2)+'\n',{encoding:'utf8',flag:'wx',mode:0o600});
  return Object.freeze({bundlePath,metadataPath,bundleSha256:bundle.metadata.bundleSha256});
}
module.exports=Object.freeze({createBundle,buildPrepared,reviewedSource,rows,configuration});
if(require.main===module){if(process.argv.length!==2)fail('runtime_arguments_rejected');process.stdout.write(JSON.stringify(buildPrepared())+'\n');}
