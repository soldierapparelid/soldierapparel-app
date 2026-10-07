# Pembaca murni riwayat tersimpan per mitra

`legacy-stored-history.js` adalah modul terpisah tanpa I/O, SDK, penyimpanan browser, penulisan database atau kaitan dengan halaman aplikasi lama. Factory mati secara default. Kode dan pengujian memakai data sintetis saja; belum ada publikasi riwayat, grant, API, perubahan Rules atau pemasangan di aplikasi utama.

Database lama masih memiliki akses luas. Memasang pembaca murni ini saja tidak mengamankan database atau aplikasi utama. Filter di browser tidak boleh dipakai sebagai batas akses.

## Kontrak data dan batas akses

`createLegacyStoredHistoryProjector({enabled, binding}).project({snapshotVersion, products})` menghasilkan `{ok:true,view}` atau kode kesalahan tetap. Binding harus berasal dari server yang sudah memverifikasi akun dan grant aktif: `{projectId,databaseURL,tenantId,uid,workerId,division,grantRevision}`. `division` hanya `jahit` atau `potong`. Modul menyalin dan membekukan binding; metode `project` tidak menerima pilihan akun, pekerja, peran, email atau profil. Sintaks binding bukan bukti autentikasi, izin atau keberadaan akun/database.

`normalizeLegacyStoredHistory(view, expectedBinding)` memvalidasi ulang DTO dan mencocokkan seluruh binding dengan konteks aktif, kemudian mengembalikan salinan beku. Pemanggil tetap harus menangani logout, pencabutan izin, pergantian grant dan callback terlambat. DTO bukan sumber grant.

Sumber `products` adalah koleksi produksi yang sudah dimuat oleh pemanggil server tepercaya, bukan blob seluruh root atau sumber yang dipilih browser. Array dan map RTDB didukung. Hanya `jahit` atau `potong` sesuai division yang dibaca dari produk saat ini dan `arsip` langsung. Baris harus memiliki `tukangId` yang sama persis dengan `workerId`. Nama, email, waktu, jumlah dan key map tidak menjadi pengganti identitas.

DTO hanya memuat binding, versi opaque dari pemanggil, cakupan, ketersediaan dan daftar record. Record memuat ID produk asli, metadata produk `series/namaBarang/size`, division/worker yang terikat, ID baris asli jika ada, lokasi salinan dan kolom tersimpan yang diizinkan: `tanggal`, `jumlah`, `lolos`, `rijek`, `kiloan`, `tarif`, `total`, `dibayar`, `quantityBasis`. Semua kolom opsional; kolom hilang, `null` dan nol tetap berbeda. `products:null` berarti tidak tersedia, bukan upah nol; koleksi kosong yang diketahui tersedia menghasilkan daftar kosong.

Jumlah, tarif dan total disalin secara terpisah sebagai angka terbatas, termasuk pecahan, tanpa mengalikan, membulatkan, memilih tarif terbaru atau memaksa kesamaan aritmetika. Tanggal dan basis jumlah adalah teks tersimpan terbatas, bukan hasil interpretasi kalender/QC. `dibayar` hanya marker lama yang disalin persis (`boolean`, `0/1`, string `true/false`, atau `null`); tidak membuktikan transfer, pelunasan atau nilai yang sudah dibayar. Modul tidak menghitung total ringkasan, saldo atau upah yang layak dibayarkan.

PIN, nama akun/pekerja lain, perangkat, biaya internal, kasbon, pembayaran, tarif global dan field lain tidak diproyeksikan. QC, hitung fisik, gudang, perbaikan dan hubungan antar sumber tidak disimpulkan. Cakupan ini adalah riwayat langsung tersimpan; belum mencakup seluruh slip atau perhitungan upah aplikasi lama.

## Duplikasi dan validasi

