(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SoldierProductionOwnerTariffClient = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  // Separate owner tariff journal. Never reads the operational journal or
  // legacy storage. Retained receipts prevent accepted request ID reuse.
  // The injected journal stores only this envelope in an account/grant scope:
  // read() -> null|string; write(nextRaw, previousRaw) -> durable CAS boolean.
  // Retention always requires lookup(requestId) and
  // acknowledge(nextRaw, previousRaw, acceptedRaw), with atomic archive checks
  // and quota reservation in BOTH write methods. No archive deletion API.
  // No token storage, legacy adoption, ID generation, automatic retry or payment.
  var MAX_BODY = 32768, MAX_RESPONSE = 4096, MAX_JOURNAL = 262144, MAX_ACCEPTED = MAX_BODY + 2048, MAX_ENTRIES = 64;
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
    try { var u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.search && !u.hash && u.href === v && u.pathname === '/v1/production/owner/tariffs/append'; } catch (_) { return false; }
  }
  function scopeValid(v) { return exact(v, scopeFields) && typeof v.projectId === 'string' && /^[a-z][a-z0-9-]{5,62}$/.test(v.projectId) && databaseURL(v.databaseURL) && safeId(v.tenantId) && safeId(v.uid) && integer(v.grantRevision, false); }
  function equalScope(a, b) { return scopeValid(a) && scopeValid(b) && scopeFields.every(function (k) { return a[k] === b[k]; }); }
  function commandValid(c) {
    return exact(c, ['kind', 'requestId', 'productId', 'cycleId', 'expectedConfigRevision', 'expectedTariffRevision', 'workerId', 'tariffVersion', 'effectiveAt', 'currency', 'rate']) && c.kind === 'appendTariffVersion' && ['requestId', 'productId', 'cycleId', 'workerId', 'tariffVersion'].every(function (k) { return safeId(c[k]); }) && integer(c.expectedConfigRevision, false) && integer(c.expectedTariffRevision, false) && instant(c.effectiveAt) && c.currency === 'IDR' && integer(c.rate, true);
  }
  function freeze(v) { if (v && typeof v === 'object') { Object.keys(v).forEach(function (k) { freeze(v[k]); }); Object.freeze(v); } return v; }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function canonical(v) { if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'; if (object(v)) return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canonical(v[k]); }).join(',') + '}'; return JSON.stringify(v); }
  function bytes(v) { return new TextEncoder().encode(v).length; }
  function receiptValid(v, command) { return exact(v, ['requestId', 'kind', 'productId', 'cycleId', 'workerId', 'tariffVersion', 'revision', 'acceptedAt']) && commandValid(command) && ['requestId', 'kind', 'productId', 'cycleId', 'workerId', 'tariffVersion'].every(function(k) { return v[k] === command[k]; }) && v.revision === command.expectedTariffRevision + 1 && integer(v.revision, true) && instant(v.acceptedAt) && v.acceptedAt <= command.effectiveAt; }
  function viewValid(v, targetScope, selection) {
    if (!exact(v, ['schemaVersion','projectId','tenantId','uid','grantRevision','productId','cycleId','configRevision','tariffRevision','serverTime','policy','workers']) || v.schemaVersion !== 1 || ['projectId','tenantId','uid','grantRevision'].some(function(k) { return v[k] !== targetScope[k]; }) || v.productId !== selection.productId || v.cycleId !== selection.cycleId || !integer(v.configRevision, false) || !integer(v.tariffRevision, false) || !instant(v.serverTime) || !exact(v.policy, ['version','kind','hour','minute']) || !safeId(v.policy.version) || v.policy.kind !== 'jakarta-fixed-local-time' || !integer(v.policy.hour, false) || v.policy.hour > 23 || !integer(v.policy.minute, false) || v.policy.minute > 59 || !array(v.workers,128)) return false;
    var ids = new Set(), total = 0;
    return v.workers.every(function(w) {
      if (!exact(w, ['workerId','label','assignedQuantity','history']) || !safeId(w.workerId) || ids.has(w.workerId) || typeof w.label !== 'string' || !w.label.trim() || w.label.length > 256 || /[\u0000-\u001f\u007f-\u009f]/.test(w.label) || !integer(w.assignedQuantity,true) || !array(w.history,512) || !w.history.length) return false;
      ids.add(w.workerId); var versions = new Set(), previous = '';
      return w.history.every(function(h) { if (++total > 512 || !exact(h,['tariffVersion','effectiveAt','currency','rate']) || !safeId(h.tariffVersion) || versions.has(h.tariffVersion) || !instant(h.effectiveAt) || h.effectiveAt <= previous || h.currency !== 'IDR' || !integer(h.rate,true) || !Number.isSafeInteger(h.rate*w.assignedQuantity)) return false; versions.add(h.tariffVersion); previous=h.effectiveAt; return true; });
    });
  }
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
  // Pure validators for the trusted store's atomic transitions. No SDK/storage
  // access, implicit scope lookup or rejected-value/error-detail exposure.
  function decodeJournal(raw, targetScope, targetEndpoint) {
    try {
      if (!scopeValid(targetScope) || !endpointURL(targetEndpoint)) throw null;
      if (raw === null) return freeze({ schemaVersion: 1, scope: clone(targetScope), endpointURL: targetEndpoint, entries: [] });
      var v = parse(raw, MAX_JOURNAL), seen = new Set();
      if (!exact(v, ['schemaVersion', 'scope', 'endpointURL', 'entries']) || v.schemaVersion !== 1 || !equalScope(v.scope, targetScope) || v.endpointURL !== targetEndpoint || !array(v.entries, MAX_ENTRIES)) throw null;
      v.entries.forEach(function (e) {
        if (!exact(e, ['command', 'receipt']) || !commandValid(e.command) || bytes(JSON.stringify({ command: e.command })) > MAX_BODY || seen.has(e.command.requestId) || e.receipt !== null && !receiptValid(e.receipt, e.command)) throw null;
        seen.add(e.command.requestId);
      });
      return freeze(v);
    } catch (_) { throw Error('invalid_journal'); }
  }
  function decodeAccepted(raw, targetScope, targetEndpoint, expectedRequestId) {
    try {
      if (!scopeValid(targetScope) || !endpointURL(targetEndpoint) || expectedRequestId !== undefined && !safeId(expectedRequestId)) throw null;
      var v = parse(raw, MAX_ACCEPTED);
      if (!exact(v, ['schemaVersion', 'scope', 'endpointURL', 'command', 'receipt']) || v.schemaVersion !== 1 || !equalScope(v.scope, targetScope) || v.endpointURL !== targetEndpoint || !commandValid(v.command) || bytes(JSON.stringify({ command: v.command })) > MAX_BODY || !receiptValid(v.receipt, v.command) || expectedRequestId !== undefined && v.command.requestId !== expectedRequestId) throw null;
      return freeze(v);
    } catch (_) { throw Error('invalid_journal'); }
  }
  function acceptedStorageBound(command, targetScope, targetEndpoint) {
    try {
      if (!scopeValid(targetScope) || !endpointURL(targetEndpoint) || !commandValid(command) || bytes(JSON.stringify({ command: command })) > MAX_BODY) throw null;
      return bytes(JSON.stringify({ schemaVersion: 1, scope: targetScope, endpointURL: targetEndpoint, command: command, receipt: { requestId: command.requestId, kind:command.kind,productId:command.productId,cycleId:command.cycleId,workerId:command.workerId,tariffVersion:command.tariffVersion,revision:Number.MAX_SAFE_INTEGER,acceptedAt:'9999-12-31T23:59:59.999Z' } }));
    } catch (_) { throw Error('invalid_journal'); }
  }
  function createClient(options) {
    var configured = false, enabled = false, manualDisabled = false, revoked = false, retaining = true, timeoutMs=15000, activeRequests=new Set(), scope, endpoint, viewEndpoint, journal, isCurrent, getIdToken, fetchRequest;
    try {
      if (!object(options)) options = {};
      var flag = Object.getOwnPropertyDescriptor(options, 'enabled'); enabled = !!(flag && Object.prototype.hasOwnProperty.call(flag, 'value') && flag.value === true);
      var keys=['enabled','scope','endpointURL','isCurrent','getIdToken','fetch','journal'];if(Object.prototype.hasOwnProperty.call(options,'requestTimeoutMs'))keys.push('requestTimeoutMs');
      if (enabled && exact(options, keys) && (keys.length===7||Number.isSafeInteger(options.requestTimeoutMs)&&options.requestTimeoutMs>=1&&options.requestTimeoutMs<=15000) && scopeValid(options.scope) && endpointURL(options.endpointURL) && ['isCurrent', 'getIdToken', 'fetch'].every(function (k) { return typeof options[k] === 'function'; }) && exact(options.journal, ['read', 'write', 'lookup', 'acknowledge']) && ['read','write','lookup','acknowledge'].every(function(k){return typeof options.journal[k]==='function';})) {
        scope = freeze(clone(options.scope)); endpoint = options.endpointURL; viewEndpoint = new URL('/v1/production/owner/tariffs/view',endpoint).href; journal = options.journal; isCurrent = options.isCurrent; getIdToken = options.getIdToken; fetchRequest = options.fetch; configured = true;
        if(keys.length===8)timeoutMs=options.requestTimeoutMs;
      }
    } catch (_) { configured = false; }
    var queue = Promise.resolve();
    function current() {
      if (manualDisabled || !enabled) fail('unavailable');
      if (revoked) fail('access_denied');
      var valid = false;
      try { valid = isCurrent() === true; } catch (_) { valid = false; }
      if (!valid) { revoked = true; fail('access_denied'); }
    }
    async function checked(fn) { current(); var result; try { result = await fn(); } catch (_) { current(); fail('unavailable'); } current(); return result; }
    function run(fn) {
      if (!enabled || manualDisabled) return Promise.resolve(outcome('service_disabled'));
      if (!configured) return Promise.resolve(outcome('unavailable'));
      var result = queue.then(async function () { try { current(); return await fn(); } catch (e) { if (manualDisabled) return outcome('service_disabled'); var code = Object.keys(sentinels).find(function (k) { return e === sentinels[k]; }); return outcome(code || 'unavailable'); } });
      queue = result.then(function () {}, function () {}); return result;
    }
    async function load() {
      var raw = await checked(function () { return journal.read(); });
      try { return { raw: raw, value: clone(decodeJournal(raw, scope, endpoint)) }; } catch (_) { fail('unavailable'); }
    }
    async function lookup(requestId) {
      if (!retaining) return null;
      var raw = await checked(function () { return journal.lookup(requestId); });
      if (raw === null) return null;
      try { return decodeAccepted(raw, scope, endpoint, requestId); } catch (_) { fail('unavailable'); }
    }
    function acceptedRaw(command, receipt) {
      var raw = JSON.stringify({ schemaVersion: 1, scope: scope, endpointURL: endpoint, command: command, receipt: receipt });
      try { decodeAccepted(raw, scope, endpoint, command.requestId); } catch (_) { fail('unavailable'); }
      return raw;
    }
    async function absentAfterArchive(doc, requestId) {
      if (doc.entries.some(function (e) { return e.command.requestId === requestId; })) {
        // A concurrent atomic acknowledgment may have completed after load().
        // A fresh snapshot must prove removal; an actual duplicate is held.
        var refreshed = await load();
        if (refreshed.value.entries.some(function (e) { return e.command.requestId === requestId; })) fail('unavailable');
      }
    }
    async function archivedPreparation(snapshot, doc) {
      var archived = await lookup(snapshot.requestId);
      if (!archived) return null;
      if (canonical(archived.command) !== canonical(snapshot)) fail('conflict');
      await absentAfterArchive(doc, snapshot.requestId);
      return freeze({ ok: true, requestId: snapshot.requestId, pending: false });
    }
    async function persist(change) {
      for (var attempt = 0; attempt < 3; attempt++) {
        var loaded = await load(), result = await change(loaded.value); current();
        if (!result.changed) { current(); return result.result; }
        var nextRaw = JSON.stringify(loaded.value);
        if (bytes(nextRaw) > MAX_JOURNAL) fail('capacity_limit');
        var written = await checked(function () { return result.acceptedRaw !== undefined ? journal.acknowledge(nextRaw, loaded.raw, result.acceptedRaw) : journal.write(nextRaw, loaded.raw); });
        if (written === true) return result.result;
        if (written === 'capacity_limit' && retaining) fail('capacity_limit');
        if (written !== false) fail('unavailable');
        // Known CAS contention only: reload and merge; never resend HTTP here.
      }
      fail('unavailable');
    }
    async function migrateAccepted() {
      if (!retaining) return;
      // Only already validated, exact-scope canonical v1 receipts are moved.
      // Pending/unknown commands and unrelated records are never dropped.
      for (var moved = 0; moved <= MAX_ENTRIES; moved++) {
        var finished = await persist(async function (doc) {
          var position = doc.entries.findIndex(function (e) { return e.receipt !== null; });
          if (position === -1) return { changed: false, result: true };
          var entry = doc.entries[position], archived = await lookup(entry.command.requestId);
          if (archived && (canonical(archived.command) !== canonical(entry.command) || canonical(archived.receipt) !== canonical(entry.receipt))) fail('conflict');
          var archivedRaw = acceptedRaw(entry.command, entry.receipt); doc.entries.splice(position, 1);
          return { changed: true, acceptedRaw: archivedRaw, result: false };
        });
        if (finished) return;
      }
      fail('unavailable');
    }
    function prepare(command) {
      var snapshot;
      try { if (!commandValid(command)) return run(function () { fail('invalid_request'); }); snapshot = freeze(clone(command)); if (bytes(JSON.stringify({ command: snapshot })) > MAX_BODY) return run(function () { fail('invalid_request'); }); } catch (_) { return run(function () { fail('invalid_request'); }); }
      return run(async function () {
        if (retaining) { var loaded = await load(), existing = await archivedPreparation(snapshot, loaded.value); if (existing) return existing; await migrateAccepted(); }
        return persist(async function (doc) {
        if (retaining) { var archived = await archivedPreparation(snapshot, doc); if (archived) return { changed: false, result: archived }; }
        var e = doc.entries.find(function (entry) { return entry.command.requestId === snapshot.requestId; });
        if (e) { if (canonical(e.command) !== canonical(snapshot)) fail('conflict'); return { changed: false, result: freeze({ ok: true, requestId: snapshot.requestId, pending: e.receipt === null }) }; }
        if (doc.entries.length >= MAX_ENTRIES) fail('capacity_limit');
        doc.entries.push({ command: clone(snapshot), receipt: null }); return { changed: true, result: freeze({ ok: true, requestId: snapshot.requestId, pending: true }) };
      }); });
    }
    async function responseBody(response, expectedEndpoint, maximum, networkCurrent) {
      if (!response || response.redirected !== false || response.url !== expectedEndpoint || ['basic', 'cors'].indexOf(response.type) === -1 || !Number.isInteger(response.status) || !response.headers || typeof response.headers.get !== 'function' || !response.body || typeof response.body.getReader !== 'function') throw null;
      var type = response.headers.get('content-type'), length = response.headers.get('content-length');
      if (typeof type !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type) || length !== null && (typeof length !== 'string' || !/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > maximum)) throw null;
      var reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true }), text = '', count = 0, chunks = 0, complete = false;
      try {
        while (true) {
          if (++chunks > maximum + 1) throw null;
          networkCurrent();var chunk = await checked(function () { return reader.read(); });networkCurrent();
          if (!chunk || typeof chunk.done !== 'boolean') throw null;
          if (chunk.done) { complete = true; break; }
          if (!(chunk.value instanceof Uint8Array)) throw null;
          count += chunk.value.byteLength; if (count > maximum) throw null;
          text += decoder.decode(chunk.value, { stream: true });
        }
        // Fetch can expose decoded content while Content-Length describes the
        // encoded wire body. Bound both independently; do not equate them.
        text += decoder.decode();
        return parse(text, maximum);
      } finally {
        if (!complete) { try { await reader.cancel(); } catch (_) {} }
        try { reader.releaseLock(); } catch (_) {}
      }
    }
    async function request(target,payload,maximum) {
      var alive=true,token=null,timer,abort=new AbortController(),rejectTimeout;
      var timed=new Promise(function(_,reject){rejectTimeout=reject;});
      function networkCurrent(){current();if(!alive)fail('unavailable');}
      function cancel(){if(!alive)return;alive=false;try{abort.abort();}catch(_){}rejectTimeout(sentinels.unavailable);}
      activeRequests.add(cancel);timer=setTimeout(cancel,timeoutMs);
      var work=(async function(){try{
        token=await checked(function(){return getIdToken();});networkCurrent();
        if(typeof token!=='string'||token.length>16384||! /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))fail('access_denied');
        var response=await fetchRequest(target,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(payload),mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:abort.signal});token=null;networkCurrent();
        var body=await responseBody(response,target,maximum,networkCurrent);networkCurrent();return {response:response,body:body};
      }finally{token=null;}
      })();
      try{return await Promise.race([work,timed]);}finally{alive=false;token=null;clearTimeout(timer);activeRequests.delete(cancel);try{abort.abort();}catch(_){} }
    }
    function send(requestId) {
      return run(async function () {
        if (!safeId(requestId)) fail('invalid_request');
        var loaded = await load(), entry = loaded.value.entries.find(function (e) { return e.command.requestId === requestId; });
        if (retaining) {
          var archived = await lookup(requestId);
          if (archived) { await absentAfterArchive(loaded.value, requestId); return freeze({ ok: true, receipt: clone(archived.receipt), replayed: true }); }
        }
        if (!entry) fail('invalid_request');
        if (entry.receipt !== null) return freeze({ ok: true, receipt: clone(entry.receipt), replayed: true });
        var snapshot = freeze(clone(entry.command));
        var response, body;
        try {
          var received=await request(endpoint,{command:snapshot},MAX_RESPONSE);response=received.response;body=received.body;current();
        } catch (e) { current();if(e===sentinels.access_denied)fail('access_denied');return outcome('result_unknown'); }
        if (response.status === 200 && exact(body, ['ok', 'receipt', 'replayed']) && body.ok === true && typeof body.replayed === 'boolean' && receiptValid(body.receipt, snapshot)) {
          var receipt = freeze(clone(body.receipt));
          return persist(async function (doc) {
            if (retaining) {
              var archived = await lookup(requestId);
              if (archived) {
                if (canonical(archived.command) !== canonical(snapshot) || canonical(archived.receipt) !== canonical(receipt)) fail('conflict');
                await absentAfterArchive(doc, requestId);
                return { changed: false, result: freeze({ ok: true, receipt: clone(archived.receipt), replayed: body.replayed }) };
              }
            }
            var e = doc.entries.find(function (row) { return row.command.requestId === requestId; });
            if (!e || canonical(e.command) !== canonical(snapshot) || e.receipt !== null && canonical(e.receipt) !== canonical(receipt)) fail('conflict');
            if (retaining) {
              doc.entries.splice(doc.entries.indexOf(e), 1);
              return { changed: true, acceptedRaw: acceptedRaw(snapshot, receipt), result: freeze({ ok: true, receipt: clone(receipt), replayed: body.replayed }) };
            }
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
    function view(selection) {
      var selected; try { if (!exact(selection,['productId','cycleId']) || !safeId(selection.productId) || !safeId(selection.cycleId)) return run(function(){fail('invalid_request');}); selected=freeze(clone(selection)); } catch(_){return run(function(){fail('invalid_request');});}
      return run(async function(){
        var response,body;
        try {var received=await request(viewEndpoint,{selection:selected},65536);response=received.response;body=received.body;current(); } catch(e){current();if(e===sentinels.access_denied)fail('access_denied');return freeze({ok:false,error:'unavailable'});}
        if(response.status===200&&exact(body,['ok','view'])&&body.ok===true&&viewValid(body.view,scope,selected))return freeze({ok:true,view:clone(body.view)});
        var errors={access_denied:403,invalid_request:400,conflict:409,not_ready:409,capacity_limit:409,rate_limited:429,service_disabled:503,unavailable:503,busy:503};
        if(exact(body,['ok','error'])&&body.ok===false&&Object.prototype.hasOwnProperty.call(errors,body.error)&&response.status===errors[body.error])return freeze({ok:false,error:body.error});
        return freeze({ok:false,error:'unavailable'});
      });
    }
    function pending() { return run(async function () { var loaded = await load(); current(); return freeze({ ok: true, commands: loaded.value.entries.filter(function (e) { return e.receipt === null; }).map(function (e) { return clone(e.command); }) }); }); }
    function dispose() { manualDisabled = true;activeRequests.forEach(function(cancel){cancel();}); }
    return Object.freeze({ view:view, prepare: prepare, send: send, pending: pending, dispose: dispose });
  }
  return Object.freeze({ createClient: createClient, decodeJournal: decodeJournal, decodeAccepted: decodeAccepted, acceptedStorageBound: acceptedStorageBound, validateCommand:commandValid,validateView:viewValid,validateScope:scopeValid });
});
