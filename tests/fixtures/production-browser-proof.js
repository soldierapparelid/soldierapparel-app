'use strict';
document.getElementById('run').onclick=async()=>{
  const button=document.getElementById('run'),status=document.getElementById('status'),list=document.getElementById('results');button.disabled=true;list.textContent='';status.textContent='Memeriksa…';
  const endpoint='https://synthetic.example.invalid/v1/production/commands',project='demo-native-proof',databaseURL='https://'+project+'.firebaseio.com',uid='proof-'+crypto.randomUUID();
  const scope=n=>({projectId:project,databaseURL,tenantId:'tenant-'+n,uid,grantRevision:0}),stores=[];
  const makeStore=(s,guard=()=>true,extra={})=>{const v=SoldierProductionCommandStore.createCommandStore({enabled:true,indexedDB,scope:s,endpointURL:endpoint,isCurrent:guard,...extra});stores.push(v);return v;};
  function check(v){if(!v)throw Error('check_failed');}
  function line(text){const item=document.createElement('li');item.textContent='✓ '+text;list.append(item);}
  let passed=0;
  async function step(label,fn){await fn();passed++;line(label);}
  const command=id=>({requestId:id,productId:'product-1',cycleId:'cycle-1',expectedRevision:0,kind:'sewing',payload:{id:'sewing-'+id,assignmentId:'assignment-1',tanggal:'2026-10-05',good:1,reject:0}});
  try{
    const a=makeStore(scope(1)),b=makeStore(scope(1));
    await step('Penyimpanan selesai sebelum hasil sukses dikembalikan.',async()=>{check(await a.read()===null);check(await a.write('native-first',null)===true);check(await b.read()==='native-first');});
    await step('Dua pengirim tidak dapat menimpa sumber yang sama.',async()=>{const results=await Promise.all([a.write('one','native-first'),b.write('two','native-first')]);check(results.filter(x=>x===true).length===1);check(results.filter(x=>x===false).length===1);});
    await step('Antrean tetap tersimpan setelah koneksi penyimpanan dibuat ulang.',async()=>{const previous=await a.read();a.dispose();check(await makeStore(scope(1)).read()===previous);});
    await step('Akun dan versi izin berbeda tidak mengambil antrean lama.',async()=>{check(await makeStore({...scope(1),uid:uid+'-other'}).read()===null);check(await makeStore({...scope(1),grantRevision:1}).read()===null);});
    let current=true,session=scope(2),s=makeStore(session,()=>current),calls=0,tokens=0,commits=0,lost=true,firstRaw;
    const journal={read:s.read,write:s.write};
    const fetchRequest=async(url,init)=>{check(url===endpoint&&init.credentials==='omit'&&init.redirect==='error');calls++;check(typeof await s.read()==='string');if(!firstRaw){firstRaw=init.body;commits++;}else check(init.body===firstRaw);if(lost){lost=false;throw Error('synthetic_lost_response');}const c=JSON.parse(init.body).command,raw=JSON.stringify({ok:true,receipt:{requestId:c.requestId,revision:1,acceptedAt:'2026-10-05T03:00:00.000Z'},replayed:true});return {status:200,url,type:'cors',redirected:false,headers:new Headers({'Content-Type':'application/json'}),body:new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(raw));controller.close();}})};};
    const makeClient=store=>SoldierProductionCommandClient.createClient({enabled:true,scope:scope(2),endpointURL:endpoint,getSession:()=>session,isCurrent:()=>current,getIdToken:async()=>{tokens++;return 'synthetic.token.signature';},fetch:fetchRequest,journal:{read:store.read,write:store.write}});
    const client=makeClient(s);
    await step('Pekerjaan masuk antrean sebelum pengiriman pertama.',async()=>{check((await client.prepare(command('request-1'))).ok===true);check((await client.pending()).commands.length===1);check(calls===0);});
    await step('Respons hilang mempertahankan permintaan yang sama; kirim ulang tidak menambah pekerjaan.',async()=>{check((await client.send('request-1')).error==='result_unknown');check((await client.pending()).commands.length===1);check((await client.send('request-1')).ok===true);check((await client.pending()).commands.length===0);check(commits===1&&calls===2&&tokens===2);});
    await step('ID pekerjaan yang sama dengan isi berbeda ditahan.',async()=>{const c=command('request-1');c.payload.good=2;check((await client.prepare(c)).error==='conflict');check(calls===2);});
    await step('Kolom uang buatan tidak disimpan sebagai command.',async()=>{const before=await s.read(),c=command('request-money');c.payload.tarif=123;check((await client.prepare(c)).error==='invalid_request');check(await s.read()===before);});
    const other=makeClient(makeStore(scope(2),()=>current));
    await step('Dua pengirim menjaga kedua draf saat menyimpan bersamaan.',async()=>{const results=await Promise.all([client.prepare(command('request-2')),other.prepare(command('request-3'))]);check(results.every(x=>x.ok));const pending=await client.pending();check(pending.commands.length===2);check(pending.commands.some(c=>c.requestId==='request-2')&&pending.commands.some(c=>c.requestId==='request-3'));});
    await step('Perubahan akun menghentikan pengiriman tanpa menghapus sumber antrean.',async()=>{current=false;check((await client.send('request-2')).error==='access_denied');check(calls===2);current=true;check((await makeClient(makeStore(scope(2))).pending()).commands.length===2);});
    const receipt=id=>({requestId:id,revision:1,acceptedAt:'2026-10-05T03:00:00.000Z'});
    const doc=(s,entries)=>JSON.stringify({schemaVersion:1,scope:s,endpointURL:endpoint,entries});
    const archive=(s,id)=>JSON.stringify({schemaVersion:1,scope:s,endpointURL:endpoint,command:command(id),receipt:receipt(id)});
    const retained=(s,extra={})=>makeStore(s,()=>true,{retention:true,...extra});
    function retentionClient(s,store,transport){return SoldierProductionCommandClient.createClient({enabled:true,scope:s,endpointURL:endpoint,getSession:()=>s,isCurrent:()=>true,getIdToken:async()=>'synthetic.token.signature',fetch:transport,journal:{read:store.read,write:store.write,lookup:store.lookup,acknowledge:store.acknowledge}});}
    let retainedCalls=0;const delivered=new Set();
    const retainedTransport=async(url,init)=>{check(url===endpoint);retainedCalls++;const c=JSON.parse(init.body).command,replayed=delivered.has(c.requestId);delivered.add(c.requestId);const raw=JSON.stringify({ok:true,receipt:receipt(c.requestId),replayed});return {status:200,url,type:'cors',redirected:false,headers:new Headers({'Content-Type':'application/json'}),body:new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(raw));controller.close();}})};};
    await step('Pembaruan penyimpanan menjaga draf dan menutup penulis versi lama.',async()=>{
      const s3=scope(3),legacy=makeStore(s3),before=doc(s3,[{command:command('legacy-accepted'),receipt:receipt('legacy-accepted')},{command:command('legacy-pending'),receipt:null}]);check(await legacy.write(before,null)===true);
      const modern=retained(s3);check(await modern.read()===before);let oldBlocked=false;try{await legacy.write(before,before);}catch{oldBlocked=true;}check(oldBlocked);let reopenBlocked=false;try{await makeStore(s3).read();}catch{reopenBlocked=true;}check(reopenBlocked);
      const after=doc(s3,[{command:command('legacy-pending'),receipt:null}]);check(await modern.acknowledge(after,before,archive(s3,'legacy-accepted'))===true);check(await modern.read()===after);check(await modern.lookup('legacy-accepted')!==null);
    });
    const s4=scope(4),rstore=retained(s4),rclient=retentionClient(s4,rstore,retainedTransport);
    await step('Lebih dari 64 catatan selesai tanpa memenuhi antrean aktif; bukti awal tetap ada.',async()=>{
      for(let i=0;i<70;i++){const id='retained-'+i;check((await rclient.prepare(command(id))).ok===true);check((await rclient.send(id)).ok===true);}
      check((await rclient.pending()).commands.length===0);check(JSON.parse(await rstore.read()).entries.length===0);check(JSON.parse(await rstore.lookup('retained-0')).command.requestId==='retained-0');
    });
    await step('Bukti arsip diputar ulang tanpa pengiriman; perubahan isi ID yang sama ditahan.',async()=>{
      const before=retainedCalls;check((await rclient.prepare(command('retained-0'))).pending===false);check((await rclient.send('retained-0')).ok===true);const changed=command('retained-0');changed.payload.good=2;check((await rclient.prepare(changed)).error==='conflict');check(retainedCalls===before);
    });
    await step('Pengirim lama tidak dapat mengembalikan ID yang sudah diterima ke antrean.',async()=>{
      const s5=scope(5),a5=retained(s5),b5=retained(s5),empty=doc(s5,[]),one=doc(s5,[{command:command('aba-request'),receipt:null}]);check(await a5.write(empty,null)===true);check(await b5.write(one,empty)===true);check(await b5.acknowledge(empty,one,archive(s5,'aba-request'))===true);check(await a5.write(one,empty)===false);check(await a5.read()===empty);check(await a5.lookup('aba-request')!==null);
    });
    await step('Kapasitas dicadangkan sebelum kirim; catatan tertunda dan bukti tetap tersimpan.',async()=>{
      const s6=scope(6),store6=retained(s6,{archiveLimit:1}),c6=retentionClient(s6,store6,retainedTransport),before=retainedCalls;check((await c6.prepare(command('capacity-one'))).ok===true);check((await c6.prepare(command('capacity-two'))).error==='capacity_limit');check(retainedCalls===before);check((await c6.send('capacity-one')).ok===true);check((await c6.prepare(command('capacity-two'))).error==='capacity_limit');check((await c6.send('capacity-one')).ok===true);check(retainedCalls===before+1);check((await c6.pending()).commands.length===0);
    });
    await step('Dua pengirim menerima bukti yang sama dan mempertahankan draf lain.',async()=>{
      const s7=scope(7),a7=retained(s7),b7=retained(s7),ca=retentionClient(s7,a7,retainedTransport),cb=retentionClient(s7,b7,retainedTransport);check((await ca.prepare(command('concurrent-accepted'))).ok===true);check((await cb.prepare(command('concurrent-pending'))).ok===true);const results=await Promise.all([ca.send('concurrent-accepted'),cb.send('concurrent-accepted')]);check(results.every(r=>r.ok));const pending=await ca.pending();check(pending.commands.length===1&&pending.commands[0].requestId==='concurrent-pending');check(JSON.parse(await a7.lookup('concurrent-accepted')).receipt.requestId==='concurrent-accepted');
    });
    status.textContent='Lulus '+passed+' dari 16 pemeriksaan IndexedDB asli.';
  }catch{status.textContent='Pemeriksaan ditahan pada langkah '+(passed+1)+'.';}
  finally{for(const s of stores)s.dispose();button.disabled=false;}
};
