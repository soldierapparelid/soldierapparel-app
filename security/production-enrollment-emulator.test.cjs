'use strict';
// Genuine Admin SDK/Auth handles and RTDB loopback transactions. Token verification
// and user records are explicit fixtures; this proves no Google login/user record.
const {test} = require('node:test'), assert = require('node:assert/strict');
const PROJECT = 'demo-soldier-security', HOST = '127.0.0.1', PORT = 9000;
const URL = 'https://' + PROJECT + '.firebaseio.com', NOW = '2026-10-05T03:00:00.000Z';
const TOKEN = 'header.payload.signature', EMAIL = 'synthetic.enrollment.0001@gmail.com';
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, HOST + ':' + PORT, 'isolated loopback RTDB is required');
assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_TOKEN, 'real credential configuration is forbidden');
assert.ok(Number(process.versions.node.split('.')[0]) >= 22);
const {initializeApp, deleteApp, SDK_VERSION} = require('firebase-admin/app');
const {getDatabase} = require('firebase-admin/database'), {getAuth} = require('firebase-admin/auth');
assert.equal(SDK_VERSION, '14.5.0');
const Authority = require('../server/production-authority.cjs');
const OwnerLedger = require('../server/production-owner-ledger.cjs'), TariffLedger = require('../server/production-tariff-ledger.cjs');
const Enrollment = require('../server/production-enrollment-service.cjs'), Adapter = require('../server/production-tenant-adapter.cjs');
const Session = require('../server/production-session-service.cjs'), Limiter = require('../server/production-rate-limiter.cjs');
const copy = v => JSON.parse(JSON.stringify(v));
let sequence = 0;

