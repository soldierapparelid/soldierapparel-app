(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.ProductionQcBatch=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var fields=['ok','perbaikan','reject','offline'];
  function pcs(value){
    var n=Number(value);
    if(!Number.isSafeInteger(n)||n<0)throw new Error('Jumlah QC harus pcs bulat dan tidak negatif.');
    return n;
  }
  function plan(input,totals,preserve){
    if(!Array.isArray(input)||!input.length)throw new Error('Tidak ada hitungan yang dipilih.');
    var ids=new Set(),rows=input.map(function(source,index){
      if(!source||!((typeof source.id==='string'&&source.id.trim())||(typeof source.id==='number'&&Number.isFinite(source.id)))||ids.has(String(source.id)))throw new Error('Tautan hitungan kosong atau ganda. Muat ulang data.');
      ids.add(String(source.id));
      var row={id:String(source.id),tanggal:String(source.tanggal||''),jumlah:pcs(source.jumlah),index:index};
      if(!row.jumlah)throw new Error('Hitungan harus lebih dari nol.');
      fields.forEach(function(field){row[field]=preserve?pcs(source[field]??0):0;});
      if(preserve&&fields.reduce(function(n,f){return n+row[f];},0)!==row.jumlah)throw new Error('Rincian QC lama tidak sama dengan hitung fisik. Periksa catatan asal.');
      return row;
    }).sort(function(a,b){return a.tanggal.localeCompare(b.tanggal)||a.index-b.index;});
    var target={},sum=0,totalRows=rows.reduce(function(n,r){return n+r.jumlah;},0);
    fields.forEach(function(field){target[field]=pcs(totals[field]??0);sum+=target[field];});
    if(!Number.isSafeInteger(totalRows)||!Number.isSafeInteger(sum)||sum!==totalRows)throw new Error('Total OK + Perbaikan + Reject + Offline harus tepat '+totalRows+' pcs.');
    // Keep existing distributions on edit, moving only quantities that change.
    if(preserve)fields.forEach(function(field){
      var excess=rows.reduce(function(n,r){return n+r[field];},0)-target[field];
      for(var i=rows.length-1;i>=0&&excess>0;i--){
        var take=Math.min(excess,rows[i][field]);rows[i][field]-=take;excess-=take;
      }
    });
    fields.forEach(function(field){
      var remaining=target[field]-rows.reduce(function(n,r){return n+r[field];},0);
      rows.forEach(function(row){
        var available=row.jumlah-fields.reduce(function(n,f){return n+row[f];},0);
        var take=Math.min(remaining,available);row[field]+=take;remaining-=take;
      });
      if(remaining)throw new Error('Pembagian hasil QC tidak seimbang.');
    });
    return rows.map(function(row){delete row.index;return row;});
  }
  return {plan:plan};
});
