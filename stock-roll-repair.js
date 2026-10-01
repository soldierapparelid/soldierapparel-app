/* Relink existing physical roll details without changing the stock ledger. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./cutting-plan.js'),require('./production-materials.js'));
  else root.StockRollRepair=factory(root.CuttingPlan,root.ProductionMaterials);
})(typeof globalThis!=='undefined'?globalThis:this,function(CuttingPlan,Materials){
  'use strict';
  const SCALE=1000000, norm=Materials.norm, rows=Materials.rows;
  const keyOf=value=>norm(value).replace(/[\/.#$\[\]]/g,'-');
  const identity=value=>value==null?'':String(value);
  const safeId=value=>(typeof value==='string'||typeof value==='number')&&identity(value).trim()!==''&&
    !/[.#$\[\]\/\u0000-\u001f\u007f]/.test(identity(value))&&!['__proto__','constructor','prototype'].includes(identity(value))&&
    (typeof value!=='number'||Number.isSafeInteger(value));
  const clone=value=>Array.isArray(value)?value.map(clone):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).map(key=>[key,clone(value[key])])):value;
  function quantity(value,negative){
    if(!['string','number'].includes(typeof value)||String(value).trim()==='')return NaN;
    const n=Number(value),scaled=n*SCALE,rounded=Math.round(scaled);
    return Number.isFinite(n)&&(negative||n>=0)&&Number.isSafeInteger(rounded)&&Math.abs(scaled-rounded)<0.00001?n:NaN;
  }
  const scaled=value=>Math.round(value*SCALE);
  const entries=value=>value&&typeof value==='object'?Object.entries(value).filter(([,row])=>row&&typeof row==='object'&&!Array.isArray(row)):[];
  function physical(stock){
    return Object.entries(stock.rolInfo||{}).flatMap(([materialKey,info])=>entries(Array.isArray(info)?info:info&&info.rols)
      .map(([rowKey,row])=>({materialKey,rowKey,row,legacy:Array.isArray(info)})));
  }
  function setId(stock,item,value){
    const info=stock.rolInfo[item.materialKey];
    (item.legacy?info:info.rols)[item.rowKey].id=value;
  }
  function productionReferences(root){
    const result=new Set();
    function visit(value,inRoll){
      if(!value||typeof value!=='object')return;
      Object.entries(value).forEach(([key,child])=>{
        if(['rolId','rolInfoId','detailId'].includes(key)||(inRoll&&key==='id')){
          if(child!=null&&typeof child!=='object')result.add(identity(child));
        }
        if(child&&typeof child==='object'){
          if(key==='rols'||key==='rolls')rows(child).forEach(row=>visit(row,true));
          else visit(child,false);
        }
      });
    }
    visit(Array.isArray(root)?root:root.produksi,false);
    visit(root.cuttingPlans,false);
    return result;
  }
  function physicalRemaining(available,item){
    const list=Object.values(available.projections||{}).flatMap(p=>p.active||[]);
    const matching=list.filter(r=>identity(r.id)===identity(item.row.id));
    return matching.length===1&&!matching[0].invalid?quantity(matching[0].val):0;
  }
  function context(root,stock,jenis){
    if(!CuttingPlan||!Materials)throw new Error('Pemeriksaan stok belum siap. Muat ulang halaman.');
    if(!root||typeof root!=='object')throw new Error('Data produksi terbaru belum tersedia. Sambungkan dahulu.');
    if(!stock||typeof stock!=='object'||Array.isArray(stock))throw new Error('Data Stok Bahan terbaru belum tersedia.');
    if(!norm(jenis))throw new Error('Pilih nama bahan yang valid.');
    const key=keyOf(jenis),materialKey=norm(jenis),allPhysical=physical(stock),purchases=rows(stock.pembelian);
    const available=CuttingPlan.availability(root,stock),material=available.materials[materialKey];
    const unit=CuttingPlan.unitOf(stock,jenis),references=productionReferences(root),usage=new Map();
    let reason='';
    function invalid(message){if(!reason)reason=message;}
    if(!CuttingPlan.validUnit(unit))invalid('Satuan bahan tidak valid. Periksa Stok Bahan terlebih dahulu.');
    if(!material||material.invalid||!Number.isFinite(quantity(material.stock))||!Number.isFinite(quantity(material.available)))invalid('Saldo atau satuan bahan belum valid. Periksa transaksi dan pemakaian dahulu.');
    const names=purchases.map(p=>p.jenisBahan).concat(rows(stock.adjustment).map(a=>a.jenisBahan));
    purchases.filter(p=>norm(p.jenisBahan)===materialKey).forEach(p=>{
      if(!Number.isFinite(quantity(p.kg)))invalid('Jumlah pembelian bahan belum valid. Periksa transaksi terlebih dahulu.');
      if(p.unit&&p.unit!==unit)invalid('Satuan pembelian berbeda dari satuan bahan.');
    });
    rows(stock.adjustment).filter(a=>norm(a.jenisBahan)===materialKey).forEach(a=>{
      if(!Number.isFinite(quantity(a.kg,true))||(a.unit&&a.unit!==unit))invalid('Jumlah atau satuan koreksi bahan belum valid.');
    });
    CuttingPlan.products(root).forEach(product=>{
      const ledger=Materials.inspect(product);
      ledger.entries.forEach(({entry})=>{
        const materials=Materials.bahan(entry);names.push(...materials.map(b=>b.jenis));
        materials.filter(b=>norm(b.jenis)===materialKey).forEach(b=>{
          if(!Number.isFinite(quantity(b.kg))||(b.unit&&b.unit!==unit))invalid('Jumlah atau satuan pemakaian bahan belum valid.');
        });
        rows(entry.rols).forEach(roll=>{
          const id=identity(roll.purchaseId);if(!id)return;
          const previous=usage.get(id)||{used:0,invalid:false},q=quantity(roll.kiloan==null?roll.kg:roll.kiloan);
          if(!Number.isFinite(q))previous.invalid=true;else previous.used+=q;
          usage.set(id,previous);
        });
      });
      if(ledger.issues.some(issue=>Materials.bahan(issue.entry).some(b=>norm(b.jenis)===materialKey)))invalid('Riwayat pemakaian bahan perlu diperiksa sebelum menghubungkan rol.');
    });
    CuttingPlan.plans(root).filter(plan=>['ready','in_progress','used'].includes(plan.status)).forEach(plan=>{
      [...rows(plan.rolls),...rows(plan.consumedRolls)].forEach(roll=>{
        const id=identity(roll.purchaseId),previous=usage.get(id)||{used:0,invalid:false};
        const purchase=purchases.find(p=>identity(p.id)===id);
        if(!Number.isFinite(quantity(roll.kg))||!CuttingPlan.validUnit(roll.unit||'kg')||
          (purchase&&(norm(roll.jenis)!==norm(purchase.jenisBahan)||(roll.unit||'kg')!==(purchase.unit||CuttingPlan.unitOf(stock,purchase.jenisBahan)))))previous.invalid=true;
        usage.set(id,previous);
      });
    });
    if(names.some(name=>keyOf(name)===key&&norm(name)!==materialKey))invalid('Beberapa nama bahan memakai kunci rincian yang sama. Periksa nama bahan terlebih dahulu.');
    const items=allPhysical.filter(item=>item.materialKey===key);
    const candidates=purchases.filter(p=>norm(p.jenisBahan)===materialKey).map(p=>{
      const id=identity(p.id),rolInfoId=identity(p.rolInfoId),matches=available.rolls.filter(r=>r.purchaseId===id),roll=matches[0];
      const history=usage.get(id)||{used:0,invalid:false},q=quantity(p.kg);
      const used=Math.max(roll&&roll.used||0,history.used),reserved=roll&&roll.reserved||0;
      let why=reason;
      if(!why&&(!safeId(p.id)||purchases.filter(other=>identity(other.id)===id).length!==1||matches.length!==1))why='Identitas pembelian kosong, tidak valid, atau ganda.';
      if(!why&&(!safeId(p.rolInfoId)||purchases.filter(other=>identity(other.rolInfoId)===rolInfoId).length!==1))why='Hubungan rincian pembelian tidak dikenal atau identitas rolnya ganda.';
      if(!why&&allPhysical.some(item=>identity(item.row.id)===rolInfoId))why='Pembelian sudah terhubung dengan rincian rol yang masih tercatat.';
      if(!why&&references.has(rolInfoId))why='Identitas rol pembelian masih dirujuk catatan produksi atau jatah potong.';
      if(!why&&(!Number.isFinite(q)||q<=0))why='Jumlah pembelian harus lebih dari nol dan valid.';
      if(!why&&(!roll||roll.invalid||!CuttingPlan.validUnit(p.unit||unit)||(p.unit||unit)!==unit||history.invalid||!Number.isFinite(quantity(used))||!Number.isFinite(quantity(reserved))))why='Satuan atau catatan pemakaian rol belum valid.';
      if(!why&&used>0)why='Rol pembelian sudah pernah dipakai; hubungan tidak dapat diganti.';
      if(!why&&reserved>0)why='Rol pembelian sudah dicadangkan untuk jatah potong.';
      return {purchaseId:id,rolInfoId,invoice:p.invoice||'',rolNum:p.rolNum||'',tanggal:p.tanggal||'',kg:q,unit:p.unit||unit,used,reserved,eligible:!why,reason:why};
    });
    const resultRows=items.map(item=>{
      const raw=item.row,id=identity(raw.id),linked=purchases.filter(p=>p.rolInfoId!=null&&identity(p.rolInfoId)===id);
      const q=quantity(raw.val==null?raw.kg:raw.val),remaining=physicalRemaining(available,item);
      let why=reason;
      if(!why&&(!safeId(raw.id)||allPhysical.filter(other=>identity(other.row.id)===id).length!==1))why='Identitas rincian rol kosong, tidak valid, atau ganda.';
      if(!why&&linked.length)why=linked.length===1?'Rincian rol sudah terhubung dengan pembelian.':'Hubungan pembelian pada rincian rol ini ganda.';
      if(!why&&(!Number.isFinite(q)||q<=0||(raw.unit&&raw.unit!==unit)))why='Jumlah atau satuan rincian rol belum valid.';
      if(!why&&(!Number.isFinite(remaining)||remaining<=0))why='Rol tidak memiliki sisa yang tersedia menurut saldo stok.';
      if(!why&&references.has(id))why='Identitas rincian rol masih dirujuk catatan produksi atau jatah potong.';
      return {detailId:id,val:q,remaining,note:raw.note||'',purchaseId:linked.length===1?identity(linked[0].id):null,editable:!why,reason:why};
    });
    return {root,stock,key,materialKey,unit,material,available,items,allPhysical,purchases,candidates,resultRows,reason};
  }
  function transition(ctx,selection){
    const out=clone(ctx.stock);
    selection.forEach(({item,purchase})=>setId(out,item,purchase.rolInfoId));
    const after=CuttingPlan.availability(ctx.root,out);
    if(JSON.stringify(after.materials)!==JSON.stringify(ctx.available.materials))throw new Error('Hubungan ini mengubah saldo atau jatah bahan. Perubahan tidak disimpan.');
    ctx.allPhysical.forEach(item=>{
      const info=out.rolInfo[item.materialKey],row=(item.legacy?info:info.rols)[item.rowKey];
      if(scaled(physicalRemaining(ctx.available,item))!==scaled(physicalRemaining(after,{...item,row})))throw new Error('Hubungan ini mengubah perkiraan sisa rol. Periksa rincian fisik dan tanggal pembelian dahulu.');
    });
    Object.entries(ctx.available.projections).filter(([key])=>key!==ctx.materialKey).forEach(([key,value])=>{
      if(JSON.stringify(value)!==JSON.stringify(after.projections[key]))throw new Error('Hubungan ini mengubah rincian bahan lain. Perubahan tidak disimpan.');
    });
    const unrelated=available=>available.rolls.filter(r=>norm(r.jenis)!==ctx.materialKey);
    if(JSON.stringify(unrelated(ctx.available))!==JSON.stringify(unrelated(after)))throw new Error('Hubungan ini mengubah ketersediaan pembelian bahan lain. Perubahan tidak disimpan.');
    return out;
  }
  function inspect(root,stock,jenis){
    const ctx=context(root,stock,jenis);
    const resultRows=ctx.resultRows.map((row,index)=>({...row,candidates:ctx.candidates.map(candidate=>{
      let reason=row.reason||candidate.reason;
      if(!reason&&scaled(candidate.kg)<scaled(row.val))reason='Jumlah pembelian lebih kecil daripada jumlah rincian fisik rol.';
      if(!reason){
        try{transition(ctx,[{item:ctx.items[index],purchase:ctx.purchases.find(p=>identity(p.id)===candidate.purchaseId)}]);}
        catch(error){reason=error.message;}
      }
      return {...candidate,eligible:!reason,reason};
    })}));
    return {material:ctx.material?ctx.material.name:String(jenis).trim(),jenis:String(jenis).trim(),key:ctx.key,unit:ctx.unit,
      stock:ctx.material?ctx.material.stock:0,reserved:ctx.material?ctx.material.reserved:0,available:ctx.material?ctx.material.available:0,
      valid:!ctx.reason,reason:ctx.reason,rows:resultRows,candidates:ctx.candidates};
  }
  function prepare(root,stock,jenis,mappings){
    if(!Array.isArray(mappings)||!mappings.length)throw new Error('Pilih setidaknya satu hubungan rol dan pembelian.');
    const ctx=context(root,stock,jenis),detailIds=new Set(),purchaseIds=new Set(),targetIds=new Set(),selection=[],changes=[];
    if(ctx.reason)throw new Error(ctx.reason);
    mappings.forEach(mapping=>{
      if(!mapping||!safeId(mapping.detailId)||!safeId(mapping.purchaseId))throw new Error('Pilih rincian rol dan pembelian yang valid.');
      const detailId=identity(mapping.detailId),purchaseId=identity(mapping.purchaseId);
      if(detailIds.has(detailId))throw new Error('Rincian rol yang sama dipilih lebih dari sekali.');
      if(purchaseIds.has(purchaseId))throw new Error('Satu pembelian tidak boleh dihubungkan ke dua rincian rol.');
      detailIds.add(detailId);purchaseIds.add(purchaseId);
      const index=ctx.resultRows.findIndex(row=>row.detailId===detailId),row=ctx.resultRows[index];
      if(!row)throw new Error('Rincian rol sudah dihapus atau berubah. Buka ulang data terbaru.');
      if(!row.editable)throw new Error(row.reason);
      const candidates=ctx.candidates.filter(candidate=>candidate.purchaseId===purchaseId),candidate=candidates[0];
      if(candidates.length!==1)throw new Error('Pembelian tidak ditemukan, ganda, atau jenis bahannya berbeda.');
      if(!candidate.eligible)throw new Error(candidate.reason);
      if(scaled(candidate.kg)<scaled(row.val))throw new Error('Jumlah pembelian lebih kecil daripada jumlah rincian fisik rol.');
      if(targetIds.has(candidate.rolInfoId))throw new Error('Dua rincian tidak boleh memakai identitas rol tujuan yang sama.');
      targetIds.add(candidate.rolInfoId);
      const purchase=ctx.purchases.find(p=>identity(p.id)===purchaseId);
      selection.push({item:ctx.items[index],purchase});
      changes.push({detailId,purchaseId,rolInfoId:candidate.rolInfoId,val:row.val,remaining:row.remaining,unit:ctx.unit,invoice:candidate.invoice,rolNum:candidate.rolNum});
    });
    return {stock:transition(ctx,selection),changes};
  }
  return {inspect,prepare};
});
