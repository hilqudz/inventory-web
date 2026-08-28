import type { Express, Response } from "express";
import { getPool, sql } from "./db";
import { authRequired, requireRole, type AuthedRequest } from "./auth";
import { ensureMasterItems } from "./dbHelpers";

/* Routes Transaksi Masuk & Keluar — pengganti fetch/add/update/delete/bulkAdd
   TransaksiMasuk/Keluar di src/supabase.ts. Kedua tabel identik strukturnya,
   jadi satu factory dipakai dua kali. Bentuk response = TransactionRecord
   (src/types.ts). */

const WRITE_ROLES = ["Admin", "Audit", "Team Gudang"];

const toDateStr = (v: any) => {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
};

const mapRow = (row: any) => ({
  id: String(row.Id),
  postingDate: toDateStr(row.TanggalTransaksi),
  entryName: row.EntryRemark || "",
  documentNo: row.DocumentNo || "",
  itemCode: row.ItemCode || "",
  category: row.Category || "",
  remark: row.EntryRemark || "",
  qty: Number(row.Qty || 0),
  fromLocation: row.FromLocation || "",
  toLocation: row.ToLocation || "",
  createdAt: row.CreatedAt,
});

function validateRecord(body: any): string | null {
  if (!body || typeof body.itemCode !== "string" || !body.itemCode.trim()) return "itemCode wajib diisi.";
  if (body.qty === undefined || isNaN(Number(body.qty))) return "qty wajib angka.";
  return null;
}

const dbError = (res: Response, label: string, err: any) => {
  console.error(`Error ${label}:`, err?.message || err);
  res.status(500).json({ error: "Operasi database gagal. Cek tunnel SSH masih terbuka." });
};

