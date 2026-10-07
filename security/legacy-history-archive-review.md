# Kandidat arsip riwayat tersimpan — OFF

`server/production-legacy-history-archive-codec.cjs` menyiapkan data murni;
`server/production-legacy-history-publisher.cjs` merupakan kandidat operator
server yang terpisah. Keduanya wajib menerima `enabled:true` dari kode tepercaya.
Keadaan default tidak membaca konfigurasi/dependency/input. Tidak ada route,
runtime, UI utama, SDK init, credential, grant, Rules, adopsi data, atau publikasi
otomatis yang didaftarkan. Uji lokal 36/36 memakai data dan SDK sintetis.

Preparer menerima scope tetap `{projectId,databaseURL,tenantId,snapshotVersion}`,
katalog worker yang telah ditinjau `{workerId:{division,reviewed:true}}`, dan
input `{products}`. Worker memakai ID asli yang sama; tidak ada tebakan dari
nama/email, alias, ID baru, atau hubungan QC/gudang. Ini proyeksi subset worker
yang ditinjau, untuk jahit/potong saat ini dan arsip langsung. Bukan salinan
struktur seluruh root atau janji mempertahankan semua jenis riwayat.

Koleksi map dinormalisasi menjadi array padat menurut urutan kunci asal yang
diurutkan; kunci map tidak menjadi ID record. Array renggang ditolak. Slot null,
daftar kosong, field tidak ada, null, nol, pecahan, tipe penanda `dibayar`, serta
ID record yang tidak ada/null/kosong dipertahankan. Metadata produk dibatasi
`id/series/namaBarang/size`. Record terpilih hanya memuat `id/tukangId/tanggal/
jumlah/lolos/rijek/kiloan/tarif/total/dibayar/quantityBasis`. Unknown field,
credential, keuangan internal, record worker lain, dan keluarga yang tidak
tercakup tidak dibaca melalui getter. Field terpilih dengan tipe yang tidak
didukung ditolak; jumlah/tarif/total disimpan terpisah tanpa hitung ulang atau
syarat kesamaan perkalian. Salinan current/direct archive tetap salinan, tidak
digabung, dijumlahkan, atau diperbaiki.

Payload logis memakai kontrak sumber layanan riwayat yang sudah ada:
`{schemaVersion:1,scope,policy:'same-stable-id-stored-history-v1',reviewed:true,
immutable:true,workers,products}`. Batas tetap: 128 worker, 2.000 produk,
256 arsip per produk, 8.192 arsip, 40.000 record sumber, dan payload 8 MiB.
Codec descriptor menolak accessor, prototype tidak sesuai, field terlarang,
tipe JSON tidak didukung, kedalaman/jumlah node berlebihan, dan coercion objek.
Renderer mengurutkan kunci object secara rekursif dan mempertahankan urutan
array; tidak memanggil `toJSON` milik input atau prototype. Decoder wajib
menemukan string JSON yang sama persis dengan rendering canonical hasil parse,
sehingga duplicate key, escaped alias, whitespace tambahan dan field sisipan
tidak diterima.

Envelope RTDB adalah `{schemaVersion:1,scope,codec:'stored-history-archive-json-v1',
payload:<STRING>,digest:<SHA-256 hex>}`. Null/kosong berada di dalam string,
sehingga pemangkasan null/empty oleh RTDB tidak mengubah maknanya. Digest
mencakup UTF-8 `canonicalJSON({domain:'soldier-legacy-stored-history-archive-sha256-v1',
schemaVersion:1,scope,codec,payload})`. Reader/publisher membutuhkan proof
terpisah dari closure server: `{schemaVersion:1,scope,codec,digest,reviewed:true,
immutable:true}`. Hash blob sendiri tidak menjadi otoritas; hash hasil hitung,
hash blob, dan hash proof tetap wajib cocok. Marker reviewed/immutable dalam
candidate menyatakan kontrak data yang ditinjau, bukan bukti bahwa penyimpanan
sudah diterbitkan atau tidak bisa diubah oleh pihak berwenang.

Publisher hanya menerima `{archive}` dengan proof yang sudah dipasang di
constructor. Referensi SDK tetap adalah
`legacyStoredHistoryArchives/{tenantId}/{snapshotVersion}`. Transaksi hanya
mengisi nilai null. Semua nilai yang sudah ada membatalkan write, termasuk
replay identik; exact readback terpisah dapat membuktikan replay. Nilai lain
menghasilkan conflict tanpa overwrite. ACK hilang dapat dipulihkan hanya jika
readback pada referensi tetap menemukan exact candidate. Readback null/gagal
setelah dispatch menghasilkan `result_unknown` dan `retrySameSnapshot:true`,
tidak mengklaim write gagal atau dibatalkan. `resolve({archive})` melakukan
readback terpisah tanpa write.

App project/database, environment, reference URL, dan identitas metode SDK
dipasang tetap dan diperiksa sebelum/sesudah boundary SDK. Result transaksi
dipilih dari own data descriptor; metadata `DataSnapshot.ref` adalah getter
SDK tepercaya. Metode `val`/URL dipasang tetap dan dicek sebelum/sesudah panggil.
Perubahan binding yang terlihat setelah dispatch tetap tercatat meskipun
kemudian dipulihkan: operasi itu tidak boleh menghasilkan success atau
melanjutkan read recovery. Pemanggilan resolve baru harus membuktikan binding
kembali secara mandiri. Error hanya kategori tetap, tidak menampilkan pesan SDK,
payload, field error, credential atau nominal.

Hasil preparer selalu `preparedOnly:true,published:false`. Success publisher
hanya bukti ACK/read node exact pada saat pengamatan. Keduanya tetap memiliki
`immutableStoreProven:false,authorizationGranted:false,legacyAdopted:false,
readyForProduction:false`. Konflik record ber-ID sama dipertahankan sebagai
fakta tersimpan; [reader](legacy-stored-history-review.md) yang tidak diubah
menolak view worker ambigu dengan `conflicting_record`. Batas record/copy/view
reader juga dapat menolak arsip yang secara codec valid. Persiapan/publikasi
tidak mengklaim semua view siap dibaca.

Mode produksi menolak Auth/Database emulator. Hook test-only yang tidak
terdaftar di runtime membutuhkan `testOnlyEmulator:true`, project persis
`demo-soldier-security`, scope database demo HTTPS, host DB persis
`127.0.0.1:9000`, URL referensi loopback exact, dan fixture credential plain
own `{getAccessToken:function}`. Auth emulator dan tujuh environment credential
nyata dilarang; identitas app/fungsi fixture dipasang tetap. Salinan objek
credential dari getter SDK `FirebaseApp.options` boleh berubah identitas;
shape own exact dan fungsi `getAccessToken` wajib tetap sama. Uji pemangkasan yang ada di
suite ini berupa model murni; bukti emulator SDK genuine dicatat terpisah,
bukan diasumsikan dari model tersebut.

Sebelum cutover diperlukan tinjauan sumber/coverage privately, proof independen,
arsip exact yang diterbitkan melalui jalur operator sah, katalog canonical dan
grant nyata, integrasi [loader](legacy-history-loader-review.md) serta
[layanan](legacy-history-service-review.md), pembatasan Rules/IAM/log platform,
dan uji Auth/storage/UI nyata. Root database legacy yang masih terbuka tidak
diamankan oleh codec/publisher ini saja. Tidak ada data bisnis atau credential
nyata dipakai dalam source/test publik ini.
