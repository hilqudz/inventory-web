/* =====================================================================
   Perluas VIEW SisaStock dengan kolom yang ada di view supabase lama
   (sisa_stock): TotalMasuk, TotalKeluar, StatusStock — dipakai endpoint
   /api/reports/sisa-stock supaya bentuk response setara view lama.
   Threshold StatusStock mengikuti definisi lama: <=0 STOK HABIS,
   <10 WARNING, sisanya AMAN.
   Kolom lama dipertahankan — RekonsiliasiStock & StockByCategory yang
   ikut baca view ini tidak terdampak.
   ===================================================================== */

CREATE OR ALTER VIEW SisaStock AS
WITH Masuk AS (
    SELECT ItemCode, SUM(Qty) AS TotalMasuk
    FROM TransaksiMasuk
    GROUP BY ItemCode
),
Keluar AS (
    SELECT ItemCode, SUM(Qty) AS TotalKeluar
    FROM TransaksiKeluar
    GROUP BY ItemCode
)
SELECT
    mi.Kode        AS ItemCode,
    mi.NamaBarang  AS ItemName,
    mi.GroupName   AS GroupName,
    ISNULL(m.TotalMasuk, 0)  AS TotalMasuk,
    ISNULL(k.TotalKeluar, 0) AS TotalKeluar,
    ISNULL(m.TotalMasuk, 0) - ISNULL(k.TotalKeluar, 0) AS SisaStock,
    mi.HargaJual,
    mi.HargaBeli,
    CAST((ISNULL(m.TotalMasuk, 0) - ISNULL(k.TotalKeluar, 0)) * ISNULL(mi.HargaJual, 0) AS DECIMAL(18,2)) AS NilaiJual,
    CAST((ISNULL(m.TotalMasuk, 0) - ISNULL(k.TotalKeluar, 0)) * ISNULL(mi.HargaBeli, 0) AS DECIMAL(18,2)) AS NilaiBeli,
    CASE
        WHEN (ISNULL(m.TotalMasuk, 0) - ISNULL(k.TotalKeluar, 0)) <= 0 THEN 'STOK HABIS'
        WHEN (ISNULL(m.TotalMasuk, 0) - ISNULL(k.TotalKeluar, 0)) < 10 THEN 'WARNING'
        ELSE 'AMAN'
    END AS StatusStock
FROM MasterItem mi
LEFT JOIN Masuk m  ON m.ItemCode = mi.Kode
LEFT JOIN Keluar k ON k.ItemCode = mi.Kode;
GO
