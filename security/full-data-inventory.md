# Pemeriksaan backup penuh secara privat

`full-data-inventory.cjs` hanya membaca berkas lokal. Jalankan terhadap ekspor root RTDB yang diperoleh melalui akses proyek resmi; simpan backup asli di tempat privat di luar repo dan Hosting. Tidak mengambil data lewat URL database publik, tidak menulis kembali data, dan tidak mengekspor kandidat sumber.

Contoh dengan path privat milik operator:

```text
node security/full-data-inventory.cjs <backup-root-lokal.json> [draft-lokal.json]
```

Output hanya status, jumlah keluarga data, kode masalah umum dan boolean kecocokan. Tidak memuat nama berkas/sumber, nominal, ID, kontak, PIN, credential, checksum, atau cuplikan error parser. Jangan mengunggah berkas input ke GitHub/CI/AI. Tes memakai fixture sintetis.

Pemeriksaan mencakup produksi/arsip/assignment/count/QC/gudang, ID mitra dan referensi, tarif beku/riwayat, kasbon/cicilan, pembayaran settled, deletion/tombstone, stok/bahan/rencana potong, pembelian, gaji harian, HPP serta draf opsional. Keluarga rahasia/izin/sumber privat dipertahankan utuh dan tidak diinterpretasikan sebagai data operasional. Kolom/root yang tidak dikenal memerlukan peninjauan; tidak dibuang otomatis. Batas input 16 MiB, 250.000 node, depth 32, hanya JSON reguler tanpa getter/prototype asing.

Aritmetika uang diperiksa pada representasi desimal yang disimpan. Tidak ada pembulatan, penggantian tarif, inferensi nama atau koreksi saldo. `sourcePreserved` membuktikan pemeriksa tidak memutasi input di memori, bukan bukti pemulihan backup di server/perangkat. `scopedCalculatedEarningsParity` hanya mencakup kandidat jahit/QC yang sudah tersedia. `readyForProduction` selalu false dan `fullReconciliation` tetap pending sampai migrasi lengkap, uji pemulihan, pemetaan privat akun, dan integrasi semua alur selesai.

Belum digunakan terhadap data usaha asli: akun yang sedang aktif pada konsol SOLDIER-PRODUKSI tidak memiliki izin mengelola Realtime Database. Tidak ada bukti seluruh saldo, slip atau data aplikasi sudah cocok. Login/draf/server core yang lulus tes tidak menggantikan pemeriksaan data asli.
