# Fase 8 — Migrasi dari VPS IDCloudHost (`ai-openclaw`) ke VPS Kantor

Dokumen ini dibuat **16 Agustus 2026** dengan mengambil kondisi *live* VPS production sekarang
(`103.59.94.43`, akun `inventoryrpg`) sebagai sumber kebenaran — bukan cuma dari `FASE-6-DEPLOY.md`
(yang sudah agak basi, ditulis sebelum gzip/security headers/cache-control ditambah belakangan).

Ikuti dokumen ini **berurutan**, jangan lompat. Prinsip sama seperti Fase 6: tiap bagian ada
**checkpoint** — jangan lanjut sebelum checkpoint lolos.

> **Status progres (diupdate live, 16 Agustus 2026):** VPS kantor: IP `116.193.190.121`, AlmaLinux 10.2,
> user `Administrator` dengan sudo NOPASSWD.
>
> - [x] **Bagian 2** (hardening dasar): SSH key dari MacBook terpasang, password login dimatikan,
>   `firewalld`+`fail2ban` aktif (butuh `epel-release` dulu — dicatat di Bagian 2c). **Temuan tambahan**:
>   Docker gagal start karena kernel modul `xt_addrtype` tidak ada di kernel yang sedang jalan (VPS ini pakai
>   KVM, modul ada di paket `kernel-modules-extra` tapi untuk versi kernel lain yang belum jadi kernel aktif)
>   — sudah diperbaiki: install `kernel-modules-extra-$(uname -r)` + daftarkan `xt_addrtype` di
>   `/etc/modules-load.d/` supaya otomatis ter-load lagi setelah reboot.
> - [x] **Bagian 4** (SQL Server): container `sql2025` jalan dengan **persistent volume** (`sql2025-data`),
>   database `InventoryGudang` + semua tabel/view (DDL 001, 003-006) + `app_inventory_user` sudah dibuat.
>   Semua checkpoint 4a-4d lolos.
> - [ ] **Bagian 5** (AI Router `9router`) — **DITUNDA**. VPS lama (`103.59.94.43`) mendadak **unreachable
>   total** (SSH timeout, HTTPS timeout, ping 100% loss) sejak ±06:45 UTC — kemungkinan situs production
>   ikut down untuk user. Tidak bisa ambil `AI_ROUTER_API_KEY` dari sana. **Perlu tindakan pemilik VPS**
>   (cek panel IDCloudHost). Lanjut skip dulu ke bagian lain yang tidak bergantung pada VPS lama.
> - [x] **Bagian 6** (deploy app): Node v22.23.2 terpasang, `npm ci` sukses, `.env` production terpasang
>   (dengan `AI_ROUTER_API_KEY` **placeholder** — belum final, lihat Bagian 5), PM2 online & auto-start
>   systemd terpasang. Checkpoint 6 & 6b lolos.
> - [x] **Bagian 7** (Nginx): terpasang, **temuan sama seperti VPS lama** (default server block bentrok
>   `server_name _`, sudah dinonaktifkan) **+ temuan baru**: file config yang di-copy lewat `/tmp` dapat
>   SELinux context `user_tmp_t` (bukan `httpd_config_t`) sehingga Nginx gagal baca — diperbaiki dengan
>   `restorecon`. SELinux `httpd_can_network_connect` on, fcontext `dist`/`uploads` benar, firewall
>   http/https terbuka. Checkpoint 7a & 7b lolos — app sudah bisa diakses via `http://116.193.190.121/`.
>   Port 1433/3000 terverifikasi tertutup dari luar.
> - [x] **Bagian 8** (testing fungsional) — diverifikasi lewat browser (login, render Dashboard, navigasi
>   antar-menu) + lewat API langsung (create/list/delete Master Item end-to-end ke database, endpoint
>   reports, role-check `/api/users` Admin-only, chatbot fallback lokal jalan tanpa AI router). Data test
>   sudah dibersihkan (`MasterItem` count kembali 0). **Catatan:** transisi antar-halaman sempat terlihat
>   "macet" di tool testing — ini FALSE ALARM yang sama seperti ditemukan sebelumnya di sesi ini
>   (`document.visibilityState: "hidden"` di tab otomatis mem-pause animasi Framer Motion), sudah
>   dikonfirmasi bukan bug nyata.
> - [x] **VPS lama kembali online** ±07:xx UTC 16 Agustus — penyebabnya **kuota bandwidth IDCloudHost
>   habis** (bukan crash), baru di-top up oleh pemilik. Dicatat sebagai temuan penting untuk monitoring
>   ke depan (lihat Bagian 13 — Monitoring & Observability, baru).
> - [x] **Bagian 5** (AI Router) selesai — volume `9router-data` (180KB, cuma config/history, bukan model
>   files) di-export dari VPS lama, di-import ke VPS baru, `AI_ROUTER_API_KEY` asli diambil dari `.env` VPS
>   lama dan dipasang. Chatbot terverifikasi membalas dengan respons AI asli (bukan fallback lokal lagi).
> - [x] **Bagian 9** (dry-run backup/restore) selesai — backup 4.2MB dari VPS lama, restore ke VPS baru,
>   **semua angka cocok persis**: MasterItem 13345, TransaksiMasuk 1411, TransaksiKeluar 5886, DoOpen 6123,
>   Users 6. 🔴 **Ditemukan bug nyata** saat proses ini: setelah `RESTORE WITH REPLACE`, `app_inventory_user`
>   jadi *orphaned* (login gagal walau password benar) karena SID mismatch — root cause & fix
>   (`ALTER USER app_inventory_user WITH LOGIN = app_inventory_user;`) sudah didokumentasikan di Bagian 9b
>   & 10c, **wajib dijalankan tiap habis restore**, termasuk nanti pas cutover final.
> - [x] **Bagian 3** — TTL DNS diturunkan ke 300 detik oleh user, terkonfirmasi via `dig` pukul **10:11 UTC,
>   16 Agustus 2026** (TTL sisa 19 detik saat dicek — bukti sudah pakai TTL baru, bukan cache lama).
>   **Aman untuk cutover (Bagian 10) mulai pukul 14:11 UTC / 21:11 WIB, 16 Agustus 2026** (4 jam dari titik ini).
> - [x] **Bagian 10 — CUTOVER SELESAI**, 16 Agustus 2026:
>   - **14:59 UTC / 21:59 WIB**: `pm2 stop` di VPS lama (mulai downtime)
>   - Backup final (3202 pages, <1 detik) → restore ke VPS baru + fix orphaned user (sekaligus, sudah tahu
>     dari dry-run) → data terverifikasi identik: MasterItem 13345, TransaksiMasuk 1411, TransaksiKeluar 5886,
>     DoOpen 6123, Users 6, KatalogFoto 0 (folder uploads VPS lama masih kosong, tidak ada file dipindah)
>   - User mengubah DNS A record ke `116.193.190.121`, propagasi terverifikasi lewat 3 resolver (lokal,
>     8.8.8.8, 1.1.1.1) — langsung propagasi penuh (TTL 300 dari Bagian 3 terbukti manjur)
>   - `server_name` Nginx diupdate, SSL dipasang via certbot (`certbot --nginx -d inventorynyarpg.my.id
>     --redirect`), expire 14 Nov 2026, **`certbot-renew.timer` dipastikan `active (waiting)`** (bukan cuma
>     `enabled` seperti temuan di VPS lama — dicek eksplisit kali ini)
>   - **15:07 UTC / 22:07 WIB**: `https://inventorynyarpg.my.id` terverifikasi 200 OK, SSL valid, security
>     headers lengkap, 0 console error di browser. **Downtime total: ±8 menit.**
>   - Port 1433/3000/20128 terverifikasi tertutup dari publik di VPS baru
>   - VPS lama: PM2 dibiarkan **stopped** (bukan restart) sesuai rencana rollback — lalu sekalian di-reboot
>     untuk aktifkan kernel security patch yang tertunda dari Bagian 14 (window downtime sudah terjadi,
>     tidak menambah downtime tambahan). Diverifikasi setelah reboot: kernel `211.47.1` aktif, Docker +
>     `sql2025`/`9router` auto-start normal, **PM2 `rpg-inventory` tetap stopped (tidak auto-start)** ✅.
>
>   **Status akhir: `inventorynyarpg.my.id` sekarang 100% dilayani VPS kantor baru
>   (`116.193.190.121`). VPS lama (`103.59.94.43`) menyala sebagai rollback (Bagian 11), app-nya
>   sengaja tidak dijalankan.**

Keputusan yang sudah dikonfirmasi ke pemilik project (16 Agustus 2026):
- VPS kantor baru: **AlmaLinux**, sudah tersedia & siap pakai, **punya IP publik langsung** (bukan di belakang NAT kantor).
- Domain `inventorynyarpg.my.id` **tetap dipakai**, tinggal diarahkan (DNS A record) ke IP VPS baru.
- Downtime: **maintenance window singkat boleh** (tidak perlu zero-downtime) — ini yang menyederhanakan strategi cutover di bawah.
- VPS lama (`103.59.94.43`) **tidak langsung dimatikan** — dibiarkan jalan beberapa minggu sebagai fallback/rollback sebelum di-cancel billing-nya.

---

