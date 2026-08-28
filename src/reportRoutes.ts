import type { Express, Response } from "express";
import { getPool, sql } from "./db";
import { authRequired, type AuthedRequest } from "./auth";

/* Routes Laporan / Agregasi — SEMUA perhitungan di VIEW T-SQL (SisaStock,
   RekonsiliasiStock, StockByCategory, DashboardSummary, DoOpenLogistikGroup),
   bukan di-loop di JS. Ini pengganti agregasi manual di DashboardView.tsx
   yang jadi akar masalah egress bengkak di versi lama (lihat CLAUDE.md).

   Aturan role: harga beli / nilai beli / gross profit DIHILANGKAN dari
   response untuk OPR — role lain (Admin/Audit/Team Gudang/BOD) akses penuh. */

const dbError = (res: Response, label: string, err: any) => {
  console.error(`Error ${label}:`, err?.message || err);
  res.status(500).json({ error: "Operasi database gagal. Cek tunnel SSH masih terbuka." });
};

const isOPR = (req: AuthedRequest) => req.user!.role === "OPR";

export function registerReportRoutes(app: Express) {
  // GET /api/reports/sisa-stock?startDate=&endDate= — bentuk kolom setara view
  // sisa_stock lama (snake_case). Tanpa parameter tanggal: pakai VIEW SisaStock
  // (cepat, sudah teroptimasi). Dengan parameter: query langsung dengan filter
  // tanggal di TransaksiMasuk/Keluar — VIEW tidak bisa menerima parameter.
  app.get("/api/reports/sisa-stock", authRequired, async (req: AuthedRequest, res) => {
    try {
      const pool = await getPool();
      const { startDate, endDate } = req.query;
      const hasDateFilter = typeof startDate === "string" && startDate || typeof endDate === "string" && endDate;

      const result = hasDateFilter
        ? await pool
            .request()
            .input("StartDate", sql.Date, startDate || null)
            .input("EndDate", sql.Date, endDate || null)
            .query(`
              WITH Masuk AS (
                SELECT ItemCode, SUM(Qty) AS TotalMasuk
                FROM dbo.TransaksiMasuk
                WHERE (@StartDate IS NULL OR TanggalTransaksi >= @StartDate)
                  AND (@EndDate IS NULL OR TanggalTransaksi <= @EndDate)
                GROUP BY ItemCode
              ),
              Keluar AS (
                SELECT ItemCode, SUM(Qty) AS TotalKeluar
                FROM dbo.TransaksiKeluar
                WHERE (@StartDate IS NULL OR TanggalTransaksi >= @StartDate)
                  AND (@EndDate IS NULL OR TanggalTransaksi <= @EndDate)
                GROUP BY ItemCode
              )
              SELECT
                mi.Kode AS ItemCode, mi.NamaBarang AS ItemName, mi.GroupName,
                ISNULL(m.TotalMasuk, 0) AS TotalMasuk,
                ISNULL(k.TotalKeluar, 0) AS TotalKeluar,
                ISNULL(m.TotalMasuk, 0) - ISNULL(k.TotalKeluar, 0) AS SisaStock,
                mi.HargaJual, mi.HargaBeli,
                CAST((ISNULL(m.TotalMasuk, 0) - ISNULL(k.TotalKeluar, 0)) * ISNULL(mi.HargaJual, 0) AS DECIMAL(18,2)) AS NilaiJual,
                CAST((ISNULL(m.TotalMasuk, 0) - ISNULL(k.TotalKeluar, 0)) * ISNULL(mi.HargaBeli, 0) AS DECIMAL(18,2)) AS NilaiBeli,
                CASE
                  WHEN (ISNULL(m.TotalMasuk, 0) - ISNULL(k.TotalKeluar, 0)) <= 0 THEN 'STOK HABIS'
                  WHEN (ISNULL(m.TotalMasuk, 0) - ISNULL(k.TotalKeluar, 0)) < 10 THEN 'WARNING'
                  ELSE 'AMAN'
                END AS StatusStock
              FROM dbo.MasterItem mi
              LEFT JOIN Masuk m ON m.ItemCode = mi.Kode
              LEFT JOIN Keluar k ON k.ItemCode = mi.Kode
              ORDER BY mi.Kode
            `)
        : await pool.request().query("SELECT * FROM dbo.SisaStock ORDER BY ItemCode");

      const opr = isOPR(req);
      res.json(
        result.recordset.map((r: any) => ({
          item_code: r.ItemCode,
          item_name: r.ItemName,
          group_name: r.GroupName,
          harga_jual: Number(r.HargaJual || 0),
          total_masuk: Number(r.TotalMasuk || 0),
          total_keluar: Number(r.TotalKeluar || 0),
          sisa_stock: Number(r.SisaStock || 0),
          nilai_stock_jual: Number(r.NilaiJual || 0),
          status_stock: r.StatusStock,
          ...(opr ? {} : {
            harga_beli: Number(r.HargaBeli || 0),
            nilai_stock_beli: Number(r.NilaiBeli || 0),
          }),
        }))
      );
    } catch (err) {
      dbError(res, "GET /api/reports/sisa-stock", err);
    }
  });

  // GET /api/reports/rekonsiliasi?startDate=&endDate= — SELALU query parameterized
  // (bukan VIEW RekonsiliasiStock). Alasan: VIEW membatasi QtyLepasan minimal 0,
  // tapi RekonsiliasiStockView.tsx butuh nilai NEGATIF untuk status "Over Committed"
  // (qtyLepasan < 0) — beda semantik dari VIEW lama. Query di bawah replikasi persis
  // formula client: qtyLepasan = sisaStock - qtyDoOpen, TANPA clamp.
  app.get("/api/reports/rekonsiliasi", authRequired, async (req: AuthedRequest, res) => {
    try {
      const pool = await getPool();
      const { startDate, endDate } = req.query;

      const result = await pool
        .request()
        .input("StartDate", sql.Date, typeof startDate === "string" && startDate ? startDate : null)
        .input("EndDate", sql.Date, typeof endDate === "string" && endDate ? endDate : null)
        .query(`
          WITH Masuk AS (
            SELECT ItemCode, SUM(Qty) AS TotalMasuk
            FROM dbo.TransaksiMasuk
            WHERE (@StartDate IS NULL OR TanggalTransaksi >= @StartDate)
              AND (@EndDate IS NULL OR TanggalTransaksi <= @EndDate)
            GROUP BY ItemCode
          ),
          Keluar AS (
            SELECT ItemCode, SUM(Qty) AS TotalKeluar
            FROM dbo.TransaksiKeluar
            WHERE (@StartDate IS NULL OR TanggalTransaksi >= @StartDate)
              AND (@EndDate IS NULL OR TanggalTransaksi <= @EndDate)
            GROUP BY ItemCode
          ),
          DoOpenAgg AS (
            SELECT ItemCode, SUM(Qty) AS QtyDoOpen
            FROM dbo.DoOpen
            WHERE (@StartDate IS NULL OR TRY_CAST(PostingDate AS DATE) >= @StartDate)
              AND (@EndDate IS NULL OR TRY_CAST(PostingDate AS DATE) <= @EndDate)
            GROUP BY ItemCode
          ),
          Sisa AS (
            SELECT
              mi.Kode AS ItemCode, mi.NamaBarang AS ItemName, mi.GroupName,
              ISNULL(m.TotalMasuk, 0) - ISNULL(k.TotalKeluar, 0) AS SisaStock
            FROM dbo.MasterItem mi
            LEFT JOIN Masuk m ON m.ItemCode = mi.Kode
            LEFT JOIN Keluar k ON k.ItemCode = mi.Kode
          )
          SELECT
            s.ItemCode, s.ItemName, s.GroupName,
            s.SisaStock AS SisaStockA,
            ISNULL(d.QtyDoOpen, 0) AS QtyDoOpenB,
            s.SisaStock - ISNULL(d.QtyDoOpen, 0) AS QtyLepasan,
            CASE WHEN s.SisaStock >= ISNULL(d.QtyDoOpen, 0) THEN 'OK' ELSE 'SELISIH' END AS StatusRekonsiliasi
          FROM Sisa s
          LEFT JOIN DoOpenAgg d ON d.ItemCode = s.ItemCode
          ORDER BY s.ItemCode
        `);

      res.json(
        result.recordset.map((r: any) => ({
          item_code: r.ItemCode,
          item_name: r.ItemName,
          group_name: r.GroupName,
          sisa_stock_a: Number(r.SisaStockA || 0),
          qty_do_open_b: Number(r.QtyDoOpenB || 0),
          qty_lepasan: Number(r.QtyLepasan || 0),
          status_rekonsiliasi: r.StatusRekonsiliasi,
        }))
      );
    } catch (err) {
      dbError(res, "GET /api/reports/rekonsiliasi", err);
    }
  });

  // GET /api/reports/dashboard-summary — pengganti agregasi manual DashboardView.tsx
  app.get("/api/reports/dashboard-summary", authRequired, async (req: AuthedRequest, res) => {
    try {
      const pool = await getPool();
      // Satu round-trip, empat result set — semua agregasi di SQL
      const result = await pool.request().query(`
        SELECT * FROM dbo.DashboardSummary;
        SELECT COUNT(*) AS TotalItems FROM dbo.MasterItem;
        SELECT LogistikGroup, SUM(ISNULL(Qty,0)) AS TotalQty, COUNT(*) AS JumlahBaris
        FROM dbo.DoOpenLogistikGroup GROUP BY LogistikGroup;
        SELECT
          COUNT(*) AS Total,
          SUM(CASE WHEN StatusContainer LIKE '%Tiba di Bintara%' THEN 1 ELSE 0 END) AS TibaBintara,
          SUM(CASE WHEN StatusContainer LIKE '%Masih OTW%' THEN 1 ELSE 0 END) AS MasihOtw,
          SUM(CASE WHEN StatusContainer LIKE '%Belum OTW%' THEN 1 ELSE 0 END) AS BelumOtw
        FROM dbo.ContainerStatus;
      `);
      const [summaryRs, itemsRs, doGroupRs, containerRs] = result.recordsets as any[];
      const summary = summaryRs[0] || {};
      const containers = containerRs[0] || {};
      const qc = doGroupRs.find((g: any) => g.LogistikGroup === "BARANG MASIH ADA DI AREA QC");
      const log = doGroupRs.find((g: any) => g.LogistikGroup === "BARANG SUDAH DI LOGISTIK (SIAP KIRIM)");
      const opr = isOPR(req);
      res.json({
        totalItems: Number(itemsRs[0]?.TotalItems || 0),
        totalStok: Number(summary.TotalStok || 0),
        totalNilaiJual: Number(summary.TotalNilaiJual || 0),
        ...(opr ? {} : {
          totalNilaiBeli: Number(summary.TotalNilaiBeli || 0),
          estimasiGrossProfit: Number(summary.EstimasiGrossProfit || 0),
        }),
        doOpen: {
          totalQty: Number(qc?.TotalQty || 0) + Number(log?.TotalQty || 0),
          qcQty: Number(qc?.TotalQty || 0),
          logistikQty: Number(log?.TotalQty || 0),
        },
        containers: {
          total: Number(containers.Total || 0),
          tibaBintara: Number(containers.TibaBintara || 0),
          masihOtw: Number(containers.MasihOtw || 0),
          belumOtw: Number(containers.BelumOtw || 0),
        },
      });
    } catch (err) {
      dbError(res, "GET /api/reports/dashboard-summary", err);
    }
  });

  // GET /api/reports/dashboard-by-year-group — pengganti agregasi manual
  // cdGroupedAllRows di DashboardView.tsx. Kelompokkan MasterItem per
  // YEAR(CreatedAt) + GroupName, dengan sisa stock (masuk-keluar) & nilai
  // beli dihitung per baris. Tahun 2013-2016 disaring (data sampah legacy,
  // sama seperti perilaku lama).
  app.get("/api/reports/dashboard-by-year-group", authRequired, async (req: AuthedRequest, res) => {
    try {
      const opr = isOPR(req);
      const pool = await getPool();
      const result = await pool.request().query(`
        WITH Masuk AS (
          SELECT ItemCode, SUM(Qty) AS TotalMasuk FROM dbo.TransaksiMasuk GROUP BY ItemCode
        ),
        Keluar AS (
          SELECT ItemCode, SUM(Qty) AS TotalKeluar FROM dbo.TransaksiKeluar GROUP BY ItemCode
        )
        SELECT
          CAST(YEAR(mi.CreatedAt) AS NVARCHAR(4)) AS Year,
          ISNULL(NULLIF(LTRIM(RTRIM(mi.GroupName)), ''), 'Tanpa Group') AS GroupName,
          COUNT(*) AS ItemCount,
          SUM(ISNULL(m.TotalMasuk, 0) - ISNULL(k.TotalKeluar, 0)) AS TotalQty,
          CAST(SUM((ISNULL(m.TotalMasuk, 0) - ISNULL(k.TotalKeluar, 0)) * ISNULL(mi.HargaBeli, 0)) AS DECIMAL(18,2)) AS TotalCost
        FROM dbo.MasterItem mi
        LEFT JOIN Masuk m ON m.ItemCode = mi.Kode
        LEFT JOIN Keluar k ON k.ItemCode = mi.Kode
        WHERE YEAR(mi.CreatedAt) NOT IN (2013, 2014, 2015, 2016)
        GROUP BY CAST(YEAR(mi.CreatedAt) AS NVARCHAR(4)), ISNULL(NULLIF(LTRIM(RTRIM(mi.GroupName)), ''), 'Tanpa Group')
        ORDER BY Year DESC, TotalQty DESC
      `);
      res.json(
        result.recordset.map((r: any) => ({
          year: r.Year,
          groupName: r.GroupName,
          itemCount: Number(r.ItemCount || 0),
          totalQty: Number(r.TotalQty || 0),
          ...(opr ? {} : { totalCost: Number(r.TotalCost || 0) }),
        }))
      );
    } catch (err) {
      dbError(res, "GET /api/reports/dashboard-by-year-group", err);
    }
  });

  // GET /api/reports/by-category — dari VIEW StockByCategory
  app.get("/api/reports/by-category", authRequired, async (req: AuthedRequest, res) => {
    try {
      const pool = await getPool();
      const result = await pool.request().query("SELECT * FROM dbo.StockByCategory ORDER BY GroupName");
      const opr = isOPR(req);
      res.json(
        result.recordset.map((r: any) => ({
          groupName: r.GroupName,
          totalQty: Number(r.TotalQty || 0),
          totalNilaiJual: Number(r.TotalNilaiJual || 0),
          ...(opr ? {} : { totalNilaiBeli: Number(r.TotalNilaiBeli || 0) }),
        }))
      );
    } catch (err) {
      dbError(res, "GET /api/reports/by-category", err);
    }
  });

  // GET /api/stock/:itemCode/sisa — pengganti getSisaStokByItemCode
  app.get("/api/stock/:itemCode/sisa", authRequired, async (req: AuthedRequest, res) => {
    try {
      const pool = await getPool();
      const result = await pool
        .request()
        .input("ItemCode", sql.NVarChar(100), req.params.itemCode.trim().toUpperCase())
        .query(`
          SELECT
            ISNULL((SELECT SUM(Qty) FROM dbo.TransaksiMasuk WHERE ItemCode = @ItemCode), 0)  AS TotalMasuk,
            ISNULL((SELECT SUM(Qty) FROM dbo.TransaksiKeluar WHERE ItemCode = @ItemCode), 0) AS TotalKeluar
        `);
      const row = result.recordset[0];
      const totalMasuk = Number(row.TotalMasuk || 0);
      const totalKeluar = Number(row.TotalKeluar || 0);
      res.json({
        itemCode: req.params.itemCode.trim().toUpperCase(),
        totalMasuk,
        totalKeluar,
        sisaStok: totalMasuk - totalKeluar,
      });
    } catch (err) {
      dbError(res, "GET /api/stock/:itemCode/sisa", err);
    }
  });
}
