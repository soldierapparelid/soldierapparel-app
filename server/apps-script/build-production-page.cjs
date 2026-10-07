'use strict';
// Offline HtmlService page assembly. No credentials, service initialization,
// deployment, enrollment, database reads or writes occur here.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const Pure=require('./build-pure-bundle.cjs'),Bootstrap=require('../../apps-script-production-bootstrap.js');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.resolve(ROOT,'../apps-script-prepared');
const hash=v=>crypto.createHash('sha256').update(v,'utf8').digest('hex'),fail=()=>{throw Error('production_page_rejected');};
const rows=Object.freeze([
  ['production-command-client.js','fb9864fcef740658041c30a1cea7ca79fb11b7e71bc194ca93d02c7614dd1426'],
  ['production-command-store.js','c290cfaf91a59950ab652120f33b486df1386693578f26b03f01349bcf13e0e3'],
  ['legacy-view-client.js','dcce2c377a5f546ac1c3fbe1e1451698e517c4092f06598a11cb7dbf2f5c756d'],
  ['legacy-lifecycle-client.js','0d9c3995e32d8a3a01c8e32a5ad38b95619dfffa45ff1d02bec7fbe6b61116c7'],
  ['legacy-owner-lifecycle-client.js','ff94816566b72a7ea7d92998aa4e1c00acb760eaec74814a7a0de06b8b95ea43'],
  ['apps-script-native-reply.js','815d1f1c9a95cfcc145935c1fdbfc37c3d367c5cf6b1e131b053ebbc4135a1ab'],
  ['apps-script-lifecycle-bridge.js','1830959ff9b425b884c52875b7ebbe488a2c2b3a92a66b3a3c419a3b2b210ae0'],
  ['apps-script-owner-lifecycle-bridge.js','b3c0cb66394a20ecd1746c72d1c66e3ac8c9f3b457ad7b945b2371e8c5419854'],
  ['legacy-lifecycle-controller.js','e1698885a647dc9fd885d2389e8a5cfa9581e15a1c4342c4c292cc8158a8efab'],
  ['legacy-owner-lifecycle-controller.js','8b53c64a8dd728be28ba24bd1c25b33f78ebba106c8c24d253f340df894b1109'],
  ['legacy-lifecycle-page.js','48074da4e238760318d4d9e0d1c0987916356e65ee4b1dda4cb89fb053d18291'],
  ['legacy-owner-lifecycle-page.js','1f9d911406948d4b5c4dd67610f7cf9cc9000cf036a875db5985479712880702'],
  ['owner-access-management-codec.js','29eb5a15a1251ce35b01a7a5479281215ff208105948b188d0c86556d6dbfb7a'],
  ['owner-access-management-client.js','7fa1daecdc88c482b69b6e5bb2aafd1c3f3e731a6b8d54ecc8494ad0981ae3b2'],
  ['apps-script-production-bootstrap.js','b6abaf86ef5db9983219f329b36f8a356d9e9858abc6909c92f0fa6faff811ef'],
  ['legacy-lifecycle-page.css','5bbb6e231f2f9f632a06c927a2e1b43b30cadfd5c89e55acd066f8f3e1d93290']
].map(([file,sha256])=>Object.freeze({file,sha256})));
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return d?.enumerable&&Object.hasOwn(d,'value');});
function publicConfiguration(v){
  const keys=Object.keys(Bootstrap.DEFAULT_CONFIGURATION);if(!exact(v,keys)||typeof v.enabled!=='boolean'||keys.slice(1).some(k=>typeof v[k]!=='string'))fail();
  if(!v.enabled){if(keys.slice(1).some(k=>v[k]!==''))fail();return Bootstrap.DEFAULT_CONFIGURATION;}
  if(!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(v.projectId)||!/^[A-Za-z_-][A-Za-z0-9_-]{0,127}$/.test(v.tenantId)||['__proto__','constructor','prototype'].includes(v.tenantId)||v.authDomain!==v.projectId+'.firebaseapp.com'||!/^[A-Za-z0-9_-]{20,128}$/.test(v.apiKey)||!/^https:\/\/([a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app)$/.test(v.databaseURL)||!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/(?:exec|dev)$/.test(v.deploymentURL))fail();
  return Object.freeze({...v});
}
function reviewedSource(file,raw){
  const row=rows.find(r=>r.file===file);if(!row||typeof raw!=='string')fail();const source=raw.replace(/\r\n/g,'\n');
  if(Buffer.byteLength(source,'utf8')>128*1024||hash(source)!==row.sha256||/<\/script|<\/style|<\?/.test(source))fail();
  if(file.endsWith('.js'))new vm.Script(source,{filename:file});return source;
}
function createPage(options={module:'owner'}){
  const hasConfiguration=Object.hasOwn(options,'configuration');if(!exact(options,hasConfiguration?['module','configuration']:['module'])||!['owner','qc','jahit'].includes(options.module))fail();
  const configuration=publicConfiguration(hasConfiguration?options.configuration:Bootstrap.DEFAULT_CONFIGURATION),sources=new Map();
  for(const row of rows){const absolute=path.resolve(ROOT,row.file);if(!absolute.startsWith(ROOT+path.sep))fail();Pure.noLinks(absolute);if(!fs.lstatSync(absolute).isFile())fail();sources.set(row.file,reviewedSource(row.file,fs.readFileSync(absolute,'utf8')));Pure.noLinks(absolute);}
  const file='apps-script-production-bootstrap.js';
  // Match the exact SOURCE-OFF literal. Never use a template or client query
  // string to select configuration, credentials, identity, role or worker.
  const literal="/* SOLDIER_REVIEWED_PUBLIC_CONFIGURATION */Object.freeze({enabled:false,projectId:'',databaseURL:'',tenantId:'',deploymentURL:'',apiKey:'',authDomain:''})";
  const bootstrap=sources.get(file);if(bootstrap.split(literal).length!==2)fail();
  const changed=bootstrap.replace(literal,'Object.freeze('+JSON.stringify(configuration)+')');new vm.Script(changed,{filename:file});sources.set(file,changed);
  const scripts=rows.filter(r=>r.file.endsWith('.js')).map(r=>'<script>\n'+sources.get(r.file)+'\n</script>').join('\n');
  const start="SoldierAppsScriptProductionBootstrap.start({module:"+JSON.stringify(options.module)+",document,host:document.getElementById('soldier-script-host')}).then(result=>{if(!result.ok&&result.error==='service_disabled'){const p=document.createElement('p');p.textContent='Halaman ini sedang disiapkan dan belum diaktifkan.';document.getElementById('soldier-script-host').replaceChildren(p);}});";
  const html='<!doctype html>\n<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_top"><title>Soldier Apparel</title><style>\n'+sources.get('legacy-lifecycle-page.css')+'\n#soldier-script-host{max-width:1200px;margin:auto;padding:24px}#soldier-script-login,#soldier-script-logout,#soldier-script-reload,#soldier-script-open-owner-access{padding:12px 20px;border-radius:12px;cursor:pointer}\n#soldier-script-reload{display:inline-block;text-decoration:none;border:1px solid #8bcdb9;color:#e6efed;background:#193138;margin-right:10px}\n</style></head><body><main id="soldier-script-host" aria-live="polite"><p>Memeriksa halaman Soldier…</p></main>\n'+scripts+'\n<script>\n'+start+'\n</script></body></html>\n';
  if(Buffer.byteLength(html,'utf8')>1024*1024)fail();
  return Object.freeze({html,metadata:Object.freeze({schemaVersion:1,module:options.module,sourceOff:!configuration.enabled,pageSha256:hash(html),modules:rows})});
}
function buildPrepared(){
  const pages=['owner','qc','jahit'].map(module=>createPage({module}));Pure.noLinks(OUT,true);fs.mkdirSync(OUT,{recursive:true});Pure.noLinks(OUT);const directory=path.join(OUT,crypto.randomUUID());Pure.noLinks(directory,true);fs.mkdirSync(directory);Pure.noLinks(directory);
  for(const page of pages)fs.writeFileSync(path.join(directory,page.metadata.module+'.html'),page.html,{encoding:'utf8',flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(directory,'production-pages-manifest.json'),JSON.stringify(pages.map(p=>p.metadata),null,2)+'\n',{encoding:'utf8',flag:'wx',mode:0o600});return Object.freeze({directory,pages:pages.map(p=>({module:p.metadata.module,sha256:p.metadata.pageSha256})),sourceOff:true});
}
module.exports=Object.freeze({createPage,buildPrepared,reviewedSource,rows});
if(require.main===module){if(process.argv.length!==2)fail();process.stdout.write(JSON.stringify(buildPrepared())+'\n');}
