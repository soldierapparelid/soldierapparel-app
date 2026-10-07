'use strict';
// Fixed public candidate only. Never reads credentials, a business backup,
// project configuration or a live database; never deploys Rules.
const fs=require('node:fs'),path=require('node:path');
const T="root.child('authorityTenants').child($tenantId)",G=T+".child('grants').child(auth.uid)",I=T+".child('initialization')",C=T+".child('workerCatalog')";
const O=T+".child('grants').child("+I+".child('ownerUid').val())",P=G+".child('profile')",W=C+".child('workers').child("+P+".child('workerId').val())";
const safe=node=>`${node}.isString() && ${node}.val().matches(/^[A-Za-z0-9_-]{1,128}$/) && ${node}.val() !== '__proto__' && ${node}.val() !== 'constructor' && ${node}.val() !== 'prototype'`;
const mapKey=node=>safe(node)+` && !${node}.val().matches(/^[0-9]+$/)`;
function v2Gate(){
  // RuleDataSnapshot supports hasChildren(), not SDK numChildren(). Exact
  // whole-state shape and capacity remain independently validated by server.
  const provenance=[`${T}.child('schemaVersion').val() === 2`,`${T}.child('projectId').val() === auth.token.aud`,`${T}.hasChildren(['schemaVersion','projectId','tenantId','initialization','workerCatalog','grants'])`,`!${T}.child('products').exists()`,`!${T}.child('ownerCommandLedger').exists()`,`!${T}.child('tariffCommandLedger').exists()`,`${I}.hasChildren(['schemaVersion','kind','reviewed','bootstrapId','initializedAt','ownerUid','ownerGrantRevision'])`,`${I}.child('schemaVersion').val() === 1`,`${I}.child('kind').val() === 'reviewed-identity-only-v1'`,`${I}.child('reviewed').val() === true`,`${I}.child('ownerGrantRevision').val() === 1`,mapKey(I+".child('ownerUid')"),safe(I+".child('bootstrapId')"),`${I}.child('initializedAt').isString()`,`${I}.child('initializedAt').val().matches(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$/)`,`${O}.hasChildren(['revision','profile'])`,`${O}.child('revision').val() === 1`,`${O}.child('profile/active').val() === true`,`${O}.child('profile/owner').val() === true`,`!${O}.child('profile/modules').exists()`,`!${O}.child('profile/workerId').exists()`,`${C}.hasChildren(['schemaVersion','revision','reviewed','workers'])`,`${C}.child('schemaVersion').val() === 1`,`${C}.child('revision').val() === 1`,`${C}.child('reviewed').val() === true`,`${C}.child('workers').hasChildren()`,`${G}.hasChildren(['revision','profile'])`];
  const oneModule=m=>['potong','jahit','qc','laporan','stok','gaji','hpp','pembelian','nota','retur'].map(k=>k===m?`${P}.child('modules/${k}').val() === true`:`!${P}.child('modules/${k}').exists()`).join(' && ');
  const owner=`auth.uid === ${I}.child('ownerUid').val() && ${G}.child('revision').val() === 1 && ${P}.child('active').val() === true && ${P}.child('owner').val() === true && !${P}.child('workerId').exists() && !${P}.child('modules').exists()`;
  const partner=[`auth.uid !== ${I}.child('ownerUid').val()`,`!auth.uid.matches(/^[0-9]+$/)`,`${P}.child('owner').val() === false`,`((${P}.child('active').val() === true && ${G}.child('revision').val() === 1) || (${P}.child('active').val() === false && ${G}.child('revision').val() === 2))`,`((${oneModule('qc')} && !${P}.child('workerId').exists()) || (${oneModule('jahit')} && ${mapKey(P+".child('workerId')")} && ${W}.hasChildren(['division','reviewed']) && ${W}.child('division').val() === 'jahit' && ${W}.child('reviewed').val() === true))`].join(' && ');
  return '('+provenance.join(' && ')+` && ((${owner}) || (${partner})))`;
}
function buildIdentityObservationRules(){
  const original=JSON.parse(fs.readFileSync(path.join(__dirname,'authority-tenant.rules.json'),'utf8'));
  const output=JSON.parse(JSON.stringify(original)),grant=output.rules.authorityTenants.$tenantId.grants.$uid;
  const nodes=[grant.revision,grant.profile.active,grant.profile.owner,grant.profile.workerId,grant.profile.modules.$module];
  const old=T+".child('schemaVersion').val() === 1";
  if(output.rules['.read']!==false||output.rules['.write']!==false)throw Error('invalid_rules_baseline');
  for(const node of nodes){const rule=node['.read'];if(typeof rule!=='string'||rule.split(old).length!==2||!rule.includes('$uid === auth.uid'))throw Error('invalid_observation_baseline');node['.read']=rule.replace(old,'('+old+' || '+v2Gate()+')');}
  return output;
}
if(require.main===module){
  const file=path.join(__dirname,'identity-access.rules.json'),bytes=JSON.stringify(buildIdentityObservationRules(),null,2)+'\n';
  if(fs.existsSync(file)){if(fs.readFileSync(file,'utf8')!==bytes)throw Error('existing_rules_candidate_differs');}else fs.writeFileSync(file,bytes,{flag:'wx'});
  process.stdout.write('identity_observation_candidate_prepared\n');
}
module.exports=Object.freeze({buildIdentityObservationRules});
