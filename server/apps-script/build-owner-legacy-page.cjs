'use strict';
// Offline, SOURCE-OFF HtmlService assembly of the existing owner pages. Only
// exact pinned repository assets are accepted. No hosts, credentials or data.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const Pure=require('./build-pure-bundle.cjs'),Bootstrap=require('../../apps-script-owner-legacy-bootstrap.js'),LegacySource=require('./legacy-page-source.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.resolve(ROOT,'../apps-script-prepared');
const PAGES=Object.freeze({potong:'potong-command.html',stok:'stok-bahan-command.html',gaji:'gaji-harian-command.html',hpp:'hpp-command-v1.html',pembelian:'pembelian-produk-v1.html',laporan:'laporan-produksi.html',nota:'nota-penjualan.html',retur:'retur-command.html',jahit:'jahit-command.html'});
const rows=Object.freeze([
  {
    "file": "potong-command.html",
    "sha256": "891baf9fef69fbcae818f52c543ae2a57d0866d2fc8ba1608c52f7e20191fdfb"
  },
  {
    "file": "stok-bahan-command.html",
    "sha256": "eb9e7a7edd2a22b2e12ea9f60a975f5db649570d7308f8afb65a3994a40601af"
  },
  {
    "file": "gaji-harian-command.html",
    "sha256": "125f54b1f3339512c4f20f9321f321a801cd637865013de6d6b4fe86b9894ea3"
  },
  {
    "file": "hpp-command-v1.html",
    "sha256": "d896c1ab444ee5c7c62c1e2a81f2127f6e05c4ea87e867dba640f4f4d05eaa24"
  },
  {
    "file": "pembelian-produk-v1.html",
    "sha256": "bd99249bda5893143067d772a79b460503de9e4093138c6daddef269960d6559"
  },
  {
    "file": "laporan-produksi.html",
    "sha256": "933721f4de65f6e8e2811f04ccd5417e411dcc785d6099a6a22a4205183877e2"
  },
  {
    "file": "nota-penjualan.html",
    "sha256": "b1fa962ead40b4ee0c8d3e3f8ddf5f8c45287bbd114116a230c6b01ba1c02110"
  },
  {
    "file": "retur-command.html",
    "sha256": "dd8519f9dc7bc9d2261b18182dae2d45968040f37b3fca95eae666a1ed106db7"
  },
  {
    "file": "jahit-command.html",
    "sha256": "5de2fc5933cfda115ee12f6e762b98fbc5f2e1e594488c66f91035b5ff2eb554"
  },
  {
    "file": "account-storage.js",
    "sha256": "307cb0d284f089f9a3cf0fa83e9d467ba57c5e24e3a557f53d2da14b942ead51"
  },
  {
    "file": "app-branding.css",
    "sha256": "1edb9db08be6629daad19489c15bdfe8c2fc3df15d364a9b998b513ef22ef495"
  },
  {
    "file": "app-sync-journal.js",
    "sha256": "f1f171d728509825371cc1de49f12cce366af210143cfd5da93eaad27541d26b"
  },
  {
    "file": "app-sync-storage.js",
    "sha256": "ae895096ec150200682a8d38fd2dab88b5d9285bcdaf7ecde0af6de279e2bfcc"
  },
  {
    "file": "cutting-plan-admin.css",
    "sha256": "4750b897c24c9b48a1e4d1f9f4f9cc01c90de33b9aacde85ad713d06ae2f365b"
  },
  {
    "file": "cutting-plan-admin.js",
    "sha256": "45629bd7a0f59612b86708c8f55747147ecf85649e8471b49c7c7ff3eda9acb8"
  },
  {
    "file": "cutting-plan-reconcile.js",
    "sha256": "95300e52b70197480a4e7a7879d4e0ac07f89bd25e48538ae503d923ee3164a2"
  },
  {
    "file": "cutting-plan-transaction.js",
    "sha256": "a51ed03d943b2054c8fcfeb897cab1726f411a6a92b113389122f6da70def430"
  },
  {
    "file": "cutting-plan-worker.css",
    "sha256": "ad6f1705d2c2692f6b5c4e759c8067b63ea8d162d81526d5a4dbefa06043b8c0"
  },
  {
    "file": "cutting-plan-worker.js",
    "sha256": "8798805942c6cac9b88520c92fc854e3dd62599c97d0ede9eb59b933b5da713c"
  },
  {
    "file": "cutting-plan.js",
    "sha256": "0ad28a081ce15cf6321b66d9693dc95a53891b97082b2a81d0ee055eee87f954"
  },
  {
    "file": "hpp-model-cost.js",
    "sha256": "ec3cb00312739591c35328e8242f0c5ae78db2e1b27638b566d1597b2f003767"
  },
  {
    "file": "hpp-model-ui.js",
    "sha256": "99c01614ec8c29ee9819f013107185c21c4fdfd8d9790ccdb27e74a4c986752d"
  },
  {
    "file": "hpp-model.css",
    "sha256": "5fc2e84519b88cda612c9b888a6267d4e1d7f20788b05668717fce6f86138666"
  },
  {
    "file": "hpp-price.js",
    "sha256": "7d12cf366f037baabe4111701f9b0b452208723a46070ad6075715021fe6d88e"
  },
  {
    "file": "laporan-layout.css",
    "sha256": "c1d010bc856634a99e24b78cf0b9dfebb9924f5afabf60dffcf70854ad0cc248"
  },
  {
    "file": "laporan-recovery.js",
    "sha256": "8737afc83ff55f1d355f16b518bbe21c8ccdef3e5574dd5bf6efd51a8311ef49"
  },
  {
    "file": "mobile-friendly.css",
    "sha256": "2789f6bb8500956772fd7032180d5f86d1e41eeee7edbe73cee7a7798f18bd42"
  },
  {
    "file": "production-command-client.js",
    "sha256": "fb9864fcef740658041c30a1cea7ca79fb11b7e71bc194ca93d02c7614dd1426"
  },
  {
    "file": "production-command-store.js",
    "sha256": "c290cfaf91a59950ab652120f33b486df1386693578f26b03f01349bcf13e0e3"
  },
  {
    "file": "production-history-import.js",
    "sha256": "b42336cacc8cc9046b48cf65739345dc44d79d3ce78c29e73b7cd6c170764d82"
  },
  {
    "file": "production-journal.js",
    "sha256": "a15bcf1e5f88a3452ad13a142ab0637b879ca8486d02b3a5c752e79e746a221d"
  },
  {
    "file": "production-materials.js",
    "sha256": "4f5bad7c69adfd7bc2adee71e7374d96e0726481caa39c6a489b3805a80174c4"
  },
  {
    "file": "production-payroll.js",
    "sha256": "3e332ba21f47aea1861841a86a05d23353818dcb73d5a1bd0545d8adedb19a72"
  },
  {
    "file": "production-recovery.css",
    "sha256": "6f2e3e04cc36216fd2db187d576413b787e22feb878fc3a76b989ef3cec86216"
  },
  {
    "file": "production-recovery.js",
    "sha256": "ba87fc451e5e89aefdc5b577fae573b2ecda4bdcd84b0110b5ef9200822eadda"
  },
  {
    "file": "production-status.js",
    "sha256": "0559c2b8880c7b49de64b16b6010a1d8a602ffbb99f1c797bcd0883c95effcd1"
  },
  {
    "file": "production-sync.js",
    "sha256": "35259f3a013ab73fb79e7752fb93f933b35d44c835c57a1ef97993862a6dbf41"
  },
  {
    "file": "production-ui.css",
    "sha256": "cea5e36c163a92ad39f6fa9b27a42f8292d8c7cf58fe80dae59f00a2a3589050"
  },
  {
    "file": "production-workflow.js",
    "sha256": "32a3709435dde95407c837ea40b1d94074a1fbe06372a15b4acbb6d9869bd718"
  },
  {
    "file": "roas-advisor.js",
    "sha256": "03ac3452e9380912d152cd6f3300688874be5c08f35e1bb713b70a0065814d0a"
  },
  {
    "file": "roas-csv.js",
    "sha256": "3d7148eaedf76ad22dcc8a7852efebf4784168e5fcf011cfc6cc119c6b646472"
  },
  {
    "file": "roas-ui.css",
    "sha256": "8d5ea00e7bdafc7f7445cdb31e4b6f51eb35e25692318f7d2e946846c02629d9"
  },
  {
    "file": "roas-ui.js",
    "sha256": "144048e224b31bec8933e3bcb942ff43f6c62c71781a833fc9e1e2d0ccde30ed"
  },
  {
    "file": "slip-document.css",
    "sha256": "bd253619411cefe5fa31222729a3176304dea9c8a5e437ddd95882892fb72aa7"
  },
  {
    "file": "slip-document.js",
    "sha256": "f7ea323d02f581c042b4d0824e235f7428105eb87aaca067b8cadc392c52f1ca"
  },
  {
    "file": "stock-roll-repair-transaction.js",
    "sha256": "0c528ff3e2a0fe602b0d89dbac07190bddf16349149ad8726bccb635cb3bafcd"
  },
  {
    "file": "stock-roll-repair-ui.js",
    "sha256": "99ea8c8c070ca3db5c93097ca94f2d8b7ac7d0a5e1889a7537579159d14ace5f"
  },
  {
    "file": "stock-roll-repair.css",
    "sha256": "42982fc0ec27e3f30f5569edffcd7065906648c3451cb6fcacebf2fb1c34f94d"
  },
  {
    "file": "stock-roll-repair.js",
    "sha256": "8c19cf69eeb4998a45833ece91bbb09edfc633405e0613180505a2a93306fce0"
  },
  {
    "file": "stok-bahan-modern.css",
    "sha256": "18b9b5fac40576e860458e0a7966cb1f7d962aa266731305ac6ccecd9cd7299b"
  },
  {
    "file": "stok-purchase-material.js",
    "sha256": "ba5081384085739f98b3e1b464b0200367a2c3c2038a268a80f85715fbf5e087"
  },
  {
    "file": "brand-mark.svg",
    "sha256": "8481c2e9709784d7ce392ad1f830707fed62d257b34936cb60cad34817ce1c92"
  },
  {
    "file": "apps-script-owner-legacy-bootstrap.js",
    "sha256": "a4e07f70889ba0659df585802d86f7d5f3e6201e3ff8e85fbedb04da9c31a4db"
  },
  {
    "file": "owner-business-storage-codec.js",
    "sha256": "58b3ac5bb9465205d1a59b7557c1b61477fd0b3d99cbc63b47e6d0226aa57924"
  },
  {
    "file": "owner-business-storage-journal.js",
    "sha256": "b4b04d59d9be9208300d13391255c30851d199d6afdaa236cbcae8c958639f6a"
  },
  {
    "file": "owner-business-storage-client.js",
    "sha256": "13f7368ec553315dcf6d4ed9bfcf747985d8d91ded5204ed75986843caa3230c"
  },
  {
    "file": "owner-production-photos-codec.js",
    "sha256": "e4cdf6bd7a6bfe7e0f7cf138cf62aff0b8a8e4c240ef0c485b803c7dcb5b4918"
  },
  {
    "file": "owner-production-photos-client.js",
    "sha256": "456c8e94f7077aa876425708891c3c56ca24dab06314a5c71cd61938386e6a5d"
  }
, {"file":"app-icons.svg","sha256":"bb030cb8d8ba7f62f644f3101926fd0bfed0a88f161f2df2cc05df2d7b01e7b0"}].map(row=>Object.freeze(row)));
const hash=raw=>crypto.createHash('sha256').update(raw,'utf8').digest('hex'),fail=()=>{throw Error('owner_legacy_page_rejected');};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return d?.enumerable&&Object.hasOwn(d,'value');});
const json=v=>JSON.stringify(v).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const CONFIG_LITERAL="/* SOLDIER_OWNER_REVIEWED_CONFIGURATION */Object.freeze({enabled:false,photosEnabled:false,projectId:'',databaseURL:'',tenantId:'',deploymentURL:'',apiKey:'',authDomain:''})";
const CHILD_LITERAL="/* SOLDIER_OWNER_REVIEWED_CHILD */''";
function publicConfiguration(raw){
  if(!exact(raw,Object.keys(Bootstrap.DEFAULT_CONFIGURATION))||typeof raw.enabled!=='boolean'||typeof raw.photosEnabled!=='boolean')fail();
  if(!raw.enabled){if(raw.photosEnabled||Object.keys(raw).slice(2).some(k=>raw[k]!==''))fail();return Bootstrap.DEFAULT_CONFIGURATION;}
  try{return Bootstrap.configuration(raw);}catch{fail();}
}
function reviewedSource(file,raw){
  const row=rows.find(r=>r.file===file);if(!row||typeof raw!=='string')fail();const text=raw.replace(/\r\n/g,'\n');
  if(Buffer.byteLength(text,'utf8')>512*1024||hash(text)!==row.sha256||/<\?/.test(text))fail();
  if(file.endsWith('.js'))new vm.Script(text,{filename:file});return text;
}
function read(file){
  // Root HTML becomes an SDK-free redirect at cutover. Never reconstruct the
  // owner UI from those entry points or fall back to them if a template drifts.
  if(Object.values(PAGES).includes(file))return reviewedSource(file,LegacySource.readLegacyPageSource(file));
  if(!rows.some(r=>r.file===file))fail();const target=path.resolve(ROOT,file);if(!target.startsWith(ROOT+path.sep))fail();Pure.noLinks(target);if(!fs.lstatSync(target).isFile())fail();const source=reviewedSource(file,fs.readFileSync(target,'utf8'));Pure.noLinks(target);return source;
}
// Exact source pins fence these narrow, top-level function boundaries. A changed
// page fails its source review before any transformation can select a boundary.
function replaceFunction(source,name,body){
  const expression=new RegExp('(?:async )?function '+name+'\\([^\\n]*\\)\\{[\\s\\S]*?\\n\\}', 'g');
  const matches=[...source.matchAll(expression)];if(matches.length!==1)fail();return source.replace(expression,body);
}
function once(source,from,to){if(source.split(from).length!==2)fail();return source.replace(from,to);}
function legacyScript(source,module){
  if(['potong','stok','gaji','hpp','laporan','jahit'].includes(module)){
    source=replaceFunction(source,'loadFirebaseSDK',"async function loadFirebaseSDK(){\n  if(!window.__firebase)throw new Error('Sambungan owner belum siap.');\n}");
  }
  if(['potong','stok','gaji','laporan','jahit'].includes(module)){
    const pattern=/function fbLoad\(\)\{[^\n]*\}/g;if([...source.matchAll(pattern)].length!==1)fail();
    source=source.replace(pattern,"function fbLoad(){const c=window.SoldierOwnerLegacyConfiguration;Object.assign(FB,{apiKey:c.apiKey,dbUrl:c.databaseURL,projectId:c.projectId});}");
    const save=/function fbSave\(\)\{[^\n]*\}/g;if([...source.matchAll(save)].length!==1)fail();source=source.replace(save,'function fbSave(){}');
  }
  if(module==='hpp'){
    source=replaceFunction(source,'loadFbConfig',"function loadFbConfig(){\n const c=window.SoldierOwnerLegacyConfiguration;return {apiKey:c.apiKey,databaseURL:c.databaseURL,projectId:c.projectId};\n}");
    source=replaceFunction(source,'saveFbConfig',"function saveFbConfig(cfg){\n window.SoldierAccessPolicy.config(cfg);\n}");
  }
  if(module==='pembelian'){
    source=replaceFunction(source,'getFbConfig',"function getFbConfig(){\n const c=window.SoldierOwnerLegacyConfiguration;return {apiKey:c.apiKey,dbUrl:c.databaseURL,projectId:c.projectId};\n}");
    source=replaceFunction(source,'saveFbConfig',"function saveFbConfig(cfg){\n window.SoldierAccessPolicy.config(cfg);\n}");
    source=replaceFunction(source,'loadScript',"function loadScript(src){\n return Promise.reject(new Error('Modul tambahan belum tersedia pada halaman terlindungi.'));\n}");
    // Its optional image-download loader cannot contact an external CDN. The
    // original print/export controls remain; unsupported export fails visibly.
    source=once(source,"s.src='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';","s.textContent=\"window.html2canvas=()=>Promise.reject(new Error('Ekspor gambar belum tersedia; gunakan cetak.'));\";");
  }
  if(module==='potong'){
    const start='// v32: Auto-expire tombstone > 3 hari (biar ga nyangkut selamanya)';
    const end='function renderAll(){';const a=source.indexOf(start),b=source.indexOf(end,a);if(a<0||b<0)fail();
    source=source.slice(0,a)+'// Tombstones and retained drafts are not expired by this protected wrapper.\n'+source.slice(b);
    const destructive=/window\.nukePotongCache = function\(\)\{[\s\S]*?\n\};/g;if([...source.matchAll(destructive)].length!==1)fail();source=source.replace(destructive,"window.nukePotongCache=function(){alert('Draf lama tetap disimpan. Gunakan unduh cadangan dan pemeriksaan owner.');};");
  }
  if(module==='laporan'){
    // Do not create sample catalogues, migrate old record schemas, reprice, or
    // reimport a local cache automatically when the owner page opens.
    source=replaceFunction(source,'buildMasterProduksi',"function buildMasterProduksi(){\n throw new Error('Pembuatan ulang katalog perlu pemeriksaan owner; data tidak diimpor otomatis.');\n}");
    source=replaceFunction(source,'migrateProduksi',"function migrateProduksi(){\n if(!Array.isArray(DB.produksi))throw new Error('Bentuk katalog perlu diperiksa sebelum digunakan.');\n}");
    source=replaceFunction(source,'migrateImageKeys',"function migrateImageKeys(){\n throw new Error('Perubahan kunci foto perlu layanan foto terlindungi.');\n}");
    source=replaceFunction(source,'loadLocal',"function loadLocal(){\n DB=JSON.parse(JSON.stringify(window.SoldierOwnerLegacyInitialBusiness.soldier.produksi));if(!Array.isArray(DB.produksi))throw new Error('Bentuk katalog perlu diperiksa.');\n}");
  }
  if(/firebase-database|firebaseio\.com.*\.json|\bfetch\s*\(|XMLHttpRequest|\beval\s*\(|\bnew\s+Function\b/.test(source))fail();
  new vm.Script(source,{filename:PAGES[module]});return source;
}
function createProgram(module,fixed){
  let html=read(PAGES[module]),scripts=[],mainFound=false;
  const exclude=new Set(['access-policy.js','access-session.js','access-photos.js','access-control.js','app-install.js','production-page-mode.js','production-bootstrap.js','production-bridge.js','production-form-controller.js','production-form-ui.js','production-view-client.js','operations-codec.js','maklon-earnings.js','legacy-stored-history.js']);
  html=html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,(_,attrs,body)=>{
    const src=/\bsrc="([^"]+)"/.exec(attrs);
    if(src){const file=src[1].split('?')[0];if(exclude.has(file))return '';if(file==='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'){scripts.push("window.html2canvas=()=>Promise.reject(new Error('Ekspor gambar belum tersedia; gunakan cetak.'));");return '';}scripts.push(read(file));return '';}
    if(module==='jahit'&&body.includes("activateLegacy('soldier-legacy-production-script')"))return '';
    if(body.includes('loadFirebaseSDK()')||module==='pembelian'&&body.includes('startPurchaseConnection()')){if(mainFound)fail();mainFound=true;scripts.push(legacyScript(body,module));}
    else scripts.push(body);
    return '';
  });
  if(!['nota','retur'].includes(module)&&!mainFound)fail();
  const mark='data:image/svg+xml;base64,'+Buffer.from(read('brand-mark.svg'),'utf8').toString('base64');
  html=html.replace(/<link\b[^>]*>/gi,tag=>{
    const href=/\bhref="([^"]+)"/.exec(tag)?.[1];if(!href)fail();const file=href.split('?')[0];if(/\brel="(?:manifest|icon|apple-touch-icon)"/.test(tag)||['access-control.css','app-install.css','production-form-ui.css'].includes(file))return '';
    if(!/\brel="stylesheet"/.test(tag)||!file.endsWith('.css'))fail();const css=read(file);if(/<\/style|@import|url\(\s*['"]?https?:/i.test(css))fail();return '<style>'+css+'</style>';
  });
  html=html.replace(/<meta\b[^>]*http-equiv="(?:Cache-Control|Pragma|Expires)"[^>]*>/gi,'').replace(/\sdata-soldier-locked\b/g,'').replace(/logo-elang\.png/g,mark);
  const fixedBack="window.top.location.href=window.SoldierOwnerLegacyConfiguration.deploymentURL+'?division=owner'";
  html=html.replace(/(?:window\.)?location\.href\s*=\s*(['"])index\.html\1/g,()=>fixedBack).replace(/app-icons\.svg(?:\?[^"'#<>]*)?#([A-Za-z_-]+)/g,(_,id)=>'#'+id);
  scripts=scripts.map(source=>source.replace(/logo-elang\.png/g,()=>mark).replace(/app-icons\.svg(?:\?[^"'#<>]*)?#([A-Za-z_-]+)/g,(_,id)=>'#'+id).replace(/(?:window\.)?location\.href\s*=\s*(['"])index\.html\1/g,()=>fixedBack));
  // Fix known menu links to this reviewed web app. No relative link can open
  // the old unauthenticated GitHub page from the protected owner's frame.
  html=html.replace(/href="([^"<>]+\.html)(?:\?[^"<>]*)?"/g,(_,file)=>{
    const ownerModule=Object.keys(PAGES).find(k=>PAGES[k]===file);return ownerModule&&fixed.enabled?'href="'+fixed.deploymentURL+'?division=owner&amp;ownerModule='+ownerModule+'" target="_top" rel="noopener noreferrer"':'href="#" data-owner-route-unavailable';
  });
  const head=/<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1],body=/<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1];if(typeof head!=='string'||typeof body!=='string'||/<script\b|<iframe\b|<object\b|<embed\b|<base\b|http-equiv\s*=/i.test(head+body))fail();
  for(const source of scripts){if(/<\?/.test(source))fail();new vm.Script(source);}
  const sprite=read('app-icons.svg');if(/<script|(?:href|src)=|onload=/i.test(sprite))fail();
  return Object.freeze({module,head,body:'<div hidden aria-hidden="true">'+sprite+'</div>'+body,scripts:Object.freeze(scripts)});
}
function createPage(options={module:'laporan'}){
  const hasConfiguration=Object.hasOwn(options,'configuration');if(!exact(options,hasConfiguration?['module','configuration']:['module'])||!Object.hasOwn(PAGES,options.module))fail();
  const fixed=publicConfiguration(hasConfiguration?options.configuration:Bootstrap.DEFAULT_CONFIGURATION),program=createProgram(options.module,fixed),browser=read('apps-script-owner-legacy-bootstrap.js');
  const assets=['owner-business-storage-codec.js','owner-business-storage-journal.js','owner-business-storage-client.js','owner-production-photos-codec.js','owner-production-photos-client.js'];
  const childScripts=assets.map(file=>'<script>\n'+read(file)+'\n</script>').join('\n');
  const child='< !doctype html>'.replace('< !','<!')+'<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; connect-src \'none\'; frame-src \'none\'; form-action \'none\'; base-uri \'none\'; object-src \'none\'"></head><body><main id="soldier-owner-legacy-host"><p>Memeriksa data owner…</p></main>'+childScripts+'<script>\n'+browser+'\n</script><script>\nSoldierOwnerLegacyBootstrapAPI.startChild({document,host:document.getElementById("soldier-owner-legacy-host"),program:'+json(program)+',capability:parent.SoldierOwnerLegacyHost.take(window)});\n</script></body></html>';
  if(Buffer.byteLength(child,'utf8')>3*1024*1024||browser.split(CONFIG_LITERAL).length!==2||browser.split(CHILD_LITERAL).length!==2)fail();
  const changed=browser.replace(CONFIG_LITERAL,()=> 'Object.freeze('+json(fixed)+')').replace(CHILD_LITERAL,()=>json(child));new vm.Script(changed);
  const menu='<nav aria-label="Modul owner">'+Object.keys(PAGES).map(module=>'<a href="'+(fixed.enabled?fixed.deploymentURL+'?division=owner&amp;ownerModule='+module:'#')+'" target="_top" rel="noopener noreferrer">'+module+'</a>').join(' ')+'</nav>';
  const html='<!doctype html>\n<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_top"><title>Soldier Apparel Owner</title><style>body{margin:0;background:#101a1f;color:#dce8e2;font-family:system-ui}#soldier-owner-auth{padding:16px}button,a{padding:10px 16px;color:inherit}nav{display:flex;flex-wrap:wrap}</style></head><body>'+menu+'<main id="soldier-owner-auth" aria-live="polite"><p>Memeriksa halaman owner…</p></main><script>\n'+changed+'\n</script><script>\nSoldierAppsScriptOwnerLegacyBootstrap.start({document,host:document.getElementById("soldier-owner-auth")});\n</script></body></html>\n';
  if(Buffer.byteLength(html,'utf8')>4*1024*1024)fail();
  return Object.freeze({html,metadata:Object.freeze({schemaVersion:1,module:options.module,originalPage:PAGES[options.module],originalTemplate:'server/apps-script/legacy-page-templates/'+LegacySource.VERSION+'/'+PAGES[options.module]+'.txt',templateVersion:LegacySource.VERSION,sourceOff:!fixed.enabled,pageSha256:hash(html),childSha256:hash(child),originalUiRetained:true,originalDatabaseSdkRemoved:true,ownerReadBeforeOriginalScripts:true,localDraftsNotDeletedOrReimported:true,photosEnabled:fixed.enabled&&fixed.photosEnabled,photoWritesAvailable:false,compoundPhotoBusinessWritesAvailable:false,localOnly:['nota','retur'].includes(options.module),nativeExecutionProven:false,modules:rows})});
}
function buildPrepared(){
  const pages=Object.keys(PAGES).map(module=>createPage({module}));Pure.noLinks(OUT,true);fs.mkdirSync(OUT,{recursive:true});Pure.noLinks(OUT);const directory=path.join(OUT,'owner-legacy-pages-'+crypto.randomUUID());Pure.noLinks(directory,true);fs.mkdirSync(directory);Pure.noLinks(directory);
  for(const page of pages)fs.writeFileSync(path.join(directory,page.metadata.module+'.html'),page.html,{encoding:'utf8',flag:'wx',mode:0o600});fs.writeFileSync(path.join(directory,'owner-legacy-pages-manifest.json'),JSON.stringify(pages.map(p=>p.metadata),null,2)+'\n',{encoding:'utf8',flag:'wx',mode:0o600});return Object.freeze({directory,sourceOff:true,pages:pages.map(p=>({module:p.metadata.module,sha256:p.metadata.pageSha256})),nativeExecutionProven:false});
}
module.exports=Object.freeze({PAGES,rows,reviewedSource,publicConfiguration,createPage,createProgram,legacyScript,buildPrepared});
if(require.main===module){if(process.argv.length!==2)fail();process.stdout.write(JSON.stringify(buildPrepared())+'\n');}
