# Upah otomatis ketika aplikasi owner ditutup

Keputusan owner: hasil kerja dan upah maklon diperbarui otomatis walaupun aplikasi owner tidak terbuka. Setiap mitra hanya membaca tarif/upah sendiri. Owner mengelola tarif dan melihat keseluruhan. Pencatatan pembayaran tetap berbeda dari perhitungan upah; tidak ada transfer, Shopee, atau pengiriman data usaha ke AI dalam rancangan ini.

Status: rancangan implementasi, belum ada backend yang dipasang atau billing yang diaktifkan. Komponen akses, model upah, codec operasi dan penyimpanan akun tersedia untuk integrasi. Memasang trigger pada array produksi lama saja belum memenuhi rancangan ini karena browser lama dapat mengirim tarif, identitas dan snapshot uang sendiri.

## Jalur aplikasi dan server

1. Aplikasi mengirim `submitProductionCommand` dengan login Google terverifikasi: `requestId`, `productId`, `cycleId`, `expectedRevision`, `kind` dan payload operasi yang dibatasi. Kind awal: hasil jahit, hitung fisik, QC, perbaikan, pembatalan. Owner membuat PO/tugas/arsip melalui jalur yang sama. Tidak ada penulisan blob seluruh produksi dari browser.
2. Server membaca izin aktif saat setiap perintah. Mitra jahit diikat pada ID catatan mitra yang ditetapkan administrator. QC memilih assignment yang memang ada, bukan tarif. Field tarif, total, pembayaran, payroll dan pilihan identitas bebas oleh jahit ditolak.
3. Transaksi authority per produk memeriksa revisi, jumlah dan hubungan ID. Retry request identik memperoleh receipt lama; penggunaan requestId yang sama untuk payload berbeda ditolak. Snapshot tarif tepercaya dibekukan saat hitung fisik diterima. QC/perbaikan terkait memakai snapshot yang sama.
4. Authority, snapshot revisi yang tidak dapat ditulis ulang, receipt dan outbox disimpan bersama. Trigger RTDB membaca outbox terbaru dan menghitung proyeksi dari sumber tepercaya. Trigger hanya memantau sumber/outbox, tidak memantau outputnya sendiri.
5. Penerbitan bersyarat harus membandingkan revisi authority dan revisi snapshot serta menolak revisi lebih lama. Proyeksi operasi, penggantian entri upah produk tersebut dan penanda penerbitan ditulis atomik. Retry/out-of-order trigger tidak boleh menggandakan atau mengembalikan upah lama.
6. Tampilan menunjukkan `pending`, `published` atau `review_required`. Hasil lama tidak disajikan sebagai nilai terkini saat revisi baru menunggu. Perhitungan belum tersedia tidak diubah menjadi nol atau dianggap lunas.

## Skema authority yang diusulkan

```text
privateFinance/authority/products/{productId}
  revision, operations, frozenPayroll/{hfId}
  commandReceipts/{uid}/{requestId}
  snapshots/{revision}, outbox/{revision}
privateFinance/publication/products/{productId}
  publishedRevision, entryKeysByWorker
soldier/operationsV2/products/{productId}
maklonEarnings/{workerId}/entries/{sourceHash}
maklonEarningsPublication/{workerId}/{productId}
  desiredRevision, publishedRevision, state
```

Path ini merupakan kontrak usulan, belum menjadi Rules/API terpasang. Karena path tersebar, transaksi penerbitan bersyarat pada ancestor bersama akan membaca state besar. Sebelum implementasi, ukur batas/volume dan pilih antara transaksi tersebut atau menempatkan authority serta proyeksi per produk pada satu node transaksional dengan izin child yang tepat. Jangan memakai multipath `update()` sebagai pengganti conditional CAS.

Rules final harus menolak semua penulisan browser ke authority, snapshot, output upah dan proyeksi operasi, termasuk akun owner. Perubahan tarif owner melalui command server yang divalidasi. Kandidat `finance-v2.rules.json` saat ini masih mengizinkan owner menulis proyeksi/sumber privat untuk persiapan offline: **belum merupakan Rules backend otomatis**. Izin owner pada ancestor harus dihapus sebelum mengandalkan deny di child. Admin SDK melewati Rules, sehingga pemeriksaan perintah dan pembatasan path di server wajib.

