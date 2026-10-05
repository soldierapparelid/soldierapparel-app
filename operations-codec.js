/* Reviewed operational schema only. No Firebase, storage, payroll or access grants. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SoldierOperationsCodec=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // Keep this browser-safe copy aligned with security/finance-schema.cjs.
  const id={kind:'id'},text={kind:'text'},date={kind:'date'},count={kind:'count'},bool={kind:'bool'};
  const common={id,tanggal:date,inputAt:text,editedAt:text,cancelled:bool,canceled:bool,deleted:bool,isDeleted:bool,cancelledAt:text,canceledAt:text,deletedAt:text};
  const rows={
    potong:{...common,jumlah:count},
    assignJahit:{...common,tukangId:id,qty:count,sisa:count,targetTanggal:date},
    jahit:{...common,jumlah:count,rijek:count,lolos:count,tukangId:id,assignmentId:id,quantityBasis:{kind:'enum',values:['good-plus-reject']}},
    hitungFisik:{...common,jumlah:count,tukangId:id,qcId:id,workflowVersion:{kind:'enum',values:[2]},countStage:{kind:'enum',values:['verified']},payrollCancelled:bool,payrollCancelledAt:text},
    qc:{...common,ok:count,reject:count,perbaikan:count,kotor:count,offline:count,hfId:id,tukangId:id,qcBatchId:id,workflowVersion:{kind:'enum',values:[2]},autoFromCount:bool,payrollCancelled:bool,payrollCancelledAt:text},
    gudang:{...common,jumlah:count,status:{kind:'enum',values:['ok','kotor','perbaikan','reject','offline']},qcId:id,hfId:id,workflowVersion:{kind:'enum',values:[2]},tukangId:id,payrollCancelled:bool,payrollCancelledAt:text,payrollStage:{kind:'enum',values:['initial','repair']}},
    bigSaller:{...common,jumlah:count,qcId:id,hfId:id,gudangId:id},
    bigSeller:{...common,jumlah:count,qcId:id,hfId:id,gudangId:id}
  };
  const product={id,series:text,namaBarang:text,size:text,poAktif:bool,poJumlah:count,poTanggal:date,needsVerify:bool};
  const archive={id,tanggalArsip:date};
  const schema={rows,product,archive};
  const MAX_NODES=250000,MAX_DEPTH=32;
  const reserved=new Set(['__proto__','constructor','prototype']);
  const safeId=value=>typeof value==='string'&&value.length>0&&value.length<=128&&!reserved.has(value)&&/^[a-zA-Z0-9_-]+$/.test(value);
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  function fail(code){throw new Error(code);}
  function assertJson(value,depth,state,ancestors){
    if(++state.nodes>MAX_NODES||depth>MAX_DEPTH)fail('operations_invalid_json');
    if(value===null||typeof value==='boolean'||typeof value==='string')return;
    if(typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER)return;
    if(!value||typeof value!=='object')fail('operations_invalid_json');
    if(ancestors.has(value))fail('operations_invalid_json');
    if(!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('operations_invalid_json');
    if(Array.isArray(value)&&Object.getPrototypeOf(value)!==Array.prototype)fail('operations_invalid_json');
    ancestors.add(value);
    const keys=Reflect.ownKeys(value);
    for(const key of keys){
      if(typeof key!=='string'||reserved.has(key))fail('operations_invalid_json');
      if(Array.isArray(value)&&key==='length')continue;
      const descriptor=Object.getOwnPropertyDescriptor(value,key);
      if(!descriptor||!Object.hasOwn(descriptor,'value')||descriptor.enumerable!==true)fail('operations_invalid_json');
      if(Array.isArray(value)&&(!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=value.length))fail('operations_invalid_json');
      assertJson(descriptor.value,depth+1,state,ancestors);
    }
    // A JSON array has explicit nulls, never holes or custom properties.
    if(Array.isArray(value)&&keys.length!==value.length+1)fail('operations_invalid_json');
    ancestors.delete(value);
  }
  function inspectJson(value){assertJson(value,0,{nodes:0},new Set());}
  function copy(value){
    if(Array.isArray(value))return value.map(copy);
    if(object(value))return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,copy(item)]));
    return value;
  }
  function valid(value,rule){
    if(rule.kind==='id')return safeId(value);
    if(rule.kind==='text')return typeof value==='string'&&value.length<=256&&!/[\u0000-\u001f\u007f]/.test(value);
    if(rule.kind==='date')return typeof value==='string'&&(value===''||/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value);
    if(rule.kind==='count')return Number.isSafeInteger(value)&&value>=0;
    if(rule.kind==='bool')return typeof value==='boolean';
    return rule.kind==='enum'&&rule.values.includes(value);
  }
  function record(value,fields,kind){
    if(!object(value)||!Object.hasOwn(value,'id')||!safeId(value.id))fail('operations_invalid_id');
    for(const [key,item]of Object.entries(value)){
      if(Object.hasOwn(fields,key)){
        if(!valid(item,fields[key]))fail('operations_invalid_value');
      }else if(kind&&Object.hasOwn(rows,key)){
        if(['bigSaller','bigSeller'].includes(key)&&typeof item==='boolean')continue;
        collection(item,rows[key]);
      }else if(kind==='product'&&key==='arsip'){
        if(typeof item==='boolean')continue;
        collection(item,archive,'archive');
      }else fail('operations_unknown_field');
    }
  }
  function collection(value,fields,kind){
    if(value===null)return;
    if(!Array.isArray(value)&&!object(value))fail('operations_invalid_collection');
    const seen=new Set();
    for(const [key,item]of Object.entries(value)){
      if(item===null){if(!Array.isArray(value))fail('operations_invalid_id');continue;}
      record(item,fields,kind);
      if(seen.has(item.id))fail('operations_duplicate_id');
      seen.add(item.id);
      if(!Array.isArray(value)&&(!safeId(key)||key!==item.id))fail('operations_key_id_mismatch');
    }
  }
  function decode(productsMap){
    inspectJson(productsMap);
    if(!object(productsMap))fail('operations_invalid_map');
    const out=[];
    for(const [key,value]of Object.entries(productsMap)){
      record(value,product,'product');
      if(!safeId(key)||key!==value.id)fail('operations_key_id_mismatch');
      out.push(copy(value));
    }
    return out;
  }
  function encode(productsView){
    inspectJson(productsView);
    if(!Array.isArray(productsView))fail('operations_invalid_view');
    const out={};
    for(const value of productsView){
      record(value,product,'product');
      if(Object.hasOwn(out,value.id))fail('operations_duplicate_id');
      out[value.id]=copy(value);
    }
    return out;
  }
  const mergeFields=[...Object.keys(product).filter(key=>key!=='id'),...Object.keys(rows),'arsip'];
  function mergeOptions(options){
    if(options===undefined)return {fields:mergeFields.slice()};
    inspectJson(options);
    if(!object(options)||Object.keys(options).some(key=>!['fields','guardFields','allowCreate','allowDelete'].includes(key)))fail('operations_invalid_merge_options');
    const out={fields:mergeFields.slice()};
    for(const key of ['fields','guardFields'])if(Object.hasOwn(options,key)){
      const list=options[key];
      if(!Array.isArray(list)||new Set(list).size!==list.length||list.some(field=>typeof field!=='string'||!mergeFields.includes(field)))fail('operations_invalid_merge_options');
      out[key]=list.slice();
    }
    for(const key of ['allowCreate','allowDelete'])if(Object.hasOwn(options,key)){
      if(typeof options[key]!=='boolean')fail('operations_invalid_merge_options');
      out[key]=options[key];
    }
    return out;
  }
  function merge(baseMap,localMap,remoteMap,productionMerge,options){
    if(typeof productionMerge!=='function')fail('operations_invalid_merge_function');
    const base=decode(baseMap),local=decode(localMap),remote=decode(remoteMap),settings=mergeOptions(options);
    const result=productionMerge(base,local,remote,settings);
    if(!result||typeof result.ok!=='boolean'||!Array.isArray(result.conflicts)||result.conflicts.some(item=>typeof item!=='string'))fail('operations_invalid_merge_result');
    // The old merge may return a best-effort remote view on conflict. It is not
    // an approved write candidate, so never expose it as this codec's value.
    if(!result.ok||result.conflicts.length)return {ok:false,conflicts:result.conflicts.slice()};
    return {ok:true,value:encode(result.value),conflicts:[]};
  }
  function createMerge(productionMerge,options){
    if(typeof productionMerge!=='function')fail('operations_invalid_merge_function');
    const settings=mergeOptions(options);
    return (base,local,remote)=>merge(base,local,remote,productionMerge,settings);
  }
  function freeze(value){
    if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}
    return value;
  }
  freeze(schema);
  return Object.freeze({schema,safeId,encode,decode,merge,createMerge});
});
