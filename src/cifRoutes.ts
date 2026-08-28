import type { Express, Response } from "express";
import { getPool, sql } from "./db";
import { authRequired, requireRole, type AuthedRequest } from "./auth";

/* Routes CIF Container / Biaya Impor — pengganti akses PostgREST langsung di
   CifBapContainerView.tsx ke resume_cif_kontainer / rincian_biaya_cif /
   rincian_biaya_selain_cif.

   KEAMANAN (CLAUDE.md poin 5): di Supabase lama tabel-tabel ini RLS-nya
   dimatikan total + GRANT ALL ke anon — data biaya impor bisa dibaca/diubah
   siapa pun. Di sini SEMUA endpoint Admin/Audit only, tanpa kecuali.

   Bentuk response snake_case mengikuti dump skema live, supaya penggantian
   fetch PostgREST di view (Fase 5) tinggal ganti URL. */

const CIF_ROLES = ["Admin", "Audit"];

const dbError = (res: Response, label: string, err: any) => {
  console.error(`Error ${label}:`, err?.message || err);
  res.status(500).json({ error: "Operasi database gagal. Cek tunnel SSH masih terbuka." });
};

const num = (v: any) => (v === undefined || v === null || v === "" ? null : Number(v));

const mapResume = (r: any) => ({
  id: String(r.Id),
  no_container: r.NoContainer,
  bulan_kont_jalan: r.BulanKontJalan || "",
  tgl_terima_pib: r.TglTerimaPib || "",
  ket: r.Ket || "",
  total_cost_po: Number(r.TotalCostPo || 0),
  total_cif: Number(r.TotalCif || 0),
  total_cif_ar1: Number(r.TotalCifAr1 || 0),
  total_cif_ar20: Number(r.TotalCifAr20 || 0),
  total_cif_ar6: Number(r.TotalCifAr6 || 0),
  total_cif_ar9: Number(r.TotalCifAr9 || 0),
  total_cif_soyu: Number(r.TotalCifSoyu || 0),
  total_cif_aff_na: Number(r.TotalCifAffNa || 0),
  pct_cif_vs_po: Number(r.PctCifVsPo || 0),
  created_at: r.CreatedAt,
});

const mapRincianCif = (r: any) => ({
  id: String(r.Id),
  no_container: r.NoContainer,
  deskripsi_biaya: r.DeskripsiBiaya,
  total_cif: Number(r.TotalCif || 0),
  pct_vs_po: Number(r.PctVsPo || 0),
  ar1: Number(r.Ar1 || 0),
  ar20: Number(r.Ar20 || 0),
  ar6: Number(r.Ar6 || 0),
  ar9: Number(r.Ar9 || 0),
  soyu: Number(r.Soyu || 0),
  aff_na: Number(r.AffNa || 0),
  keterangan: r.Keterangan || "",
  created_at: r.CreatedAt,
});

const mapRincianNonCif = (r: any) => ({
  id: String(r.Id),
  no_container: r.NoContainer,
  deskripsi_biaya: r.DeskripsiBiaya,
  kategori_biaya: r.KategoriBiaya || "",
  total_biaya: Number(r.TotalBiaya || 0),
  pct_vs_po: Number(r.PctVsPo || 0),
  created_at: r.CreatedAt,
});

