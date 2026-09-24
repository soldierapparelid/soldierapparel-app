/* Reconcile only explicit current-cycle cut deletions in the same transaction
 * as the Laporan merge. Never infer lost receipts or repair existing orphans. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./production-materials.js'),require('./cutting-plan.js'));
  else root.CuttingPlanReconcile=factory(root.ProductionMaterials,root.CuttingPlan);
})(typeof globalThis!=='undefined'?globalThis:this,function(Materials,Plans){
  'use strict';
  const clone=x=>JSON.parse(JSON.stringify(x)),rows=Materials.rows,norm=Materials.norm,SCALE=1000000;
  const fail=message=>{throw new Error(message+' Data tidak diubah.');};
  const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
  const key=x=>(typeof x==='string'&&x.trim()!=='')||(typeof x==='number'&&Number.isFinite(x))?String(x):null;
  const active=p=>p&&(p.poAktif===true||p.poAktif===1||p.poAktif==='true');
  // Compare Firebase's wire meaning, including numeric-key maps and empty lists.
  function canonical(x){
    if(x==null)return 'null';
    if(typeof x!=='object')return JSON.stringify(x);
    const parts=Object.keys(x).sort().map(k=>[k,canonical(x[k])]).filter(p=>p[1]!=='null');
    return parts.length?'{'+parts.map(p=>JSON.stringify(p[0])+':'+p[1]).join(',')+'}':'null';
  }
  const same=(a,b)=>canonical(a)===canonical(b);
  function list(value,label){
    if(value==null)return [];
    if(typeof value!=='object')fail(label+' tidak valid.');
    const values=Object.values(value).filter(x=>x!=null);
    if(values.some(x=>!object(x)))fail(label+' tidak valid.');
    return values;
  }
  function index(value,label){
    const map=new Map();
    list(value,label).forEach(p=>{const id=key(p.id);if(id===null||map.has(id))fail('Identitas '+label+' kosong atau ganda.');map.set(id,p);});
    return map;
  }
  function quantity(value){
    const n=Number(value),q=Math.round(n*SCALE);
    if(value==null||typeof value==='boolean'||String(value).trim()===''||!Number.isFinite(n)||n<0||!Number.isSafeInteger(q)||Math.abs(n-q/SCALE)>1e-9)fail('Jumlah bahan jatah tidak valid; periksa catatan asli.');
    return q;
  }
  function sum(map,k,n){const total=(map.get(k)||0)+n;if(!Number.isSafeInteger(total))fail('Jumlah bahan di luar batas.');map.set(k,total);}
  const positive=map=>new Map([...map].filter(([,n])=>n!==0));
  function equalTotals(a,b){a=positive(a);b=positive(b);return a.size===b.size&&[...a].every(([k,n])=>b.get(k)===n);}
  const materialKey=(name,unit)=>JSON.stringify([norm(name),unit||'kg']);
  function materialState(entry,expected){
    const rollTotals=new Map(),materials=new Map(),declared=new Map();
    list(entry.rols,'Rincian rol').forEach(r=>{
      const id=key(r.purchaseId),roll=expected.get(id),unit=r.unit||'kg';
      if(!roll||norm(r.jenis)!==norm(roll.jenis)||unit!==(roll.unit||'kg'))fail('Hubungan rol hasil potong berubah; periksa catatan asli.');
      const q=quantity(r.kiloan==null?r.kg:r.kiloan);
      if(r.kg!=null&&quantity(r.kg)!==q)fail('Jumlah rol hasil potong tidak konsisten.');
      sum(rollTotals,id,q);sum(materials,materialKey(r.jenis,unit),q);
    });
    list(entry.bahanList,'Rincian bahan').forEach(b=>{
      if(!norm(b.jenis)||!Plans.validUnit(b.unit||'kg'))fail('Rincian bahan hasil potong tidak valid.');
      sum(declared,materialKey(b.jenis,b.unit),quantity(b.kg));
    });
    const kg=[...materials].filter(([k])=>JSON.parse(k)[1]==='kg').reduce((n,[,q])=>n+q,0);
    if(!equalTotals(materials,declared)||quantity(entry.kiloan)!==kg)fail('Catatan bahan awal tidak lengkap atau berubah; periksa catatan asli.');
    return {rollTotals,hasMaterial:[...rollTotals.values()].some(n=>n>0)};
  }
  function materialSignature(e){return canonical([e.tanggal,e.cuttingPlanId,e.materialBatchId,e.materialAllocation,e.jenisBahan,e.kiloan,e.bahanList,e.rols,e.materialTransferSources]);}
  function archiveRows(p){return rows(p&&p.arsip).flatMap(a=>rows(a.potong));}
  function reconcile(beforeRoot,nextProducts){
    if(!beforeRoot||typeof beforeRoot!=='object')fail('Data produksi pusat belum tersedia.');
    const beforeProducts=Array.isArray(beforeRoot)?beforeRoot:beforeRoot.produksi;
    const before=index(beforeProducts,'barang'),after=index(nextProducts,'barang'),affected=new Set();
    // Removing an old receipt would return historical cloth while its old
    // plan still occupies the roll. That requires a separate audited repair,
    // never reopening a plan from an earlier cycle. Exact archive/current
    // movement and removal of an identical mirrored copy retain the receipt.
    before.forEach((p,pid)=>{
      const next=after.get(pid);
      if(same(p.arsip,next&&next.arsip))return;
      const retained=[...rows(next&&next.potong),...archiveRows(next)];
      archiveRows(p).filter(e=>e.cuttingPlanId!=null).forEach(e=>{
        if(retained.some(n=>same(n,e)))return;
        const eid=key(e.id),planId=key(e.cuttingPlanId);
        if(eid===null||planId===null)fail('Hasil potong arsip tanpa identitas jatah yang jelas tidak dapat dihapus otomatis.');
        // A non-material edit does not remove its linked material receipt.
        if(retained.some(n=>key(n.id)===eid&&key(n.cuttingPlanId)===planId&&materialSignature(n)===materialSignature(e)))return;
        fail('Hasil potong arsip masih terkait jatah bahan. Penghapusan harus diperiksa bersama riwayat bahan; jatah lama tidak dibuka otomatis.');
      });
    });
    // A stable receipt moved unchanged to an archive is not a deletion. An
    // archived-only edit never changes a current plan's completion state.
    before.forEach((p,pid)=>{
      const next=after.get(pid);
      if(same(p.potong,next&&next.potong))return;
      const current=rows(next&&next.potong),archived=archiveRows(next);
      rows(p.potong).filter(e=>e.cuttingPlanId!=null).forEach(e=>{
        const eid=key(e.id),planId=key(e.cuttingPlanId);
        if(eid===null){if(!current.some(n=>same(n,e))&&!archived.some(n=>same(n,e)))fail('Hasil potong tanpa identitas tidak dapat dihapus otomatis.');return;}
        if(rows(p.potong).filter(n=>key(n.id)===eid).length!==1)fail('Identitas hasil potong ganda; penghapusan tidak dapat dibuktikan.');
        const matches=current.filter(n=>key(n.id)===eid);
        if(matches.length){
          if(matches.length!==1||key(matches[0].cuttingPlanId)!==planId)fail('Hubungan hasil potong dengan jatah berubah atau ganda.');
          return;
        }
        const history=archived.filter(n=>key(n.id)===eid);
        if(history.length){if(history.length===1&&same(history[0],e))return;fail('Hasil potong di arsip berbeda atau ganda.');}
        if(planId===null)fail('Identitas jatah hasil potong tidak valid.');
        affected.add(planId);
      });
    });
    const out=Array.isArray(beforeRoot)?{produksi:clone(beforeRoot)}:clone(beforeRoot);
    out.produksi=clone(nextProducts);
    if(!affected.size)return out;
    const outputProducts=index(out.produksi,'barang');
    const planEntries=Object.entries(beforeRoot.cuttingPlans||{});
    affected.forEach(planId=>{
      const found=planEntries.filter(([,p])=>p&&key(p.id)===planId);
      if(found.length!==1)fail('Jatah hasil potong tidak ditemukan atau ganda.');
      const [planKey,plan]=found[0];
      if(!['in_progress','used'].includes(plan.status))fail('Jatah sudah dibatalkan atau statusnya tidak sesuai; periksa catatan asli.');
      const refs=index(plan.products,'ukuran jatah');
      if(!refs.size||key(plan.usedBatchId)===null)fail('Hubungan jatah dengan hasil awal tidak lengkap.');
      let missingProduct=false;
      refs.forEach((ref,pid)=>{
        const p=before.get(pid),next=after.get(pid);
        if(!p||!active(p)||typeof ref.cycle!=='string'||Plans.cycle(p)!==ref.cycle)fail('Jatah berasal dari siklus PO lain; periksa catatan asli.');
        if(!next){missingProduct=true;return;}
        if(!active(next)||Plans.cycle(next)!==ref.cycle)fail('Siklus PO berubah bersamaan dengan penghapusan hasil potong.');
      });
      const expected=new Map();
      list(plan.rolls,'Rol jatah').forEach(r=>{
        const id=key(r.purchaseId);
        if(id===null||expected.has(id)||!norm(r.jenis)||!Plans.validUnit(r.unit||'kg')||quantity(r.kg)<=0)fail('Rol jatah kosong, ganda, atau tidak valid.');
        expected.set(id,r);
      });
      if(!expected.size)fail('Rol jatah belum tersedia.');
      function receipts(products){
        const result=new Map(),seenProducts=new Set();
        products.forEach((p,pid)=>{
          if(archiveRows(p).some(e=>key(e.cuttingPlanId)===planId))fail('Hasil jatah juga ada di arsip; periksa hubungan siklus sebelum menghapus.');
          const current=refs.has(pid)?list(p.potong,'Riwayat potong'):rows(p.potong);
          current.filter(e=>key(e.cuttingPlanId)===planId).forEach(e=>{
            const id=key(e.id);
            if(!refs.has(pid)||id===null||result.has(id)||seenProducts.has(pid)||key(e.materialBatchId)===null||!Number.isSafeInteger(Number(e.jumlah))||Number(e.jumlah)<=0||!/^\d{4}-\d{2}-\d{2}$/.test(e.tanggal||''))fail('Hubungan hasil potong dengan ukuran jatah tidak valid atau ganda.');
            const state=materialState(e,expected);
            if(state.hasMaterial&&e.materialBatchId!==plan.usedBatchId)fail('Catatan bahan tidak berasal dari penyimpanan awal jatah.');
            seenProducts.add(pid);result.set(id,{pid,entry:e,...state});
          });
        });
        return result;
      }
      const old=receipts(before),remaining=receipts(after),removed=[...old].filter(([id])=>!remaining.has(id)).map(([,r])=>r);
      if(!removed.length)fail('Penghapusan hasil potong tidak dapat dibuktikan.');
      remaining.forEach((r,id)=>{const prior=old.get(id);if(!prior||prior.pid!==r.pid||materialSignature(prior.entry)!==materialSignature(r.entry))fail('Bahan atau hubungan hasil potong berubah bersamaan dengan penghapusan.');});
      const recorded=new Map();old.forEach(r=>r.rollTotals.forEach((n,id)=>sum(recorded,id,n)));
      if(!equalTotals(recorded,new Map([...expected].map(([id,r])=>[id,quantity(r.kg)]))))fail('Catatan bahan awal tidak lengkap atau berubah; periksa catatan asli.');
      const updated=clone(plan);
      if(!remaining.size){
        updated.status=missingProduct?'cancelled':'ready';updated.completedProductIds=[];
        delete updated.usedBatchId;delete updated.usedAt;delete updated.lastCutAt;
      }else{
        if(missingProduct)fail('Ukuran yang masih terkait hasil potong tidak dapat dihapus. Hapus hasil terkait bersama dahulu.');
        removed.filter(r=>r.hasMaterial).forEach(source=>{
          const candidates=[...remaining.values()].filter(r=>r.entry.tanggal===source.entry.tanggal).sort((a,b)=>key(a.entry.id).localeCompare(key(b.entry.id)));
          if(!candidates.length)fail('Bahan awal masih dipakai hasil potong tanggal lain. Hapus hasil terkait bersama agar jatah dapat dibuka kembali.');
          const target=candidates[0],targetProduct=outputProducts.get(target.pid),entry=rows(targetProduct.potong).find(e=>key(e.id)===key(target.entry.id));
          entry.kiloan=(quantity(entry.kiloan)+quantity(source.entry.kiloan))/SCALE;
          entry.bahanList=[...rows(entry.bahanList),...clone(rows(source.entry.bahanList))];
          entry.rols=[...rows(entry.rols),...clone(rows(source.entry.rols))];
          entry.materialBatchId=plan.usedBatchId;entry.materialAllocation='owner-plan-material-transferred';
          entry.materialTransferSources=[...rows(entry.materialTransferSources),{productId:source.pid,receipt:clone(source.entry)}];
        });
        const completed=new Set([...remaining.values()].map(r=>r.pid));
        updated.completedProductIds=[...refs.keys()].filter(id=>completed.has(id));
        updated.status=updated.completedProductIds.length===refs.size?'used':'in_progress';
        updated.lastCutAt=[...remaining.values()].map(r=>r.entry.tanggal).sort().at(-1);
        // Validate the actual output too, so every transferred micro-unit and
        // roll identity is conserved before the caller commits the transaction.
        const actual=new Map();receipts(outputProducts).forEach(r=>r.rollTotals.forEach((n,id)=>sum(actual,id,n)));
        if(!equalTotals(actual,recorded))fail('Pemindahan catatan bahan tidak seimbang.');
      }
      Object.defineProperty(out.cuttingPlans,planKey,{value:updated,enumerable:true,writable:true,configurable:true});
    });
    return out;
  }
  return {reconcile};
});
