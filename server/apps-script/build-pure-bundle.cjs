'use strict';
// Local build tool, never emitted as a server or browser host.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const Manifest=require('./compatibility-manifest.cjs');
const REPO_ROOT=path.resolve(__dirname,'../..');
const PREPARED_DIRECTORY=path.resolve(REPO_ROOT,'../apps-script-prepared');
const SOURCE_LIMIT=512*1024;
const fail=code=>{throw new Error(code);};
const hash=text=>crypto.createHash('sha256').update(text,'utf8').digest('hex');
function runtimeCompatibility(source){
  if(typeof source!=='string'||Buffer.byteLength(source,'utf8')>SOURCE_LIMIT)fail('bundle_source_limit');
  // Conservative text audit backed by an exact reviewed source hash, not a
  // general parser or a claim of complete static security analysis.
  if(/\b(?:eval|Function|fetch|process|window|document|navigator|performance|setTimeout|setInterval|clearTimeout|clearInterval|URLSearchParams|SubtleCrypto|TextEncoder|TextDecoder|FormData|ReadableStream|WritableStream|XMLHttpRequest|WebSocket|atob|btoa|importScripts)\b/.test(source))fail('bundle_unsupported_runtime');
  for(const match of source.matchAll(/\bBuffer\.([A-Za-z_$][A-Za-z0-9_$]*)/g))if(match[1]!=='byteLength')fail('bundle_unsupported_runtime');
  if(/\b(?:import|export)\s+(?:\{|\*|default|[A-Za-z_$]+\s+from)/.test(source))fail('bundle_unsupported_runtime');
  if(/(?:^|[;{}\n])\s*#[A-Za-z_$]/m.test(source)||/\bstatic\s+[A-Za-z_$][A-Za-z0-9_$]*\s*(?:=|;)/.test(source))fail('bundle_unsupported_runtime');
  return true;
}
function reviewedSource(file,source){
  const row=Manifest.modules.find(v=>v.file===file);if(!row)fail('bundle_module_rejected');
  if(typeof source!=='string')fail('bundle_source_rejected');const normalized=source.replace(/\r\n/g,'\n');
  runtimeCompatibility(normalized);if(hash(normalized)!==row.sha256)fail('bundle_source_drift');return normalized;
}
function noLinks(absolute,allowMissing=false){
  if(typeof absolute!=='string'||!path.isAbsolute(absolute))fail('bundle_path_rejected');
  const resolved=path.resolve(absolute),root=path.parse(resolved).root;
  let current=root;
  const pieces=path.relative(root,resolved).split(path.sep).filter(Boolean);
  for(let index=-1;index<pieces.length;index++){
    if(index>=0)current=path.join(current,pieces[index]);
    let stat;try{stat=fs.lstatSync(current);}catch(error){if(allowMissing&&error.code==='ENOENT')return resolved;fail('bundle_path_rejected');}
    if(stat.isSymbolicLink())fail('bundle_symlink_rejected');
    if(index<pieces.length-1&&!stat.isDirectory())fail('bundle_path_rejected');
  }return resolved;
}
function readPublicSource(file){
  if(file!=='server/apps-script/primitives.cjs'&&!Manifest.modules.some(row=>row.file===file))fail('bundle_module_rejected');
  const absolute=path.resolve(REPO_ROOT,file);
  if(!absolute.startsWith(REPO_ROOT+path.sep))fail('bundle_module_rejected');
  noLinks(absolute);if(!fs.lstatSync(absolute).isFile())fail('bundle_source_rejected');
  const source=fs.readFileSync(absolute,'utf8');noLinks(absolute);return source;
}
function createBundle(){
  const names=new Map(Manifest.modules.map((row,index)=>[row.file,'__module'+index]));
  const primitiveSource=readPublicSource('server/apps-script/primitives.cjs').replace(/\r\n/g,'\n');
  runtimeCompatibility(primitiveSource);if(/\brequire\b/.test(primitiveSource))fail('bundle_dependency_rejected');
  const pieces=[];
  for(const row of Manifest.modules){
    const expected=new Set(Object.keys(row.dependencies)),seen=new Set();
    const source=reviewedSource(row.file,readPublicSource(row.file));
    const replaced=source.replace(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g,(_all,_quote,dependency)=>{
      if(!expected.has(dependency)||seen.has(dependency))fail('bundle_dependency_rejected');seen.add(dependency);
      const target=row.dependencies[dependency];if(target==='@crypto')return '__primitives.crypto';
      const index=Manifest.modules.findIndex(v=>v.file===target),current=Manifest.modules.indexOf(row);
      if(index<0||index>=current)fail('bundle_dependency_rejected');return names.get(target);
    });
    // Reviewed files contain the English verb "require" in comments. Their
    // pinned hashes exclude aliases; this guard rejects every remaining call.
    if(seen.size!==expected.size||/\brequire\s*\(/.test(replaced))fail('bundle_dependency_rejected');
    pieces.push('const '+names.get(row.file)+'=(function(){\nconst module={exports:{}};const exports=module.exports;\nconst Buffer=__primitives.Buffer,URL=__primitives.URL,globalThis=Object.create(null);\n'+replaced+'\nreturn module.exports;\n})();');
  }
  const source="'use strict';\n// GENERATED LOCAL FEASIBILITY ARTIFACT. No live host, authenticated request adapter or network.\nvar SoldierAppsScriptFeasibility=(function(){\nconst configuration=Object.freeze({legacyOperationsEnabled:false,legacyFinanceEnabled:false,binding:Object.freeze({projectId:'',databaseURL:'',tenantId:''}),tariffPolicy:null});\nconst disabled=()=>Object.freeze({ok:false,error:'service_disabled'});\nconst disabledOperations=Object.freeze({read:disabled,append:disabled,resolve:disabled,capture:disabled}),disabledFinance=Object.freeze({read:disabled});\nfunction createPureModules(utilities){\nconst __primitives=(function(){const module={exports:{}};const exports=module.exports;\n"+primitiveSource+"\nreturn module.exports.createAppsScriptPrimitives(utilities);})();\n"+pieces.join('\n')+"\nreturn Object.freeze({operations:"+names.get('server/production-legacy-operations.cjs')+",finance:"+names.get('server/production-legacy-finance.cjs')+",primitives:__primitives});\n}\nreturn Object.freeze({schemaVersion:1,configuration,disabledOperations,disabledFinance,createPureModules});\n})();\n";
  runtimeCompatibility(source);if(/\brequire\s*\(|\bdoGet\s*\(|\bdoPost\s*\(|\bScriptApp\b|\bUrlFetchApp\b/.test(source))fail('bundle_live_host_rejected');
  new vm.Script(source,{filename:'legacy-pure.gs'});
  const metadata=Object.freeze({schemaVersion:1,bundleSha256:hash(source),configuration:Manifest.configuration,modules:Manifest.modules.map(row=>({file:row.file,sha256:row.sha256}))});
  return Object.freeze({source,metadata});
}
function buildPrepared(){
  const bundle=createBundle();noLinks(PREPARED_DIRECTORY,true);fs.mkdirSync(PREPARED_DIRECTORY,{recursive:true});noLinks(PREPARED_DIRECTORY);
  if(!fs.lstatSync(PREPARED_DIRECTORY).isDirectory())fail('bundle_path_rejected');
  const id=crypto.randomUUID();if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))fail('bundle_path_rejected');
  const directory=path.join(PREPARED_DIRECTORY,id);noLinks(directory,true);fs.mkdirSync(directory);noLinks(directory);
  const bundlePath=path.join(directory,'legacy-pure.gs'),metadataPath=path.join(directory,'compatibility-manifest.json');
  fs.writeFileSync(bundlePath,bundle.source,{encoding:'utf8',flag:'wx',mode:0o600});noLinks(bundlePath);
  fs.writeFileSync(metadataPath,JSON.stringify(bundle.metadata,null,2)+'\n',{encoding:'utf8',flag:'wx',mode:0o600});noLinks(metadataPath);
  return Object.freeze({bundlePath,metadataPath,bundleSha256:bundle.metadata.bundleSha256});
}
module.exports=Object.freeze({createBundle,buildPrepared,reviewedSource,runtimeCompatibility,noLinks});
if(require.main===module){if(process.argv.length!==2)fail('bundle_arguments_rejected');const result=buildPrepared();process.stdout.write('Local feasibility bundle compiled: '+result.bundleSha256+'\n');}