## 0. Ringkasan Eksekutif & Temuan Penting

Sebelum menulis dokumen ini, saya cek langsung kondisi VPS lama (`docker inspect`, config Nginx aktif,
firewall, SELinux, ukuran database, dll) supaya rencana ini akurat, bukan tebakan dari dokumentasi lama.
Beberapa temuan ini **mengubah cara migrasi harus dilakukan** — dibaca dulu sebelum eksekusi:

### 🔴 Temuan Kritis 1 — Container SQL Server TIDAK punya persistent volume
`docker inspect sql2025` menunjukkan `"Mounts": []` — artinya seluruh data database (23 ribu+ baris,
data bisnis riil) **hidup di dalam writable layer container**, bukan di Docker volume atau bind mount
terpisah. Kalau container ini pernah `docker rm` (sengaja atau tidak sengaja, misal saat `docker system prune`
atau update image), **semua data akan hilang** — tidak ada volume untuk diselamatkan.

**Dampak untuk migrasi:** kita TIDAK BISA cukup "copy folder volume" untuk pindahkan data (karena tidak ada
volume). Harus pakai **native SQL Server backup (`BACKUP DATABASE` → file `.bak`) lalu restore** di VPS baru —
lebih aman lagi karena ini juga menghindari resiko copy file database yang sedang dipakai (`.mdf`/`.ldf`) secara langsung.

**Dampak di luar migrasi (perlu diperbaiki, bukan cuma dipindah apa adanya):** di VPS BARU nanti, container
SQL Server **WAJIB** dibuat dengan Docker named volume dari awal (lihat Bagian 4) — supaya masalah yang sama
tidak terulang di rumah baru.

### 🟡 Temuan 2 — SQL Server pakai *Developer Edition*
```
Microsoft SQL Server 2025 (RTM-CU7) ... Enterprise Developer Edition (64-bit) on Linux
```
Developer Edition **gratis tapi lisensinya cuma untuk development/testing, bukan untuk beban kerja produksi
komersial** per EULA Microsoft. Ini bukan blocker teknis untuk migrasi (kita akan pakai edisi yang sama di VPS
baru supaya konsisten), tapi ini **catatan compliance** yang perlu diketahui pemilik bisnis — kalau app ini
resmi dipakai operasional harian perusahaan, sebaiknya didiskusikan ke pihak yang berwenang soal lisensi
(opsi: SQL Server Express — gratis, limitnya 10GB/database, masih jauh dari ukuran data sekarang yang cuma
~200MB; atau beli lisensi Standard/Web kalau butuh dukungan resmi Microsoft).

### 🟡 Temuan 3 — Auto-renewal SSL (certbot) tidak aktif jalan
`systemctl status certbot-renew.timer` di VPS lama menunjukkan `enabled` tapi `Active: inactive (dead)`,
`Trigger: n/a` — timer-nya terdaftar untuk nyala pas boot, tapi sepertinya belum pernah benar-benar
di-start sejak container/VPS terakhir reboot. Cert saat ini masih valid sampai 12 Nov 2026, jadi belum darurat,
tapi **kalau tidak diperbaiki, SSL akan expired diam-diam ~90 hari dari terakhir di-issue tanpa notifikasi**.
Perbaikan (`systemctl enable --now certbot-renew.timer`) akan dimasukkan ke setup VPS baru (Bagian 8), dan
sebaiknya juga dijalankan di VPS lama selama masih aktif.

### 🟡 Temuan 4 — Tidak ada backup terjadwal sama sekali
Tidak ditemukan crontab (`crontab -l` kosong untuk root maupun `inventoryrpg`) yang menjalankan backup
database rutin. Kalau ada masalah data (corrupt, salah hapus, dll) di antara sekarang dan migrasi, **tidak
ada titik pemulihan** selain restore manual dari ingatan/re-migrasi Supabase. Saya sarankan sekalian setup
backup harian otomatis di VPS baru sebagai bagian dari migrasi ini (lihat Bagian 12 — Rekomendasi Tambahan).

### Info baik (tidak perlu dikhawatirkan)
- Database cuma **~208MB total** (72MB data + 136MB log) — transfer akan sangat cepat, bukan operasi besar.
- Folder `/var/www/uploads` **kosong (0 byte)** — belum ada foto katalog ter-upload, jadi tidak ada file besar yang perlu dipindah.
- Container AI Router (`9router`) **sudah punya** Docker named volume (`9router-data`) — ini bisa dipindah lebih simpel (copy volume langsung).
- Firewall, SELinux context, dan Nginx config VPS lama semuanya sudah didokumentasikan persis di bawah (diambil live, bukan dari ingatan).

### Strategi migrasi (garis besar)
1. **Setup penuh VPS baru dulu** (SQL Server + app + Nginx) **tanpa mengganggu VPS lama sama sekali** — VPS lama tetap melayani user seperti biasa selama tahap ini. Testing dilakukan lewat IP VPS baru langsung (belum lewat domain/SSL).
2. Setelah VPS baru terbukti jalan sempurna (functional testing lengkap), baru masuk **maintenance window singkat**: stop tulis di VPS lama → backup final → restore ke VPS baru → pindah DNS → pasang SSL → verifikasi dari luar.
3. VPS lama dibiarkan menyala (tidak dihapus) sebagai jaring pengaman selama beberapa minggu.

Estimasi downtime saat cutover: **15–30 menit** (didominasi waktu tunggu propagasi DNS + issue SSL, bukan proses backup/restore-nya sendiri yang cuma hitungan detik karena database kecil).

---

## 1. Informasi & Akses yang WAJIB Disiapkan Dulu

Isi tabel ini dulu (atau siapkan di tempat aman) sebelum mulai Bagian 2. Kalau ada yang belum ada,
**berhenti dan siapkan dulu** — jangan lanjut dengan asumsi/tebakan.

| # | Info yang dibutuhkan | Sumber / cara dapatnya | Status |
|---|---|---|---|
| 1 | IP publik VPS kantor baru | Dari IT kantor / provider VPS | ✅ `116.193.190.121` |
| 2 | Username SSH VPS baru (root atau user dengan sudo) | Dari IT kantor | ✅ `Administrator`, sudo NOPASSWD |
| 3 | Metode akses SSH awal (password sementara, atau key yang sudah didaftarkan) | Dari IT kantor | ✅ Password awal sudah dipakai sekali untuk pasang SSH key, lalu password login **dimatikan** (Bagian 2b). Pertimbangkan ganti password akun `Administrator` juga (`passwd`) karena sempat tertulis plaintext di chat — walau sudah tidak relevan untuk akses SSH, baik untuk kebersihan kredensial. |
| 4 | Login panel DNS domain `inventorynyarpg.my.id` (terdaftar di **IDCloudHost**, nameserver `rinjani.cloudhost.id` / `bromo.cloudhost.id`) | Akun IDCloudHost yang sama dipakai untuk VPS lama — pastikan siapa yang pegang akses | ⬜ |
| 5 | `AI_ROUTER_API_KEY` yang dipakai sekarang (untuk fitur chatbot) | Ambil dari `.env` VPS lama, atau generate baru di panel `9router` kalau mau fresh | ⬜ |
| 6 | Kepastian billing/kepemilikan VPS kantor baru — ini akun resmi perusahaan? (Catatan dari `CLAUDE.md`: VPS lama sempat dipertanyakan karena billing `ai-openclaw` belum terkonfirmasi akun resmi perusahaan — jangan ulangi ambiguitas yang sama di VPS baru) | Konfirmasi ke bagian keuangan/IT kantor | ⬜ |
| 7 | Siapa yang akan pegang akses SSH/root VPS baru secara resmi ke depannya (bukan cuma dipegang 1 orang tanpa dokumentasi) | Keputusan internal tim | ✅ **Manager IT & pemilik project** (dikonfirmasi 17 Agustus 2026) |

**Checkpoint 1:** Semua baris di atas ada isinya (bukan `⬜` kosong) sebelum lanjut ke Bagian 2.

---

## 2. H-7 (jauh hari): Hardening VPS Baru

Sama persis dengan pola Fase 6 — SSH key-only dulu sebelum matikan password login, supaya tidak terkunci.
Ganti `<ip-vps-baru>` dan `<user-vps-baru>` di semua command bawah ini dengan nilai asli dari Bagian 1.

### 2a. Setup SSH key-based login

Dari **Mac kamu**:
```bash
ssh-copy-id <user-vps-baru>@<ip-vps-baru>
```

**Checkpoint 2a** — dari terminal baru, test login TANPA password:
```bash
ssh <user-vps-baru>@<ip-vps-baru> "echo SSH key login OK"
```
Kalau masih diminta password → **STOP**, jangan lanjut ke 2b.

### 2b. Matikan password login SSH

Di VPS baru:
```bash
sudo cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak-$(date +%Y%m%d)
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart sshd
```

**Checkpoint 2b** — dari terminal BARU (jangan pakai sesi sudo yang sedang terbuka):
```bash
ssh <user-vps-baru>@<ip-vps-baru> "echo masih bisa masuk"
```
Kalau gagal, rollback dari sesi lama yang masih terbuka:
```bash
sudo cp /etc/ssh/sshd_config.bak-<tanggal> /etc/ssh/sshd_config && sudo systemctl restart sshd
```