function seed(tenantId) {
  let state = Authority.createAuthority({product: {id: 'product-synthetic', series: 'Synthetic', namaBarang: 'Fixture', size: 'M', cutQuantity: 20}, cycleId: 'cycle-synthetic', workers: [{id: 'worker-synthetic', nama: 'Synthetic first partner'}, {id: 'worker-other', nama: 'Synthetic other partner'}], assignments: [{id: 'assignment-synthetic', workerId: 'worker-synthetic', qty: 10}, {id: 'assignment-other', workerId: 'worker-other', qty: 10}], now: NOW});
  const owner = {uid: 'owner-synthetic', emailVerified: true, provider: 'google.com', profile: {active: true, owner: true}, now: NOW};
  state = Authority.applyCommand(state, owner, {requestId: 'sewing-fixture', productId: state.productId, cycleId: state.cycleId, expectedRevision: 0, kind: 'sewing', payload: {id: 'sewing-synthetic', assignmentId: 'assignment-synthetic', tanggal: '2026-10-05', good: 10, reject: 0}}).state;
  const selected = {source: 'private-verified-tariff', verified: true, workerId: 'worker-synthetic', productId: state.productId, cycleId: state.cycleId, countId: 'count-synthetic', workDate: '2026-10-05', basisAt: '2026-10-05T01:00:00.000Z', effectiveAt: '2026-01-01T00:00:00.000Z', tariffVersion: 'tariff-synthetic', currency: 'IDR', rate: 100, selectedAt: NOW};
  state = Authority.applyCommand(state, {...owner, selectedTariffs: {'count-synthetic': selected}}, {requestId: 'count-fixture', productId: state.productId, cycleId: state.cycleId, expectedRevision: 1, kind: 'count', payload: {id: 'count-synthetic', assignmentId: 'assignment-synthetic', tanggal: '2026-10-05', jumlah: 10}}).state;
  const primary = {config: {revision: 1, active: true, reviewedEmptyCycle: true, tariffPolicy: 'explicit-historical-jakarta-v1'}, tariffInputs: {revision: 2, policy: {version: 'policy-synthetic', kind: 'jakarta-fixed-local-time', hour: 8, minute: 0}, historyByWorker: {'worker-synthetic': {'tariff-synthetic': {effectiveAt: '2026-01-01T00:00:00.000Z', currency: 'IDR', rate: 100}, 'tariff-future': {effectiveAt: '2026-10-05T04:00:00.000Z', currency: 'IDR', rate: 111}}, 'worker-other': {'tariff-other': {effectiveAt: '2026-01-01T00:00:00.000Z', currency: 'IDR', rate: 200}}}}, wire: Authority.encodeStorage(state)};
  const create = {kind: 'createCycle', requestId: 'create-ledger-fixture', product: {id: 'product-ledger', series: 'Synthetic', namaBarang: 'Retained sibling', size: 'L', cutQuantity: 10}, cycleId: 'cycle-ledger', workers: [{id: 'worker-ledger', nama: 'Synthetic sibling'}], assignments: [{id: 'assignment-ledger', workerId: 'worker-ledger', qty: 10}], tariffPolicy: {version: 'policy-ledger', kind: 'jakarta-fixed-local-time', hour: 8, minute: 0}, initialTariffs: [{workerId: 'worker-ledger', tariffVersion: 'tariff-ledger', effectiveAt: '2026-01-01T00:00:00.000Z', currency: 'IDR', rate: 300}]};
  const sibling = OwnerLedger.createCycleSeed(create, NOW), products = {'product-synthetic': {cycles: {'cycle-synthetic': primary}}, 'product-ledger': {cycles: {'cycle-ledger': sibling}}};
  const tariff = {kind: 'appendTariffVersion', requestId: 'tariff-ledger-fixture', productId: 'product-synthetic', cycleId: 'cycle-synthetic', expectedConfigRevision: 1, expectedTariffRevision: 1, workerId: 'worker-synthetic', tariffVersion: 'tariff-future', effectiveAt: '2026-10-05T04:00:00.000Z', currency: 'IDR', rate: 111};
  return {schemaVersion: 1, projectId: PROJECT, tenantId, grants: {'owner-synthetic': {revision: 1, profile: {active: true, owner: true}}}, products,
    ownerCommandLedger: OwnerLedger.appendOwnerLedger(undefined, {uid: 'owner-synthetic', command: create, acceptedAt: NOW, initialSnapshotHash: Authority.decodeStorage(sibling.wire).snapshots.v0000000000.hash}, products),
    tariffCommandLedger: TariffLedger.appendTariffLedger(undefined, {uid: 'owner-synthetic', command: tariff, acceptedAt: NOW}, products),
    enrollmentRegistry: {schemaVersion: 1, approvals: {'approval-synthetic': {email: EMAIL, profile: {active: true, owner: false, workerId: 'worker-synthetic', modules: {jahit: true}}, reviewed: true, approvedAt: '2026-10-01T00:00:00.000Z', expiresAt: '2026-11-01T00:00:00.000Z', revision: 1, status: 'pending'}}}};
}
function subscription(ref) {
  let listener, timer;
  const ready = new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(Error('synthetic cache preparation failed')); };
    listener = () => { clearTimeout(timer); resolve(); }; timer = setTimeout(abort, 5000); ref.on('value', listener, abort);
  });
  return {ready, close() { clearTimeout(timer); ref.off('value', listener); }};
}
function assertNamespace(ref, tenantId, branch) {
  assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, HOST + ':' + PORT);
  assert.ok(PROJECT.startsWith('demo-'));
  assert.match(tenantId, /^enrollment-service-proof-[1-9][0-9]*$/);
  assert.ok(['authorityTenants', 'serverRateLimits'].includes(branch));
  assert.equal(ref.toString(), 'http://' + HOST + ':' + PORT + '/' + branch + '/' + tenantId);
}
async function fixture(t) {
  const n = ++sequence, tenantId = 'enrollment-service-proof-' + n;
  // Explicit emulator credential fixture prevents any ADC lookup. No real token.
  const credential = {getAccessToken: async () => ({access_token: 'owner', expires_in: 3600})};
  const a = initializeApp({projectId: PROJECT, databaseURL: URL, credential}, 'enrollment-service-a-' + n);
  let b, da, db, tenantRef, quotaRef, pending; const restartedApps = [];
  t.after(async () => {
    try {
      if (pending) await pending;
      if (da) da.goOnline(); if (db) db.goOnline();
      if (tenantRef) { assertNamespace(tenantRef, tenantId, 'authorityTenants'); await tenantRef.remove(); }
      if (quotaRef) { assertNamespace(quotaRef, tenantId, 'serverRateLimits'); await quotaRef.remove(); }
    } finally { await Promise.all([a, b, ...restartedApps].filter(Boolean).map(app => Promise.resolve().then(() => deleteApp(app)))); }
  });
  b = initializeApp({projectId: PROJECT, databaseURL: URL, credential}, 'enrollment-service-b-' + n);
  da = getDatabase(a); db = getDatabase(b);
  const path = 'authorityTenants/' + tenantId;
  tenantRef = db.ref(path); quotaRef = db.ref('serverRateLimits/' + tenantId);
  assertNamespace(tenantRef, tenantId, 'authorityTenants'); assertNamespace(quotaRef, tenantId, 'serverRateLimits');
  await tenantRef.set(seed(tenantId));
  const stats = {auth: 0, users: 0, transactions: 0, callbacks: 0, on: 0, off: 0};
  const controls = {interleave: null, loseAck: false, mutationFailed: false};
  const actorA = {uid: 'user-synthetic', email: EMAIL, subject: 'google-synthetic'}, actorB = {uid: 'user-synthetic', email: EMAIL, subject: 'google-synthetic'};
  const authA = getAuth(a), authB = getAuth(b);
  function stub(auth, app, actor) {
    assert.equal(auth.app, app); assert.equal(auth.app.options.projectId, PROJECT);
    assert.equal(typeof auth.verifyIdToken, 'function'); assert.equal(typeof auth.getUser, 'function');
    Object.defineProperties(auth, {
      verifyIdToken: {configurable: true, enumerable: true, value: async (token, checkRevoked) => {
        assert.equal(token, TOKEN); assert.equal(checkRevoked, true); stats.auth++;
        return {uid: actor.uid, sub: actor.uid, aud: PROJECT, iss: 'https://securetoken.google.com/' + PROJECT, email: actor.email, email_verified: true, firebase: {sign_in_provider: 'google.com', identities: {'google.com': [actor.subject]}}, auth_time: Date.parse(NOW) / 1000, iat: Date.parse(NOW) / 1000, exp: Date.parse(NOW) / 1000 + 3600};
      }},
      getUser: {configurable: true, enumerable: true, value: async uid => {
        assert.equal(uid, actor.uid); stats.users++;
        // Plain synthetic record: do not claim a genuine UserRecord proof.
        return {uid, email: actor.email, emailVerified: true, disabled: false, providerData: [{providerId: 'google.com', uid: actor.subject, email: actor.email}]};
      }}
    });
    assert.equal(getAuth(app), auth, 'the fixture methods remain on the genuine named Auth instance');
  }
  stub(authA, a, actorA); stub(authB, b, actorB);
  async function mutate(change) {
    const warm = subscription(tenantRef);
    try { await warm.ready; const r = await tenantRef.transaction(value => { assert.ok(value); const next = copy(value); change(next); return next; }, undefined, false); assert.equal(r.committed, true); }
    finally { warm.close(); }
  }
  const wrapped = {app: da.app, ref(fixed) {
    assert.equal(fixed, path); const real = da.ref(fixed);
    return {toString: () => real.toString(), get: () => real.get(), on(...args) { stats.on++; return real.on(...args); }, off(...args) { stats.off++; return real.off(...args); }, async transaction(update, complete, local) {
      stats.transactions++;
      const outcome = await real.transaction(value => {
        stats.callbacks++; const candidate = update(value);
        if (candidate !== undefined && controls.interleave) {
          const change = controls.interleave; controls.interleave = null; da.goOffline();
          pending = mutate(change).catch(() => { controls.mutationFailed = true; }).finally(() => da.goOnline());
        }
        return candidate;
      }, complete, local);
      if (outcome.committed && controls.loseAck) { controls.loseAck = false; throw Error('SYNTHETIC_ENROLLMENT_ACK_CANARY'); }
      return outcome;
    }};
  }};
  const scope = {enabled: true, projectId: PROJECT, databaseURL: URL, tenantId, clock: () => NOW, testOnlyEmulator: {host: HOST, port: PORT}};
  const createA = () => Enrollment.createProductionEnrollmentService({...scope, database: wrapped, auth: authA});
  const createB = () => Enrollment.createProductionEnrollmentService({...scope, database: db, auth: authB});
  function freshInstance() {
    const app = initializeApp({projectId: PROJECT, databaseURL: URL, credential}, 'enrollment-service-restart-' + n + '-' + (restartedApps.length + 1));
    restartedApps.push(app); const auth = getAuth(app); stub(auth, app, actorB);
    return Enrollment.createProductionEnrollmentService({...scope, database: getDatabase(app), auth});
  }
  async function claim(service) { const r = await service.execute({idToken: TOKEN}); if (pending) await pending; assert.equal(controls.mutationFailed, false); return r; }
  async function state() { return (await tenantRef.get()).val(); }
  const adapter = Adapter.createProductionTenantAdapter({...scope, database: db});
  const limiter = Limiter.createProductionRateLimiter({...scope, database: db, windowMs: 60000, limit: 30, clock: () => Date.parse(NOW), allow: async q => (await adapter.repository.readGrant(q)).profile.active === true});
  const session = Session.createProductionSessionService({...scope, database: db, auth: authB, admit: q => limiter.admit(q)});
  return {a, b, da, db, authA, authB, actorA, actorB, controls, stats, mutate, claim, state, createA, createB, freshInstance, tenantRef, quotaRef, session};
}
function safe(r) {
  assert.equal(Object.isFrozen(r), true); assert.deepEqual(Object.keys(r).sort(), r.ok ? ['ok'] : ['error', 'ok']);
  for (const value of [EMAIL, TOKEN, 'google-synthetic', 'approval-synthetic', 'worker-synthetic', 'SYNTHETIC_ENROLLMENT_ACK_CANARY']) assert.equal(JSON.stringify(r).includes(value), false);
}

