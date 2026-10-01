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
  function planKey(root,planId){
    const found=Object.entries(root&&root.cuttingPlans||{}).filter(([,p])=>p&&String(p.id)===String(planId));
    if(found.length!==1)throw new Error('Identitas jatah tidak ditemukan atau ganda.');
    return found[0][0];
  }
  const SELECTED_MODE='per-result-v1',SELECTED_TAG='owner-plan-selected-rolls';
  function assignedRollMap(plan){
    const expected=new Map();
    rows(plan.rolls).forEach(r=>{
      const key=String(r.purchaseId==null?'':r.purchaseId);
      if(!key||expected.has(key)||!norm(r.jenis)||!validUnit(r.unit||'kg'))throw new Error('Rincian jatah bahan tidak valid.');
      number(r.kg,'Jumlah jatah',false);expected.set(key,r);
    });
    if(!expected.size)throw new Error('Rincian jatah bahan belum tersedia.');
    return expected;
  }
  function selectedLedger(root,plan){
    const expected=assignedRollMap(plan),actual=new Map(),declared=new Map();
    function add(map,key,n){map.set(key,(map.get(key)||0)+n);}
    function equal(a,b){return a.size===b.size&&[...a].every(([k,v])=>b.get(k)===v);}
    let found=false;
    products(root).forEach(p=>Materials.inspect(p).entries.forEach(({entry:e})=>{
      if(String(e.cuttingPlanId)!==String(plan.id))return;
      if(!rows(plan.products).some(ref=>String(ref.id)===String(p.id))||e.materialAllocation!==SELECTED_TAG||!e.id||!e.materialBatchId)throw new Error('Hubungan hasil dengan bahan pilihan berubah.');
      found=true;const material=new Map(),listed=new Map(),seen=new Set();let kg=0;
      rows(e.rols).forEach(r=>{
        const key=String(r.purchaseId),assigned=expected.get(key),unit=r.unit||'kg',q=units(number(r.kiloan==null?r.kg:r.kiloan,'Pemakaian rol',true));
        if(!assigned||seen.has(key)||norm(r.jenis)!==norm(assigned.jenis)||unit!==(assigned.unit||'kg')||(r.kg!=null&&units(number(r.kg,'Pemakaian rol',true))!==q))throw new Error('Rincian pemakaian rol berubah.');
        seen.add(key);if(q){add(actual,key,q);add(material,JSON.stringify([norm(r.jenis),unit]),q);}if(unit==='kg')kg+=q;
      });
      rows(e.bahanList).forEach(b=>{const q=units(number(b.kg,'Pemakaian bahan',true));if(q)add(listed,JSON.stringify([norm(b.jenis),b.unit||'kg']),q);});
      if(!equal(material,listed)||units(number(e.kiloan,'Pemakaian kilogram',true))!==kg)throw new Error('Rincian bahan hasil potong tidak seimbang.');
    }));
    rows(plan.consumedRolls).forEach(r=>{
      const key=String(r.purchaseId),assigned=expected.get(key);
      if(!assigned||declared.has(key)||norm(r.jenis)!==norm(assigned.jenis)||(r.unit||'kg')!==(assigned.unit||'kg'))throw new Error('Catatan bahan yang sudah dipakai berubah.');
      declared.set(key,units(number(r.kg,'Bahan yang sudah dipakai',false)));
    });
    if(!found||!actual.size||!equal(actual,declared)||[...actual].some(([key,q])=>q>units(Number(expected.get(key).kg))))throw new Error('Catatan bahan pilihan belum lengkap atau berubah. Minta owner memeriksa; jangan input ulang.');
    return actual;
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
    if(plan.materialMode===SELECTED_MODE){selectedLedger(root,plan);return;}
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
      const selected=plan.materialMode===SELECTED_MODE;
      const consumed=new Map(rows(plan.consumedRolls).map(r=>[String(r.purchaseId),units(Number(r.kg)||0)]));
      rows(plan.rolls).forEach(r=>{
        const roll=byId.get(String(r.purchaseId)),kg=units(Number(r.kg)||0);
        if(roll&&plan.status==='ready'&&(r.unit||'kg')!==roll.unit)material(r.jenis).invalid=true;
        const used=selected?(consumed.get(String(r.purchaseId))||0):(plan.status==='ready'?0:kg);
        const reserved=plan.status==='ready'?kg:selected&&plan.status==='in_progress'?Math.max(0,kg-used):0;
        if(roll){roll.used+=used;roll.reserved+=reserved;}
        if(reserved)material(r.jenis).reserved+=reserved;
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
    const out=rootCopy(root);out.cuttingPlans=Object.assign({},out.cuttingPlans);out.cuttingPlans[planKey(root,planId)]={...clone(plan),status:'cancelled'};return out;
  }
  // Exclude only this allowance's reservation while retaining material already
  // consumed by earlier results. Other PO reservations remain in force.
  function withoutReservation(root,planId){
    const plan=findPlan(root,planId),out=rootCopy(root);out.cuttingPlans=Object.assign({},out.cuttingPlans);
    out.cuttingPlans[planKey(root,planId)]={...clone(plan),status:plan.materialMode===SELECTED_MODE?'used':'cancelled'};return out;
  }
  function materialChoices(root,stock,planId){
    const plan=findPlan(root,planId);checkProducts(root,plan);
    if(!['ready','in_progress'].includes(plan.status))throw new Error('Jatah sudah selesai atau dibatalkan.');
    if((stock.settings&&stock.settings.resetDate||'')!==plan.stockBaseline)throw new Error('Awal perhitungan stok berubah. Minta owner memeriksa jatah ini.');
    if(plan.status==='in_progress'&&plan.materialMode!==SELECTED_MODE){requireRecordedMaterial(root,plan);return {mode:'legacy',recorded:true,rolls:[],canContinueWithoutMaterial:true};}
    if(plan.materialMode===SELECTED_MODE)requireRecordedMaterial(root,plan);
    const used=new Map(rows(plan.consumedRolls).map(r=>[String(r.purchaseId),units(Number(r.kg)||0)])),available=availability(withoutReservation(root,planId),stock);
    return {mode:'selected',recorded:plan.materialMode===SELECTED_MODE,canContinueWithoutMaterial:plan.materialMode===SELECTED_MODE&&plan.status==='in_progress',rolls:rows(plan.rolls).map(r=>{
      const spent=used.get(String(r.purchaseId))||0,left=Math.max(0,units(Number(r.kg))-spent),matches=available.rolls.filter(x=>x.purchaseId===String(r.purchaseId)),roll=matches[0],m=available.materials[norm(r.jenis)];
      const valid=matches.length===1&&!roll.invalid&&m&&!m.invalid&&validUnit(roll.unit)&&roll.unit===(r.unit||'kg')&&norm(roll.jenis)===norm(r.jenis);
      const cap=valid?Math.max(0,Math.min(left,units(roll.available),units(m.available))):0;
      return {...clone(r),assigned:Number(r.kg),used:amount(spent),remaining:amount(left),available:amount(cap),reason:!left?'Sudah dicatat untuk jatah ini':!valid?'Data rol atau satuan berubah; minta owner periksa':cap<left?'Sisa stok tercatat tidak cukup untuk seluruh jatah; minta owner periksa':''};
    })};
  }
  function selectedRolls(root,plan,selection){
    if(plan.status==='in_progress'&&plan.materialMode!==SELECTED_MODE)throw new Error('Bahan jatah lama sudah dicatat seluruhnya. Hasil susulan tidak memakai bahan lagi.');
    if(plan.materialMode===SELECTED_MODE)requireRecordedMaterial(root,plan);
    if(!Array.isArray(selection))throw new Error('Pilih bahan yang dipakai untuk hasil ini.');
    const expected=assignedRollMap(plan),used=new Map(rows(plan.consumedRolls).map(r=>[String(r.purchaseId),units(Number(r.kg)||0)])),seen=new Set();
    const picked=selection.map(row=>{
      const key=String(row.purchaseId),r=expected.get(key),q=number(row.kg,'Jumlah bahan dipakai',false);
      if(!r||seen.has(key))throw new Error('Pilih rol dari jatah owner; jangan pilih rol yang sama dua kali.');seen.add(key);
      if(units(q)>units(Number(r.kg))-(used.get(key)||0))throw new Error('Jumlah bahan melebihi sisa jatah rol '+r.rolNum+'.');
      return {...clone(r),kg:q};
    });
    if(!picked.length&&!(plan.materialMode===SELECTED_MODE&&plan.status==='in_progress'))throw new Error('Pilih paling sedikit satu bahan yang dipakai untuk hasil ini.');
    return picked;
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
    const perResult=own(meta,'materialSelection');
    if(plan.materialMode===SELECTED_MODE&&!perResult)throw new Error('Jatah memakai pilihan bahan per hasil. Muat ulang Potong versi terbaru sebelum menyimpan.');
    if(perResult&&products(root).some(p=>Materials.inspect(p).entries.some(({entry:e})=>String(e.materialBatchId||'')===batchId)))throw new Error('Identitas pengiriman hasil sudah digunakan. Periksa riwayat; jangan dicatat dua kali.');
    const chosen=perResult?selectedRolls(root,plan,meta.materialSelection):rows(plan.rolls);
    const rolls=chosen.map((r,i)=>({...r,nomor:i+1,kiloan:number(r.kg,'Jumlah bahan',false)}));
    const bahanList=rolls.map(r=>({jenis:r.jenis,kg:r.kg,...(r.unit?{unit:r.unit}:{})}));
    const kiloan=amount(rolls.filter(r=>(r.unit||'kg')==='kg').reduce((n,r)=>n+units(r.kg),0));
    const continuation=plan.status==='in_progress'&&!perResult;
    if(continuation)requireRecordedMaterial(root,plan);
    const allocated=continuation||!rolls.length?positive.map(()=>({kiloan:0,rols:[],bahanList:[]})):Materials.allocateBatch(positive.map(x=>x.qty),{kiloan,rols:rolls,bahanList});
    // Legacy field names kg/kiloan on material rows hold native quantities.
    // The top-level kiloan stays weight-only: never add yards/meters to kg.
    allocated.forEach(part=>{part.kiloan=amount(part.bahanList.filter(b=>(b.unit||'kg')==='kg').reduce((sum,b)=>sum+units(b.kg),0));});
    return positive.map((x,i)=>{
      const tarif=number(typeof meta.tarif==='object'?meta.tarif[x.p.id]:meta.tarif,'Tarif potong',true);
      return {productId:String(x.p.id),entry:{id:batchId+'-'+x.p.id,cuttingPlanId:plan.id,materialBatchId:batchId,materialAllocation:perResult?SELECTED_TAG:continuation?'owner-plan-recorded-earlier':'owner-plan-by-pcs',tanggal:meta.tanggal,jumlah:x.qty,tukangId:meta.tukangId,tukangNama:String(meta.tukangNama||''),tarif,total:x.qty*tarif,dibayar:false,...allocated[i],jenisBahan:(rolls[0]||rows(plan.rolls)[0]).jenis}};
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
      const perResult=first.materialAllocation===SELECTED_TAG,selectionTotals=new Map();
      if(perResult)added.forEach(x=>rows(x.entry.rols).forEach(r=>{const key=String(r.purchaseId),q=units(number(r.kiloan==null?r.kg:r.kiloan,'Bahan dipakai',true));if(q)selectionTotals.set(key,(selectionTotals.get(key)||0)+q);}));
      const materialSelection=[...selectionTotals].map(([purchaseId,q])=>({purchaseId,kg:amount(q)}));
      if(perResult){const chosen=selectedRolls(root,plan,materialSelection);if(chosen.length)checkCapacity(withoutReservation(out,planId),stock,{...plan,rolls:chosen});}
      else if(plan.status==='ready')checkCapacity(cancel(out,planId),stock,plan);
      else requireRecordedMaterial(root,plan);
      added.forEach(x=>{
        if(own(quantities,x.productId))throw new Error('Satu jatah hanya boleh disimpan sekali per ukuran.');
        if(x.entry.materialBatchId!==first.materialBatchId||x.entry.tanggal!==first.tanggal||x.entry.tukangId!==first.tukangId)throw new Error('Satu penyimpanan hasil harus memiliki tanggal dan petugas yang sama.');
        quantities[x.productId]=x.entry.jumlah;rates[x.productId]=x.entry.tarif;
      });
      const expected=buildCuts(root,planId,quantities,{id:first.materialBatchId,tanggal:first.tanggal,tukangId:first.tukangId,tukangNama:first.tukangNama,tarif:rates,...(perResult?{materialSelection}:{})});
      if(expected.length!==added.length||expected.some(x=>!added.some(a=>a.productId===x.productId&&a.entry.id===x.entry.id&&materialSignature(a.entry)===materialSignature(x.entry))))throw new Error('Kain atau jumlah bahan berbeda dari jatah admin. Tidak disimpan.');
      const done=completedIds(plan);added.forEach(x=>done.add(x.productId));
      const finished=rows(plan.products).every(ref=>done.has(String(ref.id)));
      const selectedState={};
      if(perResult){
        const prior=new Map(rows(plan.consumedRolls).map(r=>[String(r.purchaseId),units(Number(r.kg)||0)]));
        selectionTotals.forEach((q,key)=>prior.set(key,(prior.get(key)||0)+q));
        selectedState.materialMode=SELECTED_MODE;selectedState.consumedRolls=rows(plan.rolls).filter(r=>(prior.get(String(r.purchaseId))||0)>0).map(r=>({...clone(r),kg:amount(prior.get(String(r.purchaseId)))}));
      }
      out.cuttingPlans=Object.assign({},out.cuttingPlans);out.cuttingPlans[planKey(root,planId)]={...clone(plan),...selectedState,status:finished?'used':'in_progress',completedProductIds:[...done],usedBatchId:plan.usedBatchId||first.materialBatchId,usedAt:plan.usedAt||first.tanggal,lastCutAt:first.tanggal};
    });
    out.produksi=clone(rows(nextProducts));return out;
  }
  // Owner-only material completion. Move selected reservations to the ORIGINAL
  // recorded batch; no new cutting result, payroll or stock adjustment is made.
  function supplementContext(root,sourceId,targetId){
    const source=findPlan(root,sourceId),target=findPlan(root,targetId);
    if(target.materialMode===SELECTED_MODE)throw new Error('Hasil ini memakai pilihan bahan per hasil. Jangan gabungkan melalui pelengkapan jatah lama; minta owner memeriksa bahan yang dicatat.');
    if(source===target||source.status!=='ready'||!['used','in_progress'].includes(target.status))throw new Error('Pilih jatah yang belum dipakai dan hasil potong yang sudah tersimpan.');
    const sourceProducts=checkProducts(root,source),targetProducts=checkProducts(root,target);
    if(poKey(sourceProducts[0])!==poKey(targetProducts[0]))throw new Error('Bahan tambahan harus untuk model dan PO yang sama.');
    const allowed=new Set(sourceProducts.map(p=>String(p.id))),refs=new Set(targetProducts.map(p=>String(p.id))),batch=[],seen=new Set(),seenProducts=new Set();
    products(root).forEach(p=>{
      if([...rows(p.potong),...rows(p.arsip).flatMap(a=>rows(a.potong))].some(e=>String(e.cuttingPlanId)===String(source.id)))throw new Error('Jatah sumber sudah memiliki catatan pemakaian. Periksa riwayat sebelum menambahkan bahan.');
      if(rows(p.arsip).some(a=>rows(a.potong).some(e=>String(e.cuttingPlanId)===String(target.id))))throw new Error('Hasil potong juga ada di arsip. Periksa catatan sebelum melengkapi bahan.');
      rows(p.potong).filter(e=>String(e.cuttingPlanId)===String(target.id)).forEach(e=>{
        if(!refs.has(String(p.id))||!e.id||seen.has(String(e.id))||seenProducts.has(String(p.id))||!Number.isSafeInteger(Number(e.jumlah))||Number(e.jumlah)<=0||!/^\d{4}-\d{2}-\d{2}$/.test(e.tanggal||''))throw new Error('Identitas hasil potong tidak lengkap atau ganda.');
        seen.add(String(e.id));seenProducts.add(String(p.id));
        if(e.materialBatchId===target.usedBatchId)batch.push({productId:String(p.id),cycle:cycle(p),size:p.size||'',entry:clone(e)});
        else if(rows(e.rols).some(r=>Number(r.kiloan==null?r.kg:r.kiloan)>0)||rows(e.bahanList).some(b=>Number(b.kg)>0))throw new Error('Bahan jatah tercatat di luar hasil awal. Periksa riwayat.');
      });
    });
    if(!batch.length||batch.some(x=>!allowed.has(x.productId)))throw new Error('Ukuran hasil awal tidak sesuai dengan jatah bahan tambahan.');
    batch.sort((a,b)=>a.productId.localeCompare(b.productId)||String(a.entry.id).localeCompare(String(b.entry.id)));
    const expected=new Map();
    rows(target.rolls).forEach(r=>{const key=String(r.purchaseId);if(!r.purchaseId||expected.has(key)||!validUnit(r.unit||'kg'))throw new Error('Rincian rol jatah awal tidak valid.');number(r.kg,'Bahan awal',false);expected.set(key,r);});
    batch.forEach(({entry:e})=>{
      const material=new Map(),declared=new Map();let kg=0;
      rows(e.rols).forEach(r=>{
        const wanted=expected.get(String(r.purchaseId)),unit=r.unit||'kg',q=number(r.kiloan==null?r.kg:r.kiloan,'Bahan tercatat',true);
        if(!wanted||norm(wanted.jenis)!==norm(r.jenis)||(wanted.unit||'kg')!==unit||(r.kg!=null&&units(Number(r.kg))!==units(q)))throw new Error('Hubungan rol hasil potong berubah.');
        const key=JSON.stringify([norm(r.jenis),unit]);material.set(key,(material.get(key)||0)+units(q));if(unit==='kg')kg+=units(q);
      });
      rows(e.bahanList).forEach(b=>{const key=JSON.stringify([norm(b.jenis),b.unit||'kg']);declared.set(key,(declared.get(key)||0)+units(number(b.kg,'Bahan tercatat',true)));});
      if(material.size!==declared.size||[...material].some(([k,v])=>declared.get(k)!==v)||units(number(e.kiloan,'Berat tercatat',true))!==kg)throw new Error('Jumlah bahan awal tidak konsisten. Periksa catatan asli.');
    });
    requireRecordedMaterial(root,target);
    return {source,target,batch,pcs:batch.reduce((sum,x)=>sum+Number(x.entry.jumlah),0)};
  }
  function supplementTargets(root,sourceId){
    return plans(root).flatMap(target=>{
      try{const ctx=supplementContext(root,sourceId,target.id);return [{planId:String(target.id),pcs:ctx.pcs,sizes:ctx.batch.map(x=>x.size),tanggal:ctx.batch[0].entry.tanggal,rollCount:rows(target.rolls).length,label:(target.namaBarang||'Hasil potong')+' · '+ctx.batch.map(x=>x.size).join(', ')+' · '+ctx.pcs+' pcs · '+ctx.batch[0].entry.tanggal}];}catch(_){return [];}
    });
  }
  function supplementReceipt(root,command){
    const receipt=root&&root.cuttingMaterialAdditions&&root.cuttingMaterialAdditions[command.id];
    return !!receipt&&same(receipt.command,command);
  }
  function prepareSupplement(root,stock,input){
    const ctx=supplementContext(root,input.sourcePlanId,input.targetPlanId),ids=rows(ctx.source.rolls).map(r=>String(r.purchaseId));
    const selected=(input.purchaseIds||[]).map(String);
    if(!selected.length||new Set(selected).size!==selected.length||selected.some(k=>!ids.includes(k)))throw new Error('Centang rol tambahan yang benar-benar dipakai.');
    if(!/^\d{4}-\d{2}-\d{2}T/.test(input.createdAt||''))throw new Error('Waktu pelengkapan bahan tidak valid.');
    const command={id:id(input.id,'pelengkapan bahan'),sourcePlanId:String(ctx.source.id),targetPlanId:String(ctx.target.id),purchaseIds:selected.slice().sort(),createdAt:input.createdAt,
      sourceSnapshot:clone(ctx.source),targetSnapshot:clone(ctx.target),batchSnapshot:clone(ctx.batch),pcs:ctx.pcs,rolls:clone(rows(ctx.source.rolls).filter(r=>selected.includes(String(r.purchaseId))))};
    supplement(root,stock,command);return command;
  }
  function supplement(root,stock,command){
    id(command.id,'pelengkapan bahan');
    if(supplementReceipt(root,command))return rootCopy(root);
    if(!/^\d{4}-\d{2}-\d{2}T/.test(command.createdAt||''))throw new Error('Waktu pelengkapan bahan tidak valid.');
    if(root&&root.cuttingMaterialAdditions&&own(root.cuttingMaterialAdditions,command.id))throw new Error('Identitas pelengkapan sudah dipakai dengan rincian lain.');
    if(!stock||typeof stock!=='object')throw new Error('Stok Bahan terbaru belum tersedia.');
    const ctx=supplementContext(root,command.sourcePlanId,command.targetPlanId),{source,target,batch}=ctx;
    if(!same(source,command.sourceSnapshot)||!same(target,command.targetSnapshot)||!same(batch,command.batchSnapshot)||ctx.pcs!==command.pcs)throw new Error('Jatah atau hasil potong berubah. Tutup pilihan dan periksa ulang data terbaru.');
    const ids=(command.purchaseIds||[]).map(String),selected=rows(source.rolls).filter(r=>ids.includes(String(r.purchaseId))),targetIds=new Set(rows(target.rolls).map(r=>String(r.purchaseId)));
    if(!ids.length||new Set(ids).size!==ids.length||new Set(rows(source.rolls).map(r=>String(r.purchaseId))).size!==rows(source.rolls).length||selected.length!==ids.length||!same(selected,command.rolls))throw new Error('Pilihan rol tambahan tidak valid atau berubah.');
    if(selected.some(r=>targetIds.has(String(r.purchaseId))))throw new Error('Rol ini sudah tercatat pada hasil yang dipilih. Jangan tambahkan rol yang sama dua kali.');
    const baseline=stock.settings&&stock.settings.resetDate||'';
    if(source.stockBaseline!==baseline||target.stockBaseline!==baseline||batch.some(x=>x.entry.tanggal<baseline))throw new Error('Awal stok berubah. Periksa catatan sebelum melengkapi bahan.');
    const out=rootCopy(root),sourceKey=Object.keys(out.cuttingPlans).find(k=>out.cuttingPlans[k]&&String(out.cuttingPlans[k].id)===String(source.id)),targetKey=Object.keys(out.cuttingPlans).find(k=>out.cuttingPlans[k]&&String(out.cuttingPlans[k].id)===String(target.id));
    const left=rows(source.rolls).filter(r=>!ids.includes(String(r.purchaseId)));
    out.cuttingPlans[sourceKey]={...clone(source),rolls:clone(left),status:left.length?'ready':'merged',materialTransfers:[...rows(source.materialTransfers),{id:command.id,targetPlanId:target.id,rolls:clone(selected),createdAt:command.createdAt}]};
    // Removing only the selected reservations leaves other PO/roll reservations
    // intact while capacity is rechecked against the latest atomic snapshot.
    checkCapacity(out,stock,{rolls:selected});
    const stockRolls=availability(out,stock).rolls;
    if(selected.some(r=>{const found=stockRolls.find(s=>s.purchaseId===String(r.purchaseId));return found&&found.tanggal&&batch.some(x=>found.tanggal>x.entry.tanggal);}))throw new Error('Tanggal pembelian rol sesudah hasil potong. Periksa pilihan bahan.');
    const allocated=Materials.allocateBatch(batch.map(x=>Number(x.entry.jumlah)),{bahanList:selected.map(r=>({jenis:r.jenis,kg:r.kg,...(r.unit?{unit:r.unit}:{})})),rols:selected.map(r=>({...r,kiloan:r.kg}))});
    batch.forEach((item,i)=>{
      const p=products(out).find(p=>String(p.id)===item.productId),entry=rows(p.potong).find(e=>String(e.id)===String(item.entry.id)),part=allocated[i];
      const kg=part.bahanList.filter(b=>(b.unit||'kg')==='kg').reduce((sum,b)=>sum+units(b.kg),0);
      entry.kiloan=amount(units(entry.kiloan)+kg);
      entry.bahanList=[...rows(entry.bahanList),...part.bahanList];
      const count=rows(entry.rols).length;entry.rols=[...rows(entry.rols),...part.rols.map((r,j)=>({...r,nomor:count+j+1}))];
    });
    out.cuttingPlans[targetKey]={...clone(target),rolls:[...rows(target.rolls),...clone(selected)],materialAdditions:[...rows(target.materialAdditions),{id:command.id,sourcePlanId:source.id,rolls:clone(selected),createdAt:command.createdAt}]};
    requireRecordedMaterial(out,out.cuttingPlans[targetKey]);
    out.cuttingMaterialAdditions={...out.cuttingMaterialAdditions,[command.id]:{command:clone(command)}};
    return out;
  }
  return {products,plans,activePOs,uncutPOs,matchesPlan,remainingPlanProducts,cycle,unitOf,unitLabel,validUnit,quantityTotals,formatQuantities,projectRolls,availability,makePlan,issue,cancel,materialChoices,buildCuts,applyCuts,supplementTargets,prepareSupplement,supplement,supplementReceipt};
});
