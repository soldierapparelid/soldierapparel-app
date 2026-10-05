(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SoldierMaklonEarnings=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const reserved=new Set(['__proto__','constructor','prototype']);
  const recordFields=['sourceId','productId','series','namaBarang','size','tanggal','jumlah','tarif','total','sourceType','provisional'];
  const sourceTypes=new Set(['hitungFisik','qc','qcRepair','gudang']);
  const MAX_ENTRIES=20000;
  function fail(code){throw new Error(code);}
  function safeId(value){return typeof value==='string'&&value.length>0&&value.length<=128&&!reserved.has(value)&&/^[a-zA-Z0-9_-]+$/.test(value);}
  function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));}
  // Inspect data descriptors before reading them; never run getters from a payload.
  function keys(value){
    if(!object(value))fail('invalid_earnings');
    const names=Reflect.ownKeys(value);
    for(const key of names){
      if(typeof key!=='string'||reserved.has(key))fail('invalid_earnings');
      const descriptor=Object.getOwnPropertyDescriptor(value,key);
      if(!descriptor||!descriptor.enumerable||!Object.prototype.hasOwnProperty.call(descriptor,'value'))fail('invalid_earnings');
    }
    return names;
  }
  function shape(value,allowed,required=allowed){
    const names=keys(value);
    if(names.some(key=>!allowed.includes(key))||required.some(key=>!names.includes(key)))fail('invalid_earnings');
  }
  function text(value,nonempty){return typeof value==='string'&&value.length<=256&&!/[\u0000-\u001f\u007f]/.test(value)&&(!nonempty||!!value.trim());}
  function date(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000'))return false;
    const parsed=new Date(value+'T00:00:00.000Z');
    return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
  }
  function amount(value){return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER;}
  function target(profile,requestedOwnerId){
    try{
      // Profile comes from the authenticated, server-protected access record.
      // The caller must never manufacture it from URL, form or browser storage.
      const names=keys(profile);
      if(!names.includes('active')||profile.active!==true)fail('access_denied');
      const owner=names.includes('owner')?profile.owner:undefined;
      if(owner===true){
        if(!safeId(requestedOwnerId))fail('access_denied');
        return Object.freeze({workerId:requestedOwnerId,path:'maklonEarnings/'+requestedOwnerId});
      }
      if(owner!==undefined&&owner!==false)fail('access_denied');
      if(requestedOwnerId!==undefined||!names.includes('workerId')||!names.includes('modules')||!safeId(profile.workerId))fail('access_denied');
      const permissions=profile.modules;
      const permissionNames=keys(permissions);
      if(!permissionNames.some(name=>['potong','jahit'].includes(name)&&permissions[name]===true))fail('access_denied');
      if(permissionNames.some(name=>typeof permissions[name]!=='boolean'))fail('access_denied');
      return Object.freeze({workerId:profile.workerId,path:'maklonEarnings/'+profile.workerId});
    }catch{fail('access_denied');}
  }
  function entry(row,mapKey){
    shape(row,recordFields);
    if(typeof mapKey!=='string'||!/^[a-f0-9]{64}$/.test(mapKey)||row.sourceId!==mapKey||!safeId(row.productId))fail('invalid_earnings');
    if(!['series','namaBarang','size'].every(key=>text(row[key],false))||!date(row.tanggal))fail('invalid_earnings');
    if(!Number.isSafeInteger(row.jumlah)||row.jumlah<=0||!amount(row.tarif)||row.tarif<=0||!amount(row.total))fail('invalid_earnings');
    // Compare only to the already frozen historical tariff. No current tariff
    // lookup or rounding may change the amount displayed from this projection.
    // A count keeps its source identity after linked QC approval. Its trusted
    // projection may therefore mark it pending OR non-provisional; this view
    // must not infer approval solely from sourceType.
    if(row.total!==row.jumlah*row.tarif||!sourceTypes.has(row.sourceType)||typeof row.provisional!=='boolean'||row.sourceType!=='hitungFisik'&&row.provisional)fail('invalid_earnings');
    const out={};for(const key of recordFields)out[key]=row[key];
    return Object.freeze(out);
  }
  function normalize(data,expectedWorkerId){
    try{
      if(!safeId(expectedWorkerId))fail('invalid_earnings');
      if(data===null)return Object.freeze({workerId:expectedWorkerId,nama:'',availability:'absent',entries:Object.freeze([])});
      shape(data,['workerId','nama','entries'],['workerId','nama']);
      if(data.workerId!==expectedWorkerId||!text(data.nama,true))fail('invalid_earnings');
      // Firebase omits empty object children, so an absent entries property is
      // an empty, available projection; a null projection remains unavailable.
      const rows=data.entries===undefined?{}:data.entries;
      const ids=keys(rows);if(ids.length>MAX_ENTRIES)fail('invalid_earnings');
      const entries=ids.map(id=>entry(rows[id],id)).sort((a,b)=>a.tanggal.localeCompare(b.tanggal)||a.sourceId.localeCompare(b.sourceId));
      return Object.freeze({workerId:expectedWorkerId,nama:data.nama,availability:'available',entries:Object.freeze(entries)});
    }catch{fail('invalid_earnings');}
  }
  function validatedModel(model){
    shape(model,['workerId','nama','availability','entries']);
    if(!safeId(model.workerId)||!Array.isArray(model.entries)||Object.getPrototypeOf(model.entries)!==Array.prototype||model.entries.length>MAX_ENTRIES)fail('invalid_earnings');
    const descriptors=Object.getOwnPropertyDescriptors(model.entries);
    const names=Reflect.ownKeys(descriptors);
    if(names.some(key=>typeof key!=='string'||key!=='length'&&!/^\d+$/.test(key))||names.length!==model.entries.length+1)fail('invalid_earnings');
    for(let i=0;i<model.entries.length;i++)if(!descriptors[i]||!Object.prototype.hasOwnProperty.call(descriptors[i],'value'))fail('invalid_earnings');
    if(model.availability==='absent'){
      if(model.nama!==''||model.entries.length)fail('invalid_earnings');
      return model;
    }
    if(model.availability!=='available'||!text(model.nama,true))fail('invalid_earnings');
    const seen=new Set();
    for(let i=0;i<model.entries.length;i++){
      const row=descriptors[i].value;
      shape(row,recordFields);const id=row.sourceId;
      if(seen.has(id))fail('invalid_earnings');seen.add(id);entry(row,id);
    }
    return model;
  }
  function add(a,b){const value=a+b;if(!amount(value))fail('invalid_earnings');return value;}
  function summarize(model,range){
    try{
      const valid=validatedModel(model);
      range=range===undefined?{}:range;
      shape(range,['from','to'],[]);
      if(range.from!==undefined&&!date(range.from)||range.to!==undefined&&!date(range.to)||range.from!==undefined&&range.to!==undefined&&range.from>range.to)fail('invalid_earnings');
      const days=new Map();let quantity=0,calculatedTotal=0,provisionalQuantity=0,provisionalTotal=0,nonProvisionalQuantity=0,nonProvisionalTotal=0;
      for(const row of valid.entries){
        if(range.from!==undefined&&row.tanggal<range.from||range.to!==undefined&&row.tanggal>range.to)continue;
        const group=days.get(row.tanggal)||{tanggal:row.tanggal,quantity:0,calculatedTotal:0,provisionalQuantity:0,provisionalTotal:0,nonProvisionalQuantity:0,nonProvisionalTotal:0};
        quantity=add(quantity,row.jumlah);calculatedTotal=add(calculatedTotal,row.total);
        group.quantity=add(group.quantity,row.jumlah);group.calculatedTotal=add(group.calculatedTotal,row.total);
        if(row.provisional){provisionalQuantity=add(provisionalQuantity,row.jumlah);provisionalTotal=add(provisionalTotal,row.total);group.provisionalQuantity=add(group.provisionalQuantity,row.jumlah);group.provisionalTotal=add(group.provisionalTotal,row.total);}
        else{nonProvisionalQuantity=add(nonProvisionalQuantity,row.jumlah);nonProvisionalTotal=add(nonProvisionalTotal,row.total);group.nonProvisionalQuantity=add(group.nonProvisionalQuantity,row.jumlah);group.nonProvisionalTotal=add(group.nonProvisionalTotal,row.total);}
        days.set(row.tanggal,group);
      }
      const absent=valid.availability==='absent';
      return Object.freeze({workerId:valid.workerId,availability:valid.availability,paymentEvidence:'not_in_this_data',quantity:absent?null:quantity,calculatedTotal:absent?null:calculatedTotal,provisionalQuantity:absent?null:provisionalQuantity,provisionalTotal:absent?null:provisionalTotal,nonProvisionalQuantity:absent?null:nonProvisionalQuantity,nonProvisionalTotal:absent?null:nonProvisionalTotal,days:Object.freeze([...days.values()].sort((a,b)=>a.tanggal.localeCompare(b.tanggal)).map(Object.freeze))});
    }catch{fail('invalid_earnings');}
  }
  return Object.freeze({target,normalize,summarize});
});
