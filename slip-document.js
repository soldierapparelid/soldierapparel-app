/* Shared presentation/export only. Never reads/writes business storage or marks payment. */
(function(root,factory){
 const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.SlipDocument=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
 'use strict';
 const text=value=>String(value==null?'':value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'');
 const esc=value=>text(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const scriptURL=root.document&&root.document.currentScript&&root.document.currentScript.src;
 function asset(file){return scriptURL?new URL(file,scriptURL).href:file;}
 const logoURL=()=>asset('logo-elang.png');
 function normalize(model){
  if(!model||!Array.isArray(model.columns)||!model.columns.length||!Array.isArray(model.rows))throw new Error('Isi slip belum lengkap. Buat pratinjau lagi.');
  const table=(columns,rows)=>({columns:columns.map(c=>({label:text(c.label),align:['left','right','center'].includes(c.align)?c.align:'left',width:parseFloat(c.width)||0})),rows:rows.map(row=>{if(!Array.isArray(row)||row.length!==columns.length)throw new Error('Kolom rincian slip tidak sesuai.');return row.map(text);})});
  const main=table(model.columns,model.rows);
  return {title:text(model.title),reference:text(model.reference),recipient:text(model.recipient),recipientLabel:text(model.recipientLabel||'Penerima'),period:text(model.period),id:text(model.id),...main,
   summary:(model.summary||[]).map(row=>({label:text(row.label),value:text(row.value),emphasis:!!row.emphasis})),
   sections:(model.sections||[]).map(section=>({title:text(section.title),...table(section.columns,section.rows)})),
   signatures:(model.signatures||[]).map(s=>({label:text(s.label),name:text(s.name)}))};
 }
 function models(value){const list=Array.isArray(value)?value:[value];if(!list.length)throw new Error('Pilih minimal satu slip.');return list.map(normalize);}
 function widths(columns){const sum=columns.reduce((n,c)=>n+(c.width>0?c.width:0),0);return sum>0&&columns.every(c=>c.width>0)?columns.map(c=>100*c.width/sum):null;}
 function renderTable(columns,rows){
  const weights=widths(columns),cls=c=>c.align==='right'?'sa-slip-num':c.align==='center'?'sa-slip-center':'';
  return '<div class="sa-slip-scroll-hint">Geser tabel ke samping untuk melihat semua kolom.</div><div class="sa-slip-table-scroll"><table>'+(weights?'<colgroup>'+weights.map(w=>'<col style="width:'+w+'%">').join('')+'</colgroup>':'')+'<thead><tr>'+columns.map(c=>'<th class="'+cls(c)+'">'+esc(c.label)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map((value,i)=>'<td class="'+cls(columns[i])+'">'+esc(value)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
 }
 function render(input){
  const m=normalize(input);
  return '<article class="sa-slip"'+(m.id?' id="'+esc(m.id)+'"':'')+'><div class="sa-slip-top"><div class="sa-slip-brand"><img src="'+esc(logoURL())+'" alt="Logo Soldier Apparel"><div><strong>SOLDIER APPAREL</strong><small>SOLDIERAPPAREL.ID</small></div></div>'+(m.reference?'<div class="sa-slip-reference">Referensi<b>'+esc(m.reference)+'</b></div>':'')+'</div><h3>'+esc(m.title)+'</h3><div class="sa-slip-meta"><div><span>'+esc(m.recipientLabel)+'</span><b>'+esc(m.recipient)+'</b></div><div><span>Periode</span><b>'+esc(m.period)+'</b></div></div>'+renderTable(m.columns,m.rows)+m.sections.map(s=>'<section class="sa-slip-section"><h4>'+esc(s.title)+'</h4>'+renderTable(s.columns,s.rows)+'</section>').join('')+'<div class="sa-slip-summary">'+m.summary.map(s=>'<div'+(s.emphasis?' class="sa-slip-total"':'')+'><span>'+esc(s.label)+'</span><b>'+esc(s.value)+'</b></div>').join('')+'</div><div class="sa-slip-signatures">'+m.signatures.map(s=>'<div class="sa-slip-signature">'+esc(s.label)+'<b>'+esc(s.name)+'</b></div>').join('')+'</div><div class="sa-slip-footer">SOLDIER APPAREL</div></article>';
 }
 function guard(options){if(options&&typeof options.isCurrent==='function'&&!options.isCurrent())throw new Error('Data slip berubah. Buat pratinjau lagi sebelum mengunduh atau mencetak.');}
 function filename(value){return (text(value||'slip-upah').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-').replace(/\.+$/,'').replace(/\.pdf$/i,'').trim().slice(0,160)||'slip-upah')+'.pdf';}
 let runtimePromise;
 const scriptPromises=new Map();
 function script(file){
  if(scriptPromises.has(file))return scriptPromises.get(file);
  const promise=new Promise((resolve,reject)=>{
   const node=root.document.createElement('script');node.src=asset(file);node.async=true;
   const timer=setTimeout(()=>{node.remove();reject(new Error('Pustaka PDF belum termuat. Periksa koneksi lalu coba lagi.'));},20000);
   node.onload=()=>{clearTimeout(timer);resolve();};node.onerror=()=>{clearTimeout(timer);node.remove();reject(new Error('Pustaka PDF gagal dimuat. Muat ulang aplikasi dan coba lagi.'));};root.document.head.appendChild(node);
  }).catch(error=>{scriptPromises.delete(file);throw error;});scriptPromises.set(file,promise);return promise;
 }
 async function binary(file){const response=await root.fetch(asset(file),{signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error('Berkas slip gagal dimuat: '+file);return new Uint8Array(await response.arrayBuffer());}
 function base64(bytes){let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode.apply(null,bytes.subarray(i,i+8192));return root.btoa(raw);}
 function runtime(){
  if(runtimePromise)return runtimePromise;
  runtimePromise=(async()=>{
   await script('vendor/slips/jspdf-4.2.1.umd.min.js');await script('vendor/slips/jspdf-autotable-5.0.8.min.js');
   if(!root.jspdf||!root.jspdf.jsPDF)throw new Error('Pembuat PDF belum tersedia.');
   const [logoData,regular,bold]=await Promise.all([binary('logo-elang.png'),binary('vendor/slips/NotoSans-Regular.ttf'),binary('vendor/slips/NotoSans-Bold.ttf')]);
   return {jsPDF:root.jspdf.jsPDF,autoTable:(doc,options)=>doc.autoTable(options),logoData,fontRegular:base64(regular),fontBold:base64(bold)};
  })().catch(error=>{runtimePromise=null;throw error;});return runtimePromise;
 }
 async function createPDF(value,options){
  options=options||{};guard(options);const list=models(value),rt=options.runtime||await runtime();guard(options);
  // Noto Sans does not include the mathematical minus glyph; use the equivalent
  // printable hyphen so a deduction sign can never silently disappear in PDF.
  const pdfText=value=>text(value).replace(/\u2212/g,'-');
  list.forEach(m=>{m.rows=m.rows.map(row=>row.map(pdfText));m.summary.forEach(s=>{s.label=pdfText(s.label);s.value=pdfText(s.value);});m.sections.forEach(s=>{s.rows=s.rows.map(row=>row.map(pdfText));});});
  const doc=new rt.jsPDF({unit:'mm',format:'a4',orientation:'portrait',compress:true,putOnlyUsedFonts:true});
  doc.addFileToVFS('Slip-Regular.ttf',rt.fontRegular);doc.addFont('Slip-Regular.ttf','SlipSans','normal');
  doc.addFileToVFS('Slip-Bold.ttf',rt.fontBold);doc.addFont('Slip-Bold.ttf','SlipSans','bold');doc.setFont('SlipSans','normal');
  doc.setProperties({title:list.length===1?list[0].title+' - '+list[0].recipient:'Slip Upah - Soldier Apparel',author:'Soldier Apparel',creator:'Soldier Apparel'});
  const navy=[35,59,85],ink=[24,38,56],muted=[104,119,139],edge=[226,232,239];
  const font=(size,bold,color)=>{doc.setFont('SlipSans',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(...(color||ink));};
  const wrap=(value,width,size,bold)=>{font(size,bold);return doc.splitTextToSize(text(value),width);};
  const ranges=[];
  list.forEach((m,index)=>{
   if(index)doc.addPage();const first=doc.getNumberOfPages();
   const titleLines=wrap(m.title,180,18,true),nameLines=wrap(m.recipient,85,12,true),periodLines=wrap(m.period,85,11,true);
   const titleY=45,ruleY=titleY+(titleLines.length-1)*7+5,metaY=ruleY+8;
   const startY=metaY+7+Math.max(nameLines.length,periodLines.length)*5+5;
   let y=startY;
   function ensure(height){if(y+height>272){doc.addPage();y=39;}}
   function table(columns,rows){
    const weights=widths(columns),styles={};columns.forEach((c,i)=>{styles[i]={halign:c.align};if(weights)styles[i].cellWidth=180*weights[i]/100;});
    rt.autoTable(doc,{startY:y,margin:{left:15,right:15,top:39,bottom:24},head:[columns.map(c=>c.label)],body:rows,theme:'plain',tableWidth:180,rowPageBreak:'avoid',showHead:'everyPage',
     styles:{font:'SlipSans',fontStyle:'normal',fontSize:9,cellPadding:2,textColor:ink,lineColor:edge,lineWidth:{bottom:.2},overflow:'linebreak'},
     headStyles:{fillColor:navy,textColor:[255,255,255],fontStyle:'bold',fontSize:8.5},alternateRowStyles:{fillColor:[245,247,250]},columnStyles:styles,
     didParseCell:data=>{if(data.section==='head')data.cell.styles.halign=columns[data.column.index].align;}});
    y=doc.lastAutoTable.finalY+7;
   }
   table(m.columns,m.rows);
   m.sections.forEach(s=>{ensure(24);font(10,true);doc.text(s.title,15,y);y+=5;table(s.columns,s.rows);});
   const signatureHeight=m.signatures.length?37+Math.max(...m.signatures.map(s=>wrap(s.name,180/m.signatures.length-12,10,true).length))*4.5:0;
   const summaryHeight=m.summary.reduce((h,s)=>h+Math.max(wrap(s.label,50,9.5,false).length,wrap(s.value,45,s.emphasis?12:11,true).length)*4.4+4,0);
   ensure(Math.min(summaryHeight+signatureHeight,220));
   m.summary.forEach(s=>{
    const labels=wrap(s.label,50,9.5,false),values=wrap(s.value,45,s.emphasis?12:11,true),height=Math.max(labels.length,values.length)*4.4+4;
    ensure(height);doc.setFillColor(...(s.emphasis?navy:[245,247,250]));doc.rect(90,y,105,height,'F');
    font(9.5,false,s.emphasis?[255,255,255]:muted);doc.text(labels,94,y+5.8);
    font(s.emphasis?12:11,true,s.emphasis?[255,255,255]:ink);doc.text(values,191,y+6,{align:'right'});y+=height;
   });
   y+=9;
   if(m.signatures.length){
    const count=m.signatures.length,cell=180/count,nameHeight=Math.max(...m.signatures.map(s=>wrap(s.name,cell-12,10,true).length))*4.5;
    ensure(28+nameHeight);m.signatures.forEach((s,i)=>{const x=15+i*cell+cell/2; font(9,false,muted);doc.text(s.label,x,y,{align:'center'});doc.setDrawColor(...edge);doc.line(x-cell/2+8,y+20,x+cell/2-8,y+20);font(10,true);doc.text(wrap(s.name,cell-12,10,true),x,y+26,{align:'center'});});
   }
   ranges.push({model:m,first,last:doc.getNumberOfPages(),titleLines,nameLines,periodLines,titleY,ruleY,metaY});
  });
  ranges.forEach(range=>{
   const m=range.model;
   for(let page=range.first;page<=range.last;page++){
    doc.setPage(page);
    if(page===range.first){
     if(rt.logoData)doc.addImage(rt.logoData,'PNG',15,12,23,23,'soldier-logo','FAST');
     font(12,true);doc.text('SOLDIER APPAREL',42,22);font(8,false,muted);doc.text('SOLDIERAPPAREL.ID',42,28);
     if(m.reference){font(7.5,false,muted);doc.text('REFERENSI',195,18,{align:'right'});doc.text(wrap(m.reference,62,7.5,false),195,23,{align:'right'});}
     font(18,true);doc.text(range.titleLines,15,range.titleY);doc.setDrawColor(...navy);doc.setLineWidth(.8);doc.line(15,range.ruleY,195,range.ruleY);
     font(8,false,muted);doc.text(m.recipientLabel.toUpperCase(),15,range.metaY);doc.text('PERIODE',110,range.metaY);
     font(12,true);doc.text(range.nameLines,15,range.metaY+7);font(11,true);doc.text(range.periodLines,110,range.metaY+7);
    }else{
     font(11,true);doc.text(m.title,15,19);font(8.5,false,muted);doc.text(wrap(m.recipient+' | '+m.period,180,8.5,false).slice(0,2),15,26);doc.setDrawColor(...edge);doc.line(15,33,195,33);
    }
    doc.setDrawColor(...edge);doc.setLineWidth(.2);doc.line(15,280,195,280);font(7.5,false,muted);doc.text('SOLDIER APPAREL',15,286);doc.text('Halaman '+(page-range.first+1)+' / '+(range.last-range.first+1),195,286,{align:'right'});
   }
  });
  guard(options);return doc;
 }
 async function downloadPDF(value,options){options=options||{};const doc=await createPDF(value,options);guard(options);doc.save(filename(options.filename));return {pages:doc.getNumberOfPages(),filename:filename(options.filename)};}
 async function print(value,options){
  options=options||{};guard(options);const list=models(value);
  const response=await root.fetch(asset('slip-document.css?v=20260921-slips'),{signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error('Tampilan cetak belum termuat. Coba lagi.');
  let css=await response.text();css=css.replace(/url\('([^']+)'\)/g,(_,file)=>'url("'+asset(file)+'")');guard(options);
  const frame=root.document.createElement('iframe');frame.title='Cetak slip upah';frame.style.cssText='position:fixed;width:1px;height:1px;left:-10000px;border:0';
  return new Promise((resolve,reject)=>{
   let timer,finished=false,started=false;const cleanup=()=>{clearTimeout(timer);frame.remove();};
   const fail=error=>{if(finished)return;finished=true;cleanup();reject(error);};
   frame.onload=async()=>{if(started||finished)return;started=true;try{
    const win=frame.contentWindow,doc=frame.contentDocument;if(doc.fonts&&doc.fonts.ready)await doc.fonts.ready;
    if(finished)return;
    await Promise.all(Array.from(doc.images).map(img=>img.complete?(img.naturalWidth>0?Promise.resolve():Promise.reject(new Error('Logo cetak gagal dimuat.'))):new Promise((ok,no)=>{img.onload=ok;img.onerror=()=>no(new Error('Logo cetak gagal dimuat.'));})));
    if(finished)return;guard(options);clearTimeout(timer);win.addEventListener('afterprint',cleanup,{once:true});win.focus();win.print();finished=true;resolve();
   }catch(error){fail(error);}};
   timer=setTimeout(()=>fail(new Error('Pratinjau cetak terlalu lama. Gunakan Unduh PDF.')),25000);
   frame.srcdoc='<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Slip Upah</title><style>html,body{margin:0;background:white}'+css+'</style></head><body>'+list.map(m=>render(m)).join('')+'</body></html>';
   root.document.body.appendChild(frame);
  });
 }
 return {render,createPDF,downloadPDF,print,filename};
});
