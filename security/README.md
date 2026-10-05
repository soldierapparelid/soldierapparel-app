# Akses divisi — usulan untuk diuji sebelum produksi

Perubahan ini menambahkan login Google, izin akun yang ditetapkan owner melalui administrator Firebase, serta Rules database privat. Seluruh halaman tetap memakai alur produksi dan jurnal sinkronisasi yang ada. Jangan merilis HTML login atau Rules secara terpisah sebelum migrasi di bawah selesai: aplikasi lama belum mengirim identitas akun dan akan ditolak oleh Rules privat.

## Perubahan

- Semua 11 halaman terkunci sebelum login; listener data bisnis baru dimulai setelah identitas terverifikasi dan profil akses aktif terbaca dari server.
- `/accessControl/users/<Firebase UID>` menyimpan `active`, `owner`, dan `modules`. Akun browser, termasuk owner, tidak bisa mengubah profil sendiri. Provisioning hanya melalui Firebase Console dengan IAM yang berwenang atau Admin SDK di lingkungan tepercaya. Tidak ada pemilik pertama otomatis, registrasi otomatis, atau login anonim.
- Root database dan node yang tidak dikenal ditolak. Gaji harian, HPP, dan pembelian memiliki izin terpisah. Produksi berbagi data yang memang diperlukan beberapa divisi. QC dan laporan hanya mendapat cabang metadata penjahit yang dipakai tampilan; akses parent metadata dan cabang tarif tidak diberikan. Isi cabang penjahit belum dibatasi per kolom dan harus diperiksa sebelum migrasi produksi.
- Foto pesanan untuk produksi berasal dari `/soldier/productionPhotos`, yang hanya berisi ID barang dan gambar. Modul pembelian mempublikasikan proyeksi dari snapshot server; Rules menolak kolom tambahan seperti harga. Divisi produksi tidak diberi akses keseluruhan node pembelian demi mengambil foto.
- Default login berlaku dalam sesi browser. Opsi ingat akun hanya dipilih pada perangkat pribadi. Draf yang belum terkirim tidak boleh diteruskan menggunakan identitas lain. Jurnal dan cache lama tidak dihapus.
- SDK modular disamakan ke 10.12.2. Modul pembelian mendapat adapter pembacaan/listener/transaksi untuk menjaga perilaku sinkronisasinya.
- Workflow Gemini yang sebelumnya menulis dan mendorong perubahan otomatis dihentikan dalam usulan ini; skripnya tidak memanggil penyedia AI atau menimpa kode.

## Batas keamanan yang harus dipahami

Login tidak membuat semua data keuangan di aplikasi lama terpisah. Node produksi masih memuat tarif, riwayat pembayaran penjahit, dan informasi lain yang dibaca bersama. Akun yang mendapat akses produksi bisa membaca isi node tersebut dan dapat menulis bagian node yang diizinkan. Pembatasan per kolom, per penjahit, validasi data produksi, dan pemisahan seluruh informasi uang membutuhkan migrasi skema berikutnya. PIN lokal lama pada fitur jahit juga bukan pembatasan server; jangan menganggapnya sebagai izin admin yang kuat.

Cache localStorage dan IndexedDB yang sudah ada tidak dienkripsi oleh perubahan ini. Menutup tampilan sebelum login membatasi penggunaan normal, tetapi pemilik perangkat atau kode yang berjalan pada origin yang sama masih bisa mengakses cache. Hindari perangkat bersama untuk data keuangan. Logout mempertahankan data lokal; jangan menghapusnya sebelum draf tersinkron dan backup diperiksa.

Startup/login baru membutuhkan jaringan untuk memastikan profil aktif. Setelah sesi terverifikasi, draf offline tetap memakai jurnal lama. Pengujian seluruh alur offline dan pergantian akun di perangkat nyata wajib dilakukan sebelum rilis.

Jangan simpan password, token Shopee, refresh token, kunci OpenAI/Gemini, atau service-account JSON di HTML, localStorage, GitHub, node produksi, maupun proyeksi foto. Firebase web API key merupakan konfigurasi browser; izin data ditentukan Auth dan Rules. Credential integrasi ditempatkan pada backend tepercaya dengan penyimpanan secret. Dokumen awal integrasi ada pada PR terpisah; integrasi Shopee/AI belum diaktifkan.