### 2c. Firewall dasar + fail2ban

⚠️ **Ditemukan saat eksekusi:** `fail2ban` **tidak ada** di repo default AlmaLinux 10 (`No match for argument:
fail2ban`) — beda dari VPS lama yang mungkin AlmaLinux versi lebih lama/repo beda. Perlu aktifkan **EPEL**
dulu:
```bash
sudo dnf install -y epel-release
```

Baru lanjut:
```bash
sudo dnf install -y firewalld fail2ban
sudo systemctl enable --now firewalld
sudo systemctl enable --now fail2ban
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --reload
```

**Checkpoint 2c**: `sudo firewall-cmd --list-all` menampilkan `services: ssh`, dan kamu masih bisa buka SSH baru.

---

## 3. H-7: Turunkan TTL DNS Domain (supaya cutover cepat nanti)

DNS record `inventorynyarpg.my.id` sekarang di-manage di panel **IDCloudHost** dan TTL-nya **14400 detik (4 jam)**.
Kalau ini tidak diturunkan dulu, saat hari-H nanti ganti IP di DNS, sebagian device/ISP di luar sana bisa
masih pegang cache DNS lama sampai 4 jam — bikin sebagian user akses ke VPS lama, sebagian ke VPS baru,
membingungkan.

**Langkah:**
1. Login ke panel DNS IDCloudHost, buka pengaturan record A untuk `inventorynyarpg.my.id`.
2. Turunkan TTL jadi **300 detik (5 menit)** — JANGAN ubah IP-nya dulu, cuma TTL-nya.
3. **Tunggu minimal 4 jam** (durasi TTL lama) sebelum hari-H, supaya semua resolver di luar sana sudah
   ambil TTL baru yang pendek.

**Checkpoint 3:**
```bash
dig A inventorynyarpg.my.id +noall +answer
```
Kolom TTL di hasilnya harus sudah `300`, bukan `14400` lagi. Kalau masih `14400`, tunggu lebih lama —
jangan lanjut ke cutover (Bagian 10) sebelum ini beres.

---

## 4. H-3: Setup SQL Server di VPS Baru (Docker, **dengan** persistent volume)

Beda dari VPS lama — kali ini pakai **named volume** dari awal (perbaikan atas Temuan Kritis 1 di Bagian 0).

```bash
sudo dnf install -y dnf-plugins-core
sudo dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker

# Bikin volume persistent dulu — INI YANG TIDAK ADA di VPS lama, jangan dilewat
sudo docker volume create sql2025-data

# Generate password SA yang kuat, simpan di tempat aman (password manager), JANGAN taruh di file yang ke-commit
openssl rand -base64 24
```

Jalankan container (ganti `<password_sa_baru>` dengan hasil `openssl rand` di atas):
```bash
sudo docker run -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=<password_sa_baru>" \
  -e "MSSQL_PID=developer" \
  -v sql2025-data:/var/opt/mssql \
  -p 127.0.0.1:1433:1433 --name sql2025 --restart unless-stopped \
  -d mcr.microsoft.com/mssql/server:2025-latest
```

Catatan penting bedanya dari command lama:
- `-v sql2025-data:/var/opt/mssql` → **volume persistent, ini perbaikannya.**
- `-p 127.0.0.1:1433:1433` (bukan `-p 1433:1433` saja) → eksplisit bind ke localhost, konsisten dengan aturan "port 1433 tidak pernah publik" di `CLAUDE.md`.
- `--restart unless-stopped` → container otomatis nyala lagi kalau VPS reboot (di VPS lama sepertinya juga begini, tapi pastikan dicek).

**Checkpoint 4a** — tunggu ~30 detik lalu test:
```bash
sudo docker exec sql2025 /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P '<password_sa_baru>' -C -Q "SELECT @@VERSION"
```
Harus keluar versi SQL Server, bukan error connection.

### 4b. Buat database + tunnel dari Mac untuk jalankan DDL

Dari **Mac kamu**, buka tunnel SSH ke VPS BARU (port lokal beda dari tunnel VPS lama supaya tidak bentrok
kalau mau jalan dua-duanya sekaligus untuk sementara — misal pakai port lokal `14330`):
```bash
ssh -f -N -L 14330:localhost:1433 <user-vps-baru>@<ip-vps-baru>
```

Update `.env` lokal di Mac (folder project) — buat file terpisah dulu, jangan timpa `.env` dev yang lagi dipakai:
```bash
cp .env .env.vps-baru
```
Edit `.env.vps-baru`: `DB_PORT=14330`, `DB_USER=sa`, `DB_PASSWORD=<password_sa_baru>`.

Buat database kosong dulu (pakai `sqlcmd` langsung di VPS, lebih simpel untuk `CREATE DATABASE`):
```bash
ssh <user-vps-baru>@<ip-vps-baru> "sudo docker exec sql2025 /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P '<password_sa_baru>' -C -Q \"CREATE DATABASE InventoryGudang\""
```

### 4c. Jalankan semua DDL secara berurutan

Dari Mac, pakai script yang sudah ada di project (`scripts/apply-sql.ts`), arahkan ke `.env.vps-baru`:
```bash
cd /Users/qq/Desktop/rpg-inventory-app
for f in sql/001_create_schema.sql sql/002_seed_dummy_data.sql sql/003_sp_auth_login.sql sql/004_alter_users_role_add_bod.sql sql/005_alter_transaksi_add_columns.sql sql/006_alter_view_sisa_stock.sql; do
  echo "=== $f ==="
  env $(cat .env.vps-baru | grep -v '^#' | xargs) npx tsx scripts/apply-sql.ts "$f"
done
```

⚠️ **JANGAN jalankan `sql/002_seed_dummy_data.sql` kalau tidak mau ada data dummy nyasar** — cek isinya dulu
sebelum run; kalau isinya cuma dummy testing, skip file ini (hapus dari daftar for-loop di atas), karena data
asli akan datang dari restore backup (Bagian 10), bukan dari seed dummy.

⚠️ **JANGAN jalankan `sql/007_create_app_login.sql` dulu di sini** — itu bagian 4d di bawah, butuh password baru
yang beda dari `sa`.

**Checkpoint 4c:**
```bash
env $(cat .env.vps-baru | grep -v '^#' | xargs) npx tsx -e "
import { getPool } from './src/db';
getPool().then(async (p) => {
  const r = await p.request().query('SELECT COUNT(*) AS c FROM sys.tables');
  console.log('Jumlah tabel:', r.recordset[0].c);
  await p.close();
});
"
```
Harus keluar jumlah tabel yang masuk akal (delapan-an tabel: MasterItem, Users, TransaksiMasuk, TransaksiKeluar,
DoOpen, RequestDoOpen, ContainerStatus, KatalogFoto).

### 4d. Buat `app_inventory_user` (jangan pakai `sa` untuk aplikasi)

Generate password baru (BEDA dari password `sa`, dan BEDA dari password `app_inventory_user` di VPS lama):
```bash
openssl rand -base64 24
```

Edit `sql/007_create_app_login.sql` **di sesi lokal sementara** (jangan commit password aslinya), ganti
`__REPLACE_WITH_STRONG_PASSWORD__` dengan password baru, lalu jalankan:
```bash
env $(cat .env.vps-baru | grep -v '^#' | xargs) npx tsx scripts/apply-sql.ts sql/007_create_app_login.sql
```
Setelah dijalankan, **kembalikan file `sql/007_create_app_login.sql` ke placeholder semula** (`git diff` harus
bersih) — supaya password asli tidak ke-commit.

**Checkpoint 4d:**
```bash
env $(cat .env.vps-baru | grep -v '^#' | xargs) DB_USER=app_inventory_user DB_PASSWORD='<password_app_baru>' npx tsx -e "
import { getPool } from './src/db';
getPool().then(async (p) => { console.log('Login app_inventory_user OK'); await p.close(); });
"
```

---

## 5. H-3: Setup AI Router (`9router`) untuk fitur Chatbot

VPS lama punya container `9router` dengan Docker named volume `9router-data` — bisa dipindah dengan
export/import volume langsung (lebih simpel dari database karena memang sudah pakai volume).

### 5a. Export volume dari VPS lama

```bash
ssh inventoryrpg@103.59.94.43 "sudo docker run --rm -v 9router-data:/data -v /tmp:/backup alpine tar czf /backup/9router-data.tar.gz -C /data ."
scp inventoryrpg@103.59.94.43:/tmp/9router-data.tar.gz /tmp/9router-data.tar.gz
ssh inventoryrpg@103.59.94.43 "rm /tmp/9router-data.tar.gz"
```

### 5b. Import ke VPS baru

```bash
scp /tmp/9router-data.tar.gz <user-vps-baru>@<ip-vps-baru>:/tmp/
ssh <user-vps-baru>@<ip-vps-baru> "
  sudo docker volume create 9router-data
  sudo docker run --rm -v 9router-data:/data -v /tmp:/backup alpine tar xzf /backup/9router-data.tar.gz -C /data
  sudo docker run -d --name 9router --restart unless-stopped \
    -e NODE_ENV=production -e PORT=20128 -e HOSTNAME=0.0.0.0 -e NEXT_TELEMETRY_DISABLED=1 -e DATA_DIR=/app/data \
    -v 9router-data:/app/data \
    -p 127.0.0.1:20128:20128 \
    decolua/9router:latest
  rm /tmp/9router-data.tar.gz
"
```

