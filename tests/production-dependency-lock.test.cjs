'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path'),{spawnSync}=require('node:child_process');
const Review=require('../server/deployment/validate-dependency-lock.cjs');
// Public/synthetic metadata only; no tarball, credential, SDK or network access.
const manifest=()=>({name:'soldier-production-server-prepared',version:'0.0.0-prepared',private:true,main:'server/deployment/index.cjs',engines:{node:'22'},dependencies:{'firebase-admin':'14.5.0','firebase-functions':'7.3.0'}});
const packageEntry=(name,version,extra={})=>({version,resolved:'https://registry.npmjs.org/'+name+'/-/'+name.split('/').at(-1)+'-'+version+'.tgz',integrity:'sha512-'+Buffer.alloc(64).toString('base64'),license:'Apache-2.0',...extra});
function fixture(){
  const p=manifest();return {name:p.name,version:p.version,lockfileVersion:3,requires:true,packages:{'':{name:p.name,version:p.version,dependencies:p.dependencies,engines:p.engines},'node_modules/firebase-admin':packageEntry('firebase-admin','14.5.0',{dependencies:{'@types/node':'^22.0.0'},optionalDependencies:{'synthetic-optional':'^1.0.0'}}),'node_modules/firebase-functions':packageEntry('firebase-functions','7.3.0',{dependencies:{'firebase-admin':'^14.0.0',protobufjs:'^7.2.2'},peerDependencies:{'synthetic-uninstalled-peer':'^1.0.0'},peerDependenciesMeta:{'synthetic-uninstalled-peer':{optional:true}}}),'node_modules/@types/node':packageEntry('@types/node','22.0.0'),'node_modules/protobufjs':packageEntry('protobufjs','7.5.4',{hasInstallScript:true}),'node_modules/synthetic-optional':packageEntry('synthetic-optional','1.0.0',{optional:true})}};
}
const validate=value=>Review.validateLock(JSON.stringify(value),manifest());
const invalid=fn=>assert.throws(fn,error=>error instanceof Error&&error.message==='invalid_dependency_lock');
test('lock review returns bounded sanitized metadata, exact byte hash, scripts and explicitly no install/audit claim',()=>{
  const raw=Buffer.from(JSON.stringify(fixture(),null,2)+'\n'),result=Review.validateLock(raw,Buffer.from(JSON.stringify(manifest())));
  assert.equal(result.lockSha256,crypto.createHash('sha256').update(raw).digest('hex'));assert.equal(result.manifestSha256,crypto.createHash('sha256').update(JSON.stringify(manifest())).digest('hex'));
  assert.equal(result.bytes,raw.length);assert.equal(result.packageCount,5);assert.equal(result.optionalPackageCount,1);assert.deepEqual(result.installScriptPackages,['protobufjs']);
  assert.equal(result.dependencyLockValidated,true);assert.equal(result.dependencyAuditReviewed,false);assert.equal(result.dependenciesInstalled,false);assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.installScriptPackages));
  assert.equal(JSON.stringify(result).includes('resolved'),false);assert.equal(JSON.stringify(result).includes('integrity'),false);assert.equal(JSON.stringify(result).includes('registry.npmjs.org'),false);
});
test('duplicate JSON keys and escaped aliases cannot silently select another dependency version',()=>{
  const raw=JSON.stringify(fixture());for(const text of [raw.replace('"lockfileVersion":3','"lockfileVersion":2,"lockfileVersion":3'),raw.replace('"version":"14.5.0"','"version":"13.0.0","ver\\u0073ion":"14.5.0"'),raw.replace('"dependencies":{"firebase-admin":"14.5.0"','"dependencies":{"firebase-admin":"13.0.0","firebase-admin":"14.5.0"')])invalid(()=>Review.validateLock(text,manifest()));
});
test('prototype keys, malformed UTF8, BOM, trailing JSON and deeply nested input are rejected',()=>{
  const raw=JSON.stringify(fixture());for(const key of ['__proto__','constructor','prototype'])invalid(()=>Review.validateLock(raw.replace('"requires":true','"'+key+'":{},"requires":true'),manifest()));
  for(const bytes of [Buffer.from([0xc0,0xaf]),Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(raw)]),Buffer.from(raw+'{}')])invalid(()=>Review.validateLock(bytes,manifest()));
  invalid(()=>Review.validateLock('['.repeat(Review.LIMITS.depth+1)+'0'+']'.repeat(Review.LIMITS.depth+1),manifest()));
});
test('manifest hooks, dev dependencies, overrides, alternate project, runtime and SDK version are refused',()=>{
  for(const change of [p=>{p.scripts={preinstall:'synthetic-command'};},p=>{p.devDependencies={'synthetic-dev':'1.0.0'};},p=>{p.overrides={'firebase-admin':'13.0.0'};},p=>{p.name='foreign-package';},p=>{p.engines.node='24';},p=>{p.dependencies['firebase-admin']='^14.5.0';},p=>{p.private=false;},p=>{p.main='foreign.cjs';}]){const p=manifest();change(p);invalid(()=>Review.validateLock(JSON.stringify(fixture()),p));}
});
test('manifest getters, symbols, custom prototypes and sparse metadata cannot execute or be adopted',()=>{
  let calls=0;const p=manifest();Object.defineProperty(p,'name',{enumerable:true,get(){calls++;return manifest().name;}});invalid(()=>Review.validateLock(JSON.stringify(fixture()),p));assert.equal(calls,0);
  const symbol=manifest();symbol[Symbol('hidden')]=true;invalid(()=>Review.validateLock(JSON.stringify(fixture()),symbol));
  invalid(()=>Review.validateLock(JSON.stringify(fixture()),Object.assign(Object.create({foreign:true}),manifest())));
  const sparse=fixture();sparse.packages['node_modules/protobufjs'].funding=new Array(1);invalid(()=>Review.validateLock(JSON.stringify(sparse),manifest()));
});
test('raw lock must be JSON bytes or text, bounded nonempty and version3 with only root metadata',()=>{
  for(const raw of [undefined,{},new Uint8Array([123,125]),'',Buffer.alloc(Review.LIMITS.bytes+1,32)])invalid(()=>Review.validateLock(raw,manifest()));
  for(const change of [v=>{v.lockfileVersion=2;},v=>{v.requires=false;},v=>{v.dependencies={};},v=>{v.name='foreign';},v=>{v.version='1.0.0';},v=>{v.packages[''].scripts={};},v=>{v.packages[''].engines.node='24';},v=>{v.packages[''].dependencies['firebase-functions']='^7.3.0';},v=>{delete v.packages[''];}]){const v=fixture();change(v);invalid(()=>validate(v));}
});
test('registry tarballs cannot contain user credentials, query, fragment, redirect origin or noncanonical encoding',()=>{
  const unsafe=['http://registry.npmjs.org/protobufjs/-/protobufjs-7.5.4.tgz','https://registry.npmjs.org.evil.invalid/protobufjs/-/protobufjs-7.5.4.tgz','https://user:synthetic-password@registry.npmjs.org/protobufjs/-/protobufjs-7.5.4.tgz','https://registry.npmjs.org/protobufjs/-/protobufjs-7.5.4.tgz?token=synthetic','https://registry.npmjs.org/protobufjs/-/protobufjs-7.5.4.tgz#fragment','https://registry.npmjs.org:443/protobufjs/-/protobufjs-7.5.4.tgz','https://REGISTRY.NPMJS.ORG/protobufjs/-/protobufjs-7.5.4.tgz','https://registry.npmjs.org/%70rotobufjs/-/protobufjs-7.5.4.tgz','https://registry.npmjs.org/protobufjs/../protobufjs/-/protobufjs-7.5.4.tgz','git+https://github.com/synthetic/example.git','file:synthetic.tgz'];
  for(const resolved of unsafe){const v=fixture();v.packages['node_modules/protobufjs'].resolved=resolved;invalid(()=>validate(v));}
});
test('tarball name and concrete release are bound to their canonical package location',()=>{
  for(const version of ['^7.5.4','latest','07.5.4','7.05.4','7.5','7.5.4-01','7.5.4/foreign','7.5.4\n']){const v=fixture();v.packages['node_modules/protobufjs']=packageEntry('protobufjs',version);invalid(()=>validate(v));}
  const alias=fixture();alias.packages['node_modules/protobufjs'].resolved='https://registry.npmjs.org/other/-/other-7.5.4.tgz';invalid(()=>validate(alias));
  const direct=fixture();direct.packages['node_modules/firebase-admin']=packageEntry('firebase-admin','14.4.0',direct.packages['node_modules/firebase-admin']);direct.packages['node_modules/firebase-admin'].version='14.4.0';direct.packages['node_modules/firebase-admin'].resolved='https://registry.npmjs.org/firebase-admin/-/firebase-admin-14.4.0.tgz';invalid(()=>validate(direct));
  const prerelease=fixture();prerelease.packages['node_modules/protobufjs']=packageEntry('protobufjs','7.5.4-rc.1+build.01');assert.equal(validate(prerelease).packageCount,5);
});
test('every tarball requires a canonical single SHA512 integrity value',()=>{
  for(const integrity of [undefined,'sha1-'+Buffer.alloc(20).toString('base64'),'sha512-','sha512-'+Buffer.alloc(63).toString('base64'),'sha512-'+Buffer.alloc(64).toString('base64').replace(/=$/,''),'sha512-'+Buffer.alloc(64).toString('base64')+' sha512-'+Buffer.alloc(64).toString('base64')]){const v=fixture();if(integrity===undefined)delete v.packages['node_modules/protobufjs'].integrity;else v.packages['node_modules/protobufjs'].integrity=integrity;invalid(()=>validate(v));}
});
test('links, bundles, shrinkwrap, aliases, unknown descriptors and dev provenance are excluded',()=>{
  for(const extra of [{link:true},{inBundle:true},{hasShrinkwrap:true},{dev:true},{devOptional:true},{name:'renamed'},{unknown:true}]){const v=fixture();Object.assign(v.packages['node_modules/protobufjs'],extra);invalid(()=>validate(v));}
  for(const spec of ['file:../private','git+https://github.com/synthetic/example.git','https://registry.npmjs.org/other.tgz','npm:protobufjs@7.5.4','workspace:*','^7.2.2\n']){const v=fixture();v.packages['node_modules/firebase-functions'].dependencies.protobufjs=spec;invalid(()=>validate(v));}
});
test('path traversal, absolute paths, encoded names, scoped gaps and non-node_modules locations are refused',()=>{
  for(const name of ['../node_modules/protobufjs','/node_modules/protobufjs','node_modules/../protobufjs','node_modules\\protobufjs','vendor/protobufjs','node_modules/@types','node_modules/@types//node','node_modules/%70rotobufjs','node_modules/protobufjs/extra','node_modules/constructor']){const v=fixture();v.packages[name]=v.packages['node_modules/protobufjs'];delete v.packages['node_modules/protobufjs'];invalid(()=>validate(v));}
});
test('nested dependencies resolve locally while missing mandatory and unreferenced entries are rejected',()=>{
  const nested=fixture();nested.packages['node_modules/firebase-functions/node_modules/protobufjs']=nested.packages['node_modules/protobufjs'];delete nested.packages['node_modules/protobufjs'];assert.deepEqual(validate(nested).installScriptPackages,['protobufjs']);
  const missing=fixture();delete missing.packages['node_modules/@types/node'];invalid(()=>validate(missing));
  const foreign=fixture();foreign.packages['node_modules/unreferenced']=packageEntry('unreferenced','1.0.0');invalid(()=>validate(foreign));
  const peer=fixture();peer.packages['node_modules/firebase-functions'].peerDependenciesMeta['synthetic-uninstalled-peer'].optional=false;invalid(()=>validate(peer));
});
test('optional flags and peer metadata have strict boolean shape without inventing absent peers',()=>{
  for(const change of [p=>{p.optional='true';},p=>{p.hasInstallScript=1;},p=>{p.peer=null;},p=>{p.peerDependenciesMeta={'synthetic-unlisted':{optional:true}};},p=>{p.peerDependenciesMeta={'synthetic-uninstalled-peer':{optional:true,unknown:true}};}]){const v=fixture();change(v.packages['node_modules/firebase-functions']);invalid(()=>validate(v));}
});
test('dependency/package/string bounds reject amplification before a review result is produced',()=>{
  const huge=fixture();for(let i=0;i<Review.LIMITS.packages;i++)huge.packages['node_modules/synthetic-'+i]=packageEntry('synthetic-'+i,'1.0.0');invalid(()=>validate(huge));
  const str=fixture();str.packages['node_modules/protobufjs'].deprecated='a'.repeat(Review.LIMITS.string+1);invalid(()=>validate(str));
  const dependencies=fixture();dependencies.packages['node_modules/firebase-functions'].dependencies={};for(let i=0;i<513;i++)dependencies.packages['node_modules/firebase-functions'].dependencies['synthetic-'+i]='1.0.0';invalid(()=>validate(dependencies));
});
test('CLI accepts no caller paths or activation options and returns one fixed sanitized error',()=>{
  const filename=path.resolve(__dirname,'../server/deployment/validate-dependency-lock.cjs'),result=spawnSync(process.execPath,[filename,'../synthetic-private.json'],{encoding:'utf8'});assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr,'dependency_lock_validation_failed\n');assert.equal(result.stderr.includes('synthetic-private'),false);
});
