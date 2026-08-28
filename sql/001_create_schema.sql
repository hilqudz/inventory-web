/* =====================================================================
   InventoryGudang — DDL SQL Server 2025
   Sumber kebenaran struktur: dump information_schema.columns dari
   Supabase live (Agustus 2026), BUKAN supabase_schema.sql yang sudah
   ketinggalan (lihat CLAUDE.md untuk detail drift-nya).

   Konvensi penamaan: PascalCase (standar SQL Server), berbeda dari
   snake_case Postgres asli — ini keputusan sadar, bukan port 1:1.

   Perubahan yang DISENGAJA dari skema lama (bukan bug, catat di sini
   supaya jelas kenapa beda):
   - PasswordHash: NVARCHAR(255) untuk simpan hash bcrypt, BUKAN plaintext.
   - Role ditambah 'Admin' (skema lama cuma Audit/Team Gudang/OPR, fungsi
     admin dulu dipegang manual lewat akun pribadi Pak Irvan — ini
     diperbaiki, bukan direplikasi).
   - KatalogFoto.PhotoPath: path relatif ke file di disk VPS, BUKAN
     binary/base64 dan BUKAN URL Google Drive.
   - Tidak ada FOREIGN KEY ketat ke ItemCode di seluruh tabel transaksi —
     ini SENGAJA meniru skema asli (yang juga tidak ada FK), karena data
     import dari ERP kerap punya item_code yang belum tentu ada dulu di
     MasterItem. Konsekuensinya: integritas referensial harus dijaga di
     level API, bukan di level database.
   ===================================================================== */

CREATE DATABASE InventoryGudang;
GO

USE InventoryGudang;
GO

/* =====================================================================
   USERS
   ===================================================================== */
CREATE TABLE Users (
    Nik              NVARCHAR(50)   NOT NULL PRIMARY KEY,
    NamaLengkap      NVARCHAR(200)  NOT NULL,
    PasswordHash     NVARCHAR(255)  NOT NULL,       -- bcrypt hash, JANGAN plaintext
    Role             NVARCHAR(50)   NOT NULL,
    IsApproved       BIT            NOT NULL DEFAULT 0,
    RmAreaScope      NVARCHAR(100)  NULL,           -- kosong = enforcement RM/area belum aktif (lihat CLAUDE.md, keputusan "gitu dulu aja")
    CreatedAt        DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    ApprovedBy       NVARCHAR(50)   NULL,
    ApprovedAt       DATETIME2      NULL,
    CONSTRAINT CK_Users_Role CHECK (Role IN ('Audit', 'Team Gudang', 'OPR', 'Admin'))
);
GO

/* =====================================================================
   MASTER ITEM
   ===================================================================== */
