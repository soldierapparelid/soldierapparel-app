(function(){
  'use strict';
  let selectedPlan='',planSignature='',submitting=false;
  const el=id=>document.getElementById(id);
  const text=value=>esc(String(value==null?'':value));
  function message(value,error){const node=el('cuttingWorkerMessage');if(node){node.textContent=value;node.dataset.error=error?'true':'false';}}
  function planProducts(plan){const byId=new Map(CuttingPlan.products(CUTTING_ROOT).map(p=>[String(p.id),p]));return (plan.products||[]).map(ref=>byId.get(String(ref.id))).filter(Boolean);}
  function availablePlans(){
    if(!window.CuttingPlan||!CUTTING_ROOT)return [];
    return CuttingPlan.plans(CUTTING_ROOT).filter(plan=>{
      if(plan.status!=='ready'||!(plan.products||[]).length)return false;
      const products=planProducts(plan);
      if(products.length!==plan.products.length)return false;
      if(products.some(p=>!p.poAktif||CuttingPlan.cycle(p)!==plan.products.find(ref=>String(ref.id)===String(p.id)).cycle))return false;
      return !DB_PRODUKSI.some(p=>(p.potong||[]).some(c=>c.cuttingPlanId===plan.id));
    });
  }
  function inputProblem(){
    if(!window.CuttingPlan)return 'Instruksi potong belum termuat. Muat ulang tanpa reset data.';
    if(!FB.connected)return 'Sambungkan internet untuk mengambil instruksi owner terbaru.';
    if(!firebaseSyncReady||!CUTTING_ROOT)return 'Menunggu data barang dan stok bahan dari owner.';
    if(Object.keys(potongReadErrors).length)return 'Data belum dapat dibaca. Periksa koneksi di Setup.';
    const state=potongJournal&&potongJournal.status();
    if(!state||!state.baseKnown)return 'Menunggu data barang dari owner.';
    if(state.error||state.conflict||state.foreignPending||state.detached)return 'Ada perubahan yang perlu diperiksa. Buka Setup; draf tetap disimpan.';
    if(state.saving||!state.durable)return 'Tunggu sampai penyimpanan di perangkat selesai.';
    if(state.pending)return 'Hasil sebelumnya masih menunggu kirim. Tunggu status Tersinkron sebelum mengisi hasil berikutnya.';
    return '';
  }
  window.renderCuttingWorker=function(){
    const select=el('cuttingPlanSelect'),summary=el('cuttingPlanSummary'),outputs=el('cuttingOutputRows'),button=el('cuttingWorkerSave'),worker=el('cuttingWorkerSelect');
    if(!select||!summary||!outputs||!button||!worker)return;
    const previous=select.value,plans=availablePlans();
    select.innerHTML='<option value="">Pilih jatah potong</option>'+plans.map(plan=>'<option value="'+text(plan.id)+'">'+text((plan.namaBarang||'Jatah potong')+' · '+(plan.rolls||[]).reduce((n,r)=>n+Number(r.kg),0).toLocaleString('id-ID',{maximumFractionDigits:6})+' kg · rol '+(plan.rolls||[]).map(r=>r.rolNum).join(' + '))+'</option>').join('');
    select.value=plans.some(p=>p.id===previous)?previous:'';
    const workers=ProductionMaterials.rows(META.tukang),workerId=worker.value;
    worker.innerHTML='<option value="">Pilih nama Anda</option>'+workers.map(w=>'<option value="'+text(w.id)+'">'+text(w.nama)+'</option>').join('');
    worker.value=workers.some(w=>String(w.id)===workerId)?workerId:'';
    if(!el('cuttingWorkDate').value)el('cuttingWorkDate').value=today();
    const plan=plans.find(p=>p.id===select.value),signature=plan?JSON.stringify(plan):'';
    if(selectedPlan!==select.value||planSignature!==signature){
      selectedPlan=select.value;planSignature=signature;
      if(!plan){summary.innerHTML='';outputs.innerHTML='';}
      else{
        const products=planProducts(plan),first=products[0],photo=getProductImage(first.series,first.namaBarang)||first._offlineGambar||(OFFLINE_ORDER_IMAGES||{})[first._offlineItemId]||'';
        summary.innerHTML='<div class="cutting-plan-summary"><div class="cutting-product-heading">'+(photo?'<img src="'+text(photo)+'" alt="'+text(first.namaBarang)+'">':'')+'<h3>'+text(first.namaBarang)+'</h3></div><p>Bahan dari owner — sudah ditetapkan</p><ul class="cutting-material-list">'+(plan.rolls||[]).map(roll=>'<li><b>'+text(roll.jenis)+'</b> · '+(roll.rolNum?'Rol '+text(roll.rolNum)+' · ':'')+text(Number(roll.kg).toLocaleString('id-ID',{maximumFractionDigits:6}))+' kg</li>').join('')+'</ul><p class="cutting-material-total">Total '+text((plan.rolls||[]).reduce((sum,r)=>sum+Number(r.kg),0).toLocaleString('id-ID',{maximumFractionDigits:6}))+' kg</p>'+(plan.note?'<p>'+text(plan.note)+'</p>':'')+'<p>Semua bahan di atas dicatat sekali saat hasil ini disimpan.</p></div>';
        outputs.innerHTML='<h3>Hasil potong setiap ukuran</h3><p>Isi seluruh hasil dari jatah ini. Isi 0 untuk ukuran yang tidak dipotong.</p>'+products.map((p,i)=>'<div class="cutting-size-row"><label for="cuttingQty'+i+'">'+text(p.size||p.namaBarang)+' <span>· pcs</span></label><input id="cuttingQty'+i+'" class="cutting-result-qty" data-product-id="'+text(p.id)+'" type="number" inputmode="numeric" min="0" step="1" value="0"></div>').join('');
      }
    }
    const problem=inputProblem();
    button.disabled=submitting||!!problem||!plan;
    if(!submitting)message(problem||(!plans.length?'Belum ada instruksi potong aktif. Minta owner menyiapkan bahan dan kilogram di Stok Bahan.':!plan?'Pilih barang yang sesuai instruksi owner.':''),!!problem);
  };
  window.stageCuttingWorkerDraft=async function(next){
    if(!potongJournal)throw new Error('Penyimpanan belum siap. Hasil belum disimpan.');
    const state=potongJournal.status();
    if(state.error||state.conflict||state.foreignPending||state.detached||!state.durable)throw new Error('Draf perlu diperiksa di Setup. Perubahan ini belum disimpan.');
    if(!potongJournal.stage(next,FB.dbUrl)){updateSyncTag();throw new Error(potongJournal.status().error||'Hasil belum tersimpan aman. Unduh cadangan di Setup.');}
    DB_PRODUKSI=next;pendingLocalChange=true;potongEditRevision++;potongPendingTarget=potongJournal.status().target;
    _applyingRemote=true;try{produksiSave();}finally{_applyingRemote=false;}
    await potongJournal.ready();updateSyncTag();
  };
  window.saveAssignedCuttingPlan=async function(){
    if(submitting)return;
    const problem=inputProblem();if(problem){message(problem,true);return;}
    const plan=availablePlans().find(p=>p.id===el('cuttingPlanSelect').value);
    if(!plan){message('Pilih instruksi aktif dari owner. Bahan tidak dapat diisi manual.',true);return;}
    const worker=ProductionMaterials.rows(META.tukang).find(w=>String(w.id)===el('cuttingWorkerSelect').value);
    if(!worker){message('Pilih nama tukang potong terlebih dahulu.',true);return;}
    const quantities={},rates={};
    document.querySelectorAll('.cutting-result-qty').forEach(input=>{quantities[input.dataset.productId]=Number(input.value);});
    planProducts(plan).forEach(p=>{rates[p.id]=getTarif(p.series,p.namaBarang);});
    submitting=true;el('cuttingWorkerSave').disabled=true;
    try{
      const rows=CuttingPlan.buildCuts(CUTTING_ROOT,plan.id,quantities,{id:uid(),tanggal:el('cuttingWorkDate').value||today(),tukangId:worker.id,tukangNama:worker.nama,tarif:rates});
      if(!confirm('Simpan seluruh hasil jatah ini?\n\n'+planProducts(plan).map(p=>(p.size||p.namaBarang)+': '+(quantities[p.id]||0)+' pcs').join('\n')+'\n\nBahan '+plan.rolls.reduce((n,r)=>n+Number(r.kg),0).toLocaleString('id-ID')+' kg dicatat satu kali.'))return;
      const next=potongClone(DB_PRODUKSI);
      rows.forEach(row=>{const p=next.find(p=>String(p.id)===String(row.productId));if(!p)throw new Error('Barang berubah. Tunggu data terbaru lalu pilih kembali.');if(!Array.isArray(p.potong))p.potong=[];p.potong.push(row.entry);});
      CuttingPlan.applyCuts(CUTTING_ROOT,next,STOK_MIRROR);
      await stageCuttingWorkerDraft(next);
      await flushPotongPending();
      renderAll();
      const state=potongJournal.status();
      if(state.pending||state.error||!state.durable)throw new Error('Masih ada perubahan menunggu konfirmasi pusat.');
      message('Hasil potong sudah dikonfirmasi pusat.',false);showToast('Hasil potong dikonfirmasi pusat.');
    }catch(error){message(error.message+(potongJournal&&potongJournal.status().pending?' Draf tetap tersimpan; periksa Setup sebelum mengisi ulang.':''),true);updateSyncTag();}
    finally{submitting=false;el('cuttingWorkerSave').disabled=!!inputProblem()||!availablePlans().some(p=>p.id===el('cuttingPlanSelect').value);}
  };
  // Keep maintenance controls available without exposing them during ordinary input.
  const setup=el('tab-setup');
  if(setup&&typeof setup.replaceChildren==='function'){
    const details=document.createElement('details'),summary=document.createElement('summary');details.className='cutting-advanced';summary.textContent='Pengaturan lanjutan dan pemulihan';details.appendChild(summary);
    Array.from(setup.children).forEach(child=>details.appendChild(child));setup.appendChild(details);
  }
  if(window.appReady)window.appReady.then(renderCuttingWorker);
  window.addEventListener('app-sync-storage-change',()=>{if(typeof potongBootReady!=='undefined'&&potongBootReady)renderCuttingWorker();});
})();
