'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const Authority = require('../server/production-authority.cjs');
const Service = require('../server/production-enrollment-service.cjs');
const Registry = require('../server/production-enrollment-registry.cjs');
const Identity = require('../server/production-enrollment-identity.cjs');

const PROJECT = 'demo-enrollment-service', TENANT = 'tenant-synthetic';
const URL = 'https://' + PROJECT + '.firebaseio.com';
const NOW = '2026-02-02T03:00:00.000Z', TOKEN = 'synthetic.enrollment.token';
const EMAIL = 'synthetic.enrollment.0001@gmail.com', SUBJECT = 'google-synthetic-1';
const copy = v => structuredClone(v);
const pendingProfile = () => ({active: true, owner: false, workerId: 'worker-synthetic', modules: {jahit: true}});
function seed() {
  const state = Authority.createAuthority({product: {id: 'product-synthetic', series: 'Synthetic', namaBarang: 'Fixture', size: 'M', cutQuantity: 10}, cycleId: 'cycle-synthetic', workers: [{id: 'worker-synthetic', nama: 'Synthetic partner'}], assignments: [{id: 'assignment-synthetic', workerId: 'worker-synthetic', qty: 10}], now: NOW});
  return {schemaVersion: 1, projectId: PROJECT, tenantId: TENANT, grants: {'owner-synthetic': {revision: 1, profile: {active: true, owner: true}}}, products: {'product-synthetic': {cycles: {'cycle-synthetic': {config: {revision: 1, active: true, reviewedEmptyCycle: true, tariffPolicy: 'explicit-historical-jakarta-v1'}, tariffInputs: {revision: 1, policy: {version: 'policy-synthetic', kind: 'jakarta-fixed-local-time', hour: 8, minute: 0}, historyByWorker: {'worker-synthetic': {'tariff-synthetic': {effectiveAt: '2026-01-01T00:00:00.000Z', currency: 'IDR', rate: 100}}}}, wire: Authority.encodeStorage(state)}}}}, enrollmentRegistry: {schemaVersion: 1, approvals: {'approval-synthetic': {email: EMAIL, profile: pendingProfile(), reviewed: true, approvedAt: '2026-02-01T00:00:00.000Z', expiresAt: '2026-03-01T00:00:00.000Z', revision: 1, status: 'pending'}}}};
}
function fixture() {
  let value = seed(), time = NOW;
  const control = {uid: 'user-synthetic', email: EMAIL, subject: SUBJECT, authSeconds: Date.parse(NOW) / 1000, issuedSeconds: Date.parse(NOW) / 1000};
  const stats = {auth: 0, users: 0, refs: [], gets: 0, ons: 0, offs: 0, transactions: 0, commits: 0};
  class App { get options() { return {projectId: PROJECT, databaseURL: control.databaseURL || URL}; } }
  const sdkApp = new App();
  class Auth {
    get app() { return sdkApp; }
    async verifyIdToken(token, revoked) {
      stats.auth++; assert.equal(token, TOKEN); assert.equal(revoked, true);
      if (control.authWait) await control.authWait;
      if (control.authError) throw Error('SYNTHETIC_AUTH_CANARY');
      return {uid: control.uid, sub: control.uid, aud: PROJECT, iss: 'https://securetoken.google.com/' + PROJECT, email: control.email, email_verified: true, firebase: {sign_in_provider: 'google.com', identities: {'google.com': [control.subject]}}, auth_time: control.authSeconds, iat: control.issuedSeconds, exp: control.issuedSeconds + 3600};
    }
    async getUser(uid) {
      stats.users++; assert.equal(uid, control.uid);
      return {uid, email: control.email, emailVerified: true, disabled: false, providerData: [{providerId: 'google.com', uid: control.subject, email: control.email}]};
    }
  }
  const reference = {
    toString() { return URL + '/authorityTenants/' + TENANT; },
    async get() { stats.gets++; if (control.onGet) control.onGet(stats.gets); const snapshot = copy(value); return {val: () => copy(snapshot)}; },
    on(event, callback, cancel) {
      stats.ons++; assert.equal(event, 'value');
      if (control.onWarm) control.onWarm(stats.ons);
      if (control.warmError) return queueMicrotask(() => cancel(Error('SYNTHETIC_WARM_CANARY')));
      if (!control.silentWarm) queueMicrotask(callback);
    },
    off(event, callback) { stats.offs++; assert.equal(event, 'value'); assert.equal(typeof callback, 'function'); },
    async transaction(update, completion, applyLocally) {
      stats.transactions++; assert.equal(completion, undefined); assert.equal(applyLocally, false);
      if (control.coldOnce) { control.coldOnce = false; assert.equal(update(null), undefined); return {committed: false}; }
      if (control.repeatOnce) {
        control.repeatOnce = false; const first = update(copy(value)); assert.ok(first);
        if (control.onRetry) control.onRetry();
        assert.equal(update(copy(value)), undefined); return {committed: false};
      }
      if (control.beforeCallback) control.beforeCallback();
      const next = update(copy(value));
      if (next === undefined) return {committed: false};
      value = copy(next); stats.commits++;
      if (control.afterCommit) control.afterCommit();
      if (control.loseAck) { control.loseAck = false; throw Error('SYNTHETIC_ACK_CANARY'); }
      if (control.badAck) { control.badAck = false; return {committed: true, snapshot: {val: () => ({malformed: 'SYNTHETIC_ACK_CANARY'})}}; }
      const snapshot = copy(value); return {committed: true, snapshot: {val: () => copy(snapshot)}};
    }
  };
  const database = {app: sdkApp, ref(path) { stats.refs.push(path); assert.equal(path, 'authorityTenants/' + TENANT); return reference; }};
  const options = () => ({enabled: true, projectId: PROJECT, databaseURL: URL, tenantId: TENANT, database, auth: new Auth(), clock: () => time});
  return {control, stats, options, create: () => Service.createProductionEnrollmentService(options()), get value() { return value; }, set value(v) { value = v; }, get time() { return time; }, set time(v) { time = v; }};
}
function isolatedService(adapter, registry) {
  const sandbox = {module: {exports: {}}, require(path) {
    if (path === './production-tenant-adapter.cjs') return {...adapter, validateAccessTenant: adapter.validateCanonicalTenant};
    if (path === './production-enrollment-registry.cjs') return registry;
    if (path === './production-enrollment-identity.cjs') return Identity;
    if (path === './production-identity-state.cjs') return require('../server/production-identity-state.cjs');
    throw Error('unreviewed test dependency');
  }};
  const filename = require.resolve('../server/production-enrollment-service.cjs');
  const factory = vm.runInThisContext('(function(module,require){\n' + fs.readFileSync(filename, 'utf8') + '\n})', {filename});
  factory(sandbox.module, sandbox.require);
  return sandbox.module.exports;
}
function safeResponse(v) {
  assert.equal(Object.isFrozen(v), true);
  assert.deepEqual(Object.keys(v).sort(), v.ok ? ['ok'] : ['error', 'ok']);
  const serialized = JSON.stringify(v);
  for (const canary of [EMAIL, SUBJECT, TOKEN, 'worker-synthetic', 'approval-synthetic', 'SYNTHETIC_']) assert.equal(serialized.includes(canary), false);
}
const claim = service => service.execute({idToken: TOKEN});

