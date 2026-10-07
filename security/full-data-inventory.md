# Pemeriksaan backup penuh secara privat

`full-data-inventory.cjs` hanya membaca berkas lokal. Jalankan terhadap ekspor root RTDB yang diperoleh melalui akses proyek resmi; simpan backup asli di tempat privat di luar repo dan Hosting. Tidak mengambil data lewat URL database publik, tidak menulis kembali data, dan tidak mengekspor kandidat sumber.

Contoh dengan path privat milik operator:

```text
node security/full-data-inventory.cjs <backup-root-lokal.json> [draft-lokal.json]
```

Output hanya status, jumlah keluarga data, kode masalah/observasi umum dan boolean kecocokan. Tidak memuat nama berkas/sumber, nominal, ID, kontak, PIN, credential, checksum, atau cuplikan error parser. Jangan mengunggah berkas input ke GitHub/CI/AI. Tes memakai fixture sintetis.

Pemeriksaan mencakup produksi/arsip/assignment/count/QC/gudang, ID mitra dan referensi, tarif beku/riwayat, kasbon/cicilan, pembayaran settled, deletion/tombstone, stok/bahan/rencana potong, pembelian, gaji harian, HPP serta draf opsional. Keluarga rahasia/izin/sumber privat dipertahankan utuh dan tidak diinterpretasikan sebagai data operasional. Kolom/root yang tidak dikenal memerlukan peninjauan; tidak dibuang otomatis. Batas input 16 MiB, 250.000 node, depth 32, hanya JSON reguler tanpa getter/prototype asing.

Aritmetika uang diperiksa pada representasi desimal yang disimpan. `purchaseArithmeticParity` mempertahankan hasil desimal tersebut; `purchaseNativeArithmeticParity` secara terpisah memeriksa hasil perkalian bahan dan rumus order JavaScript yang memang dipakai aplikasi lama. Selisih representasi yang tepat cocok dengan rumus asli dicatat sebagai observasi, tanpa pembulatan atau koreksi. Contoh sintetis: total tersimpan `0.30000000000000004` dari `0.1 * 3` cocok secara native, tetapi tidak cocok dengan perkalian desimal eksak. Ketidakcocokan dengan kedua rumus tetap memerlukan peninjauan. Tidak ada penggantian tarif, inferensi nama atau koreksi saldo.

Riwayat bulk potong/jahit/gudang/Big Saller serta item pembelian lama dapat memang tidak memiliki ID. Pemeriksa menghitung dan memeriksa baris tersebut utuh, sambil memberi kode peninjauan identitas khusus yang tetap memblokir adopsi otomatis. Tidak membuat ID dari indeks, tanggal, nama atau isi baris. Receipt penerimaan pembelian tetap harus merujuk ID item yang benar. Field `cuttingMaterialAdditions` dan `hpp.modelConfigs` dikenali dari kode publik dan diperiksa bentuknya; isi aslinya tetap privat. Field atau keluarga lain yang belum dikenali tetap memblokir pemeriksaan.

Untuk bentuk jahit lama yang sekaligus tidak memiliki `lolos`, `quantityBasis`, dan `rijek`, history/editor asli memakai `jumlah` sebagai jumlah lolos. Bentuk sempit ini dikenali hanya untuk memeriksa tuple uang yang sudah tersimpan dan dicatat sebagai observasi `legacy_sewing_good_quantity_formula`. Pemeriksa tidak menambahkan field yang hilang. Bentuk parsial atau tuple yang tidak cocok tetap memerlukan peninjauan; tidak mengatur ulang total lama.

Deletion log lama memakai identitas `id:`, signature field yang dapat mengandung pemisah `|`, atau `link:` JSON. Tombstone yang tidak memiliki target aktif/arsip merupakan keadaan wajar setelah penghapusan; tetap dihitung dan dipertahankan. Prefix/signature tidak valid atau signature yang cocok ke beberapa baris memerlukan peninjauan. Kecocokan signature hanya untuk inventaris, tidak digunakan untuk memilih, menghapus, membangkitkan atau mengadopsi sebuah baris.

Pemeriksaan ekspor resmi dapat dilakukan lokal dan hasil agregatnya disimpan privat di luar repo. `sourcePreserved` membuktikan pemeriksa tidak memutasi input di memori, bukan bukti pemulihan backup di server/perangkat. `scopedCalculatedEarningsParity` hanya mencakup kandidat jahit/QC yang sudah tersedia. `readyForProduction` selalu false dan `fullReconciliation` tetap pending sampai migrasi lengkap, uji pemulihan, pemetaan privat akun, dan integrasi semua alur selesai. Hasil inventaris maupun login/draf/server core yang lulus tes belum membuktikan seluruh saldo, slip dan data aplikasi sudah cocok.
