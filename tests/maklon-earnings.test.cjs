'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const Earnings=require('../maklon-earnings.js');
const id='a'.repeat(64),otherId='b'.repeat(64);
const partner={active:true,owner:false,workerId:'synthetic-worker-1',modules:{jahit:true}};
const owner={active:true,owner:true};
function fixture(){return {workerId:partner.workerId,nama:'Synthetic partner',entries:{[id]:{sourceId:id,productId:'synthetic-product-1',series:'Example',namaBarang:'Example garment',size:'M',tanggal:'2026-02-01',jumlah:3,tarif:123.5,total:370.5,sourceType:'hitungFisik',provisional:true},[otherId]:{sourceId:otherId,productId:'synthetic-product-1',series:'Example',namaBarang:'Example garment',size:'M',tanggal:'2026-02-02',jumlah:2,tarif:125,total:250,sourceType:'qcRepair',provisional:false}}};}
function denies(fn,code){assert.throws(fn,error=>error.message===code&&!error.message.includes('synthetic-secret'));}
test('trusted partner binding selects only its own worker; owner explicitly selects one worker',()=>{
  assert.deepEqual(Earnings.target(partner),{workerId:partner.workerId,path:'maklonEarnings/'+partner.workerId});
  assert.deepEqual(Earnings.target({...partner,modules:{potong:true}}),Earnings.target(partner));
  assert.deepEqual(Earnings.target(owner,'synthetic-worker-2'),{workerId:'synthetic-worker-2',path:'maklonEarnings/synthetic-worker-2'});
  denies(()=>Earnings.target(partner,'synthetic-worker-2'),'access_denied');
  denies(()=>Earnings.target(partner,partner.workerId),'access_denied');
  denies(()=>Earnings.target(owner),'access_denied');
});
test('inactive, unbound, QC-only, malformed and accessor-bearing profiles are denied',()=>{
  for(const profile of [null,{}, {...partner,active:false},{...partner,active:1},{...partner,owner:'true'},{...partner,workerId:undefined},{...partner,workerId:'../synthetic-secret'},{...partner,workerId:'__proto__'},{...partner,modules:{qc:true}},{...partner,modules:{jahit:1}},Object.create(partner)])denies(()=>Earnings.target(profile),'access_denied');
  let getterCalls=0;const profile={...partner};Object.defineProperty(profile,'workerId',{enumerable:true,get(){getterCalls++;throw Error('synthetic-secret');}});
  denies(()=>Earnings.target(profile),'access_denied');assert.equal(getterCalls,0);
  for(const workerId of ['constructor','prototype','a/b','a.b','x'.repeat(129),''])denies(()=>Earnings.target(owner,workerId),'access_denied');
});
test('normalization preserves historical money and dates, clones input and freezes output',()=>{
  const input=fixture(),before=JSON.stringify(input),result=Earnings.normalize(input,partner.workerId);
  assert.equal(JSON.stringify(input),before);assert.equal(result.entries.length,2);assert.equal(result.entries[0].total,370.5);assert.equal(result.entries[0].tarif,123.5);
  assert.equal(Object.isFrozen(result),true);assert.equal(Object.isFrozen(result.entries),true);assert.equal(Object.isFrozen(result.entries[0]),true);
  input.entries[id].tarif=9999;assert.equal(result.entries[0].tarif,123.5);
  assert.equal(result.availability,'available');denies(()=>Earnings.normalize(fixture(),'synthetic-worker-2'),'invalid_earnings');
});
test('date summary separates provisional calculated work and never claims a payment',()=>{
  const result=Earnings.summarize(Earnings.normalize(fixture(),partner.workerId));
  assert.equal(result.quantity,5);assert.equal(result.calculatedTotal,620.5);assert.equal(result.provisionalTotal,370.5);assert.equal(result.nonProvisionalTotal,250);
  assert.equal(result.paymentEvidence,'not_in_this_data');assert.equal(result.days.length,2);assert.equal(Object.isFrozen(result.days[0]),true);
  const day=Earnings.summarize(Earnings.normalize(fixture(),partner.workerId),{from:'2026-02-02',to:'2026-02-02'});
  assert.equal(day.quantity,2);assert.equal(day.calculatedTotal,250);assert.equal(day.provisionalTotal,0);
  for(const key of ['paid','dibayar','transfer','paymentDate'])assert.equal(Object.hasOwn(result,key),false);
});
test('approved count retains its source identity without being mislabeled as provisional',()=>{
  const input=fixture();input.entries[id].provisional=false;
  const normalized=Earnings.normalize(input,partner.workerId),result=Earnings.summarize(normalized);
  assert.equal(normalized.entries[0].sourceType,'hitungFisik');assert.equal(result.provisionalTotal,0);assert.equal(result.nonProvisionalTotal,620.5);
  const pending=Earnings.summarize(Earnings.normalize(fixture(),partner.workerId));assert.equal(pending.provisionalTotal,370.5);
  const invalid=fixture();invalid.entries[otherId].provisional=true;denies(()=>Earnings.normalize(invalid,partner.workerId),'invalid_earnings');
});
test('missing projection is distinguished from available zero work and never interpreted as zero paid',()=>{
  const absent=Earnings.summarize(Earnings.normalize(null,partner.workerId));
  assert.equal(absent.availability,'absent');assert.equal(absent.calculatedTotal,null);assert.equal(absent.quantity,null);assert.deepEqual(absent.days,[]);
  const zero=Earnings.summarize(Earnings.normalize({workerId:partner.workerId,nama:'Synthetic partner'},partner.workerId));
  assert.equal(zero.availability,'available');assert.equal(zero.calculatedTotal,0);assert.equal(zero.paymentEvidence,'not_in_this_data');
  denies(()=>Earnings.normalize(undefined,partner.workerId),'invalid_earnings');
});
test('strict schema rejects extra fields, mismatched hashed source identities and unsafe prototypes',()=>{
  for(const mutate of [d=>d.password='synthetic-secret',d=>d.entries[id].accessToken='synthetic-secret',d=>d.entries[id].workerId='another-worker',d=>d.entries[id].sourceId=otherId,d=>d.entries['synthetic-secret']=d.entries[id],d=>d.entries=JSON.parse('{"__proto__":{"synthetic-secret":true}}'),d=>d.entries[id].provisional='false',d=>d.entries[id].sourceType='paid']){
    const input=fixture();mutate(input);denies(()=>Earnings.normalize(input,partner.workerId),'invalid_earnings');
  }
  const input=fixture();Object.defineProperty(input.entries[id],'credential',{value:'synthetic-secret',enumerable:false});denies(()=>Earnings.normalize(input,partner.workerId),'invalid_earnings');
  const symbol=fixture();symbol[Symbol('synthetic-secret')]=1;denies(()=>Earnings.normalize(symbol,partner.workerId),'invalid_earnings');
  const inherited=fixture();inherited.entries[id]=Object.create(inherited.entries[id]);denies(()=>Earnings.normalize(inherited,partner.workerId),'invalid_earnings');
  assert.equal({}.polluted,undefined);
});
test('invalid values stop rather than round, reprice, coerce or display malformed dates',()=>{
  const mutations=[d=>d.jumlah=1.5,d=>d.jumlah=0,d=>d.jumlah=-1,d=>d.jumlah='3',d=>d.tarif=0,d=>d.tarif=Infinity,d=>d.tarif=NaN,d=>d.total=371,d=>d.total=-1,d=>d.total=Number.MAX_SAFE_INTEGER+1,d=>d.tanggal='2026-02-31',d=>d.tanggal='2026-2-01',d=>d.tanggal='',d=>d.tanggal='0000-01-01',d=>d.namaBarang='line\nsynthetic-secret',d=>delete d.productId];
  for(const mutate of mutations){const input=fixture();mutate(input.entries[id]);denies(()=>Earnings.normalize(input,partner.workerId),'invalid_earnings');}
  const valid=fixture();valid.entries[id].tanggal='2024-02-29';assert.equal(Earnings.normalize(valid,partner.workerId).entries[0].tanggal,'2024-02-29');
});
test('getters in records and arrays never run and summary refuses forged or duplicate rows',()=>{
  let calls=0;const input=fixture();Object.defineProperty(input.entries[id],'total',{get(){calls++;throw Error('synthetic-secret');},enumerable:true});
  denies(()=>Earnings.normalize(input,partner.workerId),'invalid_earnings');assert.equal(calls,0);
  const valid=Earnings.normalize(fixture(),partner.workerId),forged={...valid,entries:[valid.entries[0],valid.entries[0]]};denies(()=>Earnings.summarize(forged),'invalid_earnings');
  const rows=[];rows.length=1;Object.defineProperty(rows,'0',{get(){calls++;throw Error('synthetic-secret');},enumerable:true});denies(()=>Earnings.summarize({...valid,entries:rows}),'invalid_earnings');assert.equal(calls,0);
  const dangerous=[valid.entries[0]];Object.setPrototypeOf(dangerous,{[Symbol.iterator](){calls++;throw Error('synthetic-secret');}});denies(()=>Earnings.summarize({...valid,entries:dangerous}),'invalid_earnings');assert.equal(calls,0);
  denies(()=>Earnings.summarize({...valid,password:'synthetic-secret'}),'invalid_earnings');
});
test('summary rejects invalid filters and cumulative amounts exceeding safe numeric range',()=>{
  const valid=Earnings.normalize(fixture(),partner.workerId);
  for(const range of [null,{from:'2026-02-31'},{to:'2026-2-01'},{from:'2026-02-02',to:'2026-02-01'},{workerId:'synthetic-secret'}])denies(()=>Earnings.summarize(valid,range),'invalid_earnings');
  const input=fixture();for(const row of Object.values(input.entries)){row.jumlah=1;row.tarif=Number.MAX_SAFE_INTEGER;row.total=Number.MAX_SAFE_INTEGER;}
  const normalized=Earnings.normalize(input,partner.workerId);denies(()=>Earnings.summarize(normalized),'invalid_earnings');
});
test('UMD browser export matches the read-only API without external or storage dependencies',()=>{
  const context={};vm.runInNewContext(fs.readFileSync(require.resolve('../maklon-earnings.js'),'utf8'),context);
  assert.deepEqual(Object.keys(context.SoldierMaklonEarnings).sort(),['normalize','summarize','target']);
  assert.equal(Object.isFrozen(context.SoldierMaklonEarnings),true);
});
