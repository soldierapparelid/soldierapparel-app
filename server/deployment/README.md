# Paket server produksi yang disiapkan

Status 6 Oktober 2026: **OFF, belum dipasang dan belum mengaktifkan biaya**. Paket ini menutup kekurangan assembly server; bukan bukti aplikasi utama sudah privat, login Google nyata sudah diuji, data lama sudah dimigrasi, atau seluruh lifecycle produksi telah siap.

`configuration.cjs` adalah satu-satunya binding sumber: `enabled`, `projectId`, `databaseURL`, `tenantId`, `allowedOrigins`, dan `serviceAccount`. Seluruh nilai masih kosong dan `enabled: false`. Tidak ada aktivasi dari browser, query, body, storage atau environment variable. Jangan mengisi password, key Shopee, API key AI, private key atau token dalam file ini. Identitas runtime yang dipersiapkan adalah service account khusus `soldier-production-runtime@{projectId}.iam.gserviceaccount.com`; email ini bukan secret dan account/IAM-nya belum dibuat oleh paket.

Saat OFF, `index.cjs` mengekspor objek kosong tanpa mengimpor Firebase Functions/Admin, mengambil ADC atau menginisialisasi app. **Jangan deploy sumber OFF ke codebase yang sudah memiliki fungsi**: CLI dapat menghapus fungsi yang hilang dari source. Untuk menghentikan layanan yang telah dipasang, rencana penghentian harus ditinjau terpisah. [Perilaku penghapusan fungsi](https://firebase.google.com/docs/functions/manage-functions#delete_functions).

Saat binding telah diaktifkan melalui patch yang ditinjau, source mendaftarkan tepat satu `onRequest` bernama `soldierProduction`. Admin SDK tetap baru diimpor dan diinisialisasi pada permintaan yang lolos batas transport dan binding host. ADC berasal dari identitas runtime Google, bukan file key; environment emulator, credential-file override dan proyek host berbeda ditolak. App, Auth dan Database harus terikat ke app/proyek/instance yang sama, dengan nama app tetap. [ADC pada lingkungan Google](https://firebase.google.com/docs/admin/setup#initialize_the_sdk).

SDK dipin ke `firebase-admin: 14.5.0` dan `firebase-functions: 7.3.0`. Tag Functions tersebut mendeklarasikan dukungan peer Admin 14; runtime deklarasi adalah Node 22. Pin tingkat atas belum merupakan lock semua dependensi transitif atau hasil audit dependency. [Tag resmi Functions](https://github.com/firebase/firebase-functions/blob/v7.3.0/package.json), [rilis resmi Admin](https://firebase.google.com/support/release-notes/admin/node), [runtime Functions yang didukung](https://firebase.google.com/docs/functions/manage-functions#set_nodejs_version).

## Pembatasan tetap yang perlu diukur

| Pengaturan | Nilai draft |
| --- | --- |
| Region | `asia-southeast1` |
| Memory / CPU | 512 MiB / 1 CPU |
| Minimum / maksimum instance | 0 / 1 |
| Concurrency per instance | 1 |
| Timeout host | 60 detik |
| Deadline klasifikasi handler | 25 detik |
| Operasi in-flight handler | 1 |
| Kuota kanonik per UID aktif | 30 permintaan per 60 detik |
| Body command | 32 KiB |
| Header aplikasi | 32 KiB / 128 pasangan |
| Tenant kanonik | 8 MiB, batas inti tetap berlaku |

Options dan policy tidak dapat diperbesar melalui caller/body/environment. `minInstances: 0` memungkinkan skala turun; `maxInstances`/concurrency membatasi kapasitas, bukan jaminan maksimum rupiah. Revisi layanan yang hidup bersamaan, request ditolak, build, artefak, jaringan, logging dan database tetap memerlukan penilaian biaya. [Pengaturan kapasitas Functions](https://firebase.google.com/docs/functions/manage-functions#control_scaling_behavior), [komponen harga Cloud Run](https://cloud.google.com/run/pricing).

Sebagai **asumsi uji**, 5 pengguna × 200 panggilan/hari × 30 hari menghasilkan 30.000 panggilan/bulan. Jika waktu aktif terukur rata-rata 1 detik pada 1 CPU/512 MiB, besaran awalnya 30.000 vCPU-detik dan 15.000 GiB-detik sebelum cold start, retry dan overhead. Jika download terukur 100 KiB/panggilan, nilainya sekitar 2,86 GiB/bulan; pada 8 MiB/panggilan sekitar 234 GiB. Ukuran tenant bukan estimasi download aktual; pembacaan/transaction retry dan listener dapat menambah transfer. Angka tersebut bukan harga, target penggunaan nyata atau janji layanan gratis. Benchmark snapshot, waktu transaksi dan pemakaian per pengguna diperlukan sebelum persetujuan biaya.

Deployment Functions memerlukan paket Blaze; belum diaktifkan di pekerjaan ini. Budget **alerts-only** tidak menghentikan layanan; dokumentasi terkini juga menyediakan **spend-cap budgets** untuk layanan yang didukung, termasuk Functions. Belum ada budget/cap yang dikonfigurasi atau diverifikasi. Cap satu layanan tidak berarti seluruh biaya proyek terbatasi. [Syarat deployment](https://firebase.google.com/docs/functions/get-started#deploy_functions_to_a_production_environment), [budget dan spend cap](https://firebase.google.com/docs/projects/billing/avoid-surprise-bills#set_up_budgets).

## Batas HTTP dan pengakuan hasil

Adapter hanya meneruskan `GET /v1/production/session`, `POST /v1/production/commands`, dan preflight yang sesuai. Route admin/bootstrap/ledger/pembayaran tidak didaftarkan. Raw `Buffer` dan header Node dari framework diteruskan utuh kepada handler yang sudah ditinjau; parsed `req.body` tidak dipakai. Batas body/header adapter bekerja **setelah** framework/platform menerima request, sehingga belum membuktikan batas buffering atau streaming host. Perlu uji Functions Framework/host sebelum pemasangan.

`hosting-rewrites.prepared.json` adalah fragment review untuk dua path tepat pada domain Hosting API yang sudah disetujui; tidak dipasang atau digabung otomatis. Hosting meneruskan seluruh path/query asli, dan handler tetap menolak query. `pinTag` tidak dipakai karena dapat ikut deploy function ketika Hosting dipasang. Endpoint browser harus berupa `https://{domain-hosting-api}/v1/production/commands`; prefix URL fungsi langsung bukan konfigurasi yang didukung bridge saat ini. [Path asli dan perilaku pinTag](https://firebase.google.com/docs/hosting/full-config#rewrite-functions).

**Origin Hosting API harus berbeda dari origin halaman frontend**, termasuk di staging. Contoh pola yang didukung adalah frontend GitHub Pages menuju API Hosting terpisah, dengan origin frontend tepat dalam `allowedOrigins`. Bridge memakai `GET` session dengan `mode: 'cors'`, tetapi Fetch pada origin yang sama dapat tidak mengirim header `Origin`; mode tersebut saja tidak memaksanya. Adapter dan handler tetap mewajibkan `Origin` yang disetujui, sehingga **GET session pada origin yang sama belum didukung** dan akan ditolak bila header itu tidak ada. `Origin` dikendalikan browser; jangan mencoba mengisinya manual, memalsukan header, atau melonggarkan pemeriksaan Auth/origin sebagai perbaikan. Pemilihan origin terpisah dan uji browser nyata masih prasyarat aktivasi; belum ada domain atau konfigurasi live yang diubah. [Aturan Origin pada Fetch](https://fetch.spec.whatwg.org/#append-a-request-origin-header), [perilaku browser dan forbidden header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Origin#description).

Handler mengembalikan promise operasi hingga selesai, tanpa bergantung pada write sesudah response. Deadline 25 detik mengklasifikasikan hasil terlambat; tidak membatalkan transaksi dan bukan jaminan waktu respons. Timeout host/koneksi dapat memutus acknowledgment sesudah commit. Pertahankan command/requestId/payload/expectedRevision yang sama dan ulangi dengan token Google segar; jangan mengganti ID atau menganggap 503 berarti pekerjaan belum tersimpan. Error tetap generik; source tidak mencatat body/token/error SDK. Logging infrastruktur belum ditinjau dan tidak boleh dianggap tidak ada.

## Menyiapkan folder lokal, tanpa deployment

Dari root repo, `node server/deployment/prepare-package.cjs` membuat folder baru di `server/deployment/.prepared/{uuid}`. Script tidak menjalankan npm, Firebase CLI, server, billing atau deployment. Ia menyalin **allowlist** delapan module runtime termasuk shared owner ledger validator, dan tiga file assembly; tidak menyalin frontend, roster, backup, credential, admin writer, `.env` atau node_modules. Symlink pada path sumber/keluaran ditolak, file lama tidak ditimpa/dihapus, dan ukuran serta SHA-256 setiap salinan dicatat.

Output berisi `functions/` yang terisolasi, `firebase.json` khusus Functions, fragment Hosting review saja dan manifest. Tidak ada default project alias, credential, Rules, Hosting public folder, script install/deploy atau route admin. Paket sumber belum memiliki lock dependency yang telah ditinjau; manifest menyatakan `dependenciesInstalled: false` dan `dependencyLockReviewed: false`. Paket lokal belum layak deploy sebelum lock/audit, binding, seluruh prasyarat rilis dan persetujuan biaya selesai.

Urutan yang masih diperlukan: tinjau perubahan lifecycle/owner ledger dan pembaca/penulis seluruh modul; selesaikan rekonsiliasi serta rollback data; pilih binding tetap dan cek izin minimal runtime; pasang/uji server dan Rules **pada uji terpisah**, termasuk login nyata, pencabutan akses, kehilangan acknowledgment, quota dan buffering; ukur biaya serta minta persetujuan konkret bila Blaze/cap diperlukan; baru buat patch aktivasi dan perpindahan aplikasi utama. Tidak ada route seed atau adopsi data lama melalui server HTTP ini.

## Bukti lokal

`node --test tests/production-deployment.test.cjs`: 20 tes dengan SDK/host yang diinjeksi, tanpa jaringan Google, data usaha, billing atau deploy. Tes membuktikan default OFF, binding/config malformed, policy tetap, CORS terbatas, ADC satu kali, promise ditunggu, kegagalan dan perubahan host ditahan, serta allowlist/hash dan closure require paket. Kelulusan ini **bukan** bukti deployment Functions, autentikasi Google nyata, izin IAM produksi, latency atau biaya produksi.
