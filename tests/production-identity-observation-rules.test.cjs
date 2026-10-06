'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Builder=require('../security/build-identity-observation-rules.cjs');
const dir=path.join(__dirname,'../security'),original=JSON.parse(fs.readFileSync(path.join(dir,'authority-tenant.rules.json'),'utf8'));
test('v2 candidate changes only the five existing self-observation predicates and never any production or write gate',()=>{
  const result=Builder.buildIdentityObservationRules();const changes=[];
  function walk(a,b,p=[]){if(a&&typeof a==='object'){assert.deepEqual(Object.keys(a),Object.keys(b));for(const key of Object.keys(a))walk(a[key],b[key],[...p,key]);}else if(a!==b)changes.push(p.join('/'));}
  walk(original,result);assert.equal(changes.length,5);assert.ok(changes.every(p=>p.startsWith('rules/authorityTenants/$tenantId/grants/$uid/')&&p.endsWith('/.read')));
  assert.deepEqual(result.rules.authorityTenants.$tenantId.products,original.rules.authorityTenants.$tenantId.products);assert.equal(result.rules['.read'],false);assert.equal(result.rules['.write'],false);
});
test('checked-in observation candidate exactly matches its deterministic public-only builder',()=>{
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'identity-access.rules.json'),'utf8')),Builder.buildIdentityObservationRules());
});
