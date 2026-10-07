'use strict';
// Actual pinned SDK storage/CAS; synthetic identity. Loopback demo only.
const { test } = require('node:test'), assert = require('node:assert/strict');
const HOST = '127.0.0.1:9000', PROJECT = 'demo-soldier-security', URL = 'https://' + PROJECT + '.firebaseio.com';
const FORBIDDEN = ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN', 'GOOGLE_OAUTH_ACCESS_TOKEN', 'CLOUDSDK_AUTH_ACCESS_TOKEN', 'CLOUDSDK_AUTH_ACCESS_TOKEN_FILE', 'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE', 'CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT'];
function fence() { assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, HOST); assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, undefined); assert.ok(FORBIDDEN.every(k => process.env[k] === undefined)); }
fence();
const { initializeApp, deleteApp, SDK_VERSION } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database'); assert.equal(SDK_VERSION, '14.5.0');
const Core = require('../server/production-legacy-lifecycle.cjs');
const F = require('../tests/fixtures/identity-tenant.cjs');
const { fixture: source, POLICY } = require('../tests/fixtures/legacy-lifecycle.cjs');
const bounded = promise => { let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Synthetic loopback operation timed out')), 10000); })]).finally(() => clearTimeout(timer)); };
let sequence = 0;
async function fixture(t) {
  fence(); const marker = 'lifecycle-sdk-' + process.pid + '-' + (++sequence), seed = source(), tenantId = F.TENANT, wireSeed = F.copy(seed.root);
  // Retained identity fixtures are immutable; retarget a detached test copy.
  wireSeed.authorityTenants[tenantId].projectId = PROJECT; wireSeed.__syntheticFixture = marker;
  const app = initializeApp({ projectId: PROJECT, databaseURL: URL, credential: { getAccessToken: async () => ({ access_token: 'owner', expires_in: 3600 }) } }, marker);
  let acquired = false, database, ref;
  t.after(async () => { try { fence(); if (acquired) { const current = (await bounded(ref.get())).val(); assert.equal(current.__syntheticFixture, marker); await bounded(ref.remove()); } } finally { database?.goOffline(); await bounded(deleteApp(app)); } });
  database = getDatabase(app); ref = database.ref('legacyLifecycleSdkProofs/' + marker); assert.equal(ref.toString(), 'http://' + HOST + '/legacyLifecycleSdkProofs/' + marker);
  await bounded(ref.get()); const acquisition = await bounded(ref.transaction(current => current === null ? wireSeed : undefined, undefined, false)); assert.equal(acquisition.committed, true); acquired = true;
  const binding = { projectId: PROJECT, databaseURL: URL, tenantId }, core = Core.createProductionLegacyLifecycle({ enabled: true, binding, clock: () => F.NOW, tariffPolicy: POLICY });
  const qc = { ...seed.qc, projectId: PROJECT }, owner = F.identity({ projectId: PROJECT, uid: 'owner-1', email: 'syntheticowner@gmail.com', googleSubject: '1000099999999' }); let requests = 0;
  const read = async () => { fence(); return (await bounded(ref.get())).val(); };
  async function command(kind, operationId, extra = {}, own = false) { const root = await read(), result = (own ? core.readOwner : core.read)({ root, identity: own ? owner : qc }); assert.equal(result.ok, true, JSON.stringify(result)); return { kind, operationId, requestId: 'sdk-request-' + (++requests), productId: 'product-1', expectedGrantRevision: 1, expectedSourceVersion: result.view.products[0].sourceVersion, ...extra }; }
  async function commit(command, own = false) { fence(); let rejection, listener;
    // A held actual SDK listener supplies the transaction cache. A one-off get
    // is not assumed to keep a value cached for the first update callback.
    try {
      await bounded(new Promise((resolve, reject) => { listener = () => resolve(); ref.on('value', listener, reject); }));
      const result = await bounded(ref.transaction(root => { const proposed = (own ? core.executeOwner : core.execute)({ root, identity: own ? owner : qc, command }); if (!proposed.ok) { rejection = proposed; return undefined; } return proposed.next; }, undefined, false));
      return { result, rejection };
    } finally { if (listener) ref.off('value', listener); }
  }
  async function resolve(command, own = false) { return (own ? core.resolveOwner : core.resolve)({ root: await read(), identity: own ? owner : qc, command }); }
  const archive = () => command('ownerArchiveCycle', 'owner-operation', { archiveId: 'new-archive', label: 'Synthetic stored cycle', startNewPO: false }, true);
  return { read, command, commit, resolve, archive, core, qc, owner, ref };
}
test('genuine SDK pruning retains count and archive receipts across empty collections and restore', { timeout: 30000 }, async t => {
  const f = await fixture(t), count = await f.command('appendCount', 'count-1', { workerId: 'worker-1', quantity: 8, workDate: '2026-10-06' }); assert.equal((await f.commit(count)).result.committed, true);
  assert.equal((await f.resolve(count)).receipt.replayed, true); const archive = await f.archive(); assert.equal((await f.commit(archive, true)).result.committed, true);
  const stored = await f.read(), p = stored.soldier.produksi.produksi[0]; assert.equal(Object.hasOwn(p, 'hitungFisik'), false); assert.equal(p.arsip.find(a => a.id === 'new-archive').jahit[1].total, 198); assert.equal((await f.resolve(count)).receipt.replayed, true); assert.equal((await f.resolve(archive, true)).receipt.replayed, true);
  const restore = await f.command('ownerRestoreCycle', 'restore-operation', { archiveId: 'new-archive', safetyArchiveId: null, safetyLabel: null }, true); assert.equal((await f.commit(restore, true)).result.committed, true); assert.equal((await f.resolve(count)).receipt.replayed, true); assert.equal((await f.resolve(archive, true)).receipt.replayed, true);
});
test('genuine SDK deletion of final count preserves acceptance after Firebase removes the collection', { timeout: 30000 }, async t => {
  const f = await fixture(t), count = await f.command('appendCount', 'count-1', { workerId: 'worker-1', quantity: 8, workDate: '2026-10-06' }); assert.equal((await f.commit(count)).result.committed, true);
  const deletion = await f.command('deleteCount', 'count-1'); assert.equal((await f.commit(deletion)).result.committed, true); assert.equal(Object.hasOwn((await f.read()).soldier.produksi.produksi[0], 'hitungFisik'), false);
  for (const cmd of [count, deletion]) assert.equal((await f.resolve(cmd)).receipt.replayed, true);
});
test('genuine committed archive with injected missing ACK resolves once and rejects a changed payload', { timeout: 30000 }, async t => {
  const f = await fixture(t), cmd = await f.archive(); const commitThenLose = async () => { const r = await f.commit(cmd, true); assert.equal(r.result.committed, true); throw Error('SYNTHETIC_ACK_LOST_AFTER_REAL_COMMIT'); };
  await assert.rejects(commitThenLose(), /SYNTHETIC_ACK_LOST/); assert.equal((await f.resolve(cmd, true)).receipt.replayed, true); assert.equal((await f.resolve({ ...cmd, label: 'Altered' }, true)).ok, false); assert.equal((await f.read()).soldier.produksi.produksi[0].arsip.filter(a => a.id === 'new-archive').length, 1);
});
test('genuine concurrent owner changes accept one version and retain the losing command as a conflict', { timeout: 30000 }, async t => {
  const f = await fixture(t), a = await f.archive(), b = { ...a, requestId: 'competing-owner', operationId: 'competing-operation', archiveId: 'competing-archive' };
  const results = await Promise.all([f.commit(a, true), f.commit(b, true)]); assert.equal(results.filter(r => r.result.committed).length, 1); assert.equal(results.find(r => !r.result.committed).rejection.error, 'conflict'); const p = (await f.read()).soldier.produksi.produksi[0]; assert.equal(p.arsip.length, 2); assert.equal(p.arsip[0].jahit[0].total, 333.75);
});

test('genuine SDK owner payment corrections retain paid evidence and prior count receipts after archive', { timeout: 30000 }, async t => {
  const f = await fixture(t), count = await f.command('appendCount', 'count-paid-1', { workerId: 'worker-1', quantity: 8, workDate: '2026-10-06' }); assert.equal((await f.commit(count)).result.committed, true);
  const paid = await f.command('ownerSetPaid', 'payment-operation-1', { recordId: 'count-paid-1', family: 'hitungFisik', paid: true, workDate: '2026-10-06', reviewed: true }, true); assert.equal((await f.commit(paid, true)).result.committed, true);
  const clear = await f.command('ownerSetPaid', 'payment-operation-2', { recordId: 'count-paid-1', family: 'hitungFisik', paid: false, workDate: null, reviewed: true }, true); assert.equal((await f.commit(clear, true)).result.committed, true);
  const h = (await f.read()).soldier.produksi.produksi[0].hitungFisik[0]; assert.equal(h.dibayar, false); assert.equal(Object.hasOwn(h, 'dibayarAt'), false); assert.equal(h.paymentCorrections[1].before.dibayar, true); assert.equal(h.paymentCorrections[1].before.tanggalBayar, '2026-10-06');
  const archive = await f.archive(); assert.equal((await f.commit(archive, true)).result.committed, true); assert.equal((await f.resolve(count)).receipt.replayed, true); for (const cmd of [paid, clear, archive]) assert.equal((await f.resolve(cmd, true)).receipt.replayed, true);
});

test('genuine SDK committed payment note resolves once after lost acknowledgement and later owner correction', { timeout: 30000 }, async t => {
  const f = await fixture(t), add = await f.command('ownerAppendPaymentNote', 'payment-add-operation', { recordId: 'payment-note-1', workDate: '2026-10-06' }, true);
  const lost = async () => { assert.equal((await f.commit(add, true)).result.committed, true); throw Error('SYNTHETIC_PAYMENT_ACK_LOST'); }; await assert.rejects(lost(), /SYNTHETIC_PAYMENT_ACK_LOST/);
  const edit = await f.command('ownerEditPaymentNote', 'payment-edit-operation', { recordId: 'payment-note-1', workDate: '2026-10-05' }, true); assert.equal((await f.commit(edit, true)).result.committed, true); assert.equal((await f.resolve(add, true)).receipt.replayed, true);
  const p = (await f.read()).soldier.produksi.produksi[0]; assert.equal(p.bayarJahit.length, 1); assert.equal(p.bayarJahit[0].tanggal, '2026-10-05'); assert.equal(p.jahit[0].total, 20); assert.equal(p.jahit[0].dibayar, false);
});

test('genuine SDK reviewed sewing amount preserves original observations and stale owner command cannot overwrite it', { timeout: 30000 }, async t => {
  const f = await fixture(t), stale = await f.command('ownerEditAssignment', 'stale-assignment-operation', { assignmentId: 'assignment-1', workerId: 'worker-1', quantity: 8, workDate: '2026-10-06', targetDate: null, note: 'stale' }, true);
  const edit = await f.command('ownerEditJahit', 'reviewed-sewing-operation', { recordId: 'sewn-1', workerId: 'worker-1', workDate: '2026-10-06', good: 7, reject: 0, amountMode: 'reviewed', rate: 2.5, total: 19.25 }, true); assert.equal((await f.commit(edit, true)).result.committed, true);
  const rejected = await f.commit(stale, true); assert.equal(rejected.result.committed, false); assert.equal(rejected.rejection.error, 'conflict'); const row = (await f.read()).soldier.produksi.produksi[0].jahit[0]; assert.equal(row.total, 19.25); assert.equal(row.amountCorrections[0].before.total, 20); assert.equal(row.amountCorrections[0].before.jumlah, 8); assert.equal(row.private, 'SYNTHETIC_ROW_PRIVATE'); assert.equal((await f.resolve(edit, true)).receipt.replayed, true);
});
