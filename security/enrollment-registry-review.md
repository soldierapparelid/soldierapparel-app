# Review registry pendaftaran mitra

Kandidat ini hanya kode server dengan pengujian sintetis. Konfigurasi produksi tetap OFF. Tidak ada roster usaha, proposal privat, token, penulisan grant live, perubahan Rules, aktivasi biaya, atau deployment dalam pekerjaan ini.

## Kontrak penyimpanan dan API internal

Tenant schema v1 menerima field opsional `enrollmentRegistry`. Tenant lama yang tidak memilikinya tetap memakai kontrak sebelumnya, termasuk ledger owner dan tarif. Jika field ini hadir, bentuknya tepat `{schemaVersion:1, approvals:{approvalId:row}}`, dengan 1–128 baris dan paling banyak 64 KiB JSON UTF-8. Registry kosong harus dihilangkan karena RTDB memangkas map kosong. Tidak ada indeks email/UID tambahan atau riwayat counter tanpa batas.

Setiap baris memuat `email`, `profile`, `reviewed:true`, `approvedAt`, `expiresAt`, `revision`, dan `status`. Waktu persetujuan/kedaluwarsa memakai ISO UTC dengan milidetik; `revision` integer aman positif. Status hanya `pending`, `claimed`, atau `revoked`. Email menggunakan validator bersama dari [helper identitas](../server/production-enrollment-identity.cjs), dicocokkan tepat terhadap ejaan lowercase Gmail yang disetujui. Tidak ada trim, perubahan huruf, penghapusan titik, atau pencocokan alias otomatis.

Profile persetujuan harus `active:true`, `owner:false`, dan hanya satu module: `{jahit:true}` dengan `workerId` canonical eksplisit, atau `{qc:true}` tanpa `workerId`. Owner, Potong, module gabungan, nama display sebagai ID, dan profile dari body permintaan tidak diterima. Nama display tidak dipakai untuk mencari pasangan akun.

`validateEnrollmentRegistry(registry, grants, products)` memeriksa bentuk, batas, keunikan dan referensi canonical; absennya registry kompatibel. `lookupEnrollmentApproval(registry, email)` dan `lookupEnrollmentClaim(registry, identity)` hanya mengembalikan salinan beku internal `{approvalId,row}` atau `null`. `claimEnrollment(tenant, identity, nowISO)` menerima tenant yang sudah diperiksa penuh dengan `validateCanonicalTenant` dari adapter dan identitas internal yang sudah diverifikasi; hasilnya salinan beku `{next,approvalId,replayed,grantRevision}`. Service harus memeriksa kembali seluruh `next` dan menyimpannya dalam CAS ancestor tenant. Hasil internal ini tidak boleh menjadi respons HTTP, log, atau keluaran CI.

`serializeEnrollmentData` dan `copyEnrollmentData` adalah helper JSON internal yang membaca descriptor data sendiri dan tidak menjalankan `toJSON` inherited pada prototype Object/Array. Batas node/depth sama dengan tenant adapter; batas 64 KiB hanya diterapkan pada registry. Ketiga integrasi tenant memakai helper ini untuk ukuran/copy. Field opsional registry, claim, quota dan worker binding juga dibaca dari descriptor sendiri. Ukuran/copy pada kedua ledger kini memakai serializer canonical berbasis data sendiri, dan regression mencakup ledger yang tidak kosong. Ini tidak berarti semua clone writer historis di modul lain sudah direview terhadap hook prototype global.

Adapter command, session service, dan tenant admin menggunakan codec registry yang sama. Session membangun respons dari allowlist semula; registry, email, Google subject dan approval tidak ikut dikirim ke browser. Tidak ada writer bootstrap/roster client dalam modul ini.

## Claim, replay dan pencabutan

Claim awal membutuhkan owner canonical yang sudah aktif, persetujuan yang masih berada dalam interval `approvedAt <= now < expiresAt`, dan untuk Jahit: worker canonical yang ada serta memiliki assignment pada cycle aktif yang sudah direview. UID yang sudah mempunyai grant, termasuk owner atau grant nonaktif, tidak boleh ditimpa. Claim awal membuat grant revision 1 dan menyimpan `claim:{uid,googleSubject,claimedAt,grantRevision:1}` pada baris yang dipilih. Nama/ID sumber, produk, authority, tarif dan kedua ledger dipertahankan.

