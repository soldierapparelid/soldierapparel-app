# Audit dan rencana integrasi aman

Audit: 4 Oktober 2026. Snapshot main: 6f04ca12c14d2cffe6807a28e370af0e85dafa10.
Repo publik; laporan tidak memuat nilai PIN, credential, token, identitas pelanggan atau angka keuangan aktual.

## Arsitektur yang ditemukan
- Frontend multipage HTML/CSS/JavaScript biasa; bukan React/Next.js. Tidak ada package.json, server aplikasi, API route, skema SQL atau rules Firebase di snapshot.
- Firebase Realtime Database diakses langsung oleh browser. SDK modular 10.7.1/10.12.2 dan SDK 8.10.1 coexist di modul berbeda.
- Data pusat: soldier/produksi (laporan, potong, jahit, QC); soldier/produksi_meta; soldier/stokBahan; soldier/pembelianProduk; soldier/gajiHarian; soldier/hpp.
- localStorage menyimpan JSON bisnis, konfigurasi Firebase, preferensi, dan sebagian PIN. Contoh: soldier_pembelian_produk, jahit_produksi, gaji_harian, soldier_hpp_cache_v1, notaPenjualan_v1. nota-penjualan.html dan retur-command.html memakai penyimpanan lokal; ekspor JSON/gambar adalah cadangan, bukan database server.
- app-sync-storage.js: IndexedDB soldier-app-sync-journals-v1 / records untuk jurnal perubahan dan pemulihan. app-sync-journal.js dan production-sync.js menangani sinkronisasi/konflik.
- roas-csv.js adalah impor CSV Shopee; roas-advisor.js melakukan hitungan deterministik lokal. Ini bukan koneksi Shopee Open Platform.
- manifest.json dan app-install.js menyediakan metadata/UX instalasi. Hosting aktif belum diverifikasi.

## Temuan keamanan dan batas audit
1. Tinggi: index.html membandingkan PIN di JavaScript; jahit-command.html menyimpan PIN admin di localStorage. PIN frontend dapat dilihat/dilewati dan tidak menggantikan autentikasi/otorisasi server. Jangan pakai kembali PIN ini untuk Shopee atau akun finansial.
2. Tinggi, belum diverifikasi: repo tidak memuat Firebase Auth atau database Security Rules. Ini tidak membuktikan database terbuka; konfigurasi deployed harus ditinjau melalui console dan emulator, tanpa membaca data live. Jika rules bergantung pada akses tanpa autentikasi, integrasi harus diblokir.
3. Data gaji, HPP, nota, kasbon dan backup lokal sensitif. XSS, script eksternal dan pengguna perangkat dapat mengaksesnya. Menyembunyikan harga di UI bukan kontrol akses.
4. Repo publik: partner_key, access/refresh token, OpenAI API key, service-account private key dan password tidak boleh masuk Git, HTML, JSON publik, IndexedDB atau localStorage. Konfigurasi Firebase web bukan pengganti rules dan tidak otomatis merupakan secret.
5. .github/workflows/gemini-debug.yml / check_jahit_bug.py: workflow yang dipicu manual mengirim kode jahit ke Gemini dan bisa push langsung. Input prompt juga diinterpolasi dalam perintah commit shell. Pisahkan perbaikan workflow: input lewat environment variable, least privilege, PR review, dan tidak pernah mengirim data produksi atau secret ke model.
6. Pencarian working snapshot tidak menemukan integrasi Shopee/OpenAI atau pola private key yang jelas. Ini bukan audit seluruh Git history, Actions logs, konfigurasi cloud atau perangkat. Tidak ada permintaan data database, login Shopee, atau transaksi live.

## Titik integrasi terbaik
Browser -> backend HTTPS terpisah -> adapter Shopee dan database privat.
Backend -> agregator operasional -> pembatas data -> AI read-only.
Browser menerima ringkasan/status; tidak menerima credential integrasi.