test('genuine named Auth/Database handles and RTDB claim preserve products, tariffs and both ledgers atomically', {timeout: 30000}, async t => {
  const f = await fixture(t), before = await f.state(), r = await f.claim(f.createA()), after = await f.state();
  assert.deepEqual(r, {ok: true}); safe(r); assert.equal(f.authA, getAuth(f.a)); assert.equal(f.authB, getAuth(f.b));
  assert.deepEqual(after.products, before.products); assert.deepEqual(after.ownerCommandLedger, before.ownerCommandLedger); assert.deepEqual(after.tariffCommandLedger, before.tariffCommandLedger);
  assert.deepEqual(after.grants['owner-synthetic'], before.grants['owner-synthetic']);
  assert.deepEqual(after.grants['user-synthetic'], {revision: 1, profile: before.enrollmentRegistry.approvals['approval-synthetic'].profile});
  assert.equal(after.enrollmentRegistry.approvals['approval-synthetic'].status, 'claimed'); assert.equal(after.enrollmentRegistry.approvals['approval-synthetic'].admission.count, 1);
  assert.equal((await f.quotaRef.get()).val(), null); assert.equal(f.stats.on, f.stats.off);
});

test('different synthetic UIDs racing through independent genuine SDK apps yield one binding and one admission', {timeout: 30000}, async t => {
  const f = await fixture(t); f.actorB.uid = 'racing-synthetic';
  const before = await f.state(), responses = await Promise.all([f.claim(f.createA()), f.claim(f.createB())]), after = await f.state();
  responses.forEach(safe); assert.equal(responses.filter(r => r.ok).length, 1);
  const row = after.enrollmentRegistry.approvals['approval-synthetic']; assert.ok(['user-synthetic', 'racing-synthetic'].includes(row.claim.uid));
  assert.equal(row.admission.count, 1); assert.equal(row.revision, 2); assert.equal(Object.keys(after.grants).length, 2);
  assert.deepEqual(after.products, before.products); assert.deepEqual(after.ownerCommandLedger, before.ownerCommandLedger); assert.deepEqual(after.tariffCommandLedger, before.tariffCommandLedger);
});