**Checkpoint 5:**
```bash
ssh <user-vps-baru>@<ip-vps-baru> "curl -s http://localhost:20128/v1/models"
```
Harus keluar response JSON berisi daftar model (`cc/claude-haiku-4-5-20251001`, `ag/gemini-3.6-flash-medium`, dll),
bukan connection refused.

Kalau ternyata `9router` di VPS lama sebenarnya cuma pakai API key eksternal (bukan model lokal beneran
tersimpan di volume-nya), export/import volume ini mungkin tidak perlu — cukup catat ulang `AI_ROUTER_API_KEY`
di `.env` baru (Bagian 6). **Sebelum lanjut, cek dulu isi volume-nya:**
```bash
ssh inventoryrpg@103.59.94.43 "sudo docker run --rm -v 9router-data:/data alpine sh -c 'du -sh /data && ls -la /data'"
```
Kalau isinya cuma config kecil (bukan model files besar), pertimbangkan cukup setup ulang `9router` fresh di
VPS baru + isi ulang API key/config manual — lebih simpel daripada export/import volume.

---

## 6. H-3: Deploy Aplikasi ke VPS Baru

Dari **Mac kamu**, di folder project:
```bash
npm run build
```

```bash
ssh <user-vps-baru>@<ip-vps-baru> "mkdir -p /var/www/rpg-inventory-app"
scp -r dist package.json package-lock.json <user-vps-baru>@<ip-vps-baru>:/var/www/rpg-inventory-app/
```

Di VPS baru:
```bash
# Pastikan versi Node sama (v22.x) — install via NodeSource kalau belum ada / beda versi
node -v || (curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - && sudo dnf install -y nodejs)

cd /var/www/rpg-inventory-app
npm ci --omit=dev
```

### Buat `.env` production di VPS baru (isi BEDA dari VPS lama, bukan hasil copy)

```bash
nano /var/www/rpg-inventory-app/.env
```

```env
DB_HOST="localhost"
DB_PORT=1433
DB_NAME="InventoryGudang"
DB_USER="app_inventory_user"
DB_PASSWORD="<password_app_baru_dari_langkah_4d>"
DB_ENCRYPT=true
DB_TRUST_SERVER_CERTIFICATE=true

# WAJIB generate baru (openssl rand -base64 48), JANGAN reuse dari VPS lama —
# ini otomatis bikin semua user harus login ulang setelah cutover, itu normal & diharapkan.
JWT_SECRET="<generate_baru>"

AI_ROUTER_BASE_URL="http://localhost:20128/v1"
AI_ROUTER_API_KEY="<isi_dari_Bagian_1_atau_generate_baru_di_9router>"
AI_ROUTER_MODELS="cc/claude-haiku-4-5-20251001,ag/gemini-3.6-flash-medium"

UPLOAD_DIR="/var/www/uploads/foto-barang"
PORT=3000
NODE_ENV=production
```

```bash
sudo mkdir -p /var/www/uploads/foto-barang
sudo chown -R <user-vps-baru>:<user-vps-baru> /var/www/uploads
chmod 600 /var/www/rpg-inventory-app/.env
```

**Checkpoint 6**: `ls -la /var/www/rpg-inventory-app/dist/server.cjs /var/www/rpg-inventory-app/.env` — keduanya ada.

### PM2

```bash
sudo npm install -g pm2
cd /var/www/rpg-inventory-app
pm2 start dist/server.cjs --name rpg-inventory --env production
pm2 save
pm2 startup systemd -u <user-vps-baru> --hp /home/<user-vps-baru>
```
Jalankan juga baris `sudo env PATH=... pm2 startup ...` yang dicetak dari command terakhir.

**Checkpoint 6b:**
```bash
pm2 status
curl -s http://localhost:3000/api/health
```
Harus `{"status":"ok",...}`. Data yang muncul masih **kosong/dummy** di titik ini (data asli baru masuk pas
cutover Bagian 10) — itu normal untuk tahap testing.

---

## 7. H-3: Setup Nginx (belum pakai SSL/domain dulu)

```bash
sudo dnf install -y nginx
sudo nano /etc/nginx/conf.d/rpg-inventory.conf
```

Isi (persis konfigurasi VPS lama yang sudah termasuk gzip + cache headers + security headers, TAPI
`server_name` masih `_` dulu — belum diarahkan ke domain sampai DNS benar-benar pindah di Bagian 10):

```nginx
server {
    listen 80;
    server_name _;

    root /var/www/rpg-inventory-app/dist;
    index index.html;

    client_max_body_size 15m;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /uploads/ {
        alias /var/www/uploads/;
        autoindex off;
    }

    location /assets/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache, must-revalidate" always;
    }

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    gzip on;
    gzip_types application/json application/javascript text/css text/plain application/xml;
    gzip_min_length 1024;
    gzip_comp_level 6;
}
```

```bash
sudo nginx -t
sudo systemctl enable --now nginx
```

### SELinux (AlmaLinux) — dua gotcha yang sudah ditemukan sebelumnya, langsung diantisipasi:

```bash
sudo setsebool -P httpd_can_network_connect on
sudo semanage fcontext -a -t httpd_sys_content_t "/var/www/rpg-inventory-app/dist(/.*)?"
sudo semanage fcontext -a -t httpd_sys_rw_content_t "/var/www/uploads(/.*)?"
sudo restorecon -Rv /var/www/rpg-inventory-app/dist /var/www/uploads
```

### Firewall — buka 80/443

```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
sudo firewall-cmd --list-services
```
Harus cuma `ssh http https` — **tidak ada** `1433`, `3000`, atau `20128`.

**Checkpoint 7a** (dari VPS sendiri dulu):
```bash
curl -s http://localhost/api/health
```

**Checkpoint 7b** (dari Mac, akses via IP publik VPS baru langsung — belum pakai domain):
```bash
curl -s http://<ip-vps-baru>/api/health
curl -s -o /dev/null -w "%{http_code}\n" http://<ip-vps-baru>/
```
Keduanya harus sukses. Kalau bisa, buka juga `http://<ip-vps-baru>/` di browser — halaman login app harus muncul
(walau datanya masih kosong).

---

## 8. H-3 sampai H-1: Testing Menyeluruh di VPS Baru (SEBELUM cutover)

Ini tahap paling penting untuk menghindari kejutan pas hari-H — app harus dites **fungsional penuh** selagi
VPS lama masih jadi yang production, jadi tidak ada tekanan waktu.

Karena data di VPS baru saat ini masih kosong/hasil DDL doang (belum data asli), buat 1 user test manual dulu:
```bash
env $(cat .env.vps-baru | grep -v '^#' | xargs) npx tsx scripts/seed-dummy-user.ts
```
(Cek isi `scripts/seed-dummy-user.ts` dulu untuk tahu kredensial apa yang dibuat.)

Checklist testing (akses via `http://<ip-vps-baru>/`, browser boleh warning "not secure" karena belum SSL — itu OK untuk tahap ini):

- [ ] Login berhasil dengan user test
- [ ] Dashboard tampil tanpa error console
- [ ] Master Item: list muncul (walau kosong/dummy), create item baru berhasil tersimpan
- [ ] Transaksi Masuk: create berhasil
- [ ] Transaksi Keluar: create berhasil
- [ ] DO Open: create + reconcile berhasil
- [ ] Request DO Open: create + approve/reject berhasil
- [ ] Sisa Stock & Rekonsiliasi Stock: tampil, filter tanggal jalan
- [ ] Upload Katalog Foto: upload 1 foto test, foto tampil, foto ke-delete
- [ ] Chatbot AI (`Tanya AI Gudang`): kirim 1 pertanyaan, dapat balasan (memverifikasi `9router` + `AI_ROUTER_API_KEY` benar)
- [ ] Otorisasi User (Admin): tampil daftar user, role-check jalan (OPR tidak lihat harga beli, dst)
- [ ] Navigasi antar-menu tidak nge-freeze (verifikasi fix `AnimatePresence mode="sync"` yang sudah di-deploy ikut terbawa di build)
- [ ] Buka Network tab browser, cek `/api/master-items` response ada header `Content-Encoding: gzip`

**Checkpoint 8:** semua checklist di atas ✅. Kalau ada yang gagal, **perbaiki dulu di VPS baru sekarang**,
JANGAN dibawa ke hari-H cutover.

Setelah semua lolos, **hapus data test** ini (supaya tidak nyampur dengan data asli hasil restore nanti):
```bash
env $(cat .env.vps-baru | grep -v '^#' | xargs) npx tsx -e "
import { getPool } from './src/db';
getPool().then(async (p) => {
  for (const t of ['DoOpen','RequestDoOpen','TransaksiMasuk','TransaksiKeluar','MasterItem','KatalogFoto']) {
    const r = await p.request().query('DELETE FROM dbo.' + t);
    console.log(t, r.rowsAffected[0], 'dihapus');
  }
  await p.close();
});
"
```
Biarkan tabel `Users` tetap ada isinya untuk sekarang (user test masih dipakai untuk cek login pasca-restore
di Bagian 10) — nanti user asli datang ikut dari backup restore yang akan menimpa/menambah.

