# To-Do List Bertahap — Migrasi ke SQL Server Self-Hosted

Prinsip: tiap fase harus bisa di-test dan dibuktikan jalan sebelum lanjut ke fase berikutnya. Jangan lompat fase.

## Fase 0 — Persiapan (sebelum nulis kode apa pun)

- [ ] Cek chip MacBook (Apple Silicon vs Intel) — jalankan `uname -m` di terminal. Hasil `arm64` = Apple Silicon, `x86_64` = Intel. Ini menentukan strategi SQL Server lokal.
- [ ] Tentukan siapa yang akan pegang akses VPS/domain/database secara resmi (jangan akun pribadi — pelajaran dari kasus Pak Irvan).
- [ ] Siapkan VPS Linux baru (atau pakai yang sudah ada kalau resource cukup) — spek awal 2 vCPU/4GB RAM cukup untuk development+testing.
- [ ] Install Docker di VPS tersebut.
- [ ] Putuskan nama domain/subdomain yang akan dipakai (misal `inventory.rpg.co.id`), pastikan siapa yang pegang akses DNS-nya.

## Fase 1 — SQL Server jalan, bisa diakses, kosong dulu

- [ ] Jalankan SQL Server 2025 via Docker di VPS (atau lokal kalau chip Mac cocok):
  ```
  docker run -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=<password_kuat>" \
    -p 1433:1433 --name sql2025 -d mcr.microsoft.com/mssql/server:2025-latest
  ```
  Catatan: port 1433 di-bind ke `127.0.0.1:1433` saja (bukan `0.0.0.0`) kalau ini sudah di VPS production — supaya tidak ter-expose ke publik.
- [ ] Test koneksi dari tool client (Azure Data Studio / DBeaver / `sqlcmd`) — pastikan bisa connect sebelum lanjut.
- [ ] Buat database kosong khusus app ini (misal `InventoryGudang`).
- [ ] Buat SQL login baru khusus aplikasi (`app_inventory_user`), JANGAN pakai akun `sa` untuk koneksi aplikasi sehari-hari.

**Checkpoint:** bisa connect ke database dari client SQL biasa, pakai akun non-sa. Kalau belum bisa, jangan lanjut ke Fase 2.

## Fase 2 — Skema tabel + data dummy, tanpa API dulu

- [ ] Buat DDL tabel: `MasterItems`, `Users` (kolom password sudah didesain untuk hash, bukan plaintext), `TransaksiMasuk`, `TransaksiKeluar`, `DoOpen`, `RequestDoOpen`, `ContainerStatus`, `KatalogFoto`.
- [ ] Buat VIEW `SisaStock` dan `RekonsiliasiStock` (replikasi logic dari `supabase_schema.sql`, tapi di T-SQL).
- [ ] Insert beberapa baris data dummy manual lewat SQL client, coba query VIEW-nya — pastikan angka yang keluar masuk akal.

**Checkpoint:** VIEW menghasilkan angka yang benar dari data dummy. Kalau logic agregasinya salah di titik ini, perbaiki dulu sebelum ada API di atasnya.

## Fase 3 — API dasar (auth + 1 resource dulu, bukan semua sekaligus)

- [x] Setup project Express + `mssql` package (bisa reuse `server.ts` yang sudah ada di project ini sebagai starting point).
- [x] Implementasi **hanya** endpoint auth (`/api/auth/login`) + hashing password (bcrypt) dulu.
- [x] Implementasi **hanya** endpoint Master Item (GET, POST) dulu — resource paling sederhana, tanpa relasi rumit.
- [x] Test lewat curl — login jalan (Admin & OPR dummy), dapat token, create + list master item pakai token, role check & penyembunyian hargaBeli untuk OPR terverifikasi.

**Checkpoint:** satu alur penuh (login → dapat token → create data → list data) jalan end-to-end. Ini pola yang akan diulang untuk resource lainnya.

## Fase 4 — Sisa endpoint CRUD, satu-satu

