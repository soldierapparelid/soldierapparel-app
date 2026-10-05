# Codec operasi untuk persiapan migrasi

Status: komponen murni yang diuji dengan data sintetis. Belum dipasang pada HTML, jurnal, Rules, Hosting atau database. Tidak memberi izin tulis divisi dan tidak mengaktifkan layanan/billing. Owner memilih penerbitan upah otomatis saat aplikasi owner tutup; hasil akhir memerlukan publisher server yang terautorisasi, bukan browser owner yang harus terbuka.

`operations-codec.js` tersedia sebagai `SoldierOperationsCodec` di browser dan ekspor CommonJS di pengujian lokal. Salinan skema browser memakai daftar kolom operasi `finance-schema.cjs`; pengujian menolak perubahan skema yang belum diselaraskan. Berkas browser tidak memerlukan modul CJS.

- `decode(productsMap)` menerima peta produk dengan key sama persis dengan ID string stabil dan mengembalikan salinan array untuk tampilan.
- `encode(productsView)` menerima array produk dan mengembalikan salinan peta menurut ID produk. Urutan tampilan tidak menjadi key angka.
- `createMerge(ProductionSync.merge, options)` menghasilkan fungsi `(baseMap, localMap, remoteMap)`; `merge(baseMap, localMap, remoteMap, ProductionSync.merge, options)` menyediakan bentuk langsung. `options.fields` harus daftar kolom operasi yang dikenal; tanpa opsi, semua kolom operasi kecuali ID dipakai. Konflik mengembalikan `{ok:false, conflicts}` tanpa kandidat `value`.

Array riwayat dan arsip dipertahankan, termasuk posisi placeholder `null`, array kosong, hubungan `assignmentId`, `hfId`, `qcId`, `qcBatchId`, dan peta riwayat menurut ID. Peta riwayat harus memiliki key sama dengan ID record; peta legacy dengan key indeks berbeda dari ID memerlukan penyesuaian privat sebelum dipakai. `arsip` dan toggle BigSeller boolean tetap boolean. `null` pada kolom koleksi adalah bentuk kosong yang dipertahankan; peta/array produk paling luar harus eksplisit (`{}` atau `[]` untuk kosong), bukan `null`. Caller perlu menangani cabang Firebase yang tidak ada secara eksplisit setelah mengonfirmasi skema.

Tidak ada konversi tipe, penghapusan kolom asing, penebakan ID/nama, penghitungan ulang tarif, atau mutasi input. Kolom uang/PIN/notes/credential yang tidak ada pada daftar kolom menyebabkan error generik. Nilai non-JSON, getter, prototype khusus, key berbahaya, ID ganda, key-ID berbeda, jumlah negatif/pecahan, tanggal kalender salah dan struktur terlalu besar ditolak. Getter tidak dijalankan saat pemeriksaan.

Codec memvalidasi bentuk dan tipe operasi. Ia belum membuktikan hubungan record menunjuk sumber yang ada, jumlah produksi konsisten, kepemilikan akun, hak mengubah pekerjaan, atau saldo upah. `ProductionSync.merge` masih menjalankan kebijakan konflik PO/arsip; codec tidak menggantikan otorisasi server. Integrasi tetap perlu transaksi dengan ACK, penjagaan draf durable, namespace project/UID/skema, pemulihan privat legacy, Rules per-record dan publisher uang server. Jangan mengganti flush transaksi dengan set tanpa pemeriksaan.

Jalankan pemeriksaan lokal dengan `node --test tests/operations-codec.test.cjs`. Pengujian mencakup UMD browser, kesamaan skema, roundtrip, edit, merge bersamaan, konflik, penolakan kolom uang/ID palsu/JSON tidak valid, dan pelestarian input.
