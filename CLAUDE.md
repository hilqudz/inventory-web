# CLAUDE.md — Aplikasi Inventory Gudang (Migrasi ke SQL Server Self-Hosted)

Dokumen ini adalah konteks proyek untuk Claude Code. Baca ini dulu sebelum mengerjakan task apa pun di repo ini.

## Latar Belakang

App ini awalnya di-generate lewat Google AI Studio (React + Vite + Express), pakai Supabase (PostgreSQL) sebagai backend. App-nya sudah dipakai 4 user internal (admin gudang, RM, dst) dan terbukti membantu (menghilangkan rekap manual 70 email/hari).

**Kenapa migrasi:** Supabase/Firebase project yang dipakai sekarang jalan di akun pribadi (bukan akun perusahaan), sudah kena limit free tier (7GB dari kuota 5GB Firebase, batas keras 10 September), dan ditemukan celah keamanan serius (lihat bagian Security Findings di bawah). Keputusan: bangun ulang data layer di atas SQL Server 2025 self-hosted, pertahankan UI/UX yang sudah ada semaksimal mungkin.

**Bukan migrasi database sederhana.** Frontend (`src/*.tsx`) memanggil fungsi-fungsi di `src/supabase.ts`, yang ditulis pakai syntax spesifik Supabase (PostgREST client, RPC, Realtime channel, Storage). SQL Server tidak punya API browser-facing sejenis ini — perlu dibangun REST API (Node/Express) sebagai perantara. Strategi: bangun API baru dengan fungsi & bentuk return value **identik** dengan fungsi-fungsi di `supabase.ts` yang lama, supaya komponen UI di `src/views/*` dan `src/components/*` tidak perlu diubah sama sekali — cukup ganti isi `supabase.ts` (atau file baru `api.ts`) jadi pemanggil REST API, bukan Supabase client.

## Arsitektur Target (Skenario B — full self-hosted)

```
[Browser User]
      │ HTTPS
      ▼
[Nginx @ VPS] ── serve static (dist/) + reverse proxy /api/* + serve /uploads/*
      │
      ▼
[Express API @ localhost:3000, VPS yang sama]
      │ TDS via 'mssql' npm package, localhost only — PORT 1433 TIDAK PERNAH PUBLIK
      ▼
[SQL Server 2025 (Docker container) @ VPS yang sama]
```

- Semua komponen (frontend build, API, database) di **satu VPS Linux** (atau VPS + private network kalau dipisah nanti). Tidak pakai Google Cloud Run / AI Studio Publish.
- Foto disimpan sebagai **file di disk VPS** (`/var/www/uploads/foto-barang/`), di-serve Nginx sebagai static file. Kolom database hanya menyimpan **path**, bukan binary.
- Port 1433 (SQL Server) **tidak pernah** dibuka ke internet — hanya bisa diakses dari `localhost` di VPS yang sama.
- AI Chatbot (fitur `/api/chat-gudang` yang sudah ada di `server.ts`, pakai `@google/genai`) **tetap Node.js**, tidak perlu Python. Konteks yang dikirim ke Gemini tinggal diganti sumbernya dari Supabase ke SQL Server.

## Security Requirements (WAJIB, non-negotiable)

Ditemukan di codebase Supabase lama — jangan direplikasi ke SQL Server:

1. **Password harus di-hash** (bcrypt atau argon2). Skema lama menyimpan password sebagai `TEXT` polos. Tabel `Users` baru wajib pakai hash sejak baris pertama.
2. **Row Level Security lama (`USING (true)`) itu sama dengan tanpa proteksi.** Di SQL Server tidak ada RLS client-facing seperti PostgREST — otorisasi **wajib dicek di setiap endpoint API**, bukan cuma disembunyikan di UI. Setiap endpoint harus verifikasi role dari token/session sebelum eksekusi query, terutama untuk data harga beli/modal (khusus non-OPR) dan approval DO.
3. **Login lewat stored procedure** (mirip konsep `verify_login` lama), tapi definisinya ditulis eksplisit di `sql/` folder proyek ini — jangan biarkan logic auth cuma hidup di database tanpa tercatat di kode.
4. **Jangan hardcode kredensial database di source code.** Pakai `.env` (sudah ada pattern-nya di `.env.example`), dan `.env` tidak boleh ter-commit ke git.
5. **Temuan lebih parah di tabel CIF Container (`resume_cif_kontainer`, `rincian_biaya_cif`, `rincian_biaya_selain_cif`):** RLS bukan cuma longgar, tapi **dimatikan total** (`DISABLE ROW LEVEL SECURITY`) plus `GRANT ALL` ke role `anon` (publik, tanpa login). Data biaya impor/CIF container bisa dibaca DAN diubah/dihapus siapa saja yang punya anon key. Tabel ini tidak ada di `supabase_schema.sql` — dibuat belakangan lewat fitur generate-SQL di dalam `CifBapContainerView.tsx` sendiri, di luar proses tercatat. Di versi SQL Server, tabel-tabel ini WAJIB masuk aturan otorisasi endpoint yang sama ketatnya seperti tabel finansial lainnya — jangan anggap "cuma tabel container" dan dilewatkan.
6. **Skema live sudah drift signifikan dari `supabase_schema.sql`.** Dump kolom aktual (Agustus 2026) menunjukkan `do_open` dan `request_do_open` punya kolom tambahan (`no_dosl`, `keterangan`, dan khusus `do_open` juga `total_qty`/`total_cost`/`total_price`) yang tidak ada di file schema. **Jangan pakai `supabase_schema.sql` sebagai acuan DDL SQL Server** — pakai hasil dump `information_schema.columns` yang sudah dikumpulkan (lihat riwayat percakapan/lampiran terkait) sebagai sumber kebenaran struktur data.