Sebenarnya lebih aman: **drop & recreate database dari 0** sebelum restore beneran, supaya dijamin bersih
(lihat Bagian 10, `RESTORE ... WITH REPLACE` sudah menangani ini otomatis).

---

## 9. H-1: Dry-Run Backup & Restore (uji coba, BUKAN final)

Tujuan bagian ini: pastikan proses backup/restore beneran jalan mulus SEBELUM dipakai di window maintenance
yang singkat besok — supaya kalau ada masalah teknis, ketahuan sekarang (waktu masih longgar), bukan pas
lagi cutover beneran.

### 9a. Backup dari VPS lama

```bash
ssh inventoryrpg@103.59.94.43 "sudo docker exec sql2025 /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P '<password_sa_lama>' -C -Q \"BACKUP DATABASE InventoryGudang TO DISK = '/var/opt/mssql/backup/InventoryGudang.bak' WITH INIT, COMPRESSION\""
```
(Kalau folder `/var/opt/mssql/backup` belum ada di dalam container, buat dulu: `sudo docker exec sql2025 mkdir -p /var/opt/mssql/backup`)

```bash
ssh inventoryrpg@103.59.94.43 "sudo docker cp sql2025:/var/opt/mssql/backup/InventoryGudang.bak /tmp/InventoryGudang.bak && sudo chmod 644 /tmp/InventoryGudang.bak"
scp inventoryrpg@103.59.94.43:/tmp/InventoryGudang.bak /tmp/InventoryGudang.bak
```
(`chmod 644` diperlukan karena `docker cp` keluar dengan owner `root`, `scp` sebagai user biasa gagal baca kalau tidak dibuka aksesnya dulu.)

### 9b. Restore ke VPS baru (percobaan)

```bash
scp /tmp/InventoryGudang.bak <user-vps-baru>@<ip-vps-baru>:/tmp/
ssh <user-vps-baru>@<ip-vps-baru> "
  sudo docker exec sql2025 mkdir -p /var/opt/mssql/backup
  sudo docker cp /tmp/InventoryGudang.bak sql2025:/var/opt/mssql/backup/InventoryGudang.bak
  sudo docker exec sql2025 /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P '<password_sa_baru>' -C -Q \"
    RESTORE DATABASE InventoryGudang FROM DISK = '/var/opt/mssql/backup/InventoryGudang.bak' WITH REPLACE
  \"
  sudo docker exec sql2025 /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P '<password_sa_baru>' -C -d InventoryGudang -Q \"ALTER USER app_inventory_user WITH LOGIN = app_inventory_user;\"
"
```
⚠️ Baris `ALTER USER ... WITH LOGIN` di atas **wajib** — tanpa ini `app_inventory_user` jadi orphaned
(login gagal walau password benar) karena SID-nya beda dari VPS lama. Ditemukan & diverifikasi fix-nya
saat dry-run 16 Agustus 2026.

**Checkpoint 9** — bandingkan angka antara VPS lama dan VPS baru, harus PERSIS SAMA:
```bash
# Query ini dijalankan ke DUA-DUANYA (VPS lama via tunnel 1433, VPS baru via tunnel 14330), bandingkan hasilnya
env $(cat .env | grep -v '^#' | xargs) npx tsx -e "
import { getPool } from './src/db';
getPool().then(async (p) => {
  const r = await p.request().query('SELECT (SELECT COUNT(*) FROM MasterItem) mi, (SELECT COUNT(*) FROM TransaksiMasuk) tm, (SELECT COUNT(*) FROM TransaksiKeluar) tk, (SELECT COUNT(*) FROM DoOpen) do_');
  console.log(r.recordset[0]);
  await p.close();
});
"
```
Jalankan sekali dengan `.env` (VPS lama) dan sekali dengan `.env.vps-baru` (VPS baru) — angkanya harus identik
(per catatan sync terakhir: MasterItem 13345, TransaksiMasuk 1411, TransaksiKeluar 5886, DoOpen 6123).

Kalau cocok, dry-run berhasil — **file `.bak` ini tidak dipakai untuk final** (karena VPS lama masih terus
dipakai user sampai besok, datanya akan berubah lagi) — backup final akan diulang di Bagian 10 pas window
maintenance beneran.

---

## 10. HARI-H: Cutover (Maintenance Window Singkat)

Lakukan di jam paling sepi (malam hari / akhir pekan). Siapkan pesan singkat ke user pilot: *"App akan
maintenance singkat pukul X–Y, mohon tidak input data selama periode ini."*

### 10a. Stop tulis di VPS lama
```bash
ssh inventoryrpg@103.59.94.43 "pm2 stop rpg-inventory"
```
Dari titik ini, VPS lama **tidak melayani traffic sama sekali** — ini awal downtime.

### 10b. Backup final dari VPS lama
```bash
ssh inventoryrpg@103.59.94.43 "sudo docker exec sql2025 /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P '<password_sa_lama>' -C -Q \"BACKUP DATABASE InventoryGudang TO DISK = '/var/opt/mssql/backup/InventoryGudang_final.bak' WITH INIT, COMPRESSION\""
ssh inventoryrpg@103.59.94.43 "sudo docker cp sql2025:/var/opt/mssql/backup/InventoryGudang_final.bak /tmp/InventoryGudang_final.bak"
scp inventoryrpg@103.59.94.43:/tmp/InventoryGudang_final.bak /tmp/InventoryGudang_final.bak
```

### 10c. Restore ke VPS baru
```bash
scp /tmp/InventoryGudang_final.bak <user-vps-baru>@<ip-vps-baru>:/tmp/
ssh <user-vps-baru>@<ip-vps-baru> "
  sudo docker exec sql2025 mkdir -p /var/opt/mssql/backup
  sudo docker cp /tmp/InventoryGudang_final.bak sql2025:/var/opt/mssql/backup/InventoryGudang_final.bak
  sudo docker exec sql2025 /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P '<password_sa_baru>' -C -Q \"
    RESTORE DATABASE InventoryGudang FROM DISK = '/var/opt/mssql/backup/InventoryGudang_final.bak' WITH REPLACE
  \"
"
```

🔴 **Koreksi penting (ditemukan saat dry-run Bagian 9, klaim sebelumnya di sini SALAH):** Restore `WITH REPLACE`
memang tidak menghapus LOGIN `app_inventory_user` di level `master`, TAPI **user di dalam database ikut
tertimpa** oleh backup — dan SID user hasil restore (dari VPS lama) **tidak cocok** dengan SID login di
VPS baru (beda `CREATE LOGIN`/password saat dibuat di Bagian 4d). Hasilnya: `app_inventory_user` jadi
**orphaned user**, login gagal total (`Login failed for user 'app_inventory_user'`) walau password benar.

**WAJIB jalankan ini setiap kali habis `RESTORE ... WITH REPLACE`** (baik dry-run maupun final nanti):
```bash
sudo docker exec sql2025 /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P '<password_sa_baru>' -C -d InventoryGudang -Q "ALTER USER app_inventory_user WITH LOGIN = app_inventory_user;"
```
Ini me-relink user di dalam database ke login server berdasarkan nama, memperbaiki SID mismatch-nya.
Verifikasi dengan coba login pakai `app_inventory_user` setelah ini — harus berhasil.

Kalau restore gagal karena ada koneksi aktif ke database, tambahkan dulu:
```sql
ALTER DATABASE InventoryGudang SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
```
sebelum `RESTORE`, lalu:
```sql
ALTER DATABASE InventoryGudang SET MULTI_USER;
```
sesudahnya.

### 10d. Copy folder uploads (kalau sudah ada isinya di titik ini)
```bash
rsync -avz inventoryrpg@103.59.94.43:/var/www/uploads/ <user-vps-baru>@<ip-vps-baru>:/var/www/uploads/
```

### 10e. Start app di VPS baru, smoke test cepat via IP
```bash
ssh <user-vps-baru>@<ip-vps-baru> "pm2 restart rpg-inventory"
curl -s http://<ip-vps-baru>/api/health
```
Login manual sekali lewat browser ke `http://<ip-vps-baru>/`, pastikan data **asli** (bukan test dummy) muncul —
cek angka Dashboard cocok dengan yang terakhir dilihat di VPS lama sebelum di-stop.

### 10f. Ganti DNS A record
Login ke panel DNS IDCloudHost → ubah A record `inventorynyarpg.my.id` dari `103.59.94.43` ke `<ip-vps-baru>`.

### 10g. Tunggu & verifikasi propagasi
```bash
watch -n 10 "dig A inventorynyarpg.my.id +short"
```
Tunggu sampai hasilnya `<ip-vps-baru>` (harusnya cepat karena TTL sudah 300 detik dari Bagian 3). Verifikasi
juga dari device lain / jaringan lain (HP data seluler, atau tool online seperti `whatsmydns.net` kalau perlu
cek dari berbagai lokasi).

### 10h. Update Nginx `server_name` + pasang SSL

