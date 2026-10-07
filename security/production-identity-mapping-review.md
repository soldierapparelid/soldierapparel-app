# Pemeriksaan pemetaan identitas secara offline

`production-identity-mapping-preflight.cjs` memeriksa manifest privat yang disediakan operator. Modul murni ini tidak membaca berkas, mengakses jaringan, memakai SDK, memverifikasi login nyata, menulis grant, atau memindahkan riwayat produksi/uang. Default OFF; inspector OFF tidak membaca manifest maupun getter scope/config. Jangan memuat manifest privat pada browser mitra, GitHub, CI, Hosting atau chat.

API CommonJS:

```js
const {createIdentityMappingPreflight} = require('./production-identity-mapping-preflight.cjs');
const inspector = createIdentityMappingPreflight({enabled:true,projectId,databaseURL,tenantId});
const report = inspector.inspect(manifest);
```

Scope factory adalah binding yang sudah diperiksa operator dan disalin sekali. URL harus berupa origin HTTPS RTDB persis, tanpa slash akhir, credential, query, fragment atau port. Kecocokan string URL/proyek bukan bukti kepemilikan proyek atau izin cloud.

Manifest mempunyai tepat field berikut; seluruh koleksi adalah array eksplisit, termasuk jika kosong.

| Field | Bentuk persis |
| --- | --- |
| `schemaVersion` | `1` |
| `scope` | `{projectId,databaseURL,tenantId}`, persis sama dengan factory |
| `source` | `{snapshotSha256,exportedAt,sourceSchemaVersion}`; SHA256 lowercase 64 karakter, timestamp UTC kanonik dengan milidetik, tag skema string aman yang dinyatakan operator |
| `review` | `{reviewedAt}`; timestamp UTC kanonik dengan milidetik |
| `legacyWorkers`, `canonicalWorkers` | `[{workerId,division}]`; division `jahit` atau `potong`, ID stabil eksplisit |
| `workerMappings` | `[{legacyWorkerId,canonicalWorkerId}]` |
| `authObservations` | `[{uid,projectId,provider:'google.com',emailVerified:true,observedAt}]` |
| `proposedProfiles` | `[{uid,reviewed:true,profile:{active,owner,workerId?,modules?}}]` |
| `pendingWorkers` | `[{legacyWorkerId,division:'potong'}]` |

Field profile mengikuti vocabulary admin kanonik: boolean `active`/`owner`, `workerId` aman opsional, dan map boolean modul opsional dari `potong`, `jahit`, `qc`, `laporan`, `stok`, `gaji`, `hpp`, `pembelian`, `nota`, `retur`. Map modul kosong harus dihilangkan. Mitra aktif Jahit/Potong memerlukan binding worker yang sesuai divisi. UID, worker sumber, worker target serta mapping harus unik; satu worker tidak boleh diikat ke beberapa UID pada pemeriksaan minimal ini. Seluruh observasi harus memiliki profile eksplisit yang ditinjau, dan seluruh profile harus memiliki observasi. Owner aktif yang ditinjau dan memiliki observasi pada proyek yang tepat wajib ada.

Semua worker sumber harus mempunyai mapping eksplisit atau status pending Potong. Target kanonik harus berasal dari mapping dan mempunyai binding profile. Pending Potong hanya memakai ID sumber stabil yang memang ada; belum mempunyai mapping kanonik atau profile. Pemeriksa tidak membuat UID/ID dari nama, email, urutan array, tanggal atau signature. Jika sumber belum memiliki ID stabil, hasil harus diblokir sampai pemetaan privat ditinjau. Tidak ada nama, label, email, token, password, tarif, nominal atau blob root dalam kontrak ini.

`exportedAt` dan seluruh `observedAt` tidak boleh melampaui `reviewedAt`. Timestamp dan metadata Auth adalah pernyataan operator, bukan bukti login, token segar, pencabutan akses, hash backup yang benar, atau persetujuan server. Tidak ada kebijakan umur/freshness yang ditebak tanpa clock tepercaya. Operator perlu memperoleh dan memeriksa bukti asli secara privat pada tahap terpisah.

Output hanya status, counts dan kode masalah umum. `reviewed_mapping` berarti metadata pemetaan konsisten; `pending` berarti Potong masih menunggu identitas; `blocked` menahan data malformed, ambigu atau belum lengkap; `disabled` berarti OFF. Semua hasil selalu memiliki `readyForProduction:false`, `liveAuthProven:false` dan `authorizationGranted:false`. Tidak ada kandidat grant, ID, hash, timestamp, kontak, cuplikan input atau pesan exception dalam output. Tidak ada CLI atau ekspor kandidat ke disk.

Batas input 64 KiB JSON UTF-8, 8.192 node, depth 12 dan 512 baris per koleksi. Ukuran dihitung persis melalui descriptor dan serialisasi nilai/key primitif, tanpa serialisasi objek input yang dapat menjalankan hook `toJSON`. Getter, prototype asing, field tersembunyi/symbol, array sparse, siklus objek, alias objek bersama dan field tidak dikenal ditolak. API menerima tree objek reguler; string JSON ditolak. Jika caller membaca JSON dari berkas privat, parser caller harus menolak duplicate key sebelum membuat objek; API ini tidak dapat memulihkan key yang telah dibuang `JSON.parse`.

Tes memakai fixture sintetis dan memeriksa input beku tetap utuh, scope salah, pemetaan/UID ambigu, observasi/profile kosong, pending Potong, batas kapasitas, accessor/prototype dan output tanpa data privat. Kelulusan ini belum menyelesaikan bootstrap tenant/owner, adopsi riwayat, potong, assignment/PO/arsip, pembayaran, kasbon, pemulihan draf, Rules, backup/pemulihan atau pemasangan layanan.
