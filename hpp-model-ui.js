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
  const sourceReady=()=>hppSourceReady.stok&&hppSourceReady.produksi&&hppSourceReady.plans&&hppSourceReady.workers&&hppSourceReady.hpp&&!Object.keys(hppReadErrors).length;
  const fabric=model=>C.fabric(model,{...hppStockData,pembelian:pembelianList});
  const fixed=mp=>Number(getMarketplace()[mp]?.fixedPerPcs??0);
  const quote=(hpp,margin,mp,price=0)=>P.quote({hpp,margin,fee:getFee(mp),tax:getPajak(),fixed:fixed(mp),price});
  const normalize=model=>model?.members?model:getHppModels().find(m=>m.members.some(p=>getProductId(p)===getProductId(model)));
  getGroupedProducts=function(){const out=Object.create(null);getHppModels().forEach(m=>(out[m.series]||(out[m.series]=[])).push(m));return out;};
  findProductById=function(id){return getHppModels().find(m=>m.id===id)||null;};
  computeProductHpp=function(product){
    const model=normalize(product);if(!model)return {configured:false,kain:{complete:false,perPcs:null},hppTotal:null,warnings:['Model tidak ditemukan.']};
    const kain=fabric(model),ci=C.config(model,hppData),cfg=ci.value,auto=C.sewing(model,hppWorkers);
    const mode=cfg?.jahitMode||(cfg?'manual':'auto');
    const hargaJahit=mode==='auto'?(auto.complete?auto.perPcs:null):(cfg?.hargaJahit==null?null:Number(cfg.hargaJahit));
    const biayaLain=cfg?Number(cfg.biayaLain??0):0,targetMargin=cfg?Number(cfg.targetMargin??30):30;
    const warnings=[...kain.warnings,...ci.warnings];
    if(!valid(hargaJahit))warnings.push('Isi ongkos jahit per pcs, atau lengkapi tarif di aplikasi Jahit.');
    if(!sourceReady())warnings.push('Menunggu data bahan, potong, dan tarif jahit terbaru.');
    const hppTotal=kain.complete&&valid(hargaJahit)&&valid(biayaLain)?kain.perPcs+hargaJahit+biayaLain:null;
    if(ci.source==='legacy-compatible')warnings.push('Biaya lama sudah diisikan. Periksa dan simpan sekali untuk semua ukuran model ini.');
    const configured=!!cfg&&ci.source==='model'&&cfg.costsReviewed===true&&ci.complete&&kain.complete&&valid(hppTotal)&&sourceReady()&&valid(targetMargin)&&targetMargin<100;
    const h={pid:model.id,model,kain,configInfo:ci,auto,hargaJahit,biayaLain,hppTotal,configured,targetMargin,warnings};
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
    $('dashTable').innerHTML=entries.length?'<div class="model-grid">'+entries.slice((dashPage-1)*24,dashPage*24).map(({m,h})=>'<article class="model-card"><div class="model-series">'+escape(m.series)+'</div><h3>'+escape(m.namaBarang)+'</h3><p class="model-sizes">Semua ukuran: '+escape(m.sizes.join(' · '))+' · '+h.kain.totalPcs+' pcs potong</p><div class="model-costs"><div><span>Kain / pcs</span><strong>'+money(h.kain.complete?h.kain.perPcs:null)+'</strong></div><div><span>Jahit / pcs</span><strong>'+money(h.hargaJahit)+'</strong></div><div><span>Biaya lain / pcs</span><strong>'+(h.configInfo.value?money(h.biayaLain):'Belum diisi')+'</strong></div></div><div class="model-total"><span>HPP / pcs</span><strong>'+money(h.configured?h.hppTotal:null)+'</strong></div>'+(h.configured?'<p class="model-ok">Simulasi Shopee: '+money(h.recShopee)+'</p>':'<p class="model-help">'+escape(h.warnings[0]||'Lengkapi ongkos jahit dan biaya lain sekali untuk model ini.')+'</p>')+'<button class="btn btn-accent" data-model-setup="'+escape(m.id)+'">'+(h.configured?'Lihat / ubah biaya':'Lengkapi HPP')+'</button></article>').join('')+'</div>':'<p class="model-empty">'+(query?'Model tidak ditemukan.':'Belum ada data produksi yang terbaca.')+'</p>';
    $('dashPagination').innerHTML=Array.from({length:pages>1?pages:0},(_,i)=>'<button class="page-btn '+(i+1===dashPage?'active':'')+'" data-model-page="'+(i+1)+'">'+(i+1)+'</button>').join('');
  };
  populateProductDropdowns=function(){
    const groups=getGroupedProducts();let html='<option value="">Pilih model barang…</option>';
    Object.entries(groups).forEach(([series,models])=>{html+='<optgroup label="'+escape(series)+'">'+models.map(m=>'<option value="'+escape(m.id)+'">'+escape(m.namaBarang)+'</option>').join('')+'</optgroup>';});
    ['setupProduct','simProduct'].forEach(id=>{const current=$(id).value;$(id).innerHTML=html;$(id).value=current;});
  };
  jumpToSetup=function(id){editing=false;switchTab('setup',document.querySelector('[data-tab="setup"]'));populateProductDropdowns();$('setupProduct').value=id;renderSetupDetail();};
  function detailKain(k){return '<details class="model-source"><summary>Lihat rincian '+k.details.length+' jenis/satuan kain</summary>'+k.details.map(d=>line(d.jenis+' · '+d.qty.toLocaleString('id-ID')+' '+d.unit,money(d.totalCost))).join('')+line('Total biaya semua kain',money(k.totalCost))+line('Dibagi hasil potong semua ukuran',k.totalPcs+' pcs')+'<p class="model-help">Semua kain dan rol yang dipakai dijumlahkan biayanya. Contoh 3 jenis kain untuk 100 pcs: jumlah biaya ketiganya ÷ 100, bukan dibagi 3. Kain bersama antar-ukuran dihitung sekali sesuai catatan pemakaian.</p><p class="model-help">Harga mengikuti pembelian tercatat. Jika rincian bahan, harga, atau hasil potong belum lengkap, HPP belum dinyatakan siap. Rata-rata memakai total biaya ÷ total pcs, bukan rata-rata biasa antar-ukuran.</p></details>';}
  renderSetupDetail=function(){
    const id=$('setupProduct').value,m=findProductById(id);editing=false;editingId=id;
    if(!m){$('setupDetail').innerHTML='';return;}
    const h=computeProductHpp(m),cfg=h.configInfo.value||{},auto=h.auto,mode=cfg.jahitMode||(h.configInfo.value?'manual':auto.complete?'auto':'manual');
    editingConfig=JSON.stringify(h.configInfo);
    const j=mode==='auto'?auto.perPcs:cfg.hargaJahit,extra=cfg.biayaLain??0;
    $('setupDetail').innerHTML='<div class="section model-section"><h2 class="model-section-title">'+escape(m.namaBarang)+'</h2><p class="model-help">'+escape(m.series)+' · '+escape(m.sizes.join(' / '))+' — satu HPP untuk semua ukuran.</p><div id="modelSourceNote"></div><div class="model-total"><span>1. Kain rata-rata / pcs</span><strong id="modelFabricValue">'+money(h.kain.complete?h.kain.perPcs:null)+'</strong></div><div id="modelFabricDetails">'+warning(h.kain.warnings)+detailKain(h.kain)+'</div></div>'+
      '<div class="section model-section"><h3 class="model-section-title">2. Ongkos jahit / pcs</h3><label class="form-label" for="inputJahitMode">Sumber ongkos jahit</label><select class="form-input" id="inputJahitMode"><option value="auto" '+(mode==='auto'?'selected':'')+'>Ambil dari tarif Jahit</option><option value="manual" '+(mode==='manual'?'selected':'')+'>Isi sendiri untuk model ini</option></select><p id="sewingSource" class="model-help"></p><label class="form-label" for="inputJahit">Ongkos jahit per pcs (Rp)</label><input class="form-input" id="inputJahit" type="number" min="0" step="1" value="'+(valid(Number(j))&&j!=null?Number(j):'')+'" placeholder="Isi ongkos jahit" '+(mode==='auto'?'readonly':'')+'>'+warning(h.configInfo.warnings)+'</div>'+
      '<div class="section model-section"><h3 class="model-section-title">3. Tambahkan biaya lain / pcs</h3><div class="model-input-row"><label><span class="form-label">Total biaya lain (Rp)</span><input class="form-input" id="inputLain" type="number" min="0" step="1" value="'+(valid(Number(extra))?Number(extra):'')+'"></label><label><span class="form-label">Keterangan biaya</span><input class="form-input" id="inputKetLain" value="'+escape(cfg.ketLain||'')+'" placeholder="Potong, sablon, label, plastik…"></label></div><p class="form-note">Jumlahkan biaya potong, sablon, aksesoris, kemasan dan biaya produksi lain per pcs. Ongkos jahit di atas jangan dimasukkan lagi. Biaya marketplace dan pajak dihitung terpisah di bawah.</p><label class="chk-wrap model-source"><input id="costChecked" type="checkbox" '+(h.configInfo.value?'checked':'')+'>Biaya lain sudah saya periksa (boleh 0 jika tidak ada).</label></div>'+
      '<div class="total-box"><span class="total-label">HPP rata-rata / pcs</span><strong class="total-value" id="setupTotalHpp"></strong></div><div class="section"><h3 class="model-section-title">4. Perkiraan harga jual</h3><label class="form-label" for="inputMargin">Target laba dari harga jual (%)</label><input class="form-input" id="inputMargin" type="number" min="0" max="99" step="1" value="'+(valid(Number(cfg.targetMargin??30))?Number(cfg.targetMargin??30):30)+'"><p class="model-help">Misal target 20%: laba Rp20.000 dari harga Rp100.000 setelah biaya yang dimasukkan. Bukan markup 20% dari modal.</p><button class="btn btn-outline" data-model-settings>Atur biaya marketplace & pajak</button><div id="recPriceArea"></div></div><p id="modelFormWarning" class="model-warning model-form-warning"></p><button class="btn btn-accent" id="modelSave" style="width:100%;min-height:48px">Simpan HPP model ini</button><p class="model-save-note">Tidak mengubah jumlah potong, stok, upah tukang, atau pengaturan HPP lama per ukuran. Harga hanya simulasi, tidak mengubah harga jual di marketplace.</p>';
    $('inputJahitMode').onchange=()=>{editing=true;applySewing();updateMarginPreview();};
    ['inputJahit','inputLain','inputKetLain','inputMargin','costChecked'].forEach(field=>$(field).addEventListener('input',()=>{editing=true;updateMarginPreview();}));
    $('costChecked').checked=h.configInfo.source==='model'&&cfg.costsReviewed===true;
    $('modelSave').onclick=()=>saveSetup(id);applySewing();updateMarginPreview();
  };
  function applySewing(){const m=findProductById($('setupProduct').value);if(!m)return;const s=C.sewing(m,hppWorkers),automatic=$('inputJahitMode').value==='auto';$('inputJahit').readOnly=automatic;if(automatic)$('inputJahit').value=s.complete?s.perPcs:'';$('sewingSource').textContent=automatic?(s.complete?s.source+'; dihitung per model.':'Tarif otomatis belum lengkap. '+s.warnings.join(' ')):'Ongkos ini hanya untuk perkiraan HPP; tidak mengubah upah di aplikasi Jahit.';}
  function formState(){
    const m=findProductById($('setupProduct').value);if(!m)return {errors:['Pilih model dahulu.']};
    const k=fabric(m),automatic=$('inputJahitMode').value==='auto',s=C.sewing(m,hppWorkers),j=automatic?(s.complete?s.perPcs:null):num('inputJahit'),extra=num('inputLain'),margin=num('inputMargin');
    const errors=[];if(!sourceReady())errors.push('Data sumber belum lengkap/terbaru. Tunggu sinkronisasi sebelum menghitung.');
    if(!k.complete)errors.push(...k.warnings);if(!valid(j))errors.push('Lengkapi ongkos jahit per pcs.');if(!valid(extra))errors.push('Isi biaya lain 0 atau lebih.');if(!valid(margin)||margin>=100)errors.push('Target laba harus 0 sampai kurang dari 100%.');
    if(!$('costChecked').checked)errors.push('Periksa biaya lain, lalu centang konfirmasinya.');
    const total=k.complete&&valid(j)&&valid(extra)?k.perPcs+j+extra:null;
    if(total!==null&&!valid(total))errors.push('Total biaya melampaui batas perhitungan.');
    return {model:m,kain:k,jahitMode:automatic?'auto':'manual',hargaJahit:j,biayaLain:extra,targetMargin:margin,hppTotal:total,errors};
  }
  updateMarginPreview=function(){
    if(!$('setupProduct').value)return;applySewing();const s=formState();if(!s.model)return;$('setupTotalHpp').textContent=money(s.hppTotal);$('modelFabricValue').textContent=money(s.kain.complete?s.kain.perPcs:null);$('modelFabricDetails').innerHTML=warning(s.kain.warnings)+detailKain(s.kain);
    if(s.errors.length){$('recPriceArea').innerHTML=warning(s.errors);return;}
    $('recPriceArea').innerHTML='<div class="model-price-grid">'+platforms.map(([mp,name])=>{const q=quote(s.hppTotal,s.targetMargin,mp);if(!q.valid)return '<div class="model-price">'+name+warning([q.error])+'</div>';const at=quote(s.hppTotal,s.targetMargin,mp,q.recommended);return '<div class="model-price"><h4>'+name+'</h4><p>Harga setelah diskon penjual</p><strong>'+money(q.recommended)+'</strong><p>Perkiraan laba '+money(at.profit)+' / pcs<br>Batas impas '+money(q.breakEven)+'<br>Biaya '+getFee(mp)+'% + '+money(fixed(mp))+' / pcs<br>Perkiraan pajak '+getPajak()+'%</p></div>';}).join('')+'</div><p class="model-help">Cek potongan toko di Setting. Hasil bergantung pada biaya yang kamu masukkan; biaya yang belum tercatat belum termasuk.</p>';
  };
  saveSetup=function(id){
    const s=formState();if(!s.model||s.model.id!==id){showToast('Model berubah. Pilih kembali sebelum menyimpan.','error');return false;}
    if(JSON.stringify(C.config(s.model,hppData))!==editingConfig){$('modelFormWarning').textContent='Biaya model ini berubah dari sesi lain. Isianmu belum dikirim. Catat isian ini, lalu pilih ulang model untuk memeriksa biaya terbaru.';return false;}
    if(s.errors.length){$('modelFormWarning').textContent=s.errors.join(' ');return false;}
    const prices={};for(const [mp] of platforms){const q=quote(s.hppTotal,s.targetMargin,mp);if(!q.valid){$('modelFormWarning').textContent=q.error;return false;}prices[mp]=q.recommended;}
    const state=hppJournal?.status();if(!state||!state.baseKnown||state.foreignPending||state.detached||state.conflict||state.error||!state.durable){$('modelFormWarning').textContent='Pengaturan belum aman untuk diubah. Periksa sinkronisasi; isian tetap di sini.';return false;}
    const old=hppData.modelConfigs?.[id]||{},next={...old,series:s.model.series,namaBarang:s.model.namaBarang,jahitMode:s.jahitMode,hargaJahit:s.hargaJahit,biayaLain:s.biayaLain,ketLain:$('inputKetLain').value.trim(),targetMargin:s.targetMargin,hargaJual:prices,costsReviewed:true};
    hppData.modelConfigs={...(hppData.modelConfigs||{}),[id]:next};debouncedSave();editingConfig=JSON.stringify(C.config(s.model,hppData));editing=false;$('modelFormWarning').textContent='';showToast('HPP model disimpan sebagai draf; menunggu konfirmasi pusat.');debounceRender();return true;
  };
  saveMarketplaceSettings=function(){
    const ids=['feeShopee','feeTokped','feeTiktok','feePajak','fixedShopee','fixedTokped','fixedTiktok'],values=ids.map(num);
    if(values.some(v=>!valid(v))||values.slice(0,3).some(v=>v+values[3]>=100)){showToast('Isi biaya valid; total persen marketplace + pajak harus di bawah 100%.','error');return false;}
    const state=hppJournal?.status();if(!state||!state.baseKnown||state.foreignPending||state.detached||state.conflict||state.error){showToast('Periksa sinkronisasi sebelum mengubah biaya.','error');return false;}
    const old=hppData.marketplace||{},next={...old};platforms.forEach(([mp,name],i)=>{next[mp]={nama:name,...old[mp],fee:values[i],fixedPerPcs:values[4+i]};});hppData.marketplace=next;hppData.pajak=values[3];debouncedSave();debounceRender();return true;
  };
  function simHeader(h,mp){return '<p class="model-help">HPP model '+money(h.hppTotal)+' / pcs · biaya '+getFee(mp)+'% + '+money(fixed(mp))+' / pcs · perkiraan pajak '+getPajak()+'%. Harga setelah diskon penjual.</p>';}
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
}