## Riwayat dan alur kerja

Gunakan ID/referensi eksplisit untuk semua catatan baru. Adapter server untuk `production-payroll.js` wajib mencegah fallback nama, tarif terkini, inferensi waktu batch dan deduplikasi berdasarkan editedAt. Terapkan tombstone/penghapusan sebelum menghitung. Riwayat yang tidak mempunyai tarif beku atau hubungan pasti perlu pemeriksaan privat; jangan mengganti dengan tarif hari ini.

Hitung fisik menghasilkan upah sementara. QC terkait mengubah jumlah yang layak dibayar, termasuk hasil nol; gudang terkait adalah cermin, bukan upah tambahan. Perbaikan memakai tanggal selesai dan tarif snapshot asli. Pembatalan QC menjaga pembatalan count/gudang terkait. QC gabungan mempertahankan masing-masing ID count/tarif. Slip lama, kasbon, pembayaran dan upah bersih harus direkonsiliasi secara terpisah sebelum migrasi dinyatakan lengkap. Tarif/tanggal mengikuti perilaku usaha yang diperiksa, termasuk zona Jakarta dan pekerjaan tanggal mundur; tidak membulatkan nilai lama diam-diam. Perhitungan maklon potong masih perlu dipindahkan dari sumber lamanya.

## Layanan dan biaya yang perlu ditinjau sebelum aktivasi

Pilihan layanan yang cocok dengan Firebase saat ini: Cloud Functions for Firebase, Node 22, lokasi sama dengan RTDB, runtime identity terkelola tanpa private key di browser/repo. Pilihan awal pengujian: minimum instance 0, maximum instance 1, concurrency 1, timeout pendek dan retry yang dibatasi melalui receipt/outbox. Pembatas instance bukan batas tagihan.

[Dokumentasi Firebase](https://firebase.google.com/docs/functions/get-started) mensyaratkan paket Blaze untuk deployment Functions; emulator dapat dipakai tanpa deployment. [Tarif resmi](https://firebase.google.com/pricing) berbasis pemakaian: batas gratis tidak menjamin tagihan nol, dan build/artifact/database juga perlu dihitung. Estimasi rupiah belum dapat diberikan tanpa jumlah event, ukuran data, runtime dan konfigurasi aktual. Pemilihan otomatis oleh owner **bukan persetujuan mengaktifkan billing**.

[Budget alerts](https://firebase.google.com/docs/projects/billing/budget-alerts) hanya pemberitahuan. [Spend caps](https://firebase.google.com/docs/projects/billing/spend-caps) untuk layanan tertentu masih Preview dan dapat terlambat menerapkan penghentian, sehingga bukan hard cap. Setelah bundle server lengkap dan tesnya dapat ditinjau, tampilkan proyek/layanan, estimasi dan batas anggaran yang diinginkan owner; baru minta keputusan aktivasi biaya. Jangan menghubungkan akun penagihan sekarang.

## Urutan pemasangan

Selesaikan command server + penerbitan + Rules emulator, ubah seluruh alur owner/mitra ke sumber operasi yang sama, ikat cache/jurnal ke akun, dan siapkan pemulihan privat draf lama. Cocokkan ID mitra serta backup lengkap secara privat. Uji dua akun/perangkat, retry/offline, pencabutan saat kirim, konflik revisi, QC/perbaikan/pembatalan, serta rollback ke bundle kompatibel. Setelah hasil dan biaya siap ditinjau, aktifkan hanya proyek uji terlebih dahulu. Produksi beralih terkoordinasi setelah rekonsiliasi; rollback mempertahankan Rules privat dan snapshot, bukan membuka kembali database publik.

Referensi implementasi: [trigger RTDB](https://firebase.google.com/docs/functions/database-events), [retry dan idempotency](https://firebase.google.com/docs/functions/retries), [runtime dan scaling](https://firebase.google.com/docs/functions/manage-functions).
