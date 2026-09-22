/* Guided recovery for the master. No automatic force push or draft disposal. */
(function(){
  'use strict';
  let review=null,busy=false,opener=null;
  const el=id=>document.getElementById(id);
  const pendingState=()=>JSON.parse(laporanJournal.exportState()).journal.state;
  function message(text){el('recoveryMessage').textContent=text;}
  function total(p,field){return ProductionSync.rows(p&&p[field]).reduce((sum,row)=>sum+Number(field==='qc'?(Number(row.ok)||0)+(Number(row.reject)||0)+(Number(row.perbaikan)||0)+(Number(row.offline)||0):row.jumlah||row.qty||0),0);}
  function summary(p){
    if(!p)return '<p>Barang tidak ada pada versi ini.</p>';
    return '<dl>'+[['Potong','potong'],['Setoran jahit','jahit'],['Hitung fisik','hitungFisik'],['Hasil QC','qc'],['Gudang','gudang']].map(([label,field])=>'<div><dt>'+label+'</dt><dd>'+fmt(total(p,field))+' pcs</dd></div>').join('')+'<div><dt>Arsip PO</dt><dd>'+ProductionSync.rows(p.arsip).length+' catatan</dd></div></dl>';
  }
  function choices(){
    const serverProducts=[],serverImages=[];
    review.plan.items.forEach((item,i)=>{if(el('recoveryChoice'+i).checked)(item.type==='product'?serverProducts:serverImages).push(item.id);});
    return {serverProducts,serverImages};
  }
  function show(plan){
    el('recoveryItems').innerHTML=plan.items.length?plan.items.map((item,i)=>'<section class="recovery-item"><h3>'+esc(item.name)+' '+esc(item.size||'')+'</h3><p>'+esc(item.series||'Gambar produk')+'</p>'+(item.type==='product'?'<div class="recovery-compare"><div><h4>Draf di perangkat</h4>'+summary(item.draft)+'</div><div><h4>Data pusat terbaru</h4>'+summary(item.server)+'</div></div>':'<p>Foto diubah pada dua perangkat. Foto lokal tetap disimpan dalam cadangan.</p>')+'<label class="recovery-choice"><input id="recoveryChoice'+i+'" type="checkbox"> Gunakan data pusat untuk barang ini; simpan drafnya di cadangan</label></section>').join(''):'<p>Tidak ada bentrokan yang tersisa. Perubahan lokal dapat digabung dengan data pusat terbaru.</p>';
    message(plan.items.length?plan.items.length+' barang/gambar perlu pilihan. Perubahan lain yang tidak bentrok tetap dipertahankan.':'Draf dan data pusat siap diselaraskan. Tidak ada riwayat yang dihapus oleh proses pemulihan.');
    el('recoveryApply').disabled=false;
  }
  window.closeLaporanRecovery=function(){if(busy)return;el('recoveryOv').classList.remove('on');review=null;if(opener&&opener.focus)opener.focus();};
  window.reviewLaporanPending=async function(){
    if(busy)return;
    opener=document.activeElement;el('recoveryOv').classList.add('on');el('recoveryClose').focus();el('recoveryItems').innerHTML='';el('recoveryApply').disabled=true;message('Mengambil data pusat tanpa mengubah catatan...');review=null;
    try{
      if(!laporanJournal||!window.ProductionRecovery)throw new Error('Modul pemulihan belum siap. Muat ulang setelah menyimpan cadangan.');
      await laporanJournal.ready();
      const info=laporanJournal.status();
      if(info.foreignPending||info.detached)throw new Error('Draf masih dimiliki tab sebelumnya. Tutup peninjauan, pilih Lanjutkan draf tersimpan, lalu tinjau kembali.');
      if(!FB.connected)throw new Error('Sambungkan internet dahulu; draf lokal tetap aman.');
      if(!info.pending){message('Tidak ada draf tertahan. Gunakan Coba kirim lagi untuk memeriksa koneksi.');return;}
      const before=pendingState(),target=FB.dbUrl,snap=await FB.get(FB.ref(FB.db,'soldier/produksi'));
      const after=pendingState();
      if(before.token!==after.token||before.target!==target||target!==FB.dbUrl)throw new Error('Draf berubah saat diperiksa. Tekan Tinjau perubahan lagi.');
      const remote=snap.val(),plan=ProductionRecovery.plan(after.base,after.draft,remote);
      if(!plan.items.length&&!plan.ok)throw new Error(plan.conflicts.join(', '));
      review={token:after.token,target,remote,plan};show(plan);
    }catch(error){message(error.message);}
  };
  window.applyLaporanRecovery=async function(){
    if(busy||!review)return;
    const selected=choices(),accepted=ProductionRecovery.plan(pendingState().base,pendingState().draft,review.remote,selected);
    if(!accepted.ok){message('Centang pilihan untuk setiap barang yang berbeda, atau tutup untuk membiarkan draf tetap tersimpan.');return;}
    // Deletion intent is a separate durable record. Do not silently detach it
    // from a still-pending deletion during a product-level choice.
    const deletions=laporanPendingDeletions();
    if(selected.serverProducts.some(id=>deletions.ids.some(value=>String(value)===id)||Object.keys(deletions.entries).some(key=>key.startsWith(id+'|')))){message('Barang terpilih juga memiliki penghapusan tertahan. Unduh cadangan untuk pemeriksaan; data belum diubah.');return;}
    if(!confirm('Simpan cadangan lengkap, gunakan pilihan data pusat hanya untuk barang yang dicentang, lalu kirim perubahan lain yang aman?'))return;
    busy=true;el('recoveryApply').disabled=true;el('recoveryClose').disabled=true;message('Menyimpan cadangan dan memeriksa ulang data pusat...');
    try{
      if(FB.dbUrl!==review.target||!FB.connected)throw new Error('Koneksi berubah. Tinjau ulang.');
      const snap=await FB.get(FB.ref(FB.db,'soldier/produksi')),remote=snap.val();
      if(!AppSyncJournal.equal(remote,review.remote))throw new Error('Data pusat baru berubah. Tinjau ulang sebelum memilih; belum ada data yang ditimpa.');
      const result=await laporanJournal.reconcilePending(remote,review.target,review.token,(base,draft,server)=>ProductionRecovery.plan(base,draft,server,selected));
      DB=result.value;pendingLocalChange=laporanJournal.status().pending;laporanConnectionError='';lastSyncError='';cacheLaporan();renderAll();
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
