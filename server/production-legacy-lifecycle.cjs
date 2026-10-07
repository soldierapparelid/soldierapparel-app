'use strict';
// Pure SOURCE-OFF candidate. A trusted adapter must read and CAS the full root.
// No token verification, network, deployment, enrollment, or financial selectors.
const Crypto = require('node:crypto');
const Core = require('./production-legacy-operations.cjs');
const State = require('./production-identity-state.cjs');
const Email = require('./production-enrollment-identity.cjs');
const Workflow = require('../production-workflow.js');
const Payroll = require('../production-payroll.js');
const Archive = require('../production-archive.js');
const Batch = require('../production-qc-batch.js');

const POLICY = 'legacy-lifecycle-current-v2', LEDGER = 'legacyLifecycleReceipts';
const FAMILIES = ['jahit', 'assignJahit', 'hitungFisik', 'qc', 'gudang', 'bigSaller'];
const CYCLE_FIELDS = ['potong', 'bigSaller', 'bayarJahit', 'gudang', 'jahit', 'assignJahit', 'qc', 'hitungFisik'];
const PO_FIELDS = ['poAktif', 'poJumlah', 'poTanggal', 'poKet', 'bigSeller', 'needsVerify'];
const LEDGER_FAMILIES = [...FAMILIES, 'potong', 'bayarJahit', 'arsip', 'poControls'];
const MAX_COMMANDS = 10000, MAX_ROWS = 40000, MAX_COMMAND_BYTES = 32768;
const BUSINESS_LEDGER = 'legacyOwnerBusinessReceipts', BUSINESS_POLICY = 'legacy-owner-business-v1';
const MAX_BUSINESS_BYTES = 2 * 1024 * 1024;
const BUSINESS_ROOTS = Object.freeze(['produksi', 'produksi_meta', 'produksi_deletions', 'produksi_deleted_ids', 'stokBahan', 'gajiHarian', 'hpp', 'pembelianProduk']);
const BUSINESS_PATHS = Object.freeze(BUSINESS_ROOTS.map(k => 'soldier/' + k).concat(['soldier/produksi/produksi']));
const PRIVATE_BUSINESS_FIELDS = new Set(['pin', 'password', 'passwd', 'passphrase', 'secret', 'token', 'accesstoken', 'refreshtoken', 'idtoken', 'apikey', 'partnerkey', 'privatekey', 'credential', 'credentials', 'authorization', 'googlesubject', 'uid', 'deviceinfo', 'deviceid', 'device', 'authtimems', 'issuedatms', 'expiresatms', 'verifiedat', 'editedby', 'createdby', 'changedby', 'inputby', 'amountreviewedby', 'pemeriksa', 'amountcorrections', 'paymentcorrections', 'ownerbusinesscorrections', 'authoritytenants', 'accesscontrol', 'legacylifecyclereceipts', 'legacyoperationreceipts', 'legacyownerbusinessreceipts', 'images', 'productionphotos']);
const privateBusinessField = key => PRIVATE_BUSINESS_FIELDS.has(key.replace(/[^a-z]/gi, '').toLowerCase());
const HASH = /^[a-f0-9]{64}$/;
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const safe = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v) && !['__proto__', 'constructor', 'prototype'].includes(v);
const canonical = v => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
const digest = v => Crypto.createHash('sha256').update(canonical(v)).digest('hex');
const copy = Core.copyLegacyRoot;
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const yes = v => v === true || v === 1 || v === 'true';
const ignored = v => yes(v.deleted) || yes(v.isDeleted) || !!v.deletedAt || yes(v.cancelled) || yes(v.canceled) || !!v.cancelledAt || !!v.canceledAt || /^(deleted|cancelled|canceled|dihapus|dibatalkan|batal)$/i.test(v.status || '');
class LegacyLifecycleError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new LegacyLifecycleError(code); };
function exact(v, keys, code = 'not_ready') { if (!plain(v) || Reflect.ownKeys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) fail(code); for (const k of keys) { const d = Object.getOwnPropertyDescriptor(v, k); if (!d.enumerable || !Object.hasOwn(d, 'value')) fail(code); } }
function id(v, code = 'not_ready') { if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) v = String(v); if (!safe(v)) fail(code); return v; }
function newId(v) { if (typeof v !== 'string' || !safe(v) || /^\d+$/.test(v) || v.length > 96) fail('invalid_request'); return v; }
function pcs(v, min = 0, code = 'not_ready') { if (!Number.isSafeInteger(v) || v < min) fail(code); return v; }
function label(v, max = 256, code = 'not_ready') { if (typeof v !== 'string' || v.length > max || /[\u0000-\u001f\u007f-\u009f]/.test(v)) fail(code); return v; }
function day(v, code = 'not_ready') { if (typeof v !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v + 'T00:00:00.000Z')) || new Date(v + 'T00:00:00.000Z').toISOString().slice(0, 10) !== v) fail(code); return v; }
function instant(v, code = 'not_ready') { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) || !Number.isFinite(Date.parse(v)) || Date.parse(v) < 0 || new Date(v).toISOString() !== v) fail(code); return v; }
function rows(v) { if (v == null) return []; if (!Array.isArray(v) && !plain(v)) fail('not_ready'); const out = Object.values(v).filter(x => x !== null); if (out.length > MAX_ROWS) fail('capacity_limit'); if (out.some(x => !plain(x))) fail('not_ready'); const ids = new Set(); for (const r of out) if (r.id != null) { const k = id(r.id); if (ids.has(k)) fail('not_ready'); ids.add(k); } return out; }
function selected(v, key) { const matches = rows(v).filter(r => r.id != null && id(r.id) === key && !ignored(r)); if (matches.length !== 1) fail('conflict'); return matches[0]; }
function amount(v) { const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+(?:\.\d+)?\s*$/.test(v) ? Number(v) : NaN; if (!Number.isFinite(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) fail('not_ready'); return n; }
function marker(v) {
  if (typeof v !== 'string') return v;
  if (Buffer.byteLength(v, 'utf8') > 256 * 1024) fail('capacity_limit');
  // Strict JSON keys, including escaped aliases, before last-key parsing.
  const stack = [];
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '"') { let end = i + 1; for (; end < v.length; end++) { if (v[end] === '\\') { end++; continue; } if (v[end] === '"') break; } const top = stack.at(-1); if (top?.keys && top.nextKey) { let k; try { k = JSON.parse(v.slice(i, end + 1)); } catch { fail('not_ready'); } if (top.keys.has(k)) fail('not_ready'); top.keys.add(k); top.nextKey = false; } i = end; }
    else if (v[i] === '{') stack.push({ keys: new Set(), nextKey: true }); else if (v[i] === '[') stack.push({}); else if (v[i] === '}' || v[i] === ']') stack.pop(); else if (v[i] === ',' && stack.at(-1)?.keys) stack.at(-1).nextKey = true;
    if (stack.length > 8) fail('not_ready');
  }
  try { return copy({ marker: JSON.parse(v) }).marker; } catch { fail('not_ready'); }
}
function markers(soldier) {
  const products = new Set(), pairs = new Set();
  const deleted = marker(soldier.produksi_deleted_ids ?? null), log = marker(soldier.produksi_deletions ?? null);
  if (deleted != null) { if (!Array.isArray(deleted) && !plain(deleted)) fail('not_ready'); for (const value of Object.values(deleted)) if (value !== null) products.add(id(value)); }
  if (log != null) { if (!plain(log) || Object.keys(log).length > MAX_ROWS || Buffer.byteLength(canonical(log), 'utf8') > 256 * 1024) fail('not_ready'); for (const [key, value] of Object.entries(log)) { if (key.length > 2048) fail('not_ready'); pcs(value); pairs.add(key); } }
  return { products, pairs, log: log || {}, stringLog: typeof soldier.produksi_deletions === 'string' };
}
function tombstone(root, productId, family, row, time) {
  const m = markers(root.soldier);
  const fields = ['tanggal', 'jumlah', 'tukangJahit', 'tukang', 'status', 'nominal', 'pcs'];
  const fingerprint = fields.filter(k => row[k] !== undefined).map(k => k + ':' + row[k]).join('|') || JSON.stringify(row);
  const source = row.id != null ? 'id:' + id(row.id) : row.hfId || row.qcId ? 'link:' + JSON.stringify([row.hfId || '', row.qcId || '', fingerprint]) : null;
  if (!source) fail('not_ready');
  m.log[productId + '|' + family + '|' + source] = Date.parse(time);
  root.soldier.produksi_deletions = m.stringLog ? JSON.stringify(m.log) : m.log;
}
function liveCollection(p, family, m) { return rows(p[family]).filter(r => !ignored(r) && !(r.id != null && m.pairs.has(id(p.id) + '|' + family + '|id:' + id(r.id)))); }
function put(p, family, row, original = null) {
  if (p[family] == null) p[family] = [];
  if (Array.isArray(p[family])) { const index = original ? p[family].indexOf(original) : -1; if (original && index < 0) fail('conflict'); if (index < 0) p[family].push(row); else p[family][index] = row; }
  else { const key = original ? Object.keys(p[family]).find(k => p[family][k] === original) : id(row.id); if (key == null || !original && Object.hasOwn(p[family], key)) fail('conflict'); p[family][key] = row; }
}
function remove(root, p, family, predicate, time) {
  if (p[family] == null) return;
  rows(p[family]);
  if (Array.isArray(p[family])) p[family] = p[family].filter(r => { if (r === null || !predicate(r)) return true; tombstone(root, id(p.id), family, r, time); return false; });
  else for (const key of Object.keys(p[family])) if (p[family][key] !== null && predicate(p[family][key])) { tombstone(root, id(p.id), family, p[family][key], time); delete p[family][key]; }
}
function replaceMirrors(root, p, family, next, time) {
  const previous = rows(p[family]);
  for (const row of previous) if (!next.some(n => row.id != null && n.id != null ? id(n.id) === id(row.id) : canonical(n) === canonical(row))) tombstone(root, id(p.id), family, row, time);
  if (Array.isArray(p[family]) || p[family] == null) p[family] = next;
  else {
    const out = {}; for (const [key, row] of Object.entries(p[family])) if (row === null) out[key] = null;
    for (const row of next) { const oldKey = Object.keys(p[family]).find(k => p[family][k] !== null && (row.id != null && p[family][k].id != null ? id(row.id) === id(p[family][k].id) : canonical(row) === canonical(p[family][k]))); const key = oldKey ?? (row.id == null ? null : id(row.id)); if (key == null || Object.hasOwn(out, key)) fail('not_ready'); out[key] = row; } p[family] = out;
  }
}
const BASE = ['kind', 'requestId', 'operationId', 'productId', 'expectedGrantRevision', 'expectedSourceVersion'];
const OWNER_EXTRA = Object.freeze({ ownerArchiveCycle: ['archiveId', 'label', 'startNewPO'], ownerRestoreCycle: ['archiveId', 'safetyArchiveId', 'safetyLabel'], ownerRelabelArchive: ['archiveId', 'label'], ownerSetPO: ['active', 'quantity', 'workDate', 'note'], ownerAppendAssignment: ['assignmentId', 'workerId', 'quantity', 'workDate', 'targetDate', 'note'], ownerEditAssignment: ['assignmentId', 'workerId', 'quantity', 'workDate', 'targetDate', 'note'], ownerAppendJahit: ['recordId', 'assignmentId', 'workerId', 'workDate', 'good', 'reject', 'amountMode', 'rate', 'total'], ownerEditJahit: ['recordId', 'workerId', 'workDate', 'good', 'reject', 'amountMode', 'rate', 'total'], ownerAppendPaymentNote: ['recordId', 'workDate'], ownerEditPaymentNote: ['recordId', 'workDate'], ownerSetPaid: ['recordId', 'family', 'paid', 'workDate', 'reviewed'] });
const EXTRA = Object.freeze({ editJahit: ['workDate', 'good', 'reject'], deleteJahit: [], appendCount: ['workerId', 'workDate', 'quantity'], editCount: ['workDate', 'quantity'], deleteCount: [], inspectCount: ['countId', 'workDate', 'totals', 'note'], editQC: ['workDate', 'totals', 'note'], repairQC: ['workDate', 'quantity'], inspectCounts: ['countIds', 'workDate', 'totals', 'note'], editQCGroup: ['qcIds', 'totals', 'note'] });
function command(raw) {
  const cmd = copy(raw);
  if (cmd.kind === 'appendJahit') {
    exact(cmd, ['kind', 'requestId', 'operationId', 'productId', 'assignmentId', 'expectedGrantRevision', 'expectedSourceVersion', 'workDate', 'good', 'reject'], 'invalid_request'); newId(cmd.requestId); newId(cmd.operationId); id(cmd.productId, 'invalid_request'); id(cmd.assignmentId, 'invalid_request'); pcs(cmd.expectedGrantRevision, 1, 'invalid_request'); if (!HASH.test(cmd.expectedSourceVersion)) fail('invalid_request'); if (cmd.workDate !== null) day(cmd.workDate, 'invalid_request'); pcs(cmd.good, 0, 'invalid_request'); pcs(cmd.reject, 0, 'invalid_request'); pcs(cmd.good + cmd.reject, 1, 'invalid_request'); return cmd;
  }
  if (!Object.hasOwn(EXTRA, cmd.kind)) fail('invalid_request'); exact(cmd, BASE.concat(EXTRA[cmd.kind]), 'invalid_request'); newId(cmd.requestId); id(cmd.operationId, 'invalid_request'); id(cmd.productId, 'invalid_request'); pcs(cmd.expectedGrantRevision, 1, 'invalid_request'); if (!HASH.test(cmd.expectedSourceVersion)) fail('invalid_request');
  if (['appendCount', 'inspectCount', 'inspectCounts'].includes(cmd.kind)) newId(cmd.operationId);
  if (Object.hasOwn(cmd, 'workDate')) day(cmd.workDate, 'invalid_request');
  if (Object.hasOwn(cmd, 'workerId')) id(cmd.workerId, 'invalid_request'); if (Object.hasOwn(cmd, 'countId')) id(cmd.countId, 'invalid_request');
  if (Object.hasOwn(cmd, 'quantity')) pcs(cmd.quantity, 1, 'invalid_request');
  if (Object.hasOwn(cmd, 'good')) { pcs(cmd.good, 0, 'invalid_request'); pcs(cmd.reject, 0, 'invalid_request'); pcs(cmd.good + cmd.reject, 1, 'invalid_request'); }
  if (Object.hasOwn(cmd, 'note')) label(cmd.note, 512, 'invalid_request');
  if (Object.hasOwn(cmd, 'totals')) { exact(cmd.totals, ['ok', 'perbaikan', 'reject', 'offline'], 'invalid_request'); for (const n of Object.values(cmd.totals)) pcs(n, 0, 'invalid_request'); pcs(Object.values(cmd.totals).reduce((a, b) => a + b, 0), 1, 'invalid_request'); }
  for (const field of ['countIds', 'qcIds']) if (Object.hasOwn(cmd, field)) { if (!Array.isArray(cmd[field]) || !cmd[field].length || cmd[field].length > 128) fail('invalid_request'); const ids = cmd[field].map(v => id(v, 'invalid_request')); if (new Set(ids).size !== ids.length) fail('invalid_request'); }
  if (Buffer.byteLength(Core.serializeLegacyRoot(cmd), 'utf8') > MAX_COMMAND_BYTES) fail('invalid_request'); return cmd;
}
function ownerCommand(raw) {
  const cmd = copy(raw), extra = OWNER_EXTRA;
  if (!Object.hasOwn(extra, cmd.kind)) fail('invalid_request'); exact(cmd, BASE.concat(extra[cmd.kind]), 'invalid_request');
  newId(cmd.requestId); newId(cmd.operationId); id(cmd.productId, 'invalid_request'); pcs(cmd.expectedGrantRevision, 1, 'invalid_request'); if (!HASH.test(cmd.expectedSourceVersion)) fail('invalid_request');
  if (Object.hasOwn(cmd, 'archiveId')) id(cmd.archiveId, 'invalid_request');
  if (cmd.kind === 'ownerArchiveCycle') { newId(cmd.archiveId); label(cmd.label, 256, 'invalid_request'); if (!cmd.label.trim() || typeof cmd.startNewPO !== 'boolean') fail('invalid_request'); }
  if (cmd.kind === 'ownerRestoreCycle') { if (cmd.safetyArchiveId !== null) newId(cmd.safetyArchiveId); if (cmd.safetyLabel !== null) { label(cmd.safetyLabel, 256, 'invalid_request'); if (!cmd.safetyLabel.trim()) fail('invalid_request'); } }
  if (cmd.kind === 'ownerRelabelArchive') { label(cmd.label, 256, 'invalid_request'); if (!cmd.label.trim()) fail('invalid_request'); }
  if (cmd.kind === 'ownerSetPO') { if (typeof cmd.active !== 'boolean') fail('invalid_request'); pcs(cmd.quantity, 0, 'invalid_request'); if (cmd.workDate !== null) day(cmd.workDate, 'invalid_request'); label(cmd.note, 512, 'invalid_request'); }
  if (cmd.kind === 'ownerAppendAssignment' || cmd.kind === 'ownerEditAssignment') {
    id(cmd.assignmentId, 'invalid_request'); if (cmd.kind === 'ownerAppendAssignment') newId(cmd.assignmentId); id(cmd.workerId, 'invalid_request'); pcs(cmd.quantity, 1, 'invalid_request'); day(cmd.workDate, 'invalid_request'); if (cmd.targetDate !== null) { day(cmd.targetDate, 'invalid_request'); if (cmd.targetDate < cmd.workDate) fail('invalid_request'); } label(cmd.note, 512, 'invalid_request');
  }
  if (cmd.kind === 'ownerAppendJahit' || cmd.kind === 'ownerEditJahit') {
    id(cmd.recordId, 'invalid_request'); if (cmd.kind === 'ownerAppendJahit') { newId(cmd.recordId); if (cmd.assignmentId !== null) id(cmd.assignmentId, 'invalid_request'); }
    id(cmd.workerId, 'invalid_request'); day(cmd.workDate, 'invalid_request'); pcs(cmd.good, 0, 'invalid_request'); pcs(cmd.reject, 0, 'invalid_request'); pcs(cmd.good + cmd.reject, 1, 'invalid_request');
    if (!['stored', 'reviewed'].includes(cmd.amountMode) || cmd.kind === 'ownerAppendJahit' && cmd.amountMode !== 'reviewed') fail('invalid_request');
    if (cmd.amountMode === 'stored') { if (cmd.rate !== null || cmd.total !== null) fail('invalid_request'); }
    else for (const k of ['rate', 'total']) if (typeof cmd[k] !== 'number' || !Number.isFinite(cmd[k]) || cmd[k] < 0 || cmd[k] > Number.MAX_SAFE_INTEGER || Object.is(cmd[k], -0)) fail('invalid_request');
  }
  if (cmd.kind === 'ownerAppendPaymentNote' || cmd.kind === 'ownerEditPaymentNote') { id(cmd.recordId, 'invalid_request'); if (cmd.kind === 'ownerAppendPaymentNote') newId(cmd.recordId); day(cmd.workDate, 'invalid_request'); }
  if (cmd.kind === 'ownerSetPaid') { id(cmd.recordId, 'invalid_request'); if (!['jahit', 'hitungFisik', 'qc'].includes(cmd.family) || typeof cmd.paid !== 'boolean' || cmd.reviewed !== true || cmd.paid && cmd.workDate === null || !cmd.paid && cmd.workDate !== null) fail('invalid_request'); if (cmd.workDate !== null) day(cmd.workDate, 'invalid_request'); }
  if (Buffer.byteLength(Core.serializeLegacyRoot(cmd), 'utf8') > MAX_COMMAND_BYTES) fail('invalid_request'); return cmd;
}
function businessSafe(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(businessSafe);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !privateBusinessField(key)).map(([key, v]) => [key, businessSafe(v)]));
}
function businessCommand(raw) {
  const cmd = copy(raw); exact(cmd, ['kind', 'requestId', 'expectedGrantRevision', 'expectedSourceVersion', 'changes'], 'invalid_request');
  if (cmd.kind !== 'ownerBusinessWrite') fail('invalid_request'); newId(cmd.requestId); pcs(cmd.expectedGrantRevision, 1, 'invalid_request'); if (!HASH.test(cmd.expectedSourceVersion)) fail('invalid_request');
  if (!Array.isArray(cmd.changes) || !cmd.changes.length || cmd.changes.length > BUSINESS_PATHS.length) fail('invalid_request');
  const paths = [];
  for (const change of cmd.changes) {
    if (change.action === 'set') { exact(change, ['path', 'action', 'value'], 'invalid_request'); if (canonical(businessSafe(change.value)) !== canonical(change.value)) fail('invalid_request'); }
    else if (change.action === 'remove') exact(change, ['path', 'action'], 'invalid_request'); else fail('invalid_request');
    if (!BUSINESS_PATHS.includes(change.path) || paths.some(p => p === change.path || p.startsWith(change.path + '/') || change.path.startsWith(p + '/'))) fail('invalid_request');
    if (change.action === 'remove' && ['soldier/produksi', 'soldier/produksi/produksi', 'soldier/produksi_meta', 'soldier/produksi_deletions', 'soldier/produksi_deleted_ids'].includes(change.path)) fail('invalid_request');
    paths.push(change.path);
  }
  if (Buffer.byteLength(Core.serializeLegacyRoot(cmd), 'utf8') > MAX_BUSINESS_BYTES) fail('capacity_limit'); return cmd;
}
function createProductionLegacyLifecycle(options = {}) {
  const rejected = error => freeze({ ok: false, error });
  let enabled = false; try { const d = plain(options) && Object.getOwnPropertyDescriptor(options, 'enabled'); enabled = !!d && Object.hasOwn(d, 'value') && d.value === true; } catch {}
  const disabled = error => Object.freeze(Object.fromEntries(['read', 'capture', 'execute', 'resolve', 'readOwner', 'captureOwner', 'executeOwner', 'resolveOwner', 'readBusiness', 'executeOwnerBusiness', 'resolveOwnerBusiness'].map(k => [k, () => rejected(error)])));
  if (!enabled) return disabled('service_disabled');
  let binding, clock, highWater = -1, jahit;
  try {
    exact(options, ['enabled', 'binding', 'clock', 'tariffPolicy'], 'unavailable'); binding = copy(options.binding); exact(binding, ['projectId', 'databaseURL', 'tenantId'], 'unavailable');
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(binding.projectId) || !safe(binding.tenantId) || /^\d+$/.test(binding.tenantId) || !/^https:\/\/([a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app)$/.test(binding.databaseURL)) fail('unavailable');
    const policy = copy(options.tariffPolicy); exact(policy, ['version', 'reviewed', 'timeZone', 'quantityBasis'], 'unavailable'); if (policy.version !== 'legacy-jahit-current-v1' || policy.reviewed !== true || policy.timeZone !== 'Asia/Jakarta' || policy.quantityBasis !== 'good-plus-reject') fail('unavailable');
    clock = options.clock; if (typeof clock !== 'function') fail('unavailable'); freeze(binding); jahit = Core.createProductionLegacyOperations(options);
  } catch { return disabled('unavailable'); }
  function now() { const time = instant(clock(), 'unavailable'), n = Date.parse(time); if (n < highWater) fail('unavailable'); highWater = n; return time; }
  function context(root, identity, time, owner = false) {
    exact(identity, ['projectId', 'uid', 'email', 'googleSubject', 'authTimeMs', 'issuedAtMs', 'expiresAtMs', 'verifiedAt'], 'access_denied');
    if (identity.projectId !== binding.projectId || !Email.isEnrollmentEmail(identity.email)) fail('access_denied'); id(identity.uid, 'access_denied'); id(identity.googleSubject, 'access_denied'); for (const k of ['authTimeMs', 'issuedAtMs', 'expiresAtMs']) pcs(identity[k], 0, 'access_denied'); instant(identity.verifiedAt, 'access_denied');
    const n = Date.parse(time); if (identity.authTimeMs > identity.issuedAtMs || identity.issuedAtMs >= identity.expiresAtMs || identity.issuedAtMs > n || identity.expiresAtMs <= n || Date.parse(identity.verifiedAt) > n || Date.parse(identity.verifiedAt) < identity.issuedAtMs) fail('access_denied');
    if (!plain(root.authorityTenants) || !Object.hasOwn(root.authorityTenants, binding.tenantId)) fail('not_ready'); const tenant = State.validateIdentityTenant(root.authorityTenants[binding.tenantId], { projectId: binding.projectId, tenantId: binding.tenantId });
    // The initialized owner may use the quantity-only QC lane without creating
    // a second enrollment or impersonating a partner. The trusted retained grant
    // and Google subject still authorize the caller; no role comes from input.
    if (owner || identity.uid === tenant.initialization.ownerUid) {
      const grant = State.readIdentityGrant(tenant, { uid: identity.uid, googleSubject: identity.googleSubject });
      if (identity.uid !== tenant.initialization.ownerUid || grant.profile.owner !== true || grant.profile.active !== true) fail('access_denied');
      return { binding: { ...binding, uid: identity.uid, workerId: null, division: owner ? 'owner' : 'qc', grantRevision: grant.revision }, initialization: tenant.initialization, workerCatalog: tenant.workerCatalog, grant };
    }
    const retained = State.lookupIdentityEnrollment(tenant, identity); if (retained.row.status !== 'claimed' || retained.row.email !== identity.email) fail('access_denied');
    const grant = State.readIdentityGrant(tenant, { uid: identity.uid, googleSubject: identity.googleSubject }), profile = grant.profile;
    if (profile.owner !== false || !plain(profile.modules) || Object.keys(profile.modules).length !== 1) fail('access_denied');
    const division = profile.modules.qc === true && !Object.hasOwn(profile, 'workerId') ? 'qc' : profile.modules.jahit === true && safe(profile.workerId) && tenant.workerCatalog.workers[profile.workerId]?.division === 'jahit' ? 'jahit' : null;
    if (!division) fail('access_denied');
    return { binding: { ...binding, uid: identity.uid, workerId: division === 'qc' ? null : profile.workerId, division, grantRevision: grant.revision }, initialization: tenant.initialization, workerCatalog: tenant.workerCatalog, grant };
  }
  function source(root) {
    if (!plain(root.soldier) || !plain(root.soldier.produksi) || !Object.hasOwn(root.soldier.produksi, 'produksi') || !plain(root.soldier.produksi_meta)) fail('not_ready');
    const products = rows(root.soldier.produksi.produksi), workers = rows(root.soldier.produksi_meta.tukangJahit); if (products.length > 2000 || workers.length > 128) fail('capacity_limit'); return { products, workers, markers: markers(root.soldier) };
  }
  function normalizedProduct(p, s) { const out = { ...p }; for (const field of ['potong', ...FAMILIES]) out[field] = liveCollection(p, field, s.markers); return out; }
  function editable(p, s) { const a = Archive.inspect(p); if (ignored(p) || s.markers.products.has(id(p.id)) || a.archived || a.needsReview) fail('conflict'); }
  function worker(s, c, workerId) { if (c.workerCatalog.workers[workerId]?.division !== 'jahit') fail('not_ready'); const found = selected(s.workers, workerId); if (found.active === false || found.deleted) fail('not_ready'); label(found.nama); return found; }
  function rowWorker(s, c, row) {
    const explicit = [row.tukangId, row.workerId, row.payroll?.workerId].filter(v => v != null && v !== '').map(v => id(v)); if (new Set(explicit).size > 1) fail('not_ready');
    const found = explicit.length ? worker(s, c, explicit[0]) : Payroll.resolveWorker(s.workers, row.tukangJahit || row.tukang || row.tukangNama); if (!found) fail('not_ready'); return worker(s, c, id(found.id));
  }
  function frozenPayroll(s, c, p, row, when) {
    const w = rowWorker(s, c, row);
    if (row.payroll != null) { const pay = row.payroll; exact(pay, ['workerId', 'workerName', 'rate', 'rateMissing', 'capturedAt']); if (pay.workerId !== id(w.id) || pay.rateMissing !== false || amount(pay.rate) <= 0) fail('not_ready'); label(pay.workerName); instant(pay.capturedAt); if (Date.parse(pay.capturedAt) > highWater) fail('not_ready'); return copy(pay); }
    // Explicit Jakarta midnight avoids the host timezone changing history.
    const dated = copy(w); if (plain(dated.tarifHistory)) for (const history of Object.values(dated.tarifHistory)) for (const entry of rows(history)) if (typeof entry.effectiveAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.effectiveAt)) entry.effectiveAt = day(entry.effectiveAt) + 'T00:00:00+07:00';
    const at = when + 'T00:00:00+07:00', rate = Payroll.rateFor(dated, p.series, p.namaBarang, at); if (!Number.isFinite(rate) || rate <= 0 || rate > Number.MAX_SAFE_INTEGER) fail('not_ready'); return { workerId: id(w.id), workerName: w.nama, rate, rateMissing: false, capturedAt: new Date(at).toISOString() };
  }
  function qcView(p, s, c) {
    const n = normalizedProduct(p, s), summary = Workflow.inspect(n, s.workers);
    const out = { productId: id(p.id), series: label(p.series || ''), namaBarang: label(p.namaBarang || ''), size: label(p.size || ''), poActive: p.poAktif === true, poQuantity: p.poJumlah == null ? null : pcs(p.poJumlah), readyForQC: summary.readyForQC === true, needsReview: summary.needsReview === true, target: pcs(summary.target), remainingPO: pcs(summary.remainingPO), groups: [], counts: [], inspections: [] };
    for (const g of summary.groups) { if (!g.workerId) { out.needsReview = true; continue; } const w = worker(s, c, g.workerId); out.groups.push({ workerId: id(w.id), name: w.nama, sewn: pcs(g.sewn), counted: pcs(g.counted), pendingCount: pcs(g.pendingCount) }); }
    for (const h of n.hitungFisik) { if (h.id == null) { out.needsReview = true; continue; } const w = rowWorker(s, c, h); out.counts.push({ countId: id(h.id), workerId: id(w.id), workerName: w.nama, workDate: day(h.tanggal), quantity: pcs(h.jumlah, 1), qcId: h.qcId == null ? null : id(h.qcId), cancelled: !!h.payrollCancelled, staged: Number(h.workflowVersion) >= 2 }); }
    for (const q of n.qc) { if (q.id == null) { out.needsReview = true; continue; } const w = rowWorker(s, c, q); out.inspections.push({ operationId: id(q.id), countId: q.hfId == null ? null : id(q.hfId), batchId: q.qcBatchId == null ? null : id(q.qcBatchId), workerId: id(w.id), workDate: day(q.tanggal), totals: qcTotals(q), note: label(q.keterangan || '', 512), staged: Number(q.workflowVersion) >= 2 }); }
    // This hash contains only this quantity DTO and non-financial PO controls.
    out.sourceVersion = digest({ view: out, poTanggal: p.poTanggal ?? null, archives: Archive.inspect(p).snapshots.map(a => a.id == null ? null : id(a.id)) }); return out;
  }
  function qcTotals(q) { const t = { ok: pcs(q.ok ?? 0), perbaikan: pcs(q.perbaikan ?? q.kotor ?? 0), reject: pcs(q.reject ?? 0), offline: pcs(q.offline ?? 0) }; pcs(Object.values(t).reduce((a, b) => a + b, 0), 1); return t; }
  function newUnique(s, operationId, family) { for (const p of s.products) for (const cycle of [p, ...Archive.inspect(p).snapshots]) if (rows(cycle[family]).some(r => r.id != null && id(r.id) === operationId) || s.markers.pairs.has(id(p.id) + '|' + family + '|id:' + operationId)) fail('conflict'); }
  function linked(p, h) { const matches = rows(p.qc).filter(q => q.hfId != null && id(q.hfId) === id(h.id) || h.qcId != null && q.id != null && id(q.id) === id(h.qcId)); if (matches.length > 1 || h.qcId != null && (matches.length !== 1 || matches[0].id == null || id(matches[0].id) !== id(h.qcId)) || matches.some(q => q.hfId != null && id(q.hfId) !== id(h.id))) fail('not_ready'); return matches[0] || null; }
  function linkSafety(p, q, h = null) {
    if (q.id == null) fail('not_ready'); const qid = id(q.id), hid = h ? id(h.id) : q.hfId == null ? null : id(q.hfId);
    if (yes(q.dibayar) || h && yes(h.dibayar)) fail('conflict');
    for (const other of rows(p.hitungFisik)) if (other.qcId != null && id(other.qcId) === qid && (hid === null || other.id == null || id(other.id) !== hid)) fail('not_ready');
    for (const field of ['gudang', 'bigSaller']) for (const g of rows(p[field])) { if (g.qcId != null && id(g.qcId) === qid && g.hfId != null && id(g.hfId) !== hid || hid !== null && g.hfId != null && id(g.hfId) === hid && g.qcId != null && id(g.qcId) !== qid) fail('not_ready'); if (yes(g.dibayar) && (g.qcId != null && id(g.qcId) === qid || hid !== null && g.hfId != null && id(g.hfId) === hid)) fail('conflict'); }
  }
  function mirrors(root, p, q, previousDate, cmd, time) {
    let sequence = 0; const warehouse = Payroll.reconcileQcWarehouse(p.gudang, q, { previousDate, newId: () => cmd.requestId + '-g' + sequence++ });
    // Supply authoritative explicit worker IDs on new v2 mirrors.
    for (const g of warehouse) if (g.qcId != null && id(g.qcId) === id(q.id) && Number(q.workflowVersion) === 2) { g.tukangId = q.tukangId; g.workflowVersion = 2; }
    rows(warehouse); const sellable = Payroll.reconcileQcSellable(p.bigSaller, q, warehouse); rows(sellable);
    replaceMirrors(root, p, 'gudang', warehouse, time); replaceMirrors(root, p, 'bigSaller', sellable, time);
  }
  function dependents(before, after, workers) {
    const b = Workflow.inspect(before, workers), a = Workflow.inspect(after, workers);
    if (a.reasons.includes('assignment-worker-mismatch')) fail('conflict'); const keys = new Set([...b.groups, ...a.groups].map(g => g.key));
    for (const key of keys) { const old = b.groups.find(g => g.key === key), next = a.groups.find(g => g.key === key); if (Math.max(0, (next?.counted || 0) - (next?.sewn || 0)) > Math.max(0, (old?.counted || 0) - (old?.sewn || 0))) fail('conflict'); }
  }
  function mutateJahit(root, p, s, c, cmd, time) {
    const old = selected(p.jahit, cmd.operationId); if (old.tukangId !== c.binding.workerId) fail('access_denied'); if (yes(old.dibayar)) fail('conflict');
    const before = normalizedProduct(p, s), good = pcs(old.lolos == null ? pcs(old.jumlah) - pcs(old.rijek ?? 0) : old.lolos), reject = pcs(old.rijek ?? 0); if (good + reject !== pcs(old.jumlah, 1)) fail('not_ready');
    if (cmd.kind === 'deleteJahit') remove(root, p, 'jahit', r => r === old, time);
    else { const next = { ...old, tanggal: cmd.workDate, jumlah: cmd.good + cmd.reject, rijek: cmd.reject, lolos: cmd.good, quantityBasis: 'good-plus-reject', editedAt: time };
      if (cmd.good !== good) { const rate = amount(old.tarif), total = amount(old.total); if (rate <= 0 || total !== good * rate || !Number.isFinite(cmd.good * rate) || cmd.good * rate > Number.MAX_SAFE_INTEGER) fail('not_ready'); next.total = cmd.good * rate; }
      put(p, 'jahit', next, old);
    }
    const after = normalizedProduct(p, { ...s, markers: markers(root.soldier) }); dependents(before, after, s.workers);
    for (const assignment of rows(p.assignJahit).filter(a => a.tukangId === c.binding.workerId && !ignored(a))) { const progress = Workflow.assignmentProgress(after, assignment, s.workers); if (!progress.known || progress.rawSewn > progress.assigned) fail('conflict'); assignment.sisa = progress.remaining; assignment.editedAt = time; }
  }
  function validateCount(p, s, c, workerId, quantity) { worker(s, c, workerId); const state = Workflow.inspect(normalizedProduct(p, s), s.workers), group = state.groups.find(g => g.workerId === workerId); if (state.needsReview || !group) fail('not_ready'); if (quantity > Math.min(group.pendingCount, state.remainingPO)) fail('conflict'); }
  function mutateCount(root, p, s, c, cmd, time) {
    if (cmd.kind === 'appendCount') { newUnique(s, cmd.operationId, 'hitungFisik'); validateCount(p, s, c, cmd.workerId, cmd.quantity); const w = worker(s, c, cmd.workerId), payroll = frozenPayroll(s, c, p, { tukangId: cmd.workerId }, cmd.workDate); put(p, 'hitungFisik', { id: cmd.operationId, tanggal: cmd.workDate, jumlah: cmd.quantity, tukang: w.nama, tukangId: id(w.id), payroll, workflowVersion: 2, countStage: 'verified', inputBy: c.binding.uid, inputAt: time, inputVia: 'qc-staged' }); return; }
    const h = selected(p.hitungFisik, cmd.operationId), q = linked(p, h); if (h.payrollCancelled || yes(h.dibayar)) fail('conflict'); if (q) linkSafety(p, q, h);
    if (cmd.kind === 'deleteCount') { const qid = q ? id(q.id) : null, hid = id(h.id); for (const field of ['gudang', 'bigSaller']) { for (const g of rows(p[field])) if (g.hfId != null && id(g.hfId) === hid && g.qcId != null && id(g.qcId) !== qid) fail('not_ready'); remove(root, p, field, g => g.hfId != null && id(g.hfId) === hid || qid !== null && g.qcId != null && id(g.qcId) === qid, time); } if (q) remove(root, p, 'qc', r => r === q, time); remove(root, p, 'hitungFisik', r => r === h, time); return; }
    if (q && (Number(h.workflowVersion) >= 2 || Number(q.workflowVersion) >= 2)) fail('conflict');
    const n = normalizedProduct(p, s); n.hitungFisik = n.hitungFisik.filter(r => r !== h); validateCount(n, s, c, id(rowWorker(s, c, h).id), cmd.quantity);
    const next = { ...h, tanggal: cmd.workDate, jumlah: cmd.quantity, editedAt: time, editedBy: c.binding.uid };
    if (q) { const totals = qcTotals(q), other = totals.perbaikan + totals.reject + totals.offline; if (cmd.quantity < other) fail('conflict'); const updated = { ...q, ok: cmd.quantity - other, tanggal: cmd.workDate, payroll: frozenPayroll(s, c, p, q, q.tanggal), editedAt: time }; next.payroll = updated.payroll; put(p, 'qc', updated, q); mirrors(root, p, updated, q.tanggal, cmd, time); }
    else if (rows(p.gudang).some(g => g.hfId != null && id(g.hfId) === id(h.id)) || rows(p.bigSaller).some(g => g.hfId != null && id(g.hfId) === id(h.id))) fail('not_ready');
    put(p, 'hitungFisik', next, h);
  }
  function inspectOne(root, p, s, c, cmd, countId, qcId, totals, time) {
    const h = selected(p.hitungFisik, countId); if (h.payrollCancelled || linked(p, h)) fail('conflict'); if (!Workflow.inspect(normalizedProduct(p, s), s.workers).readyForQC) fail('conflict');
    if (Object.values(totals).reduce((a, b) => a + b, 0) !== pcs(h.jumlah, 1) || cmd.workDate < day(h.tanggal)) fail('conflict'); newUnique(s, qcId, 'qc'); const payroll = frozenPayroll(s, c, p, h, h.tanggal);
    const q = { id: qcId, hfId: h.id, workflowVersion: 2, tanggal: cmd.workDate, ...totals, keterangan: cmd.note, tukangJahit: payroll.workerName, tukangId: payroll.workerId, payroll, pemeriksa: c.binding.uid, inputAt: time, autoFromCount: false };
    if (cmd.kind === 'inspectCounts') q.qcBatchId = cmd.operationId;
    put(p, 'qc', q); put(p, 'hitungFisik', { ...h, qcId: q.id, tukangId: payroll.workerId, payroll, workflowVersion: 2, countStage: 'verified' }, h); linkSafety(p, q, h); mirrors(root, p, q, null, { ...cmd, requestId: qcId }, time);
  }
  function editQuality(root, p, s, c, cmd, q, totals, when, time) {
    const h = q.hfId == null ? null : selected(p.hitungFisik, id(q.hfId)); if (h && linked(p, h) !== q) fail('not_ready'); linkSafety(p, q, h);
    const total = Object.values(totals).reduce((a, b) => a + b, 0), prior = qcTotals(q); if (Number(q.workflowVersion) >= 2 && (!h || h.payrollCancelled || total !== pcs(h.jumlah, 1)) || Number(q.workflowVersion) < 2 && total !== Object.values(prior).reduce((a, b) => a + b, 0)) fail('conflict');
    if (h && when < day(h.tanggal)) fail('conflict'); const repaired = rows(p.gudang).filter(g => g.qcId != null && id(g.qcId) === id(q.id) && g.status === 'ok' && (g.payrollStage === 'repair' || g.payrollStage !== 'initial' && g.tanggal !== q.tanggal)).reduce((sum, g) => sum + pcs(g.jumlah), 0); if (totals.ok < repaired) fail('conflict');
    if (Object.keys(totals).some(k => totals[k] !== prior[k]) && (rows(p.gudang).some(g => g.qcId == null && pcs(g.jumlah ?? 0) > 0) || rows(p.bigSaller).some(g => g.qcId == null && pcs(g.jumlah ?? 0) > 0 && g.hfId == null))) fail('not_ready');
    const next = { ...q, tanggal: when, ok: totals.ok, reject: totals.reject, offline: totals.offline, keterangan: cmd.note, editedAt: time, editedBy: c.binding.uid };
    if (q.perbaikan == null && q.kotor != null) next.kotor = totals.perbaikan; else next.perbaikan = totals.perbaikan;
    // Only genuine v2 sources can supply the strict partner finance lane.
    if (Number(q.workflowVersion) >= 2) { const payroll = frozenPayroll(s, c, p, h, h.tanggal), own = frozenPayroll(s, c, p, q, q.tanggal); if (canonical(payroll) !== canonical(own)) fail('not_ready'); }
    put(p, 'qc', next, q); mirrors(root, p, next, q.tanggal, { ...cmd, requestId: cmd.requestId.slice(0, 64) + '-m' + digest(id(q.id)).slice(0, 32) }, time);
  }
  function repair(root, p, s, c, cmd, time) {
    const q = selected(p.qc, cmd.operationId), h = q.hfId == null ? null : selected(p.hitungFisik, id(q.hfId)); linkSafety(p, q, h); const totals = qcTotals(q); if (cmd.quantity > totals.perbaikan || cmd.workDate < day(q.tanggal)) fail('conflict');
    const payroll = frozenPayroll(s, c, p, q, q.tanggal); if (Number(q.workflowVersion) >= 2 && (!h || h.payrollCancelled || canonical(payroll) !== canonical(frozenPayroll(s, c, p, h, h.tanggal)))) fail('not_ready');
    const next = { ...q, ok: totals.ok + cmd.quantity, perbaikanBeresHariIni: pcs(q.perbaikanBeresHariIni ?? 0) + cmd.quantity, editedAt: time, editedBy: c.binding.uid, payroll };
    if (q.perbaikan == null && q.kotor != null) next.kotor = totals.perbaikan - cmd.quantity; else next.perbaikan = totals.perbaikan - cmd.quantity; pcs(next.ok); pcs(next.perbaikanBeresHariIni);
    // Reduce the existing repair-pending mirror, then add a dated repair OK
    // movement. This prevents a repair from being paid on the initial count day.
    const warehouse = rows(p.gudang).map(g => ({ ...g })), pending = warehouse.filter(g => g.qcId != null && id(g.qcId) === id(q.id) && ['kotor', 'perbaikan'].includes(g.status));
    let remaining = cmd.quantity; for (const g of pending) { const take = Math.min(remaining, pcs(g.jumlah)); g.jumlah -= take; remaining -= take; } if (remaining) fail('not_ready');
    const movement = { id: cmd.requestId + '-repair', tanggal: cmd.workDate, jumlah: cmd.quantity, status: 'ok', qcId: q.id, tukangJahit: payroll.workerName, payroll, ket: 'Perbaikan beres → OK' }; if (h) movement.hfId = h.id; if (Number(q.workflowVersion) >= 2) { movement.tukangId = payroll.workerId; movement.workflowVersion = 2; movement.payrollStage = 'repair'; }
    if (warehouse.some(g => g.id != null && id(g.id) === movement.id)) fail('conflict'); warehouse.push(movement);
    const kept = warehouse.filter(g => g.qcId == null || id(g.qcId) !== id(q.id) || pcs(g.jumlah) > 0); rows(kept); const sellable = Payroll.reconcileQcSellable(p.bigSaller, next, kept); rows(sellable); put(p, 'qc', next, q); replaceMirrors(root, p, 'gudang', kept, time); replaceMirrors(root, p, 'bigSaller', sellable, time);
  }
  function mutate(root, p, s, c, cmd, time) {
    if (cmd.kind.endsWith('Jahit')) return mutateJahit(root, p, s, c, cmd, time);
    if (['appendCount', 'editCount', 'deleteCount'].includes(cmd.kind)) return mutateCount(root, p, s, c, cmd, time);
    if (cmd.kind === 'inspectCount') return inspectOne(root, p, s, c, cmd, cmd.countId, cmd.operationId, cmd.totals, time);
    if (cmd.kind === 'editQC') return editQuality(root, p, s, c, cmd, selected(p.qc, cmd.operationId), cmd.totals, cmd.workDate, time);
    if (cmd.kind === 'repairQC') return repair(root, p, s, c, cmd, time);
    const editing = cmd.kind === 'editQCGroup', inputs = (editing ? cmd.qcIds : cmd.countIds).map(key => selected(p[editing ? 'qc' : 'hitungFisik'], key)); const workers = inputs.map(r => id(rowWorker(s, c, r).id)); if (new Set(workers).size !== 1) fail('conflict');
    const input = inputs.map(r => ({ id: r.id, tanggal: r.tanggal, jumlah: editing ? Object.values(qcTotals(r)).reduce((a, b) => a + b, 0) : r.jumlah, ...(editing ? qcTotals(r) : {}) }));
    let plan; try { plan = Batch.plan(input, cmd.totals, editing); } catch { fail('conflict'); }
    for (let index = 0; index < plan.length; index++) { const row = plan[index], totals = { ok: row.ok, perbaikan: row.perbaikan, reject: row.reject, offline: row.offline }; if (editing) { const q = selected(p.qc, row.id); editQuality(root, p, s, c, cmd, q, totals, q.tanggal, time); } else inspectOne(root, p, s, c, cmd, row.id, cmd.operationId + '-q' + index, totals, time); }
  }
  function wireValue(v) {
    if (v == null) return null;
    if (typeof v !== 'object') return v;
    const out = {}; for (const key of Object.keys(v)) { const value = wireValue(v[key]); if (value !== null) out[key] = value; }
    return Object.keys(out).length ? out : null;
  }
  function collectionHash(p, family) { return digest(wireValue(family === 'poControls' ? Object.fromEntries(PO_FIELDS.filter(k => Object.hasOwn(p, k)).map(k => [k, p[k]])) : p[family])); }
  function ownerVersion(p) { return digest(wireValue(p)); }
  function hasCycle(p) { return CYCLE_FIELDS.some(field => rows(p[field]).length > 0); }
  function archiveUnique(p, archiveId) { if (rows(p.arsip).some(a => a.id != null && id(a.id) === archiveId)) fail('conflict'); }
  function snapshot(p, archiveId, title, time) {
    archiveUnique(p, archiveId);
    const arc = { id: archiveId, tanggalArsip: new Date(Date.parse(time) + 7 * 3600000).toISOString().slice(0, 10), label: title };
    for (const field of [...CYCLE_FIELDS, ...PO_FIELDS]) if (Object.hasOwn(p, field)) arc[field] = copy({ value: p[field] }).value;
    put(p, 'arsip', arc);
  }
  function ownerHistory(row, field, before, cmd, c, time) {
    if (row[field] != null && !Array.isArray(row[field])) fail('not_ready'); const history = row[field] || []; if (history.length >= 256) fail('capacity_limit');
    row[field] = [...history, { requestId: cmd.requestId, changedBy: c.binding.uid, changedAt: time, before }];
  }
  function ownerAssignment(root, p, s, c, cmd, time) {
    editable(p, s); worker(s, c, cmd.workerId); const before = normalizedProduct(p, s), adding = cmd.kind === 'ownerAppendAssignment', old = adding ? null : selected(p.assignJahit, cmd.assignmentId);
    if (s.markers.pairs.has(id(p.id) + '|assignJahit|id:' + cmd.assignmentId)) fail('conflict'); if (adding) newUnique(s, cmd.assignmentId, 'assignJahit');
    let done = 0; if (old) { const progress = Workflow.assignmentProgress(before, old, s.workers); if (!progress.known) fail('not_ready'); done = pcs(progress.rawSewn); if (cmd.quantity < done || done > 0 && id(old.tukangId) !== cmd.workerId) fail('conflict'); }
    const next = { ...(old || {}), id: old?.id ?? cmd.assignmentId, tukangId: cmd.workerId, qty: cmd.quantity, sisa: cmd.quantity - done, tanggal: cmd.workDate, ket: cmd.note, editedAt: time, editedBy: c.binding.uid };
    if (cmd.targetDate === null) delete next.targetTanggal; else next.targetTanggal = cmd.targetDate;
    const candidate = { ...before, assignJahit: before.assignJahit.filter(a => a !== old).concat([next]) };
    for (const a of candidate.assignJahit) { const progress = Workflow.assignmentProgress(candidate, a, s.workers); if (!progress.known || progress.rawSewn > progress.assigned) fail('conflict'); }
    const sum = entries => entries.reduce((n, a) => pcs(n + pcs(a.qty, 1)), 0), cutting = before.potong.reduce((n, r) => pcs(n + pcs(r.jumlah, 1)), 0), ceiling = cutting || (p.poJumlah == null ? 0 : pcs(p.poJumlah));
    if (ceiling && sum(candidate.assignJahit) > Math.max(ceiling, sum(before.assignJahit))) fail('conflict'); dependents(before, candidate, s.workers); put(p, 'assignJahit', next, old);
  }
  function ownerSewing(root, p, s, c, cmd, time) {
    editable(p, s); const w = worker(s, c, cmd.workerId), before = normalizedProduct(p, s), adding = cmd.kind === 'ownerAppendJahit', old = adding ? null : selected(p.jahit, cmd.recordId);
    if (s.markers.pairs.has(id(p.id) + '|jahit|id:' + cmd.recordId)) fail('conflict'); if (adding) newUnique(s, cmd.recordId, 'jahit');
    if (old && (yes(old.dibayar) || Object.hasOwn(old, 'dibayarAt'))) fail('conflict');
    if (old?.payroll != null && old.payroll.workerId !== cmd.workerId) fail('conflict');
    const next = { ...(old || {}), id: old?.id ?? cmd.recordId, tukangId: cmd.workerId, tukangNama: w.nama, tanggal: cmd.workDate, jumlah: cmd.good + cmd.reject, lolos: cmd.good, rijek: cmd.reject, quantityBasis: 'good-plus-reject', editedAt: time, editedBy: c.binding.uid };
    const ownerAssignments = before.assignJahit.filter(a => id(rowWorker(s, c, a).id) === cmd.workerId), assignmentId = adding ? cmd.assignmentId : old.assignmentId == null ? null : id(old.assignmentId);
    if (assignmentId !== null) { const a = selected(p.assignJahit, assignmentId); if (!before.assignJahit.includes(a) || id(rowWorker(s, c, a).id) !== cmd.workerId) fail('conflict'); next.assignmentId = a.id; }
    else if (ownerAssignments.length === 1) next.assignmentId = id(ownerAssignments[0].id);
    else if (ownerAssignments.length > 1) fail('conflict');
    if (cmd.amountMode === 'stored') {
      const good = pcs(old.lolos == null ? pcs(old.jumlah) - pcs(old.rijek ?? 0) : old.lolos), reject = pcs(old.rijek ?? 0);
      if (good !== cmd.good || reject !== cmd.reject || id(rowWorker(s, c, old).id) !== cmd.workerId) fail('invalid_request');
    } else {
      if (old) ownerHistory(next, 'amountCorrections', Object.fromEntries(['tukangId', 'jumlah', 'lolos', 'rijek', 'tarif', 'total'].filter(k => Object.hasOwn(old, k)).map(k => [k, old[k]])), cmd, c, time);
      next.tarif = cmd.rate; next.total = cmd.total; next.amountReviewedBy = c.binding.uid; next.amountReviewedAt = time;
    }
    if (adding) { next.dibayar = false; next.inputAt = time; }
    const candidate = { ...before, jahit: before.jahit.filter(r => r !== old).concat([next]) }; dependents(before, candidate, s.workers);
    for (const a of candidate.assignJahit) { const progress = Workflow.assignmentProgress(candidate, a, s.workers); if (!progress.known || progress.rawSewn > progress.assigned) fail('conflict'); }
    put(p, 'jahit', next, old);
    for (const a of before.assignJahit) { const progress = Workflow.assignmentProgress(candidate, a, s.workers); if (a.sisa !== progress.remaining) { a.sisa = progress.remaining; a.editedAt = time; } }
  }
  function mutateOwner(root, p, s, c, cmd, time) {
    if (['ownerAppendAssignment', 'ownerEditAssignment'].includes(cmd.kind)) return ownerAssignment(root, p, s, c, cmd, time);
    if (['ownerAppendJahit', 'ownerEditJahit'].includes(cmd.kind)) return ownerSewing(root, p, s, c, cmd, time);
    if (['ownerAppendPaymentNote', 'ownerEditPaymentNote'].includes(cmd.kind)) {
      editable(p, s); if (s.markers.pairs.has(id(p.id) + '|bayarJahit|id:' + cmd.recordId)) fail('conflict'); const adding = cmd.kind === 'ownerAppendPaymentNote'; if (adding) newUnique(s, cmd.recordId, 'bayarJahit');
      const old = adding ? null : selected(p.bayarJahit, cmd.recordId); put(p, 'bayarJahit', { ...(old || {}), id: old?.id ?? cmd.recordId, tanggal: cmd.workDate, editedAt: time, editedBy: c.binding.uid }, old); return;
    }
    if (cmd.kind === 'ownerSetPaid') {
      editable(p, s); if (s.markers.pairs.has(id(p.id) + '|' + cmd.family + '|id:' + cmd.recordId)) fail('conflict'); const old = selected(p[cmd.family], cmd.recordId); rowWorker(s, c, old);
      if (old.dibayar != null && ![true, false, 0, 1, 'true', 'false'].includes(old.dibayar)) fail('not_ready'); if ((yes(old.dibayar) || Object.hasOwn(old, 'dibayarAt')) === cmd.paid && (!cmd.paid || old.tanggalBayar === cmd.workDate)) fail('conflict');
      const next = { ...old, dibayar: cmd.paid, editedAt: time, editedBy: c.binding.uid }; ownerHistory(next, 'paymentCorrections', Object.fromEntries(['dibayar', 'dibayarAt', 'tanggalBayar'].filter(k => Object.hasOwn(old, k)).map(k => [k, old[k]])), cmd, c, time);
      if (cmd.paid) { next.dibayarAt = time; next.tanggalBayar = cmd.workDate; } else { delete next.dibayarAt; delete next.tanggalBayar; } put(p, cmd.family, next, old); return;
    }
    rows(p.arsip); for (const field of CYCLE_FIELDS) rows(p[field]);
    if (cmd.kind === 'ownerArchiveCycle') {
      if (!hasCycle(p)) fail('conflict'); snapshot(p, cmd.archiveId, cmd.label, time);
      for (const field of CYCLE_FIELDS) p[field] = []; p.bigSeller = false; delete p.needsVerify; p.poAktif = cmd.startNewPO; if (!cmd.startNewPO) p.poKet = ''; return;
    }
    if (cmd.kind === 'ownerRelabelArchive') { const arc = selected(p.arsip, cmd.archiveId); arc.label = cmd.label; return; }
    if (cmd.kind === 'ownerSetPO') { p.poAktif = cmd.active; p.poJumlah = cmd.quantity; if (cmd.workDate === null) delete p.poTanggal; else p.poTanggal = cmd.workDate; p.poKet = cmd.note; return; }
    const arc = selected(p.arsip, cmd.archiveId), saved = copy({ value: arc }).value, hasCurrent = hasCycle(p);
    for (const field of CYCLE_FIELDS) rows(saved[field]);
    if (hasCurrent) { if (cmd.safetyArchiveId === null || cmd.safetyLabel === null || cmd.safetyArchiveId === cmd.archiveId) fail('invalid_request'); snapshot(p, cmd.safetyArchiveId, cmd.safetyLabel, time); }
    else if (cmd.safetyArchiveId !== null || cmd.safetyLabel !== null) fail('invalid_request');
    for (const field of CYCLE_FIELDS) { if (Object.hasOwn(saved, field)) p[field] = saved[field]; else delete p[field]; }
    for (const field of PO_FIELDS.filter(k => k !== 'poAktif')) if (Object.hasOwn(saved, field)) p[field] = saved[field];
    p.poAktif = true;
    if (Array.isArray(p.arsip)) p.arsip = p.arsip.filter(a => a !== arc); else { const key = Object.keys(p.arsip).find(k => p.arsip[k] === arc); if (key === undefined) fail('conflict'); delete p.arsip[key]; }
  }
  function loadLedger(root) {
    if (!Object.hasOwn(root, LEDGER)) return null; if (!plain(root[LEDGER])) fail('not_ready'); if (!Object.hasOwn(root[LEDGER], binding.tenantId)) return null; const l = root[LEDGER][binding.tenantId];
    exact(l, ['schemaVersion', 'projectId', 'tenantId', 'policyVersion', 'commands', 'heads']); if (l.schemaVersion !== 2 || l.projectId !== binding.projectId || l.tenantId !== binding.tenantId || l.policyVersion !== POLICY || !plain(l.commands) || !plain(l.heads)) fail('not_ready'); if (Object.keys(l.commands).length > MAX_COMMANDS || Object.keys(l.heads).length > 20000) fail('capacity_limit');
    for (const [key, r] of Object.entries(l.commands)) { newId(key); exact(r, ['uid', 'googleSubject', 'grantRevision', 'identityGuard', 'payloadHash', 'operationId', 'productId', 'createdAt', 'effects']); for (const k of ['uid', 'googleSubject', 'operationId', 'productId']) id(r[k]); pcs(r.grantRevision, 1); instant(r.createdAt); if (Date.parse(r.createdAt) > highWater || !HASH.test(r.identityGuard) || !HASH.test(r.payloadHash) || !plain(r.effects) || Object.keys(r.effects).length < 1 || Object.keys(r.effects).length > LEDGER_FAMILIES.length) fail('not_ready'); for (const [f, e] of Object.entries(r.effects)) { if (!LEDGER_FAMILIES.includes(f)) fail('not_ready'); exact(e, ['before', 'after', 'previous']); if (!HASH.test(e.before) || !HASH.test(e.after) || typeof e.previous !== 'string' || e.previous !== '' && !Object.hasOwn(l.commands, e.previous)) fail('not_ready'); } }
    for (const [key, head] of Object.entries(l.heads)) { if (!/^([A-Za-z0-9_-]{1,128})\|(jahit|assignJahit|hitungFisik|qc|gudang|bigSaller|potong|bayarJahit|arsip|poControls)$/.test(key)) fail('not_ready'); exact(head, ['requestId', 'digest']); if (!Object.hasOwn(l.commands, head.requestId) || !HASH.test(head.digest)) fail('not_ready'); }
    return l;
  }
  function verifyChain(l, p, family, requestId = null) {
    const key = id(p.id) + '|' + family, head = l.heads[key]; if (!head || head.digest !== collectionHash(p, family)) fail('conflict'); let cursor = head.requestId, expected = head.digest, found = requestId === null, seen = new Set();
    while (cursor !== '') { if (seen.has(cursor) || seen.size >= MAX_COMMANDS) fail('not_ready'); seen.add(cursor); const r = l.commands[cursor], e = r?.effects?.[family]; if (!e || r.productId !== id(p.id) || e.after !== expected) fail('not_ready'); if (cursor === requestId) found = true; expected = e.before; cursor = e.previous; } if (!found) fail('conflict');
  }
  function receipt(root, s, c, who, cmd, l) {
    const r = l?.commands[cmd.requestId]; if (!r) return null;
    if (r.uid !== c.binding.uid || r.googleSubject !== who.googleSubject || r.grantRevision !== c.binding.grantRevision || r.payloadHash !== digest(cmd) || r.operationId !== cmd.operationId || r.productId !== cmd.productId || r.identityGuard !== digest({ initialization: c.initialization, workerCatalog: c.workerCatalog }) || r.createdAt < c.initialization.initializedAt) fail('conflict');
    const p = selected(s.products, cmd.productId); for (const family of Object.keys(r.effects)) verifyChain(l, p, family, cmd.requestId); return { ok: true, replayed: true, operationId: r.operationId };
  }
  function prepare(raw, resolving, owner = false) {
    exact(raw, ['root', 'identity', 'command'], 'invalid_request'); let root = copy(raw.root); const who = copy(raw.identity), cmd = (owner ? ownerCommand : command)(raw.command), time = now(), c = context(root, who, time, owner); let s = source(root);
    if (cmd.expectedGrantRevision !== c.binding.grantRevision) fail('conflict'); if (!owner && (c.binding.division === 'jahit' ? !cmd.kind.endsWith('Jahit') : cmd.kind.endsWith('Jahit'))) fail('access_denied'); const l = loadLedger(root), previous = receipt(root, s, c, who, cmd, l); if (previous) return freeze(resolving ? { ok: true, receipt: previous } : { ok: true, next: root, receipt: previous }); if (resolving) fail('result_unknown'); if (l && Object.keys(l.commands).length >= MAX_COMMANDS) fail('capacity_limit');
    let p = selected(s.products, cmd.productId); if (!owner) editable(p, s); else if (s.markers.products.has(cmd.productId)) fail('conflict'); const version = owner ? ownerVersion(p) : c.binding.division === 'qc' ? qcView(p, s, c).sourceVersion : jahit.read({ root, identity: who }).view?.products.find(v => v.productId === cmd.productId)?.sourceVersion; if (!version || version !== cmd.expectedSourceVersion) fail('conflict');
    const targetFamily = cmd.kind.endsWith('Jahit') && cmd.kind !== 'appendJahit' ? 'jahit' : ['editCount', 'deleteCount'].includes(cmd.kind) ? 'hitungFisik' : ['editQC', 'repairQC'].includes(cmd.kind) ? 'qc' : null;
    if (targetFamily && s.markers.pairs.has(cmd.productId + '|' + targetFamily + '|id:' + cmd.operationId)) fail('conflict');
    for (const [family, keys] of [['hitungFisik', cmd.countIds || (cmd.countId ? [cmd.countId] : [])], ['qc', cmd.qcIds || []]]) for (const key of keys) if (s.markers.pairs.has(cmd.productId + '|' + family + '|id:' + key)) fail('conflict');
    if (Object.hasOwn(cmd, 'workDate') && cmd.workDate !== null && cmd.workDate > new Date(Date.parse(time) + 7 * 3600000).toISOString().slice(0, 10)) fail('invalid_request');
    const before = {}; for (const family of LEDGER_FAMILIES) { before[family] = collectionHash(p, family); if (l?.heads[cmd.productId + '|' + family]) verifyChain(l, p, family); }
    if (owner) mutateOwner(root, p, s, c, cmd, time);
    else if (cmd.kind === 'appendJahit') { const proposed = jahit.append({ root, identity: who, command: cmd }); if (!proposed.ok) fail(proposed.error); if (proposed.receipt.replayed) fail('conflict'); root = copy(proposed.next); s = source(root); p = selected(s.products, cmd.productId); }
    else mutate(root, p, s, c, cmd, time);
    const effects = {}; for (const family of LEDGER_FAMILIES) { const after = collectionHash(p, family); if (after !== before[family]) effects[family] = { before: before[family], after, previous: l?.heads[cmd.productId + '|' + family]?.requestId || '' }; }
    if (!Object.keys(effects).length) fail('conflict'); if (!root[LEDGER]) root[LEDGER] = {}; if (!l) root[LEDGER][binding.tenantId] = { schemaVersion: 2, projectId: binding.projectId, tenantId: binding.tenantId, policyVersion: POLICY, commands: {}, heads: {} }; const nextLedger = root[LEDGER][binding.tenantId];
    nextLedger.commands[cmd.requestId] = { uid: c.binding.uid, googleSubject: who.googleSubject, grantRevision: c.binding.grantRevision, identityGuard: digest({ initialization: c.initialization, workerCatalog: c.workerCatalog }), payloadHash: digest(cmd), operationId: cmd.operationId, productId: cmd.productId, createdAt: time, effects };
    for (const [family, effect] of Object.entries(effects)) nextLedger.heads[cmd.productId + '|' + family] = { requestId: cmd.requestId, digest: effect.after }; Core.serializeLegacyRoot(root); return freeze({ ok: true, next: root, receipt: { ok: true, replayed: false, operationId: cmd.operationId } });
  }
  function protect(fn) { try { return fn(); } catch (e) { const known = e instanceof LegacyLifecycleError || e instanceof Core.LegacyOperationsError || e instanceof State.IdentityStateError; return rejected(known && ['unavailable', 'invalid_request', 'access_denied', 'not_ready', 'conflict', 'capacity_limit', 'result_unknown'].includes(e.code) ? e.code : 'unavailable'); } }
  function read(raw) { return protect(() => { exact(raw, ['root', 'identity'], 'invalid_request'); const root = copy(raw.root), who = copy(raw.identity), c = context(root, who, now()); if (c.binding.division === 'jahit') return jahit.read({ root, identity: who }); const s = source(root), products = []; for (const p of s.products) if (!ignored(p) && !s.markers.products.has(id(p.id)) && !Archive.inspect(p).archived) products.push(qcView(p, s, c)); const view = { schemaVersion: 1, binding: c.binding, products }; if (Buffer.byteLength(canonical(view), 'utf8') > 1024 * 1024) fail('capacity_limit'); return freeze({ ok: true, view }); }); }
  function capture(raw) { return protect(() => { exact(raw, ['root', 'identity'], 'invalid_request'); return freeze({ ok: true, context: context(copy(raw.root), copy(raw.identity), now()) }); }); }
  function readOwner(raw) { return protect(() => {
    exact(raw, ['root', 'identity'], 'invalid_request'); const root = copy(raw.root), c = context(root, copy(raw.identity), now(), true), s = source(root);
    const products = s.products.filter(p => !ignored(p) && !s.markers.products.has(id(p.id))).map(p => ({ productId: id(p.id), series: label(p.series || ''), namaBarang: label(p.namaBarang || ''), size: label(p.size || ''), sourceVersion: ownerVersion(p), hasCurrent: hasCycle(p), archives: rows(p.arsip).map(a => ({ archiveId: a.id == null ? null : id(a.id), label: label(a.label || ''), workDate: a.tanggalArsip == null ? null : day(a.tanggalArsip) })) }));
    const workers = []; for (const record of s.workers) { if (record.id == null || c.workerCatalog.workers[id(record.id)]?.division !== 'jahit' || ignored(record) || record.active === false) continue; const w = worker(s, c, id(record.id)); workers.push({ workerId: id(w.id), workerLabel: label(w.nama) }); }
    const maintenance = s.products.filter(p => products.some(v => v.productId === id(p.id))).map(p => {
      const out = { productId: id(p.id), needsReview: false, assignments: [], sewing: [], payments: [], payableRows: [] }, live = normalizedProduct(p, s);
      const project = (entries, fn) => { for (const row of entries) try { if (row.id == null) fail('not_ready'); fn(row); } catch (e) { if (!(e instanceof LegacyLifecycleError)) throw e; out.needsReview = true; } };
      project(live.assignJahit, a => { const w = rowWorker(s, c, a), progress = Workflow.assignmentProgress(live, a, s.workers); if (!progress.known || progress.rawSewn > progress.assigned) fail('not_ready'); out.assignments.push({ assignmentId: id(a.id), workerId: id(w.id), workerLabel: label(w.nama), quantity: pcs(a.qty, 1), sewn: pcs(progress.rawSewn), workDate: a.tanggal == null ? null : day(a.tanggal), targetDate: a.targetTanggal == null || a.targetTanggal === '' ? null : day(a.targetTanggal), note: label(a.ket || '', 512) }); });
      project(live.jahit, r => { const w = rowWorker(s, c, r), good = pcs(r.lolos == null ? pcs(r.jumlah) - pcs(r.rijek ?? 0) : r.lolos), reject = pcs(r.rijek ?? 0); if (good + reject !== pcs(r.jumlah, 1)) fail('not_ready'); out.sewing.push({ recordId: id(r.id), workerId: id(w.id), workerLabel: label(w.nama), workDate: day(r.tanggal), good, reject, paid: yes(r.dibayar) || Object.hasOwn(r, 'dibayarAt'), storedRate: r.tarif == null ? null : amount(r.tarif), storedTotal: r.total == null ? null : amount(r.total) }); });
      project(liveCollection(p, 'bayarJahit', s.markers), r => out.payments.push({ recordId: id(r.id), workDate: day(r.tanggal) }));
      for (const family of ['jahit', 'hitungFisik', 'qc']) project(live[family], r => { const w = rowWorker(s, c, r); if (r.dibayar != null && ![true, false, 0, 1, 'true', 'false'].includes(r.dibayar)) fail('not_ready'); out.payableRows.push({ family, recordId: id(r.id), workerId: id(w.id), workerLabel: label(w.nama), workDate: day(r.tanggal), paid: yes(r.dibayar) || Object.hasOwn(r, 'dibayarAt') }); });
      return out;
    });
    const view = { schemaVersion: 2, binding: c.binding, products, maintenance: { workers, products: maintenance } }; if (Buffer.byteLength(canonical(view), 'utf8') > 1024 * 1024) fail('capacity_limit'); return freeze({ ok: true, view });
  }); }
  function captureOwner(raw) { return protect(() => { exact(raw, ['root', 'identity'], 'invalid_request'); return freeze({ ok: true, context: context(copy(raw.root), copy(raw.identity), now(), true) }); }); }
  const valueCopy = v => copy({ value: v }).value;
  const sameValue = (a, b) => canonical(a) === canonical(b);
  function businessProjection(root) {
    if (!plain(root.soldier)) fail('not_ready'); const business = { soldier: {} };
    for (const k of BUSINESS_ROOTS) if (Object.hasOwn(root.soldier, k)) business.soldier[k] = businessSafe(root.soldier[k]);
    const p = business.soldier.produksi;
    if (!plain(p) || !Object.hasOwn(p, 'produksi') || !plain(business.soldier.produksi_meta)) fail('not_ready');
    const deleted = markers(root.soldier).products, hide = row => row !== null && plain(row) && row.id != null && deleted.has(id(row.id));
    if (Array.isArray(p.produksi)) p.produksi = p.produksi.filter(row => !hide(row));
    else if (plain(p.produksi)) { for (const [k, row] of Object.entries(p.produksi)) if (hide(row)) delete p.produksi[k]; }
    else fail('not_ready');
    if (Buffer.byteLength(Core.serializeLegacyRoot(business), 'utf8') > MAX_BUSINESS_BYTES) fail('capacity_limit'); return business;
  }
  // A supplied projection never replaces hidden credentials, photos or host
  // identity fields. Record correspondence uses explicit IDs only. An idless
  // historic record may be retained exactly, never renamed or linked by label.
  function mergeBusiness(original, old, next, path) {
    if (sameValue(old, next)) return valueCopy(original);
    if (next === null || typeof next !== 'object') {
      if (original && typeof original === 'object' && !sameValue(original, businessSafe(original))) fail('conflict'); return valueCopy(next);
    }
    if (Array.isArray(next)) {
      const before = old == null ? [] : Array.isArray(old) ? old : plain(old) ? Object.values(old) : null;
      const raw = original == null ? [] : Array.isArray(original) ? original : plain(original) ? Object.values(original) : null;
      if (!before || !raw) fail('not_ready');
      const oldIds = new Map(), rawIds = new Map(); for (let i = 0; i < before.length; i++) if (plain(before[i]) && before[i].id != null) { const k = id(before[i].id); if (oldIds.has(k)) fail('not_ready'); oldIds.set(k, i); }
      for (const row of raw) if (plain(row) && row.id != null) { const k = id(row.id); if (rawIds.has(k)) fail('not_ready'); rawIds.set(k, row); }
      const seen = new Set(), result = next.map((row, index) => {
        if (plain(row) && row.id != null) { const k = id(row.id); if (seen.has(k)) fail('not_ready'); seen.add(k); const at = oldIds.get(k); return at === undefined ? valueCopy(row) : mergeBusiness(rawIds.get(k), before[at], row, path + '/' + k); }
        if (plain(row)) {
          if (index < before.length && plain(before[index]) && before[index].id == null && sameValue(row, before[index])) return valueCopy(raw[index]);
          if (!path.includes('/tarifHistory/') || index < before.length) fail('not_ready');
        }
        return valueCopy(row);
      });
      for (let i = 0; i < before.length; i++) if (plain(before[i]) && before[i].id == null && (i >= next.length || !sameValue(before[i], next[i]))) fail('not_ready');
      return result;
    }
    if (!plain(next)) fail('not_ready'); const out = {};
    if (original != null && !plain(original)) fail('not_ready'); if (old != null && !plain(old)) fail('not_ready');
    for (const k of Object.keys(next)) out[k] = original && Object.hasOwn(original, k) ? mergeBusiness(original[k], old?.[k], next[k], path + '/' + k) : valueCopy(next[k]);
    if (original) for (const k of Object.keys(original)) if (privateBusinessField(k)) out[k] = valueCopy(original[k]);
    return out;
  }
  function businessView(root, c) { return { schemaVersion: 1, binding: c.binding, sourceVersion: digest(businessProjection(root)), business: businessProjection(root) }; }
  function readBusiness(raw) { return protect(() => { exact(raw, ['root', 'identity'], 'invalid_request'); const root = copy(raw.root), c = context(root, copy(raw.identity), now(), true); return freeze({ ok: true, view: businessView(root, c) }); }); }
  function strictWorkerRef(row, s, c) {
    const refs = [row.tukangId, row.workerId, row.payroll?.workerId].filter(v => v != null && v !== '').map(v => id(v));
    if (!refs.length || new Set(refs).size !== 1) fail('not_ready'); worker(s, c, refs[0]); return refs[0];
  }
  function strictFrozen(row, s, c) {
    const wid = strictWorkerRef(row, s, c), pay = row.payroll;
    if (!plain(pay) || pay.workerId !== wid || pay.rateMissing !== false || amount(pay.rate) <= 0) fail('not_ready'); instant(pay.capturedAt); if (Date.parse(pay.capturedAt) > highWater) fail('not_ready'); return pay;
  }
  function validateStoredDelta(before, after, key = '') {
    if (sameValue(before, after)) return;
    if (after !== null && typeof after === 'object') {
      if (Array.isArray(after)) {
        const old = before == null ? [] : Array.isArray(before) ? before : plain(before) ? Object.values(before) : [];
        const ids = new Set(); for (let i = 0; i < after.length; i++) { const row = after[i]; let prior = old[i]; if (plain(row) && row.id != null) { const rid = id(row.id); if (ids.has(rid)) fail('not_ready'); ids.add(rid); prior = old.find(r => plain(r) && r.id != null && id(r.id) === rid); } validateStoredDelta(prior, row, key); }
      } else for (const [k, v] of Object.entries(after)) validateStoredDelta(plain(before) ? before[k] : undefined, v, k);
      return;
    }
    // Stored business amounts are accepted as owner-supplied observations.
    // They are bounded, never recomputed from current/date tariffs here.
    if (/^(?:tarif|rate|total|nominal|harga|hargaPerKg|hargaBeli|hargaJual|jumlah|qty|lolos|rijek|ok|perbaikan|reject|offline|gaji|upah|sisa|dp)$/i.test(key) && after !== null) {
      if (typeof after !== 'number') fail('not_ready'); amount(after);
    }
    if (/^(?:tanggal|tanggalBayar|tanggalArsip|targetTanggal)$/i.test(key) && after !== null && after !== '') day(after);
    if (/^(?:createdAt|editedAt|inputAt|capturedAt)$/i.test(key) && after !== null) { instant(after); if (Date.parse(after) > highWater) fail('not_ready'); }
  }
  function unchangedIdentities(before, after, field) {
    const old = rows(before[field]), next = rows(after[field]);
    for (const r of old) if (r.id == null && !next.some(n => sameValue(n, r))) fail('not_ready');
    return { old, next };
  }
  function retainMovedFields(before, after) {
    if (!before) return; const sources = [before, ...rows(before.arsip)], targets = [after, ...rows(after.arsip)];
    for (const field of CYCLE_FIELDS) for (const target of targets) for (const r of rows(target[field])) {
      if (r.id == null) continue; const current = sources.find(p => target === after ? p === before : target.id != null && p !== before && p.id != null && id(p.id) === id(target.id));
      if (current && rows(current[field]).some(x => x.id != null && id(x.id) === id(r.id) && sameValue(x, r))) continue;
      const matches = sources.flatMap(p => rows(p[field])).filter(x => x.id != null && id(x.id) === id(r.id)); if (!matches.length) continue;
      const original = matches[0]; if (matches.some(x => !sameValue(x, original))) fail('not_ready');
      // Only explicit identical IDs within one product/family carry hidden
      // source fields through an archive/restore. No labels/dates infer links.
      const merged = mergeBusiness(original, businessSafe(original), businessSafe(r), 'soldier/produksi/produksi/' + id(after.id) + '/' + field); for (const k of Object.keys(r)) delete r[k]; Object.assign(r, merged);
    }
  }
  function validateBusinessProduct(before, after, s, c, time, cmd) {
    if (before && id(before.id) !== id(after.id)) fail('conflict');
    const stagesChanged = ['hitungFisik', 'qc', 'gudang'].some(f => !sameValue(before?.[f], after[f]));
    for (const field of CYCLE_FIELDS) {
      if (sameValue(before?.[field], after[field])) continue; const { old, next } = unchangedIdentities(before || {}, after, field);
      for (const r of next) {
        const prior = r.id == null ? old.find(x => sameValue(x, r)) : old.find(x => x.id != null && id(x.id) === id(r.id)); if (prior && sameValue(prior, r)) continue;
        if (r.id == null) fail('not_ready'); id(r.id); if (r.tanggal != null) { day(r.tanggal); if (r.tanggal > new Date(Date.parse(time) + 7 * 3600000).toISOString().slice(0, 10)) fail('invalid_request'); }
        for (const k of ['jumlah', 'lolos', 'rijek', 'ok', 'perbaikan', 'kotor', 'reject', 'offline', 'qty', 'sisa']) if (Object.hasOwn(r, k)) pcs(r[k]);
        for (const k of ['tarif', 'total', 'nominal']) if (Object.hasOwn(r, k)) { if (typeof r[k] !== 'number') fail('not_ready'); amount(r[k]); }
        if (field === 'jahit' || field === 'assignJahit') strictWorkerRef(r, s, c);
        if (field === 'jahit' && pcs(r.jumlah, 1) !== pcs(r.lolos ?? r.jumlah - pcs(r.rijek ?? 0)) + pcs(r.rijek ?? 0)) fail('conflict');
        if (prior && (yes(prior.dibayar) || prior.dibayarAt != null) && ['jumlah', 'lolos', 'rijek', 'tarif', 'total', 'tukangId', 'workerId', 'payroll'].some(k => !sameValue(prior[k], r[k]))) fail('conflict');
        if (prior?.payroll != null && !sameValue(prior.payroll, r.payroll)) fail('conflict');
        if (prior && ['tarif', 'total', 'nominal', 'dibayar', 'dibayarAt', 'tanggalBayar'].some(k => !sameValue(prior[k], r[k]))) {
          if (r.ownerBusinessCorrections != null && !Array.isArray(r.ownerBusinessCorrections)) fail('not_ready'); const history = r.ownerBusinessCorrections || []; if (history.length >= 256) fail('capacity_limit');
          r.ownerBusinessCorrections = [...history, { requestId: cmd.requestId, changedBy: c.binding.uid, changedAt: time, before: Object.fromEntries(['tarif', 'total', 'nominal', 'dibayar', 'dibayarAt', 'tanggalBayar'].filter(k => Object.hasOwn(prior, k)).map(k => [k, valueCopy(prior[k])])) }];
        }
      }
      for (const r of old) if (r.id != null && !next.some(n => n.id != null && id(n.id) === id(r.id))) {
        const archived = rows(after.arsip).flatMap(a => rows(a[field])).filter(n => n.id != null && id(n.id) === id(r.id) && sameValue(n, r));
        if ((yes(r.dibayar) || r.dibayarAt != null) && archived.length !== 1) fail('conflict');
      }
    }
    if (before) {
      const previous = Workflow.inspect(normalizedProduct(before, s), s.workers), next = Workflow.inspect(normalizedProduct(after, s), s.workers); dependents(normalizedProduct(before, s), normalizedProduct(after, s), s.workers);
      for (const reason of ['assigned-exceeds-cut', 'sewn-exceeds-assigned', 'sewn-exceeds-upstream', 'count-exceeds-target', 'invalid-quantity', 'invalid-cut-quantity']) if (next.reasons.includes(reason) && !previous.reasons.includes(reason)) fail('conflict');
    }
    for (const a of rows(after.assignJahit)) if (!ignored(a)) {
      const prior = rows(before?.assignJahit).find(x => x.id != null && a.id != null && id(x.id) === id(a.id));
      if (prior && sameValue(prior, a) && !['jahit', 'assignJahit'].some(f => !sameValue(before?.[f], after[f]))) continue;
      strictWorkerRef(a, s, c); const progress = Workflow.assignmentProgress(normalizedProduct(after, s), a, s.workers);
      if (!progress.known || progress.rawSewn > progress.assigned || a.sisa != null && a.sisa !== progress.remaining) fail('conflict');
      if (prior && prior.tukangId !== a.tukangId && progress.rawSewn > 0) fail('conflict');
    }
    // Owner snapshots may carry staged transitions, but never manufacture a
    // second payable lane, a current-rate fallback or a detached QC mirror.
    if (stagesChanged) {
      const hf = rows(after.hitungFisik), qc = rows(after.qc), warehouse = rows(after.gudang);
      for (const field of ['hitungFisik', 'qc', 'gudang']) for (const r of rows(after[field])) {
        const old = rows(before?.[field]).find(x => x.id != null && r.id != null && id(x.id) === id(r.id));
        if (old && sameValue(old, r)) continue; if (r.workflowVersion !== 2) fail('not_ready'); strictFrozen(r, s, c);
      }
      for (const h of hf.filter(r => r.workflowVersion === 2 && !ignored(r) && !r.payrollCancelled)) {
        id(h.id); if (h.countStage !== 'verified') fail('not_ready'); const pay = strictFrozen(h, s, c); pcs(h.jumlah, 1); day(h.tanggal);
        if (!rows(before?.hitungFisik).some(old => old.id != null && id(old.id) === id(h.id)) && !sameValue(pay, frozenPayroll(s, c, after, { tukangId: pay.workerId }, h.tanggal))) fail('not_ready');
        const quality = qc.filter(q => q.hfId === h.id || h.qcId != null && q.id === h.qcId); if (quality.length > 1 || h.qcId != null && quality.length !== 1) fail('not_ready');
        if (!quality.length) continue; const q = quality[0]; if (q.workflowVersion !== 2 || q.hfId !== h.id || h.qcId !== q.id || !sameValue(strictFrozen(q, s, c), pay) || day(q.tanggal) < h.tanggal) fail('not_ready');
        const totals = qcTotals(q); if (Object.values(totals).reduce((n, v) => n + v, 0) !== h.jumlah) fail('conflict');
        const mirrors = warehouse.filter(g => g.qcId === q.id), sums = { ok: 0, perbaikan: 0, reject: 0, offline: 0 }; let repair = 0;
        for (const g of mirrors) { if (g.workflowVersion !== 2 || g.hfId !== h.id || !sameValue(strictFrozen(g, s, c), pay) || !['initial', 'repair'].includes(g.payrollStage)) fail('not_ready'); const category = g.status === 'kotor' ? 'perbaikan' : g.status; if (!Object.hasOwn(sums, category)) fail('not_ready'); sums[category] += pcs(g.jumlah, 1); if (g.payrollStage === 'repair') { if (category !== 'ok' || day(g.tanggal) < q.tanggal) fail('not_ready'); repair += g.jumlah; } }
        if (repair > totals.ok || Object.keys(sums).some(k => sums[k] !== totals[k])) fail('conflict');
      }
      for (const q of qc.filter(r => r.workflowVersion === 2 && !ignored(r))) if (hf.filter(h => h.id === q.hfId && h.qcId === q.id && !h.payrollCancelled).length !== 1) fail('not_ready');
      for (const g of warehouse.filter(r => r.workflowVersion === 2 && !ignored(r))) if (qc.filter(q => q.id === g.qcId && q.hfId === g.hfId && !ignored(q)).length !== 1) fail('not_ready');
    }
  }
  function validateBusinessMeta(before, after, s, c) {
    const prior = rows(before.tukangJahit), next = rows(after.tukangJahit);
    for (const old of prior) if (!next.some(w => old.id != null && w.id != null && id(w.id) === id(old.id))) fail('conflict');
    for (const w of next) {
      id(w.id); label(w.nama); const old = prior.find(x => x.id != null && id(x.id) === id(w.id));
      if (!old) { if (c.workerCatalog.workers[id(w.id)]) fail('conflict'); continue; }
      if (sameValue(old, w)) continue;
      if (!sameValue(old, w)) for (const field of ['id', 'pin', 'active', 'deleted', 'isDeleted', 'deletedAt']) if (!sameValue(old[field], w[field])) fail('conflict');
      if (w.tarif != null) { if (!plain(w.tarif)) fail('not_ready'); for (const v of Object.values(w.tarif)) amount(v); }
      if (w.tarifHistory != null) { if (!plain(w.tarifHistory)) fail('not_ready'); for (const [key, list] of Object.entries(w.tarifHistory)) { const oldList = old.tarifHistory?.[key] == null ? [] : Object.values(old.tarifHistory[key]), newList = list == null ? [] : Object.values(list); if (newList.length < oldList.length || oldList.some((r, i) => !sameValue(r, newList[i]))) fail('conflict'); let at = oldList.length ? Date.parse(oldList.at(-1).effectiveAt) : -1; for (const r of newList.slice(oldList.length)) { if (!plain(r)) fail('not_ready'); amount(r.rate); const t = Date.parse(r.effectiveAt); if (!Number.isFinite(t) || !Number.isFinite(at) || t < 0 || t > highWater || t < at) fail('not_ready'); at = t; } } }
      for (const key of Object.keys(old.tarifHistory || {})) if (!Object.hasOwn(w.tarifHistory || {}, key)) fail('conflict');
    }
    for (const loan of rows(after.kasbonJahit)) {
      const old = rows(before.kasbonJahit).find(x => x.id != null && loan.id != null && id(x.id) === id(loan.id)); if (old && sameValue(old, loan)) continue;
      id(loan.id); strictWorkerRef(loan, s, c); day(loan.tanggal); const total = amount(loan.jumlah), remaining = amount(loan.sisa), installments = rows(loan.cicilan); let paid = 0;
      for (const item of installments) { id(item.id); day(item.tanggal); paid += amount(item.jumlah); }
      if (paid > total || Math.abs(remaining - (total - paid)) > 1e-7 || (loan.status === 'lunas') !== (remaining === 0)) fail('conflict');
    }
  }
  function businessLedger(root) {
    if (!Object.hasOwn(root, BUSINESS_LEDGER)) return null; if (!plain(root[BUSINESS_LEDGER])) fail('not_ready'); const l = root[BUSINESS_LEDGER][binding.tenantId]; if (l == null) return null;
    exact(l, ['schemaVersion', 'projectId', 'tenantId', 'policyVersion', 'commands']); if (l.schemaVersion !== 1 || l.projectId !== binding.projectId || l.tenantId !== binding.tenantId || l.policyVersion !== BUSINESS_POLICY || !plain(l.commands)) fail('not_ready');
    if (Object.keys(l.commands).length > MAX_COMMANDS) fail('capacity_limit');
    for (const [key, r] of Object.entries(l.commands)) { newId(key); exact(r, ['uid', 'googleSubject', 'grantRevision', 'identityGuard', 'payloadHash', 'createdAt', 'products']); id(r.uid); id(r.googleSubject); pcs(r.grantRevision, 1); instant(r.createdAt); if (Date.parse(r.createdAt) > highWater || !HASH.test(r.identityGuard) || !HASH.test(r.payloadHash) || !Array.isArray(r.products) || r.products.length > 2000) fail('not_ready'); for (const x of r.products) { exact(x, ['productId', 'requestId']); id(x.productId); newId(x.requestId); } }
    return l;
  }
  function verifyBusinessChains(root, s) {
    const l = loadLedger(root); if (!l) return null; const ids = new Set(s.products.map(p => id(p.id)));
    for (const [key] of Object.entries(l.heads)) { const split = key.lastIndexOf('|'), pid = key.slice(0, split), family = key.slice(split + 1); if (!ids.has(pid)) fail('conflict'); verifyChain(l, selected(s.products, pid), family); }
    return l;
  }
  function prepareBusiness(raw, resolving) {
    exact(raw, ['root', 'identity', 'command'], 'invalid_request'); const root = copy(raw.root), who = copy(raw.identity), cmd = businessCommand(raw.command), time = now(), c = context(root, who, time, true); let s = source(root);
    if (cmd.expectedGrantRevision !== c.binding.grantRevision) fail('conflict'); const l = verifyBusinessChains(root, s), ledger = businessLedger(root), retained = ledger?.commands[cmd.requestId];
    const identityGuard = digest({ initialization: c.initialization, workerCatalog: c.workerCatalog });
    if (retained) {
      if (retained.uid !== c.binding.uid || retained.googleSubject !== who.googleSubject || retained.grantRevision !== c.binding.grantRevision || retained.identityGuard !== identityGuard || retained.payloadHash !== digest(cmd) || retained.createdAt < c.initialization.initializedAt) fail('conflict');
      for (const r of retained.products) { const linked = l?.commands[r.requestId]; if (!linked || linked.productId !== r.productId || linked.uid !== c.binding.uid || linked.payloadHash !== digest(cmd)) fail('not_ready'); for (const family of Object.keys(linked.effects)) verifyChain(l, selected(s.products, r.productId), family, r.requestId); }
      const receipt = { ok: true, replayed: true, requestId: cmd.requestId }; return freeze(resolving ? { ok: true, receipt } : { ok: true, next: root, receipt });
    }
    if (resolving) fail('result_unknown'); if (ledger && Object.keys(ledger.commands).length >= MAX_COMMANDS || l && Object.keys(l.commands).length >= MAX_COMMANDS) fail('capacity_limit');
    const before = businessProjection(root); if (digest(before) !== cmd.expectedSourceVersion) fail('conflict'); const proposed = valueCopy(before);
    for (const change of cmd.changes) { const parts = change.path.split('/'); let node = proposed; for (const part of parts.slice(0, -1)) { if (!plain(node[part])) fail('not_ready'); node = node[part]; } const leaf = parts.at(-1); if (change.action === 'set') node[leaf] = valueCopy(change.value); else delete node[leaf]; }
    if (sameValue(before, proposed)) fail('conflict'); validateStoredDelta(before, proposed);
    const oldProducts = s.products, oldMeta = valueCopy(root.soldier.produksi_meta), oldById = new Map(oldProducts.map(p => [id(p.id), p]));
    // Hidden product tombstones are retained at their original explicit ID.
    // Physical removal is translated into a monotonic deletion marker, keeping
    // all original records available to their already-issued receipt chains.
    const visible = rows(before.soldier.produksi.produksi), wanted = rows(proposed.soldier.produksi.produksi); for (const p of wanted) id(p.id);
    const removed = visible.filter(p => !wanted.some(n => id(n.id) === id(p.id)));
    for (const k of BUSINESS_ROOTS) if (Object.hasOwn(proposed.soldier, k)) root.soldier[k] = Object.hasOwn(before.soldier, k) ? mergeBusiness(root.soldier[k], before.soldier[k], proposed.soldier[k], 'soldier/' + k) : valueCopy(proposed.soldier[k]); else {
      if (Object.hasOwn(root.soldier, k) && !sameValue(root.soldier[k], businessSafe(root.soldier[k]))) fail('conflict'); delete root.soldier[k];
    }
    const collection = root.soldier.produksi.produksi;
    for (const p of oldProducts) if (removed.some(r => id(r.id) === id(p.id)) || s.markers.products.has(id(p.id))) {
      if (rows(collection).some(r => id(r.id) === id(p.id))) fail('conflict'); if (Array.isArray(collection)) collection.push(valueCopy(p)); else { const oldKey = Object.keys(raw.root.soldier.produksi.produksi).find(k => raw.root.soldier.produksi.produksi[k]?.id != null && id(raw.root.soldier.produksi.produksi[k].id) === id(p.id)); if (oldKey == null || Object.hasOwn(collection, oldKey)) fail('conflict'); collection[oldKey] = valueCopy(p); }
    }
    const oldMarkers = s.markers, nextMarkers = markers(root.soldier);
    if ([...oldMarkers.products].some(k => !nextMarkers.products.has(k)) || Object.entries(oldMarkers.log).some(([k, v]) => nextMarkers.log[k] !== v)) fail('conflict');
    if (removed.length) { const deleted = new Set([...nextMarkers.products, ...removed.map(p => id(p.id))]), value = [...deleted]; root.soldier.produksi_deleted_ids = typeof root.soldier.produksi_deleted_ids === 'string' ? JSON.stringify(value) : value; }
    s = source(root); validateBusinessMeta(oldMeta, root.soldier.produksi_meta, s, c); const linkedProducts = [];
    for (const p of s.products) {
      const old = oldById.get(id(p.id)); if (old && sameValue(old, p)) continue; retainMovedFields(old, p); validateBusinessProduct(old, p, s, c, time, cmd);
      const effects = {}; for (const f of LEDGER_FAMILIES) { const a = collectionHash(old || {}, f), b = collectionHash(p, f); if (a !== b) effects[f] = { before: a, after: b, previous: l?.heads[id(p.id) + '|' + f]?.requestId || '' }; }
      if (!Object.keys(effects).length) continue; const linkedRequest = 'owner-business-' + digest({ requestId: cmd.requestId, productId: id(p.id) });
      if (l?.commands[linkedRequest]) fail('conflict'); if (!root[LEDGER]) root[LEDGER] = {}; if (!root[LEDGER][binding.tenantId]) root[LEDGER][binding.tenantId] = { schemaVersion: 2, projectId: binding.projectId, tenantId: binding.tenantId, policyVersion: POLICY, commands: {}, heads: {} }; const target = root[LEDGER][binding.tenantId];
      if (Object.keys(target.commands).length >= MAX_COMMANDS) fail('capacity_limit'); target.commands[linkedRequest] = { uid: c.binding.uid, googleSubject: who.googleSubject, grantRevision: c.binding.grantRevision, identityGuard, payloadHash: digest(cmd), operationId: linkedRequest, productId: id(p.id), createdAt: time, effects };
      for (const [family, e] of Object.entries(effects)) target.heads[id(p.id) + '|' + family] = { requestId: linkedRequest, digest: e.after }; linkedProducts.push({ productId: id(p.id), requestId: linkedRequest });
    }
    if (!root[BUSINESS_LEDGER]) root[BUSINESS_LEDGER] = {}; if (!ledger) root[BUSINESS_LEDGER][binding.tenantId] = { schemaVersion: 1, projectId: binding.projectId, tenantId: binding.tenantId, policyVersion: BUSINESS_POLICY, commands: {} };
    root[BUSINESS_LEDGER][binding.tenantId].commands[cmd.requestId] = { uid: c.binding.uid, googleSubject: who.googleSubject, grantRevision: c.binding.grantRevision, identityGuard, payloadHash: digest(cmd), createdAt: time, products: linkedProducts };
    // The strict root codec and the protected adapter's separate 2 MiB envelope
    // cap remain authoritative; this pure function cannot acknowledge storage.
    Core.serializeLegacyRoot(root); businessProjection(root); verifyBusinessChains(root, source(root)); return freeze({ ok: true, next: root, receipt: { ok: true, replayed: false, requestId: cmd.requestId } });
  }
  return Object.freeze({ read, capture, execute: raw => protect(() => prepare(raw, false)), resolve: raw => protect(() => prepare(raw, true)), readOwner, captureOwner, executeOwner: raw => protect(() => prepare(raw, false, true)), resolveOwner: raw => protect(() => prepare(raw, true, true)), readBusiness, executeOwnerBusiness: raw => protect(() => prepareBusiness(raw, false)), resolveOwnerBusiness: raw => protect(() => prepareBusiness(raw, true)) });
}
module.exports = Object.freeze({ createProductionLegacyLifecycle, normalizeLegacyLifecycleCommand: command, normalizeLegacyOwnerLifecycleCommand: ownerCommand, normalizeLegacyOwnerBusinessCommand: businessCommand, isLegacyOwnerBusinessPrivateField: privateBusinessField, LegacyLifecycleError, POLICY, MAX_COMMAND_BYTES, MAX_BUSINESS_BYTES, BUSINESS_PATHS });