Usulan backend: Cloud Run Node.js dengan Firebase Admin untuk akses database yang dibatasi aplikasi; Firebase Auth untuk identitas pengguna; Secret Manager untuk app key/API key; penyimpanan token per toko di database privat terenkripsi dengan KMS. Firebase Admin melewati Security Rules: handler wajib memeriksa user, role dan kepemilikan toko sendiri. Token jangan ditempatkan di pohon soldier yang dipakai frontend.

Sumber produksi yang sudah tersinkronisasi adalah titik baca internal. Jangan memindahkan jurnal offline atau menulis langsung array soldier/produksi dari adapter Shopee. Gunakan namespace privat order dan pemetaan SKU; stok bahan baku bukan stok barang jadi siap jual.

## Urutan implementasi
1. Autentikasi dan akses: backup privat; tentukan owner/worker roles; tambahkan Firebase Auth; uji Security Rules dengan emulator untuk user anonim, role salah dan akses lintas toko. Jangan deploy deny-all ke data lama tanpa migrasi yang diuji.
2. Backend privat: verifikasi ID token setiap request, cek role owner untuk koneksi toko; CORS origin spesifik, limit request, respons/log error generik. Secret di Secret Manager. Token store tidak bisa dibaca browser. Uji tanpa credential nyata.
3. Shopee: daftar app dan konfirmasi scope/eligibility di Open Platform. Rancang POST /integrations/shopee/authorize dan GET callback HTTPS. Login seller dilakukan hanya pada domain resmi Shopee; jangan menerima password seller. Kaitkan callback ke sesi owner dengan nonce sekali pakai, TTL, dan perlindungan replay; verifikasi mekanisme callback yang benar-benar didukung Shopee sebelum implementasi. Signed request dan penukaran/refresh token hanya di backend. Jangan log query callback atau URL bertoken. Refresh harus memakai locking dan penyimpanan atomik.
4. Sinkronisasi read-only: simpan order/product seperlunya, pagination, retry terbatas, deduplikasi order, pemetaan SKU, waktu sinkronisasi. Pertahankan data harga/pembayaran/customer dalam area privat; jangan kirim ke AI.
5. AI: satu tool get_operational_summary. Backend menghitung hanya jumlah operasional tanpa nama, SKU bebas, alamat, order detail, harga, omzet, gaji, rekening atau credential. Validasi input dan setiap output tool sebelum request model. Tidak ada tool transfer, refund, update stok, balas chat atau pengaturan iklan. Budget/rate limit inference diperlukan.
6. UI owner: status koneksi dan kesegaran data melalui backend terautentikasi. Aktifkan pilot sesudah tes akses dan review. Tidak ada fitur uang dalam scope awal.

## Perubahan minimal pada PR ini
server/integrations/operational-boundary.mjs adalah modul Node server-only, tanpa dependensi eksternal, network, akses database atau secret. Hanya empat integer operasional diterima; field lain, getter, proxy, nested value dan angka invalid ditolak tanpa menggemakan input. Live connection, data finansial dan mutasi dinyatakan nonaktif.

Ini fondasi yang belum dihubungkan ke frontend, Shopee atau OpenAI. Policy bukan kontrol akses deployed; integrasi masa depan wajib menegakkannya di handler dan egress. Modul tidak dapat membuktikan asal atau makna angka: agregator trusted wajib mengambil sumber operasional yang benar. Jangan gunakan kolom jumlah sebagai jalur data uang. Bahkan jumlah operasional tetap internal; belum ada pengiriman eksternal yang diaktifkan.

Validasi: node --test server/integrations/operational-boundary.test.mjs.
Tidak ada perubahan alur produksi lama, rules deployed, credential atau konfigurasi akun.

## Referensi
- https://developers.openai.com/api/reference/overview — API key wajib di server, bukan browser.
- https://developers.openai.com/api/docs/guides/function-calling — handler aplikasi menjalankan tool.
- https://open.shopee.com/documents?module=63&type=2 — referensi resmi authorization. Halaman tidak dapat diambil saat audit; endpoint, signature, expiry, scope dan callback wajib diverifikasi di console/dokumentasi resmi sebelum koneksi live. Tidak mengandalkan tutorial pihak ketiga untuk implementasi credential.