Setelah domain terbukti resolve ke VPS baru:
```bash
ssh <user-vps-baru>@<ip-vps-baru> "sudo sed -i 's/server_name _;/server_name inventorynyarpg.my.id;/' /etc/nginx/conf.d/rpg-inventory.conf && sudo nginx -t && sudo systemctl reload nginx"
ssh <user-vps-baru>@<ip-vps-baru> "sudo dnf install -y certbot python3-certbot-nginx && sudo certbot --nginx -d inventorynyarpg.my.id --redirect"
ssh <user-vps-baru>@<ip-vps-baru> "sudo systemctl enable --now certbot-renew.timer"
```
Baris terakhir ini memperbaiki Temuan 3 (Bagian 0) — pastikan timer beneran aktif kali ini:
```bash
ssh <user-vps-baru>@<ip-vps-baru> "systemctl status certbot-renew.timer"
```
Harus `Active: active (waiting)`, bukan `inactive (dead)`.

### 10i. Full test dari luar (HP pakai data seluler, BUKAN wifi yang satu jaringan dengan VPS)
```bash
curl -sI https://inventorynyarpg.my.id/api/health
nc -zv -w3 <ip-vps-baru> 3000     # harus refused/timeout
nc -zv -w3 <ip-vps-baru> 1433     # harus refused/timeout
nc -zv -w3 <ip-vps-baru> 20128    # harus refused/timeout
nc -zv -w3 <ip-vps-baru> 80       # harus succeeded
nc -zv -w3 <ip-vps-baru> 443      # harus succeeded
```
Buka `https://inventorynyarpg.my.id/` di HP, login dengan akun asli, cek beberapa menu — **ini akhir dari
downtime**, catat waktunya untuk dokumentasi.

### 10j. VPS lama — jangan hidupkan lagi PM2-nya untuk sekarang
Biarkan `pm2 stop rpg-inventory` di VPS lama tetap dalam kondisi stop (bukan `delete`) — supaya tidak ada dua
"sumber kebenaran" yang membingungkan kalau ada yang tidak sengaja akses IP lama langsung. VPS + database-nya
sendiri **tetap menyala** sebagai rollback plan (lihat Bagian 11).

**Checkpoint 10 — Cutover selesai kalau semua ini ✅:**
- [ ] `https://inventorynyarpg.my.id/` diakses dari luar, 200 OK, SSL valid (gembok hijau, tidak warning)
- [ ] Login dengan akun asli berhasil, data cocok dengan kondisi terakhir sebelum maintenance
- [ ] Port 1433/3000/20128 terbukti tertutup dari luar
- [ ] `pm2 status` di VPS baru: `rpg-inventory` online, tidak crash-loop
- [ ] `systemctl status certbot-renew.timer` di VPS baru: aktif

---

## 11. Rollback Plan (kalau ada masalah parah pas/setelah cutover)

Karena VPS lama sengaja dibiarkan menyala (bukan langsung dimatikan), rollback relatif simpel:

1. Login panel DNS IDCloudHost, kembalikan A record `inventorynyarpg.my.id` ke `103.59.94.43`.
2. Di VPS lama: `ssh inventoryrpg@103.59.94.43 "pm2 restart rpg-inventory"`.
3. Tunggu propagasi DNS (cepat, TTL sudah 300 detik).
4. ⚠️ **Data yang sempat masuk ke VPS BARU** selama periode setelah cutover (kalau user sempat pakai VPS baru
   beberapa saat sebelum ketahuan ada masalah) **akan hilang/tidak ke-carry balik** ke VPS lama secara otomatis —
   perlu direkonsiliasi manual (export data baru dari VPS baru, cross-check dengan VPS lama) sebelum lanjut pakai
   VPS lama lagi. Ini kenapa penting rollback diputuskan **secepat mungkin** kalau memang ada masalah, jangan
   ditunda-tunda supaya window data yang perlu direkonsiliasi tetap kecil.

**Kapan harus rollback (kriteria):** app tidak bisa diakses sama sekali dari luar >10 menit setelah DNS
propagasi selesai, ATAU ditemukan data korup/hilang pasca-restore, ATAU error fatal yang tidak bisa
diperbaiki cepat di tempat.

---

## 12. Pasca-Migrasi

- [ ] Pantau `pm2 logs rpg-inventory` di VPS baru selama beberapa jam pertama setelah cutover — cek ada error tak terduga atau tidak.
- [ ] Informasikan ke seluruh user pilot bahwa migrasi selesai, minta mereka login ulang (wajar karena `JWT_SECRET` baru).
- [ ] Setelah **minimal 2 minggu** VPS baru terbukti stabil tanpa masalah, baru pertimbangkan:
  - [ ] Cancel billing VPS lama (`103.59.94.43`, akun `ai-openclaw`) — konfirmasi dulu ke pihak yang pegang billing.
  - [ ] Sebelum benar-benar cancel, ambil 1 backup terakhir dari VPS lama untuk arsip (jaga-jaga), simpan di luar kedua VPS (misal Google Drive/S3 kantor).
- [ ] Update `CLAUDE.md` dan dokumentasi lain di repo ini — ganti semua referensi `103.59.94.43`/`inventoryrpg` ke detail VPS baru, supaya dokumentasi tidak basi untuk sesi kerja berikutnya.

---

## 13. Monitoring & Observability (ditambahkan 16 Agustus 2026, di luar rencana migrasi awal)

Dipicu insiden 16 Agustus 2026: VPS lama sempat down total (~20-30 menit) karena **kuota bandwidth
IDCloudHost habis**, bukan crash server. Ini baru ketahuan setelah ditanya user, tidak ada alert otomatis
sebelumnya. Bagian ini menutup celah itu — dan celah monitoring lain (security, performa) yang juga belum
ada.

### 13a. Bandwidth/Egress — sudah terpasang

`vnstat` sudah diinstall & aktif di **kedua VPS** (lama & baru), mulai mengumpulkan data dari 16 Agustus 2026.
Cara cek:
```bash
vnstat                # ringkasan harian/bulanan
vnstat -m              # breakdown per bulan
vnstat -h              # breakdown per jam (berguna untuk lihat pola lonjakan traffic)
vnstat --oneline       # satu baris ringkas, gampang di-parse script
```
⚠️ **Data baru mulai terkumpul sejak hari ini** — belum ada histori sebelumnya, jadi belum bisa dipakai untuk
lihat kapan tepatnya kuota lama habis. Untuk itu, **cek dashboard billing/kuota resmi di panel IDCloudHost**
(vnstat cuma lihat dari sisi VPS, sedangkan limit kuota dihitung oleh IDCloudHost di sisi mereka — dua angka
ini bisa saja tidak 100% sama tapi harusnya berkorelasi dekat). Sebaiknya cek berkala (mingguan) berapa sisa
kuota di panel supaya tidak kejadian sama lagi.

### 13b. Uptime Monitoring — ✅ SUDAH TERPASANG (17 Agustus 2026)

UptimeRobot terhubung, cek `https://inventorynyarpg.my.id/api/health` tiap 5 menit (paket gratis). Alert
otomatis kalau situs down — tidak perlu lagi menunggu laporan user seperti insiden kuota bandwidth 16 Agustus.

### 13c. Resource & Security Monitoring — sudah terpasang / cara cek

| Yang dipantau | Cara cek | Status |
|---|---|---|
| CPU/RAM/Disk real-time | `pm2 status` (lihat baris "host metrics" di bawah tabel), atau `htop`/`free -h`/`df -h` langsung | Tersedia, cek manual |
| Log aplikasi (error dsb) | `pm2 logs rpg-inventory` | Auto-rotate terpasang (`pm2-logrotate`: max 20MB/file, simpan 14 hari, terkompresi) — **baru dipasang di VPS baru**, sebaiknya juga dipasang di VPS lama kalau belum |
| Percobaan brute-force SSH | `sudo fail2ban-client status sshd` — daftar IP yang sudah di-ban | Aktif otomatis (fail2ban) sejak Bagian 2c |
| Log akses/error Nginx | `sudo tail -f /var/log/nginx/access.log` / `error.log` | Tersedia, cek manual |
| SSL expiry | `sudo certbot certificates` | Auto-renewal via `certbot-renew.timer` (pastikan `active`, bukan `inactive` — lihat Bagian 0 temuan 3) |
| Database — cek langsung | Lihat Bagian 13d di bawah (kredensial koneksi) | Tersedia |

### 13d. Akses Monitoring Database Langsung

Untuk pantau data langsung (misal pakai Navicat/DBeaver/Azure Data Studio, sama seperti yang sudah kamu
pakai untuk VPS lama), koneksi ke SQL Server **tidak bisa langsung** dari internet (port 1433 sengaja
tertutup untuk publik — ini keputusan keamanan yang disengaja, lihat `CLAUDE.md`). Caranya lewat **SSH
tunnel**, dua opsi:

**Opsi A — pakai fitur SSH Tunnel bawaan Navicat/DBeaver** (paling praktis, sekali setting):
- SSH Host: `116.193.190.121`, SSH Port: `22`, SSH User: `Administrator`, autentikasi: pakai SSH key yang
  sudah terpasang di MacBook kamu (`~/.ssh/id_ed25519`) — bukan password (sudah dimatikan).
- Database Host (dari sisi tunnel): `localhost`, Port: `1433`
- Database User & Password: **lihat pesan terpisah** (saya kirim terpisah dari chat ini demi keamanan, bukan
  ditulis di dokumen yang nanti ke-commit ke git).

