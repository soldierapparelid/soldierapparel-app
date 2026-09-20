(function(root, factory){
  var api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.ProductionMaterials = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  var SCALE = 1000000;
  function norm(value){ return String(value || '').trim().toLowerCase(); }
  function rows(value){ return Array.isArray(value) ? value.filter(Boolean) : value && typeof value === 'object' ? Object.values(value).filter(function(v){ return v && typeof v === 'object'; }) : []; }
  function stable(value){
    if(Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if(value && typeof value === 'object') return '{' + Object.keys(value).sort().map(function(k){ return JSON.stringify(k) + ':' + stable(value[k]); }).join(',') + '}';
    return JSON.stringify(value);
  }
  function bahan(entry){
    if(entry && Array.isArray(entry.bahanList) && entry.bahanList.length) return entry.bahanList.filter(function(b){ return b && (b.jenis || +b.kg > 0); });
    return entry && entry.jenisBahan ? [{jenis:entry.jenisBahan,kg:+entry.kiloan || 0}] : [];
  }
  // Read-only ledger projection. Archiving a PO must not return consumed cloth to stock.
  // Only a stable record ID with identical material details proves a mirrored copy.
  // ID-less matches and conflicting IDs remain visible and are explicitly flagged.
  function inspect(product){
    var result = { entries:[], issues:[] }, seenIds = new Map(), seenFingerprints = new Map();
    var cycles = [{source:'current',value:product && product.potong}];
    rows(product && product.arsip).forEach(function(a,i){ cycles.push({source:'archive:' + i,value:a.potong}); });
    cycles.forEach(function(cycle){
      rows(cycle.value).forEach(function(entry){
        var fingerprint = stable({tanggal:entry.tanggal || '',jumlah:+entry.jumlah || 0,tukangId:entry.tukangId || '',bahan:bahan(entry).map(function(b){return {jenis:norm(b.jenis),kg:+b.kg || 0};})});
        var id = entry.id === 0 ? '0' : entry.id ? String(entry.id) : '';
        var idKey = id && id + '|' + fingerprint;
        if(idKey && seenIds.has(idKey)) return;
        var previous = seenFingerprints.get(fingerprint);
        if(previous && previous.source !== cycle.source && (!id || !previous.id)) result.issues.push({type:'unidentified-mirror',entry:entry,source:cycle.source});
        if(id && Array.from(seenIds.keys()).some(function(k){return k.indexOf(id + '|') === 0 && k !== idKey;})) result.issues.push({type:'conflicting-id',entry:entry,source:cycle.source});
        if(idKey) seenIds.set(idKey, true);
        seenFingerprints.set(fingerprint,{source:cycle.source,id:id});
        result.entries.push({entry:entry,archived:cycle.source !== 'current'});
      });
    });
    return result;
  }
  function inspectAll(products){
    var results=rows(products).map(function(product){return {product:product,ledger:inspect(product)};}), batches=new Map();
    results.forEach(function(result){
      var product=result.product;
      if(!product._offlineOrderId) return;
      result.ledger.entries.forEach(function(row){
        var entry=row.entry;
        if(entry.materialBatchId) return;
        var key=stable([product._offlineOrderId,product.series || '',product.namaBarang || '',entry.tanggal || '',entry.tukangId || '',bahan(entry).map(function(b){return {jenis:norm(b.jenis),kg:+b.kg || 0};})]);
        if(!batches.has(key))batches.set(key,[]);
        batches.get(key).push({result:result,entry:entry});
      });
    });
    batches.forEach(function(group){
      if(new Set(group.map(function(x){return x.result.product;})).size < 2)return;
      group.forEach(function(x){x.result.ledger.issues.push({type:'legacy-multi-size',entry:x.entry});});
    });
    return results;
  }
  function split(total, quantities){
    if(!Number.isFinite(+total) || +total < 0) throw new Error('Jumlah bahan harus angka positif.');
    var units = Math.round(+total * SCALE), sum = quantities.reduce(function(a,b){return a+b;},0);
    var parts = quantities.map(function(q,i){var raw=units*q/sum;return {i:i,units:Math.floor(raw),fraction:raw-Math.floor(raw)};});
    var remainder=units-parts.reduce(function(a,p){return a+p.units;},0);
    parts.slice().sort(function(a,b){return b.fraction-a.fraction || a.i-b.i;}).slice(0,remainder).forEach(function(p){p.units++;});
    return parts.map(function(p){return p.units/SCALE;});
  }
  // New multi-size inputs only: each material/roll is apportioned by piece count.
  // The original batch's total is conserved, rather than copied once per size.
  function allocateBatch(quantities, input){
    if(!Array.isArray(quantities) || !quantities.length || quantities.some(function(q){return !Number.isInteger(q) || q <= 0;})) throw new Error('Jumlah setiap size harus pcs bulat lebih dari nol.');
    var parts=quantities.map(function(){return {kiloan:0,rols:[],bahanList:[]};});
    var materials=bahan(input), rolls=rows(input && input.rols);
    materials.forEach(function(b){var values=split(+b.kg || 0,quantities);parts.forEach(function(p,i){p.bahanList.push(Object.assign({},b,{kg:values[i]}));});});
    rolls.forEach(function(r){var values=split(+(r.kiloan !== undefined ? r.kiloan : r.kg) || 0,quantities);parts.forEach(function(p,i){p.rols.push(Object.assign({},r,{kiloan:values[i],kg:values[i]}));});});
    var totalValues=split(+(input && input.kiloan) || 0,quantities);
    parts.forEach(function(p,i){p.kiloan=materials.length ? Math.round(p.bahanList.reduce(function(a,b){return a+b.kg;},0)*SCALE)/SCALE : totalValues[i];});
    return parts;
  }
  return {norm:norm,rows:rows,bahan:bahan,inspect:inspect,inspectAll:inspectAll,allocateBatch:allocateBatch};
});
