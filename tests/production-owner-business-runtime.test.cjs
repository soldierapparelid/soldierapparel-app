'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { createLifecycleRuntimeFixture } = require('./helpers/lifecycle-runtime-fixture.cjs');
const Gateway = require('../server/apps-script/owner-business-rpc-gateway.cjs');
const F = require('./fixtures/identity-tenant.cjs');
const normal = v => JSON.parse(JSON.stringify(v));
function fixture() { const f = createLifecycleRuntimeFixture('owner'); const root = f.root; root.soldier.gajiHarian = { entries: [{ id: 'daily-1', total: 100.25 }], unknown: { retained: true } }; root.unknownPrivate = { preserved: 'SYNTHETIC_PRIVATE' }; f.root = root; return f; }
function command(f, requestId = 'owner-business-request-1', total = 120.25) { const r = f.create().readBusiness(f.readInput()); assert.equal(r.ok, true, JSON.stringify(r)); const value = normal(r.view.business.soldier.gajiHarian); value.entries[0].total = total; return { kind: 'ownerBusinessWrite', requestId, expectedGrantRevision: 1, expectedSourceVersion: r.view.sourceVersion, changes: [{ path: 'soldier/gajiHarian', action: 'set', value }] }; }
function confirmedReceipt(raw) { assert.deepEqual(Object.keys(raw).sort(), ['ok', 'replayed', 'requestId', 'view']); assert.equal(raw.view.binding.division, 'owner'); assert.equal(raw.view.business.soldier.gajiHarian.entries[0].total, 120.25); assert.match(raw.view.sourceVersion, /^[a-f0-9]{64}$/); return { ok: raw.ok, replayed: raw.replayed, requestId: raw.requestId }; }

test('owner business runtime defaults OFF including all three new methods', () => {
  const R = require('../server/apps-script/legacy-lifecycle-runtime.cjs').createAppsScriptLegacyLifecycleRuntime();
  for (const name of ['readBusiness', 'executeOwnerBusiness', 'resolveOwnerBusiness']) assert.deepEqual(R[name]({}), { ok: false, error: 'service_disabled' });
});

test('owner read returns business projection without authority, receipts, photos, credentials or unknown root', () => {
  const f = fixture(), r = f.create().readBusiness(f.readInput()); assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.view.binding.division, 'owner'); assert.equal(r.view.business.soldier.gajiHarian.entries[0].total, 100.25);
  for (const marker of ['SYNTHETIC_PRIVATE', 'authorityTenants', 'legacyLifecycleReceipts', 'SYNTHETIC_PIN', 'SYNTHETIC_MANAGED_OAUTH']) assert.equal(JSON.stringify(r).includes(marker), false, marker);
  assert.equal(f.stats.reads, 2); assert.equal(f.stats.google, 4); assert.equal(f.stats.puts, 0);
});

test('owner business edit confirms one CAS, preserves all unrelated stored fields and recovers through a new runtime', () => {
  const f = fixture(), cmd = command(f), before = normal(f.root), r = f.create().executeOwnerBusiness(f.input(cmd));
  assert.deepEqual(confirmedReceipt(r), { ok: true, replayed: false, requestId: cmd.requestId }); assert.equal(f.stats.writes, 1); assert.equal(f.stats.reads, 4);
  assert.deepEqual(f.root.unknownPrivate, before.unknownPrivate); assert.deepEqual(f.root.soldier.produksi, before.soldier.produksi); assert.deepEqual(f.root.soldier.produksi_meta, before.soldier.produksi_meta); assert.deepEqual(f.root.authorityTenants, before.authorityTenants);
  assert.equal(f.root.soldier.gajiHarian.entries[0].total, 120.25);
  assert.deepEqual(confirmedReceipt(f.create().resolveOwnerBusiness(f.input(cmd))), { ok: true, replayed: true, requestId: cmd.requestId }); assert.equal(f.stats.puts, 1);
});

test('business lost acknowledgement remains unknown and same-command resolution performs no second write', () => {
  const f = fixture(), cmd = command(f); f.hooks.afterPut = () => { throw Error('synthetic acknowledgement lost'); };
  assert.deepEqual(f.create().executeOwnerBusiness(f.input(cmd)), { ok: false, error: 'result_unknown', retrySameCommand: true }); delete f.hooks.afterPut;
  assert.deepEqual(confirmedReceipt(f.create().resolveOwnerBusiness(f.input(cmd))), { ok: true, replayed: true, requestId: cmd.requestId }); assert.equal(f.stats.puts, 1); assert.equal(f.stats.writes, 1);
});