test('eight eligible admissions persist across independent app/service restarts and concurrent ninth attempts add nothing', {timeout: 30000}, async t => {
  const f = await fixture(t);
  for (let n = 0; n < 7; n++) assert.deepEqual(await f.claim(n % 2 ? f.createA() : f.createB()), {ok: true});
  const responses = await Promise.all([f.claim(f.createA()), f.claim(f.createB())]); responses.forEach(safe);
  assert.equal(responses.filter(r => r.ok).length, 1);
  const before = await f.state(); assert.equal(before.enrollmentRegistry.approvals['approval-synthetic'].admission.count, 8); assert.equal(before.grants['user-synthetic'].revision, 1);
  assert.deepEqual(await f.claim(f.freshInstance()), {ok: false, error: 'rate_limited'}); assert.deepEqual(await f.state(), before);
});

test('lost genuine RTDB acknowledgement reports uncertainty and independent verified replay changes only its admission', {timeout: 30000}, async t => {
  const f = await fixture(t); f.controls.loseAck = true;
  const lost = await f.claim(f.createA()); assert.deepEqual(lost, {ok: false, error: 'result_unknown'}); safe(lost);
  const committed = await f.state(); assert.equal(committed.grants['user-synthetic'].revision, 1);
  assert.deepEqual(await f.claim(f.createB()), {ok: true}); const replayed = await f.state();
  assert.deepEqual(replayed.grants, committed.grants); assert.deepEqual(replayed.products, committed.products); assert.deepEqual(replayed.ownerCommandLedger, committed.ownerCommandLedger); assert.deepEqual(replayed.tariffCommandLedger, committed.tariffCommandLedger);
  assert.equal(replayed.enrollmentRegistry.approvals['approval-synthetic'].admission.count, 2); assert.equal(f.stats.on, f.stats.off);
});

