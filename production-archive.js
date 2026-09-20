(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProductionArchive = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var fields = ['potong', 'assignJahit', 'jahit', 'hitungFisik', 'qc', 'gudang', 'bigSaller', 'bayarJahit'];
  function object(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function yes(value) { return value === true || value === 1 || value === 'true'; }
  function no(value) { return value === false || value === 0 || value === 'false'; }
  function ignored(row) {
    var status = String(row.status || '').trim().toLowerCase();
    return yes(row.deleted) || yes(row.isDeleted) || !!row.deletedAt ||
      yes(row.cancelled) || yes(row.canceled) || !!row.cancelledAt || !!row.canceledAt ||
      /^(deleted|cancelled|canceled|dihapus|dibatalkan|batal)$/.test(status);
  }
  function list(value, field, state) {
    // Legacy QC stores bigSaller as an activation flag, not a stock row.
    if (value == null || (field === 'bigSaller' && typeof value === 'boolean')) return [];
    var source = Array.isArray(value) ? value : object(value) ? Object.values(value) : null;
    if (!source) { state.malformed = true; return []; }
    return source.filter(function (row) {
      if (row == null) return false; // Firebase array holes are not records.
      if (!object(row)) { state.malformed = true; return false; }
      return !ignored(row);
    });
  }
  function stableId(row) {
    if (typeof row.id === 'number' && Number.isFinite(row.id)) return 'number:' + row.id;
    if (typeof row.id === 'string' && row.id.trim()) return 'string:' + row.id;
    return '';
  }
  function canonical(value, ancestors) {
    if (value === null) return 'null';
    if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('Invalid number');
      return JSON.stringify(value);
    }
    if (typeof value !== 'object') throw new Error('Invalid value');
    if (ancestors.indexOf(value) !== -1) throw new Error('Cyclic data');
    var next = ancestors.concat([value]);
    if (Array.isArray(value)) return '[' + value.map(function (item) { return canonical(item, next); }).join(',') + ']';
    return '{' + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ':' + canonical(value[key], next);
    }).join(',') + '}';
  }
  function signature(row, state) {
    try { return canonical(row, []); }
    catch (e) { state.malformed = true; return null; }
  }
  function realSnapshot(value) {
    if (!object(value)) return false;
    if (stableId(value) || (typeof value.label === 'string' && value.label.trim()) ||
        (typeof value.tanggalArsip === 'string' && value.tanggalArsip.trim())) return true;
    return fields.some(function (field) { return list(value[field], field, { malformed: false }).length > 0; });
  }
  function inspect(product) {
    var p = object(product) ? product : {}, currentState = { malformed: !object(product) };
    var archiveSource = Array.isArray(p.arsip) ? p.arsip : object(p.arsip) ? Object.values(p.arsip) : [];
    var snapshots = archiveSource.filter(realSnapshot), current = {}, count = 0;
    fields.forEach(function (field) {
      current[field] = list(p[field], field, currentState);
      count += current[field].length;
      current[field].forEach(function (row) { signature(row, currentState); });
    });
    // The legacy boolean is an explicit archive marker. Its original product
    // supplies the read-only history; never manufacture or move source rows.
    if (p.arsip === true) {
      // If explicitly reopened, there is no separate legacy snapshot to show.
      // Treating the active product as its own archive would duplicate live rows.
      var legacySnapshots = yes(p.poAktif) ? [] : [p];
      if (currentState.malformed) return { archived: false, snapshots: legacySnapshots, hasNewWork: true, needsReview: true, reason: 'malformed-current' };
      return { archived: !yes(p.poAktif), snapshots: legacySnapshots, hasNewWork: yes(p.poAktif) && count > 0,
        needsReview: false, reason: yes(p.poAktif) ? 'active-po' : 'legacy-archive' };
    }
    if (!snapshots.length) {
      return { archived: false, snapshots: snapshots, hasNewWork: count > 0 || currentState.malformed,
        needsReview: currentState.malformed, reason: currentState.malformed ? 'malformed-current' : 'no-archive' };
    }
    var unmatched = false, ambiguous = false;
    fields.forEach(function (field) {
      var archived = new Map();
      snapshots.forEach(function (snapshot) {
        var archiveState = { malformed: false };
        list(snapshot[field], field, archiveState).forEach(function (row) {
          var id = stableId(row), content = signature(row, archiveState);
          if (!id || content === null) return;
          if (!archived.has(id)) archived.set(id, new Set());
          archived.get(id).add(content);
        });
      });
      current[field].forEach(function (row) {
        var id = stableId(row), content = signature(row, currentState);
        // Equal date/quantity or even an identical ID-less payload cannot prove
        // archive membership: a genuine next PO can repeat both on the same day.
        if (!id) { unmatched = true; ambiguous = true; return; }
        if (content === null || !archived.has(id) || !archived.get(id).has(content)) unmatched = true;
      });
    });
    if (currentState.malformed) return { archived: false, snapshots: snapshots, hasNewWork: true, needsReview: true, reason: 'malformed-current' };
    if (yes(p.poAktif)) return { archived: false, snapshots: snapshots, hasNewWork: unmatched, needsReview: ambiguous, reason: 'active-po' };
    if (unmatched) return { archived: false, snapshots: snapshots, hasNewWork: true, needsReview: ambiguous, reason: ambiguous ? 'unproven-current-work' : 'new-current-work' };
    if (!count || no(p.poAktif)) return { archived: true, snapshots: snapshots, hasNewWork: false, needsReview: false, reason: !count ? 'archive-only' : 'inactive-archive-mirrors' };
    return { archived: false, snapshots: snapshots, hasNewWork: false, needsReview: true, reason: 'inactive-not-confirmed' };
  }
  return { inspect: inspect };
});
