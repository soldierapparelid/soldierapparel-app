(function(){
  'use strict';
  const Model=window.SoldierMaklonEarnings,Policy=window.SoldierAccessPolicy;
  let context,model,unsubscribe,selection=0,ownerId;
  const byId=id=>document.getElementById(id);
  const currency=value=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:2}).format(value);
  function clear(){
    model=null;byId('earnings-content').hidden=true;byId('earnings-rows').replaceChildren();byId('worker-name').textContent='';
    byId('work-count').textContent='';byId('earnings-total').textContent='';
  }
  function status(value){byId('earnings-status').textContent=value;}
  function validSession(workerId){
    if(!context||!context.authorized||!context.auth.currentUser||context.auth.currentUser.uid!==context.uid||!Policy.allowed(context.profile,'earnings')||document.documentElement.hasAttribute('data-soldier-locked'))return false;
    try{return Model.target(context.profile,context.profile.owner===true?ownerId:undefined).workerId===workerId;}catch{return false;}
  }
  function render(){
    if(!model||!validSession(model.workerId)){clear();return;}
    byId('earnings-rows').replaceChildren();
    if(model.availability==='absent'){clear();status('Rincian upah belum diterbitkan untuk akun ini. Owner sedang menyiapkan catatan mitra.');return;}
    const range={};if(byId('date-from').value)range.from=byId('date-from').value;if(byId('date-to').value)range.to=byId('date-to').value;
    let summary;
    try{summary=Model.summarize(model,range);}catch{byId('work-count').textContent='—';byId('earnings-total').textContent='—';status('Periksa tanggal awal dan akhir yang dipilih.');return;}
    byId('worker-name').textContent=model.nama;byId('work-count').textContent=summary.quantity.toLocaleString('id-ID')+' pcs';byId('earnings-total').textContent=currency(summary.calculatedTotal);
    for(const entry of model.entries){
      if(range.from&&entry.tanggal<range.from||range.to&&entry.tanggal>range.to)continue;
      const row=document.createElement('tr');
      const values=[entry.tanggal,entry.series+' · '+entry.namaBarang+' · '+entry.size,entry.jumlah.toLocaleString('id-ID'),currency(entry.tarif),currency(entry.total),entry.provisional?'Hitungan sementara':'Hasil QC / gudang'];
      for(const [index,value]of values.entries()){const cell=document.createElement('td');cell.textContent=value;if(index===3||index===4)cell.className='money';row.append(cell);}
      byId('earnings-rows').append(row);
    }
    byId('earnings-content').hidden=false;status(model.entries.length?'Rincian mengikuti catatan pekerjaan yang sudah diterbitkan owner.':'Belum ada catatan upah pada periode pekerjaan ini.');
  }
  function subscribe(id){
    const ticket=++selection;if(unsubscribe)unsubscribe();clear();
    if(context.profile.owner===true)ownerId=id;
    let target;try{target=Model.target(context.profile,context.profile.owner===true?id:undefined);}catch{status('Hubungan akun dengan catatan mitra perlu diperiksa owner.');return;}
    status('Memuat rincian hasil kerja…');
    unsubscribe=context.sdk.onValue(context.sdk.ref(context.db,target.path),snapshot=>{
      if(ticket!==selection)return;
      if(!validSession(target.workerId)){clear();return;}
      try{model=Model.normalize(snapshot.val(),target.workerId);render();}catch{clear();status('Rincian pekerjaan perlu diperiksa owner sebelum ditampilkan.');}
    },()=>{if(ticket!==selection)return;clear();status('Rincian upah belum tersedia untuk akun ini. Hubungi owner untuk memeriksa akses dan catatan mitra.');});
  }
  async function ownerPicker(){
    const snapshot=await context.sdk.get(context.sdk.ref(context.db,'soldier/workerDirectory'));
    if(!context.authorized||context.profile.owner!==true||!context.auth.currentUser||context.auth.currentUser.uid!==context.uid||document.documentElement.hasAttribute('data-soldier-locked'))return;
    const data=snapshot.val()||{};
    if(typeof data!=='object'||Array.isArray(data)||Object.keys(data).length>5000)throw Error('invalid_directory');
    const options=[];
    for(const [id,record]of Object.entries(data)){
      Model.target(context.profile,id);
      if(!record||record.id!==id||typeof record.nama!=='string'||!record.nama.trim()||record.nama.length>256||Object.keys(record).some(key=>!['id','nama'].includes(key)))throw Error('invalid_directory');
      const option=document.createElement('option');option.value=id;option.textContent=record.nama;options.push(option);
    }
    const select=byId('worker-choice');select.replaceChildren();const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Pilih mitra';select.append(placeholder,...options);
    byId('owner-selection').hidden=false;status(options.length?'Pilih mitra untuk melihat hasil kerja dan upahnya.':'Direktori mitra belum diterbitkan.');
    select.addEventListener('change',()=>{if(!select.value){if(unsubscribe)unsubscribe();++selection;clear();return;}subscribe(select.value);});
  }
  document.addEventListener('DOMContentLoaded',async()=>{
    const observer=new MutationObserver(()=>{if(document.documentElement.hasAttribute('data-soldier-locked')){if(unsubscribe)unsubscribe();++selection;clear();byId('owner-selection').hidden=true;byId('worker-choice').replaceChildren();}});
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-soldier-locked']});
    for(const id of ['date-from','date-to'])byId(id).addEventListener('change',render);
    window.addEventListener('pagehide',()=>{if(unsubscribe)unsubscribe();clear();observer.disconnect();});
    const cfg=window.SoldierAccess.findConfig();if(!cfg){status('Owner belum mengatur koneksi aplikasi pada perangkat ini.');return;}
    try{
      context=await window.SoldierAccess.connect(cfg,'earnings',{pending:()=>false});
      if(context.profile.owner===true)await ownerPicker();else subscribe();
    }catch{clear();status('Masuk dengan akun yang didaftarkan owner. Rincian upah belum bisa ditampilkan.');}
  },{once:true});
})();