test('OFF uses only an own enumerable data flag and touches no options, SDK, request, or clock getters', async () => {
  let touched = 0;
  for (const options of [{}, {enabled: false}, Object.create({enabled: true}), Object.defineProperty({}, 'enabled', {get() { touched++; return true; }}), Object.defineProperty({}, 'enabled', {value: true})]) {
    Object.defineProperty(options, 'database', {get() { touched++; throw Error('private'); }});
    const request = Object.defineProperty({}, 'idToken', {get() { touched++; throw Error('private'); }});
    assert.deepEqual(await Service.createProductionEnrollmentService(options).execute(request), {ok: false, error: 'service_disabled'});
  }
  assert.equal(touched, 0);
});

test('enabled configuration and request descriptors reject getters/inheritance/extra choices before SDK work', async () => {
  const f = fixture(); let touched = 0;
  const badOptions = f.options(); Object.defineProperty(badOptions, 'auth', {enumerable: true, get() { touched++; return {}; }});
  assert.deepEqual(await claim(Service.createProductionEnrollmentService(badOptions)), {ok: false, error: 'unavailable'});
  for (const request of [{idToken: TOKEN, workerId: 'worker-synthetic'}, {idToken: TOKEN, role: 'owner'}, Object.create({idToken: TOKEN}), Object.defineProperty({}, 'idToken', {enumerable: true, get() { touched++; return TOKEN; }}), ['token']]) {
    const r = await f.create().execute(request); assert.deepEqual(r, {ok: false, error: 'invalid_request'}); safeResponse(r);
  }
  assert.equal(touched, 0); assert.equal(f.stats.auth, 0); assert.deepEqual(f.stats.refs, []);
});

