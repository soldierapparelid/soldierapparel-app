(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SoldierLegacyStoredHistory=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // This is a pure stored-value reader, not an authentication or migration API.
  // A trusted server caller must resolve the binding before constructing it.
  const LIMITS=Object.freeze({products:2000,archivesPerProduct:256,archives:8192,sourceRows:40000,records:4096,copies:8192,viewBytes:1048576});
  const COVERAGE='stored-jahit-potong-current-and-direct-archives';
  const BINDING_KEYS=['projectId','databaseURL','tenantId','uid','workerId','division','grantRevision'];
  const STORED_KEYS=['tanggal','jumlah','lolos','rijek','kiloan','tarif','total','dibayar','quantityBasis'];
  const NUMBER_KEYS=new Set(['jumlah','lolos','rijek','kiloan','tarif','total']);
  const RESERVED=new Set(['__proto__','constructor','prototype']);
  const own=(v,k)=>Object.getOwnPropertyDescriptor(v,k);
  function fail(code){throw Error(code);}
  function object(v){return v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);}
  function data(v,k,required=false){
    if(!object(v))fail('invalid_source');
    const d=own(v,k);
    if(!d){if(required)fail('invalid_source');return {present:false};}
    if(!d.enumerable||!Object.hasOwn(d,'value'))fail('invalid_source');
    return {present:true,value:d.value};
  }
  function shape(v,allowed,required=allowed){
    if(!object(v))fail('invalid_source');
    const names=Reflect.ownKeys(v);
    if(names.some(k=>typeof k!=='string'||!allowed.includes(k))||required.some(k=>!names.includes(k)))fail('invalid_source');
    for(const k of names)data(v,k,true);
  }
  function safeId(v){return typeof v==='string'&&v.length>=1&&v.length<=128&&!RESERVED.has(v)&&/^[A-Za-z0-9_-]+$/.test(v);}
  function text(v,max=256){return typeof v==='string'&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);}
  function number(v){return typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=Number.MAX_SAFE_INTEGER&&!Object.is(v,-0);}
  function databaseOrigin(v){return typeof v==='string'&&v.length<=256&&/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.(?:firebaseio\.com|firebasedatabase\.app)$/.test(v);}
  function define(v,k,value){Object.defineProperty(v,k,{value,enumerable:true,writable:true,configurable:true});return v;}
  function append(v,value){define(v,String(v.length),value);return v;}
  function binding(v){
    shape(v,BINDING_KEYS);
    const out={};
    for(const k of BINDING_KEYS){
      const value=data(v,k,true).value;
      let valid;
      if(k==='division')valid=['jahit','potong'].includes(value);
      else if(k==='databaseURL')valid=databaseOrigin(value);
      else if(k==='grantRevision')valid=Number.isSafeInteger(value)&&value>=1;
      else if(k==='projectId')valid=text(value,30)&&/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value);
      else valid=safeId(value);
      if(!valid)fail('invalid_source');
      define(out,k,value);
    }
    return Object.freeze(out);
  }
  function sameBinding(a,b){return BINDING_KEYS.every(k=>data(a,k,true).value===data(b,k,true).value);}
  // Only collection descriptors are traversed. Unknown record fields are never
  // read, including getters, PINs, devices, accounts or internal finance data.
  function collection(value,max,visit,allowSparse=true){
    if(value===undefined||value===null)return;
    if(Array.isArray(value)){
      if(Object.getPrototypeOf(value)!==Array.prototype)fail('invalid_source');
      const length=own(value,'length');
      if(!length||!Object.hasOwn(length,'value')||!Number.isSafeInteger(length.value)||length.value<0)fail('invalid_source');
      if(length.value>max)fail('capacity_limit');
      const names=Reflect.ownKeys(value);
      if(names.some(k=>typeof k!=='string'||k!=='length'&&(!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=length.value)))fail('invalid_source');
      if(!allowSparse&&names.length!==length.value+1)fail('invalid_source');
      for(let i=0;i<length.value;i++){
        const d=own(value,String(i));if(!d){if(!allowSparse)fail('invalid_source');continue;}
        if(!d.enumerable||!Object.hasOwn(d,'value'))fail('invalid_source');
        if(d.value===null&&allowSparse)continue;
        visit(d.value);
      }
      return;
    }
    if(!object(value))fail('invalid_source');
    const names=Reflect.ownKeys(value);if(names.length>max)fail('capacity_limit');
    for(const k of names){
      if(typeof k!=='string'||k.length>128||RESERVED.has(k)||/[\u0000-\u001f\u007f]/.test(k))fail('invalid_source');
      const v=data(value,k,true).value;if(v===null&&allowSparse)continue;visit(v);
    }
  }
  function metadata(product){
    const out={};
    for(const k of ['series','namaBarang','size']){const d=data(product,k);if(d.present){if(d.value!==null&&!text(d.value))fail('invalid_source');define(out,k,d.value);}}
    return out;
  }
  function stored(row){
    const out={};
    for(const k of STORED_KEYS){
      const d=data(row,k);if(!d.present)continue;const v=d.value;
      if(v!==null){
        if(NUMBER_KEYS.has(k)){if(!number(v))fail('invalid_source');}
        else if(k==='dibayar'){if(typeof v!=='boolean'&&v!==0&&v!==1&&v!=='true'&&v!=='false')fail('invalid_source');}
        else if(!text(v,64))fail('invalid_source');
      }
      define(out,k,v);
    }
    return out;
  }
  // No object JSON hooks are called. Serialization/equality only walks fresh,
  // descriptor-checked allowlist data and JSON-encodes primitive values.
  function serialize(v){
    if(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number')return JSON.stringify(v);
    if(Array.isArray(v)){
      const parts=[];collection(v,LIMITS.copies,x=>append(parts,serialize(x)),false);return '['+parts.join(',')+']';
    }
    if(!object(v))fail('invalid_source');
    const names=Reflect.ownKeys(v);if(names.some(k=>typeof k!=='string'))fail('invalid_source');
    names.sort();const parts=[];for(const k of names)append(parts,JSON.stringify(k)+':'+serialize(data(v,k,true).value));return '{'+parts.join(',')+'}';
  }
  function bytes(textValue){let n=0;for(const c of textValue){const p=c.codePointAt(0);n+=p<=127?1:p<=2047?2:p<=65535?3:4;}return n;}
  function freeze(v){
    if(v&&typeof v==='object'){for(const k of Reflect.ownKeys(v)){if(k==='length')continue;const d=own(v,k);if(!d||!Object.hasOwn(d,'value'))fail('invalid_source');freeze(d.value);}Object.freeze(v);}
    return v;
  }
  function optionalId(v,k){const d=data(v,k);if(!d.present||d.value===null||d.value==='')return null;if(!safeId(d.value))fail('invalid_source');return d.value;}
  function recordKey(division,productId,rowId){return JSON.stringify(division)+'|'+JSON.stringify(productId)+'|'+JSON.stringify(rowId);}
  function viewBound(v){if(bytes(serialize(v))>LIMITS.viewBytes)fail('capacity_limit');return freeze(v);}
  function envelope(fixed,snapshotVersion,records){return {schemaVersion:1,binding:fixed,snapshotVersion,coverage:COVERAGE,availability:records===null?'unavailable':'available',records};}
  function project(source,fixed){
    shape(source,['snapshotVersion','products']);
    const version=data(source,'snapshotVersion',true).value;if(!safeId(version))fail('invalid_source');
    const products=data(source,'products',true).value;
    if(products===null)return viewBound(envelope(fixed,version,null));
    if(products===undefined)fail('invalid_source');
    const result=[],identities=new Map();let sourceRows=0,copies=0,archiveCount=0;
    collection(products,LIMITS.products,product=>{
      if(!object(product))fail('invalid_source');
      let productId,productMeta;
      function consume(container,location){
        const rows=data(container,fixed.division);
        if(!rows.present)return;
        collection(rows.value,LIMITS.sourceRows,row=>{
          if(++sourceRows>LIMITS.sourceRows)fail('capacity_limit');
          if(!object(row))fail('invalid_source');
          const worker=data(row,'tukangId');
          if(!worker.present||worker.value!==fixed.workerId)return;
          // Exact ID only. Labels, dates, quantities and inferred QC/gudang
          // links cannot supply an ownership or record identity fallback.
          if(productId===undefined){productId=data(product,'id',true).value;if(!safeId(productId))fail('invalid_source');productMeta=metadata(product);}
          if(++copies>LIMITS.copies)fail('capacity_limit');
          const record={workerId:fixed.workerId,division:fixed.division,productId,product:productMeta,stored:stored(row)};
          const rowId=optionalId(row,'id');if(rowId!==null)define(record,'sourceRecordId',rowId);
          const fingerprint=serialize(record),key=rowId===null?null:recordKey(fixed.division,productId,rowId);
          if(key!==null&&identities.has(key)){
            const previous=identities.get(key);if(previous.fingerprint!==fingerprint)fail('conflicting_record');
            append(previous.record.locations,location);previous.record.copyCount++;return;
          }
          if(result.length>=LIMITS.records)fail('capacity_limit');
          define(record,'locations',[location]);define(record,'copyCount',1);append(result,record);
          if(key!==null)identities.set(key,{fingerprint,record});
        });
      }
      consume(product,{type:'current'});
      const archives=data(product,'arsip');
      if(archives.present&&archives.value!==true){
        collection(archives.value,LIMITS.archivesPerProduct,archive=>{
          if(++archiveCount>LIMITS.archives)fail('capacity_limit');
          if(!object(archive))fail('invalid_source');
          const location={type:'archive'},archiveId=optionalId(archive,'id');if(archiveId!==null)define(location,'archiveId',archiveId);
          consume(archive,location);
        });
      }
    });
    return viewBound(envelope(fixed,version,result));
  }
  function normalize(value,expectedBinding){
    try{
      const fixed=binding(expectedBinding);
      shape(value,['schemaVersion','binding','snapshotVersion','coverage','availability','records']);
      if(data(value,'schemaVersion',true).value!==1||data(value,'coverage',true).value!==COVERAGE)fail('invalid_source');
      const actual=binding(data(value,'binding',true).value);if(!sameBinding(actual,fixed))fail('invalid_source');
      const version=data(value,'snapshotVersion',true).value;if(!safeId(version))fail('invalid_source');
      const availability=data(value,'availability',true).value,raw=data(value,'records',true).value;
      if(availability==='unavailable'){if(raw!==null)fail('invalid_source');return viewBound(envelope(fixed,version,null));}
      if(availability!=='available'||!Array.isArray(raw))fail('invalid_source');
      const records=[],identities=new Set();let copies=0;
      collection(raw,LIMITS.records,row=>{
        shape(row,['workerId','division','productId','product','stored','sourceRecordId','locations','copyCount'],['workerId','division','productId','product','stored','locations','copyCount']);
        if(data(row,'workerId',true).value!==fixed.workerId||data(row,'division',true).value!==fixed.division)fail('invalid_source');
        const productId=data(row,'productId',true).value;if(!safeId(productId))fail('invalid_source');
        const p=data(row,'product',true).value;shape(p,['series','namaBarang','size'],[]);
        const s=data(row,'stored',true).value;shape(s,STORED_KEYS,[]);
        const record={workerId:fixed.workerId,division:fixed.division,productId,product:metadata(p),stored:stored(s)};
        const id=data(row,'sourceRecordId');
        if(id.present){if(!safeId(id.value))fail('invalid_source');define(record,'sourceRecordId',id.value);const key=recordKey(fixed.division,productId,id.value);if(identities.has(key))fail('invalid_source');identities.add(key);}
        const locations=[];const rawLocations=data(row,'locations',true).value;if(!Array.isArray(rawLocations))fail('invalid_source');
        collection(rawLocations,LIMITS.copies,location=>{
          shape(location,['type','archiveId'],['type']);const type=data(location,'type',true).value;if(type!=='current'&&type!=='archive')fail('invalid_source');
          const next={type},archiveId=data(location,'archiveId');if(archiveId.present){if(type!=='archive'||!safeId(archiveId.value))fail('invalid_source');define(next,'archiveId',archiveId.value);}append(locations,next);
        },false);
        const count=data(row,'copyCount',true).value;
        if(!Number.isSafeInteger(count)||count<1||count!==locations.length||!id.present&&count!==1||(copies+=count)>LIMITS.copies)fail('invalid_source');
        define(record,'locations',locations);define(record,'copyCount',count);append(records,record);
      },false);
      return viewBound(envelope(fixed,version,records));
    }catch{fail('invalid_history');}
  }
  function createLegacyStoredHistoryProjector(options){
    // OFF never reads binding or source, and does not initialize any dependency.
    let enabled=false;try{const d=options&&typeof options==='object'?own(options,'enabled'):null;enabled=!!d&&Object.hasOwn(d,'value')&&d.value===true;}catch{}
    if(!enabled)return Object.freeze({project:()=>Object.freeze({ok:false,error:'service_disabled'})});
    let fixed;try{shape(options,['enabled','binding']);fixed=binding(data(options,'binding',true).value);}catch{return Object.freeze({project:()=>Object.freeze({ok:false,error:'invalid_binding'})});}
    return Object.freeze({project(source){
      try{return Object.freeze({ok:true,view:project(source,fixed)});}
      catch(error){
        let code='invalid_source';
        try{const d=error&&typeof error==='object'?own(error,'message'):null;if(d&&Object.hasOwn(d,'value')&&['capacity_limit','conflicting_record'].includes(d.value))code=d.value;}catch{}
        return Object.freeze({ok:false,error:code});
      }
    }});
  }
  return Object.freeze({createLegacyStoredHistoryProjector,normalizeLegacyStoredHistory:normalize,LIMITS,COVERAGE});
});
