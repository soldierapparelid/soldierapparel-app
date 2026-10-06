'use strict';
// Narrow, disabled-by-default enrollment only. No SDK initialization, credentials,
// owner bootstrap, deployment, logging, or client-supplied permission bindings.
const Adapter = require('./production-tenant-adapter.cjs');
const Registry = require('./production-enrollment-registry.cjs');
const Identity = require('./production-enrollment-identity.cjs');
const IdentityState = require('./production-identity-state.cjs');

const MAX_ATTEMPTS = 3, MAX_TOKEN = 16384, MAX_TENANT_BYTES = 8 * 1024 * 1024;
const WARM_MS = 5000, WINDOW_MS = 60000, ATTEMPT_LIMIT = 20, FRESH_MS = 300000;
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const allowedErrors = new Set(['service_disabled', 'unavailable', 'invalid_request', 'access_denied', 'rate_limited', 'busy', 'conflict', 'not_ready', 'capacity_limit', 'result_unknown']);
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const safe = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v) && !forbidden.has(v);
const result = error => Object.freeze(error === undefined ? {ok: true} : {ok: false, error});
class EnrollmentServiceError extends Error { constructor(code) { super('Enrollment unavailable'); this.code = code; } }
const fail = code => { throw new EnrollmentServiceError(code); };

