/* Owner-issued cutting plans. Stock records remain owned by the stock journal. */
(function(){
  'use strict';
  const el=id=>document.getElementById(id),clone=value=>AppSyncJournal.clone(value),rows=value=>ProductionMaterials.rows(value);
  let busy=false,availabilityError='',attempt=null;
  let supplement=null,supplementAttempt=null,supplementNotice='',supplementNoticeError=false;
  let form={group:'',productIds:[],rolls:[],note:''};
  const openMaterials=new Set();
  const drafts=new Map(),rollChoices=new Map();
  const qty=value=>Number(value||0).toLocaleString('id-ID',{maximumFractionDigits:6});
  function groups(root=CUTTING_ROOT){
    return new Map((typeof CuttingPlan.uncutPOs==='function'?CuttingPlan.uncutPOs(root):[]).map(group=>[group.id,group.products]));
  }
  function requireUncut(root,draft){
    const products=groups(root).get(draft.group);
    if(!products||draft.productIds.some(id=>!products.some(p=>String(p.id)===id)))throw new Error('Ukuran PO ini sudah dipotong, tidak aktif, atau merupakan PO offline. Pilih ukuran PO aktif yang belum dipotong.');
  }
  function readyError(target){
    if(!window.CuttingPlan||!window.CuttingTransaction||!stokJournal||!stokBootReady)return 'Data jatah dan penyimpanan belum siap.';
    const state=stokJournal.status();
    if(!FB.connected||!firebaseSyncReadyStok||!FB.get||!FB.onValue||!FB.runTransaction)return 'Sambungkan internet dan tunggu data pusat sebelum menerbitkan jatah.';
    if(target&&target!==FB.dbUrl)return 'Tujuan koneksi berubah. Buka kembali jatah sebelum melanjutkan.';
    if(!state.baseKnown||state.target!==FB.dbUrl||!state.durable||state.saving||state.pending||state.foreignPending||state.detached||state.conflict||state.error||stokWritePromise||stokSyncError||Object.keys(stokReadErrors).length)return 'Selesaikan penyimpanan atau kendala sinkronisasi stok terlebih dahulu.';
    return '';
  }
  function requireReady(target){const error=readyError(target);if(error)throw new Error(error);}
  function message(text,error){el('cuttingAdminMessage').textContent=text;el('cuttingAdminMessage').dataset.error=String(!!error);}
  function supplementMessage(text,error){supplementNotice=text;supplementNoticeError=!!error;const node=el('cuttingSupplementMessage');if(node){node.textContent=text;node.dataset.error=String(!!error);}}
  function supplementTargets(root,id){return typeof CuttingPlan.supplementTargets==='function'?CuttingPlan.supplementTargets(root,id):[];}
  function renderSupplement(){
    const notice='<p id="cuttingSupplementMessage" class="cutting-admin-message" role="status" aria-live="polite" data-error="'+supplementNoticeError+'">'+esc(supplementNotice)+'</p>';
    if(!supplement)return notice;
    const source=CuttingPlan.plans(supplement.root).find(p=>String(p.id)===supplement.sourceId),targets=supplementTargets(supplement.root,supplement.sourceId),target=targets.find(t=>String(t.planId)===supplement.targetPlanId),locked=busy||!!supplementAttempt,selected=rows(source.rolls).filter(r=>supplement.purchaseIds.includes(String(r.purchaseId)));
    return '<section class="cutting-supplement" aria-labelledby="cuttingSupplementTitle"><div class="cutting-history-heading"><h3 id="cuttingSupplementTitle">Tambahkan bahan ke hasil tersimpan</h3><button type="button" class="sec small" data-close-supplement'+(locked?' disabled':'')+'>Tutup</button></div><p class="cutting-supplement-intro">'+esc(source.namaBarang||'Hasil potong')+' · Tambahkan pemakaian bahan yang tertinggal. Jumlah pcs, tanggal hasil, dan upah tidak berubah.</p><label for="cuttingSupplementTarget">Hasil potong yang memakai bahan ini</label><select id="cuttingSupplementTarget"'+(locked?' disabled':'')+'><option value="">Pilih hasil potong…</option>'+targets.map(t=>'<option value="'+esc(t.planId)+'"'+(String(t.planId)===supplement.targetPlanId?' selected':'')+'>'+esc(t.label||((t.sizes||[]).join(', ')+' · '+t.tanggal+' · '+qty(t.pcs)+' pcs'))+'</option>').join('')+'</select><div class="cutting-supplement-summary">'+(target?'<strong>Hasil tetap '+qty(target.pcs)+' pcs</strong><span>'+qty(target.rollCount)+' baris rol sudah tercatat · '+selected.length+' rol tambahan dipilih</span>':'Pilih hasil yang sudah tersimpan, bukan membuat hasil baru.')+'</div><fieldset class="cutting-supplement-rolls"'+(locked?' disabled':'')+'><legend>Centang hanya rol yang benar-benar sudah dipakai</legend>'+rows(source.rolls).map(r=>'<label class="cutting-supplement-roll"><input type="checkbox" data-supplement-roll="'+esc(r.purchaseId)+'"'+(supplement.purchaseIds.includes(String(r.purchaseId))?' checked':'')+'><span><strong>'+esc(r.jenis)+'</strong><small>Rol '+esc(r.rolNum||r.purchaseId)+' · '+qty(r.kg)+' '+esc(CuttingPlan.unitLabel(r.unit||'kg'))+'</small></span></label>').join('')+'</fieldset><p class="mini">Rol yang tidak dicentang tetap berada di jatah semula. Berat sama belum tentu rol yang sama. Periksa nomor rol sebelum menyimpan.</p>'+notice+'<button type="button" id="cuttingSupplementSave" class="green"'+(busy||readyError()||!target||!selected.length?' disabled':'')+'>'+(supplementAttempt?'Periksa / coba pengiriman yang sama':'Tambahkan bahan · pcs tetap')+'</button></section>';
  }
  function readForm(){
    const group=el('cuttingAdminGroup').value;
    el('cuttingAdminSelection').querySelectorAll('[data-roll-kg]').forEach(input=>{
      const row=form.rolls.find(r=>r.purchaseId===input.dataset.rollKg);if(row)row.kg=input.value;
    });
    form={...form,group,productIds:(groups().get(group)||[]).map(p=>String(p.id)),note:el('cuttingAdminNote').value};
    return form;
  }
  function total(){
    el('cuttingAdminTotal').textContent=form.rolls.length?form.rolls.length+' rol dipilih · Total '+CuttingPlan.formatQuantities(form.rolls):'Belum ada bahan dipilih';
    el('cuttingAdminSelection').querySelectorAll('[data-selected-kg]').forEach(label=>{const row=form.rolls.find(r=>r.purchaseId===label.dataset.selectedKg);if(row)label.textContent=row.kg===''?'Isi jumlah':qty(row.kg)+' '+CuttingPlan.unitLabel(row.unit||'kg');});
  }
  function renderSelection(available){
    el('cuttingAdminSelection').innerHTML=form.rolls.map(row=>{
      const roll=available.rolls.find(r=>String(r.purchaseId)===row.purchaseId);
      const fieldId='cuttingKg-'+encodeURIComponent(row.purchaseId),partial=row.mode==='partial';
      const unavailable=!roll||roll.invalid||Number(roll.available)<=0||roll.unit!==(row.unit||'kg');
      return '<article class="cutting-selected"><div class="cutting-selected-head"><span><b>'+esc(roll?roll.jenis:'Rol tidak tersedia')+'</b><br>Rol '+esc(roll?roll.rolNum:row.purchaseId)+(roll&&roll.tanggal?' · '+esc(roll.tanggal):'')+'</span><strong data-selected-kg="'+esc(row.purchaseId)+'">'+esc(row.kg===''?'Isi jumlah':qty(row.kg)+' '+CuttingPlan.unitLabel(row.unit||'kg'))+'</strong></div><div class="cutting-selected-actions"><button type="button" class="sec small" data-partial-roll="'+esc(row.purchaseId)+'">'+(partial?'Pakai sebagian':'Pakai sebagian / bagi rol')+'</button><button type="button" class="sec small" data-remove-roll="'+esc(row.purchaseId)+'">Lepas</button></div>'+
        (unavailable?'<p class="mini">Rol ini sudah tidak tersedia. Lepas pilihan ini, lalu pilih sisa rol lain. Isian belum disimpan.</p>':'')+
        (partial?'<div class="cutting-partial"><label for="'+esc(fieldId)+'">Jumlah untuk PO ini ('+esc(CuttingPlan.unitLabel(row.unit||'kg'))+')</label><input id="'+esc(fieldId)+'" data-roll-kg="'+esc(row.purchaseId)+'" type="number" min="0" max="'+esc(roll?Math.max(0,roll.available):0)+'" step="any" inputmode="decimal" value="'+esc(row.kg)+'" placeholder="Contoh: 10"><p class="mini">Sisa rol tetap tersedia untuk PO lain.</p></div>':'')+'</article>';
    }).join('');total();
  }
  function photo(items){
    const first=items[0],key=String(first.series+'|'+first.namaBarang).replace(/[.#$\/\[\]]/g,'_');
    const images=CUTTING_ROOT&&CUTTING_ROOT.images||{};
    const value=images[key]||images[first.series+'|'+first.namaBarang]||items.map(p=>p._offlineGambar).find(Boolean)||'';
    return typeof value==='string'&&/^(https?:\/\/|data:image\/)/i.test(value)?value:'';
  }
  function photoHTML(items){const src=photo(items);return src?'<img src="'+esc(src)+'" alt="'+esc(items[0].namaBarang)+'" loading="lazy">':'<span class="cutting-po-placeholder">Belum ada foto</span>';}
  function assignedPlans(items){
    const ids=new Set(items.map(p=>String(p.id)));
    return CuttingPlan.plans(CUTTING_ROOT).filter(p=>['ready','in_progress'].includes(p.status)&&rows(p.products).some(ref=>ids.has(String(ref.id)))&&CuttingPlan.matchesPlan({products:items},p));
  }
  function planMaterialDisplay(plan,showRoll){
    if(plan.materialMode!=='per-result-v1')return '<p>'+rows(plan.rolls).map(r=>esc(r.jenis)+(showRoll?' · Rol '+esc(r.rolNum||r.purchaseId):'')+' · '+(showRoll?'<b>':'')+(r.quantityPolicy==='actual-stock-v1'?'Sesuai pemakaian · batas stok tersedia':qty(r.kg)+' '+esc(CuttingPlan.unitLabel(r.unit||'kg')))+(showRoll?'</b>':'')).join('<br>')+'</p>';
    const consumed=new Map(rows(plan.consumedRolls).map(r=>[String(r.purchaseId),Number(r.kg)||0]));
    return rows(plan.rolls).map(r=>{
      const used=consumed.get(String(r.purchaseId))||0,left=Math.max(0,Number(r.kg)-used),unit=esc(CuttingPlan.unitLabel(r.unit||'kg'));
      if(r.quantityPolicy==='actual-stock-v1')return '<p><b>'+esc(r.jenis)+' · Rol '+esc(r.rolNum||r.purchaseId)+'</b><br>Sesuai pemakaian · terpakai tercatat: <b>'+qty(used)+' '+unit+'</b> · hasil berikutnya mengikuti stok yang tersedia.</p>';
      return '<p><b>'+esc(r.jenis)+' · Rol '+esc(r.rolNum||r.purchaseId)+'</b><br>Jatah awal: '+qty(r.kg)+' '+unit+' · Terpakai tercatat: <b>'+qty(used)+' '+unit+'</b> · Sisa jatah belum dipakai: '+qty(left)+' '+unit+'</p>';
    }).join('')+'<p class="mini">Pemakaian dicatat per hasil potong. Sisa di atas adalah selisih jatah, bukan hasil cek fisik stok.</p>';
  }
  function renderPOPicker(all){
    const selected=all.get(form.group),terms=el('cuttingAdminSearch').value.trim().toLocaleLowerCase('id-ID').split(/\s+/).filter(Boolean);
    const matches=Array.from(all).filter(([,items])=>terms.every(term=>(items[0].namaBarang+' '+items[0].series+' '+items.map(p=>p.size||'').join(' ')).toLocaleLowerCase('id-ID').includes(term)));
    el('cuttingAdminPickerTitle').textContent=selected?'Ganti PO · '+selected[0].namaBarang:'1. Pilih foto barang';
    if(!selected)el('cuttingAdminPicker').open=true;
    el('cuttingAdminCount').textContent=matches.length+' barang · '+matches.reduce((sum,[,items])=>sum+items.length,0)+' ukuran belum dipotong';
    el('cuttingAdminCards').innerHTML=matches.map(([key,items])=>'<button type="button" class="cutting-po-card'+(key===form.group?' is-selected':'')+'" data-admin-po="'+esc(key)+'" aria-pressed="'+(key===form.group)+'">'+photoHTML(items)+'<span><strong>'+esc(items[0].namaBarang)+'</strong><small>'+esc(items[0].series)+'</small><small>Ukuran '+items.map(p=>esc(p.size||'Tanpa size')).join(' · ')+'</small><b class="cutting-po-status">'+(assignedPlans(items).length?'Bahan sudah disiapkan':'Pilih bahan')+'</b></span></button>').join('')||'<p class="empty">'+(all.size?'Barang tidak ditemukan. Coba nama atau ukuran lain.':'Tidak ada PO aktif yang belum dipotong.')+'</p>';
    el('cuttingAdminWork').hidden=!selected;
    el('cuttingAdminSizes').innerHTML=selected?'<div class="cutting-selected-po">'+photoHTML(selected)+'<div><h3>'+esc(selected[0].namaBarang)+'</h3><p>'+esc(selected[0].series)+'</p><b>Ukuran '+selected.map(p=>esc(p.size||'Tanpa size')).join(' · ')+'</b></div></div>':'';
    const existing=selected?assignedPlans(selected):[];
    el('cuttingAdminExisting').innerHTML=existing.length?'<details><summary>Bahan yang sudah disimpan untuk PO ini</summary>'+existing.map(plan=>planMaterialDisplay(plan,false)).join('')+'<p class="mini">Tambahkan hanya jika memang ada bahan tambahan.</p></details>':'';
  }
  function materialKey(roll){return ProductionMaterials.norm(roll.jenis);}
  function captureOpenMaterials(){
    el('cuttingAdminRolls').querySelectorAll('[data-material]').forEach(details=>{if(details.open)openMaterials.add(details.dataset.material);else openMaterials.delete(details.dataset.material);});
  }
  function renderRolls(available){
    const byMaterial=new Map();
    available.rolls.filter(r=>CuttingPlan.validUnit(r.unit)&&!r.invalid&&!available.materials[materialKey(r)].invalid&&Number(r.available)>0).forEach(roll=>{
      const key=materialKey(roll);if(!byMaterial.has(key))byMaterial.set(key,[]);byMaterial.get(key).push(roll);
    });
    const search=el('cuttingAdminMaterialSearch').value.trim().toLocaleLowerCase('id-ID');
    el('cuttingAdminRolls').innerHTML=Array.from(byMaterial).filter(([key])=>key.includes(search)).map(([key,rolls],index)=>{
      const selectedId=rollChoices.get(key)||'',fieldId='cuttingRollChoice'+index;
      const roll=rolls.find(r=>String(r.purchaseId)===selectedId&&!form.rolls.some(row=>row.purchaseId===selectedId)),material=available.materials[key];
      const fullAllowed=roll&&Number(roll.available)>0&&material&&!material.invalid&&Number(roll.available)<=Number(material.available);
      return '<details class="cutting-material-choice" data-material="'+esc(key)+'"'+(openMaterials.has(key)?' open':'')+'><summary><strong>'+esc(rolls[0].jenis)+'</strong></summary><div class="cutting-material-body"><label for="'+fieldId+'">Pilih rol yang dipakai</label><select id="'+fieldId+'" data-roll-choice="'+esc(key)+'"><option value="">Pilih rol…</option>'+rolls.map(r=>'<option value="'+esc(r.purchaseId)+'"'+(String(r.purchaseId)===selectedId?' selected':'')+(form.rolls.some(row=>row.purchaseId===String(r.purchaseId))?' disabled':'')+'>Rol '+esc(r.rolNum)+' · '+qty(r.available)+' '+esc(CuttingPlan.unitLabel(r.unit))+(r.tanggal?' · '+esc(r.tanggal):'')+(form.rolls.some(row=>row.purchaseId===String(r.purchaseId))?' · sudah dipilih':'')+'</option>').join('')+'</select>'+
        (roll?'<div class="cutting-roll-actions"><button type="button" class="green" data-pick-roll="'+esc(selectedId)+'"'+(!fullAllowed?' disabled':'')+'>Pakai '+qty(roll.available)+' '+esc(CuttingPlan.unitLabel(roll.unit))+'</button><button type="button" class="sec" data-partial-roll="'+esc(selectedId)+'">Pakai sebagian</button></div>'+(!fullAllowed?'<p class="mini">Saldo tidak cukup untuk seluruh rol. Pilih sebagian atau periksa stok.</p>':''):'')+'</div></details>';
    }).join('')||'<p class="mini">'+(search?'Tidak ada sisa rol yang dapat dipilih untuk bahan ini.':'Belum ada rol bahan yang tersedia. Periksa pembelian dan saldo bahan.')+'</p>';
    el('cuttingAdminRolls').innerHTML+='<p class="mini">Hanya sisa rol yang tersedia. Rol habis, rincian yang sudah dilepas, dan jatah penuh untuk PO lain tidak ditampilkan. Riwayat tetap tersimpan.</p>';
    renderSelection(available);
  }
  function clearForm(){
    drafts.delete(form.group);form={group:'',productIds:[],rolls:[],note:''};el('cuttingAdminGroup').value='';el('cuttingAdminNote').value='';openMaterials.clear();rollChoices.clear();el('cuttingAdminSearch').value='';el('cuttingAdminMaterialSearch').value='';el('cuttingAdminMaterialPicker').open=false;
  }
  function renderForm(available){
    const all=groups(),selected=all.get(form.group)||[];
    el('cuttingAdminGroup').innerHTML='<option value="">Pilih PO aktif yang belum dipotong…</option>'+Array.from(all,([key,items])=>'<option value="'+esc(key)+'"'+(key===form.group?' selected':'')+'>'+esc(items[0].series+' · '+items[0].namaBarang)+'</option>').join('');
    el('cuttingAdminGroup').value=all.has(form.group)?form.group:'';
    renderPOPicker(all);
    renderRolls(available);el('cuttingAdminNote').value=form.note;
  }
  function renderHistory(){
    const products=new Map(CuttingPlan.products(CUTTING_ROOT).map(p=>[String(p.id),p]));
    const plans=CuttingPlan.plans(CUTTING_ROOT).slice().sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    el('cuttingAdminHistory').innerHTML=renderSupplement()+(plans.length?plans.map(plan=>{
      const sizes=rows(plan.products).map(ref=>{const p=products.get(String(ref.id));return p?p.size||'Tanpa size':ref.id;});
      const selectedMode=plan.materialMode==='per-result-v1';
      const status=plan.status==='used'?(selectedMode?'Semua ukuran sudah dicatat':'Sudah dipakai'):plan.status==='merged'?'Ditambahkan ke hasil potong':plan.status==='in_progress'?(selectedMode?'Potong bertahap · bahan per hasil':'Potong bertahap · bahan sudah dicatat'):plan.status==='cancelled'?'Dibatalkan':'Siap dipotong';
      const disabled=busy||!!attempt||!!supplement||!!supplementAttempt||!!readyError(),transfers=rows(plan.materialTransfers);
      const audit=transfers.length?'<details class="cutting-transfer-history"><summary>Riwayat bahan yang ditambahkan ke hasil potong</summary>'+transfers.map(t=>'<p>'+esc(String(t.createdAt||'').slice(0,10))+' · '+rows(t.rolls).map(r=>esc(r.jenis)+' · Rol '+esc(r.rolNum||r.purchaseId)+' · '+qty(r.kg)+' '+esc(CuttingPlan.unitLabel(r.unit||'kg'))).join('<br>')+'</p>').join('')+'</details>':'';
      return '<article class="cutting-history-item"><div class="cutting-history-heading"><strong>'+esc(plan.series||'')+' · '+esc(plan.namaBarang||'Jatah potong')+'</strong><span class="status-badge '+(plan.status==='ready'?'ok':'info')+'">'+status+'</span></div><p>Size '+esc(sizes.join(', '))+' · '+esc(plan.createdAt?String(plan.createdAt).slice(0,10):'')+'</p>'+planMaterialDisplay(plan,true)+(selectedMode&&plan.status==='used'?'<p class="mini">Semua ukuran selesai dicatat; bukan berarti seluruh jatah bahan habis.</p>':'')+audit+(plan.note?'<p class="cutting-note">'+esc(plan.note)+'</p>':'')+(plan.status==='ready'?'<div class="cutting-history-actions">'+(supplementTargets(CUTTING_ROOT,plan.id).length?'<button type="button" class="green small" data-supplement-plan="'+esc(plan.id)+'"'+(disabled?' disabled':'')+'>Tambahkan ke hasil potong</button>':'')+'<button type="button" class="sec small" data-cancel-plan="'+esc(plan.id)+'"'+(disabled?' disabled':'')+'>Batalkan jatah belum dipakai</button></div>':'')+'</article>';
    }).join(''):'<p class="empty">Belum ada jatah potong. Riwayat akan muncul setelah jatah pertama diterbitkan.</p>');
  }
  window.updateCuttingPlanReady=function(){
    if(!el('cuttingAdminForm'))return;
    const error=readyError()||availabilityError;
    el('cuttingAdminReady').textContent=busy?'Memeriksa dan menyimpan jatah ke pusat…':error;
    el('cuttingAdminForm').disabled=busy||!!error||!!supplement||!!supplementAttempt;
    el('cuttingAdminIssue').disabled=busy||!!error||!!supplement||!!supplementAttempt||!groups().has(form.group)||!form.rolls.length;
    el('cuttingAdminHistory').querySelectorAll('[data-cancel-plan],[data-supplement-plan]').forEach(button=>{button.disabled=busy||!!error||!!attempt||!!supplement||!!supplementAttempt;});
    const save=el('cuttingSupplementSave');if(save&&supplement)save.disabled=busy||!!readyError()||!supplement.targetPlanId||!supplement.purchaseIds.length;
  };
  window.renderCuttingPlans=function(){
    if(!el('cuttingAdminForm')||!window.CuttingPlan)return;
    // Preserve a form already being filled when a stock or production update arrives.
    readForm();captureOpenMaterials();
    let available={rolls:[],materials:{}};availabilityError='';
    try{available=CuttingPlan.availability(CUTTING_ROOT,STOK);}
    catch(error){availabilityError=error.message;}
    renderForm(available);renderHistory();
    el('cuttingAdminBalances').innerHTML=Object.values(available.materials).map(m=>'<div class="cutting-balance"><b>'+esc(m.name)+'</b><p>Saldo '+qty(m.stock)+' '+esc(m.unit)+' · Dipesan '+qty(m.reserved)+' '+esc(m.unit)+' · Dapat dijatahkan '+qty(m.available)+' '+esc(m.unit)+'</p></div>').join('')||'<p class="mini">Catat pembelian rol terlebih dahulu. Jumlah mengikuti satuan bahan: kg, yd, atau m.</p>';
    window.updateCuttingPlanReady();
  };
  function adoptRoot(root,revision){
    if(CUTTING_ROOT_REVISION!==revision)return;
    CUTTING_ROOT=clone(root);CUTTING_ROOT_REVISION++;DB_PRODUKSI=CuttingPlan.products(root);lastSyncedProduksi=JSON.stringify(DB_PRODUKSI);renderAll();
  }
  function samePlan(a,b){return AppSyncJournal.equal({id:a.id,products:a.products,rolls:a.rolls,note:a.note||'',createdAt:a.createdAt},{id:b.id,products:b.products,rolls:b.rolls,note:b.note||'',createdAt:b.createdAt});}
  window.openCuttingSupplement=function(sourceId){
    if(busy)return;
    try{
      requireReady();if(attempt||supplementAttempt)throw new Error('Pastikan pengiriman sebelumnya dahulu. Jangan membuat pengiriman baru.');
      const source=CuttingPlan.plans(CUTTING_ROOT).find(p=>String(p.id)===String(sourceId));
      if(!source||source.status!=='ready'||!supplementTargets(CUTTING_ROOT,source.id).length)throw new Error('Belum ada hasil potong yang cocok dengan jatah ini. Periksa barang, ukuran, dan siklus PO.');
      readForm();supplement={sourceId:String(source.id),targetPlanId:'',purchaseIds:[],root:clone(CUTTING_ROOT),stock:clone(STOK),target:FB.dbUrl};
      supplementMessage('Pilih hasil potong, lalu centang rol yang benar-benar sudah dipakai. Tidak ada rol yang dipilih otomatis.');renderHistory();window.updateCuttingPlanReady();
      const panel=el('cuttingSupplementTitle');if(panel&&typeof panel.scrollIntoView==='function')panel.scrollIntoView({block:'center',behavior:'smooth'});
    }catch(error){message(error.message,true);}
  };
  window.saveCuttingSupplement=async function(){
    if(busy||!supplement)return;
    const retryingUncertain=!!supplementAttempt;
    try{
      requireReady(supplement.target);if(attempt)throw new Error('Pastikan pengiriman jatah sebelumnya dahulu.');
      if(!supplement.targetPlanId||!supplement.purchaseIds.length)throw new Error('Pilih hasil potong dan centang minimal satu rol yang benar-benar dipakai.');
      busy=true;window.updateCuttingPlanReady();renderHistory();supplementMessage('Memeriksa hasil potong dan bahan terbaru di pusat…');
      await stokJournal.ready();requireReady(supplement.target);
      const target=supplement.target,database=FB.db,generation=stokConnectionGeneration,revision=CUTTING_ROOT_REVISION;
      const check=()=>{requireReady(target);if(database!==FB.db||generation!==stokConnectionGeneration)throw new Error('Koneksi berubah. Periksa pengiriman pada koneksi semula.');};
      const command=supplementAttempt?supplementAttempt.command:CuttingPlan.prepareSupplement(supplement.root,supplement.stock,{id:'cutting-addition-'+uid(),sourcePlanId:supplement.sourceId,targetPlanId:supplement.targetPlanId,purchaseIds:supplement.purchaseIds.slice(),createdAt:new Date().toISOString()});
      const central=(await FB.get(FB.ref(database,'soldier'))).val();check();
      if(!central||!central.produksi||!central.stokBahan)throw new Error('Data hasil potong dan stok pusat belum tersedia.');
      if(CuttingPlan.supplementReceipt(central.produksi,command)){
        supplementAttempt=null;supplement=null;adoptRoot(central.produksi,revision);supplementMessage('Tambahan bahan sebelumnya sudah dikonfirmasi pusat. Hasil tetap '+qty(command.pcs)+' pcs; upah tidak ditambah.');renderCuttingPlans();return;
      }
      // Validate the frozen, displayed selection against current central data before asking to save.
      CuttingPlan.supplement(central.produksi,central.stokBahan,command);
      if(!supplementAttempt&&!confirm('Tambahkan '+rows(command.rolls).length+' rol berikut ke hasil '+qty(command.pcs)+' pcs?\n\n'+rows(command.rolls).map(r=>r.jenis+' · Rol '+(r.rolNum||r.purchaseId)+' · '+qty(r.kg)+' '+CuttingPlan.unitLabel(r.unit||'kg')).join('\n')+'\n\nJumlah pcs, tanggal hasil, dan upah tetap. Stok dan HPP mengikuti tambahan bahan. Rol yang tidak dipilih tetap berada di jatah semula.')){supplementMessage('Belum disimpan. Periksa pilihan rol terlebih dahulu.');return;}
      supplementAttempt={command:clone(command),target};renderHistory();const beforeCommitRevision=CUTTING_ROOT_REVISION;
      const result=await CuttingTransaction.run({ref:FB.ref(database,'soldier'),onValue:FB.onValue,runTransaction:FB.runTransaction,check,
        validate:current=>{if(!current||!current.produksi||!current.stokBahan)throw new Error('Data hasil potong dan stok pusat belum tersedia.');},
        update:current=>{if(CuttingPlan.supplementReceipt(current.produksi,command))return current;return Object.assign({},current,{produksi:CuttingPlan.supplement(current.produksi,current.stokBahan,command)});},
        receipt:current=>!!current&&CuttingPlan.supplementReceipt(current.produksi,command)
      });
      supplementAttempt=null;supplement=null;adoptRoot((result.snapshot.val()||{}).produksi,beforeCommitRevision);supplementMessage('Tambahan '+rows(command.rolls).length+' rol sudah dikonfirmasi pusat. Hasil tetap '+qty(command.pcs)+' pcs; upah tidak ditambah.');renderCuttingPlans();
    }catch(error){
      if(error.notCommitted&&!retryingUncertain)supplementAttempt=null;
      supplementMessage(error.message+(supplementAttempt?' Jangan ganti pilihan atau input ulang hasil. Klik Periksa / coba pengiriman yang sama.':' Tidak ada tambahan yang dipastikan tersimpan. Jika data berubah, tutup panel lalu pilih ulang.'),true);
    }finally{busy=false;renderHistory();window.updateCuttingPlanReady();}
  };
  window.issueCuttingPlan=async function(){
    if(busy)return;
    const draft=clone(readForm()),retryingUncertain=!!attempt;
    try{
      requireReady();
      if(supplement||supplementAttempt)throw new Error('Selesaikan atau tutup panel tambahan bahan sebelum membuat jatah baru.');
      if(!draft.productIds.length)throw new Error('Pilih PO aktif yang belum dipotong dari Laporan Produksi.');
      if(!draft.rolls.length||draft.rolls.some(r=>!r.purchaseId||r.kg===''||!Number.isFinite(Number(r.kg))||Number(r.kg)<=0))throw new Error('Pilih rol yang dipakai. Jika membagi rol, isi jumlah bahan untuk PO ini lebih dari nol.');
      if(attempt&&!AppSyncJournal.equal(attempt.form,draft))throw new Error('Pengiriman sebelumnya belum dipastikan. Gunakan pilihan sebelumnya dan coba lagi untuk memeriksa jatah yang sama.');
      if(attempt&&attempt.target!==FB.dbUrl)throw new Error('Tujuan koneksi berubah. Periksa pengiriman sebelumnya pada database asal sebelum melanjutkan.');
      busy=true;window.updateCuttingPlanReady();message('Mengambil PO dan stok terbaru…');
      await stokJournal.ready();requireReady();
      const target=FB.dbUrl,database=FB.db,generation=stokConnectionGeneration,revision=CUTTING_ROOT_REVISION;
      const check=()=>{requireReady(target);if(database!==FB.db||generation!==stokConnectionGeneration)throw new Error('Koneksi berubah. Jatah belum dapat diterbitkan.');};
      const central=(await FB.get(FB.ref(database,'soldier'))).val();check();
      if(!central||!central.stokBahan)throw new Error('Data PO dan stok pusat belum tersedia.');
      const root=central.produksi,stock=central.stokBahan;
      if(attempt){
        const previous=CuttingPlan.plans(root).find(p=>p.id===attempt.plan.id);
        if(previous){if(!samePlan(previous,attempt.plan))throw new Error('Identitas jatah sudah digunakan dengan rincian berbeda. Periksa riwayat.');clearForm();adoptRoot(root,revision);renderCuttingPlans();attempt=null;message('Jatah sebelumnya sudah dikonfirmasi pusat.');return;}
      }
      requireUncut(root,draft);
      const plan=attempt?attempt.plan:CuttingPlan.makePlan({id:'cutting-'+uid(),productIds:draft.productIds,rolls:draft.rolls.map(r=>({purchaseId:r.purchaseId,kg:Number(r.kg),unit:r.unit||'kg'})),note:draft.note.trim(),createdAt:new Date().toISOString()},root,stock);
      if(!attempt&&!confirm('Simpan bahan untuk PO '+(plan.namaBarang||'potong')+'?\n\n'+plan.rolls.map(r=>r.jenis+' · Rol '+(r.rolNum||r.purchaseId)+' · '+qty(r.kg)+' '+esc(CuttingPlan.unitLabel(r.unit||'kg'))+'').join('\n')+'\n\nPO tetap mengikuti Laporan Produksi. Tukang memilih rol dari jatah ini dan jumlah yang benar-benar dipakai, lalu mengisi hasil pcs. Sisa bahan dapat dipakai untuk ukuran berikutnya.')){message('Bahan belum disimpan.');return;}
      attempt={form:draft,plan:clone(plan),target};const beforeCommitRevision=CUTTING_ROOT_REVISION;
      const result=await CuttingTransaction.run({ref:FB.ref(database,'soldier'),onValue:FB.onValue,runTransaction:FB.runTransaction,check,
        validate:current=>{if(!current||!current.stokBahan||typeof current.stokBahan!=='object'||!current.produksi)throw new Error('Data PO dan stok pusat belum tersedia. Pilihan bahan tetap tersimpan.');},
        update:current=>{
          const existing=CuttingPlan.plans(current.produksi).find(p=>p.id===plan.id);
          if(existing){if(!samePlan(existing,plan))throw new Error('Identitas jatah berubah.');return current;}
          requireUncut(current.produksi,draft);return Object.assign({},current,{produksi:CuttingPlan.issue(current.produksi,current.stokBahan,plan)});
        },
        receipt:current=>{const saved=current&&CuttingPlan.plans(current.produksi).find(p=>p.id===plan.id);return !!saved&&samePlan(saved,plan);}
      });
      attempt=null;clearForm();adoptRoot((result.snapshot.val()||{}).produksi,beforeCommitRevision);renderCuttingPlans();message('Bahan dan jumlahnya tersimpan. Tukang memilih rol serta jumlah yang dipakai dari jatah ini, lalu mengisi hasil potong.');
    }catch(error){if(error.notCommitted&&!retryingUncertain)attempt=null;message(error.message+(attempt?' Pengiriman belum dipastikan; coba lagi dengan pilihan yang sama.':''),true);}
    finally{busy=false;window.updateCuttingPlanReady();renderHistory();}
  };
  window.cancelCuttingPlan=async function(id){
    if(busy)return;
    try{
      requireReady();if(attempt||supplement||supplementAttempt)throw new Error('Selesaikan pengiriman atau panel tambahan bahan sebelumnya dahulu.');
      const plan=CuttingPlan.plans(CUTTING_ROOT).find(p=>p.id===id);
      if(!plan||plan.status!=='ready')throw new Error('Hanya jatah yang belum dipakai yang dapat dibatalkan.');
      if(!confirm('Batalkan jatah '+(plan.namaBarang||'potong')+' yang belum dipakai? Riwayat jatah tetap disimpan.'))return;
      busy=true;window.updateCuttingPlanReady();await stokJournal.ready();requireReady();
      const target=FB.dbUrl,database=FB.db,generation=stokConnectionGeneration,revision=CUTTING_ROOT_REVISION;
      const result=await CuttingTransaction.run({ref:FB.ref(database,'soldier/produksi'),onValue:FB.onValue,runTransaction:FB.runTransaction,
        check:()=>{requireReady(target);if(database!==FB.db||generation!==stokConnectionGeneration)throw new Error('Koneksi berubah.');},
        validate:current=>{if(!current||typeof current!=='object')throw new Error('Data produksi pusat belum tersedia. Pembatalan belum dilakukan.');},
        update:current=>CuttingPlan.cancel(current,id),
        receipt:current=>{const saved=CuttingPlan.plans(current).find(p=>p.id===id);return !!saved&&saved.status==='cancelled'&&samePlan(saved,plan);}
      });
      adoptRoot(result.snapshot.val(),revision);message('Jatah dibatalkan; riwayat tetap tersimpan.');
    }catch(error){message(error.message,true);}
    finally{busy=false;window.updateCuttingPlanReady();renderHistory();}
  };
  function choosePO(group){
    if(busy||supplement||supplementAttempt||readyError())return;
    if(attempt){message('Pastikan pengiriman sebelumnya dahulu sebelum mengganti PO.',true);return;}
    const current=form.group;
    // Read the old selection before replacing the hidden compatibility control.
    el('cuttingAdminGroup').value=current;readForm();if(current)drafts.set(current,clone(form));
    form=drafts.has(group)?clone(drafts.get(group)):{group,productIds:[],rolls:[],note:''};form.group=group;
    el('cuttingAdminGroup').value=group;form.productIds=(groups().get(group)||[]).map(p=>String(p.id));
    openMaterials.clear();rollChoices.clear();el('cuttingAdminMaterialSearch').value='';
    renderForm(CuttingPlan.availability(CUTTING_ROOT,STOK));el('cuttingAdminPicker').open=false;el('cuttingAdminMaterialPicker').open=!form.rolls.length;message('');updateCuttingPlanReady();
  }
  el('cuttingAdminGroup').addEventListener('change',()=>choosePO(el('cuttingAdminGroup').value));
  el('cuttingAdminCards').addEventListener('click',event=>{const button=event.target.closest('[data-admin-po]');if(button)choosePO(button.dataset.adminPo);});
  el('cuttingAdminSearch').addEventListener('input',()=>renderPOPicker(groups()));
  el('cuttingAdminMaterialSearch').addEventListener('input',()=>{readForm();captureOpenMaterials();renderRolls(CuttingPlan.availability(CUTTING_ROOT,STOK));});
  el('cuttingAdminRolls').addEventListener('change',event=>{
    const select=event.target.closest('[data-roll-choice]');if(!select)return;
    readForm();captureOpenMaterials();rollChoices.set(select.dataset.rollChoice,select.value);renderRolls(CuttingPlan.availability(CUTTING_ROOT,STOK));
  });
  el('cuttingAdminSelection').addEventListener('input',()=>{readForm();total();});
  function pickRoll(event){
    const button=event.target.closest('[data-pick-roll],[data-partial-roll]');if(!button||busy||supplement||supplementAttempt||attempt||button.disabled||readyError())return;
    try{
      readForm();captureOpenMaterials();const available=CuttingPlan.availability(CUTTING_ROOT,STOK),id=button.dataset.pickRoll||button.dataset.partialRoll;
      const roll=available.rolls.find(r=>String(r.purchaseId)===id);if(!roll||roll.invalid||!CuttingPlan.validUnit(roll.unit)||Number(roll.available)<=0)throw new Error('Rol sudah tidak tersedia. Periksa data terbaru.');
      let row=form.rolls.find(r=>r.purchaseId===id);if(!row){row={purchaseId:id,kg:'',unit:roll.unit,mode:'partial'};form.rolls.push(row);}
      if(row.unit!==roll.unit)throw new Error('Satuan rol berubah. Lepas lalu pilih kembali bahan ini.');if(button.dataset.pickRoll){row.kg=String(roll.available);row.mode='whole';}else row.mode='partial';
      openMaterials.clear();rollChoices.delete(materialKey(roll));renderRolls(available);el('cuttingAdminMaterialPicker').open=false;message('');updateCuttingPlanReady();
      if(row.mode==='partial'){const input=el('cuttingKg-'+encodeURIComponent(id));if(input)input.focus();}
    }catch(error){message(error.message,true);}
  }
  el('cuttingAdminRolls').addEventListener('click',pickRoll);
  el('cuttingAdminSelection').addEventListener('click',pickRoll);
  el('cuttingAdminSelection').addEventListener('click',event=>{
    const button=event.target.closest('[data-remove-roll]');if(!button||busy||supplement||supplementAttempt||attempt)return;readForm();captureOpenMaterials();form.rolls=form.rolls.filter(row=>row.purchaseId!==button.dataset.removeRoll);renderRolls(CuttingPlan.availability(CUTTING_ROOT,STOK));updateCuttingPlanReady();
  });
  el('cuttingAdminHistory').addEventListener('click',event=>{
    if(event.target.id==='cuttingSupplementSave'){window.saveCuttingSupplement();return;}
    const close=event.target.closest('[data-close-supplement]');if(close){if(!busy&&!supplementAttempt){supplement=null;supplementMessage('');renderHistory();window.updateCuttingPlanReady();}return;}
    const add=event.target.closest('[data-supplement-plan]');if(add){if(!add.disabled)window.openCuttingSupplement(add.dataset.supplementPlan);return;}
    const cancel=event.target.closest('[data-cancel-plan]');if(cancel&&!cancel.disabled)window.cancelCuttingPlan(cancel.dataset.cancelPlan);
  });
  el('cuttingAdminHistory').addEventListener('change',event=>{
    if(!supplement||busy||supplementAttempt)return;
    if(event.target.id==='cuttingSupplementTarget')supplement.targetPlanId=String(event.target.value||'');
    else{const box=event.target.closest('[data-supplement-roll]');if(!box)return;const id=String(box.dataset.supplementRoll);supplement.purchaseIds=supplement.purchaseIds.filter(value=>value!==id);if(box.checked)supplement.purchaseIds.push(id);}
    supplementMessage('');renderHistory();window.updateCuttingPlanReady();
  });
  el('cuttingAdminIssue').addEventListener('click',window.issueCuttingPlan);
  window.renderCuttingPlans();
})();