export function registerCifRoutes(app: Express) {
  const guard = [authRequired, requireRole(...CIF_ROLES)] as const;

  // POST /api/cif-container — upsert header per NoContainer
  app.post("/api/cif-container", ...guard, async (req: AuthedRequest, res) => {
    const b = req.body || {};
    if (typeof b.no_container !== "string" || !b.no_container.trim()) {
      return res.status(400).json({ error: "no_container wajib diisi." });
    }
    try {
      const pool = await getPool();
      const result = await pool
        .request()
        .input("NoContainer", sql.NVarChar(100), b.no_container.trim())
        .input("BulanKontJalan", sql.NVarChar(50), b.bulan_kont_jalan || null)
        .input("TglTerimaPib", sql.NVarChar(50), b.tgl_terima_pib || null)
        .input("Ket", sql.NVarChar(500), b.ket || null)
        .input("TotalCostPo", sql.Decimal(18, 2), num(b.total_cost_po))
        .input("TotalCif", sql.Decimal(18, 2), num(b.total_cif))
        .input("TotalCifAr1", sql.Decimal(18, 2), num(b.total_cif_ar1))
        .input("TotalCifAr20", sql.Decimal(18, 2), num(b.total_cif_ar20))
        .input("TotalCifAr6", sql.Decimal(18, 2), num(b.total_cif_ar6))
        .input("TotalCifAr9", sql.Decimal(18, 2), num(b.total_cif_ar9))
        .input("TotalCifSoyu", sql.Decimal(18, 2), num(b.total_cif_soyu))
        .input("TotalCifAffNa", sql.Decimal(18, 2), num(b.total_cif_aff_na))
        .input("PctCifVsPo", sql.Decimal(9, 4), num(b.pct_cif_vs_po))
        .query(`
          MERGE dbo.ResumeCifKontainer AS t
          USING (SELECT @NoContainer AS NoContainer) AS s ON t.NoContainer = s.NoContainer
          WHEN MATCHED THEN UPDATE SET
            BulanKontJalan = @BulanKontJalan, TglTerimaPib = @TglTerimaPib, Ket = @Ket,
            TotalCostPo = @TotalCostPo, TotalCif = @TotalCif,
            TotalCifAr1 = @TotalCifAr1, TotalCifAr20 = @TotalCifAr20, TotalCifAr6 = @TotalCifAr6,
            TotalCifAr9 = @TotalCifAr9, TotalCifSoyu = @TotalCifSoyu, TotalCifAffNa = @TotalCifAffNa,
            PctCifVsPo = @PctCifVsPo
          WHEN NOT MATCHED THEN INSERT
            (NoContainer, BulanKontJalan, TglTerimaPib, Ket, TotalCostPo, TotalCif,
             TotalCifAr1, TotalCifAr20, TotalCifAr6, TotalCifAr9, TotalCifSoyu, TotalCifAffNa, PctCifVsPo)
            VALUES (@NoContainer, @BulanKontJalan, @TglTerimaPib, @Ket, @TotalCostPo, @TotalCif,
             @TotalCifAr1, @TotalCifAr20, @TotalCifAr6, @TotalCifAr9, @TotalCifSoyu, @TotalCifAffNa, @PctCifVsPo)
          OUTPUT $action AS Action;
        `);
      const action = result.recordset[0].Action === "INSERT" ? "inserted" : "updated";
      res.status(action === "inserted" ? 201 : 200).json({ success: true, action });
    } catch (err) {
      dbError(res, "POST /api/cif-container", err);
    }
  });

  // GET /api/cif-container/:noContainer — header saja
  app.get("/api/cif-container/:noContainer", ...guard, async (req: AuthedRequest, res) => {
    try {
      const pool = await getPool();
      const result = await pool
        .request()
        .input("No", sql.NVarChar(100), req.params.noContainer.trim())
        .query("SELECT * FROM dbo.ResumeCifKontainer WHERE NoContainer = @No");
      if (!result.recordset.length) return res.status(404).json({ error: "Container tidak ditemukan." });
      res.json(mapResume(result.recordset[0]));
    } catch (err) {
      dbError(res, "GET /api/cif-container/:noContainer", err);
    }
  });

  // GET rincian CIF
  app.get("/api/cif-container/:noContainer/rincian-cif", ...guard, async (req: AuthedRequest, res) => {
    try {
      const pool = await getPool();
      const result = await pool
        .request()
        .input("No", sql.NVarChar(100), req.params.noContainer.trim())
        .query("SELECT * FROM dbo.RincianBiayaCif WHERE NoContainer = @No ORDER BY Id");
      res.json(result.recordset.map(mapRincianCif));
    } catch (err) {
      dbError(res, "GET rincian-cif", err);
    }
  });

  // POST rincian CIF (bulk replace) — perilaku lama: DELETE per no_container lalu insert semua
  app.post("/api/cif-container/:noContainer/rincian-cif", ...guard, async (req: AuthedRequest, res) => {
    const records: any[] = req.body?.records;
    if (!Array.isArray(records)) return res.status(400).json({ error: "Body harus { records: [...] }." });
    const noContainer = req.params.noContainer.trim();
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      await new sql.Request(tx)
        .input("No", sql.NVarChar(100), noContainer)
        .query("DELETE FROM dbo.RincianBiayaCif WHERE NoContainer = @No");
      for (const r of records) {
        if (typeof r.deskripsi_biaya !== "string" || !r.deskripsi_biaya.trim()) {
          throw Object.assign(new Error("deskripsi_biaya wajib diisi di setiap record."), { status: 400 });
        }
        await new sql.Request(tx)
          .input("No", sql.NVarChar(100), noContainer)
          .input("Deskripsi", sql.NVarChar(300), r.deskripsi_biaya.trim())
          .input("TotalCif", sql.Decimal(18, 2), num(r.total_cif))
          .input("Pct", sql.Decimal(9, 4), num(r.pct_vs_po))
          .input("Ar1", sql.Decimal(18, 2), num(r.ar1))
          .input("Ar20", sql.Decimal(18, 2), num(r.ar20))
          .input("Ar6", sql.Decimal(18, 2), num(r.ar6))
          .input("Ar9", sql.Decimal(18, 2), num(r.ar9))
          .input("Soyu", sql.Decimal(18, 2), num(r.soyu))
          .input("AffNa", sql.Decimal(18, 2), num(r.aff_na))
          .input("Ket", sql.NVarChar(500), r.keterangan || null)
          .query(`
            INSERT INTO dbo.RincianBiayaCif
              (NoContainer, DeskripsiBiaya, TotalCif, PctVsPo, Ar1, Ar20, Ar6, Ar9, Soyu, AffNa, Keterangan)
            VALUES (@No, @Deskripsi, @TotalCif, @Pct, @Ar1, @Ar20, @Ar6, @Ar9, @Soyu, @AffNa, @Ket)
          `);
      }
      await tx.commit();
      res.status(201).json({ success: true, inserted: records.length });
    } catch (err: any) {
      try { await tx.rollback(); } catch { /* sudah batal */ }
      if (err?.status === 400) return res.status(400).json({ error: err.message });
      dbError(res, "POST rincian-cif", err);
    }
  });

  // GET rincian non-CIF
  app.get("/api/cif-container/:noContainer/rincian-non-cif", ...guard, async (req: AuthedRequest, res) => {
    try {
      const pool = await getPool();
      const result = await pool
        .request()
        .input("No", sql.NVarChar(100), req.params.noContainer.trim())
        .query("SELECT * FROM dbo.RincianBiayaSelainCif WHERE NoContainer = @No ORDER BY Id");
      res.json(result.recordset.map(mapRincianNonCif));
    } catch (err) {
      dbError(res, "GET rincian-non-cif", err);
    }
  });

  // POST rincian non-CIF (bulk replace)
  app.post("/api/cif-container/:noContainer/rincian-non-cif", ...guard, async (req: AuthedRequest, res) => {
    const records: any[] = req.body?.records;
    if (!Array.isArray(records)) return res.status(400).json({ error: "Body harus { records: [...] }." });
    const noContainer = req.params.noContainer.trim();
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      await new sql.Request(tx)
        .input("No", sql.NVarChar(100), noContainer)
        .query("DELETE FROM dbo.RincianBiayaSelainCif WHERE NoContainer = @No");
      for (const r of records) {
        if (typeof r.deskripsi_biaya !== "string" || !r.deskripsi_biaya.trim()) {
          throw Object.assign(new Error("deskripsi_biaya wajib diisi di setiap record."), { status: 400 });
        }
        await new sql.Request(tx)
          .input("No", sql.NVarChar(100), noContainer)
          .input("Deskripsi", sql.NVarChar(300), r.deskripsi_biaya.trim())
          .input("Kategori", sql.NVarChar(100), r.kategori_biaya || null)
          .input("Total", sql.Decimal(18, 2), num(r.total_biaya))
          .input("Pct", sql.Decimal(9, 4), num(r.pct_vs_po))
          .query(`
            INSERT INTO dbo.RincianBiayaSelainCif (NoContainer, DeskripsiBiaya, KategoriBiaya, TotalBiaya, PctVsPo)
            VALUES (@No, @Deskripsi, @Kategori, @Total, @Pct)
          `);
      }
      await tx.commit();
      res.status(201).json({ success: true, inserted: records.length });
    } catch (err: any) {
      try { await tx.rollback(); } catch { /* sudah batal */ }
      if (err?.status === 400) return res.status(400).json({ error: err.message });
      dbError(res, "POST rincian-non-cif", err);
    }
  });

  // DELETE /api/cif-container/:noContainer — hapus header + semua rincian
  app.delete("/api/cif-container/:noContainer", ...guard, async (req: AuthedRequest, res) => {
    const noContainer = req.params.noContainer.trim();
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      // Nomor container kadang tersimpan dengan/tanpa spasi — hapus keduanya
      const noSpace = noContainer.replace(/\s+/g, "");
      const result = await new sql.Request(tx)
        .input("No", sql.NVarChar(100), noContainer)
        .input("NoSpace", sql.NVarChar(100), noSpace)
        .query(`
          DELETE FROM dbo.RincianBiayaCif WHERE NoContainer IN (@No, @NoSpace);
          DELETE FROM dbo.RincianBiayaSelainCif WHERE NoContainer IN (@No, @NoSpace);
          DELETE FROM dbo.ResumeCifKontainer WHERE NoContainer IN (@No, @NoSpace);
        `);
      await tx.commit();
      const total = (result.rowsAffected || []).reduce((a: number, b: number) => a + b, 0);
      res.json({ success: true, deleted: total });
    } catch (err) {
      try { await tx.rollback(); } catch { /* sudah batal */ }
      dbError(res, "DELETE /api/cif-container/:noContainer", err);
    }
  });

  // GET /lengkap — header + kedua rincian dalam satu response
  // (replikasi view_resume_cif_lengkap, satu round-trip 3 result set)
  app.get("/api/cif-container/:noContainer/lengkap", ...guard, async (req: AuthedRequest, res) => {
    try {
      const pool = await getPool();
      const result = await pool
        .request()
        .input("No", sql.NVarChar(100), req.params.noContainer.trim())
        .query(`
          SELECT * FROM dbo.ResumeCifKontainer WHERE NoContainer = @No;
          SELECT * FROM dbo.RincianBiayaCif WHERE NoContainer = @No ORDER BY Id;
          SELECT * FROM dbo.RincianBiayaSelainCif WHERE NoContainer = @No ORDER BY Id;
        `);
      const [headerRs, cifRs, nonCifRs] = result.recordsets as any[];
      if (!headerRs.length) return res.status(404).json({ error: "Container tidak ditemukan." });
      res.json({
        resume: mapResume(headerRs[0]),
        rincian_cif: cifRs.map(mapRincianCif),
        rincian_non_cif: nonCifRs.map(mapRincianNonCif),
      });
    } catch (err) {
      dbError(res, "GET /lengkap", err);
    }
  });
}
