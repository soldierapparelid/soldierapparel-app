'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),Crypto=require('node:crypto');
const P=require('../server/apps-script/primitives.cjs');
function utilities(){
 const stats={blobs:0,bytes:0,stringDigests:0,arrayDigests:0},charset={UTF_8:'utf8'},u={DigestAlgorithm:{SHA_256:'sha256'},Charset:charset,newBlob(value,type){stats.blobs++;assert.equal(type,'text/plain');return {getBytes(){stats.bytes++;return Array.from(Buffer.from(value,'utf8'),v=>v>127?v-256:v);}};},computeDigest(algorithm,value,encoding){assert.equal(algorithm,'sha256');if(typeof value==='string'){stats.stringDigests++;assert.equal(encoding,charset.UTF_8);}else{stats.arrayDigests++;assert.equal(encoding,undefined);}return Array.from(Crypto.createHash('sha256').update(typeof value==='string'?value:Buffer.from(value),'utf8').digest(),v=>v>127?v-256:v);}};
 return {u,stats};
}
test('native UTF-8 string hashes preserve Unicode and independent update semantics',()=>{
 const {u,stats}=utilities(),p=P.createAppsScriptPrimitives(u);
 for(const value of ['', 'ASCII', 'café', '漢字', '😀', 'e\u0301', '\ud800', '\udc00', '\ud800x\udc00', '\ud800\ud800\udc00', '\ud83d\ude00'])assert.equal(p.crypto.createHash('sha256').update(value).digest('hex'),Crypto.createHash('sha256').update(value).digest('hex'));
 const chunks=['A\ud800','\udc00雪','😀'];let actual=p.crypto.createHash('sha256'),expected=Crypto.createHash('sha256');for(const value of chunks){actual.update(value);expected.update(value);}assert.equal(actual.digest('hex'),expected.digest('hex'));assert.throws(()=>actual.update('x'),/apps_script_compatibility/);assert.throws(()=>actual.digest('hex'),/apps_script_compatibility/);assert.equal(stats.blobs+stats.bytes+stats.arrayDigests,0);
});
test('a synthetic five MiB hash uses one native string call and no input byte arrays',()=>{
 const {u,stats}=utilities(),p=P.createAppsScriptPrimitives(u),value='S'.repeat(5*1024*1024);assert.equal(p.Buffer.byteLength(value,'utf8'),Buffer.byteLength(value,'utf8'));assert.equal(p.crypto.createHash('sha256').update(value).digest('hex'),Crypto.createHash('sha256').update(value).digest('hex'));assert.deepEqual(stats,{blobs:0,bytes:0,stringDigests:1,arrayDigests:0});
});
test('over-budget or coerced string input fails before a native digest',()=>{
 const {u,stats}=utilities(),p=P.createAppsScriptPrimitives(u);let coercions=0;const value={toString(){coercions++;return 'x';}};
 for(const fn of [()=>p.crypto.createHash('sha256').update(value),()=>p.crypto.createHash('sha256').update('x','hex'),()=>p.crypto.createHash('sha256').update('雪'.repeat(Math.floor(P.MAX_BYTES/3)+1)),()=>p.crypto.createHash('sha256').update('x'.repeat(P.MAX_BYTES)).update('x')])assert.throws(fn,/apps_script_compatibility/);assert.equal(coercions,0);assert.deepEqual(stats,{blobs:0,bytes:0,stringDigests:0,arrayDigests:0});
});
test('native charset accessors and later enum/method drift fail without invoking getters',()=>{
 let hits=0;const a=utilities();Object.defineProperty(a.u,'Charset',{get(){hits++;return {UTF_8:'utf8'};}});assert.throws(()=>P.createAppsScriptPrimitives(a.u),/apps_script_compatibility/);assert.equal(hits,0);
 const b=utilities();Object.defineProperty(b.u.Charset,'UTF_8',{get(){hits++;return 'utf8';}});assert.throws(()=>P.createAppsScriptPrimitives(b.u),/apps_script_compatibility/);assert.equal(hits,0);
 for(const mutate of [u=>{u.Charset={UTF_8:'utf8'};},u=>{u.Charset.UTF_8='other';},u=>{u.computeDigest=()=>[];}]){const f=utilities(),p=P.createAppsScriptPrimitives(f.u);mutate(f.u);assert.throws(()=>p.crypto.createHash('sha256').update('x'),/apps_script_compatibility/);assert.equal(f.stats.stringDigests,0);}
 const f=utilities(),p=P.createAppsScriptPrimitives(f.u),hash=p.crypto.createHash('sha256').update('x');f.u.Charset.UTF_8='other';assert.throws(()=>hash.digest('hex'),/apps_script_compatibility/);assert.equal(f.stats.stringDigests,0);
});
test('the native 32-byte result retains full descriptor checks and suppressed exceptions',()=>{
 let getters=0;for(const result of [[],Array(32),Array(32).fill(256),Array(32).fill(-129),Object.assign(Array(32).fill(0),{extra:true}),(()=>{const v=Array(32).fill(0);Object.defineProperty(v,'0',{enumerable:true,get(){getters++;return 0;}});return v;})()]){const f=utilities();f.u.computeDigest=()=>result;assert.throws(()=>P.createAppsScriptPrimitives(f.u).crypto.createHash('sha256').update('x').digest('hex'),/apps_script_compatibility/);}assert.equal(getters,0);
 const f=utilities();f.u.computeDigest=()=>{throw Error('SYNTHETIC_PRIVATE');};assert.throws(()=>P.createAppsScriptPrimitives(f.u).crypto.createHash('sha256').update('x').digest('hex'),e=>e.message==='apps_script_compatibility');
});
test('missing Charset retains the strict existing byte fallback without accepting holes or getters',()=>{
 const f=utilities();delete f.u.Charset;const p=P.createAppsScriptPrimitives(f.u);assert.equal(p.crypto.createHash('sha256').update('café').digest('hex'),Crypto.createHash('sha256').update('café').digest('hex'));assert.deepEqual(f.stats,{blobs:1,bytes:1,stringDigests:0,arrayDigests:1});
 let hits=0;for(const bytes of [Array(1),Object.assign([120],{extra:true}),(()=>{const a=[];Object.defineProperty(a,'0',{enumerable:true,get(){hits++;return 120;}});return a;})()]){const bad=utilities();delete bad.u.Charset;bad.u.newBlob=()=>({getBytes:()=>bytes});assert.throws(()=>P.createAppsScriptPrimitives(bad.u).crypto.createHash('sha256').update('x'),/apps_script_compatibility/);}assert.equal(hits,0);
});
