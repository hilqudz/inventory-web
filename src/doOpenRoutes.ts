import type { Express, Response } from "express";
import { getPool, sql } from "./db";
import { authRequired, requireRole, type AuthedRequest } from "./auth";
import { ensureMasterItems, cleanCode } from "./dbHelpers";

/* Routes DO Open — pengganti fetchDoOpen/addDoOpen/updateDoOpen/deleteDoOpen/
   bulkAddOrUpdateDoOpen (supabase.ts), autoReconcileDoOpen (firebase.ts), dan
   cleanupDuplicateTransactionsInSupabase. Bentuk response = DoOpenRecord
   (src/types.ts): entryName ← AreaRmOpr, category ← StatusDoOpen,
   remark ← AreaSpvOpr. */

const WRITE_ROLES = ["Admin", "Audit", "Team Gudang"];

const mapRow = (row: any) => ({
  id: String(row.Id).toLowerCase(),
  postingDate: row.PostingDate || "",
  entryName: row.AreaRmOpr || "",
  documentNo: row.DocumentNo || "",
  noDosl: row.NoDosl || "",
  itemCode: row.ItemCode || "",
  category: row.StatusDoOpen || "",
  remark: row.AreaSpvOpr || "",
  qty: Number(row.Qty || 0),
  fromLocation: row.FromLocation || "",
  toLocation: row.ToLocation || "",
  keterangan: row.Keterangan || "",
  createdAt: row.CreatedAt,
});

const dbError = (res: Response, label: string, err: any) => {
  console.error(`Error ${label}:`, err?.message || err);
  res.status(500).json({ error: "Operasi database gagal. Cek tunnel SSH masih terbuka." });
};

function insertRequest(tx: sql.Transaction, r: any) {
  return new sql.Request(tx)
    .input("PostingDate", sql.NVarChar(50), r.postingDate || new Date().toISOString().slice(0, 10))
    .input("AreaRmOpr", sql.NVarChar(150), r.entryName || "BELUM ADA AREA OPR")
    .input("DocumentNo", sql.NVarChar(100), String(r.documentNo).trim())
    .input("NoDosl", sql.NVarChar(100), r.noDosl || "-")
    .input("ItemCode", sql.NVarChar(100), cleanCode(r.itemCode))
    .input("StatusDoOpen", sql.NVarChar(100), r.category || "DO SUDAH DI LOGISTIK")
    .input("AreaSpvOpr", sql.NVarChar(150), r.remark || "-")
    .input("Qty", sql.Decimal(18, 2), Number(r.qty || 0))
    .input("FromLocation", sql.NVarChar(150), r.fromLocation || "-")
    .input("ToLocation", sql.NVarChar(150), r.toLocation || "-")
    .input("Keterangan", sql.NVarChar(500), r.keterangan || "-")
    .query(`
      INSERT INTO dbo.DoOpen (PostingDate, AreaRmOpr, DocumentNo, NoDosl, ItemCode, StatusDoOpen, AreaSpvOpr, Qty, FromLocation, ToLocation, Keterangan, Aksi)
      OUTPUT INSERTED.Id
      VALUES (@PostingDate, @AreaRmOpr, @DocumentNo, @NoDosl, @ItemCode, @StatusDoOpen, @AreaSpvOpr, @Qty, @FromLocation, @ToLocation, @Keterangan, N'DO_OPEN')
    `);
}

