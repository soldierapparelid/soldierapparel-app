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
  ['legacy-lifecycle-page.js','0562d104bf8306a71ad415b8b557da5d8be1b9c778c83171a032f44cca4d1300'],
  ['legacy-owner-lifecycle-page.js','1f9d911406948d4b5c4dd67610f7cf9cc9000cf036a875db5985479712880702'],
  ['owner-access-management-codec.js','29eb5a15a1251ce35b01a7a5479281215ff208105948b188d0c86556d6dbfb7a'],
  ['owner-access-management-client.js','7fa1daecdc88c482b69b6e5bb2aafd1c3f3e731a6b8d54ecc8494ad0981ae3b2'],
  ['production-revision-sync.js','569c4b75b6963e4ecac390ae387275310913b7cf8488c76024428bccfe37c395'],
  ['apps-script-production-bootstrap.js','9ccc6a7b5ea663421d5d2042f2bd36034f02ffe4c52da48326c2c871f84895c9'],
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
// The owner landing page is a public navigation menu. Only an explicit choice
// opens an existing authenticated module or starts the advanced workbench.
const OWNER_MENU=Object.freeze([
  ['potong','Divisi Potong','cutting'],['jahit','Divisi Jahit','sewing'],['qc','QC & Inspeksi','quality'],['laporan','Laporan Produksi','production'],
  ['stok','Stok Bahan','materials'],['gaji','Gaji Harian','payroll'],['hpp','HPP Produksi','hpp'],['pembelian','Pembelian Produk','purchase'],['nota','Nota Penjualan','invoice'],['retur','Retur Produk','returns']
].map(row=>Object.freeze(row)));
const OWNER_ICONS=Object.freeze({
  cutting:'<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8.3 7.9 12.2 12.6M8.3 16.1 20.5 3.5M14.5 14l6 3.5M14.5 10l6-3.5"/>',
  sewing:'<path d="M3 8h12a5 5 0 0 1 5 5v5h-6v-5H8v1H3V8ZM5.5 14v3M10 8V4h4v4M9 4h6M2 18h20v3H2zM17 11v2"/>',
  quality:'<path d="m12 3 8 3v6c0 4-3.5 7.5-8 9-4.5-1.5-8-5-8-9V6l8-3Z"/><path d="m8 12 2.5 2.5L16 9"/>',
  production:'<path d="M8 4H7a3 3 0 0 0-3 3v11a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3h-1"/><rect x="8" y="2" width="8" height="4" rx="1.5"/><path d="M8 17v-3m4 3v-7m4 7v-5"/>',
  materials:'<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm-8 4.5 8 4.5 8-4.5M12 12v9M8 5.25l8 4.5V13"/>',
  payroll:'<path d="M3 9V6a2 2 0 0 1 2-2h12v3M5 7h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/><path d="M21 12h-5a2 2 0 0 0 0 4h5M16 14h.1M7 11h3"/>',
  hpp:'<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M8.5 7h7M8.5 11h1m5 0h1m-7 4h1m-1 3h1M15 15v3"/>',
  purchase:'<path d="M3 3h2l2.5 12h11L21 7H6M10 7V5a3 3 0 0 1 6 0v2"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
  invoice:'<path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3ZM9 7h6M9 11h6M9 15h2m3 0h1"/>',
  returns:'<path d="M8 6H5V3M5 6a8 8 0 1 1-1 10m7-8 4 2.2v4.6L12 17l-4-2.2v-4.6L12 8Zm-4 2.2 4 2.3 4-2.3M12 12.5V17"/>'
});
const OWNER_HOME_STYLE=`
body.soldier-owner-home{margin:0;min-height:100vh;padding:30px 20px 36px;color:#f1f6f8;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background-color:#11191d;background-image:linear-gradient(#86e3c309 1px,transparent 1px),linear-gradient(90deg,#86e3c309 1px,transparent 1px),radial-gradient(circle at 50% -20%,#86e3c321,transparent 50%);background-size:30px 30px,30px 30px,100% 100%}
.soldier-owner-home [hidden]{display:none!important}.soldier-owner-menu{max-width:600px;margin:auto}.soldier-owner-brand{text-align:center;margin-bottom:24px}.soldier-owner-logo{width:80px;height:80px;background:#fff;border:2px solid #86e3c366;border-radius:50%;box-shadow:0 0 0 7px #86e3c30b;margin-bottom:14px}.soldier-owner-brand h1{color:#86e3c3;font-size:clamp(26px,6vw,32px);letter-spacing:2px;margin:0 0 9px;text-transform:uppercase;line-height:1.25}.soldier-owner-badge{display:inline-block;margin:0;padding:4px 15px;border-radius:24px;color:#bdc9d6;background:#0008;font-size:14px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase}.soldier-owner-help{text-align:center;color:#c0cdd2;margin:0 0 24px;font-size:15px}
.soldier-owner-tabs{display:flex;gap:5px;padding:5px;border:1px solid #425860;border-radius:16px;background:#152127;margin-bottom:22px}.soldier-owner-tab{flex:1;min-width:0;min-height:56px;padding:12px;font:800 18px system-ui,sans-serif;letter-spacing:1px;text-transform:uppercase;border:0;border-radius:12px;color:#bdc9d6;background:transparent;cursor:pointer}.soldier-owner-tab[aria-selected="true"]{background:#86e3c3;color:#102c24}.soldier-owner-menu h2{font-size:15px;text-transform:uppercase;letter-spacing:1px;color:#bdc9c0;margin:0 0 14px}.soldier-owner-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px}.soldier-owner-card{display:flex;min-width:0;min-height:168px;flex-direction:column;align-items:center;justify-content:center;gap:17px;padding:22px 12px;border:1px solid #47616c;border-radius:22px;color:#f1f6f8;text-decoration:none;background:linear-gradient(145deg,#1e2c33f5,#172329f5);box-shadow:0 8px 20px #0003;text-align:center;font-size:19px;font-weight:800;line-height:1.35;overflow-wrap:anywhere}.soldier-owner-card:hover{background:#263941;border-color:#86e3c3}.soldier-owner-icon{display:grid;place-items:center;width:64px;height:64px;border-radius:18px;background:#86e3c315;color:#86e3c3;border:1px solid #86e3c330}.soldier-owner-icon.sewing,.soldier-owner-icon.invoice{background:#96caff15;border-color:#96caff30;color:#96caff}.soldier-owner-icon.quality,.soldier-owner-icon.returns{background:#c5b4ff15;border-color:#c5b4ff30;color:#c5b4ff}.soldier-owner-icon.production,.soldier-owner-icon.hpp{background:#efd49a15;border-color:#efd49a30;color:#efd49a}.soldier-owner-icon svg{width:38px;height:38px;fill:none;stroke:currentColor;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round}
.soldier-owner-settings{margin:28px 0 0;padding-top:22px;border-top:1px solid #344a52;text-align:center}.soldier-owner-settings p{color:#a9bebc;font-size:14px;margin:9px 0 0}.soldier-owner-secondary{min-height:48px;padding:11px 18px;border:1px solid #527069;border-radius:12px;background:#152127;color:#d4e4df;font:600 15px system-ui,sans-serif;cursor:pointer}.soldier-owner-secondary:hover{border-color:#86e3c3;color:#86e3c3}.soldier-owner-workbench{max-width:1200px;margin:auto}.soldier-owner-workbench>header{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:16px}.soldier-owner-workbench>header h1{font-size:21px;color:#86e3c3;margin:0}.soldier-owner-home :focus-visible{outline:3px solid #86e3c3;outline-offset:4px}
@media(max-width:600px){body.soldier-owner-home{padding:24px 14px}.soldier-owner-card{min-height:152px;font-size:17px;padding:18px 10px;gap:13px}.soldier-owner-grid{gap:12px}.soldier-owner-icon{width:58px;height:58px}.soldier-owner-brand{margin-bottom:20px}.soldier-owner-home #soldier-script-host{padding:0}}
@media(max-width:360px){.soldier-owner-card{font-size:16px;min-height:144px}.soldier-owner-tab{font-size:16px}.soldier-owner-brand h1{font-size:25px}}
`;
function ownerHome(configuration){
  const card=([module,label,icon])=>'<a class="soldier-owner-card" href="'+configuration.deploymentURL+(module==='qc'?'?division=qc':'?division=owner&amp;ownerModule='+module)+'" target="_top"><span class="soldier-owner-icon '+icon+'"><svg viewBox="0 0 24 24" aria-hidden="true">'+OWNER_ICONS[icon]+'</svg></span><span>'+label.replace(/&/g,'&amp;')+'</span></a>';
  return '<main><section class="soldier-owner-menu" id="soldier-owner-menu" aria-label="Menu aplikasi owner"><header class="soldier-owner-brand"><img class="soldier-owner-logo" src="https://soldierapparelid.github.io/soldierapparel-app/logo-elang.png" alt="Logo Soldier Apparel" width="80" height="80"><h1>Soldier Apparel</h1><p class="soldier-owner-badge">Command Center · Owner</p></header><p class="soldier-owner-help">Pilih menu kerja seperti biasa.<br>Masuk dengan akun Google owner saat diminta.</p><div class="soldier-owner-tabs" role="tablist" aria-label="Kategori aplikasi"><button class="soldier-owner-tab" type="button" id="soldier-owner-tab-0" role="tab" aria-selected="true" aria-controls="soldier-owner-panel-0" tabindex="0">Produksi</button><button class="soldier-owner-tab" type="button" id="soldier-owner-tab-1" role="tab" aria-selected="false" aria-controls="soldier-owner-panel-1" tabindex="-1">Admin</button></div><section id="soldier-owner-panel-0" role="tabpanel" aria-labelledby="soldier-owner-tab-0"><h2>Akses Produksi</h2><div class="soldier-owner-grid">'+OWNER_MENU.slice(0,4).map(card).join('')+'</div></section><section id="soldier-owner-panel-1" role="tabpanel" aria-labelledby="soldier-owner-tab-1" hidden><h2>Akses Admin</h2><div class="soldier-owner-grid">'+OWNER_MENU.slice(4).map(card).join('')+'</div></section><div class="soldier-owner-settings"><button class="soldier-owner-secondary" type="button" id="soldier-owner-settings" aria-controls="soldier-owner-workbench" aria-expanded="false">Pengaturan produksi dan akses</button><p>Penugasan, koreksi produksi, dan izin mitra.</p></div></section><section class="soldier-owner-workbench" id="soldier-owner-workbench" aria-label="Pengaturan produksi dan akses" hidden><header><button class="soldier-owner-secondary" type="button" id="soldier-owner-back">← Kembali ke menu</button><h1>Pengaturan produksi dan akses</h1></header><section id="soldier-script-host" aria-live="polite"><p>Memeriksa halaman Soldier…</p></section></section></main>';
}
function ownerHomeStart(start){
  return `(function(){
  const menu=document.getElementById('soldier-owner-menu'),workbench=document.getElementById('soldier-owner-workbench'),open=document.getElementById('soldier-owner-settings'),back=document.getElementById('soldier-owner-back');
  let started=false;
  function selectTab(index){for(let i=0;i<2;i++){const tab=document.getElementById('soldier-owner-tab-'+i);tab.setAttribute('aria-selected',String(i===index));tab.tabIndex=i===index?0:-1;document.getElementById('soldier-owner-panel-'+i).hidden=i!==index;}}
  for(let i=0;i<2;i++){const tab=document.getElementById('soldier-owner-tab-'+i);tab.addEventListener('click',()=>selectTab(i));tab.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight'||event.key==='ArrowLeft')next=1-i;else if(event.key==='Home')next=0;else if(event.key==='End')next=1;else return;event.preventDefault();selectTab(next);document.getElementById('soldier-owner-tab-'+next).focus();});}
  open.addEventListener('click',()=>{menu.hidden=true;workbench.hidden=false;open.setAttribute('aria-expanded','true');back.focus();if(started)return;started=true;${start}});
  back.addEventListener('click',()=>{workbench.hidden=true;menu.hidden=false;open.setAttribute('aria-expanded','false');open.focus();});
})();`;
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
  const ownerMenu=options.module==='owner'&&configuration.enabled;
  const html='<!doctype html>\n<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_top"><title>Soldier Apparel</title><style>\n'+sources.get('legacy-lifecycle-page.css')+'\n#soldier-script-host{max-width:1200px;margin:auto;padding:24px}#soldier-script-login,#soldier-script-logout,#soldier-script-reload,#soldier-script-open-owner-access{padding:12px 20px;border-radius:12px;cursor:pointer}\n#soldier-script-reload{display:inline-block;text-decoration:none;border:1px solid #8bcdb9;color:#e6efed;background:#193138;margin-right:10px}\n'+(ownerMenu?OWNER_HOME_STYLE:'')+'</style></head><body'+(ownerMenu?' class="soldier-owner-home"':'')+'>'+(ownerMenu?ownerHome(configuration):'<main id="soldier-script-host" aria-live="polite"><p>Memeriksa halaman Soldier…</p></main>')+'\n'+scripts+'\n<script>\n'+(ownerMenu?ownerHomeStart(start):start)+'\n</script></body></html>\n';
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
