/* Owner-issued material allowances. No migration or rewriting of historic cuts. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./production-materials.js'));
  else root.CuttingPlan=factory(root.ProductionMaterials);
})(typeof globalThis!=='undefined'?globalThis:this,function(Materials){
  'use strict';
  const clone=x=>JSON.parse(JSON.stringify(x)), rows=Materials.rows, norm=Materials.norm;
  const units=n=>Math.round(n*1000000), amount=n=>n/1000000;
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
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
  // PO identity comes only from Laporan Produksi, never from fabric allowances.
  function activePOs(root){
    const groups=new Map();
    products(root).filter(isActive).forEach(p=>{
      const key=JSON.stringify([p.series||'',p.namaBarang||'',p._offlineOrderId||'']);
      if(!groups.has(key))groups.set(key,{id:key,series:p.series||'',namaBarang:p.namaBarang||'',orderId:p._offlineOrderId||'',products:[]});
      groups.get(key).products.push(p);
    });
    return Array.from(groups.values());
  }
  function matchesPlan(group,plan){
    const refs=rows(plan&&plan.products),list=group&&group.products||[];
    return refs.length>0&&refs.every(ref=>list.some(p=>String(p.id)===String(ref.id)&&isActive(p)&&cycle(p)===ref.cycle));
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
  function unitOf(stock,jenis){
    const key=norm(jenis).replace(/[\/.#$\[\]]/g,'-');
    const info=stock.rolInfo&&stock.rolInfo[key];
    return info&&!Array.isArray(info)&&info.unit?info.unit:'kg';
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
      Materials.bahan(entry).forEach(b=>{const m=material(b.jenis),q=Number(b.kg);if(!Number.isFinite(q)||q<0)m.invalid=true;else m.stock-=units(q);});
      // Legacy cuts with purchase identities still occupy their recorded rolls.
      if(!entry.cuttingPlanId)rows(entry.rols).forEach(r=>{const roll=byId.get(String(r.purchaseId));if(roll)roll.used+=units(Number(r.kiloan==null?r.kg:r.kiloan)||0);});
    }));
    allPlans.forEach(plan=>{
      if(!['ready','used'].includes(plan.status))return;
      rows(plan.rolls).forEach(r=>{
        const roll=byId.get(String(r.purchaseId)),kg=units(Number(r.kg)||0);
        if(roll)roll[plan.status==='used'?'used':'reserved']+=kg;
        if(plan.status==='ready')material(r.jenis).reserved+=kg;
      });
    });
    Object.values(materials).forEach(m=>{m.stock=amount(m.stock);m.reserved=amount(m.reserved);m.available=amount(units(m.stock)-units(m.reserved));});
    rolls.forEach(r=>{r.used=amount(r.used);r.reserved=amount(r.reserved);r.available=amount(units(r.kg)-units(r.used)-units(r.reserved));});
    return {materials,rolls};
  }
  function checkCapacity(root,stock,plan){
    const available=availability(root,stock),wanted=new Map(),seen=new Set();
    if(!rows(plan.rolls).length)throw new Error('Pilih paling sedikit satu rol dan kilogramnya.');
    rows(plan.rolls).forEach(r=>{
      const purchaseId=String(r.purchaseId),kg=number(r.kg,'Jatah kilogram',false);
      if(seen.has(purchaseId))throw new Error('Rol yang sama dipilih dua kali. Satukan kilogramnya.');seen.add(purchaseId);
      const matches=available.rolls.filter(x=>x.purchaseId===purchaseId),roll=matches[0];
      if(matches.length!==1||roll.invalid||roll.unit!=='kg'||norm(roll.jenis)!==norm(r.jenis))throw new Error('Catatan rol berubah, tidak ditemukan, atau satuannya bukan kg.');
      if(units(kg)>units(roll.available))throw new Error('Jatah melebihi sisa batas rol '+roll.rolNum+'. Periksa jatah PO lain.');
      const key=norm(r.jenis);wanted.set(key,(wanted.get(key)||0)+units(kg));
    });
    wanted.forEach((qty,key)=>{const m=available.materials[key];if(!m||m.invalid||m.unit!=='kg'||qty>units(m.available))throw new Error('Stok '+(m?m.name:key)+' tidak cukup setelah jatah PO lain. Periksa Stok Bahan; data tidak diubah.');});
  }
  function makePlan(input,root,stock){
    const productIds=input.productIds||[],map=indexed(products(root),'barang'),selected=productIds.map(k=>map.get(String(k)));
    if(!selected.length||selected.some(p=>!isActive(p))||new Set(productIds.map(String)).size!==productIds.length)throw new Error('Pilih ukuran dari PO aktif.');
    const first=selected[0];
    if(selected.some(p=>p.series!==first.series||p.namaBarang!==first.namaBarang||(p._offlineOrderId||'')!==(first._offlineOrderId||'')))throw new Error('Satu jatah hanya untuk barang dan PO yang sama.');
    const candidates=availability(root,stock).rolls;
    const rolls=rows(input.rolls).map(r=>{
      const matches=candidates.filter(x=>x.purchaseId===String(r.purchaseId));if(matches.length!==1)throw new Error('Pilih rol pembelian yang valid.');
      return {purchaseId:String(r.purchaseId),jenis:matches[0].jenis,kg:number(r.kg,'Jatah kilogram',false),rolNum:matches[0].rolNum};
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
    if(plan.status!=='ready')throw new Error('Jatah ini sudah digunakan atau dibatalkan. Pilih jatah lain.');
    const selected=checkProducts(root,plan),allowed=new Set(selected.map(p=>String(p.id)));
    if(Object.keys(quantities||{}).some(k=>!allowed.has(k)))throw new Error('Ukuran tidak termasuk jatah ini.');
    const output=selected.map(p=>({p,qty:Number(own(quantities,p.id)?quantities[p.id]:0)}));
    if(output.some(x=>!Number.isSafeInteger(x.qty)||x.qty<0)||!output.some(x=>x.qty>0))throw new Error('Isi jumlah hasil potong dengan pcs bulat; minimal satu ukuran lebih dari nol.');
    if(!meta||!meta.tukangId||!/^\d{4}-\d{2}-\d{2}$/.test(meta.tanggal||''))throw new Error('Pilih tukang dan tanggal potong yang valid.');
    if(meta.tanggal<plan.stockBaseline||meta.tanggal<plan.createdAt.slice(0,10))throw new Error('Tanggal potong tidak boleh sebelum jatah diterbitkan atau sebelum awal stok.');
    const batchId=id(meta.id,'hasil potong'),positive=output.filter(x=>x.qty>0);
    const rolls=rows(plan.rolls).map((r,i)=>({...r,nomor:i+1,kiloan:number(r.kg,'Jatah kilogram',false)}));
    const bahanList=rolls.map(r=>({jenis:r.jenis,kg:r.kg})),kiloan=amount(rolls.reduce((n,r)=>n+units(r.kg),0));
    const allocated=Materials.allocateBatch(positive.map(x=>x.qty),{kiloan,rols:rolls,bahanList});
    return positive.map((x,i)=>{
      const tarif=number(typeof meta.tarif==='object'?meta.tarif[x.p.id]:meta.tarif,'Tarif potong',true);
      return {productId:String(x.p.id),entry:{id:batchId+'-'+x.p.id,cuttingPlanId:plan.id,materialBatchId:batchId,materialAllocation:'owner-plan-by-pcs',tanggal:meta.tanggal,jumlah:x.qty,tukangId:meta.tukangId,tukangNama:String(meta.tukangNama||''),tarif,total:x.qty*tarif,dibayar:false,...allocated[i],jenisBahan:rolls[0].jenis}};
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
          if(materialSignature(matches[0])!==materialSignature(e))throw new Error('Tanggal dan bahan tetap; kain dan kilogram hanya ditetapkan admin Stok Bahan.');
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
      if(plan.status!=='ready')throw new Error('Jatah sudah dipakai perangkat lain atau dibatalkan. Draf tidak dibuang.');
      // Its own reservation becomes consumption, not a second stock deduction.
      const capacityRoot=cancel(out,planId);
      if((stock.settings&&stock.settings.resetDate||'')!==plan.stockBaseline)throw new Error('Awal perhitungan stok berubah. Minta admin membuat jatah baru.');
      checkCapacity(capacityRoot,stock,plan);
      added.forEach(x=>{
        if(own(quantities,x.productId))throw new Error('Satu jatah hanya boleh disimpan sekali per ukuran.');
        if(x.entry.materialBatchId!==first.materialBatchId||x.entry.tanggal!==first.tanggal||x.entry.tukangId!==first.tukangId)throw new Error('Satu jatah harus dipotong dalam satu pencatatan.');
        quantities[x.productId]=x.entry.jumlah;rates[x.productId]=x.entry.tarif;
      });
      const expected=buildCuts(root,planId,quantities,{id:first.materialBatchId,tanggal:first.tanggal,tukangId:first.tukangId,tukangNama:first.tukangNama,tarif:rates});
      if(expected.length!==added.length||expected.some(x=>!added.some(a=>a.productId===x.productId&&a.entry.id===x.entry.id&&materialSignature(a.entry)===materialSignature(x.entry))))throw new Error('Kain atau kilogram berbeda dari jatah admin. Tidak disimpan.');
      out.cuttingPlans=Object.assign({},out.cuttingPlans);out.cuttingPlans[planId]={...clone(plan),status:'used',usedBatchId:first.materialBatchId,usedAt:first.tanggal};
    });
    out.produksi=clone(rows(nextProducts));return out;
  }
  return {products,plans,activePOs,matchesPlan,cycle,availability,makePlan,issue,cancel,buildCuts,applyCuts};
});
