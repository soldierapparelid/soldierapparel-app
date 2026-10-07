'use strict';
// Public dependency evidence only. No ADC, project discovery, server or deploy.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const {validateLock,validateManifest}=require('../server/deployment/validate-dependency-lock.cjs');
const deployment=path.resolve(__dirname,'../server/deployment'),lockPath=path.join(deployment,'package-lock.json');
const raw=fs.readFileSync(lockPath),manifest=fs.readFileSync(path.join(deployment,'package.json'));
validateManifest(manifest);
if(!raw.length||raw.length>1048576)throw Error('invalid_public_lock_size');
const mode=process.argv[2];if(process.argv.length!==3||!['summary','smoke','audit','emit'].includes(mode))throw Error('invalid_review_mode');
const evidence=validateLock(raw,manifest),lock=JSON.parse(raw.toString('utf8'));
if(lock.name!=='soldier-production-server-prepared'||lock.version!=='0.0.0-prepared'||lock.lockfileVersion!==3||!lock.packages||JSON.stringify(lock.packages['']?.dependencies)!==JSON.stringify(JSON.parse(manifest.toString('utf8')).dependencies))throw Error('foreign_public_lock');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function emit(kind,bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length>1048576)throw Error('invalid_public_evidence');
  const encoded=bytes.toString('base64'),chunks=Math.ceil(encoded.length/4096),digest=sha(bytes);
  process.stdout.write(kind+'_BEGIN '+JSON.stringify({sha256:digest,bytes:bytes.length,chunks})+'\n');
  for(let i=0;i<chunks;i++)process.stdout.write(kind+'_CHUNK '+i+' '+encoded.slice(i*4096,(i+1)*4096)+'\n');
  process.stdout.write(kind+'_END '+digest+'\n');
}
if(mode==='summary')process.stdout.write(JSON.stringify(evidence)+'\n');
if(mode==='smoke'){
  const sdk=createRequire(path.join(deployment,'package.json'));
  const app=sdk('firebase-admin/app');if(app.getApps().length!==0)throw Error('unexpected_initialized_app');
  const auth=sdk('firebase-admin/auth'),database=sdk('firebase-admin/database'),functions=sdk('firebase-functions/v2/https');
  if(typeof auth.getAuth!=='function'||typeof database.getDatabase!=='function'||typeof functions.onRequest!=='function'||app.getApps().length!==0)throw Error('sdk_contract_unavailable');
  if(Object.keys(require('../server/deployment/index.cjs')).length!==0||app.getApps().length!==0)throw Error('prepared_source_not_off');
  if(sha(fs.readFileSync(lockPath))!==evidence.lockSha256)throw Error('lock_changed');
  process.stdout.write(JSON.stringify({lockSha256:evidence.lockSha256,nodeMajor:Number(process.versions.node.split('.')[0]),admin:lock.packages['node_modules/firebase-admin'].version,functions:lock.packages['node_modules/firebase-functions'].version,importsPassed:true,appsInitialized:0,sourceOFF:true,realGoogleAuth:false,deployed:false})+'\n');
}
if(mode==='audit'){
  const auditRaw=fs.readFileSync(path.join(__dirname,'server-audit.public.json'));if(auditRaw.length>1048576)throw Error('audit_too_large');
  const audit=JSON.parse(auditRaw.toString('utf8'));
  if(audit.auditReportVersion!==2||audit.error||!audit.metadata?.vulnerabilities||!audit.vulnerabilities||typeof audit.vulnerabilities!=='object'||Array.isArray(audit.vulnerabilities))throw Error('audit_unavailable');
  const severities=['info','low','moderate','high','critical'];
  if(severities.some(k=>!Number.isSafeInteger(audit.metadata.vulnerabilities[k])||audit.metadata.vulnerabilities[k]<0)||!Number.isSafeInteger(audit.metadata.vulnerabilities.total)||audit.metadata.vulnerabilities.total!==severities.reduce((n,k)=>n+audit.metadata.vulnerabilities[k],0))throw Error('invalid_audit_counts');
  const names=Object.keys(audit.vulnerabilities).sort();if(names.length>2000||names.some(name=>!/^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(name)))throw Error('invalid_audit_names');
  process.stdout.write(JSON.stringify({lockSha256:evidence.lockSha256,auditSha256:sha(auditRaw),knownVulnerabilities:audit.metadata.vulnerabilities,packagesWithFindings:names,advisoryKnowledgeOnly:true,autoFix:false,deployed:false})+'\n');
  emit('PUBLIC_SERVER_AUDIT',auditRaw);
}
if(mode==='emit')emit('PUBLIC_SERVER_LOCK',raw);