function data(v, key) {
  if (!plain(v)) return undefined;
  const d = Object.getOwnPropertyDescriptor(v, key);
  return d && d.enumerable && Object.hasOwn(d, 'value') ? d.value : undefined;
}
function exact(v, required, optional = []) {
  if (!plain(v)) return false;
  const keys = Reflect.ownKeys(v);
  return required.every(k => Object.hasOwn(v, k)) && keys.every(k => typeof k === 'string' && [...required, ...optional].includes(k) && (() => {
    const d = Object.getOwnPropertyDescriptor(v, k);
    return d && d.enumerable && Object.hasOwn(d, 'value');
  })());
}
function instant(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) fail('unavailable');
  return v;
}
function databaseURL(v) {
  if (typeof v !== 'string') fail('unavailable');
  let u; try { u = new URL(v); } catch { fail('unavailable'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash || u.pathname !== '/' || !/^([a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app)$/.test(u.hostname)) fail('unavailable');
  return u.origin;
}
const copy = v => Registry.copyEnrollmentData(v);
// Inputs to equality have already passed canonical own-data JSON validators.
function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}
const same = (a, b) => stable(a) === stable(b);
function policy(found) {
  const row = found.row;
  return {approvalId: found.approvalId, email: row.email, profile: copy(row.profile), reviewed: row.reviewed, approvedAt: row.approvedAt, expiresAt: row.expiresAt, revision: row.revision};
}
function identity(value, projectId, now) {
  if (!exact(value, ['projectId', 'uid', 'email', 'googleSubject', 'authTimeMs', 'issuedAtMs', 'expiresAtMs', 'verifiedAt']) || value.projectId !== projectId || !safe(value.uid) || !Identity.isEnrollmentEmail(value.email) || !safe(value.googleSubject)) fail('access_denied');
  const n = Date.parse(instant(now));
  if (![value.authTimeMs, value.issuedAtMs, value.expiresAtMs].every(Number.isSafeInteger) || value.authTimeMs < 0 || value.authTimeMs > value.issuedAtMs || value.issuedAtMs >= value.expiresAtMs || value.authTimeMs > n || value.issuedAtMs > n || n - value.authTimeMs > FRESH_MS || n - value.issuedAtMs > FRESH_MS || n >= value.expiresAtMs || Date.parse(instant(value.verifiedAt)) > n) fail('access_denied');
  return value;
}
function identityBinding(v) { return {projectId: v.projectId, uid: v.uid, email: v.email, googleSubject: v.googleSubject}; }
function sidecars(current, next, uid, approvalId, replayed) {
  if (!same(Object.keys(current).sort(), Object.keys(next).sort())) fail('not_ready');
  for (const k of Object.keys(current)) if (!['grants', 'enrollmentRegistry'].includes(k) && !same(current[k], next[k])) fail('not_ready');
  const beforeIds = Object.keys(current.grants).sort(), afterIds = Object.keys(next.grants).sort();
  if (replayed) {
    if (!same(current.grants, next.grants)) fail('not_ready');
  } else {
    if (Object.hasOwn(current.grants, uid) || !same(afterIds, [...beforeIds, uid].sort())) fail('access_denied');
    for (const key of beforeIds) if (!same(current.grants[key], next.grants[key])) fail('not_ready');
    if (!exact(next.grants[uid], ['revision', 'profile']) || next.grants[uid].revision !== 1) fail('not_ready');
  }
  const before = data(current, 'enrollmentRegistry'), after = data(next, 'enrollmentRegistry');
  if (!exact(before, ['schemaVersion', 'approvals']) || !exact(after, ['schemaVersion', 'approvals']) || before.schemaVersion !== after.schemaVersion || !same(Object.keys(before.approvals).sort(), Object.keys(after.approvals).sort())) fail('not_ready');
  for (const key of Object.keys(before.approvals)) if (key !== approvalId && !same(before.approvals[key], after.approvals[key])) fail('not_ready');
}

function createProductionEnrollmentService(options = {}) {
  let enabled = false;
  try { enabled = data(options, 'enabled') === true; } catch {}
  if (!enabled) return Object.freeze({execute: async () => result('service_disabled')});
  let configured = false, scope, ref, verifier, clock, emulator = null;
  let inFlight = false, highWater = -1, windowStartedAt = -1, attempts = 0;
  try {
    if (!exact(options, ['enabled', 'projectId', 'databaseURL', 'tenantId', 'database', 'auth', 'clock'], ['testOnlyEmulator'])) fail('unavailable');
    const projectId = data(options, 'projectId'), tenantId = data(options, 'tenantId');
    const url = databaseURL(data(options, 'databaseURL'));
    if (typeof projectId !== 'string' || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) || !safe(tenantId)) fail('unavailable');
    clock = data(options, 'clock');
    if (typeof clock !== 'function' || typeof Adapter.validateCanonicalTenant !== 'function' || typeof Registry.claimEnrollment !== 'function' || typeof Registry.lookupEnrollmentApproval !== 'function' || typeof Registry.lookupEnrollmentClaim !== 'function' || typeof Registry.copyEnrollmentData !== 'function') fail('unavailable');
    const e = data(options, 'testOnlyEmulator');
    if (e !== undefined) {
      if (!exact(e, ['host', 'port']) || !projectId.startsWith('demo-') || !['127.0.0.1', 'localhost'].includes(data(e, 'host')) || data(e, 'port') !== 9000 || url !== 'https://' + projectId + '.firebaseio.com') fail('unavailable');
      emulator = {host: data(e, 'host'), port: 9000};
    }
    scope = Object.freeze({projectId, tenantId, databaseURL: url, referenceURL: emulator ? 'http://' + emulator.host + ':9000' : url, database: data(options, 'database')});
    verifier = Identity.createProductionEnrollmentIdentityVerifier({enabled: true, projectId, auth: data(options, 'auth'), clock});
    if (!verifier || typeof verifier.verify !== 'function') fail('unavailable');
    configured = true;
  } catch {}
  function readNow() {
    let now; try { now = instant(clock()); } catch { fail('unavailable'); }
    const n = Date.parse(now); if (n < highWater) fail('unavailable'); highWater = n; return now;
  }
  function checkBinding() {
    try {
      if (emulator ? process.env.FIREBASE_DATABASE_EMULATOR_HOST !== emulator.host + ':9000' : process.env.FIREBASE_DATABASE_EMULATOR_HOST !== undefined) fail('unavailable');
      const db = scope.database;
      if (!db || typeof db.ref !== 'function' || !db.app || !db.app.options || db.app.options.projectId !== scope.projectId || databaseURL(db.app.options.databaseURL) !== scope.databaseURL) fail('unavailable');
      if (ref && ref.toString() !== scope.referenceURL + '/authorityTenants/' + scope.tenantId) fail('unavailable');
    } catch { fail('unavailable'); }
  }
  function reference() {
    checkBinding();
    if (!ref) {
      try { ref = scope.database.ref('authorityTenants/' + scope.tenantId); } catch { fail('unavailable'); }
      if (!ref || ['get', 'transaction', 'toString', 'on', 'off'].some(k => typeof ref[k] !== 'function')) fail('unavailable');
      checkBinding();
    }
    return ref;
  }
  function validate(value) { return Adapter.validateAccessTenant(value, {projectId: scope.projectId, tenantId: scope.tenantId}, MAX_TENANT_BYTES); }
  function lookup(value, who) {
    if (value.schemaVersion === 2) return IdentityState.lookupIdentityEnrollment(value, who);
    const registry = data(value, 'enrollmentRegistry');
    if (registry === undefined) fail('not_ready');
    const found = Registry.lookupEnrollmentClaim(registry, who) || Registry.lookupEnrollmentApproval(registry, who.email);
    if (!exact(found, ['approvalId', 'row']) || !safe(found.approvalId)) fail('access_denied');
    return found;
  }
  function preview(value, who, now) {
    const found = lookup(value, who), proposal = value.schemaVersion === 2 ? IdentityState.claimIdentityEnrollment(value, who, now) : Registry.claimEnrollment(value, who, now);
    if (!exact(proposal, ['next', 'approvalId', 'replayed', 'grantRevision']) || proposal.approvalId !== found.approvalId || typeof proposal.replayed !== 'boolean' || !Number.isSafeInteger(proposal.grantRevision) || proposal.grantRevision < 1) fail('not_ready');
    validate(proposal.next); sidecars(value, proposal.next, who.uid, found.approvalId, proposal.replayed); return proposal;
  }
  async function read(who) {
    const r = reference(); let snapshot;
    try { snapshot = await r.get(); } catch { fail('unavailable'); }
    checkBinding(); identity(who, scope.projectId, readNow());
    if (!snapshot || typeof snapshot.val !== 'function') fail('unavailable');
    let value; try { value = snapshot.val(); } catch { fail('unavailable'); }
    return validate(value);
  }
  async function transact(who, observedPolicy) {
    let listener, timer, called = 0, cold = false, terminal, candidate, dispatched = false, response;
    const ready = new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new EnrollmentServiceError('unavailable')); };
      listener = () => { clearTimeout(timer); resolve(); }; timer = setTimeout(abort, WARM_MS);
      try { ref.on('value', listener, abort); } catch { abort(); }
    });
    try {
      await ready; checkBinding(); identity(who, scope.projectId, readNow());
      dispatched = true;
      response = await ref.transaction(value => {
        if (value === null) { cold = true; return undefined; }
        called++; if (called > 1) { candidate = undefined; return undefined; }
        try {
          checkBinding(); const now = readNow(); identity(who, scope.projectId, now);
          const current = validate(value), found = lookup(current, who);
          if (!same(policy(found), observedPolicy)) fail('access_denied');
          candidate = preview(current, who, now); return candidate.next;
        } catch (error) { terminal = code(error); candidate = undefined; return undefined; }
      }, undefined, false);
      checkBinding();
      if (!response || typeof response.committed !== 'boolean') fail('result_unknown');
      if (!response.committed) {
        dispatched = false; identity(who, scope.projectId, readNow());
        if (terminal) fail(terminal);
        return {retryable: cold || called > 1};
      }
      if (cold || called !== 1 || !candidate || !response.snapshot || typeof response.snapshot.val !== 'function') fail('result_unknown');
      let committed; try { committed = validate(response.snapshot.val()); } catch { fail('result_unknown'); }
      if (!same(committed, candidate.next)) fail('result_unknown');
      identity(who, scope.projectId, readNow()); return {committed: true};
    } catch (error) { if (dispatched) fail('result_unknown'); throw error; }
    finally { clearTimeout(timer); try { ref.off('value', listener); } catch {} }
  }
  function code(error) {
    try {
      const d = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'code') : undefined;
      return d && d.enumerable && Object.hasOwn(d, 'value') && typeof d.value === 'string' && allowedErrors.has(d.value) ? d.value : 'unavailable';
    } catch { return 'unavailable'; }
  }
  async function execute(request) {
    if (!configured) return result('unavailable');
    if (inFlight) return result('busy');
    inFlight = true;
    try {
      const firstNow = Date.parse(readNow()), start = Math.floor(firstNow / WINDOW_MS) * WINDOW_MS;
      if (start !== windowStartedAt) { windowStartedAt = start; attempts = 0; }
      if (attempts >= ATTEMPT_LIMIT) fail('rate_limited'); attempts++;
      if (!exact(request, ['idToken'])) fail('invalid_request');
      const idToken = data(request, 'idToken');
      if (typeof idToken !== 'string' || !idToken || idToken.length > MAX_TOKEN || /[\r\n]/.test(idToken)) fail('invalid_request');
      let pinnedIdentity, pinnedPolicy;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        checkBinding(); let verified; try { verified = await verifier.verify({idToken}); } catch { fail('unavailable'); }
        if (!exact(verified, ['ok', 'identity']) || verified.ok !== true) {
          if (exact(verified, ['ok', 'error']) && verified.ok === false && ['service_disabled', 'unavailable', 'invalid_request', 'access_denied'].includes(verified.error)) fail(verified.error);
          fail('access_denied');
        }
        checkBinding(); const now = readNow(), who = identity(verified.identity, scope.projectId, now);
        const bound = identityBinding(who); if (pinnedIdentity && !same(bound, pinnedIdentity)) fail('access_denied'); if (!pinnedIdentity) pinnedIdentity = copy(bound);
        const observed = await read(who), found = lookup(observed, who), approved = policy(found);
        if (pinnedPolicy && !same(approved, pinnedPolicy)) fail('access_denied'); if (!pinnedPolicy) pinnedPolicy = copy(approved);
        preview(observed, who, readNow());
        const outcome = await transact(who, approved);
        if (outcome.committed === true) return result();
        if (!outcome.retryable) fail('unavailable');
      }
      fail('conflict');
    } catch (error) { return result(code(error)); }
    finally { inFlight = false; }
  }
  return Object.freeze({execute});
}
module.exports = Object.freeze({createProductionEnrollmentService});