test('initial claim commits only its UID grant and private registry row with admission atomically', async () => {
  const f = fixture(), before = copy(f.value), r = await claim(f.create());
  assert.deepEqual(r, {ok: true}); safeResponse(r);
  assert.equal(f.stats.commits, 1); assert.equal(f.stats.ons, 1); assert.equal(f.stats.offs, 1);
  assert.deepEqual(f.value.products, before.products); assert.deepEqual(f.value.grants['owner-synthetic'], before.grants['owner-synthetic']);
  assert.deepEqual(f.value.grants['user-synthetic'], {revision: 1, profile: pendingProfile()});
  const row = f.value.enrollmentRegistry.approvals['approval-synthetic'];
  assert.equal(row.status, 'claimed'); assert.equal(row.revision, 2);
  assert.deepEqual(row.claim, {uid: 'user-synthetic', googleSubject: SUBJECT, claimedAt: NOW, grantRevision: 1});
  assert.deepEqual(row.admission, {windowStartedAt: Date.parse(NOW), count: 1});
  assert.deepEqual(f.stats.refs, ['authorityTenants/' + TENANT]);
});

test('new service private copies and comparisons never invoke an inherited serialization hook', async () => {
  const f = fixture();
  // Isolate this new service boundary from the older Authority/adapter codecs.
  // The reviewed registry descriptor copier remains genuine; no SDK is loaded.
  const adapter = {validateCanonicalTenant(value) { Registry.copyEnrollmentData(value); return value; }};
  const registry = {
    copyEnrollmentData: Registry.copyEnrollmentData,
    lookupEnrollmentClaim() { return null; },
    lookupEnrollmentApproval(value) { return {approvalId: 'approval-synthetic', row: Registry.copyEnrollmentData(value.approvals['approval-synthetic'])}; },
    claimEnrollment(value, who, now) {
      const next = Registry.copyEnrollmentData(value), row = next.enrollmentRegistry.approvals['approval-synthetic'];
      row.status = 'claimed'; row.revision++; row.claim = {uid: who.uid, googleSubject: who.googleSubject, claimedAt: now, grantRevision: 1}; row.admission = {windowStartedAt: Date.parse(now), count: 1};
      next.grants[who.uid] = {revision: 1, profile: Registry.copyEnrollmentData(row.profile)};
      return {next, approvalId: 'approval-synthetic', replayed: false, grantRevision: 1};
    }
  };
  const create = isolatedService(adapter, registry).createProductionEnrollmentService;
  const old = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON'); let touched = 0, response;
  try {
    Object.defineProperty(Object.prototype, 'toJSON', {configurable: true, get() { touched++; throw Error('SYNTHETIC_INHERITED_SERIALIZATION_CANARY'); }});
    response = await claim(create(f.options()));
  } finally { if (old) Object.defineProperty(Object.prototype, 'toJSON', old); else delete Object.prototype.toJSON; }
  assert.deepEqual(response, {ok: true}); assert.equal(touched, 0); assert.equal(f.value.grants['user-synthetic'].profile.owner, false);
});

