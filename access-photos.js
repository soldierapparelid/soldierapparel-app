(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SoldierAccessPhotos=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const rows=value=>Array.isArray(value)?value:Object.values(value||{});
  // Publish only product IDs and display images, never whole purchase/order records.
  function project(value){
    const items=[];
    for(const order of rows(value&&value.pesananOffline)){
      if(!order||order._deleted)continue;
      for(const item of rows(order.items)){
        if(!item||!['string','number'].includes(typeof item.id)||!item.id||typeof item.gambar!=='string')continue;
        if(!/^(data:image\/(png|jpeg|webp);base64,|https:\/\/)/.test(item.gambar))continue;
        items.push({id:item.id,gambar:item.gambar});
      }
    }
    return items.length?{pesananOffline:[{items}]}:null;
  }
  return Object.freeze({project});
});
