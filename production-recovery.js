/* Explicit per-product recovery. Pure: no network, storage, or automatic choices. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./production-sync.js'));
  else root.ProductionRecovery=factory(root.ProductionSync);
})(typeof globalThis!=='undefined'?globalThis:this,function(Sync){
  'use strict';
  function plan(base,local,remote,choices){
    choices=choices||{};
    const valid=x=>x==null||(typeof x==='object'&&!Array.isArray(x));
    if(![base,local,remote].every(valid))return {ok:false,conflicts:['Format induk perlu diperiksa'],items:[]};
    base=base||{};local=local||{};remote=remote||{};
    if(![base.images,local.images,remote.images].every(valid))return {ok:false,conflicts:['Format peta gambar perlu diperiksa'],items:[]};
    const collection=value=>value==null||Array.isArray(value)||(typeof value==='object'&&value!==null);
    if(![base.produksi,local.produksi,remote.produksi].every(collection))return {ok:false,conflicts:['Format daftar produksi perlu diperiksa'],items:[]};
    const b=Sync.rows(base.produksi),l=Sync.rows(local.produksi),r=Sync.rows(remote.produksi);
    const index=rows=>{const map=new Map();for(const row of rows){if(!row||typeof row!=='object'||Array.isArray(row))return null;const id=Sync.key(row.id);if(id===null||map.has(id))return null;map.set(id,row);}return map;};
    const bm=index(b),lm=index(l),rm=index(r);
    if(!bm||!lm||!rm)return {ok:false,conflicts:['Identitas barang kosong atau ganda'],items:[]};
    const items=[],out=[],conflicts=[];
    const chosen=new Set(choices.serverProducts||[]),chosenImages=new Set(choices.serverImages||[]);
    for(const id of new Set([...rm.keys(),...lm.keys(),...bm.keys()])){
      const before=bm.get(id),draft=lm.get(id),server=rm.get(id);
      const fields=[...new Set([...Object.keys(before||{}),...Object.keys(draft||{})])].filter(k=>k!=='id');
      const row=x=>x?[x]:[];
      const result=Sync.merge(row(before),row(draft),row(server),{fields,allowCreate:true,allowDelete:true});
      if(!result.ok){
        const accepted=chosen.has(id),label=draft||server||before;
        items.push({type:'product',id,name:label.namaBarang||id,size:label.size||'',series:label.series||'',base:Sync.clone(before),draft:Sync.clone(draft),server:Sync.clone(server),conflicts:result.conflicts,accepted});
        // Choose the entire server product so count/QC/warehouse links stay
        // coherent. All local alternatives remain in the journal's recovery copy.
        if(server)out.push(Sync.clone(server));
        if(!accepted)conflicts.push(...result.conflicts);
      }else out.push(...result.value);
    }
    const images=Sync.mergeMap(base.images,local.images,remote.images);
    for(const id of images.conflicts){
      const accepted=chosenImages.has(id);
      items.push({type:'image',id,name:id,conflicts:['Gambar diubah pada dua perangkat'],accepted});
      if(!accepted)conflicts.push('gambar/'+id);
    }
    // Never apply root-level replacement from a draft. Preserve other apps' data.
    return {ok:!conflicts.length,value:Object.assign({},Sync.clone(remote),{produksi:out,images:images.value}),conflicts,items};
  }
  return {plan};
});
