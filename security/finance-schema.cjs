'use strict';
// Rehearsal only. Adding a field requires a privacy review and matching Rules.
const id={kind:'id'},text={kind:'text'},date={kind:'date'},count={kind:'count'},bool={kind:'bool'};
const common={id,tanggal:date,inputAt:text,editedAt:text};
const rows={
  potong:{...common,jumlah:count},
  assignJahit:{...common,tukangId:id,qty:count,sisa:count,targetTanggal:date},
  jahit:{...common,jumlah:count,rijek:count,lolos:count,tukangId:id,assignmentId:id,quantityBasis:{kind:'enum',values:['good-plus-reject']}},
  hitungFisik:{...common,jumlah:count,tukangId:id,qcId:id,workflowVersion:{kind:'enum',values:[2]},countStage:{kind:'enum',values:['verified']},payrollCancelled:bool},
  qc:{...common,ok:count,reject:count,perbaikan:count,kotor:count,offline:count,hfId:id,tukangId:id,workflowVersion:{kind:'enum',values:[2]},autoFromCount:bool,payrollCancelled:bool},
  gudang:{...common,jumlah:count,status:{kind:'enum',values:['ok','kotor','perbaikan','reject','offline']},qcId:id,tukangId:id,payrollCancelled:bool,payrollStage:{kind:'enum',values:['initial','repair']}},
  bigSaller:{...common,jumlah:count,qcId:id,gudangId:id},
  bigSeller:{...common,jumlah:count,qcId:id,gudangId:id}
};
const product={id,series:text,namaBarang:text,size:text,poAktif:bool,poJumlah:count,poTanggal:date,needsVerify:bool};
const archive={id,tanggalArsip:date};
// Retain these fields exclusively in the exact private source, never project them.
const privateRow=['tarif','total','dibayar','payroll','tukang','tukangJahit','tukangNama','workerName','pemeriksa','inputBy','inputVia','deviceInfo','ket','keterangan','createdAt','cancelled','canceled','cancelledAt','canceledAt','deleted','isDeleted','deletedAt'];
const privateProduct=['poKet','label','bayarJahit','harga','hpp','biaya','nominal','_offlineOrderId','bigSellerAt','bigSellerTanggal','status'];
const privateWorker=['pin','tarif','tarifHistory'];
module.exports={rows,product,archive,privateRow,privateProduct,privateWorker};