**Opsi B — buka tunnel manual dulu via terminal**, baru connect seperti biasa ke `localhost:<port_lokal>`:
```bash
ssh -f -N -L 14330:localhost:1433 Administrator@116.193.190.121
```
Lalu di Navicat: Host `localhost`, Port `14330`.

Untuk monitoring read-only (sekadar lihat data, tidak perlu bisa ubah), lebih aman pakai `app_inventory_user`
daripada `sa` — permission-nya cuma baca+tulis data (bukan admin penuh), jadi kalau ada salah klik tidak bisa
merusak struktur tabel.

### 13e. Rekomendasi lanjutan (belum dikerjakan, perlu keputusan kamu)

- **Dashboard custom di dalam app ini sendiri** (misal halaman "System Health" khusus Admin, menampilkan
  status API/DB/uptime/bandwidth dalam satu tampilan) — bisa dibuat, tapi ini scope pekerjaan baru di luar
  migrasi VPS ini. Beri tahu saya kalau mau dilanjutkan, saya bisa desain & bangun terpisah.
- **Alerting otomatis ke WhatsApp/Telegram** kalau ada error rate tinggi atau resource menipis — juga bisa
  dibangun (misal cron script + webhook), scope terpisah dari migrasi ini.

---

## Checklist Ringkas (rangkuman semua bagian)

- [x] 0: Sudah baca & paham semua temuan kritis (terutama soal volume SQL Server)
- [x] 1: Semua info & akses di tabel Bagian 1 sudah lengkap
- [x] 2: VPS baru di-hardening (SSH key-only, firewall, fail2ban) — selesai 16 Agustus 2026
- [x] 3: TTL DNS diturunkan ke 300 detik (10:11 UTC 16 Agu) — cutover aman mulai 14:11 UTC / 21:11 WIB
- [x] 4: SQL Server jalan di VPS baru **dengan persistent volume**, `app_inventory_user` dibuat
- [x] 5: `9router` (AI chatbot) jalan di VPS baru, API key asli terpasang, respons AI terverifikasi
- [x] 6: App ter-deploy (PM2 online), `.env` pakai secret BARU (bukan reuse VPS lama)
- [x] 7: Nginx jalan (belum SSL), SELinux context benar, firewall cuma ssh/http/https
- [x] 8: **Testing fungsional lengkap** via IP VPS baru, semua ✅
- [x] 9: Dry-run backup/restore berhasil, angka cocok persis dengan VPS lama (bug orphaned-user ditemukan & difix)
- [x] 10: **CUTOVER SELESAI** 16 Agustus 2026, 21:59-22:07 WIB (~8 menit downtime) — domain live di VPS baru, SSL aktif
- [x] 11: Rollback plan dipahami — VPS lama sengaja dibiarkan menyala, app di-stop (bukan dihapus)
- [ ] 12: Monitoring pasca-migrasi berjalan (lihat Bagian 13-14) — cancel billing VPS lama menyusul setelah masa aman ≥2 minggu
- [x] 13 (baru): Monitoring dasar terpasang di kedua VPS (`vnstat` bandwidth, `pm2-logrotate`) — lihat Bagian 13
- [x] 14 (baru): Audit keamanan menyeluruh + hardening tambahan — lihat Bagian 14

---

## 14. Audit Keamanan Menyeluruh (16 Agustus 2026, di luar rencana migrasi awal)

Dipicu permintaan eksplisit pemilik project ("data di dalamnya confidential banget") setelah VPS baru mulai
online. Mencakup: infrastruktur (kedua VPS) + kode aplikasi (`server.ts`, semua `src/*Routes.ts`).

### 14a. Infrastruktur — ditemukan & diperbaiki

| Temuan | VPS | Fix |
|---|---|---|
| Service `cockpit` (panel admin web) terbuka di firewall padahal tidak dipakai (socket inactive, belum ada eksposur nyata tapi memperbesar attack surface kalau tidak sengaja ke-start nanti) | Baru | `firewall-cmd --remove-service=cockpit` |
| Kernel security patch sudah ter-download tapi belum aktif (masih jalan di kernel lama) | Baru & Lama | Baru: `dnf update --security` + **reboot** (aman, belum ada traffic produksi) → kernel `211.47.1` aktif, `xt_addrtype` & semua service terverifikasi auto-start benar setelahnya. Lama: `dnf update --security` diterapkan (termasuk OpenSSH), **TIDAK di-reboot** (masih live production) — kernel baru baru aktif setelah reboot yang dijadwalkan bareng cutover nanti malam. |
| OpenSSH ikut ter-patch tapi proses `sshd` yang jalan masih versi lama sampai di-restart | Baru & Lama | `systemctl restart sshd` di kedua VPS, checkpoint login ulang lolos di keduanya |
| SELinux mode | Baru | Dicek: `Enforcing` ✅ (bukan permissive/disabled) |
| Firewall final | Baru | Cuma `dhcpv6-client http https ssh` — 1433/3000/20128 terverifikasi tertutup |

### 14b. Kode Aplikasi — audit menyeluruh (`server.ts` + semua `src/*Routes.ts`)

🔴 **CRITICAL — diperbaiki**: `GET /api/reports/dashboard-by-year-group` (endpoint yang saya bangun sendiri
di sesi migrasi data sebelumnya) **tidak melakukan role-check sama sekali** — field `totalCost` (harga
beli/modal) ikut terkirim ke role OPR, padahal ini melanggar aturan tegas di `CLAUDE.md`. **Untungnya belum
pernah dipakai frontend** (migrasi Dashboard ke endpoint ini sempat dibatalkan saat debugging sesi
sebelumnya, jadi belum ada resiko nyata lewat UI) — tapi tetap harus diperbaiki karena bisa diakses langsung
lewat API oleh OPR yang paham teknis. **Fix**: `src/reportRoutes.ts` — tambah `isOPR(req)` check, `totalCost`
cuma dikirim kalau bukan OPR (pola sama seperti endpoint `by-category` di file yang sama).

🟠 **HIGH — diperbaiki**: `POST /api/chat-gudang` (fitur chatbot AI) **tidak ada middleware auth sama
sekali** — endpoint ini bisa dipanggil siapa saja tanpa login, dan lebih parah lagi, keputusan "apakah user
ini OPR atau bukan" (untuk sembunyikan harga beli dari jawaban AI) diambil dari `req.body.userRole` yang
**dikirim client** — bisa dispoof begitu saja (`{"userRole":"Admin"}`) untuk memaksa AI membocorkan
harga beli meski user aslinya OPR. **Fix**: `server.ts` + `src/components/AIChatBot.tsx` — endpoint sekarang
wajib `authRequired`, role diambil dari JWT terverifikasi (`req.user.role`), bukan dari body. Sudah dites:
percobaan spoof `userRole: Admin` di body tetap dianggap OPR oleh server (lihat log verifikasi di atas).

🟡 **MEDIUM — diperbaiki**: Upload Katalog Foto cuma cek MIME type yang **diklaim** client di data-URL
(`data:image/png;base64,...`), bukan isi file sebenarnya — file HTML/script berbahaya bisa disamarkan
sebagai gambar dan tersimpan/ter-serve dari `/uploads/foto-barang/`. **Fix**: `src/catalogPhotoRoutes.ts` —
tambah pengecekan magic bytes (signature biner asli JPEG/PNG/GIF/WEBP), tolak kalau isi file tidak cocok
dengan tipe yang diklaim. Dites: PNG asli berhasil, file HTML menyamar PNG ditolak dengan benar.

⚪ **LOW / informational — TIDAK diubah, sudah sesuai desain**: `DB_TRUST_SERVER_CERTIFICATE=true` (skip
validasi sertifikat TLS koneksi ke SQL Server) — aman karena koneksi API↔DB di production selalu lewat
`127.0.0.1` (tidak pernah keluar mesin), jadi tidak ada jalur network untuk disadap. Tidak ada `cors()`
middleware — ini justru benar (default browser memblokir cross-origin request tanpa header CORS eksplisit,
dan auth pakai Bearer token bukan cookie jadi tidak ada celah CSRF).

**Yang sudah dicek dan TERBUKTI AMAN (tidak perlu perubahan)**: seluruh SQL query pakai parameterized
binding (tidak ada SQL injection), JWT diverifikasi signature-nya di setiap endpoint terproteksi, approval
`RequestDoOpen` sudah dibatasi role yang benar, `/api/users` Admin-only, halaman CIF/Container dibatasi
Admin/Audit sesuai `CLAUDE.md`, pesan error ke client tidak membocorkan detail internal (stack trace/skema DB).

Semua fix di atas sudah **dibangun ulang, dites (termasuk percobaan bypass), dan di-deploy ke KEDUA VPS**
(baru & lama — karena bug ini juga ada di production yang sedang live), diverifikasi lewat `curl` dari luar
bahwa endpoint sekarang menolak request tanpa token (`401`).

### 14c. Rekomendasi lanjutan (belum dikerjakan, prioritas lebih rendah)

