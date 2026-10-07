'use strict';
// SOURCE OFF. Pure generator only: no file export, upload, SDK or production UID.
const Scope=require('../server/apps-script/protected-storage-scope.cjs');
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const DENY=()=>({rules:{'.read':false,'.write':false}});
// Rules numbers are not a canonical JSON text formatter. Select an exact decimal
// string for the bounded receipt revision instead of concatenating a number.
// Balanced branches keep evaluation depth logarithmic; no request can choose
// this range or refill the finite receipt ledger.
function revisionText(expression,first,last){
  if(first===last)return `(${expression} === ${first} ? '${first}' : 'invalid')`;
  const split=Math.floor((first+last)/2)+1;
  return `(${expression} < ${split} ? ${revisionText(expression,first,split-1)} : ${revisionText(expression,split,last)})`;
}
function buildProtectedOwnerPhotoRules(options={}){
  const d=plain(options)&&Object.getOwnPropertyDescriptor(options,'enabled');if(!d||!Object.hasOwn(d,'value')||d.value!==true)return DENY();
  const optional=Object.hasOwn(options,'revisionSyncEnabled')?['revisionSyncEnabled']:[];
  if(Reflect.ownKeys(options).length!==3+optional.length||!['enabled','ownerUid','projectId',...optional].every(k=>{const p=Object.getOwnPropertyDescriptor(options,k);return p?.enumerable&&Object.hasOwn(p,'value');})||optional.length&&typeof options.revisionSyncEnabled!=='boolean'||typeof options.ownerUid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(options.ownerUid)||['__proto__','constructor','prototype'].includes(options.ownerUid)||typeof options.projectId!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(options.projectId))throw Error('invalid_private_binding');
  const q=JSON.stringify,old=k=>`data.child(${q(k)})`,next=k=>`newData.child(${q(k)})`,eq=k=>`${next(k)}.val() === ${old(k)}.val()`;
  const immutable=['schemaVersion','phase','encoding','migrationId','sourceRootDigest','binding/projectId','binding/databaseURL','binding/tenantId'];
  const owner=`auth != null && auth.uid === ${q(options.ownerUid)} && auth.token.aud === ${q(options.projectId)} && auth.token.email_verified === true && auth.token.firebase != null && auth.token.firebase.sign_in_provider === 'google.com'`;
  const active=`data.exists() && data.child('schemaVersion').val() === 2 && data.child('phase').val() === 'active' && data.child('encoding').val() === ${q(Scope.PHOTO_ENCODING)} && data.child('binding/projectId').val() === ${q(options.projectId)} && root.child(${q(Scope.KEY+'/manifest/schemaVersion')}).val() === 2 && root.child(${q(Scope.KEY+'/manifest/phase')}).val() === 'active' && root.child(${q(Scope.KEY+'/manifest/binding/projectId')}).val() === ${q(options.projectId)}`;
  const lastEqual=`(${old('lastReceipt')}.isBoolean() && ${next('lastReceipt')}.isBoolean() && ${old('lastReceipt')}.val() === false && ${next('lastReceipt')}.val() === false || ${old('lastReceipt')}.hasChildren(['requestId','payloadDigest','revision','dataDigest']) && ${next('lastReceipt')}.hasChildren(['requestId','payloadDigest','revision','dataDigest']) && ${['requestId','payloadDigest','revision','dataDigest'].map(k=>eq('lastReceipt/'+k)).join(' && ')})`;
  const noop=[...immutable,'revision','dataDigest','data','receiptCount','receipts'].map(eq).concat(lastEqual).join(' && ');
  const entry=`'{"dataDigest":"' + ${next('lastReceipt/dataDigest')}.val() + '","payloadDigest":"' + ${next('lastReceipt/payloadDigest')}.val() + '","requestId":"' + ${next('lastReceipt/requestId')}.val() + '","revision":' + ${revisionText(next('lastReceipt/revision')+'.val()',2,Scope.MAX_PHOTO_RECEIPTS+1)} + '}|'`;
  const changed=[...immutable.map(eq),`${next('revision')}.val() === ${old('revision')}.val() + 1`,`${next('receiptCount')}.val() === ${old('receiptCount')}.val() + 1`,`${next('receiptCount')}.val() <= ${Scope.MAX_PHOTO_RECEIPTS}`,`${next('lastReceipt/revision')}.val() === ${next('revision')}.val()`,`${next('lastReceipt/dataDigest')}.val() === ${next('dataDigest')}.val()`,`${next('receipts')}.val() === ${old('receipts')}.val() + ${entry}`,`!${old('receipts')}.val().contains('\"requestId\":\"' + ${next('lastReceipt/requestId')}.val() + '\"')`].join(' && ');
  // ASCII plus literal replacement accounts for JSON quote/backslash escaping.
  // 4096 bytes conservatively covers bounded metadata and the structured tail.
  const escaped=k=>`${next(k)}.val().replace('\\\\','aa').replace('\"','aa').length`;
  const fields=['schemaVersion','phase','binding','migrationId','sourceRootDigest','encoding','revision','dataDigest','data','receiptCount','receipts','lastReceipt'];
  // RTDB's regex subset treats unsupported hex escapes literally. The literal
  // interval space through tilde expresses precisely printable ASCII32..126.
  // https://firebase.google.com/docs/database/security/regex
  const text=max=>({'.validate':`newData.isString() && newData.val().matches(/^[ -~]*$/) && newData.val().length <= ${max}`});
  const digest={'.validate':"newData.isString() && newData.val().matches(/^[a-f0-9]{64}$/)"};
  const receipt={'.validate':"newData.isBoolean() && newData.val() === false && newData.parent().child('receiptCount').val() === 0 || newData.hasChildren(['requestId','payloadDigest','revision','dataDigest']) && newData.parent().child('receiptCount').val() > 0",requestId:{'.validate':"newData.isString() && newData.val().matches(/^[A-Za-z0-9_-]{1,80}$/) && newData.val() !== '__proto__' && newData.val() !== 'constructor' && newData.val() !== 'prototype'"},payloadDigest:digest,revision:{'.validate':'newData.isNumber() && newData.val() >= 2 && newData.val() <= 9007199254740991 && newData.val() % 1 === 0'},dataDigest:digest,$other:{'.validate':false}};
  const photos={'.read':`(${owner}) && (${active})`,'.write':`(${owner}) && (${active}) && newData.exists() && ((${noop}) || (${changed}))`,'.validate':`newData.hasChildren(${q(fields)}) && ${escaped('data')} + ${escaped('receipts')} + 4096 <= ${Scope.MAX_PHOTO_BYTES}`,
    schemaVersion:{'.validate':'newData.val() === 2'},phase:{'.validate':"newData.val() === 'active'"},encoding:{'.validate':`newData.val() === ${q(Scope.PHOTO_ENCODING)}`},
    binding:{'.validate':"newData.hasChildren(['projectId','databaseURL','tenantId'])",projectId:text(30),databaseURL:text(256),tenantId:text(128),$other:{'.validate':false}},migrationId:text(128),sourceRootDigest:digest,
    revision:{'.validate':'newData.isNumber() && newData.val() >= 1 && newData.val() <= 9007199254740991 && newData.val() % 1 === 0'},dataDigest:digest,data:text(Scope.MAX_PHOTO_BYTES),receiptCount:{'.validate':`newData.isNumber() && newData.val() >= 0 && newData.val() <= ${Scope.MAX_PHOTO_RECEIPTS} && newData.val() % 1 === 0`},receipts:text(Scope.MAX_PHOTO_RECEIPT_BYTES),lastReceipt:receipt,$other:{'.validate':false}};
  const working={'.read':false,'.write':false};
  if(options.revisionSyncEnabled===true){
    const w=`root.child(${q(Scope.KEY+'/working')})`,m=`root.child(${q(Scope.KEY+'/manifest')})`;
    // A private retained-grant mirror authorizes only the scalar notification.
    // The ACL, opaque payload and every working write remain denied to SDKs.
    working.revision={'.read':`auth != null && auth.token.aud === ${q(options.projectId)} && auth.token.email_verified === true && auth.token.firebase != null && auth.token.firebase.sign_in_provider === 'google.com' && ${w}.child('schemaVersion').val() === 1 && ${w}.child('phase').val() === 'active' && ${w}.child('binding/projectId').val() === ${q(options.projectId)} && (${m}.child('schemaVersion').val() === 1 || ${m}.child('schemaVersion').val() === 2) && ${m}.child('phase').val() === 'active' && ${m}.child('binding/projectId').val() === ${q(options.projectId)} && ${w}.child('binding/databaseURL').val() === ${m}.child('binding/databaseURL').val() && ${w}.child('binding/tenantId').val() === ${m}.child('binding/tenantId').val() && ${w}.child('migrationId').val() === ${m}.child('migrationId').val() && ${w}.child('sourceRootDigest').val() === ${m}.child('sourceRootDigest').val() && ${w}.child('revisionReaders').child(auth.uid).val() === true && data.isNumber() && data.val() >= 1 && data.val() <= 9007199254740991 && data.val() % 1 === 0`,'.write':false};
  }
  return {rules:{'.read':false,'.write':false,[Scope.KEY]:{'.read':false,'.write':false,working,manifest:{'.read':false,'.write':false},photos,$other:{'.read':false,'.write':false}}}};
}
module.exports=Object.freeze({buildProtectedOwnerPhotoRules});