## Keputusan Arsitektur yang Sudah Disepakati

- **OS VPS: AlmaLinux** — VPS baru terpisah dari VPS OpenClaw lama (bukan reuse), nama `rpginventory`, IP publik **`103.59.94.43`** (catatan: sempat tercatat `103.55.37.87` saat provisioning awal, berubah setelah beberapa waktu berjalan — perlu diverifikasi ke IDCloudHost apakah IP publik VPS ini statis atau dinamis, sebelum setup DNS/domain di Fase 6. Kalau dinamis, perlu upgrade ke IP statis dulu supaya domain enggak putus tiap kali IP berubah), spek 4 vCPU/8GB RAM/80GB SSD, lokasi Jakarta (SouthJKT-a). Keputusan pisah VPS diambil setelah VPS OpenClaw ditemukan disk 100% penuh (log lama menumpuk) dan RAM terbatas (5.8GB, sudah terpakai servis lain). Sempat dicoba Ubuntu tapi hanya AlmaLinux tersedia — command hardening/install pakai `dnf`/`firewall-cmd`.
- **Billing account & kepemilikan VPS baru ini perlu dikonfirmasi** — billing account bernama `ai-openclaw`, perlu dipastikan ini akun resmi perusahaan (bukan pribadi) sebelum data production disimpan di situ. Biaya ~Rp692.000/bulan perlu masuk radar persetujuan yang sama dengan diskusi biaya Supabase.
- **File kredensial OpenVPN** (`config.ovpn`, `passkey`, `userpass`) dari VPS OpenClaw lama sudah/perlu di-backup ke luar VPS sebelum VPS lama di-cleanup — akan dibutuhkan lagi saat setup Linked Server/ETL ke SQL Server 2008 ERP kantor (fase belakangan, di luar scope awal). Kedua VPS (OpenClaw lama & `rpginventory` baru) berada di VPC/private network yang sama ("My Network") — bisa saling komunikasi lewat private IP kalau dibutuhkan nanti.
- **SQL Server dijalankan via Docker container** (`mcr.microsoft.com/mssql/server:2025-latest`), bukan install native.
- **Agregasi (SUM, GROUP BY) dipindah ke database** (VIEW atau stored procedure), bukan di-loop di frontend seperti kode lama. Ini memperbaiki masalah bandwidth/egress yang jadi penyebab Supabase/Firebase jebol kuota di versi lama.
- **Realtime subscription (`subscribeTransaksiMasuk`) di-drop untuk versi awal** — bukan kebutuhan kritikal untuk internal reporting tool. Bisa ditambah nanti pakai polling interval kalau memang dibutuhkan.
- **ETL dari SQL Server 2008 ERP kantor ke SQL Server 2025 VPS**: dibahas terpisah, di luar scope awal proyek ini — untuk fase pertama, data di-import manual dulu (mirip alur lama), otomasi ETL menyusul.
- **Development: local (MacBook, Apple Silicon) dulu**, deploy ke VPS setelah stabil. Karena SQL Server Docker image resmi tidak mendukung ARM64 (dan **Azure SQL Edge sudah di-retire Microsoft per 30 Sept 2025, plus sejak sebelum itu sudah tidak dukung ARM64** — jangan pakai), strategi dev: **jalankan SQL Server 2025 di VPS**, MacBook connect ke situ lewat **SSH tunnel** (`ssh -L 1433:localhost:1433 user@vps-ip`), BUKAN dengan membuka port 1433 ke publik. Port 1433 tetap hanya listen di `localhost` VPS; tunnel SSH yang menjembatani, konsisten dengan aturan "port 1433 tidak pernah publik" di atas.

## Coding Conventions

- Bahasa: TypeScript, konsisten dengan codebase yang ada.
- Query SQL Server: pakai **parameterized query** (via `mssql` package `.input()`), JANGAN PERNAH string-concat input user ke query — cegah SQL injection.
- Setiap endpoint yang mengubah data (POST/PUT/DELETE) wajib validasi role di middleware sebelum masuk ke handler.
- Response API wajib dalam bentuk yang bisa langsung dipakai fungsi-fungsi di `src/views/*` tanpa ubah struktur data — cek `src/types.ts` untuk bentuk tipe yang diharapkan (`MasterItem`, `TransactionRecord`, `DoOpenRecord`, `RequestDoRecord`, `AppUser`, `ContainerRecord`, `ItemCatalogPhoto`).

## Referensi

- Daftar lengkap endpoint yang perlu dibangun: lihat `API-ENDPOINTS.md`
- Urutan pengerjaan bertahap: lihat `TODO-PHASED.md`
- Skema tabel lama (referensi, JANGAN dipakai apa adanya — ada RLS yang salah dan password tanpa hash): `supabase_schema.sql` (di root repo, untuk referensi struktur data saja)
