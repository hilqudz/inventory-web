# Setup Pertama — Baca ini sebelum buka Claude Code

## Isi folder ini

- `src/`, `server.ts`, `package.json`, dll — kode app yang sudah ada (dari Google AI Studio + Supabase). Ini dipertahankan sebagai basis UI, akan ditulis ulang data layer-nya secara bertahap.
- `CLAUDE.md` — konteks proyek, Claude Code otomatis baca ini setiap sesi.
- `docs/API-ENDPOINTS.md` — daftar endpoint API yang perlu dibangun.
- `docs/TODO-PHASED.md` — checklist bertahap, kita sudah di Fase 3.
- `sql/001_create_schema.sql` — DDL yang SUDAH dijalankan di VPS (Fase 2 selesai).
- `sql/002_seed_dummy_data.sql` — data dummy yang SUDAH divalidasi di Fase 2.
- `.env.example` — template koneksi. **Copy jadi `.env`, isi password SQL Server kamu, JANGAN commit `.env` ke git.**
- `supabase_schema.sql`, `src/supabase.ts`, `src/firebase.ts` — kode/skema LAMA, referensi struktur data saja. Akan digantikan bertahap, jangan dihapus dulu (masih dipakai UI sampai Fase 5).

## Langkah pertama

1. **Copy environment file:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env`, isi `DB_PASSWORD` dengan password SQL Server `sa` yang kamu set waktu jalankan Docker container.

2. **Install dependencies:**
   ```bash
   npm install
   ```
   (project ini pakai `bun.lock`, artinya sebelumnya dikembangkan pakai Bun — kalau kamu punya Bun terinstall, `bun install` juga bisa; kalau enggak, `npm install` tetap jalan karena `package.json` yang jadi acuan utama)

3. **Buka SSH tunnel dulu** (di terminal terpisah, biarkan tetap terbuka):
   ```bash
   ssh -L 1433:localhost:1433 inventoryrpg@103.59.94.43
   ```

4. **Buka Claude Code di folder ini.** Prompt pertama yang disarankan:
   > "Baca CLAUDE.md dan docs/TODO-PHASED.md. Kita sudah selesai Fase 1-2. Mulai Fase 3: install package `mssql` dan `bcrypt`, lalu buatkan koneksi database di file baru `src/db.ts` yang baca config dari `.env`, dan buat endpoint `POST /api/auth/login` sesuai deskripsi di docs/API-ENDPOINTS.md, dengan password di-hash pakai bcrypt."

5. Setelah endpoint login jalan (test pakai Postman/curl — bisa buat user dummy manual dulu lewat Navicat dengan password yang sudah di-hash), lanjut ke endpoint Master Item (GET, POST) sesuai urutan di TODO-PHASED.md — **satu resource dulu sampai teruji, baru lanjut resource berikutnya.** Jangan minta Claude Code bikin semua endpoint sekaligus.

## Yang perlu diingat selama proses

- Setiap kali sesi Claude Code baru, pastikan tunnel SSH masih terbuka — kalau enggak, koneksi database bakal gagal dan errornya bisa membingungkan kalau kamu enggak inget penyebabnya.
- Ikuti urutan Fase di `docs/TODO-PHASED.md` — jangan lompat ke Fase 5 (sambungkan ke frontend) sebelum Fase 3-4 (semua endpoint API) teruji satu-satu.
- Kalau Claude Code menyarankan sesuatu yang bertentangan dengan keputusan yang sudah dicatat di `CLAUDE.md` (misal nyaranin taruh foto sebagai blob, atau bikin RLS ala Supabase), rujuk balik ke `CLAUDE.md` — dokumen itu sumber kebenaran keputusan yang sudah disepakati.
