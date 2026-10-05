(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SoldierProductionCommandClient = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  // Disabled unless explicitly configured from a trusted canonical session.
  // The injected journal stores only this envelope in an account/grant scope:
  // read() -> null|string; write(nextRaw, previousRaw) -> durable CAS boolean.
  // No storage discovery, legacy adoption, ID generation, HTTP retry or payment.
  var MAX_BODY = 32768, MAX_RESPONSE = 4096, MAX_JOURNAL = 262144, MAX_ENTRIES = 64;
  var scopeFields = ['projectId', 'databaseURL', 'tenantId', 'uid', 'grantRevision'];
  var forbidden = ['__proto__', 'constructor', 'prototype'];
  var sentinels = Object.create(null);
  ['invalid_request', 'access_denied', 'conflict', 'capacity_limit', 'unavailable'].forEach(function (code) { sentinels[code] = Object.freeze({ code: code }); });
  function fail(code) { throw sentinels[code]; }
  function object(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].indexOf(Object.getPrototypeOf(v)) !== -1; }
  function exact(v, keys) {
    if (!object(v)) return false;
    var own = Reflect.ownKeys(v);
    return own.length === keys.length && own.every(function (k) {
      var d = Object.getOwnPropertyDescriptor(v, k);
      return typeof k === 'string' && keys.indexOf(k) !== -1 && d && d.enumerable && Object.prototype.hasOwnProperty.call(d, 'value');
    });
  }
  function array(v, max) {
    if (!Array.isArray(v) || Object.getPrototypeOf(v) !== Array.prototype || v.length > max) return false;
    var keys = Reflect.ownKeys(v);
    if (keys.length !== v.length + 1) return false;
    return keys.every(function (k) {
      if (k === 'length') return true;
      var d = Object.getOwnPropertyDescriptor(v, k);
      return typeof k === 'string' && /^(0|[1-9][0-9]*)$/.test(k) && Number(k) < v.length && d && d.enumerable && Object.prototype.hasOwnProperty.call(d, 'value');
    });
  }
  function safeId(v) { return typeof v === 'string' && v.length > 0 && v.length <= 128 && /^[A-Za-z0-9_-]+$/.test(v) && forbidden.indexOf(v) === -1; }
  function integer(v, positive) { return Number.isSafeInteger(v) && v >= (positive ? 1 : 0); }
  function date(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v; }
  function instant(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v; }
  function databaseURL(v) {
    if (typeof v !== 'string' || v.length > 256) return false;
    try { var u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password && !u.port && u.origin === v && /^[a-z0-9-]+(?:\.[a-z0-9-]+)?\.(firebaseio\.com|firebasedatabase\.app)$/.test(u.hostname); } catch (_) { return false; }
  }
  function endpointURL(v) {
    if (typeof v !== 'string' || v.length > 512) return false;
    try { var u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.search && !u.hash && u.href === v && /^\/[A-Za-z0-9/_-]+$/.test(u.pathname) && u.pathname.endsWith('/v1/production/commands'); } catch (_) { return false; }
  }
  function scopeValid(v) { return exact(v, scopeFields) && typeof v.projectId === 'string' && /^[a-z][a-z0-9-]{5,62}$/.test(v.projectId) && databaseURL(v.databaseURL) && safeId(v.tenantId) && safeId(v.uid) && integer(v.grantRevision, false); }
  function equalScope(a, b) { return scopeValid(a) && scopeValid(b) && scopeFields.every(function (k) { return a[k] === b[k]; }); }
  function commandValid(c) {
    if (!exact(c, ['requestId', 'productId', 'cycleId', 'expectedRevision', 'kind', 'payload']) || !safeId(c.requestId) || !safeId(c.productId) || !safeId(c.cycleId) || !integer(c.expectedRevision, false)) return false;
    var p = c.payload;
    if (c.kind === 'sewing') return exact(p, ['id', 'assignmentId', 'tanggal', 'good', 'reject']) && safeId(p.id) && safeId(p.assignmentId) && date(p.tanggal) && integer(p.good, false) && integer(p.reject, false) && integer(p.good + p.reject, true);
    if (c.kind === 'count') return exact(p, ['id', 'assignmentId', 'tanggal', 'jumlah']) && safeId(p.id) && safeId(p.assignmentId) && date(p.tanggal) && integer(p.jumlah, true);
    if (c.kind === 'repair') return exact(p, ['id', 'qcId', 'tanggal', 'jumlah']) && safeId(p.id) && safeId(p.qcId) && date(p.tanggal) && integer(p.jumlah, true);
    if (c.kind === 'cancel') return exact(p, ['targetType', 'targetId']) && ['sewing', 'count', 'inspect', 'repair'].indexOf(p.targetType) !== -1 && safeId(p.targetId);
    if (c.kind === 'inspect') return exact(p, ['batchId', 'entries']) && safeId(p.batchId) && array(p.entries, 100) && p.entries.length > 0 && p.entries.every(function (e) { return exact(e, ['id', 'hfId', 'tanggal', 'ok', 'perbaikan', 'reject', 'offline']) && safeId(e.id) && safeId(e.hfId) && date(e.tanggal) && ['ok', 'perbaikan', 'reject', 'offline'].every(function (k) { return integer(e[k], false); }); });
    return false;
  }
  function freeze(v) { if (v && typeof v === 'object') { Object.keys(v).forEach(function (k) { freeze(v[k]); }); Object.freeze(v); } return v; }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function canonical(v) { if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'; if (object(v)) return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canonical(v[k]); }).join(',') + '}'; return JSON.stringify(v); }
  function bytes(v) { return new TextEncoder().encode(v).length; }
  function receiptValid(v, id) { return exact(v, ['requestId', 'revision', 'acceptedAt']) && v.requestId === id && safeId(v.requestId) && integer(v.revision, true) && instant(v.acceptedAt); }
  function outcome(code) { var v = { ok: false, error: code }; if (code === 'unavailable' || code === 'result_unknown' || code === 'busy') v.retrySameCommand = true; return freeze(v); }
  function parse(raw, limit) {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > limit || bytes(raw) > limit) fail('unavailable');
    var v = JSON.parse(raw), stack = [];
    // Reject escaped duplicate keys too; JSON.parse alone would retain only one.
    for (var i = 0; i < raw.length; i++) {
      var c = raw[i];
      if (c === '"') {
        var end = i + 1;
        for (; end < raw.length; end++) { if (raw[end] === '\\') { end++; continue; } if (raw[end] === '"') break; }
        var top = stack[stack.length - 1];
        if (top && top.type === 'object' && top.key) { var name = JSON.parse(raw.slice(i, end + 1)); if (top.keys.has(name) || forbidden.indexOf(name) !== -1) fail('unavailable'); top.keys.add(name); top.key = false; }
        i = end;
      } else if (c === '{' || c === '[') { stack.push(c === '{' ? { type: 'object', key: true, keys: new Set() } : { type: 'array' }); if (stack.length > 16) fail('unavailable'); }
      else if (c === '}' || c === ']') stack.pop();
      else if (c === ',' && stack.length && stack[stack.length - 1].type === 'object') stack[stack.length - 1].key = true;
    }
    return v;
  }
  function createClient(options) {
    var configured = false, enabled = false, manualDisabled = false, revoked = false, scope, endpoint, journal, getSession, isCurrent, getIdToken, fetchRequest;
    try {
      if (!object(options)) options = {};
      var flag = Object.getOwnPropertyDescriptor(options, 'enabled'); enabled = !!(flag && Object.prototype.hasOwnProperty.call(flag, 'value') && flag.value === true);
      if (enabled && exact(options, ['enabled', 'scope', 'endpointURL', 'getSession', 'isCurrent', 'getIdToken', 'fetch', 'journal']) && scopeValid(options.scope) && endpointURL(options.endpointURL) && ['getSession', 'isCurrent', 'getIdToken', 'fetch'].every(function (k) { return typeof options[k] === 'function'; }) && exact(options.journal, ['read', 'write']) && typeof options.journal.read === 'function' && typeof options.journal.write === 'function') {
        scope = freeze(clone(options.scope)); endpoint = options.endpointURL; journal = options.journal; getSession = options.getSession; isCurrent = options.isCurrent; getIdToken = options.getIdToken; fetchRequest = options.fetch; configured = true;
      }
    } catch (_) { configured = false; }
    var queue = Promise.resolve();
    function current() {
      if (manualDisabled || !enabled) fail('unavailable');
      if (revoked) fail('access_denied');
      var valid = false;
      try { valid = isCurrent() === true && equalScope(getSession(), scope); } catch (_) { valid = false; }
      if (!valid) { revoked = true; fail('access_denied'); }
    }
    async function checked(fn) { current(); var result; try { result = await fn(); } catch (_) { current(); fail('unavailable'); } current(); return result; }
    function run(fn) {
      if (!enabled || manualDisabled) return Promise.resolve(outcome('service_disabled'));
      if (!configured) return Promise.resolve(outcome('unavailable'));
      var result = queue.then(async function () { try { current(); return await fn(); } catch (e) { if (manualDisabled) return outcome('service_disabled'); var code = Object.keys(sentinels).find(function (k) { return e === sentinels[k]; }); return outcome(code || 'unavailable'); } });
      queue = result.then(function () {}, function () {}); return result;
    }
    function empty() { return { schemaVersion: 1, scope: clone(scope), endpointURL: endpoint, entries: [] }; }
    async function load() {
      var raw = await checked(function () { return journal.read(); });
      if (raw === null) return { raw: null, value: empty() };
      var v;
      try {
        v = parse(raw, MAX_JOURNAL);
        if (!exact(v, ['schemaVersion', 'scope', 'endpointURL', 'entries']) || v.schemaVersion !== 1 || !equalScope(v.scope, scope) || v.endpointURL !== endpoint || !array(v.entries, MAX_ENTRIES)) fail('unavailable');
        var seen = new Set();
        v.entries.forEach(function (e) {
          if (!exact(e, ['command', 'receipt']) || !commandValid(e.command) || bytes(JSON.stringify({ command: e.command })) > MAX_BODY || seen.has(e.command.requestId) || e.receipt !== null && !receiptValid(e.receipt, e.command.requestId)) fail('unavailable');
          seen.add(e.command.requestId);
        });
      } catch (_) { fail('unavailable'); }
      return { raw: raw, value: v };
    }
    async function persist(change) {
      for (var attempt = 0; attempt < 3; attempt++) {
        var loaded = await load(), result = change(loaded.value);
        if (!result.changed) { current(); return result.result; }
        var nextRaw = JSON.stringify(loaded.value);
        if (bytes(nextRaw) > MAX_JOURNAL) fail('capacity_limit');
        var written = await checked(function () { return journal.write(nextRaw, loaded.raw); });
        if (written === true) return result.result;
        if (written !== false) fail('unavailable');
        // Known CAS contention only: reload and merge; never resend HTTP here.
      }
      fail('unavailable');
    }
    function prepare(command) {
      var snapshot;
      try { if (!commandValid(command)) return run(function () { fail('invalid_request'); }); snapshot = freeze(clone(command)); if (bytes(JSON.stringify({ command: snapshot })) > MAX_BODY) return run(function () { fail('invalid_request'); }); } catch (_) { return run(function () { fail('invalid_request'); }); }
      return run(function () { return persist(function (doc) {
        var e = doc.entries.find(function (entry) { return entry.command.requestId === snapshot.requestId; });
        if (e) { if (canonical(e.command) !== canonical(snapshot)) fail('conflict'); return { changed: false, result: freeze({ ok: true, requestId: snapshot.requestId, pending: e.receipt === null }) }; }
        if (doc.entries.length >= MAX_ENTRIES) fail('capacity_limit');
        doc.entries.push({ command: clone(snapshot), receipt: null }); return { changed: true, result: freeze({ ok: true, requestId: snapshot.requestId, pending: true }) };
      }); });
    }
    async function responseBody(response) {
      if (!response || response.redirected !== false || response.url !== endpoint || ['basic', 'cors'].indexOf(response.type) === -1 || !Number.isInteger(response.status) || !response.headers || typeof response.headers.get !== 'function' || !response.body || typeof response.body.getReader !== 'function') throw null;
      var type = response.headers.get('content-type'), length = response.headers.get('content-length');
      if (typeof type !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type) || length !== null && (typeof length !== 'string' || !/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > MAX_RESPONSE)) throw null;
      var reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true }), text = '', count = 0, chunks = 0, complete = false;
      try {
        while (true) {
          if (++chunks > MAX_RESPONSE + 1) throw null;
          var chunk = await checked(function () { return reader.read(); });
          if (!chunk || typeof chunk.done !== 'boolean') throw null;
          if (chunk.done) { complete = true; break; }
          if (!(chunk.value instanceof Uint8Array)) throw null;
          count += chunk.value.byteLength; if (count > MAX_RESPONSE) throw null;
          text += decoder.decode(chunk.value, { stream: true });
        }
        // Fetch can expose decoded content while Content-Length describes the
        // encoded wire body. Bound both independently; do not equate them.
        text += decoder.decode();
        return parse(text, MAX_RESPONSE);
      } finally {
        if (!complete) { try { await reader.cancel(); } catch (_) {} }
        try { reader.releaseLock(); } catch (_) {}
      }
    }
    function send(requestId) {
      return run(async function () {
        if (!safeId(requestId)) fail('invalid_request');
        var loaded = await load(), entry = loaded.value.entries.find(function (e) { return e.command.requestId === requestId; });
        if (!entry) fail('invalid_request');
        if (entry.receipt !== null) return freeze({ ok: true, receipt: clone(entry.receipt), replayed: true });
        var snapshot = freeze(clone(entry.command)), rawBody = JSON.stringify({ command: snapshot }), token;
        token = await checked(function () { return getIdToken(); });
        if (typeof token !== 'string' || token.length > 16384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) fail('access_denied');
        var response, body;
        try {
          current(); response = await fetchRequest(endpoint, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: rawBody, mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' }); token = null; current(); body = await responseBody(response); current();
        } catch (_) { token = null; current(); return outcome('result_unknown'); }
        if (response.status === 200 && exact(body, ['ok', 'receipt', 'replayed']) && body.ok === true && typeof body.replayed === 'boolean' && receiptValid(body.receipt, requestId)) {
          var receipt = freeze(clone(body.receipt));
          return persist(function (doc) {
            var e = doc.entries.find(function (row) { return row.command.requestId === requestId; });
            if (!e || canonical(e.command) !== canonical(snapshot) || e.receipt !== null && canonical(e.receipt) !== canonical(receipt)) fail('conflict');
            var changed = e.receipt === null; if (changed) e.receipt = clone(receipt);
            return { changed: changed, result: freeze({ ok: true, receipt: clone(receipt), replayed: body.replayed }) };
          });
        }
        var errors = { access_denied: 403, invalid_request: 400, conflict: 409, not_ready: 409, capacity_limit: 409, rate_limited: 429, service_disabled: 503, unavailable: 503, busy: 503, result_unknown: 503 };
        if (object(body) && typeof body.error === 'string' && Object.prototype.hasOwnProperty.call(errors, body.error) && response.status === errors[body.error] && body.ok === false) {
          var uncertain = ['unavailable', 'busy', 'result_unknown'].indexOf(body.error) !== -1;
          if (exact(body, uncertain ? ['ok', 'error', 'retrySameCommand'] : ['ok', 'error']) && (!uncertain || body.retrySameCommand === true)) return outcome(body.error);
        }
        return outcome('result_unknown');
      });
    }
    function pending() { return run(async function () { var loaded = await load(); current(); return freeze({ ok: true, commands: loaded.value.entries.filter(function (e) { return e.receipt === null; }).map(function (e) { return clone(e.command); }) }); }); }
    function disable() { manualDisabled = true; }
    return Object.freeze({ prepare: prepare, send: send, pending: pending, disable: disable });
  }
  return Object.freeze({ createClient: createClient });
});
