/* Pure price simulation. Tax percentages are user estimates, not filing advice. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HppPrice = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var MAX = Number.MAX_SAFE_INTEGER;
  var labels = { hpp: 'HPP', price: 'Harga jual', margin: 'Target margin', fee: 'Biaya marketplace', tax: 'Estimasi pajak', fixed: 'Biaya tetap per pcs', profit: 'Target untung per pcs' };
  function fields(input, names) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Isian simulasi belum valid.';
    for (var i = 0; i < names.length; i += 1) {
      var name = names[i], value = input[name];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return labels[name] + ' harus angka nol atau lebih yang valid.';
      if (name !== 'fee' && name !== 'tax' && name !== 'margin' && value > MAX) return labels[name] + ' melampaui batas perhitungan rupiah yang aman.';
    }
    return '';
  }
  function money(value) {
    if (!Number.isFinite(value) || Math.abs(value) > MAX) throw new RangeError('Hasil simulasi melampaui batas perhitungan rupiah yang aman.');
    return value === 0 ? 0 : value;
  }
  function roundedPrice(base, divisor) {
    if (!Number.isFinite(divisor) || divisor <= 0) throw new RangeError('Sisa persentase harga harus lebih dari nol.');
    return money(Math.ceil(money(base / divisor) / 100) * 100);
  }
  function invalidQuote(error) {
    return { valid: false, recommended: null, breakEven: null, profit: null, feeAmount: null, taxAmount: null, fixed: null, marginActual: null, error: error };
  }
  // Inputs are per piece. The caller converts any per-order charge to fixed/pcs.
  // HPP and costs may be fractional; only recommended sale prices round up to
  // the next Rp100. Margin is a percentage of selling price, not markup on HPP.
  // At price 0 the signed profit is defined, but marginActual is null.
  function quote(input) {
    var error = fields(input, ['hpp', 'price', 'margin', 'fee', 'tax', 'fixed']);
    if (error) return invalidQuote(error);
    var combined = input.fee + input.tax + input.margin;
    if (!Number.isFinite(combined) || combined >= 100) return invalidQuote('Jumlah biaya marketplace, estimasi pajak, dan target margin harus kurang dari 100%.');
    try {
      var base = money(input.hpp + input.fixed);
      var feeAmount = money(input.price * (input.fee / 100));
      var taxAmount = money(input.price * (input.tax / 100));
      var profit = money(input.price - feeAmount - taxAmount - base);
      var marginActual = input.price === 0 ? null : profit / input.price * 100;
      if (marginActual !== null && !Number.isFinite(marginActual)) throw new RangeError('Persentase hasil simulasi melampaui batas perhitungan yang aman.');
      return {
        valid: true,
        recommended: roundedPrice(base, 1 - input.fee / 100 - input.tax / 100 - input.margin / 100),
        breakEven: roundedPrice(base, 1 - input.fee / 100 - input.tax / 100),
        profit: profit,
        feeAmount: feeAmount,
        taxAmount: taxAmount,
        fixed: input.fixed === 0 ? 0 : input.fixed,
        marginActual: marginActual === 0 ? 0 : marginActual,
        error: ''
      };
    } catch (failure) {
      return invalidQuote(failure.message || 'Hasil simulasi belum dapat dihitung dengan aman.');
    }
  }
  function target(input) {
    var error = fields(input, ['hpp', 'profit', 'fee', 'tax', 'fixed']);
    var invalid = function (message) { return { valid: false, price: null, error: message }; };
    if (error) return invalid(error);
    var combined = input.fee + input.tax;
    if (!Number.isFinite(combined) || combined >= 100) return invalid('Jumlah biaya marketplace dan estimasi pajak harus kurang dari 100%.');
    try {
      var base = money(money(input.hpp + input.fixed) + input.profit);
      return { valid: true, price: roundedPrice(base, 1 - input.fee / 100 - input.tax / 100), error: '' };
    } catch (failure) {
      return invalid(failure.message || 'Harga target belum dapat dihitung dengan aman.');
    }
  }
  return Object.freeze({ quote: quote, target: target });
}));
