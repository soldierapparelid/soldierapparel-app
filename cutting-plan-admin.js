/* Owner-issued cutting plans. Stock records remain owned by the stock journal. */
(function(){
  'use strict';
  const el=id=>document.getElementById(id),clone=value=>AppSyncJournal.clone(value);
  let busy=false,availabilityError='',attempt=null;
  let form={group:'',productIds:[],rolls:[],note:''};
  const openMaterials=new Set();
  const qty=value=>Number(value||0).toLocaleString('id-ID',{maximumFractionDigits:6});
  function groups(root=CUTTING_ROOT){
    return new Map((typeof CuttingPlan.uncutPOs==='function'?CuttingPlan.uncutPOs(root):[]).map(group=>[group.id,group.products]));
  }
  function requireUncut(root,draft){
    const products=groups(root).get(draft.group);
    if(!products||draft.productIds.some(id=>!products.some(p=>String(p.id)===id)))throw new Error('Ukuran PO ini sudah dipotong, tidak aktif, atau merupakan PO offline. Pilih ukuran PO aktif yang belum dipotong.');
  }
  function readyError(target){
    if(!window.CuttingPlan||!stokJournal||!stokBootReady)return 'Data jatah dan penyimpanan belum siap.';
    const state=stokJournal.status();
    if(!FB.connected||!firebaseSyncReadyStok||!FB.get||!FB.runTransaction)return 'Sambungkan internet dan tunggu data pusat sebelum menerbitkan jatah.';
    if(target&&target!==FB.dbUrl)return 'Tujuan koneksi berubah. Buka kembali jatah sebelum melanjutkan.';
    if(!state.baseKnown||state.target!==FB.dbUrl||!state.durable||state.saving||state.pending||state.foreignPending||state.detached||state.conflict||state.error||stokWritePromise||stokSyncError||Object.keys(stokReadErrors).length)return 'Selesaikan penyimpanan atau kendala sinkronisasi stok terlebih dahulu.';
    return '';
  }
  function requireReady(target){const error=readyError(target);if(error)throw new Error(error);}
  function message(text,error){el('cuttingAdminMessage').textContent=text;el('cuttingAdminMessage').dataset.error=String(!!error);}
  function readForm(){
    const group=el('cuttingAdminGroup').value;
    el('cuttingAdminRolls').querySelectorAll('[data-roll-kg]').forEach(input=>{
      const row=form.rolls.find(r=>r.purchaseId===input.dataset.rollKg);if(row)row.kg=input.value;
    });
    form={...form,group,productIds:(groups().get(group)||[]).map(p=>String(p.id)),note:el('cuttingAdminNote').value};
    return form;
  }
  function total(){
    el('cuttingAdminTotal').textContent=form.rolls.length?form.rolls.length+' rol dipilih · Total '+qty(form.rolls.reduce((sum,row)=>sum+(Number(row.kg)||0),0))+' kg':'Belum ada bahan dipilih';
  }
  function renderSelection(available){
    el('cuttingAdminSelection').innerHTML=form.rolls.map(row=>{
      const roll=available.rolls.find(r=>String(r.purchaseId)===row.purchaseId);
      return '<div class="cutting-selected"><span><b>'+esc(roll?roll.jenis:'Rol tidak tersedia')+'</b> · Rol '+esc(roll?roll.rolNum:row.purchaseId)+'<br>'+esc(row.kg===''?'Isi kilogram bagian ini':qty(row.kg)+' kg untuk PO ini')+'</span><button type="button" class="sec small" data-remove-roll="'+esc(row.purchaseId)+'">Lepas</button></div>';
    }).join('');total();
  }
  function materialKey(roll){return ProductionMaterials.norm(roll.jenis);}
  function captureOpenMaterials(){
    el('cuttingAdminRolls').querySelectorAll('[data-material]').forEach(details=>{if(details.open)openMaterials.add(details.dataset.material);else openMaterials.delete(details.dataset.material);});
  }
  function renderRolls(available){
    const byMaterial=new Map();
    available.rolls.filter(r=>r.unit==='kg'&&!r.invalid&&(Number(r.available)>0||form.rolls.some(row=>row.purchaseId===String(r.purchaseId)))).forEach(roll=>{
      const key=materialKey(roll);if(!byMaterial.has(key))byMaterial.set(key,[]);byMaterial.get(key).push(roll);
    });
    el('cuttingAdminRolls').innerHTML=Array.from(byMaterial,([key,rolls])=>'<details class="cutting-material-choice" data-material="'+esc(key)+'"'+(openMaterials.has(key)?' open':'')+'><summary><strong>'+esc(rolls[0].jenis)+'</strong><span>Ketuk untuk pilih rol</span></summary><div class="cutting-material-body">'+rolls.map((roll,index)=>{
      const id=String(roll.purchaseId),selected=form.rolls.find(r=>r.purchaseId===id),partial=selected&&selected.mode==='partial',fieldId='cuttingKg-'+encodeURIComponent(id),free=Number(roll.available);
      const material=available.materials[key],fullAllowed=free>0&&material&&!material.invalid&&free<=Number(material.available);
      return '<article class="cutting-roll-choice'+(selected?' is-selected':'')+'"><div class="cutting-roll-title"><b>Rol '+esc(roll.rolNum)+'</b><span>'+qty(free)+' kg tersedia'+(roll.tanggal?' · '+esc(roll.tanggal):'')+'</span></div>'+
        (selected?'<p class="cutting-picked">Dipilih untuk PO ini: '+esc(selected.kg===''?'belum diisi':qty(selected.kg)+' kg')+'</p>':'')+
        '<div class="cutting-roll-actions"><button type="button" class="'+(selected&&!partial?'sec':'green')+'" data-pick-roll="'+esc(id)+'"'+(!fullAllowed?' disabled':'')+'>'+(selected&&!partial?'✓ Dipilih':'Pakai '+qty(free)+' kg')+'</button><button type="button" class="sec" data-partial-roll="'+esc(id)+'">Bagi rol / isi kg</button></div>'+
        (!fullAllowed&&free>0?'<p class="mini">Saldo bahan tidak cukup untuk seluruh rol. Periksa saldo atau pilih sebagian.</p>':'')+
        (partial?'<div class="cutting-partial"><label for="'+esc(fieldId)+'">Kilogram untuk PO ini</label><input id="'+esc(fieldId)+'" data-roll-kg="'+esc(id)+'" type="number" min="0" max="'+esc(free)+'" step="any" inputmode="decimal" value="'+esc(selected.kg)+'" placeholder="Contoh: 10"><p class="mini">Sisanya tetap tersedia untuk PO lain. Bisa pilih beberapa rol untuk satu PO.</p></div>':'')+'</article>';
    }).join('')+'</div></details>').join('')||'<p class="mini">Belum ada rol kilogram yang tersedia. Periksa pembelian dan saldo bahan.</p>';
    renderSelection(available);
  }
  function clearForm(){
    form={group:'',productIds:[],rolls:[],note:''};el('cuttingAdminGroup').value='';el('cuttingAdminNote').value='';openMaterials.clear();
  }
  function renderForm(available){
    const all=groups(),selected=all.get(form.group)||[];
    el('cuttingAdminGroup').innerHTML='<option value="">Pilih PO aktif yang belum dipotong…</option>'+Array.from(all,([key,items])=>'<option value="'+esc(key)+'"'+(key===form.group?' selected':'')+'>'+esc(items[0].series+' · '+items[0].namaBarang)+'</option>').join('');
    el('cuttingAdminGroup').value=all.has(form.group)?form.group:'';
    el('cuttingAdminSizes').innerHTML=selected.length?'<p class="mini">Ukuran belum dipotong: <b>'+selected.map(p=>esc(p.size||'Tanpa size')).join(', ')+'</b> · dari Laporan Produksi</p>':'<p class="mini">Hanya ukuran PO aktif yang belum dipotong. Ukuran lain yang sudah dipotong dan PO offline tidak ditampilkan.</p>';
    renderRolls(available);el('cuttingAdminNote').value=form.note;
  }
  function renderHistory(){
    const products=new Map(CuttingPlan.products(CUTTING_ROOT).map(p=>[String(p.id),p]));
    const plans=CuttingPlan.plans(CUTTING_ROOT).slice().sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    el('cuttingAdminHistory').innerHTML=plans.length?plans.map(plan=>{
      const sizes=(plan.products||[]).map(ref=>{const p=products.get(String(ref.id));return p?p.size||'Tanpa size':ref.id;});
      const status=plan.status==='used'?'Sudah dipakai':plan.status==='in_progress'?'Potong bertahap · bahan sudah dicatat':plan.status==='cancelled'?'Dibatalkan':'Siap dipotong';
      return '<article class="cutting-history-item"><div class="cutting-history-heading"><strong>'+esc(plan.series||'')+' · '+esc(plan.namaBarang||'Jatah potong')+'</strong><span class="status-badge '+(plan.status==='ready'?'ok':'info')+'">'+status+'</span></div><p>Size '+esc(sizes.join(', '))+' · '+esc(plan.createdAt?String(plan.createdAt).slice(0,10):'')+'</p><p>'+(plan.rolls||[]).map(r=>esc(r.jenis)+' · Rol '+esc(r.rolNum||r.purchaseId)+' · <b>'+qty(r.kg)+' kg</b>').join('<br>')+'</p>'+(plan.note?'<p class="cutting-note">'+esc(plan.note)+'</p>':'')+(plan.status==='ready'?'<button type="button" class="sec small" data-cancel-plan="'+esc(plan.id)+'"'+(busy||readyError()?' disabled':'')+'>Batalkan jatah belum dipakai</button>':'')+'</article>';
    }).join(''):'<p class="empty">Belum ada jatah potong. Riwayat akan muncul setelah jatah pertama diterbitkan.</p>';
  }
  window.updateCuttingPlanReady=function(){
    if(!el('cuttingAdminForm'))return;
    const error=readyError()||availabilityError;
    el('cuttingAdminReady').textContent=busy?'Memeriksa dan menyimpan jatah ke pusat…':error;
    el('cuttingAdminForm').disabled=busy||!!error;
    el('cuttingAdminHistory').querySelectorAll('[data-cancel-plan]').forEach(button=>{button.disabled=busy||!!error;});
  };
  window.renderCuttingPlans=function(){
    if(!el('cuttingAdminForm')||!window.CuttingPlan)return;
    // Preserve a form already being filled when a stock or production update arrives.
    readForm();captureOpenMaterials();
    let available={rolls:[],materials:{}};availabilityError='';
    try{available=CuttingPlan.availability(CUTTING_ROOT,STOK);}
    catch(error){availabilityError=error.message;}
    renderForm(available);renderHistory();
    el('cuttingAdminBalances').innerHTML=Object.values(available.materials).map(m=>'<div class="cutting-balance"><b>'+esc(m.name)+'</b><p>Saldo '+qty(m.stock)+' '+esc(m.unit)+' · Dipesan '+qty(m.reserved)+' '+esc(m.unit)+' · Dapat dijatahkan '+qty(m.available)+' '+esc(m.unit)+'</p></div>').join('')||'<p class="mini">Catat pembelian rol terlebih dahulu. Jatah potong menggunakan satuan kg.</p>';
    window.updateCuttingPlanReady();
  };
  function adoptRoot(root,revision){
    if(CUTTING_ROOT_REVISION!==revision)return;
    CUTTING_ROOT=clone(root);CUTTING_ROOT_REVISION++;DB_PRODUKSI=CuttingPlan.products(root);lastSyncedProduksi=JSON.stringify(DB_PRODUKSI);renderAll();
  }
  function samePlan(a,b){return AppSyncJournal.equal({id:a.id,products:a.products,rolls:a.rolls,note:a.note||'',createdAt:a.createdAt},{id:b.id,products:b.products,rolls:b.rolls,note:b.note||'',createdAt:b.createdAt});}
  window.issueCuttingPlan=async function(){
    if(busy)return;
    const draft=clone(readForm());
    try{
      requireReady();
      if(!draft.productIds.length)throw new Error('Pilih PO aktif yang belum dipotong dari Laporan Produksi.');
      if(!draft.rolls.length||draft.rolls.some(r=>!r.purchaseId||r.kg===''||!Number.isFinite(Number(r.kg))||Number(r.kg)<=0))throw new Error('Pilih rol yang dipakai. Jika membagi rol, isi kilogram untuk PO ini lebih dari nol.');
      if(attempt&&!AppSyncJournal.equal(attempt.form,draft))throw new Error('Pengiriman sebelumnya belum dipastikan. Gunakan pilihan sebelumnya dan coba lagi untuk memeriksa jatah yang sama.');
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
      const plan=attempt?attempt.plan:CuttingPlan.makePlan({id:'cutting-'+uid(),productIds:draft.productIds,rolls:draft.rolls.map(r=>({purchaseId:r.purchaseId,kg:Number(r.kg)})),note:draft.note.trim(),createdAt:new Date().toISOString()},root,stock);
      if(!attempt&&!confirm('Simpan bahan untuk PO '+(plan.namaBarang||'potong')+'?\n\n'+plan.rolls.map(r=>r.jenis+' · Rol '+(r.rolNum||r.purchaseId)+' · '+qty(r.kg)+' kg').join('\n')+'\n\nPO tetap mengikuti Laporan Produksi. Tukang bebas memilih urutan pekerjaan dan hanya mengisi hasil pcs.')){message('Bahan belum disimpan.');return;}
      attempt={form:draft,plan:clone(plan)};let transactionError='';const beforeCommitRevision=CUTTING_ROOT_REVISION;
      const result=await FB.runTransaction(FB.ref(database,'soldier'),current=>{
        transactionError='';
        try{check();if(!current||!current.stokBahan)throw new Error('Stok bahan pusat belum tersedia.');const existing=CuttingPlan.plans(current.produksi).find(p=>p.id===plan.id);if(existing){if(!samePlan(existing,plan))throw new Error('Identitas jatah berubah.');return current;}requireUncut(current.produksi,draft);return Object.assign({},current,{produksi:CuttingPlan.issue(current.produksi,current.stokBahan,plan)});}
        catch(error){transactionError=error.message;return;}
      },{applyLocally:false});
      if(!result.committed){attempt=null;throw new Error(transactionError||'PO atau jatah berubah. Periksa pilihan lalu coba lagi.');}
      attempt=null;clearForm();adoptRoot((result.snapshot.val()||{}).produksi,beforeCommitRevision);renderCuttingPlans();message('Bahan dan kilogram tersimpan. Tukang tinggal memilih PO dan mengisi hasil potong.');
    }catch(error){message(error.message+(attempt?' Pengiriman belum dipastikan; coba lagi dengan pilihan yang sama.':''),true);}
    finally{busy=false;window.updateCuttingPlanReady();renderHistory();}
  };
  window.cancelCuttingPlan=async function(id){
    if(busy)return;
    try{
      requireReady();if(attempt)throw new Error('Pastikan pengiriman jatah sebelumnya dahulu.');
      const plan=CuttingPlan.plans(CUTTING_ROOT).find(p=>p.id===id);
      if(!plan||plan.status!=='ready')throw new Error('Hanya jatah yang belum dipakai yang dapat dibatalkan.');
      if(!confirm('Batalkan jatah '+(plan.namaBarang||'potong')+' yang belum dipakai? Riwayat jatah tetap disimpan.'))return;
      busy=true;window.updateCuttingPlanReady();await stokJournal.ready();requireReady();
      const target=FB.dbUrl,database=FB.db,generation=stokConnectionGeneration,revision=CUTTING_ROOT_REVISION;let transactionError='';
      const result=await FB.runTransaction(FB.ref(database,'soldier/produksi'),current=>{
        try{requireReady(target);if(database!==FB.db||generation!==stokConnectionGeneration)throw new Error('Koneksi berubah.');return CuttingPlan.cancel(current,id);}
        catch(error){transactionError=error.message;return;}
      },{applyLocally:false});
      if(!result.committed)throw new Error(transactionError||'Jatah berubah atau sudah dipakai. Pembatalan tidak dilakukan.');
      adoptRoot(result.snapshot.val(),revision);message('Jatah dibatalkan; riwayat tetap tersimpan.');
    }catch(error){message(error.message,true);}
    finally{busy=false;window.updateCuttingPlanReady();renderHistory();}
  };
  el('cuttingAdminGroup').addEventListener('change',()=>{readForm();captureOpenMaterials();renderForm(CuttingPlan.availability(CUTTING_ROOT,STOK));});
  el('cuttingAdminRolls').addEventListener('input',()=>{readForm();renderSelection(CuttingPlan.availability(CUTTING_ROOT,STOK));});
  el('cuttingAdminRolls').addEventListener('click',event=>{
    const button=event.target.closest('[data-pick-roll],[data-partial-roll]');if(!button||busy||button.disabled||readyError())return;
    try{
      readForm();captureOpenMaterials();const available=CuttingPlan.availability(CUTTING_ROOT,STOK),id=button.dataset.pickRoll||button.dataset.partialRoll;
      const roll=available.rolls.find(r=>String(r.purchaseId)===id);if(!roll||roll.invalid||roll.unit!=='kg'||Number(roll.available)<=0)throw new Error('Rol sudah tidak tersedia. Periksa data terbaru.');
      let row=form.rolls.find(r=>r.purchaseId===id);if(!row){row={purchaseId:id,kg:'',mode:'partial'};form.rolls.push(row);}
      if(button.dataset.pickRoll){row.kg=String(roll.available);row.mode='whole';}else row.mode='partial';
      openMaterials.add(materialKey(roll));renderRolls(available);message('');
    }catch(error){message(error.message,true);}
  });
  el('cuttingAdminSelection').addEventListener('click',event=>{
    const button=event.target.closest('[data-remove-roll]');if(!button||busy)return;readForm();captureOpenMaterials();form.rolls=form.rolls.filter(row=>row.purchaseId!==button.dataset.removeRoll);renderRolls(CuttingPlan.availability(CUTTING_ROOT,STOK));
  });
  el('cuttingAdminHistory').addEventListener('click',event=>{const button=event.target.closest('[data-cancel-plan]');if(button)window.cancelCuttingPlan(button.dataset.cancelPlan);});
  el('cuttingAdminIssue').addEventListener('click',window.issueCuttingPlan);
  window.renderCuttingPlans();
})();
