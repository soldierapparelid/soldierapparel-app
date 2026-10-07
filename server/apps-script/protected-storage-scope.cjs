'use strict';
// Pure SOURCE-OFF storage candidate. No host, transport, RPC, Auth verification,
// logging, credential, automatic migration or installed production binding.
const Crypto = require('node:crypto');
const Snapshot = require('../production-legacy-operations.cjs');
const State = require('../production-identity-state.cjs');
const Email = require('../production-enrollment-identity.cjs');
const KEY = 'soldierProtectedStorageV1';
const PATHS = Object.freeze({ root: '/' + KEY, working: '/' + KEY + '/working', photos: '/' + KEY + '/photos' });
const MAX_WORKING_BYTES = 2 * 1024 * 1024;
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
const MAX_PHOTO_RECEIPTS = 128;
const MAX_PHOTO_RECEIPT_BYTES = 64 * 1024;
const PHOTO_ENCODING = 'canonical-json-ascii-v1';
const PHOTO_RULE_METADATA_RESERVE = 4096;
const COMMON = ['schemaVersion', 'phase', 'binding', 'migrationId', 'sourceRootDigest'];
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
const CODES = new Set(['service_disabled', 'unavailable', 'invalid_request', 'access_denied', 'not_ready', 'conflict', 'capacity_limit', 'result_unknown']);
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
class ProtectedScopeError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new ProtectedScopeError(code); };
function field(v, k, code = 'not_ready') { const d = v && typeof v === 'object' ? Object.getOwnPropertyDescriptor(v, k) : null; if (!d?.enumerable || !Object.hasOwn(d, 'value')) fail(code); return d.value; }
function exact(v, keys, code = 'not_ready') { if (!plain(v) || Reflect.ownKeys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) fail(code); for (const k of keys) field(v, k, code); }
function copied(v) { try { return Snapshot.copyLegacyRoot(v); } catch (e) { if (e instanceof Snapshot.LegacyOperationsError && e.code === 'capacity_limit') fail('capacity_limit'); fail('not_ready'); } }
function freeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function stable(v) { return v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'; }
const hash = v => Crypto.createHash('sha256').update(stable(v)).digest('hex');
const same = (a, b) => stable(a) === stable(b);
function protect(fn) { try { return freeze(fn()); } catch (e) { const code = e instanceof ProtectedScopeError && CODES.has(e.code) ? e.code : 'unavailable'; return Object.freeze({ ok: false, error: code }); } }
function binding(v) { const b = copied(v); exact(b, ['projectId', 'databaseURL', 'tenantId']); if (typeof b.projectId !== 'string' || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(b.projectId) || typeof b.databaseURL !== 'string' || !/^https:\/\/([a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app)$/.test(b.databaseURL) || typeof b.tenantId !== 'string' || !/^[A-Za-z_-][A-Za-z0-9_-]{0,127}$/.test(b.tenantId) || RESERVED.has(b.tenantId)) fail('not_ready'); return b; }
function migrationId(v) { if (typeof v !== 'string' || !/^[A-Za-z_-][A-Za-z0-9_-]{0,127}$/.test(v) || RESERVED.has(v)) fail('not_ready'); return v; }
function digest(v) { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) fail('not_ready'); return v; }
function revision(v) { if (!Number.isSafeInteger(v) || v < 1 || Object.is(v, -0)) fail('not_ready'); return v; }
function increment(v) { if (v === Number.MAX_SAFE_INTEGER) fail('capacity_limit'); return v + 1; }
function etag(v) { if (typeof v !== 'string' || !(/^"[A-Za-z0-9_+/=-]{1,128}"$/.test(v) || /^[A-Za-z0-9+/]{26}[AEIMQUYcgkosw048]=$/.test(v))) fail('invalid_request'); return v; }
function production(root) { if (Object.hasOwn(root, KEY) || !plain(root.soldier) || !plain(root.soldier.produksi)) fail('not_ready'); return root.soldier.produksi; }
function workingRoot(v) { const root = copied(v), p = production(root); if (Object.hasOwn(p, 'images')) fail('not_ready'); if (Buffer.byteLength(Snapshot.serializeLegacyRoot(root), 'utf8') > MAX_WORKING_BYTES) fail('capacity_limit'); return root; }
function images(v) { exact(v, field(v, 'present') === true ? ['present', 'value'] : ['present']); const out = copied(v); if (typeof out.present !== 'boolean') fail('not_ready'); if (Buffer.byteLength(Snapshot.serializeLegacyRoot(out), 'utf8') > MAX_PHOTO_BYTES) fail('capacity_limit'); return out; }
function partition(root) { const source = copied(root), p = production(source), photos = Object.hasOwn(p, 'images') ? { present: true, value: p.images } : { present: false }; delete p.images; return { workingRoot: workingRoot(source), images: images(photos) }; }
function combine(root, rawImages) { const out = workingRoot(root), photo = images(rawImages); if (photo.present) out.soldier.produksi.images = photo.value; return copied(out); }
function common(b, m) { return { schemaVersion: 1, phase: 'active', binding: copied(b), migrationId: m.migrationId, sourceRootDigest: m.sourceRootDigest }; }
function boundedEnvelope(v, max) { if (Buffer.byteLength(Snapshot.serializeLegacyRoot(v), 'utf8') > max) fail('capacity_limit'); return v; }
function encoded(v) { return Snapshot.serializeLegacyRoot(v); }
function decoded(v) {
  if (typeof v !== 'string') fail('not_ready'); let value; try { value = JSON.parse(v); } catch { fail('not_ready'); }
  // Strictly generated text is retained as a scalar in RTDB. Re-rendering must
  // match its exact bytes: duplicate/escaped-alias keys, whitespace, alternate
  // numbers and unsupported descriptor/prototype forms cannot be normalized.
  const out = copied(value); if (encoded(out) !== v) fail('not_ready'); return out;
}
function asciiEncoded(v) { return encoded(v).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')); }
function asciiDecoded(v) { if (typeof v !== 'string' || !/^[\x20-\x7e]*$/.test(v)) fail('not_ready'); let out; try { out = copied(JSON.parse(v)); } catch { fail('not_ready'); } if (asciiEncoded(out) !== v) fail('not_ready'); return out; }
function sdkImages(v) { exact(v, ['images', 'productionPhotos']); return { images: images(v.images), productionPhotos: images(v.productionPhotos) }; }
function sdkWorkingRoot(v) { const root = workingRoot(v); if (Object.hasOwn(root.soldier, 'productionPhotos')) fail('not_ready'); return root; }
function sdkPartition(root) { const parts = partition(root), w = copied(parts.workingRoot), projection = Object.hasOwn(w.soldier, 'productionPhotos') ? { present: true, value: w.soldier.productionPhotos } : { present: false }; delete w.soldier.productionPhotos; return { workingRoot: sdkWorkingRoot(w), photos: sdkImages({ images: parts.images, productionPhotos: projection }) }; }
function sdkCombine(root, raw) { const out = sdkWorkingRoot(root), p = sdkImages(raw); if (p.images.present) out.soldier.produksi.images = p.images.value; if (p.productionPhotos.present) out.soldier.productionPhotos = p.productionPhotos.value; return copied(out); }
function requestId(v) { if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(v) || RESERVED.has(v)) fail('invalid_request'); return v; }
function photoReceipt(v) { exact(v, ['requestId', 'payloadDigest', 'revision', 'dataDigest']); requestId(v.requestId); digest(v.payloadDigest); revision(v.revision); digest(v.dataDigest); return copied(v); }
function receiptText(v) { const r = photoReceipt(v); return asciiEncoded({ dataDigest: r.dataDigest, payloadDigest: r.payloadDigest, requestId: r.requestId, revision: r.revision }) + '|'; }
function receiptMap(v, n, currentRevision, last, currentDigest) {
  if (typeof v !== 'string' || Buffer.byteLength(v, 'utf8') > MAX_PHOTO_RECEIPT_BYTES || !Number.isSafeInteger(n) || n < 0 || n > MAX_PHOTO_RECEIPTS) fail('not_ready');
  if (n === 0) { if (v !== '' || last !== false || currentRevision !== 1) fail('not_ready'); return new Map(); }
  const frames = v.split('|'); if (frames.pop() !== '' || frames.length !== n) fail('not_ready'); const out = new Map(); let previous = 1;
  for (const frame of frames) { const r = photoReceipt(asciiDecoded(frame)); if (receiptText(r) !== frame + '|' || out.has(r.requestId) || r.revision !== previous + 1) fail('not_ready'); previous = r.revision; out.set(r.requestId, r); }
  const tail = photoReceipt(last); if (!same(tail, [...out.values()].at(-1)) || previous !== currentRevision || tail.dataDigest !== currentDigest) fail('not_ready'); return out;
}
function photoRuleBound(v) { if (typeof v.data !== 'string' || typeof v.receipts !== 'string') fail('not_ready'); if (Buffer.byteLength(JSON.stringify(v.data), 'utf8') - 2 + Buffer.byteLength(JSON.stringify(v.receipts), 'utf8') - 2 + PHOTO_RULE_METADATA_RESERVE > MAX_PHOTO_BYTES) fail('capacity_limit'); return v; }
function sdkPhotoEnvelope(b, m, raw, n, receipts = '', receiptCount = 0, lastReceipt = false) { const p = sdkImages(raw); return photoRuleBound(boundedEnvelope({ ...common(b, m), schemaVersion: 2, encoding: PHOTO_ENCODING, revision: revision(n), dataDigest: hash(p), data: asciiEncoded(p), receiptCount, receipts, lastReceipt }, MAX_PHOTO_BYTES)); }
function validateSdkPhotos(v, b, m) { const out = photoRuleBound(boundedEnvelope(copied(v), MAX_PHOTO_BYTES)); exact(out, [...COMMON, 'encoding', 'revision', 'dataDigest', 'data', 'receiptCount', 'receipts', 'lastReceipt']); if (out.schemaVersion !== 2 || out.encoding !== PHOTO_ENCODING) fail('not_ready'); commonMatches({ ...out, schemaVersion: 1 }, b, m); revision(out.revision); const p = sdkImages(asciiDecoded(out.data)); if (digest(out.dataDigest) !== hash(p)) fail('not_ready'); const receipts = receiptMap(out.receipts, out.receiptCount, out.revision, out.lastReceipt, out.dataDigest); return { envelope: out, data: p, receipts }; }
function normalizeOwnerSdkPhotoCommand(v) { const out = copied(v); exact(out, ['requestId', 'expectedRevision', 'expectedDataDigest', 'images', 'productionPhotos'], 'invalid_request'); requestId(out.requestId); revision(out.expectedRevision); digest(out.expectedDataDigest); sdkImages({ images: out.images, productionPhotos: out.productionPhotos }); return freeze(out); }
function inspectOwnerSdkPhotoEnvelope(raw) { return protect(() => { exact(raw, ['photos'], 'invalid_request'); const e = field(raw, 'photos'), b = binding(field(e, 'binding')), m = { migrationId: migrationId(field(e, 'migrationId')), sourceRootDigest: digest(field(e, 'sourceRootDigest')) }, p = validateSdkPhotos(e, b, m); return { ok: true, photos: p.envelope, data: p.data }; }); }
function prepareOwnerSdkPhotoMutation(raw) { return protect(() => {
  exact(raw, ['photos', 'command'], 'invalid_request'); const e = field(raw, 'photos'), b = binding(field(e, 'binding')), m = { migrationId: migrationId(field(e, 'migrationId')), sourceRootDigest: digest(field(e, 'sourceRootDigest')) }, p = validateSdkPhotos(e, b, m), c = normalizeOwnerSdkPhotoCommand(field(raw, 'command')), payloadDigest = hash(c), prior = p.receipts.get(c.requestId);
  if (prior) { if (prior.payloadDigest !== payloadDigest) fail('conflict'); return { ok: true, replayed: true, receipt: prior }; }
  if (c.expectedRevision !== p.envelope.revision || c.expectedDataDigest !== p.envelope.dataDigest) fail('conflict'); if (p.envelope.receiptCount >= MAX_PHOTO_RECEIPTS) fail('capacity_limit');
  const data = sdkImages({ images: c.images, productionPhotos: c.productionPhotos }), receipt = { requestId: c.requestId, payloadDigest, revision: increment(p.envelope.revision), dataDigest: hash(data) }, text = p.envelope.receipts + receiptText(receipt); if (Buffer.byteLength(text, 'utf8') > MAX_PHOTO_RECEIPT_BYTES) fail('capacity_limit');
  const nextPhotos = sdkPhotoEnvelope(b, m, data, receipt.revision, text, p.envelope.receiptCount + 1, receipt); validateSdkPhotos(nextPhotos, b, m); return { ok: true, replayed: false, receipt, nextPhotos };
}); }
function resolveOwnerSdkPhotoMutation(raw) { return protect(() => { exact(raw, ['photos', 'command'], 'invalid_request'); const e = field(raw, 'photos'), b = binding(field(e, 'binding')), m = { migrationId: migrationId(field(e, 'migrationId')), sourceRootDigest: digest(field(e, 'sourceRootDigest')) }, p = validateSdkPhotos(e, b, m), c = normalizeOwnerSdkPhotoCommand(field(raw, 'command')), prior = p.receipts.get(c.requestId); if (!prior) fail('result_unknown'); if (prior.payloadDigest !== hash(c)) fail('conflict'); return { ok: true, replayed: true, receipt: prior }; }); }
function workingEnvelope(b, m, root, n) { const value = workingRoot(root); return boundedEnvelope({ ...common(b, m), revision: revision(n), dataDigest: hash(value), data: encoded(value) }, MAX_WORKING_BYTES); }
function photoEnvelope(b, m, rawImages, n) { const image = images(rawImages); return boundedEnvelope({ ...common(b, m), revision: revision(n), present: image.present, dataDigest: hash(image), data: encoded(image) }, MAX_PHOTO_BYTES); }
function commonMatches(v, b, m) { if (v.schemaVersion !== 1 || v.phase !== 'active' || !same(binding(v.binding), b) || migrationId(v.migrationId) !== m.migrationId || digest(v.sourceRootDigest) !== m.sourceRootDigest) fail('not_ready'); }
function validateWorking(v, b, m) { const out = boundedEnvelope(copied(v), MAX_WORKING_BYTES); exact(out, [...COMMON, 'revision', 'dataDigest', 'data']); commonMatches(out, b, m); revision(out.revision); const data = workingRoot(decoded(out.data)); if (digest(out.dataDigest) !== hash(data)) fail('not_ready'); out.data = data; return out; }
function validatePhotos(v, b, m) { const out = boundedEnvelope(copied(v), MAX_PHOTO_BYTES); exact(out, [...COMMON, 'revision', 'present', 'dataDigest', 'data']); commonMatches(out, b, m); revision(out.revision); const image = images(decoded(out.data)); if (out.present !== image.present || digest(out.dataDigest) !== hash(image)) fail('not_ready'); out.data = image; return out; }
function inspectRoot(v) {
  const root = copied(v); exact(root, [KEY]); const s = root[KEY]; exact(s, ['manifest', 'working', 'photos']); const manifest = copied(s.manifest), sdk = manifest.schemaVersion === 2; exact(manifest, [...COMMON, 'imagesPath', ...(sdk ? ['productionPhotosPath'] : [])]);
  if (manifest.imagesPath !== 'soldier/produksi/images' || sdk && manifest.productionPhotosPath !== 'soldier/productionPhotos') fail('not_ready'); const b = binding(manifest.binding), m = { migrationId: migrationId(manifest.migrationId), sourceRootDigest: digest(manifest.sourceRootDigest) }; commonMatches(sdk ? { ...manifest, schemaVersion: 1 } : manifest, b, m);
  const w = validateWorking(s.working, b, m), p = sdk ? validateSdkPhotos(s.photos, b, m) : validatePhotos(s.photos, b, m);
  const restored = sdk ? sdkCombine(w.data, p.data) : combine(w.data, p.data), photoRevision = sdk ? p.envelope.revision : p.revision;
  // Both revision-one partitions must still be the exact original snapshot.
  // Later accepted writes carry their own digest and revision; they do not
  // falsely pretend the current root still equals the initial snapshot.
  if (w.revision === 1 && photoRevision === 1 && hash(restored) !== m.sourceRootDigest) fail('not_ready');
  return { root, scope: s, binding: b, migration: m, restored };
}
function splitLegacyRoot(raw) { return protect(() => { exact(raw, ['root'], 'invalid_request'); return { ok: true, ...partition(field(raw, 'root')) }; }); }
function reassembleLegacyRoot(raw) { return protect(() => { exact(raw, ['workingRoot', 'images'], 'invalid_request'); return { ok: true, root: combine(field(raw, 'workingRoot'), field(raw, 'images')) }; }); }
function prepareProtectedMigration(raw) { return protect(() => {
  exact(raw, ['root', 'binding', 'migrationId', 'expectedRootETag'], 'invalid_request'); const source = copied(field(raw, 'root')), b = binding(field(raw, 'binding')), m = { migrationId: migrationId(field(raw, 'migrationId')), sourceRootDigest: hash(source) }, expectedRootETag = etag(field(raw, 'expectedRootETag')), parts = partition(source);
  const nextRoot = { [KEY]: { manifest: { ...common(b, m), imagesPath: 'soldier/produksi/images' }, working: workingEnvelope(b, m, parts.workingRoot, 1), photos: photoEnvelope(b, m, parts.images, 1) } };
  const candidate = inspectRoot(nextRoot); if (!same(source, candidate.restored)) fail('not_ready');
  return { ok: true, expectedRootETag, nextRoot: candidate.root, migration: m };
}); }
function prepareOwnerSdkPhotoMigration(raw) { return protect(() => { exact(raw, ['root', 'binding', 'migrationId', 'expectedRootETag'], 'invalid_request'); const source = copied(field(raw, 'root')), b = binding(field(raw, 'binding')), m = { migrationId: migrationId(field(raw, 'migrationId')), sourceRootDigest: hash(source) }, expectedRootETag = etag(field(raw, 'expectedRootETag')), parts = sdkPartition(source); const nextRoot = { [KEY]: { manifest: { ...common(b, m), schemaVersion: 2, imagesPath: 'soldier/produksi/images', productionPhotosPath: 'soldier/productionPhotos' }, working: workingEnvelope(b, m, parts.workingRoot, 1), photos: sdkPhotoEnvelope(b, m, parts.photos, 1) } }; const candidate = inspectRoot(nextRoot); if (!same(source, candidate.restored)) fail('not_ready'); return { ok: true, expectedRootETag, nextRoot: candidate.root, migration: m }; }); }
function inspectProtectedRoot(raw) { return protect(() => { exact(raw, ['protectedRoot'], 'invalid_request'); const s = inspectRoot(field(raw, 'protectedRoot')); return { ok: true, binding: s.binding, migration: s.migration, workingRevision: s.scope.working.revision, photoRevision: s.scope.photos.revision }; }); }
function prepareProtectedRollback(raw) { return protect(() => {
  exact(raw, ['protectedRoot', 'expectedRootETag'], 'invalid_request'); const s = inspectRoot(field(raw, 'protectedRoot')); return { ok: true, expectedRootETag: etag(field(raw, 'expectedRootETag')), nextRoot: s.restored };
}); }
function owner(working, who, now, b) {
  const v = copied(who); exact(v, ['projectId', 'uid', 'email', 'googleSubject', 'authTimeMs', 'issuedAtMs', 'expiresAtMs', 'verifiedAt'], 'access_denied');
  if (v.projectId !== b.projectId || typeof v.uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v.uid) || RESERVED.has(v.uid) || typeof v.googleSubject !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v.googleSubject) || RESERVED.has(v.googleSubject) || !Email.isEnrollmentEmail(v.email)) fail('access_denied');
  const instant = t => { if (typeof t !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(t) || !Number.isFinite(Date.parse(t)) || Date.parse(t) < 0 || new Date(t).toISOString() !== t) fail('access_denied'); return Date.parse(t); };
  const n = instant(now), verified = instant(v.verifiedAt); for (const k of ['authTimeMs', 'issuedAtMs', 'expiresAtMs']) if (!Number.isSafeInteger(v[k]) || v[k] < 0 || Object.is(v[k], -0)) fail('access_denied');
  if (v.authTimeMs > v.issuedAtMs || v.issuedAtMs >= v.expiresAtMs || v.authTimeMs > n || v.issuedAtMs > n || v.expiresAtMs <= n || verified > n || verified < v.issuedAtMs) fail('access_denied');
  try { const tenant = State.validateIdentityTenant(field(field(working.data, 'authorityTenants'), b.tenantId), { projectId: b.projectId, tenantId: b.tenantId }), grant = State.readIdentityGrant(tenant, { uid: v.uid, googleSubject: v.googleSubject }); if (v.uid !== tenant.initialization.ownerUid || grant.profile.owner !== true || grant.profile.active !== true) fail('access_denied'); return { ownerUid: v.uid, grantRevision: grant.revision }; }
  catch (e) { if (e instanceof ProtectedScopeError) throw e; if (e instanceof State.IdentityStateError && e.code === 'access_denied') fail('access_denied'); fail('not_ready'); }
}
function createProtectedStorageScope(options = {}) {
  let enabled = false; try { const d = plain(options) && Object.getOwnPropertyDescriptor(options, 'enabled'); enabled = !!d && Object.hasOwn(d, 'value') && d.value === true; } catch {}
  const disabled = error => Object.freeze(Object.fromEntries(['readWorking', 'prepareWorkingWrite', 'readOwnerPhotos', 'prepareOwnerPhotoWrite'].map(k => [k, () => Object.freeze({ ok: false, error })])));
  if (!enabled) return disabled('service_disabled'); let b, m;
  try { exact(options, ['enabled', 'binding', 'migration'], 'unavailable'); b = binding(field(options, 'binding')); const input = copied(field(options, 'migration')); exact(input, ['migrationId', 'sourceRootDigest']); m = freeze({ migrationId: migrationId(input.migrationId), sourceRootDigest: digest(input.sourceRootDigest) }); freeze(b); } catch { return disabled('unavailable'); }
  function readWorking(raw) { return protect(() => { exact(raw, ['working'], 'invalid_request'); const w = validateWorking(field(raw, 'working'), b, m); return { ok: true, root: w.data, revision: w.revision }; }); }
  function prepareWorkingWrite(raw) { return protect(() => { exact(raw, ['working', 'nextRoot', 'expectedRevision'], 'invalid_request'); const w = validateWorking(field(raw, 'working'), b, m); if (revision(field(raw, 'expectedRevision')) !== w.revision) fail('conflict'); return { ok: true, nextWorking: workingEnvelope(b, m, field(raw, 'nextRoot'), increment(w.revision)) }; }); }
  function readOwnerPhotos(raw) { return protect(() => { exact(raw, ['working', 'photos', 'identity', 'now'], 'invalid_request'); const w = validateWorking(field(raw, 'working'), b, m); owner(w, field(raw, 'identity'), field(raw, 'now'), b); const p = validatePhotos(field(raw, 'photos'), b, m); return { ok: true, images: p.data, photoRevision: p.revision, workingRevision: w.revision }; }); }
  function prepareOwnerPhotoWrite(raw) { return protect(() => {
    exact(raw, ['working', 'photos', 'identity', 'now', 'expectedWorkingRevision', 'expectedPhotoRevision', 'images'], 'invalid_request'); const w = validateWorking(field(raw, 'working'), b, m), authorization = owner(w, field(raw, 'identity'), field(raw, 'now'), b), p = validatePhotos(field(raw, 'photos'), b, m);
    if (revision(field(raw, 'expectedWorkingRevision')) !== w.revision || revision(field(raw, 'expectedPhotoRevision')) !== p.revision) fail('conflict');
    return { ok: true, nextPhotos: photoEnvelope(b, m, field(raw, 'images'), increment(p.revision)), authorization: { ...authorization, workingRevision: w.revision } };
  }); }
  return Object.freeze({ readWorking, prepareWorkingWrite, readOwnerPhotos, prepareOwnerPhotoWrite });
}
module.exports = Object.freeze({ KEY, PATHS, MAX_WORKING_BYTES, MAX_PHOTO_BYTES, MAX_PHOTO_RECEIPTS, MAX_PHOTO_RECEIPT_BYTES, PHOTO_ENCODING, PHOTO_RULE_METADATA_RESERVE, ProtectedScopeError, splitLegacyRoot, reassembleLegacyRoot, prepareProtectedMigration, prepareOwnerSdkPhotoMigration, inspectProtectedRoot, prepareProtectedRollback, createProtectedStorageScope, normalizeOwnerSdkPhotoCommand, inspectOwnerSdkPhotoEnvelope, prepareOwnerSdkPhotoMutation, resolveOwnerSdkPhotoMutation });