CREATE TABLE MasterItem (
    Kode             NVARCHAR(100)  NOT NULL PRIMARY KEY,
    NamaBarang       NVARCHAR(300)  NOT NULL,
    GroupName        NVARCHAR(150)  NOT NULL,
    HargaJual        DECIMAL(18,2)  NULL,
    HargaBeli        DECIMAL(18,2)  NULL,           -- WAJIB disembunyikan dari role OPR di response API
    CreatedAt        DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_MasterItem_GroupName ON MasterItem(GroupName);
GO

/* =====================================================================
   TRANSAKSI MASUK
   ===================================================================== */
CREATE TABLE TransaksiMasuk (
    Id               BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    ItemCode         NVARCHAR(100)  NOT NULL,
    Qty              DECIMAL(18,2)  NOT NULL,
    TanggalTransaksi DATE           NULL,
    DocumentNo       NVARCHAR(100)  NULL,
    CreatedAt        DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_TransaksiMasuk_ItemCode ON TransaksiMasuk(ItemCode);
GO

/* =====================================================================
   TRANSAKSI KELUAR
   ===================================================================== */
CREATE TABLE TransaksiKeluar (
    Id               BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    ItemCode         NVARCHAR(100)  NOT NULL,
    Qty              DECIMAL(18,2)  NOT NULL,
    DocumentNo       NVARCHAR(100)  NULL,           -- dipakai untuk matching reconcile dengan DoOpen.DocumentNo
    TanggalTransaksi DATE           NULL,
    CreatedAt        DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_TransaksiKeluar_ItemCode ON TransaksiKeluar(ItemCode);
CREATE INDEX IX_TransaksiKeluar_DocumentNo ON TransaksiKeluar(DocumentNo);
GO

/* =====================================================================
   DO OPEN
   Kolom NoDosl, Keterangan, TotalQty/TotalCost/TotalPrice: sesuai drift
   yang ditemukan di dump live, bukan ada di supabase_schema.sql lama.
   ===================================================================== */
CREATE TABLE DoOpen (
    Id               UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
    PostingDate      NVARCHAR(50)   NULL,
    AreaRmOpr        NVARCHAR(150)  NULL,
    DocumentNo       NVARCHAR(100)  NOT NULL,
    ItemCode         NVARCHAR(100)  NOT NULL,
    StatusDoOpen     NVARCHAR(100)  NULL,           -- dipakai getDoOpenLogistikGroup() — pertimbangkan normalisasi ke kode tetap, bukan free text
    AreaSpvOpr       NVARCHAR(150)  NULL,
    Qty              DECIMAL(18,2)  NULL,
    NilaiJual        DECIMAL(18,2)  NULL,
    FromLocation     NVARCHAR(150)  NULL,
    ToLocation       NVARCHAR(150)  NULL,
    Aksi             NVARCHAR(100)  NULL,
    TotalQty         DECIMAL(18,2)  NULL,
    TotalCost        DECIMAL(18,2)  NULL,
    TotalPrice       DECIMAL(18,2)  NULL,
    NoDosl           NVARCHAR(100)  NULL,
    Keterangan       NVARCHAR(500)  NULL,
    CreatedAt        DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_DoOpen_ItemCode ON DoOpen(ItemCode);
CREATE INDEX IX_DoOpen_DocumentNo ON DoOpen(DocumentNo);
CREATE INDEX IX_DoOpen_AreaRmOpr ON DoOpen(AreaRmOpr);
GO

/* =====================================================================
   REQUEST DO OPEN (approval flow OPR)
   ===================================================================== */
CREATE TABLE RequestDoOpen (
    Id               UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
    TanggalRequest   NVARCHAR(50)   NULL,
    DocumentNo       NVARCHAR(100)  NOT NULL,
    ItemCode         NVARCHAR(100)  NOT NULL,
    Qty              DECIMAL(18,2)  NULL,
    AreaRmOpr        NVARCHAR(150)  NULL,
    AreaSpvOpr       NVARCHAR(150)  NULL,
    ToLocation       NVARCHAR(150)  NULL,
    Pengajuan        NVARCHAR(200)  NULL,
    StatusApproval   NVARCHAR(50)   NOT NULL DEFAULT 'Pending',
    AksiPicGudang    NVARCHAR(200)  NULL,
    NoDosl           NVARCHAR(100)  NULL,
    Keterangan       NVARCHAR(500)  NULL,
    RequestedByNik   NVARCHAR(50)   NULL,           -- BARU: kaitkan ke Users.Nik, tidak ada di skema lama — perlu untuk audit trail siapa yang request
    ApprovedByNik    NVARCHAR(50)   NULL,           -- BARU: sama alasannya
    CreatedAt        DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_RequestDoOpen_DocumentNo ON RequestDoOpen(DocumentNo);
CREATE INDEX IX_RequestDoOpen_StatusApproval ON RequestDoOpen(StatusApproval);
GO

/* =====================================================================
   CONTAINER STATUS
   ===================================================================== */
CREATE TABLE ContainerStatus (
    Id                  BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    NoContainer         NVARCHAR(100)  NOT NULL,
    Category            NVARCHAR(150)  NULL,
    TglTibaPriuk        NVARCHAR(50)   NULL,
    TglTibaBintara      NVARCHAR(50)   NULL,
    ItemCategoryBarang  NVARCHAR(150)  NULL,
    StatusContainer     NVARCHAR(100)  NOT NULL,
    Remark              NVARCHAR(500)  NULL,
    TotalQty            DECIMAL(18,2)  NULL,
    TotalCost           DECIMAL(18,2)  NULL,
    TotalPrice          DECIMAL(18,2)  NULL,
    CreatedAt           DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

/* =====================================================================
   KATALOG FOTO — path ke file di disk VPS, BUKAN binary/base64
   ===================================================================== */
CREATE TABLE KatalogFoto (
    Id               NVARCHAR(100)  NOT NULL PRIMARY KEY,   -- string ID sesuai skema live, bukan uuid
    ItemCode         NVARCHAR(100)  NOT NULL,
    ItemName         NVARCHAR(300)  NULL,
    GroupName        NVARCHAR(150)  NULL,
    PhotoPath        NVARCHAR(500)  NOT NULL,               -- contoh: /uploads/foto-barang/ITEM123_1699999999.jpg
    Notes            NVARCHAR(500)  NULL,
    CreatedAt        DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt        DATETIME2      NULL
);
GO
CREATE INDEX IX_KatalogFoto_ItemCode ON KatalogFoto(ItemCode);
GO

/* =====================================================================
   CIF CONTAINER / BIAYA IMPOR
   Temuan keamanan: di Supabase versi lama, RLS OFF total + GRANT ALL ke
   anon. Di sini TIDAK ada RLS-equivalent — otorisasi WAJIB dilakukan di
   endpoint API (lihat CLAUDE.md poin 5), bukan diasumsikan aman karena
   "cuma tabel container".
   ===================================================================== */
CREATE TABLE ResumeCifKontainer (
    Id                BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    NoContainer       NVARCHAR(100)  NOT NULL,
    BulanKontJalan    NVARCHAR(50)   NULL,
    TglTerimaPib      NVARCHAR(50)   NULL,
    Ket               NVARCHAR(500)  NULL,
    TotalCostPo       DECIMAL(18,2)  NULL,
    TotalCif          DECIMAL(18,2)  NULL,
    TotalCifAr1       DECIMAL(18,2)  NULL,
    TotalCifAr20      DECIMAL(18,2)  NULL,
    TotalCifAr6       DECIMAL(18,2)  NULL,
    TotalCifAr9       DECIMAL(18,2)  NULL,
    TotalCifSoyu      DECIMAL(18,2)  NULL,
    TotalCifAffNa     DECIMAL(18,2)  NULL,
    PctCifVsPo        DECIMAL(9,4)   NULL,
    CreatedAt         DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE UNIQUE INDEX UX_ResumeCifKontainer_NoContainer ON ResumeCifKontainer(NoContainer);
GO

CREATE TABLE RincianBiayaCif (
    Id               BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    NoContainer      NVARCHAR(100)  NOT NULL,
    DeskripsiBiaya   NVARCHAR(300)  NOT NULL,
    TotalCif         DECIMAL(18,2)  NULL,
    PctVsPo          DECIMAL(9,4)   NULL,
    Ar1              DECIMAL(18,2)  NULL,
    Ar20             DECIMAL(18,2)  NULL,
    Ar6              DECIMAL(18,2)  NULL,
    Ar9              DECIMAL(18,2)  NULL,
    Soyu             DECIMAL(18,2)  NULL,
    AffNa            DECIMAL(18,2)  NULL,
    Keterangan       NVARCHAR(500)  NULL,
    CreatedAt        DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_RincianBiayaCif_NoContainer ON RincianBiayaCif(NoContainer);
GO

CREATE TABLE RincianBiayaSelainCif (
    Id               BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    NoContainer      NVARCHAR(100)  NOT NULL,
    DeskripsiBiaya   NVARCHAR(300)  NOT NULL,
    KategoriBiaya    NVARCHAR(100)  NULL,
    TotalBiaya       DECIMAL(18,2)  NULL,
    PctVsPo          DECIMAL(9,4)   NULL,
    CreatedAt        DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_RincianBiayaSelainCif_NoContainer ON RincianBiayaSelainCif(NoContainer);
GO


/* =====================================================================
   VIEWS — agregasi WAJIB di sini, bukan di-loop di frontend/API handler
   (ini akar masalah egress bengkak di versi Supabase lama)
   ===================================================================== */

-- Sisa stok per item = total masuk - total keluar
CREATE VIEW SisaStock AS
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
    ISNULL(m.TotalMasuk, 0) - ISNULL(k.TotalKeluar, 0) AS SisaStock,
    mi.HargaJual,
    mi.HargaBeli,
    CAST((ISNULL(m.TotalMasuk, 0) - ISNULL(k.TotalKeluar, 0)) * ISNULL(mi.HargaJual, 0) AS DECIMAL(18,2)) AS NilaiJual,
    CAST((ISNULL(m.TotalMasuk, 0) - ISNULL(k.TotalKeluar, 0)) * ISNULL(mi.HargaBeli, 0) AS DECIMAL(18,2)) AS NilaiBeli
FROM MasterItem mi
LEFT JOIN Masuk m  ON m.ItemCode = mi.Kode
LEFT JOIN Keluar k ON k.ItemCode = mi.Kode;
GO

-- Rekonsiliasi: sisa stok vs qty yang masih ada di DO Open ("qty lepasan" = stok bebas belum terikat DO)
CREATE VIEW RekonsiliasiStock AS
WITH DoOpenAgg AS (
    SELECT ItemCode, SUM(Qty) AS QtyDoOpen
    FROM DoOpen
    GROUP BY ItemCode
)
SELECT
    s.ItemCode,
    s.ItemName,
    s.GroupName,
    s.SisaStock       AS SisaStockA,
    ISNULL(d.QtyDoOpen, 0) AS QtyDoOpenB,
    CASE
        WHEN (s.SisaStock - ISNULL(d.QtyDoOpen, 0)) > 0
        THEN s.SisaStock - ISNULL(d.QtyDoOpen, 0)
        ELSE 0
    END AS QtyLepasan,
    CASE
        WHEN s.SisaStock >= ISNULL(d.QtyDoOpen, 0) THEN 'OK'
        ELSE 'SELISIH'
    END AS StatusRekonsiliasi
FROM SisaStock s
LEFT JOIN DoOpenAgg d ON d.ItemCode = s.ItemCode;
GO

-- Rekap per kategori (group_name) — pengganti groupCategoryMap yang dulu dihitung di browser
CREATE VIEW StockByCategory AS
SELECT
    GroupName,
    SUM(SisaStock) AS TotalQty,
    CAST(SUM(NilaiJual) AS DECIMAL(18,2)) AS TotalNilaiJual,
    CAST(SUM(NilaiBeli) AS DECIMAL(18,2)) AS TotalNilaiBeli
FROM SisaStock
GROUP BY GroupName;
GO

-- Dashboard summary — pengganti perhitungan manual di DashboardView.tsx
CREATE VIEW DashboardSummary AS
SELECT
    SUM(SisaStock)  AS TotalStok,
    CAST(SUM(NilaiJual) AS DECIMAL(18,2))  AS TotalNilaiJual,
    CAST(SUM(NilaiBeli) AS DECIMAL(18,2))  AS TotalNilaiBeli,
    CAST(SUM(NilaiJual) - SUM(NilaiBeli) AS DECIMAL(18,2)) AS EstimasiGrossProfit
FROM SisaStock;
GO

-- Status DO Open dikelompokkan QC vs Logistik — replikasi getDoOpenLogistikGroup(),
-- tapi tetap berbasis pattern-match teks (lihat catatan risiko di CLAUDE.md/komentar DoOpen.StatusDoOpen)
CREATE VIEW DoOpenLogistikGroup AS
SELECT
    *,
    CASE
        WHEN UPPER(LTRIM(RTRIM(ISNULL(StatusDoOpen, '')))) IN ('NOT POSTING SHIPPING', 'DO SUDAH DI LOGISTIK', 'SUDAH DI LOGISTIK', 'LOGISTIK')
          OR UPPER(ISNULL(StatusDoOpen, '')) LIKE '%SIAP KIRIM%'
          OR UPPER(ISNULL(StatusDoOpen, '')) LIKE '%SUDAH DI LOGISTIK%'
        THEN 'BARANG SUDAH DI LOGISTIK (SIAP KIRIM)'
        ELSE 'BARANG MASIH ADA DI AREA QC'
    END AS LogistikGroup
FROM DoOpen;
GO