test('unknown error.code accessors are ignored without execution or sensitive output', async () => {
  const f = fixture(); let touched = 0;
  const hostile = Object.defineProperty({}, 'code', {enumerable: true, get() { touched++; return 'access_denied'; }});
  const create = isolatedService({validateCanonicalTenant() { throw hostile; }}, Registry).createProductionEnrollmentService;
  const response = await claim(create(f.options())); assert.deepEqual(response, {ok: false, error: 'unavailable'}); safeResponse(response); assert.equal(touched, 0); assert.equal(f.stats.transactions, 0);
});

test('absent canonical registry cannot be supplied by an inherited getter and performs no permission write', async () => {
  const f = fixture(); delete f.value.enrollmentRegistry;
  const old = Object.getOwnPropertyDescriptor(Object.prototype, 'enrollmentRegistry'); let touched = 0, response;
  try {
    Object.defineProperty(Object.prototype, 'enrollmentRegistry', {configurable: true, get() { touched++; throw Error('SYNTHETIC_INHERITED_REGISTRY_CANARY'); }});
    response = await claim(f.create());
  } finally { if (old) Object.defineProperty(Object.prototype, 'enrollmentRegistry', old); else delete Object.prototype.enrollmentRegistry; }
  assert.deepEqual(response, {ok: false, error: 'not_ready'}); safeResponse(response); assert.equal(touched, 0); assert.equal(f.stats.transactions, 0); assert.equal(Object.hasOwn(f.value.grants, 'user-synthetic'), false);
});

test('independent service instances share fixed eight-per-minute canonical approval quota including replay', async () => {
  const f = fixture(), a = f.create(), b = f.create();
  for (let n = 0; n < 8; n++) assert.deepEqual(await claim(n % 2 ? a : b), {ok: true});
  const before = copy(f.value);
  assert.deepEqual(await claim(f.create()), {ok: false, error: 'rate_limited'});
  assert.deepEqual(f.value, before); assert.equal(f.stats.commits, 8);
  assert.equal(f.value.enrollmentRegistry.approvals['approval-synthetic'].admission.count, 8);
  assert.equal(f.value.enrollmentRegistry.approvals['approval-synthetic'].revision, 9);
  assert.equal(f.value.grants['user-synthetic'].revision, 1);
  f.time = '2026-02-02T03:01:00.000Z';
  assert.deepEqual(await claim(f.create()), {ok: true});
  assert.deepEqual(f.value.enrollmentRegistry.approvals['approval-synthetic'].admission, {windowStartedAt: Date.parse(f.time), count: 1});
});

test('expired approval and closed cycle affect initial claim but do not reactivate or block eligible exact replay', async () => {
  const f = fixture(); assert.deepEqual(await claim(f.create()), {ok: true});
  const row = f.value.enrollmentRegistry.approvals['approval-synthetic']; row.expiresAt = '2026-02-02T03:00:00.001Z';
  f.time = '2026-02-02T03:00:01.000Z'; f.value.products['product-synthetic'].cycles['cycle-synthetic'].config.active = false;
  assert.deepEqual(await claim(f.create()), {ok: true});
  f.value.grants['user-synthetic'].profile.active = false; const before = copy(f.value);
  assert.equal((await claim(f.create())).ok, false); assert.deepEqual(f.value, before);
});

