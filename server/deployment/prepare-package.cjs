'use strict';
// Explicit local preparation only. Never enumerate/copy the application root,
// install dependencies, read a backup or credential, invoke a CLI, or deploy.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const Lock=require('./validate-dependency-lock.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUTPUT=path.join(__dirname,'.prepared');
// Exact public candidate bytes, not a claim that advisory/host review passed.
// Dependency changes require another explicit source/hash review; callers and
// environment cannot substitute a different otherwise-valid lock.
const PINNED_LOCK_SHA256='3b96ac007f3cc4f5ae039b47c4eaf05a6a597117a4f9e42d5fda78847b4337e1';
const SOURCES=Object.freeze([
  'server/production-authority.cjs',
  'server/production-command-service.cjs',
  'server/production-http-handler.cjs',
  'server/production-owner-ledger.cjs',
  'server/production-rate-limiter.cjs',
  'server/production-runtime.cjs',
  'server/production-session-service.cjs',
  'server/production-tariff-ledger.cjs',
  'server/production-tenant-admin.cjs',
  'server/production-tenant-adapter.cjs',
  'server/deployment/configuration.cjs',
  'server/deployment/functions-adapter.cjs',
  'server/deployment/index.cjs'
]);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function approvedRead(relative){
  const absolute=path.resolve(ROOT,...relative.split('/'));
  if(!absolute.startsWith(ROOT+path.sep))throw Error('invalid_package_source');
  let current=ROOT;for(const part of relative.split('/')){current=path.join(current,part);const stat=await fs.lstat(current);if(stat.isSymbolicLink())throw Error('invalid_package_source');}
  const stat=await fs.lstat(absolute);if(!stat.isFile()||stat.size>1048576)throw Error('invalid_package_source');
  const bytes=await fs.readFile(absolute);if(bytes.length>1048576)throw Error('invalid_package_source');return bytes;
}
async function preparePackage(){
  await Lock.assertProjectConfigsAbsent();
  const packageBytes=await approvedRead('server/deployment/package.json'),lockBytes=await approvedRead('server/deployment/package-lock.json');
  const dependency=Lock.validateLock(lockBytes,packageBytes);if(dependency.lockSha256!==PINNED_LOCK_SHA256)throw Error('invalid_package_lock');
  const copies=[];
  for(const relative of SOURCES)copies.push({destination:'functions/'+relative,bytes:await approvedRead(relative)});
  copies.push({destination:'functions/package.json',bytes:packageBytes});
  copies.push({destination:'functions/package-lock.json',bytes:lockBytes});
  copies.push({destination:'firebase.json',bytes:await approvedRead('server/deployment/firebase.prepared.json')});
  copies.push({destination:'hosting-rewrites.review-only.json',bytes:await approvedRead('server/deployment/hosting-rewrites.prepared.json')});
  // Bound the fixed output directory before any creation. Reject links and
  // collisions; never delete, replace or merge an earlier prepared artifact.
  try{const stat=await fs.lstat(OUTPUT);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('invalid_package_output');}catch(error){if(error.code!=='ENOENT')throw error;await fs.mkdir(OUTPUT);}
  const destination=path.join(OUTPUT,crypto.randomUUID());if(path.dirname(destination)!==OUTPUT)throw Error('invalid_package_output');
  await fs.mkdir(destination);
  const manifest=[];
  for(const copy of copies){const target=path.join(destination,...copy.destination.split('/'));await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,copy.bytes,{flag:'wx'});manifest.push({path:copy.destination,bytes:copy.bytes.length,sha256:sha(copy.bytes)});}
  const configuration=require('./configuration.cjs');
  const result={schemaVersion:1,preparedOnly:true,configurationEnabled:configuration.enabled===true,dependenciesInstalled:false,dependencyLockReviewed:false,dependencyAuditReviewed:false,dependencyLockValidated:true,dependencyLockSha256:dependency.lockSha256,dependencyPackageCount:dependency.packageCount,dependencyOptionalPackageCount:dependency.optionalPackageCount,dependencyRegistryAliasCount:dependency.registryAliasCount,dependencyInstallScriptPackages:dependency.installScriptPackages,sourceFiles:SOURCES.length,files:manifest};
  await fs.writeFile(path.join(destination,'preparation-manifest.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  return Object.freeze({directory:destination,manifest:Object.freeze(result)});
}
if(require.main===module)preparePackage().then(result=>{process.stdout.write(JSON.stringify({preparedOnly:true,directory:result.directory,files:result.manifest.files.length})+'\n');}).catch(()=>{process.stderr.write('package_preparation_failed\n');process.exitCode=1;});
module.exports=Object.freeze({preparePackage,SOURCES,PINNED_LOCK_SHA256});
