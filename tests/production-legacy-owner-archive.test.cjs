'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../server/production-legacy-lifecycle.cjs');
const Finance = require('../server/production-legacy-finance.cjs');
const F = require('./fixtures/identity-tenant.cjs');
const { fixture, POLICY } = require('./fixtures/legacy-lifecycle.cjs');
const owner = () => F.identity({ uid: 'owner-1', email: 'syntheticowner@gmail.com', googleSubject: '1000099999999' });
function harness() {
  const f = fixture(); let sequence = 0;
  const read = (identity = owner()) => f.api.readOwner({ root: f.root, identity });
  const command = (kind, extra, identity = owner()) => ({ kind, requestId: 'owner-request-' + (++sequence), operationId: 'owner-operation-' + sequence, productId: 'product-1', expectedGrantRevision: 1, expectedSourceVersion: read(identity).view.products[0].sourceVersion, ...extra });
  const execute = (cmd, identity = owner()) => f.api.executeOwner({ root: f.root, identity, command: cmd });
  const resolve = (cmd, identity = owner()) => f.api.resolveOwner({ root: f.root, identity, command: cmd });
  const apply = cmd => { const r = execute(cmd); assert.equal(r.ok, true, JSON.stringify(r)); replace(r.next); return r; };
  const replace = next => { Object.keys(f.root).forEach(k => delete f.root[k]); Object.assign(f.root, F.copy(next)); };
  const archive = (archiveId = 'archive-new') => command('ownerArchiveCycle', { archiveId, label: 'Synthetic archived PO', startNewPO: false });
  const restore = (archiveId = 'archive-new', safetyArchiveId = null, safetyLabel = null) => command('ownerRestoreCycle', { archiveId, safetyArchiveId, safetyLabel });
  const finance = () => Finance.createProductionLegacyFinance({ enabled: true, binding: f.binding, clock: () => F.NOW, tariffPolicy: POLICY }).read({ root: f.root, identity: f.partner });
  return { ...f, readOwner: read, ownerCommand: command, executeOwner: execute, resolveOwner: resolve, applyOwner: apply, replace, archive, restore, finance };
}
// Explicit storage model for focused tests; genuine SDK cases cover this too.
function prunedMaps(value) {
  if (value == null) return null;
  if (typeof value !== 'object') return value;
  const out = {}; for (const key of Object.keys(value)) { const next = prunedMaps(value[key]); if (next !== null) out[key] = next; }
  return Object.keys(out).length ? out : null;
}
test('all owner methods remain SOURCE OFF before any configuration or request getter', () => {
  let called = 0; const config = { enabled: false }; Object.defineProperty(config, 'binding', { get() { called++; throw Error(); } }); const raw = new Proxy({}, { ownKeys() { called++; throw Error(); } });
  const api = Core.createProductionLegacyLifecycle(config); for (const method of ['readOwner', 'captureOwner', 'executeOwner', 'resolveOwner']) assert.deepEqual(api[method](raw), { ok: false, error: 'service_disabled' }); assert.equal(called, 0);
});
test('owner archive projection authenticates the retained initial owner and returns no raw records, money or credentials', () => {
  const f = harness(), before = F.copy(f.root), result = f.readOwner(); assert.equal(result.ok, true); assert.equal(result.view.binding.division, 'owner');
  for (const marker of ['tarif', 'total', 'pin', 'googleSubject', 'email', 'authorityTenants', 'SYNTHETIC_', 'privateCost', 'payroll']) assert.equal(JSON.stringify(result.view).includes(marker), false, marker);
  for (const identity of [f.partner, f.qc, { ...owner(), uid: 'unknown-1' }]) assert.equal(f.readOwner(identity).ok, false);
  assert.deepEqual(f.root, before); assert.equal(Object.isFrozen(result.view.products[0]), true);
});
test('partner and QC cannot submit or resolve owner commands through either lane', () => {
  const f = harness(), cmd = f.archive(), before = F.copy(f.root); for (const identity of [f.partner, f.qc]) { assert.equal(f.executeOwner(cmd, identity).ok, false); assert.equal(f.resolveOwner(cmd, identity).ok, false); assert.equal(f.api.execute({ root: f.root, identity, command: cmd }).ok, false); } assert.deepEqual(f.root, before);
});
test('archiving moves every current cycle exactly, preserves paid and anomalous stored values, and leaves unrelated data intact', () => {
  const f = harness(); f.p().poKet = 'Original PO'; f.p().bigSeller = true; f.p().needsVerify = true; f.p().bayarJahit = [{ id: 'payment-note', nominal: 765.25 }]; f.ready(); f.inspect();
  const before = F.copy(f.root), original = F.copy(f.p()), cmd = f.archive(); f.applyOwner(cmd); const arc = f.p().arsip.find(a => a.id === 'archive-new');
  for (const field of ['potong', 'bigSaller', 'bayarJahit', 'gudang', 'jahit', 'assignJahit', 'qc', 'hitungFisik']) { assert.deepEqual(arc[field], original[field]); assert.deepEqual(f.p()[field], []); }
  assert.equal(arc.potong[0].total, 999.75); assert.equal(arc.jahit[1].dibayar, true); assert.equal(arc.poJumlah, 10); assert.equal(arc.poKet, 'Original PO'); assert.equal(arc.bigSeller, true); assert.equal(arc.needsVerify, true); assert.equal(f.p().poAktif, false);
  assert.deepEqual(f.p().arsip[0], original.arsip[0]); assert.deepEqual(f.root.authorityTenants, before.authorityTenants); assert.deepEqual(f.root.soldier.produksi_meta, before.soldier.produksi_meta); assert.deepEqual(f.root.soldier.produksi.images, before.soldier.produksi.images); assert.equal(f.root.privateRoot, before.privateRoot);
});
test('count, inspection and repair receipts remain resolvable after archive, storage pruning and restore', () => {
  const f = harness(), count = f.cmd('appendCount', 'count-1', { workerId: 'worker-1', quantity: 8, workDate: '2026-10-06' }); f.apply(count); f.count('worker-2', 2, 'count-2');
  const quality = f.cmd('inspectCount', 'quality-row-1', { countId: 'count-1', workDate: '2026-10-06', totals: { ok: 5, perbaikan: 2, reject: 1, offline: 0 }, note: '' }); f.apply(quality);
  const repair = f.cmd('repairQC', 'quality-row-1', { quantity: 1, workDate: '2026-10-06' }); f.apply(repair); const archive = f.archive(); f.applyOwner(archive); f.replace(prunedMaps(f.root));
  for (const command of [count, quality, repair]) assert.equal(f.api.resolve({ root: f.root, identity: f.qc, command }).receipt.replayed, true);
  assert.equal(f.resolveOwner(archive).receipt.replayed, true); const restore = f.restore(); f.applyOwner(restore); f.replace(prunedMaps(f.root));
  for (const command of [count, quality, repair]) assert.equal(f.api.resolve({ root: f.root, identity: f.qc, command }).receipt.replayed, true);
  assert.equal(f.resolveOwner(archive).receipt.replayed, true); assert.equal(f.resolveOwner(restore).receipt.replayed, true); assert.equal(Object.values(f.p().hitungFisik).filter(h => h.id === 'count-1').length, 1);
});
test('own finance retains original observations and dated frozen count/repair earnings after archiving', () => {
  const f = harness(); f.ready(); f.inspect(); f.apply(f.cmd('repairQC', 'quality-row-1', { quantity: 1, workDate: '2026-10-06' })); const before = f.finance(); f.applyOwner(f.archive()); const after = f.finance();
  const ordered = records => records.slice().sort((a, b) => a.sourceRecordId.localeCompare(b.sourceRecordId));
  assert.equal(after.ok, true); assert.deepEqual(after.view.slip, before.view.slip); assert.deepEqual(ordered(after.view.storedJahit.records), ordered(before.view.storedJahit.records)); assert.equal(JSON.stringify(after.view).includes('worker-2'), false);
});
test('archive confirmation loss resolves exactly once without recreating current work or another archive', () => {
  const f = harness(), cmd = f.archive(); f.applyOwner(cmd); f.replace(prunedMaps(f.root)); const before = F.copy(f.root); assert.equal(f.resolveOwner(cmd).receipt.replayed, true); assert.equal(f.executeOwner(cmd).receipt.replayed, true); assert.deepEqual(f.root, before); assert.equal(Object.values(f.p().arsip).filter(a => a.id === 'archive-new').length, 1); assert.equal(f.executeOwner({ ...cmd, label: 'Changed payload' }).ok, false);
});
test('restore autoarchives current work instead of overwriting either current or archived paid values', () => {
  const f = harness(), old = F.copy(f.p().arsip[0]), current = F.copy(f.p()); const cmd = f.restore('archive-1', 'safety-archive', 'Synthetic current cycle backup'); f.applyOwner(cmd);
  const safety = f.p().arsip.find(a => a.id === 'safety-archive'); assert.deepEqual(safety.jahit, current.jahit); assert.deepEqual(safety.potong, current.potong); assert.deepEqual(f.p().jahit, old.jahit); assert.equal(f.p().jahit[0].total, 333.75); assert.equal(f.p().poAktif, true); assert.equal(f.p().arsip.some(a => a.id === 'archive-1'), false);
  assert.equal(f.resolveOwner(cmd).receipt.replayed, true);
});
test('archive label edits extend the archive chain, preserve content and keep prior archive receipt valid', () => {
  const f = harness(), original = f.archive(); f.applyOwner(original); const before = F.copy(f.p().arsip.find(a => a.id === 'archive-new'));
  const cmd = f.ownerCommand('ownerRelabelArchive', { archiveId: 'archive-new', label: 'Reviewed archive label' }); f.applyOwner(cmd); const after = f.p().arsip.find(a => a.id === 'archive-new'); assert.deepEqual({ ...after, label: before.label }, before); assert.equal(f.resolveOwner(original).receipt.replayed, true); assert.equal(f.resolveOwner(cmd).receipt.replayed, true);
});
test('PO changes extend controlled history while leaving stored totals and earlier report receipts intact', () => {
  const f = harness(), count = f.cmd('appendCount', 'count-1', { workerId: 'worker-1', quantity: 8, workDate: '2026-10-06' }); f.apply(count); const old = F.copy(f.p().jahit);
  const cmd = f.ownerCommand('ownerSetPO', { active: false, quantity: 12, workDate: '2026-10-05', note: 'Owner reviewed PO' }); f.applyOwner(cmd); assert.deepEqual(f.p().jahit, old); assert.equal(f.p().poJumlah, 12); assert.equal(f.api.resolve({ root: f.root, identity: f.qc, command: count }).receipt.replayed, true); assert.equal(f.resolveOwner(cmd).receipt.replayed, true);
});
test('stale owner snapshots, duplicate archive IDs, missing safety backup and extra financial/identity selectors fail without writes', () => {
  const f = harness(); const cases = [{ ...f.archive(), expectedSourceVersion: '0'.repeat(64) }, { ...f.archive(), archiveId: 'archive-1' }, { ...f.archive(), total: 1 }, { ...f.archive(), uid: 'owner-1' }, { ...f.archive(), label: '' }, f.restore('archive-1'), f.ownerCommand('ownerSetPO', { active: true, quantity: 10, workDate: '2026-10-07', note: '' })];
  for (const cmd of cases) { const before = F.copy(f.root); assert.equal(f.executeOwner(cmd).ok, false); assert.deepEqual(f.root, before); }
});
test('owner source version changes on concurrent money changes rather than overwriting them', () => {
  const f = harness(), cmd = f.archive(); f.p().jahit[0].total = 987.75; const before = F.copy(f.root); assert.equal(f.executeOwner(cmd).ok, false); assert.deepEqual(f.root, before);
});
test('map-backed archives/cycles and null placeholders retain keys and financial observations', () => {
  const f = harness(); f.p().arsip = { retained: null, oldKey: f.p().arsip[0] }; f.p().jahit = { zero: f.p().jahit[0], gap: null, third: f.p().jahit[1] }; const original = F.copy(f.p().jahit); const cmd = f.archive(); f.applyOwner(cmd); assert.deepEqual(f.p().arsip['archive-new'].jahit, original); assert.equal(f.p().arsip.retained, null); f.applyOwner(f.restore()); assert.deepEqual(f.p().jahit, original); assert.equal(f.p().arsip.oldKey.id, 'archive-1');
});
test('empty collections pruned after deleting the last count do not invalidate accepted receipts', () => {
  const f = harness(), count = f.cmd('appendCount', 'count-1', { workerId: 'worker-1', quantity: 8, workDate: '2026-10-06' }); f.apply(count); const deletion = f.cmd('deleteCount', 'count-1'); f.apply(deletion); f.replace(prunedMaps(f.root)); assert.equal(Object.hasOwn(f.p(), 'hitungFisik'), false); for (const command of [count, deletion]) assert.equal(f.api.resolve({ root: f.root, identity: f.qc, command }).receipt.replayed, true);
});
test('unknown direct archive/PO edits cannot reset or silently rebase retained evidence', () => {
  const f = harness(), archive = f.archive(); f.applyOwner(archive); const clean = F.copy(f.root); f.p().arsip[1].jahit[0].total = 987.75; assert.equal(f.resolveOwner(archive).ok, false); f.replace(clean); f.p().poAktif = true; assert.equal(f.resolveOwner(archive).ok, false);
});
test('legacy policy version is rejected rather than reset under new wire-compatible history', () => {
  const f = harness(); f.count(); const ledger = f.root.legacyLifecycleReceipts[F.TENANT]; ledger.schemaVersion = 1; ledger.policyVersion = 'legacy-lifecycle-current-v1'; const before = F.copy(f.root); assert.equal(f.executeOwner(f.archive()).ok, false); assert.deepEqual(f.root, before);
});