- **Rate limiting** di luar `/api/auth/login` — saat ini cuma endpoint login yang dibatasi percobaannya.
  Endpoint bulk-write dan `/api/chat-gudang` (yang punya biaya nyata per panggilan ke AI router) belum
  dibatasi. Pertimbangkan `express-rate-limit` kalau mau lebih ketat.
- Reboot VPS lama untuk aktifkan kernel security patch — **dijadwalkan bareng maintenance window cutover**
  (Bagian 10) supaya cuma sekali downtime, bukan dua kali terpisah.

---

## 15. Audit Kode Lanjutan & Fitur Keamanan Baru (17 Agustus 2026)

Dipicu permintaan pemilik project untuk bersihkan fitur mati dan bangun deteksi serangan. Sebagian besar
temuan di sini **tidak terkait migrasi VPS** — bug lama yang kebetulan baru ketahuan sekarang.

### 15a. Bug ditemukan & diperbaiki (live di kedua VPS)

🔴 **CRITICAL — kehilangan data diam-diam**: `TransaksiKeluarView.tsx` — tombol "Tambah Transaksi Keluar"
manual (bukan bulk import) **tidak pernah benar-benar menyimpan ke database** sejak migrasi Firebase→SQL
Server (pemanggilan `addTransaksiKeluar` hilang saat migrasi, sisa kode Firestore mati yang tidak
ketahuan). Modal ditutup seolah sukses, padahal data hilang. **Sudah diperbaiki** — dites, tersimpan
normal sekarang. ⚠️ **Data transaksi keluar manual yang pernah diinput lewat tombol ini sebelum perbaikan
kemungkinan hilang** — tidak ada cara recovery dari sisi kode (tidak pernah sampai ke database sama sekali).

🔴 **HIGH — fitur "Daftar Akun Baru" selalu crash**: `LoginView.tsx` — pengecekan NIK duplikat pakai
Firestore yang sudah mati (`db` = `null`), jadi setiap kali ada yang coba daftar akun baru lewat form,
langsung error total sebelum sempat menyimpan. **Sudah diperbaiki** — sekarang murni pakai backend SQL
Server, error NIK-duplikat ditangani server dengan benar.

🟡 **MEDIUM — "sukses palsu" di beberapa aksi Admin**: `UserManagementView.tsx` (Approve, Hapus, Tambah User
Langsung) dan `LoginView.tsx` (Daftar) semuanya memanggil fungsi yang **tidak pernah dicek hasilnya** — kalau
backend menolak (misal NIK sudah ada), UI tetap bilang "Berhasil!". **Sudah diperbaiki** di semua titik —
sekarang gagal beneran ditampilkan sebagai gagal.

🟡 Bug duplikasi tulis database di Import Excel DO Open (lihat Bagian 14b sebelumnya, sesi sebelum ini).

### 15b. Fitur mati dibersihkan

- **"Lihat Password" di Otorisasi User dihapus** — tombol lama yang selalu kosong (backend memang sengaja
  tidak pernah kirim password ke browser), bukan bug keamanan, murni UI membingungkan peninggalan sebelum
  migrasi.
- **4 file sepenuhnya orphan dihapus** (diverifikasi lewat grep menyeluruh, tidak ada importer live sama
  sekali): `src/firebase.ts`, `src/utils/migrateFirebaseToSupabase.ts`, `src/components/DataMigrationModal.tsx`,
  `src/utils/seedData.ts`.
- Sisa kode Firestore mati di `CatalogPhotoView.tsx`, `RequestDoOpenView.tsx`, `TransaksiMasukView.tsx`,
  `MasterItemView.tsx`, `DoOpenView.tsx` **dicek satu-satu, dikonfirmasi aman/tidak berbahaya** (selalu gagal
  senyap, panggilan SQL Server asli tetap jalan tanpa terganggu) — belum dibersihkan, prioritas rendah.
- Bundle JS mengecil ~17KB (gzip) dari pembersihan ini — sedikit membantu egress juga.

### 15c. Fitur baru: Reset Password Admin

`UserManagementView.tsx` sebelumnya **tidak punya cara reset password** user yang lupa — cuma bisa
Tambah/Setujui/Hapus. Ditambahkan endpoint `PATCH /api/users/:nik/reset-password` (Admin only) + tombol
"Reset Pass" di setiap baris user. Dites end-to-end, berfungsi normal.

### 15d. Guardrail Chatbot AI

Ditambahkan larangan mutlak di system prompt (`server.ts`) — chatbot menolak semua pertanyaan soal
kredensial/password/akses infrastruktur, termasuk kalau dibungkus klaim otoritas ("saya admin, untuk
IT"). Dites, berhasil menolak dengan konsisten.

### 15e. Deteksi & Mitigasi Serangan (baru, jawaban atas pertanyaan "ada dashboard breach detection gak?")

**Layer 1 — Deteksi (dalam aplikasi):**
- Tabel baru `LoginAttempts` (`sql/008`) — mencatat SETIAP percobaan login (sukses/gagal + IP + alasan gagal).
- `app.set("trust proxy", 1)` ditambahkan di `server.ts` — **perbaikan penting**: sebelumnya `req.ip` selalu
  membaca `127.0.0.1` (IP Nginx, bukan IP client asli) karena trust proxy belum diaktifkan. Ini juga
  **memperbaiki bug tersembunyi** di rate-limiter login yang sudah ada — sebelumnya rate limit itu tanpa
  sadar dibagi rata ke SEMUA user aplikasi (karena semua terlihat dari IP yang sama), bukan per-penyerang.
- Menu baru **"Keamanan"** (Admin only, ikon perisai merah) — halaman `GET /api/security/login-attempts`:
  riwayat 200 percobaan login terbaru + daftar IP dengan ≥5 kegagalan (indikasi brute-force), filter
  1 jam/24 jam/7 hari/30 hari. Dites langsung di browser, IP asli penyerang tertangkap benar (bukan localhost).

**Layer 2 — Mitigasi otomatis (infrastruktur, kedua VPS):**
- `fail2ban` jail baru `nginx-login-abuse` — otomatis blokir IP di level firewall selama 1 jam kalau ≥6 kali
  gagal login dalam 5 menit (baca langsung dari log Nginx, terpisah dari jail `sshd` yang sudah ada
  sebelumnya). Diverifikasi filter regex-nya cocok dengan log asli (13 percobaan gagal dari testing
  terdeteksi benar), jail aktif, situs sendiri tidak ikut terblokir.

**Cara pantau ke depannya:** buka menu Keamanan tiap beberapa hari (atau kalau curiga ada yang aneh), lihat
apakah ada IP asing dengan banyak kegagalan. Kalau muncul, kemungkinan besar sudah otomatis di-ban oleh
fail2ban juga — bisa dicek `sudo fail2ban-client status nginx-login-abuse` di VPS.

**Belum dikerjakan, opsi lanjutan kalau mau lebih jauh:**
- **Cloudflare (gratis)** di depan domain — WAF otomatis, proteksi DDoS, sembunyikan IP asli VPS, plus
  dashboard analitik serangan bawaan mereka. Ini lever terbesar untuk effort paling kecil, tapi butuh ganti
  nameserver domain (keputusan yang perlu persetujuan eksplisit, tidak saya kerjakan sepihak).
- Rate limiting di endpoint lain selain login (bulk-write, chat-gudang).

---

## Advice / Rekomendasi Tambahan (di luar migrasi teknis murni)

1. **Setup backup terjadwal otomatis** di VPS baru sejak hari pertama — jangan tunggu sampai butuh. Contoh
   sederhana pakai cron (jalan tiap hari jam 2 pagi, simpan 7 hari terakhir):
   ```bash
   # crontab -e di VPS baru
   0 2 * * * docker exec sql2025 /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P '<password>' -C -Q "BACKUP DATABASE InventoryGudang TO DISK = '/var/opt/mssql/backup/daily_$(date +\%Y\%m\%d).bak' WITH INIT, COMPRESSION" && find /var/opt/mssql/backup -name "daily_*.bak" -mtime +7 -delete
   ```
   Idealnya backup ini juga di-copy keluar VPS (rsync ke server lain / cloud storage) — backup yang cuma
   disimpan di mesin yang sama tidak melindungi dari kegagalan hardware/disk VPS itu sendiri.

2. **Klarifikasi lisensi SQL Server Developer Edition** (Temuan 2, Bagian 0) ke pihak yang berwenang di
   perusahaan — bukan keputusan teknis yang bisa saya putuskan sendiri.

3. **Dokumentasikan siapa pemegang akses** VPS baru, panel DNS IDCloudHost, dan billing-nya secara resmi
   (bukan cuma di kepala satu orang) — ini persis pelajaran yang sudah dicatat di `CLAUDE.md` dari kasus VPS
   lama yang sempat ambigu soal kepemilikan akun.

4. **Pertimbangkan monitoring uptime sederhana** (misal UptimeRobot gratis, ping `/api/health` tiap 5 menit)
   supaya ada notifikasi otomatis kalau app down, tidak mengandalkan user lapor duluan.

5. Setelah migrasi stabil, **User pilot 4 orang bisa mulai diperluas bertahap** sesuai catatan `TODO-PHASED.md`
   Fase 7 — bukan bagian dari migrasi VPS ini, tapi momentum yang pas untuk dilanjutkan setelah infrastruktur baru terbukti solid.