- [x] Transaksi Masuk & Keluar (ikuti pola dari Fase 3) — CRUD + bulk teruji curl; kolom Category/EntryRemark/From/ToLocation ditambah via sql/005.
- [x] DO Open + reconcile logic — CRUD, bulk-upsert (match DocumentNo+ItemCode → fallback DocumentNo), reconcile set-based, cleanup-duplicates, filter RmAreaScope untuk OPR; semua teruji curl.
- [x] Request DO Open + approval flow — OPR create/bulk & hanya lihat miliknya (RequestedByNik), Admin/Team Gudang approve/reject (PATCH by UUID atau DocumentNo), audit trail ApprovedByNik terisi dari token; teruji curl.
- [x] Container Status — CRUD + batch upsert per NoContainer (MERGE), normalisasi status free-text → 3 status baku; teruji curl.
- [x] Katalog Foto — base64 → file di UPLOAD_DIR (path di DB, bukan blob), serve via express.static di dev (Nginx nanti di Fase 6), whitelist mime + limit 10MB, DELETE ikut hapus file; teruji curl. Setup folder di VPS menyusul saat deploy Fase 6.
- [x] Endpoint reports/dashboard-summary — 5 endpoint reports semua dari VIEW T-SQL (SisaStock diperluas via sql/006 supaya setara view lama), dashboard-summary satu round-trip 4 result set, harga beli/gross profit disembunyikan dari OPR; teruji curl.

**Checkpoint per item:** setiap resource di-test sendiri-sendiri sebelum pindah ke resource berikutnya. Jangan tulis semua endpoint dulu baru ditest belakangan.

## Fase 5 — Sambungkan ke frontend yang sudah ada

- [x] Dibuat `src/api.ts` baru (bukan mengubah `supabase.ts`): nama fungsi & bentuk return identik dengan versi lama, plus shim kompatibilitas untuk `supabase`/`firebase` supaya komponen UI tidak perlu diubah.
- [x] Update import di semua file consumer (12 file di `views/` + `components/`, `App.tsx`). Firebase Auth & Firestore dicabut; `DataMigrationModal` (khusus migrasi Firebase→Supabase) dilepas dari App.
- [x] Test satu-satu tiap halaman lewat browser: Login/Logout, Dashboard, Master Item (termasuk create → tersimpan ke DB), Transaksi Masuk, Transaksi Keluar, DO OPEN, Request DO OPEN, Sisa Stock, Rekonsiliasi (+ tombol Rekonsiliasi Otomatis → POST /api/do-open/reconcile 200), Katalog Foto, Status Container, CIF & BAP, Otorisasi User (kolom password ter-mask, API memang tidak mengirimnya).
- [x] `/api/chat-gudang` — context yang dikirim ke Gemini otomatis bersumber dari data SQL Server (AIChatBot membangun context dari state App yang kini di-load dari REST API); tidak ada perubahan server yang diperlukan.
- [x] **Perbaikan tambahan saat Fase 5:** `ContainerStatusView` & `CifBapContainerView` ternyata di-import tapi tidak pernah dirender dan tidak punya menu sidebar (cacat bawaan sebelum migrasi) — sekarang disambungkan. Role `Admin` ditambahkan ke `UserRole` dan diperlakukan setara `Audit` untuk menu Otorisasi User. Label "Firebase Live"/"Firebase Realtime Engine" diganti "SQL Server" supaya tidak menyesatkan.

**Checkpoint:** app jalan penuh di local/VPS dev pakai SQL Server, tanpa Supabase sama sekali, semua fitur utama (bukan cuma sebagian) sudah dicoba manual.

## Fase 6 — Deploy ke VPS supaya bisa diakses user

**Panduan lengkap + command siap-copy: [FASE-6-DEPLOY.md](FASE-6-DEPLOY.md).**
Dikerjakan manual oleh user (bukan Claude Code) karena SSH ke VPS production tidak
tersedia untuk agent di sesi ini (public key belum terdaftar di `authorized_keys` VPS) —
dan hardening SSH/firewall termasuk aksi berisiko-lockout yang sebaiknya dijalankan
langsung oleh pemilik akses, bukan otomatis.

