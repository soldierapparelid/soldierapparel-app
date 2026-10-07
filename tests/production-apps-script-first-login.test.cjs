'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),State=require('../server/production-identity-state.cjs'),F=require('./fixtures/identity-tenant.cjs');
const {createLifecycleRuntimeFixture:fixture}=require('./helpers/lifecycle-runtime-fixture.cjs');
const copy=F.copy,tenant=f=>f.root.authorityTenants[F.TENANT];
function pending(division='jahit') { const f=fixture(division),root=copy(f.root);root.authorityTenants[F.TENANT]=F.tenant();f.root=root;f.options.enrollmentEnabled=true;return f; }
test('first-login enrollment is opt-in and the existing source-OFF/default path never creates grants',()=>{
  const f=pending();delete f.options.enrollmentEnabled;assert.equal(f.create().read(f.readInput()).error,'access_denied');assert.equal(f.stats.writes,0);assert.equal(tenant(f).enrollmentRegistry.approvals['approval-1'].status,'pending');
  const g=pending();g.options.enrollmentEnabled=false;assert.equal(g.create().read(g.readInput()).ok,false);assert.equal(g.stats.puts,0);
});
test('approved first Jahit and QC logins atomically bind the actual UID and Google subject before returning a scoped view',()=>{
  for(const division of ['jahit','qc']){const f=pending(division),money=copy(f.root.soldier),privateRoot=f.root.privateRoot,budgets=[];f.hooks.budget=q=>{budgets.push(copy(q));return true;};const r=f.create().read(f.readInput());assert.equal(r.ok,true);assert.equal(r.view.binding.division,division);assert.equal(r.view.binding.uid,f.who.uid);assert.equal(f.stats.puts,1);assert.equal(f.stats.writes,1);assert.deepEqual(f.root.soldier,money);assert.equal(f.root.privateRoot,privateRoot);
    const row=tenant(f).enrollmentRegistry.approvals[division==='qc'?'approval-q':'approval-1'];assert.equal(row.status,'claimed');assert.deepEqual(row.claim,{uid:f.who.uid,googleSubject:f.who.googleSubject,claimedAt:F.NOW,grantRevision:1});assert.equal(row.revision,2);assert.equal(row.admission.count,1);assert.deepEqual(budgets.map(q=>q.kind),['read','execute']);assert.equal(budgets.reduce((s,q)=>s+q.maxDatabaseDownloadBytes,0),5*8*1024*1024);assert.equal(JSON.stringify(r).includes('SYNTHETIC_CASH_PRIVATE'),false);
  }
});
test('ordinary reload and finance reads use the retained claim without incrementing approval or writing again',()=>{
  const f=pending();assert.equal(f.create().read(f.readInput()).ok,true);const before=copy(tenant(f));for(let i=0;i<4;i++)assert.equal(f.create().read(f.readInput()).ok,true);assert.equal(f.create().readFinance(f.readInput()).ok,true);assert.deepEqual(tenant(f),before);assert.equal(f.stats.writes,1);assert.equal(f.stats.budget,7);
});
test('unknown emails, expired approval, stale Google auth and foreign tenant state create no grant',()=>{
  for(const change of [f=>{f.payload.email=f.account.email='unapproved@gmail.com';f.account.providerUserInfo[0].email=f.account.email;},f=>{const root=copy(f.root);root.authorityTenants[F.TENANT].enrollmentRegistry.approvals['approval-1'].expiresAt=F.NOW;f.root=root;},f=>{f.payload.auth_time=Date.parse(F.NOW)/1000-301;},f=>{const root=copy(f.root);root.authorityTenants[F.TENANT].tenantId='foreign';f.root=root;}]){const f=pending();change(f);assert.equal(f.create().read(f.readInput()).ok,false);assert.equal(f.stats.puts,0);assert.equal(f.stats.writes,0);}
});
test('owner and already claimed partner reads never re-enroll or create another grant',()=>{
  for(const division of ['owner','jahit','qc']){const f=fixture(division);f.options.enrollmentEnabled=true;const before=copy(tenant(f));assert.equal(f.create().read(f.readInput()).ok,true);assert.deepEqual(tenant(f),before);assert.equal(f.stats.writes,0);assert.equal(f.stats.budget,1);}
});
test('the extra shared reservation can deny enrollment before any PUT or new grant',()=>{
  const f=pending();f.hooks.budget=q=>q.kind!=='execute';const r=f.create().read(f.readInput());assert.equal(r.error,'rate_limited');assert.equal(f.stats.reads,1);assert.equal(f.stats.puts,0);assert.equal(tenant(f).enrollmentRegistry.approvals['approval-1'].status,'pending');
});
test('a concurrent money change causes CAS conflict and is preserved when a fresh read later claims the account',()=>{
  const f=pending();f.hooks.beforePut=()=>{f.root.soldier.privateCash='SYNTHETIC_CHANGED_CASH';};assert.equal(f.create().read(f.readInput()).error,'conflict');assert.equal(f.stats.writes,0);assert.equal(tenant(f).enrollmentRegistry.approvals['approval-1'].status,'pending');delete f.hooks.beforePut;assert.equal(f.create().read(f.readInput()).ok,true);assert.equal(f.stats.writes,1);assert.equal(f.root.soldier.privateCash,'SYNTHETIC_CHANGED_CASH');
});
test('a lost enrollment acknowledgment returns no data and the next login resolves the retained claim without a second write',()=>{
  const f=pending();f.hooks.afterPut=()=>{throw Error('SYNTHETIC_PRIVATE_ACK_LOSS');};const first=f.create().read(f.readInput());assert.deepEqual(first,{ok:false,error:'unavailable'});assert.equal(f.stats.writes,1);assert.equal(tenant(f).enrollmentRegistry.approvals['approval-1'].revision,2);delete f.hooks.afterPut;assert.equal(f.create().read(f.readInput()).ok,true);assert.equal(f.stats.writes,1);assert.equal(f.stats.puts,1);assert.equal(tenant(f).enrollmentRegistry.approvals['approval-1'].revision,2);
});
test('revocation during the claim reply denies the view and retained revocation prevents rejoining',()=>{
  const f=pending();f.hooks.afterPut=()=>{const root=copy(f.root);root.authorityTenants[F.TENANT]=State.revokeIdentityEnrollment(root.authorityTenants[F.TENANT],F.revokeCommand(),F.NOW).next;f.root=root;};assert.equal(f.create().read(f.readInput()).ok,false);delete f.hooks.afterPut;assert.equal(f.create().read(f.readInput()).error,'access_denied');assert.equal(f.stats.writes,1);assert.equal(tenant(f).enrollmentRegistry.approvals['approval-1'].status,'revoked');assert.equal(tenant(f).grants[f.who.uid].profile.active,false);
});
test('disabled Google account discovered at pre-write verification receives no grant',()=>{
  const f=pending();f.hooks.google=n=>{if(n>=8)f.account.disabled=true;};assert.equal(f.create().read(f.readInput()).ok,false);assert.equal(f.stats.puts,0);assert.equal(tenant(f).enrollmentRegistry.approvals['approval-1'].status,'pending');
});
test('read payloads cannot select enrollment, role, email, worker, grant or host',()=>{
  for(const field of ['enrollmentEnabled','email','uid','googleSubject','workerId','division','role','binding','grantRevision']){const f=pending();assert.equal(f.create().read({...f.readInput(),[field]:true}).error,'invalid_request');assert.equal(f.stats.google,0);assert.equal(f.stats.puts,0);}
  const f=pending();let hits=0;Object.defineProperty(f.options,'enrollmentEnabled',{enumerable:true,get(){hits++;throw Error();}});assert.equal(f.create().read(f.readInput()).error,'unavailable');assert.equal(hits,0);assert.equal(f.stats.google,0);
});
test('generated V8 RPC uses the same atomic first-login path and shared retained reservations',()=>{
  const {createLifecycleBundleFixture}=require('./helpers/lifecycle-bundle-fixture.cjs'),f=createLifecycleBundleFixture('jahit'),normal=v=>JSON.parse(JSON.stringify(v)),root=normal(f.fixture.root());root.authorityTenants[F.TENANT]=F.tenant();f.fixture.setRoot(f.realm(root));f.fixture.controls.enrollmentEnabled=true;
  const request=f.realm({kind:'read',idToken:f.seed.token}),first=normal(f.fixture.gateway().dispatch(request));assert.equal(first.ok,true);assert.equal(first.view.binding.uid,f.seed.identity.uid);assert.equal(f.fixture.stats.writes,1);assert.equal(f.fixture.state().requests,2);assert.equal(normal(f.fixture.root()).authorityTenants[F.TENANT].enrollmentRegistry.approvals['approval-1'].revision,2);
  assert.equal(f.fixture.gateway().dispatch(request).ok,true);assert.equal(f.fixture.stats.writes,1);assert.equal(f.fixture.state().requests,3);
});
