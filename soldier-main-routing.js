'use strict';
(function(host){
 const configuration=Object.freeze({"enabled":true,"deploymentURL":"https://script.google.com/macros/s/AKfycbwFhLNyROTqFwo9unOuAIARc7VLBMl5m4bsPguC8xs5U-M3ztepXBcXnue1nExBiQIRUg/exec"});
 const routes=Object.freeze({"jahit-command.html":"?division=jahit","qc-command.html":"?division=qc","maklon-upah.html":"?division=jahit","laporan-produksi.html":"?division=owner&ownerModule=laporan","potong-command.html":"?division=owner&ownerModule=potong","stok-bahan-command.html":"?division=owner&ownerModule=stok","gaji-harian-command.html":"?division=owner&ownerModule=gaji","hpp-command-v1.html":"?division=owner&ownerModule=hpp","pembelian-produk-v1.html":"?division=owner&ownerModule=pembelian","nota-penjualan.html":"?division=owner&ownerModule=nota","retur-command.html":"?division=owner&ownerModule=retur","owner-upah.html":"?division=owner&ownerModule=jahit","owner-tarif.html":"?division=owner&ownerModule=jahit"});
 const execPattern=new RegExp("^https:\\/\\/script\\.google\\.com\\/macros\\/s\\/[A-Za-z0-9_-]{20,200}\\/exec$");
 function ready(){return configuration.enabled===true&&typeof configuration.deploymentURL==='string'&&execPattern.test(configuration.deploymentURL);}
 function target(file){if(typeof file!=='string'||!Object.prototype.hasOwnProperty.call(routes,file))throw Error('Halaman Soldier tidak dikenal.');return ready()?configuration.deploymentURL+routes[file]:null;}
 function redirect(file){const url=target(file);if(url===null)return false;try{host.location.replace(url);return true;}catch(_){return false;}}
 Object.defineProperty(host,'SoldierMainRouting',{value:Object.freeze({target,redirect,sourceOff:!ready()}),writable:false,configurable:false});
})(window);
