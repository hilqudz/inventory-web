# Daftar Endpoint API — Pengganti supabase.ts

Dipetakan langsung dari fungsi-fungsi di `src/supabase.ts` (versi Supabase lama). Setiap baris di bawah = satu fungsi lama yang perlu direplikasi jadi endpoint REST + query SQL Server.

Semua endpoint kecuali `/api/auth/login` wajib dilewatkan middleware auth (cek token/session) dan middleware role-check sesuai kolom "Role Check".

## Auth

| Method | Endpoint | Pengganti fungsi lama | Role Check |
|---|---|---|---|
| POST | `/api/auth/login` | `verifyLoginSupabase` | Publik (tapi rate-limited, cegah brute force) |
| GET | `/api/auth/me` | — (baru) | Semua role login |

## Master Item

| Method | Endpoint | Pengganti fungsi lama | Role Check |
|---|---|---|---|
| GET | `/api/master-items` | `fetchMasterItems` | Semua role; sembunyikan `harga_beli` untuk OPR & Team Gudang di response (permintaan Pak Irvan 2026-08-18 — Audit tetap lihat harga_beli) |
| POST | `/api/master-items` | `addMasterItem` | Admin/Audit/Team Gudang |
| PUT | `/api/master-items/:kode` | `updateMasterItem` | Admin/Audit/Team Gudang |
| PUT | `/api/master-items/:kode/upsert` | `upsertMasterItem` | Admin/Audit/Team Gudang |
| DELETE | `/api/master-items/:kode` | `deleteMasterItem` | Admin only |
| POST | `/api/master-items/bulk` | `bulkAddMasterItems` | Admin/Audit/Team Gudang |

## Transaksi Masuk

| Method | Endpoint | Pengganti fungsi lama | Role Check |
|---|---|---|---|
| GET | `/api/transaksi-masuk` | `fetchTransaksiMasuk` | Semua role |
| POST | `/api/transaksi-masuk` | `addTransaksiMasuk` | Admin/Audit/Team Gudang |
| PUT | `/api/transaksi-masuk/:id` | `updateTransaksiMasuk` | Admin/Audit/Team Gudang |
| DELETE | `/api/transaksi-masuk/:id` | `deleteTransaksiMasuk` | Admin only |
| POST | `/api/transaksi-masuk/bulk` | `bulkAddTransaksiMasuk` | Admin/Audit/Team Gudang |

## Transaksi Keluar

| Method | Endpoint | Pengganti fungsi lama | Role Check |
|---|---|---|---|
| GET | `/api/transaksi-keluar` | `fetchTransaksiKeluar` | Semua role |
| POST | `/api/transaksi-keluar` | `addTransaksiKeluar` | Admin/Audit/Team Gudang |
| PUT | `/api/transaksi-keluar/:id` | `updateTransaksiKeluar` | Admin/Audit/Team Gudang |
| DELETE | `/api/transaksi-keluar/:id` | `deleteTransaksiKeluar` | Admin only |
| POST | `/api/transaksi-keluar/bulk` | `bulkAddTransaksiKeluar` | Admin/Audit/Team Gudang |

## DO Open

| Method | Endpoint | Pengganti fungsi lama | Role Check |
|---|---|---|---|
| GET | `/api/do-open` | `fetchDoOpen` | Semua role; OPR hanya lihat filter area/RM miliknya |
| POST | `/api/do-open` | `addDoOpen` | Admin/Audit/Team Gudang |
| PUT | `/api/do-open/:id` | `updateDoOpen` | Admin/Audit/Team Gudang |
| DELETE | `/api/do-open/:id` | `deleteDoOpen` | Admin only |
| POST | `/api/do-open/bulk-upsert` | `bulkAddOrUpdateDoOpen` | Admin/Audit/Team Gudang |
| POST | `/api/do-open/reconcile` | `autoReconcileDoOpen` (dari firebase.ts, logic sama) | Admin/Audit/Team Gudang |
| POST | `/api/do-open/cleanup-duplicates` | `cleanupDuplicateTransactionsInSupabase` | Admin only |

## Request DO Open (approval flow — OPR)

| Method | Endpoint | Pengganti fungsi lama | Role Check |
|---|---|---|---|
| GET | `/api/request-do-open` | `fetchRequestDoOpen` | Semua role; OPR hanya lihat miliknya |
| POST | `/api/request-do-open` | `addRequestDoOpen` | OPR |
| POST | `/api/request-do-open/bulk` | `bulkAddRequestDoOpen` | OPR |
| PATCH | `/api/request-do-open/:id/status` | `updateRequestDoOpenStatus` | Admin/Team Gudang (approve/reject) |
| DELETE | `/api/request-do-open/:id` | `deleteRequestDoOpen` | Admin/Team Gudang |

## Users

| Method | Endpoint | Pengganti fungsi lama | Role Check |
|---|---|---|---|
| GET | `/api/users` | `fetchUsersSupabase` | Admin only — **JANGAN pernah kirim kolom password ke response, hash sekalipun** |
| POST | `/api/users` | `addUserSupabase` | Admin only (atau self-register dengan `is_approved=false` default) |
| PATCH | `/api/users/:nik/approve` | `approveUserSupabase` | Admin only |
| DELETE | `/api/users/:nik` | `deleteUserSupabase` | Admin only |

## Container Status

