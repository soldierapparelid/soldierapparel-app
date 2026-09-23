/* Guided recovery for the master. No automatic force push or draft disposal. */
(function(){
  'use strict';
  let review=null,busy=false,opener=null,reviewGeneration=0;
  const el=id=>document.getElementById(id);
  const pendingState=()=>laporanJournal.snapshot();
  function deletionCount(id,log){return log.ids.filter(value=>String(value)===id).length+Object.keys(log.entries).filter(key=>key.startsWith(id+'|')).length;}
  function checkDeletionReview(){
    if(laporanPendingDeletionKey()!==review.deletionKey||!AppSyncJournal.equal(laporanPendingDeletions(),review.deletions))throw new Error('Catatan penghapusan berubah. Tinjau ulang; perintah baru tidak dibatalkan.');
  }
  function message(text){el('recoveryMessage').textContent=text;}
  function total(p,field){return ProductionSync.rows(p&&p[field]).reduce((sum,row)=>sum+Number(field==='qc'?(Number(row.ok)||0)+(Number(row.reject)||0)+(Number(row.perbaikan)||0)+(Number(row.offline)||0):row.jumlah||row.qty||0),0);}
  function summary(p){
    if(!p)return '<p>Barang tidak ada pada versi ini.</p>';
    const po=p.poAktif===true?'Aktif':p.poAktif===false?'Tidak aktif':'Belum ditetapkan';
    return '<dl><div><dt>Status PO</dt><dd>'+po+'</dd></div>'+[['Potong','potong'],['Setoran jahit','jahit'],['Hitung fisik','hitungFisik'],['Hasil QC','qc'],['Gudang','gudang']].map(([label,field])=>'<div><dt>'+label+'</dt><dd>'+fmt(total(p,field))+' pcs</dd></div>').join('')+'<div><dt>Arsip PO</dt><dd>'+ProductionSync.rows(p.arsip).length+' catatan</dd></div></dl>'+(p.poKet?'<p>Catatan PO: '+esc(p.poKet)+'</p>':'');
  }
  function reason(item){
    if((item.conflicts||[]).some(text=>text.includes('siklus PO berubah')))return '<p class="recovery-reason">Status atau arsip PO di pusat berubah sejak draf ini dibuat. Pilihan diperlukan agar isian lama tidak masuk ke PO yang berbeda.</p>';
    return '<p class="recovery-reason">Ada perubahan pada catatan yang sama. Bandingkan kedua versi; draf tidak akan dikirim sebelum pilihan disimpan.</p>';
  }
  function choices(){
    const serverProducts=[],serverImages=[],cancelDeletions=[];
    review.plan.items.forEach((item,i)=>{if(el('recoveryChoice'+i).checked){(item.type==='product'?serverProducts:serverImages).push(item.id);if(item.type==='product'&&deletionCount(item.id,review.deletions)&&el('recoveryCancelDeletion'+i).checked)cancelDeletions.push(item.id);}});
    return {serverProducts,serverImages,cancelDeletions};
  }
  function show(plan){
    el('recoveryItems').innerHTML=plan.items.length?plan.items.map((item,i)=>'<section class="recovery-item"><h3>'+esc(item.name)+' '+esc(item.size||'')+'</h3><p>'+esc(item.series||'Gambar produk')+'</p>'+(item.type==='product'?reason(item)+'<div class="recovery-compare"><div><h4>Draf di perangkat</h4>'+summary(item.draft)+'</div><div><h4>Data pusat terbaru</h4>'+summary(item.server)+'</div></div>':'<p>Foto diubah pada dua perangkat. Foto lokal tetap disimpan dalam cadangan.</p>')+'<label class="recovery-choice"><input id="recoveryChoice'+i+'" type="checkbox"> Gunakan data pusat untuk barang ini; simpan drafnya di cadangan</label>'+(item.type==='product'&&deletionCount(item.id,review.deletions)?'<label class="recovery-choice"><input id="recoveryCancelDeletion'+i+'" type="checkbox"> Batalkan '+deletionCount(item.id,review.deletions)+' perintah hapus tertahan untuk barang ini saja. Catatan pusat dipertahankan; perintah lama disimpan dalam cadangan.</label>':'')+'</section>').join(''):'<p>Tidak ada bentrokan yang tersisa. Perubahan lokal dapat digabung dengan data pusat terbaru.</p>';
    message(plan.items.length?plan.items.length+' barang/gambar perlu pilihan. Perubahan lain yang tidak bentrok tetap dipertahankan.':'Draf dan data pusat siap diselaraskan. Tidak ada riwayat yang dihapus oleh proses pemulihan.');
    el('recoveryApply').disabled=false;
  }
  window.closeLaporanRecovery=function(){if(busy)return;reviewGeneration++;el('recoveryOv').classList.remove('on');review=null;window.laporanRecoveryPaused=false;if(opener&&opener.focus)opener.focus();scheduleSyncToFirebase();};
  window.reviewLaporanPending=async function(){
    if(busy)return;
    const generation=++reviewGeneration;
    window.laporanRecoveryPaused=true;clearTimeout(syncTimer);
    if(!el('recoveryOv').classList.contains('on'))opener=document.activeElement;
    el('recoveryOv').classList.add('on');el('recoveryClose').focus();el('recoveryItems').innerHTML='';el('recoveryResume').hidden=true;el('recoveryApply').disabled=true;message('Mengambil data pusat tanpa mengubah catatan...');review=null;
    try{
      if(!laporanJournal||!window.ProductionRecovery)throw new Error('Modul pemulihan belum siap. Muat ulang setelah menyimpan cadangan.');
      await laporanJournal.ready();
      if(generation!==reviewGeneration)return;
      const info=laporanJournal.status();
      if(info.foreignPending||info.detached){el('recoveryResume').hidden=false;message('Ada isian dari tab atau sesi lama di komputer ini. Unduh cadangan dahulu, hentikan pengeditan di tab lain, lalu tekan Lanjutkan dan periksa draf. Data pusat belum diubah.');return;}
      if(!FB.connected)throw new Error('Sambungkan internet dahulu; draf lokal tetap aman.');
      if(!info.pending){message('Tidak ada draf tertahan. Gunakan Coba kirim lagi untuk memeriksa koneksi.');return;}
      const before=pendingState(),target=FB.dbUrl,snap=await FB.get(FB.ref(FB.db,'soldier/produksi'));
      if(generation!==reviewGeneration)return;
      const after=pendingState();
      if(before.token!==after.token||before.target!==target||target!==FB.dbUrl)throw new Error('Draf berubah saat diperiksa. Tekan Tinjau perubahan lagi.');
      const remote=snap.val(),plan=ProductionRecovery.plan(after.base,after.draft,remote);
      if(!plan.items.length&&!plan.ok)throw new Error(plan.conflicts.join(', '));
      const deletions=laporanPendingDeletions(),deletionKey=laporanPendingDeletionKey();
      if(deletions.target&&deletions.target!==target)throw new Error('Perintah hapus berasal dari database berbeda. Data belum diubah.');
      review={token:after.token,target,remote,plan,deletions,deletionKey};show(plan);
    }catch(error){if(generation===reviewGeneration)message(error.message);}
  };
  window.continueLaporanRecovery=async function(){
    if(busy||el('recoveryResume').hidden)return;
    busy=true;el('recoveryResume').disabled=true;el('recoveryClose').disabled=true;
    let continued=false;
    try{
      if(await window.resumeLaporanPending({reviewOnly:true})){
        await laporanJournal.ready();
        const info=laporanJournal.status();
        if(!info.durable||info.foreignPending||info.detached)throw new Error('Draf belum aman untuk ditinjau. Unduh cadangan dan periksa tab lain.');
        continued=true;
      }else message('Draf belum dipindahkan. Tidak ada perubahan yang dikirim; cadangan tetap tersedia.');
    }catch(error){message(error.message+' Tidak ada data pusat yang ditimpa.');}
    finally{busy=false;el('recoveryResume').disabled=false;el('recoveryClose').disabled=false;}
    if(continued)await window.reviewLaporanPending();
  };
  window.applyLaporanRecovery=async function(){
    if(busy||!review)return;
    const selected=choices(),accepted=ProductionRecovery.plan(pendingState().base,pendingState().draft,review.remote,selected);
    if(!accepted.ok){message('Centang pilihan untuk setiap barang yang berbeda, atau tutup untuk membiarkan draf tetap tersimpan.');return;}
    // Separate, explicit consent is required for cancelling pending deletion
    // commands. Keep their exact original values with the durable draft backup.
    try{checkDeletionReview();}catch(error){message(error.message);return;}
    if(selected.serverProducts.some(id=>deletionCount(id,review.deletions)&&!selected.cancelDeletions.includes(id))){message('Barang ini memiliki penghapusan tertahan. Jika ingin mempertahankan data pusat, centang juga Batalkan perintah hapus. Belum ada data yang diubah.');return;}
    if(!confirm('Simpan cadangan lengkap, gunakan pilihan data pusat hanya untuk barang yang dicentang'+(selected.cancelDeletions.length?', batalkan perintah hapus tertahan hanya untuk barang yang disetujui':'')+', lalu kirim perubahan lain yang aman?'))return;
    busy=true;el('recoveryApply').disabled=true;el('recoveryClose').disabled=true;message('Menyimpan cadangan dan memeriksa ulang data pusat...');
    try{
      if(FB.dbUrl!==review.target||!FB.connected)throw new Error('Koneksi berubah. Tinjau ulang.');
      const snap=await FB.get(FB.ref(FB.db,'soldier/produksi')),remote=snap.val();
      if(!AppSyncJournal.equal(remote,review.remote))throw new Error('Data pusat baru berubah. Tinjau ulang sebelum memilih; belum ada data yang ditimpa.');
      checkDeletionReview();
      const recoveryContext={type:'reviewed-pending-deletions-v1',deletionKey:review.deletionKey,pendingDeletions:review.deletions,cancelledProducts:selected.cancelDeletions,serverProducts:selected.serverProducts};
      const result=await laporanJournal.reconcilePending(remote,review.target,review.token,(base,draft,server)=>{checkDeletionReview();return ProductionRecovery.plan(base,draft,server,selected);},recoveryContext);
      // Reflect the durable rebase even if the separate command queue cannot
      // be updated. Otherwise a later edit could restage the stale visible data.
      DB=result.value;pendingLocalChange=laporanJournal.status().pending;cacheLaporan();renderAll();
      if(selected.cancelDeletions.length){
        checkDeletionReview();
        const cancelled=new Set(selected.cancelDeletions),remaining=AppSyncJournal.clone(review.deletions);
        remaining.ids=remaining.ids.filter(id=>!cancelled.has(String(id)));
        Object.keys(remaining.entries).forEach(key=>{if(selected.cancelDeletions.some(id=>key.startsWith(id+'|')))delete remaining.entries[key];});
        // The original draft AND commands have committed to the journal backup
        // before removing commands from the pending queue. No cloud deletion.
        localStorage.setItem(review.deletionKey,JSON.stringify(remaining));
      }
      laporanConnectionError='';lastSyncError='';
      if(pendingLocalChange)await flushLaporanPending();
      else {lastSyncAt=Date.now();firebaseSyncReady=laporanJournal.status().baseKnown;updateSyncTag();}
      review=null;el('recoveryItems').innerHTML='';message(laporanJournal.status().pending?'Pilihan tersimpan. Ada perubahan lebih baru yang masih menunggu dikirim. Cadangan draf sebelumnya tetap aman.':'Selesai. Data pusat dan perubahan aman sudah diselaraskan. Draf sebelumnya tetap tersimpan di cadangan sinkronisasi.');
    }catch(error){message(error.message+' Draf dan cadangannya tetap disimpan.');updateSyncTag();review=null;}
    finally{busy=false;el('recoveryClose').disabled=false;el('recoveryApply').disabled=true;}
  };
  document.addEventListener('keydown',event=>{
    if(!el('recoveryOv').classList.contains('on'))return;
    if(event.key==='Escape'){event.preventDefault();window.closeLaporanRecovery();}
    if(event.key==='Tab'){
      const nodes=Array.from(el('recoveryOv').querySelectorAll('button:not([disabled]),input:not([disabled])'));
      if(!nodes.length)return;const first=nodes[0],last=nodes[nodes.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
})();