test('owner business known storage conflict does not retry or modify the requested branch', () => {
  const f = fixture(), cmd = command(f); f.hooks.beforePut = () => { const root = f.root; root.unknownPrivate.counter = 1; f.root = root; };
  assert.deepEqual(f.create().executeOwnerBusiness(f.input(cmd)), { ok: false, error: 'conflict' }); assert.equal(f.stats.puts, 1); assert.equal(f.stats.writes, 0); assert.equal(f.root.soldier.gajiHarian.entries[0].total, 100.25);
});

test('partner and QC cannot read or change owner business even through the fixed owner RPC', () => {
  const owner = fixture(), cmd = command(owner);
  for (const division of ['qc', 'jahit']) {
    const f = createLifecycleRuntimeFixture(division); assert.deepEqual(f.create().readBusiness(f.readInput()), { ok: false, error: 'access_denied' });
    assert.deepEqual(f.create().executeOwnerBusiness(f.input(cmd)), { ok: false, error: 'access_denied' }); assert.equal(f.stats.puts, 0);
  }
});

test('an invalid retained initial owner grant between reads stops business projection without a write', () => {
  const f = fixture(); f.hooks.read = n => { if (n !== 2) return; const root = f.root; const g = root.authorityTenants[F.TENANT].grants['owner-1']; g.profile.active = false; g.revision++; f.root = root; };
  assert.deepEqual(f.create().readBusiness(f.readInput()), { ok: false, error: 'not_ready' }); assert.equal(f.stats.puts, 0);
});

test('browser selectors and invalid command paths are rejected before quota or Google lookups', () => {
  const f = fixture(), api = f.create(), gateway = Gateway.createAppsScriptOwnerBusinessRpcGateway({ enabled: true, binding: f.f.binding, runtime: api });
  const before = normal(f.stats); assert.deepEqual(gateway.dispatch({ kind: 'read', ...f.readInput(), role: 'owner' }), { ok: false, error: 'invalid_request' });
  assert.deepEqual(api.executeOwnerBusiness(f.input({ kind: 'ownerBusinessWrite', requestId: 'owner-invalid-request', expectedGrantRevision: 1, expectedSourceVersion: '0'.repeat(64), changes: [{ path: 'authorityTenants', action: 'remove' }] })), { ok: false, error: 'invalid_request' });
  assert.deepEqual(f.stats, before);
});

test('fixed owner gateway validates business DTO and preserves receipt identity', () => {
  const f = fixture(), gateway = Gateway.createAppsScriptOwnerBusinessRpcGateway({ enabled: true, binding: f.f.binding, runtime: f.create() });
  const read = normal(gateway.dispatch({ kind: 'read', ...f.readInput() })); assert.equal(read.ok, true, JSON.stringify(read));
  const cmd = command(f); const r = JSON.parse(gateway.dispatchJson({ kind: 'execute', ...f.input(cmd) })); assert.deepEqual(confirmedReceipt(r), { ok: true, replayed: false, requestId: cmd.requestId });
  assert.deepEqual(confirmedReceipt(JSON.parse(gateway.dispatchJson({ kind: 'resolve', ...f.input(cmd) }))), { ok: true, replayed: true, requestId: cmd.requestId }); assert.equal(f.stats.puts, 1);
});

test('native string owner requests reject duplicate keys and dispatch the bounded exact request', () => {
  const f = fixture(), gateway = Gateway.createAppsScriptOwnerBusinessRpcGateway({ enabled: true, binding: f.f.binding, runtime: f.create() });
  assert.equal(JSON.parse(gateway.dispatchJson(JSON.stringify({ kind: 'read', ...f.readInput() }))).ok, true);
  const before = normal(f.stats); assert.deepEqual(JSON.parse(gateway.dispatchJson('{"kind":"read","kind":"execute","idToken":"synthetic"}')), { ok: false, error: 'invalid_request' }); assert.deepEqual(f.stats, before);
});

test('confirmed owner write projection uses current grant and bounded business DTO before returning through the fixed gateway', () => {
  const f = fixture(), cmd = command(f), api = f.create(); const reply = normal(api.executeOwnerBusiness(f.input(cmd)));
  for (const change of [v => { v.view.binding.tenantId = 'foreign-tenant'; }, v => { v.view.business.soldier.authorityTenants = {}; }, v => { v.view.binding.division = 'qc'; }]) {
    const modified = normal(reply); change(modified); const runtime = { readBusiness: api.readBusiness, executeOwnerBusiness: () => modified, resolveOwnerBusiness: api.resolveOwnerBusiness };
    const gateway = Gateway.createAppsScriptOwnerBusinessRpcGateway({ enabled: true, binding: f.f.binding, runtime });
    assert.deepEqual(gateway.dispatch({ kind: 'execute', ...f.input(cmd) }), { ok: false, error: 'result_unknown', retrySameCommand: true });
  }
  assert.equal(f.stats.puts, 1);
});

