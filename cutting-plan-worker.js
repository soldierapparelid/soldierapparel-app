(function(){
  'use strict';
  let selectedPO='',selectedPlan='',formSignature='',outputSignature='',submitting=false,explicitMaterialChange=false;
  let canReturnAfterSave=false;
  const drafts=new Map(),el=id=>document.getElementById(id);
  const text=value=>esc(String(value==null?'':value)).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const rows=value=>ProductionMaterials.rows(value);
  const kg=value=>Number(value).toLocaleString('id-ID',{maximumFractionDigits:6});
  function message(value,error){const node=el('cuttingWorkerMessage');if(node){node.textContent=value;node.dataset.error=error?'true':'false';}}
  function renderBackButton(){
    const button=el('cuttingWorkerBack');if(!button)return;
    button.hidden=!el('cuttingPlanSelect').value&&!canReturnAfterSave;
    button.disabled=submitting;
  }
  // Work choices only: never remove cuts, close the PO, or change material history.
  // Sizes already cut disappear; the other sizes remain available for later days.
  function uncutPOs(source){
    return window.CuttingPlan&&typeof CuttingPlan.uncutPOs==='function'?CuttingPlan.uncutPOs(source):[];
  }
  function activePOs(){
    const local=uncutPOs(DB_PRODUKSI);
    if(!CUTTING_ROOT)return local;
    const central=new Set(uncutPOs(CUTTING_ROOT).map(group=>group.id));
    return local.filter(group=>central.has(group.id));
  }
  function planProducts(plan){
    // A remote archive/deactivation invalidates the allowance, not the page.
    try{return typeof CuttingPlan.remainingPlanProducts==='function'?CuttingPlan.remainingPlanProducts(CUTTING_ROOT,plan):[];}
    catch(error){return [];}
  }
  function groupSignature(group){return group?JSON.stringify(group.products.map(p=>[String(p.id),CuttingPlan.cycle(p),p.series||'',p.namaBarang||'',p.size||'']).sort((a,b)=>a[0].localeCompare(b[0]))):'';}
  function readyPlans(group){
    if(!group||!CUTTING_ROOT)return [];
    const rootGroup=uncutPOs(CUTTING_ROOT).find(p=>p.id===group.id);
    return CuttingPlan.plans(CUTTING_ROOT).filter(plan=>['ready','in_progress'].includes(plan.status)&&planProducts(plan).length&&CuttingPlan.matchesPlan(group,plan)&&rootGroup&&CuttingPlan.matchesPlan(rootGroup,plan));
  }
  function hasResults(group){return group.products.some(p=>rows(p.potong).some(c=>Number(c.jumlah)>0));}
  function materialDataProblem(group){
    if(inputProblem())return true;
    const central=group&&CUTTING_ROOT?uncutPOs(CUTTING_ROOT).find(p=>p.id===group.id):null;
    return !!group&&groupSignature(group)!==groupSignature(central);
  }
  function poStatus(group){
    if(materialDataProblem(group))return 'Periksa data bahan';
    const choices=readyPlans(group);
    return choices.some(p=>p.status==='ready')?'Bahan disiapkan':choices.length?'Lanjut ukuran tersisa':hasResults(group)?'Sudah ada hasil':'Bahan belum ditentukan';
  }
  function planSizes(plan){return planProducts(plan).map(p=>p.size||'Tanpa size').join(' · ');}
  function actualStockRoll(roll){return roll.quantityPolicy==='actual-stock-v1';}
  function rollDescription(roll){return roll.jenis+' · '+(roll.rolNum?'Rol '+roll.rolNum+' · ':'')+kg(roll.kg)+' '+CuttingPlan.unitLabel(roll.unit||'kg');}
  function materialState(plan){return CuttingPlan.materialChoices(CUTTING_ROOT,STOK_MIRROR,plan.id);}
  function materialDraft(draft,plan){
    if(!draft||!plan)return {selected:[],quantities:{},noMaterial:false};
    if(!draft.materials)draft.materials={};
    const key=String(plan.id);if(!draft.materials[key])draft.materials[key]={selected:[],quantities:{},noMaterial:false};return draft.materials[key];
  }
  function selectedMaterials(context,draft){
    if(!context.plan||!context.material||context.material.mode==='legacy')return [];
    const choice=materialDraft(draft,context.plan);
    return choice.selected.map(id=>({purchaseId:id,kg:Number(choice.quantities[id])}));
  }
  function materialSelectionProblem(context,draft){
    if(context.materialError)return context.materialError;
    if(!context.plan||!context.material||context.material.mode==='legacy')return '';
    const choice=materialDraft(draft,context.plan),list=selectedMaterials(context,draft);
    if(!list.length)return context.material.canContinueWithoutMaterial&&choice.noMaterial?'':'Centang rol yang dipakai untuk hasil ini. Jika melanjutkan bahan yang sudah dicatat, konfirmasi tidak ada bahan tambahan.';
    for(const picked of list){
      const roll=rows(context.material.rolls).find(r=>String(r.purchaseId)===picked.purchaseId);
      if(!roll) return 'Rol pilihan sudah tidak termasuk jatah ini. Periksa kembali bahan terbaru.';
      if(!Number.isFinite(picked.kg)||picked.kg<=0)return 'Isi jumlah bahan yang dipakai lebih dari nol.';
      if(picked.kg>Number(roll.remaining)||picked.kg>Number(roll.available))return 'Jumlah '+roll.jenis+' · Rol '+(roll.rolNum||roll.purchaseId)+' melebihi sisa yang tersedia. Periksa jumlah atau lepaskan pilihan rol ini.';
    }
    return '';
  }
  function cardMaterials(group,choices){
    if(materialDataProblem(group))return '<span class="cutting-card-materials">Tunggu data terbaru sebelum mengambil bahan.</span>';
    return choices.map((plan,index)=>{
      const label=choices.length>1?'Jatah '+(index+1)+' · ':'';
      let state;try{state=materialState(plan);}catch(error){return '<span class="cutting-card-materials">Periksa data bahan sebelum memilih rol.</span>';}
      if(!usableMaterial(state))return '<span class="cutting-card-materials"><b>'+text(label+'Tidak tersedia')+'</b><span>Rincian rol perlu diperiksa owner; gunakan jatah lain yang tersedia.</span></span>';
      if(state.mode==='legacy')return '<span class="cutting-card-materials"><b>'+text(label+'Bahan sudah dicatat')+'</b><span>Lanjut ukuran '+text(planSizes(plan))+'; tidak mengambil jatah lagi.</span></span>';
      const list=rows(state.rolls).filter(r=>Number(r.remaining)>0).map(r=>({...r,kg:r.remaining}));
      return '<span class="cutting-card-materials"><b>'+text(label+list.length+' rincian rol'+(list.some(actualStockRoll)?' · ada bahan sesuai pemakaian':' tersisa · '+CuttingPlan.formatQuantities(list)))+'</b>'+list.slice(0,2).map(r=>'<span>'+text(rollDescription(r)+(actualStockRoll(r)?' tersedia; isi sesuai pemakaian':''))+'</span>').join('')+(list.length>2?'<span>+ '+(list.length-2)+' rincian rol lainnya · buka untuk melihat</span>':'')+'<span>Pilih hanya rol yang dipakai untuk hasil hari ini.</span></span>';
    }).join('')+(choices.length>1?'<span class="cutting-card-choice">'+choices.length+' jatah terpisah · pilih yang dikerjakan</span>':'');
  }
  function guideRolls(plan,recorded){
    return '<ul class="cutting-guide-rolls">'+rows(plan.rolls).map(roll=>{
      const purchases=rows(STOK_MIRROR&&STOK_MIRROR.pembelian).filter(p=>String(p.id)===String(roll.purchaseId)),purchase=purchases.length===1?purchases[0]:null;
      const details=[roll.rolNum?'Rol '+roll.rolNum:'Nomor rol belum ada',purchase&&purchase.tanggal?'Beli '+purchase.tanggal:'',purchase&&purchase.invoice?'Nota '+purchase.invoice:''].filter(Boolean).join(' · ');
      return '<li><div><b>'+text(roll.jenis)+'</b><small>'+text(details)+'</small></div><strong><small>'+(recorded?'Tercatat':'Gunakan')+'</small>'+text(kg(roll.kg)+' '+CuttingPlan.unitLabel(roll.unit||'kg'))+'</strong></li>';
    }).join('')+'</ul>';
  }
  function selectedTotal(context,draft){
    const choice=materialDraft(draft,context.plan),picked=selectedMaterials(context,draft);
    if(picked.some(r=>!Number.isFinite(r.kg)||r.kg<=0||!rows(context.material.rolls).some(roll=>String(roll.purchaseId)===r.purchaseId)))return 'Periksa pilihan rol dan jumlah bahan sebelum menyimpan';
    const list=picked.map(picked=>{const roll=rows(context.material.rolls).find(r=>String(r.purchaseId)===picked.purchaseId);return {...roll,kg:picked.kg};});
    return list.length?'Dicatat untuk hasil ini · '+CuttingPlan.formatQuantities(list):choice.noMaterial?'Tanpa bahan tambahan · memakai bahan yang sudah dicatat':'Belum ada rol dipilih';
  }
  function guideRollChoices(context,draft){
    const choice=materialDraft(draft,context.plan),all=rows(context.material.rolls),list=all.filter(r=>Number(r.remaining)>0||choice.selected.includes(String(r.purchaseId))),missing=choice.selected.filter(id=>!all.some(r=>String(r.purchaseId)===id));
    return '<div class="cutting-use-choices">'+list.map((roll,index)=>{
      const id=String(roll.purchaseId),selected=choice.selected.includes(id),max=Math.max(0,Math.min(Number(roll.remaining),Number(roll.available))),unit=CuttingPlan.unitLabel(roll.unit||'kg');
      const purchases=rows(STOK_MIRROR&&STOK_MIRROR.pembelian).filter(p=>String(p.id)===id),purchase=purchases.length===1?purchases[0]:null;
      const details=[roll.rolNum?'Rol '+roll.rolNum:'Nomor rol belum ada',purchase&&purchase.tanggal?'Beli '+purchase.tanggal:'',purchase&&purchase.invoice?'Nota '+purchase.invoice:''].filter(Boolean).join(' · ');
      return '<article class="cutting-use-roll'+(max<=0?' is-unavailable':'')+'"><label class="cutting-use-check"><input type="checkbox" data-cutting-use="'+text(id)+'"'+(selected?' checked':'')+(max<=0&&!selected?' disabled':'')+'><span><b>'+text(roll.jenis)+'</b><small>'+text(details)+'</small></span></label><p class="cutting-use-remaining">'+(actualStockRoll(roll)?'Sesuai pemakaian · stok tersedia ':'Disiapkan tersisa ')+text(kg(roll.remaining)+' '+unit)+(max<Number(roll.remaining)?' · Bisa dipakai '+text(kg(max)+' '+unit):'')+'</p>'+(roll.reason?'<p class="cutting-use-warning">'+text(roll.reason)+'</p>':'')+(selected?'<label class="cutting-use-amount" for="cuttingUseQty'+index+'">Dipakai untuk hasil ini ('+text(unit)+')<input id="cuttingUseQty'+index+'" data-cutting-use-qty="'+text(id)+'" type="number" min="0" max="'+text(max)+'" step="any" inputmode="decimal" value="'+text(choice.quantities[id]||'')+'"></label>':'')+'</article>';
    }).join('')+missing.map(id=>'<label class="cutting-use-check cutting-use-none"><input type="checkbox" data-cutting-use="'+text(id)+'" checked><span>Pilihan rol lama tidak termasuk jatah terbaru. Lepas centang ini, lalu pilih rol yang tersedia.</span></label>').join('')+(!list.length?'<p>Tidak ada sisa rol pada jatah ini.</p>':'')+'</div>'+(context.material.canContinueWithoutMaterial?'<label class="cutting-use-check cutting-use-none"><input type="checkbox" data-cutting-no-material'+(choice.noMaterial?' checked':'')+'><span>Tidak ada bahan tambahan; memakai bahan yang sudah dicatat.</span></label>':'')+'<p id="cuttingSelectedMaterialTotal" class="cutting-material-total" aria-live="polite">'+text(selectedTotal(context,draft))+'</p>';
  }
  function materialGuide(context,draft){
    const plan=context.plan,unverified=materialDataProblem(context.group)||!!context.materialError||!!(draft&&draft.needsReview),legacy=!!(context.material&&context.material.mode==='legacy');
    const hasUsableChoice=context.choiceStates.some(choice=>choice.usable);
    const heading=unverified?'Periksa data bahan dulu':!plan?(hasUsableChoice?'Pilih jatah yang dikerjakan':context.choices.length?'Jatah bahan perlu diperiksa':'Tunggu bahan dari owner'):legacy?'Lanjutkan hasil ukuran tersisa':'Pilih bahan yang benar-benar dipakai';
    let content='<section class="cutting-material-guide" data-state="'+(unverified?'check':!plan?'waiting':legacy?'recorded':'ready')+'"><span class="cutting-guide-eyebrow">BAHAN UNTUK PO INI</span><h3 id="cuttingMaterialGuideHeading" tabindex="-1">'+text(heading)+'</h3>';
    if(unverified)return content+'<p>Data bahan belum terkonfirmasi. Jangan mengambil bahan berdasarkan tampilan ini dulu. '+text(draft&&draft.needsReview?'Periksa perubahan di bawah, lalu konfirmasi pemeriksaan.':'Tunggu sinkronisasi atau periksa pesan di bawah.')+'</p></section>';
    if(!plan)return content+'<p>'+text(hasUsableChoice?'Pilih jatah yang tersedia di atas untuk melihat kain dan jumlah yang harus dipakai.':context.choices.length?'Rincian rol pada jatah ini belum bisa dipakai. Minta owner memeriksanya di Stok Bahan.':'Owner perlu menyiapkan bahan untuk PO ini di Stok Bahan.')+'</p></section>';
    if(rows(plan.rolls).some(actualStockRoll))content+='<p class="cutting-guide-note"><b>Bahan sesuai pemakaian:</b> isi jumlah bahan yang benar-benar dipakai sesuai satuan rol. Jumlah boleh berbeda dari jatah lama, selama stok rol masih tersedia. Rol tidak dipilih otomatis.</p>';
    content+='<p class="cutting-guide-sizes">Untuk ukuran '+text(planSizes(plan))+'</p>';
    if(legacy){
      content+='<p><b>Bahan sudah dicatat pada hasil pertama.</b> Lanjutkan pencatatan hasil dari jatah yang sama, bukan mengambil bahan baru. Hasil ukuran berikutnya tidak mengurangi bahan lagi.</p><details class="cutting-guide-recorded"><summary>Lihat bahan yang sudah dicatat</summary>'+guideRolls(plan,true)+'</details>';
    }else{
      content+='<p class="cutting-guide-note">Centang rol yang dipakai untuk hasil hari ini, lalu isi jumlah pemakaiannya. Cocokkan nomor rol dan timbang bahan. Bahan lain tetap disiapkan untuk ukuran berikutnya.</p>'+guideRollChoices(context,draft)+'<small class="cutting-guide-ledger">Hanya bahan yang dipilih di sini yang dicatat. Tidak otomatis memakai seluruh jatah.</small>';
      if(context.material.recorded){const used=rows(context.material.rolls).filter(r=>Number(r.used)>0).map(r=>({...r,kg:r.used}));content+='<p class="cutting-guide-note">Sebagian bahan sudah dicatat pada hasil sebelumnya. Jika tidak ada bahan tambahan, stok tidak dikurangi lagi.</p>'+(used.length?'<details class="cutting-guide-recorded"><summary>Lihat bahan yang sudah dicatat</summary>'+guideRolls({rolls:used},true)+'</details>':'');}
    }
    if(plan.note)content+='<p class="cutting-guide-owner-note"><b>Catatan owner:</b> '+text(plan.note)+'</p>';
    return content+'</section>';
  }
  function groupLabel(group){return [group.series,group.namaBarang,group.orderId?'PO '+group.orderId:''].filter(Boolean).join(' · ');}
  function groupPhoto(group){const first=group.products[0];return getProductImage(first.series,first.namaBarang)||group.products.map(p=>p._offlineGambar||(OFFLINE_ORDER_IMAGES||{})[p._offlineItemId]).find(Boolean)||'';}
  function renderPicker(groups,chosen){
    const picker=el('cuttingPOPicker'),heading=el('cuttingPOPickerHeading'),cards=el('cuttingPOCards'),search=el('cuttingPOSearch');
    if(!picker||!heading||!cards||!search)return;
    const query=String(search.value||'').trim().toLocaleLowerCase('id-ID'),terms=query.split(/\s+/).filter(Boolean);
    const matches=groups.filter(group=>{const haystack=groupLabel(group).toLocaleLowerCase('id-ID');return terms.every(term=>haystack.includes(term));});
    heading.textContent=chosen?'Ganti barang · '+chosen.namaBarang:'1. Pilih barang yang dipotong';
    if(el('cuttingPOCount'))el('cuttingPOCount').textContent=matches.length+' barang · '+matches.reduce((sum,group)=>sum+group.products.length,0)+' ukuran belum dipotong';
    if(!chosen)picker.open=true;
    cards.innerHTML=matches.map(group=>{
      const photo=groupPhoto(group),selected=chosen&&chosen.id===group.id,choices=readyPlans(group);
      return '<button type="button" class="cutting-po-card'+(selected?' is-selected':'')+'" data-cutting-po="'+text(group.id)+'" aria-pressed="'+!!selected+'">'+(photo?'<img src="'+text(photo)+'" alt="'+text(group.namaBarang)+'" loading="lazy">':'<span class="cutting-card-no-photo">Belum ada gambar</span>')+'<span class="cutting-card-copy"><strong>'+text(group.namaBarang)+'</strong><span>'+text(group.series)+'</span><small>Belum dipotong: '+text(group.products.map(p=>p.size||'Tanpa size').join(' · '))+'</small><b class="cutting-card-status" data-ready="'+(!!choices.length&&!materialDataProblem(group))+'">'+text(poStatus(group))+'</b>'+cardMaterials(group,choices)+'</span></button>';
    }).join('')||'<p class="cutting-picker-empty">'+(groups.length?'Barang tidak ditemukan. Coba nama barang atau series lain.':'Tidak ada PO aktif yang belum dipotong. Riwayat tetap tersimpan.')+'</p>';
  }
  function workerProblem(){
    const workers=rows(META.tukang);
    if(!workers.length)return 'Nama tukang potong belum diatur. Minta admin menambahkan namanya di Setup.';
    return workers.some(w=>String(w.id)===el('cuttingWorkerSelect').value)?'':'Pilih nama tukang potong terlebih dahulu.';
  }
  function materialLabel(choice,index){
    const plan=choice.plan,state=choice.material;
    if(!choice.usable)return 'Jatah '+(index+1)+' · Tidak tersedia · '+(choice.materialError||'Rol tidak tersedia; minta owner periksa');
    return 'Jatah '+(index+1)+' · '+(state.mode==='legacy'?'Bahan sudah dicatat':'Ukuran '+planSizes(plan))+' · '+(state.mode==='legacy'?rows(plan.rolls):rows(state.rolls).filter(r=>Number(r.remaining)>0).map(r=>({...r,kg:r.remaining}))).map(r=>rollDescription(r)+(actualStockRoll(r)?' tersedia · sesuai pemakaian':'')).join(' + ');
  }
  function usableMaterial(material){
    return !!material&&(material.mode==='legacy'||material.canContinueWithoutMaterial===true||rows(material.rolls).some(r=>Number.isFinite(Number(r.remaining))&&Number(r.remaining)>0&&Number.isFinite(Number(r.available))&&Number(r.available)>0));
  }
  function getContext(group,preferredPlan,allowAuto=true){
    const choices=readyPlans(group),choiceStates=choices.map(plan=>{
      try{const material=materialState(plan);return {plan,material,materialError:'',usable:usableMaterial(material)};}
      catch(error){return {plan,material:null,materialError:error.message,usable:false};}
    }),usable=choiceStates.filter(choice=>choice.usable);
    // Preserve a previous choice (including a removed one) until the worker
    // chooses again. Never move typed results to a different allowance silently.
    const choice=preferredPlan?choiceStates.find(choice=>String(choice.plan.id)===String(preferredPlan)):allowAuto&&usable.length===1?usable[0]:null;
    const plan=choice&&choice.plan;
    const rootGroup=group&&CUTTING_ROOT?uncutPOs(CUTTING_ROOT).find(p=>p.id===group.id):null;
    const material=choice&&choice.material||null,materialError=choice&&choice.materialError||'';
    return {group,choices,choiceStates,plan,material,materialError,rootMismatch:!!group&&groupSignature(group)!==groupSignature(rootGroup),signature:group?JSON.stringify([groupSignature(group),groupSignature(rootGroup),plan||null,material,materialError]):''};
  }
  function captureDraft(){
    const draft=drafts.get(selectedPO);if(!draft)return;
    document.querySelectorAll('.cutting-result-qty').forEach(input=>{draft.quantities[input.dataset.productId]=input.value;});
  }
  function hasQuantity(draft){return Object.values(draft.quantities).some(value=>String(value).trim()!==''&&Number(value)!==0);}
  function hasMaterialSelection(draft){return Object.values(draft.materials||{}).some(value=>value.selected.length||value.noMaterial);}
  function unsupportedQuantities(context,draft){
    if(!context.plan)return [];
    const remaining=new Set(planProducts(context.plan).map(p=>String(p.id))),allowed=new Set(context.group.products.filter(p=>remaining.has(String(p.id))).map(p=>String(p.id)));
    return Object.keys(draft.quantities).filter(id=>!allowed.has(id)&&String(draft.quantities[id]).trim()!==''&&Number(draft.quantities[id])!==0);
  }
  function inputProblem(){
    if(!window.CuttingPlan||typeof CuttingPlan.uncutPOs!=='function'||typeof CuttingPlan.remainingPlanProducts!=='function'||typeof CuttingPlan.materialChoices!=='function')return 'Data PO belum termuat. Muat ulang tanpa reset data.';
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
    if(!context.choices.length)return hasResults(context.group)?'Sudah ada hasil potong. Untuk tambahan, minta owner mengisi bahan berikutnya.':'Bahan belum ditentukan. Minta owner isi kain dan jumlahnya di Stok Bahan.';
    if(!context.plan)return context.choiceStates.some(choice=>choice.usable)?'Pilih bahan yang sedang dikerjakan untuk PO ini.':'Jatah bahan belum bisa dipakai. Minta owner memeriksa rincian rol di Stok Bahan.';
    if(unsupportedQuantities(context,draft).length)return 'Ada angka pada ukuran yang tidak termasuk bahan ini. Periksa ukuran terkunci, lalu kosongkan angka tersebut atau pilih bahan yang sesuai.';
    if(draft.needsReview)return 'Data PO atau bahan berubah. Angka tetap disimpan. Periksa gambar, ukuran, bahan dan jumlahnya di bawah, lalu konfirmasi pemeriksaan.';
    return materialSelectionProblem(context,draft);
  }
  function currentMaterialDraft(){
    captureDraft();const draft=drafts.get(selectedPO),context=getContext(activePOs().find(p=>p.id===selectedPO),selectedPlan);
    if(!draft||!context.plan||!context.material||context.material.mode==='legacy'||submitting)return null;
    if(context.signature!==formSignature){renderCuttingWorker();return null;}
    return {draft,context,choice:materialDraft(draft,context.plan)};
  }
  window.changeAssignedCuttingRoll=function(purchaseId,checked){
    const state=currentMaterialDraft();if(!state)return;
    const id=String(purchaseId),roll=rows(state.context.material.rolls).find(r=>String(r.purchaseId)===id);
    if(checked&&(!roll||Number(roll.available)<=0||Number(roll.remaining)<=0))return;
    state.choice.selected=state.choice.selected.filter(value=>value!==id);
    if(checked){state.choice.selected.push(id);state.choice.noMaterial=false;if(!Object.prototype.hasOwnProperty.call(state.choice.quantities,id))state.choice.quantities[id]=actualStockRoll(roll)?'':String(Math.min(Number(roll.remaining),Number(roll.available)));}
    renderCuttingWorker();
  };
  window.updateAssignedCuttingRoll=function(purchaseId,value){
    if(submitting)return;
    const draft=drafts.get(selectedPO),choice=draft&&draft.materials&&draft.materials[selectedPlan],id=String(purchaseId);if(!choice||!choice.selected.includes(id))return;
    // Retain the latest keystroke even if a stock update arrived at the same time.
    choice.quantities[id]=String(value);const state=currentMaterialDraft();if(!state)return;
    const total=el('cuttingSelectedMaterialTotal');if(total)total.textContent=selectedTotal(state.context,state.draft);
    const problem=inputProblem()||contextProblem(state.context,state.draft)||workerProblem();el('cuttingWorkerSave').disabled=!!problem;message(problem,!!problem);
  };
  window.continueCuttingWithoutMaterial=function(checked){
    const state=currentMaterialDraft();if(!state||!state.context.material.canContinueWithoutMaterial)return;
    state.choice.noMaterial=!!checked;if(checked)state.choice.selected=[];renderCuttingWorker();
  };
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
  window.returnToCuttingMenu=function(){
    if(submitting)return;
    // Navigation only: keep typed quantities and the saved production journal.
    captureDraft();canReturnAfterSave=false;
    el('cuttingPlanSelect').value='';el('cuttingPOSearch').value='';
    renderCuttingWorker();
    const picker=el('cuttingPOPicker'),search=el('cuttingPOSearch');
    picker.open=true;
    if(typeof search.focus==='function')search.focus({preventScroll:true});
    if(typeof picker.scrollIntoView==='function')picker.scrollIntoView({behavior:'smooth',block:'start'});
  };
  window.renderCuttingWorker=function(){
    const select=el('cuttingPlanSelect'),material=el('cuttingMaterialSelect'),materialField=el('cuttingMaterialField'),summary=el('cuttingPlanSummary'),outputs=el('cuttingOutputRows'),button=el('cuttingWorkerSave'),worker=el('cuttingWorkerSelect');
    if(!select||!material||!materialField||!summary||!outputs||!button||!worker)return;
    captureDraft();
    const previous=select.value,groups=activePOs();
    select.innerHTML='<option value="">Pilih PO belum dipotong</option>'+groups.map(group=>'<option value="'+text(group.id)+'">'+text(groupLabel(group)+' · '+poStatus(group))+'</option>').join('');
    select.value=groups.some(p=>p.id===previous)?previous:'';
    const group=groups.find(p=>p.id===select.value);
    renderPicker(groups,group);
    if(group&&!drafts.has(group.id))drafts.set(group.id,{quantities:{},names:{},planId:'',signature:'',needsReview:false});
    const draft=group?drafts.get(group.id):null;
    const preferredPlan=selectedPO===select.value?(explicitMaterialChange?material.value:material.value||(draft&&draft.planId)):draft&&draft.planId;
    const allowAuto=!draft||(!hasQuantity(draft)&&!hasMaterialSelection(draft)&&!draft.needsReview);
    const context=getContext(group,preferredPlan,allowAuto),plan=context.plan;
    if(draft){
      group.products.forEach(p=>{draft.names[String(p.id)]=p.size||p.namaBarang;});
      if(draft.signature&&draft.signature!==context.signature&&(hasQuantity(draft)||hasMaterialSelection(draft))&&!explicitMaterialChange)draft.needsReview=true;
      draft.signature=context.signature;draft.planId=plan?String(plan.id):String(preferredPlan||'');
    }
    explicitMaterialChange=false;selectedPO=select.value;selectedPlan=plan?String(plan.id):String(preferredPlan||'');formSignature=context.signature;
    const missingPreferred=!!selectedPlan&&!context.choices.some(p=>String(p.id)===selectedPlan);
    material.innerHTML='<option value="">Pilih jatah yang sedang dikerjakan</option>'+(missingPreferred?'<option value="'+text(selectedPlan)+'" disabled>Jatah sebelumnya tidak tersedia. Pilih ulang.</option>':'')+context.choiceStates.map((choice,i)=>'<option value="'+text(choice.plan.id)+'"'+(choice.usable?'':' disabled')+'>'+text(materialLabel(choice,i))+'</option>').join('');
    material.value=selectedPlan;materialField.hidden=context.choices.length<2&&!missingPreferred&&(!!plan||!context.choices.length);
    const workers=rows(META.tukang),workerId=worker.value;
    worker.innerHTML='<option value="">Pilih nama Anda</option>'+workers.map(w=>'<option value="'+text(w.id)+'">'+text(w.nama)+'</option>').join('');
    worker.value=workers.length===1?String(workers[0].id):workers.some(w=>String(w.id)===workerId)?workerId:'';
    const workerField=el('cuttingWorkerField'),workerFixed=el('cuttingWorkerFixed');
    if(workerField)workerField.hidden=workers.length===1;
    if(workerFixed){workerFixed.hidden=workers.length!==1;workerFixed.textContent=workers.length===1?'Tukang potong: '+workers[0].nama:'';}
    if(!el('cuttingWorkDate').value)el('cuttingWorkDate').value=today();
    if(!group){summary.innerHTML='';outputs.innerHTML='';outputSignature='';}
    else{
      const first=group.products[0],photo=groupPhoto(group);
      const unsupported=unsupportedQuantities(context,draft),allowed=new Set(plan?planProducts(plan).map(p=>String(p.id)):[]);
      summary.innerHTML='<div class="cutting-plan-summary"><div class="cutting-product-heading">'+(photo?'<img src="'+text(photo)+'" alt="'+text(first.namaBarang)+'">':'<div class="cutting-photo-empty">Belum ada gambar</div>')+'<div><h3>'+text(group.namaBarang)+'</h3><p class="cutting-po-detail">'+text([group.series,group.orderId?'PO '+group.orderId:''].filter(Boolean).join(' · '))+'</p></div></div>'+materialGuide(context,draft)+(draft.needsReview?'<div class="cutting-review"><p>Data PO atau bahan berubah. Periksa kembali; angka yang diketik tetap disimpan.</p><button class="sec" type="button" onclick="reviewCuttingWorkerData()"'+(context.rootMismatch?' disabled':'')+'>Sudah saya periksa</button></div>':'')+(unsupported.length?'<div class="cutting-review"><p>Angka di luar bahan ini: '+unsupported.map(id=>text(draft.names[id]||id)+': '+text(draft.quantities[id])+' pcs').join(', ')+'.</p><button class="sec" type="button" onclick="clearUnsupportedCuttingSizes()">Kosongkan ukuran terkunci</button></div>':'')+'</div>';
      const nextOutputSignature=JSON.stringify([groupSignature(group),selectedPlan,[...allowed]]);
      if(outputSignature!==nextOutputSignature){
        outputs.innerHTML='<h3>Hasil potong hari ini</h3><p>Isi ukuran yang sudah selesai saja. Ukuran yang masih 0 bisa dicatat hari berikutnya.</p>'+group.products.map((p,i)=>{
          const id=String(p.id),locked=!!plan&&!allowed.has(id),value=Object.prototype.hasOwnProperty.call(draft.quantities,id)?draft.quantities[id]:'0';
          return '<div class="cutting-size-row'+(locked?' cutting-size-locked':'')+'"><label for="cuttingQty'+i+'">'+text(p.size||p.namaBarang)+' <span>· pcs</span>'+(locked?'<small>Belum termasuk bahan ini</small>':'')+'</label><input id="cuttingQty'+i+'" class="cutting-result-qty" data-product-id="'+text(id)+'" type="number" inputmode="numeric" min="0" step="1" value="'+text(value)+'"'+(locked?' disabled':'')+'></div>';
        }).join('');
        outputSignature=nextOutputSignature;
      }
    }
    const problem=inputProblem(),selectionProblem=contextProblem(context,draft)||workerProblem();
    button.disabled=submitting||!!problem||!!selectionProblem;
    renderBackButton();
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
    submitting=true;el('cuttingWorkerSave').disabled=true;renderBackButton();
    try{
      const legacy=context.material.mode==='legacy',selection=selectedMaterials(context,draft),materialRows=selection.map(picked=>({...rows(context.material.rolls).find(r=>String(r.purchaseId)===picked.purchaseId),kg:picked.kg}));
      const cuts=CuttingPlan.buildCuts(CUTTING_ROOT,plan.id,quantities,{id:uid(),tanggal:el('cuttingWorkDate').value||today(),tukangId:worker.id,tukangNama:worker.nama,tarif:rates,...(!legacy?{materialSelection:selection}:{})});
      if(!confirm('Simpan hasil potong PO '+groupLabel(group)+'?\n\nTanggal: '+(el('cuttingWorkDate').value||today())+'\n'+planProducts(plan).filter(p=>quantities[p.id]>0).map(p=>(p.size||p.namaBarang)+': '+quantities[p.id]+' pcs').join('\n')+'\n\n'+(legacy?'Bahan sudah dicatat sebelumnya. Bahan tidak dikurangi lagi.':!materialRows.length?'Tanpa bahan tambahan: memakai bahan yang sudah dicatat. Stok tidak dikurangi lagi.':'Bahan yang dicatat untuk hasil ini:\n'+materialRows.map(rollDescription).join('\n')+'\nTotal '+CuttingPlan.formatQuantities(materialRows)+'. Hanya bahan ini yang dikurangi; sisa jatah tetap tersedia untuk ukuran berikutnya.')))return;
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
      canReturnAfterSave=true;
      message('Hasil potong sudah dikonfirmasi pusat.',false);showToast('Hasil potong dikonfirmasi pusat.');
    }catch(error){message(error.message+(potongJournal&&potongJournal.status().pending?' Draf tetap tersimpan; periksa Setup sebelum mengisi ulang.':''),true);updateSyncTag();}
    finally{
      submitting=false;
      const current=getContext(activePOs().find(p=>p.id===el('cuttingPlanSelect').value),el('cuttingMaterialSelect').value),currentDraft=current.group&&drafts.get(current.group.id);
      el('cuttingWorkerSave').disabled=!!inputProblem()||!currentDraft||current.signature!==formSignature||!!contextProblem(current,currentDraft)||!!workerProblem();
      renderBackButton();
    }
  };
  if(el('cuttingPlanSummary')){
    el('cuttingPlanSummary').addEventListener('change',event=>{
      const checkbox=event.target.closest('[data-cutting-use]');if(checkbox){window.changeAssignedCuttingRoll(checkbox.dataset.cuttingUse,checkbox.checked);return;}
      const noMaterial=event.target.closest('[data-cutting-no-material]');if(noMaterial)window.continueCuttingWithoutMaterial(noMaterial.checked);
    });
    el('cuttingPlanSummary').addEventListener('input',event=>{const input=event.target.closest('[data-cutting-use-qty]');if(input)window.updateAssignedCuttingRoll(input.dataset.cuttingUseQty,input.value);});
  }
  if(el('cuttingPOSearch'))el('cuttingPOSearch').addEventListener('input',()=>{const groups=activePOs();renderPicker(groups,groups.find(group=>group.id===el('cuttingPlanSelect').value));});
  if(el('cuttingPOCards'))el('cuttingPOCards').addEventListener('click',event=>{
    const button=event.target.closest('[data-cutting-po]');if(!button||submitting)return;
    const group=activePOs().find(group=>group.id===button.dataset.cuttingPo);if(!group){renderCuttingWorker();return;}
    canReturnAfterSave=false;el('cuttingPlanSelect').value=group.id;renderCuttingWorker();el('cuttingPOPicker').open=false;
    const heading=el('cuttingMaterialGuideHeading');if(heading&&typeof heading.focus==='function')heading.focus({preventScroll:true});
    const summary=el('cuttingPlanSummary');if(summary&&typeof summary.scrollIntoView==='function')summary.scrollIntoView({behavior:'smooth',block:'start'});
  });
  // Keep maintenance controls available without exposing them during ordinary input.
  const setup=el('tab-setup');
  if(setup&&typeof setup.replaceChildren==='function'){
    const details=document.createElement('details'),summary=document.createElement('summary');details.className='cutting-advanced';summary.textContent='Pengaturan lanjutan dan pemulihan';details.appendChild(summary);
    Array.from(setup.children).forEach(child=>details.appendChild(child));setup.appendChild(details);
  }
  if(window.appReady)window.appReady.then(renderCuttingWorker);
  window.addEventListener('app-sync-storage-change',()=>{if(typeof potongBootReady!=='undefined'&&potongBootReady)renderCuttingWorker();});
})();
