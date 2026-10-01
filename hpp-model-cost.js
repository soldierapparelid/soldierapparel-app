/* Read-only, model-level costing. This module never rewrites production or legacy HPP data. */
(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HppModelCost=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function rows(v){return (Array.isArray(v)?v:v&&typeof v==='object'?Object.values(v):[]).filter(x=>x&&typeof x==='object'&&!Array.isArray(x));}
  function norm(v){var s=String(v==null?'':v).trim();return (s.normalize?s.normalize('NFKC'):s).replace(/\s+/g,' ').toLowerCase();}
  function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
  function stable(v){return v&&typeof v==='object'?(Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}'):JSON.stringify(v);}
  function flag(v){return v===true||v===1||v==='true';}
  function ignored(v){return flag(v.deleted)||flag(v.isDeleted)||!!v.deletedAt||flag(v.cancelled)||flag(v.canceled)||!!v.cancelledAt||!!v.canceledAt||flag(v.void)||flag(v.voided)||!!v.voidedAt||/^(deleted|cancelled|canceled|dihapus|dibatalkan|batal|void|voided)$/.test(norm(v.status));}
  function number(v){if(v==null||typeof v==='boolean'||String(v).trim()==='')return null;var n=Number(v);return Number.isFinite(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER?n:null;}
  function warn(out,text){if(!out.includes(text))out.push(text);}
  function unit(v){var n=norm(v);return {kg:'kg',kilogram:'kg',yd:'yard',yard:'yard',yards:'yard',m:'meter',meter:'meter',metre:'meter'}[n]||null;}
  function legacyId(p){return p.id!=null?String(p.id):(p.series||'')+'_'+(p.namaBarang||'')+'_'+(p.size||'');}
  // URL-safe UTF-8 base64, without browser/Node dependencies or hash collisions.
  function modelId(series,name){var raw=encodeURIComponent(JSON.stringify([norm(series),norm(name)])),bytes=[],abc='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',out='model_';for(var i=0;i<raw.length;i++){if(raw[i]==='%'){bytes.push(parseInt(raw.slice(i+1,i+3),16));i+=2;}else bytes.push(raw.charCodeAt(i));}for(var j=0;j<bytes.length;j+=3){var a=bytes[j],b=bytes[j+1],c=bytes[j+2];out+=abc[a>>2]+abc[((a&3)<<4)|((b||0)>>4)];if(b!==undefined)out+=abc[((b&15)<<2)|((c||0)>>6)];if(c!==undefined)out+=abc[c&63];}return out;}
  function materialRows(e){if(rows(e.bahanList).length)return rows(e.bahanList);return e.jenisBahan?[{jenis:e.jenisBahan,kg:e.kiloan,unit:e.unit}]:[];}
  function cycles(p){return [{source:'current',value:p}].concat(rows(p.arsip).filter(a=>!ignored(a)).map((a,i)=>({source:'archive:'+i,value:a})));}
  function costSignature(e,field){if(field!=='potong')return stable(e);return stable({tanggal:e.tanggal,jumlah:e.jumlah,tukangId:e.tukangId,cuttingPlanId:e.cuttingPlanId,materialBatchId:e.materialBatchId,materialAllocation:e.materialAllocation,bahan:materialRows(e),rols:rows(e.rols)});}
  function ledger(members,field,warnings,signature){
    var out=[],globalIds=new Map();
    members.forEach(p=>{
      var seen=new Map(),fingerprints=new Map(),history=cycles(p),tombstones=new Set();
      history.forEach(c=>rows(c.value[field]).forEach(e=>{if(ignored(e)&&e.id!=null)tombstones.add(String(e.id));}));
      history.forEach(c=>{
        var source=c.value[field];
        if(source!=null&&(typeof source!=='object'||(Array.isArray(source)?source:Object.values(source)).some(e=>e!=null&&(typeof e!=='object'||Array.isArray(e)))))warn(warnings,'Ada rincian '+field+' yang tidak terbaca lengkap.');
        rows(source).filter(e=>!ignored(e)&&!(e.id!=null&&tombstones.has(String(e.id)))).forEach(e=>{
          var id=e.id!=null&&String(e.id)!==''?String(e.id):'',sig=(signature||costSignature)(e,field),prev=id&&seen.get(id);
          if(prev){if(prev.sig!==sig)warn(warnings,'Ada catatan '+field+' dengan identitas sama tetapi isi berbeda; periksa Laporan Produksi.');return;}
          if(id){seen.set(id,{sig});var owner=globalIds.get(id);if(owner&&owner!==p)warn(warnings,'Identitas catatan '+field+' dipakai pada lebih dari satu ukuran.');globalIds.set(id,p);}
          var fp=fingerprints.get(sig);
          if(fp&&fp.source!==c.source&&(!id||!fp.id))warn(warnings,'Riwayat '+field+' lama mungkin tersalin di arsip tanpa identitas; belum dapat dipastikan.');
          fingerprints.set(sig,{source:c.source,id});out.push({entry:e,product:p,archived:c.source!=='current'});
        });
      });
    });
    return out;
  }
  function groupProducts(input,options){options=options||{};var list=rows(input&&input.produksi?input.produksi:input),plans=rows(options.cuttingPlans||(input&&!Array.isArray(input)&&input.cuttingPlans)),groups=new Map(),ids=new Map();list.filter(p=>!ignored(p)).forEach(p=>{var id=modelId(p.series,p.namaBarang);if(!groups.has(id))groups.set(id,{id,series:String(p.series||'').trim(),namaBarang:String(p.namaBarang||'').trim(),sizes:[],members:[],potong:[],warnings:[],cuttingPlans:plans,plansKnown:options.plansKnown===true||Object.prototype.hasOwnProperty.call(options,'cuttingPlans')||!!(input&&!Array.isArray(input)&&Object.prototype.hasOwnProperty.call(input,'cuttingPlans'))});var m=groups.get(id);m.members.push(p);if(p.size!=null&&!m.sizes.includes(String(p.size)))m.sizes.push(String(p.size));if(p.id!=null){var old=ids.get(String(p.id));if(old)warn(m.warnings,'Identitas produk ganda; periksa daftar produksi.');ids.set(String(p.id),p);}if(!norm(p.namaBarang))warn(m.warnings,'Nama model belum tersedia.');});groups.forEach(m=>{m.ledger=ledger(m.members,'potong',m.warnings);m.potong=m.ledger.map(x=>x.entry);m.sizes.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));var offline=new Map();m.ledger.forEach(x=>{var p=x.product,e=x.entry;if(!p._offlineOrderId||e.materialBatchId)return;var fp=stable([p._offlineOrderId,e.tanggal,e.tukangId,materialRows(e)]);if(!offline.has(fp))offline.set(fp,new Set());offline.get(fp).add(p);});if([...offline.values()].some(set=>set.size>1))warn(m.warnings,'Bahan pada potongan offline lama mungkin disalin ke beberapa ukuran.');});return [...groups.values()].sort((a,b)=>(a.series+' '+a.namaBarang).localeCompare(b.series+' '+b.namaBarang));}
  function stockUnit(stock,name){var key=String(name||'').trim().toLowerCase().replace(/[\/.#$\[\]]/g,'-'),info=stock.rolInfo&&stock.rolInfo[key];return info&&!Array.isArray(info)&&info.unit?(unit(info.unit)||'invalid'):null;}
  function selectedPlanCheck(plan,cuts,warnings,inferUnit){
    var actual=new Map(),positive=[],empty=[],epsilon=0.00001;
    function invalid(text){warn(warnings,text||'Rincian pemakaian bahan per hasil belum cocok dengan jatah; periksa Laporan Produksi.');}
    function readable(value){return value==null||typeof value==='object'&&(Array.isArray(value)?value:Object.values(value)).every(v=>v==null||typeof v==='object'&&!Array.isArray(v));}
    function rollMap(value,receipt){
      var out=new Map();if(!readable(value))invalid();
      rows(value).forEach(r=>{
        var id=String(r.purchaseId==null?'':r.purchaseId).trim(),name=norm(r.jenis||r.jenisBahan),u=inferUnit(r.unit,r.jenis||r.jenisBahan),q=number(receipt&&r.kiloan!=null?r.kiloan:r.kg);
        if(!id||!name||!u||q===null||q<=0||ignored(r)||out.has(id)){invalid();return;}
        if(receipt&&r.kg!=null&&r.kiloan!=null&&(number(r.kg)===null||Math.abs(Number(r.kg)-q)>epsilon))invalid();
        out.set(id,{name,unit:u,qty:q});
      });return out;
    }
    function equal(a,b){return a.size===b.size&&[...a].every(([key,v])=>{var other=b.get(key);return other&&other.name===v.name&&other.unit===v.unit&&Math.abs(other.qty-v.qty)<=epsilon;});}
    var assigned=rollMap(plan.rolls,false),consumed=rollMap(plan.consumedRolls,false);
    if(!assigned.size||!consumed.size)invalid('Pemakaian bahan untuk hasil potong ini belum ditemukan.');
    cuts.forEach(e=>{
      if(e.materialAllocation!=='owner-plan-selected-rolls'||!String(e.materialBatchId||'').trim())invalid('Identitas pemakaian bahan per hasil tidak sesuai.');
      var current=rollMap(e.rols,true),byMaterial=new Map(),listed=new Map();
      current.forEach((r,id)=>{
        var owner=assigned.get(id),previous=actual.get(id),key=r.name+'|'+r.unit;
        if(!owner||owner.name!==r.name||owner.unit!==r.unit)invalid('Rol atau satuan bahan hasil potong tidak sesuai jatah.');
        if(previous&&(previous.name!==r.name||previous.unit!==r.unit))invalid();
        actual.set(id,{name:r.name,unit:r.unit,qty:r.qty+(previous?previous.qty:0)});
        byMaterial.set(key,(byMaterial.get(key)||0)+r.qty);
      });
      if(!readable(e.bahanList))invalid();
      materialRows(e).forEach(b=>{
        var q=number(b.kg),name=norm(b.jenis),u=inferUnit(b.unit,b.jenis);
        if(q===null||!name||!u||ignored(b)){invalid();return;}
        if(q>0){var key=name+'|'+u;listed.set(key,(listed.get(key)||0)+q);}
      });
      if(byMaterial.size!==listed.size||[...byMaterial].some(([key,q])=>Math.abs(q-(listed.get(key)||0))>epsilon))invalid('Rincian rol tidak cocok dengan jumlah bahan pada hasil potong.');
      if(e.kiloan!=null){var kg=number(e.kiloan),totalKg=[...current.values()].reduce((n,r)=>n+(r.unit==='kg'?r.qty:0),0);if(kg===null||Math.abs(kg-totalKg)>epsilon)invalid('Jumlah kilogram hasil potong tidak cocok dengan rincian rol.');}
      if(current.size)positive.push(e);else empty.push(e);
    });
    if(!equal(actual,consumed))invalid('Jumlah bahan tercatat berbeda dari pemakaian jatah per hasil.');
    consumed.forEach((r,id)=>{var owner=assigned.get(id);if(!owner||owner.name!==r.name||owner.unit!==r.unit||r.qty>owner.qty+epsilon)invalid('Pemakaian bahan melebihi atau berbeda dari jatah pemotongan.');});
    empty.forEach(e=>{
      // CuttingPlan enforces save order. Result dates can legitimately be
      // backdated, so costing only checks for a different positive batch.
      if(!positive.some(first=>first.materialBatchId!==e.materialBatchId))invalid('Pemakaian bahan pertama untuk potongan susulan belum ditemukan.');
    });
  }
  function fabric(model,purchasesOrStock){var stock=Array.isArray(purchasesOrStock)?{pembelian:purchasesOrStock}:purchasesOrStock||{},purchases=rows(stock.pembelian).filter(p=>!ignored(p)),warnings=(model.warnings||[]).slice(),detailsMap=new Map(),totalPcs=0,totalCost=0,totalKg=0,plans=new Map(),entries=model.ledger||ledger(model.members||[model],'potong',warnings);
    function inferUnit(raw,name){if(raw!=null&&String(raw).trim())return unit(raw);var declared=stockUnit(stock,name);if(declared)return declared==='invalid'?null:declared;var candidates=new Set(purchases.filter(p=>norm(p.jenisBahan)===norm(name)&&p.unit).map(p=>unit(p.unit)));if(candidates.has(null))return null;if(candidates.size===1)return [...candidates][0];if(candidates.size>1)return null;return 'kg';}
    function purchaseUnit(p){return p.unit?unit(p.unit):stockUnit(stock,p.jenisBahan)||'kg';}
    function price(p){var q=number(p.kg),r=number(p.hargaPerKg),t=number(p.total);if(q===null||q<=0)return null;if(r!==null&&r>0){if(t!==null&&Math.abs(t-q*r)>Math.max(1,q*r*0.000001))return null;return r;}return t!==null&&t>0?t/q:null;}
    function add(name,u,qty,rate,source){if(!(qty>0))return;var key=norm(name)+'|'+u,d=detailsMap.get(key);if(!d){d={jenis:name,unit:u,qty:0,kg:0,avgHarga:0,totalCost:0,priceSources:[]};detailsMap.set(key,d);}d.qty+=qty;d.kg=d.qty;if(rate!==null){d.totalCost+=qty*rate;totalCost+=qty*rate;}if(!d.priceSources.includes(source))d.priceSources.push(source);if(u==='kg')totalKg+=qty;}
    entries.forEach(({entry:e})=>{var qty=number(e.jumlah);if(qty===null||!Number.isSafeInteger(qty)||qty<=0){warn(warnings,'Ada jumlah hasil potong yang belum valid.');return;}totalPcs+=qty;if(e.cuttingPlanId){var k=String(e.cuttingPlanId);if(!plans.has(k))plans.set(k,[]);plans.get(k).push(e);}if(e.materialAllocation==='owner-plan-recorded-earlier'){if(materialRows(e).some(b=>Number(b.kg)>0)||rows(e.rols).some(r=>Number(r.kiloan==null?r.kg:r.kiloan)>0))warn(warnings,'Potongan susulan masih memiliki bahan; pemakaian perlu diperiksa.');return;}var materials=materialRows(e).filter(b=>!ignored(b));if(e.materialAllocation==='owner-plan-selected-rolls'&&!e.cuttingPlanId)warn(warnings,'Identitas jatah untuk pemakaian bahan per hasil belum tersedia.');if(e.materialAllocation==='owner-plan-selected-rolls'&&!materials.some(b=>Number(b.kg)>0)&&!rows(e.rols).some(r=>Number(r.kiloan==null?r.kg:r.kiloan)>0))return;if(!materials.length){warn(warnings,'Ada hasil potong tanpa rincian bahan.');return;}var rolls=rows(e.rols).filter(r=>!ignored(r));materials.forEach(b=>{var q=number(b.kg),u=inferUnit(b.unit,b.jenis),name=String(b.jenis||'').trim();if(!name||q===null||q<=0||!u){warn(warnings,'Nama, jumlah, atau satuan bahan belum valid.');return;}var matching=rolls.filter(r=>norm(r.jenis||r.jenisBahan||'')===norm(name));var withLinks=matching.filter(r=>r.purchaseId!=null);if(withLinks.length){var total=matching.reduce((n,r)=>n+(number(r.kiloan==null?r.kg:r.kiloan)||0),0);var matchingMaterialQty=materials.filter(other=>norm(other.jenis)===norm(name)&&(inferUnit(other.unit,other.jenis)===u)).reduce((n,other)=>n+(number(other.kg)||0),0);if(materials.indexOf(b)!==materials.findIndex(other=>norm(other.jenis)===norm(name)&&inferUnit(other.unit,other.jenis)===u))return;if(Math.abs(total-matchingMaterialQty)>0.00001||withLinks.length!==matching.length){warn(warnings,'Rincian rol tidak cocok dengan jumlah bahan '+name+'.');add(name,u,matchingMaterialQty,null,'belum-lengkap');return;}matching.forEach(r=>{var rq=number(r.kiloan==null?r.kg:r.kiloan),ru=inferUnit(r.unit,name),found=purchases.filter(p=>String(p.id)===String(r.purchaseId));var p=found[0],rate=found.length===1?price(p):null;if(!p||found.length!==1||norm(p.jenisBahan)!==norm(name)||purchaseUnit(p)!==u||ru!==u||rq===null||rate===null){warn(warnings,'Harga atau satuan rol '+name+' belum dapat dicocokkan dengan pembelian.');rate=null;}add(name,u,rq||0,rate,'rol-pembelian');});}else{var found=purchases.filter(p=>norm(p.jenisBahan)===norm(name)&&purchaseUnit(p)===u),pq=0,pc=0,invalid=false;found.forEach(p=>{var pr=price(p),amount=number(p.kg);if(pr===null||amount===null){invalid=true;return;}pq+=amount;pc+=amount*pr;});var rate=!invalid&&pq>0?pc/pq:null;if(rate===null)warn(warnings,'Harga pembelian '+name+' ('+u+') belum lengkap.');add(name,u,q,rate,'rata-rata-pembelian');}});});
    plans.forEach((cuts,id)=>{var found=rows(model.cuttingPlans).filter(p=>String(p.id)===id),plan=found[0];if(!plan||found.length!==1){warn(warnings,'Status jatah bahan belum terbaca; tunggu data lengkap sebelum memakai HPP.');return;}if(plan.status!=='used')warn(warnings,plan.status==='in_progress'?'Hasil potong bertahap belum selesai; rata-rata kain masih sementara.':'Status jatah bahan tidak sesuai hasil potong.');if(plan.materialMode==='per-result-v1'){selectedPlanCheck(plan,cuts,warnings,inferUnit);return;}if(cuts.some(e=>e.materialAllocation==='owner-plan-selected-rolls'))warn(warnings,'Mode pemakaian bahan per hasil tidak cocok dengan jatah.');var initial=cuts.filter(e=>e.materialAllocation!=='owner-plan-recorded-earlier');if(!initial.length)warn(warnings,'Pemakaian bahan pertama untuk potongan susulan belum ditemukan.');if(plan.usedBatchId&&initial.some(e=>e.materialBatchId!==plan.usedBatchId))warn(warnings,'Identitas pemakaian bahan jatah tidak sesuai.');var actual=new Map(),wanted=new Map();initial.forEach(e=>rows(e.rols).forEach(r=>{var key=String(r.purchaseId)+'|'+(unit(r.unit)||'kg');actual.set(key,(actual.get(key)||0)+(number(r.kiloan==null?r.kg:r.kiloan)||0));}));rows(plan.rolls).forEach(r=>{var key=String(r.purchaseId)+'|'+(unit(r.unit)||'kg');wanted.set(key,(wanted.get(key)||0)+(number(r.kg)||0));});if(actual.size!==wanted.size||[...wanted].some(([key,value])=>Math.abs(value-(actual.get(key)||0))>0.00001))warn(warnings,'Jumlah bahan tercatat berbeda dari jatah pemotongan.');});
    plans.forEach((cuts,id)=>{var plan=rows(model.cuttingPlans).find(p=>String(p.id)===id);if(!plan||plan.status!=='used')return;var present=new Set(entries.filter(x=>String(x.entry.cuttingPlanId)===id&&number(x.entry.jumlah)>0).map(x=>String(x.product.id)));if(rows(plan.products).some(ref=>!present.has(String(ref.id))))warn(warnings,'Ada ukuran dari jatah selesai yang hasil potongnya belum ditemukan.');});
    if(!totalPcs)warn(warnings,'Belum ada jumlah hasil potong untuk model ini.');if(!detailsMap.size)warn(warnings,'Belum ada biaya kain yang dapat dihitung.');if(!Number.isFinite(totalCost)||totalCost>Number.MAX_SAFE_INTEGER||!Number.isSafeInteger(totalPcs)){warn(warnings,'Nilai biaya atau jumlah pcs melebihi batas perhitungan.');totalCost=0;}
    var details=[...detailsMap.values()].map(d=>Object.assign(d,{avgHarga:d.qty?d.totalCost/d.qty:0,priceSource:d.priceSources.join(', ')}));return {perPcs:totalPcs?totalCost/totalPcs:0,totalCost,totalPcs,totalKg,details,complete:warnings.length===0,warnings};
  }
  function config(model,hppData){var data=hppData||{},direct=data.modelConfigs&&data.modelConfigs[model.id];if(direct&&typeof direct==='object')return {value:clone(direct),source:'model',complete:true,warnings:[]};var configs=(model.members||[]).map(p=>data.configs&&data.configs[legacyId(p)]).filter(c=>c&&typeof c==='object');if(!configs.length)return {value:null,source:'none',complete:false,warnings:[]};if(new Set(configs.map(stable)).size>1)return {value:null,source:'legacy-conflict',complete:false,warnings:['Pengaturan HPP lama berbeda antarukuran. Tetapkan biaya model sekali; data lama tetap disimpan.']};return {value:clone(configs[0]),source:'legacy-compatible',complete:true,warnings:[]};}
  function cutting(model,meta){
    var warnings=[],totalCost=0,totalPcs=0,details=[],sources=new Set();
    meta=meta||{};
    // Match Potong Command's precedence exactly: full name, shorter prefixes,
    // then its legacy sanitized/raw series|name override. Never match by size.
    function currentRate(p){
      var name=String(p.namaBarang||'').trim(),words=name.split(/\s+/),keys=name?[name]:[];
      for(var i=words.length-1;i>=1;i--)keys.push(words.slice(0,i).join(' '));
      for(var key of keys){var value=number((meta.tarifJenis||{})[key]);if(value!==null&&value>0)return value;}
      var raw=(p.series||'')+'|'+(p.namaBarang||''),safe=raw.replace(/[.#$\/\[\]]/g,'_');
      var legacy=number((meta.tarif||{})[safe]||(meta.tarif||{})[raw]);
      return legacy!==null&&legacy>0?legacy:null;
    }
    var cuts=ledger(model.members||[model],'potong',warnings,e=>stable({cut:costSignature(e,'potong'),tarif:e.tarif,total:e.total}));
    cuts.forEach(({entry:e,product:p})=>{
      var q=number(e.jumlah),rate=number(e.tarif),total=number(e.total),cost=null,source='';
      if(q===null||!Number.isSafeInteger(q)||q<=0){warn(warnings,'Jumlah hasil potong belum valid untuk menghitung upah.');return;}
      totalPcs+=q;
      if((e.tarif!=null&&rate===null)||(e.total!=null&&total===null)){
        warn(warnings,'Tarif atau total upah potong tercatat tidak valid; periksa Potong Command.');
      }else if(total!==null&&total>0){
        if(rate!==null&&rate>0&&Math.abs(total-q*rate)>Math.max(1,Math.abs(q*rate)*0.000001))warn(warnings,'Total upah potong berbeda dari jumlah pcs × tarif; periksa Potong Command.');
        else {cost=total;source='total-tercatat';}
      }else if(rate!==null&&rate>0){
        if(total===0)warn(warnings,'Tarif potong ada tetapi total upah tercatat nol; periksa Potong Command.');
        else {cost=q*rate;source='tarif-tercatat';}
      }else{
        var current=currentRate(p);
        if(current!==null){cost=q*current;source='tarif-saat-ini';}
        else warn(warnings,'Tarif potong belum tersedia untuk '+String(p.namaBarang||'model ini')+'. Isi tarif di Potong Command.');
      }
      if(cost!==null){
        if(!Number.isFinite(cost)||cost>Number.MAX_SAFE_INTEGER)warn(warnings,'Nilai upah potong melebihi batas perhitungan.');
        else {totalCost+=cost;sources.add(source);details.push({tanggal:e.tanggal||'',size:p.size||'',jumlah:q,tarif:cost/q,totalCost:cost,source});}
      }
    });
    if(!totalPcs)warn(warnings,'Belum ada hasil potong untuk menghitung rata-rata upah.');
    if(!Number.isSafeInteger(totalPcs)||!Number.isFinite(totalCost)||totalCost>Number.MAX_SAFE_INTEGER){warn(warnings,'Jumlah atau biaya potong melebihi batas perhitungan.');totalCost=0;}
    var source=sources.has('tarif-saat-ini')?(sources.size>1?'Upah tercatat + perkiraan tarif Potong saat ini':'Perkiraan tarif Potong Command saat ini'):
      sources.has('total-tercatat')?'Upah potong tercatat · rata-rata seluruh hasil':sources.has('tarif-tercatat')?'Tarif potong tercatat · rata-rata seluruh hasil':'Belum ada biaya potong';
    return {perPcs:totalPcs?totalCost/totalPcs:0,totalCost,totalPcs,complete:!!totalPcs&&!warnings.length,warnings,source,details};
  }
  function sewing(model,workers){
    var warnings=[],list=rows(workers&&workers.tukangJahit?workers.tukangJahit:workers).filter(w=>!ignored(w));
    function rate(w,p){if(!w||!w.tarif)return null;var raw=(p.series||'')+'|'+(p.namaBarang||''),safe=raw.replace(/[.#$\/\[\]]/g,'_'),v=number(w.tarif[safe]!==undefined?w.tarif[safe]:w.tarif[raw]);return v!==null&&v>0?v:null;}
    var assignments=[];
    (model.members||[]).filter(p=>p.arsip!==true||flag(p.poAktif)).forEach(p=>{
      var seen=new Map();
      rows(p.assignJahit).filter(a=>!ignored(a)).forEach(a=>{
        var q=number(a.qty),id=a.id!=null?String(a.id):'',previous=id&&seen.get(id);
        if(q===null||!Number.isSafeInteger(q)){warn(warnings,'Jumlah penugasan jahit belum valid.');return;}
        if(previous){if(stable(previous)!==stable(a))warn(warnings,'Identitas penugasan jahit ganda dengan isi berbeda.');return;}
        if(id)seen.set(id,a);
        if(q>0)assignments.push({p,a});
      });
    });
    var totalCost=0,totalPcs=0;
    if(assignments.length){assignments.forEach(({p,a})=>{var matches=list.filter(w=>String(w.id)===String(a.tukangId)),r=matches.length===1?rate(matches[0],p):null,q=number(a.qty);if(r===null)warn(warnings,'Tarif jahit saat ini belum tersedia untuk semua penugasan model.');else totalCost+=r*q;totalPcs+=q;});return {perPcs:totalPcs?totalCost/totalPcs:0,totalCost,totalPcs,complete:!warnings.length,warnings,source:'Tarif jahit saat ini · rata-rata sesuai jumlah penugasan'};}
    var rates=[];list.forEach(w=>{var values=new Set((model.members||[model]).map(p=>rate(w,p)).filter(v=>v!==null));if(values.size>1)warn(warnings,'Tarif nama model yang sama berbeda; periksa tarif jahit.');values.forEach(v=>rates.push(v));});if(rates.length){if(new Set(rates).size>1)warn(warnings,'Tarif berbeda antarpenjahit. Pilih biaya jahit model sebelum memakai rekomendasi.');return {perPcs:warnings.length?0:rates[0],totalCost:0,totalPcs:0,complete:!warnings.length,warnings,source:'Tarif jahit saat ini'};}
    var historic=ledger(model.members||[model],'jahit',warnings);historic.forEach(({entry:e})=>{var q=number(e.jumlah),r=number(e.tarif);if(q===null||q<=0||r===null||r<=0){warn(warnings,'Tarif atau jumlah pada riwayat jahit belum lengkap.');return;}totalCost+=q*r;totalPcs+=q;});if(!totalPcs)warn(warnings,'Tarif jahit belum tersedia; isi biaya jahit per pcs.');return {perPcs:totalPcs?totalCost/totalPcs:0,totalCost,totalPcs,complete:!!totalPcs&&!warnings.length,warnings,source:totalPcs?'Riwayat tarif jahit · bukan tarif terbaru':'Belum ada tarif jahit'};
  }
  return {groupProducts,fabric,config,sewing,cutting,modelId,norm};
});