test('verified email change replays its retained UID/Google binding rather than another pending worker approval', async () => {
  const f = fixture();
  const state = Authority.createAuthority({product: {id: 'product-synthetic', series: 'Synthetic', namaBarang: 'Fixture', size: 'M', cutQuantity: 20}, cycleId: 'cycle-synthetic', workers: [{id: 'worker-synthetic', nama: 'Synthetic partner'}, {id: 'worker-other', nama: 'Synthetic other'}], assignments: [{id: 'assignment-synthetic', workerId: 'worker-synthetic', qty: 10}, {id: 'assignment-other', workerId: 'worker-other', qty: 10}], now: NOW});
  f.value.products['product-synthetic'].cycles['cycle-synthetic'].wire = Authority.encodeStorage(state);
  const other = copy(f.value.enrollmentRegistry.approvals['approval-synthetic']); other.email = 'synthetic.enrollment.0002@gmail.com'; other.profile.workerId = 'worker-other';
  f.value.enrollmentRegistry.approvals['approval-other'] = other;
  assert.deepEqual(await claim(f.create()), {ok: true}); const beforeOther = copy(f.value.enrollmentRegistry.approvals['approval-other']);
  f.control.email = other.email; assert.deepEqual(await claim(f.create()), {ok: true});
  assert.equal(f.value.grants['user-synthetic'].profile.workerId, 'worker-synthetic'); assert.deepEqual(f.value.enrollmentRegistry.approvals['approval-other'], beforeOther);
  assert.equal(f.value.enrollmentRegistry.approvals['approval-synthetic'].admission.count, 2);
  const before = copy(f.value); f.control.subject = 'google-relinked-synthetic';
  const denied = await claim(f.create()); assert.equal(denied.ok, false); safeResponse(denied); assert.deepEqual(f.value, before);
});

test('unknown email and unavailable owner/worker never create any quota or grant write', async () => {
  const variants = [f => { f.control.email = 'synthetic.unknown.0001@gmail.com'; }, f => { f.value.grants = {}; }, f => { f.value.products['product-synthetic'].cycles['cycle-synthetic'].config.active = false; }, f => { f.value.enrollmentRegistry.approvals['approval-synthetic'].expiresAt = NOW; }];
  for (const change of variants) {
    const f = fixture(); change(f); const before = copy(f.value), r = await claim(f.create()); safeResponse(r);
    assert.equal(r.ok, false); assert.deepEqual(f.value, before); assert.equal(f.stats.transactions, 0);
    assert.ok(f.stats.refs.every(path => path === 'authorityTenants/' + TENANT));
  }
});

test('existing UID grants, including inactive/owner grants, cannot be overwritten by a pending approval', async () => {
  for (const profile of [pendingProfile(), {...pendingProfile(), active: false}, {active: true, owner: true}]) {
    const f = fixture(); f.value.grants['user-synthetic'] = {revision: 7, profile}; const before = copy(f.value), r = await claim(f.create());
    assert.equal(r.ok, false); safeResponse(r); assert.deepEqual(f.value, before); assert.equal(f.stats.transactions, 0);
  }
});

test('QC enrollment has no worker binding and Potong/owner approvals cannot enroll', async () => {
  const f = fixture(); f.value.enrollmentRegistry.approvals['approval-synthetic'].profile = {active: true, owner: false, modules: {qc: true}};
  assert.deepEqual(await claim(f.create()), {ok: true});
  assert.deepEqual(f.value.grants['user-synthetic'].profile, {active: true, owner: false, modules: {qc: true}});
  for (const profile of [{active: true, owner: true}, {active: true, owner: false, workerId: 'worker-synthetic', modules: {potong: true}}]) {
    const g = fixture(); g.value.enrollmentRegistry.approvals['approval-synthetic'].profile = profile; const before = copy(g.value);
    const r = await claim(g.create()); assert.equal(r.ok, false); safeResponse(r); assert.deepEqual(g.value, before); assert.equal(g.stats.transactions, 0);
  }
});

test('canonical revocation between preflight and SDK callback aborts all permission/admission changes', async () => {
  const f = fixture(); f.control.onWarm = () => { f.value.enrollmentRegistry.approvals['approval-synthetic'].status = 'revoked'; };
  const r = await claim(f.create()); assert.equal(r.ok, false); safeResponse(r);
  assert.equal(f.stats.transactions, 1); assert.equal(f.stats.commits, 0);
  assert.equal(Object.hasOwn(f.value.grants, 'user-synthetic'), false);
  assert.equal(Object.hasOwn(f.value.enrollmentRegistry.approvals['approval-synthetic'], 'admission'), false);
});

