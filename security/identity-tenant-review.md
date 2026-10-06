# Candidate tenant identitas awal v2 — OFF

`server/production-identity-tenant.cjs` hanya menyediakan validator dan preparer
murni. Tidak memuat SDK, I/O, clock, logger, writer, Auth, route, registry,
runtime atau migrasi. Factory default OFF hanya memeriksa own data `enabled`,
tanpa membaca konfigurasi/input. Source dan tes memakai data sintetis.

`validateInitialIdentityTenant(value,{projectId,tenantId})` menerima exact root
`{schemaVersion:2,projectId,tenantId,initialization,workerCatalog,grants}`.
Ia mengembalikan deep copy yang frozen, tanpa mengubah atau membekukan input.
V1, produk (termasuk null/{}), ledger owner/tarif, enrollmentRegistry, keuangan,
credential dan field tambahan ditolak. Tidak ada normalisasi v2 menjadi v1,
produk kosong, placeholder siklus, atau transisi ke produksi.

Initialization exact:
`{schemaVersion:1,kind:'reviewed-identity-only-v1',reviewed:true,bootstrapId,
initializedAt,ownerUid,ownerGrantRevision:1}`. Timestamp wajib canonical ISO
UTC dengan milidetik; berasal dari input operator, bukan clock atau verifikasi
Auth dalam module. Marker reviewed menyatakan deklarasi candidate yang
ditinjau, bukan bukti autentikasi nyata atau izin menulis.

Catalog exact: `{schemaVersion:1,revision:1,reviewed:true,workers}` dengan
1–128 key ID stabil. Setiap row hanya `{division:'jahit'|'potong',reviewed:true}`.
Catalog tidak menetapkan role, akun, assignment, jumlah pekerjaan, tarif, label
atau pembayaran. Record Potong yang belum ditinjau tetap di luar candidate;
catalog yang valid pun tidak memberi grant Potong. Tidak ada pencocokan nama,
email, ID legacy, alias atau perbaikan ID otomatis.

Grant harus tepat satu di key `initialization.ownerUid`:
`{revision:1,profile:{active:true,owner:true}}`. Tidak menerima modules,
workerId, owner lain atau nonowner. UID dan key worker numeric-only ditolak
dengan `unsupported_storage_key`: RTDB dapat mengembalikan map key numerik
sebagai array melalui `val()`. Penolakan tetap berlaku jika map juga memiliki
key nonnumerik. Module tidak mengganti ID nyata; sumber dengan ID tersebut
memerlukan representation lain yang ditinjau sebelum dapat dipersiapkan.

`createInitialIdentityTenantPreparer({enabled,scope:{projectId,tenantId}})`
menerima `.prepare({ownerUid,bootstrapId,initializedAt,workerCatalog})`.
Profile/role tidak diterima dari input; preparer membangun konstanta owner
di atas. Success memuat `.tenant`, `preparedOnly:true` dan selalu
`readyForProduction:false,authorizationGranted:false,authProven:false,
grantWritten:false,migrated:false`. Nilai candidate untuk operator privat;
tidak ada output/log otomatis atau izin browser untuk membaca catalog/root.

Seluruh input diperiksa melalui descriptor sebelum copy/validasi. Accessor,
symbol, field tidak enumerable, prototype lain, key terlarang, fungsi, cyclic
graph, array renggang dan scalar JSON tidak valid ditolak. Serializer sizing
hanya menggunakan JSON rendering primitive; tidak memanggil inherited/own
`toJSON` atau coercion objek. Batas tetap seluruh input JSON 64 KiB UTF-8,
kedalaman 16, 4.096 node, dan 128 worker. Scope/UID/timestamp/versi/boolean wajib
tipe primitive exact. Error hanya kategori tetap, tanpa nilai input.

Candidate nonempty bertahan pada model pruning RTDB tanpa `products:{}`.
Uji model adalah pemeriksaan murni; SDK emulator genuine dan operator proof
ditinjau terpisah. Tidak ada hasil uji ini yang membuktikan owner UID nyata,
Google sign-in, grant tersimpan, aturan akses atau keamanan aplikasi utama.

V2 belum diterima adapter/session/enrollment/history/admin/Rules/runtime lama.
Increment berikutnya harus menambahkan validator registry/claimed-only grant,
readers dari satu snapshot canonical, self-grant Rules saja, dan lifecycle
revokasi v2 yang mempertahankan reservation UID/subject/worker. Semua path
produksi v1 tetap terpisah. Writer bootstrap create-only dan proof operator
masih diperlukan; pekerjaan/upah lama tidak diadopsi oleh seed identitas ini.

Jika ancestor memberikan izin read/write, descendant tidak bisa membatalkan
izin yang diwariskan itu melalui child deny. Sebelum setiap write operator
nyata, wajib memastikan penutupan ROOT/namespace privat yang disetujui dan
diuji, dengan kompatibilitas/cutover legacy terkoordinasi (atau pengamanan
setara yang ditinjau dan diuji). Module ini tidak membuktikan Rules target,
melakukan write atau mengubah Rules/live; candidate tidak boleh diterbitkan
sebelum prasyarat perlindungan namespace tersebut terbukti.
