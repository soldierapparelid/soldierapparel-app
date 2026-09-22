/* Owner-issued material allowances. No migration or rewriting of historic cuts. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./production-materials.js'));
  else root.CuttingPlan=factory(root.ProductionMaterials);
})(typeof globalThis!=='undefined'?globalThis:this,function(Materials){
  'use strict';
  const clone=x=>JSON.parse(JSON.stringify(x)), rows=Materials.rows, norm=Materials.norm;
  const units=n=>Math.round(n*1000000), amount=n=>n/1000000;
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
  const validUnit=u=>['kg','yard','meter'].includes(u);
  const unitLabel=u=>u==='yard'?'yd':u==='meter'?'m':u==='kg'?'kg':String(u||'kg');
  function quantityTotals(list,stock){
    const totals=new Map();rows(list).forEach(r=>{const unit=r.unit||(stock?unitOf(stock,r.jenis):'kg');totals.set(unit,(totals.get(unit)||0)+units(Number(r.kg)||0));});
    return Array.from(totals,([unit,value])=>({unit,quantity:amount(value)}));
  }
  function formatQuantities(list,stock){return quantityTotals(list,stock).map(r=>r.quantity.toLocaleString('id-ID',{maximumFractionDigits:6})+' '+unitLabel(r.unit)).join(' · ')||'0 kg';}
  function canonical(x){
    if(x==null)return 'null';
    if(typeof x!=='object')return JSON.stringify(x);
    const pairs=Object.keys(x).sort().map(k=>[k,canonical(x[k])]).filter(p=>p[1]!=='null');
    return pairs.length?'{'+pairs.map(p=>JSON.stringify(p[0])+':'+p[1]).join(',')+'}':'null';
  }
  const same=(a,b)=>canonical(a)===canonical(b);
  function number(value,label,zero){
    const n=Number(value);
    if(value==null||typeof value==='boolean'||String(value).trim()===''||!Number.isFinite(n)||n<0||(!zero&&n===0)||!Number.isSafeInteger(units(n)))throw new Error(label+' harus berupa angka '+(zero?'nol atau lebih.':'lebih dari nol.'));
    return amount(units(n));
  }
  function id(value,label){
    const s=String(value==null?'':value);
    if(!s||/[.#$\[\]\/]/.test(s)||s==='__proto__'||s==='constructor'||s==='prototype')throw new Error('Identitas '+label+' tidak valid.');
    return s;
  }
  function products(root){return rows(Array.isArray(root)?root:root&&root.produksi);}
  function plans(root){return rows(root&&root.cuttingPlans);}
  function isActive(p){return p&&(p.poAktif===true||p.poAktif===1||p.poAktif==='true');}
  function poKey(p){return JSON.stringify([p.series||'',p.namaBarang||'',p._offlineOrderId||'']);}
  // PO identity comes only from Laporan Produksi, never from fabric allowances.
  function activePOs(root){
    const groups=new Map();
    products(root).filter(isActive).forEach(p=>{
      const key=poKey(p);
      if(!groups.has(key))groups.set(key,{id:key,series:p.series||'',namaBarang:p.namaBarang||'',orderId:p._offlineOrderId||'',products:[]});
      groups.get(key).products.push(p);
    });
    return Array.from(groups.values());
  }
  // Work choices only: preserve all PO, cuts, archives and material history.
  // Each size is completed independently so workers can record daily results.
  // Historical cuts inside arsip belong to earlier cycles, not the current PO.
  function uncutPOs(root){
    // Offline orders use both markers in Pembelian; preserve legacy rows that
    // have only one marker, but do not offer them in the ordinary cutting list.
    return activePOs(root).filter(group=>!group.orderId&&!String(group.series).startsWith('OFFLINE-'))
      .map(group=>({...group,products:group.products.filter(p=>!rows(p.potong).some(c=>Number(c.jumlah)>0))}))
      .filter(group=>group.products.length>0);
  }
  function matchesPlan(group,plan){
    const refs=rows(plan&&plan.products),list=group&&group.products||[];
    const matching=refs.filter(ref=>list.some(p=>String(p.id)===String(ref.id)));
    return matching.length>0&&matching.every(ref=>list.some(p=>String(p.id)===String(ref.id)&&isActive(p)&&cycle(p)===ref.cycle));
  }
  function rootCopy(root){
    if(root==null)throw new Error('Data produksi pusat belum tersedia. Sambungkan dahulu.');
    return Array.isArray(root)?{produksi:clone(root)}:clone(root);
  }
  // Archive identities mark a new cycle. Include legacy archive contents only
  // when no stable ID exists; Firebase null pruning does not alter this token.
  function cycle(p){return canonical([String(p.id),p._offlineOrderId||'',rows(p.arsip).map(a=>a.id!=null?String(a.id):a)]);}
  function indexed(list,label){
    const out=new Map();
    rows(list).forEach(v=>{const key=String(v.id==null?'':v.id);if(!key||out.has(key))throw new Error('Identitas '+label+' kosong atau ganda; periksa di Laporan Produksi.');out.set(key,v);});
    return out;
  }
  function findPlan(root,planId){
    const matches=plans(root).filter(p=>String(p.id)===String(planId));
    if(matches.length!==1)throw new Error('Jatah potong tidak ditemukan atau ganda. Minta admin memeriksa Stok Bahan.');
    return matches[0];
  }
  function checkProducts(root,plan){
    const byId=indexed(products(root),'barang');
    if(!rows(plan.products).length)throw new Error('Jatah belum memiliki barang.');
    const seen=new Set();
    return rows(plan.products).map(ref=>{
      const key=String(ref.id),p=byId.get(key);
      if(seen.has(key)||!isActive(p)||cycle(p)!==ref.cycle)throw new Error('PO berubah atau sudah tidak aktif. Minta admin memeriksa bahan untuk PO ini.');
      seen.add(key);return p;
    });
  }
  function completedIds(plan){return new Set((Array.isArray(plan.completedProductIds)?plan.completedProductIds:[]).map(String));}
  function remainingPlanProducts(root,plan){
    const done=completedIds(plan);
    return checkProducts(root,plan).filter(p=>!done.has(String(p.id))&&!rows(p.potong).some(c=>Number(c.jumlah)>0));
  }
  function requireRecordedMaterial(root,plan){
    if(!plan.usedBatchId)throw new Error('Catatan pemakaian bahan awal belum ditemukan. Minta admin memeriksa, jangan input ulang.');
    const actual=new Map(),wanted=new Map(),expectedUnits=new Map();let unitChanged=false;
    rows(plan.rolls).forEach(r=>{wanted.set(String(r.purchaseId),units(Number(r.kg)));expectedUnits.set(String(r.purchaseId),r.unit||'kg');});
    products(root).forEach(p=>Materials.inspect(p).entries.forEach(({entry:e})=>{
      if(String(e.cuttingPlanId)!==String(plan.id)||e.materialBatchId!==plan.usedBatchId)return;
      rows(e.rols).forEach(r=>{const key=String(r.purchaseId);if((r.unit||'kg')!==expectedUnits.get(key))unitChanged=true;actual.set(key,(actual.get(key)||0)+units(Number(r.kiloan==null?r.kg:r.kiloan)||0));});
    }));
    if(unitChanged||actual.size!==wanted.size||[...wanted].some(([key,value])=>actual.get(key)!==value))throw new Error('Catatan bahan awal berubah. Minta admin memeriksa; bahan tidak ditambahkan ulang.');
  }
  function unitOf(stock,jenis){
    const key=norm(jenis).replace(/[\/.#$\[\]]/g,'-');
    const info=stock.rolInfo&&stock.rolInfo[key];
    return info&&!Array.isArray(info)&&info.unit?info.unit:'kg';
  }
  // Read-only roll projection shared by the stock card and the PO picker.
  // Removed roll details must not be resurrected from purchase history. Only
  // old purchases that never had a roll-detail identity may use the fallback.
  function projectRolls(stock,jenis,saldo,usedByPurchase={}){
    const key=norm(jenis).replace(/[\/.#$\[\]]/g,'-'),info=stock.rolInfo&&stock.rolInfo[key];
    const purchases=rows(stock.pembelian).filter(p=>norm(p.jenisBahan)===norm(jenis));
    const unit=unitOf(stock,jenis),active=[],consumed=[];
    let source;
    if(info){
      source=rows(Array.isArray(info)?info:info.rols).map(r=>{
        const linked=purchases.filter(p=>p.rolInfoId!=null&&String(p.rolInfoId)===String(r.id));
        const p=linked.length===1?linked[0]:null;
        return {id:r.id,val:Number(r.val==null?r.kg:r.val),note:r.note||'',purchaseId:p&&p.id!=null?String(p.id):null,purchase:p};
      });
    }else source=purchases.filter(p=>!p.rolInfoId).map(p=>({id:p.id,val:Number(p.kg),note:p.tanggal?'Beli '+p.tanggal:'',purchaseId:p.id!=null?String(p.id):null,purchase:p}));
    const seen=new Set();
    source.forEach(r=>{
      const p=r.purchase;delete r.purchase;
      r._sortDate=p&&p.tanggal||'';
      if(!r._sortDate){const match=String(r.note).match(/(\d{2})\/(\d{2})\/(\d{2,4})/);if(match)r._sortDate=(match[3].length===2?'20'+match[3]:match[3])+'-'+match[2]+'-'+match[1];}
      if(!r._sortDate)r._sortDate='9999-12-31';
      if(!Number.isFinite(r.val)||r.val<0){r.val=0;r.invalid=true;}
      if(r.purchaseId!=null){
        if(seen.has(r.purchaseId)){r.invalid=true;source.filter(other=>other.purchaseId===r.purchaseId).forEach(other=>other.invalid=true);}
        seen.add(r.purchaseId);
      }
      r._origVal=r.val;
      const used=units(Number(usedByPurchase[r.purchaseId])||0);
      if(p){
        // A corrected smaller detail can already represent the remaining kg.
        // Bound against the original roll instead of deducting it twice.
        const cap=Math.max(0,units(Number(p.kg)||0)-used);
        r.val=amount(Math.min(units(r.val),cap));
      }
    });
    source.sort((a,b)=>a._sortDate.localeCompare(b._sortDate));
    let remainingDebit=Math.max(0,source.reduce((sum,r)=>sum+units(r.val),0)-Math.max(0,units(Number(saldo)||0)));
    source.forEach(r=>{
      const debit=Math.min(units(r.val),remainingDebit);remainingDebit-=debit;
      const left=amount(units(r.val)-debit),spent=amount(units(r._origVal)-units(left));
      if(spent>0)consumed.push({...r,val:spent,_partial:left>0});
      if(left>0)active.push({...r,val:left,_remaining:left<r._origVal});
    });
    return {active,consumed,unit};
  }
  function availability(root,stock){
    if(!stock||typeof stock!=='object')throw new Error('Data Stok Bahan belum tersedia.');
    const materials=Object.create(null),rolls=[],byId=new Map(),allPlans=plans(root);
    function material(name){const key=norm(name);if(!key)throw new Error('Nama bahan kosong. Periksa Stok Bahan.');if(!materials[key])materials[key]={name:String(name).trim(),unit:unitOf(stock,name),stock:0,reserved:0,available:0};return materials[key];}
    rows(stock.pembelian).forEach(p=>{
      const m=material(p.jenisBahan),q=Number(p.kg);
      if(!Number.isFinite(q)||q<0)m.invalid=true;else m.stock+=units(q);
      if(p.unit&&p.unit!==m.unit)m.invalid=true;
      if(p.id==null)return;
      const key=String(p.id),r={purchaseId:key,jenis:p.jenisBahan,kg:q,unit:p.unit||m.unit,rolNum:p.rolNum||p.rolInfoId||key,tanggal:p.tanggal||'',invoice:p.invoice||'',reserved:0,used:0,available:0};
      if(byId.has(key)){r.invalid=true;byId.get(key).invalid=true;}else byId.set(key,r);
      rolls.push(r);
    });
    rows(stock.adjustment).forEach(a=>{const m=material(a.jenisBahan),q=Number(a.kg);if(!Number.isFinite(q))m.invalid=true;else m.stock+=units(q);});
    const baseline=stock.settings&&stock.settings.resetDate||'';
    products(root).forEach(p=>Materials.inspect(p).entries.forEach(({entry})=>{
      if(baseline&&entry.tanggal<baseline)return;
      Materials.bahan(entry).forEach(b=>{const m=material(b.jenis),q=Number(b.kg);if(b.unit&&b.unit!==m.unit)m.invalid=true;if(!Number.isFinite(q)||q<0)m.invalid=true;else m.stock-=units(q);});
      // Legacy cuts with purchase identities still occupy their recorded rolls.
      if(!entry.cuttingPlanId)rows(entry.rols).forEach(r=>{const roll=byId.get(String(r.purchaseId));if(roll)roll.used+=units(Number(r.kiloan==null?r.kg:r.kiloan)||0);});
    }));
    allPlans.forEach(plan=>{
      if(!['ready','in_progress','used'].includes(plan.status))return;
      rows(plan.rolls).forEach(r=>{
        const roll=byId.get(String(r.purchaseId)),kg=units(Number(r.kg)||0);
        if(roll&&plan.status==='ready'&&(r.unit||'kg')!==roll.unit)material(r.jenis).invalid=true;
        if(roll)roll[plan.status==='ready'?'reserved':'used']+=kg;
        if(plan.status==='ready')material(r.jenis).reserved+=kg;
      });
    });
    const usedByPurchase=Object.create(null),projections=Object.create(null),remainingByPurchase=new Map();
    rolls.forEach(r=>{r.used=amount(r.used);r.reserved=amount(r.reserved);usedByPurchase[r.purchaseId]=r.used;});
    Object.entries(materials).forEach(([key,m])=>{
      m.stock=amount(m.stock);m.reserved=amount(m.reserved);m.available=amount(units(m.stock)-units(m.reserved));
      const projection=projectRolls(stock,m.name,m.stock,usedByPurchase);projections[key]=projection;
      projection.active.forEach(r=>{if(r.purchaseId!=null&&!r.invalid)remainingByPurchase.set(r.purchaseId,r.val);});
    });
    rolls.forEach(r=>{r.stockAvailable=remainingByPurchase.get(r.purchaseId)||0;r.available=amount(units(r.stockAvailable)-units(r.reserved));});
    return {materials,rolls,projections};
  }
  function checkCapacity(root,stock,plan){
    const available=availability(root,stock),wanted=new Map(),seen=new Set();
    if(!rows(plan.rolls).length)throw new Error('Pilih paling sedikit satu rol dan jumlah bahannya.');
    rows(plan.rolls).forEach(r=>{
      const purchaseId=String(r.purchaseId),kg=number(r.kg,'Jumlah bahan',false);
      if(seen.has(purchaseId))throw new Error('Rol yang sama dipilih dua kali. Satukan jumlahnya.');seen.add(purchaseId);
      const matches=available.rolls.filter(x=>x.purchaseId===purchaseId),roll=matches[0];
      if(matches.length!==1||roll.invalid||!validUnit(roll.unit)||roll.unit!==(r.unit||'kg')||norm(roll.jenis)!==norm(r.jenis))throw new Error('Catatan rol berubah, tidak ditemukan, atau satuannya berbeda. Periksa Stok Bahan.');
      if(units(kg)>units(roll.available))throw new Error('Jatah melebihi sisa batas rol '+roll.rolNum+'; stok tidak cukup atau rol sudah terpakai. Pilih rol yang masih tersedia.');
      const key=norm(r.jenis);wanted.set(key,(wanted.get(key)||0)+units(kg));
    });
    wanted.forEach((qty,key)=>{const m=available.materials[key];if(!m||m.invalid||!validUnit(m.unit)||qty>units(m.available))throw new Error('Stok '+(m?m.name:key)+' tidak cukup atau satuan berubah setelah jatah PO lain. Periksa Stok Bahan; data tidak diubah.');});
  }
  function makePlan(input,root,stock){
    const productIds=input.productIds||[],map=indexed(products(root),'barang'),selected=productIds.map(k=>map.get(String(k)));
    if(!selected.length||selected.some(p=>!isActive(p))||new Set(productIds.map(String)).size!==productIds.length)throw new Error('Pilih ukuran dari PO aktif.');
    const first=selected[0];
    if(selected.some(p=>p.series!==first.series||p.namaBarang!==first.namaBarang||(p._offlineOrderId||'')!==(first._offlineOrderId||'')))throw new Error('Satu jatah hanya untuk barang dan PO yang sama.');
    const candidates=availability(root,stock).rolls;
    const rolls=rows(input.rolls).map(r=>{
      const matches=candidates.filter(x=>x.purchaseId===String(r.purchaseId));if(matches.length!==1)throw new Error('Pilih rol pembelian yang valid.');if(r.unit&&r.unit!==matches[0].unit)throw new Error('Satuan rol berubah. Pilih kembali bahan sebelum menyimpan.');
      return {purchaseId:String(r.purchaseId),jenis:matches[0].jenis,kg:number(r.kg,'Jumlah bahan',false),rolNum:matches[0].rolNum,...(matches[0].unit==='kg'?{}:{unit:matches[0].unit})};
    });
    if(!/^\d{4}-\d{2}-\d{2}T/.test(input.createdAt||''))throw new Error('Waktu penerbitan jatah belum valid.');
    const plan={id:id(input.id,'jatah'),status:'ready',products:selected.map(p=>({id:String(p.id),cycle:cycle(p)})),rolls,series:first.series||'',namaBarang:first.namaBarang||'',note:String(input.note||''),createdAt:input.createdAt,stockBaseline:stock.settings&&stock.settings.resetDate||''};
    checkCapacity(root,stock,plan);return plan;
  }
  function issue(root,stock,plan){
    if(plans(root).some(p=>String(p.id)===String(plan.id)))throw new Error('Jatah ini sudah tersimpan. Muat daftar terbaru, jangan buat salinan.');
    if(plan.status!=='ready')throw new Error('Status jatah tidak valid.');
    const selected=checkProducts(root,plan);
    const trusted=makePlan({id:plan.id,productIds:selected.map(p=>p.id),rolls:plan.rolls,note:plan.note,createdAt:plan.createdAt},root,stock);
    if(!same(trusted,plan))throw new Error('Jatah atau data rol berubah. Periksa kembali sebelum menyimpan.');
    const out=rootCopy(root);out.cuttingPlans=Object.assign({},out.cuttingPlans||{});out.cuttingPlans[plan.id]=clone(plan);return out;
  }
  function cancel(root,planId){
    const plan=findPlan(root,planId);
    if(plan.status!=='ready')throw new Error('Hanya jatah yang belum digunakan yang dapat dibatalkan.');
    const out=rootCopy(root);out.cuttingPlans=Object.assign({},out.cuttingPlans);out.cuttingPlans[plan.id]={...clone(plan),status:'cancelled'};return out;
  }
  function buildCuts(root,planId,quantities,meta){
    const plan=findPlan(root,planId);
    if(!['ready','in_progress'].includes(plan.status))throw new Error('Jatah ini sudah digunakan atau dibatalkan. Pilih jatah lain.');
    const selected=checkProducts(root,plan),allowed=new Set(selected.map(p=>String(p.id)));
    if(Object.keys(quantities||{}).some(k=>!allowed.has(k)))throw new Error('Ukuran tidak termasuk jatah ini.');
    const output=selected.map(p=>({p,qty:Number(own(quantities,p.id)?quantities[p.id]:0)}));
    if(output.some(x=>!Number.isSafeInteger(x.qty)||x.qty<0)||!output.some(x=>x.qty>0))throw new Error('Isi jumlah hasil potong dengan pcs bulat; minimal satu ukuran lebih dari nol.');
    const remaining=new Set(remainingPlanProducts(root,plan).map(p=>String(p.id)));
    if(output.some(x=>x.qty>0&&!remaining.has(String(x.p.id))))throw new Error('Ukuran ini sudah dipotong. Periksa riwayat; jangan dicatat dua kali.');
    if(!meta||!meta.tukangId||!/^\d{4}-\d{2}-\d{2}$/.test(meta.tanggal||''))throw new Error('Pilih tukang dan tanggal potong yang valid.');
    if(meta.tanggal<plan.stockBaseline||meta.tanggal<plan.createdAt.slice(0,10))throw new Error('Tanggal potong tidak boleh sebelum jatah diterbitkan atau sebelum awal stok.');
    const batchId=id(meta.id,'hasil potong'),positive=output.filter(x=>x.qty>0);
    const rolls=rows(plan.rolls).map((r,i)=>({...r,nomor:i+1,kiloan:number(r.kg,'Jumlah bahan',false)}));
    const bahanList=rolls.map(r=>({jenis:r.jenis,kg:r.kg,...(r.unit?{unit:r.unit}:{})}));
    const kiloan=amount(rolls.filter(r=>(r.unit||'kg')==='kg').reduce((n,r)=>n+units(r.kg),0));
    const continuation=plan.status==='in_progress';
    if(continuation)requireRecordedMaterial(root,plan);
    const allocated=continuation?positive.map(()=>({kiloan:0,rols:[],bahanList:[]})):Materials.allocateBatch(positive.map(x=>x.qty),{kiloan,rols:rolls,bahanList});
    // Legacy field names kg/kiloan on material rows hold native quantities.
    // The top-level kiloan stays weight-only: never add yards/meters to kg.
    allocated.forEach(part=>{part.kiloan=amount(part.bahanList.filter(b=>(b.unit||'kg')==='kg').reduce((sum,b)=>sum+units(b.kg),0));});
    return positive.map((x,i)=>{
      const tarif=number(typeof meta.tarif==='object'?meta.tarif[x.p.id]:meta.tarif,'Tarif potong',true);
      return {productId:String(x.p.id),entry:{id:batchId+'-'+x.p.id,cuttingPlanId:plan.id,materialBatchId:batchId,materialAllocation:continuation?'owner-plan-recorded-earlier':'owner-plan-by-pcs',tanggal:meta.tanggal,jumlah:x.qty,tukangId:meta.tukangId,tukangNama:String(meta.tukangNama||''),tarif,total:x.qty*tarif,dibayar:false,...allocated[i],jenisBahan:rolls[0].jenis}};
    });
  }
  function materialSignature(e){return canonical([e.tanggal||'',e.cuttingPlanId||'',e.materialBatchId||'',e.materialAllocation||'',e.jenisBahan||'',e.kiloan||0,e.bahanList||[],e.rols||[]]);}
  // Called with production and stock from the same soldier transaction snapshot.
  // This makes the stock check and consumption atomic across all sizes and devices.
  function applyCuts(root,nextProducts,stock){
    if(!stock||typeof stock!=='object')throw new Error('Stok Bahan terbaru belum tersedia. Draf tidak dibuang.');
    const before=indexed(products(root),'barang'),after=indexed(rows(nextProducts),'barang'),additions=new Map();
    if(before.size!==after.size||[...before.keys()].some(k=>!after.has(k)))throw new Error('Daftar barang berubah; muat ulang dari pusat tanpa menghapus draf.');
    before.forEach((p,key)=>{
      const next=after.get(key),left={...p},right={...next};delete left.potong;delete right.potong;
      if(!same(left,right))throw new Error('Potong tidak boleh mengubah data divisi lain.');
      const oldRows=rows(p.potong),newRows=rows(next.potong);
      if(same(oldRows,newRows))return;
      // Keep untouched ID-less history. Changed/new rows must have stable IDs.
      const seen=new Set();
      newRows.forEach(e=>{
        if(e.id==null){if(!oldRows.some(old=>same(old,e)))throw new Error('Catatan potong tanpa identitas harus dikoreksi admin.');return;}
        const eid=String(e.id);if(seen.has(eid))throw new Error('Catatan potong ganda.');seen.add(eid);
        const matches=oldRows.filter(old=>String(old.id)===eid);
        if(matches.length>1)throw new Error('Identitas hasil potong ganda.');
        if(matches.length){
          if(materialSignature(matches[0])!==materialSignature(e))throw new Error('Tanggal dan bahan tetap; kain dan jumlahnya hanya ditetapkan admin Stok Bahan.');
          if(!same(matches[0],e)&&(!Number.isSafeInteger(e.jumlah)||e.jumlah<=0))throw new Error('Jumlah pcs harus bulat lebih dari nol.');
          return;
        }
        if(!e.cuttingPlanId)throw new Error('Hasil potong baru wajib memakai jatah dari Stok Bahan. Draf lama tetap tersimpan; minta admin memeriksanya.');
        const planId=String(e.cuttingPlanId);if(!additions.has(planId))additions.set(planId,[]);additions.get(planId).push({productId:key,entry:e});
      });
      oldRows.forEach(e=>{if(e.cuttingPlanId&&!newRows.some(n=>String(n.id)===String(e.id)))throw new Error('Hasil dari jatah tidak dapat dihapus di Potong. Minta admin koreksi di Laporan Produksi.');});
    });
    let out=rootCopy(root);
    additions.forEach((added,planId)=>{
      const plan=findPlan(root,planId),quantities={},rates={},first=added[0].entry;
      if(!['ready','in_progress'].includes(plan.status))throw new Error('Jatah sudah dipakai perangkat lain atau dibatalkan. Draf tidak dibuang.');
      // Its own reservation becomes consumption, not a second stock deduction.
      if((stock.settings&&stock.settings.resetDate||'')!==plan.stockBaseline)throw new Error('Awal perhitungan stok berubah. Minta admin membuat jatah baru.');
      if(plan.status==='ready')checkCapacity(cancel(out,planId),stock,plan);
      else requireRecordedMaterial(root,plan);
      added.forEach(x=>{
        if(own(quantities,x.productId))throw new Error('Satu jatah hanya boleh disimpan sekali per ukuran.');
        if(x.entry.materialBatchId!==first.materialBatchId||x.entry.tanggal!==first.tanggal||x.entry.tukangId!==first.tukangId)throw new Error('Satu penyimpanan hasil harus memiliki tanggal dan petugas yang sama.');
        quantities[x.productId]=x.entry.jumlah;rates[x.productId]=x.entry.tarif;
      });
      const expected=buildCuts(root,planId,quantities,{id:first.materialBatchId,tanggal:first.tanggal,tukangId:first.tukangId,tukangNama:first.tukangNama,tarif:rates});
      if(expected.length!==added.length||expected.some(x=>!added.some(a=>a.productId===x.productId&&a.entry.id===x.entry.id&&materialSignature(a.entry)===materialSignature(x.entry))))throw new Error('Kain atau jumlah bahan berbeda dari jatah admin. Tidak disimpan.');
      const done=completedIds(plan);added.forEach(x=>done.add(x.productId));
      const finished=rows(plan.products).every(ref=>done.has(String(ref.id)));
      out.cuttingPlans=Object.assign({},out.cuttingPlans);out.cuttingPlans[planId]={...clone(plan),status:finished?'used':'in_progress',completedProductIds:[...done],usedBatchId:plan.usedBatchId||first.materialBatchId,usedAt:plan.usedAt||first.tanggal,lastCutAt:first.tanggal};
    });
    out.produksi=clone(rows(nextProducts));return out;
  }
  return {products,plans,activePOs,uncutPOs,matchesPlan,remainingPlanProducts,cycle,unitOf,unitLabel,validUnit,quantityTotals,formatQuantities,projectRolls,availability,makePlan,issue,cancel,buildCuts,applyCuts};
});