- [x] **Hardening VPS:** SSH key-only, firewalld aktif (`http/https/ssh/cockpit`).
- [x] `npm run build`, copy `dist/` + `.env` production ke VPS. `DB_USER` diganti ke `app_inventory_user` (least-privilege, dibuat via `sql/007_create_app_login.sql` — sebelumnya cuma `sa` yang ada).
- [x] PM2 — `rpg-inventory` online, auto-start via systemd (`pm2 startup` + `pm2 save`).
- [x] Nginx reverse proxy + static `dist/` + `/uploads/*`. **Dua gotcha SELinux (AlmaLinux/RHEL) ditemukan & diperbaiki:** (1) `httpd_can_network_connect` off → 502 di semua proxy_pass, diaktifkan via `setsebool -P`; (2) folder `dist`/`uploads` berlabel `var_t` → 403, di-relabel ke `httpd_sys_content_t`/`httpd_sys_rw_content_t` via `semanage fcontext` + `restorecon`. Default server block bawaan `nginx.conf` (bentrok `server_name _`) dinonaktifkan.
- [x] **Temuan keamanan tambahan (di luar checklist asli):** AI router (`9router`, dipakai fitur chatbot — lihat catatan Fase 5 di bawah) awalnya publish `0.0.0.0:20128` dari Docker, TIDAK tertutup firewalld sama sekali (Docker menyisipkan rule iptables sendiri yang melewati firewalld). Container dibuat ulang dengan bind `127.0.0.1:20128` mengikuti pola `sql2025`.
- [x] Firewall final — cuma `http/https/ssh` publik; **1433, 3000, DAN 20128** terverifikasi tertutup dari luar (test `nc`/`curl` dari Mac, semua connection refused/timeout).
- [x] **SSL terpasang.** Domain `inventorynyarpg.my.id` sudah aktif dan resolve ke IP VPS. `server_name` di `rpg-inventory.conf` diupdate dari `_` ke domain, `nginx -t` lolos, reload sukses, lalu `certbot --nginx -d inventorynyarpg.my.id --redirect` — cert Let's Encrypt terpasang (expire 2026-11-12, auto-renewal terjadwal certbot), HTTP otomatis redirect 301 ke HTTPS. Terverifikasi dari luar: `https://inventorynyarpg.my.id/` 200 dengan app termuat, `/api/health` jalan, port 3000 & 1433 tetap tertutup dari publik (firewall tidak berubah, exposure sudah dikunci sejak sebelumnya).
- [x] Test dari luar (dari Mac, bukan jaringan VPS): situs `http://103.59.94.43/` 200 OK, `/api/health` & `/api/auth/login` lewat Nginx sukses; port 1433/3000/20128 semua connection refused dari luar.

**Perubahan di luar rencana awal (relevan untuk Fase 7):**
- Fitur AI chatbot (`/api/chat-gudang`) dipindah dari Google Gemini SDK ke router self-hosted OpenAI-compatible milik user (`9router`, model `cc/claude-haiku-4-5-20251001` → `ag/gemini-3.6-flash-medium`). Dependency `@google/genai` dicopot. Lihat `.env.example` untuk `AI_ROUTER_*`.
- [x] **Password `sa` sudah dirotasi** (`ALTER LOGIN`) — password baru cuma ada di `.env` dev lokal (di-gitignore), tidak pernah disimpan di file yang ter-commit. Production tidak terdampak (sudah pakai `app_inventory_user` sejak awal). Placeholder `DB_PASSWORD`/`JWT_SECRET` di `.env.example` diperkuat jadi teks yang jelas tidak boleh dipakai apa adanya (`__WAJIB_GANTI_JANGAN_DIPAKAI_LANGSUNG__`), supaya kejadian password asli = teks placeholder tidak terulang. **Ingat: update juga password tersimpan di Navicat kalau ada koneksi `sa` yang disimpan.**

**Checkpoint:** app bisa diakses dari device manapun via domain, bukan cuma `localhost` VPS.

## Fase 7 — Migrasi data asli + cutover

