(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProductionStatus = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Display-only classification. Never archive, delete or rewrite production.
  var MAX_QUANTITY = 9007199254740991;
  function number(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !value.replace(/\s/g, '')) return null;
    var result = Number(value);
    return isFinite(result) && result >= 0 && result <= MAX_QUANTITY ? result : null;
  }
  function normalized(value) {
    return String(value == null ? '' : value).replace(/^\s+|\s+$/g, '').toLowerCase();
  }
  function flag(value) { return value === true || value === 1 || value === 'true'; }
  function ignored(row) {
    return flag(row.deleted) || flag(row.isDeleted) || !!row.deletedAt ||
      flag(row.cancelled) || flag(row.canceled) || !!row.cancelledAt || !!row.canceledAt ||
      /^(deleted|cancelled|canceled|dihapus|dibatalkan|batal)$/.test(normalized(row.status));
  }
  function stamp(row) {
    var value = row.editedAt || row.updatedAt || row.deletedAt || row.cancelledAt || row.inputAt;
    var parsed = typeof value === 'number' ? value : Date.parse(value || '');
    return isFinite(parsed) ? parsed : 0;
  }
  function records(value, state) {
    var source = [], output = [], byId = {}, i, key, row, previous;
    if (Array.isArray(value)) source = value;
    else if (value && typeof value === 'object') {
      Object.keys(value).forEach(function (name) { source.push(value[name]); });
    } else if (value != null) state.invalidData = true;
    for (i = 0; i < source.length; i += 1) {
      row = source[i];
      if (row == null) continue;
      if (typeof row !== 'object' || Array.isArray(row)) { state.invalidData = true; continue; }
      // Only stable IDs identify duplicates. Equal, ID-less rows can be real batches.
      key = row.id != null && row.id !== '' ? '$' + String(row.id) : null;
      if (key !== null && Object.prototype.hasOwnProperty.call(byId, key)) {
        previous = byId[key];
        if (stamp(row) >= stamp(output[previous])) output[previous] = row;
      } else {
        if (key !== null) byId[key] = output.length;
        output.push(row);
      }
    }
    return output.filter(function (entry) { return !ignored(entry); });
  }
  function quantity(row, key, optional, state) {
    if (row[key] == null && optional) return 0;
    var amount = number(row[key]);
    if (amount === null) { state.invalidData = true; return 0; }
    return amount;
  }
  function add(left, right, state) {
    var result = left + right;
    if (result > MAX_QUANTITY || !isFinite(result)) {
      state.invalidData = true;
      return MAX_QUANTITY;
    }
    return result;
  }
  function sum(entries, key, state) {
    return entries.reduce(function (total, row) {
      return add(total, quantity(row, key, false, state), state);
    }, 0);
  }

  function summarize(product) {
    var state = { invalidData: false };
    var p = product && typeof product === 'object' ? product : {};
    var potong = records(p.potong, state), jahit = records(p.jahit, state);
    var counted = records(p.hitungFisik, state), quality = records(p.qc, state);
    var stored = records(p.gudang, state), assignments = records(p.assignJahit, state);
    var potongTotal = sum(potong, 'jumlah', state), hfTotal = sum(counted, 'jumlah', state);
    var jahitTotal = 0, rijekTotal = 0, jahitGood = 0, consumed = {};
    var assignmentRemaining = 0, qcTotal = 0, qcRepair = 0;
    var warehouseTotal = 0, warehouseRepair = 0, manualWarehouseTotal = 0;

    jahit.forEach(function (row) {
      var amount = quantity(row, 'jumlah', false, state);
      var rejected = quantity(row, 'rijek', true, state);
      if (rejected > amount) state.invalidData = true;
      rejected = Math.min(amount, rejected);
      jahitTotal = add(jahitTotal, amount, state);
      rijekTotal = add(rijekTotal, rejected, state);
      jahitGood = add(jahitGood, amount - rejected, state);
      if (row.assignmentId != null && row.assignmentId !== '') {
        var key = '$' + String(row.assignmentId);
        consumed[key] = add(consumed[key] || 0, amount, state);
      }
    });

    // Laporan may write reports without updating the cached remainder.
    // Real reports for known worker IDs take precedence; never count them twice.
    var assignedWorkers = {}, workerReports = {}, assignmentWorkers = {};
    assignments.forEach(function (row) {
      var worker = row.tukangId || row.workerId || '';
      if (worker) {
        assignedWorkers['$' + worker] = add(assignedWorkers['$' + worker] || 0, quantity(row, 'qty', false, state), state);
        if (row.id) assignmentWorkers['$' + row.id] = worker;
      }
    });
    jahit.forEach(function (row) {
      var worker = row.tukangId || row.workerId || assignmentWorkers['$' + row.assignmentId];
      if (worker) workerReports['$' + worker] = add(workerReports['$' + worker] || 0, quantity(row, 'jumlah', false, state), state);
    });
    Object.keys(assignedWorkers).forEach(function (key) {
      assignmentRemaining = add(assignmentRemaining, Math.max(0, assignedWorkers[key] - (workerReports[key] || 0)), state);
    });
    assignments.forEach(function (row) {
      if (row.tukangId || row.workerId) return;
      var qty = quantity(row, 'qty', false, state), remaining;
      var key = row.id != null && row.id !== '' ? '$' + String(row.id) : '';
      if (key && Object.prototype.hasOwnProperty.call(consumed, key)) remaining = Math.max(0, qty - consumed[key]);
      else if (row.sisa != null) remaining = quantity(row, 'sisa', false, state);
      else remaining = qty;
      assignmentRemaining = add(assignmentRemaining, remaining, state);
    });

    quality.forEach(function (row) {
      // perbaikan is the current field; kotor is its legacy alias, never an extra batch.
      var repair = quantity(row, row.perbaikan != null ? 'perbaikan' : 'kotor', true, state);
      qcRepair = add(qcRepair, repair, state);
      qcTotal = add(qcTotal, quantity(row, 'ok', true, state), state);
      qcTotal = add(qcTotal, quantity(row, 'reject', true, state), state);
      qcTotal = add(qcTotal, quantity(row, 'offline', true, state), state);
      qcTotal = add(qcTotal, repair, state);
    });

    stored.forEach(function (row) {
      var amount = quantity(row, 'jumlah', false, state), status = normalized(row.status);
      var manual = row.qcId == null || row.qcId === '';
      if (status === 'perbaikan' || status === 'kotor') {
        warehouseRepair = add(warehouseRepair, amount, state);
      } else if (status === 'ok' || status === 'reject' || status === 'rijek' ||
          status === 'offline' || (!status && manual)) {
        warehouseTotal = add(warehouseTotal, amount, state);
        if (manual) manualWarehouseTotal = add(manualWarehouseTotal, amount, state);
      }
    });

    var netPotong = Math.max(0, potongTotal - Math.min(potongTotal, rijekTotal));
    var expected = Math.max(netPotong, jahitGood, hfTotal);
    var requiredWarehouse = Math.max(expected, qcTotal);
    var repairPending = Math.max(qcRepair, warehouseRepair);
    var qcRemaining = Math.max(0, expected - qcTotal);
    var warehouseRemaining = Math.max(0, requiredWarehouse - warehouseTotal);
    var jahitRemaining = Math.max(0, potongTotal - jahitTotal, assignmentRemaining);
    var manualDone = quality.length === 0 && manualWarehouseTotal >= expected;
    var done = !ignored(p) && !state.invalidData && expected > 0 &&
      assignmentRemaining === 0 && repairPending === 0 && warehouseRemaining === 0 &&
      (qcRemaining === 0 || manualDone);
    return {
      done: done, expected: expected, potongTotal: potongTotal, netPotong: netPotong,
      jahitTotal: jahitTotal, rijekTotal: rijekTotal, jahitGood: jahitGood, hfTotal: hfTotal,
      qcTotal: qcTotal, warehouseTotal: warehouseTotal, manualWarehouseTotal: manualWarehouseTotal,
      requiredWarehouse: requiredWarehouse, repairPending: repairPending,
      assignmentRemaining: assignmentRemaining, jahitRemaining: jahitRemaining,
      qcRemaining: qcRemaining, warehouseRemaining: warehouseRemaining,
      manualDone: expected > 0 && manualDone, invalidData: state.invalidData
    };
  }

  // Dashboard stages are stricter than the historical completion summary.
  // A warehouse/BigSeller flag, manual display label, or an old automatically
  // generated QC row is not proof that an inspection actually happened.
  function stage(product, workflow) {
    var p = product && typeof product === 'object' ? product : {};
    var state = { invalidData: false }, quality = records(p.qc, state);
    var realQuality = quality.filter(function (row) { return !flag(row.autoFromCount); });
    var view = {};
    Object.keys(p).forEach(function (key) { view[key] = p[key]; });
    view.qc = realQuality;
    var s = summarize(view), flow = workflow || null;
    var completeCounts = flow ? (!flow.needsReview && flow.remainingPO === 0 && flow.remainingCount === 0 && flow.remainingAssigned === 0) :
      (s.expected > 0 && s.hfTotal === s.expected && s.jahitGood >= s.expected && s.assignmentRemaining === 0);
    var inspectionComplete = s.expected > 0 && s.qcTotal === s.expected && s.qcRemaining === 0 && s.repairPending === 0;
    // The worker-aware workflow resolves legacy names and disregards stale sisa
    // caches. Do not let the compatibility summary veto that resolved result.
    var assignmentRemaining = flow ? flow.remainingAssigned : s.assignmentRemaining;
    var warehouseExcess = Math.max(0, s.warehouseTotal - s.requiredWarehouse);
    var qcCategories = { ok: 0, reject: 0, offline: 0 };
    var warehouseCategories = { ok: 0, reject: 0, offline: 0 };
    realQuality.forEach(function (row) {
      Object.keys(qcCategories).forEach(function (key) {
        qcCategories[key] = add(qcCategories[key], quantity(row, key, true, state), state);
      });
    });
    records(p.gudang, state).forEach(function (row) {
      var key = normalized(row.status), amount = quantity(row, 'jumlah', false, state);
      if (key === 'rijek') key = 'reject';
      if (Object.prototype.hasOwnProperty.call(warehouseCategories, key))
        warehouseCategories[key] = add(warehouseCategories[key], amount, state);
    });
    var categoryMismatch = inspectionComplete &&
      Object.keys(qcCategories).some(function (key) { return warehouseCategories[key] > qcCategories[key]; });
    var key, reason;
    if (state.invalidData || s.invalidData) {
      key = 'kurang'; reason = 'Periksa jumlah pada catatan produksi; status selesai belum dapat dipastikan.';
    } else if (warehouseExcess > 0 || categoryMismatch) {
      key = 'kurang'; reason = warehouseExcess > 0 ? 'Jumlah gudang melebihi target produksi; periksa catatan gudang sebelum menyatakan selesai.' :
        'Kategori barang di gudang tidak sesuai hasil QC; periksa catatan OK, reject, dan offline.';
    } else if (!ignored(p) && inspectionComplete && completeCounts && assignmentRemaining === 0 && s.warehouseRemaining === 0) {
      key = 'selesai'; reason = 'Pemeriksaan QC tuntas dan seluruh hasilnya sudah tercatat di gudang.';
    } else if (inspectionComplete && completeCounts && assignmentRemaining === 0 && s.warehouseRemaining > 0) {
      key = 'bigsaller'; reason = 'QC sudah tuntas; masih menunggu pencatatan gudang lengkap.';
    } else if (s.repairPending > 0 || s.qcTotal > 0 || quality.some(function (q) { return flag(q.autoFromCount); }) || (flow ? flow.readyForQC : completeCounts)) {
      key = 'prosesqc';
      reason = s.repairPending > 0 ? 'Masih ada barang yang perlu diperbaiki atau diperiksa kembali.' :
        realQuality.length < quality.length ? 'Catatan otomatis dari hitungan lama bukan hasil pemeriksaan QC; periksa hasil QC terlebih dahulu.' :
        s.qcTotal > 0 ? 'Pemeriksaan atau pekerjaan produksi belum seluruhnya tuntas.' : 'Barang baik sudah dihitung; menunggu pemeriksaan QC.';
    } else if (s.hfTotal > 0 || s.jahitTotal > 0) {
      key = 'qc'; reason = flow && flow.counted > 0 ?
        (flow.remainingCount > 0 ? 'Sebagian setoran sudah dihitung; masih ada setoran yang perlu dihitung.' :
          'Setoran yang diterima sudah dihitung; menunggu sisa pekerjaan jahit sebelum pemeriksaan QC.') :
        'Setoran jahit berada di antrian hitung. Belum selesai QC atau masuk gudang.';
    } else if (records(p.assignJahit, state).some(function (a) { return number(a.qty) > 0; })) {
      key = 'sedangjahit'; reason = 'Pekerjaan sudah ditugaskan kepada tukang jahit.';
    } else if (s.potongTotal > 0) {
      key = 'sudahpotong'; reason = 'Bahan sudah dipotong; menunggu penugasan jahit.';
    } else if (flag(p.poAktif)) {
      key = 'po'; reason = 'PO terbuka dan belum memiliki hasil potong.';
    } else {
      key = 'kosong'; reason = 'Belum ada aktivitas produksi pada PO ini.';
    }
    return { key: key, summary: s, reason: reason };
  }

  return { summarize: summarize, stage: stage };
});
