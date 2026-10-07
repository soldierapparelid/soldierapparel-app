'use strict';
// Versioned source text for offline rebuilding and legacy regression tests.
// These .html.txt assets are source templates, never web-app entry points.
// Original scripts remain inert until the reviewed owner builder transforms
// them and verifies genuine owner access before mounting the resulting UI.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Pure=require('./build-pure-bundle.cjs');
const VERSION='v1',TEMPLATE_DIRECTORY=path.resolve(__dirname,'legacy-page-templates',VERSION);
const rows=Object.freeze([
 ['gaji-harian-command.html','125f54b1f3339512c4f20f9321f321a801cd637865013de6d6b4fe86b9894ea3'],
 ['hpp-command-v1.html','d896c1ab444ee5c7c62c1e2a81f2127f6e05c4ea87e867dba640f4f4d05eaa24'],
 ['index.html','9809bb21326ce04f40f7055a9c7d225053f7c32a6741278defd067b88266650e'],
 ['jahit-command.html','5de2fc5933cfda115ee12f6e762b98fbc5f2e1e594488c66f91035b5ff2eb554'],
 ['laporan-produksi.html','933721f4de65f6e8e2811f04ccd5417e411dcc785d6099a6a22a4205183877e2'],
 ['maklon-upah.html','fe8bd674c33d43c5555a1d78b262fb248799bef3c528198282140b3f3984a7b4'],
 ['nota-penjualan.html','b1fa962ead40b4ee0c8d3e3f8ddf5f8c45287bbd114116a230c6b01ba1c02110'],
 ['owner-tarif.html','87020537799b7d6f1dc788d4d6ffe3fa928f843d8af5042aa86bd5efd5ed89d5'],
 ['owner-upah.html','cb96b852c3de88958e870a5adb0fb67422cb17cad6e644d9727857dd94ae256a'],
 ['pembelian-produk-v1.html','bd99249bda5893143067d772a79b460503de9e4093138c6daddef269960d6559'],
 ['potong-command.html','891baf9fef69fbcae818f52c543ae2a57d0866d2fc8ba1608c52f7e20191fdfb'],
 ['qc-command.html','833533f6c522f74628932d1828e11022d80a6f8e93dd8f064f02e9b3ea8a520c'],
 ['retur-command.html','dd8519f9dc7bc9d2261b18182dae2d45968040f37b3fca95eae666a1ed106db7'],
 ['stok-bahan-command.html','eb9e7a7edd2a22b2e12ea9f60a975f5db649570d7308f8afb65a3994a40601af']
].map(([file,sha256])=>Object.freeze({file,sha256})));
const fail=()=>{throw Error('legacy_page_source_rejected');};
function sourcePath(file){
 if(typeof file!=='string'||!rows.some(row=>row.file===file))fail();
 const target=path.resolve(TEMPLATE_DIRECTORY,file+'.txt');
 if(path.dirname(target)!==TEMPLATE_DIRECTORY)fail();return target;
}
function reviewedSource(file,raw){
 const row=rows.find(row=>row.file===file);if(!row||typeof raw!=='string')fail();
 const source=raw.replace(/\r\n/g,'\n');
 if(Buffer.byteLength(source)>512*1024||crypto.createHash('sha256').update(source).digest('hex')!==row.sha256||/<\?/.test(source))fail();
 return source;
}
function readLegacyPageSource(file){
 const target=sourcePath(file);Pure.noLinks(target);if(!fs.lstatSync(target).isFile())fail();
 const source=reviewedSource(file,fs.readFileSync(target,'utf8'));Pure.noLinks(target);return source;
}
module.exports=Object.freeze({VERSION,TEMPLATE_DIRECTORY,rows,sourcePath,reviewedSource,readLegacyPageSource});
