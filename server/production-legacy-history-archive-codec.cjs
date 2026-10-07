'use strict';
// Pure candidate preparation only. No SDK, file, grant, publication or logging.
const crypto=require('node:crypto');
const Data=require('./production-enrollment-registry.cjs');
const History=require('../legacy-stored-history.js');
const ARCHIVE_CODEC='stored-history-archive-json-v1',DIGEST_DOMAIN='soldier-legacy-stored-history-archive-sha256-v1',SOURCE_POLICY='same-stable-id-stored-history-v1',MAX_PAYLOAD_BYTES=8*1024*1024,MAX_WORKERS=128;
const SCOPE=['projectId','databaseURL','tenantId','snapshotVersion'];
const STORED=['tanggal','jumlah','lolos','rijek','kiloan','tarif','total','dibayar','quantityBasis'];
const NUMBERS=new Set(['jumlah','lolos','rijek','kiloan','tarif','total']);
const reserved=new Set(['__proto__','constructor','prototype']);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const safe=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!reserved.has(v);
class ArchiveError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new ArchiveError(code);};
function field(v,k,required=true){
  if(!plain(v))fail('invalid_source');const d=Object.getOwnPropertyDescriptor(v,k);
  if(!d){if(required)fail('invalid_source');return {present:false};}
  if(!d.enumerable||!Object.hasOwn(d,'value'))fail('invalid_source');return {present:true,value:d.value};
}
function exact(v,keys){if(!plain(v)||Reflect.ownKeys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail('invalid_source');for(const k of keys)field(v,k);}
function put(v,k,value){Object.defineProperty(v,k,{value,enumerable:true,writable:true,configurable:true});}
function append(v,value){put(v,String(v.length),value);}
function freeze(v){if(v&&typeof v==='object'){for(const k of Reflect.ownKeys(v)){if(k==='length')continue;freeze(Object.getOwnPropertyDescriptor(v,k).value);}Object.freeze(v);}return v;}
function scope(v){
  exact(v,SCOPE);const out={};for(const k of SCOPE){const x=field(v,k).value;if(k==='databaseURL'){
    if(typeof x!=='string')fail('invalid_source');
    let u;try{u=new URL(x);}catch{fail('invalid_source');}
    if(typeof x!=='string'||u.origin!==x||u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||!/^([a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app)$/.test(u.hostname))fail('invalid_source');
  }else if(k==='projectId'?(typeof x!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(x)):!safe(x))fail('invalid_source');put(out,k,x);}return freeze(out);
}
function canonicalJSON(value){
  // The existing descriptor codec validates JSON depth/nodes/types/hooks;
  // this renderer adds explicit recursive sorted-key canonical ordering.
  const copied=Data.copyEnrollmentData(value);
  function render(v){
    if(v===null||typeof v!=='object')return JSON.stringify(v);
    if(Array.isArray(v)){const parts=[];for(let i=0;i<v.length;i++)append(parts,render(Object.getOwnPropertyDescriptor(v,String(i)).value));return '['+parts.join(',')+']';}
    const parts=[];for(const k of Object.keys(v).sort())append(parts,JSON.stringify(k)+':'+render(Object.getOwnPropertyDescriptor(v,k).value));return '{'+parts.join(',')+'}';
  }
  return render(copied);
}
function workers(v){
  if(!plain(v))fail('invalid_source');const keys=Reflect.ownKeys(v);if(!keys.length||keys.length>MAX_WORKERS)fail('capacity_limit');const out={};
  for(const k of keys.slice().sort()){
    if(!safe(k))fail('invalid_source');const w=field(v,k).value;exact(w,['division','reviewed']);const division=field(w,'division').value;
    if(!['jahit','potong'].includes(division)||field(w,'reviewed').value!==true)fail('invalid_source');put(out,k,{division,reviewed:true});
  }return freeze(out);
}
function collection(v,max,visit){
  if(!Array.isArray(v)&&!plain(v))fail('invalid_source');
  if(Array.isArray(v)){
    if(Object.getPrototypeOf(v)!==Array.prototype||v.length>max)fail(v.length>max?'capacity_limit':'invalid_source');
    const names=Reflect.ownKeys(v);if(names.some(k=>typeof k!=='string'||k!=='length'&&(!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=v.length)))fail('invalid_source');
    if(names.length!==v.length+1)fail('invalid_source');
    for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail('invalid_source');visit(d.value);}
  }else{
    const keys=Reflect.ownKeys(v);if(keys.length>max)fail('capacity_limit');if(keys.some(k=>typeof k!=='string'||reserved.has(k)||k.length>128))fail('invalid_source');
    for(const k of keys.slice().sort())visit(field(v,k).value);
  }
}
function scalar(v,k){
  if(v===null)return true;
  if(NUMBERS.has(k))return typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=Number.MAX_SAFE_INTEGER&&!Object.is(v,-0);
  if(k==='dibayar')return typeof v==='boolean'||v===0||v===1||v==='true'||v==='false';
  return typeof v==='string'&&v.length<=64&&!/[\u0000-\u001f\u007f]/.test(v);
}
function sourceId(out,input){const d=field(input,'id',false);if(d.present){if(d.value!==null&&d.value!==''&&!safe(d.value))fail('invalid_source');put(out,'id',d.value);}}
function sanitizeProducts(input,catalog){
  if(input===null)return null;const products=[],divisions=new Set(Object.values(catalog).map(w=>w.division));let rows=0,archives=0;
  collection(input,History.LIMITS.products,p=>{
    if(p===null){append(products,null);return;}
    if(!plain(p))fail('invalid_source');const product={};sourceId(product,p);
    for(const k of ['series','namaBarang','size']){const d=field(p,k,false);if(d.present){if(d.value!==null&&(typeof d.value!=='string'||d.value.length>256||/[\u0000-\u001f\u007f]/.test(d.value)))fail('invalid_source');put(product,k,d.value);}}
    function families(out,raw){
      for(const family of ['jahit','potong']){
        if(!divisions.has(family))continue;
        const d=field(raw,family,false);if(!d.present)continue;if(d.value===null){put(out,family,null);continue;}
        const kept=[];
        collection(d.value,History.LIMITS.sourceRows,row=>{
          if(++rows>History.LIMITS.sourceRows)fail('capacity_limit');if(row===null){append(kept,null);return;}if(!plain(row))fail('invalid_source');const owner=field(row,'tukangId',false);
          if(!owner.present||owner.value===null)return;if(typeof owner.value!=='string')fail('invalid_source');
          if(!Object.hasOwn(catalog,owner.value)||catalog[owner.value].division!==family)return;
          if(!safe(product.id))fail('invalid_source');const selected={tukangId:owner.value};sourceId(selected,row);
          for(const k of STORED){const x=field(row,k,false);if(x.present){if(!scalar(x.value,k))fail('invalid_source');put(selected,k,x.value);}}
          append(kept,selected);
        });put(out,family,kept);
      }
    }
    families(product,p);const old=field(p,'arsip',false);
    if(old.present){
      if(old.value===null||old.value===true)put(product,'arsip',old.value);
      else{
        const list=[];collection(old.value,History.LIMITS.archivesPerProduct,a=>{
          if(++archives>History.LIMITS.archives)fail('capacity_limit');if(a===null){append(list,null);return;}if(!plain(a))fail('invalid_source');const arc={};sourceId(arc,a);families(arc,a);append(list,arc);
        });put(product,'arsip',list);
      }
    }append(products,product);
  });return products;
}
function digestFor(scopeValue,payload){return crypto.createHash('sha256').update(canonicalJSON({domain:DIGEST_DOMAIN,schemaVersion:1,scope:scopeValue,codec:ARCHIVE_CODEC,payload}),'utf8').digest('hex');}
function proof(value,expectedScope){
  try{
    exact(value,['schemaVersion','scope','codec','digest','reviewed','immutable']);const fixed=scope(field(value,'scope').value);
    if(value.schemaVersion!==1||value.codec!==ARCHIVE_CODEC||value.reviewed!==true||value.immutable!==true||typeof value.digest!=='string'||!/^([a-f0-9]{64})$/.test(value.digest))fail('invalid_proof');
    if(expectedScope&&canonicalJSON(fixed)!==canonicalJSON(scope(expectedScope)))fail('scope_mismatch');
    return freeze({schemaVersion:1,scope:fixed,codec:ARCHIVE_CODEC,digest:value.digest,reviewed:true,immutable:true});
  }catch(error){if(error instanceof ArchiveError&&error.code==='scope_mismatch')throw error;fail('invalid_proof');}
}
function decodeArchive(value,publicationProof){
  try{
    const anchor=proof(publicationProof);exact(value,['schemaVersion','scope','codec','payload','digest']);const fixed=scope(value.scope);
    if(value.schemaVersion!==1||value.codec!==ARCHIVE_CODEC||canonicalJSON(fixed)!==canonicalJSON(anchor.scope))fail('invalid_archive');
    if(typeof value.payload!=='string'||Buffer.byteLength(value.payload,'utf8')>MAX_PAYLOAD_BYTES)fail('capacity_limit');
    if(value.digest!==anchor.digest||digestFor(fixed,value.payload)!==anchor.digest)fail('invalid_archive');
    const inner=JSON.parse(value.payload);if(canonicalJSON(inner)!==value.payload)fail('invalid_archive');
    exact(inner,['schemaVersion','scope','policy','reviewed','immutable','workers','products']);
    if(inner.schemaVersion!==1||inner.policy!==SOURCE_POLICY||inner.reviewed!==true||inner.immutable!==true||canonicalJSON(scope(inner.scope))!==canonicalJSON(fixed))fail('invalid_archive');
    const catalog=workers(inner.workers),clean=sanitizeProducts(inner.products,catalog);
    if(canonicalJSON(clean)!==canonicalJSON(inner.products))fail('invalid_archive');return freeze(inner);
  }catch(error){if(error instanceof ArchiveError&&['capacity_limit','invalid_proof'].includes(error.code))throw error;fail('invalid_archive');}
}
function createLegacyHistoryArchivePreparer(options){
  let enabled;try{const d=plain(options)&&Object.getOwnPropertyDescriptor(options,'enabled');enabled=d&&Object.hasOwn(d,'value')&&d.value===true;}catch{}
  if(!enabled)return Object.freeze({prepare:()=>freeze({ok:false,error:'service_disabled'})});
  let fixed,catalog;try{exact(options,['enabled','scope','workers']);fixed=scope(options.scope);catalog=workers(options.workers);}catch{return Object.freeze({prepare:()=>freeze({ok:false,error:'invalid_configuration'})});}
  return Object.freeze({prepare(request){
    try{
      exact(request,['products']);const products=sanitizeProducts(request.products,catalog),inner={schemaVersion:1,scope:fixed,policy:SOURCE_POLICY,reviewed:true,immutable:true,workers:catalog,products};
      const payload=canonicalJSON(inner);if(Buffer.byteLength(payload,'utf8')>MAX_PAYLOAD_BYTES)fail('capacity_limit');const digest=digestFor(fixed,payload);
      const archive=freeze({schemaVersion:1,scope:fixed,codec:ARCHIVE_CODEC,payload,digest}),publicationProof=proof({schemaVersion:1,scope:fixed,codec:ARCHIVE_CODEC,digest,reviewed:true,immutable:true},fixed);
      decodeArchive(archive,publicationProof);
      return freeze({ok:true,preparedOnly:true,published:false,immutableStoreProven:false,authorizationGranted:false,legacyAdopted:false,readyForProduction:false,archive,publicationProof});
    }catch(error){let code='invalid_source';try{if(error instanceof ArchiveError&&error.code==='capacity_limit')code='capacity_limit';}catch{}return freeze({ok:false,error:code});}
  }});
}
module.exports=Object.freeze({ARCHIVE_CODEC,DIGEST_DOMAIN,MAX_PAYLOAD_BYTES,MAX_WORKERS,ArchiveError,canonicalJSON,validatePublicationProof:proof,decodeArchive,createLegacyHistoryArchivePreparer});
