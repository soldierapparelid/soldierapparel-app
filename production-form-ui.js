/* Canonical production forms. No legacy storage, payroll lookup or SDK calls. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?()=>require('./production-form-controller.js'):()=>root.SoldierProductionFormController);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.SoldierProductionFormUI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(getController){
  'use strict';
  const messages={access_denied:'Akses akun berubah. Masuk kembali sebelum melanjutkan.',conflict:'Data pusat berubah. Periksa catatan dan draf sebelum melanjutkan.',capacity_limit:'Penyimpanan draf penuh. Hubungi owner; draf tetap dipertahankan.',result_unknown:'Hasil simpan belum pasti. Coba kembali draf yang sama di bawah.',pending_review:'Periksa draf yang belum pasti tersimpan sebelum mencatat pekerjaan baru.',unavailable:'Belum dapat menyimpan. Periksa draf tersimpan lalu coba kembali draf yang sama.',busy:'Proses sebelumnya belum selesai.',not_ready:'Pilih produk dan tugas setelah akses diperiksa.',service_disabled:'Jalur aman ini belum diaktifkan.',invalid_request:'Periksa pilihan, tanggal, dan jumlah yang dimasukkan.',invalid_input:'Pilih catatan yang benar dan isi jumlah bilangan bulat. Kolom kosong belum boleh dikirim.'};
  const safeId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
  const codeMessage=code=>messages[code]||'Akses aman belum siap. Data belum dikirim.';
  function endpoint(v){try{const u=new URL(v);return typeof v==='string'&&u.href===v&&u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/v1/production/commands';}catch{return false;}}
  function date(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!v.startsWith('0000')&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;}
  function today(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),part=kind=>parts.find(p=>p.type===kind).value;return part('year')+'-'+part('month')+'-'+part('day');}
  function number(v,positive=false){if(typeof v!=='string'||! /^(0|[1-9][0-9]*)$/.test(v))throw Error();const n=Number(v);if(!Number.isSafeInteger(n)||n<(positive?1:0))throw Error();return n;}
  function mount(options={}){
    const {document,host,module:moduleName,createBridge,isCurrent,endpointURL}=options;
    if(!document||!host||!['jahit','qc'].includes(moduleName)||typeof createBridge!=='function'||typeof isCurrent!=='function'||!endpoint(endpointURL))return Object.freeze({ready:Promise.resolve(Object.freeze({ok:false,error:'unavailable'})),dispose(){}});
    let controller,state={phase:'loading',cycles:[],pending:[],selectedCycle:null,busy:false},disposed=false,working=false,selectedKey='',batch=[];
    const controls=[],forms=[],selects={},inputs={},buttons={};
    const root=document.createElement('section');root.className='production-canonical';
    function node(tag,text,parent=root){const value=document.createElement(tag);if(text!==undefined)value.textContent=String(text);if(parent)parent.appendChild(value);return value;}
    function current(){if(disposed)return false;try{if(isCurrent()===true)return true;}catch{}dispose();return false;}
    function note(code){status.textContent=codeMessage(code);status.setAttribute('role','alert');}
    function addControl(value){controls.push(value);return value;}
    function select(id,label,parent){const field=node('label',undefined,parent);node('span',label,field);const s=addControl(node('select',undefined,field));s.id=id;selects[id]=s;return s;}
    function input(id,label,type,parent,value=''){const field=node('label',undefined,parent);node('span',label,field);const i=addControl(node('input',undefined,field));i.id=id;i.type=type;i.value=value;if(type==='number'){i.min='0';i.step='1';i.inputMode='numeric';}inputs[id]=i;return i;}
    function button(id,label,parent,fn){const b=addControl(node('button',label,parent));b.id=id;b.type='button';buttons[id]=b;b.addEventListener('click',()=>{if(current())fn();});return b;}
    function form(title){const f=node('fieldset');node('legend',title,f);forms.push(f);return f;}
    function optionsFor(s,rows,label,placeholder='Pilih terlebih dahulu'){const previous=s.value;s.replaceChildren();const first=node('option',placeholder,s);first.value='';for(const row of rows){const option=node('option',label(row),s);option.value=row.value;}s.value=rows.some(row=>row.value===previous)?previous:'';}
    function cycle(){return state.cycles.find(c=>state.selectedCycle&&c.productId===state.selectedCycle.productId&&c.cycleId===state.selectedCycle.cycleId)||null;}
    function collection(field){return cycle()?.operations?.[field]||[];}
    function label(workerId){return cycle()?.workerLabels?.find(row=>row.workerId===workerId)?.label||'Mitra '+workerId;}
    function assignmentRows(){return collection('assignJahit').filter(row=>moduleName==='qc'||state.profile?.owner===true||row.tukangId===state.profile?.workerId);}
    function choice(id,rows){const value=selects[id].value;if(!safeId(value)||!rows.some(row=>row.id===value))throw Error();return value;}
    function workDate(id){const value=inputs[id].value;if(!date(value))throw Error();return value;}
    function hasPending(){const c=cycle();return !!c&&state.pending.some(p=>p.productId===c.productId&&p.cycleId===c.cycleId);}
    function canSubmit(){return current()&&state.phase==='ready'&&!state.busy&&!working&&!!cycle()&&!hasPending();}
    function enabled(){const writable=canSubmit();for(const f of forms)f.disabled=!writable;cycleSelect.disabled=working||state.busy||state.phase!=='ready';refreshButton.disabled=working||state.busy||state.phase!=='ready';}
    function clearForm(){for(const [id,i]of Object.entries(inputs)){if(i.type==='date')i.value=today();else if(i.type==='checkbox')i.checked=false;else i.value=['sewing-reject','inspect-perbaikan','inspect-reject','inspect-offline'].includes(id)?'0':'';}for(const [id,s]of Object.entries(selects))if(id!=='production-cycle')s.value='';batch=[];renderBatch();}
    function displayResult(result){if(result?.ok===true){status.textContent='Tersimpan melalui layanan pusat.';status.removeAttribute('role');}else note(result?.error);}
    async function perform(action,accepted){
      if(!current()||working)return;working=true;enabled();const key=selectedKey;
      try{const result=await action();if(!current())return;displayResult(result);if(result?.ok===true&&accepted&&key===selectedKey)accepted();}catch{if(current())note('unavailable');}
      finally{working=false;if(current()){renderPending();enabled();}}
    }
    function submit(kind,read,accepted=clearForm){if(!canSubmit()){note(hasPending()?'result_unknown':'busy');return;}let payload;try{payload=read();}catch{note('invalid_input');return;}perform(()=>controller.submit(kind,payload),accepted);}
    const heading=node('h1',moduleName==='jahit'?'Jahit Soldier':'QC & Inspeksi Soldier');heading.id='production-title';
    node('p','Gunakan akun sendiri. Draf yang belum pasti tersimpan dicoba kembali dengan catatan yang sama.');
    const status=node('p','Memeriksa akses…');status.id='production-status';status.setAttribute('aria-live','polite');
    const cycleSelect=select('production-cycle','Produk dan siklus produksi',root),summary=node('p');summary.id='production-summary';
    cycleSelect.addEventListener('change',()=>{
      if(!current()||working)return;let chosen;try{const ids=JSON.parse(cycleSelect.value);chosen=state.cycles.find(c=>Array.isArray(ids)&&ids.length===2&&c.productId===ids[0]&&c.cycleId===ids[1]);}catch{}
      if(!chosen){note('invalid_input');return;}perform(()=>controller.selectCycle(chosen.productId,chosen.cycleId));
    });
    const wage=node('section');wage.id='production-own-wage';wage.hidden=moduleName!=='jahit';
    const records=node('section');records.id='production-records';
    if(moduleName==='jahit'){
      const f=form('Catat hasil jahit');select('sewing-assignment','Tugas jahit',f);input('sewing-date','Tanggal kerja','date',f,today());input('sewing-good','Jumlah baik','number',f);input('sewing-reject','Jumlah rijek','number',f,'0');
      button('sewing-submit','Simpan hasil jahit',f,()=>submit('sewing',()=>{const good=number(inputs['sewing-good'].value),reject=number(inputs['sewing-reject'].value);if(!Number.isSafeInteger(good+reject)||good+reject<=0)throw Error();return {assignmentId:choice('sewing-assignment',assignmentRows()),tanggal:workDate('sewing-date'),good,reject};}));
    }else{
      const f=form('Hitung fisik');select('count-assignment','Tugas yang dihitung',f);input('count-date','Tanggal hitung','date',f,today());input('count-quantity','Jumlah fisik','number',f);button('count-submit','Simpan hitung fisik',f,()=>submit('count',()=>({assignmentId:choice('count-assignment',assignmentRows()),tanggal:workDate('count-date'),jumlah:number(inputs['count-quantity'].value,true)})));
      const q=form('Pemeriksaan QC');select('inspect-count','Catatan hitung fisik',q);input('inspect-date','Tanggal pemeriksaan','date',q,today());for(const [id,title]of [['ok','Baik'],['perbaikan','Perlu perbaikan'],['reject','Reject'],['offline','Offline']])input('inspect-'+id,title,'number',q,id==='ok'?'':'0');
      const queue=node('ul',undefined,q);queue.id='inspect-queue';
      function pendingCounts(){return collection('hitungFisik').filter(row=>!row.qcId);}
      function inspectEntry(){const hfId=choice('inspect-count',pendingCounts()),row=pendingCounts().find(r=>r.id===hfId),entry={hfId,tanggal:workDate('inspect-date')};let total=0;for(const key of ['ok','perbaikan','reject','offline']){entry[key]=number(inputs['inspect-'+key].value);total+=entry[key];if(!Number.isSafeInteger(total))throw Error();}if(total!==row.jumlah||entry.tanggal<row.tanggal)throw Error();return entry;}
      function resetInspect(){selects['inspect-count'].value='';inputs['inspect-ok'].value='';for(const key of ['perbaikan','reject','offline'])inputs['inspect-'+key].value='0';}
      function renderBatchLocal(){queue.replaceChildren();for(const entry of batch)node('li','Hitung '+entry.hfId+' · '+entry.tanggal+' · baik '+entry.ok+' · perbaikan '+entry.perbaikan+' · reject '+entry.reject+' · offline '+entry.offline,queue);}
      renderBatch=renderBatchLocal;
      button('inspect-add','Tambah ke pemeriksaan gabungan',q,()=>{if(!canSubmit()){note('busy');return;}try{const entry=inspectEntry();if(batch.length>=100||batch.some(e=>e.hfId===entry.hfId))throw Error();batch.push(Object.freeze(entry));resetInspect();renderBatch();}catch{note('invalid_input');}});
      button('inspect-reset','Kosongkan pilihan pemeriksaan',q,()=>{batch=[];resetInspect();renderBatch();});
      button('inspect-submit','Simpan pemeriksaan QC',q,()=>submit('inspect',()=>{const entries=batch.map(e=>({...e}));if(selects['inspect-count'].value)entries.push(inspectEntry());if(!entries.length||entries.length>100||new Set(entries.map(e=>e.hfId)).size!==entries.length)throw Error();let worker;for(const entry of entries){const row=pendingCounts().find(r=>r.id===entry.hfId);if(!row||entry.ok+entry.perbaikan+entry.reject+entry.offline!==row.jumlah||worker!==undefined&&row.tukangId!==worker)throw Error();worker=row.tukangId;}return {entries};}));
      const r=form('Hasil perbaikan');select('repair-qc','Catatan QC yang diperbaiki',r);input('repair-date','Tanggal perbaikan','date',r,today());input('repair-quantity','Jumlah selesai diperbaiki','number',r);button('repair-submit','Simpan hasil perbaikan',r,()=>submit('repair',()=>{const qcId=choice('repair-qc',collection('qc').filter(row=>row.perbaikan>0)),row=collection('qc').find(r=>r.id===qcId),jumlah=number(inputs['repair-quantity'].value,true),tanggal=workDate('repair-date');if(jumlah>row.perbaikan||tanggal<row.tanggal)throw Error();return {qcId,tanggal,jumlah};}));
    }
    function renderBatch(){}
    function cancelRows(){const types=moduleName==='jahit'?[['sewing','jahit']]:[['count','hitungFisik'],['inspect','qc'],['repair','repairs']];return types.flatMap(([type,field])=>collection(field).filter(row=>moduleName!=='jahit'||state.profile?.owner===true||row.tukangId===state.profile?.workerId).map(row=>({type,row,value:JSON.stringify([type,row.id])})));}
    const c=form('Batalkan catatan');select('cancel-target','Catatan yang akan dibatalkan',c);node('p','Pembatalan hitung fisik atau QC dapat membatalkan catatan turunannya. Periksa pilihan sebelum mengirim.',c);input('cancel-confirm','Saya sudah memeriksa dan menyetujui pembatalan','checkbox',c);
    selects['cancel-target'].addEventListener('change',()=>{inputs['cancel-confirm'].checked=false;});
    button('cancel-submit','Batalkan catatan terpilih',c,()=>submit('cancel',()=>{const chosen=cancelRows().find(row=>row.value===selects['cancel-target'].value);if(!chosen||inputs['cancel-confirm'].checked!==true)throw Error();return {targetType:chosen.type,targetId:chosen.row.id,confirmed:true};}));
    const pending=node('section');pending.id='production-pending';const refreshButton=button('production-refresh-pending','Periksa draf tersimpan',root,()=>perform(()=>controller.refreshPending()));
    function renderWage(){
      if(moduleName!=='jahit')return;wage.replaceChildren();node('h2','Tarif dan upah milik saya',wage);const model=cycle()?.wage;
      if(!model||state.profile?.owner===true||!safeId(state.profile?.workerId)||model.workerId!==state.profile.workerId||model.availability!=='available'||!Array.isArray(model.entries)){node('p','Upah belum tersedia untuk pilihan ini.',wage);return;}
      let sum=0;for(const entry of model.entries){sum+=entry.total;if(!Number.isSafeInteger(sum)||sum<0){node('p','Upah perlu diperiksa owner.',wage);return;}}
      const currency=value=>'Rp '+new Intl.NumberFormat('id-ID',{maximumFractionDigits:20}).format(value);
      node('p','Upah kotor tercatat: '+currency(sum),wage);node('p','Angka ini belum menunjukkan pembayaran atau potongan.',wage);const list=node('ul',undefined,wage);
      for(const entry of model.entries)node('li',entry.tanggal+' · '+entry.jumlah+' pcs × '+currency(entry.tarif)+' · total '+currency(entry.total)+(entry.provisional?' · menunggu QC':''),list);
    }
    function renderRecords(){records.replaceChildren();node('h2','Catatan produksi',records);const selected=cycle();if(!selected){node('p','Pilih produk dan siklus terlebih dahulu.',records);return;}const fields=moduleName==='jahit'?['jahit']:['hitungFisik','qc','repairs'];let count=0;for(const field of fields)for(const row of collection(field)){if(moduleName==='jahit'&&state.profile?.owner!==true&&row.tukangId!==state.profile?.workerId)continue;count++;const quantities=field==='qc'?'baik '+row.ok+' · perbaikan '+row.perbaikan+' · reject '+row.reject+' · offline '+row.offline:field==='jahit'?'baik '+row.lolos+' · rijek '+row.rijek:row.jumlah+' pcs';node('p',label(row.tukangId)+' · '+row.tanggal+' · '+quantities+' · catatan '+row.id,records);}if(!count)node('p','Belum ada catatan pada pilihan ini.',records);}
    function renderPending(){pending.replaceChildren();node('h2','Draf yang belum pasti tersimpan',pending);if(!state.pending.length){node('p','Tidak ada draf tertahan.',pending);return;}for(const command of state.pending){const row=node('div',undefined,pending);node('p',command.kind+' · '+command.productId+' · '+command.cycleId+' · draf '+command.requestId,row);const b=node('button','Coba kembali draf yang sama',row);b.type='button';b.setAttribute('data-request-id',command.requestId);b.disabled=working||state.busy||state.phase!=='ready';b.addEventListener('click',()=>{if(current()&&!working&&!state.busy)perform(()=>controller.retry(command.requestId));});}}
    function render(next){
      if(!current())return;
      try{
        if(!next||!Array.isArray(next.cycles)||!Array.isArray(next.pending))throw Error();
        if(next.phase==='blocked'){dispose();return;}
        state=next;
        optionsFor(cycleSelect,state.cycles.map(c=>({productId:c.productId,cycleId:c.cycleId,operations:c.operations,value:JSON.stringify([c.productId,c.cycleId])})),c=>[c.operations?.series,c.operations?.namaBarang,c.operations?.size].filter(Boolean).join(' · ')+' · siklus '+c.cycleId);
        const selected=cycle(),key=selected?JSON.stringify([selected.productId,selected.cycleId]):'';cycleSelect.value=key;
        if(key!==selectedKey){selectedKey=key;clearForm();}
        summary.textContent=selected?[selected.operations?.series,selected.operations?.namaBarang,selected.operations?.size].filter(Boolean).join(' · '):'Pilih produk dan siklus sebelum mencatat pekerjaan.';
        if(selects['sewing-assignment'])optionsFor(selects['sewing-assignment'],assignmentRows().map(row=>({...row,value:row.id})),row=>label(row.tukangId)+' · tugas '+row.id+' · sisa '+row.sisa+' pcs');
        if(selects['count-assignment'])optionsFor(selects['count-assignment'],assignmentRows().map(row=>({...row,value:row.id})),row=>label(row.tukangId)+' · tugas '+row.id);
        if(selects['inspect-count'])optionsFor(selects['inspect-count'],collection('hitungFisik').filter(row=>!row.qcId&&!batch.some(e=>e.hfId===row.id)).map(row=>({...row,value:row.id})),row=>label(row.tukangId)+' · '+row.jumlah+' pcs · hitung '+row.id);
        if(selects['repair-qc'])optionsFor(selects['repair-qc'],collection('qc').filter(row=>row.perbaikan>0).map(row=>({...row,value:row.id})),row=>label(row.tukangId)+' · sisa '+row.perbaikan+' pcs · QC '+row.id);
        optionsFor(selects['cancel-target'],cancelRows(),row=>row.type+' · '+label(row.row.tukangId)+' · '+row.row.tanggal+' · catatan '+row.row.id);
        renderRecords();renderWage();renderPending();enabled();
        if(state.error)note(state.error);else if(state.phase!=='ready'){status.textContent='Memeriksa akses…';}else if(hasPending())note('result_unknown');else{status.textContent='Akses aktif. Pilih tugas untuk melanjutkan.';status.removeAttribute('role');}
      }catch{dispose();}
    }
    function dispose(){if(disposed)return;disposed=true;try{controller?.dispose();}catch{}root.remove();batch=[];state={phase:'disposed',cycles:[],pending:[],selectedCycle:null,busy:false};}
    host.appendChild(root);
    let ready;
    try{
      const api=getController();if(!api||typeof api.createProductionFormController!=='function'||!current())throw Error();
      controller=api.createProductionFormController({enabled:true,module:moduleName,createBridge,isCurrent,onState:render,endpointURL});
      ready=(async()=>{try{const result=await controller.connect();if(!current())return Object.freeze({ok:false,error:'access_denied'});if(!result||result.ok!==true){note(result?.error);return Object.freeze({ok:false,error:result?.error==='access_denied'?'access_denied':'unavailable'});}return Object.freeze({ok:true});}catch{if(current())note('unavailable');return Object.freeze({ok:false,error:'unavailable'});}})();
    }catch{dispose();ready=Promise.resolve(Object.freeze({ok:false,error:'unavailable'}));}
    return Object.freeze({ready,dispose});
  }
  return Object.freeze({mount});
});
