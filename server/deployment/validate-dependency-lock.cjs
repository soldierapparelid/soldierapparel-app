'use strict';
// Preparation/review helper only. No SDK import, dependency install, credential,
// environment lookup, application data, network, activation or deployment.
const crypto=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path');
const {TextDecoder}=require('node:util');
const LIMITS=Object.freeze({bytes:1048576,packages:2048,depth:64,nodes:100000,string:16384});
const EXPECTED=Object.freeze({name:'soldier-production-server-prepared',version:'0.0.0-prepared',private:true,main:'server/deployment/index.cjs',engines:Object.freeze({node:'22'}),dependencies:Object.freeze({'firebase-admin':'14.5.0','firebase-functions':'7.3.0'})});
const ROOT=path.resolve(__dirname,'../..'),PROJECT_DIRECTORIES=Object.freeze(['','server','server/deployment','security']);
const forbidden=new Set(['__proto__','constructor','prototype']);
const packageFields=new Set(['version','resolved','integrity','license','dependencies','optionalDependencies','peerDependencies','peerDependenciesMeta','engines','funding','bin','os','cpu','deprecated','optional','peer','hasInstallScript']);
const fail=()=>{throw Error('invalid_dependency_lock');};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fields(value,names){return plain(value)&&Reflect.ownKeys(value).length===names.length&&names.every(name=>{const d=Object.getOwnPropertyDescriptor(value,name);return d&&d.enumerable&&Object.hasOwn(d,'value');});}
function inspect(value){
  let nodes=0;const seen=new Set();
  function walk(item,depth){
    if(++nodes>LIMITS.nodes||depth>LIMITS.depth)fail();
    if(item===null||typeof item==='boolean')return;
    if(typeof item==='string'){if(item.length>LIMITS.string||/[\u0000-\u001f\u007f-\u009f]/.test(item))fail();return;}
    if(typeof item==='number'){if(!Number.isFinite(item))fail();return;}
    if(!item||typeof item!=='object'||seen.has(item))fail();seen.add(item);
    if(Array.isArray(item)){
      if(Object.getPrototypeOf(item)!==Array.prototype||item.length>LIMITS.nodes||Reflect.ownKeys(item).length!==item.length+1)fail();
      for(let i=0;i<item.length;i++){const d=Object.getOwnPropertyDescriptor(item,String(i));if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail();walk(d.value,depth+1);}
    }else{
      if(!plain(item))fail();
      for(const key of Reflect.ownKeys(item)){
        if(typeof key!=='string'||forbidden.has(key)||key.length>1024||/[\u0000-\u001f\u007f-\u009f]/.test(key))fail();
        const d=Object.getOwnPropertyDescriptor(item,key);if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail();walk(d.value,depth+1);
      }
    }
  }
  walk(value,0);
}
function decode(raw){
  if(typeof raw!=='string'&&!Buffer.isBuffer(raw))fail();
  const bytes=Buffer.isBuffer(raw)?Buffer.from(raw):Buffer.from(raw,'utf8');if(!bytes.length||bytes.length>LIMITS.bytes)fail();
  let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail();}
  // Scan key tokens before JSON.parse: escaped duplicate aliases and excessive
  // nesting must never become a last-key-wins dependency selection.
  const stack=[];
  try{
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(c==='"'){
        let end=i+1;for(;end<text.length;end++){if(text[end]==='\\'){end++;continue;}if(text[end]==='"')break;}
        if(end>=text.length)fail();const top=stack[stack.length-1];
        if(top?.object&&top.key){const name=JSON.parse(text.slice(i,end+1));if(top.keys.has(name)||forbidden.has(name))fail();top.keys.add(name);top.key=false;}
        i=end;
      }else if(c==='{'||c==='['){stack.push(c==='{'?{object:true,key:true,keys:new Set()}:{object:false});if(stack.length>LIMITS.depth)fail();}
      else if(c==='}'||c===']')stack.pop();
      else if(c===','&&stack[stack.length-1]?.object)stack[stack.length-1].key=true;
    }
    const value=JSON.parse(text);inspect(value);return {value,bytes};
  }catch{fail();}
}
function version(value){
  if(typeof value!=='string'||value.length>128)return false;
  const number='(?:0|[1-9][0-9]*)',identifier='(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)';
  return new RegExp('^'+number+'\\.'+number+'\\.'+number+'(?:-'+identifier+'(?:\\.'+identifier+')*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$').test(value);
}
function packageName(value){return typeof value==='string'&&value.length<=214&&/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value)&&value.split('/').every(part=>!forbidden.has(part));}
function packagePath(value){
  if(typeof value!=='string'||value.length>1024)return null;const parts=value.split('/');let cursor=0,last;
  while(cursor<parts.length){
    if(parts[cursor++]!=='node_modules'||cursor>=parts.length)return null;
    let name=parts[cursor++];if(name.startsWith('@')){if(cursor>=parts.length)return null;name+='/'+parts[cursor++];}
    if(!packageName(name))return null;last=name;
  }
  return last||null;
}
function registryUrl(value,name,release){
  if(typeof value!=='string'||value.length>2048)return false;
  try{const url=new URL(value),base=name.split('/').at(-1),expected='https://registry.npmjs.org/'+name+'/-/'+base+'-'+release+'.tgz';return url.protocol==='https:'&&url.hostname==='registry.npmjs.org'&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&url.href===value&&value===expected;}catch{return false;}
}
function integrity(value){if(typeof value!=='string'||!/^sha512-[A-Za-z0-9+/]{86}==$/.test(value))return false;const bytes=Buffer.from(value.slice(7),'base64');return bytes.length===64&&bytes.toString('base64')===value.slice(7);}
function dependencyMap(value){
  if(!plain(value)||Reflect.ownKeys(value).length>512)fail();
  for(const [name,spec] of Object.entries(value))if(!packageName(name)||typeof spec!=='string'||!spec.length||spec.length>512||!/^[0-9A-Za-z.*~^<>=|+ -]+$/.test(spec))fail();
}
function httpsUrl(value){try{const url=new URL(value);return typeof value==='string'&&value.length<=2048&&url.protocol==='https:'&&!url.username&&!url.password&&url.href===value;}catch{return false;}}
function metadata(item){
  if(Object.hasOwn(item,'license')&&(typeof item.license!=='string'||!item.license.length))fail();
  if(Object.hasOwn(item,'deprecated')&&typeof item.deprecated!=='string')fail();
  if(Object.hasOwn(item,'engines')){if(!plain(item.engines)||Object.keys(item.engines).length>32)fail();for(const [name,range] of Object.entries(item.engines))if(!/^[a-z][a-z0-9_-]{0,63}$/.test(name)||typeof range!=='string'||!range.length||range.length>512)fail();}
  for(const key of ['os','cpu'])if(Object.hasOwn(item,key)&&(!Array.isArray(item[key])||!item[key].length||item[key].length>32||item[key].some(value=>typeof value!=='string'||!/^!?[a-z0-9_-]{1,64}$/.test(value))))fail();
  if(Object.hasOwn(item,'bin')){
    const values=typeof item.bin==='string'?[item.bin]:plain(item.bin)?Object.values(item.bin):null;if(!values||!values.length||values.length>128)fail();
    if(plain(item.bin)&&Object.keys(item.bin).some(name=>!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)))fail();
    for(const value of values)if(typeof value!=='string'||value.length>1024||!value.length||value.startsWith('/')||value.includes('\\')||value.split('/').some(part=>part==='..')||!/^[A-Za-z0-9._/-]+$/.test(value))fail();
  }
  if(Object.hasOwn(item,'funding')){
    const values=Array.isArray(item.funding)?item.funding:[item.funding];if(!values.length||values.length>32)fail();
    for(const value of values){if(typeof value==='string'){if(!httpsUrl(value))fail();}else if(!plain(value)||!Object.hasOwn(value,'url')||Object.keys(value).some(key=>!['url','type'].includes(key))||!httpsUrl(value.url)||Object.hasOwn(value,'type')&&(typeof value.type!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value.type)))fail();}
  }
}
function validateManifest(manifest){
  const parsed=typeof manifest==='string'||Buffer.isBuffer(manifest)?decode(manifest).value:manifest;inspect(parsed);
  if(!fields(parsed,Object.keys(EXPECTED))||parsed.name!==EXPECTED.name||parsed.version!==EXPECTED.version||parsed.private!==true||parsed.main!==EXPECTED.main||!fields(parsed.engines,['node'])||parsed.engines.node!=='22'||!fields(parsed.dependencies,Object.keys(EXPECTED.dependencies))||Object.entries(EXPECTED.dependencies).some(([key,value])=>parsed.dependencies[key]!==value))fail();
  return EXPECTED;
}
function resolveDependency(packages,from,name){
  let at=from;
  for(;;){const candidate=(at?at+'/':'')+'node_modules/'+name;if(Object.hasOwn(packages,candidate))return candidate;if(!at)return null;const offset=at.lastIndexOf('/node_modules/');at=offset<0?'':at.slice(0,offset);}
}
function validateLock(raw,manifest){
  const expected=validateManifest(manifest),{value:lock,bytes}=decode(raw);
  if(!fields(lock,['name','version','lockfileVersion','requires','packages'])||lock.name!==expected.name||lock.version!==expected.version||lock.lockfileVersion!==3||lock.requires!==true||!plain(lock.packages))fail();
  const entries=Object.entries(lock.packages);if(entries.length<3||entries.length>LIMITS.packages||!Object.hasOwn(lock.packages,''))fail();
  const root=lock.packages[''];
  if(!fields(root,['name','version','dependencies','engines'])||root.name!==expected.name||root.version!==expected.version||!fields(root.engines,['node'])||root.engines.node!=='22'||!fields(root.dependencies,Object.keys(expected.dependencies))||Object.entries(expected.dependencies).some(([key,value])=>root.dependencies[key]!==value))fail();
  let optionalPackageCount=0;const installScriptPackages=new Set();
  for(const [location,item] of entries){
    if(location==='')continue;const name=packagePath(location);
    if(!name||!plain(item)||Object.keys(item).some(key=>!packageFields.has(key))||!version(item.version)||!registryUrl(item.resolved,name,item.version)||!integrity(item.integrity))fail();
    metadata(item);
    for(const flag of ['optional','peer','hasInstallScript'])if(Object.hasOwn(item,flag)&&typeof item[flag]!=='boolean')fail();
    if(item.optional===true)optionalPackageCount++;if(item.hasInstallScript===true)installScriptPackages.add(name);
    for(const key of ['dependencies','optionalDependencies','peerDependencies'])if(Object.hasOwn(item,key))dependencyMap(item[key]);
    if(Object.hasOwn(item,'peerDependenciesMeta')){
      if(!plain(item.peerDependenciesMeta))fail();
      for(const [peer,meta] of Object.entries(item.peerDependenciesMeta))if(!packageName(peer)||!fields(meta,['optional'])||typeof meta.optional!=='boolean'||!Object.hasOwn(item.peerDependencies||{},peer))fail();
    }
  }
  for(const [name,release] of Object.entries(expected.dependencies))if(lock.packages['node_modules/'+name]?.version!==release)fail();
  // Every mandatory dependency must have a concrete nearby registry entry.
  // Optional peers may be absent; npm ci separately checks npm range semantics.
  const reached=new Set(['']),queue=[''];
  while(queue.length){
    const location=queue.shift(),item=lock.packages[location];
    for(const key of ['dependencies','optionalDependencies','peerDependencies'])for(const name of Object.keys(item[key]||{})){
      const target=resolveDependency(lock.packages,location,name),optional=key==='optionalDependencies'||key==='peerDependencies'&&item.peerDependenciesMeta?.[name]?.optional===true||key==='dependencies'&&Object.hasOwn(item.optionalDependencies||{},name);
      if(!target){if(!optional)fail();continue;}
      if(!reached.has(target)){reached.add(target);queue.push(target);}
    }
  }
  if(reached.size!==entries.length)fail();
  return Object.freeze({schemaVersion:1,lockfileVersion:3,manifestSha256:hash(Buffer.from(JSON.stringify(expected))),lockSha256:hash(bytes),bytes:bytes.length,packageCount:entries.length-1,optionalPackageCount,installScriptPackages:Object.freeze([...installScriptPackages].sort()),dependencyLockValidated:true,dependencyAuditReviewed:false,dependenciesInstalled:false});
}
async function readFixed(name){const filename=path.join(__dirname,name),stat=await fs.lstat(filename);if(stat.isSymbolicLink()||!stat.isFile()||!stat.size||stat.size>LIMITS.bytes)fail();return fs.readFile(filename);}
async function assertProjectConfigsAbsent(){
  // npm still considers project-level config despite empty user/global files.
  // Inspect only fixed path metadata; never open, adopt or print those files.
  for(const relative of PROJECT_DIRECTORIES){
    const directory=path.join(ROOT,...relative.split('/')),stat=await fs.lstat(directory);if(stat.isSymbolicLink()||!stat.isDirectory())fail();
    for(const name of ['.npmrc','npm-shrinkwrap.json']){
      try{await fs.lstat(path.join(directory,name));}catch(error){if(error.code==='ENOENT')continue;fail();}fail();
    }
  }
}
if(require.main===module){
  (async()=>{
    const manifestOnly=process.argv.length===3&&process.argv[2]==='--manifest-only';if(process.argv.length!==2&&!manifestOnly)fail();await assertProjectConfigsAbsent();const manifest=await readFixed('package.json');
    if(manifestOnly){validateManifest(manifest);process.stdout.write(JSON.stringify({schemaVersion:1,manifestValidated:true,manifestSha256:hash(Buffer.from(JSON.stringify(EXPECTED))),projectConfigurationAbsent:true})+'\n');}
    else{const raw=await readFixed('package-lock.json');process.stdout.write(JSON.stringify(validateLock(raw,manifest))+'\n');}
  })().catch(()=>{process.stderr.write('dependency_lock_validation_failed\n');process.exitCode=1;});
}
module.exports=Object.freeze({validateLock,validateManifest,assertProjectConfigsAbsent,LIMITS});