test('actual SDK callback retry observes canonical revocation and writes no speculative UID or admission', {timeout: 30000}, async t => {
  const f = await fixture(t), before = await f.state();
  f.controls.interleave = value => { const row = value.enrollmentRegistry.approvals['approval-synthetic']; row.status = 'revoked'; row.revision++; };
  const denied = await f.claim(f.createA()), after = await f.state(); assert.equal(denied.ok, false); safe(denied);
  assert.ok(f.stats.callbacks >= 2); assert.ok(f.stats.auth >= 2); assert.equal(f.stats.on, f.stats.off);
  assert.equal(Object.hasOwn(after.grants, 'user-synthetic'), false); assert.equal(Object.hasOwn(after.enrollmentRegistry.approvals['approval-synthetic'], 'admission'), false);
  assert.deepEqual(after.products, before.products); assert.deepEqual(after.ownerCommandLedger, before.ownerCommandLedger); assert.deepEqual(after.tariffCommandLedger, before.tariffCommandLedger);
});

test('unrelated actual tenant changes survive a fresh outer verified retry without replacing sibling data', {timeout: 30000}, async t => {
  const f = await fixture(t), before = await f.state();
  f.controls.interleave = value => { value.products['product-ledger'].cycles['cycle-ledger'].config.revision++; value.grants['sibling-synthetic'] = {revision: 1, profile: {active: true, owner: false, modules: {qc: true}}}; };
  assert.deepEqual(await f.claim(f.createA()), {ok: true}); const after = await f.state();
  assert.ok(f.stats.auth >= 2); assert.ok(f.stats.transactions >= 2); assert.equal(f.stats.on, f.stats.off);
  assert.equal(after.products['product-ledger'].cycles['cycle-ledger'].config.revision, before.products['product-ledger'].cycles['cycle-ledger'].config.revision + 1);
  assert.deepEqual(after.products['product-synthetic'], before.products['product-synthetic']); assert.equal(after.grants['sibling-synthetic'].revision, 1);
  assert.deepEqual(after.ownerCommandLedger, before.ownerCommandLedger); assert.deepEqual(after.tariffCommandLedger, before.tariffCommandLedger); assert.equal(after.enrollmentRegistry.approvals['approval-synthetic'].admission.count, 1);
});

