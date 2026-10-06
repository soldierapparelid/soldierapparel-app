# Menu tarif owner: persiapan yang belum diaktifkan

`owner-tarif.html` menyediakan riwayat tarif mitra Jahit dan form penambahan versi untuk pekerjaan berikutnya. Switch pada `production-owner-tariff-page.js` dan konfigurasi server tetap OFF. Halaman utama dan situs uji belum menerima paket ini. Tidak ada nominal usaha, status pembayaran, credential, IAM, billing atau data produksi yang diubah oleh persiapan ini.

## Akses dan perubahan

Bootstrap memakai app Firebase khusus, browser SDK 10.12.2, persistence sesi dan popup Google dari klik pengguna. Identitas Google terverifikasi mengakses session server, lalu profil owner aktif serta revisi grant dikunci ke scope proyek/database/tenant/UID. Empat belas leaf grant sendiri harus cocok sebelum jurnal dibuka. Perubahan akun, grant, binding, logout atau penolakan server menutup bridge dan membersihkan tampilan tarif. Fixture Auth bukan bukti login Google atau pencabutan token nyata.

Route HTTPS tetap:

- `GET /v1/production/session`: profil sendiri dan daftar siklus aktif yang telah direview.
- `POST /v1/production/owner/tariffs/view`: envelope exact `{selection:{productId,cycleId}}`. Owner melihat tarif worker yang ditugaskan pada satu siklus. Respons direkonstruksi dari snapshot kanonik tervalidasi; tidak membawa grant orang lain, private wire, jurnal atau token. Batas 128 worker, 512 versi dan 64 KiB. Kuota memeriksa owner aktif kembali.
- `POST /v1/production/owner/tariffs/append`: envelope exact `{command}`, hanya `appendTariffVersion`. SetGrant, createCycle, setConfig dan appendTariff lama tidak tersedia melalui route ini. Writer memeriksa token segar dan owner kembali dalam CAS tenant. Revisi, history baru dan receipt berada pada transaksi yang sama.

Route operasional dan owner berbagi satu batas in-flight serta bucket kuota per UID. Reader/writer owner memerlukan owner kanonik sebelum kuota dibuat. API harus berbeda origin dari frontend agar GET session memiliki header Origin. Allowlist CORS tidak menggantikan pemeriksaan token dan izin server.

Waktu input/display memakai WIB. Kebijakan siklus menentukan jam acuan tanggal kerja; tarif baru tidak otomatis mengganti semua catatan pada waktu penyimpanan. UI menyarankan jeda 10 menit dari waktu server, mewajibkan waktu setelah versi terakhir dan konfirmasi pilihan. Server memeriksa waktu segar pada transaksi; keterlambatan dapat menghasilkan konflik. ID request/version dibuat satu kali ketika command ditangkap.

## Riwayat dan pemulihan

Form hanya menambah tarif rupiah positif utuh dengan total penugasan yang aman. Riwayat lama, frozenPayroll, Authority wire dan snapshot tidak ditulis ulang. Tarif pecahan lama, upah gudang manual, maklon Potong, kasbon, tanggal pembayaran, koreksi sejarah dan status lunas belum dipindahkan ke menu ini. Menyimpan tarif tidak mengirim uang.

Jurnal owner terpisah dari jurnal operasional, terikat scope dan endpoint. Transaksi IndexedDB menyimpan command asli sebelum HTTP dan mengarsipkannya beserta receipt setelah acknowledgment tervalidasi. Accepted ID tidak digunakan ulang. Batas 64 pending/256 KiB dan 256 accepted-plus-pending/8 MiB per scope. Meter mencadangkan kapasitas arsip sebelum kirim; kuota disk browser tetap dapat gagal. Token tidak disimpan di jurnal. Tarif lokal bukan enkripsi dan perlu perangkat owner yang dipercaya.

Putus koneksi/deadline 15 detik memberi hasil belum pasti; command tetap disimpan dan percobaan ulang memakai body/ID/revisi sama. Tidak ada retry, rebase, purge atau ID pengganti otomatis. Input sebelum prepare hanya ada di memori. Snapshot yang gagal disimpan tidak dijamin pulih setelah halaman ditutup. Akun atau revisi grant berbeda tidak mengadopsi draf lama.

UI menahan perubahan baru selama ada draf belum selesai. Konflik yang tidak bisa direplay perlu rekonsiliasi terkontrol; belum ada tombol buang/rebase atau koreksi sejarah. Batas tersebut perlu diselesaikan sebelum pemakaian penuh.

## Verifikasi dan pemasangan

Tes Node merangkai bridge/client/store/HTTP/runtime dengan fault fixture sintetis. Suite emulator terpisah memakai Firebase Admin SDK asli dan dua app independen untuk CAS, pencabutan grant, replay dan larangan browser; verifier Google masih fixture. Uji browser lokal memakai IndexedDB asli, tarif contoh, respons hilang setelah commit, reload, replay satu versi dan pembersihan DOM saat sesi berakhir. Database/Auth pada uji browser itu disimulasikan. Tidak ada data usaha atau akun produksi pada fixture/CI.

Paket deployment memuat 13 sumber/16 salinan allowlist dengan hash, termasuk admin writer yang hanya diakses runtime melalui closure tarif baru. Konfigurasi OFF, tanpa SDK init saat import. Jangan deploy OFF di atas codebase aktif karena fungsi yang tidak diekspor dapat dihapus CLI. Lock/dependency, IAM akun layanan, transport host, Google Auth nyata, tenant pertama, roster/worker dan rekonsiliasi data belum selesai.

**Jangan seed jurnal/data privat pada database dengan root read publik.** Deny child tidak mencabut izin ancestor. Seluruh modul, bundle/cache/draf dan Rules privat perlu dipindahkan bersama setelah diuji. Layanan otomatis saat aplikasi owner ditutup belum dipasang; persetujuan biaya belum diminta atau diberikan.