test('different UID racing for the same approval cannot acquire the already claimed worker', async () => {
  const f = fixture();
  f.control.beforeCallback = () => {
    f.value.grants['racing-synthetic'] = {revision: 1, profile: pendingProfile()};
    const row = f.value.enrollmentRegistry.approvals['approval-synthetic']; row.status = 'claimed'; row.revision++;
    row.claim = {uid: 'racing-synthetic', googleSubject: 'google-racing-synthetic', claimedAt: NOW, grantRevision: 1};
    row.admission = {windowStartedAt: Date.parse(NOW), count: 1};
  };
  const r = await claim(f.create()); assert.equal(r.ok, false); safeResponse(r); assert.equal(f.stats.commits, 0);
  assert.equal(Object.hasOwn(f.value.grants, 'user-synthetic'), false); assert.equal(f.value.enrollmentRegistry.approvals['approval-synthetic'].claim.uid, 'racing-synthetic');
});

test('cold SDK cache and repeated transaction callbacks reverify outside the callback and clean listeners', async () => {
  for (const key of ['coldOnce', 'repeatOnce']) {
    const f = fixture(); f.control[key] = true;
    assert.deepEqual(await claim(f.create()), {ok: true});
    assert.equal(f.stats.auth, 2); assert.equal(f.stats.users, 2); assert.equal(f.stats.transactions, 2);
    assert.equal(f.stats.commits, 1); assert.equal(f.stats.ons, 2); assert.equal(f.stats.offs, 2);
    assert.equal(f.value.enrollmentRegistry.approvals['approval-synthetic'].admission.count, 1);
  }
});

test('identity or approved policy revision drift on an outer retry denies without overwriting canonical data', async () => {
  for (const change of [f => { f.control.subject = 'google-changed-synthetic'; }, f => { f.value.enrollmentRegistry.approvals['approval-synthetic'].revision++; }]) {
    const f = fixture(); f.control.repeatOnce = true; f.control.onRetry = () => change(f);
    const r = await claim(f.create()); assert.equal(r.ok, false); safeResponse(r); assert.equal(f.stats.commits, 0);
    assert.equal(Object.hasOwn(f.value.grants, 'user-synthetic'), false);
  }
});

test('lost or corrupt commit acknowledgements return result_unknown and a fresh verified replay is safe', async () => {
  for (const key of ['loseAck', 'badAck']) {
    const f = fixture(); f.control[key] = true;
    const r = await claim(f.create()); assert.deepEqual(r, {ok: false, error: 'result_unknown'}); safeResponse(r);
    assert.equal(f.stats.commits, 1); assert.equal(f.value.grants['user-synthetic'].revision, 1);
    assert.deepEqual(await claim(f.create()), {ok: true}); assert.equal(f.stats.commits, 2);
    assert.equal(f.value.grants['user-synthetic'].revision, 1); assert.equal(f.value.enrollmentRegistry.approvals['approval-synthetic'].admission.count, 2);
  }
});

test('freshness expires while warming or after a commit without returning a false definite failure', async () => {
  const warm = fixture(); warm.control.onWarm = () => { warm.time = '2026-02-02T03:05:00.001Z'; };
  assert.deepEqual(await claim(warm.create()), {ok: false, error: 'access_denied'}); assert.equal(warm.stats.transactions, 0);
  const ack = fixture(); ack.control.afterCommit = () => { ack.time = '2026-02-02T03:05:00.001Z'; };
  assert.deepEqual(await claim(ack.create()), {ok: false, error: 'result_unknown'}); assert.equal(ack.stats.commits, 1);
});

test('wrong bound database and backwards process clock fail without additional canonical writes', async () => {
  const f = fixture(), service = f.create(); assert.deepEqual(await claim(service), {ok: true});
  const before = copy(f.value); f.time = '2026-02-02T02:59:59.999Z';
  assert.deepEqual(await claim(service), {ok: false, error: 'unavailable'}); assert.deepEqual(f.value, before);
  f.time = NOW; f.control.databaseURL = 'https://demo-other-bound.firebaseio.com';
  assert.deepEqual(await claim(service), {ok: false, error: 'unavailable'}); assert.deepEqual(f.value, before); assert.equal(f.stats.commits, 1);
});

