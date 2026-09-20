/* Raw server journals with a normalized, non-publishing UI view. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./app-sync-journal.js'));
  else root.ProductionJournal=factory(root.AppSyncJournal);
})(typeof globalThis!=='undefined'?globalThis:this,function(AppSyncJournal){
  'use strict';
  const clone=AppSyncJournal.clone,equal=AppSyncJournal.equal;
  const own=(object,key)=>object!=null&&Object.prototype.hasOwnProperty.call(object,key);
  const rowId=row=>row&&typeof row==='object'&&row.id!=null&&row.id!==''?String(row.id):null;
  function project(raw,view,current){
    if(equal(view,current))return clone(raw);
    if(Array.isArray(current)&&Array.isArray(view)){
      // Firebase array holes are null placeholders, not ID-less business rows.
      // Ignore only those placeholders when aligning the compact UI view; the
      // original raw shape is returned unchanged for a no-op projection above.
      const rawRows=(Array.isArray(raw)?raw:raw&&typeof raw==='object'?Object.values(raw):[]).filter(row=>row!=null);
      if(rawRows.length!==view.length&&rawRows.some(row=>rowId(row)===null))throw new Error('Catatan lama tanpa identitas berubah saat ditampilkan. Ekspor salinan untuk diperiksa; data pusat tidak ditimpa.');
      const used=new Set();
      const output=current.map((entry,index)=>{
        const id=rowId(entry);
        let matches=[];
        view.forEach((old,i)=>{if(!used.has(i)&&(id!==null?rowId(old)===id:equal(old,entry)))matches.push(i);});
        let found=matches.length===1?matches[0]:-1;
        // An ID-less edited legacy row can retain its original position only
        // when the collection length is unchanged and identity is unambiguous.
        if(found<0&&id===null&&current.length===view.length&&!used.has(index)&&rowId(view[index])===null){
          const equivalent=view.filter(old=>equal(old,view[index])).length;
          if(equivalent===1)found=index;
        }
        if(found<0)return clone(entry);
        used.add(found);
        let original=rawRows[found];
        const oldId=rowId(view[found]);
        if(oldId!==null){const candidates=rawRows.filter(row=>rowId(row)===oldId);if(candidates.length===1)original=candidates[0];}
        if(original===undefined&&!equal(view[found],entry))throw new Error('Catatan lama hasil penyesuaian tampilan perlu diperiksa sebelum diubah. Ekspor salinan dahulu.');
        return project(original,view[found],entry);
      }).filter(entry=>entry!==undefined);
      // Rows hidden by a read-only view (for example deletion filters) are not
      // an operator's deletion. Keep them unless they were in the editable view.
      rawRows.forEach(entry=>{
        const id=rowId(entry);
        if(id!==null&&!view.some(old=>rowId(old)===id))output.push(clone(entry));
      });
      return output;
    }
    if(current&&typeof current==='object'&&!Array.isArray(current)&&view&&typeof view==='object'&&!Array.isArray(view)){
      const out=Object.create(null);
      if(raw&&typeof raw==='object'&&!Array.isArray(raw))Object.keys(raw).forEach(key=>{out[key]=clone(raw[key]);});
      for(const key of new Set([...Object.keys(view),...Object.keys(current)])){
        if(equal(view[key],current[key])&&own(view,key)===own(current,key))continue;
        if(!own(current,key)){delete out[key];continue;}
        const value=project(raw&&raw[key],view[key],current[key]);
        if(value===undefined)delete out[key];else out[key]=value;
      }
      return out;
    }
    return clone(current);
  }
  function create(options){
    const journal=AppSyncJournal.create(options),toView=options.toView||clone;
    let rawVisible,viewBaseline,projectionFailure=null;
    function display(raw){rawVisible=clone(raw);viewBaseline=toView(clone(raw));return clone(viewBaseline);}
    function initialize(cache,hasData){
      journal.seedLegacy(cache,hasData);
      const state=journal.status();
      return display(state.baseKnown||state.pending?journal.current():cache);
    }
    function acceptRemote(raw,target){
      if(projectionFailure)return {apply:false,error:projectionFailure.error};
      const result=journal.acceptRemote(raw,target);
      return result.apply?{...result,value:display(result.value)}:result;
    }
    function stage(view,target){
      let draft;
      try{draft=project(rawVisible,viewBaseline,view);}catch(e){projectionFailure={error:e.message,view:clone(view),raw:clone(rawVisible)};return false;}
      if(equal(draft,rawVisible))return !journal.status().foreignPending&&journal.status().durable;
      const saved=journal.stage(draft,target);
      rawVisible=clone(draft);viewBaseline=clone(view);
      return saved;
    }
    async function flush(io){if(projectionFailure)throw new Error(projectionFailure.error);const result=await journal.flush(io);return {...result,value:display(result.value)};}
    function useRemote(raw,target){if(projectionFailure)return false;if(!journal.useRemote(raw,target))return false;display(raw);return true;}
    function resumeSavedDraft(){if(projectionFailure||!journal.resumeSavedDraft())return false;display(journal.current());return true;}
    function status(){return projectionFailure?{...journal.status(),pending:true,durable:false,conflict:true,error:projectionFailure.error+' Jangan muat ulang; ekspor salinan perubahan.'}:journal.status();}
    function exportState(){return JSON.stringify({journal:JSON.parse(journal.exportState()),projectionFailure},null,2);}
    return {initialize,acceptRemote,stage,flush,useRemote,resumeSavedDraft,status,exportState,current:()=>clone(viewBaseline),rawCurrent:journal.current};
  }
  return {create,project};
});