export function registerTransaksiRoutes(app: Express, kind: "masuk" | "keluar") {
  const table = kind === "masuk" ? "dbo.TransaksiMasuk" : "dbo.TransaksiKeluar";
  const base = `/api/transaksi-${kind}`;

  // GET — semua role
  app.get(base, authRequired, async (_req: AuthedRequest, res) => {
    try {
      const pool = await getPool();
      const result = await pool.request().query(`SELECT * FROM ${table} ORDER BY CreatedAt`);
      res.json(result.recordset.map(mapRow));
    } catch (err) {
      dbError(res, `GET ${base}`, err);
    }
  });

  // POST — Admin/Audit/Team Gudang
  app.post(base, authRequired, requireRole(...WRITE_ROLES), async (req: AuthedRequest, res) => {
    const invalid = validateRecord(req.body);
    if (invalid) return res.status(400).json({ error: invalid });
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      const r = req.body;
      await tx.begin();
      await ensureMasterItems(tx, [r.itemCode]);
      const result = await new sql.Request(tx)
        .input("ItemCode", sql.NVarChar(100), r.itemCode.trim().toUpperCase())
        .input("Qty", sql.Decimal(18, 2), Number(r.qty))
        .input("TanggalTransaksi", sql.Date, r.postingDate || null)
        .input("DocumentNo", sql.NVarChar(100), r.documentNo || null)
        .input("Category", sql.NVarChar(150), r.category || null)
        .input("EntryRemark", sql.NVarChar(500), r.remark || r.entryName || null)
        .input("FromLocation", sql.NVarChar(150), r.fromLocation || null)
        .input("ToLocation", sql.NVarChar(150), r.toLocation || null)
        .query(`
          INSERT INTO ${table} (ItemCode, Qty, TanggalTransaksi, DocumentNo, Category, EntryRemark, FromLocation, ToLocation)
          OUTPUT INSERTED.Id
          VALUES (@ItemCode, @Qty, @TanggalTransaksi, @DocumentNo, @Category, @EntryRemark, @FromLocation, @ToLocation)
        `);
      await tx.commit();
      res.status(201).json({ success: true, id: String(result.recordset[0].Id) });
    } catch (err) {
      try { await tx.rollback(); } catch { /* sudah batal */ }
      dbError(res, `POST ${base}`, err);
    }
  });

  // PUT /:id — Admin/Audit/Team Gudang, partial update
  app.put(`${base}/:id`, authRequired, requireRole(...WRITE_ROLES), async (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "id tidak valid." });

    const r = req.body || {};
    const sets: string[] = [];
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      if (r.itemCode !== undefined) await ensureMasterItems(tx, [r.itemCode]);

      const request = new sql.Request(tx).input("Id", sql.BigInt, id);
      if (r.itemCode !== undefined) { sets.push("ItemCode = @ItemCode"); request.input("ItemCode", sql.NVarChar(100), String(r.itemCode).trim().toUpperCase()); }
      if (r.qty !== undefined) {
        if (isNaN(Number(r.qty))) { await tx.rollback(); return res.status(400).json({ error: "qty harus angka." }); }
        sets.push("Qty = @Qty"); request.input("Qty", sql.Decimal(18, 2), Number(r.qty));
      }
      if (r.postingDate !== undefined) { sets.push("TanggalTransaksi = @Tgl"); request.input("Tgl", sql.Date, r.postingDate || null); }
      if (r.documentNo !== undefined) { sets.push("DocumentNo = @Doc"); request.input("Doc", sql.NVarChar(100), r.documentNo || null); }
      if (r.category !== undefined) { sets.push("Category = @Cat"); request.input("Cat", sql.NVarChar(150), r.category || null); }
      if (r.remark !== undefined || r.entryName !== undefined) { sets.push("EntryRemark = @Rem"); request.input("Rem", sql.NVarChar(500), r.remark ?? r.entryName ?? null); }
      if (r.fromLocation !== undefined) { sets.push("FromLocation = @From"); request.input("From", sql.NVarChar(150), r.fromLocation || null); }
      if (r.toLocation !== undefined) { sets.push("ToLocation = @To"); request.input("To", sql.NVarChar(150), r.toLocation || null); }
      if (!sets.length) { await tx.rollback(); return res.status(400).json({ error: "Tidak ada field yang diupdate." }); }

      const result = await request.query(`UPDATE ${table} SET ${sets.join(", ")} WHERE Id = @Id`);
      if (!result.rowsAffected[0]) { await tx.rollback(); return res.status(404).json({ error: "Record tidak ditemukan." }); }
      await tx.commit();
      res.json({ success: true });
    } catch (err) {
      try { await tx.rollback(); } catch { /* sudah batal */ }
      dbError(res, `PUT ${base}/:id`, err);
    }
  });

  // DELETE /:id — Admin only
  app.delete(`${base}/:id`, authRequired, requireRole("Admin"), async (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "id tidak valid." });
    try {
      const pool = await getPool();
      const result = await pool.request().input("Id", sql.BigInt, id).query(`DELETE FROM ${table} WHERE Id = @Id`);
      if (!result.rowsAffected[0]) return res.status(404).json({ error: "Record tidak ditemukan." });
      res.json({ success: true });
    } catch (err) {
      dbError(res, `DELETE ${base}/:id`, err);
    }
  });

  // POST /bulk — Admin/Audit/Team Gudang. Seperti bulkAddTransaksi* lama:
  // auto-upsert itemCode yang belum ada di MasterItem, lalu insert semua
  // record dalam satu transaction (all-or-nothing).
  app.post(`${base}/bulk`, authRequired, requireRole(...WRITE_ROLES), async (req: AuthedRequest, res) => {
    const records: any[] = req.body?.records;
    if (!Array.isArray(records) || !records.length) {
      return res.status(400).json({ error: "Body harus { records: [...] } dan tidak kosong." });
    }
    for (const [i, r] of records.entries()) {
      const invalid = validateRecord(r);
      if (invalid) return res.status(400).json({ error: `Record ke-${i + 1}: ${invalid}` });
    }

    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();

      await ensureMasterItems(tx, records.map((r) => r.itemCode));

      for (const r of records) {
        await new sql.Request(tx)
          .input("ItemCode", sql.NVarChar(100), String(r.itemCode).trim().toUpperCase())
          .input("Qty", sql.Decimal(18, 2), Number(r.qty))
          .input("TanggalTransaksi", sql.Date, r.postingDate || null)
          .input("DocumentNo", sql.NVarChar(100), r.documentNo || null)
          .input("Category", sql.NVarChar(150), r.category || null)
          .input("EntryRemark", sql.NVarChar(500), r.remark || r.entryName || null)
          .input("FromLocation", sql.NVarChar(150), r.fromLocation || null)
          .input("ToLocation", sql.NVarChar(150), r.toLocation || null)
          .query(`
            INSERT INTO ${table} (ItemCode, Qty, TanggalTransaksi, DocumentNo, Category, EntryRemark, FromLocation, ToLocation)
            VALUES (@ItemCode, @Qty, @TanggalTransaksi, @DocumentNo, @Category, @EntryRemark, @FromLocation, @ToLocation)
          `);
      }

      await tx.commit();
      res.status(201).json({ success: true, inserted: records.length });
    } catch (err) {
      try { await tx.rollback(); } catch { /* transaction sudah batal */ }
      dbError(res, `POST ${base}/bulk`, err);
    }
  });
}
