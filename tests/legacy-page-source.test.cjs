'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Source=require('../server/apps-script/legacy-page-source.cjs'),Builder=require('../server/apps-script/build-owner-legacy-page.cjs');
const ROOT=path.resolve(__dirname,'..'),CONFIG=Object.freeze({enabled:true,photosEnabled:false,projectId:'demo-identity-state',databaseURL:'https://demo-identity-state-default-rtdb.asia-southeast1.firebasedatabase.app',tenantId:'synthetic-tenant',deploymentURL:'https://script.google.com/macros/s/SYNTHETIC_OWNER_LEGACY_000000000000000/exec',apiKey:'SYNTHETIC_PUBLIC_API_KEY_000000000',authDomain:'demo-identity-state.firebaseapp.com'});
test('fourteen legacy source templates are versioned text assets with exact pins and no credential literals',()=>{
 assert.equal(Source.VERSION,'v1');assert.equal(Source.rows.length,14);
 assert.deepEqual(fs.readdirSync(Source.TEMPLATE_DIRECTORY).sort(),Source.rows.map(row=>row.file+'.txt').sort());
 for(const row of Source.rows){const file=Source.sourcePath(row.file),source=Source.readLegacyPageSource(row.file);assert.equal(path.extname(file),'.txt');assert.equal(path.dirname(file),Source.TEMPLATE_DIRECTORY);assert.equal(Source.reviewedSource(row.file,source),source);assert.doesNotMatch(source,/\b(?:password|passwd|passphrase|pin|secret|accessToken|refreshToken|idToken|partnerKey|privateKey|credential|authorization)\b\s*[:=]\s*(['"])([^'"\n]+)\1/i);assert.doesNotMatch(source,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/);}
});
test('fixed template source rejects unknown paths, caller path selectors and source drift',()=>{
 for(const file of ['../index.html','v1/index.html','index.html.txt','constructor','__proto__','https://foreign.invalid/index.html',{},null,undefined])assert.throws(()=>Source.sourcePath(file));
 const raw=Source.readLegacyPageSource('potong-command.html');assert.throws(()=>Source.reviewedSource('potong-command.html',raw+'\n'));assert.throws(()=>Source.reviewedSource('potong-command.html','<html>main redirect</html>'));assert.throws(()=>Source.reviewedSource('../index.html',raw));
});
test('owner page rebuild is byte-identical when every root HTML is replaced by an SDK-free router shim',()=>{
 const expected=new Map();for(const module of Object.keys(Builder.PAGES))expected.set(module,Builder.createPage({module,configuration:CONFIG}));
 const nativeRead=fs.readFileSync;let rootHtmlReads=0;
 fs.readFileSync=function(file,...args){if(typeof file==='string'&&path.dirname(path.resolve(file))===ROOT&&String(file).endsWith('.html')){rootHtmlReads++;return '<!doctype html><html><head><script src="soldier-main-routing.js?v=synthetic"></script><script>SoldierMainRouting.redirect("synthetic");</script></head></html>';}return nativeRead.call(this,file,...args);};
 try{for(const module of Object.keys(Builder.PAGES)){const page=Builder.createPage({module,configuration:CONFIG});assert.equal(page.html,expected.get(module).html);assert.equal(page.metadata.pageSha256,expected.get(module).metadata.pageSha256);assert.equal(page.metadata.templateVersion,'v1');assert.equal(page.metadata.originalTemplate,'server/apps-script/legacy-page-templates/v1/'+Builder.PAGES[module]+'.txt');assert.equal(page.metadata.originalDatabaseSdkRemoved,true);assert.equal(page.metadata.ownerReadBeforeOriginalScripts,true);assert.equal(page.html.includes('SoldierMainRouting.redirect'),false);}}finally{fs.readFileSync=nativeRead;}
 assert.equal(rootHtmlReads,0);
});
test('missing or changed template fails closed without using still-present legacy root HTML',()=>{
 const nativeRead=fs.readFileSync,target=Source.sourcePath('gaji-harian-command.html');let rootReads=0;
 fs.readFileSync=function(file,...args){if(file===target)return '<html>unreviewed source</html>';if(file===path.join(ROOT,'gaji-harian-command.html'))rootReads++;return nativeRead.call(this,file,...args);};
 try{assert.throws(()=>Builder.createPage({module:'gaji'}));}finally{fs.readFileSync=nativeRead;}
 assert.equal(rootReads,0);
});
