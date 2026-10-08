(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProductionWorkflow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var MAX = 9007199254740991;
  function text(value) { return String(value == null ? '' : value).replace(/^\s+|\s+$/g, ''); }
  function normalized(value) {
    var valueText = text(value);
    if (typeof valueText.normalize === 'function') valueText = valueText.normalize('NFKC');
    return valueText.toLowerCase().replace(/\s+/g, ' ');
  }
  function number(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !text(value)) return null;
    var n = Number(value);
    return isFinite(n) && n >= 0 && n <= MAX ? n : null;
  }
  function truth(value) { return value === true || value === 1 || value === 'true'; }
  function ignored(row) {
    return truth(row.deleted) || truth(row.isDeleted) || !!row.deletedAt ||
      truth(row.cancelled) || truth(row.canceled) || !!row.cancelledAt || !!row.canceledAt ||
      /^(deleted|cancelled|canceled|dihapus|dibatalkan|batal)$/.test(normalized(row.status));
  }
  function time(row) {
    var value = row.editedAt || row.updatedAt || row.deletedAt || row.cancelledAt || row.inputAt;
    var parsed = typeof value === 'number' ? value : Date.parse(value || '');
    return isFinite(parsed) ? parsed : 0;
  }
  function issue(state, code, field, key) {
    if (state.reasons.indexOf(code) === -1) state.reasons.push(code);
    state.reviewDetails.push({ code: code, field: field || '', key: key || '' });
  }
  function warning(state, code) {
    if (state.warnings.indexOf(code) === -1) state.warnings.push(code);
  }
  function rows(value, state, field) {
    var list = [], out = [], positions = {};
    if (Array.isArray(value)) list = value;
    else if (value && typeof value === 'object') {
      Object.keys(value).forEach(function (key) { list.push(value[key]); });
    } else if (value != null) issue(state, 'invalid-collection', field);
    list.forEach(function (row) {
      if (row == null) return;
      if (typeof row !== 'object' || Array.isArray(row)) { issue(state, 'invalid-record', field); return; }
      var key = row.id != null && row.id !== '' ? '$' + row.id : null;
      if (key !== null && Object.prototype.hasOwnProperty.call(positions, key)) {
        var index = positions[key];
        if (time(row) >= time(out[index])) out[index] = row;
      } else {
        if (key !== null) positions[key] = out.length;
        out.push(row);
      }
    });
    return out.filter(function (row) { return !ignored(row); });
  }
  function quantity(row, key, optional, state, field) {
    if (row[key] == null && optional) return 0;
    var value = number(row[key]);
    if (value === null) { issue(state, 'invalid-quantity', field, text(row.id)); return 0; }
    return value;
  }
  function add(a, b, state, field) {
    var value = a + b;
    if (value > MAX || !isFinite(value)) {
      issue(state, 'quantity-overflow', field);
      return MAX;
    }
    return value;
  }
  function explicitId(row) {
    return text(row.tukangId || row.workerId || row.payroll && row.payroll.workerId);
  }
  function explicitName(row) {
    return text(row.tukangNama || row.workerName || row.tukang || row.tukangJahit ||
      row.payroll && row.payroll.workerName);
  }
  function registry(workers, entries, state) {
    var byId = {}, byName = {};
    function register(id, name, primary) {
      id = text(id); name = text(name);
      if (!id) return;
      var key = '$' + id, old = byId[key];
      if (!old) old = byId[key] = { id: id, name: name || id, primary: !!primary };
      else if (name && (primary || !old.primary && old.name === old.id)) {
        old.name = name;
        old.primary = !!primary;
      }
      if (name) {
        var nameKey = '$' + normalized(name), ids = byName[nameKey] || (byName[nameKey] = []);
        if (ids.indexOf(id) === -1) ids.push(id);
      }
    }
    rows(workers, state, 'workers').forEach(function (worker) {
      register(worker.id || worker.workerId, worker.nama || worker.name || worker.tukangNama, true);
    });
    entries.forEach(function (row) { register(explicitId(row), explicitName(row), false); });
    function resolve(value) {
      var id = typeof value === 'object' && value ? explicitId(value) : '';
      if (id && byId['$' + id]) return byId['$' + id];
      var raw = typeof value === 'object' && value ? explicitName(value) : text(value);
      if (!raw) return null;
      if (byId['$' + raw]) return byId['$' + raw];
      var candidates = byName['$' + normalized(raw)] || [];
      return candidates.length === 1 ? byId['$' + candidates[0]] : null;
    }
    return { resolve: resolve };
  }

  function analyze(product, workers) {
    var state = { reasons: [], reviewDetails: [], warnings: [] };
    var p = product && typeof product === 'object' ? product : {};
    var cutting = rows(p.potong, state, 'potong');
    var assignments = rows(p.assignJahit, state, 'assignJahit');
    var sewing = rows(p.jahit, state, 'jahit');
    var counts = rows(p.hitungFisik, state, 'hitungFisik');
    var people = registry(workers, assignments.concat(sewing, counts), state);
    var groups = [], groupIndex = {}, assignmentOwners = {};
    var potongTotal = 0, assignedTotal = 0, rawSewn = 0, rejected = 0, counted = 0;

    function getGroup(row, field, index, resolved) {
      var worker = resolved || people.resolve(row);
      var unknownName = explicitName(row), key = worker ? 'id:' + worker.id :
        'unknown:' + (normalized(unknownName) || field + ':' + index);
      if (!worker) issue(state, 'unknown-worker', field, text(row.id) || key);
      var group = groupIndex['$' + key];
      if (!group) {
        group = { key: key, workerId: worker ? worker.id : '', name: worker ? worker.name : unknownName || 'Belum diketahui',
          assigned: 0, sewn: 0, counted: 0, pendingCount: 0, remainingAssigned: 0,
          counts: [], rawSewn: 0, rejected: 0, explicitRemaining: 0,
          remainingCacheMismatch: false, _completeRemainingCache: true };
        groupIndex['$' + key] = group;
        groups.push(group);
      }
      return group;
    }

    cutting.forEach(function (row) { potongTotal = add(potongTotal, quantity(row, 'jumlah', false, state, 'potong'), state, 'potong'); });
    assignments.forEach(function (row, index) {
      var amount = quantity(row, 'qty', false, state, 'assignJahit');
      // sisa is a cached convenience value. Laporan's report editor does not
      // maintain it, so only actual assigned/report quantities can gate QC.
      var cached = row.sisa == null ? null : number(row.sisa);
      var remaining = cached === null ? 0 : cached;
      if (row.sisa != null && cached === null) warning(state, 'invalid-assignment-remainder-cache');
      if (!amount && !remaining) return;
      var group = getGroup(row, 'assignJahit', index);
      group.assigned = add(group.assigned, amount, state, 'assignJahit');
      group.explicitRemaining = Math.min(MAX, group.explicitRemaining + remaining);
      if (cached === null) group._completeRemainingCache = false;
      assignedTotal = add(assignedTotal, amount, state, 'assignJahit');
      if (row.id != null && row.id !== '') assignmentOwners['$' + row.id] = group;
    });
    sewing.forEach(function (row, index) {
      var amount = quantity(row, 'jumlah', false, state, 'jahit');
      var loss = quantity(row, 'rijek', true, state, 'jahit');
      if (loss > amount) issue(state, 'reject-exceeds-sewn', 'jahit', text(row.id));
      loss = Math.min(amount, loss);
      if (row.lolos != null && quantity(row, 'lolos', false, state, 'jahit') !== amount - loss)
        issue(state, 'sewn-good-mismatch', 'jahit', text(row.id));
      if (!amount) return;
      var worker = people.resolve(row), linked = assignmentOwners['$' + row.assignmentId];
      var group;
      if (!worker && !explicitId(row) && !explicitName(row) && linked) group = linked;
      else group = getGroup(row, 'jahit', index, worker);
      if (linked && group.key !== linked.key) issue(state, 'assignment-worker-mismatch', 'jahit', text(row.id));
      group.rawSewn = add(group.rawSewn, amount, state, 'jahit');
      group.rejected = add(group.rejected, loss, state, 'jahit');
      group.sewn = add(group.sewn, amount - loss, state, 'jahit');
      rawSewn = add(rawSewn, amount, state, 'jahit');
      rejected = add(rejected, loss, state, 'jahit');
    });
    counts.forEach(function (row, index) {
      var amount = quantity(row, 'jumlah', false, state, 'hitungFisik');
      if (!amount) return;
      var group = getGroup(row, 'hitungFisik', index);
      group.counted = add(group.counted, amount, state, 'hitungFisik');
      group.counts.push(row);
      counted = add(counted, amount, state, 'hitungFisik');
    });

    var upstream = potongTotal > 0 ? potongTotal : assignedTotal;
    var target = Math.max(0, upstream - Math.min(upstream, rejected));
    var remainingCount = 0, remainingAssigned = 0, sewnGood = 0;
    groups.forEach(function (group) {
      group.pendingCount = Math.max(0, group.sewn - group.counted);
      group.remainingAssigned = Math.max(0, group.assigned - group.rawSewn);
      group.remainingCacheMismatch = group._completeRemainingCache && group.explicitRemaining !== group.remainingAssigned;
      if (group.remainingCacheMismatch) warning(state, 'stale-assignment-remainder-cache');
      delete group._completeRemainingCache;
      if (group.counted > group.sewn) issue(state, 'count-exceeds-sewn', 'hitungFisik', group.key);
      if (group.assigned > 0 && group.rawSewn > group.assigned) issue(state, 'sewn-exceeds-assigned', 'jahit', group.key);
      remainingCount = add(remainingCount, group.pendingCount, state, 'hitungFisik');
      remainingAssigned = add(remainingAssigned, group.remainingAssigned, state, 'assignJahit');
      sewnGood = add(sewnGood, group.sewn, state, 'jahit');
    });
    if (!(upstream > 0)) issue(state, 'no-upstream', 'potong');
    if (potongTotal > 0 && assignedTotal > potongTotal) issue(state, 'assigned-exceeds-cut', 'assignJahit');
    if (rawSewn > upstream && upstream > 0) issue(state, 'sewn-exceeds-upstream', 'jahit');
    if (counted > target) issue(state, 'count-exceeds-target', 'hitungFisik');
    if (ignored(p)) issue(state, 'inactive-product', 'product');
    var needsReview = state.reasons.length > 0;
    return {
      result: {
        target: target, counted: counted, sewnGood: sewnGood,
        remainingCount: remainingCount, remainingPO: Math.max(0, target - counted),
        remainingAssigned: remainingAssigned, readyForQC: target > 0 && counted === target &&
          remainingCount === 0 && remainingAssigned === 0 && !needsReview,
        needsReview: needsReview, groups: groups, reasons: state.reasons, reviewDetails: state.reviewDetails, warnings: state.warnings,
        potongTotal: potongTotal, assignedTotal: assignedTotal, rawSewn: rawSewn, rejected: rejected,
        targetSource: potongTotal > 0 ? 'potong' : assignedTotal > 0 ? 'assignJahit' : ''
      },
      people: people
    };
  }
  function inspect(product, workers) { return analyze(product, workers).result; }
  function groupFor(product, workers, workerValue) {
    var analysis = analyze(product, workers), worker = analysis.people.resolve(workerValue);
    if (!worker) return null;
    for (var i = 0; i < analysis.result.groups.length; i += 1)
      if (analysis.result.groups[i].workerId === worker.id) return analysis.result.groups[i];
    return null;
  }
  // Read-only assignment projection. `sisa` is a legacy cache, never evidence of
  // completed work. Unknown attribution must not become extra input capacity.
  function assignmentProgress(product, assignment, workers) {
    var result = { known: true, assigned: 0, rawSewn: 0, good: 0, rejected: 0,
      remaining: 0, reportCount: 0, reasons: [] };
    var state = { reasons: [], reviewDetails: [], warnings: [] };
    var p = product && typeof product === 'object' ? product : {};
    var assignments = rows(p.assignJahit, state, 'assignJahit');
    var sewing = rows(p.jahit, state, 'jahit');
    var people = registry(workers, assignments.concat(sewing), state);
    function uncertain(code) {
      result.known = false;
      if (result.reasons.indexOf(code) < 0) result.reasons.push(code);
    }
    function id(value) { return value == null || value === '' ? '' : String(value); }
    function pcs(value) {
      var n = number(value);
      return n !== null && Math.floor(n) === n ? n : null;
    }
    var wantedId = assignment && id(assignment.id);
    var matches = assignments.filter(function (a) {
      return wantedId ? id(a.id) === wantedId : a === assignment;
    });
    if (matches.length !== 1) {
      uncertain('assignment-not-current');
      return result;
    }
    var target = matches[0], owner = people.resolve(target);
    var amount = pcs(target.qty);
    if (amount === null) uncertain('invalid-assignment-quantity');
    else result.assigned = amount;
    if (!owner) uncertain('unknown-assignment-worker');
    state.reasons.forEach(uncertain);

    // Report IDs use inspect's latest-row/deletion semantics. Assignment ID
    // collisions are different: a link cannot safely choose either assignment.
    var rawAssignments = Array.isArray(p.assignJahit) ? p.assignJahit :
      p.assignJahit && typeof p.assignJahit === 'object' ? Object.keys(p.assignJahit).map(function (key) { return p.assignJahit[key]; }) : [];
    var assignmentIdCounts = {};
    rawAssignments.forEach(function (a) {
      if (!a || typeof a !== 'object' || Array.isArray(a) || ignored(a) || !id(a.id)) return;
      var key = '$' + id(a.id);
      assignmentIdCounts[key] = (assignmentIdCounts[key] || 0) + 1;
    });
    if (wantedId && assignmentIdCounts['$' + wantedId] > 1) uncertain('ambiguous-assignment-id');
    function sameOwner(worker) { return !!(worker && owner && worker.id === owner.id); }
    function assignmentsFor(worker) {
      if (!worker) return [];
      return assignments.filter(function (a) {
        var person = people.resolve(a);
        return person && person.id === worker.id;
      });
    }
    function affectsTarget(worker, linked) {
      return linked === target || sameOwner(worker) || !worker;
    }
    function include(row) {
      var total = pcs(row.jumlah), rejected = row.rijek == null ? 0 : pcs(row.rijek);
      var good = row.lolos == null ? null : pcs(row.lolos);
      if (total === null || rejected === null || rejected > total ||
          row.lolos != null && (good === null || good !== total - rejected)) {
        uncertain('invalid-sewing-quantity');
        return;
      }
      if (result.rawSewn > MAX - total) {
        uncertain('quantity-overflow');
        return;
      }
      result.rawSewn += total;
      result.rejected += rejected;
      result.good += total - rejected;
      result.reportCount += 1;
    }
    sewing.forEach(function (row) {
      var link = id(row.assignmentId), worker = people.resolve(row);
      var explicitWorker = !!(explicitId(row) || explicitName(row));
      if (link) {
        var linkedMatches = assignments.filter(function (a) { return id(a.id) === link; });
        var linked = linkedMatches.length === 1 ? linkedMatches[0] : null;
        if (!linked || assignmentIdCounts['$' + link] !== 1) {
          if (affectsTarget(worker, linked)) uncertain(linked ? 'ambiguous-assignment-id' : 'dangling-assignment-link');
          return;
        }
        var linkedOwner = people.resolve(linked);
        if (!linkedOwner || explicitWorker && (!worker || worker.id !== linkedOwner.id)) {
          if (affectsTarget(worker, linked)) uncertain('assignment-worker-mismatch');
          return;
        }
        if (linked === target) include(row);
        return;
      }
      if (!worker) { uncertain('unknown-sewing-worker'); return; }
      var candidates = assignmentsFor(worker);
      // No guessing by date, cached remainder, array order, or remaining space.
      if (candidates.length !== 1 || id(candidates[0].id) && assignmentIdCounts['$' + id(candidates[0].id)] > 1) {
        if (sameOwner(worker)) uncertain('ambiguous-legacy-assignment');
        return;
      }
      if (candidates[0] === target) include(row);
    });
    result.remaining = Math.max(0, result.assigned - result.rawSewn);
    // Overreporting is still a known total, allowing a duplicate to be removed.
    if (result.rawSewn > result.assigned) result.reasons.push('sewn-exceeds-assigned');
    return result;
  }
  return { inspect: inspect, groupFor: groupFor, assignmentProgress: assignmentProgress };
});
