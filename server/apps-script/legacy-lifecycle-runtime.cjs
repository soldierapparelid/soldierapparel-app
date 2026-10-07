'use strict';
// Separate SOURCE-OFF candidate. Existing append-only runtime/build/proof stay
// unchanged. Requires a reviewed native host, finite shared admission and roster.
const Identity = require('./current-google-identity.cjs');
const Transport = require('./rest-root-adapter.cjs');
const Snapshot = require('../production-legacy-operations.cjs');
const Lifecycle = require('../production-legacy-lifecycle.cjs');
const Finance = require('../production-legacy-finance.cjs');
const DEFAULT_CONFIGURATION = Object.freeze({ enabled: false, binding: Object.freeze({ projectId: '', databaseURL: '', tenantId: '', apiKey: '' }) });
const ERRORS = new Set(['service_disabled', 'unavailable', 'invalid_request', 'access_denied', 'not_ready', 'conflict', 'capacity_limit', 'result_unknown', 'rate_limited', 'busy']);
const IDENTITY_KEYS = ['projectId', 'uid', 'email', 'googleSubject', 'authTimeMs', 'issuedAtMs', 'expiresAtMs', 'verifiedAt'];
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const rejected = error => Object.freeze(error === 'result_unknown' ? { ok: false, error, retrySameCommand: true } : { ok: false, error });
class RuntimeError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new RuntimeError(code); };
function field(v, k, code = 'unavailable') { const d = v && typeof v === 'object' ? Object.getOwnPropertyDescriptor(v, k) : null; if (!d?.enumerable || !Object.hasOwn(d, 'value')) fail(code); return d.value; }
function exact(v, keys, code = 'unavailable') { if (!plain(v) || Reflect.ownKeys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) fail(code); for (const k of keys) field(v, k, code); }
function method(v, k) { for (let p = v, depth = 0; p && typeof p === 'object' && depth < 8; p = Object.getPrototypeOf(p), depth++) { const d = Object.getOwnPropertyDescriptor(p, k); if (d) { if (!Object.hasOwn(d, 'value') || typeof d.value !== 'function') fail('unavailable'); return d.value; } } fail('unavailable'); }
function canonical(v) { if (v === null || typeof v !== 'object') return JSON.stringify(v); return Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}'; }
const same = (a, b) => canonical(Snapshot.copyLegacyRoot(a)) === canonical(Snapshot.copyLegacyRoot(b));
function unwrap(v, keys) { if (plain(v) && Object.hasOwn(v, 'error')) { const code = field(v, 'error'); exact(v, code === 'result_unknown' && Object.hasOwn(v, 'retrySameCommand') ? ['ok', 'error', 'retrySameCommand'] : ['ok', 'error']); if (v.ok !== false || !ERRORS.has(code) || Object.hasOwn(v, 'retrySameCommand') && v.retrySameCommand !== true) fail('unavailable'); fail(code); } exact(v, keys); if (v.ok !== true) fail('unavailable'); return v; }
function receipt(v, command) { const r = field(v, 'receipt'); exact(r, ['ok', 'replayed', 'operationId']); if (r.ok !== true || typeof r.replayed !== 'boolean' || r.operationId !== command.operationId) fail('unavailable'); return Object.freeze({ ok: true, replayed: r.replayed, operationId: r.operationId }); }
function createAppsScriptLegacyLifecycleRuntime(options = {}) {
  let enabled = false; try { const d = plain(options) && Object.getOwnPropertyDescriptor(options, 'enabled'); enabled = !!d && Object.hasOwn(d, 'value') && d.value === true; } catch {}
  const denied = error => Object.freeze({ read: () => rejected(error), readFinance: () => rejected(error), execute: () => rejected(error), resolve: () => rejected(error) });
  if (!enabled) return denied('service_disabled');
  let binding, host, script, fetchMethod, oauthMethod, clock, requestAdmission, identityAdmission, verifier, transport, core, finance;
  let busy = false, drift = false, highWater = -1, currentToken = '', lastIdentity = null, verificationFailure = null;
  function check() { if (drift) fail('unavailable'); try { if (method(host, 'fetch') !== fetchMethod || method(script, 'getOAuthToken') !== oauthMethod) fail('unavailable'); } catch { drift = true; fail('unavailable'); } }
  function now() { check(); const time = clock(); check(); if (typeof time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(time) || !Number.isFinite(Date.parse(time)) || Date.parse(time) < 0 || new Date(time).toISOString() !== time || Date.parse(time) < highWater) fail('unavailable'); highWater = Date.parse(time); return time; }
  function verify() {
    try { check(); if (!currentToken) fail('access_denied'); const r = unwrap(verifier.verify({ idToken: currentToken }), ['ok', 'identity']); check(); exact(r.identity, IDENTITY_KEYS, 'access_denied'); lastIdentity = Object.freeze({ ...r.identity }); if (lastIdentity.expiresAtMs <= Date.parse(now())) fail('access_denied'); return lastIdentity; }
    catch (e) { verificationFailure = e instanceof RuntimeError && ['access_denied', 'invalid_request', 'unavailable'].includes(e.code) ? e.code : 'unavailable'; throw e; }
  }
  try {
    exact(options, ['enabled', 'binding', 'urlFetchApp', 'scriptApp', 'clock', 'requestAdmission', 'identityAdmission', 'tariffPolicy']); const selected = field(options, 'binding'); exact(selected, ['projectId', 'databaseURL', 'tenantId', 'apiKey']); binding = Object.freeze({ ...selected });
    if (typeof binding.projectId !== 'string' || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(binding.projectId) || typeof binding.tenantId !== 'string' || !/^[A-Za-z_-][A-Za-z0-9_-]{0,127}$/.test(binding.tenantId) || ['__proto__', 'constructor', 'prototype'].includes(binding.tenantId) || typeof binding.databaseURL !== 'string' || !/^https:\/\/([a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app)$/.test(binding.databaseURL) || typeof binding.apiKey !== 'string' || !/^[A-Za-z0-9_-]{20,128}$/.test(binding.apiKey)) fail('unavailable');
    const policy = Snapshot.copyLegacyRoot(field(options, 'tariffPolicy')); exact(policy, ['version', 'reviewed', 'timeZone', 'quantityBasis']); if (policy.version !== 'legacy-jahit-current-v1' || policy.reviewed !== true || policy.timeZone !== 'Asia/Jakarta' || policy.quantityBasis !== 'good-plus-reject') fail('unavailable');
    host = field(options, 'urlFetchApp'); script = field(options, 'scriptApp'); fetchMethod = method(host, 'fetch'); oauthMethod = method(script, 'getOAuthToken'); clock = field(options, 'clock'); requestAdmission = field(options, 'requestAdmission'); identityAdmission = field(options, 'identityAdmission'); if ([clock, requestAdmission, identityAdmission].some(v => typeof v !== 'function')) fail('unavailable'); check();
    verifier = Identity.createAppsScriptSessionGoogleIdentityVerifier({ enabled: true, binding: { projectId: binding.projectId, apiKey: binding.apiKey }, urlFetchApp: host, clock: now }); const rootBinding = Object.freeze({ projectId: binding.projectId, databaseURL: binding.databaseURL, tenantId: binding.tenantId });
    transport = Transport.createAppsScriptRestRootAdapter({ enabled: true, binding: rootBinding, urlFetchApp: host, scriptApp: script, verifyCurrentIdentity: verify, clock: now }); const pureOptions = { enabled: true, binding: rootBinding, clock: now, tariffPolicy: policy }; core = Lifecycle.createProductionLegacyLifecycle(pureOptions); finance = Finance.createProductionLegacyFinance(pureOptions);
  } catch { return denied('unavailable'); }
  function parse(raw, kind) {
    const reading = kind === 'read' || kind === 'readFinance'; exact(raw, reading ? ['idToken'] : ['idToken', 'command'], 'invalid_request'); const token = field(raw, 'idToken', 'invalid_request'); if (typeof token !== 'string' || !token || token.length > 16384 || /[\r\n]/.test(token)) fail('invalid_request');
    if (reading) return { token, command: null }; try { return { token, command: Lifecycle.normalizeLegacyLifecycleCommand(field(raw, 'command', 'invalid_request')) }; } catch { fail('invalid_request'); }
  }
  function admission(kind) {
    const writing = kind === 'execute', budget = Object.freeze({ projectId: binding.projectId, kind, now: now(), maxDatabaseDownloadBytes: (writing ? 3 : 2) * Transport.MAX_BYTES, maxGoogleLookupCount: writing ? 14 : 10 }); if (requestAdmission(budget) !== true) fail('rate_limited'); check(); const who = verify(); if (identityAdmission(Object.freeze({ projectId: binding.projectId, uid: who.uid, email: who.email, googleSubject: who.googleSubject, kind, now: now() })) !== true) fail('access_denied'); check(); return Object.freeze({ ...who });
  }
  function readRoot(initial) { verificationFailure = null; const observed = transport.read(); check(); if (verificationFailure) fail(verificationFailure); const r = unwrap(observed, ['ok', 'etag', 'root']); if (!lastIdentity || !same(initial, { ...lastIdentity, verifiedAt: initial.verifiedAt })) fail('access_denied'); return r; }
  function capture(root) { const r = unwrap(core.capture({ root, identity: lastIdentity }), ['ok', 'context']); check(); return r.context; }
  function continuity(first, current) { if (!same(first, current)) fail('access_denied'); }
  function confirm(initial, context, command, replayed) { const latest = readRoot(initial); continuity(context, capture(latest.root)); const r = receipt(unwrap(core.resolve({ root: latest.root, identity: lastIdentity, command }), ['ok', 'receipt']), command); if (!r.replayed) fail('result_unknown'); if (lastIdentity.expiresAtMs <= Date.parse(now())) fail('access_denied'); check(); return Object.freeze({ ...r, replayed }); }
  function run(raw, kind, count) {
    if (busy) return rejected('busy'); busy = true; let parsed = null, writeAttempted = false;
    try {
      if (count !== 1) fail('invalid_request'); parsed = parse(raw, kind); currentToken = parsed.token; const initial = admission(kind), first = readRoot(initial), context = capture(first.root);
      if (kind === 'read' || kind === 'readFinance') {
        if (kind === 'readFinance' && context.binding.division !== 'jahit') fail('access_denied'); const lane = kind === 'read' ? core : finance; unwrap(lane.read({ root: first.root, identity: lastIdentity }), ['ok', 'view']); const latest = readRoot(initial); continuity(context, capture(latest.root)); const result = unwrap(lane.read({ root: latest.root, identity: lastIdentity }), ['ok', 'view']); if (lastIdentity.expiresAtMs <= Date.parse(now())) fail('access_denied'); check(); return Object.freeze({ ok: true, view: result.view });
      }
      const resolving = kind === 'resolve', proposal = unwrap((resolving ? core.resolve : core.execute)({ root: first.root, identity: lastIdentity, command: parsed.command }), resolving ? ['ok', 'receipt'] : ['ok', 'next', 'receipt']), proposedReceipt = receipt(proposal, parsed.command);
      if (resolving || proposedReceipt.replayed) return confirm(initial, context, parsed.command, true);
      check(); writeAttempted = true; const ack = transport.compareAndSwap({ expectedETag: first.etag, next: proposal.next });
      if (plain(ack) && Reflect.ownKeys(ack).length === 2 && ack.ok === false && ack.error === 'conflict') { exact(ack, ['ok', 'error']); writeAttempted = false; fail('conflict'); }
      unwrap(ack, ['ok', 'storageAcknowledged', 'etag']); if (ack.storageAcknowledged !== true || !lastIdentity || !same(initial, { ...lastIdentity, verifiedAt: initial.verifiedAt })) fail('result_unknown'); check(); return confirm(initial, context, parsed.command, false);
    } catch (e) { const code = e instanceof RuntimeError && ERRORS.has(e.code) ? e.code : 'unavailable'; return rejected(writeAttempted ? 'result_unknown' : code); }
    finally { currentToken = ''; lastIdentity = null; verificationFailure = null; if (parsed) parsed.token = ''; parsed = null; busy = false; }
  }
  return Object.freeze({ read: function(raw) { return run(raw, 'read', arguments.length); }, readFinance: function(raw) { return run(raw, 'readFinance', arguments.length); }, execute: function(raw) { return run(raw, 'execute', arguments.length); }, resolve: function(raw) { return run(raw, 'resolve', arguments.length); } });
}
module.exports = Object.freeze({ createAppsScriptLegacyLifecycleRuntime, DEFAULT_CONFIGURATION });
