/* Three-way production merge. Pure: never mutates input or guesses conflicting history. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.ProductionSync=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
  function stable(x){
    if(Array.isArray(x))return '['+x.map(stable).join(',')+']';
    if(x && typeof x==='object')return '{'+Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';
    return JSON.stringify(x);
  }
  const equal=(a,b)=>stable(a)===stable(b);
  // Realtime Database removes empty arrays instead of returning them. Treat
  // an absent/empty collection as the same history, never as boolean false.
  const emptyCollection=x=>x==null||(Array.isArray(x)&&x.length===0);
  const fieldEqual=(a,b)=>equal(a,b)||((Array.isArray(a)||Array.isArray(b))&&emptyCollection(a)&&emptyCollection(b));
  function key(id){return (typeof id==='string'&&id.trim()!=='')||(typeof id==='number'&&Number.isFinite(id))?String(id):null;}
  function rows(value){return Array.isArray(value)?value.filter(x=>x!=null):value&&typeof value==='object'?Object.values(value).filter(x=>x!=null):[];}
  function indexed(values){
    const map=new Map();
    for(const row of values){if(!row||typeof row!=='object'||Array.isArray(row))return null;const id=key(row.id);if(id===null||map.has(id))return null;map.set(id,row);}
    return map;
  }
  function mergeField(base,local,remote,path,conflicts){
    if(fieldEqual(local,base))return clone(remote);
    if(Array.isArray(local)){
      const seen=new Set();
      for(const row of local){
        if(!row||typeof row!=='object'||Array.isArray(row)){conflicts.push(path+': catatan tidak valid');return clone(remote);}
        const id=key(row.id);
        if(id!==null&&seen.has(id)){conflicts.push(path+': identitas catatan ganda');return clone(remote);}
        if(id!==null)seen.add(id);
      }
    }
    if(fieldEqual(remote,base)||fieldEqual(local,remote))return clone(local);
    // Concurrent history edits merge only with unambiguous IDs. Legacy ID-less
    // histories are preserved for manual review rather than matched by quantity.
    if(Array.isArray(local)&&Array.isArray(remote)&&(Array.isArray(base)||base==null)){
      const bm=indexed(base||[]),lm=indexed(local),rm=indexed(remote);
      if(bm&&lm&&rm){
        const result=[];
        for(const id of new Set([...rm.keys(),...lm.keys(),...bm.keys()])){
          const b=bm.get(id),l=lm.get(id),r=rm.get(id);
          let row;
          if(equal(l,b))row=r;
          else if(equal(r,b)||equal(l,r))row=l;
          else {conflicts.push(path+'/'+id);row=r;}
          if(row!==undefined)result.push(clone(row));
        }
        return result;
      }
    }
    conflicts.push(path);return clone(remote);
  }
  function merge(baseValue,localValue,remoteValue,options){
    options=options||{};
    const base=rows(baseValue),local=rows(localValue),remote=rows(remoteValue);
    const bm=indexed(base),lm=indexed(local),rm=indexed(remote),conflicts=[];
    if(!bm||!lm||!rm)return {ok:false,value:clone(remote),conflicts:['Identitas barang kosong atau ganda']};
    const fields=options.fields||[],out=[];
    for(const id of new Set([...rm.keys(),...lm.keys()])){
      const b=bm.get(id),l=lm.get(id),r=rm.get(id);
      const changed=!!l&&fields.some(f=>!fieldEqual(l[f],b&&b[f]));
      if(!r){
        if(changed){
          if(!b&&options.allowCreate===true)out.push(clone(l));
          else conflicts.push(id+': barang sudah dihapus/tidak ada di induk');
        }
        continue;
      }
      if(!l&&b&&options.allowDelete===true){
        // Only the master may delete a product, and only if nobody changed it
        // since the master read it. A deletion never wins by record count.
        if(!equal(r,b)){conflicts.push(id+': barang berubah saat akan dihapus');out.push(clone(r));}
        continue;
      }
      if(!l||!changed){out.push(clone(r));continue;}
      if(!b){conflicts.push(id+': dasar edit belum tersedia');out.push(clone(r));continue;}
      const guarded=options.guardFields||['arsip','poAktif'];
      if(guarded.some(f=>!fieldEqual(b[f],r[f]))){conflicts.push(id+': siklus PO berubah');out.push(clone(r));continue;}
      const merged=clone(r);
      for(const f of fields){
        if(!fieldEqual(l[f],b[f])){
          const value=mergeField(b[f],l[f],r[f],id+'/'+f,conflicts);
          if(value===undefined)delete merged[f];else merged[f]=value;
        }
      }
      out.push(merged);
    }
    return {ok:conflicts.length===0,value:out,conflicts};
  }
  function mergeMap(base,local,remote){
    const valid=x=>x==null||(typeof x==='object'&&!Array.isArray(x));
    if(!valid(base)||!valid(local)||!valid(remote))return {ok:false,value:clone(remote),conflicts:['Peta data tidak valid']};
    base=base||{};local=local||{};remote=remote||{};
    const out={},conflicts=[];
    for(const id of new Set([...Object.keys(remote),...Object.keys(local),...Object.keys(base)])){
      const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k)?o[k]:undefined;
      const b=own(base,id),l=own(local,id),r=own(remote,id);
      let value;
      if(equal(l,b))value=r;
      else if(equal(r,b)||equal(l,r))value=l;
      else {conflicts.push(id);value=r;}
      // defineProperty also keeps a literal __proto__ key as data.
      if(value!==undefined)Object.defineProperty(out,id,{value:clone(value),enumerable:true,writable:true,configurable:true});
    }
    return {ok:conflicts.length===0,value:out,conflicts};
  }
  return {merge,mergeMap,rows,equal,clone,key};
});
