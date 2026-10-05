# Pemisahan data uang sebelum rilis produksi

Status: rancangan, belum diterapkan. Login dan draft Rules tahap pertama hanya layak diuji dengan data sintetis. Jangan memberi akun karyawan akses ke database usaha berdasarkan draft itu.

## Ketergantungan yang sudah ditemukan

- `jahit-command.html` membaca seluruh `soldier/produksi_meta`, mengubah `tukangJahit` dan `kasbonJahit`, serta menyimpan salinannya pada `jahit_meta`. Record penjahit memuat tarif, riwayat tarif, dan PIN lokal.
- `qc-command.html` membaca `produksi_meta/tukangJahit` untuk membentuk snapshot `payroll`. Cache `qc_payroll_workers` memuat record penjahit tersebut. Beberapa penyimpanan hitung fisik/QC menolak jika tarif belum tersedia.
- `hitungFisik`, `qc`, `gudang`, dan `arsip` pada data produksi dapat membawa snapshot `payroll` dengan tarif yang dibekukan. `production-payroll.js` memakai snapshot itu agar perubahan tarif sekarang tidak mengubah pembayaran pekerjaan lama.
- `laporan-produksi.html` hanya memerlukan ID/nama dari metadata penjahit, tetapi pembacaan cabang lama tetap menerima semua kolom. Mengubah tampilan saja tidak membatasi data yang diterima browser.
- Jurnal sinkronisasi dan transaksi menggabungkan data lama. Menghapus kolom uang langsung dari array produksi dapat menghapus bukti tarif lama atau membuat draf lama memasukkannya kembali.

## Skema tujuan

| Area | Isi | Akses |
| --- | --- | --- |
| `accessControl/users/{uid}` | izin aktif, modul, dan pemetaan ID penjahit | hanya profil sendiri dapat dibaca; hanya administrator tepercaya mengubah |
| `soldier/workerDirectory/{workerId}` | ID dan nama tampilan saja | divisi operasional membaca; owner/layanan tepercaya mengubah |
| `soldier/operationsV2` | pesanan produksi, tugas, hitungan fisik, QC, dan pergerakan barang yang lolos daftar kolom | setiap divisi hanya membaca/menulis operasi yang dibutuhkan |
| `privateFinance/tariffs` | tarif dan riwayat efektif | owner atau layanan tepercaya |
| `privateFinance/payrollSnapshots` | snapshot lama, ID sumber, tarif beku, waktu, pembatalan/koreksi | owner atau layanan tepercaya |
| `privateFinance/ledger` | kasbon, pembayaran dan slip | owner atau layanan tepercaya |

Nama path adalah usulan; belum menjadi API aplikasi. Default tolak akses root dan path tidak dikenal. Jangan memberi izin baca pada parent yang memiliki child keuangan. Worker directory menolak semua kolom selain daftar dua kolom; termasuk tarif, PIN, email, kasbon, atau nilai uang. Identitas akun sungguhan tidak masuk berkas repo.

Pemetaan akun jahit ke penjahit wajib memakai UID terverifikasi dan ID penjahit yang diperiksa owner. Jangan mencocokkan berdasarkan nama saja, memilih ID pertama, atau menganggap PIN frontend sebagai identitas. Karyawan jahit mengubah progres tugas miliknya; QC mengubah hitungan/pemeriksaan yang diizinkan. Pengelolaan tarif, kasbon, penjahit, pembayaran, koreksi uang, dan izin akun memakai otorisasi owner di server.

## Perubahan aplikasi dan migrasi yang diperlukan

1. Siapkan backup privat dan inventaris kolom dari administrator tepercaya. Pemeriksaan hanya mengeluarkan hitungan dan jenis kolom, tanpa record uang, credential, identitas, atau potongan backup di log. Kolom tak dikenal dan struktur tidak pasti menghentikan migrasi untuk diperiksa owner.
2. Ekstrak snapshot tarif lama ke area privat dengan ID sumber yang stabil, termasuk arsip dan hubungan `hfId`/`qcId`. Pertahankan waktu, tarif, pembatalan dan kaitan perbaikan; jangan menghitung ulang riwayat dengan tarif terbaru. Record tanpa ID atau hubungan ambigu harus diperiksa, bukan ditebak atau dibuang.
3. Bentuk worker directory dan record operasi melalui daftar kolom yang eksplisit. Jangan memakai penyaringan beberapa nama seperti `delete harga`: kolom baru dapat membawa uang. Bandingkan jumlah pesanan, tugas, hitungan, QC, gudang dan arsip dengan sumber sebelum rilis. Simpan checksum lokal privat untuk salinan sumber dan hasil.
4. Ubah listener dan transaksi aplikasi agar karyawan menerima data operasi/direktori saja. QC tetap dapat mencatat hitungan dan pemeriksaan tanpa menerima tarif. Perhitungan slip memakai fakta operasi dan snapshot privat di layanan tepercaya atau alur owner yang terautorisasi; kebijakan tarif baru dan koreksi uang harus divalidasi server. Jangan sekadar mengganti directory lalu melewati pemeriksaan tarif pada kode lama.
5. Hapus jalur PIN admin lama dan pilihan penjahit bebas sebagai dasar otorisasi. Tindakan admin perlu pemeriksaan role server. Cache owner, cache pekerja dan jurnal harus terikat UID serta versi skema. Draf lama diperiksa/ekspor privat terlebih dahulu; jangan otomatis mengunggah ulang seluruh blob lama ke skema baru.
6. Uji pada proyek terpisah dengan fixture sintetis, dua akun/perangkat, draf offline dan konflik. Terapkan penolakan server bagi bundle lama agar klien lama tidak dapat memasukkan ulang kolom uang. Frontend dan Rules baru dirilis bersama dalam perpindahan yang terkoordinasi; jangan membuka kembali akses publik untuk mengatasi kegagalan.

Tidak ada migrasi atau perhitungan uang otomatis yang dijalankan oleh draft ini. Bila layanan backend membutuhkan billing, siapkan perubahan yang dapat ditinjau dan minta keputusan biaya sebelum mengaktifkan langganan. Jangan membuat private key untuk browser atau memakai credential CI persisten sebagai jalan pintas.

## Syarat lulus sebelum perpindahan

- Akun anonim, belum terdaftar, dicabut, dan modul salah ditolak oleh server, termasuk akses langsung yang melewati menu.
- Akun jahit dan QC tidak dapat membaca tarif, kasbon, pembayaran, snapshot uang, PIN, HPP, pembelian, gaji, atau parent keuangan. Jahit tidak bisa mengubah tugas penjahit lain atau profilnya sendiri.
- Kolom tambahan, tipe salah, angka hitungan negatif/tidak bulat, referensi sumber palsu dan usaha menulis kolom uang ditolak server. Kuantitas valid mengikuti alur produksi yang sudah diuji.
- Catatan baru, hitungan fisik, QC, perbaikan dan masuk gudang tetap berjalan; saldo pekerjaan dan pembayaran lama sama sebelum/sesudah migrasi. Perubahan tarif saat ini tidak mengubah riwayat beku.
- Pergantian akun tidak mengunggah draf atau menampilkan cache akun lain. Perangkat bersama dan backup lokal memerlukan pengaturan akses perangkat yang sesuai; kode login saja tidak mengenkripsi cache lama.
- Owner dan karyawan menguji origin serta bundle baru, lalu owner memeriksa hasil backup dan sinkronisasi. Status lulus tes otomatis saja tidak cukup untuk merilis produksi.
