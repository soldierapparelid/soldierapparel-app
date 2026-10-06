# Pembaca upah owner yang disiapkan

Halaman `owner-upah.html` dan lima modul browser khususnya nonaktif pada sumber: `enabled:false`, enam field konfigurasi kosong. Tidak ada tautan baru di menu aplikasi utama, URL pengaktif, discovery localStorage, credential, SDK init saat OFF, atau perubahan izin live. Halaman ini dapat ditinjau dengan contoh sintetis sebelum perpindahan produksi.

## Pilihan dan batas baca

Bridge memakai konfigurasi tetap serta instance Auth/Database pada app khusus `soldier-owner-wage-v1`. SDK browser versi 10.12.2 berasal dari gstatic resmi. Login Google dipanggil dari klik pengguna dan persistence session dikelola Auth SDK. Halaman tidak menyimpan token, upah atau konfigurasi sendiri. Session berasal dari GET `/v1/production/session` memakai token segar di header; response streaming dibatasi 64 KiB, duplikasi/prototype/getter/binding tidak sah ditolak. Batas waktu connect meliputi token, HTTP dan gate grant.

Pembaca memerlukan profile owner aktif, session dengan workerLabels, dan 14 daun grant pemanggil yang cocok: active, owner, optional workerId, sepuluh boolean modul, serta revision. Katalog baru tampil setelah gate selesai. Worker dari session adalah pilihan kanonik; nama tampil tidak dijadikan identitas atau assignment. Optional cycleLabels owner memuat tepat productId, cycleId, series, namaBarang, size dari snapshot produk yang sama. String metadata dipertahankan utuh, termasuk metadata kosong lama; pasangan harus sama dengan manifest, bounded, tanpa field uang. Role lain tidak menerima atau menerima dengan sah cycleLabels ini. Session v1 tanpa field tersebut tetap didukung.

Sesudah pengguna memilih siklus lalu worker secara eksplisit, hanya tiga daun proyeksi dipantau: operations, revision, dan earningsByWorker/workerId tersebut. Direktori earningsByWorker, tenant/root, privateAuthority, tarif privat, cache/JSON lama atau worker lain tidak dibaca. Owner boleh memilih worker kanonik yang belum ditugaskan; null pada daun upah ditampilkan belum tersedia, tanpa menebak assignment atau menganggap upah nol. Model kosong yang sah memiliki total nol.

Pergantian pilihan menghapus rincian sebelum membuka pilihan baru dan menutup listener lama. Epoch pilihan serta binding akun menolak value/error callback yang terlambat. Perubahan grant/revisi, akun/proyek/database, error izin, input cacat atau logout menutup pembaca dan membersihkan DOM. OFF tidak membuka listener atau membaca getter dependensi. Tidak ada jalur writer, journal, IndexedDB bisnis, pembayaran, koreksi upah, atau perubahan nominal.

## Arti nominal

Ringkasan adalah upah kotor yang sudah tersimpan pada proyeksi pekerjaan, dibagi sementara dan hasil QC sesuai flag provisional. Rincian menunjukkan tanggal, jumlah, tarif tiap catatan serta total tersimpan. Harga lama tidak dihitung ulang dengan tarif terbaru. Nilai ini bukan bukti pembayaran, saldo bersih, kasbon atau transfer. UI menggunakan textContent untuk label dan metadata. Pilihan awal menampilkan nama produk bila tersedia, dengan ID sebagai fallback.

Operations, revision dan upah diterima lewat listener terpisah. `consistency:independent-listeners` menjelaskan bahwa pembaca ini tidak membuktikan satu snapshot lintas ketiga daun. Validation menolak produk/worker/metadata/jumlah yang salah, tetapi belum menjamin pembaruan lintas-daun atomik di browser. Jangan memakai layar ini sebagai pemeriksa transaksi atau mengganti rekonsiliasi.

## Pemeriksaan dan pemasangan berikutnya

Tes menggunakan akun, produk, tarif dan uang sintetis. Cakupannya gate grant, whitelist pilihan, read exact-child, auth/binding/deadline, error/late callback, XSS, null versus model kosong, logout serta source OFF. Emulator memakai demo lokal; Google login/revocation nyata dan izin database produksi belum dibuktikan oleh tes tersebut.

Rules yang disiapkan sudah mengizinkan owner membaca child upah tepat; perubahan ini tidak memperluas Rules. Session service tetap satu baca tenant tervalidasi untuk snapshot awal dan tidak memutasi data. Paket runtime masih memakai manifest/lock yang telah dikunci; tidak ditambah dependency atau route server.

Sebelum dipasang utama: selesaikan perlindungan buffering/parser/log pada host Functions; uji login Google browser pada staging privat dengan origin API terpisah; siapkan data/grant privat, cocokkan upah lama, dan pindahkan seluruh penulis/cache lama sebelum mengunci root produksi. Billing dan deployment belum diaktifkan dalam perubahan ini. Endpoint administratif, pembayaran dan Shopee/AI belum dipasang.