## Urutan perpindahan tanpa kehilangan pekerjaan

1. Uji branch pada origin terpisah dan proyek Firebase uji yang privat, dengan data contoh tanpa nama, uang, atau credential asli. Jangan hubungkan preview ke database produksi yang masih memiliki Rules publik. Aktifkan provider Google dan authorized domain untuk origin uji melalui akun Firebase yang berwenang.
2. Daftarkan satu akun owner uji dan satu akun tiap divisi menggunakan Firebase UID yang diperiksa di Authentication; gunakan `access-profile.example.json` sebagai bentuk data, bukan daftar akun sungguhan. Uji login gagal, akun tidak terdaftar, pencabutan izin, pergantian akun, menu, transaksi, dua perangkat, dan draf offline.
3. Periksa setiap divisi: potong membaca stok dan daftar penghapusan; QC membaca nama penjahit; laporan memulihkan data; stok, pembelian, HPP, dan gaji tersinkron. Buka pembelian pada lingkungan privat untuk mengisi proyeksi foto, lalu cocokkan tampilan foto di potong/jahit/QC/laporan. Jangan menerapkan tahap ini ke produksi yang masih publik.
4. Sebelum perpindahan produksi, semua perangkat menyinkronkan draf dan melakukan backup lokal yang disimpan privat. Draf lama tanpa ikatan UID sengaja diblokir; periksa dan ekspor bersama owner, jangan menandainya sebagai milik akun baru secara otomatis. Catat daftar akun/divisi dan pastikan email pemiliknya benar.
5. Siapkan login provider, authorized domain, bundle HTML/JS, Rules final, serta provisioning akun melalui IAM. Saat perpindahan terkoordinasi, tutup Rules publik, provision profil dengan administrator tepercaya, dan rilis frontend login. Jangan membuat profil owner di database yang masih bisa ditulis publik, sebab orang lain dapat mengganti izin tersebut. Tidak ada tahap membuka kembali root `read/write: true`.
6. Periksa owner lalu satu perangkat tiap divisi sebelum seluruh karyawan beralih. Perubahan Auth/Rules dapat memutus koneksi lama; jendela perpindahan singkat perlu disepakati. Jika ada kendala, pertahankan Rules privat dan gunakan versi frontend yang sudah kompatibel login atau simpan draf offline. Jangan kembali ke frontend tanpa login dan Rules publik.
7. Backup finansial disimpan di tempat privat; jangan unggah backup ke repo publik atau layanan AI. Setelah stabil, pisahkan tarif/payroll dari node produksi dan tambah kontrol admin server untuk operasi berisiko. Lalu kerjakan backend Shopee read-only terlebih dahulu; aksi uang, stok, dan chat tidak diberikan otomatis ke agent.

## Pengujian

`node --test tests/access-control.test.cjs` menjalankan tes tanpa jaringan untuk batas otorisasi, draf, adapter pembelian, ketergantungan Rules, dan proyeksi foto. Evaluator ekspresi di tes ini bukan compiler Firebase.

Workflow `Division access tests` menguji Rules sesungguhnya menggunakan emulator di loopback, Java 21, Node 22, dan proyek `demo-soldier-security`. Hanya fixture sintetis digunakan; tidak memakai akun produksi, service account, secret, atau akses database langsung. Test menolak berjalan apabila alamat emulator tidak cocok. Jalankan dari direktori `security` dengan `npm install --ignore-scripts` kemudian `npm run test:rules`.

Lulus tes otomatis belum menggantikan uji login Google dan alur divisi pada staging. Perubahan ini tidak menerbitkan Rules atau aplikasi secara otomatis.

`staging-fixture.json` merupakan data contoh tanpa akun, uang, pelanggan, atau credential asli. Impor hanya pada proyek uji kosong yang Rules-nya sudah menolak akses publik; jangan impor menggantikan root produksi.

Referensi resmi: [Google Sign-in](https://firebase.google.com/docs/auth/web/google-signin), [persistence sesi](https://firebase.google.com/docs/auth/web/auth-state-persistence), [Rules dan pewarisan akses](https://firebase.google.com/docs/database/security/core-syntax), [unit testing Rules](https://firebase.google.com/docs/rules/unit-tests).
