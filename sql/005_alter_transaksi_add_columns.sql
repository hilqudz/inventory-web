/* =====================================================================
   Tambah kolom TransaksiMasuk & TransaksiKeluar supaya menampung semua
   field TransactionRecord yang dipakai UI (src/types.ts):
   postingDate → TanggalTransaksi (sudah ada), sisanya baru.

   Konteks: DDL 001 hanya menyimpan ItemCode/Qty/Tanggal/DocumentNo,
   padahal tabel supabase lama (transaksi_masuk/keluar) juga menyimpan
   category, entry_remark, from_location, to_location — tanpa ini data
   hilang saat POST dan halaman Transaksi rusak di Fase 5.
   Semua kolom nullable, VIEW SisaStock/RekonsiliasiStock tidak terdampak
   (hanya pakai ItemCode & Qty).
   ===================================================================== */

ALTER TABLE dbo.TransaksiMasuk ADD
    Category     NVARCHAR(150) NULL,
    EntryRemark  NVARCHAR(500) NULL,
    FromLocation NVARCHAR(150) NULL,
    ToLocation   NVARCHAR(150) NULL;
GO

ALTER TABLE dbo.TransaksiKeluar ADD
    Category     NVARCHAR(150) NULL,
    EntryRemark  NVARCHAR(500) NULL,
    FromLocation NVARCHAR(150) NULL,
    ToLocation   NVARCHAR(150) NULL;
GO
