/* Explicit owner review of disconnected roll identities. No automatic repair. */
(function(){
  'use strict';
  const el=id=>document.getElementById(id),clone=x=>AppSyncJournal.clone(x);
  const qty=n=>Number(n||0).toLocaleString('id-ID',{maximumFractionDigits:6});
  let controller=null,context=null,running=false,initializing=null,returnFocus=null;
  const dialog=()=>el('stockRollRepairDialog');
  function notice(text,error=false){el('stockRollRepairMessage').textContent=text;el('stockRollRepairMessage').dataset.error=String(error);}
  function readyError(target){
    if(!stokBootReady||!stokJournal||!FB.connected||!firebaseSyncReadyStok||!FB.get||!FB.onValue||!FB.runTransaction)return 'Sambungkan internet dan tunggu stok tersinkron sebelum memperbaiki rol.';
    if(target&&target!==FB.dbUrl)return 'Koneksi berbeda dari saat pilihan dibuat. Kembali ke koneksi semula.';
    const s=stokJournal.status();
    if(!s.baseKnown||s.target!==FB.dbUrl||s.pending||s.foreignPending||s.conflict||s.detached||s.error||stokWritePromise||stokSyncError||Object.keys(stokReadErrors).length)return 'Selesaikan draf atau kendala sinkronisasi stok lebih dahulu. Jangan paksa menimpa data.';
    return '';
  }
  function requireReady(target){const error=readyError(target);if(error)throw new Error(error);}
  async function init(){
    if(controller)return controller;
    if(!initializing)initializing=(async()=>{
      const storage=await AppSyncStorage.open({storage:localStorage,indexedDB:window.indexedDB,keys:['stok_roll_repair_v1']});
      await storage.whenIdle();
      controller=StockRollRepairTransaction.create({storage,key:'stok_roll_repair_v1',engine:StockRollRepair,transactionRun:CuttingTransaction.run});
      return controller;
    })();
    return initializing;
  }
  function pending(){return controller&&controller.pending();}
  function show(){
    if(!dialog().open){returnFocus=document.activeElement;if(typeof dialog().showModal==='function')dialog().showModal();else dialog().setAttribute('open','');}
    el('stockRollRepairTitle').focus();
  }
  function selections(){return Array.from(el('stockRollRepairRows').querySelectorAll('[data-repair-detail]')).filter(x=>x.value).map(x=>({detailId:x.dataset.repairDetail,purchaseId:x.value}));}
  function candidateLabel(c,unit){return (c.invoice?'Nota '+c.invoice:'Tanpa nomor nota')+' · '+(c.tanggal||'tanggal belum ada')+' · Rol '+(c.rolNum||'—')+' · '+qty(c.kg)+' '+unit;}
  function renderRows(){
    const info=context.info,unit=CuttingPlan.unitLabel(info.unit);
    el('stockRollRepairMaterial').textContent=info.material||context.jenis;
    el('stockRollRepairSummary').textContent='Saldo tercatat '+qty(info.stock)+' '+unit+' · Jumlah stok tidak diubah.';
    el('stockRollRepairRows').innerHTML=info.rows.map((r,i)=>{
      const options=(r.candidates||[]).map(c=>'<option value="'+esc(c.purchaseId)+'"'+(!c.eligible?' disabled':'')+'>'+esc(candidateLabel(c,unit)+(c.eligible?'':' — '+c.reason))+'</option>').join('');
      const linked=(info.candidates||[]).find(c=>c.purchaseId===r.purchaseId);
      return '<article class="repair-roll"><div class="repair-roll-heading"><strong>Rol tercatat '+(i+1)+'</strong><b>'+qty(r.val)+' '+esc(unit)+'</b></div>'+(r.note?'<p class="mini">'+esc(r.note)+'</p>':'')+
        (r.editable?'<label for="repair-purchase-'+i+'">Hubungkan ke nota &amp; rol pembelian</label><select id="repair-purchase-'+i+'" data-repair-detail="'+esc(r.detailId)+'"><option value="">Pilih nota dan rol yang benar…</option>'+options+'</select><p class="mini">Cocokkan dengan label rol dan nota fisik, bukan hanya beratnya.</p>':'<p class="repair-linked">'+esc(linked?candidateLabel(linked,unit):r.reason||'Hubungan rol ini tidak dapat diubah di sini.')+'</p>')+'</article>';
    }).join('')||'<p>Belum ada rincian rol untuk dihubungkan. Fitur ini tidak membuat stok atau rol baru.</p>';
    el('stockRollRepairReview').hidden=!info.rows.some(r=>r.editable);
    el('stockRollRepairSave').hidden=!info.rows.some(r=>r.editable);
    el('stockRollRepairRefresh').hidden=false;el('stockRollRepairConfirm').checked=false;
    if(!info.valid)notice(info.reason||'Data bahan perlu diperiksa.',true);
    else if(!info.rows.some(r=>r.editable))notice('Tidak ada rol terputus yang bisa diperbaiki. Rol yang sudah terhubung atau tidak aman diubah tetap dilindungi.');
    else notice('Pilih hanya rol yang belum terhubung. Tidak ada nota yang dipilih otomatis.');
    el('stockRollRepairRows').querySelectorAll('[data-repair-detail]').forEach(input=>input.addEventListener('change',()=>{el('stockRollRepairConfirm').checked=false;preview();}));
    preview();
  }
  function preview(){
    if(!context||!context.info||pending())return;
    const mappings=selections();let valid=false;
    try{
      if(mappings.length){
        const result=StockRollRepair.prepare(context.root,context.stock,context.jenis,mappings);
        el('stockRollRepairPreview').innerHTML='<b>'+result.changes.length+' hubungan rol akan diperbaiki</b><ul>'+result.changes.map(c=>'<li>'+esc((c.invoice?'Nota '+c.invoice:'Tanpa nomor nota')+' · Rol '+(c.rolNum||'—')+' · '+qty(c.val)+' '+CuttingPlan.unitLabel(c.unit))+'</li>').join('')+'</ul><p>Jumlah, harga pembelian, hasil potong, dan jatah PO tidak diubah.</p>';valid=true;
      }else el('stockRollRepairPreview').textContent='Pilih nota untuk melihat rincian perubahan.';
    }catch(error){el('stockRollRepairPreview').textContent=error.message;}
    el('stockRollRepairSave').disabled=running||!valid||!el('stockRollRepairConfirm').checked||!!readyError(context.target);
  }
  function renderPending(){
    const record=pending();if(!record)return;
    context={jenis:record.jenis,target:record.target};
    el('stockRollRepairMaterial').textContent=record.jenis;
    el('stockRollRepairSummary').textContent='Periksa pengiriman yang sama. Jangan membuat perbaikan baru.';
    el('stockRollRepairRows').innerHTML='<p>Pilihan dan cadangan sebelum perbaikan tetap tersimpan di perangkat ini.</p>';
    el('stockRollRepairReview').hidden=true;el('stockRollRepairRefresh').hidden=true;
    el('stockRollRepairSave').hidden=false;el('stockRollRepairSave').disabled=running;
    el('stockRollRepairSave').textContent='Periksa / coba pengiriman yang sama';
    el('stockRollRepairBackup').disabled=running;
  }
  function controls(){
    el('stockRollRepairClose').disabled=running;el('stockRollRepairRefresh').disabled=running;
    el('stockRollRepairBackup').disabled=running||(!context&&!(controller&&controller.backup()));
    el('stockRollRepairRows').querySelectorAll('select').forEach(input=>input.disabled=running);
    el('stockRollRepairConfirm').disabled=running;el('stockRollRepairRecovery').hidden=!pending();
    if(pending())renderPending();else preview();
  }
  function io(target){
    const database=FB.db,generation=stokConnectionGeneration;
    return {target,ref:FB.ref(database,'soldier'),onValue:FB.onValue,runTransaction:FB.runTransaction,
      check:()=>{requireReady(target);if(database!==FB.db||generation!==stokConnectionGeneration)throw new Error('Koneksi berubah. Periksa pengiriman pada koneksi semula.');}};
  }
  async function open(jenis){
    if(running)return;
    try{
      await init();
      if(pending()){renderPending();notice('Ada perbaikan yang belum dikonfirmasi. Periksa pengiriman ini dahulu.',true);show();return;}
      requireReady();await stokJournal.ready();requireReady();
      running=true;context=null;el('stockRollRepairRows').innerHTML='';el('stockRollRepairMaterial').textContent=jenis;el('stockRollRepairSummary').textContent='';el('stockRollRepairReview').hidden=true;el('stockRollRepairSave').hidden=true;el('stockRollRepairRefresh').hidden=true;show();notice('Mengambil stok dan pemakaian terbaru…');controls();
      const target=FB.dbUrl,connection=io(target),central=(await FB.get(connection.ref)).val();connection.check();
      if(!central||!central.produksi||!central.stokBahan)throw new Error('Data pusat belum lengkap. Tidak ada perubahan disimpan.');
      context={jenis,target,stock:clone(central.stokBahan),root:clone(central.produksi)};
      context.info=StockRollRepair.inspect(context.root,context.stock,jenis);
      el('stockRollRepairSave').textContent='Simpan hubungan rol';renderRows();
    }catch(error){notice(error.message,true);show();}
    finally{running=false;controls();}
  }
  async function save(){
    if(running)return;
    try{
      await init();const retry=pending();if(!retry&&!(context&&context.info))return;
      const target=retry?retry.target:context.target;requireReady(target);await stokJournal.ready();requireReady(target);
      if(!retry&&!el('stockRollRepairConfirm').checked)throw new Error('Cocokkan nota dan label rol, lalu centang konfirmasi.');
      const mappings=retry?null:selections();if(!retry)StockRollRepair.prepare(context.root,context.stock,context.jenis,mappings);
      running=true;controls();notice('Menyimpan cadangan aman dan memeriksa data pusat…');
      const result=retry?await controller.retry(io(target)):await controller.save({...io(target),jenis:context.jenis,rootSnapshot:{produksi:context.root,stokBahan:context.stock},stockSnapshot:context.stock,mappings});
      if(result.confirmed){
        notice('Hubungan rol sudah dikonfirmasi pusat. Jumlah stok dan riwayat tetap.'+(result.warning?' '+result.warning:''),!!result.warning);
        if(!result.pending){
          const materialName=context.jenis;context=null;
          el('stockRollRepairSave').hidden=true;el('stockRollRepairReview').hidden=true;el('stockRollRepairRefresh').hidden=true;
          el('stockRollRepairRows').innerHTML='<p class="repair-success">Selesai. Buka <b>Bahan untuk PO</b>, lalu pilih bahan yang sudah dihubungkan.</p>';
          el('stockRollRepairMaterial').textContent=materialName;
          el('stockRollRepairSummary').textContent='Tidak menambah stok dan tidak menghidupkan kembali jatah yang dibatalkan.';
        }
        // Realtime listeners own STOK. Do not replace newer local data with an older receipt.
        renderStok();
      }else notice((result.error||'Perbaikan belum dikonfirmasi.')+(result.pending?' Pilihan tetap tersimpan. Periksa pengiriman yang sama.':' Muat data terbaru sebelum memilih ulang.'),true);
    }catch(error){notice(error.message,true);}
    finally{running=false;controls();}
  }
  function close(){
    if(running)return;
    if(typeof dialog().close==='function')dialog().close();else dialog().removeAttribute('open');
    if(returnFocus&&typeof returnFocus.focus==='function')returnFocus.focus();
  }
  function download(){
    const record=controller&&controller.backup();
    const value=context&&context.info&&!pending()?{version:1,type:'roll-link-review',jenis:context.jenis,createdAt:new Date().toISOString(),beforeStock:context.stock}:record;
    if(!value){notice('Belum ada cadangan perbaikan.',true);return;}
    dlFile('stok-cadangan-hubungan-rol-'+today()+'.json',JSON.stringify(value,null,2),'application/json');
  }
  function cardHTML(jenis,projection){
    const count=(projection.active||[]).filter(r=>r.purchaseId==null).length;
    return '<div class="repair-card-action">'+(count?'<p class="repair-warning">'+count+' rol belum terhubung ke nota pembelian. Stok bisa terlihat, tetapi rol belum bisa dipilih untuk PO.</p>':'')+'<button type="button" class="sec small" onclick="'+stockAction('openStockRollRepair',jenis)+'">Perbaiki hubungan rol</button></div>';
  }
  window.openStockRollRepair=open;window.StockRollRepairUI={open,save,close,download,preview,cardHTML};
  el('stockRollRepairSave').addEventListener('click',save);el('stockRollRepairClose').addEventListener('click',close);
  el('stockRollRepairRefresh').addEventListener('click',()=>context&&open(context.jenis));
  el('stockRollRepairBackup').addEventListener('click',download);el('stockRollRepairConfirm').addEventListener('change',preview);
  el('stockRollRepairResume').addEventListener('click',()=>open(''));
  dialog().addEventListener('cancel',event=>{if(running)event.preventDefault();});
  window.appReady.then(async()=>{
    if(!stokBootReady)return;
    try{renderStok();await init();controls();if(pending()){renderPending();notice('Ada perbaikan belum dikonfirmasi dari sesi sebelumnya.',true);show();}}
    catch(error){el('stockRollRepairRecovery').hidden=false;el('stockRollRepairRecoveryText').textContent='Cadangan perbaikan belum siap: '+error.message;}
  });
})();
