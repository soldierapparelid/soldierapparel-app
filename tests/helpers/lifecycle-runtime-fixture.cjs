'use strict';
const assert = require('node:assert/strict'), Crypto = require('node:crypto');
const Runtime = require('../../server/apps-script/legacy-lifecycle-runtime.cjs');
const State = require('../../server/production-identity-state.cjs');
const { fixture: production, POLICY } = require('../fixtures/legacy-lifecycle.cjs');
const F = require('../fixtures/identity-tenant.cjs');
const KEY = 'SYNTHETIC_PUBLIC_KEY_0000000000000', OAUTH = 'SYNTHETIC_MANAGED_OAUTH';
const encode = v => Buffer.from(JSON.stringify(v)).toString('base64url');
function createLifecycleRuntimeFixture(division = 'qc') {
  const f = production(), who = division === 'owner' ? F.identity({ uid: 'owner-1', email: 'syntheticowner@gmail.com', googleSubject: '1000099999999' }) : division === 'qc' ? f.qc : f.partner, stats = { google: 0, reads: 0, puts: 0, writes: 0, oauth: 0, budget: 0 }, hooks = {}, sec = Date.parse(F.NOW) / 1000;
  const payload = { sub: who.uid, aud: F.PROJECT, iss: 'https://securetoken.google.com/' + F.PROJECT, email: who.email, email_verified: true, firebase: { sign_in_provider: 'google.com', identities: { 'google.com': [who.googleSubject] } }, auth_time: sec - 1, iat: sec - 1, exp: sec + 3600 };
  const account = { localId: who.uid, email: who.email, emailVerified: true, disabled: false, validSince: String(sec - 300), providerUserInfo: [{ providerId: 'google.com', rawId: who.googleSubject, email: who.email }] };
  let root = F.copy(f.root), time = F.NOW;
  const token = () => encode({ alg: 'RS256', kid: 'synthetic-key', typ: 'JWT' }) + '.' + encode(payload) + '.' + Buffer.alloc(256, 19).toString('base64url');
  const etag = () => Crypto.createHash('sha1').update(JSON.stringify(root)).digest('base64');
  const response = (code = 200, body = JSON.stringify(root), headers = { 'Content-Type': 'application/json', ETag: etag() }) => ({ getResponseCode: () => code, getAllHeaders: () => headers, getContent: () => Array.from(Buffer.from(body), v => v > 127 ? v - 256 : v) });
  const host = { fetch(url, args) {
    if (url === 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + KEY) { stats.google++; assert.equal(JSON.parse(args.payload).idToken, token()); if (hooks.google) hooks.google(stats.google); return response(200, JSON.stringify({ users: [account] }), { 'Content-Type': 'application/json' }); }
    assert.equal(url, F.URL + '/.json'); assert.equal(args.headers.Authorization, 'Bearer ' + OAUTH);
    if (args.method === 'get') { stats.reads++; if (hooks.read) hooks.read(stats.reads); return response(); }
    assert.equal(args.method, 'put'); stats.puts++; if (hooks.beforePut) hooks.beforePut(); if (args.headers['If-Match'] !== etag()) return response(412, '{}'); root = JSON.parse(args.payload); stats.writes++; if (hooks.afterPut) hooks.afterPut(); return response();
  } };
  const script = { getOAuthToken() { stats.oauth++; return OAUTH; } };
  const options = { enabled: true, binding: { ...f.binding, apiKey: KEY }, urlFetchApp: host, scriptApp: script, clock: () => time, tariffPolicy: POLICY, requestAdmission(q) { stats.budget++; return hooks.budget ? hooks.budget(q) : true; }, identityAdmission(q) { return hooks.identity ? hooks.identity(q) : true; } };
  const create = () => Runtime.createAppsScriptLegacyLifecycleRuntime(options), readInput = () => ({ idToken: token() });
  let sequence = 0;
  const command = (kind, operationId, extra = {}) => { const api = create(), r = (division === 'owner' ? api.readOwner : api.read)(readInput()); assert.equal(r.ok, true, JSON.stringify(r)); return { kind, requestId: 'native-request-' + (++sequence), operationId, productId: 'product-1', expectedGrantRevision: 1, expectedSourceVersion: r.view.products[0].sourceVersion, ...extra }; };
  const input = cmd => ({ idToken: token(), command: cmd });
  return { f, who, stats, hooks, payload, account, host, script, options, create, readInput, command, input, get root() { return root; }, set root(v) { root = F.copy(v); }, setTime(v) { time = v; } };
}
function count(f, quantity = 8, operationId = 'count-1', workerId = 'worker-1') { const cmd = f.command('appendCount', operationId, { workerId, quantity, workDate: '2026-10-06' }); const result = f.create().execute(f.input(cmd)); assert.equal(result.ok, true, JSON.stringify(result)); return cmd; }
module.exports=Object.freeze({createLifecycleRuntimeFixture,KEY,OAUTH});
