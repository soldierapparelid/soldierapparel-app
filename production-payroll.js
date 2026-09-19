(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProductionPayroll = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalizeName(value) {
    return String(value == null ? '' : value).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  }
  function rows(value) {
    return (Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [])
      .filter(function (v) { return v && typeof v === 'object'; });
  }
  function positive(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return 0;
    if (typeof value === 'string' && !value.trim()) return 0;
    var n = Number(value);
    return Number.isFinite(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER ? n : 0;
  }
  function resolveWorker(workers, value) {
    var list = rows(workers), key = String(value == null ? '' : value).trim();
    if (!key) return null;
    var byId = list.filter(function (w) { return String(w.id == null ? '' : w.id).trim() === key; });
    if (byId.length) return byId.length === 1 ? byId[0] : null;
    var byName = list.filter(function (w) { return normalizeName(w.nama || w.name) === normalizeName(key); });
    return byName.length === 1 ? byName[0] : null;
  }
  function dateTime(value) {
    if (value == null || value === '') return NaN;
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    var text = String(value).trim();
    // Date-only legacy records use the start of their local work day. A tariff
    // changed later that day must not silently reprice earlier, undated work.
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      var parts = text.split('-').map(Number), date = new Date(parts[0], parts[1] - 1, parts[2]);
      return date.getFullYear() === parts[0] && date.getMonth() === parts[1] - 1 && date.getDate() === parts[2] ? date.getTime() : NaN;
    }
    return Date.parse(text);
  }
  function rateFor(worker, series, product, date) {
    if (!worker) return 0;
    var rawKey = String(series || '') + '|' + String(product || '');
    var key = rawKey.replace(/[.#$\/\[\]]/g, '_');
    var current = worker.tarif || {}, histories = worker.tarifHistory || {};
    var history = rows(histories[key] || histories[rawKey]).map(function (entry, index) {
      return { time: dateTime(entry.effectiveAt), rate: positive(entry.rate), index: index };
    }).filter(function (entry) { return Number.isFinite(entry.time); });
    var at = dateTime(date);
    if (history.length && Number.isFinite(at)) {
      history.sort(function (a, b) { return b.time - a.time || b.index - a.index; });
      var selected = history.find(function (entry) { return entry.time <= at; });
      return selected ? selected.rate : 0;
    }
    return positive(current[key] != null ? current[key] : current[rawKey]);
  }
  function snapshot(workers, workerValue, product, timestamp) {
    var worker = resolveWorker(workers, workerValue), at = dateTime(timestamp);
    var rate = worker ? rateFor(worker, (product || {}).series, (product || {}).namaBarang, timestamp) : 0;
    return {
      workerId: worker ? String(worker.id || '') : '',
      workerName: worker ? String(worker.nama || worker.name || '') : String(workerValue || '').trim(),
      rate: rate,
      rateMissing: !worker || !worker.id || !rate,
      capturedAt: Number.isFinite(at) ? new Date(at).toISOString() : new Date().toISOString()
    };
  }
  function stamp(entry) { return dateTime(entry.editedAt || entry.inputAt) || 0; }
  function fingerprint(entry, type) {
    return JSON.stringify([type, entry.tanggal || '', entry.jumlah, entry.ok, entry.reject,
      entry.perbaikan, entry.status || '', entry.qcId || '', entry.hfId || '',
      entry.tukangJahit || entry.tukang || '', entry.inputAt || '']);
  }
  function unique(entries, type) {
    var selected = new Map();
    rows(entries).forEach(function (entry) {
      var key = entry.id != null && entry.id !== '' ? 'id:' + entry.id : fingerprint(entry, type);
      var old = selected.get(key);
      if (!old || stamp(entry) >= stamp(old.entry)) selected.set(key, { key: key, entry: entry });
    });
    return Array.from(selected.values());
  }
  function collectProduct(product, workers) {
    if (!product) return [];
    var cycles = rows(product.arsip).concat([product]);
    function sources(field) {
      return cycles.reduce(function (all, cycle) { return all.concat(rows(cycle[field])); }, []);
    }
    var output = [], productId = String(product.id || ''), counted = unique(sources('hitungFisik'), 'hf');
    var quality = unique(sources('qc'), 'qc'), stored = unique(sources('gudang'), 'gudang');
    var byHf = new Map(), consumedHf = new Set(), consumedCounts = new Set();
    var inferredHf = new Map(), reviewEntries = new Set(), linkedHf = new Set(), qcIds = new Set();
    var countsByQc = new Map(), qualityByHf = new Map();
    counted.forEach(function (item) {
      if (item.entry.id) byHf.set(String(item.entry.id), item.entry);
      if (item.entry.qcId) {
        var linked = countsByQc.get(String(item.entry.qcId)) || [];
        linked.push(item); countsByQc.set(String(item.entry.qcId), linked);
      }
    });
    quality.forEach(function (item) { if (item.entry.hfId) linkedHf.add(String(item.entry.hfId)); });
    quality.forEach(function (item) {
      var q = item.entry;
      if (q.id) qcIds.add(String(q.id));
      if (q.hfId) {
        var peers = qualityByHf.get(String(q.hfId)) || [];
        peers.push(item); qualityByHf.set(String(q.hfId), peers);
      } else if (q.id) {
        var linked = countsByQc.get(String(q.id)) || [];
        if (linked.length === 1) {
          inferredHf.set(item.key, linked[0].entry); consumedCounts.add(linked[0].key);
        } else if (linked.length > 1) {
          reviewEntries.add(q);
          linked.forEach(function (count) { reviewEntries.add(count.entry); });
        }
      }
    });
    qualityByHf.forEach(function (peers) {
      if (peers.length > 1) peers.forEach(function (item) { reviewEntries.add(item.entry); });
    });

    // Older batch input wrote the count and QC simultaneously without hfId.
    // Recover that relationship only when the evidence identifies one pair.
    var legacyCandidates = new Map(), reverseCandidates = new Map();
    function workerKey(entry) {
      var value = entry.tukangJahit || entry.tukang || entry.tukangId || '';
      var worker = resolveWorker(workers, value);
      return worker && worker.id ? 'id:' + worker.id : 'name:' + normalizeName(value);
    }
    quality.forEach(function (item) {
      var q = item.entry;
      if (q.hfId || inferredHf.has(item.key) || !/batch/.test(q.inputVia || '')) return;
      var at = dateTime(q.inputAt);
      if (!Number.isFinite(at)) return;
      var near = counted.filter(function (count) {
        var h = count.entry, ht = dateTime(h.inputAt);
        return !h.qcId && !linkedHf.has(String(h.id)) && /batch/.test(h.inputVia || '') &&
          h.tanggal === q.tanggal && workerKey(h) === workerKey(q) &&
          Number.isFinite(ht) && Math.abs(ht - at) <= 2000;
      });
      if (!near.length) return;
      var total = positive(q.ok) + positive(q.reject) + positive(q.perbaikan == null ? q.kotor : q.perbaikan) + positive(q.offline);
      var exact = near.filter(function (count) { return positive(count.entry.jumlah) === total && total > 0; });
      legacyCandidates.set(item.key, { qc: item, near: near, exact: exact });
      exact.forEach(function (count) {
        var references = reverseCandidates.get(count.key) || [];
        references.push(item.key); reverseCandidates.set(count.key, references);
      });
    });
    legacyCandidates.forEach(function (candidate, key) {
      var count = candidate.exact[0];
      if (candidate.exact.length === 1 && (reverseCandidates.get(count.key) || []).length === 1) {
        inferredHf.set(key, count.entry); consumedCounts.add(count.key);
      } else {
        reviewEntries.add(candidate.qc.entry);
        candidate.near.forEach(function (item) { reviewEntries.add(item.entry); });
      }
    });
    counted.forEach(function (count) {
      var h = count.entry;
      if (h.qcId || h.payrollCancelled || linkedHf.has(String(h.id)) || consumedCounts.has(count.key)) return;
      var orphanMirror = stored.some(function (record) {
        var g = record.entry;
        return g.qcId && !qcIds.has(String(g.qcId)) && g.tanggal === h.tanggal &&
          workerKey(g) === workerKey(h) && positive(g.jumlah) > 0 && positive(g.jumlah) === positive(h.jumlah);
      });
      if (orphanMirror) reviewEntries.add(h);
    });

    function add(quantity, type, key, source, hf, warehouse) {
      quantity = positive(quantity);
      if (!quantity) return;
      var frozen = source && source.payroll || hf && hf.payroll || warehouse && warehouse.payroll || null;
      var rawWorker = frozen && (frozen.workerId || frozen.workerName) || source && (source.tukangJahit || source.tukang || source.tukangId) || hf && (hf.tukang || hf.tukangId) || warehouse && (warehouse.tukangJahit || warehouse.tukang) || '';
      var worker = resolveWorker(workers, rawWorker);
      var missingWorker = !worker || !worker.id;
      var dateSource = source || hf || warehouse || {};
      var when = dateSource.inputAt || dateSource.tanggal || '';
      var rate = frozen && !frozen.rateMissing ? positive(frozen.rate) : 0;
      if (!rate && worker) rate = rateFor(worker, product.series, product.namaBarang, when);
      var needsReview = reviewEntries.has(source) || reviewEntries.has(hf);
      var missingRate = missingWorker || !rate || needsReview;
      output.push({
        productId: productId,
        series: product.series || '', namaBarang: product.namaBarang || '', size: product.size || '',
        sourceId: productId + '|' + type + '|' + key,
        sourceType: type,
        tanggal: String(warehouse && warehouse.tanggal || dateSource.tanggal || '').slice(0, 10),
        workerId: missingWorker ? '' : String(worker.id),
        workerName: worker ? String(worker.nama || worker.name || '') : String(frozen && frozen.workerName || rawWorker),
        rawWorker: String(rawWorker),
        jumlah: quantity, tarif: missingRate ? 0 : rate, total: missingRate ? 0 : quantity * rate,
        missingRate: missingRate, missingWorker: missingWorker, needsReview: needsReview,
        reviewReason: needsReview ? 'Sumber hitungan QC bertumpuk atau hubungan batch lama belum pasti. Periksa data sebelum membuat slip.' : ''
      });
    }

    // A QC row owns its linked count and warehouse mirrors. Its approved total
    // is authoritative, including zero, so a rejected count cannot fall back.
    quality.forEach(function (item) {
      var q = item.entry, hf = q.hfId ? byHf.get(String(q.hfId)) : inferredHf.get(item.key) || null;
      if (q.hfId) consumedHf.add(String(q.hfId));
      if ((q.hfId && !hf) || (hf && hf.payrollCancelled)) return;
      if (q.payrollCancelled) return;
      var remaining = positive(q.ok);
      if (!remaining) return;
      var movements = stored.filter(function (record) {
        return record.entry.qcId && q.id && String(record.entry.qcId) === String(q.id) && normalizeName(record.entry.status) === 'ok';
      }).sort(function (a, b) {
        return String(a.entry.tanggal || '').localeCompare(String(b.entry.tanggal || '')) || stamp(a.entry) - stamp(b.entry);
      });
      movements.forEach(function (record) {
        var amount = Math.min(remaining, positive(record.entry.jumlah));
        if (!amount) return;
        add(amount, 'qc', item.key + '|' + record.key, q, hf, record.entry);
        remaining -= amount;
      });
      if (remaining) add(remaining, 'qc', item.key + '|balance', q, hf, null);
    });

    counted.forEach(function (item) {
      var h = item.entry;
      if (h.payrollCancelled || consumedCounts.has(item.key) || h.id && consumedHf.has(String(h.id))) return;
      if (h.qcId && !qcIds.has(String(h.qcId))) return;
      add(h.jumlah, 'hitungFisik', item.key, h, null, null);
    });
    stored.forEach(function (item) {
      var g = item.entry;
      // A linked warehouse record is only a mirror. An orphan reference must
      // never recreate earnings after the master QC entry has been deleted.
      if (g.qcId || g.payrollCancelled || normalizeName(g.status) !== 'ok') return;
      add(g.jumlah, 'gudang', item.key, g, null, null);
    });
    return output;
  }
  function reconcileQcWarehouse(existing, q, options) {
    options = options || {};
    var output = rows(existing).map(function (entry) { return Object.assign({}, entry); });
    if (!q || q.id == null || q.id === '') return output;
    var qcId = String(q.id), date = String(q.tanggal || ''), previousDate = String(options.previousDate || date);
    var target = { ok: positive(q.ok), kotor: positive(q.perbaikan == null ? q.kotor : q.perbaikan), reject: positive(q.reject), offline: positive(q.offline) };
    function category(entry) {
      var status = normalizeName(entry.status);
      return status === 'perbaikan' ? 'kotor' : status;
    }
    var linked = output.filter(function (entry) { return entry.qcId != null && String(entry.qcId) === qcId; });
    linked.forEach(function (entry) {
      if (date && (!entry.tanggal || String(entry.tanggal) === previousDate)) entry.tanggal = date;
    });
    Object.keys(target).forEach(function (status) {
      var movements = linked.filter(function (entry) { return category(entry) === status; });
      movements.forEach(function (entry) { entry.jumlah = positive(entry.jumlah); });
      var sum = movements.reduce(function (total, entry) { return total + entry.jumlah; }, 0);
      var excess = sum - target[status];
      if (excess > 0) {
        // A count correction belongs to the original QC date. Preserve later
        // repair earnings first; only shrink those when the new total requires
        // it, reducing the newest repair movements before older ones.
        var reductionOrder = movements.slice().sort(function (a, b) {
          var aOriginal = String(a.tanggal || '') === date, bOriginal = String(b.tanggal || '') === date;
          if (aOriginal !== bOriginal) return aOriginal ? -1 : 1;
          return String(b.tanggal || '').localeCompare(String(a.tanggal || ''));
        });
        reductionOrder.forEach(function (entry) {
          var reduction = Math.min(excess, entry.jumlah);
          entry.jumlah -= reduction; excess -= reduction;
        });
      } else if (excess < 0) {
        var original = movements.find(function (entry) { return String(entry.tanggal || '') === date; });
        if (original) {
          original.jumlah += -excess;
        } else {
          var suppliedId = typeof options.newId === 'function' ? options.newId() : null;
          var entry = {
            id: suppliedId == null || suppliedId === '' ? qcId + ':' + status + ':' + date : suppliedId,
            tanggal: date, jumlah: -excess, status: status,
            qcId: q.id, tukangJahit: q.tukangJahit || '', ket: q.keterangan || 'Penyesuaian QC'
          };
          if (q.hfId) entry.hfId = q.hfId;
          if (q.payroll) entry.payroll = q.payroll;
          output.push(entry);
        }
      }
    });
    return output.filter(function (entry) {
      return entry.qcId == null || String(entry.qcId) !== qcId || !Object.prototype.hasOwnProperty.call(target, category(entry)) || positive(entry.jumlah) > 0;
    });
  }
  function reconcileQcSellable(existing, q, warehouse) {
    var entries = rows(existing);
    if (!q || q.id == null || q.id === '') return entries.map(function (entry) { return Object.assign({}, entry); });
    var qcId = String(q.id), used = new Set();
    function related(entry) {
      return (entry.qcId != null && String(entry.qcId) === qcId) ||
        (q.hfId && entry.hfId != null && String(entry.hfId) === String(q.hfId));
    }
    var old = entries.filter(related);
    var output = entries.filter(function (entry) { return !related(entry); }).map(function (entry) { return Object.assign({}, entry); });
    unique(warehouse, 'gudang').forEach(function (record) {
      var g = record.entry;
      if (g.qcId == null || String(g.qcId) !== qcId || normalizeName(g.status) !== 'ok' || !positive(g.jumlah)) return;
      var warehouseId = g.id == null || g.id === '' ? record.key : g.id;
      var previous = old.find(function (entry) { return !used.has(entry) && entry.gudangId != null && String(entry.gudangId) === String(warehouseId); });
      if (!previous) previous = old.find(function (entry) { return !used.has(entry) && entry.tanggal === g.tanggal && positive(entry.jumlah) === positive(g.jumlah); });
      if (!previous) previous = old.find(function (entry) { return !used.has(entry) && entry.tanggal === g.tanggal; });
      if (previous) used.add(previous);
      var next = Object.assign({}, previous || {}, {
        id: previous && previous.id != null && previous.id !== '' ? previous.id : String(warehouseId) + '-sellable',
        tanggal: g.tanggal || q.tanggal || '', jumlah: positive(g.jumlah),
        qcId: q.id, gudangId: warehouseId
      });
      if (q.hfId || g.hfId) next.hfId = q.hfId || g.hfId;
      if (!next.ket) next.ket = g.ket || q.keterangan || 'QC OK → Bisa Jualan';
      output.push(next);
    });
    return output;
  }
  return { normalizeName: normalizeName, resolveWorker: resolveWorker, rateFor: rateFor, snapshot: snapshot, collectProduct: collectProduct, reconcileQcWarehouse: reconcileQcWarehouse, reconcileQcSellable: reconcileQcSellable };
});
