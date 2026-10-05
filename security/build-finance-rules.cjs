'use strict';
const fs=require('node:fs');
const schema=require('./finance-schema.cjs');
const legacy=JSON.parse(fs.readFileSync(__dirname+'/database.rules.json','utf8')).rules;
const owner="auth != null && auth.token.email_verified === true && auth.token.firebase != null && auth.token.firebase.sign_in_provider === 'google.com' && root.child('accessControl/users').child(auth.uid).child('active').val() === true && root.child('accessControl/users').child(auth.uid).child('owner').val() === true";
const readOperations="auth != null && auth.token.firebase != null && auth.token.firebase.sign_in_provider === 'google.com' && ("+legacy.soldier.produksi['.read']+")";
function validate(field){
  if(field.kind==='id')return "newData.isString() && newData.val().length > 0 && newData.val().length <= 128 && newData.val() !== '__proto__' && newData.val() !== 'constructor' && newData.val() !== 'prototype' && newData.val().matches(/^[^.#$\\/\\[\\]\\x00-\\x1f\\x7f]+$/)";
  if(field.kind==='text')return "newData.isString() && newData.val().length <= 256 && newData.val().matches(/^[^\\x00-\\x1f\\x7f]*$/)";
  if(field.kind==='date')return "newData.isString() && (newData.val() === '' || newData.val().matches(/^\\d{4}-\\d{2}-\\d{2}$/))";
  if(field.kind==='count')return 'newData.isNumber() && newData.val() >= 0 && newData.val() <= 9007199254740991 && newData.val() % 1 === 0';
  if(field.kind==='money')return 'newData.isNumber() && newData.val() >= 0 && newData.val() <= 9007199254740991';
  if(field.kind==='bool')return 'newData.isBoolean()';
  return field.values.map(value=>'newData.val() === '+JSON.stringify(value)).join(' || ');
}
function record(fields,key){
  const node={'.validate':"newData.hasChildren(['id'])"+(key?" && newData.child('id').val() === "+key:'')};
  for(const [name,field]of Object.entries(fields))node[name]={'.validate':validate(field)};
  node.$other={'.validate':false};return node;
}
function collections(node){
  for(const [name,fields]of Object.entries(schema.rows)){
    node[name]={'.validate':"newData.hasChildren()"+(name==='bigSaller'||name==='bigSeller'?' || newData.isBoolean()':''),$record:record(fields)};
  }
  return node;
}
const product=collections(record(schema.product,'$product'));
product.arsip={'.validate':'newData.isBoolean() || newData.hasChildren()',$archive:collections(record(schema.archive))};
const directory=record({id:{kind:'id'},nama:{kind:'text'}},'$worker');
directory['.validate']+=" && newData.hasChildren(['nama']) && newData.child('nama').val().length > 0";
const soldier={
  workerDirectory:{'.read':readOperations,'.write':owner,'.validate':'newData.hasChildren()',$worker:directory},
  operationsV2:{'.read':readOperations,'.write':owner,'.validate':"newData.hasChildren(['schemaVersion']) && newData.child('schemaVersion').val() === 2",schemaVersion:{'.validate':'newData.val() === 2'},products:{'.validate':'newData.hasChildren()',$product:product},$other:{'.validate':false}}
};
// Close every old shared path to workers. These Rules cannot be deployed before
// worker clients, transactions, account-to-worker mapping and drafts are migrated.
for(const name of ['produksi','produksi_meta','produksi_deletions','produksi_deleted_ids','stokBahan','pembelianProduk','gajiHarian','hpp','productionPhotos'])soldier[name]={'.read':owner,'.write':owner};
const uidWorker="root.child('accessControl/users').child(auth.uid).child('workerId').val() === $worker";
const emailWorker="!root.child('accessControl/users').child(auth.uid).exists() && auth.token.email != null && root.child('accessControl/emailGrants').child(auth.token.email.replace('.',',')).child('workerId').val() === $worker";
const visibleEarnings="("+owner+") || ("+readOperations+") && ("+uidWorker+" || ("+emailWorker+"))";
const earning=record({sourceId:{kind:'id'},productId:{kind:'id'},series:{kind:'text'},namaBarang:{kind:'text'},size:{kind:'text'},tanggal:{kind:'date'},jumlah:{kind:'count'},tarif:{kind:'money'},total:{kind:'money'},sourceType:{kind:'enum',values:['hitungFisik','qc','qcRepair','gudang']},provisional:{kind:'bool'}});
// Earning identity is the trusted source hash, not a browser-generated ID.
delete earning.id;earning['.validate']="newData.hasChildren(['sourceId','productId','tanggal','jumlah','tarif','total','sourceType','provisional']) && newData.child('sourceId').val() === $source";
const accessControl=JSON.parse(JSON.stringify(legacy.accessControl));
const result={rules:{'.read':false,'.write':false,accessControl,soldier,
  maklonEarnings:{'.read':owner,$worker:{'.read':visibleEarnings,'.write':owner,'.validate':"newData.hasChildren(['workerId','nama']) && newData.child('workerId').val() === $worker",workerId:{'.validate':validate({kind:'id'})},nama:{'.validate':validate({kind:'text'})},entries:{'.validate':'newData.hasChildren()',$source:earning},$other:{'.validate':false}}},
  privateFinance:{'.read':owner,'.write':owner}}};
if(require.main===module)fs.writeFileSync(__dirname+'/finance-v2.rules.json',JSON.stringify(result,null,2)+'\n');
module.exports=result;
