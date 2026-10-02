/* Pure, local advice. The caller must match the sold product to reviewed costs.
 * No account settings or model-average HPP are read or changed here.
 * Shopee's analysis guidance: https://iklan.shopee.co.id/learn/faq/555/2031
 * All numerical decision thresholds below are conservative app heuristics,
 * not Shopee rules. A target is a control setting, never a promised outcome.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RoasAdvisor = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var MAX = Number.MAX_SAFE_INTEGER;
  var DAY = 86400000;
  var FOLLOW_UP = ' Ini uji bertahap dengan aturan konservatif aplikasi, bukan aturan atau jaminan hasil Shopee. Amati 7–14 hari dan hindari perubahan target berulang dalam waktu singkat.';
  function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function number(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX; }
  function safe(value) {
    if (!Number.isFinite(value) || Math.abs(value) > MAX) throw new RangeError('Hasil perhitungan melampaui batas angka yang aman. Periksa data dan satuannya.');
    return value === 0 ? 0 : value;
  }
  function action(code, title, reason, tone, target, budget) {
    return { code: code, title: title, reason: reason, tone: tone || 'neutral', suggestedTarget: target == null ? null : target, suggestedBudget: budget == null ? null : budget };
  }
  function empty() {
    return { valid: false, errors: [], spend: null, revenue: null, sold: null, roas: null, feeAmount: null, taxAmount: null, fixedAmount: null, hppCost: null, profit: null, marginPct: null, breakEvenRoas: null, safeRoas: null, action: null };
  }
  function fail(result, errors, incompleteCost) {
    result.valid = false;
    result.errors = errors;
    ['feeAmount', 'taxAmount', 'fixedAmount', 'hppCost', 'profit', 'marginPct', 'breakEvenRoas', 'safeRoas'].forEach(function (key) { result[key] = null; });
    result.action = incompleteCost
      ? action('complete_cost', 'Lengkapi biaya produk', errors.join(' '), 'warning')
      : action('fix_data', 'Periksa data perhitungan', errors.join(' '), 'warning');
    return result;
  }
  function active(status) {
    // Unknown, paused, ended, and deleted states must never receive a scale suggestion.
    return typeof status === 'string' && ['berjalan', 'aktif', 'active', 'running', 'ongoing'].indexOf(status.trim().toLowerCase()) >= 0;
  }
  function analyze(input) {
    var result = empty();
    if (!record(input) || !record(input.ad)) return fail(result, ['Data iklan belum tersedia.']);
    var ad = input.ad, cost = input.cost, context = record(input.context) ? input.context : {};
    var errors = [];
    if (Array.isArray(ad.parseErrors) ? ad.parseErrors.length > 0 : !!ad.parseErrors) errors.push('Ada kolom laporan yang gagal dibaca. Periksa hasil impor sebelum memakai saran.');
    [['biaya', 'Biaya iklan'], ['omzet', 'Omzet'], ['terjual', 'Produk terjual']].forEach(function (field) {
      if (!number(ad[field[0]])) errors.push(field[1] + ' harus berupa angka nol atau lebih dalam batas aman.');
    });
    if (number(ad.terjual) && !Number.isSafeInteger(ad.terjual)) errors.push('Produk terjual harus berupa jumlah unit bulat.');
    if (errors.length) return fail(result, errors);
    result.spend = ad.biaya; result.revenue = ad.omzet; result.sold = ad.terjual;
    try { result.roas = ad.biaya > 0 ? safe(ad.omzet / ad.biaya) : null; }
    catch (failure) { return fail(result, [failure.message]); }
    if (!record(cost) || cost.reviewed !== true || cost.hppPerPcs == null) {
      return fail(result, ['Cocokkan barang yang terjual dengan HPP per pcs serta biaya yang sudah diperiksa. Rata-rata HPP seluruh model tidak dipakai untuk saran iklan.'], true);
    }
    [['hppPerPcs', 'HPP per pcs'], ['feePct', 'Biaya marketplace'], ['taxPct', 'Perkiraan pajak'], ['fixedPerPcs', 'Biaya tetap per pcs']].forEach(function (field) {
      if (!number(cost[field[0]])) errors.push(field[1] + ' harus berupa angka nol atau lebih dalam batas aman.');
    });
    if (number(cost.feePct) && cost.feePct > 100) errors.push('Persentase biaya marketplace tidak boleh melebihi 100%.');
    if (number(cost.taxPct) && cost.taxPct > 100) errors.push('Persentase pajak tidak boleh melebihi 100%.');
    if (errors.length) return fail(result, errors);
    var validMargin = number(context.minMargin) && context.minMargin < 100;
    var contribution;
    try {
      result.feeAmount = safe(result.revenue * (cost.feePct / 100));
      result.taxAmount = safe(result.revenue * (cost.taxPct / 100));
      result.fixedAmount = safe(result.sold * cost.fixedPerPcs);
      result.hppCost = safe(result.sold * cost.hppPerPcs);
      var totalCost = safe(safe(safe(result.feeAmount + result.taxAmount) + result.fixedAmount) + result.hppCost);
      contribution = safe(result.revenue - totalCost);
      result.profit = safe(contribution - result.spend);
      result.marginPct = result.revenue > 0 ? safe(result.profit / result.revenue * 100) : null;
      result.breakEvenRoas = contribution > 0 ? safe(result.revenue / contribution) : null;
      if (result.revenue > 0 && validMargin) {
        var availableForAds = contribution / result.revenue - context.minMargin / 100;
        result.safeRoas = availableForAds > 0 ? safe(1 / availableForAds) : null;
      }
    } catch (failure) { return fail(result, [failure.message]); }
    result.valid = true;
    if (!active(ad.status)) {
      result.action = action('hold_inactive', 'Periksa status iklan', 'Status iklan tidak terkonfirmasi sedang berjalan. Angka tetap ditampilkan, tetapi tidak ada saran mengaktifkan, menaikkan anggaran, atau mengubah target.', 'neutral');
      return result;
    }
    if (result.sold === 0) {
      result.action = action('review_no_sales', 'Tinjau iklan tanpa penjualan', 'Belum ada unit terjual pada laporan ini. Periksa kelengkapan periode, atribusi, penawaran, dan biaya; angka nol ini bukan alasan tunggal untuk mematikan iklan.', 'warning');
      return result;
    }
    if (contribution <= 0) {
      result.action = action('fix_economics', 'Periksa harga dan biaya produk', 'Omzet belum menutup HPP, biaya marketplace, biaya tetap, dan pajak bahkan sebelum iklan. Tidak ada target ROAS yang dapat menutup kekurangan ini pada komposisi penjualan sekarang.', 'warning');
      return result;
    }
    if (!number(context.days) || !Number.isSafeInteger(context.days) || context.days < 7 || context.complete !== true) {
      result.action = action('collect_data', 'Tunggu periode lengkap', 'Saran perubahan menunggu sedikitnya 7 hari yang sudah selesai dengan pengaturan yang sama. Ini batas konservatif aplikasi; laporan yang mencakup hari ini masih berjalan.', 'neutral');
      return result;
    }
    if (result.spend === 0) {
      result.action = action('collect_data', 'Tinjau data belanja iklan', 'Belanja iklan pada periode ini nol. ROAS tidak dapat dibagi dengan nol dan belum ada dasar untuk saran peningkatan belanja.', 'neutral');
      return result;
    }
    var knownBidding = ['gmv_roas', 'gmv_auto', 'manual'].indexOf(context.biddingMode) >= 0;
    var knownBudget = context.budgetMode === 'unlimited' || (context.budgetMode === 'limited' && number(context.dailyBudget) && context.dailyBudget > 0);
    var knownTarget = context.biddingMode !== 'gmv_roas' || (number(context.targetRoas) && context.targetRoas > 0);
    var knownGoal = context.goal === 'profit' || context.goal === 'grow';
    if (context.settingsVerified !== true || context.settingsStable !== true || !knownBidding || !knownBudget || !knownTarget || !knownGoal || !validMargin) {
      result.action = action('verify_settings', 'Konfirmasi pengaturan iklan', 'Pastikan mode iklan, batas anggaran, target ROAS bila dipakai, tujuan, dan margin minimum sudah benar. Konfirmasi juga bahwa pengaturannya tetap sama selama periode laporan sebelum mengikuti saran perubahan.', 'warning');
      return result;
    }
    if (result.profit < 0) {
      if (result.sold < 10) {
        result.action = action('review_loss_low_sample', 'Tinjau kerugian, data penjualan masih sedikit', 'Hitungan biaya menunjukkan rugi, tetapi baru ada ' + result.sold + ' unit terjual. Periksa kerugian, atribusi, biaya, dan kemampuan kas sekarang; jangan memperbesar belanja. Usulan perubahan target menunggu sedikitnya 10 unit terjual agar tidak bereaksi terhadap satu atau beberapa transaksi saja. Ini batas konservatif aplikasi, bukan jaminan statistik atau aturan Shopee.', 'warning');
        return result;
      }
      if (context.biddingMode === 'gmv_roas') {
        var raisedTarget = context.targetRoas * 1.1;
        if (number(raisedTarget) && raisedTarget > context.targetRoas) {
          var targetNote = result.safeRoas === null
            ? ' Margin minimum yang diminta belum dapat dicapai hanya lewat target iklan pada komposisi biaya ini.'
            : raisedTarget < result.safeRoas
              ? ' Kenaikan kecil ini masih di bawah ROAS yang dihitung untuk margin minimum; belum cukup untuk mencapai batas tersebut.'
              : ' Target yang diusulkan bukan jaminan ROAS aktual atau laba.';
          result.action = action('raise_target', 'Uji naikkan target ROAS', 'Laporan lengkap menunjukkan rugi setelah seluruh biaya. Uji kenaikan target paling banyak 10% untuk menahan belanja; target lebih tinggi dapat membatasi belanja dan penjualan.' + targetNote + FOLLOW_UP, 'warning', raisedTarget);
          return result;
        }
      }
      result.action = action('limit_spend', 'Batasi biaya / tinjau iklan', 'Laporan lengkap menunjukkan rugi setelah seluruh biaya. Tinjau batas biaya, harga, dan konversi sebelum menambah belanja. Mode ini tidak menghasilkan saran perubahan target ROAS.' + FOLLOW_UP, 'warning');
      return result;
    }
    if (result.marginPct !== null && result.marginPct < context.minMargin) {
      var marginNote = result.safeRoas === null
        ? ' Dengan komposisi biaya sekarang, margin minimum ini belum dapat dicapai hanya dengan mengubah target iklan; periksa harga dan biaya produk.'
        : ' Periksa harga, biaya produk, serta efisiensi iklan sebelum mempertimbangkan perubahan. Tidak ada saran menambah belanja atau mengubah target otomatis.';
      result.action = action('review_margin', 'Laba belum mencapai margin minimum', 'Laporan tidak menunjukkan rugi, tetapi margin laba setelah iklan masih di bawah batas minimum ' + context.minMargin + '% yang dipilih.' + marginNote, 'warning');
      return result;
    }
    if (context.goal === 'profit') {
      result.action = action('maintain', 'Pertahankan pengaturan', 'Laporan tidak menunjukkan rugi dan tujuan yang dipilih adalah menjaga laba. ROAS di bawah target saja tidak cukup untuk memutuskan perubahan.', 'positive');
      return result;
    }
    if (result.sold < 10 || result.marginPct === null || result.marginPct < context.minMargin + 5 || result.safeRoas === null) {
      result.action = action('maintain', 'Pertahankan; kumpulkan bukti', 'Belum memenuhi batas konservatif aplikasi untuk mencoba pertumbuhan: sedikitnya 10 unit terjual dan margin laba minimal 5 poin persentase di atas margin minimum. Batas ini bukan aturan Shopee.', 'neutral');
      return result;
    }
    if (context.budgetMode === 'limited' && context.budgetExhausted === true) {
      var raisedBudget = Math.floor(context.dailyBudget * 1.1);
      if (number(raisedBudget) && raisedBudget > context.dailyBudget) {
        result.action = action('raise_budget', 'Uji naikkan anggaran 10%', 'Laba memiliki ruang terhadap margin minimum dan anggaran terbatas dikonfirmasi habis. Uji tambahan anggaran paling banyak 10% sambil mempertahankan target saat ini; biaya dapat bertambah.' + FOLLOW_UP, 'positive', null, raisedBudget);
        return result;
      }
    }
    var budgetRoom = context.budgetMode === 'unlimited' || (context.budgetMode === 'limited' && context.budgetExhausted === false);
    if (context.biddingMode === 'gmv_roas' && budgetRoom && result.roas >= context.targetRoas) {
      var loweredTarget = context.targetRoas * 0.95;
      if (number(loweredTarget) && loweredTarget > 0 && loweredTarget < context.targetRoas && loweredTarget >= result.safeRoas) {
        result.action = action('lower_target', 'Uji turunkan target ROAS 5%', 'Tujuan pertumbuhan dipilih, laba memiliki ruang, dan ROAS aktual mencapai target. Uji target turun paling banyak 5% hanya karena usulnya masih di atas batas margin minimum. Belanja dapat meningkat dan laba dapat turun; hasil berikutnya tidak dijamin.' + FOLLOW_UP, 'warning', loweredTarget);
        return result;
      }
    }
    var holdReason = context.budgetMode === 'unlimited'
      ? 'Anggaran sudah tanpa batas, sehingga tidak ada saran menaikkan anggaran. Belum ada dasar yang cukup untuk perubahan target yang tetap menjaga margin minimum.'
      : context.budgetExhausted !== true && context.budgetExhausted !== false
        ? 'Belum dikonfirmasi apakah anggaran harian habis. Periksa batas yang benar-benar menahan penjualan sebelum mencoba perubahan.'
        : 'Belum ada dasar yang cukup untuk perubahan tambahan yang tetap menjaga margin minimum. Pertahankan dan amati hasil periode berikutnya.';
    result.action = action('maintain', 'Pertahankan pengaturan', holdReason, 'neutral');
    return result;
  }
  function dateValue(text) {
    if (typeof text !== 'string') return null;
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    var local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (!match && !local) return null;
    var year = Number(match ? match[1] : local[3]), month = Number(match ? match[2] : local[2]), day = Number(match ? match[3] : local[1]);
    if (year < 1000 || year > 9999) return null;
    var value = Date.UTC(year, month - 1, day), date = new Date(value);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return { day: date.toISOString().slice(0, 10), value: value };
  }
  // `now` is the caller's current Asia/Jakarta calendar day in YYYY-MM-DD.
  // Compare calendar days at UTC midnight, avoiding host locale and DST effects.
  function periodInfo(period, now) {
    var invalid = { start: null, end: null, days: null, complete: false };
    if (typeof period !== 'string') return invalid;
    var token = '(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}/\\d{4})';
    var range = new RegExp('^\\s*' + token + '\\s*[-–—]\\s*' + token + '\\s*$').exec(period);
    var start = dateValue(range ? range[1] : period.trim());
    var end = dateValue(range ? range[2] : period.trim());
    if (!start || !end || end.value < start.value) return invalid;
    var today = typeof now === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(now) ? dateValue(now) : null;
    return { start: start.day, end: end.day, days: (end.value - start.value) / DAY + 1, complete: !!today && end.value < today.value };
  }
  return Object.freeze({ analyze: analyze, periodInfo: periodInfo });
}));