test('unknown identities and revoked claimed identities create no new canonical or ordinary quota write', {timeout: 30000}, async t => {
  const f = await fixture(t), before = await f.state(); f.actorA.email = 'synthetic.unknown.0001@gmail.com';
  const unknown = await f.claim(f.createA()); assert.equal(unknown.ok, false); safe(unknown); assert.deepEqual(await f.state(), before); assert.equal(f.stats.transactions, 0); assert.equal((await f.quotaRef.get()).val(), null);
  f.actorA.email = EMAIL; assert.deepEqual(await f.claim(f.createA()), {ok: true});
  await f.mutate(value => { value.grants['user-synthetic'].profile.active = false; value.grants['user-synthetic'].revision++; const row = value.enrollmentRegistry.approvals['approval-synthetic']; row.status = 'revoked'; row.revision++; });
  const revoked = await f.state(), denied = await f.claim(f.createB()); assert.equal(denied.ok, false); safe(denied); assert.deepEqual(await f.state(), revoked); assert.equal((await f.quotaRef.get()).val(), null);
});

test('ordinary session admission stays closed before enrollment and afterward exposes only own nonfinancial scope', {timeout: 30000}, async t => {
  const f = await fixture(t), before = await f.state();
  assert.deepEqual(await f.session.execute({idToken: TOKEN}), {ok: false, error: 'rate_limited'}); assert.equal((await f.quotaRef.get()).val(), null); assert.deepEqual(await f.state(), before);
  assert.deepEqual(await f.claim(f.createA()), {ok: true}); const enrolled = await f.state();
  const session = await f.session.execute({idToken: TOKEN}); assert.equal(session.ok, true);
  assert.deepEqual(session.session.profile, enrolled.grants['user-synthetic'].profile); assert.equal(session.session.uid, 'user-synthetic');
  assert.deepEqual(session.session.workerLabels, [{productId: 'product-synthetic', cycleId: 'cycle-synthetic', workers: [{workerId: 'worker-synthetic', label: 'Synthetic first partner'}]}]);
  assert.deepEqual(session.session.cycles, [{productId: 'product-synthetic', cycleId: 'cycle-synthetic'}]);
  for (const value of [EMAIL, TOKEN, 'google-synthetic', 'owner-synthetic', 'approval-synthetic', 'worker-other', 'Synthetic other partner', 'worker-ledger', 'tariff-synthetic', 'tariff-future', 'tariffInputs', 'historyByWorker', 'earnings', 'frozenPayroll', 'privateAuthority', 'commandJson', 'enrollmentRegistry']) assert.equal(JSON.stringify(session).includes(value), false);
  assert.equal((await f.quotaRef.child('user-synthetic').get()).val().count, 1); assert.deepEqual(await f.state(), enrolled, 'ordinary session does not mutate enrollment or business state');
});
