/* Pure Shopee CSV reader. Never writes storage, changes a report, or joins rows.
 *
 * Numeric policy: currency/count columns interpret a single separator followed
 * by exactly three digits as grouping (Indonesian integer exports). Ratio
 * columns interpret it as a decimal. number(value) without a kind returns null
 * for that ambiguous spelling. Rp/IDR explicitly selects Indonesian currency.
 * Thus Rp2.878.190, Rp 1.234,56, 1,234.56 and 1984.5 are supported without
 * indiscriminately deleting punctuation. Missing/invalid values remain null.
 * parseErrors blocks analysis for structural, identity, or core spend/revenue/
 * sold-unit problems. Invalid optional settings and auxiliary metrics instead
 * stay null/unknown with settingWarnings (also copied to report warnings).
 * A caller may use explicitly reviewed settings without rewriting source data;
 * imported ROAS/CTR never substitutes for ROAS computed from revenue and spend.
 *
 * identity(ad) prefers an export ad ID. Its fallback is the EXACT trimmed
 * product code + ad name; names are never case-folded or stripped of punctuation.
 * No row number, order, spend, budget or bidding mode participates in identity.
 * The fallback cannot distinguish two ads with the same code/name. parse()
 * flags such duplicates and callers must not auto-join or persist an association
 * for colliding identities. identity() returns null without an ID or full pair.
 */