Email, worker, UID dan Google subject yang sudah dicatat tetap unik. Status `revoked` dapat menyimpan claim sebagai tombstone; identitas dan binding itu tidak menjadi slot yang bebas dipakai ulang. Grant untuk claim harus tetap ada, mempertahankan worker binding dan revision setidaknya sebesar revision awal. Grant `active:false` dapat disimpan untuk pencabutan. Perubahan role/module yang disengaja owner tetap dapat menjadi keadaan canonical valid, tetapi tidak mengizinkan replay jika profile saat ini berbeda dari profile persetujuan.

Replay hanya menerima UID dan Google subject yang sama, registry belum revoked, dan profile canonical sekarang aktif serta sama persis dengan profile non-owner yang disetujui. Module yang cocok harus merupakan field data milik object, bukan field inherited. Claim yang sudah disimpan dicari berdasarkan UID+Google subject terlebih dahulu. Email Google yang baru terverifikasi dapat replay hanya binding lama tersebut; email baru tidak boleh memilih approval pending lain. Kecocokan sebagian UID/subject ditolak dan tidak memakai fallback email. Email hanya memilih approval pending untuk claim pertama. Replay tidak menulis ulang atau mengaktifkan grant. Kedaluwarsa persetujuan awal dan cycle yang kemudian ditutup tidak menghalangi replay dari claim yang sudah berhasil; ini memungkinkan pemeriksaan ulang setelah acknowledgment hilang. Worker canonical historis tetap harus ada. Akses usaha tetap ditentukan grant dan Rules, bukan keberhasilan replay atau perubahan status registry saja.

## Batas admission yang ikut CAS

Baris yang eligible dapat memuat satu `admission:{windowStartedAt,count}`. Window adalah epoch millisecond yang sejajar kelipatan 60.000; counter integer 1–8. Batas tetap 8 admission per menit dan tidak berasal dari caller. Claim dan replay sama-sama menambah counter serta menaikkan `row.revision` dalam CAS yang sama. Replay hanya mengubah counter/revision pada baris terpilih; claim awal juga menyimpan claim dan satu grant baru.

Email/identitas yang tidak dikenal, grant nonaktif atau scope berubah, persetujuan pending yang kedaluwarsa, dan konflik tidak membuat bucket atau mengubah counter. Admission ke-9 pada menit yang sama ditolak `rate_limited`; pergantian menit mereset counter. Service harus mematok revision canonical yang sedang diperiksa dan membuang kandidat bila baris berubah sebelum commit. Codec menolak bentuk quota/policy tambahan.

Registry menolak window menit yang mundur dan replay sebelum `claimedAt`. Dua field admission tidak menyimpan waktu setiap replay, sehingga tidak membuktikan urutan historis dua replay dalam menit yang sama. Service perlu pemeriksaan clock monotonic selama await/CAS. Quota ini melengkapi admission global dan satu slot sebelum Auth; tidak menggantikannya.

## Verifikasi dan batas kesiapan

Pengujian baru memakai data contoh untuk claim Jahit/QC, replay setelah cycle ditutup, pencabutan, UID/subject/worker collision, quota, overflow, getter/prototype/kapasitas, preservasi kedua ledger, dan integrasi ketiga pembaca tenant. Tes lama adapter/session/admin/ledger juga tetap diperlukan. Bukti jumlah CI akhir dicatat root pada kandidat final; pengujian fixture tidak membuktikan login Google live.

Sebelum aktivasi diperlukan katalog canonical dan edge legacy→canonical yang direview, scope project/database/tenant tetap, identitas Google nyata yang diverifikasi pada proyek tujuan, approval privat yang sah, serta uji staging end-to-end. Proposal owner tentang email ke ID legacy tidak otomatis menjadi UID atau izin canonical. Pekerjaan ini tidak mengubah cara aplikasi lama dipakai mitra maupun memindahkan data usaha.
