import type { Express, Response } from "express";
import { getPool, sql } from "./db";
import { authRequired, requireRole, type AuthedRequest } from "./auth";

/* Routes Container Status — pengganti fetchContainerStatus/addContainerStatus/
   updateContainerStatus/deleteContainerStatus/saveBatchContainerStatus di
   src/supabase.ts. Bentuk response = ContainerRecord (src/types.ts).
   Local-cache fallback versi lama tidak direplikasi (itu workaround kuota
   Supabase, tidak relevan lagi). */

const WRITE_ROLES = ["Admin", "Audit", "Team Gudang"];

// Normalisasi status free-text → salah satu dari ContainerStatusType,
// sama seperti fuzzy match di fetchContainerStatus lama
function normalizeStatus(raw: any): string {
  const s = String(raw || "").trim().toLowerCase();
  if (s.includes("tiba di bintara") || s.includes("sudah tiba")) return "Barang Sudah Tiba di Bintara";
  if (s.includes("belum otw") || s.includes("belum")) return "Container Belum OTW";
  if (s.includes("masih otw") || s.includes("otw")) return "Container Masih OTW";
  return "Container Belum OTW";
}

const mapRow = (row: any) => ({
  id: String(row.Id),
  noContainer: row.NoContainer || "",
  category: row.Category || "",
  tglTibaPriuk: row.TglTibaPriuk || "",
  tglTibaBintara: row.TglTibaBintara || "",
  itemCategoryBarang: row.ItemCategoryBarang || "",
  statusContainer: normalizeStatus(row.StatusContainer),
  totalQty: Number(row.TotalQty || 0),
  totalCost: Number(row.TotalCost || 0),
  totalPrice: Number(row.TotalPrice || 0),
  remark: row.Remark || "",
  createdAt: row.CreatedAt,
});

const dbError = (res: Response, label: string, err: any) => {
  console.error(`Error ${label}:`, err?.message || err);
  res.status(500).json({ error: "Operasi database gagal. Cek tunnel SSH masih terbuka." });
};

// Upsert per NoContainer — perilaku lama: insert, kalau nomor sudah ada → update.
// Return 'inserted' | 'updated'.
async function upsertByNoContainer(reqOrTx: sql.Request, r: any): Promise<"inserted" | "updated"> {
  const result = await reqOrTx
    .input("NoContainer", sql.NVarChar(100), String(r.noContainer).trim())
    .input("Category", sql.NVarChar(150), r.category || "IMPORT")
    .input("TglTibaPriuk", sql.NVarChar(50), r.tglTibaPriuk || "")
    .input("TglTibaBintara", sql.NVarChar(50), r.tglTibaBintara || "")
    .input("ItemCategoryBarang", sql.NVarChar(150), r.itemCategoryBarang || "")
    .input("StatusContainer", sql.NVarChar(100), normalizeStatus(r.statusContainer))
    .input("TotalQty", sql.Decimal(18, 2), Number(r.totalQty || 0))
    .input("TotalCost", sql.Decimal(18, 2), Number(r.totalCost || 0))
    .input("TotalPrice", sql.Decimal(18, 2), Number(r.totalPrice || 0))
    .input("Remark", sql.NVarChar(500), r.remark || "")
    .query(`
      MERGE dbo.ContainerStatus AS t
      USING (SELECT @NoContainer AS NoContainer) AS s
        ON UPPER(LTRIM(RTRIM(t.NoContainer))) = UPPER(LTRIM(RTRIM(s.NoContainer)))
      WHEN MATCHED THEN UPDATE SET
        Category = @Category, TglTibaPriuk = @TglTibaPriuk, TglTibaBintara = @TglTibaBintara,
        ItemCategoryBarang = @ItemCategoryBarang, StatusContainer = @StatusContainer,
        TotalQty = @TotalQty, TotalCost = @TotalCost, TotalPrice = @TotalPrice, Remark = @Remark
      WHEN NOT MATCHED THEN INSERT
        (NoContainer, Category, TglTibaPriuk, TglTibaBintara, ItemCategoryBarang, StatusContainer, TotalQty, TotalCost, TotalPrice, Remark)
        VALUES (@NoContainer, @Category, @TglTibaPriuk, @TglTibaBintara, @ItemCategoryBarang, @StatusContainer, @TotalQty, @TotalCost, @TotalPrice, @Remark)
      OUTPUT $action AS Action;
    `);
  return result.recordset[0].Action === "INSERT" ? "inserted" : "updated";
}