| Method | Endpoint | Pengganti fungsi lama | Role Check |
|---|---|---|---|
| GET | `/api/containers` | `fetchContainerStatus` | Semua role |
| POST | `/api/containers` | `addContainerStatus` | Admin/Audit/Team Gudang |
| PUT | `/api/containers/:id` | `updateContainerStatus` | Admin/Audit/Team Gudang |
| DELETE | `/api/containers/:id` | `deleteContainerStatus` | Admin only |
| POST | `/api/containers/batch` | `saveBatchContainerStatus` | Admin/Audit/Team Gudang |

## Katalog Foto

| Method | Endpoint | Pengganti fungsi lama | Role Check |
|---|---|---|---|
| GET | `/api/catalog-photos` | `fetchCatalogPhotosSupabase` | Semua role |
| POST | `/api/catalog-photos/upload` | `uploadFotoBarang` + `uploadBase64ToStorage` | Admin/Audit/Team Gudang — **simpan file ke disk, path ke DB (lihat CLAUDE.md)** |
| PUT | `/api/catalog-photos/:id` | `upsertCatalogPhotoSupabase` | Admin/Audit/Team Gudang |
| POST | `/api/catalog-photos/bulk` | `bulkUpsertCatalogPhotosSupabase` | Admin/Audit/Team Gudang |
| DELETE | `/api/catalog-photos/:id` | `deleteCatalogPhotoSupabase` | Admin only |

## CIF Container / Biaya Import (ditemukan lewat dump skema live — TIDAK ADA di supabase_schema.sql lama)

Sumber: `src/views/CifBapContainerView.tsx`. Tabel-tabel ini di versi Supabase lama **RLS-nya dimatikan total + GRANT ALL ke anon** — prioritas keamanan tinggi saat ditulis ulang.

| Method | Endpoint | Tabel terkait | Role Check |
|---|---|---|---|
| GET | `/api/cif-container/:noContainer` | `resume_cif_kontainer` | Admin/Audit — data biaya, JANGAN buka ke semua role |
| POST/PUT | `/api/cif-container` (upsert) | `resume_cif_kontainer` | Admin/Audit only |
| GET | `/api/cif-container/:noContainer/rincian-cif` | `rincian_biaya_cif` | Admin/Audit only |
| POST | `/api/cif-container/:noContainer/rincian-cif` (bulk) | `rincian_biaya_cif` | Admin/Audit only |
| GET | `/api/cif-container/:noContainer/rincian-non-cif` | `rincian_biaya_selain_cif` | Admin/Audit only |
| POST | `/api/cif-container/:noContainer/rincian-non-cif` (bulk) | `rincian_biaya_selain_cif` | Admin/Audit only |
| GET | `/api/cif-container/:noContainer/lengkap` | View gabungan (replikasi `view_resume_cif_lengkap`) | Admin/Audit only |

Kolom `resume_cif_kontainer`: `no_container`, `bulan_kont_jalan`, `tgl_terima_pib`, `ket`, `total_cost_po`, `total_cif`, `total_cif_ar1`, `total_cif_ar20`, `total_cif_ar6`, `total_cif_ar9`, `total_cif_soyu`, `total_cif_aff_na`, `pct_cif_vs_po`.
Kolom `rincian_biaya_cif` / `rincian_biaya_selain_cif`: breakdown biaya per `no_container`, per brand (ar1/ar20/ar6/ar9/soyu/aff_na) — lihat dump skema live untuk daftar kolom lengkap.

## Laporan / View Agregat (WAJIB dihitung di SQL, bukan di frontend)

| Method | Endpoint | Pengganti fungsi lama | Catatan |
|---|---|---|---|
| GET | `/api/reports/sisa-stock` | `fetchSisaStockView` (view `sisa_stock`) | Buat sebagai VIEW T-SQL, replikasi logic dari `supabase_schema.sql` |
| GET | `/api/reports/rekonsiliasi` | `fetchRekonsiliasiStockView` (view `rekonsiliasi_stock`) | Sama, VIEW T-SQL |
| GET | `/api/reports/dashboard-summary` | Logic di `DashboardView.tsx` (agregasi manual JS) | **Pindahkan ke stored procedure/VIEW** — ini akar masalah egress bengkak di versi lama |
| GET | `/api/reports/by-category` | Logic `groupCategoryMap` di `DashboardView.tsx` | Sama, agregasi di SQL |
| GET | `/api/stock/:itemCode/sisa` | `getSisaStokByItemCode` | Bisa jadi scalar function T-SQL |

## AI Chatbot (sudah ada, tinggal ganti sumber data)

| Method | Endpoint | Status |
|---|---|---|
| POST | `/api/chat-gudang` | **Sudah ada di `server.ts`**, cuma perlu ganti context yang dikirim ke Gemini dari data Supabase → data SQL Server (lewat endpoint reports di atas) |

## Fungsi yang SENGAJA tidak direplikasi (fase awal)

- `subscribeTransaksiMasuk` (Realtime) — di-drop untuk versi awal, lihat CLAUDE.md.
- `migrateFirebaseToSupabase.ts` — spesifik migrasi Firebase→Supabase lama, tidak relevan lagi.
- `fetchGDriveFileName` / `extractGDriveFileId` / `convertGoogleDriveUrl` — terkait alur foto dari Google Drive; evaluasi ulang apakah masih dibutuhkan setelah foto pindah ke disk VPS.
