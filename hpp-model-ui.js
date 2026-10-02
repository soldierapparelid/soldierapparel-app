/* Model-only presentation adapter. Legacy per-size settings remain untouched. */
function installHppModelUI(){
  'use strict';
  if(!window.HppModelCost||!window.HppPrice)throw new Error('Modul HPP model belum termuat. Muat ulang tanpa menghapus data.');
  const C=window.HppModelCost,P=window.HppPrice,$=id=>document.getElementById(id);
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=value=>Number.isFinite(value)?rp(value):'Belum tersedia';
  const num=id=>{const s=String($(id).value).trim();return s===''?null:Number(s);};
  const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER;
  const warning=messages=>messages.length?'<div class="model-warning">'+[...new Set(messages)].map(escape).join('<br>')+'</div>':'';
  const line=(name,value)=>'<div class="model-breakdown"><span>'+escape(name)+'</span><strong>'+escape(value)+'</strong></div>';
  const platforms=[['shopee','Shopee'],['tokped','Tokopedia'],['tiktok','TikTok Shop']];
  let editing=false,editingId='',editingConfig='';
  let simDraft={key:'',value:'',entered:false};
  window.getHppModels=()=>C.groupProducts(produksiList,{cuttingPlans:hppCuttingPlans,plansKnown:hppSourceReady.plans});
  const sourceReady=()=>hppSourceReady.stok&&hppSourceReady.produksi&&hppSourceReady.plans&&hppSourceReady.workers&&hppSourceReady.cutting&&hppSourceReady.hpp&&!Object.keys(hppReadErrors).length;
  const fabric=model=>C.reference(model,{...hppStockData,pembelian:pembelianList});
  const cutting=(model,reference)=>C.cutting(model,hppPotongMeta,reference);
  const basisReviewed=(k,cfg)=>!k.basis?.excluded.length||cfg?.basisPolicy===k.basis.policy;
  function modelPhoto(model){
    const candidates=model.members.map(p=>(hppImages||{})[String(p.series+'|'+p.namaBarang).replace(/[.#$\/\[\]]/g,'_')]).concat(model.members.map(p=>p._offlineGambar));
    const src=candidates.find(x=>typeof x==='string'&&(/^(https?:\/\/|data:image\/(png|jpeg|jpg|webp|gif);base64,)/i.test(x.trim())));
    return '<div class="model-photo">'+(src?'<img data-model-photo src="'+escape(src.trim())+'" alt="'+escape(model.namaBarang)+'" loading="lazy" decoding="async" referrerpolicy="no-referrer"><span hidden>Foto tidak tersedia</span>':'<span>'+escape(hppImageError||'Belum ada foto')+'</span>')+'</div>';
  }
  const fixed=mp=>Number(getMarketplace()[mp]?.fixedPerPcs??0);
  const quote=(hpp,margin,mp,price=0)=>P.quote({hpp,margin,fee:getFee(mp),tax:getPajak(),fixed:fixed(mp),price});
  const normalize=model=>model?.members?model:getHppModels().find(m=>m.members.some(p=>getProductId(p)===getProductId(model)));
  getGroupedProducts=function(){const out=Object.create(null);getHppModels().forEach(m=>(out[m.series]||(out[m.series]=[])).push(m));return out;};
  findProductById=function(id){return getHppModels().find(m=>m.id===id)||null;};
  computeProductHpp=function(product){
    const model=normalize(product);if(!model)return {configured:false,kain:{complete:false,perPcs:null},hppTotal:null,warnings:['Model tidak ditemukan.']};
    const kain=fabric(model),potong=cutting(model,kain),ci=C.config(model,hppData),cfg=ci.value,auto=C.sewing(model,hppWorkers);
    const mode=cfg?.jahitMode||(cfg?'manual':'auto');
    const hargaJahit=mode==='auto'?(auto.complete?auto.perPcs:null):(cfg?.hargaJahit==null?null:Number(cfg.hargaJahit));
    const biayaLain=cfg?Number(cfg.biayaLain??0):0,targetMargin=cfg?Number(cfg.targetMargin??30):30;
    const warnings=[...kain.warnings,...potong.warnings,...ci.warnings];
    if(!valid(hargaJahit))warnings.push('Isi ongkos jahit per pcs, atau lengkapi tarif di aplikasi Jahit.');
    if(!sourceReady())warnings.push('Menunggu data bahan, potong, dan tarif jahit terbaru.');
    const hppTotal=kain.complete&&potong.complete&&valid(hargaJahit)&&valid(biayaLain)?kain.perPcs+potong.perPcs+hargaJahit+biayaLain:null;
    if(ci.source==='legacy-compatible')warnings.push('Biaya lama sudah diisikan. Periksa dan simpan sekali untuk semua ukuran model ini.');
    if(cfg&&cfg.costSchema!==2)warnings.push('Upah potong sekarang otomatis. Periksa biaya lain agar potong dan jahit tidak dihitung dua kali, lalu simpan kembali.');
    if(!basisReviewed(kain,cfg))warnings.push('Acuan HPP memakai produksi lengkap saja. Periksa rincian dan simpan HPP sekali agar dapat dipakai di ROAS.');
    const configured=!!cfg&&ci.source==='model'&&cfg.costSchema===2&&cfg.costsReviewed===true&&basisReviewed(kain,cfg)&&ci.complete&&kain.complete&&potong.complete&&valid(hppTotal)&&sourceReady()&&valid(targetMargin)&&targetMargin<100;
    const h={pid:model.id,model,kain,potong,configInfo:ci,auto,hargaJahit,biayaLain,hppTotal,configured,targetMargin,warnings};
    platforms.forEach(([mp])=>{const suffix=mp==='shopee'?'Shopee':mp==='tokped'?'Tokped':'Tiktok',q=configured?quote(hppTotal,targetMargin,mp):null;
      h['rec'+suffix]=q?.valid?q.recommended:null;h['hargaJual'+suffix]=h['rec'+suffix]||0;
      h['prof'+suffix]=q?.valid?quote(hppTotal,targetMargin,mp,q.recommended):{profit:null,marginActual:null};
    });
    return h;
  };
  renderDashboard=function(){
    const query=String(dashSearch||'').trim().toLowerCase(),models=getHppModels().filter(m=>(m.series+' '+m.namaBarang).toLowerCase().includes(query));
    const entries=models.map(m=>({m,h:computeProductHpp(m)})),ready=entries.filter(x=>x.h.configured).length;
    $('kpiGrid').innerHTML=[['Model',models.length,'blue'],['HPP siap',ready,'green'],['Perlu dilengkapi',models.length-ready,'accent']].map(([label,value,tone])=>'<div class="kpi-card"><div class="kpi-label">'+label+'</div><div class="kpi-value '+tone+'">'+value+'</div></div>').join('');
    const pages=Math.ceil(entries.length/24);dashPage=Math.max(1,Math.min(dashPage,pages||1));
    $('dashTable').innerHTML=entries.length?'<div class="model-grid">'+entries.slice((dashPage-1)*24,dashPage*24).map(({m,h})=>'<article class="model-card"><div class="model-heading">'+modelPhoto(m)+'<div><div class="model-series">'+escape(m.series)+'</div><h3>'+escape(m.namaBarang)+'</h3><p class="model-sizes">Semua ukuran: '+escape(m.sizes.join(' · '))+' · '+(h.kain.basis?.allPcs??h.kain.totalPcs)+' pcs tercatat</p>'+(h.kain.basis?.excluded.length?'<p class="model-help">Acuan HPP: '+h.kain.totalPcs+' pcs · '+h.kain.basis.excludedPcs+' pcs lama dipisahkan</p>':'')+'</div></div><div class="model-costs"><div><span>Kain / pcs</span><strong>'+money(h.kain.complete?h.kain.perPcs:null)+'</strong></div><div><span>Potong / pcs</span><strong>'+money(h.potong.complete?h.potong.perPcs:null)+'</strong></div><div><span>Jahit / pcs</span><strong>'+money(h.hargaJahit)+'</strong></div><div><span>Biaya lain / pcs</span><strong>'+(h.configInfo.value?money(h.biayaLain):'Belum diisi')+'</strong></div></div><div class="model-total"><span>HPP / pcs</span><strong>'+money(h.configured?h.hppTotal:null)+'</strong></div>'+(h.configured?'<p class="model-ok">Simulasi Shopee: '+money(h.recShopee)+'</p>':'<p class="model-help">'+escape(h.warnings[0]||'Periksa biaya otomatis dan tambahkan biaya lain untuk model ini.')+'</p>')+'<button class="btn btn-accent" data-model-setup="'+escape(m.id)+'">'+(h.configured?'Lihat / ubah biaya':'Lengkapi HPP')+'</button></article>').join('')+'</div>':'<p class="model-empty">'+(query?'Model tidak ditemukan.':'Belum ada data produksi yang terbaca.')+'</p>';
    $('dashPagination').innerHTML=Array.from({length:pages>1?pages:0},(_,i)=>'<button class="page-btn '+(i+1===dashPage?'active':'')+'" data-model-page="'+(i+1)+'">'+(i+1)+'</button>').join('');
  };
  populateProductDropdowns=function(){
    const groups=getGroupedProducts();let html='<option value="">Pilih model barang…</option>';
    Object.entries(groups).forEach(([series,models])=>{html+='<optgroup label="'+escape(series)+'">'+models.map(m=>'<option value="'+escape(m.id)+'">'+escape(m.namaBarang)+'</option>').join('')+'</optgroup>';});
    ['setupProduct','simProduct'].forEach(id=>{const current=$(id).value;$(id).innerHTML=html;$(id).value=current;});
  };
  jumpToSetup=function(id){editing=false;switchTab('setup',document.querySelector('[data-tab="setup"]'));populateProductDropdowns();$('setupProduct').value=id;renderSetupDetail();};
  function detailBasis(k){
    const b=k.basis;if(!b?.excluded.length)return '';
    return '<div class="model-basis"><strong>Acuan HPP: '+b.includedPcs.toLocaleString('id-ID')+' pcs</strong><p class="model-help">Dari '+b.allPcs.toLocaleString('id-ID')+' pcs produksi tercatat, '+b.excludedPcs.toLocaleString('id-ID')+' pcs lama belum dipakai untuk HPP karena rincian bahan belum lengkap. Ini acuan biaya dari produksi lengkap, bukan biaya pasti seluruh riwayat.</p><details class="model-source"><summary>Lihat '+b.excluded.length+' catatan lama yang tidak ikut dihitung</summary>'+b.excluded.map(e=>'<div class="model-excluded">'+line((e.tanggal||'Tanggal tidak tersedia')+' · Ukuran '+(e.size||'—'),e.jumlah+' pcs')+'<p class="model-help">'+escape(e.reason)+'</p></div>').join('')+'</details><p class="model-help">Data produksi, stok, dan upah tetap utuh. Pcs dan biaya dari catatan ini tidak dimasukkan ke rata-rata HPP. Jika rincian bahan dilengkapi, catatan akan dihitung kembali.</p></div>';
  }
  function detailKain(k){return detailBasis(k)+'<details class="model-source"><summary>Lihat rincian '+k.details.length+' jenis/satuan kain</summary>'+k.details.map(d=>line(d.jenis+' · '+d.qty.toLocaleString('id-ID')+' '+d.unit,money(d.totalCost))).join('')+line('Total biaya kain dalam acuan',money(k.totalCost))+line('Dibagi hasil potong dalam acuan HPP',k.totalPcs+' pcs')+'<p class="model-help">Semua kain dan rol yang dipakai dijumlahkan biayanya. Contoh 3 jenis kain untuk 100 pcs: jumlah biaya ketiganya ÷ 100, bukan dibagi 3. Kain bersama antar-ukuran dihitung sekali sesuai catatan pemakaian.</p><p class="model-help">Harga mengikuti pembelian tercatat. Rata-rata memakai total biaya ÷ total pcs dalam acuan, bukan rata-rata biasa antar-ukuran. Harga yang belum lengkap atau pemakaian yang belum cocok tetap harus diperiksa.</p></details>';}
  function detailCutting(c){return warning(c.warnings)+'<details class="model-source"><summary>Lihat asal upah potong</summary><p class="model-help">'+escape(c.source)+'</p>'+line('Total upah potong dalam acuan',money(c.totalCost))+line('Dibagi hasil potong dalam acuan HPP',c.totalPcs+' pcs')+'<p class="model-help">Menggunakan hasil potong yang sama dengan acuan kain. Catatan tanpa upah memakai tarif Potong saat ini jika tersedia dan ditandai sebagai perkiraan. Tidak mengubah slip atau upah tukang.</p></details>';}
  renderSetupDetail=function(){
    const id=$('setupProduct').value,m=findProductById(id);editing=false;editingId=id;
    if(!m){$('setupDetail').innerHTML='';return;}
    const h=computeProductHpp(m),cfg=h.configInfo.value||{},auto=h.auto,mode=cfg.jahitMode||(h.configInfo.value?'manual':'auto');
    editingConfig=JSON.stringify(h.configInfo);
    const j=mode==='auto'?auto.perPcs:cfg.hargaJahit,extra=cfg.biayaLain??0;
    $('setupDetail').innerHTML='<div class="section model-section"><div class="model-heading model-heading-large"><div id="modelPhotoSlot">'+modelPhoto(m)+'</div><div><h2 class="model-section-title">'+escape(m.namaBarang)+'</h2><p class="model-help">'+escape(m.series)+' · '+escape(m.sizes.join(' / '))+' — satu HPP untuk semua ukuran.</p></div></div><div id="modelSourceNote"></div><h3 class="model-section-title">1. Biaya otomatis / pcs</h3><p class="model-help">Dari Stok Bahan, Potong Command dan Jahit Command. Tidak perlu diketik ulang.</p><div class="model-auto-costs"><div><span>Kain dari hasil potong</span><strong id="modelFabricValue"></strong></div><div><span>Upah potong</span><strong id="modelCuttingValue"></strong></div><div><span>Ongkos jahit</span><strong id="modelSewingValue"></strong></div></div><p id="sewingSource" class="model-help"></p><div id="modelFabricDetails"></div><div id="modelCuttingDetails"></div>'+warning(h.configInfo.warnings)+'<details class="model-source" '+(mode==='manual'?'open':'')+'><summary>Pilihan ongkos jahit (opsional)</summary><label class="form-label" for="inputJahitMode">Sumber ongkos jahit</label><select class="form-input" id="inputJahitMode"><option value="auto" '+(mode==='auto'?'selected':'')+'>Otomatis dari Jahit Command</option><option value="manual" '+(mode==='manual'?'selected':'')+'>Isi perkiraan sendiri</option></select><label class="form-label" for="inputJahit">Ongkos jahit per pcs (Rp)</label><input class="form-input" id="inputJahit" type="number" min="0" step="1" value="'+(valid(Number(j))&&j!=null?Number(j):'')+'" placeholder="Belum ada tarif jahit" '+(mode==='auto'?'readonly':'')+'><p class="model-help">Pilihan manual hanya untuk perkiraan HPP; tidak mengubah upah di Jahit Command.</p></details></div>'+
      '<div class="section model-section"><h3 class="model-section-title">2. Tambahkan biaya lain / pcs</h3>'+(h.configInfo.value&&cfg.costSchema!==2?warning(['Angka biaya lain dari versi lama tetap disimpan. Jika dahulu sudah termasuk potong atau jahit, keluarkan bagian itu dari biaya lain agar tidak dihitung dua kali.']):'')+'<div class="model-input-row"><label><span class="form-label">Total biaya lain (Rp)</span><input class="form-input" id="inputLain" type="number" min="0" step="1" value="'+(valid(Number(extra))?Number(extra):'')+'"></label><label><span class="form-label">Keterangan biaya</span><input class="form-input" id="inputKetLain" value="'+escape(cfg.ketLain||'')+'" placeholder="Sablon, label, plastik, kemasan…"></label></div><p class="form-note">Isi biaya tambahan saja. Kain, upah potong dan ongkos jahit sudah dihitung di atas. Biaya marketplace dan perkiraan pajak dihitung terpisah.</p><label class="chk-wrap model-source"><input id="costChecked" type="checkbox">'+(h.kain.basis?.excluded.length?'Acuan produksi dan biaya lain sudah saya periksa. ':'Biaya lain sudah diperiksa. ')+'Biaya lain tidak termasuk kain, potong, dan jahit (boleh 0).</label></div>'+
      '<div class="total-box"><span class="total-label">HPP rata-rata / pcs</span><strong class="total-value" id="setupTotalHpp"></strong></div><div class="section"><h3 class="model-section-title">3. Perkiraan harga jual</h3><label class="form-label" for="inputMargin">Target laba dari harga jual (%)</label><input class="form-input" id="inputMargin" type="number" min="0" max="99" step="1" value="'+(valid(Number(cfg.targetMargin??30))?Number(cfg.targetMargin??30):30)+'"><p class="model-help">Misal target 20%: laba Rp20.000 dari harga Rp100.000 setelah biaya yang dimasukkan. Bukan markup 20% dari modal.</p><button class="btn btn-outline" data-model-settings>Atur biaya marketplace & pajak</button><div id="recPriceArea"></div></div><p id="modelFormWarning" class="model-warning model-form-warning"></p><button class="btn btn-accent" id="modelSave" style="width:100%;min-height:48px">Simpan HPP model ini</button><p class="model-save-note">Tidak mengubah jumlah potong, stok, upah tukang, atau pengaturan HPP lama per ukuran. Harga hanya simulasi, tidak mengubah harga jual di marketplace.</p>';
    $('inputJahitMode').onchange=()=>{editing=true;applySewing();updateMarginPreview();};
    ['inputJahit','inputLain','inputKetLain','inputMargin','costChecked'].forEach(field=>$(field).addEventListener('input',()=>{editing=true;updateMarginPreview();}));
    $('costChecked').checked=h.configInfo.source==='model'&&cfg.costSchema===2&&cfg.costsReviewed===true&&basisReviewed(h.kain,cfg);
    $('modelSave').onclick=()=>saveSetup(id);applySewing();updateMarginPreview();
  };
  function applySewing(){const m=findProductById($('setupProduct').value);if(!m)return;const s=C.sewing(m,hppWorkers),automatic=$('inputJahitMode').value==='auto';$('inputJahit').readOnly=automatic;if(automatic)$('inputJahit').value=s.complete?s.perPcs:'';$('sewingSource').textContent=automatic?(s.complete?s.source+'; dihitung per model.':'Tarif otomatis belum lengkap. '+s.warnings.join(' ')):'Ongkos ini hanya untuk perkiraan HPP; tidak mengubah upah di aplikasi Jahit.';}
  function formState(){
    const m=findProductById($('setupProduct').value);if(!m)return {errors:['Pilih model dahulu.']};
    const k=fabric(m),c=cutting(m,k),automatic=$('inputJahitMode').value==='auto',s=C.sewing(m,hppWorkers),j=automatic?(s.complete?s.perPcs:null):num('inputJahit'),extra=num('inputLain'),margin=num('inputMargin');
    const errors=[];if(!sourceReady())errors.push('Data sumber belum lengkap/terbaru. Tunggu sinkronisasi sebelum menghitung.');
    if(!k.complete)errors.push(...k.warnings);if(!c.complete)errors.push(...c.warnings);if(!valid(j))errors.push('Tarif jahit belum tersedia. Lengkapi di Jahit Command atau pilih perkiraan manual.');if(!valid(extra))errors.push('Isi biaya lain 0 atau lebih.');if(!valid(margin)||margin>=100)errors.push('Target laba harus 0 sampai kurang dari 100%.');
    if(!$('costChecked').checked)errors.push(k.basis?.excluded.length?'Periksa acuan produksi dan biaya lain, lalu centang konfirmasinya.':'Periksa biaya lain, lalu centang konfirmasinya.');
    const total=k.complete&&c.complete&&valid(j)&&valid(extra)?k.perPcs+c.perPcs+j+extra:null;
    if(total!==null&&!valid(total))errors.push('Total biaya melampaui batas perhitungan.');
    return {model:m,kain:k,potong:c,jahitMode:automatic?'auto':'manual',hargaJahit:j,biayaLain:extra,targetMargin:margin,hppTotal:total,errors};
  }
  updateMarginPreview=function(){
    if(!$('setupProduct').value)return;applySewing();const s=formState();if(!s.model)return;$('setupTotalHpp').textContent=s.errors.length?'Belum lengkap':money(s.hppTotal);$('modelFabricValue').textContent=money(s.kain.complete?s.kain.perPcs:null);$('modelFabricDetails').innerHTML=warning(s.kain.warnings)+detailKain(s.kain);$('modelCuttingValue').textContent=money(s.potong.complete?s.potong.perPcs:null);$('modelCuttingDetails').innerHTML=detailCutting(s.potong);$('modelSewingValue').textContent=money(s.hargaJahit);$('modelPhotoSlot').innerHTML=modelPhoto(s.model);
    if(s.errors.length){$('recPriceArea').innerHTML=warning(s.errors);return;}
    $('recPriceArea').innerHTML='<div class="model-price-grid">'+platforms.map(([mp,name])=>{const q=quote(s.hppTotal,s.targetMargin,mp);if(!q.valid)return '<div class="model-price">'+name+warning([q.error])+'</div>';const at=quote(s.hppTotal,s.targetMargin,mp,q.recommended);return '<div class="model-price"><h4>'+name+'</h4><p>Harga setelah diskon penjual</p><strong>'+money(q.recommended)+'</strong><p>Perkiraan laba '+money(at.profit)+' / pcs<br>Batas impas '+money(q.breakEven)+'<br>Biaya '+getFee(mp)+'% + '+money(fixed(mp))+' / pcs<br>Perkiraan pajak '+getPajak()+'%</p></div>';}).join('')+'</div><p class="model-help">Cek potongan toko di Setting. Hasil bergantung pada biaya yang kamu masukkan; biaya yang belum tercatat belum termasuk.</p>';
  };
  saveSetup=function(id){
    const s=formState();if(!s.model||s.model.id!==id){showToast('Model berubah. Pilih kembali sebelum menyimpan.','error');return false;}
    if(JSON.stringify(C.config(s.model,hppData))!==editingConfig){$('modelFormWarning').textContent='Biaya model ini berubah dari sesi lain. Isianmu belum dikirim. Catat isian ini, lalu pilih ulang model untuk memeriksa biaya terbaru.';return false;}
    if(s.errors.length){$('modelFormWarning').textContent=s.errors.join(' ');return false;}
    const prices={};for(const [mp] of platforms){const q=quote(s.hppTotal,s.targetMargin,mp);if(!q.valid){$('modelFormWarning').textContent=q.error;return false;}prices[mp]=q.recommended;}
    const state=hppJournal?.status();if(!state||!state.baseKnown||state.foreignPending||state.detached||state.conflict||state.error||!state.durable){$('modelFormWarning').textContent='Pengaturan belum aman untuk diubah. Periksa sinkronisasi; isian tetap di sini.';return false;}
    const old=hppData.modelConfigs?.[id]||{},next={...old,series:s.model.series,namaBarang:s.model.namaBarang,jahitMode:s.jahitMode,hargaJahit:s.hargaJahit,biayaLain:s.biayaLain,ketLain:$('inputKetLain').value.trim(),targetMargin:s.targetMargin,hargaJual:prices,costsReviewed:true,costSchema:2,basisPolicy:s.kain.basis.policy};
    hppData.modelConfigs={...(hppData.modelConfigs||{}),[id]:next};debouncedSave();editingConfig=JSON.stringify(C.config(s.model,hppData));editing=false;$('modelFormWarning').textContent='';showToast('HPP model disimpan sebagai draf; menunggu konfirmasi pusat.');debounceRender();return true;
  };
  saveMarketplaceSettings=function(){
    const ids=['feeShopee','feeTokped','feeTiktok','feePajak','fixedShopee','fixedTokped','fixedTiktok'],values=ids.map(num);
    if(values.some(v=>!valid(v))||values.slice(0,3).some(v=>v+values[3]>=100)){showToast('Isi biaya valid; total persen marketplace + pajak harus di bawah 100%.','error');return false;}
    const state=hppJournal?.status();if(!state||!state.baseKnown||state.foreignPending||state.detached||state.conflict||state.error){showToast('Periksa sinkronisasi sebelum mengubah biaya.','error');return false;}
    const old=hppData.marketplace||{},next={...old};platforms.forEach(([mp,name],i)=>{next[mp]={nama:name,...old[mp],fee:values[i],fixedPerPcs:values[4+i]};});hppData.marketplace=next;hppData.pajak=values[3];debouncedSave();debounceRender();return true;
  };
  function simHeader(h,mp){return (h.kain.basis?.excluded.length?'<p class="model-help">Acuan HPP dari '+h.kain.totalPcs+' pcs produksi lengkap; '+h.kain.basis.excludedPcs+' pcs lama belum dihitung. Rincian ada di Setup HPP.</p>':'')+'<p class="model-help">HPP model '+money(h.hppTotal)+' / pcs · biaya '+getFee(mp)+'% + '+money(fixed(mp))+' / pcs · perkiraan pajak '+getPajak()+'%. Harga setelah diskon penjual.</p>';}
  renderSimulasi=function(){const selected=$('simProduct').value,mp=$('simMarketplace').value,key=JSON.stringify([selected,mp,simMode]);
    if(simDraft.key!==key)simDraft={key,value:'',entered:false};
    const m=findProductById(selected);if(!m){$('simInputArea').innerHTML='';$('simResult').innerHTML='<p class="model-help">Pilih satu model, bukan ukuran.</p>';return;}
    const h=computeProductHpp(m);
    if(!h.configured){$('simInputArea').innerHTML='';$('simResult').innerHTML=warning(h.warnings.concat('Lengkapi dan simpan HPP model ini dahulu.'))+'<button class="btn btn-accent" data-model-setup="'+escape(m.id)+'">Lengkapi HPP</button>';return;}
    const inputId=simMode==='profit'?'simHargaJual':'simTargetProfit',value=simDraft.entered?simDraft.value:simMode==='profit'?(quote(h.hppTotal,h.targetMargin,mp).recommended??''):'';
    $('simInputArea').innerHTML=simHeader(h,mp)+'<label class="form-label">'+(simMode==='profit'?'Harga jual setelah diskon (Rp)':'Target laba / pcs (Rp)')+'</label><input class="form-input" type="number" min="0" id="'+inputId+'" value="'+escape(value)+'">';
    $('simResult').innerHTML='<div id="'+(simMode==='profit'?'simProfitResult':'simTargetResult')+'"></div>';
    const input=$(inputId),update=simMode==='profit'?updateSimProfit:updateSimTarget;input.value=String(value);
    input.oninput=()=>{if(simDraft.key!==key)return;simDraft.value=input.value;simDraft.entered=true;update();};
    if(simMode==='profit'||simDraft.entered)update();
  };
  function result(h,mp,price){const q=quote(h.hppTotal,0,mp,price);if(!q.valid)return warning([q.error]);return '<div class="model-price">'+line('Harga jual',money(price))+line('HPP model / pcs',money(h.hppTotal))+line('Biaya marketplace (%)',money(q.feeAmount))+line('Biaya tetap / pcs',money(q.fixed))+line('Perkiraan pajak',money(q.taxAmount))+'<h4>Perkiraan laba / pcs</h4><strong class="'+(q.profit<0?'negative':'')+'">'+money(q.profit)+'</strong><p>'+(q.marginActual===null?'':pct(q.marginActual)+' dari harga jual')+' · '+(q.profit<0?'Harga ini belum menutup biaya.':'Berdasarkan biaya yang tercatat.')+'</p></div>';}
  updateSimProfit=function(){const m=findProductById($('simProduct').value),price=num('simHargaJual');if(!m)return;const h=computeProductHpp(m);$('simProfitResult').innerHTML=h.configured&&valid(price)?result(h,$('simMarketplace').value,price):warning(['Isi harga valid dan lengkapi data HPP.']);};
  updateSimTarget=function(){const m=findProductById($('simProduct').value);if(!m)return;const h=computeProductHpp(m),mp=$('simMarketplace').value,q=P.target({hpp:h.hppTotal,profit:num('simTargetProfit'),fee:getFee(mp),tax:getPajak(),fixed:fixed(mp)});$('simTargetResult').innerHTML=q.valid&&h.configured?'<div class="total-box"><span class="total-label">Harga untuk target laba</span><strong class="total-value">'+money(q.price)+'</strong></div>'+result(h,mp,q.price):warning([q.error||'HPP belum lengkap.']);};
  renderAll=function(){if(currentTab==='dashboard')renderDashboard();if(currentTab==='setup'){populateProductDropdowns();if(editing&&editingId===$('setupProduct').value){$('modelSourceNote').innerHTML='<p class="model-deferred-note">Isian belum disimpan. Data sumber terbaru dipakai saat menghitung dan menyimpan.</p>';updateMarginPreview();}else renderSetupDetail();}if(currentTab==='simulasi'){populateProductDropdowns();renderSimulasi();}if(currentTab==='settings')updateDataStatus();if(currentTab==='roas'){renderRoasResult();renderRoasHistory();}};
  document.addEventListener('click',event=>{const b=event.target.closest('[data-model-setup],[data-model-page],[data-model-settings]');if(!b)return;if(b.dataset.modelSetup)jumpToSetup(b.dataset.modelSetup);if(b.dataset.modelPage){dashPage=Number(b.dataset.modelPage);renderDashboard();}if(b.hasAttribute('data-model-settings'))switchTab('settings',document.querySelector('[data-tab="settings"]'));});
  document.addEventListener('error',event=>{const img=event.target;if(!img?.matches?.('img[data-model-photo]'))return;img.hidden=true;if(img.nextElementSibling)img.nextElementSibling.hidden=false;},true);
}
