/* Explicit private-file import planning only: no I/O, storage, or automatic import. */
(function(root,factory){
  'use strict';
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.ProductionHistoryImport=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var FORMAT='soldier-private-production-history-v1';
  var fields=['potong','bigSaller','bayarJahit','gudang','jahit','assignJahit','qc','hitungFisik'];
  var actions={potong:'potong',bigsaller:'bigSaller',jahit:'bayarJahit',reject:'gudang',kotor:'gudang',ok:'gudang'};
  function own(value,key){return Object.prototype.hasOwnProperty.call(value,key);}
  function dataProperties(value){return Object.getOwnPropertyNames(value).every(function(key){
    return own(Object.getOwnPropertyDescriptor(value,key),'value');
  });}
  function object(value){
    if(!value||typeof value!=='object'||Array.isArray(value))return false;
    var prototype=Object.getPrototypeOf(value);
    if(prototype!==null){
      // Plain JSON objects from another window/VM have a different Object
      // prototype identity. Compare the native constructor, not that identity.
      var constructor=Object.getOwnPropertyDescriptor(prototype,'constructor');
      if(Object.getPrototypeOf(prototype)!==null||!constructor||!own(constructor,'value')||
          typeof constructor.value!=='function'||
          Function.prototype.toString.call(constructor.value)!==Function.prototype.toString.call(Object))return false;
    }
    return dataProperties(value);
  }
  function fail(message){throw new Error(message);}
  function date(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
    var year=Number(value.slice(0,4)),month=Number(value.slice(5,7)),day=Number(value.slice(8,10));
    var days=[31,(year%4===0&&(year%100!==0||year%400===0))?29:28,31,30,31,30,31,31,30,31,30,31];
    return year>=1&&month>=1&&month<=12&&day>=1&&day<=days[month-1];
  }
  function pcs(value,legacy){
    if(legacy&&typeof value==='string'&&/^\d+$/.test(value.trim()))value=Number(value.trim());
    return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
  }
  function label(value){return typeof value==='string'&&value.trim()&&!/[\u0000-\u001f]/.test(value);}
  function sku(series,nama,size){return JSON.stringify([series.trim(),nama.trim(),size.trim()]);}
  function validatePayload(payload){
    if(!object(payload)||!own(payload,'format')||!own(payload,'rows')||payload.format!==FORMAT||
        !Array.isArray(payload.rows)||!dataProperties(payload.rows)||payload.rows.length>10000)
      fail('Format riwayat pribadi tidak valid atau melebihi 10000 baris.');
    var rows=[];
    for(var i=0;i<payload.rows.length;i++){
      var row=payload.rows[i],prefix='Baris '+(i+1)+': ';
      if(!Array.isArray(row)||!dataProperties(row)||row.length!==7||!label(row[0])||!label(row[1])||!label(row[2]))
        fail(prefix+'isi tujuh kolom: series, nama, size, aksi, tanggal, jumlah, ket.');
      if(typeof row[3]!=='string'||!own(actions,row[3]))fail(prefix+'aksi tidak didukung.');
      if(!date(row[4]))fail(prefix+'tanggal harus tanggal kalender YYYY-MM-DD yang valid.');
      if(pcs(row[5],false)===null)fail(prefix+'jumlah harus angka pcs bulat, aman, dan tidak negatif.');
      if(typeof row[6]!=='string')fail(prefix+'keterangan harus teks.');
      rows.push({series:row[0].trim(),namaBarang:row[1].trim(),size:row[2].trim(),
        field:actions[row[3]],tanggal:row[4],jumlah:row[5],ket:row[6],
        status:actions[row[3]]==='gudang'?row[3]:''});
    }
    return rows;
  }
  // Clone JSON-shaped state without silently dropping unsupported fields or
  // changing special own keys such as __proto__. Input objects stay untouched.
  function clone(value,ancestors){
    if(value===null||typeof value==='string'||typeof value==='boolean')return value;
    if(typeof value==='number'&&Number.isFinite(value))return value;
    if(!Array.isArray(value)&&!object(value))fail('Data lama bukan struktur JSON yang valid.');
    if(ancestors.indexOf(value)!==-1)fail('Data lama memiliki referensi berulang.');
    var next=ancestors.concat([value]),out=Array.isArray(value)?new Array(value.length):{};
    Object.keys(value).forEach(function(key){
      var descriptor=Object.getOwnPropertyDescriptor(value,key);
      if(!descriptor||!own(descriptor,'value'))fail('Data lama memiliki properti yang tidak aman.');
      Object.defineProperty(out,key,{value:clone(descriptor.value,next),enumerable:true,writable:true,configurable:true});
    });
    return out;
  }
  function records(value,where,flag){
    if(value==null||(flag&&(typeof value==='boolean'||value===1)))return [];
    if(!Array.isArray(value)&&!object(value))fail('Riwayat lama '+where+' tidak valid; impor dibatalkan.');
    var list=Array.isArray(value)?value:Object.keys(value).map(function(key){return value[key];});
    return list.filter(function(row){
      if(row==null)return false; // Preserve, but do not interpret, Firebase holes.
      if(!object(row))fail('Entri riwayat lama '+where+' tidak valid; impor dibatalkan.');
      return true;
    });
  }
  function history(product,where,visit){
    fields.forEach(function(field){
      records(product[field],where+'.'+field,field==='bigSaller').forEach(function(row){
        if(field==='potong'||field==='bigSaller'||field==='bayarJahit'||field==='gudang'){
          if(!date(row.tanggal))fail('Tanggal riwayat lama '+where+'.'+field+' tidak valid; impor dibatalkan.');
          if(field!=='bayarJahit'&&pcs(row.jumlah,true)===null)
            fail('Jumlah riwayat lama '+where+'.'+field+' tidak valid; impor dibatalkan.');
          if(row.status!=null&&typeof row.status!=='string')
            fail('Status riwayat lama '+where+'.'+field+' tidak valid; impor dibatalkan.');
          visit(field,row);
        }
      });
    });
    records(product.arsip,where+'.arsip',true).forEach(function(archive,index){
      history(archive,where+'.arsip['+index+']',visit);
    });
  }
  function signature(field,row){
    // The legacy "jahit" action is a payment date marker, not sewn quantity.
    if(field==='bayarJahit')return JSON.stringify([field,row.tanggal]);
    return JSON.stringify([field,row.tanggal,pcs(row.jumlah,true),String(row.status||'').trim().toLowerCase()]);
  }
  function rememberIds(value,ids){
    if(!value||typeof value!=='object')return;
    if(!Array.isArray(value)&&value.id!=null)ids.add(String(value.id));
    Object.keys(value).forEach(function(key){rememberIds(value[key],ids);});
  }
  function plan(root,payload,makeId){
    // Validate the whole file before any planning or calls to the ID factory.
    var rows=validatePayload(payload);
    if(!object(root))fail('Data produksi yang sedang dibuka tidak valid.');
    if(typeof makeId!=='function')fail('Pembuat identitas entri diperlukan.');
    var value=clone(root,[]),products=value.produksi;
    if(products==null)products=[];
    if(!Array.isArray(products))fail('Daftar produksi lama harus berupa array; impor dibatalkan.');
    var bySku=new Map(),ids=new Set(),operations=[],skipped=0,created=0;
    rememberIds(value,ids);
    products.forEach(function(product,index){
      if(product==null)return;
      if(!object(product))fail('Entri produksi lama tidak valid; impor dibatalkan.');
      if(label(product.series)&&label(product.namaBarang)&&label(product.size)){
        var key=sku(product.series,product.namaBarang,product.size),matches=bySku.get(key)||[];
        matches.push({product:product,seen:new Set(),isNew:false,validated:false,index:index});bySku.set(key,matches);
      }
    });
    rows.forEach(function(row){
      var key=sku(row.series,row.namaBarang,row.size),matches=bySku.get(key)||[];
      if(matches.length>1)fail('SKU cocok dengan lebih dari satu entri produksi. Periksa duplikat sebelum impor.');
      var state=matches[0];
      if(!state){
        var product={series:row.series,namaBarang:row.namaBarang,size:row.size,poAktif:false,arsip:[]};
        fields.forEach(function(field){product[field]=[];});
        state={product:product,seen:new Set(),isNew:true,validated:true};bySku.set(key,[state]);created++;
      }
      // Preserve untouched legacy products as-is. Only histories belonging to
      // an imported SKU need interpretation and must be safe to append to.
      if(!state.validated){
        history(state.product,'produksi['+state.index+']',function(field,entry){state.seen.add(signature(field,entry));});
        state.validated=true;
      }
      var fingerprint=signature(row.field,row);
      if(state.seen.has(fingerprint)){skipped++;return;}
      // A map/legacy flag may be read for deduplication, but cannot be silently
      // replaced by an array. The operator must resolve that shape first.
      if(state.product[row.field]!=null&&!Array.isArray(state.product[row.field]))
        fail('Riwayat '+row.field+' lama bukan array; impor dibatalkan agar data lama tetap utuh.');
      state.seen.add(fingerprint);operations.push({state:state,row:row});
    });
    function nextId(){
      var id=makeId();
      if(!((typeof id==='string'&&id.trim())||(typeof id==='number'&&Number.isSafeInteger(id)))||ids.has(String(id)))
        fail('Identitas entri baru kosong, tidak valid, atau sudah dipakai; impor dibatalkan.');
      ids.add(String(id));return id;
    }
    operations.forEach(function(operation){
      var state=operation.state,row=operation.row,product=state.product;
      if(state.isNew){product.id=nextId();products.push(product);state.isNew=false;}
      var entry={id:nextId(),tanggal:row.tanggal};
      if(row.field!=='bayarJahit'){
        entry.jumlah=row.jumlah;entry.ket=row.ket;
        if(row.field==='gudang')entry.status=row.status;
      }
      if(product[row.field]==null)product[row.field]=[];
      product[row.field].push(entry);
    });
    if(operations.length)value.produksi=products;
    return {value:value,added:operations.length,skipped:skipped,created:created};
  }
  return {plan:plan};
});
