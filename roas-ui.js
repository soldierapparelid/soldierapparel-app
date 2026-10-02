/* Weekly, reviewable Shopee advice. No Shopee API calls or production/HPP writes. */
(function(root){
  'use strict';
  const KEY='sa_roas_analysis_v2', LEGACY='sa_roas_weekly';
  const E=root.RoasAdvisor,C=root.RoasCSV,$=id=>document.getElementById(id);
  const copy=x=>JSON.parse(JSON.stringify(x));
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const obj=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
  const money=x=>typeof x==='number'&&Number.isFinite(x)?'Rp '+Math.round(x).toLocaleString('id-ID'):'Belum dihitung';
  const ratio=x=>typeof x==='number'&&Number.isFinite(x)?x.toLocaleString('id-ID',{maximumFractionDigits:2})+'×':'—';
  const proposedTarget=a=>a.code==='raise_target'?Math.floor(a.suggestedTarget*100+1e-8)/100:Math.ceil(a.suggestedTarget*100-1e-8)/100;
  const finite=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=Number.MAX_SAFE_INTEGER;
  const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Jakarta'});
  const empty=()=>({version:2,reports:[],profiles:{}});
  let state=empty(),seen=null,fatal='',legacy={},legacyRaw=null,current=null,filter='all',editIndex=null,models=[];
  let seenLegacy=null,displayedCosts={};
  function note(message,error=false){const el=$('roas-message');if(el){el.textContent=message;el.className=error?'roas-notice error':'roas-notice';el.hidden=!message;}}
  function validAd(a){return obj(a)&&typeof a.nama==='string';}
  function validSnapshot(s){return obj(s)&&obj(s.cost)&&obj(s.context)&&obj(s.result)&&obj(s.result.action)&&typeof s.result.action.title==='string'&&typeof s.result.action.reason==='string'&&typeof s.reviewedAt==='string'&&typeof s.costLabel==='string'&&Array.isArray(s.models);}
  function validState(x){return obj(x)&&x.version===2&&Array.isArray(x.reports)&&obj(x.profiles)&&Object.values(x.profiles).every(obj)&&x.reports.every(r=>obj(r)&&typeof r.id==='string'&&typeof r.period==='string'&&Array.isArray(r.ads)&&r.ads.every(validAd)&&obj(r.inputs)&&Object.values(r.inputs).every(v=>obj(v)&&Array.isArray(v.models)&&v.models.every(m=>obj(m)&&typeof m.modelId==='string'&&finite(m.qty))&&obj(v.context))&&obj(r.snapshots)&&Object.values(r.snapshots).every(validSnapshot)&&Array.isArray(r.revisions)&&(r.warnings===undefined||(Array.isArray(r.warnings)&&r.warnings.every(w=>typeof w==='string'))));}
  try{
    seen=localStorage.getItem(KEY);legacyRaw=localStorage.getItem(LEGACY);seenLegacy=legacyRaw;
    if(seen!==null){const parsed=JSON.parse(seen);if(!validState(parsed))throw new Error('Format analisis tersimpan tidak dikenali.');state=parsed;}
    if(legacyRaw!==null){try{const parsed=JSON.parse(legacyRaw);if(obj(parsed))legacy=parsed;else throw new Error();}catch(_){fatal='Riwayat ROAS lama tidak dapat dibaca. Data aslinya tetap disimpan; unduh cadangan sebelum diperiksa.';}}
  }catch(error){fatal='Penyimpanan analisis perlu diperiksa. Data tidak direset. '+error.message;}
  async function persist(next){
    if(fatal)throw new Error(fatal);
    if(!root.navigator?.locks?.request)throw new Error('Browser ini belum mendukung pengaman penyimpanan antartab. Buka aplikasi melalui HTTPS di Chrome/Edge terbaru. Data lama tetap aman.');
    const expected=seen,oldLegacy=seenLegacy;
    await root.navigator.locks.request(KEY,{mode:'exclusive'},()=>{
      if(localStorage.getItem(KEY)!==expected||localStorage.getItem(LEGACY)!==oldLegacy)throw new Error('Laporan berubah di tab lain. Unduh cadangan, lalu muat ulang sebelum menyimpan.');
      const raw=JSON.stringify(next);
      localStorage.setItem(KEY,raw);
      if(localStorage.getItem(KEY)!==raw)throw new Error('Simpanan belum terkonfirmasi. Muat ulang dan periksa sebelum mencoba lagi.');
      seen=raw;state=next;
    });
  }
  function uniqueIdentity(ad){const id=C.identity(ad);return id&&current?.ads.filter(a=>C.identity(a)===id).length===1?id:null;}
  function key(ad,index){const id=uniqueIdentity(ad);return id?'ad:'+id:'row:'+index;}
  function profile(ad){const id=uniqueIdentity(ad);return id?state.profiles['ad:'+id]||{}:{};}
  function snapshot(ad,index){return current?.snapshots?.[key(ad,index)]||null;}
  function result(ad,index){return snapshot(ad,index)?.result||E.analyze({ad,cost:null,context:{}});}
  function needsReview(m){return !m.valid||['verify_settings','collect_data'].includes(m.action?.code);}
  function stamp(){return new Date().toISOString();}
  function id(){return 'roas_'+(root.crypto?.randomUUID?root.crypto.randomUUID():Date.now().toString(36)+'_'+Math.random().toString(36).slice(2));}
  async function importText(text){
    try{
      const parsed=C.parse(text);
      if(!parsed.ads.length)throw new Error(parsed.warnings?.[0]||'Tidak ada baris iklan yang dapat dibaca. Gunakan CSV laporan Shopee Ads.');
      const report={id:id(),period:parsed.period||'Periode belum diketahui',sourceCsv:String(text),ads:copy(parsed.ads),importedAt:stamp(),inputs:{},snapshots:{},revisions:[],warnings:parsed.warnings||[]};
      const next=copy(state);next.reports.push(report);await persist(next);current=report;filter='all';
      render();history();note('Laporan tersimpan di perangkat ini. Hubungkan HPP dan periksa kondisi iklan untuk mendapatkan saran.');return true;
    }catch(error){note('Belum tersimpan: '+error.message,true);return false;}
  }
  root.parseShopeeCSV=text=>C.parse(text);
  root.handleRoasCSV=function(file){if(!file)return;const reader=new FileReader();reader.onload=e=>importText(e.target.result);reader.onerror=()=>note('File belum dapat dibaca. Pilih ulang file CSV.',true);reader.readAsText(file);};
  root.setRoasFilter=function(value){filter=value;render();};
  root.calcAdMetrics=function(ad){const index=current?.ads.indexOf(ad)??-1;return index>=0?result(ad,index):E.analyze({ad,cost:null,context:{}});};
  function previous(ad){
    const ident=uniqueIdentity(ad),period=E.periodInfo(current.period,today());if(!ident||!period.start)return null;
    return allReports().filter(r=>r.id!==current.id).map(r=>({r,p:E.periodInfo(r.period,today())}))
      .filter(x=>x.p.end&&x.p.end<period.start&&x.p.days===period.days).sort((a,b)=>b.p.end.localeCompare(a.p.end))
      .map(x=>({r:x.r,ads:x.r.ads.filter(a=>C.identity(a)===ident)})).find(x=>x.ads.length===1)||null;
  }
  function allReports(){return state.reports.concat(Object.entries(legacy).filter(([,r])=>obj(r)&&Array.isArray(r.ads)&&r.ads.every(validAd)).map(([k,r])=>({id:'legacy:'+k,period:String(r.period||k),ads:r.ads,inputs:{},snapshots:{},revisions:[],legacy:true})));}
  function load(reportId){current=allReports().find(r=>r.id===reportId)||null;filter='all';render();history();}
  root.loadRoasWeek=function(period){const r=allReports().find(r=>r.id===period)||allReports().find(r=>r.period===period);if(r)load(r.id);};
  function metric(label,value){return '<div><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>';}
  function render(){
    const el=$('roas-result');if(!el)return;
    if(fatal)note(fatal,true);
    if(!current){el.innerHTML='<div class="roas-empty">Upload laporan mingguan, atau buka riwayat di bawah. Data HPP tetap diambil dari Setup HPP.</div>';return;}
    const rows=current.ads.map((ad,i)=>({ad,i,m:result(ad,i),s:snapshot(ad,i)}));
    const complete=rows.filter(x=>x.m.valid),unknown=rows.length-complete.length;
    const sum=name=>{const values=rows.map(x=>x.ad[name]);return values.every(finite)&&Number.isSafeInteger(Math.round(values.reduce((a,b)=>a+b,0)))?values.reduce((a,b)=>a+b,0):null;};
    const spend=sum('biaya'),revenue=sum('omzet'),profit=complete.reduce((s,x)=>s+x.m.profit,0);
    let h='<div class="card"><div class="roas-heading"><div><div class="model-series">EVALUASI MINGGUAN</div><h2>'+esc(current.period)+'</h2></div><button type="button" class="btn btn-outline" data-roas-backup>Unduh cadangan</button></div>';
    h+='<p class="roas-help">Angka penjualan berasal dari atribusi iklan, bukan uang bersih yang cair. Saran tidak mengubah pengaturan Shopee otomatis.</p>';
    h+='<div class="roas-top-grid">'+metric('Biaya iklan',money(spend))+metric('Penjualan iklan',money(revenue))+metric('ROAS Shopee',spend>0&&revenue!==null?ratio(revenue/spend):'—')+metric(unknown?'Perkiraan laba sebagian ('+complete.length+'/'+rows.length+' iklan)':'Perkiraan laba setelah iklan',complete.length&&Number.isSafeInteger(Math.round(profit))?money(profit):'Hubungkan HPP dahulu')+'</div>';
    h+='<div class="roas-notice">'+(unknown?unknown+' iklan belum memiliki biaya yang lengkap. Tidak dianggap nol dan tidak diberi label untung/boncos. ':'Semua iklan sudah memiliki biaya yang diperiksa. ')+'Hitungan tersimpan memakai HPP dan pengaturan saat diperiksa. Buka “Periksa / hitung ulang” untuk memperbaruinya.</div>';
    if(current.warnings?.length)h+='<details class="roas-source"><summary>Catatan file ('+current.warnings.length+')</summary>'+current.warnings.map(x=>'<p>'+esc(x)+'</p>').join('')+'</details>';
    h+='<div class="roas-filter">'+[['all','Semua'],['review','Perlu dilengkapi'],['loss','Perkiraan rugi'],['profit','Perkiraan untung']].map(([v,l])=>'<button type="button" class="'+(filter===v?'active':'')+'" data-roas-filter="'+v+'">'+l+'</button>').join('')+'</div>';
    const query=String($('roas-search')?.value||'').trim().toLocaleLowerCase('id-ID');
    const shown=rows.filter(x=>(!query||(x.ad.nama+' '+(x.ad.kode||'')).toLocaleLowerCase('id-ID').includes(query))&&(filter==='review'?needsReview(x.m):filter==='loss'?x.m.valid&&x.m.profit<0:filter==='profit'?x.m.valid&&x.m.profit>0:true));
    shown.sort((a,b)=>((a.m.valid&&a.m.profit<0)?0:needsReview(a.m)?1:2)-((b.m.valid&&b.m.profit<0)?0:needsReview(b.m)?1:2)||b.ad.biaya-a.ad.biaya);
    h+=shown.map(({ad,i,m,s})=>{
      const action=m.action||{title:'Periksa data',reason:'Lengkapi biaya dan kondisi iklan.',tone:'neutral'};
      const ctx=s?.context||{},budget=ctx.budgetMode==='unlimited'?'Tidak terbatas':ctx.budgetMode==='limited'?money(ctx.dailyBudget)+'/hari':'Belum diperiksa';
      const period=E.periodInfo(current.period,today()),age=period.end?Math.floor((Date.parse(today())-Date.parse(period.end))/86400000):null;
      const prev=previous(ad),old=prev?.ads[0],oldRoas=old&&finite(old.omzet)&&old.biaya>0?old.omzet/old.biaya:null;
      return '<article class="roas-ad"><div class="roas-heading"><div><h3>'+esc(ad.nama)+'</h3><p class="roas-help">'+esc(ad.status||'Status belum diketahui')+' · '+esc(ad.kode||ad.adId||'Tanpa kode produk')+'</p></div><span class="roas-profit '+(m.valid?(m.profit<0?'loss':'profit'):'')+'">'+(m.valid?money(m.profit):'Laba belum dihitung')+'</span></div>'+
        '<div class="roas-ad-metrics">'+metric('Biaya iklan',money(ad.biaya))+metric('Penjualan',money(ad.omzet))+metric('ROAS hasil',ratio(m.roas))+metric('ROAS impas',ratio(m.breakEvenRoas))+'</div>'+
        '<div class="roas-condition">Budget: <strong>'+esc(budget)+'</strong> · Target ROAS: <strong>'+ratio(ctx.targetRoas)+'</strong></div>'+
        '<div class="roas-advice '+(m.valid&&m.profit<0?'loss':'')+'"><strong>'+esc(action.title)+'</strong><p>'+esc(action.reason)+'</p>'+(action.suggestedTarget!=null?'<p>Target uji: <b>'+ratio(proposedTarget(action))+'</b> (bukan jaminan hasil).</p>':'')+(action.suggestedBudget!=null?'<p>Budget uji: <b>'+money(action.suggestedBudget)+'/hari</b>; tetap sesuaikan kemampuan kas.</p>':'')+'</div>'+
        (age!==null&&age>14?'<p class="roas-help roas-warn">Ini riwayat lama. Upload periode terbaru sebelum mengubah iklan.</p>':'')+
        (oldRoas!==null?'<p class="roas-help">Pembanding '+esc(prev.r.period)+': ROAS '+ratio(oldRoas)+' → '+ratio(m.roas)+'. Periode tidak tumpang tindih; perubahan biaya/produk tetap perlu diperiksa.</p>':'')+
        '<details class="roas-source"><summary>Rincian hitungan &amp; sumber HPP</summary>'+(s?'<p>Diperiksa '+esc(new Date(s.reviewedAt).toLocaleString('id-ID'))+'. '+esc(s.costLabel)+'</p>'+metric('HPP per pcs',money(s.cost.hppPerPcs))+metric('Produk terjual',ad.terjual+' pcs')+metric('Biaya marketplace ('+s.cost.feePct+'%)',money(m.feeAmount))+metric('Biaya tetap per pcs × terjual',money(m.fixedAmount))+metric('Estimasi pajak ('+s.cost.taxPct+'%)',money(m.taxAmount))+'<p>Laba perkiraan = penjualan − HPP seluruh barang terjual − biaya marketplace − biaya tetap − estimasi pajak − iklan. ROAS impas = penjualan ÷ sisa sebelum biaya iklan; bukan target yang pasti tercapai.</p>':'<p>Belum ada HPP yang dicocokkan dengan barang terjual. Rata-rata seluruh model tidak dipakai.</p>')+'</details>'+
        '<button type="button" class="btn btn-accent" data-roas-edit="'+i+'">'+(s?'Periksa / hitung ulang':'Hubungkan HPP & kondisi')+'</button></article>';
    }).join('');
    h+=(!shown.length?'<p class="roas-empty">Tidak ada iklan pada filter ini.</p>':'')+'<details class="roas-source"><summary>Cara membaca saran</summary><p>Boncos tidak otomatis berarti target ROAS harus diturunkan. Target lebih rendah dapat memperbesar belanja. Cek ROAS impas dan biaya produk terlebih dahulu.</p><p>Uji perubahan hanya ditampilkan setelah periode minimal 7 hari selesai, kondisi stabil diperiksa, dan biaya cocok. Uji perubahan target membutuhkan minimal 10 pcs terjual. Untuk memperbesar iklan, aplikasi juga memerlukan selisih margin minimal 5 poin di atas batas pilihanmu; ini aturan aplikasi, bukan jaminan statistik atau ketentuan Shopee.</p><p>Budget tidak terbatas tidak akan mendapat saran menaikkan budget. Hasil tetap perkiraan: pesanan batal/retur, biaya yang belum tercatat, dan kompensasi iklan belum dikoreksi otomatis.</p><p><a href="https://iklan.shopee.co.id/learn/faq/555/2031" target="_blank" rel="noopener">Panduan GMV Max resmi Shopee</a></p></details></div>';
    el.innerHTML=h;
    el.querySelectorAll('[data-roas-edit]').forEach(b=>b.onclick=()=>openEditor(Number(b.dataset.roasEdit)));
    el.querySelectorAll('[data-roas-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.roasFilter;render();});
    el.querySelectorAll('[data-roas-backup]').forEach(b=>b.onclick=backup);
  }
  function history(){
    const section=$('roas-history-section'),el=$('roas-history-list');if(!section||!el)return;
    const reports=allReports().sort((a,b)=>String(b.importedAt||'').localeCompare(String(a.importedAt||'')));
    section.style.display=reports.length?'block':'none';
    el.innerHTML=reports.map(r=>'<button type="button" class="roas-history-item" data-roas-report="'+esc(r.id)+'"><span><b>'+esc(r.period)+'</b><small>'+r.ads.length+' iklan · '+(r.legacy?'riwayat lama, data tetap utuh':esc(new Date(r.importedAt).toLocaleString('id-ID')))+'</small></span><span>Buka →</span></button>').join('');
    el.querySelectorAll('[data-roas-report]').forEach(b=>b.onclick=()=>load(b.dataset.roasReport));
  }
  function field(label,id,value,type='number',extra=''){return '<label class="roas-field">'+esc(label)+'<input id="'+id+'" type="'+type+'" '+(type==='number'?'min="0" step="any"':'')+' value="'+esc(value??'')+'" '+extra+'></label>';}
  function select(label,id,value,options){return '<label class="roas-field">'+esc(label)+'<select id="'+id+'">'+options.map(([v,l])=>'<option value="'+esc(v)+'"'+(String(value)===v?' selected':'')+'>'+esc(l)+'</option>').join('')+'</select></label>';}
  function modelOptions(selected){return '<option value="">Pilih model HPP…</option>'+models.map(m=>'<option value="'+esc(m.id)+'"'+(m.id===selected?' selected':'')+'>'+esc(m.series+' · '+m.namaBarang)+'</option>').join('');}
  function modelRow(value={}){return '<div class="roas-model-row"><label class="roas-field">Model barang<select data-roas-model>'+modelOptions(value.modelId)+'</select></label><label class="roas-field">Terjual (pcs)<input type="number" min="0" step="1" data-roas-qty value="'+esc(value.qty??'')+'"></label><button type="button" class="btn btn-outline" data-roas-remove aria-label="Hapus pilihan model dari perhitungan ini">×</button><p class="roas-help" data-roas-cost></p></div>';}
  function modelValues(){return Array.from($('roas-models').querySelectorAll('.roas-model-row')).map(row=>({modelId:row.querySelector('[data-roas-model]').value,qty:Number(row.querySelector('[data-roas-qty]').value)}));}
  function costSelection(rows,sold){
    const sync=typeof hppJournal!=='undefined'&&hppJournal?hppJournal.status():null;
    if(sync&&(sync.error||sync.pending||sync.durable===false||sync.conflict||sync.detached||sync.foreignPending))throw new Error('HPP masih berupa draf atau sinkronisasinya perlu diperiksa. Selesaikan sinkronisasi HPP sebelum menghitung saran.');
    if(!rows.length)throw new Error('Pilih model dari Setup HPP terlebih dahulu.');
    if(!Number.isSafeInteger(sold)||sold<0)throw new Error('Jumlah terjual belum valid. Periksa file laporan.');
    let total=0,qty=0;const details=[],used=new Set();
    rows.forEach(row=>{
      if(used.has(row.modelId))throw new Error('Model yang sama cukup satu baris; gabungkan jumlah terjualnya.');used.add(row.modelId);
      if(!Number.isSafeInteger(row.qty)||row.qty<0||(sold>0&&row.qty===0)||(sold===0&&rows.length!==1))throw new Error('Isi jumlah terjual dengan pcs bulat sesuai laporan. Jika belum terjual, pilih satu model dengan jumlah 0.');
      const model=getHppModels().find(m=>m.id===row.modelId);if(!model)throw new Error('Model belum dipilih atau tidak tersedia di HPP.');
      const h=computeProductHpp(model);if(!h.configured||!finite(h.hppTotal))throw new Error(model.namaBarang+': HPP belum lengkap/terkonfirmasi. Lengkapi Setup HPP dahulu.');
      total+=h.hppTotal*row.qty;qty+=row.qty;details.push({modelId:model.id,nama:model.namaBarang,qty:row.qty,hppPerPcs:h.hppTotal});
    });
    if(qty!==sold)throw new Error('Jumlah model harus sama dengan '+sold+' pcs terjual pada laporan (sekarang '+qty+' pcs).');
    if(!finite(total))throw new Error('Total HPP melampaui batas aman.');
    return {hppPerPcs:sold>0?total/sold:details[0].hppPerPcs,details,label:details.map(d=>d.nama+' ('+d.qty+' pcs × '+money(d.hppPerPcs)+')').join(' + ')};
  }
  function showCosts(){
    displayedCosts={};if($('roas-cost-reviewed'))$('roas-cost-reviewed').checked=false;
    $('roas-models').querySelectorAll('.roas-model-row').forEach(row=>{
      const model=models.find(m=>m.id===row.querySelector('[data-roas-model]').value);const h=model?computeProductHpp(model):null;
      if(model)displayedCosts[model.id]=h.configured?h.hppTotal:null;
      row.querySelector('[data-roas-cost]').textContent=model?(h.configured?'HPP '+money(h.hppTotal)+'/pcs':'HPP belum siap. Lengkapi model ini di Setup HPP.'):'Harga kain, potong, jahit, dan biaya lain mengikuti model yang dipilih.';
      row.querySelector('[data-roas-remove]').onclick=()=>{row.remove();showCosts();};
      row.querySelector('[data-roas-model]').onchange=showCosts;
      row.querySelector('[data-roas-qty]').oninput=()=>{$('roas-cost-reviewed').checked=false;};
    });
  }
  function dialog(){let d=$('roas-editor');if(!d){d=document.createElement('dialog');d.id='roas-editor';d.className='roas-editor';d.setAttribute('aria-labelledby','roas-editor-title');document.body.appendChild(d);}return d;}
  function openEditor(index){
    if(!current||!current.ads[index])return;editIndex=index;const ad=current.ads[index],k=key(ad,index),saved=current.inputs[k],pref=profile(ad),snap=snapshot(ad,index);
    models=getHppModels();const settings=saved||{},ctx=settings.context||{};
    const csv=(name,fallback)=>saved?fallback:ad[name]!=null&&ad[name]!=='unknown'?ad[name]:fallback;
    let rows=settings.models?.length?settings.models:[{modelId:pref.singleModelId||'',qty:ad.terjual??''}];
    const period=E.periodInfo(current.period,today()),d=dialog();
    d.innerHTML='<form id="roas-form"><div class="roas-heading"><div><div class="model-series">HPP + KONDISI IKLAN</div><h2 id="roas-editor-title">'+esc(ad.nama)+'</h2></div><button type="button" class="btn btn-outline" id="roas-close" aria-label="Tutup pemeriksaan">×</button></div>'+
      '<p class="roas-help">Cocokkan untuk periode '+esc(current.period)+'. Ini hanya analisis; tidak mengubah HPP, stok, data penjualan, atau iklan di Shopee.</p>'+
      '<section><h3>1. Barang apa yang terjual?</h3><p class="roas-help">Laporan: '+esc(ad.terjual??'belum diketahui')+' pcs. Jika satu iklan menghasilkan beberapa model/produk lain, tambahkan masing-masing dan jumlah terjualnya. Jangan memakai satu HPP untuk barang yang berbeda.</p><div id="roas-models">'+rows.map(modelRow).join('')+'</div><button type="button" class="btn btn-outline" id="roas-add-model">+ Model lain yang terjual</button></section>'+
      '<details class="roas-source"><summary>Biaya marketplace &amp; estimasi pajak</summary><p class="roas-help">Diisi dari Setting HPP, atau angka terakhir laporan ini. Cocokkan dengan potongan toko. Biaya tetap di sini per pcs, bukan per pesanan. Kompensasi iklan tidak otomatis mengurangi biaya.</p><div class="roas-form-grid">'+field('Biaya marketplace (%)','roas-fee',snap?.cost.feePct??getFee('shopee'))+field('Estimasi pajak (%)','roas-tax',snap?.cost.taxPct??getPajak())+field('Biaya tetap per pcs (Rp)','roas-fixed',snap?.cost.fixedPerPcs??getMarketplace().shopee?.fixedPerPcs??0)+'</div></details>'+
      '<label class="roas-check"><input id="roas-cost-reviewed" type="checkbox">Saya sudah cocokkan model, jumlah terjual, dan potongannya; termasuk produk lain yang teratribusi pada iklan ini.</label>'+
      '<section><h3>2. Kondisi di Shopee</h3><p class="roas-help">Kolom yang tersedia di CSV diisikan otomatis. Yang tidak ada perlu diisi dari pengaturan Shopee; aplikasi tidak dapat menebaknya.</p><div class="roas-form-grid">'+
      select('Jenis iklan','roas-mode',csv('biddingMode',ctx.biddingMode||pref.biddingMode||'unknown'),[['unknown','Belum diketahui'],['gmv_roas','GMV Max ROAS'],['gmv_auto','GMV Max Auto'],['manual','Iklan manual / lainnya']])+
      select('Modal harian','roas-budget-mode',csv('budgetMode',ctx.budgetMode||pref.budgetMode||'unknown'),[['unknown','Belum diketahui'],['unlimited','Tidak terbatas'],['limited','Ada batas harian']])+
      field('Batas harian (Rp), jika terbatas','roas-budget',csv('dailyBudget',ctx.dailyBudget??pref.dailyBudget))+
      field('Target ROAS, untuk GMV Max ROAS','roas-target',csv('targetRoas',ctx.targetRoas??pref.targetRoas))+
      select('Sering mentok batas harian?','roas-exhausted',ctx.budgetExhausted===true?'yes':ctx.budgetExhausted===false?'no':'unknown',[['unknown','Belum diperiksa'],['yes','Ya, sudah cek laporan harian'],['no','Tidak']])+
      select('Tetap selama seluruh periode laporan (≥ 7 hari)?','roas-stable','unknown',[['unknown','Belum diperiksa'],['yes','Ya, sama selama seluruh periode'],['no','Tidak / masih pembelajaran']])+'</div><label class="roas-check"><input id="roas-settings-reviewed" type="checkbox">Kondisi di atas sesuai iklan dan periode laporan ini, bukan hanya menyalin minggu lalu.</label></section>'+
      '<section><h3>3. Tujuan evaluasi</h3><div class="roas-form-grid">'+select('Tujuan','roas-goal',ctx.goal||'profit',[['profit','Jaga keuntungan dahulu'],['grow','Uji tambah penjualan bila margin cukup']])+field('Batas margin laba setelah iklan (%)','roas-margin',ctx.minMargin??10)+'</div><p class="roas-help">Batas awal 10% adalah asumsi yang bisa kamu ubah, bukan janji keuntungan. Saran memperbesar iklan memerlukan margin di atas batas ini.</p></section>'+
      '<details class="roas-source"><summary>Periksa tanggal periode</summary><div class="roas-form-grid">'+field('Tanggal awal','roas-start',period.start||settings.start||'','date',period.start?'readonly':'')+field('Tanggal akhir','roas-end',period.end||settings.end||'','date',period.end?'readonly':'')+'</div><p class="roas-help">Tanggal harus sama dengan file. Periode yang masih mencakup hari ini belum dianggap selesai.</p>'+(!period.start?'<label class="roas-check"><input type="checkbox" id="roas-period-reviewed">Saya sudah cocokkan kedua tanggal dengan periode pada file Shopee.</label>':'')+'</details>'+
      '<p id="roas-editor-message" class="roas-notice error" hidden role="status"></p><div class="roas-editor-actions"><button type="submit" class="btn btn-accent">Simpan pemeriksaan &amp; lihat saran</button><button type="button" class="btn btn-outline" id="roas-cancel">Batal</button></div></form>';
    $('roas-close').onclick=$('roas-cancel').onclick=()=>d.close();$('roas-add-model').onclick=()=>{$('roas-models').insertAdjacentHTML('beforeend',modelRow());showCosts();};
    $('roas-form').onsubmit=e=>{e.preventDefault();saveEditor();};showCosts();
    ['roas-fee','roas-tax','roas-fixed'].forEach(id=>{$(id).oninput=()=>{$('roas-cost-reviewed').checked=false;};});
    const condition=()=>{$('roas-budget').disabled=$('roas-budget-mode').value!=='limited';$('roas-exhausted').disabled=$('roas-budget-mode').value!=='limited';$('roas-target').disabled=$('roas-mode').value!=='gmv_roas';};
    $('roas-budget-mode').onchange=$('roas-mode').onchange=condition;condition();
    if(!d.open)d.showModal();
  }
  function number(id){const value=$(id).value.trim();return value===''?null:Number(value);}
  async function saveEditor(){
    try{
      if(editIndex===null||!current)throw new Error('Pilih iklan dahulu.');
      const ad=current.ads[editIndex],k=key(ad,editIndex),chosen=costSelection(modelValues(),ad.terjual);
      if(chosen.details.some(d=>displayedCosts[d.modelId]!==d.hppPerPcs)){showCosts();throw new Error('HPP berubah setelah formulir dibuka. Harga sudah diperbarui; periksa lalu konfirmasi biaya kembali.');}
      if(!$('roas-cost-reviewed').checked)throw new Error('Cocokkan model dan biaya, lalu centang konfirmasi biaya.');
      const cost={hppPerPcs:chosen.hppPerPcs,feePct:number('roas-fee'),taxPct:number('roas-tax'),fixedPerPcs:number('roas-fixed'),reviewed:true};
      const period=E.periodInfo($('roas-start').value+' - '+$('roas-end').value,today());
      const originalPeriod=E.periodInfo(current.period,today());
      if(!period.start||!period.end)throw new Error('Lengkapi tanggal periode yang valid sesuai file.');
      if(originalPeriod.start&&(originalPeriod.start!==period.start||originalPeriod.end!==period.end))throw new Error('Tanggal periode tidak sama dengan laporan CSV. Upload file untuk periode yang benar.');
      if(!originalPeriod.start&&!$('roas-period-reviewed')?.checked)throw new Error('Konfirmasi tanggal sesuai file karena periode CSV belum dikenali.');
      const context={days:period.days,complete:period.complete,settingsVerified:$('roas-settings-reviewed').checked,settingsStable:$('roas-stable').value==='yes',biddingMode:$('roas-mode').value,budgetMode:$('roas-budget-mode').value,dailyBudget:$('roas-budget-mode').value==='limited'?number('roas-budget'):null,targetRoas:$('roas-mode').value==='gmv_roas'?number('roas-target'):null,budgetExhausted:$('roas-exhausted').value==='yes'?true:$('roas-exhausted').value==='no'?false:null,goal:$('roas-goal').value,minMargin:number('roas-margin')};
      const computed=E.analyze({ad,cost,context});if(!computed.valid)throw new Error(computed.errors?.join(' ')||computed.action?.reason||'Periksa biaya dan data.');
      const report=copy(current);if(report.legacy){report.id=id();report.importedAt=stamp();report.sourceLegacyId=current.id;delete report.legacy;}
      const old=report.snapshots[k];if(old)report.revisions.push({adKey:k,snapshot:old,input:report.inputs[k]});
      report.inputs[k]={models:chosen.details.map(d=>({modelId:d.modelId,qty:d.qty})),context,start:period.start,end:period.end};
      report.snapshots[k]={reviewedAt:stamp(),costLabel:chosen.label,models:chosen.details,cost,context,result:computed};
      const next=copy(state),at=next.reports.findIndex(r=>r.id===report.id);if(at<0)next.reports.push(report);else next.reports[at]=report;
      const ident=uniqueIdentity(ad);if(ident)next.profiles['ad:'+ident]={singleModelId:chosen.details.length===1?chosen.details[0].modelId:'',biddingMode:context.biddingMode,budgetMode:context.budgetMode,dailyBudget:context.dailyBudget,targetRoas:context.targetRoas};
      await persist(next);current=report;dialog().close();editIndex=null;render();history();note('Pemeriksaan tersimpan di perangkat ini. Data HPP dan iklan Shopee tidak diubah.');return true;
    }catch(error){const el=$('roas-editor-message');if(el){el.hidden=false;el.textContent='Belum tersimpan: '+error.message;}return false;}
  }
  function backup(){
    const body=JSON.stringify({format:'soldier-roas-backup-v2',createdAt:stamp(),analysisRaw:localStorage.getItem(KEY),legacyRaw:localStorage.getItem(LEGACY)},null,2);
    const a=document.createElement('a'),url=URL.createObjectURL(new Blob([body],{type:'application/json'}));a.href=url;a.download='roas-cadangan-'+today()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  root.renderRoasResult=render;root.renderRoasHistory=history;
  root.RoasUI=Object.freeze({importText,openEditor,saveEditor,costSelection,load,backup,getCurrent:()=>current?copy(current):null,getState:()=>copy(state)});
  document.addEventListener('DOMContentLoaded',function(){const drop=$('roas-drop');if(drop){drop.addEventListener('dragover',e=>e.preventDefault());drop.addEventListener('drop',e=>{e.preventDefault();if(e.dataTransfer.files.length)root.handleRoasCSV(e.dataTransfer.files[0]);});}const b=$('roas-backup');if(b)b.onclick=backup;const search=$('roas-search');if(search)search.oninput=render;render();history();});
})(window);
