/* =====================================================================
   Data dummy untuk validasi Fase 2 — HAPUS/TRUNCATE sebelum masuk data
   asli di Fase 7. Jangan gunakan NIK/nama asli karyawan di sini.
   ===================================================================== */
USE InventoryGudang;
GO

-- Master item — 3 SKU dummy, mirip kategori yang muncul di rekaman (hair clip)
INSERT INTO MasterItem (Kode, NamaBarang, GroupName, HargaJual, HargaBeli) VALUES
('HC-001', 'Hair Clip Motif Bunga', 'Hair Clip', 15000, 8000),
('HC-002', 'Hair Clip Polos', 'Hair Clip', 12000, 6000),
('HT-001', 'Hair Tie Basic', 'Hair Tie', 8000, 4000);
GO

-- Transaksi masuk
INSERT INTO TransaksiMasuk (ItemCode, Qty, TanggalTransaksi, DocumentNo) VALUES
('HC-001', 200, '2026-08-01', 'IN-0001'),
('HC-002', 150, '2026-08-01', 'IN-0002'),
('HT-001', 300, '2026-08-01', 'IN-0003');
GO

-- Transaksi keluar (sebagian sudah terjual/keluar dari gudang)
INSERT INTO TransaksiKeluar (ItemCode, Qty, DocumentNo, TanggalTransaksi) VALUES
('HC-001', 40, 'OUT-0001', '2026-08-05'),
('HC-002', 20, 'OUT-0002', '2026-08-05');
GO

-- DO Open — sebagian stok yang tersisa sedang "terikat" DO, sisanya jadi qty lepasan
INSERT INTO DoOpen (DocumentNo, ItemCode, StatusDoOpen, AreaRmOpr, Qty, TotalCost, TotalPrice) VALUES
('DO-1001', 'HC-001', 'Belum Shipping Logistik', 'Bu Ita', 60, 480000, 900000),
('DO-1002', 'HC-002', 'Sudah Di Logistik', 'Bu Ita', 30, 180000, 360000);
GO

-- Test hasil View
SELECT * FROM SisaStock;
SELECT * FROM RekonsiliasiStock;
SELECT * FROM StockByCategory;
SELECT * FROM DashboardSummary;
SELECT * FROM DoOpenLogistikGroup;
