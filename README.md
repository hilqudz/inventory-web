# Inventory Gudang — RPG Group

Aplikasi web internal untuk kelola stok, katalog foto barang, alur DO (Delivery Order), dan rekapitulasi nilai inventaris gudang. Awalnya di-generate lewat Google AI Studio (React + Supabase/Firebase), lalu dimigrasi penuh ke backend self-hosted (Node/Express + SQL Server) karena limit kuota gratis Firebase/Supabase dan temuan celah keamanan serius di setup lama (RLS longgar, password tanpa hash).

Sudah dipakai harian oleh tim gudang & operasional — menggantikan rekap manual yang sebelumnya dikerjakan lewat puluhan email per hari.

## Daftar Isi

- [Arsitektur](#arsitektur)
- [Tech Stack](#tech-stack)
- [Role & Hak Akses](#role--hak-akses)
- [Fitur per Menu](#fitur-per-menu)
- [Setup Development](#setup-development)
- [Struktur Proyek](#struktur-proyek)
- [Keamanan](#keamanan)
- [Deployment](#deployment)

## Arsitektur

```
[Browser User]
      │ HTTPS
      ▼
[Nginx] ── serve static (dist/) + reverse proxy /api/* + serve /uploads/*
      │
      ▼
[Express API @ Node.js]
      │ TDS protocol (package 'mssql'), koneksi database HANYA dari localhost
      ▼
[SQL Server 2025 (Docker container)]
```

Semua komponen (build frontend, API, database) berjalan di satu server Linux. Foto katalog barang disimpan sebagai file di disk server (diserve Nginx sebagai static file) — database cuma menyimpan path-nya, bukan binary foto.

Fitur Chat Bot AI (`/api/chat-gudang`) memanggil proxy AI self-hosted (OpenAI-compatible endpoint) yang meneruskan ke model Claude/Gemini, dipakai untuk tanya-jawab data inventaris secara percakapan.

## Tech Stack

**Frontend**
- React 19 + TypeScript
- Vite 6 (build tool)
- Tailwind CSS 4

**Backend**
- Express 4 + TypeScript, dijalankan lewat `tsx`/build ke `dist/server.cjs`
- `mssql` (driver Tedious) — parameterized query ke SQL Server, tidak pernah string-concat input user
- `jsonwebtoken` — autentikasi JWT (token berlaku 12 jam)
- `bcrypt` — hashing password
- `sharp` — kompresi gambar sebelum disimpan

**Database**
- SQL Server 2025, dijalankan via Docker container
- Agregasi berat (SUM, GROUP BY, rekap tahunan) dikerjakan lewat VIEW/query di database, bukan di-loop di browser — penting karena data sudah puluhan ribu baris (Master Item, DO Open)

**Infrastruktur**
- Linux server (AlmaLinux), Nginx sebagai reverse proxy + static file server, PM2 sebagai process manager, Let's Encrypt untuk TLS, fail2ban untuk proteksi brute-force login

## Role & Hak Akses

Aplikasi punya 5 role, masing-masing lihat menu & data yang berbeda:

| Role | Menu yang bisa diakses | Catatan |
|---|---|---|
| **Admin** | Semua menu | Satu-satunya yang bisa akses menu Keamanan (log percobaan login) dan kelola user penuh (approve/reject/hapus/reset password) |
| **Audit** | Semua menu kecuali Keamanan | Bisa approve/reject user baru, tapi tidak bisa hapus/reset password user lain. Punya hak hapus tambahan di beberapa tabel (DO Open, Katalog Foto) |
| **Team Gudang** (PIC Gudang) | DO OPEN, Request DO OPEN (approval), Report DO OPEN Kirim | Cuma lihat Nilai Jual, tidak lihat Harga Beli/modal (kebijakan internal) |
| **OPR** (Operator Lapangan) | DO OPEN (Logistik) saja — otomatis terfilter ke status "Sudah di Logistik" | Sama seperti Team Gudang, tidak lihat Harga Beli. Bisa isi Keterangan & ajukan Request DO OPEN langsung dari tabel |
| **BOD** | Dashboard, Upload Katalog Foto, Chat Bot AI | Akses paling terbatas, buat ringkasan level manajemen |

Setiap endpoint backend memvalidasi role dari token JWT sebelum mengeksekusi query — pembatasan bukan cuma disembunyikan di tampilan.

## Fitur per Menu

**Dashboard** — Ringkasan KPI (jumlah Master Item, Sisa Stock, Nilai Stock Harga Beli/Jual, DO Open, Qty Lepasan/bebas alokasi), rekapitulasi tahunan berdasarkan tanggal input barang, rekap per Group Name, breakdown lokasi barang (area QC vs Logistik), export Excel, kirim laporan lewat email.

**Daftar Master Item** — Data induk barang (kode, nama, group, harga jual, harga beli), pencarian, import/export Excel.

**Upload Katalog Foto** — Kelola foto produk per kode barang (bisa lebih dari satu foto per item), tampilan grid/tabel, lightbox, info stok (Sisa Stock/DO Open/Qty Lepasan) beserta nilai Beli & Jual langsung di kartu foto, bisa langsung ajukan Request DO OPEN dari kartu foto.

**Chat Bot Meta AI** — Asisten AI buat tanya jawab data inventaris secara percakapan (misal: "berapa sisa stok hair clip bulan ini?").

**Transaksi Masuk / Transaksi Keluar** — Log pergerakan stok masuk & keluar gudang, import Excel, filter tanggal/kategori.

**DO OPEN** — Daftar delivery order yang masih pending. Ada dashboard ringkasan (nilai beli/jual sesuai role), panel filter (dropdown bisa dicari, otomatis buka ke atas kalau ruang layar terbatas), kolom Keterangan yang bisa diedit inline (berlaku untuk semua item dengan No DO yang sama sekaligus), tombol ajukan Request (satuan/borongan via checkbox/manual), rekonsiliasi otomatis terhadap Transaksi Keluar, import/export Excel.

**Request DO OPEN** — Antrian persetujuan untuk PIC Gudang: approve/reject/revert pengajuan, dikelompokkan per No DO, tampilkan Keterangan dari pengaju, form input manual buat request yang belum ada di sistem.

**Report DO OPEN Kirim** — Riwayat request yang sudah disetujui, tampilan detail per item maupun ringkasan per No DO, export/kirim laporan email.

**Sisa Stock** — Perhitungan stok sisa (Total Masuk − Total Keluar) beserta nilai Harga Beli & Harga Jual, status stok (Aman/Perlu Restock/Habis), laporan email rekap tahunan.

**Rekonsiliasi Stock** — Cek silang otomatis antara DO Open dan Transaksi Keluar, menghapus DO yang sudah benar-benar terkirim.

**Status Container** — Pelacakan status kontainer barang masuk.

**Otorisasi User** — Approve/reject pendaftaran user baru, atur role, reset password.

**Keamanan** — Monitoring percobaan login (gagal/berhasil), deteksi IP mencurigakan.

## Setup Development

**Prasyarat:** Node.js 20+, akses ke instance SQL Server (lokal via Docker atau tunnel SSH ke server).

```bash
npm install
cp .env.example .env   # isi kredensial database & JWT secret
npm run dev
```

Environment variable yang wajib diisi ada di [.env.example](.env.example) — jangan pernah hardcode kredensial di source code atau commit file `.env` ke git.

## Struktur Proyek

```
src/
  views/          Setiap menu/halaman (satu file per menu)
  components/     Komponen reusable (Sidebar, modal, tabel, dsb)
  api.ts          Pemanggil REST API dari frontend
  types.ts        Definisi tipe data (MasterItem, DoOpenRecord, dst)
  *.Routes.ts     Endpoint backend per modul (doOpenRoutes, requestDoRoutes, dst)
  auth.ts         Middleware JWT & pembatasan role
  db.ts           Koneksi pool ke SQL Server
sql/              Migrasi & definisi skema database, urut sesuai nomor file
scripts/          Script utilitas one-off (migrasi data, seed, dsb) — dijalankan manual, bukan bagian dari runtime aplikasi
server.ts         Entry point Express, registrasi seluruh route
```

## Keamanan

- Password di-hash dengan bcrypt sejak baris pertama, tidak pernah disimpan polos.
- Otorisasi dicek di setiap endpoint backend berdasarkan role dari token JWT — bukan cuma disembunyikan di tampilan.
- Query database selalu parameterized, tidak pernah string-concat input user.
- Port database tidak pernah dibuka ke internet publik.
- Rate limiting sederhana pada endpoint login untuk mencegah brute-force, ditambah fail2ban di level server.

## Deployment

Build frontend (`npm run build`) menghasilkan `dist/` berisi static asset (disajikan Nginx) dan `dist/server.cjs` (dijalankan lewat PM2). Deploy standar: build lokal → sync `dist/` ke server → restart proses PM2.
