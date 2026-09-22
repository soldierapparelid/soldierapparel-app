/* Owner-issued cutting plans. Stock records remain owned by the stock journal. */
(function(){
  'use strict';
  const el=id=>document.getElementById(id),clone=value=>AppSyncJournal.clone(value);
  let busy=false,availabilityError='',attempt=null;
  let form={group:'',productIds:[],rolls:[{purchaseId:'',kg:''}],note:''};
  const qty=value=>Number(value||0).toLocaleString('id-ID',{maximumFractionDigits:6});
  const groupKey=p=>JSON.stringify([p.series||'',p.namaBarang||'',p._offlineOrderId||'']);
  const active=p=>p.poAktif===true||p.poAktif===1||p.poAktif==='true';
  function groups(){
    const result=new Map();
    CuttingPlan.products(CUTTING_ROOT).filter(active).forEach(p=>{const key=groupKey(p);if(!result.has(key))result.set(key,[]);result.get(key).push(p);});
    return result;
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
    form={group:el('cuttingAdminGroup').value,productIds:Array.from(el('cuttingAdminSizes').querySelectorAll('input:checked')).map(input=>input.value),
      rolls:Array.from(el('cuttingAdminRolls').querySelectorAll('.cutting-roll-row')).map(row=>({purchaseId:row.querySelector('select').value,kg:row.querySelector('input').value})),note:el('cuttingAdminNote').value};
    if(!form.rolls.length)form.rolls=[{purchaseId:'',kg:''}];
    return form;
  }
  function total(){
    const rows=Array.from(el('cuttingAdminRolls').querySelectorAll('.cutting-roll-row'));
    el('cuttingAdminTotal').textContent='Total jatah: '+qty(rows.reduce((sum,row)=>sum+(Number(row.querySelector('input').value)||0),0))+' kg';
  }
  function renderForm(available){
    const all=groups(),selected=all.get(form.group)||[];
    el('cuttingAdminGroup').innerHTML='<option value="">Pilih barang…</option>'+Array.from(all,([key,items])=>'<option value="'+esc(key)+'"'+(key===form.group?' selected':'')+'>'+esc(items[0].series+' · '+items[0].namaBarang+(items[0]._offlineOrderId?' · Pesanan '+items[0]._offlineOrderId:''))+'</option>').join('');
    el('cuttingAdminGroup').value=all.has(form.group)?form.group:'';
    el('cuttingAdminSizes').innerHTML=selected.length?selected.map(p=>'<label><input type="checkbox" value="'+esc(String(p.id))+'"'+(form.productIds.includes(String(p.id))?' checked':'')+'> '+esc(p.size||'Tanpa size')+'</label>').join(''):'<p class="mini">Pilih barang untuk menampilkan size PO aktif.</p>';
    el('cuttingAdminRolls').innerHTML=form.rolls.map((row,index)=>'<div class="cutting-roll-row" data-row="'+index+'"><div><label for="cuttingRoll'+index+'">Rol pembelian '+(index+1)+'</label><select id="cuttingRoll'+index+'"><option value="">Pilih rol…</option>'+available.rolls.filter(r=>r.unit==='kg'&&(Number(r.available)>0||String(r.purchaseId)===row.purchaseId)).map(r=>'<option value="'+esc(String(r.purchaseId))+'"'+(String(r.purchaseId)===row.purchaseId?' selected':'')+'>'+esc(r.jenis)+' · Rol '+esc(r.rolNum||r.purchaseId)+' · batas '+qty(r.available)+' kg · dipesan '+qty(r.reserved)+' kg</option>').join('')+'</select></div><div><label for="cuttingKg'+index+'">Jatah (kg)</label><input id="cuttingKg'+index+'" type="number" min="0" step="any" inputmode="decimal" value="'+esc(row.kg)+'" placeholder="0"></div><button type="button" class="sec small" data-remove-roll="'+index+'"'+(form.rolls.length===1?' disabled':'')+'>Hapus</button></div>').join('');
    el('cuttingAdminNote').value=form.note;total();
  }
  function renderHistory(){
    const products=new Map(CuttingPlan.products(CUTTING_ROOT).map(p=>[String(p.id),p]));
    const plans=CuttingPlan.plans(CUTTING_ROOT).slice().sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    el('cuttingAdminHistory').innerHTML=plans.length?plans.map(plan=>{
      const sizes=(plan.products||[]).map(ref=>{const p=products.get(String(ref.id));return p?p.size||'Tanpa size':ref.id;});
      const status=plan.status==='used'?'Sudah dipakai':plan.status==='cancelled'?'Dibatalkan':'Siap dipotong';
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
    if(el('cuttingAdminRolls').querySelector('.cutting-roll-row'))readForm();
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
      if(!draft.productIds.length)throw new Error('Pilih minimal satu size PO aktif.');
      if(draft.rolls.some(r=>!r.purchaseId||r.kg===''||!Number.isFinite(Number(r.kg))||Number(r.kg)<=0))throw new Error('Pilih setiap rol dan isi jumlah kg lebih dari nol.');
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
        if(previous){if(!samePlan(previous,attempt.plan))throw new Error('Identitas jatah sudah digunakan dengan rincian berbeda. Periksa riwayat.');adoptRoot(root,revision);attempt=null;message('Jatah sebelumnya sudah dikonfirmasi pusat.');return;}
      }
      const plan=attempt?attempt.plan:CuttingPlan.makePlan({id:'cutting-'+uid(),productIds:draft.productIds,rolls:draft.rolls.map(r=>({purchaseId:r.purchaseId,kg:Number(r.kg)})),note:draft.note.trim(),createdAt:new Date().toISOString()},root,stock);
      if(!attempt&&!confirm('Terbitkan jatah '+(plan.namaBarang||'potong')+' untuk '+draft.productIds.length+' size?\n\n'+plan.rolls.map(r=>r.jenis+' · Rol '+(r.rolNum||r.purchaseId)+' · '+qty(r.kg)+' kg').join('\n')+'\n\nTukang hanya mengisi hasil pcs. Jatah terbit tidak dapat diedit.')){message('Jatah belum diterbitkan.');return;}
      attempt={form:draft,plan:clone(plan)};let transactionError='';const beforeCommitRevision=CUTTING_ROOT_REVISION;
      const result=await FB.runTransaction(FB.ref(database,'soldier'),current=>{
        transactionError='';
        try{check();if(!current||!current.stokBahan)throw new Error('Stok bahan pusat belum tersedia.');const existing=CuttingPlan.plans(current.produksi).find(p=>p.id===plan.id);if(existing){if(!samePlan(existing,plan))throw new Error('Identitas jatah berubah.');return current;}return Object.assign({},current,{produksi:CuttingPlan.issue(current.produksi,current.stokBahan,plan)});}
        catch(error){transactionError=error.message;return;}
      },{applyLocally:false});
      if(!result.committed){attempt=null;throw new Error(transactionError||'PO atau jatah berubah. Periksa pilihan lalu coba lagi.');}
      attempt=null;adoptRoot((result.snapshot.val()||{}).produksi,beforeCommitRevision);message('Jatah diterbitkan. Tukang dapat memilihnya di Potong.');
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
  el('cuttingAdminGroup').addEventListener('change',()=>{readForm();form.productIds=[];renderForm(CuttingPlan.availability(CUTTING_ROOT,STOK));});
  el('cuttingAdminAddRoll').addEventListener('click',()=>{readForm();form.rolls.push({purchaseId:'',kg:''});renderForm(CuttingPlan.availability(CUTTING_ROOT,STOK));});
  el('cuttingAdminRolls').addEventListener('input',total);
  el('cuttingAdminRolls').addEventListener('click',event=>{const button=event.target.closest('[data-remove-roll]');if(!button||busy)return;readForm();if(form.rolls.length>1)form.rolls.splice(Number(button.dataset.removeRoll),1);renderForm(CuttingPlan.availability(CUTTING_ROOT,STOK));});
  el('cuttingAdminHistory').addEventListener('click',event=>{const button=event.target.closest('[data-cancel-plan]');if(button)window.cancelCuttingPlan(button.dataset.cancelPlan);});
  el('cuttingAdminIssue').addEventListener('click',window.issueCuttingPlan);
  window.renderCuttingPlans();
})();