test('canonical admission rejects a backwards minute after process restart without resetting its persisted quota', async () => {
  const f = fixture(); assert.deepEqual(await claim(f.create()), {ok: true});
  f.time = '2026-02-02T03:01:00.000Z'; assert.deepEqual(await claim(f.create()), {ok: true});
  const before = copy(f.value); f.time = '2026-02-02T03:00:30.000Z';
  assert.deepEqual(await claim(f.create()), {ok: false, error: 'access_denied'});
  assert.deepEqual(f.value, before); assert.equal(f.stats.commits, 2);
});

test('quota and approval revision advancing concurrently prevent a stale preflight from creating a ninth admission', async () => {
  const f = fixture(); for (let n = 0; n < 7; n++) assert.deepEqual(await claim(f.create()), {ok: true});
  f.control.beforeCallback = () => { const row = f.value.enrollmentRegistry.approvals['approval-synthetic']; row.admission.count = 8; row.revision++; };
  const r = await claim(f.create()); assert.equal(r.ok, false); safeResponse(r);
  assert.equal(f.value.enrollmentRegistry.approvals['approval-synthetic'].admission.count, 8);
  assert.equal(f.value.grants['user-synthetic'].revision, 1); assert.equal(f.stats.commits, 7);
});

test('one slot stays held through an outstanding Auth await and rejects concurrent work before inspecting its request', async () => {
  const f = fixture(); let release; f.control.authWait = new Promise(resolve => { release = resolve; });
  const service = f.create(), running = claim(service); await new Promise(resolve => setImmediate(resolve));
  let touched = 0; const hostile = Object.defineProperty({}, 'idToken', {enumerable: true, get() { touched++; return TOKEN; }});
  assert.deepEqual(await service.execute(hostile), {ok: false, error: 'busy'}); assert.equal(touched, 0); assert.equal(f.stats.auth, 1);
  release(); assert.deepEqual(await running, {ok: true}); assert.equal(f.stats.commits, 1);
});

test('fixed global twenty-per-minute pre-Auth gate creates no per-unknown-UID records', async () => {
  const f = fixture(); f.control.email = 'synthetic.unknown.0001@gmail.com'; const service = f.create(), before = copy(f.value);
  for (let n = 0; n < 20; n++) { const r = await claim(service); assert.equal(r.ok, false); assert.notEqual(r.error, 'rate_limited'); }
  assert.deepEqual(await claim(service), {ok: false, error: 'rate_limited'}); assert.equal(f.stats.auth, 20);
  assert.equal(f.stats.transactions, 0); assert.deepEqual(f.value, before); assert.deepEqual(f.stats.refs, ['authorityTenants/' + TENANT]);
  f.time = '2026-02-02T03:01:00.000Z'; await claim(service); assert.equal(f.stats.auth, 21);
});

test('SDK/Auth/warm failures have generic responses and release the slot without logging thrown canaries', async () => {
  const f = fixture(); f.control.authError = true; safeResponse(await claim(f.create())); assert.equal(f.stats.transactions, 0);
  const warm = fixture(); warm.control.warmError = true; const service = warm.create();
  assert.deepEqual(await claim(service), {ok: false, error: 'unavailable'}); assert.equal(warm.stats.ons, 1); assert.equal(warm.stats.offs, 1);
  warm.control.warmError = false; assert.deepEqual(await claim(service), {ok: true});
});

test('actual bounded warm deadline cleans its subscription and creates no admission or grant', async () => {
  const f = fixture(); f.control.silentWarm = true; const before = copy(f.value), start = Date.now();
  assert.deepEqual(await claim(f.create()), {ok: false, error: 'unavailable'});
  assert.ok(Date.now() - start >= 4900); assert.equal(f.stats.ons, 1); assert.equal(f.stats.offs, 1); assert.equal(f.stats.transactions, 0); assert.deepEqual(f.value, before);
});
