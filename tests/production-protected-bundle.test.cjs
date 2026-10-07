'use strict';
// Generated Google V8-compatible graph; every service/identity below is fake.
const { test } = require('node:test'), assert = require('node:assert/strict');
const { createProtectedBundleFixture, fixtureFactorySource, KEY, OAUTH } = require('./helpers/protected-bundle-fixture.cjs');
const F = require('./fixtures/identity-tenant.cjs');
const normal = v => JSON.parse(JSON.stringify(v));
function run(f, kind, id, extra = {}) { const cmd = f.command(kind, id, extra), r = normal(f.create().execute(f.fixture.input(cmd))); assert.equal(r.ok, true, JSON.stringify(r)); return cmd; }
function business(root) { const v = normal(root); delete v.authorityTenants; return v; }
function request(f, kind = 'read') { return f.realm({ projectId: F.PROJECT, kind, now: f.fixture.clock(), maxDatabaseDownloadBytes: (kind === 'execute' ? 3 : 2) * 2 * 1024 * 1024, maxGoogleLookupCount: kind === 'execute' ? 14 : 10 }); }

test('generated protected fixture uses the complete reviewed graph with source-OFF defaults and explicit synthetic hosts', () => {
  const f = createProtectedBundleFixture(); assert.equal(f.bundle.metadata.modules.length, 30); assert.equal(f.context.SoldierAppsScriptLifecycleRuntime.configuration.enabled, false);
  for (const k of ['protectedScope', 'protectedTransport', 'recurringAdmission', 'ownerAccess']) assert.ok(f.fixture.modules[k]);
  assert.deepEqual(normal(f.fixture.stats), { google: 0, reads: 0, puts: 0, writes: 0, oauth: 0, propertyWrites: 0 });
  for (const pattern of [/\brequire\s*\(/, /\b(?:doGet|doPost)\s*\(/, /\b(?:UrlFetchApp|ScriptApp|PropertiesService|LockService|Logger)\b/, /soldier-produksi/, /soldierapparelid/]) assert.equal(pattern.test(fixtureFactorySource), false);
});

test('generated QC RPC reads only fixed working data and recurring admission charges the enforced 2 MiB cap', () => {
  const f = createProtectedBundleFixture(), r = normal(f.fixture.gateway().dispatch(f.realm({ kind: 'read', idToken: f.seed.credentials.qc.token })));
  assert.equal(r.ok, true); assert.equal(r.view.binding.division, 'qc');
  for (const marker of [KEY, OAUTH, 'SYNTHETIC_IMAGE', 'SYNTHETIC_PIN', 'tarif', 'payroll', 'SYNTHETIC_CASH_PRIVATE', F.EMAIL, F.QC_EMAIL]) assert.equal(JSON.stringify(r).includes(marker), false);
  assert.equal(f.fixture.stats.google, 10); assert.equal(f.fixture.stats.reads, 2); assert.equal(f.fixture.stats.puts, 0); assert.equal(f.fixture.lockHeld(), false);
  const state = normal(f.fixture.state()); assert.equal(state.requests, 1); assert.equal(state.lookups, 10); assert.equal(state.downloadBytes, 4 * 1024 * 1024);
  for (const call of normal(f.fixture.network)) assert.equal(call.url, F.URL + '/soldierProtectedStorageV1/working.json');
});

test('generated count, own finance, deletion of the last count and receipt recovery preserve exact null and empty collection shapes', () => {
  const f = createProtectedBundleFixture(), photo = JSON.stringify(f.fixture.protectedRoot().soldierProtectedStorageV1.photos), original = run(f, 'appendCount', 'protected-count-1', { workerId: 'worker-1', quantity: 8, workDate: '2026-10-06' });
  const finance = normal(f.create('jahit').readFinance(f.fixture.readInput('jahit'))); assert.equal(finance.ok, true); assert.equal(finance.view.slip.entries[0].total, 26); assert.equal(finance.view.storedJahit.records[0].stored.total, 20);
  run(f, 'deleteCount', 'protected-count-1');
  const root = normal(f.fixture.root()), working = normal(f.fixture.protectedRoot().soldierProtectedStorageV1.working);
  assert.deepEqual(root.soldier.produksi.produksi[0].hitungFisik, []); assert.deepEqual(root.soldier.produksi.produksi[0].qc, []); assert.deepEqual(root.soldier.produksi.produksi[0].gudang, []);
  assert.equal(root.nullableUnknown, null); assert.deepEqual(root.emptyUnknown, {}); assert.deepEqual(root.arrayUnknown, [null, {}, []]); assert.equal(typeof working.data, 'string');
  assert.deepEqual(normal(f.create().resolve(f.fixture.input(original))), { ok: true, replayed: true, operationId: 'protected-count-1' });
  assert.equal(f.fixture.stats.writes, 2); assert.equal(working.revision, 3); assert.equal(JSON.stringify(f.fixture.protectedRoot().soldierProtectedStorageV1.photos), photo);
  assert.equal(normal(f.fixture.network).some(v => v.containsPhoto || v.url.includes('/photos') || v.url.endsWith('/.json')), false);
});

test('generated protected count, QC inspection, repair and cascade deletion retain frozen wages and the earlier count receipt', () => {
  const f = createProtectedBundleFixture(), original = run(f, 'appendCount', 'protected-count-1', { workerId: 'worker-1', quantity: 8, workDate: '2026-10-06' });
  run(f, 'appendCount', 'protected-count-2', { workerId: 'worker-2', quantity: 2, workDate: '2026-10-06' });
  run(f, 'inspectCount', 'protected-quality-1', { countId: 'protected-count-1', workDate: '2026-10-06', totals: { ok: 5, perbaikan: 2, reject: 1, offline: 0 }, note: '' });
  run(f, 'repairQC', 'protected-quality-1', { quantity: 1, workDate: '2026-10-06' }); run(f, 'deleteCount', 'protected-count-1');
  assert.equal(f.create().resolve(f.fixture.input(original)).ok, true); assert.equal(f.fixture.stats.writes, 5);
  const p = normal(f.fixture.root()).soldier.produksi.produksi[0]; assert.equal(p.jahit[0].total, 20); assert.equal(p.jahit[1].total, 198); assert.equal(p.arsip[0].jahit[0].total, 333.75); assert.deepEqual(p.gudang, []);
});

test('generated partner finance excludes another worker and partner correction preserves foreign stored wages', () => {
  const f = createProtectedBundleFixture(), result = normal(f.fixture.gateway('jahit').dispatch(f.realm({ kind: 'readFinance', idToken: f.seed.credentials.jahit.token })));
  assert.equal(result.ok, true); assert.deepEqual(result.view.storedJahit.records.map(v => v.stored.total), [20, 333.75]);
  for (const marker of ['Synthetic second', 'private-advance', 'SYNTHETIC_ROW_PRIVATE', 'SYNTHETIC_PIN', KEY, OAUTH]) assert.equal(JSON.stringify(result).includes(marker), false);
  const cmd = f.command('editJahit', 'sewn-1', { good: 7, reject: 0, workDate: '2026-10-05' }, 'jahit'); assert.equal(f.create('jahit').execute(f.fixture.input(cmd, 'jahit')).ok, true);
  const root = normal(f.fixture.root()); assert.equal(root.soldier.produksi.produksi[0].jahit[0].total, 17.5); assert.equal(root.soldier.produksi.produksi[0].jahit[1].total, 198); assert.equal(root.soldier.produksi_meta.kasbonJahit[0].jumlah, 123);
  assert.deepEqual(normal(f.create('qc').readFinance(f.fixture.readInput('qc'))), { ok: false, error: 'access_denied' });
});

test('generated owner lifecycle retains owner maintenance authority without partner impersonation', () => {
  const f = createProtectedBundleFixture(), r = normal(f.create('owner').readOwner(f.fixture.readInput('owner'))); assert.equal(r.ok, true); assert.equal(r.view.binding.division, 'owner');
  for (const marker of ['SYNTHETIC_IMAGE', OAUTH, KEY, 'SYNTHETIC_PIN']) assert.equal(JSON.stringify(r).includes(marker), false);
  assert.equal(f.fixture.stats.puts, 0); assert.equal(f.fixture.state().maxRootBytes, 2 * 1024 * 1024);
});

test('generated owner access RPC returns only reviewed labels and atomically revokes a partner without changing any business data', () => {
  const f = createProtectedBundleFixture(), before = business(f.fixture.root()), gateway = f.fixture.ownerAccessGateway(), read = normal(gateway.dispatch(f.realm({ kind: 'read', idToken: f.seed.credentials.owner.token })));
  assert.equal(read.ok, true); assert.equal(read.view.targets[0].label, 'Synthetic partner');
  for (const marker of ['partner-1', 'owner-1', 'worker-1', F.EMAIL, F.QC_EMAIL, 'googleSubject', 'tarif', 'total', KEY, OAUTH]) assert.equal(JSON.stringify(read).includes(marker), false);
  const cmd = f.revokeCommand(), result = normal(gateway.dispatch(f.realm({ kind: 'execute', idToken: f.seed.credentials.owner.token, command: normal(cmd) })));
  assert.deepEqual(result, { ok: true, replayed: false, requestId: cmd.requestId, profileId: 'approval-1', approvalRevision: 3, grantRevision: 2 }); assert.deepEqual(business(f.fixture.root()), before); assert.equal(f.fixture.stats.writes, 1);
  assert.deepEqual(normal(f.create('jahit').read(f.fixture.readInput('jahit'))), { ok: false, error: 'access_denied' }); assert.deepEqual(normal(f.create('jahit').readFinance(f.fixture.readInput('jahit'))), { ok: false, error: 'access_denied' });
  assert.equal(f.fixture.root().authorityTenants[F.TENANT].grants['owner-1'].profile.active, true); assert.equal(f.fixture.stats.writes, 1);
});

test('generated revocation lost acknowledgement resolves across fresh factories without repeating a conditional write', () => {
  const f = createProtectedBundleFixture(), cmd = f.revokeCommand(); f.fixture.controls.loseAck = true;
  assert.deepEqual(normal(f.fixture.ownerAccess().executeAccess(f.fixture.input(cmd, 'owner'))), { ok: false, error: 'result_unknown', retrySameCommand: true }); f.fixture.controls.loseAck = false;
  assert.deepEqual(normal(f.fixture.ownerAccess().resolveAccess(f.fixture.input(cmd, 'owner'))), { ok: true, replayed: true, requestId: cmd.requestId, profileId: cmd.profileId, approvalRevision: 3, grantRevision: 2 });
  assert.equal(f.fixture.stats.puts, 1); assert.equal(f.fixture.protectedRoot().soldierProtectedStorageV1.working.revision, 2); assert.equal(f.create('jahit').read(f.fixture.readInput('jahit')).error, 'access_denied');
});

test('generated lifecycle lost acknowledgement and known conflict keep separate recoverable outcomes', () => {
  const f = createProtectedBundleFixture(), cmd = f.command('appendCount', 'protected-lost-count', { workerId: 'worker-1', quantity: 8, workDate: '2026-10-06' }); f.fixture.controls.loseAck = true;
  assert.deepEqual(normal(f.create().execute(f.fixture.input(cmd))), { ok: false, error: 'result_unknown', retrySameCommand: true }); f.fixture.controls.loseAck = false; assert.equal(f.create().resolve(f.fixture.input(cmd)).ok, true); assert.equal(f.fixture.stats.puts, 1);
  const g = createProtectedBundleFixture(), other = g.command('appendCount', 'protected-conflict-count', { workerId: 'worker-1', quantity: 8, workDate: '2026-10-06' }); g.fixture.controls.conflict = true;
  assert.deepEqual(normal(g.create().execute(g.fixture.input(other))), { ok: false, error: 'conflict' }); assert.equal(g.fixture.stats.writes, 0); assert.equal(g.fixture.stats.puts, 1);
  const h = createProtectedBundleFixture(); h.fixture.controls.conflict = true; assert.equal(h.fixture.ownerAccess().executeAccess(h.fixture.input(h.revokeCommand(), 'owner')).error, 'conflict'); assert.equal(h.fixture.stats.writes, 0); assert.equal(h.fixture.root().authorityTenants[F.TENANT].grants['partner-1'].profile.active, true);
});

test('generated shared recurring reservations survive runtime and gateway recreation including failed account checks', () => {
  const f = createProtectedBundleFixture(); assert.equal(f.create().read(f.fixture.readInput()).ok, true); assert.equal(f.create('jahit').readFinance(f.fixture.readInput('jahit')).ok, true); assert.equal(f.fixture.ownerAccess().readAccess(f.fixture.readInput('owner')).ok, true);
  const initial = normal(f.fixture.state()); assert.equal(initial.requests, 3); assert.equal(initial.downloadBytes, 12 * 1024 * 1024); f.fixture.controls.denyUid = f.seed.credentials.qc.identity.uid;
  const before = normal(f.fixture.stats); assert.equal(f.create().read(f.fixture.readInput()).error, 'access_denied'); const later = normal(f.fixture.state()); assert.equal(later.requests, 4); assert.equal(later.downloadBytes, 16 * 1024 * 1024); assert.equal(f.fixture.stats.reads, before.reads); assert.equal(f.fixture.stats.oauth, before.oauth); assert.equal(f.fixture.lockHeld(), false);
});

test('generated denied or uncertain property reservation stops all identity and data calls without an automatic reset', () => {
  for (const mode of ['denyProperties', 'loseReservationAck', 'denyLock']) { const f = createProtectedBundleFixture(); f.fixture.controls[mode] = true; assert.deepEqual(normal(f.create().read(f.fixture.readInput())), { ok: false, error: 'rate_limited' }); assert.equal(f.fixture.stats.google, 0); assert.equal(f.fixture.stats.oauth, 0); assert.equal(f.fixture.stats.reads, 0); assert.equal(f.fixture.lockHeld(), false); assert.equal(f.fixture.state().requests, mode === 'loseReservationAck' ? 1 : 0); f.fixture.controls[mode] = false; assert.equal(f.create().read(f.fixture.readInput()).ok, true); assert.equal(f.fixture.state().requests, mode === 'loseReservationAck' ? 2 : 1); }
});

test('generated recurring day and month rollover reserves before use while lifetime counters never decrease', () => {
  const bytes = 2 * 1024 * 1024, f = createProtectedBundleFixture({ policy: { expiresAt: '2026-11-15T00:00:00.000Z', dayRequestLimit: 2, dayLookupLimit: 28, dayDownloadLimitBytes: 6 * bytes, monthRequestLimit: 3, monthLookupLimit: 42, monthDownloadLimitBytes: 9 * bytes } });
  assert.equal(f.fixture.gate().admit(request(f)), true); assert.equal(f.fixture.gate().admit(request(f)), true); const sameDay = f.fixture.stateText(); assert.equal(f.fixture.gate().admit(request(f)), false); assert.equal(f.fixture.stateText(), sameDay);
  f.fixture.setClock('2026-10-07T00:00:00.000Z'); assert.equal(f.fixture.gate().admit(request(f, 'execute')), true); let state = normal(f.fixture.state()); assert.equal(state.requests, 3); assert.equal(state.day.requests, 1); assert.equal(state.month.requests, 3); assert.equal(state.downloadBytes, 7 * bytes);
  f.fixture.setClock('2026-11-01T00:00:00.000Z'); assert.equal(f.fixture.gate().admit(request(f)), true); state = normal(f.fixture.state()); assert.equal(state.requests, 4); assert.equal(state.month.requests, 1); assert.equal(state.downloadBytes, 9 * bytes);
  const beforeExpire = f.fixture.stateText(); f.fixture.setClock('2026-11-15T00:00:00.000Z'); assert.equal(f.fixture.gate().admit(request(f)), false); assert.equal(f.fixture.stateText(), beforeExpire); assert.equal(f.fixture.stats.google, 0);
});

test('generated owner access route and scoped readers reject untrusted selectors before shared admission', () => {
  const f = createProtectedBundleFixture(), before = f.fixture.stateText();
  assert.equal(f.fixture.ownerAccessGateway('jahit').dispatch(f.realm({ kind: 'read', idToken: f.seed.credentials.jahit.token })).error, 'access_denied'); const afterDenied = f.fixture.stateText();
  assert.deepEqual(JSON.parse(f.fixture.ownerAccessGateway().dispatchJson('{"kind":"read","kind":"execute","idToken":"synthetic"}')), { ok: false, error: 'invalid_request' }); assert.equal(f.fixture.stateText(), afterDenied);
  for (const extra of [{ storageScope: 'photos' }, { role: 'owner' }, { uid: 'owner-1' }, { maxRootBytes: 8 * 1024 * 1024 }, { workerId: 'worker-2' }]) assert.equal(f.create('jahit').read(f.realm({ idToken: f.seed.credentials.jahit.token, ...extra })).error, 'invalid_request');
  assert.equal(f.fixture.stateText(), afterDenied); assert.notEqual(before, afterDenied); assert.equal(f.fixture.stats.puts, 0);
});

test('generated working updates preserve a concurrently changed encoded photo partition without any photo network request', () => {
  const f = createProtectedBundleFixture(), cmd = f.command('appendCount', 'protected-photo-count', { workerId: 'worker-1', quantity: 8, workDate: '2026-10-06' });
  f.fixture.replacePhotos(f.realm({ present: true, value: { photo: 'NEW_SYNTHETIC_IMAGE', empty: [], nullable: null } })); const photos = JSON.stringify(f.fixture.protectedRoot().soldierProtectedStorageV1.photos);
  assert.equal(f.create().execute(f.fixture.input(cmd)).ok, true); assert.equal(JSON.stringify(f.fixture.protectedRoot().soldierProtectedStorageV1.photos), photos);
  const restored = normal(f.fixture.modules.protectedScope.prepareProtectedRollback(f.realm({ protectedRoot: normal(f.fixture.protectedRoot()), expectedRootETag: '"current-synthetic"' }))); assert.equal(restored.ok, true); assert.deepEqual(restored.nextRoot.soldier.produksi.images, { photo: 'NEW_SYNTHETIC_IMAGE', empty: [], nullable: null }); assert.equal(restored.nextRoot.soldier.produksi.produksi[0].hitungFisik.length, 1);
  assert.equal(normal(f.fixture.network).some(v => v.url.includes('/photos') || v.containsPhoto), false);
});

test('generated malformed stored text and binding mismatch return fixed failures without exposing the private wire root', () => {
  for (const mode of ['duplicate', 'digest', 'migration']) { const f = createProtectedBundleFixture(), w = f.fixture.protectedRoot().soldierProtectedStorageV1.working; if (mode === 'duplicate') w.data = w.data.replace('"soldier":', '"soldier":null,"soldier":'); else if (mode === 'digest') w.dataDigest = '0'.repeat(64); else w.migrationId = 'foreign-migration'; const r = normal(f.create().read(f.fixture.readInput())); assert.deepEqual(r, { ok: false, error: 'not_ready' }); assert.equal(f.fixture.stats.puts, 0); assert.equal(JSON.stringify(r).includes('SYNTHETIC'), false); }
});

test('generated owner business gateway confirms fixed legacy daily pay writes with the same current view and no photo downloads', () => {
  const f = createProtectedBundleFixture(), root = normal(f.fixture.root()); root.soldier.gajiHarian = { karyawan: [], entries: [{ id: 'daily-native-1', jumlah: 75.25 }], kasbon: [] }; f.fixture.replaceRoot(f.realm(root));
  const fixed = f.realm({ projectId: f.seed.binding.projectId, databaseURL: f.seed.binding.databaseURL, tenantId: f.seed.binding.tenantId });
  const gateway = f.fixture.modules.ownerBusinessRpc.createAppsScriptOwnerBusinessRpcGateway(f.realm({ enabled: true, binding: normal(fixed) }));
  assert.equal(normal(gateway.dispatch(f.realm({ kind: 'read', ...normal(f.fixture.readInput('owner')) }))).error, 'unavailable');
  const actual = f.fixture.modules.ownerBusinessRpc.createAppsScriptOwnerBusinessRpcGateway(Object.assign(f.realm({ enabled: true, binding: normal(fixed) }), { runtime: f.create('owner') }));
  const read = normal(actual.dispatch(f.realm({ kind: 'read', ...normal(f.fixture.readInput('owner')) }))); assert.equal(read.ok, true);
  const value = normal(read.view.business.soldier.gajiHarian); value.entries[0].jumlah = 90.25;
  const cmd = f.realm({ kind: 'ownerBusinessWrite', requestId: 'protected-business-save-1', expectedGrantRevision: 1, expectedSourceVersion: read.view.sourceVersion, changes: [{ path: 'soldier/gajiHarian', action: 'set', value }] });
  const before = normal(f.fixture.stats), reply = normal(actual.dispatch(f.realm({ kind: 'execute', ...normal(f.fixture.input(cmd, 'owner')) })));
  assert.equal(reply.ok, true); assert.equal(reply.replayed, false); assert.equal(reply.view.business.soldier.gajiHarian.entries[0].jumlah, 90.25); assert.equal(f.fixture.stats.reads - before.reads, 2); assert.equal(f.fixture.stats.writes - before.writes, 1);
  for (const marker of ['SYNTHETIC_PIN', 'SYNTHETIC_IMAGE', OAUTH, KEY, 'authorityTenants']) assert.equal(JSON.stringify(reply).includes(marker), false);
  const resolved = normal(actual.dispatch(f.realm({ kind: 'resolve', ...normal(f.fixture.input(cmd, 'owner')) }))); assert.equal(resolved.ok, true); assert.equal(resolved.replayed, true); assert.equal(resolved.view.sourceVersion, reply.view.sourceVersion); assert.equal(f.fixture.stats.puts, 1);
  assert.equal(normal(f.fixture.network).some(v => v.url.includes('/photos') || v.containsPhoto), false);
});

test('generated owner business ledger lost acknowledgement resolves once through a fresh RPC factory', () => {
  const f = createProtectedBundleFixture(), root = normal(f.fixture.root()); root.soldier.stokBahan = { rolls: [{ id: 'roll-business-1', panjang: 8 }] }; f.fixture.replaceRoot(f.realm(root));
  const read = normal(f.create('owner').readBusiness(f.fixture.readInput('owner'))), value = normal(read.view.business.soldier.stokBahan); value.rolls[0].panjang = 9;
  const cmd = f.realm({ kind: 'ownerBusinessWrite', requestId: 'protected-business-lost-1', expectedGrantRevision: 1, expectedSourceVersion: read.view.sourceVersion, changes: [{ path: 'soldier/stokBahan', action: 'set', value }] });
  f.fixture.controls.loseAck = true; assert.equal(f.create('owner').executeOwnerBusiness(f.fixture.input(cmd, 'owner')).error, 'result_unknown'); f.fixture.controls.loseAck = false;
  const resolved = normal(f.create('owner').resolveOwnerBusiness(f.fixture.input(cmd, 'owner'))); assert.equal(resolved.ok, true); assert.equal(resolved.replayed, true); assert.equal(resolved.view.business.soldier.stokBahan.rolls[0].panjang, 9); assert.equal(f.fixture.stats.puts, 1);
});