export function registerContainerRoutes(app: Express) {
  // GET — semua role
  app.get("/api/containers", authRequired, async (_req: AuthedRequest, res) => {
    try {
      const pool = await getPool();
      const result = await pool.request().query("SELECT * FROM dbo.ContainerStatus ORDER BY CreatedAt");
      res.json(result.recordset.map(mapRow));
    } catch (err) {
      dbError(res, "GET /api/containers", err);
    }
  });

  // POST — Admin/Audit/Team Gudang; NoContainer sudah ada → update (perilaku lama)
  app.post("/api/containers", authRequired, requireRole(...WRITE_ROLES), async (req: AuthedRequest, res) => {
    const r = req.body || {};
    if (typeof r.noContainer !== "string" || !r.noContainer.trim()) {
      return res.status(400).json({ error: "noContainer wajib diisi." });
    }
    try {
      const pool = await getPool();
      const action = await upsertByNoContainer(pool.request(), r);
      res.status(action === "inserted" ? 201 : 200).json({ success: true, action });
    } catch (err) {
      dbError(res, "POST /api/containers", err);
    }
  });

  // PUT /:id — Admin/Audit/Team Gudang, partial update by Id
  app.put("/api/containers/:id", authRequired, requireRole(...WRITE_ROLES), async (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "id tidak valid." });
    const r = req.body || {};
    const sets: string[] = [];
    const request = (await getPool()).request().input("Id", sql.BigInt, id);
    if (r.noContainer !== undefined) { sets.push("NoContainer = @No"); request.input("No", sql.NVarChar(100), String(r.noContainer).trim()); }
    if (r.category !== undefined) { sets.push("Category = @Cat"); request.input("Cat", sql.NVarChar(150), r.category || null); }
    if (r.tglTibaPriuk !== undefined) { sets.push("TglTibaPriuk = @Priuk"); request.input("Priuk", sql.NVarChar(50), r.tglTibaPriuk || null); }
    if (r.tglTibaBintara !== undefined) { sets.push("TglTibaBintara = @Bintara"); request.input("Bintara", sql.NVarChar(50), r.tglTibaBintara || null); }
    if (r.itemCategoryBarang !== undefined) { sets.push("ItemCategoryBarang = @ItemCat"); request.input("ItemCat", sql.NVarChar(150), r.itemCategoryBarang || null); }
    if (r.statusContainer !== undefined) { sets.push("StatusContainer = @Status"); request.input("Status", sql.NVarChar(100), normalizeStatus(r.statusContainer)); }
    if (r.totalQty !== undefined) { sets.push("TotalQty = @Qty"); request.input("Qty", sql.Decimal(18, 2), Number(r.totalQty || 0)); }
    if (r.totalCost !== undefined) { sets.push("TotalCost = @Cost"); request.input("Cost", sql.Decimal(18, 2), Number(r.totalCost || 0)); }
    if (r.totalPrice !== undefined) { sets.push("TotalPrice = @Price"); request.input("Price", sql.Decimal(18, 2), Number(r.totalPrice || 0)); }
    if (r.remark !== undefined) { sets.push("Remark = @Rem"); request.input("Rem", sql.NVarChar(500), r.remark || null); }
    if (!sets.length) return res.status(400).json({ error: "Tidak ada field yang diupdate." });
    try {
      const result = await request.query(`UPDATE dbo.ContainerStatus SET ${sets.join(", ")} WHERE Id = @Id`);
      if (!result.rowsAffected[0]) return res.status(404).json({ error: "Container tidak ditemukan." });
      res.json({ success: true });
    } catch (err) {
      dbError(res, "PUT /api/containers/:id", err);
    }
  });

  // DELETE /:id — Admin only
  app.delete("/api/containers/:id", authRequired, requireRole("Admin"), async (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "id tidak valid." });
    try {
      const pool = await getPool();
      const result = await pool.request().input("Id", sql.BigInt, id).query("DELETE FROM dbo.ContainerStatus WHERE Id = @Id");
      if (!result.rowsAffected[0]) return res.status(404).json({ error: "Container tidak ditemukan." });
      res.json({ success: true });
    } catch (err) {
      dbError(res, "DELETE /api/containers/:id", err);
    }
  });

  // POST /batch — Admin/Audit/Team Gudang; upsert per NoContainer dalam satu
  // transaction. Return { insertedCount, updatedCount } seperti versi lama.
  app.post("/api/containers/batch", authRequired, requireRole(...WRITE_ROLES), async (req: AuthedRequest, res) => {
    const records: any[] = req.body?.records;
    if (!Array.isArray(records) || !records.length) {
      return res.status(400).json({ error: "Body harus { records: [...] } dan tidak kosong." });
    }
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      let insertedCount = 0;
      let updatedCount = 0;
      for (const r of records) {
        if (typeof r.noContainer !== "string" || !r.noContainer.trim()) continue;
        const action = await upsertByNoContainer(new sql.Request(tx), r);
        if (action === "inserted") insertedCount++;
        else updatedCount++;
      }
      await tx.commit();
      res.json({ insertedCount, updatedCount });
    } catch (err) {
      try { await tx.rollback(); } catch { /* sudah batal */ }
      dbError(res, "POST /api/containers/batch", err);
    }
  });
}
