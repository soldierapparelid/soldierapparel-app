/* Choose an existing ledger name. Suggestions never merge historical records. */
(function(){
  'use strict';
  const el=id=>document.getElementById(id),key=value=>String(value||'').trim().toLowerCase();
  let mode='existing',selected='',newName='',newUnit='kg';
  function names(){return allJenisBahan(true);}
  function exact(value){return names().find(name=>key(name)===key(value));}
  function distance(a,b){
    let row=Array.from({length:b.length+1},(_,i)=>i);
    for(let i=0;i<a.length;i++){const next=[i+1];for(let j=0;j<b.length;j++)next.push(Math.min(next[j]+1,row[j+1]+1,row[j]+(a[i]===b[j]?0:1)));row=next;}return row[b.length];
  }
  function similar(value){
    const query=key(value).replace(/\s+/g,' ');if(query.length<4)return [];
    return names().filter(name=>{const candidate=key(name).replace(/\s+/g,' ');return Math.abs(candidate.length-query.length)<=2&&distance(query,candidate)<=2;}).slice(0,5);
  }
  function renderOptions(){
    const query=key(el('pbMaterialSearch').value),choices=names().filter(name=>name===selected||key(name).includes(query));
    el('pbExistingMaterial').innerHTML='<option value="">Pilih bahan yang sudah ada…</option>'+choices.map(name=>'<option value="'+esc(name)+'">'+esc(name)+' · '+unitShort(getBahanUnit(name))+'</option>').join('');
    el('pbExistingMaterial').value=selected;
    el('pbMaterialEmpty').textContent=choices.length?'':names().length?'Tidak ditemukan. Coba ejaan lain, atau pilih “Bahan baru” jika memang berbeda.':'Belum ada bahan. Pilih “Bahan baru” untuk pembelian pertama.';
  }
  function render(){
    if(mode==='new'){newName=el('pbJenis').value;newUnit=el('pbUnit').value||'kg';}
    if(selected)selected=exact(selected)||'';
    el('pbExistingFields').hidden=mode!=='existing';el('pbNewFields').hidden=mode!=='new';
    el('pbChooseExisting').setAttribute('aria-pressed',String(mode==='existing'));el('pbChooseNew').setAttribute('aria-pressed',String(mode==='new'));
    if(mode==='existing')el('pbJenis').value=selected;
    const match=exact(el('pbJenis').value);
    const unitConflict=!!match&&el('pbUnit').value!==getBahanUnit(match);
    el('pbUnit').disabled=mode==='existing'||!!match;
    renderOptions();
    const suggestions=unitConflict?[match]:mode==='new'&&!match?similar(newName):[];
    el('pbMaterialHint').textContent=unitConflict?'Satuan bahan di pusat adalah '+unitShort(getBahanUnit(match))+', berbeda dari isian ini. Pilih kembali bahan, lalu periksa jumlah rol sebelum menyimpan.':match?'Pembelian ditambahkan ke '+match+'. Rol lama dan riwayat tetap tersimpan.':mode==='new'?'Nama baru membuat daftar stok terpisah. Untuk menambah stok lama, pilih bahan yang sudah ada.':'Pilih nama bahan sekali, lalu isi rol pembelian. Tidak perlu mengetik ulang nama.';
    el('pbMaterialSuggestions').innerHTML=suggestions.length?'<p>'+(unitConflict?'Pilih ulang satuan bahan terbaru, lalu periksa jumlah rol.':'Sudah ada nama yang mirip. Apakah salah satunya bahan yang dimaksud?')+'</p>'+suggestions.map(name=>'<button type="button" class="sec" data-existing-material="'+esc(name)+'">Pakai '+esc(name)+(unitConflict?' · '+unitShort(getBahanUnit(name)):'')+'</button>').join(''):'';
  }
  function choose(value){
    const name=exact(value);if(!name)throw new Error('Bahan sudah berubah. Pilih lagi dari daftar.');
    if(mode==='new'){newName=el('pbJenis').value;newUnit=el('pbUnit').value||'kg';}
    mode='existing';selected=name;el('pbUnit').value=getBahanUnit(name);el('pbMaterialSearch').value='';render();updateRolPreview();
  }
  function setMode(value){
    if(mode==='new'){newName=el('pbJenis').value;newUnit=el('pbUnit').value||'kg';}
    mode=value==='new'?'new':'existing';el('pbJenis').value=mode==='new'?newName:selected;
    el('pbUnit').value=mode==='new'?newUnit:selected?getBahanUnit(selected):'kg';render();updateRolPreview();
  }
  function resolve(){
    const value=mode==='existing'?selected:el('pbJenis').value.trim(),match=exact(value);
    if(mode==='existing'&&!match)throw new Error('Pilih bahan yang sudah ada, atau tekan “Bahan baru” untuk membuat nama baru.');
    if(!value)throw new Error('Isi nama bahan baru.');
    if(match&&el('pbUnit').value!==getBahanUnit(match))throw new Error('Satuan bahan berubah atau tidak sesuai. Pilih kembali bahan, lalu periksa jumlah rol sebelum menyimpan.');
    return {name:match||value,isNew:!match,similar:match?[]:similar(value)};
  }
  el('pbChooseExisting').addEventListener('click',()=>setMode('existing'));
  el('pbChooseNew').addEventListener('click',()=>setMode('new'));
  el('pbMaterialSearch').addEventListener('input',renderOptions);
  el('pbExistingMaterial').addEventListener('change',()=>{const value=el('pbExistingMaterial').value;if(value)choose(value);else{selected='';render();updateRolPreview();}});
  el('pbJenis').addEventListener('input',()=>{render();updateRolPreview();});
  el('pbMaterialSuggestions').addEventListener('click',event=>{const button=event.target.closest('[data-existing-material]');if(button)choose(button.dataset.existingMaterial);});
  window.StockPurchaseMaterial={render,choose,setMode,resolve};
  if(window.appReady)window.appReady.then(()=>{render();updateRolPreview();}).catch(()=>{});
})();