- [x] **Export data dari Supabase (masih aktif) ke SQL Server** — 23.415 baris: MasterItem 13.345, DoOpen 6.499, TransaksiKeluar 2.160, TransaksiMasuk 1.411. Tabel `request_do_open`/`container_status`/`katalog_foto`/CIF-BAP dicek kosong (0 baris), tidak perlu dimigrasi. Data dummy Fase 2 dibersihkan dulu sebelum import. Script: `scripts/migrate-supabase-data.ts` (bisa dijalankan ulang untuk re-sync sebelum cutover final — pakai `--dry-run` dulu untuk preview). **Bug ditemukan & diperbaiki:** `mssql` `Table.bulk()` (protokol TDS bcp) error di semua tipe tanggal terhadap SQL Server 2025 — diganti strategi batch `INSERT` parameterized biasa.
- [x] **User pilot dibuat** (4 orang, bukan dummy) — password asli dari sistem lama dipertahankan (by user request, demi kemudahan masa pilot) tapi di-hash bcrypt sebelum disimpan, tidak pernah plaintext di DB. Login terverifikasi lewat production untuk semua 4 akun. Tabel `users` Supabase lama TIDAK bisa/tidak diakses via anon key (diproteksi dengan benar, beda dari tabel lain) — sejalan dengan keputusan untuk tidak memindah password lama apa adanya.
- [ ] User pilot coba app baru berdampingan dengan yang lama beberapa hari — **menunggu user pilot benar-benar mencoba**, bukan tugas teknis.
- [ ] Setelah yakin stabil, matikan/arsipkan app lama (Supabase/Firebase), pastikan tidak ada biaya recurring yang masih jalan sia-sia.

## Fase 8 — Migrasi dari VPS IDCloudHost ke VPS Kantor

**Panduan lengkap + command siap-copy: [FASE-8-MIGRASI-VPS-KANTOR.md](FASE-8-MIGRASI-VPS-KANTOR.md).**
Dipicu keputusan pindah dari VPS `103.59.94.43` (akun `ai-openclaw`, billing belum terkonfirmasi resmi
perusahaan — lihat catatan Fase 0) ke VPS kantor baru yang sudah tersedia (AlmaLinux, IP publik langsung).
Domain `inventorynyarpg.my.id` tetap dipakai, tinggal diarahkan. Downtime yang ditoleransi: maintenance
window singkat (bukan zero-downtime).

- [ ] **Temuan kritis sebelum mulai:** container `sql2025` di VPS lama ternyata **tidak punya persistent
      Docker volume** — seluruh data hidup di writable layer container, resiko hilang total kalau container
      ke-`docker rm`. Migrasi ini WAJIB sekalian jadi kesempatan perbaiki (pakai named volume di VPS baru),
      dan data dipindah lewat native `BACKUP`/`RESTORE` .bak, bukan copy volume (karena tidak ada volume
      untuk di-copy).
- [ ] Informasi & akses yang wajib dikumpulkan dulu (IP VPS baru, akses SSH, login panel DNS IDCloudHost,
      `AI_ROUTER_API_KEY`, kepastian billing resmi) — lihat tabel Bagian 1 di dokumen detail.
- [ ] H-7: Hardening VPS baru (SSH key-only, firewall, fail2ban) + turunkan TTL DNS ke 300 detik.
- [ ] H-3: Setup SQL Server (Docker + volume persistent kali ini), AI Router (`9router`), app (PM2), Nginx
      (gzip + cache headers + security headers, replikasi persis dari VPS lama) — semua dites via IP VPS
      baru langsung, VPS lama tidak terganggu sama sekali di tahap ini.
- [ ] H-1: Dry-run backup/restore data asli dari VPS lama ke VPS baru, verifikasi angka cocok persis.
- [ ] Hari-H: Cutover di maintenance window singkat — stop app VPS lama, backup final, restore ke VPS baru,
      pindah DNS, pasang SSL (certbot, sekalian pastikan auto-renewal timer beneran aktif — ditemukan tidak
      aktif di VPS lama), verifikasi dari luar jaringan.
- [ ] Pasca-migrasi: VPS lama dibiarkan menyala sebagai rollback selama minimal 2 minggu sebelum
      dipertimbangkan cancel billing-nya.

**Rekomendasi tambahan di luar migrasi murni** (lihat Bagian "Advice" di dokumen detail): setup backup
database terjadwal otomatis (belum ada sama sekali sekarang), klarifikasi lisensi SQL Server Developer
Edition untuk pemakaian produksi, dan dokumentasikan kepemilikan akses VPS/DNS/billing secara resmi.

**Checkpoint:** app bisa diakses penuh dari domain yang sama, di infrastruktur baru, tanpa kehilangan data
maupun downtime lebih dari target maintenance window.

## Yang sengaja BELUM masuk fase manapun (didiskusikan terpisah nanti)

- ETL otomatis dari SQL Server 2008 ERP kantor.
- Realtime update (kalau nanti ternyata dibutuhkan).
- Perluasan akses ke SPV/RM/OPR skala penuh (~500 karyawan) — mulai dari user pilot dulu.
