/* Read-only owner wage UI. Explicit canonical choices; no business persistence. */
(function(root,factory){
  const api=typeof module==='object'&&module.exports?factory(require('./production-view-client.js'),require('./maklon-earnings.js')):factory(root.SoldierProductionViewClient,root.SoldierMaklonEarnings);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.SoldierProductionOwnerWageUI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(View,Earnings){
  'use strict';
  const reserved=new Set(['__proto__','constructor','prototype']);
  const safe=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!reserved.has(v);
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
  function exact(v,keys,optional=[]){if(!object(v)||Reflect.ownKeys(v).some(k=>!keys.includes(k)&&!optional.includes(k))||keys.some(k=>!Object.hasOwn(v,k))||Reflect.ownKeys(v).some(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return !d||!d.enumerable||!Object.hasOwn(d,'value');}))throw Error();}
  function inspect(v,depth=0,seen=new Set(),budget={nodes:0}){
    if(depth>32||++budget.nodes>250000)throw Error();
    if(v===null||typeof v==='string'||typeof v==='boolean')return;
    if(typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=Number.MAX_SAFE_INTEGER)return;
    if(!v||typeof v!=='object'||seen.has(v)||!Array.isArray(v)&&!object(v)||Array.isArray(v)&&Object.getPrototypeOf(v)!==Array.prototype)throw Error();
    seen.add(v);const keys=Reflect.ownKeys(v);
    for(const k of keys){if(typeof k!=='string'||reserved.has(k))throw Error();if(Array.isArray(v)&&k==='length')continue;const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!d.enumerable||!Object.hasOwn(d,'value')||Array.isArray(v)&&(!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=v.length))throw Error();inspect(d.value,depth+1,seen,budget);}
    if(Array.isArray(v)&&keys.length!==v.length+1)throw Error();seen.delete(v);
  }
  const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
  const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
  const copy=v=>freeze(JSON.parse(JSON.stringify(v)));
  function catalog(value){
    inspect(value);exact(value,['cycles']);if(!Array.isArray(value.cycles)||value.cycles.length>256)throw Error();const pairs=new Set();let total=0;
    for(const cycle of value.cycles){exact(cycle,['productId','cycleId','workers'],['product']);if(!safe(cycle.productId)||!safe(cycle.cycleId)||pairs.has(cycle.productId+'/'+cycle.cycleId)||!Array.isArray(cycle.workers)||cycle.workers.length>128)throw Error();pairs.add(cycle.productId+'/'+cycle.cycleId);if(Object.hasOwn(cycle,'product')){exact(cycle.product,['series','namaBarang','size']);if(Object.values(cycle.product).some(v=>typeof v!=='string'||v.length>256||/[\u0000-\u001f\u007f-\u009f]/.test(v)))throw Error();}const ids=new Set();for(const worker of cycle.workers){exact(worker,['workerId','label']);if(!safe(worker.workerId)||ids.has(worker.workerId)||typeof worker.label!=='string'||!worker.label||worker.label.length>256||worker.label.trim()!==worker.label||/[\u0000-\u001f\u007f-\u009f]/.test(worker.label)||++total>1024)throw Error();ids.add(worker.workerId);}}
    return copy(value);
  }
  const pairValue=cycle=>JSON.stringify([cycle.productId,cycle.cycleId]);
  const numberFormat=new Intl.NumberFormat('id-ID',{maximumFractionDigits:0}),dateFormat=new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',dateStyle:'medium'});
  const money=value=>'Rp '+numberFormat.format(value);
  const number=value=>numberFormat.format(value);
  const date=value=>dateFormat.format(new Date(value+'T00:00:00.000Z'));
  function mount(options={}){
    try{exact(options,['document','host','createBridge','isCurrent']);if(!options.document||typeof options.document.createElement!=='function'||!options.host||options.host.ownerDocument!==options.document||typeof options.host.replaceChildren!=='function'||typeof options.createBridge!=='function'||typeof options.isCurrent!=='function'||!View||typeof View.validateSession!=='function'||typeof View.validateOperations!=='function'||!Earnings||typeof Earnings.summarize!=='function')throw Error();}catch{return Object.freeze({readyPromise:Promise.resolve(Object.freeze({ok:false,error:'unavailable'})),dispose(){}});}
    const {document,host,createBridge,isCurrent}=options;
    let bridge,disposed=false,connected=false,choices=null,pendingCatalog=null,selectedCycle=null,selected=null;
    const root=document.createElement('section');root.className='production-owner-wage';
    function node(tag,text,parent=root){const element=document.createElement(tag);if(text!==undefined)element.textContent=String(text);if(parent)parent.appendChild(element);return element;}
    function current(){if(disposed)return false;try{if(isCurrent()===true)return true;}catch{}dispose();return false;}
    function clearView(){context.textContent='';totals.replaceChildren();days.replaceChildren();rows.replaceChildren();detail.hidden=true;}
    function dispose(){if(disposed)return;disposed=true;connected=false;selected=null;selectedCycle=null;choices=null;pendingCatalog=null;clearView();cycleSelect.replaceChildren();workerSelect.replaceChildren();cycleSelect.removeEventListener('change',chooseCycle);workerSelect.removeEventListener('change',chooseWorker);host.replaceChildren();const owned=bridge;bridge=null;try{owned?.dispose();}catch{}}
    function statusText(text,alert=false){status.textContent=text;status.setAttribute('role',alert?'alert':'status');}
    function optionsFor(select,items,placeholder){select.replaceChildren();const first=node('option',placeholder,select);first.value='';for(const item of items){const option=node('option',item.label,select);option.value=item.value;}select.value='';}
    function enabled(){cycleSelect.disabled=!connected||!choices?.cycles.length;workerSelect.disabled=!connected||!selectedCycle||!selectedCycle.workers.length;}
    function receiveCatalog(value){
      if(!current())return;
      try{const next=catalog(value);if(!connected){if(pendingCatalog&&canonical(pendingCatalog)!==canonical(next))throw Error();pendingCatalog=next;return;}if(canonical(next)!==canonical(choices))throw Error();}catch{dispose();}
    }
    function receiveClear(code){
      if(!current())return;clearView();
      if(!['loading','selection_changed','selection_cleared'].includes(code)){dispose();return;}
      statusText(code==='loading'?'Memeriksa akses owner…':selected?'Memuat rincian mitra yang dipilih…':selectedCycle?'Pilih mitra untuk melihat rincian upah.':'Pilih produksi, lalu pilih mitra.');
    }
    function validateView(value){
      inspect(value);exact(value,['selection','workerLabel','operations','projectionRevision','earnings','summary','availability','consistency']);exact(value.selection,['productId','cycleId','workerId']);
      if(!selected||canonical(value.selection)!==canonical(selected)||value.consistency!=='independent-listeners'||!Number.isSafeInteger(value.projectionRevision)||value.projectionRevision<0)throw Error();
      const worker=selectedCycle?.workers.find(w=>w.workerId===selected.workerId);if(!worker||value.workerLabel!==worker.label)throw Error();
      const operations=View.validateOperations(value.operations,selected.productId);
      if(selectedCycle.product&&['series','namaBarang','size'].some(k=>selectedCycle.product[k]!==operations[k]))throw Error();
      if(value.availability==='unavailable'){if(value.earnings!==null||value.summary!==null)throw Error();return {worker,operations,earnings:null,summary:null};}
      if(value.availability!=='available'||value.earnings===null||value.summary===null)throw Error();
      const earnings=value.earnings,summary=Earnings.summarize(earnings);
      if(earnings.workerId!==selected.workerId||earnings.availability!=='available'||canonical(summary)!==canonical(value.summary)||earnings.entries.some(entry=>entry.productId!==selected.productId||!Number.isSafeInteger(entry.tarif)||!Number.isSafeInteger(entry.total)||!['hitungFisik','qcRepair'].includes(entry.sourceType)||['series','namaBarang','size'].some(k=>entry[k]!==operations[k])))throw Error();
      return {worker,operations,earnings,summary};
    }
    function receiveView(value){
      if(!current()||!connected||!selected)return;
      // An old selection can finish after unsubscription. It never updates DOM.
      try{inspect(value);exact(value.selection,['productId','cycleId','workerId']);if(canonical(value.selection)!==canonical(selected))return;}catch{dispose();return;}
      try{
        const view=validateView(value);clearView();if(!current())return;
        const product=[view.operations.series,view.operations.namaBarang,view.operations.size].map(v=>v.trim()).filter(Boolean).join(' · ')||'Produk '+selected.productId;
        context.textContent=view.worker.label+' · '+product+' · siklus '+selected.cycleId;
        if(!view.earnings){statusText('Rincian upah mitra ini belum tersedia. Catatannya perlu diperiksa sebelum nominal ditampilkan.');return;}
        const summary=view.summary;
        function total(label,value,quantity){const card=node('div',undefined,totals);node('h2',label,card);node('p',money(value),card).className='owner-wage-amount';node('p',number(quantity)+' pcs',card);}
        total('Total upah tercatat',summary.calculatedTotal,summary.quantity);total('Masih sementara',summary.provisionalTotal,summary.provisionalQuantity);total('Hasil QC',summary.nonProvisionalTotal,summary.nonProvisionalQuantity);
        node('h2','Ringkasan per tanggal',days);if(!summary.days.length)node('p','Belum ada catatan upah untuk mitra pada produksi ini.',days);else{const list=node('ul',undefined,days);for(const day of summary.days)node('li',date(day.tanggal)+' · '+number(day.quantity)+' pcs · '+money(day.calculatedTotal)+' · sementara '+money(day.provisionalTotal)+' · hasil QC '+money(day.nonProvisionalTotal),list);}
        for(const entry of view.earnings.entries){const row=node('tr',undefined,rows);for(const text of [date(entry.tanggal),[entry.series,entry.namaBarang,entry.size].map(v=>v.trim()).filter(Boolean).join(' · ')||'Produk '+entry.productId,number(entry.jumlah)+' pcs',money(entry.tarif)+' / pcs',money(entry.total),entry.provisional?'Sementara — menunggu QC':'Hasil QC — tarif saat dicatat'])node('td',text,row);}
        detail.hidden=false;statusText(view.earnings.entries.length?'Rincian mengikuti catatan pekerjaan terbaru. Tarif tiap catatan tetap memakai tarif yang tersimpan.':'Rincian tersedia; belum ada pekerjaan yang tercatat untuk mitra ini.');
      }catch{dispose();}
    }
    function clearSelection(){try{const result=bridge.clearSelection();exact(result,['ok']);return result.ok===true;}catch{return false;}}
    function chooseCycle(){
      if(!current()||!connected)return;clearView();selected=null;selectedCycle=null;optionsFor(workerSelect,[],'Pilih mitra');
      if(!clearSelection()){dispose();return;}
      selectedCycle=choices.cycles.find(c=>pairValue(c)===cycleSelect.value)||null;
      if(!selectedCycle){cycleSelect.value='';statusText('Pilih produksi, lalu pilih mitra.');enabled();return;}
      optionsFor(workerSelect,selectedCycle.workers.map(w=>({value:w.workerId,label:w.label})),'Pilih mitra');statusText(selectedCycle.workers.length?'Pilih mitra untuk melihat rincian upah.':'Produksi ini belum memiliki mitra untuk dipilih.');enabled();
    }
    function chooseWorker(){
      if(!current()||!connected)return;clearView();selected=null;
      if(!clearSelection()){dispose();return;}
      const worker=selectedCycle?.workers.find(w=>w.workerId===workerSelect.value);
      if(!worker){workerSelect.value='';statusText('Pilih mitra untuk melihat rincian upah.');return;}
      selected=copy({productId:selectedCycle.productId,cycleId:selectedCycle.cycleId,workerId:worker.workerId});statusText('Memuat rincian mitra yang dipilih…');
      try{const result=bridge.select(selected);inspect(result);if(!object(result)||result.ok!==true||Reflect.ownKeys(result).length!==1){clearView();selected=null;if(result?.error==='invalid_request'||result?.error==='not_ready'){workerSelect.value='';statusText('Pilihan mitra belum dapat dibuka. Pilih kembali setelah catatan diperiksa.',true);}else dispose();}}catch{dispose();}
    }
    node('h1','Rincian upah mitra');node('p','Pilih produksi dan mitra untuk melihat upah kotor dari catatan pekerjaan. Tarif mengikuti yang tersimpan pada tiap catatan.');
    const status=node('p','Memeriksa akses owner…');status.id='owner-wage-status';status.setAttribute('aria-live','polite');status.setAttribute('role','status');
    function select(id,label){const field=node('label');node('span',label,field);const element=node('select',undefined,field);element.id=id;element.disabled=true;return element;}
    const cycleSelect=select('owner-wage-cycle','Produksi dan siklus'),workerSelect=select('owner-wage-worker','Mitra');optionsFor(cycleSelect,[],'Pilih produksi');optionsFor(workerSelect,[],'Pilih mitra');
    const context=node('p');context.id='owner-wage-context';const totals=node('section');totals.id='owner-wage-totals';totals.className='owner-wage-totals';const days=node('section');days.id='owner-wage-days';
    const detail=node('section');detail.id='owner-wage-detail';detail.hidden=true;node('h2','Catatan pekerjaan dan tarif tersimpan',detail);node('p','Nominal di halaman ini adalah upah kotor tercatat. Status pembayaran dan potongan tidak dihitung di sini.',detail);
    const scroll=node('div',undefined,detail);scroll.className='owner-wage-table-wrap';const table=node('table',undefined,scroll);node('caption','Rincian per catatan pekerjaan',table);const head=node('thead',undefined,table),header=node('tr',undefined,head);for(const label of ['Tanggal','Produksi','Jumlah','Tarif tersimpan','Upah tercatat','Tahap']){const cell=node('th',label,header);cell.setAttribute('scope','col');}const rows=node('tbody',undefined,table);rows.id='owner-wage-rows';
    cycleSelect.addEventListener('change',chooseCycle);workerSelect.addEventListener('change',chooseWorker);host.replaceChildren(root);
    const readyPromise=(async()=>{
      try{
        if(!current())throw Error();bridge=createBridge({onCatalog:receiveCatalog,onView:receiveView,onClear:receiveClear});
        if(disposed){try{bridge?.dispose();}catch{}throw Error();}
        if(!bridge||['connect','select','clearSelection','dispose'].some(k=>typeof bridge[k]!=='function'))throw Error();
        const result=await bridge.connect();if(!current())throw Error();inspect(result);exact(result,['ok','scope','profile','catalog']);if(result.ok!==true)throw Error();exact(result.scope,['projectId','databaseURL','tenantId','uid','grantRevision']);
        const next=catalog(result.catalog),s=result.scope;
        View.validateSession({schemaVersion:1,...s,profile:result.profile,cycles:next.cycles.map(c=>({productId:c.productId,cycleId:c.cycleId})),workerLabels:next.cycles.map(c=>({productId:c.productId,cycleId:c.cycleId,workers:c.workers}))},{projectId:s.projectId,databaseURL:s.databaseURL,tenantId:s.tenantId,uid:s.uid});
        if(result.profile.owner!==true||pendingCatalog&&canonical(pendingCatalog)!==canonical(next))throw Error();choices=next;pendingCatalog=null;connected=true;
        optionsFor(cycleSelect,choices.cycles.map(c=>({value:pairValue(c),label:(c.product&&[c.product.series,c.product.namaBarang,c.product.size].map(v=>v.trim()).filter(Boolean).join(' · ')||'Produk '+c.productId)+' · siklus '+c.cycleId})),'Pilih produksi');enabled();statusText(choices.cycles.length?'Pilih produksi, lalu pilih mitra.':'Belum ada produksi yang tersedia untuk rincian upah.');return Object.freeze({ok:true});
      }catch{dispose();return Object.freeze({ok:false,error:'unavailable'});}
    })();
    return Object.freeze({readyPromise,dispose});
  }
  return Object.freeze({mount});
});
