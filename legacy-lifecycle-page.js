/* SOURCE OFF. Scoped form UI; all validation, authority and wages stay on server. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SoldierLegacyLifecyclePage=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const TITLES=Object.freeze({appendJahit:'Tambah laporan',editJahit:'Ubah laporan',deleteJahit:'Hapus laporan',appendCount:'Hitung barang',editCount:'Ubah hitungan',deleteCount:'Hapus hitungan',inspectCount:'Periksa barang',inspectCounts:'Gabungkan pemeriksaan',editQC:'Ubah hasil QC',editQCGroup:'Ubah QC gabungan',repairQC:'Selesai perbaikan'});
  const MESSAGES=Object.freeze({access_denied:'Akses akun sudah berakhir. Masuk kembali atau hubungi owner.',unavailable:'Sambungan belum tersedia. Catatan yang menunggu tetap dipertahankan.',not_ready:'Pilih pekerjaan yang tersedia terlebih dahulu.',invalid_request:'Periksa tanggal, jumlah, dan pilihan catatan.',busy:'Tunggu penyimpanan yang sedang berjalan.',conflict:'Data sudah berubah atau jumlah belum sesuai. Muat ulang sebelum mengisi kembali.',capacity_limit:'Penyimpanan perlu diperiksa bersama owner. Catatan yang menunggu tetap dipertahankan.',rate_limited:'Batas penggunaan sementara tercapai. Catatan yang menunggu tetap dipertahankan.',result_unknown:'Status penyimpanan belum pasti. Gunakan tombol Periksa catatan pada daftar yang menunggu.',pending_review:'Ada catatan untuk produk ini yang belum dipastikan. Periksa catatan tersebut terlebih dahulu.',service_disabled:'Halaman ini belum diaktifkan.'});
  const count=v=>new Intl.NumberFormat('id-ID').format(v);
  const money=v=>typeof v==='number'?new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:2}).format(v):'Belum diisi';
  function today(){const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(k=>p.find(x=>x.type===k).value).join('-');}
  function createLegacyLifecyclePage(options={}){
    let enabled=false;try{const d=Object.getOwnPropertyDescriptor(options,'enabled');enabled=!!d&&d.enumerable&&Object.hasOwn(d,'value')&&d.value===true;}catch{}
    if(!enabled)return Object.freeze({connect:async()=>({ok:false,error:'service_disabled'}),dispose(){}});
    const root=options.rootElement,doc=root?.ownerDocument;
    if(!doc||typeof doc.createElement!=='function'||typeof options.createController!=='function'||typeof options.onSignOut!=='function')return Object.freeze({connect:async()=>({ok:false,error:'unavailable'}),dispose(){}});
    let controller=null,current=null,stopped=false,kind=null,notice='',listPage=0,formKey='',draft={},deleteConfirm=false,dirty=false,discardConfirm=false,revisionStatus=null,revisionNotice=null;
    function resumeRevision(){if(!stopped&&typeof options.onAutoRefreshReady==='function')try{options.onAutoRefreshReady();}catch{}}
    function canAutoRefresh(){return !stopped&&current?.phase==='ready'&&!current.busy&&!dirty&&!current.pending.length;}
    async function refresh(){if(!canAutoRefresh())return {ok:false,error:'busy'};const ownFinanceLoaded=current.binding.division==='jahit'&&current.finance!==null,result=await controller.refresh();if(result.ok&&canAutoRefresh()&&ownFinanceLoaded)return controller.refreshFinance();return result;}
    function revisionMessage(){
      if(!revisionNotice)return;revisionNotice.replaceChildren();
      const state=revisionStatus;if(!state||!state.pending&&!state.error&&!state.blocked){revisionNotice.hidden=true;return;}revisionNotice.hidden=false;
      revisionNotice.append(el('p',state.error?'Pembaruan otomatis belum tersedia. Gunakan Muat ulang pekerjaan.':dirty?'Data baru tersedia. Selesaikan isian ini sebelum memperbarui.':current?.pending?.length?'Data baru tersedia. Periksa catatan yang menunggu terlebih dahulu.':state.busy?'Memperbarui pekerjaan…':'Data baru tersedia; pekerjaan akan diperbarui saat siap.'));
      if(dirty&&state.pending)revisionNotice.append(button(discardConfirm?'Ya, batalkan isian yang belum disimpan':'Batalkan isian dan muat data baru',()=>{if(!discardConfirm){discardConfirm=true;revisionMessage();return;}dirty=false;discardConfirm=false;formKey='';draft={};deleteConfirm=false;render();resumeRevision();},current?.busy===true));
    }
    function setRevisionStatus(state){if(stopped)return;revisionStatus=state;revisionMessage();}
    function changed(){dirty=true;discardConfirm=false;revisionMessage();}
    function el(tag,text,cls){const node=doc.createElement(tag);if(text!==undefined)node.textContent=String(text);if(cls)node.className=cls;return node;}
    function button(text,action,disabled=false,cls=''){const b=el('button',text,cls);b.type='button';b.disabled=disabled;b.addEventListener('click',action);return b;}
    function heading(text,parent){parent.append(el('h2',text));}
    function panel(title){const p=el('section',undefined,'soldier-life-panel');heading(title,p);return p;}
    function row(label,value){const r=el('div',undefined,'soldier-life-row');r.append(el('span',label),el('strong',value));return r;}
    function table(parent,headers,records,map){
      if(!records.length){parent.append(el('p','Belum ada catatan.','soldier-life-muted'));return;}
      const wrap=el('div',undefined,'soldier-life-table-wrap'),t=el('table'),head=el('thead'),tr=el('tr');for(const h of headers)tr.append(el('th',h));head.append(tr);t.append(head);const body=el('tbody');
      for(const value of records.slice(0,100)){const r=el('tr');for(const cell of map(value))r.append(el('td',cell));body.append(r);}t.append(body);wrap.append(t);parent.append(wrap);
      if(records.length>100)parent.append(el('p','Menampilkan 100 catatan pertama. Catatan lengkap tetap tersimpan.','soldier-life-muted'));
    }
    function selectedProduct(){return current?.view?.products.find(p=>p.productId===current.productId);}
    function labelProduct(p){return [p.series,p.namaBarang,p.size].filter(Boolean).join(' · ');}
    function status(parent){
      const box=el('div',undefined,'soldier-life-status');box.setAttribute('role','status');box.setAttribute('aria-live','polite');
      box.append(el('strong',current?.busy?'Sedang memproses…':current?.phase==='ready'?'Terhubung':current?.phase==='loading'?'Menghubungkan…':'Belum terhubung'));
      const text=current?.error?MESSAGES[current.error]||MESSAGES.unavailable:notice;if(text)box.append(el('p',text));parent.append(box);
    }
    function pending(parent){
      if(!current.pending.length)return;const p=panel('Catatan menunggu kepastian');
      p.append(el('p','Periksa catatan yang sama sebelum membuat laporan pengganti.'));
      for(const command of current.pending.slice(0,30)){const product=current.view.products.find(v=>v.productId===command.productId),r=el('div',undefined,'soldier-life-pending');r.append(el('span',(TITLES[command.kind]||'Catatan')+' · '+(product?labelProduct(product):'Produk')));
        r.append(button('Periksa catatan',async()=>{notice='';const result=await controller.retry(command.requestId);if(result.ok)notice='Catatan sudah dipastikan tersimpan.';else notice=MESSAGES[result.error]||MESSAGES.unavailable;render();resumeRevision();},current.busy));p.append(r);}
      if(current.pending.length>30)p.append(el('p','Catatan lain akan muncul setelah catatan di atas dipastikan.'));parent.append(p);
    }
    function products(parent){
      const p=panel(current.binding.division==='jahit'?'Pekerjaan saya':'Daftar pekerjaan QC'),all=current.view.products,start=listPage*50;
      if(start>=all.length)listPage=0;const visible=all.slice(listPage*50,listPage*50+50);
      if(!all.length)p.append(el('p','Belum ada pekerjaan yang tersedia untuk akun ini.'));
      const cards=el('div',undefined,'soldier-life-products');for(const product of visible){const b=button(labelProduct(product),()=>{formKey='';draft={};dirty=false;notice='';deleteConfirm=false;controller.selectProduct(product.productId);resumeRevision();},current.busy,'soldier-life-product'+(product.productId===current.productId?' selected':''));
        if(current.binding.division==='jahit')b.append(el('small','Sisa tugas: '+count(product.assignments.reduce((n,a)=>n+a.remaining,0))));else b.append(el('small',product.needsReview?'Perlu pemeriksaan owner':product.readyForQC?'Siap diperiksa':'Menunggu hitungan lengkap'));cards.append(b);}p.append(cards);
      if(all.length>50){const nav=el('div',undefined,'soldier-life-actions');nav.append(button('Sebelumnya',()=>{listPage--;render();},current.busy||listPage===0),el('span','Halaman '+(listPage+1)),button('Berikutnya',()=>{listPage++;render();},current.busy||(listPage+1)*50>=all.length));p.append(nav);}parent.append(p);
    }
    function operations(parent,p){
      const box=panel(labelProduct(p));
      if(current.binding.division==='jahit'){
        table(box,['Tugas','Ditugaskan','Baik','Reject','Sisa'],p.assignments,a=>['Tugas '+(p.assignments.indexOf(a)+1),count(a.assigned),count(a.reportedGood),count(a.reportedReject),count(a.remaining)]);
        table(box,['Tanggal','Baik','Reject','Selesai'],p.reports,r=>[r.workDate,count(r.good),count(r.reject),count(r.completed)]);
        if(p.hasUnlistedLegacy)box.append(el('p','Ada catatan lama yang perlu dicocokkan oleh owner.'));
      }else{
        box.append(row('Jumlah PO',p.poQuantity===null?'Belum diisi':count(p.poQuantity)),row('Sisa belum dihitung',count(p.remainingPO)));
        table(box,['Mitra','Selesai jahit','Sudah dihitung','Belum dihitung'],p.groups,g=>[g.name,count(g.sewn),count(g.counted),count(g.pendingCount)]);
        table(box,['Tanggal','Mitra','Hitungan','Pemeriksaan'],p.counts,h=>[h.workDate,h.workerName,count(h.quantity),h.cancelled?'Dibatalkan':h.qcId?'Sudah QC':'Menunggu QC']);
        table(box,['Tanggal','Mitra','OK','Perbaikan','Reject','Offline','Catatan'],p.inspections,q=>[q.workDate,p.groups.find(g=>g.workerId===q.workerId)?.name||'Mitra',count(q.totals.ok),count(q.totals.perbaikan),count(q.totals.reject),count(q.totals.offline),q.note]);
        if(p.needsReview)box.append(el('p','Owner perlu memeriksa catatan produk ini sebelum perubahan dilakukan.','soldier-life-warning'));
      }
      parent.append(box);
    }
    function form(parent,p){
      const allowed=current.binding.division==='jahit'?['appendJahit','editJahit','deleteJahit']:['appendCount','editCount','deleteCount','inspectCount','inspectCounts','editQC','editQCGroup','repairQC'];
      if(!allowed.includes(kind))kind=allowed[0];const key=p.productId+'|'+kind;
      if(formKey!==key){formKey=key;draft={workDate:today(),good:1,reject:0,quantity:1,totals:{ok:1,perbaikan:0,reject:0,offline:0},note:''};deleteConfirm=false;dirty=false;}
      const box=panel('Catat pekerjaan'),tabs=el('div',undefined,'soldier-life-actions');for(const k of allowed)tabs.append(button(TITLES[k],()=>{kind=k;formKey='';dirty=false;notice='';render();resumeRevision();},current.busy,'soldier-life-mode'+(kind===k?' selected':'')));box.append(tabs);
      const f=el('form');f.setAttribute('aria-label',TITLES[kind]);const values={};let choiceAvailable=true;
      function field(name,label,type='text',value='',extra={}){
        const wrap=el('label',undefined,'soldier-life-field');wrap.append(el('span',label));const input=el(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.name=name;input.value=String(draft[name]??value);input.required=name!=='note';input.disabled=current.busy;
        for(const [k,v]of Object.entries(extra))input.setAttribute(k,String(v));input.addEventListener('input',()=>{draft[name]=input.value;deleteConfirm=false;changed();});wrap.append(input);f.append(wrap);values[name]=()=>type==='number'?(input.value===''?null:Number(input.value)):input.value;return input;
      }
      function select(name,label,items,onChange){
        const wrap=el('label',undefined,'soldier-life-field');wrap.append(el('span',label));const input=el('select');input.name=name;input.required=true;input.disabled=current.busy;
        if(!items.length){input.append(el('option','Belum ada catatan yang dapat dipilih'));choiceAvailable=false;input.disabled=true;}
        for(const item of items){const o=el('option',item.label);o.value=item.value;input.append(o);}if(items.some(i=>i.value===draft[name]))input.value=draft[name];
        draft[name]=input.value;input.addEventListener('change',()=>{draft[name]=input.value;deleteConfirm=false;changed();if(onChange)onChange(input.value);render();});wrap.append(input);f.append(wrap);values[name]=()=>input.value;return input;
      }
      function choices(name,label,items){
        const set=el('fieldset');set.append(el('legend',label));const selected=new Set(draft[name]||[]),inputs=[];
        for(const item of items){const line=el('label',undefined,'soldier-life-check'),input=el('input');input.type='checkbox';input.value=item.value;input.checked=selected.has(item.value);input.disabled=current.busy;input.addEventListener('change',()=>{draft[name]=inputs.filter(x=>x.checked).map(x=>x.value);deleteConfirm=false;changed();});inputs.push(input);line.append(input,el('span',item.label));set.append(line);}
        if(!items.length){set.append(el('p','Belum ada hitungan yang menunggu QC.'));choiceAvailable=false;}f.append(set);values[name]=()=>inputs.filter(x=>x.checked).map(x=>x.value);
      }
      function dateField(){field('workDate','Tanggal pekerjaan','date',today());}
      function quantities(){field('good','Baik','number',1,{min:0,step:1});field('reject','Reject','number',0,{min:0,step:1});}
      function qcTotals(){const wrap=el('fieldset');wrap.append(el('legend','Hasil pemeriksaan'));for(const [k,label]of Object.entries({ok:'OK',perbaikan:'Perbaikan',reject:'Reject',offline:'Offline'})){const line=el('label',undefined,'soldier-life-field'),input=el('input');line.append(el('span',label));input.type='number';input.name='totals.'+k;input.min='0';input.step='1';input.required=true;input.disabled=current.busy;input.value=String(draft.totals?.[k]??0);input.addEventListener('input',()=>{draft.totals={...draft.totals,[k]:input.value};changed();});line.append(input);wrap.append(line);}f.append(wrap);values.totals=()=>Object.fromEntries([...wrap.querySelectorAll('input')].map(x=>[x.name.slice(7),x.value===''?null:Number(x.value)]));field('note','Catatan','textarea','',{maxlength:512});}
      if(kind==='appendJahit'){
        select('assignmentId','Tugas',p.assignments.filter(a=>a.remaining>0).map((a,i)=>({value:a.assignmentId,label:'Tugas '+(i+1)+' · sisa '+count(a.remaining)})));dateField();quantities();
      }else if(['editJahit','deleteJahit'].includes(kind)){
        const change=id=>{const r=p.reports.find(r=>r.operationId===id);if(r)Object.assign(draft,{workDate:r.workDate,good:r.good,reject:r.reject});};
        if(!draft.operationId){const r=p.reports[0];if(r){draft.operationId=r.operationId;change(r.operationId);}}
        select('operationId','Laporan',p.reports.map(r=>({value:r.operationId,label:r.workDate+' · baik '+count(r.good)+' · reject '+count(r.reject)})),change);
        if(kind==='editJahit'){dateField();quantities();}
      }else if(kind==='appendCount'){
        select('workerId','Mitra jahit',p.groups.filter(g=>g.pendingCount>0).map(g=>({value:g.workerId,label:g.name+' · belum dihitung '+count(g.pendingCount)})));dateField();field('quantity','Jumlah dihitung','number',1,{min:1,step:1});
      }else if(['editCount','deleteCount'].includes(kind)){
        const counts=p.counts.filter(h=>!h.cancelled),change=id=>{const h=counts.find(h=>h.countId===id);if(h)Object.assign(draft,{workDate:h.workDate,quantity:h.quantity});};
        if(!draft.operationId&&counts[0]){draft.operationId=counts[0].countId;change(counts[0].countId);}
        select('operationId','Hitungan',counts.map(h=>({value:h.countId,label:h.workDate+' · '+h.workerName+' · '+count(h.quantity)})),change);
        if(kind==='editCount'){dateField();field('quantity','Jumlah dihitung','number',1,{min:1,step:1});}
      }else if(['inspectCount','inspectCounts'].includes(kind)){
        const counts=p.counts.filter(h=>!h.cancelled&&h.qcId===null);
        if(kind==='inspectCount')select('countId','Hitungan',counts.map(h=>({value:h.countId,label:h.workDate+' · '+h.workerName+' · '+count(h.quantity)})));
        else{f.append(el('p','Pilih hitungan dari satu mitra untuk digabungkan.'));choices('countIds','Hitungan yang diperiksa',counts.map(h=>({value:h.countId,label:h.workDate+' · '+h.workerName+' · '+count(h.quantity)})));}
        dateField();qcTotals();if(!p.readyForQC){choiceAvailable=false;f.append(el('p','Pemeriksaan tersedia setelah hitungan seluruh PO lengkap.','soldier-life-warning'));}
      }else if(kind==='editQCGroup'){
        const batches=[...new Set(p.inspections.map(q=>q.batchId).filter(Boolean))],change=id=>{const rows=p.inspections.filter(q=>q.batchId===id);draft.totals=Object.fromEntries(['ok','perbaikan','reject','offline'].map(k=>[k,rows.reduce((n,q)=>n+q.totals[k],0)]));};
        if(!draft.operationId&&batches[0]){draft.operationId=batches[0];change(batches[0]);}
        select('operationId','Kelompok pemeriksaan',batches.map((id,i)=>({value:id,label:'Kelompok '+(i+1)+' · '+count(p.inspections.filter(q=>q.batchId===id).reduce((n,q)=>n+Object.values(q.totals).reduce((a,b)=>a+b,0),0))+' barang'})),change);
        qcTotals();values.qcIds=()=>p.inspections.filter(q=>q.batchId===values.operationId()).map(q=>q.operationId);
      }else{
        const qs=p.inspections.filter(q=>kind!=='repairQC'||q.totals.perbaikan>0),change=id=>{const q=qs.find(q=>q.operationId===id);if(q)Object.assign(draft,{workDate:kind==='repairQC'?today():q.workDate,totals:{...q.totals},note:q.note});};
        if(!draft.operationId&&qs[0]){draft.operationId=qs[0].operationId;change(qs[0].operationId);}
        select('operationId','Pemeriksaan',qs.map(q=>({value:q.operationId,label:q.workDate+' · '+(p.groups.find(g=>g.workerId===q.workerId)?.name||'Mitra')+' · OK '+count(q.totals.ok)+' · perbaikan '+count(q.totals.perbaikan)})),change);dateField();
        if(kind==='repairQC')field('quantity','Selesai diperbaiki','number',1,{min:1,step:1});else qcTotals();
      }
      const deleting=kind==='deleteJahit'||kind==='deleteCount';if(deleting)f.append(el('p',kind==='deleteCount'?'Penghapusan hitungan juga memeriksa hasil QC dan stok yang terkait. Catatan yang sudah dibayar atau memiliki pekerjaan lanjutan akan dikunci server.':'Server memeriksa status pembayaran dan pekerjaan lanjutan sebelum menghapus laporan.','soldier-life-warning'));
      if(deleteConfirm)f.append(el('p','Pastikan catatan yang dipilih benar. Tekan sekali lagi untuk meminta penghapusan.','soldier-life-warning'));
      const submit=el('button',deleteConfirm?'Ya, hapus catatan':deleting?'Hapus catatan':'Simpan catatan','soldier-life-primary');submit.type='submit';submit.disabled=current.busy||!choiceAvailable||p.needsReview===true||current.pending.some(command=>command.productId===p.productId);f.append(submit);
      f.addEventListener('submit',async event=>{event.preventDefault();if(current.busy||!choiceAvailable)return;if(deleting&&!deleteConfirm){deleteConfirm=true;changed();render();return;}const payload=Object.fromEntries(Object.entries(values).map(([k,fn])=>[k,fn()]));notice='';const result=await controller.submit(kind,payload);if(result.ok){notice='Catatan sudah dipastikan tersimpan.';formKey='';draft={};dirty=false;discardConfirm=false;deleteConfirm=false;}else notice=MESSAGES[result.error]||MESSAGES.unavailable;render();resumeRevision();});
      box.append(f);parent.append(box);
    }
    function finance(parent){
      if(current.binding.division!=='jahit')return;const box=panel('Upah saya');box.append(button('Muat upah saya',async()=>{notice='';const result=await controller.refreshFinance();if(!result.ok)notice=MESSAGES[result.error]||MESSAGES.unavailable;render();},current.busy));
      const v=current.finance;if(!v){box.append(el('p','Tekan tombol di atas untuk mengambil catatan upah terbaru.','soldier-life-muted'));parent.append(box);return;}
      box.append(el('p','Catatan lama dan hasil hitungan/QC ditampilkan terpisah. Owner memeriksa pembayaran dan catatan yang masih perlu dicocokkan.'));
      heading('Catatan upah lama',box);table(box,['Produk','Tanggal','Jumlah','Tarif','Total tersimpan','Catatan bayar'],v.storedJahit.records,r=>[labelProduct(r.product),r.stored.tanggal||'—',r.stored.jumlah===null||r.stored.jumlah===undefined?'Belum diisi':count(r.stored.jumlah),money(r.stored.tarif),money(r.stored.total),[true,1,'true'].includes(r.stored.dibayar)?'Ditandai dibayar':'Belum ditandai dibayar']);
      heading('Upah hitungan dan QC',box);if(v.slip.entries===null)box.append(el('p','Catatan ini masih perlu diperiksa owner.'));else table(box,['Produk','Tanggal','Jumlah','Tarif','Upah','Tahap'],v.slip.entries,r=>[labelProduct(r.product),r.tanggal,count(r.jumlah),money(r.tarif),money(r.total),r.provisional?'Sementara · menunggu QC':r.sourceType==='qcRepair'?'Selesai perbaikan':'Hasil QC']);
      heading('Kasbon saya',box);table(box,['Tanggal','Jumlah','Sisa tersimpan','Status','Keterangan'],v.kasbon.records,r=>[r.stored.tanggal||'—',money(r.stored.jumlah),money(r.stored.sisa),r.stored.status||'—',r.stored.keterangan||'']);parent.append(box);
    }
    function render(){
      if(stopped)return;root.replaceChildren();const layout=el('main',undefined,'soldier-life-shell'),head=el('header',undefined,'soldier-life-header');head.append(el('p','SOLDIER APPAREL','soldier-life-brand'),el('h1',current?.binding?.division==='qc'?'QC & inspeksi':current?.binding?.division==='jahit'?'Pekerjaan jahit':'Masuk ke pekerjaan'));
      if(current?.view?.workerLabel)head.append(el('p',current.view.workerLabel));head.append(button('Keluar',()=>{controller?.dispose();options.onSignOut();},current?.busy===true));layout.append(head);status(layout);
      revisionNotice=el('section',undefined,'soldier-life-status');revisionNotice.setAttribute('aria-live','polite');layout.append(revisionNotice);
      if(current?.phase==='ready'){const tools=el('div',undefined,'soldier-life-actions');tools.append(button('Muat ulang pekerjaan',()=>controller.refresh(),current.busy));layout.append(tools);pending(layout);products(layout);const p=selectedProduct();if(p){operations(layout,p);form(layout,p);}finance(layout);}
      root.append(layout);revisionMessage();
    }
    try{controller=options.createController({onState:state=>{if(stopped)return;current=state;if(state.phase==='blocked'){draft={};dirty=false;formKey='';notice='';kind=null;deleteConfirm=false;}render();resumeRevision();}});}catch{return Object.freeze({connect:async()=>({ok:false,error:'unavailable'}),dispose(){root.replaceChildren();}});}
    render();return Object.freeze({connect:()=>controller.connect(),canAutoRefresh,refresh,setRevisionStatus,dispose(){if(stopped)return;stopped=true;try{controller.dispose();}catch{}current=null;draft={};dirty=false;revisionStatus=null;revisionNotice=null;root.replaceChildren();}});
  }
  return Object.freeze({createLegacyLifecyclePage});
});