export function registerDoOpenRoutes(app: Express) {
  // GET — semua role; OPR difilter AreaRmOpr = RmAreaScope kalau scope-nya diisi
  // (scope kosong = enforcement belum aktif, lihat komentar DDL sql/001)
  app.get("/api/do-open", authRequired, async (req: AuthedRequest, res) => {
    try {
      const pool = await getPool();
      let scope: string | null = null;
      if (req.user!.role === "OPR") {
        const u = await pool
          .request()
          .input("Nik", sql.NVarChar(50), req.user!.nik)
          .query("SELECT RmAreaScope FROM dbo.Users WHERE Nik = @Nik");
        scope = u.recordset[0]?.RmAreaScope || null;
      }
      const request = pool.request();
      let where = "";
      if (scope) {
        where = "WHERE AreaRmOpr = @Scope";
        request.input("Scope", sql.NVarChar(150), scope);
      }
      const result = await request.query(`SELECT * FROM dbo.DoOpen ${where} ORDER BY CreatedAt`);
      res.json(result.recordset.map(mapRow));
    } catch (err) {
      dbError(res, "GET /api/do-open", err);
    }
  });

  // POST — Admin/Audit/Team Gudang
  app.post("/api/do-open", authRequired, requireRole(...WRITE_ROLES), async (req: AuthedRequest, res) => {
    const r = req.body || {};
    if (typeof r.documentNo !== "string" || !r.documentNo.trim()) {
      return res.status(400).json({ error: "documentNo wajib diisi." });
    }
    if (r.qty !== undefined && isNaN(Number(r.qty))) {
      return res.status(400).json({ error: "qty harus angka." });
    }
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      await ensureMasterItems(tx, [r.itemCode]);
      const result = await insertRequest(tx, r);
      await tx.commit();
      res.status(201).json({ success: true, id: String(result.recordset[0].Id).toLowerCase() });
    } catch (err) {
      try { await tx.rollback(); } catch { /* sudah batal */ }
      dbError(res, "POST /api/do-open", err);
    }
  });

  // PUT /keterangan-by-document/:documentNo — Admin/Audit/Team Gudang + OPR
  // (beda dari WRITE_ROLES field lain kayak No DOSL/Qty — OPR yang sehari-hari
  // isi Keterangan sebelum request, jadi khusus endpoint ini diizinkan juga).
  // Update Keterangan utk SEMUA baris dengan DocumentNo yang sama sekaligus —
  // 1 catatan mewakili seluruh No DO (bukan per-item), sesuai permintaan user
  // supaya gak ada item yang kelupaan diisi & jadi gak konsisten.
  app.put(
    "/api/do-open/keterangan-by-document/:documentNo",
    authRequired,
    requireRole(...WRITE_ROLES, "OPR"),
    async (req: AuthedRequest, res) => {
      const keterangan = req.body?.keterangan;
      try {
        const pool = await getPool();
        const result = await pool
          .request()
          .input("DocumentNo", sql.NVarChar(100), req.params.documentNo)
          .input("K", sql.NVarChar(500), keterangan || null)
          .query(`UPDATE dbo.DoOpen SET Keterangan = @K WHERE DocumentNo = @DocumentNo`);
        res.json({ success: true, updated: result.rowsAffected[0] });
      } catch (err) {
        dbError(res, "PUT /api/do-open/keterangan-by-document/:documentNo", err);
      }
    }
  );

  // PUT /:id — Admin/Audit/Team Gudang, partial update
  app.put("/api/do-open/:id", authRequired, requireRole(...WRITE_ROLES), async (req: AuthedRequest, res) => {
    const r = req.body || {};
    const sets: string[] = [];
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      const request = new sql.Request(tx).input("Id", sql.UniqueIdentifier, req.params.id);
      if (r.postingDate !== undefined) { sets.push("PostingDate = @P"); request.input("P", sql.NVarChar(50), r.postingDate || null); }
      if (r.entryName !== undefined) { sets.push("AreaRmOpr = @E"); request.input("E", sql.NVarChar(150), r.entryName || null); }
      if (r.documentNo !== undefined) { sets.push("DocumentNo = @D"); request.input("D", sql.NVarChar(100), String(r.documentNo).trim()); }
      if (r.noDosl !== undefined) { sets.push("NoDosl = @N"); request.input("N", sql.NVarChar(100), r.noDosl || null); }
      if (r.itemCode !== undefined) {
        await ensureMasterItems(tx, [r.itemCode]);
        sets.push("ItemCode = @I"); request.input("I", sql.NVarChar(100), cleanCode(r.itemCode));
      }
      if (r.category !== undefined) { sets.push("StatusDoOpen = @S"); request.input("S", sql.NVarChar(100), r.category || null); }
      if (r.remark !== undefined) { sets.push("AreaSpvOpr = @A"); request.input("A", sql.NVarChar(150), r.remark || null); }
      if (r.qty !== undefined) {
        if (isNaN(Number(r.qty))) { await tx.rollback(); return res.status(400).json({ error: "qty harus angka." }); }
        sets.push("Qty = @Q"); request.input("Q", sql.Decimal(18, 2), Number(r.qty));
      }
      if (r.fromLocation !== undefined) { sets.push("FromLocation = @F"); request.input("F", sql.NVarChar(150), r.fromLocation || null); }
      if (r.toLocation !== undefined) { sets.push("ToLocation = @T"); request.input("T", sql.NVarChar(150), r.toLocation || null); }
      if (r.keterangan !== undefined) { sets.push("Keterangan = @K"); request.input("K", sql.NVarChar(500), r.keterangan || null); }
      if (!sets.length) { await tx.rollback(); return res.status(400).json({ error: "Tidak ada field yang diupdate." }); }

      const result = await request.query(`UPDATE dbo.DoOpen SET ${sets.join(", ")} WHERE Id = @Id`);
      await tx.commit();
      if (!result.rowsAffected[0]) return res.status(404).json({ error: "Record tidak ditemukan." });
      res.json({ success: true });
    } catch (err) {
      try { await tx.rollback(); } catch { /* sudah batal */ }
      dbError(res, "PUT /api/do-open/:id", err);
    }
  });

  // DELETE /:id — Admin only
  app.delete("/api/do-open/:id", authRequired, requireRole("Admin"), async (req: AuthedRequest, res) => {
    try {
      const pool = await getPool();
      const result = await pool
        .request()
        .input("Id", sql.UniqueIdentifier, req.params.id)
        .query("DELETE FROM dbo.DoOpen WHERE Id = @Id");
      if (!result.rowsAffected[0]) return res.status(404).json({ error: "Record tidak ditemukan." });
      res.json({ success: true });
    } catch (err) {
      dbError(res, "DELETE /api/do-open/:id", err);
    }
  });

  // POST /bulk-upsert — replikasi bulkAddOrUpdateDoOpen: match existing record
  // per DocumentNo+ItemCode (exact), fallback DocumentNo saja; match → update
  // field terisi, tidak match → insert baru. Return { updatedCount, insertedCount }.
  app.post("/api/do-open/bulk-upsert", authRequired, requireRole(...WRITE_ROLES), async (req: AuthedRequest, res) => {
    const items: any[] = req.body?.records;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "Body harus { records: [...] } dan tidak kosong." });
    }
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();

      await ensureMasterItems(tx, items.map((i) => i.itemCode));

      const existing = await new sql.Request(tx).query("SELECT Id, DocumentNo, ItemCode FROM dbo.DoOpen");
      const poolFull = new Map<string, any[]>();
      const poolDoc = new Map<string, any[]>();
      for (const rec of existing.recordset) {
        const docKey = String(rec.DocumentNo || "").trim().toUpperCase();
        if (!docKey) continue;
        const fullKey = `${docKey}_${cleanCode(rec.ItemCode)}`;
        (poolFull.get(fullKey) || poolFull.set(fullKey, []).get(fullKey)!).push(rec);
        (poolDoc.get(docKey) || poolDoc.set(docKey, []).get(docKey)!).push(rec);
      }

      let updatedCount = 0;
      let insertedCount = 0;

      for (const item of items) {
        const docKey = String(item.documentNo || "").trim().toUpperCase();
        if (!docKey) continue;
        const itemKey = cleanCode(item.itemCode);

        let matched: any = null;
        if (itemKey !== "-") {
          const list = poolFull.get(`${docKey}_${itemKey}`);
          if (list?.length) {
            matched = list.shift();
            const docList = poolDoc.get(docKey);
            if (docList) {
              const idx = docList.findIndex((x) => x.Id === matched.Id);
              if (idx >= 0) docList.splice(idx, 1);
            }
          }
        }
        if (!matched) {
          const docList = poolDoc.get(docKey);
          if (docList?.length) {
            matched = docList.shift();
            const fk = `${docKey}_${cleanCode(matched.ItemCode)}`;
            const list = poolFull.get(fk);
            if (list) {
              const idx = list.findIndex((x) => x.Id === matched.Id);
              if (idx >= 0) list.splice(idx, 1);
            }
          }
        }

        if (matched) {
          // Sama seperti versi lama: hanya field terisi (dan bukan placeholder) yang di-update
          const sets: string[] = [];
          const request = new sql.Request(tx).input("Id", sql.UniqueIdentifier, matched.Id);
          if (item.category) { sets.push("StatusDoOpen = @S"); request.input("S", sql.NVarChar(100), item.category); }
          if (item.remark && item.remark !== "-") { sets.push("AreaSpvOpr = @A"); request.input("A", sql.NVarChar(150), item.remark); }
          if (item.postingDate) { sets.push("PostingDate = @P"); request.input("P", sql.NVarChar(50), item.postingDate); }
          if (item.noDosl && item.noDosl !== "-") { sets.push("NoDosl = @N"); request.input("N", sql.NVarChar(100), item.noDosl); }
          if (item.qty !== undefined && Number(item.qty) >= 0) { sets.push("Qty = @Q"); request.input("Q", sql.Decimal(18, 2), Number(item.qty)); }
          if (item.fromLocation && item.fromLocation !== "-") { sets.push("FromLocation = @F"); request.input("F", sql.NVarChar(150), item.fromLocation); }
          if (item.toLocation && item.toLocation !== "-") { sets.push("ToLocation = @T"); request.input("T", sql.NVarChar(150), item.toLocation); }
          if (item.keterangan && item.keterangan !== "-") { sets.push("Keterangan = @K"); request.input("K", sql.NVarChar(500), item.keterangan); }
          if (item.entryName && item.entryName !== "System" && item.entryName !== "BELUM ADA AREA OPR") { sets.push("AreaRmOpr = @E"); request.input("E", sql.NVarChar(150), item.entryName); }
          if (item.itemCode && item.itemCode !== "-") { sets.push("ItemCode = @I"); request.input("I", sql.NVarChar(100), itemKey); }
          if (sets.length) {
            await request.query(`UPDATE dbo.DoOpen SET ${sets.join(", ")} WHERE Id = @Id`);
            updatedCount++;
          }
        } else {
          await insertRequest(tx, item);
          insertedCount++;
        }
      }

      await tx.commit();
      res.json({ updatedCount, insertedCount });
    } catch (err) {
      try { await tx.rollback(); } catch { /* sudah batal */ }
      dbError(res, "POST /api/do-open/bulk-upsert", err);
    }
  });

  // POST /reconcile — replikasi autoReconcileDoOpen (firebase.ts): hapus baris
  // DoOpen yang DocumentNo-nya sudah muncul di TransaksiKeluar. Versi SQL:
  // satu operasi set-based, bukan loop di JS.
  app.post("/api/do-open/reconcile", authRequired, requireRole(...WRITE_ROLES), async (_req: AuthedRequest, res) => {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      const candidates = await new sql.Request(tx).query(`
        SELECT d.Id, d.DocumentNo
        FROM dbo.DoOpen d
        WHERE UPPER(LTRIM(RTRIM(d.DocumentNo))) IN (
          SELECT DISTINCT UPPER(LTRIM(RTRIM(k.DocumentNo)))
          FROM dbo.TransaksiKeluar k
          WHERE k.DocumentNo IS NOT NULL AND LTRIM(RTRIM(k.DocumentNo)) <> ''
        )
      `);
      const deletedIds = candidates.recordset.map((r: any) => String(r.Id).toLowerCase());
      const deletedDocs = Array.from(new Set(candidates.recordset.map((r: any) => r.DocumentNo)));
      if (deletedIds.length) {
        await new sql.Request(tx).query(`
          DELETE d FROM dbo.DoOpen d
          WHERE UPPER(LTRIM(RTRIM(d.DocumentNo))) IN (
            SELECT DISTINCT UPPER(LTRIM(RTRIM(k.DocumentNo)))
            FROM dbo.TransaksiKeluar k
            WHERE k.DocumentNo IS NOT NULL AND LTRIM(RTRIM(k.DocumentNo)) <> ''
          )
        `);
      }
      await tx.commit();
      res.json({ deletedCount: deletedIds.length, deletedDocs, deletedIds });
    } catch (err) {
      try { await tx.rollback(); } catch { /* sudah batal */ }
      dbError(res, "POST /api/do-open/reconcile", err);
    }
  });

  // POST /cleanup-duplicates — Admin only. Replikasi cleanupDuplicateTransactions:
  // hapus baris duplikat, sisakan yang paling awal (CreatedAt terkecil).
  app.post("/api/do-open/cleanup-duplicates", authRequired, requireRole("Admin"), async (_req: AuthedRequest, res) => {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      // Signature duplikat transaksi: DocumentNo+ItemCode+Tanggal+Qty+FromLocation+ToLocation
      const dedupeTransaksi = (table: string) => `
        WITH d AS (
          SELECT ROW_NUMBER() OVER (
            PARTITION BY UPPER(ISNULL(DocumentNo,'')), UPPER(ISNULL(ItemCode,'')),
                         ISNULL(TanggalTransaksi,'1900-01-01'), ISNULL(Qty,0),
                         UPPER(ISNULL(FromLocation,'')), UPPER(ISNULL(ToLocation,''))
            ORDER BY CreatedAt ASC, Id ASC
          ) AS rn
          FROM ${table}
        )
        DELETE FROM d WHERE rn > 1
      `;
      const masuk = await new sql.Request(tx).query(dedupeTransaksi("dbo.TransaksiMasuk"));
      const keluar = await new sql.Request(tx).query(dedupeTransaksi("dbo.TransaksiKeluar"));
      // DoOpen: duplikat = DocumentNo + ItemCode sama
      const doOpen = await new sql.Request(tx).query(`
        WITH d AS (
          SELECT ROW_NUMBER() OVER (
            PARTITION BY UPPER(ISNULL(DocumentNo,'')), UPPER(ISNULL(ItemCode,''))
            ORDER BY CreatedAt ASC, Id ASC
          ) AS rn
          FROM dbo.DoOpen
        )
        DELETE FROM d WHERE rn > 1
      `);
      await tx.commit();
      res.json({
        deletedMasuk: masuk.rowsAffected[0] || 0,
        deletedKeluar: keluar.rowsAffected[0] || 0,
        deletedDoOpen: doOpen.rowsAffected[0] || 0,
      });
    } catch (err) {
      try { await tx.rollback(); } catch { /* sudah batal */ }
      dbError(res, "POST /api/do-open/cleanup-duplicates", err);
    }
  });
}
