# Pemeriksaan dependency server: persiapan, belum terpasang

Bukti dependency pada 6 Oktober 2026: [CI commit f2c7b8659f1981b4476bfd882bb1b35e81fcfc5e](https://github.com/soldierapparelid/soldierapparel-app/actions/runs/37407510388) memvalidasi lock tepat, memasang dari lock tanpa lifecycle scripts, memverifikasi 275 signature registry dan 15 attestations, mendapat audit runtime nol temuan, serta meluluskan 16 tes transport. Hasil commit terakhir harus tetap diperiksa pada [draft PR 2](https://github.com/soldierapparelid/soldierapparel-app/pull/2); bukti historis bukan izin deployment.

Paket server tetap OFF. Pemeriksaan ini tidak memasang layanan ke aplikasi utama, mengaktifkan billing, mengubah IAM atau menulis data usaha. Auth pada fixture bukan login Google nyata. Tidak ada password, token produksi, credential akun layanan atau nominal usaha di paket dan fixture publik.

## Manifest dan lock

Manifest runtime tetap memakai Node 22, `firebase-admin` 14.5.0 dan `firebase-functions` 7.3.0. Override statis tepat `{gaxios:{uuid:"11.1.1"}}` mengganti satu entry UUID 9.0.1 dalam graph ini; 274 paket lain tetap sama. Validator memeriksa setiap child UUID dari gaxios benar-benar menyelesaikan versi 11.1.1. Override global/versi/field lain ditolak. Audit lama melaporkan satu advisory UUID sebagai dua temuan moderate melalui UUID dan gaxios; audit lock baru melaporkan nol. Ini perbaikan terarah, tanpa `npm audit fix`. [Advisory UUID](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq), [override npm](https://docs.npmjs.com/cli/v10/configuring-npm/package-json/#overrides).

Validator mengikat manifest exact, struktur lock, nama paket termasuk alias registry, versi dan URL tarball registry publik. Validator menolak sumber file/git/URL luar, key duplikat termasuk escape JSON, field asing, dependency yang tidak terselesaikan dan integrity SHA-512 yang tidak canonical. Hash manifest dan lock pada paket mengikat salinan yang diperiksa; hash tidak menggantikan pemeriksaan isi atau bukti provenance penerbit.

Workflow dependency terpisah memakai npm 10.9.9, `--ignore-scripts`, engine dan peer dependency ketat. Workflow hanya menerima lock yang sudah disertakan, memvalidasinya sebelum `ci`, lalu memeriksa hash lock tetap sama, signature registry, provenance yang tersedia, import SDK dan advisory runtime termasuk optional. Lock yang hilang tidak dibuat ulang otomatis. Hanya dua file publik tepat—lock dan laporan audit—yang menjadi artifact; tidak ada secret, OIDC, billing, deployment atau writer usaha dalam workflow. Provenance tidak tersedia untuk setiap paket. Audit tidak menjalankan perbaikan otomatis. Hasil tanpa temuan hanya berlaku pada graph dan waktu pemeriksaan tersebut.

Lock v3 tepat: SHA-256 `3b96ac007f3cc4f5ae039b47c4eaf05a6a597117a4f9e42d5fda78847b4337e1`, 123.658 byte, 275 paket termasuk 118 optional dan tiga alias registry. Audit v2 tepat: SHA-256 `b3a5fdefaa44eb2857d764d71ddded044467e53063ee1ebc6d05ba7876d7b9ca`, 364 byte; seluruh severity nol. Instalasi nyata pada CI memakai Node 22.23.3, tanpa menjalankan dua paket bertanda install script (`@firebase/util`, `protobufjs`). Package warning/deprecation dan kerentanan yang belum diketahui tetap dapat ada; signature, audit dan tes ini bukan jaminan kode atau host bebas risiko.

Lock ini hanya untuk dependency runtime server. Dependency development di direktori `security/`, yang menjalankan emulator dan tes, belum dikunci oleh lock runtime ini.

## SDK dan transport

Uji import pada konfigurasi OFF memastikan adapter tidak menginisialisasi app Firebase atau meminta Application Default Credentials. Ini bukan pembuktian IAM atau koneksi database produksi.

Uji transport memakai Firebase Functions SDK 7.3.0 dan Functions Framework 5.0.5 yang dipasang, melalui server loopback sintetis. Semua 16 tes lulus, termasuk import CommonJS gaxios 6.7.1 yang menyelesaikan UUID 11.1.1, 100 pemanggilan `v4()` tanpa buffer/jaringan, raw byte/UTF-8/duplicate JSON, origin/header/route, batas body, deadline, slot bersama dan disconnect sebelum operasi selesai. Admin/Auth memakai fixture; tes ini tidak memeriksa Google Auth nyata, TLS publik, proxy platform atau konfigurasi host produksi.

Functions Framework dapat menampung dan mem-parsing body sebelum handler menerapkan batas 32 KiB. Batas aplikasi tidak menjadi bukti batas buffering platform. JSON malformed dapat ditolak oleh parser upstream sebelum respons error aplikasi yang disanitasi; sanitasi log/error host untuk jalur tersebut belum dibuktikan. Request dengan header HTTP yang tidak valid juga dapat ditolak Node dengan HTTP 400 sebelum handler berjalan, sehingga bentuknya berbeda dari penolakan JSON aplikasi. Perilaku host nyata tetap harus diperiksa sebelum pemasangan.

## Paket dan langkah pemasangan

Paket persiapan memakai allowlist 13 modul runtime dan 17 salinan dengan lock, hash serta konfigurasi OFF. Tidak ada instalasi atau deployment dalam proses penyiapan paket. Jangan men-deploy konfigurasi OFF di atas codebase fungsi aktif: perubahan export dapat menghapus fungsi yang ada.

Pemasangan masih memerlukan hasil dependency dan transport yang lolos pada commit yang sama, pemeriksaan host/IAM, login Google nyata, tenant privat yang aman serta pencocokan data lama. Persetujuan layanan berbiaya belum diberikan. Tes sintetis yang lulus tidak berarti seluruh aplikasi dan data lama sudah dipindahkan atau keamanan tanpa risiko telah dibuktikan.