Salinan dengan ID baris asli, division dan ID produk yang sama hanya digabung jika seluruh nilai yang diproyeksikan sama persis. Nilai tetap disalin sekali, tanpa penjumlahan, dengan `copyCount` dan lokasi asal tersimpan. Perbedaan pada nilai, metadata, marker atau keberadaan kolom menghasilkan `conflicting_record`; tidak ada pilihan versi berdasarkan tanggal edit. Kesamaan ini hanya mengenali salinan eksplisit, bukan membuktikan keunikan pekerjaan, non-overlap PO atau penyelesaian pembayaran.

Baris tanpa ID tetap terpisah meskipun isinya sama. ID tidak dibuat dari index, label, key map atau hash isi. Lokasi arsip memakai ID arsip asli jika ada; tidak menciptakan cycle canonical. Arsip bersarang tidak ditelusuri. Metadata produk berasal dari produk induk sebagaimana skema arsip lama, yang menyimpan keluarga pekerjaan tanpa salinan metadata SKU.

Field yang dipakai dibaca melalui descriptor milik objek; getter field terpilih ditolak tanpa dijalankan. Field lain tidak dibaca. Codec menolak field tambahan, identitas yang berbeda, tipe tidak valid, array DTO berlubang dan provenance yang tidak sesuai. Salinan dan perbandingan tidak menjalankan `toJSON` objek/array. Semua hasil dibekukan. Ini bukan sandbox untuk Proxy atau intrinsic JavaScript yang sudah diganti oleh kode penyerang; exception inspeksi tetap menjadi kesalahan umum tanpa detail sumber.

Budget tetap: 2.000 produk, 256 arsip per produk, 8.192 arsip keseluruhan, 40.000 baris sumber dalam division, 4.096 record hasil, 8.192 salinan dan 1 MiB hasil serialisasi. Pelampauan ditolak; tidak ada hasil parsial yang dianggap lengkap atau paging otomatis yang menyembunyikan data.

## Sambungan berikutnya sebelum pemasangan utama

1. Tambahkan penyedia server yang memverifikasi token/revocation dan grant canonical aktif, mematok project/database/tenant, serta memperoleh worker/division/revision dari grant. Browser tidak mengirim identitas mitra sebagai pilihan akses. Jangan membuat tenant parsial atau memakai email-preapproval lama sebagai grant canonical.
2. Publikasikan snapshot arsip privat secara terpisah, dengan versi opaque dan pemeriksaan provenance/kelengkapan. Decoder tidak membuktikan sumber fresh, immutable atau hasil rekonsiliasi. Pemisahan immutable history dari pekerjaan baru tidak membuktikan keduanya tidak tumpang tindih.
3. Tambahkan endpoint atau projection leaf persis untuk satu UID/worker, Rules yang menolak directory/root/worker lain, dan pengujian nyata terhadap batas akses. Jangan membagikan root produksi kepada mitra lalu memfilter di browser. Akses ancestor database lama harus ditutup sebagai bagian cutover yang terkoordinasi.
4. Tambahkan UI baca saja dengan text rendering, indikator cakupan/tidak tersedia dan pembersihan data pada pergantian akun atau grant. UI harus memakai konteks sesi aktif sebagai `expectedBinding`, bukan binding dari payload itu sendiri. Riwayat lama dan perhitungan canonical baru ditampilkan terpisah sampai batas non-overlap dan rekonsiliasi terbukti.
5. Rencanakan pekerjaan yang masih berjalan, antrean/draft lokal, penghentian writer lama, export akhir, rekonsiliasi dan rollback privat sebelum migrasi utama. Modul ini belum menyelesaikan jalur tulis lama, seed populated, tarif/cycle yang belum direview, pembayaran atau hosting/IAM/platform logs.

Validasi lokal: `node --test tests/legacy-stored-history.test.cjs`. Tes sintetis meliputi ketidakcocokan jumlah/tarif/total, batas akun/division/database/revision, field privat, getter/hook serialisasi, salinan arsip, ID hilang, data kosong/tidak tersedia, tipe dan budget. Tidak ada data usaha, token, API Google atau database nyata yang dipakai.
