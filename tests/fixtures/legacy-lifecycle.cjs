'use strict';
// Public synthetic data only.
const assert = require('node:assert/strict');
const Core = require('../../server/production-legacy-lifecycle.cjs');
const State = require('../../server/production-identity-state.cjs');
const F = require('./identity-tenant.cjs');
const POLICY = { version: 'legacy-jahit-current-v1', reviewed: true, timeZone: 'Asia/Jakarta', quantityBasis: 'good-plus-reject' };
function fixture() {
  const qc = F.identity({ uid: 'quality-1', email: F.QC_EMAIL, googleSubject: '1000000012345' });
  const tenant = State.claimIdentityEnrollment(F.claimed(), qc, F.NOW).next;
  const root = { authorityTenants: { [F.TENANT]: tenant }, soldier: { produksi: { images: { private: 'SYNTHETIC_IMAGE' }, unknown: { private: true }, produksi: [{
    id: 'product-1', series: 'Synthetic.Series', namaBarang: 'Item', size: 'M', poAktif: true, poJumlah: 10, poTanggal: '2026-10-06', privateCost: 987,
    potong: [{ id: 'cut-1', jumlah: 10, total: 999.75 }],
    assignJahit: [{ id: 'assignment-1', tukangId: 'worker-1', qty: 8, sisa: 0 }, { id: 'assignment-2', tukangId: 'worker-2', qty: 2, sisa: 0 }],
    jahit: [{ id: 'sewn-1', assignmentId: 'assignment-1', tukangId: 'worker-1', tukangNama: 'Synthetic partner', tanggal: '2026-10-06', jumlah: 8, lolos: 8, rijek: 0, tarif: 2.5, total: 20, dibayar: false, private: 'SYNTHETIC_ROW_PRIVATE' }, { id: 'sewn-2', assignmentId: 'assignment-2', tukangId: 'worker-2', tanggal: '2026-10-06', jumlah: 2, lolos: 2, rijek: 0, tarif: 99, total: 198, dibayar: true }],
    hitungFisik: [], qc: [], gudang: [], bigSaller: [], arsip: [{ id: 'archive-1', jahit: [{ id: 'archived-sewn', tukangId: 'worker-1', tarif: 7, total: 333.75, dibayar: true }], private: 'SYNTHETIC_ARCHIVE_PRIVATE' }], private: { preserve: true }
  }] }, produksi_meta: { tukangJahit: [{ id: 'worker-1', nama: 'Synthetic partner', pin: 'SYNTHETIC_PIN', tarif: { 'Synthetic_Series|Item': 7.5 }, tarifHistory: { 'Synthetic_Series|Item': [{ effectiveAt: '2026-10-01T00:00:00+07:00', rate: 3.25 }, { effectiveAt: '2026-10-06T12:00:00+07:00', rate: 7.5 }] } }, { id: 'worker-2', nama: 'Synthetic second', tarif: { 'Synthetic_Series|Item': 99 } }], kasbonJahit: [{ id: 'private-advance', tukangId: 'worker-2', jumlah: 123 }] }, privateCash: 'SYNTHETIC_CASH_PRIVATE' }, privateRoot: 'SYNTHETIC_ROOT_PRIVATE' };
  const binding = { projectId: F.PROJECT, databaseURL: F.URL, tenantId: F.TENANT }, control = { time: F.NOW }, api = Core.createProductionLegacyLifecycle({ enabled: true, binding, tariffPolicy: POLICY, clock: () => control.time });
  const p = () => root.soldier.produksi.produksi[0];
  const read = (identity = qc) => api.read({ root, identity });
  let sequence = 0;
  const cmd = (kind, operationId, extra = {}, identity = qc) => ({ kind, requestId: 'request-' + (++sequence), operationId, productId: 'product-1', expectedGrantRevision: 1, expectedSourceVersion: read(identity).view.products[0].sourceVersion, ...extra });
  const call = (command, identity = qc) => api.execute({ root, identity, command });
  const apply = (command, identity = qc) => { const r = call(command, identity); assert.equal(r.ok, true, JSON.stringify(r)); Object.keys(root).forEach(k => delete root[k]); Object.assign(root, F.copy(r.next)); return r; };
  const count = (workerId = 'worker-1', quantity = 8, operationId = 'count-1', date = '2026-10-06') => apply(cmd('appendCount', operationId, { workerId, quantity, workDate: date }));
  const ready = () => { count(); count('worker-2', 2, 'count-2'); };
  const inspect = (totals = { ok: 5, perbaikan: 2, reject: 1, offline: 0 }) => apply(cmd('inspectCount', 'quality-row-1', { countId: 'count-1', workDate: '2026-10-06', totals, note: 'Synthetic note' }));
  return { root, qc, partner: F.identity(), binding, control, api, p, read, cmd, call, apply, count, ready, inspect };
}
module.exports = Object.freeze({ fixture, POLICY });
