'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../server/production-legacy-lifecycle.cjs');
const F = require('./fixtures/identity-tenant.cjs');
const { fixture } = require('./fixtures/legacy-lifecycle.cjs');
const owner = () => F.identity({ uid: 'owner-1', email: 'syntheticowner@gmail.com', googleSubject: '1000099999999' });
function harness() {
  const f = fixture(); let seq = 0;
  const read = (who = owner()) => f.api.readBusiness({ root: f.root, identity: who });
  const cmd = changes => ({ kind: 'ownerBusinessWrite', requestId: 'business-request-' + (++seq), expectedGrantRevision: 1, expectedSourceVersion: read().view.sourceVersion, changes });
  const execute = (command, identity = owner()) => f.api.executeOwnerBusiness({ root: f.root, identity, command });
  const resolve = (command, identity = owner()) => f.api.resolveOwnerBusiness({ root: f.root, identity, command });
  const replace = next => { Object.keys(f.root).forEach(k => delete f.root[k]); Object.assign(f.root, F.copy(next)); };
  const apply = command => { const r = execute(command); assert.equal(r.ok, true, JSON.stringify(r)); replace(r.next); return r; };
  const modify = (path, mutate) => { const value = F.copy({ v: path.split('/').reduce((p, k) => p[k], read().view.business) }).v; mutate(value); return cmd([{ path, action: 'set', value }]); };
  return { ...f, owner, readBusiness: read, businessCommand: cmd, executeBusiness: execute, resolveBusiness: resolve, applyBusiness: apply, replace, modify };
}
test('owner business source OFF does not touch request/config accessors', () => {
  let calls = 0; const options = { enabled: false }; Object.defineProperty(options, 'binding', { get() { calls++; throw Error(); } });
  const raw = new Proxy({}, { ownKeys() { calls++; throw Error(); } });
  const api = Core.createProductionLegacyLifecycle(options); for (const m of ['readBusiness', 'executeOwnerBusiness', 'resolveOwnerBusiness']) assert.deepEqual(api[m](raw), { ok: false, error: 'service_disabled' }); assert.equal(calls, 0);
});
test('bounded owner projection includes only business roots and suppresses credentials/photos/foreign identity metadata', () => {
  const f = harness(); f.p().jahit[0].inputBy = 'synthetic-foreign-uid'; f.p().jahit[0].device_info = { token: 'synthetic' }; f.root.soldier.produksi_meta.tukangJahit[0].authorization = 'SYNTHETIC';
  const before = F.copy(f.root), r = f.readBusiness(); assert.equal(r.ok, true); assert.equal(r.view.schemaVersion, 1); assert.equal(r.view.binding.uid, 'owner-1'); assert.equal(r.view.binding.workerId, null); assert.equal(r.view.binding.division, 'owner');
  assert.deepEqual(Object.keys(r.view.business.soldier).sort(), ['produksi', 'produksi_meta']);
  const payload = JSON.stringify(r.view.business); for (const value of ['SYNTHETIC_PIN', 'SYNTHETIC_IMAGE', 'synthetic-foreign-uid', 'authorityTenants', 'privateRoot', 'privateCash', 'authorization', 'device_info']) assert.equal(payload.includes(value), false, value);
  assert.equal(r.view.business.soldier.produksi_meta.tukangJahit[0].tarif['Synthetic_Series|Item'], 7.5); assert.equal(r.view.business.soldier.produksi.produksi[0].jahit[0].total, 20);
  assert.deepEqual(f.root, before); assert.equal(Object.isFrozen(r.view.business.soldier.produksi.produksi), true);
});
test('QC, partner, unknown and stale Google callers cannot read, write or resolve owner business', () => {
  const f = harness(), cmd = f.modify('soldier/produksi', v => { v.produksi[0].poKet = 'Owner note'; }), before = F.copy(f.root);
  for (const who of [f.partner, f.qc, { ...owner(), uid: 'unknown' }, { ...owner(), expiresAtMs: 1 }]) for (const method of [() => f.readBusiness(who), () => f.executeBusiness(cmd, who), () => f.resolveBusiness(cmd, who)]) assert.equal(method().ok, false);
  assert.deepEqual(f.root, before);
});
test('fixed path, exact command, overlap, secret and photo attempts reject without mutation', () => {
  const f = harness(), valid = f.modify('soldier/produksi', v => { v.produksi[0].poKet = 'Note'; });
  const cases = [{ ...valid, uid: 'owner-1' }, { ...valid, changes: [{ path: '/', action: 'set', value: {} }] }, { ...valid, changes: [{ path: 'soldier', action: 'set', value: {} }] }, { ...valid, changes: [{ path: 'authorityTenants', action: 'set', value: {} }] }, { ...valid, changes: [{ path: 'soldier/produksi/images', action: 'set', value: {} }] }, { ...valid, changes: [{ path: 'soldier/produksi', action: 'set', value: {} }, { path: 'soldier/produksi/produksi', action: 'set', value: [] }] }, { ...valid, changes: [{ path: 'soldier/produksi_meta', action: 'set', value: { pin: 'x' } }] }, { ...valid, changes: [{ path: 'soldier/produksi_meta', action: 'set', value: { access_token: 'x' } }] }, { ...valid, changes: [{ path: 'soldier/produksi', action: 'remove' }] }];
  for (const cmd of cases) { const before = F.copy(f.root); assert.equal(f.executeBusiness(cmd).ok, false); assert.deepEqual(f.root, before); }
});
test('ordinary PO edit preserves suppressed data, all authority and unrelated raw values', () => {
  const f = harness(), before = F.copy(f.root), cmd = f.modify('soldier/produksi', v => { v.produksi[0].poKet = 'Owner approved note'; });
  f.applyBusiness(cmd); assert.equal(f.p().poKet, 'Owner approved note'); assert.deepEqual(f.root.authorityTenants, before.authorityTenants); assert.deepEqual(f.root.soldier.produksi.images, before.soldier.produksi.images); assert.deepEqual(f.root.soldier.produksi_meta, before.soldier.produksi_meta); assert.deepEqual(f.p().jahit, before.soldier.produksi.produksi[0].jahit); assert.equal(f.root.privateRoot, before.privateRoot); assert.equal(f.root.soldier.privateCash, before.soldier.privateCash);
});
test('worker tariff append reflects current owner edit without repricing any report or frozen QC snapshot', () => {
  const f = harness(); f.root.soldier.produksi_meta.tukangJahit[0].tarifHistory['Synthetic_Series|Item'][1].effectiveAt = F.BEFORE; f.ready(); const before = F.copy(f.root), cmd = f.modify('soldier/produksi_meta', v => { const w = v.tukangJahit[0]; w.tarif['Synthetic_Series|Item'] = 8.25; w.tarifHistory['Synthetic_Series|Item'].push({ effectiveAt: F.NOW, rate: 8.25 }); });
  f.applyBusiness(cmd); assert.equal(f.root.soldier.produksi_meta.tukangJahit[0].tarif['Synthetic_Series|Item'], 8.25); assert.equal(f.root.soldier.produksi_meta.tukangJahit[0].pin, 'SYNTHETIC_PIN'); assert.deepEqual(f.p(), before.soldier.produksi.produksi[0]);
});
test('tariff-history rewrites and identity/active changes do not reset retained owner/catalog authority', () => {
  const f = harness(); for (const mutate of [v => { v.tukangJahit[0].tarifHistory['Synthetic_Series|Item'][0].rate = 88; }, v => { v.tukangJahit.splice(0, 1); }, v => { v.tukangJahit[0].active = false; }]) { const cmd = f.modify('soldier/produksi_meta', mutate), before = F.copy(f.root); assert.equal(f.executeBusiness(cmd).ok, false); assert.deepEqual(f.root, before); }
});
test('stale business snapshots and changed exact-payload replays fail without overwriting current edits', () => {
  const f = harness(), stale = f.modify('soldier/produksi', v => { v.produksi[0].poKet = 'Stale'; }); f.applyBusiness(f.modify('soldier/produksi', v => { v.produksi[0].poKet = 'Fresh'; })); const before = F.copy(f.root); assert.equal(f.executeBusiness(stale).error, 'conflict'); assert.deepEqual(f.root, before);
  const cmd = f.modify('soldier/produksi', v => { v.produksi[0].poKet = 'Accepted'; }); f.applyBusiness(cmd); assert.equal(f.resolveBusiness({ ...cmd, changes: [{ ...cmd.changes[0], value: { ...cmd.changes[0].value, unexpected: true } }] }).error, 'conflict');
});
test('unknown lost ACK remains unknown; accepted command resolves exactly after later ordinary QC and owner commands', () => {
  const f = harness(), unknown = f.modify('soldier/produksi', v => { v.produksi[0].poKet = 'Missing'; }); assert.equal(f.resolveBusiness(unknown).error, 'result_unknown');
  const cmd = f.modify('soldier/produksi', v => { v.produksi[0].poKet = 'Accepted'; }); f.applyBusiness(cmd); f.count(); f.applyBusiness(f.modify('soldier/produksi', v => { v.produksi[0].poKet = 'Later'; })); const before = F.copy(f.root);
  assert.deepEqual(f.resolveBusiness(cmd), { ok: true, receipt: { ok: true, replayed: true, requestId: cmd.requestId } }); assert.equal(f.executeBusiness(cmd).receipt.replayed, true); assert.deepEqual(f.root, before);
});
test('business edits extend same product-family chain and prior semantic count receipt stays valid', () => {
  const f = harness(), count = f.cmd('appendCount', 'count-proof', { workerId: 'worker-1', quantity: 8, workDate: '2026-10-06' }); f.apply(count);
  const oldHead = f.root.legacyLifecycleReceipts[F.TENANT].heads['product-1|poControls']; f.applyBusiness(f.modify('soldier/produksi', v => { v.produksi[0].poKet = 'New control'; }));
  assert.notDeepEqual(f.root.legacyLifecycleReceipts[F.TENANT].heads['product-1|poControls'], oldHead); assert.equal(f.api.resolve({ root: f.root, identity: f.qc, command: count }).receipt.replayed, true); f.count('worker-2', 2, 'later-count');
});
test('untracked family tampering fails closed before unrelated business write or receipt resolution', () => {
  const f = harness(); f.count(); const cmd = f.modify('soldier/produksi_meta', v => { v.tukangJahit[0].nama = 'Owner display edit'; }); f.p().hitungFisik[0].jumlah = 7; const before = F.copy(f.root); assert.equal(f.executeBusiness(cmd).error, 'conflict'); assert.deepEqual(f.root, before);
});
test('removed product becomes invisible while raw records and earlier semantic receipts remain retained', () => {
  const f = harness(), count = f.cmd('appendCount', 'delete-count-proof', { workerId: 'worker-1', quantity: 8, workDate: '2026-10-06' }); f.apply(count); const original = F.copy(f.p());
  const cmd = f.modify('soldier/produksi/produksi', v => { v.splice(0, 1); }); f.applyBusiness(cmd); assert.deepEqual(f.readBusiness().view.business.soldier.produksi.produksi, []); assert.deepEqual(f.p(), original); assert.equal(f.api.resolve({ root: f.root, identity: f.qc, command: count }).receipt.replayed, true); assert.equal(f.resolveBusiness(cmd).receipt.replayed, true);
  assert.equal(f.executeBusiness(f.businessCommand([{ path: 'soldier/produksi_deleted_ids', action: 'set', value: [] }])).error, 'conflict');
});
test('nulls, empty maps/arrays and unknown stored fields survive unrelated business edits exactly', () => {
  const f = harness(); f.root.soldier.hpp = { emptyArray: [], emptyMap: {}, nullValue: null, decimal: 1.25, sparseMap: { 0: { x: null }, 7: {} } }; f.p().futureFields = { null: null, array: [], map: {} }; const before = F.copy(f.root.soldier.hpp);
  f.applyBusiness(f.modify('soldier/produksi', v => { v.produksi[0].poKet = 'Changed'; })); assert.deepEqual(f.root.soldier.hpp, before); assert.deepEqual(f.p().futureFields, { null: null, array: [], map: {} });
});
test('idless reports cannot be silently changed, removed or inferred from labels', () => {
  const f = harness(); f.p().jahit.push({ tukangNama: 'Synthetic partner', total: 99.75 });
  for (const mutate of [v => { v[0].jahit.at(-1).total = 1; }, v => { v[0].jahit.pop(); }]) { const cmd = f.modify('soldier/produksi/produksi', mutate), before = F.copy(f.root); assert.equal(f.executeBusiness(cmd).ok, false); assert.deepEqual(f.root, before); }
});
test('paid stored wages cannot be repriced or deleted by a broad owner snapshot', () => {
  const f = harness(); for (const mutate of [v => { v[0].jahit[1].total = 1; }, v => { v[0].jahit.splice(1, 1); }]) { const cmd = f.modify('soldier/produksi/produksi', mutate), before = F.copy(f.root); assert.equal(f.executeBusiness(cmd).error, 'conflict'); assert.deepEqual(f.root, before); }
});
test('own loan and installment update requires exact reviewed worker ID and coherent stored residual', () => {
  const f = harness(); f.root.soldier.produksi_meta.kasbonJahit = [{ id: 'loan-1', tukangId: 'worker-1', tanggal: '2026-10-06', jumlah: 100.25, sisa: 100.25, status: 'aktif', cicilan: [] }];
  const cmd = f.modify('soldier/produksi_meta', v => { const k = v.kasbonJahit[0]; k.cicilan.push({ id: 'installment-1', tanggal: '2026-10-06', jumlah: 40.25 }); k.sisa = 60; }); f.applyBusiness(cmd); assert.equal(f.root.soldier.produksi_meta.kasbonJahit[0].sisa, 60);
  for (const mutate of [v => { v.kasbonJahit[0].sisa = 1; }, v => { delete v.kasbonJahit[0].tukangId; v.kasbonJahit[0].tukang = 'Synthetic partner'; }]) { const cmd = f.modify('soldier/produksi_meta', mutate), before = F.copy(f.root); assert.equal(f.executeBusiness(cmd).ok, false); assert.deepEqual(f.root, before); }
});
test('staged QC snapshots reject changed frozen payroll and unlinked duplicate earnings', () => {
  const f = harness(); f.ready(); f.inspect();
  for (const mutate of [v => { v[0].qc[0].payroll.rate = 999; }, v => { v[0].gudang.push({ ...v[0].gudang[0], id: 'orphan-mirror', qcId: 'unknown-qc' }); }, v => { v[0].qc[0].ok++; }]) { const cmd = f.modify('soldier/produksi/produksi', mutate), before = F.copy(f.root); assert.equal(f.executeBusiness(cmd).ok, false); assert.deepEqual(f.root, before); }
});
test('strict root codec rejects array holes, accessors, alternate prototypes and oversized commands', () => {
  const f = harness(), normal = f.modify('soldier/produksi', v => { v.produksi[0].poKet = 'Note'; }); const hole = []; hole.length = 2; const getter = {}; Object.defineProperty(getter, 'x', { enumerable: true, get() { throw Error('must not run'); } });
  for (const value of [hole, getter, new Date(), { large: 'x'.repeat(Core.MAX_BUSINESS_BYTES) }]) assert.equal(f.executeBusiness({ ...normal, changes: [{ path: 'soldier/hpp', action: 'set', value }] }).ok, false);
});
test('map-backed product edits preserve map keys and suppressed fields without array-index matching', () => {
  const f = harness(), p = F.copy(f.p()); f.root.soldier.produksi.produksi = { zero: null, retained: p }; p.jahit[0].inputBy = 'synthetic-author';
  const cmd = f.modify('soldier/produksi', v => { v.produksi.retained.poKet = 'Map note'; }); f.applyBusiness(cmd);
  assert.equal(f.root.soldier.produksi.produksi.zero, null); assert.equal(f.root.soldier.produksi.produksi.retained.jahit[0].inputBy, 'synthetic-author'); assert.equal(f.readBusiness().view.business.soldier.produksi.produksi.retained.poKet, 'Map note');
});
test('previously hidden products do not shift correspondence or copy credentials into another explicit product', () => {
  const f = harness(), other = { ...F.copy(f.p()), id: 'product-2', secret: 'SYNTHETIC_HIDDEN', jahit: [], assignJahit: [] }; f.root.soldier.produksi.produksi.unshift(other); f.root.soldier.produksi_deleted_ids = ['product-2'];
  const cmd = f.modify('soldier/produksi/produksi', v => { v[0].poKet = 'Visible only'; }); f.applyBusiness(cmd);
  const actual = f.root.soldier.produksi.produksi.find(p => p.id === 'product-1'), hidden = f.root.soldier.produksi.produksi.find(p => p.id === 'product-2'); assert.equal(actual.poKet, 'Visible only'); assert.equal(Object.hasOwn(actual, 'secret'), false); assert.equal(hidden.secret, 'SYNTHETIC_HIDDEN'); assert.equal(f.readBusiness().view.business.soldier.produksi.produksi.length, 1);
});
test('explicit unpaid stored-total correction records before fields while all unrelated historical values remain exact', () => {
  const f = harness(), old = F.copy(f.p().jahit), cmd = f.modify('soldier/produksi/produksi', v => { v[0].jahit[0].total = 21.75; }); f.applyBusiness(cmd);
  assert.equal(f.p().jahit[0].total, 21.75); assert.equal(f.p().jahit[0].tarif, old[0].tarif); assert.deepEqual(f.p().jahit[1], old[1]); assert.equal(f.p().jahit[0].ownerBusinessCorrections[0].before.total, old[0].total); assert.equal(f.readBusiness().view.business.soldier.produksi.produksi[0].jahit[0].ownerBusinessCorrections, undefined);
  f.applyBusiness(f.modify('soldier/produksi', v => { v.produksi[0].poKet = 'Later unrelated'; })); assert.equal(f.p().jahit[0].ownerBusinessCorrections.length, 1);
});
test('coherent inspected-count correction preserves frozen rate and later repair cannot be paid twice', () => {
  const f = harness(); f.ready(); f.inspect(); const cmd = f.modify('soldier/produksi/produksi', v => { const p = v[0], q = p.qc[0]; q.ok = 6; q.perbaikan = 1; p.gudang.find(g => g.qcId === q.id && g.status === 'ok').jumlah = 6; p.gudang.find(g => g.qcId === q.id && g.status === 'kotor').jumlah = 1; const sell = p.bigSaller.find(g => g.qcId === q.id); sell.jumlah = 6; }); f.applyBusiness(cmd);
  assert.equal(f.p().qc[0].ok, 6); const before = F.copy(f.p().qc[0].payroll); f.apply(f.cmd('repairQC', 'quality-row-1', { quantity: 1, workDate: '2026-10-06' })); assert.deepEqual(f.p().qc[0].payroll, before); assert.equal(f.p().qc[0].ok, 7); assert.equal(f.resolveBusiness(cmd).receipt.replayed, true);
});
test('owner archive snapshot keeps paid source fields and prior count receipts instead of dropping old wages', () => {
  const f = harness(); f.ready(); f.p().jahit[1].inputBy = 'synthetic-private-author'; const count = f.cmd('inspectCount', 'archive-qc', { countId: 'count-1', workDate: '2026-10-06', totals: { ok: 5, perbaikan: 2, reject: 1, offline: 0 }, note: '' }); f.apply(count); const old = F.copy(f.p());
  const cmd = f.modify('soldier/produksi/produksi', v => { const p = v[0], arc = { id: 'new-owner-archive', label: 'Synthetic archive', tanggalArsip: '2026-10-06' }; for (const k of ['potong', 'bigSaller', 'bayarJahit', 'gudang', 'jahit', 'assignJahit', 'qc', 'hitungFisik']) { if (Object.hasOwn(p, k)) arc[k] = F.copy(p[k]); p[k] = []; } p.arsip.push(arc); p.poAktif = false; });
  f.applyBusiness(cmd); const arc = f.p().arsip.find(a => a.id === 'new-owner-archive'); assert.deepEqual(arc.jahit, old.jahit); assert.equal(f.api.resolve({ root: f.root, identity: f.qc, command: count }).receipt.replayed, true);
});
test('multiple fixed business roots update atomically while a rejected production delta returns no partial candidate', () => {
  const f = harness(), v = f.readBusiness().view.business.soldier; const cmd = f.businessCommand([{ path: 'soldier/stokBahan', action: 'set', value: { pembelian: [], adjustment: [] } }, { path: 'soldier/hpp', action: 'set', value: { note: 'Synthetic HPP' } }]); f.applyBusiness(cmd); assert.deepEqual(f.root.soldier.stokBahan, { pembelian: [], adjustment: [] }); assert.equal(f.root.soldier.hpp.note, 'Synthetic HPP');
  const bad = f.businessCommand([{ path: 'soldier/hpp', action: 'set', value: { note: 'Must not commit' } }, { path: 'soldier/produksi/produksi', action: 'set', value: v.produksi.produksi.map(p => ({ ...p, jahit: p.jahit.map(r => ({ ...r, tukangId: 'unreviewed-worker' })) })) }]); const before = F.copy(f.root); assert.equal(f.executeBusiness(bad).ok, false); assert.deepEqual(f.root, before);
});
test('embedded owner product pictures are allowed within cap; separate production images and credentials stay private', () => {
  const f = harness(), picture = 'data:image/png;base64,U1lOVEhFVElD'; const cmd = f.businessCommand([{ path: 'soldier/pembelianProduk', action: 'set', value: { produk: [{ id: 'purchase-product', gambar: picture, _offlineGambar: picture }], suppliers: [], orders: [] } }]); f.applyBusiness(cmd);
  assert.equal(f.readBusiness().view.business.soldier.pembelianProduk.produk[0].gambar, picture); assert.equal(f.readBusiness().view.business.soldier.produksi.images, undefined);
});
test('hidden source fields cannot be discarded by optional whole-branch removal and normalized private spellings are suppressed', () => {
  const f = harness(); f.root.soldier.gajiHarian = { employees: [], 'api.key': 'SYNTHETIC_SECRET', audit: { changedBy: 'synthetic-author' } }; assert.equal(f.readBusiness().view.business.soldier.gajiHarian['api.key'], undefined);
  const cmd = f.businessCommand([{ path: 'soldier/gajiHarian', action: 'remove' }]), before = F.copy(f.root); assert.equal(f.executeBusiness(cmd).error, 'conflict'); assert.deepEqual(f.root, before);
});
test('invalid changed stored money is rejected while an unchanged original anomaly remains exact', () => {
  const f = harness(); f.root.soldier.hpp = { original: { total: -7.5 }, labels: {} }; f.applyBusiness(f.businessCommand([{ path: 'soldier/hpp', action: 'set', value: { original: { total: -7.5 }, labels: { note: 'Owner label' } } }])); assert.equal(f.root.soldier.hpp.original.total, -7.5);
  for (const value of [{ total: -1 }, { total: 'bad' }, { jumlah: -1 }]) { const cmd = f.businessCommand([{ path: 'soldier/pembelianProduk', action: 'set', value }]), before = F.copy(f.root); assert.equal(f.executeBusiness(cmd).ok, false); assert.deepEqual(f.root, before); }
});
test('new physical count cannot supply an arbitrary frozen rate through broad owner snapshot', () => {
  const f = harness(), cmd = f.modify('soldier/produksi/produksi', v => { v[0].hitungFisik.push({ id: 'new-owner-count', tukangId: 'worker-1', tukang: 'Synthetic partner', jumlah: 8, tanggal: '2026-10-06', workflowVersion: 2, countStage: 'verified', payroll: { workerId: 'worker-1', workerName: 'Synthetic partner', rate: 999, rateMissing: false, capturedAt: '2026-10-05T17:00:00.000Z' } }); }); const before = F.copy(f.root); assert.equal(f.executeBusiness(cmd).error, 'not_ready'); assert.deepEqual(f.root, before);
});