(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RoasCSV=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  function clean(value){return value==null?'':String(value).trim();}
  function normalized(value){
    var text=clean(value);
    if(text.normalize)text=text.normalize('NFKC');
    return text.toLowerCase().replace(/[\s_\-()[\]{}:/.%]+/g,'').replace(/\uFEFF/g,'');
  }
  function missing(value){return /^(?:-|--|\u2013|\u2014|n\/?a|null|none|tidak tersedia|not available)?$/i.test(clean(value));}
  function uniquePush(list,value){if(list.indexOf(value)<0)list.push(value);}
  function validNumber(value){return typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER;}

  function number(value,options){
    options=options||{};
    if(typeof value==='number')return validNumber(value)?value:null;
    if(typeof value!=='string'||missing(value))return null;
    var text=clean(value),kind=options.kind||'',rupiah=/^(?:rp\.?|idr)\s*/i.test(text);
    if(/%/.test(text)&&(kind==='currency'||kind==='count'||rupiah))return null;
    text=text.replace(/^(?:rp\.?|idr)\s*/i,'').replace(/\s*%$/,'').trim();
    if(!text||/\s/.test(text)||!/^[-+]?\d+(?:[.,]\d+)*$/.test(text))return null;
    var sign='';
    if(/^[+-]/.test(text)){sign=text[0];text=text.slice(1);}
    var dots=(text.match(/\./g)||[]).length,commas=(text.match(/,/g)||[]).length,result;
    if(dots&&commas){
      var decimal=text.lastIndexOf('.')>text.lastIndexOf(',')?'.':',';
      if(rupiah&&decimal!==',')return null;
      var grouping=decimal==='.'?',':'.',parts=text.split(decimal);
      if(parts.length!==2||!parts[1]||!/^\d+$/.test(parts[1]))return null;
      var escaped=grouping==='.'?'\\.':',';
      if(!(new RegExp('^\\d{1,3}(?:'+escaped+'\\d{3})+$')).test(parts[0]))return null;
      result=Number(sign+parts[0].split(grouping).join('')+'.'+parts[1]);
    }else if(dots||commas){
      var separator=dots?'.':',',pieces=text.split(separator);
      if(pieces.length>2){
        if(rupiah&&separator!=='.')return null;
        if(pieces[0].length>3||pieces.slice(1).some(function(p){return p.length!==3;}))return null;
        result=Number(sign+pieces.join(''));
      }else{
        var grouped=pieces[0].length<=3&&pieces[1].length===3;
        if(rupiah&&separator==='.'){if(!grouped)return null;result=Number(sign+pieces.join(''));}
        else if(rupiah&&separator===',')result=Number(sign+pieces[0]+'.'+pieces[1]);
        else if(grouped){
          if(kind==='currency'||kind==='count')result=Number(sign+pieces.join(''));
          else if(kind==='ratio')result=Number(sign+pieces[0]+'.'+pieces[1]);
          else return null;
        }else result=Number(sign+pieces[0]+'.'+pieces[1]);
      }
    }else result=Number(sign+text);
    return validNumber(result)?result:null;
  }

  var aliases={
    urutan:['Urutan','No','Nomor','No.','Sequence','Row'],
    nama:['Nama Iklan','Nama Kampanye','Ad Name','Campaign Name'],
    status:['Status','Status Iklan','Status Kampanye','Ad Status','Campaign Status'],
    kode:['Kode Produk','ID Produk','SKU','Product Code','Product ID','Item ID','Item Code'],
    adId:['ID Iklan','ID Kampanye','Ad ID','Campaign ID'],
    dilihat:['Dilihat','Jumlah Dilihat','Tayangan','Jumlah Tayangan','Impressions','Impression','Views'],
    klik:['Jumlah Klik','Klik','Clicks','Click'],
    ctr:['Persentase Klik','Rasio Klik','CTR','Click Through Rate','Click Through Rate (CTR)'],
    konversi:['Konversi','Jumlah Konversi','Total Konversi','Conversions','Orders','Total Orders','Total Conversions'],
    konversiL:['Konversi Langsung','Jumlah Konversi Langsung','Direct Conversions','Direct Orders'],
    terjual:['Produk Terjual','Jumlah Produk Terjual','Total Produk Terjual','Items Sold','Units Sold','Total Items Sold','Total Units Sold'],
    terjualL:['Terjual Langsung','Produk Terjual Langsung','Jumlah Produk Terjual Langsung','Direct Items Sold','Direct Units Sold'],
    omzet:['Omzet Penjualan','Omset Penjualan','Total Omzet Penjualan','Penjualan','Penjualan Total','Total Penjualan','GMV','Revenue','Sales','Sales Revenue','Total Sales','Total Revenue'],
    omzetL:['Omzet Penjualan Langsung','Omset Penjualan Langsung','Penjualan Langsung','Total Penjualan Langsung','Direct GMV','Direct Revenue','Direct Sales','Direct Sales Revenue'],
    biaya:['Biaya','Biaya Iklan','Total Biaya','Pengeluaran','Spend','Ad Spend','Spending','Expense','Expenses','Cost','Total Spend'],
    roas:['ROAS','Efektivitas Iklan','Efektifitas Iklan','Efektivitas Iklan (ROAS)','Efektifitas Iklan (ROAS)','Return On Ad Spend','Return On Advertising Spend','Total ROAS'],
    roasL:['ROAS Langsung','Efektivitas Langsung','Efektifitas Langsung','Efektivitas Iklan Langsung','Efektifitas Iklan Langsung','Direct ROAS','Direct Return On Ad Spend'],
    acos:['ACOS','Advertising Cost Of Sales','Persentase Biaya Iklan terhadap Penjualan'],
    dailyBudget:['Anggaran Harian','Budget Harian','Bujet Harian','Modal Harian','Batas Anggaran Harian','Daily Budget','Daily Ad Budget'],
    targetRoas:['Target ROAS','ROAS Target','ROAS Sasaran','Target Efektivitas Iklan','Target Efektifitas Iklan','Target Return On Ad Spend'],
    biddingMode:['Metode Penawaran','Strategi Penawaran','Mode Penawaran','Jenis Penawaran','Tipe Penawaran','Jenis Iklan','Tipe Iklan','Mode Iklan','Bidding Mode','Bidding Strategy','Bid Strategy','Bidding Method','Ad Type','Campaign Type']
  };
  var headerNames=Object.create(null);
  Object.keys(aliases).forEach(function(key){aliases[key].forEach(function(alias){headerNames[normalized(alias)]=key;});});
  function headerField(value){
    var key=normalized(value).replace(/(?:rp|idr)$/,'');
    if(headerNames[key])return headerNames[key];
    if(/(?:langsun[g]?|direct)/.test(key)){
      if(/roas$/.test(key)||/^efekti[fv]itas(?:iklan)?langsung/.test(key))return 'roasL';
      if(/acos/.test(key))return null;
    }
    if(/acos$/.test(key))return 'acos';
    if(/^(?:efektivitasiklan|efektifitasiklan)(?:roas)?$/.test(key))return 'roas';
    return null;
  }

  // Tokenize complete text so delimiters and newlines inside quotes are data.
  function tokenize(text,delimiter){
    var rows=[],fields=[],field='',quoted=false,closed=false,errors=[],line=1,startLine=1;
    function finishField(){fields.push(field);field='';closed=false;}
    function finishRow(){finishField();rows.push({fields:fields,line:startLine,errors:errors});fields=[];errors=[];}
    for(var i=0;i<text.length;i++){
      var ch=text[i];
      if(quoted){
        if(ch==='"'){
          if(text[i+1]==='"'){field+='"';i++;}
          else{quoted=false;closed=true;}
        }else if(ch==='\r'||ch==='\n'){
          if(ch==='\r'&&text[i+1]==='\n')i++;
          field+='\n';line++;
        }else field+=ch;
      }else if(ch===delimiter)finishField();
      else if(ch==='\r'||ch==='\n'){
        finishRow();
        if(ch==='\r'&&text[i+1]==='\n')i++;
        line++;startLine=line;
      }else if(ch==='"'){
        if(!closed&&field.trim()===''){field='';quoted=true;}
        else{field+=ch;uniquePush(errors,'Tanda kutip CSV tidak valid.');}
      }else if(closed){
        if(!/\s/.test(ch)){field+=ch;uniquePush(errors,'Ada teks setelah tanda kutip penutup CSV.');}
      }else field+=ch;
    }
    if(quoted)uniquePush(errors,'Tanda kutip CSV belum ditutup.');
    if(field!==''||fields.length||errors.length)finishRow();
    return rows;
  }
  function findHeader(rows){
    var best=null;
    rows.forEach(function(row,index){
      var map=Object.create(null),duplicates=[];
      row.fields.forEach(function(value,column){
        var field=headerField(value);
        if(field){if(map[field]!==undefined)uniquePush(duplicates,field);else map[field]=column;}
      });
      var keys=Object.keys(map),score=keys.length;
      // A name plus any other recognized column accepts small valid exports.
      if(map.nama!==undefined&&score>=2&&(!best||score>best.score))best={index:index,map:map,duplicates:duplicates,score:score};
    });
    return best;
  }
  function periodFromRows(rows,headerIndex){
    var period='',start='',end='';
    rows.slice(0,headerIndex<0?rows.length:headerIndex).forEach(function(row){
      var label=normalized(row.fields[0]);
      if(/^(?:periode|period|daterange|rentangtanggal|reportingperiod|periodeiklan|reportperiod)$/.test(label)){
        var value=row.fields.slice(1).map(clean).filter(Boolean).join(' - ');
        if(value)period=value;
      }else if(/^(?:tanggalmulai|startdate|periodstart)$/.test(label))start=row.fields.slice(1).map(clean).filter(Boolean).join(' ');
      else if(/^(?:tanggalakhir|enddate|periodend)$/.test(label))end=row.fields.slice(1).map(clean).filter(Boolean).join(' ');
    });
    return period||(start&&end?start+' - '+end:'');
  }
  function mode(value){
    var text=normalized(value);
    if(!text)return 'unknown';
    if(/^(?:manual|manualbidding|penawaranmanual|iklanmanual|cpcmanual)$/.test(text))return 'manual';
    if(text.indexOf('gmv')>=0&&text.indexOf('roas')>=0)return 'gmv_roas';
    if(text.indexOf('gmv')>=0&&/(?:auto|otomatis)/.test(text))return 'gmv_auto';
    return 'unknown';
  }
  // Reversible UTF-8 base64url, keeping Firebase/path-unfriendly ID characters out.
  function encode(value){
    var raw=encodeURIComponent(value),bytes=[],alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',out='';
    for(var i=0;i<raw.length;i++){
      if(raw[i]==='%'){bytes.push(parseInt(raw.slice(i+1,i+3),16));i+=2;}
      else bytes.push(raw.charCodeAt(i));
    }
    for(var j=0;j<bytes.length;j+=3){
      var a=bytes[j],b=bytes[j+1],c=bytes[j+2];
      out+=alphabet[a>>2]+alphabet[((a&3)<<4)|((b||0)>>4)];
      if(b!==undefined)out+=alphabet[((b&15)<<2)|((c||0)>>6)];
      if(c!==undefined)out+=alphabet[c&63];
    }
    return out;
  }
  function identity(ad){
    if(!ad||typeof ad!=='object')return null;
    var id=clean(ad.adId),code=clean(ad.kode),name=clean(ad.nama);
    try{
      if(!missing(id))return 'ad_'+encode(id);
      if(!missing(code)&&!missing(name))return 'product_'+encode(JSON.stringify([code,name]));
    }catch(error){return null;}
    return null;
  }
  var numericFields={urutan:'count',dilihat:'count',klik:'count',ctr:'ratio',konversi:'count',konversiL:'count',terjual:'count',terjualL:'count',omzet:'currency',omzetL:'currency',biaya:'currency',roas:'ratio',roasL:'ratio',acos:'ratio'};
  var labels={biaya:'Biaya iklan',omzet:'Omzet penjualan total',terjual:'Produk terjual total',dailyBudget:'Anggaran harian',targetRoas:'Target ROAS'};
  var required=['biaya','omzet','terjual'];

  function parse(text){
    var result={period:'',ads:[],warnings:[]};
    if(typeof text!=='string'||!text.trim()){result.warnings.push('CSV kosong atau tidak dapat dibaca.');return result;}
    text=text.replace(/^\uFEFF/,'');
    var candidates=[',',';','\t'].map(function(delimiter){var rows=tokenize(text,delimiter);return {rows:rows,header:findHeader(rows)};});
    candidates.sort(function(a,b){return (b.header?b.header.score:0)-(a.header?a.header.score:0);});
    var candidate=candidates[0],header=candidate.header,rows=candidate.rows;
    result.period=periodFromRows(rows,header?header.index:-1);
    if(!header){result.warnings.push('Kolom Nama Iklan/Ad Name dan metrik iklan tidak ditemukan.');return result;}
    var map=header.map,headerRow=rows[header.index];
    header.duplicates.forEach(function(field){result.warnings.push('Kolom '+(labels[field]||field)+' muncul lebih dari sekali; nilainya perlu diperiksa.');});
    if(headerRow.errors.length)headerRow.errors.forEach(function(error){uniquePush(result.warnings,'Header: '+error);});
    required.forEach(function(field){if(map[field]===undefined)result.warnings.push('Kolom '+labels[field]+' tidak tersedia; nilainya tidak dianggap nol.');});
    var identities=Object.create(null);
    rows.slice(header.index+1).forEach(function(row){
      if(row.fields.every(function(value){return clean(value)==='';}))return;
      // Some exports repeat the table header between sections.
      if(headerField(row.fields[map.nama])==='nama'&&Object.keys(map).filter(function(key){return headerField(row.fields[map[key]])===key;}).length>=2)return;
      function cell(field){return map[field]===undefined?'':clean(row.fields[map[field]]);}
      var name=cell('nama'),code=cell('kode'),id=cell('adId');
      if(!name){uniquePush(result.warnings,'Baris '+row.line+' tidak memiliki nama iklan dan dilewati.');return;}
      if(/^(?:total|grand total|total keseluruhan|jumlah keseluruhan|semua iklan|all ads)$/i.test(name)&&missing(code)&&missing(id)){
        uniquePush(result.warnings,'Baris ringkasan '+row.line+' dilewati agar total tidak dihitung dua kali.');return;
      }
      var ad={nama:name,status:cell('status'),kode:missing(code)?'':code,adId:missing(id)?'':id,budgetMode:'unknown',dailyBudget:null,targetRoas:null,biddingMode:'unknown',parseErrors:[],settingWarnings:[]};
      function error(message){uniquePush(ad.parseErrors,message);}
      function warning(message){uniquePush(ad.settingWarnings,message);}
      row.errors.forEach(error);
      if(row.fields.length!==headerRow.fields.length)error('Jumlah kolom CSV berbeda dari header; periksa pemisah atau tanda kutip.');
      if(headerRow.errors.length)error('Header CSV memiliki tanda kutip yang tidak valid.');
      Object.keys(numericFields).forEach(function(field){
        var raw=cell(field),kind=numericFields[field],isRequired=required.indexOf(field)>=0;
        ad[field]=number(raw,{kind:kind});
        if(ad[field]!==null&&(ad[field]<0||(kind==='count'&&!Number.isInteger(ad[field]))))ad[field]=null;
        var problem=isRequired?error:warning;
        if(header.duplicates.indexOf(field)>=0){ad[field]=null;problem('Kolom '+(labels[field]||field)+' ganda dan belum dapat dipilih.');}
        else if(ad[field]===null&&(isRequired||!missing(raw)))problem((labels[field]||field)+(missing(raw)?' belum tersedia.':' tidak valid.'));
      });
      var budget=cell('dailyBudget');
      if(header.duplicates.indexOf('dailyBudget')>=0)warning('Kolom anggaran harian ganda dan belum dapat dipilih.');
      else if(/^(?:tidak terbatas|tanpa batas|tanpa batasan|unlimited|no limit|unlimited budget|tidak ada batas)$/i.test(budget))ad.budgetMode='unlimited';
      else if(!missing(budget)){
        ad.dailyBudget=number(budget.replace(/\s*(?:\/\s*hari|per\s+hari|\/\s*day|per\s+day)\s*$/i,''),{kind:'currency'});
        if(ad.dailyBudget!==null&&ad.dailyBudget>=0)ad.budgetMode='limited';
        else{ad.dailyBudget=null;warning('Anggaran harian tidak valid.');}
      }
      var target=cell('targetRoas');
      if(header.duplicates.indexOf('targetRoas')>=0)warning('Kolom target ROAS ganda dan belum dapat dipilih.');
      else if(!missing(target)){
        ad.targetRoas=number(target,{kind:'ratio'});
        if(ad.targetRoas===null||ad.targetRoas<=0){ad.targetRoas=null;warning('Target ROAS tidak valid.');}
      }
      if(header.duplicates.indexOf('biddingMode')>=0)warning('Kolom metode penawaran ganda dan belum dapat dipilih.');
      else{
        ad.biddingMode=mode(cell('biddingMode'));
        if(ad.biddingMode==='unknown'&&!missing(cell('biddingMode')))warning('Metode penawaran belum dikenali; periksa pengaturan iklan.');
      }
      if(header.duplicates.indexOf('status')>=0){ad.status='';warning('Kolom status iklan ganda; status aktif belum dapat dipastikan.');}
      ['nama','kode','adId'].forEach(function(field){if(header.duplicates.indexOf(field)>=0)error('Kolom identitas '+field+' ganda; asosiasi iklan perlu diperiksa.');});
      var key=identity(ad);
      if(key){
        if(!identities[key])identities[key]=[];
        identities[key].push(ad);
      }else uniquePush(result.warnings,'Iklan "'+name+'" belum memiliki ID iklan atau pasangan kode produk dan nama untuk identitas stabil.');
      if(ad.parseErrors.length)uniquePush(result.warnings,'Baris '+row.line+' ('+name+'): '+ad.parseErrors.join(' '));
      if(ad.settingWarnings.length)uniquePush(result.warnings,'Baris '+row.line+' ('+name+'), pengaturan/data tambahan: '+ad.settingWarnings.join(' '));
      result.ads.push(ad);
    });
    Object.keys(identities).forEach(function(key){
      if(identities[key].length<2)return;
      var message='Identitas iklan ganda; baris tidak boleh digabung atau diasosiasikan otomatis.';
      identities[key].forEach(function(ad){uniquePush(ad.parseErrors,message);});
      uniquePush(result.warnings,message+' '+identities[key].map(function(ad){return ad.nama;}).join(' / '));
    });
    if(!result.ads.length)uniquePush(result.warnings,'Tidak ada baris iklan yang dapat dibaca.');
    return result;
  }

  return {parse:parse,number:number,identity:identity};
});
