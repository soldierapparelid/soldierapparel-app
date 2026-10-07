'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLifecycleRuntimeFixture } = require('./helpers/lifecycle-runtime-fixture.cjs');
const cmd = f => f.command('ownerArchiveCycle', 'owner-operation-1', { archiveId: 'owner-archive-1', label: 'Synthetic owner archive', startNewPO: false });
test('owner coordinator verifies the account, reserves ordinary execute budget and performs one root CAS plus confirmation', () => {
  const f = createLifecycleRuntimeFixture('owner'), command = cmd(f); let budget;
  f.hooks.budget = request => { budget = request; return true; }; const r = f.create().executeOwner(f.input(command));
  assert.deepEqual(r, { ok: true, replayed: false, operationId: command.operationId }); assert.equal(budget.kind, 'execute'); assert.equal(budget.maxGoogleLookupCount, 14); assert.equal(f.stats.puts, 1); assert.equal(f.stats.writes, 1);
  assert.equal(f.root.soldier.produksi.produksi[0].arsip.filter(a => a.id === 'owner-archive-1').length, 1); assert.equal(f.create().resolveOwner(f.input(command)).replayed, true); assert.equal(f.stats.puts, 1);
});
test('owner archive ACK loss keeps the exact command and independent resolution never duplicates the archive', () => {
  const f = createLifecycleRuntimeFixture('owner'), command = cmd(f); f.hooks.afterPut = () => { throw Error('SYNTHETIC_ACK_LOSS'); };
  assert.deepEqual(f.create().executeOwner(f.input(command)), { ok: false, error: 'result_unknown', retrySameCommand: true }); delete f.hooks.afterPut;
  assert.deepEqual(f.create().resolveOwner(f.input(command)), { ok: true, replayed: true, operationId: command.operationId }); assert.equal(f.stats.writes, 1);
});
test('owner archive conflict issues no automatic retry or overwrite', () => {
  const f = createLifecycleRuntimeFixture('owner'), command = cmd(f); f.hooks.beforePut = () => { f.root.soldier.produksi.produksi[0].privateOwnerNote = 'Concurrent owner change'; };
  assert.deepEqual(f.create().executeOwner(f.input(command)), { ok: false, error: 'conflict' }); assert.equal(f.stats.puts, 1); assert.equal(f.stats.writes, 0); assert.equal(f.root.soldier.produksi.produksi[0].jahit.length, 2);
});
test('QC/Jahit current accounts cannot use owner reads or writes and payload roles cannot select the lane', () => {
  const o = createLifecycleRuntimeFixture('owner'), command = cmd(o); for (const division of ['qc', 'jahit']) { const f = createLifecycleRuntimeFixture(division); assert.deepEqual(f.create().readOwner(f.readInput()), { ok: false, error: 'access_denied' }); assert.deepEqual(f.create().executeOwner(f.input(command)), { ok: false, error: 'access_denied' }); assert.equal(f.stats.puts, 0); }
  assert.deepEqual(o.create().executeOwner({ ...o.input(command), owner: true }), { ok: false, error: 'invalid_request' }); assert.equal(o.stats.puts, 0);
});
test('post-write owner account change returns uncertainty and changed evidence cannot confirm acceptance', () => {
  const f = createLifecycleRuntimeFixture('owner'), command = cmd(f); f.hooks.afterPut = () => { f.account.disabled = true; };
  assert.deepEqual(f.create().executeOwner(f.input(command)), { ok: false, error: 'result_unknown', retrySameCommand: true }); assert.equal(f.stats.writes, 1); delete f.hooks.afterPut;
  assert.equal(f.create().resolveOwner(f.input(command)).ok, false); assert.equal(f.stats.puts, 1);
});
