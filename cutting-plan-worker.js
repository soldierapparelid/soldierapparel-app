(function(){
  'use strict';
  let selectedPO='',selectedPlan='',formSignature='',outputSignature='',submitting=false,explicitMaterialChange=false;
  const drafts=new Map(),el=id=>document.getElementById(id);
  const text=value=>esc(String(value==null?'':value)).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const rows=value=>ProductionMaterials.rows(value);
  const kg=value=>Number(value).toLocaleString('id-ID',{maximumFractionDigits:6});
  function message(value,error){const node=el('cuttingWorkerMessage');if(node){node.textContent=value;node.dataset.error=error?'true':'false';}}
  // Work choices only: never remove cuts, close the PO, or change material history.
  // One result in any size means this PO has already started cutting.
  function uncutPOs(source){
    if(!window.CuttingPlan||typeof CuttingPlan.activePOs!=='function')return [];
    // Include inactive size siblings so closing one size cannot reopen a cut PO.
    const started=new Set(CuttingPlan.products(source).filter(p=>hasResults({products:[p]})).map(p=>JSON.stringify([p.series||'',p.namaBarang||'',p._offlineOrderId||''])));
    return CuttingPlan.activePOs(source).filter(group=>!started.has(group.id));
  }
  function activePOs(){
    const local=uncutPOs(DB_PRODUKSI);
    if(!CUTTING_ROOT)return local;
    const central=new Set(uncutPOs(CUTTING_ROOT).map(group=>group.id));
    return local.filter(group=>central.has(group.id));
  }
  function planProducts(plan){const byId=new Map(CuttingPlan.products(CUTTING_ROOT).map(p=>[String(p.id),p]));return rows(plan.products).map(ref=>byId.get(String(ref.id))).filter(Boolean);}
  function groupSignature(group){return group?JSON.stringify(group.products.map(p=>[String(p.id),CuttingPlan.cycle(p),p.series||'',p.namaBarang||'',p.size||'']).sort((a,b)=>a[0].localeCompare(b[0]))):'';}
  function readyPlans(group){
    if(!group||!CUTTING_ROOT)return [];
    const rootGroup=uncutPOs(CUTTING_ROOT).find(p=>p.id===group.id);
    return CuttingPlan.plans(CUTTING_ROOT).filter(plan=>plan.status==='ready'&&CuttingPlan.matchesPlan(group,plan)&&rootGroup&&CuttingPlan.matchesPlan(rootGroup,plan)&&!DB_PRODUKSI.some(p=>rows(p.potong).some(c=>String(c.cuttingPlanId)===String(plan.id))));
  }
  function hasResults(group){return group.products.some(p=>rows(p.potong).some(c=>Number(c.jumlah)>0));}
  function poStatus(group){return readyPlans(group).length?'Bahan siap':hasResults(group)?'Sudah ada hasil':'Bahan belum ditentukan';}
  function groupLabel(group){return [group.series,group.namaBarang,group.orderId?'PO '+group.orderId:''].filter(Boolean).join(' · ');}
  function materialLabel(plan,index){return 'Bahan '+(index+1)+' · '+rows(plan.rolls).map(r=>r.jenis+' '+kg(r.kg)+' kg'+(r.rolNum?' (rol '+r.rolNum+')':'')).join(' + ');}
  function getContext(group,preferredPlan){
    const choices=readyPlans(group),plan=choices.length===1?choices[0]:choices.find(p=>String(p.id)===String(preferredPlan));
    const rootGroup=group&&CUTTING_ROOT?uncutPOs(CUTTING_ROOT).find(p=>p.id===group.id):null;
    return {group,choices,plan,rootMismatch:!!group&&groupSignature(group)!==groupSignature(rootGroup),signature:group?JSON.stringify([groupSignature(group),groupSignature(rootGroup),plan||null]):''};
  }
  function captureDraft(){
    const draft=drafts.get(selectedPO);if(!draft)return;
    document.querySelectorAll('.cutting-result-qty').forEach(input=>{draft.quantities[input.dataset.productId]=input.value;});
  }
  function hasQuantity(draft){return Object.values(draft.quantities).some(value=>String(value).trim()!==''&&Number(value)!==0);}
  function unsupportedQuantities(context,draft){
    if(!context.plan)return [];
    const allowed=new Set(rows(context.plan.products).map(p=>String(p.id)));
    return Object.keys(draft.quantities).filter(id=>!allowed.has(id)&&String(draft.quantities[id]).trim()!==''&&Number(draft.quantities[id])!==0);
  }
  function inputProblem(){
    if(!window.CuttingPlan||typeof CuttingPlan.activePOs!=='function')return 'Data PO belum termuat. Muat ulang tanpa reset data.';
    if(!FB.connected)return 'Sambungkan internet untuk mengambil PO dan bahan terbaru.';
    if(!firebaseSyncReady||!CUTTING_ROOT)return 'Menunggu data PO dari Laporan dan bahan dari owner.';
    if(Object.keys(potongReadErrors).length)return 'Data belum dapat dibaca. Periksa koneksi di Setup.';
    const state=potongJournal&&potongJournal.status();
    if(!state||!state.baseKnown)return 'Menunggu data barang dari owner.';
    if(state.error||state.conflict||state.foreignPending||state.detached)return 'Ada perubahan yang perlu diperiksa. Buka Setup; draf tetap disimpan.';
    if(state.saving||!state.durable)return 'Tunggu sampai penyimpanan di perangkat selesai.';
    if(state.pending)return 'Hasil sebelumnya masih menunggu kirim. Tunggu status Tersinkron sebelum mengisi hasil berikutnya.';
    return '';
  }
  function contextProblem(context,draft){
    if(!context.group)return 'Pilih PO aktif yang akan dikerjakan.';
    if(context.rootMismatch)return 'Data PO sedang berubah. Tunggu sampai data Laporan selesai tersinkron. Angka yang diketik tetap disimpan.';
    if(!context.choices.length)return hasResults(context.group)?'Sudah ada hasil potong. Untuk tambahan, minta owner mengisi bahan berikutnya.':'Bahan belum ditentukan. Minta owner isi kain dan kg di Stok Bahan.';
    if(!context.plan)return 'Pilih bahan yang sedang dikerjakan untuk PO ini.';
    if(unsupportedQuantities(context,draft).length)return 'Ada angka pada ukuran yang tidak termasuk bahan ini. Periksa ukuran terkunci, lalu kosongkan angka tersebut atau pilih bahan yang sesuai.';
    if(draft.needsReview)return 'Data PO atau bahan berubah. Angka tetap disimpan. Periksa gambar, ukuran, bahan dan kilogram di bawah, lalu konfirmasi pemeriksaan.';
    return '';
  }
  window.changeCuttingMaterial=function(){explicitMaterialChange=true;renderCuttingWorker();};
  window.reviewCuttingWorkerData=function(){
    captureDraft();const draft=drafts.get(selectedPO),group=activePOs().find(p=>p.id===selectedPO),context=getContext(group,selectedPlan);
    if(!draft||context.rootMismatch||context.signature!==formSignature){renderCuttingWorker();return;}
    draft.needsReview=false;renderCuttingWorker();
  };
  window.clearUnsupportedCuttingSizes=function(){
    captureDraft();const draft=drafts.get(selectedPO),context=getContext(activePOs().find(p=>p.id===selectedPO),selectedPlan);if(!draft)return;
    const unsupported=new Set(unsupportedQuantities(context,draft));
    unsupported.forEach(id=>{draft.quantities[id]='0';});
    document.querySelectorAll('.cutting-result-qty').forEach(input=>{if(unsupported.has(input.dataset.productId))input.value='0';});
    renderCuttingWorker();
  };
  window.renderCuttingWorker=function(){
    const select=el('cuttingPlanSelect'),material=el('cuttingMaterialSelect'),materialField=el('cuttingMaterialField'),summary=el('cuttingPlanSummary'),outputs=el('cuttingOutputRows'),button=el('cuttingWorkerSave'),worker=el('cuttingWorkerSelect');
    if(!select||!material||!materialField||!summary||!outputs||!button||!worker)return;
    captureDraft();
    const previous=select.value,groups=activePOs();
    select.innerHTML='<option value="">Pilih PO belum dipotong</option>'+groups.map(group=>'<option value="'+text(group.id)+'">'+text(groupLabel(group)+' · '+poStatus(group))+'</option>').join('');
    select.value=groups.some(p=>p.id===previous)?previous:'';
    const group=groups.find(p=>p.id===select.value);
    if(group&&!drafts.has(group.id))drafts.set(group.id,{quantities:{},names:{},planId:'',signature:'',needsReview:false});
    const draft=group?drafts.get(group.id):null;
    const preferredPlan=selectedPO===select.value?material.value:draft&&draft.planId;
    const context=getContext(group,preferredPlan),plan=context.plan;
    if(draft){
      group.products.forEach(p=>{draft.names[String(p.id)]=p.size||p.namaBarang;});
      if(draft.signature&&draft.signature!==context.signature&&hasQuantity(draft)&&!explicitMaterialChange)draft.needsReview=true;
      draft.signature=context.signature;draft.planId=plan?String(plan.id):'';
    }
    explicitMaterialChange=false;selectedPO=select.value;selectedPlan=plan?String(plan.id):'';formSignature=context.signature;
    material.innerHTML='<option value="">Pilih bahan untuk hasil ini</option>'+context.choices.map((p,i)=>'<option value="'+text(p.id)+'">'+text(materialLabel(p,i))+'</option>').join('');
    material.value=selectedPlan;materialField.hidden=context.choices.length<2;
    const workers=rows(META.tukang),workerId=worker.value;
    worker.innerHTML='<option value="">Pilih nama Anda</option>'+workers.map(w=>'<option value="'+text(w.id)+'">'+text(w.nama)+'</option>').join('');
    worker.value=workers.some(w=>String(w.id)===workerId)?workerId:'';
    if(!el('cuttingWorkDate').value)el('cuttingWorkDate').value=today();
    if(!group){summary.innerHTML='';outputs.innerHTML='';outputSignature='';}
    else{
      const first=group.products[0],photo=getProductImage(first.series,first.namaBarang)||group.products.map(p=>p._offlineGambar||(OFFLINE_ORDER_IMAGES||{})[p._offlineItemId]).find(Boolean)||'';
      const unsupported=unsupportedQuantities(context,draft),allowed=new Set(plan?rows(plan.products).map(p=>String(p.id)):[]);
      summary.innerHTML='<div class="cutting-plan-summary"><div class="cutting-product-heading">'+(photo?'<img src="'+text(photo)+'" alt="'+text(first.namaBarang)+'">':'<div class="cutting-photo-empty">Belum ada gambar</div>')+'<div><h3>'+text(group.namaBarang)+'</h3><p class="cutting-po-detail">'+text([group.series,group.orderId?'PO '+group.orderId:''].filter(Boolean).join(' · '))+'</p></div></div><p class="cutting-po-status" data-ready="'+!!plan+'">'+text(poStatus(group))+'</p>'+(plan?'<p>Bahan dan kilogram sudah ditetapkan owner</p><ul class="cutting-material-list">'+rows(plan.rolls).map(roll=>'<li><b>'+text(roll.jenis)+'</b> · '+(roll.rolNum?'Rol '+text(roll.rolNum)+' · ':'')+text(kg(roll.kg))+' kg</li>').join('')+'</ul><p class="cutting-material-total">Total '+text(kg(rows(plan.rolls).reduce((sum,r)=>sum+Number(r.kg),0)))+' kg</p>'+(plan.note?'<p>'+text(plan.note)+'</p>':'')+'<p>Semua bahan ini dicatat sekali saat hasil disimpan.</p>':'<p>'+text(context.choices.length?'Pilih bahan di atas untuk melihat kilogram yang ditetapkan owner.':'Owner menetapkan bahan dan kilogram untuk PO ini di Stok Bahan.')+'</p>')+(draft.needsReview?'<div class="cutting-review"><p>Data PO atau bahan berubah. Periksa kembali; angka yang diketik tetap disimpan.</p><button class="sec" type="button" onclick="reviewCuttingWorkerData()"'+(context.rootMismatch?' disabled':'')+'>Sudah saya periksa</button></div>':'')+(unsupported.length?'<div class="cutting-review"><p>Angka di luar bahan ini: '+unsupported.map(id=>text(draft.names[id]||id)+': '+text(draft.quantities[id])+' pcs').join(', ')+'.</p><button class="sec" type="button" onclick="clearUnsupportedCuttingSizes()">Kosongkan ukuran terkunci</button></div>':'')+'</div>';
      const nextOutputSignature=JSON.stringify([groupSignature(group),selectedPlan,[...allowed]]);
      if(outputSignature!==nextOutputSignature){
        outputs.innerHTML='<h3>Hasil potong setiap ukuran</h3><p>Isi jumlah dalam pcs. Isi 0 untuk ukuran yang tidak dipotong.</p>'+group.products.map((p,i)=>{
          const id=String(p.id),locked=!!plan&&!allowed.has(id),value=Object.prototype.hasOwnProperty.call(draft.quantities,id)?draft.quantities[id]:'0';
          return '<div class="cutting-size-row'+(locked?' cutting-size-locked':'')+'"><label for="cuttingQty'+i+'">'+text(p.size||p.namaBarang)+' <span>· pcs</span>'+(locked?'<small>Belum termasuk bahan ini</small>':'')+'</label><input id="cuttingQty'+i+'" class="cutting-result-qty" data-product-id="'+text(id)+'" type="number" inputmode="numeric" min="0" step="1" value="'+text(value)+'"'+(locked?' disabled':'')+'></div>';
        }).join('');
        outputSignature=nextOutputSignature;
      }
    }
    const problem=inputProblem(),selectionProblem=contextProblem(context,draft);
    button.disabled=submitting||!!problem||!!selectionProblem;
    if(!submitting)message(problem||(!groups.length?'Tidak ada PO aktif yang belum dipotong. Hasil sebelumnya tetap ada di Riwayat hasil potong.':selectionProblem),!!problem||context.rootMismatch||!!(draft&&draft.needsReview));
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
    captureDraft();
    const group=activePOs().find(p=>p.id===el('cuttingPlanSelect').value),context=getContext(group,el('cuttingMaterialSelect').value),draft=group&&drafts.get(group.id);
    if(!draft||group.id!==selectedPO||context.signature!==formSignature){renderCuttingWorker();message('PO atau bahan berubah. Periksa data terbaru dan angka yang sudah diketik sebelum menyimpan.',true);return;}
    const selectionProblem=contextProblem(context,draft);if(selectionProblem){message(selectionProblem,true);return;}
    const plan=context.plan,worker=rows(META.tukang).find(w=>String(w.id)===el('cuttingWorkerSelect').value);
    if(!worker){message('Pilih nama tukang potong terlebih dahulu.',true);return;}
    const quantities={},rates={};
    planProducts(plan).forEach(p=>{quantities[p.id]=Number(draft.quantities[String(p.id)]||0);rates[p.id]=getTarif(p.series,p.namaBarang);});
    submitting=true;el('cuttingWorkerSave').disabled=true;
    try{
      const cuts=CuttingPlan.buildCuts(CUTTING_ROOT,plan.id,quantities,{id:uid(),tanggal:el('cuttingWorkDate').value||today(),tukangId:worker.id,tukangNama:worker.nama,tarif:rates});
      if(!confirm('Simpan hasil potong PO '+groupLabel(group)+'?\n\n'+planProducts(plan).map(p=>(p.size||p.namaBarang)+': '+(quantities[p.id]||0)+' pcs').join('\n')+'\n\nBahan '+kg(rows(plan.rolls).reduce((n,r)=>n+Number(r.kg),0))+' kg dicatat satu kali.'))return;
      const latest=getContext(activePOs().find(p=>p.id===group.id),plan.id);
      if(latest.signature!==formSignature||latest.rootMismatch)throw new Error('PO atau bahan berubah. Periksa data terbaru sebelum menyimpan. Angka tetap disimpan.');
      const next=potongClone(DB_PRODUKSI);
      cuts.forEach(row=>{const p=next.find(p=>String(p.id)===String(row.productId));if(!p)throw new Error('Barang berubah. Tunggu data terbaru lalu pilih kembali.');if(!Array.isArray(p.potong))p.potong=[];p.potong.push(row.entry);});
      CuttingPlan.applyCuts(CUTTING_ROOT,next,STOK_MIRROR);
      await stageCuttingWorkerDraft(next);
      await flushPotongPending();
      const state=potongJournal.status();
      if(state.pending||state.error||!state.durable)throw new Error('Masih ada perubahan menunggu konfirmasi pusat.');
      drafts.delete(group.id);selectedPO='';selectedPlan='';outputSignature='';renderAll();
      message('Hasil potong sudah dikonfirmasi pusat.',false);showToast('Hasil potong dikonfirmasi pusat.');
    }catch(error){message(error.message+(potongJournal&&potongJournal.status().pending?' Draf tetap tersimpan; periksa Setup sebelum mengisi ulang.':''),true);updateSyncTag();}
    finally{
      submitting=false;
      const current=getContext(activePOs().find(p=>p.id===el('cuttingPlanSelect').value),el('cuttingMaterialSelect').value),currentDraft=current.group&&drafts.get(current.group.id);
      el('cuttingWorkerSave').disabled=!!inputProblem()||!currentDraft||current.signature!==formSignature||!!contextProblem(current,currentDraft);
    }
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
