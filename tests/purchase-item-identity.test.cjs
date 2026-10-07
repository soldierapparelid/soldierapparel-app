'use strict';
const readReviewedLegacyHtml=require('./helpers/legacy-html-source.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=readReviewedLegacyHtml('pembelian-produk-v1.html');
const clone=value=>JSON.parse(JSON.stringify(value));
function extract(start,end){const from=source.indexOf(start),to=source.indexOf(end,from);assert.ok(from>=0&&to>from);return source.slice(from,to);}
function fixture(){return {id:'synthetic-order',produkId:'synthetic-product',hargaSatuan:13,totalHarga:65,sisaBayar:52,items:[{id:'synthetic-item-one',nama:'First',jumlah:2,sourceMarker:'preserve'},{id:'synthetic-item-two',nama:'Second',jumlah:3}],pembayaran:[{id:'synthetic-payment',jumlah:13}],penerimaan:[{id:'synthetic-receipt',itemId:'synthetic-item-one',jumlah:1}],catatan:'Before'};}
function row(token,name,quantity){const fields={'.edit-item-nama':{value:name},'.edit-item-qty':{value:String(quantity)}};return {dataset:{purchaseEditToken:token},className:'edit-varian-row',innerHTML:'',querySelector:selector=>fields[selector]||null};}
function harness(order=fixture()){
  const nodes=new Map(),events=[],rows=[];let calls=0;
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',appendChild:item=>rows.push(item)});return nodes.get(id);};
  const document={getElementById:node,querySelectorAll:()=>rows,createElement:()=>row(undefined,'',0)};
  const product={id:'synthetic-product',nama:'Synthetic product',model:'Model',warna:'Color'};
  const context={document,DATA:{orders:[order],produk:[product]},orderFormState:{produkId:'synthetic-product',hargaSatuan:13,items:[],newProdImg:''},
    uid:()=>{calls++;return 'synthetic-created-'+calls;},esc:value=>String(value??''),getOrderProduk:()=>product,getSupplierForOrder:()=>({}),
    toast:(message,kind)=>events.push({type:'toast',message,kind}),save:()=>events.push({type:'save'}),debouncedRender(){},closeModal(){},showOrderDetail(){},today:()=> '2026-01-02',showOrderShareModal(){},confirm:()=>true};
  vm.createContext(context);
  for(const code of [extract('function getOrderItems(o){','function getOrderProduk(o){'),extract('function calcTotalPaid(order){','function statusBadge(s){'),extract('/* ===== EDIT ORDER ===== */','function renderEditOrderModal(o, prodOpts){'),extract('function doEditOrder(orderId){','function deleteOrder(orderId){'),extract('function deleteOrder(orderId){','    function hapusGroupOrders('),extract('function addReceipt(orderId){','/* ===== QUICK BAYAR'),extract('function doQuickTerima(orderId){','/* ===== EDIT ORDER ===== */'),extract('function addOrderItem(){','function removeOrderItem(idx){'),extract('function saveOrder(){','/* ===== PRODUK TAB ===== */')])vm.runInContext(code,context);
  function open(){context.showEditOrderModal(order.id);node('edit-order-id').value=order.id;node('edit-harga').value=String(order.hargaSatuan);node('edit-catatan').value='After';node('edit-prod-nama').value=product.nama;node('edit-prod-model').value=product.model;node('edit-prod-warna').value=product.warna;rows.splice(0,rows.length,...(order.items||[]).map((item,index)=>row('existing-'+index,item.nama,item.jumlah)));}
  return {context,order,nodes,node,rows,events,open,product,calls:()=>calls};
}
test('actual edit retains persisted IDs and metadata through rename, quantity changes and reorder',()=>{
  const run=harness(),beforePayments=clone(run.order.pembayaran),beforeReceipts=clone(run.order.penerimaan);run.open();
  assert.ok(run.node('modal-root').innerHTML.includes('data-purchase-edit-token="existing-0"'));
  run.rows.splice(0,2,row('existing-1','Renamed second',1),row('existing-0','Renamed first',4));
  run.context.saveOrderEdits();assert.equal(run.events.filter(event=>event.type==='save').length,1);
  assert.deepEqual(clone(run.order.items.map(item=>item.id)),['synthetic-item-two','synthetic-item-one']);assert.equal(run.order.items[1].sourceMarker,'preserve');
  assert.equal(run.order.totalHarga,13*(1+4));assert.equal(run.order.hargaSatuan,13);assert.deepEqual(run.order.pembayaran,beforePayments);assert.deepEqual(run.order.penerimaan,beforeReceipts);assert.equal(run.calls(),0);
});
test('new dynamic item gets one stable ID at creation, retained at save and later edit',()=>{
  const run=harness();run.open();run.context.addEditVarianRow();const added=run.rows[2],id=added.dataset.purchaseEditToken.slice(4);
  added.querySelector('.edit-item-nama').value='New item';added.querySelector('.edit-item-qty').value='2';assert.equal(run.calls(),1);
  run.context.saveOrderEdits();assert.equal(run.order.items[2].id,id);assert.equal(run.calls(),1);
  run.open();run.rows.reverse();run.context.saveOrderEdits();assert.equal(run.order.items[0].id,id);assert.equal(run.calls(),1);
});
test('duplicate/malformed item IDs and unsupported single-item edit format block without changing any ledger',()=>{
  for(const mutate of [order=>order.items[0].id='invalid/id',order=>order.items[1].id=order.items[0].id,order=>{delete order.items;order.jumlah=5;}]){
    const order=fixture();mutate(order);const before=clone(order),run=harness(order);run.context.showEditOrderModal(order.id);
    assert.deepEqual(order,before);assert.equal(run.events.some(event=>event.type==='save'),false);assert.equal(run.node('modal-root').innerHTML,'');
    assert.ok(run.events.some(event=>event.type==='toast'&&event.kind==='error'));
  }
});
test('referenced item removal, duplicate or unknown row tokens are rejected before product or money mutation',()=>{
  for(const candidates of [[row('existing-1','Second',3)],[row('existing-0','One',2),row('existing-0','Duplicate',3)],[row('existing-0','One',2),row('synthetic-unregistered-new','Unknown',3)]]){
    const run=harness();run.open();const before=clone(run.order),product=clone(run.product);run.rows.splice(0,run.rows.length,...candidates);run.node('edit-prod-nama').value='Do not apply';
    run.context.saveOrderEdits();assert.deepEqual(run.order,before);assert.deepEqual(run.product,product);assert.equal(run.events.some(event=>event.type==='save'),false);
  }
  const run=harness();run.open();run.rows.splice(1,1);run.context.saveOrderEdits();assert.equal(run.order.items.length,1);assert.equal(run.order.items[0].id,'synthetic-item-one');assert.equal(run.order.totalHarga,26);
});
test('IDless legacy items stay IDless through normal edits and reorder; orphan receipts remain exactly preserved and flagged',()=>{
  const order=fixture();delete order.items[0].id;delete order.items[1].id;const beforePayments=clone(order.pembayaran),beforeReceipts=clone(order.penerimaan),run=harness(order);run.open();
  run.rows.splice(0,2,row('existing-1','Updated second',1),row('existing-0','Updated first',4));run.context.saveOrderEdits();
  assert.equal(run.events.filter(event=>event.type==='save').length,1);assert.equal(order.items.every(item=>!Object.hasOwn(item,'id')),true);
  assert.equal(order.items[1].sourceMarker,'preserve');assert.deepEqual(order.pembayaran,beforePayments);assert.deepEqual(order.penerimaan,beforeReceipts);assert.equal(order.totalHarga,65);assert.equal(run.calls(),0);
  assert.ok(run.events.some(event=>event.kind==='error'));run.open();run.rows.splice(0,1);const before=clone(order);run.context.saveOrderEdits();assert.deepEqual(clone(order),before);
});
test('remote order change after opening prevents stale form overwrite',()=>{
  const run=harness();run.open();run.order.items[0].jumlah=9;const changed=clone(run.order);run.context.saveOrderEdits();
  assert.deepEqual(run.order,changed);assert.equal(run.events.some(event=>event.type==='save'),false);
});
test('edit retains native multiplication and stored unit price without rounding, repricing or changing payments',()=>{
  const order=fixture();order.hargaSatuan=0.1;order.totalHarga=5*0.1;order.pembayaran[0].jumlah=0.1;order.sisaBayar=0.4;
  const run=harness(order),payments=clone(order.pembayaran);run.open();run.rows.splice(0,2,row('existing-0','First',3));run.context.saveOrderEdits();
  assert.equal(order.hargaSatuan,0.1);assert.equal(order.totalHarga,3*0.1);assert.notEqual(order.totalHarga,0.3);assert.deepEqual(order.pembayaran,payments);
});
test('finite inputs whose quantity sum or multiplication overflow never partially mutate order/product in either editor',()=>{
  for(const alternate of [false,true])for(const input of [{quantities:[1e308,1e308],price:1},{quantities:[2,3],price:1e308}]){
    const run=harness();run.open();const before=clone(run.order),product=clone(run.product);
    if(alternate){
      const candidate=clone(run.order.items);candidate.forEach((item,index)=>item.jumlah=input.quantities[index]);run.context.candidate=candidate;vm.runInContext('_editOrderItems=candidate',run.context);
      for(const [field,value]of [['eo-produk','synthetic-other-product'],['eo-harga',String(input.price)],['eo-tanggal','2026-01-03'],['eo-catatan','Do not apply']])run.node(field).value=value;
      run.context.doEditOrder(run.order.id);
    }else{
      run.rows.splice(0,2,...input.quantities.map((quantity,index)=>row('existing-'+index,'Overflow candidate',quantity)));run.node('edit-harga').value=String(input.price);run.node('edit-prod-nama').value='Do not apply';run.context.saveOrderEdits();
    }
    assert.deepEqual(clone(run.order),before);assert.deepEqual(run.product,product);assert.equal(run.events.some(event=>event.type==='save'),false);
  }
});
test('numeric-map receipts with null placeholders retain exact representation and references through edit; null receipts stay null',()=>{
  for(const receipts of [{0:null,2:{id:'synthetic-map-receipt',itemId:'synthetic-item-one',jumlah:1}},null]){
    const order=fixture();order.penerimaan=receipts;const before=clone(receipts),run=harness(order);run.open();run.rows.reverse();run.context.saveOrderEdits();
    assert.deepEqual(order.penerimaan,before);assert.equal(run.events.filter(event=>event.type==='save').length,1);assert.equal(run.context.purchaseItemReferencesValid(order.items,order.penerimaan),true);
  }
  const run=harness();assert.equal(run.context.purchaseItemReferencesValid(run.order.items,{0:null,2:{itemId:'synthetic-orphan'}}),false);
});
test('full and quick receipts require an unambiguous current item reference, preserving rejected legacy data',()=>{
  for(const quick of [false,true])for(const mutation of [order=>delete order.items[0].id,order=>order.items[1].id=order.items[0].id,order=>order.penerimaan[0].itemId='synthetic-orphan']){
    const order=fixture();mutation(order);const run=harness(order),before=clone(order);
    run.node(quick?'qr-item':'rf-item-'+order.id).value='synthetic-item-one';run.node(quick?'qr-jml':'rf-jml-'+order.id).value='1';
    (quick?run.context.doQuickTerima:run.context.addReceipt)(order.id);assert.deepEqual(order,before);assert.equal(run.events.some(event=>event.type==='save'),false);
  }
  for(const quick of [false,true]){
    const run=harness();run.node(quick?'qr-item':'rf-item-'+run.order.id).value='synthetic-item-two';run.node(quick?'qr-jml':'rf-jml-'+run.order.id).value='1';
    (quick?run.context.doQuickTerima:run.context.addReceipt)(run.order.id);assert.equal(run.order.penerimaan.length,2);assert.equal(run.order.penerimaan[1].itemId,'synthetic-item-two');
  }
});
test('known single-product legacy receipt remains supported without inventing or persisting item IDs',()=>{
  const order=fixture();delete order.items;order.jumlah=5;order.penerimaan=[{id:'synthetic-legacy-receipt',itemId:'legacy',jumlah:1}];const run=harness(order);
  run.node('qr-item').value='legacy';run.node('qr-jml').value='1';run.context.doQuickTerima(order.id);
  assert.equal(order.penerimaan.length,2);assert.equal(Object.hasOwn(order,'items'),false);assert.equal(order.penerimaan[1].itemId,'legacy');
});
test('alternate edit path also rejects orphaning receipts while preserving candidate IDs and its original math',()=>{
  const run=harness(),candidate=clone(run.order.items).reverse();run.context.candidate=candidate;vm.runInContext('_editOrderItems=candidate',run.context);
  for(const [field,value]of [['eo-produk','synthetic-product'],['eo-harga','13'],['eo-tanggal','2026-01-02'],['eo-catatan','Alternative']])run.node(field).value=value;
  run.context.doEditOrder(run.order.id);assert.deepEqual(clone(run.order.items.map(item=>item.id)),candidate.map(item=>item.id));assert.equal(run.order.totalHarga,65);assert.equal(run.order.sisaBayar,52);
  const before=clone(run.order);run.context.candidate=[clone(run.order.items[0])];vm.runInContext('_editOrderItems=candidate',run.context);run.context.doEditOrder(run.order.id);assert.deepEqual(clone(run.order),before);
});
test('create and whole-order delete retain explicit item/receipt/payment identities without positional remapping',()=>{
  const run=harness();run.node('ai-nama').value='Synthetic new variant';run.node('ai-qty').value='2';run.context.addOrderItem();
  const id=run.context.orderFormState.items[0].id;run.node('ob-dp').value='0';run.node('ob-tanggal').value='2026-01-02';run.node('ob-catatan').value='Create';run.context.saveOrder();
  assert.equal(run.context.DATA.orders[1].items[0].id,id);assert.equal(run.context.DATA.orders[1].totalHarga,26);
  const before=clone(run.order);run.context.deleteOrder(run.order.id);assert.equal(run.order._deleted,true);delete run.order._deleted;assert.deepEqual(run.order,before);
});
