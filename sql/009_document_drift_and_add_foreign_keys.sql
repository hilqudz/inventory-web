/* =====================================================================
   1. DOKUMENTASI SCHEMA DRIFT: kolom SourceId

   Ditemukan lewat information_schema.columns (Agustus 2026) — kolom
   SourceId (UNIQUEIDENTIFIER, nullable) + unique index UX_*_SourceId
   sudah ADA di TransaksiMasuk, TransaksiKeluar, DoOpen (dan tabel arsip
   DoOpen_ClosedBackup_20260816), TAPI tidak pernah dibuat lewat file
   migrasi manapun di folder ini — terbawa dari proses migrasi awal
   tanpa tercatat. Sesuai aturan CLAUDE.md ("logic wajib tercatat di
   kode, jangan cuma hidup di database"), dicatat di sini SEKARANG
   supaya jadi sumber kebenaran, BUKAN dibuat ulang (kolomnya sudah ada
   & sudah terisi 100% di data live per Agustus 2026).

   Fungsinya: idempotency key untuk sinkronisasi dari sumber luar (ETL/
   ERP) — satu baris sumber = satu SourceId, unique index mencegah baris
   yang sama masuk dobel kalau proses sync diulang. INI FONDASI YANG
   DIPAKAI untuk sinkronisasi ERP di masa depan (lihat diskusi sesi
   terkait) — jangan dihapus/diganti tanpa pertimbangan matang.

   Definisi setara (untuk referensi kalau perlu setup fresh database):
     ALTER TABLE dbo.TransaksiMasuk  ADD SourceId UNIQUEIDENTIFIER NULL;
     ALTER TABLE dbo.TransaksiKeluar ADD SourceId UNIQUEIDENTIFIER NULL;
     ALTER TABLE dbo.DoOpen          ADD SourceId UNIQUEIDENTIFIER NULL;
     CREATE UNIQUE INDEX UX_TransaksiMasuk_SourceId  ON dbo.TransaksiMasuk(SourceId)  WHERE SourceId IS NOT NULL;
     CREATE UNIQUE INDEX UX_TransaksiKeluar_SourceId ON dbo.TransaksiKeluar(SourceId) WHERE SourceId IS NOT NULL;
     CREATE UNIQUE INDEX UX_DoOpen_SourceId          ON dbo.DoOpen(SourceId)          WHERE SourceId IS NOT NULL;
   (Filtered unique index — WHERE SourceId IS NOT NULL — supaya banyak
   baris NULL tidak dianggap bentrok oleh SQL Server.)

   =====================================================================
   2. FOREIGN KEY ItemCode → MasterItem.Kode

   Konteks: 001_create_schema.sql SENGAJA tidak memasang FK ini, dengan
   alasan "data import dari ERP kerap punya item_code yang belum tentu
   ada dulu di MasterItem". Itu SUDAH TIDAK BERLAKU — setiap jalur tulis
   (single & bulk, lihat src/dbHelpers.ts ensureMasterItems) sekarang
   auto-membuat baris MasterItem placeholder dulu sebelum insert ke
   tabel anak. Diverifikasi 0 baris orphan di semua tabel sebelum
   migrasi ini dijalankan (lihat catatan sesi terkait).

   Kenapa sekarang, bukan nanti: rencana sinkronisasi ERP butuh jaminan
   integritas referensial di level database, bukan cuma di kode — kalau
   suatu saat ada jalur tulis baru yang lupa panggil ensureMasterItems,
   FK ini yang akan menahannya, bukan silent orphan row.

   Efek samping yang PERLU diketahui: DELETE MasterItem sekarang akan
   DITOLAK kalau item itu masih punya baris di salah satu tabel anak
   (ON DELETE default = NO ACTION, sengaja — supaya hapus master item
   tidak diam-diam menghapus riwayat transaksinya). Endpoint
   DELETE /api/master-items/:kode di server.ts sudah diberi pesan error
   yang jelas untuk kasus ini (SQL error 547).

   WITH CHECK dipakai (bukan WITH NOCHECK) supaya SQL Server VALIDASI
   dulu semua baris existing — akan gagal loud kalau ternyata masih ada
   orphan yang belum ketahuan, bukan diam-diam melewatkannya.
   ===================================================================== */

ALTER TABLE dbo.TransaksiMasuk WITH CHECK ADD CONSTRAINT FK_TransaksiMasuk_MasterItem
    FOREIGN KEY (ItemCode) REFERENCES dbo.MasterItem(Kode);
GO

ALTER TABLE dbo.TransaksiKeluar WITH CHECK ADD CONSTRAINT FK_TransaksiKeluar_MasterItem
    FOREIGN KEY (ItemCode) REFERENCES dbo.MasterItem(Kode);
GO

ALTER TABLE dbo.DoOpen WITH CHECK ADD CONSTRAINT FK_DoOpen_MasterItem
    FOREIGN KEY (ItemCode) REFERENCES dbo.MasterItem(Kode);
GO

ALTER TABLE dbo.KatalogFoto WITH CHECK ADD CONSTRAINT FK_KatalogFoto_MasterItem
    FOREIGN KEY (ItemCode) REFERENCES dbo.MasterItem(Kode);
GO

ALTER TABLE dbo.RequestDoOpen WITH CHECK ADD CONSTRAINT FK_RequestDoOpen_MasterItem
    FOREIGN KEY (ItemCode) REFERENCES dbo.MasterItem(Kode);
GO
