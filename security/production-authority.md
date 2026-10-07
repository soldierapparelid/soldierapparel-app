# Inti transaksi untuk upah otomatis

Status: kode server lokal yang diuji dengan data sintetis, belum menjadi layanan Firebase dan belum dipasang. Tidak ada koneksi database, credential, billing, marketplace, transfer, atau panggilan AI di modul ini.

`server/production-authority.cjs` menyediakan `createAuthority`, `applyCommand`, `project`, `validateState`, `encodeStorage` dan `decodeStorage`. Bootstrap hanya membuat siklus kosong dengan produk, mitra dan assignment yang sudah ditinjau server. Ini tidak mengimpor riwayat produksi lama atau saldo usaha. Bootstrap baru tidak boleh menggantikan PO aktif/arsip lama.

Setiap command membawa requestId, productId, cycleId, expectedRevision, kind dan payload terbatas. Jahit terikat pada assignment milik workerId dari izin administrator. QC memeriksa count yang sudah ada. Tarif, total, PIN, snapshot payroll, status dibayar dan klaim profil dari body ditolak. Server context harus berasal dari verifikasi token Google dan izin aktif, bukan browser.

Hitung fisik membekukan hasil lookup tarif historis privat yang terikat pada produk/siklus/mitra/count/tanggal. Basis pemilihan tarif harus eksplisit dan sesuai hari kerja Jakarta. Modul tidak mencari tarif terkini atau menebak identitas lewat nama. Tarif baru dalam rupiah utuh; tarif pecahan lama membutuhkan kebijakan impor yang ditinjau terpisah. QC memakai tarif beku yang sama, termasuk hasil nol. Perbaikan memakai tanggal selesai dan tarif awal. Gerakan gudang/siap jual adalah cermin, bukan sumber upah tambahan.

State authority, receipt, snapshot revisi, outbox dan proyeksi operasi/upah berada pada satu node produk transaksional. `applyCommand` menghasilkan state baru yang harus disimpan atomik dengan CAS/retry database; mengirim hasil ini lewat `set()` biasa tidak aman. Request identik menghasilkan receipt lama; revisi atau requestId yang bertentangan ditolak. Tidak membutuhkan aplikasi owner terbuka setelah adapter server terpasang.

State mentah tidak boleh disimpan langsung pada RTDB: database menghilangkan object kosong dan child null yang diperlukan riwayat. Gunakan envelope `encodeStorage(state)` dan `decodeStorage(envelope)` pada setiap transaksi. Authority privat disimpan sebagai JSON string utuh, bersama proyeksi yang sama dalam envelope dibatasi 8 MiB. Decoder memeriksa authority dan proyeksi setelah normalisasi RTDB, tanpa mengeluarkan cuplikan parser. Ukuran ini batas modul, bukan bukti batas event/runtime layanan; sizing tetap perlu ditinjau. Private authority tidak boleh bisa dibaca browser. Proyeksi operasi membawa cutQuantity asli tanpa membuat catatan potong palsu; scalar ini dipertahankan oleh codec/workflow.

Adapter layanan yang belum dibuat wajib:

- Memverifikasi ID token pada server, provider Google dan email terverifikasi. Ambil izin aktif dan workerId dari sumber administrator pada setiap request/retry; jangan menerima izin dari payload atau cache frontend. SDK Admin melewati Rules.
- Mengikat command ke node produk yang tepat serta menolak bootstrap/edit/arsip/pembayaran yang belum didukung. Tarif privat harus dipilih sesuai kebijakan usaha historis, dengan pemeriksaan revisi sumber.
- Menerapkan batas ukuran, rate limit, error umum dan pencatatan tanpa data usaha/token. Mengembalikan receipt terbatas; jangan mengembalikan state privat, snapshot, semua mitra atau tarif mitra lain.
- Menggunakan Rules yang menolak semua penulisan browser ke node authority/proyeksi, termasuk akun owner. Read hanya di child proyeksi yang diizinkan; jangan memberi read pada ancestor privat. Kandidat finance-v2 saat ini belum memenuhi skema ini.
- Mengintegrasikan seluruh pembaca/penulis PO, potong, jahit, QC, laporan, stok dan arsip ke sumber/revisi yang sama. UI upah saat ini masih membaca maklonEarnings lama; proyeksi per produk ini belum terhubung ke UI tersebut. Fanout trigger baru membutuhkan publikasi bersyarat dan versi; tidak boleh overwrite output dengan event lama.
- Menyiapkan impor/rekonsiliasi arsip, frozen payroll, kasbon, pembayaran/slip, potong dan draf legacy sebelum cutover. Perubahan assignment, edit, arsip, PO baru, maklon potong, pembayaran dan koreksi periode settled belum didukung inti ini.
- Mengukur pertumbuhan snapshot: ada batas node/record, dan snapshot/receipt dibatasi 5.000 record. Batas revisi 4.999 menyisakan satu snapshot bootstrap; batas node dapat tercapai lebih awal. Retensi/siklus arsip tidak boleh menghapus receipt/riwayat tanpa mekanisme pemulihan yang ditinjau.

Tes `node --test tests/production-authority.test.cjs` meliputi kepemilikan assignment, penolakan uang/identitas buatan, kapasitas dan hubungan, retry/revisi, rate historis, QC nol/gabungan, tanggal perbaikan, pembatalan dan preservasi snapshot. Tes pure ini belum membuktikan transaksi nyata, izin cloud, biaya, migrasi data usaha atau pemasangan produksi.
