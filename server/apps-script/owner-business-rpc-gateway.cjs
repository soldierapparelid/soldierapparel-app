'use strict';
// SOURCE OFF. Fixed owner business route. Authentication and retained-owner
// authority remain in the runtime; no browser role or arbitrary root selector.
const Codec = require('../../owner-business-storage-codec.js');
const DEFAULT_CONFIGURATION = Object.freeze({ enabled: false, binding: Object.freeze({ projectId: '', databaseURL: '', tenantId: '' }) });
const METHODS = ['readBusiness', 'executeOwnerBusiness', 'resolveOwnerBusiness'];
const LEGACY_METHODS = ['read', 'readFinance', 'execute', 'resolve', 'readOwner', 'executeOwner', 'resolveOwner'];
const CODES = new Set(['service_disabled', 'invalid_request', 'access_denied', 'unavailable', 'not_ready', 'conflict', 'capacity_limit', 'result_unknown', 'rate_limited', 'busy']);
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const fail = () => { throw Error('owner_business_rpc_unavailable'); };
const deny = error => Object.freeze(error === 'result_unknown' ? { ok: false, error, retrySameCommand: true } : { ok: false, error });
function field(v, k) { const d = v && typeof v === 'object' ? Object.getOwnPropertyDescriptor(v, k) : null; if (!d?.enumerable || !Object.hasOwn(d, 'value')) fail(); return d.value; }
function exact(v, keys) { if (!plain(v) || Reflect.ownKeys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) fail(); for (const k of keys) field(v, k); }
function createAppsScriptOwnerBusinessRpcGateway(options = {}) {
  let enabled = false; try { const d = plain(options) && Object.getOwnPropertyDescriptor(options, 'enabled'); enabled = !!d && Object.hasOwn(d, 'value') && d.value === true; } catch {}
  const disabled = error => Object.freeze({ dispatch: () => deny(error), dispatchJson: () => JSON.stringify(deny(error)) });
  if (!enabled) return disabled('service_disabled');
  let binding, runtime, methods, keys, busy = false, drift = false;
  function check() { if (drift) fail(); try { exact(runtime, keys); for (const k of keys) if (field(runtime, k) !== methods[k]) fail(); } catch { drift = true; fail(); } }
  try {
    exact(options, ['enabled', 'binding', 'runtime']); const b = field(options, 'binding'); exact(b, ['projectId', 'databaseURL', 'tenantId']); binding = Object.freeze({ ...b });
    Codec.normalizeOwnerBusinessBinding({ ...binding, uid: 'binding-probe', workerId: null, division: 'owner', grantRevision: 1 });
    runtime = field(options, 'runtime'); keys = Object.hasOwn(runtime, 'read') ? LEGACY_METHODS.concat(METHODS) : METHODS; exact(runtime, keys);
    methods = {}; for (const k of keys) { methods[k] = field(runtime, k); if (typeof methods[k] !== 'function') fail(); } Object.freeze(methods); check();
  } catch { return disabled('unavailable'); }
  function response(raw, kind, command) {
    if (plain(raw) && Object.hasOwn(raw, 'error')) {
      const code = field(raw, 'error'); if (!CODES.has(code) || code === 'result_unknown' && kind === 'read') fail();
      exact(raw, code === 'result_unknown' ? ['ok', 'error', 'retrySameCommand'] : ['ok', 'error']);
      if (raw.ok !== false || code === 'result_unknown' && raw.retrySameCommand !== true) fail(); return deny(code);
    }
    if (kind !== 'read') {
      if (!plain(raw) || !Object.hasOwn(raw, 'view')) return Codec.normalizeOwnerBusinessReceipt(raw, command);
      exact(raw, ['ok', 'replayed', 'requestId', 'view']); const view = field(raw, 'view'), b = field(view, 'binding');
      for (const k of ['projectId', 'databaseURL', 'tenantId']) if (field(b, k) !== binding[k]) fail();
      const receipt = Codec.normalizeOwnerBusinessReceipt({ ok: field(raw, 'ok'), replayed: field(raw, 'replayed'), requestId: field(raw, 'requestId') }, command);
      return Object.freeze({ ...receipt, view: Codec.normalizeOwnerBusinessView(view, b) });
    }
    exact(raw, ['ok', 'view']); if (raw.ok !== true) fail(); const view = field(raw, 'view'), b = field(view, 'binding');
    for (const k of ['projectId', 'databaseURL', 'tenantId']) if (field(b, k) !== binding[k]) fail();
    return Object.freeze({ ok: true, view: Codec.normalizeOwnerBusinessView(view, b) });
  }
  function dispatch(raw) {
    if (busy) return deny('busy'); busy = true; let request = null, kind = null, command = null, called = false;
    try {
      if (arguments.length !== 1) return deny('invalid_request');
      try {
        kind = field(raw, 'kind'); if (!['read', 'execute', 'resolve'].includes(kind)) fail(); const writing = kind !== 'read';
        exact(raw, writing ? ['kind', 'idToken', 'command'] : ['kind', 'idToken']); const token = field(raw, 'idToken');
        if (typeof token !== 'string' || !token || token.length > 16384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) fail();
        command = writing ? Codec.normalizeOwnerBusinessCommand(field(raw, 'command')) : null; request = writing ? { idToken: token, command } : { idToken: token };
      } catch { return deny('invalid_request'); }
      check(); called = true; const name = { read: 'readBusiness', execute: 'executeOwnerBusiness', resolve: 'resolveOwnerBusiness' }[kind];
      const result = methods[name].call(runtime, request); check(); return response(result, kind, command);
    } catch { return deny(called && kind !== 'read' ? 'result_unknown' : 'unavailable'); }
    finally { if (request) request.idToken = ''; request = null; command = null; busy = false; }
  }
  return Object.freeze({ dispatch, dispatchJson: function(raw) {
    if (arguments.length !== 1) return JSON.stringify(deny('invalid_request'));
    let request = null;
    try { request = typeof raw === 'string' ? Codec.parseOwnerBusinessJSON(raw) : raw; return JSON.stringify(dispatch(request)); }
    catch { return JSON.stringify(deny('invalid_request')); }
    finally { if (request && typeof request === 'object' && Object.hasOwn(request, 'idToken')) try { request.idToken = ''; } catch {} request = null; }
  } });
}
module.exports = Object.freeze({ createAppsScriptOwnerBusinessRpcGateway, DEFAULT_CONFIGURATION });
