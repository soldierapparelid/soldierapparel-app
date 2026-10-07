# Verifikasi identitas untuk pendaftaran pertama

`server/production-enrollment-identity.cjs` adalah kandidat komponen server terpisah yang kini dihubungkan ke route claim melalui service dan runtime. Kedua switch sumber, `enabled` dan `enrollmentEnabled`, tetap OFF; route belum dipasang atau diaktifkan. Login Google nyata pada proyek tujuan belum dibuktikan. Modul tidak menginisialisasi SDK, membaca roster, membuka database, menulis izin, menyimpan token atau membuat log. Hanya instance Admin Auth yang diberikan integrasi server dapat menjalankan verifikasi melalui dua metodenya. Bukti integrasi dan batas pengujian sintetis/emulator dicatat terpisah dalam [review rilis enrollment](enrollment-release-review.md).

API CommonJS:

```js
createProductionEnrollmentIdentityVerifier({enabled,projectId,auth,clock})
  .verify({idToken})
```

Switch `enabled` harus merupakan own data property bernilai `true`. OFF tidak membaca field opsi lain, request, getter, clock atau SDK. Opsi aktif harus persis `enabled`, `projectId`, `auth`, `clock`; binding proyek disalin dan dikunci. Instance Auth, app dan metode `verifyIdToken`/`getUser` tidak boleh berganti saat menunggu. Getter app/options milik SDK didukung; accessor request/token/field identitas record tidak dijalankan.

Verifier memanggil `auth.verifyIdToken(idToken,true)` lalu `auth.getUser(uid)`. Pemeriksaan `true` juga memeriksa user disabled dan sesi revoked menurut [kontrak Admin Auth](https://firebase.google.com/docs/reference/admin/node/firebase-admin.auth.baseauth#verifyidtoken). UID token harus sama dengan `sub`, audience dan issuer harus cocok dengan proyek tetap, email terverifikasi dan provider sesi harus Google. Tidak ada UID, role, worker, email atau status review yang diterima dari body.

`firebase.identities['google.com']` harus berupa array persis satu subject ASCII aman. Subject tersebut harus sama dengan satu-satunya provider Google yang tertaut dalam UserRecord saat ini. UID, email utama, verifikasi email, user enabled dan email provider Google juga harus cocok persis. UserRecord dan UserInfo dapat berbentuk class SDK: hanya field own data yang diperlukan dipilih. Field lain seperti metadata, custom claims, passwordHash, passwordSalt atau display name tidak dibaca atau diserialisasi. Provider koleksi dibatasi 16, tanpa array sparse, field ekstra atau provider Google ganda. Firebase Auth multi-tenant belum didukung.

Ekspor murni `isEnrollmentEmail(value)` mengizinkan hanya spelling Gmail ASCII yang sudah lowercase, maksimal 254 karakter, tanpa spasi atau kontrol. Tidak ada konversi, lowercase otomatis, penghapusan titik, pemotongan plus tag atau pencocokan alias. Ini batas kandidat roster yang ditinjau; tidak mengklaim dukungan semua akun Google Workspace/domain kustom. Subject dan UID memakai ID ASCII aman 1–128 karakter. Nama tampilan tidak menjadi identitas.

`auth_time`, `iat` dan `exp` wajib integer detik aman dengan `auth_time <= iat < exp`. Clock harus menghasilkan timestamp UTC kanonik dengan milidetik dan tidak mundur selama request. `auth_time` serta `iat` tidak boleh berasal dari masa depan, `exp` harus melampaui waktu pemeriksaan akhir, dan umur autentikasi maupun penerbitan token masing-masing maksimal tepat 300.000 ms. Batas lima menit tetap dan tidak dapat diubah body/env/opsi caller. Batas diterapkan sesudah kedua await; tepat lima menit diterima, satu milidetik lebih ditolak.

Refresh ID token memperbarui `iat` tetapi mempertahankan `auth_time` sesi sebelumnya. Karena itu `getIdToken(true)` saja tidak membuktikan login baru; pendaftaran pertama perlu login/reauth Google yang memenuhi batas tersebut. Perbedaan kedua timestamp mengikuti [DecodedIdToken resmi](https://firebase.google.com/docs/reference/admin/node/firebase-admin.auth.decodedidtoken). Ini belum merupakan bukti Google Auth nyata dari pengujian sintetis.

Hasil sukses hanya untuk pemakaian internal server:

```text
{ok:true,identity:{projectId,uid,email,googleSubject,
  authTimeMs,issuedAtMs,expiresAtMs,verifiedAt}}
```

Identity dan envelope dibekukan. `verifiedAt` berupa timestamp UTC kanonik dengan milidetik; tiga field `*Ms` berupa angka. Identity memuat kontak dan ID privat: jangan mengirimnya sebagai respons HTTP, menyimpannya ke log/CI, atau memberikan akses browser ke registry. Tidak ada token atau record SDK mentah dalam hasil. Kegagalan hanya `{ok:false,error}` dengan kode `service_disabled`, `invalid_request`, `access_denied` atau `unavailable`, tanpa pesan exception/input.

Komponen ini tidak memberi izin. Service enrollment terpisah harus mengikat identity ke preapproval privat yang eksplisit, mengunci project/UID/email/subject di setiap retry luar, memeriksa clock/expiry/kedua batas freshness kembali setelah await dan di callback CAS, serta memverifikasi Auth lagi di luar callback yang dipanggil ulang. Auth dan RTDB bukan transaksi lintas layanan: hasil helper tidak menjamin pencabutan/ubah akun setelah pemeriksaan akan atomik dengan commit. Grant kanonik tetap perlu menjadi sumber otorisasi berikutnya. Kuota enrollment, registry, transaksi claim, route dan pemasangan tetap prasyarat terpisah.

Tes memakai instance kelas sintetis dengan bentuk SDK, bukan credential atau login nyata. Cakupannya OFF inert, binding berubah, request/claim accessor, waktu lama meski token refreshed, expiry saat await, user/provider mismatch, revocation/backend error generik, input beku dan tidak menjalankan `toJSON`. Pengujian SDK asli, fresh Google sign-in, IAM, latensi/biaya, quota, Rules dan deployment belum dibuktikan oleh suite ini.
